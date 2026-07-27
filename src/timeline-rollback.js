import { db, getFields, logAudit, nowSql, recordClassroomHistory, setClassroomValue } from "./database.js";

const supportedMutationActions = new Set([
  "review_approved",
  "review_create_approved",
  "create_classroom",
  "upload_classroom_photo",
  "delete_classroom_photo",
  "review_photo_upload_approved",
  "review_photo_delete_approved",
  "rollback_change_request",
  "rollback_to_before"
]);

const knownMutationActions = new Set([
  ...supportedMutationActions,
  "rollback_create_request",
  "rollback_create_to_before",
  "rollback_timeline_single",
  "rollback_timeline_to_before",
  "bulk_mark_standard_exam_room",
  "bulk_set_monitoring_for_standard_exam_room"
]);

export function buildTimelineRollbackPreview(auditId, scope = "before") {
  const target = getAuditLog(auditId);
  if (!target || !knownMutationActions.has(target.action)) {
    const error = new Error("只能从正式数据修改记录发起整体还原");
    error.statusCode = 404;
    throw error;
  }

  const normalizedScope = scope === "single" ? "single" : "before";
  const events = normalizedScope === "single"
    ? [target]
    : db.prepare(`
      SELECT * FROM audit_logs
      WHERE id >= ?
      ORDER BY id DESC
    `).all(target.id).filter((event) => knownMutationActions.has(event.action));
  const unsupported = events
    .filter((event) => !supportedMutationActions.has(event.action))
    .map((event) => ({ id: event.id, action: event.action, createdAt: event.created_at }));
  const operations = events.flatMap(eventToInverseOperations);
  const pendingConflicts = findPendingConflicts(operations);
  const changes = summarizeOperations(operations);
  const canExecute = changes.length > 0 && unsupported.length === 0 && pendingConflicts.length === 0;
  const reason = unsupported.length
    ? "时间线中包含旧版本未保存完整逆向数据的操作，请使用对应数据库备份恢复"
    : pendingConflicts.length
      ? "涉及教室仍有待审核内容，请先处理待审核项"
      : changes.length
        ? ""
        : "当前数据已经处于目标状态";

  return {
    scope: normalizedScope,
    targetAuditId: target.id,
    targetAction: target.action,
    targetCreatedAt: target.created_at,
    eventsIncluded: events.length,
    classroomCount: new Set(changes.map((change) => change.classroomId).filter(Boolean)).size,
    fieldCount: changes.filter((change) => change.type === "field").length,
    canExecute,
    reason,
    unsupported,
    pendingConflicts,
    changes,
    operations,
    summary: normalizedScope === "single"
      ? `撤销该次正式数据操作，影响 ${new Set(changes.map((change) => change.classroomId).filter(Boolean)).size} 间教室`
      : `还原到该记录之前，逆序处理 ${events.length} 条正式数据操作，影响 ${new Set(changes.map((change) => change.classroomId).filter(Boolean)).size} 间教室`
  };
}

export function applyTimelineRollback(auditId, actorId, scope = "before") {
  const preview = buildTimelineRollbackPreview(auditId, scope);
  if (!preview.canExecute) {
    const error = new Error(preview.reason || "当前状态不能执行整体还原");
    error.statusCode = 409;
    error.preview = preview;
    throw error;
  }

  const apply = db.transaction(() => {
    const changesByClassroom = new Map();
    for (const change of preview.changes) {
      if (!change.classroomId) continue;
      if (!changesByClassroom.has(change.classroomId)) changesByClassroom.set(change.classroomId, []);
      changesByClassroom.get(change.classroomId).push(change);
    }
    for (const [classroomId, changes] of changesByClassroom) {
      recordClassroomHistory({
        classroomId,
        eventType: preview.scope === "single" ? "timeline_change_rolled_back" : "timeline_state_restored",
        sourceType: "rollback",
        sourceId: preview.targetAuditId,
        actorId,
        changes: changes.map((change) => ({
          fieldKey: change.fieldKey || (change.type === "photo" ? "__photo__" : "__classroom__"),
          label: change.label,
          oldValue: change.currentValue,
          newValue: change.restoreValue
        })),
        detail: {
          scope: preview.scope,
          targetAuditId: preview.targetAuditId,
          eventsIncluded: preview.eventsIncluded
        },
        dedupeKey: `timeline_rollback:${preview.scope}:${preview.targetAuditId}:${classroomId}`
      });
    }

    const touchedClassrooms = new Set();
    for (const operation of preview.operations) {
      if (operation.type === "set_value") {
        setClassroomValue(operation.classroomId, operation.fieldKey, operation.value);
        touchedClassrooms.add(operation.classroomId);
      } else if (operation.type === "delete_photo") {
        db.prepare(`UPDATE classroom_photos SET deleted_at = ${nowSql} WHERE id = ?`).run(operation.photoId);
        touchedClassrooms.add(operation.classroomId);
      } else if (operation.type === "restore_photo") {
        db.prepare("UPDATE classroom_photos SET deleted_at = NULL WHERE id = ?").run(operation.photoId);
        touchedClassrooms.add(operation.classroomId);
      } else if (operation.type === "delete_classroom") {
        db.prepare("DELETE FROM classrooms WHERE id = ?").run(operation.classroomId);
        touchedClassrooms.delete(operation.classroomId);
      }
    }

    const updateClassroom = db.prepare(`UPDATE classrooms SET updated_at = ${nowSql} WHERE id = ?`);
    for (const classroomId of touchedClassrooms) updateClassroom.run(classroomId);
    logAudit(actorId, preview.scope === "single" ? "rollback_timeline_single" : "rollback_timeline_to_before", "audit_log", preview.targetAuditId, {
      targetAuditId: preview.targetAuditId,
      eventsIncluded: preview.eventsIncluded,
      classroomCount: preview.classroomCount,
      fieldCount: preview.fieldCount,
      operationsApplied: preview.operations.map(stripBinaryFields)
    });
  });

  apply();
  return preview;
}

function getAuditLog(auditId) {
  return db.prepare("SELECT * FROM audit_logs WHERE id = ?").get(Number(auditId));
}

function eventToInverseOperations(event) {
  const detail = parseJson(event.detail_json);
  if (event.action === "review_approved") {
    const request = db.prepare("SELECT classroom_id FROM change_requests WHERE id = ?").get(event.target_id);
    if (!request) return [];
    return db.prepare(`
      SELECT field_key AS fieldKey, old_value AS value
      FROM change_request_items WHERE request_id = ?
    `).all(event.target_id).map((item) => ({
      type: "set_value",
      auditId: event.id,
      classroomId: request.classroom_id,
      fieldKey: item.fieldKey,
      value: item.value || ""
    }));
  }

  if (["review_create_approved", "create_classroom"].includes(event.action)) {
    const classroomId = Number(detail.classroomId || (event.action === "create_classroom" ? event.target_id : 0));
    return classroomId ? [{ type: "delete_classroom", auditId: event.id, classroomId }] : [];
  }

  if (["upload_classroom_photo", "review_photo_upload_approved"].includes(event.action)) {
    const photoId = Number(detail.photoId || 0);
    const classroomId = Number(detail.classroomId || event.target_id || 0);
    return photoId ? [{ type: "delete_photo", auditId: event.id, classroomId, photoId, file: detail.file || "" }] : [];
  }

  if (["delete_classroom_photo", "review_photo_delete_approved"].includes(event.action)) {
    const photoId = Number(detail.photoId || 0);
    const photo = photoId ? db.prepare("SELECT classroom_id FROM classroom_photos WHERE id = ?").get(photoId) : null;
    const classroomId = Number(detail.classroomId || photo?.classroom_id || event.target_id || 0);
    return photoId ? [{ type: "restore_photo", auditId: event.id, classroomId, photoId, file: detail.file || "" }] : [];
  }

  if (["rollback_change_request", "rollback_to_before"].includes(event.action) && Array.isArray(detail.changes)) {
    return detail.changes.map((change) => ({
      type: "set_value",
      auditId: event.id,
      classroomId: Number(change.classroomId),
      fieldKey: change.fieldKey,
      value: String(change.currentValue || "")
    })).filter((operation) => operation.classroomId && operation.fieldKey);
  }
  return [];
}

function summarizeOperations(operations) {
  const fields = new Map(getFields().map((field) => [field.key, field.label]));
  const currentValue = db.prepare("SELECT value FROM classroom_values WHERE classroom_id = ? AND field_key = ?");
  const classroom = db.prepare("SELECT building, room FROM classrooms WHERE id = ?");
  const photo = db.prepare("SELECT original_name, deleted_at FROM classroom_photos WHERE id = ?");
  const simulatedValues = new Map();
  const simulatedPhotos = new Map();
  const deletedClassrooms = new Set();
  const changes = [];

  for (const operation of operations) {
    const room = classroom.get(operation.classroomId);
    const roomLabel = room ? `${room.building} ${room.room}` : `教室 #${operation.classroomId}`;
    if (operation.type === "set_value" && !deletedClassrooms.has(operation.classroomId)) {
      const key = `${operation.classroomId}|${operation.fieldKey}`;
      const before = simulatedValues.has(key)
        ? simulatedValues.get(key)
        : String(currentValue.get(operation.classroomId, operation.fieldKey)?.value || "");
      const after = String(operation.value || "");
      simulatedValues.set(key, after);
      if (before !== after) changes.push({
        type: "field",
        classroomId: operation.classroomId,
        roomLabel,
        fieldKey: operation.fieldKey,
        label: fields.get(operation.fieldKey) || operation.fieldKey,
        currentValue: before,
        restoreValue: after
      });
    } else if (["delete_photo", "restore_photo"].includes(operation.type)) {
      const photoRow = photo.get(operation.photoId);
      if (!photoRow) continue;
      const beforeDeleted = simulatedPhotos.has(operation.photoId)
        ? simulatedPhotos.get(operation.photoId)
        : Boolean(photoRow.deleted_at);
      const afterDeleted = operation.type === "delete_photo";
      simulatedPhotos.set(operation.photoId, afterDeleted);
      if (beforeDeleted !== afterDeleted) changes.push({
        type: "photo",
        classroomId: operation.classroomId,
        roomLabel,
        label: `照片 ${photoRow.original_name || operation.photoId}`,
        currentValue: beforeDeleted ? "已删除" : "存在",
        restoreValue: afterDeleted ? "删除" : "恢复"
      });
    } else if (operation.type === "delete_classroom" && room && !deletedClassrooms.has(operation.classroomId)) {
      deletedClassrooms.add(operation.classroomId);
      changes.push({
        type: "classroom",
        classroomId: operation.classroomId,
        roomLabel,
        label: "新增教室",
        currentValue: "存在",
        restoreValue: "删除"
      });
    }
  }
  return changes;
}

function findPendingConflicts(operations) {
  const classroomIds = [...new Set(operations.map((operation) => operation.classroomId).filter(Boolean))];
  if (!classroomIds.length) return [];
  const placeholders = classroomIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT 'change' AS type, id, classroom_id AS classroomId FROM change_requests
    WHERE status = 'pending' AND classroom_id IN (${placeholders})
    UNION ALL
    SELECT 'photo' AS type, id, classroom_id AS classroomId FROM classroom_photo_requests
    WHERE status = 'pending' AND classroom_id IN (${placeholders})
  `).all(...classroomIds, ...classroomIds);
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stripBinaryFields(operation) {
  return Object.fromEntries(Object.entries(operation).filter(([key]) => key !== "photoData"));
}
