import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import bcrypt from "bcryptjs";
import multer from "multer";
import Database from "better-sqlite3";
import {
  db,
  backfillClassroomHistory,
  dbPath,
  getClassroomHistory,
  getFields,
  initDb,
  initialAdminPasswordPath,
  logAudit,
  normalizeClassroomValue,
  nowSql,
  recordClassroomHistory,
  setClassroomValue
} from "./database.js";
import { buildExportWorkbook, importSourceExcelIfEmpty, parseUploadedWorkbook } from "./excel.js";
import { applyTimelineRollback, buildTimelineRollbackPreview } from "./timeline-rollback.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const sessionMaxAge = 1000 * 60 * 60 * 10;
const publicDir = path.join(process.cwd(), "public");
const exportsDir = process.env.EXPORTS_DIR || path.join(process.cwd(), "exports");
const uploadsDir = process.env.UPLOADS_DIR || path.join(process.cwd(), "uploads");
const backupsDir = process.env.BACKUPS_DIR || path.join(process.cwd(), "backups");
const backupMirrorDir = String(process.env.BACKUP_MIRROR_DIR || "").trim();
const autoBackupKeep = normalizeAutoBackupKeep(process.env.AUTO_BACKUP_KEEP);
const runtimeDataDir = path.dirname(dbPath);
const apiTokenPath = path.join(runtimeDataDir, "base-data-api-token.txt");
const sessionSecretPath = path.join(runtimeDataDir, "session-secret.txt");
const superAdminUsername = "admin";

fs.mkdirSync(exportsDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(backupsDir, { recursive: true });
initDb();
const importResult = process.env.SKIP_SOURCE_IMPORT === "1"
  ? { imported: false, count: db.prepare("SELECT COUNT(*) AS count FROM classrooms").get().count }
  : await importSourceExcelIfEmpty();
backfillClassroomHistory();
const baseDataToken = getOrCreateBaseDataToken();
const sessionSecret = getOrCreateSessionSecret();
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 20 * 1024 * 1024 }
});
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});
const databaseUpload = multer({
  dest: uploadsDir,
  limits: { fileSize: 200 * 1024 * 1024 }
});
const sessionStore = createSqliteSessionStore();
if (process.env.NODE_ENV !== "test") {
  ensureDailyDatabaseBackup();
  scheduleDailyDatabaseBackup();
}

app.use(express.json({ limit: "2mb" }));
app.use(session({
  store: sessionStore,
  name: "teachingroom.sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: sessionMaxAge
  }
}));

app.use(express.static(publicDir));

app.options("/api/open/{*splat}", allowOpenCors, (req, res) => {
  res.sendStatus(204);
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, imported: importResult });
});

app.post("/api/login", (req, res, next) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND active = 1 AND deleted_at IS NULL").get(username || "");
  if (!user || !bcrypt.compareSync(password || "", user.password_hash)) {
    return res.status(401).json({ error: "用户名或密码不正确" });
  }
  req.session.regenerate((error) => {
    if (error) return next(error);
    req.session.user = safeUser(user);
    logAudit(user.id, "login", "user", user.id);
    res.json({ user: req.session.user });
  });
});

app.post("/api/logout", requireLogin, (req, res) => {
  const userId = req.session.user?.id;
  req.session.destroy(() => {
    logAudit(userId, "logout", "user", userId);
    res.json({ ok: true });
  });
});

app.get("/api/session", (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  const user = findActiveUser(req.session.user.id);
  if (!user) {
    return req.session.destroy(() => res.json({ user: null }));
  }
  req.session.user = safeUser(user);
  res.json({ user: req.session.user });
});

app.post("/api/me/password", requireLogin, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "当前密码和新密码不能为空" });
  if (newPassword.length < 6) return res.status(400).json({ error: "新密码至少 6 位" });

  const user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL").get(req.session.user.id);
  if (!user) return res.status(404).json({ error: "用户不存在或已停用" });
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(403).json({ error: "当前密码不正确" });
  }

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(newPassword, 10), user.id);
  if (user.username === superAdminUsername && fs.existsSync(initialAdminPasswordPath)) {
    fs.unlinkSync(initialAdminPasswordPath);
  }
  sessionStore.destroyUserSessions(user.id, req.sessionID);
  logAudit(user.id, "change_own_password", "user", user.id, { username: user.username });
  res.json({ ok: true });
});

app.get("/api/fields", requireLogin, (req, res) => {
  res.json({ fields: getFields() });
});

app.get("/api/suggestions", requireLogin, (req, res) => {
  res.json({ suggestions: getSuggestions() });
});

app.post("/api/fields", requireSuperAdmin, (req, res) => {
  const { key, label, group, type, options, filterable = false, editable = true, publicApi = false } = req.body || {};
  const cleanKey = String(key || "").trim().replace(/[^a-zA-Z0-9_]/g, "_");
  if (!cleanKey || !label) return res.status(400).json({ error: "字段标识和名称不能为空" });

  db.prepare(`
    INSERT INTO field_definitions (key, label, group_name, type, options_json, sort_order, filterable, editable, public_api)
    VALUES (?, ?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 10 FROM field_definitions), 1000), ?, ?, ?)
  `).run(
    cleanKey,
    String(label).trim(),
    String(group || "其他").trim(),
    String(type || "text"),
    JSON.stringify(Array.isArray(options) ? options : []),
    filterable ? 1 : 0,
    editable ? 1 : 0,
    publicApi ? 1 : 0
  );
  logAudit(req.session.user.id, "create_field", "field", null, { key: cleanKey, label });
  res.json({ fields: getFields() });
});

app.get("/api/classrooms", requireLogin, (req, res) => {
  const result = getClassroomRecords(req.query);
  res.json(result);
});

app.get("/api/classrooms/:id/history", requireLogin, (req, res) => {
  const classroomId = Number(req.params.id);
  if (!classroomId) return res.status(400).json({ error: "教室编号不正确" });
  const classroom = db.prepare("SELECT id, building, room FROM classrooms WHERE id = ?").get(classroomId);
  if (!classroom) return res.status(404).json({ error: "教室不存在" });
  res.json({
    classroom,
    ...getClassroomHistory(classroomId, {
      page: req.query.page,
      pageSize: req.query.pageSize
    })
  });
});

app.post("/api/classrooms", requireAdmin, (req, res) => {
  const values = req.body?.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return res.status(400).json({ error: "教室信息不完整" });
  }

  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId);
  if (clientRequestId) {
    const created = db.prepare("SELECT id FROM classrooms WHERE client_request_id = ?").get(clientRequestId);
    if (created) {
      const record = getClassroomRecords({ ids: String(created.id) }).records[0];
      return res.status(200).json({ record, status: "created" });
    }
    const pending = db.prepare(`
      SELECT id, status
      FROM classroom_create_requests
      WHERE client_request_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(clientRequestId);
    if (pending) return res.status(202).json({ id: pending.id, status: pending.status });
  }

  const fields = getFields();
  const { building, room, savedValues } = normalizeClassroomCreateValues(values, fields);
  if (!building || !room) return res.status(400).json({ error: "楼栋和教室编号不能为空" });

  const existing = db.prepare("SELECT id FROM classrooms WHERE building = ? AND room = ?").get(building, room);
  if (existing) return res.status(409).json({ error: "该楼栋和教室编号已存在" });

  const pendingDuplicate = findPendingClassroomCreateRequest(building, room);
  if (pendingDuplicate) return res.status(409).json({ error: "该教室已有待审核新增申请" });

  if (req.session.user.username !== superAdminUsername) {
    const request = db.prepare(`
      INSERT INTO classroom_create_requests (submitter_id, values_json, client_request_id, created_at)
      VALUES (?, ?, ?, ${nowSql})
      RETURNING id
    `).get(req.session.user.id, JSON.stringify({ building, room, values: savedValues }), clientRequestId || null);
    logAudit(req.session.user.id, "submit_create_classroom", "classroom_create_request", request.id, { building, room, values: savedValues });
    return res.status(202).json({ id: request.id, status: "pending" });
  }

  const createTx = db.transaction(() => {
    const classroom = db.prepare(`
      INSERT INTO classrooms (building, room, client_request_id, created_at, updated_at)
      VALUES (?, ?, ?, ${nowSql}, ${nowSql})
      RETURNING id, building, room
    `).get(building, room, clientRequestId || null);

    for (const [fieldKey, value] of Object.entries(savedValues)) setClassroomValue(classroom.id, fieldKey, value);

    const auditId = logAudit(req.session.user.id, "create_classroom", "classroom", classroom.id, {
      building,
      room,
      values: savedValues
    });
    recordClassroomHistory({
      classroomId: classroom.id,
      eventType: "classroom_created",
      sourceType: "web",
      sourceId: auditId,
      actorId: req.session.user.id,
      changes: classroomCreateHistoryChanges(building, room, savedValues),
      dedupeKey: `audit_create:${auditId}`
    });
    return classroom.id;
  });

  const id = createTx();
  const record = getClassroomRecords({ ids: String(id) }).records[0];
  res.status(201).json({ record });
});

app.get("/api/classrooms/:id/photos", requireLogin, (req, res) => {
  const classroomId = Number(req.params.id);
  if (!classroomId) return res.status(400).json({ error: "教室编号不正确" });
  const classroom = db.prepare("SELECT id FROM classrooms WHERE id = ?").get(classroomId);
  if (!classroom) return res.status(404).json({ error: "教室不存在" });

  const photos = db.prepare(`
    SELECT p.id, p.classroom_id AS classroomId, p.uploader_id AS uploaderId, p.original_name AS originalName,
           p.mime_type AS mimeType, p.size, p.created_at AS createdAt,
           u.username AS uploaderUsername, u.display_name AS uploaderName
    FROM classroom_photos p
    LEFT JOIN users u ON u.id = p.uploader_id
    WHERE p.classroom_id = ? AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC, p.id DESC
  `).all(classroomId).map((photo) => ({
    ...photo,
    sizeLabel: formatBytes(photo.size),
    canDelete: true,
    url: `/api/classrooms/${classroomId}/photos/${photo.id}/file`
  }));

  const pendingRequests = db.prepare(`
    SELECT pr.id, pr.action, pr.photo_id AS photoId, pr.original_name AS originalName,
           pr.size, pr.created_at AS createdAt, u.display_name AS submitterName
    FROM classroom_photo_requests pr
    JOIN users u ON u.id = pr.submitter_id
    WHERE pr.classroom_id = ? AND pr.status = 'pending'
    ORDER BY pr.created_at DESC, pr.id DESC
  `).all(classroomId).map((request) => ({
    ...request,
    sizeLabel: formatBytes(request.size)
  }));

  res.json({ photos, pendingRequests });
});

app.post("/api/classrooms/:id/photos", requireLogin, photoUpload.single("photo"), (req, res) => {
  const classroomId = Number(req.params.id);
  if (!classroomId) return res.status(400).json({ error: "教室编号不正确" });
  const classroom = db.prepare("SELECT id, building, room FROM classrooms WHERE id = ?").get(classroomId);
  if (!classroom) return res.status(404).json({ error: "教室不存在" });
  if (!req.file) return res.status(400).json({ error: "请先选择照片" });
  if (!isAllowedPhotoFile(req.file)) {
    return res.status(400).json({ error: "仅支持 JPEG、PNG、WebP、GIF、HEIC 或 HEIF 图片" });
  }

  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId);
  if (clientRequestId) {
    const existingPhoto = db.prepare("SELECT id FROM classroom_photos WHERE client_request_id = ?").get(clientRequestId);
    if (existingPhoto) return res.status(200).json({ id: existingPhoto.id, ok: true, status: "approved" });
    const existingRequest = db.prepare(`
      SELECT id, status FROM classroom_photo_requests WHERE client_request_id = ? ORDER BY id DESC LIMIT 1
    `).get(clientRequestId);
    if (existingRequest) return res.status(200).json({ id: existingRequest.id, ok: true, status: existingRequest.status });
  }

  const originalName = String(req.file.originalname || "photo").slice(0, 240);
  if (req.session.user.username !== superAdminUsername) {
    const request = db.prepare(`
      INSERT INTO classroom_photo_requests
        (classroom_id, submitter_id, action, original_name, mime_type, size, photo_data, client_request_id, created_at)
      VALUES (?, ?, 'upload', ?, ?, ?, ?, ?, ${nowSql})
      RETURNING id
    `).get(
      classroomId,
      req.session.user.id,
      originalName,
      req.file.mimetype,
      req.file.size,
      req.file.buffer,
      clientRequestId || null
    );
    logAudit(req.session.user.id, "submit_photo_upload", "classroom_photo_request", request.id, {
      classroomId,
      file: originalName,
      size: req.file.size,
      building: classroom.building,
      room: classroom.room
    });
    return res.status(202).json({ id: request.id, ok: true, status: "pending" });
  }

  const createPhotoTx = db.transaction(() => {
    const photo = db.prepare(`
      INSERT INTO classroom_photos (classroom_id, uploader_id, original_name, mime_type, size, photo_data, client_request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ${nowSql})
      RETURNING id
    `).get(
      classroomId,
      req.session.user.id,
      originalName,
      req.file.mimetype,
      req.file.size,
      req.file.buffer,
      clientRequestId || null
    );
    const auditId = logAudit(req.session.user.id, "upload_classroom_photo", "classroom", classroomId, {
      photoId: photo.id,
      file: req.file.originalname,
      size: req.file.size,
      building: classroom.building,
      room: classroom.room
    });
    recordClassroomHistory({
      classroomId,
      eventType: "photo_uploaded",
      sourceType: "web",
      sourceId: auditId,
      actorId: req.session.user.id,
      changes: [photoHistoryChange("upload", originalName)],
      dedupeKey: `audit_photo:${auditId}`
    });
    return photo.id;
  });
  res.status(201).json({ id: createPhotoTx(), ok: true });
});

app.get("/api/classrooms/:id/photos/:photoId/file", requireLogin, (req, res) => {
  const classroomId = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  const photo = db.prepare(`
    SELECT original_name AS originalName, mime_type AS mimeType, photo_data AS photoData
    FROM classroom_photos
    WHERE id = ? AND classroom_id = ? AND deleted_at IS NULL
  `).get(photoId, classroomId);
  if (!photo) return res.status(404).json({ error: "照片不存在" });
  res.setHeader("Content-Type", photo.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(photo.originalName || "photo")}`);
  res.send(photo.photoData);
});

app.delete("/api/classrooms/:id/photos/:photoId", requireLogin, (req, res) => {
  const classroomId = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId);
  if (clientRequestId) {
    const existingRequest = db.prepare(`
      SELECT id, status FROM classroom_photo_requests WHERE client_request_id = ? ORDER BY id DESC LIMIT 1
    `).get(clientRequestId);
    if (existingRequest) return res.status(200).json({ id: existingRequest.id, ok: true, status: existingRequest.status });
  }
  const photo = db.prepare(`
    SELECT id, uploader_id AS uploaderId, original_name AS originalName
    FROM classroom_photos
    WHERE id = ? AND classroom_id = ? AND deleted_at IS NULL
  `).get(photoId, classroomId);
  if (!photo) return res.status(404).json({ error: "照片不存在" });
  const classroom = db.prepare("SELECT id, building, room FROM classrooms WHERE id = ?").get(classroomId);
  if (!classroom) return res.status(404).json({ error: "教室不存在" });

  if (req.session.user.username !== superAdminUsername) {
    const pending = db.prepare(`
      SELECT id FROM classroom_photo_requests
      WHERE photo_id = ? AND action = 'delete' AND status = 'pending'
      ORDER BY id DESC LIMIT 1
    `).get(photoId);
    if (pending) return res.status(200).json({ id: pending.id, ok: true, status: "pending" });

    const request = db.prepare(`
      INSERT INTO classroom_photo_requests
        (classroom_id, submitter_id, action, photo_id, original_name, client_request_id, created_at)
      VALUES (?, ?, 'delete', ?, ?, ?, ${nowSql})
      RETURNING id
    `).get(classroomId, req.session.user.id, photoId, photo.originalName || "", clientRequestId || null);
    logAudit(req.session.user.id, "submit_photo_delete", "classroom_photo_request", request.id, {
      classroomId,
      photoId,
      building: classroom.building,
      room: classroom.room
    });
    return res.status(202).json({ id: request.id, ok: true, status: "pending" });
  }

  const deletePhotoTx = db.transaction(() => {
    db.prepare(`UPDATE classroom_photos SET deleted_at = ${nowSql} WHERE id = ?`).run(photoId);
    const auditId = logAudit(req.session.user.id, "delete_classroom_photo", "classroom", classroomId, {
      photoId,
      file: photo.originalName,
      building: classroom.building,
      room: classroom.room
    });
    recordClassroomHistory({
      classroomId,
      eventType: "photo_deleted",
      sourceType: "web",
      sourceId: auditId,
      actorId: req.session.user.id,
      changes: [photoHistoryChange("delete", photo.originalName)],
      dedupeKey: `audit_photo:${auditId}`
    });
  });
  deletePhotoTx();
  res.json({ ok: true });
});

app.post("/api/classroom-photo-requests/:id/review", requireAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const { decision, note } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "审核结果不正确" });

  const request = db.prepare(`
    SELECT pr.*, c.building, c.room
    FROM classroom_photo_requests pr
    JOIN classrooms c ON c.id = pr.classroom_id
    WHERE pr.id = ?
  `).get(requestId);
  if (!request) return res.status(404).json({ error: "照片申请不存在" });
  if (request.status !== "pending") return res.status(400).json({ error: "该申请已经处理过" });
  if (request.submitter_id === req.session.user.id && req.session.user.username !== superAdminUsername) {
    return res.status(403).json({ error: "提交人不能审核自己的照片申请，请由其他管理员审核" });
  }

  const reviewTx = db.transaction(() => {
    let photoId = request.photo_id || null;
    if (decision === "approved" && request.action === "upload") {
      if (!request.photo_data) throw Object.assign(new Error("待审核照片内容不存在"), { statusCode: 409 });
      const photo = db.prepare(`
        INSERT INTO classroom_photos
          (classroom_id, uploader_id, original_name, mime_type, size, photo_data, client_request_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ${nowSql})
        RETURNING id
      `).get(
        request.classroom_id,
        request.submitter_id,
        request.original_name,
        request.mime_type,
        request.size,
        request.photo_data,
        request.client_request_id || null
      );
      photoId = photo.id;
    }
    if (decision === "approved" && request.action === "delete") {
      const photo = db.prepare("SELECT id FROM classroom_photos WHERE id = ? AND classroom_id = ? AND deleted_at IS NULL").get(request.photo_id, request.classroom_id);
      if (!photo) throw Object.assign(new Error("照片已不存在或已经删除"), { statusCode: 409 });
      db.prepare(`UPDATE classroom_photos SET deleted_at = ${nowSql} WHERE id = ?`).run(request.photo_id);
    }

    db.prepare(`
      UPDATE classroom_photo_requests
      SET status = ?, photo_id = ?, reviewer_id = ?, review_note = ?, reviewed_at = ${nowSql}, photo_data = NULL
      WHERE id = ?
    `).run(decision, photoId, req.session.user.id, String(note || "").trim(), requestId);

    logAudit(req.session.user.id, `review_photo_${request.action}_${decision}`, "classroom_photo_request", requestId, {
      classroomId: request.classroom_id,
      photoId,
      file: request.original_name,
      building: request.building,
      room: request.room,
      note: String(note || "").trim()
    });
    if (decision === "approved") {
      recordClassroomHistory({
        classroomId: request.classroom_id,
        eventType: request.action === "upload" ? "photo_uploaded" : "photo_deleted",
        sourceType: "web",
        sourceId: requestId,
        actorId: request.submitter_id,
        reviewerId: req.session.user.id,
        changes: [photoHistoryChange(request.action, request.original_name)],
        reviewNote: String(note || "").trim(),
        dedupeKey: `photo_request:${requestId}`
      });
    }
  });

  reviewTx();
  res.json({ ok: true });
});

app.post("/api/import-review", requireLogin, upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请上传 Excel 文件" });
    const result = await createChangeRequestsFromWorkbook(req.file.path, req.file.originalname, req.session.user.id);
    res.json(result);
  } catch (error) {
    next(error);
  } finally {
    if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
  }
});

app.get("/api/open/meta", allowOpenCors, requireBaseDataToken, (req, res) => {
  res.json({
    name: "TeachingRoom Base Data API",
    version: "0.1.0",
    updatedAt: latestClassroomUpdatedAt(),
    endpoints: [
      "/api/open/fields",
      "/api/open/classrooms",
      "/api/open/classrooms/:id",
      "/api/open/summary"
    ]
  });
});

app.get("/api/open/fields", allowOpenCors, requireBaseDataToken, (req, res) => {
  res.json({
    fields: getPublicFields().map(toPublicField)
  });
});

app.get("/api/open/summary", allowOpenCors, requireBaseDataToken, (req, res) => {
  const publishedKeys = new Set(getPublicFields().map((field) => field.key));
  const { records, summary, filters } = getClassroomRecords(req.query, { searchableKeys: publishedKeys });
  res.json({
    summary,
    filters,
    count: records.length,
    updatedAt: latestClassroomUpdatedAt()
  });
});

app.get("/api/open/classrooms", allowOpenCors, requireBaseDataToken, (req, res) => {
  const publishedKeys = new Set(getPublicFields().map((field) => field.key));
  const { records, summary, filters } = getClassroomRecords(req.query, { searchableKeys: publishedKeys });
  res.json({
    data: records.map((record) => toPublicClassroom(record, publishedKeys)),
    summary,
    filters,
    count: records.length,
    updatedAt: latestClassroomUpdatedAt()
  });
});

app.get("/api/open/classrooms/:id", allowOpenCors, requireBaseDataToken, (req, res) => {
  const id = Number(req.params.id);
  const { records } = getClassroomRecords({});
  const record = records.find((item) => item.id === id || item.values.room === req.params.id);
  if (!record) return res.status(404).json({ error: "教室不存在" });
  const publishedKeys = new Set(getPublicFields().map((field) => field.key));
  res.json({ data: toPublicClassroom(record, publishedKeys), updatedAt: latestClassroomUpdatedAt() });
});

app.post("/api/change-requests", requireLogin, (req, res) => {
  const { classroomId, changes, reason } = req.body || {};
  const id = Number(classroomId);
  if (!id || typeof changes !== "object" || Array.isArray(changes)) {
    return res.status(400).json({ error: "变更内容不完整" });
  }

  const classroom = db.prepare("SELECT * FROM classrooms WHERE id = ?").get(id);
  if (!classroom) return res.status(404).json({ error: "教室不存在" });

  const clientRequestId = normalizeClientRequestId(req.body?.clientRequestId);
  if (clientRequestId) {
    const existingRequest = db.prepare(`
      SELECT id, status
      FROM change_requests
      WHERE client_request_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(clientRequestId);
    if (existingRequest) return res.status(200).json(existingRequest);
  }

  const fields = new Map(getFields().map((field) => [field.key, field]));
  const currentValues = getClassroomValues(id);
  const items = [];
  for (const [fieldKey, newValueRaw] of Object.entries(changes)) {
    const field = fields.get(fieldKey);
    if (!field || !field.editable) continue;
    const oldValue = currentValues[fieldKey] || "";
    const newValue = normalizeClassroomValue(fieldKey, newValueRaw).trim();
    if (oldValue !== newValue) items.push({ fieldKey, oldValue, newValue });
  }

  if (!items.length) return res.status(400).json({ error: "没有检测到实际变化" });
  const pendingConflicts = findPendingFieldConflicts(id, items.map((item) => item.fieldKey));
  if (pendingConflicts.length) {
    return res.status(409).json({
      error: `以下字段已有待审核变更：${pendingConflicts.map((item) => item.label).join("、")}`,
      conflicts: pendingConflicts
    });
  }

  const createRequest = db.transaction(() => {
    const request = db.prepare(`
      INSERT INTO change_requests (classroom_id, submitter_id, reason, client_request_id, created_at)
      VALUES (?, ?, ?, ?, ${nowSql})
      RETURNING id
    `).get(id, req.session.user.id, String(reason || "").trim(), clientRequestId || null);

    const insertItem = db.prepare(`
      INSERT INTO change_request_items (request_id, field_key, old_value, new_value)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of items) insertItem.run(request.id, item.fieldKey, item.oldValue, item.newValue);
    logAudit(req.session.user.id, "submit_change_request", "change_request", request.id, { classroomId: id, items });
    return request.id;
  });

  res.status(201).json({ id: createRequest(), status: "pending" });
});

app.get("/api/change-requests", requireLogin, (req, res) => {
  const status = String(req.query.status || "pending");
  const requests = db.prepare(`
    SELECT cr.*, c.building, c.room,
           COALESCE(fd.value, c.room) AS front_door,
           COALESCE(bd.value, '') AS back_door,
           u.display_name AS submitter_name, ru.display_name AS reviewer_name
    FROM change_requests cr
    JOIN classrooms c ON c.id = cr.classroom_id
    LEFT JOIN classroom_values fd ON fd.classroom_id = c.id AND fd.field_key = 'front_door'
    LEFT JOIN classroom_values bd ON bd.classroom_id = c.id AND bd.field_key = 'back_door'
    JOIN users u ON u.id = cr.submitter_id
    LEFT JOIN users ru ON ru.id = cr.reviewer_id
    WHERE (? = 'all' OR cr.status = ?)
    ORDER BY cr.created_at DESC
  `).all(status, status);

  const itemStmt = db.prepare(`
    SELECT cri.field_key AS fieldKey, fd.label, cri.old_value AS oldValue, cri.new_value AS newValue
    FROM change_request_items cri
    JOIN field_definitions fd ON fd.key = cri.field_key
    WHERE cri.request_id = ?
    ORDER BY fd.sort_order
  `);

  const updateRequests = requests.map((request) => ({
    ...request,
    requestType: "update",
    items: itemStmt.all(request.id)
  }));
  const createRequests = getClassroomCreateReviewRequests(status);
  const photoRequests = getClassroomPhotoReviewRequests(status);
  const combined = [...updateRequests, ...createRequests, ...photoRequests]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || b.id - a.id);

  res.json({ requests: combined });
});

app.post("/api/classroom-create-requests/:id/review", requireAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const { decision, note } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "审核结果不正确" });
  }

  const request = db.prepare("SELECT * FROM classroom_create_requests WHERE id = ?").get(requestId);
  if (!request) return res.status(404).json({ error: "新增教室申请不存在" });
  if (request.status !== "pending") return res.status(400).json({ error: "该申请已经处理过" });
  if (request.submitter_id === req.session.user.id && req.session.user.username !== superAdminUsername) {
    return res.status(403).json({ error: "提交人不能审核自己的新增申请，请由其他管理员审核" });
  }

  const payload = parseClassroomCreatePayload(request.values_json);
  if (!payload.building || !payload.room) return res.status(400).json({ error: "新增教室申请内容不完整" });

  const reviewTx = db.transaction(() => {
    let classroomId = null;
    if (decision === "approved") {
      const existing = db.prepare("SELECT id FROM classrooms WHERE building = ? AND room = ?").get(payload.building, payload.room);
      if (existing) {
        const error = new Error("该楼栋和教室编号已存在，不能通过新增申请");
        error.statusCode = 409;
        throw error;
      }
      const classroom = db.prepare(`
        INSERT INTO classrooms (building, room, client_request_id, created_at, updated_at)
        VALUES (?, ?, ?, ${nowSql}, ${nowSql})
        RETURNING id
      `).get(payload.building, payload.room, request.client_request_id || null);
      classroomId = classroom.id;
      for (const [fieldKey, value] of Object.entries(payload.values)) setClassroomValue(classroom.id, fieldKey, value);
    }

    db.prepare(`
      UPDATE classroom_create_requests
      SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ${nowSql}
      WHERE id = ?
    `).run(decision, req.session.user.id, String(note || "").trim(), requestId);

    logAudit(req.session.user.id, `review_create_${decision}`, "classroom_create_request", requestId, {
      note,
      classroomId,
      building: payload.building,
      room: payload.room
    });
    if (decision === "approved") {
      recordClassroomHistory({
        classroomId,
        eventType: "classroom_created",
        sourceType: String(request.reason || "").startsWith("Excel上传：") ? "excel" : "web",
        sourceId: requestId,
        actorId: request.submitter_id,
        reviewerId: req.session.user.id,
        changes: classroomCreateHistoryChanges(payload.building, payload.room, payload.values),
        reason: request.reason,
        reviewNote: String(note || "").trim(),
        dedupeKey: `create_request:${requestId}`
      });
    }
  });

  reviewTx();
  res.json({ ok: true });
});

app.post("/api/change-requests/:id/review", requireAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const { decision, note } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "审核结果不正确" });
  }

  const request = db.prepare("SELECT * FROM change_requests WHERE id = ?").get(requestId);
  if (!request) return res.status(404).json({ error: "变更申请不存在" });
  if (request.status !== "pending") return res.status(400).json({ error: "该申请已经处理过" });
  if (request.submitter_id === req.session.user.id && req.session.user.username !== superAdminUsername) {
    return res.status(403).json({ error: "提交人不能审核自己的变更，请由其他管理员审核" });
  }

  const reviewItems = db.prepare(`
    SELECT field_key AS fieldKey, old_value AS oldValue, new_value AS newValue
    FROM change_request_items
    WHERE request_id = ?
  `).all(requestId);
  if (decision === "approved") {
    const currentValues = getClassroomValues(request.classroom_id);
    const conflicts = reviewItems.filter((item) => (currentValues[item.fieldKey] || "") !== (item.oldValue || ""));
    if (conflicts.length) {
      const labels = new Map(getFields().map((field) => [field.key, field.label]));
      return res.status(409).json({
        error: `正式数据已经变化，请拒绝旧申请后重新提交：${conflicts.map((item) => labels.get(item.fieldKey) || item.fieldKey).join("、")}`,
        conflicts: conflicts.map((item) => ({
          ...item,
          label: labels.get(item.fieldKey) || item.fieldKey,
          currentValue: currentValues[item.fieldKey] || ""
        }))
      });
    }
  }

  const reviewTx = db.transaction(() => {
    if (decision === "approved") {
      for (const item of reviewItems) setClassroomValue(request.classroom_id, item.fieldKey, item.newValue);
      db.prepare(`UPDATE classrooms SET updated_at = ${nowSql} WHERE id = ?`).run(request.classroom_id);
    }

    db.prepare(`
      UPDATE change_requests
      SET status = ?, reviewer_id = ?, review_note = ?, reviewed_at = ${nowSql}
      WHERE id = ?
    `).run(decision, req.session.user.id, String(note || "").trim(), requestId);

    logAudit(req.session.user.id, `review_${decision}`, "change_request", requestId, { note });
    if (decision === "approved") {
      recordClassroomHistory({
        classroomId: request.classroom_id,
        eventType: "fields_changed",
        sourceType: String(request.reason || "").startsWith("Excel上传：") ? "excel" : "web",
        sourceId: requestId,
        actorId: request.submitter_id,
        reviewerId: req.session.user.id,
        changes: reviewItems,
        reason: request.reason,
        reviewNote: String(note || "").trim(),
        dedupeKey: `change_request:${requestId}`
      });
    }
  });

  reviewTx();
  res.json({ ok: true });
});

app.get("/api/rollback/change-requests/:id/preview", requireSuperAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const scope = normalizeRollbackScope(req.query.scope);
  const preview = buildRollbackPreview(requestId, scope);
  res.json(preview);
});

app.post("/api/rollback/change-requests/:id", requireSuperAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const scope = normalizeRollbackScope(req.body?.scope);
  const preview = buildRollbackPreview(requestId, scope);
  if (!preview.canExecute) {
    return res.status(409).json({ error: preview.reason || "当前状态不能执行回滚", preview });
  }

  const applyRollback = db.transaction(() => {
    const changedClassroomIds = new Set();
    for (const change of preview.changes) {
      setClassroomValue(change.classroomId, change.fieldKey, change.restoreValue);
      changedClassroomIds.add(change.classroomId);
    }
    const updateClassroom = db.prepare(`UPDATE classrooms SET updated_at = ${nowSql} WHERE id = ?`);
    for (const classroomId of changedClassroomIds) updateClassroom.run(classroomId);

    const auditId = logAudit(req.session.user.id, scope === "single" ? "rollback_change_request" : "rollback_to_before", "change_request", requestId, {
      scope,
      sourceRequestId: requestId,
      requestsIncluded: preview.requestsIncluded,
      classroomCount: preview.classroomCount,
      fieldCount: preview.fieldCount,
      changes: preview.changes.map((change) => ({
        classroomId: change.classroomId,
        roomLabel: change.roomLabel,
        fieldKey: change.fieldKey,
        label: change.label,
        currentValue: change.currentValue,
        restoreValue: change.restoreValue,
        sourceRequestIds: change.sourceRequestIds
      }))
    });
    for (const [classroomId, changes] of groupHistoryChangesByClassroom(preview.changes)) {
      recordClassroomHistory({
        classroomId,
        eventType: scope === "single" ? "change_rolled_back" : "state_restored",
        sourceType: "rollback",
        sourceId: auditId,
        actorId: req.session.user.id,
        changes: changes.map((change) => ({
          fieldKey: change.fieldKey,
          label: change.label,
          oldValue: change.currentValue,
          newValue: change.restoreValue
        })),
        detail: { scope, sourceRequestId: requestId, sourceRequestIds: changes.flatMap((change) => change.sourceRequestIds || []) },
        dedupeKey: `rollback_request:${auditId}:${classroomId}`
      });
    }
  });

  applyRollback();
  res.json({ ok: true, summary: preview.summary });
});

app.get("/api/rollback/classroom-create-requests/:id/preview", requireSuperAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const scope = normalizeRollbackScope(req.query.scope);
  const preview = buildCreateRollbackPreview(requestId, scope);
  res.json(preview);
});

app.post("/api/rollback/classroom-create-requests/:id", requireSuperAdmin, (req, res) => {
  const requestId = Number(req.params.id);
  const scope = normalizeRollbackScope(req.body?.scope);
  const preview = buildCreateRollbackPreview(requestId, scope);
  if (!preview.canExecute) {
    return res.status(409).json({ error: preview.reason || "当前状态不能执行回滚", preview });
  }

  const applyRollback = db.transaction(() => {
    const deleteClassroom = db.prepare("DELETE FROM classrooms WHERE id = ?");
    for (const change of preview.changes) {
      recordClassroomHistory({
        classroomId: change.classroomId,
        eventType: "classroom_removed_by_rollback",
        sourceType: "rollback",
        sourceId: requestId,
        actorId: req.session.user.id,
        changes: [{
          fieldKey: "__classroom__",
          label: "教室记录",
          oldValue: "存在",
          newValue: "已删除"
        }],
        detail: { scope, sourceRequestIds: change.sourceRequestIds },
        dedupeKey: `rollback_create:${scope}:${requestId}:${change.classroomId}`
      });
      deleteClassroom.run(change.classroomId);
    }

    logAudit(req.session.user.id, scope === "single" ? "rollback_create_request" : "rollback_create_to_before", "classroom_create_request", requestId, {
      scope,
      sourceRequestId: requestId,
      requestsIncluded: preview.requestsIncluded,
      classroomCount: preview.classroomCount,
      fieldCount: preview.fieldCount,
      changes: preview.changes.map((change) => ({
        classroomId: change.classroomId,
        roomLabel: change.roomLabel,
        fieldKey: change.fieldKey,
        label: change.label,
        currentValue: change.currentValue,
        restoreValue: change.restoreValue,
        sourceRequestIds: change.sourceRequestIds
      }))
    });
  });

  applyRollback();
  res.json({ ok: true, summary: preview.summary });
});

app.get("/api/rollback/timeline/:auditId/preview", requireSuperAdmin, (req, res) => {
  res.json(buildTimelineRollbackPreview(Number(req.params.auditId), req.query.scope));
});

app.post("/api/rollback/timeline/:auditId", requireSuperAdmin, (req, res, next) => {
  try {
    const preview = applyTimelineRollback(Number(req.params.auditId), req.session.user.id, req.body?.scope);
    res.json({ ok: true, summary: preview.summary });
  } catch (error) {
    next(error);
  }
});

app.get("/api/backups", requireSuperAdmin, (req, res) => {
  res.json({
    backups: listDatabaseBackups(),
    policy: {
      autoBackupKeep,
      retentionMode: "count_only",
      mirrorEnabled: Boolean(backupMirrorDir)
    }
  });
});

app.post("/api/backups", requireSuperAdmin, (req, res, next) => {
  try {
    const backup = createDatabaseBackup("manual");
    logAudit(req.session.user.id, "create_database_backup", "database_backup", null, backup);
    res.status(201).json({ backup });
  } catch (error) {
    next(error);
  }
});

app.get("/api/backups/:file/download", requireSuperAdmin, (req, res, next) => {
  try {
    const backup = getDatabaseBackup(req.params.file);
    res.download(backup.path, backup.file);
  } catch (error) {
    next(error);
  }
});

app.post("/api/backups/:file/restore", requireSuperAdmin, (req, res, next) => {
  try {
    const backup = getDatabaseBackup(req.params.file);
    queueDatabaseRestore(backup.path, req.session.user.id, {
      source: "server_backup",
      file: backup.file,
      size: backup.size
    });
    res.json({ ok: true, message: "已开始启用该备份，服务会自动重启" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/backups/upload-restore", requireSuperAdmin, databaseUpload.single("database"), (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请上传 SQLite 数据库文件" });
    validateDatabaseFile(req.file.path);
    queueDatabaseRestore(req.file.path, req.session.user.id, {
      source: "upload",
      file: req.file.originalname,
      size: req.file.size
    });
    fs.rm(req.file.path, { force: true }, () => {});
    res.json({ ok: true, message: "数据库文件已校验，服务会自动重启并启用上传的数据库" });
  } catch (error) {
    if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {});
    next(error);
  }
});

app.get("/api/users", requireSuperAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, u.role, u.active, u.created_at AS createdAt,
           (
             SELECT COUNT(*) FROM change_requests cr WHERE cr.submitter_id = u.id
           ) + (
             SELECT COUNT(*) FROM classroom_create_requests ccr WHERE ccr.submitter_id = u.id
           ) + (
             SELECT COUNT(*) FROM classroom_photo_requests cpr WHERE cpr.submitter_id = u.id
           ) AS submittedCount,
           (
             SELECT COUNT(*) FROM change_requests cr WHERE cr.reviewer_id = u.id
           ) + (
             SELECT COUNT(*) FROM classroom_create_requests ccr WHERE ccr.reviewer_id = u.id
           ) + (
             SELECT COUNT(*) FROM classroom_photo_requests cpr WHERE cpr.reviewer_id = u.id
           ) AS reviewedCount
    FROM users u
    WHERE u.deleted_at IS NULL
    ORDER BY u.id
  `).all();
  res.json({ users });
});

app.post("/api/users", requireSuperAdmin, (req, res) => {
  const { username, displayName, role, password } = req.body || {};
  const cleanUsername = String(username || "").trim();
  const cleanDisplayName = String(displayName || "").trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(cleanUsername)) {
    return res.status(400).json({ error: "账号只能使用 3-32 位字母、数字、下划线或横线" });
  }
  if (!cleanDisplayName || !["admin", "inspector"].includes(role) || !password) {
    return res.status(400).json({ error: "用户信息不完整" });
  }
  if (String(password).length < 6) return res.status(400).json({ error: "密码至少 6 位" });
  const exists = db.prepare("SELECT id FROM users WHERE username = ? AND deleted_at IS NULL").get(cleanUsername);
  if (exists) return res.status(409).json({ error: "账号已存在" });

  const user = db.prepare(`
    INSERT INTO users (username, display_name, role, password_hash)
    VALUES (?, ?, ?, ?)
    RETURNING id, username, display_name AS displayName, role, active, created_at AS createdAt
  `).get(cleanUsername, cleanDisplayName, role, bcrypt.hashSync(password, 10));
  logAudit(req.session.user.id, "create_user", "user", user.id, { username: user.username, role: user.role });
  res.status(201).json({ user });
});

app.patch("/api/users/:id", requireSuperAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(userId);
  if (!existing) return res.status(404).json({ error: "用户不存在" });

  const displayName = String(req.body?.displayName || "").trim();
  const role = String(req.body?.role || "");
  const active = req.body?.active ? 1 : 0;
  if (!displayName || !["admin", "inspector"].includes(role)) {
    return res.status(400).json({ error: "用户信息不完整" });
  }
  if (existing.username === superAdminUsername && (role !== "admin" || active !== 1)) {
    return res.status(400).json({ error: "超级管理员不能停用或降级" });
  }

  const user = db.prepare(`
    UPDATE users
    SET display_name = ?, role = ?, active = ?
    WHERE id = ?
    RETURNING id, username, display_name AS displayName, role, active, created_at AS createdAt
  `).get(displayName, role, active, userId);
  sessionStore.destroyUserSessions(userId, userId === req.session.user.id ? req.sessionID : "");
  if (userId === req.session.user.id) req.session.user = safeUser({ ...existing, display_name: displayName, role, active });
  logAudit(req.session.user.id, "update_user", "user", userId, { username: user.username, role, active });
  res.json({ user });
});

app.post("/api/users/:id/password", requireSuperAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const password = String(req.body?.password || "");
  if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
  const user = db.prepare("SELECT id, username FROM users WHERE id = ? AND deleted_at IS NULL").get(userId);
  if (!user) return res.status(404).json({ error: "用户不存在" });

  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(password, 10), userId);
  if (user.username === superAdminUsername && fs.existsSync(initialAdminPasswordPath)) {
    fs.unlinkSync(initialAdminPasswordPath);
  }
  sessionStore.destroyUserSessions(userId, userId === req.session.user.id ? req.sessionID : "");
  logAudit(req.session.user.id, "reset_user_password", "user", userId, { username: user.username });
  res.json({ ok: true });
});

app.delete("/api/users/:id", requireSuperAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND deleted_at IS NULL").get(userId);
  if (!user) return res.status(404).json({ error: "用户不存在" });
  if (user.username === superAdminUsername) return res.status(400).json({ error: "超级管理员不能删除" });

  const deletedUsername = `${user.username}__deleted_${user.id}_${Date.now()}`;
  db.prepare(`
    UPDATE users
    SET username = ?, active = 0, deleted_at = ${nowSql}
    WHERE id = ?
  `).run(deletedUsername, userId);
  sessionStore.destroyUserSessions(userId);
  logAudit(req.session.user.id, "delete_user", "user", userId, { username: user.username });
  res.json({ ok: true });
});

app.get("/api/audit-logs", requireSuperAdmin, (req, res) => {
  const search = String(req.query.search || "").trim().toLowerCase();
  const action = String(req.query.action || "").trim();
  const actorId = Number(req.query.actorId || 0);
  const page = Math.max(1, Number(req.query.page || 1));
  const pageSize = Math.min(200, Math.max(20, Number(req.query.pageSize || 100)));
  const rows = db.prepare(`
    SELECT al.id, al.actor_id AS actorId, al.action, al.target_type AS targetType, al.target_id AS targetId,
           al.detail_json AS detailJson, al.created_at AS createdAt,
           actor.username AS actorUsername, actor.display_name AS actorName,
           target_user.username AS targetUsername, target_user.display_name AS targetUserName,
           cr.status AS requestStatus, cr.reason AS requestReason,
           c.building, c.room,
           COALESCE(fd.value, c.room) AS frontDoor,
           COALESCE(bd.value, '') AS backDoor
    FROM audit_logs al
    LEFT JOIN users actor ON actor.id = al.actor_id
    LEFT JOIN users target_user ON al.target_type = 'user' AND target_user.id = al.target_id
    LEFT JOIN change_requests cr ON al.target_type = 'change_request' AND cr.id = al.target_id
    LEFT JOIN classroom_photo_requests pr ON al.target_type = 'classroom_photo_request' AND pr.id = al.target_id
    LEFT JOIN classrooms c ON c.id = COALESCE(
      cr.classroom_id,
      pr.classroom_id,
      CASE WHEN al.target_type = 'classroom' THEN al.target_id END
    )
    LEFT JOIN classroom_values fd ON fd.classroom_id = c.id AND fd.field_key = 'front_door'
    LEFT JOIN classroom_values bd ON bd.classroom_id = c.id AND bd.field_key = 'back_door'
    WHERE (? = '' OR al.action = ?)
      AND (? = 0 OR al.actor_id = ?)
    ORDER BY al.created_at DESC, al.id DESC
  `).all(action, action, actorId, actorId);

  const fields = new Map(getFields().map((field) => [field.key, field.label]));
  const itemStmt = db.prepare(`
    SELECT cri.field_key AS fieldKey, cri.old_value AS oldValue, cri.new_value AS newValue
    FROM change_request_items cri
    WHERE cri.request_id = ?
  `);

  const matchingLogs = rows.map((row) => {
    const detail = parseJsonObject(row.detailJson);
    const items = row.targetType === "change_request"
      ? itemStmt.all(row.targetId).map((item) => ({
        ...item,
        label: fields.get(item.fieldKey) || item.fieldKey
      }))
      : Array.isArray(detail.items)
        ? detail.items.map((item) => ({ ...item, label: fields.get(item.fieldKey) || item.fieldKey }))
        : [];
    const targetLabel = buildAuditTargetLabel(row, detail);
    return {
      id: row.id,
      actorId: row.actorId,
      actorUsername: row.actorUsername || "",
      actorName: row.actorName || row.actorUsername || "系统",
      action: row.action,
      actionLabel: auditActionLabel(row.action),
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel,
      roomLabel: row.building ? `${row.building} ${row.frontDoor || row.room || ""}${row.backDoor ? ` / ${row.backDoor}` : ""}` : "",
      detail,
      items,
      createdAt: row.createdAt
    };
  }).filter((log) => {
    if (!search) return true;
    const haystack = [
      log.actorUsername,
      log.actorName,
      log.actionLabel,
      log.action,
      log.targetLabel,
      log.roomLabel,
      JSON.stringify(log.detail),
      JSON.stringify(log.items)
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });

  const total = matchingLogs.length;
  const offset = (page - 1) * pageSize;
  const logs = matchingLogs.slice(offset, offset + pageSize);
  const actors = db.prepare(`
    SELECT DISTINCT u.id, u.username, u.display_name AS displayName
    FROM audit_logs al
    JOIN users u ON u.id = al.actor_id
    ORDER BY u.id
  `).all();

  res.json({ logs, actors, page, pageSize, total, hasMore: offset + logs.length < total });
});

app.get("/api/export", requireLogin, async (req, res, next) => {
  try {
    const { records, summary } = getClassroomRecords(req.query);
    const allSummary = getClassroomRecords({}).summary;
    const fields = getFields();
    const workbook = await buildExportWorkbook(records, fields, {
      query: req.query,
      summary,
      allSummary
    });
    const buffer = await workbook.xlsx.writeBuffer();
    const filename = encodeURIComponent(`教室设备清单-${new Date().toISOString().slice(0, 10)}.xlsx`);
    logAudit(req.session.user.id, "export_excel", "workbook", null, { count: records.length, query: req.query });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, _next) => {
  console.error(error);
  const status = error.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? "服务处理失败" : error.message,
    preview: error.preview,
    detail: process.env.NODE_ENV === "development" ? error.message : undefined
  });
});

export function startServer(listenPort = port, host = "0.0.0.0") {
  return app.listen(listenPort, host, () => {
    console.log(`TeachingRoom Manager running at http://localhost:${listenPort}`);
    console.log(`Excel import: ${importResult.imported ? "seeded" : "already present"} (${importResult.count} rows)`);
    console.log(`Base data API token: ${apiTokenPath}`);
    if (fs.existsSync(initialAdminPasswordPath)) {
      console.log(`Initial admin password file: ${initialAdminPasswordPath}`);
    }
  });
}

if (process.env.NODE_ENV !== "test") startServer();

export { app, normalizeAutoBackupKeep, pruneDatabaseBackups };

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "请先登录" });
  const user = findActiveUser(req.session.user.id);
  if (!user) {
    return req.session.destroy(() => res.status(401).json({ error: "账号已停用或删除，请重新登录" }));
  }
  req.session.user = safeUser(user);
  next();
}

function requireAdmin(req, res, next) {
  requireLogin(req, res, () => {
    if (req.session.user.role !== "admin") return res.status(403).json({ error: "需要管理员权限" });
    next();
  });
}

function requireSuperAdmin(req, res, next) {
  requireLogin(req, res, () => {
    if (req.session.user.username !== superAdminUsername) return res.status(403).json({ error: "需要超级管理员权限" });
    next();
  });
}

function findActiveUser(userId) {
  return db.prepare("SELECT * FROM users WHERE id = ? AND active = 1 AND deleted_at IS NULL").get(Number(userId));
}

function allowOpenCors(req, res, next) {
  const configured = String(process.env.BASE_DATA_CORS_ORIGIN || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const origin = String(req.get("origin") || "");
  if (configured.includes("*")) res.setHeader("Access-Control-Allow-Origin", "*");
  else if (origin && configured.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Token, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  next();
}

function requireBaseDataToken(req, res, next) {
  const auth = String(req.get("authorization") || "");
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const token = req.get("x-api-token") || bearerToken;
  if (!token || token !== baseDataToken) {
    return res.status(401).json({ error: "基础数据接口令牌不正确" });
  }
  next();
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeClientRequestId(value) {
  const text = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{12,80}$/.test(text) ? text : "";
}

function normalizeAutoBackupKeep(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(7, Math.floor(parsed)) : 200;
}

function classroomCreateHistoryChanges(building, room, values = {}) {
  return [
    { fieldKey: "building", oldValue: "", newValue: building },
    { fieldKey: "room", oldValue: "", newValue: room },
    ...Object.entries(values).map(([fieldKey, value]) => ({
      fieldKey,
      oldValue: "",
      newValue: value
    }))
  ];
}

function photoHistoryChange(action, file) {
  return {
    fieldKey: "__photo__",
    label: action === "upload" ? "上传照片" : "删除照片",
    oldValue: action === "upload" ? "" : String(file || "照片"),
    newValue: action === "upload" ? String(file || "照片") : "已删除"
  };
}

function groupHistoryChangesByClassroom(changes) {
  const grouped = new Map();
  for (const change of changes || []) {
    const classroomId = Number(change.classroomId);
    if (!classroomId) continue;
    if (!grouped.has(classroomId)) grouped.set(classroomId, []);
    grouped.get(classroomId).push(change);
  }
  return grouped;
}

function isAllowedPhotoFile(file) {
  const data = file?.buffer;
  const mimeType = String(file?.mimetype || "").toLowerCase();
  if (!Buffer.isBuffer(data) || data.length < 6) return false;
  if (["image/jpeg", "image/jpg"].includes(mimeType)) {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (mimeType === "image/gif") {
    return ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"));
  }
  if (["image/heic", "image/heif"].includes(mimeType)) {
    if (data.subarray(4, 8).toString("ascii") !== "ftyp") return false;
    const brand = data.subarray(8, 12).toString("ascii");
    return ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand);
  }
  return false;
}

function normalizeClassroomCreateValues(values, fields) {
  const building = normalizeClassroomValue("building", values.building).trim();
  const room = normalizeClassroomValue("room", values.room).trim();
  const savedValues = {};
  for (const field of fields) {
    if (field.key === "building" || field.key === "room" || !field.editable) continue;
    const rawValue = field.key === "front_door" && !String(values[field.key] || "").trim()
      ? room
      : values[field.key];
    const normalizedValue = normalizeClassroomValue(field.key, rawValue).trim();
    if (normalizedValue) savedValues[field.key] = normalizedValue;
  }
  return { building, room, savedValues };
}

function parseClassroomCreatePayload(valuesJson) {
  const payload = parseJsonObject(valuesJson);
  const values = payload.values && typeof payload.values === "object" && !Array.isArray(payload.values)
    ? payload.values
    : {};
  return {
    building: String(payload.building || "").trim(),
    room: String(payload.room || "").trim(),
    values
  };
}

function findPendingClassroomCreateRequest(building, room) {
  const pendingRequests = db.prepare(`
    SELECT id, values_json AS valuesJson
    FROM classroom_create_requests
    WHERE status = 'pending'
    ORDER BY id DESC
  `).all();
  return pendingRequests.find((request) => {
    const payload = parseClassroomCreatePayload(request.valuesJson);
    return payload.building === building && payload.room === room;
  });
}

function getClassroomCreateReviewRequests(status) {
  const rows = db.prepare(`
    SELECT ccr.id, ccr.submitter_id, ccr.status, ccr.reason, ccr.values_json AS valuesJson,
           ccr.reviewer_id, ccr.review_note, ccr.created_at, ccr.reviewed_at,
           u.display_name AS submitter_name, ru.display_name AS reviewer_name
    FROM classroom_create_requests ccr
    JOIN users u ON u.id = ccr.submitter_id
    LEFT JOIN users ru ON ru.id = ccr.reviewer_id
    WHERE (? = 'all' OR ccr.status = ?)
    ORDER BY ccr.created_at DESC, ccr.id DESC
  `).all(status, status);
  const fields = getFields();
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  return rows.map((row) => {
    const payload = parseClassroomCreatePayload(row.valuesJson);
    const frontDoor = payload.values.front_door || payload.room;
    const items = [
      { fieldKey: "building", label: "楼栋", oldValue: "", newValue: payload.building },
      { fieldKey: "room", label: "教室编号", oldValue: "", newValue: payload.room },
      ...Object.entries(payload.values).map(([fieldKey, newValue]) => ({
        fieldKey,
        label: fieldsByKey.get(fieldKey)?.label || fieldKey,
        oldValue: "",
        newValue
      }))
    ].sort((a, b) => (fieldsByKey.get(a.fieldKey)?.sort || 0) - (fieldsByKey.get(b.fieldKey)?.sort || 0));
    return {
      ...row,
      requestType: "create",
      building: payload.building,
      room: payload.room,
      front_door: frontDoor,
      back_door: payload.values.back_door || "",
      items
    };
  });
}

function getClassroomPhotoReviewRequests(status) {
  return db.prepare(`
    SELECT pr.id, pr.classroom_id, pr.submitter_id, pr.action, pr.photo_id, pr.original_name,
           pr.size, pr.status, pr.reviewer_id, pr.review_note, pr.created_at, pr.reviewed_at,
           c.building, c.room, COALESCE(fd.value, c.room) AS front_door,
           COALESCE(bd.value, '') AS back_door,
           u.display_name AS submitter_name, ru.display_name AS reviewer_name
    FROM classroom_photo_requests pr
    JOIN classrooms c ON c.id = pr.classroom_id
    LEFT JOIN classroom_values fd ON fd.classroom_id = c.id AND fd.field_key = 'front_door'
    LEFT JOIN classroom_values bd ON bd.classroom_id = c.id AND bd.field_key = 'back_door'
    JOIN users u ON u.id = pr.submitter_id
    LEFT JOIN users ru ON ru.id = pr.reviewer_id
    WHERE (? = 'all' OR pr.status = ?)
    ORDER BY pr.created_at DESC, pr.id DESC
  `).all(status, status).map((request) => ({
    ...request,
    requestType: "photo",
    photoAction: request.action,
    reason: "",
    items: [{
      fieldKey: "__photo__",
      label: request.action === "upload" ? "上传照片" : "删除照片",
      oldValue: request.action === "upload" ? "" : request.original_name || `照片 #${request.photo_id}`,
      newValue: request.action === "upload" ? `${request.original_name}（${formatBytes(request.size)}）` : "删除"
    }]
  }));
}

function auditActionLabel(action) {
  return {
    login: "登录",
    logout: "退出",
    create_field: "新增字段",
    create_classroom: "新增教室",
    submit_create_classroom: "提交新增教室",
    review_create_approved: "新增审核通过",
    review_create_rejected: "新增审核拒绝",
    upload_classroom_photo: "上传教室照片",
    delete_classroom_photo: "删除教室照片",
    submit_photo_upload: "提交照片上传",
    submit_photo_delete: "提交照片删除",
    review_photo_upload_approved: "照片上传审核通过",
    review_photo_upload_rejected: "照片上传审核拒绝",
    review_photo_delete_approved: "照片删除审核通过",
    review_photo_delete_rejected: "照片删除审核拒绝",
    submit_change_request: "提交变更",
    review_approved: "审核通过",
    review_rejected: "审核拒绝",
    upload_excel_review: "Excel 上传",
    export_excel: "导出 Excel",
    bulk_mark_standard_exam_room: "批量标注标准化考场",
    bulk_set_monitoring_for_standard_exam_room: "批量设置标准化考场监控",
    create_user: "新增用户",
    update_user: "修改用户",
    change_own_password: "修改自己密码",
    reset_user_password: "重置密码",
    delete_user: "删除用户",
    rollback_change_request: "撤销修改",
    rollback_to_before: "整体还原",
    rollback_create_request: "撤销新增教室",
    rollback_create_to_before: "还原新增记录之前",
    rollback_timeline_single: "撤销时间线操作",
    rollback_timeline_to_before: "整体还原到记录之前",
    create_database_backup: "创建数据库备份",
    restore_database_backup: "启用数据库备份"
  }[action] || action;
}

function buildAuditTargetLabel(row, detail) {
  if (row.targetType === "change_request" && row.building) {
    return `${row.building} ${row.frontDoor || row.room || ""}`;
  }
  if (row.targetType === "classroom_create_request") {
    return `${detail.building || ""} ${detail.room || ""}`.trim() || `新增申请 ${row.targetId || ""}`.trim();
  }
  if (row.targetType === "classroom_photo_request") {
    return `${detail.building || row.building || ""} ${detail.room || row.frontDoor || row.room || ""} ${detail.file || "照片"}`.trim();
  }
  if (row.targetType === "user") {
    return detail.username || row.targetUsername || row.targetUserName || `用户 ${row.targetId || ""}`.trim();
  }
  if (row.targetType === "workbook") {
    return detail.file || "Excel 工作簿";
  }
  if (row.targetType === "field") {
    return detail.key || detail.label || "字段";
  }
  if (row.targetType === "classroom") {
    return `${detail.building || ""} ${detail.frontDoor || detail.room || row.targetId || ""}`.trim();
  }
  if (row.targetType === "database_backup") {
    return detail.file || detail.preRestoreBackup || "数据库备份";
  }
  return row.targetId ? `${row.targetType} #${row.targetId}` : row.targetType;
}

function safeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    isSuperAdmin: user.username === superAdminUsername
  };
}

function getClassroomValues(classroomId) {
  const rows = db.prepare("SELECT field_key, value FROM classroom_values WHERE classroom_id = ?").all(classroomId);
  return Object.fromEntries(rows.map((row) => [row.field_key, row.value]));
}

function findPendingFieldConflicts(classroomId, fieldKeys) {
  if (!fieldKeys.length) return [];
  const placeholders = fieldKeys.map(() => "?").join(",");
  return db.prepare(`
    SELECT DISTINCT cr.id AS requestId, cri.field_key AS fieldKey, fd.label
    FROM change_requests cr
    JOIN change_request_items cri ON cri.request_id = cr.id
    JOIN field_definitions fd ON fd.key = cri.field_key
    WHERE cr.classroom_id = ? AND cr.status = 'pending' AND cri.field_key IN (${placeholders})
    ORDER BY fd.sort_order, cr.id
  `).all(classroomId, ...fieldKeys);
}

function normalizeRollbackScope(value) {
  return value === "before" ? "before" : "single";
}

function buildRollbackPreview(requestId, scope) {
  const target = getApprovedRequest(requestId);
  if (!target) {
    const error = new Error("只能回滚已审核通过的修改记录");
    error.statusCode = 404;
    throw error;
  }

  const requests = scope === "before" ? getApprovedRequestsFrom(target) : [target];
  const changes = scope === "before" ? buildBeforeRollbackChanges(requests) : buildSingleRollbackChanges(target);
  const pendingConflicts = findPendingRollbackConflicts(changes);
  const changed = changes.filter((change) => change.currentValue !== change.restoreValue);
  const conflicts = changes.filter((change) => change.conflict);
  const canExecute = changed.length > 0 && pendingConflicts.length === 0 && conflicts.length === 0;
  const reason = !changed.length
    ? "当前数据已经处于该回滚目标状态"
    : pendingConflicts.length
      ? "存在影响相同字段的待审核变更，请先处理待审核项"
      : conflicts.length
        ? "该修改之后同一字段已经发生过其他变更，请使用整体还原或先确认后续记录"
        : "";

  const classroomCount = new Set(changed.map((change) => change.classroomId)).size;
  return {
    scope,
    targetRequestId: target.id,
    targetLabel: `${target.building} ${target.frontDoor || target.room || ""}${target.backDoor ? ` / ${target.backDoor}` : ""}`,
    targetReviewedAt: target.reviewed_at || target.created_at,
    requestsIncluded: requests.length,
    classroomCount,
    fieldCount: changed.length,
    canExecute,
    reason,
    conflicts,
    pendingConflicts,
    changes: changed,
    summary: scope === "single"
      ? `撤销 1 条已审核修改，影响 ${classroomCount} 间教室、${changed.length} 个字段`
      : `还原到该记录之前，反向处理 ${requests.length} 条已审核修改，影响 ${classroomCount} 间教室、${changed.length} 个字段`
  };
}

function buildCreateRollbackPreview(requestId, scope) {
  const target = getApprovedCreateRequest(requestId);
  if (!target) {
    const error = new Error("只能回滚已审核通过的新增教室记录");
    error.statusCode = 404;
    throw error;
  }

  const requests = scope === "before" ? getApprovedCreateRequestsFrom(target) : [target];
  const changes = buildCreateRollbackChanges(requests);
  const conflicts = findCreateRollbackConflicts(changes);
  const canExecute = changes.length > 0 && conflicts.length === 0;
  const reason = !changes.length
    ? "当前数据已经处于该回滚目标状态"
    : conflicts.length
      ? "新增教室之后已经产生变更或照片，不能直接删除；请先处理后续数据或使用数据库备份恢复"
      : "";

  const classroomCount = new Set(changes.map((change) => change.classroomId)).size;
  return {
    scope,
    targetRequestId: target.id,
    targetLabel: `${target.building} ${target.frontDoor || target.room || ""}${target.backDoor ? ` / ${target.backDoor}` : ""}`,
    targetReviewedAt: target.reviewed_at || target.created_at,
    requestsIncluded: requests.length,
    classroomCount,
    fieldCount: changes.length,
    canExecute,
    reason,
    conflicts,
    pendingConflicts: [],
    changes,
    summary: scope === "single"
      ? `撤销 1 条已审核新增教室，删除 ${classroomCount} 间教室`
      : `还原到该新增记录之前，删除 ${classroomCount} 间此后新增的教室`
  };
}

function getApprovedRequest(requestId) {
  return db.prepare(`
    SELECT cr.*, c.building, c.room,
           COALESCE(fd.value, c.room) AS frontDoor,
           COALESCE(bd.value, '') AS backDoor
    FROM change_requests cr
    JOIN classrooms c ON c.id = cr.classroom_id
    LEFT JOIN classroom_values fd ON fd.classroom_id = c.id AND fd.field_key = 'front_door'
    LEFT JOIN classroom_values bd ON bd.classroom_id = c.id AND bd.field_key = 'back_door'
    WHERE cr.id = ? AND cr.status = 'approved'
  `).get(requestId);
}

function getApprovedCreateRequest(requestId) {
  const row = db.prepare(`
    SELECT *
    FROM classroom_create_requests
    WHERE id = ? AND status = 'approved'
  `).get(requestId);
  return row ? hydrateApprovedCreateRequest(row) : null;
}

function getApprovedCreateRequestsFrom(target) {
  const targetTime = target.reviewed_at || target.created_at;
  return db.prepare(`
    SELECT *
    FROM classroom_create_requests
    WHERE status = 'approved'
      AND (
        COALESCE(reviewed_at, created_at) > ?
        OR (COALESCE(reviewed_at, created_at) = ? AND id >= ?)
      )
    ORDER BY COALESCE(reviewed_at, created_at) DESC, id DESC
  `).all(targetTime, targetTime, target.id).map(hydrateApprovedCreateRequest);
}

function hydrateApprovedCreateRequest(row) {
  const payload = parseClassroomCreatePayload(row.values_json);
  const classroom = findClassroomForCreateRequest(row, payload);
  return {
    ...row,
    building: payload.building,
    room: payload.room,
    values: payload.values,
    frontDoor: payload.values.front_door || payload.room,
    backDoor: payload.values.back_door || "",
    classroomId: classroom?.id || null
  };
}

function findClassroomForCreateRequest(request, payload) {
  if (request.client_request_id) {
    const classroom = db.prepare("SELECT id FROM classrooms WHERE client_request_id = ?").get(request.client_request_id);
    if (classroom) return classroom;
  }
  if (!payload.building || !payload.room) return null;
  return db.prepare("SELECT id FROM classrooms WHERE building = ? AND room = ?").get(payload.building, payload.room);
}

function buildCreateRollbackChanges(requests) {
  return requests
    .filter((request) => request.classroomId)
    .map((request) => ({
      classroomId: request.classroomId,
      requestId: request.id,
      roomLabel: `${request.building} ${request.frontDoor || request.room || ""}${request.backDoor ? ` / ${request.backDoor}` : ""}`,
      fieldKey: "__classroom__",
      label: "新增教室",
      currentValue: "存在",
      restoreValue: "删除",
      sourceRequestIds: [request.id]
    }))
    .sort((a, b) => a.roomLabel.localeCompare(b.roomLabel, "zh-CN"));
}

function findCreateRollbackConflicts(changes) {
  if (!changes.length) return [];
  const changeCountStmt = db.prepare("SELECT COUNT(*) AS count FROM change_requests WHERE classroom_id = ?");
  const photoCountStmt = db.prepare("SELECT COUNT(*) AS count FROM classroom_photos WHERE classroom_id = ? AND deleted_at IS NULL");
  return changes.flatMap((change) => {
    const changeCount = changeCountStmt.get(change.classroomId).count;
    const photoCount = photoCountStmt.get(change.classroomId).count;
    if (!changeCount && !photoCount) return [];
    const reasons = [];
    if (changeCount) reasons.push(`${changeCount} 条变更记录`);
    if (photoCount) reasons.push(`${photoCount} 张照片`);
    return [{
      classroomId: change.classroomId,
      requestId: change.requestId,
      roomLabel: change.roomLabel,
      label: change.label,
      reason: reasons.join("、")
    }];
  });
}

function getApprovedRequestsFrom(target) {
  const targetTime = target.reviewed_at || target.created_at;
  return db.prepare(`
    SELECT cr.*, c.building, c.room,
           COALESCE(fd.value, c.room) AS frontDoor,
           COALESCE(bd.value, '') AS backDoor
    FROM change_requests cr
    JOIN classrooms c ON c.id = cr.classroom_id
    LEFT JOIN classroom_values fd ON fd.classroom_id = c.id AND fd.field_key = 'front_door'
    LEFT JOIN classroom_values bd ON bd.classroom_id = c.id AND bd.field_key = 'back_door'
    WHERE cr.status = 'approved'
      AND (
        COALESCE(cr.reviewed_at, cr.created_at) > ?
        OR (COALESCE(cr.reviewed_at, cr.created_at) = ? AND cr.id >= ?)
      )
    ORDER BY COALESCE(cr.reviewed_at, cr.created_at) DESC, cr.id DESC
  `).all(targetTime, targetTime, target.id);
}

function buildSingleRollbackChanges(request) {
  const fields = new Map(getFields().map((field) => [field.key, field.label]));
  const currentValues = getClassroomValues(request.classroom_id);
  return getRequestItems(request.id).map((item) => ({
    classroomId: request.classroom_id,
    requestId: request.id,
    roomLabel: `${request.building} ${request.frontDoor || request.room || ""}${request.backDoor ? ` / ${request.backDoor}` : ""}`,
    fieldKey: item.fieldKey,
    label: fields.get(item.fieldKey) || item.fieldKey,
    currentValue: currentValues[item.fieldKey] || "",
    restoreValue: item.oldValue || "",
    expectedValue: item.newValue || "",
    conflict: (currentValues[item.fieldKey] || "") !== (item.newValue || ""),
    sourceRequestIds: [request.id]
  }));
}

function buildBeforeRollbackChanges(requests) {
  const fields = new Map(getFields().map((field) => [field.key, field.label]));
  const changesByField = new Map();
  for (const request of requests) {
    const roomLabel = `${request.building} ${request.frontDoor || request.room || ""}${request.backDoor ? ` / ${request.backDoor}` : ""}`;
    for (const item of getRequestItems(request.id)) {
      const key = `${request.classroom_id}|${item.fieldKey}`;
      const existing = changesByField.get(key);
      if (existing) {
        existing.restoreValue = item.oldValue || "";
        existing.sourceRequestIds.push(request.id);
      } else {
        const currentValues = getClassroomValues(request.classroom_id);
        changesByField.set(key, {
          classroomId: request.classroom_id,
          requestId: request.id,
          roomLabel,
          fieldKey: item.fieldKey,
          label: fields.get(item.fieldKey) || item.fieldKey,
          currentValue: currentValues[item.fieldKey] || "",
          restoreValue: item.oldValue || "",
          expectedValue: item.newValue || "",
          conflict: false,
          sourceRequestIds: [request.id]
        });
      }
    }
  }
  return [...changesByField.values()].sort((a, b) => a.roomLabel.localeCompare(b.roomLabel, "zh-CN") || a.label.localeCompare(b.label, "zh-CN"));
}

function getRequestItems(requestId) {
  return db.prepare(`
    SELECT field_key AS fieldKey, old_value AS oldValue, new_value AS newValue
    FROM change_request_items
    WHERE request_id = ?
  `).all(requestId);
}

function findPendingRollbackConflicts(changes) {
  if (!changes.length) return [];
  const pending = db.prepare(`
    SELECT cr.id AS requestId, cr.classroom_id AS classroomId, cri.field_key AS fieldKey
    FROM change_requests cr
    JOIN change_request_items cri ON cri.request_id = cr.id
    WHERE cr.status = 'pending'
  `).all();
  const targetKeys = new Set(changes.map((change) => `${change.classroomId}|${change.fieldKey}`));
  const labels = new Map(changes.map((change) => [`${change.classroomId}|${change.fieldKey}`, change]));
  return pending
    .filter((row) => targetKeys.has(`${row.classroomId}|${row.fieldKey}`))
    .map((row) => {
      const change = labels.get(`${row.classroomId}|${row.fieldKey}`);
      return {
        requestId: row.requestId,
        classroomId: row.classroomId,
        fieldKey: row.fieldKey,
        label: change?.label || row.fieldKey,
        roomLabel: change?.roomLabel || ""
      };
    });
}

function buildClassroomCreatePayloadFromImportRow(row, fields) {
  const values = {
    ...(row.values || {}),
    building: row.values?.building || row.building,
    room: row.values?.room || row.room
  };
  const { building, room, savedValues } = normalizeClassroomCreateValues(values, fields);
  return { building, room, savedValues };
}

async function createChangeRequestsFromWorkbook(filePath, originalName, submitterId) {
  const currentFields = getFields();
  const rows = await parseUploadedWorkbook(filePath, currentFields);
  if (!rows.length) {
    return { importedRows: 0, requestsCreated: 0, changedFields: 0, unmatchedRows: [], message: "没有识别到可导入的教室行" };
  }

  const fields = new Map(currentFields.map((field) => [field.key, field]));
  const editableKeys = new Set([...fields.values()].filter((field) => field.editable).map((field) => field.key));
  const submitter = db.prepare("SELECT role FROM users WHERE id = ? AND deleted_at IS NULL").get(submitterId);
  const canCreateClassroom = submitter?.role === "admin";
  const classrooms = db.prepare("SELECT id, building, room FROM classrooms").all();
  const classroomByKey = new Map();
  for (const classroom of classrooms) {
    classroomByKey.set(`${classroom.building}|${classroom.room}`, classroom);
    classroomByKey.set(classroom.room, classroom);
  }

  const currentValuesByClassroom = new Map();
  for (const classroom of classrooms) {
    const values = normalizeComparableValues(getClassroomValues(classroom.id));
    currentValuesByClassroom.set(classroom.id, { ...values, building: classroom.building, room: classroom.room });
    if (values.front_door) classroomByKey.set(values.front_door, classroom);
    if (values.back_door) classroomByKey.set(values.back_door, classroom);
  }
  const pendingFieldKeys = new Set(db.prepare(`
    SELECT cr.classroom_id AS classroomId, cri.field_key AS fieldKey
    FROM change_requests cr
    JOIN change_request_items cri ON cri.request_id = cr.id
    WHERE cr.status = 'pending'
  `).all().map((row) => `${row.classroomId}|${row.fieldKey}`));

  const unmatchedRows = [];
  const requestGroups = [];
  const createRequestGroups = [];
  let skippedPendingFields = 0;
  let skippedPendingCreates = 0;
  for (const row of rows) {
    const classroom = classroomByKey.get(`${row.building}|${row.room}`)
      || classroomByKey.get(row.room)
      || classroomByKey.get(row.values.front_door)
      || classroomByKey.get(row.values.back_door);

    if (!classroom) {
      const createPayload = buildClassroomCreatePayloadFromImportRow(row, [...fields.values()]);
      if (!canCreateClassroom || !createPayload.building || !createPayload.room) {
        unmatchedRows.push({ building: row.building, room: row.room, frontDoor: row.values.front_door || "", backDoor: row.values.back_door || "" });
        continue;
      }
      const existing = db.prepare("SELECT id FROM classrooms WHERE building = ? AND room = ?").get(createPayload.building, createPayload.room);
      if (existing) {
        unmatchedRows.push({ building: row.building, room: row.room, frontDoor: row.values.front_door || "", backDoor: row.values.back_door || "" });
        continue;
      }
      if (findPendingClassroomCreateRequest(createPayload.building, createPayload.room)) {
        skippedPendingCreates += 1;
        continue;
      }
      createRequestGroups.push(createPayload);
      continue;
    }

    const currentValues = currentValuesByClassroom.get(classroom.id) || {};
    const items = [];
    for (const [fieldKey, newValueRaw] of Object.entries(row.values)) {
      if (!editableKeys.has(fieldKey)) continue;
      if (pendingFieldKeys.has(`${classroom.id}|${fieldKey}`)) {
        skippedPendingFields += 1;
        continue;
      }
      const newValue = normalizeClassroomValue(fieldKey, newValueRaw).trim();
      const oldValue = String(currentValues[fieldKey] ?? "").trim();
      if (oldValue !== newValue) items.push({ fieldKey, oldValue, newValue });
    }
    if (items.length) requestGroups.push({ classroomId: classroom.id, items });
  }

  const importTx = db.transaction(() => {
    const insertRequest = db.prepare(`
      INSERT INTO change_requests (classroom_id, submitter_id, reason, created_at)
      VALUES (?, ?, ?, ${nowSql})
      RETURNING id
    `);
    const insertItem = db.prepare(`
      INSERT INTO change_request_items (request_id, field_key, old_value, new_value)
      VALUES (?, ?, ?, ?)
    `);
    const insertCreateRequest = db.prepare(`
      INSERT INTO classroom_create_requests (submitter_id, values_json, client_request_id, reason, created_at)
      VALUES (?, ?, ?, ?, ${nowSql})
      RETURNING id
    `);

    const requestIds = [];
    for (const group of requestGroups) {
      const request = insertRequest.get(group.classroomId, submitterId, `Excel上传：${originalName}`);
      requestIds.push(request.id);
      for (const item of group.items) insertItem.run(request.id, item.fieldKey, item.oldValue, item.newValue);
    }
    const createRequestIds = [];
    for (const group of createRequestGroups) {
      const request = insertCreateRequest.get(
        submitterId,
        JSON.stringify({ building: group.building, room: group.room, values: group.savedValues }),
        `excel-${crypto.randomUUID()}`,
        `Excel上传：${originalName}`
      );
      createRequestIds.push(request.id);
      logAudit(submitterId, "submit_create_classroom", "classroom_create_request", request.id, {
        source: "excel",
        file: originalName,
        building: group.building,
        room: group.room,
        values: group.savedValues
      });
    }

    logAudit(submitterId, "upload_excel_review", "workbook", null, {
      file: originalName,
      importedRows: rows.length,
      requestsCreated: requestGroups.length,
      createRequestsCreated: createRequestGroups.length,
      changedFields: requestGroups.reduce((sum, group) => sum + group.items.length, 0),
      skippedPendingFields,
      skippedPendingCreates,
      unmatchedRows
    });
    return { requestIds, createRequestIds };
  });

  const { requestIds, createRequestIds } = importTx();
  const changedFields = requestGroups.reduce((sum, group) => sum + group.items.length, 0);
  const totalRequests = requestIds.length + createRequestIds.length;
  return {
    importedRows: rows.length,
    requestsCreated: requestIds.length,
    createRequestsCreated: createRequestIds.length,
    changedFields,
    skippedPendingFields,
    skippedPendingCreates,
    unmatchedRows,
    message: totalRequests
      ? `已生成 ${requestIds.length} 条待审核变更、${createRequestIds.length} 条新增教室申请，共 ${changedFields} 个字段`
      : skippedPendingFields || skippedPendingCreates
        ? `没有新增审核项，${skippedPendingFields} 个字段、${skippedPendingCreates} 间教室已有待审核内容`
        : "没有检测到和当前数据不同的内容"
  };
}

function getClassroomRecords(filters = {}, options = {}) {
  const fields = getFields();
  const classrooms = db.prepare("SELECT * FROM classrooms ORDER BY building, room").all();
  const valueRows = db.prepare("SELECT classroom_id, field_key, value FROM classroom_values").all();
  const pendingRows = db.prepare(`
    SELECT classroom_id, COUNT(*) AS count
    FROM (
      SELECT classroom_id FROM change_requests WHERE status = 'pending'
      UNION ALL
      SELECT classroom_id FROM classroom_photo_requests WHERE status = 'pending'
    )
    GROUP BY classroom_id
  `).all();
  const photoRows = db.prepare(`
    SELECT classroom_id, COUNT(*) AS count
    FROM classroom_photos
    WHERE deleted_at IS NULL
    GROUP BY classroom_id
  `).all();

  const valuesByClassroom = new Map();
  for (const classroom of classrooms) valuesByClassroom.set(classroom.id, {});
  for (const row of valueRows) {
    if (!valuesByClassroom.has(row.classroom_id)) valuesByClassroom.set(row.classroom_id, {});
    valuesByClassroom.get(row.classroom_id)[row.field_key] = normalizeDisplayValue(row.field_key, row.value);
  }
  const pendingByClassroom = new Map(pendingRows.map((row) => [row.classroom_id, row.count]));
  const photosByClassroom = new Map(photoRows.map((row) => [row.classroom_id, row.count]));
  const pendingCreateRecords = getPendingCreateSummaryRecords();

  let records = classrooms.map((classroom) => {
    const values = {
      ...valuesByClassroom.get(classroom.id),
      building: classroom.building,
      room: classroom.room
    };
    return {
      id: classroom.id,
      building: classroom.building,
      room: classroom.room,
      updatedAt: classroom.updated_at,
      pendingChanges: pendingByClassroom.get(classroom.id) || 0,
      photoCount: photosByClassroom.get(classroom.id) || 0,
      values
    };
  });

  records = records.filter((record) => classroomRecordMatchesFilters(record, filters, options.searchableKeys));
  const pendingCreateCount = pendingCreateRecords.filter((record) => classroomRecordMatchesFilters(record, filters, options.searchableKeys)).length;

  return {
    fields,
    records,
    summary: buildSummary(records, pendingCreateCount),
    filters: buildFilterOptions(classrooms, valueRows)
  };
}

function getPendingCreateSummaryRecords() {
  return db.prepare(`
    SELECT id, values_json AS valuesJson, created_at AS createdAt
    FROM classroom_create_requests
    WHERE status = 'pending'
  `).all().map((row) => {
    const payload = parseClassroomCreatePayload(row.valuesJson);
    const values = {
      ...payload.values,
      building: payload.building,
      room: payload.room
    };
    return {
      id: null,
      requestId: row.id,
      building: payload.building,
      room: payload.room,
      updatedAt: row.createdAt,
      pendingChanges: 1,
      photoCount: 0,
      values
    };
  });
}

function classroomRecordMatchesFilters(record, filters = {}, searchableKeys = null) {
  const search = String(filters.search || "").trim().toLowerCase();
  const building = String(filters.building || "").trim();
  const department = String(filters.department || "").trim();
  const orientation = String(filters.orientation || filters.side || "").trim().replace(/侧$/, "");
  const planned = String(filters.planned || "").trim();
  const pending = String(filters.pending || "").trim();
  const plannedField = plannedFieldKey(planned);
  const idFilter = parseIdFilter(filters.ids);

  if (idFilter && (!record.id || !idFilter.has(record.id))) return false;
  if (building && record.values.building !== building) return false;
  if (department && record.values.department !== department) return false;
  if (orientation && record.values.orientation !== orientation) return false;
  if (pending === "yes" && record.pendingChanges === 0) return false;
  if (pending === "no" && record.pendingChanges > 0) return false;
  if (planned === "yes" && !planFieldKeys().some((key) => record.values[key])) return false;
  if (planned === "no" && planFieldKeys().some((key) => record.values[key])) return false;
  if (plannedField && !record.values[plannedField]) return false;
  if (search) {
    const searchableValues = searchableKeys
      ? [...searchableKeys].map((key) => record.values[key] || "")
      : Object.values(record.values);
    const haystack = searchableValues.join(" ").toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

function parseIdFilter(value) {
  const ids = String(value || "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
  return ids.length ? new Set(ids) : null;
}

function getSuggestions() {
  const baseSuggestionKeys = [
    "class_name",
    "current_screen",
    "current_board"
  ];
  const fields = getFields();
  const suggestionKeys = [...new Set([
    ...baseSuggestionKeys,
    ...fields.filter((field) => field.editable && field.type === "select").map((field) => field.key)
  ])];

  const suggestions = Object.fromEntries(suggestionKeys.map((key) => [key, new Set()]));
  for (const field of fields) {
    if (!suggestions[field.key]) continue;
    for (const option of field.options || []) {
      if (option) suggestions[field.key].add(option);
    }
  }

  const placeholders = suggestionKeys.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT field_key, value
    FROM classroom_values
    WHERE field_key IN (${placeholders}) AND TRIM(value) <> ''
    GROUP BY field_key, value
    ORDER BY field_key, value
  `).all(...suggestionKeys);

  for (const row of rows) suggestions[row.field_key].add(normalizeDisplayValue(row.field_key, row.value));
  return Object.fromEntries(Object.entries(suggestions).map(([key, values]) => [key, [...values]]));
}

function normalizeDisplayValue(fieldKey, value) {
  return normalizeClassroomValue(fieldKey, value);
}

function normalizeComparableValues(values) {
  return Object.fromEntries(Object.entries(values).map(([fieldKey, value]) => [fieldKey, normalizeDisplayValue(fieldKey, value)]));
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function getOrCreateBaseDataToken() {
  if (process.env.BASE_DATA_API_TOKEN) return process.env.BASE_DATA_API_TOKEN;
  fs.mkdirSync(path.dirname(apiTokenPath), { recursive: true });
  if (fs.existsSync(apiTokenPath)) return fs.readFileSync(apiTokenPath, "utf8").trim();
  const token = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(apiTokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

function getOrCreateSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fs.mkdirSync(path.dirname(sessionSecretPath), { recursive: true });
  if (fs.existsSync(sessionSecretPath)) return fs.readFileSync(sessionSecretPath, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(sessionSecretPath, `${secret}\n`, { mode: 0o600 });
  return secret;
}

function listDatabaseBackups() {
  if (!fs.existsSync(backupsDir)) return [];
  return fs.readdirSync(backupsDir)
    .filter((file) => /^teachingroom-\d{8}-\d{6}-[a-z_]+\.sqlite$/.test(file))
    .map((file) => {
      const backupPath = path.join(backupsDir, file);
      const stats = fs.statSync(backupPath);
      const match = file.match(/^teachingroom-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-([a-z_]+)\.sqlite$/);
      const kind = match?.[7] || "unknown";
      return {
        file,
        kind,
        kindLabel: databaseBackupKindLabel(kind),
        size: stats.size,
        sizeLabel: formatBytes(stats.size),
        createdAt: match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}` : formatBeijingDateTime(stats.mtime),
        downloadUrl: `/api/backups/${encodeURIComponent(file)}/download`
      };
    })
    .sort((a, b) => b.file.localeCompare(a.file));
}

function createDatabaseBackup(kind = "manual") {
  fs.mkdirSync(backupsDir, { recursive: true });
  db.pragma("wal_checkpoint(TRUNCATE)");
  const safeKind = String(kind).replace(/[^a-z_]/g, "_") || "manual";
  const file = `teachingroom-${beijingTimestampForFile()}-${safeKind}.sqlite`;
  const backupPath = path.join(backupsDir, file);
  fs.copyFileSync(dbPath, backupPath);
  if (backupMirrorDir) {
    fs.mkdirSync(backupMirrorDir, { recursive: true });
    fs.copyFileSync(backupPath, path.join(backupMirrorDir, file));
  }
  pruneDatabaseBackups(backupsDir);
  if (backupMirrorDir) pruneDatabaseBackups(backupMirrorDir);
  const stats = fs.statSync(backupPath);
  return {
    file,
    kind: safeKind,
    kindLabel: databaseBackupKindLabel(safeKind),
    size: stats.size,
    sizeLabel: formatBytes(stats.size),
    createdAt: formatBeijingDateTime(new Date()),
    downloadUrl: `/api/backups/${encodeURIComponent(file)}/download`
  };
}

function pruneDatabaseBackups(directory) {
  if (!fs.existsSync(directory)) return;
  const files = fs.readdirSync(directory)
    .filter((file) => /^teachingroom-\d{8}-\d{6}-auto\.sqlite$/.test(file))
    .sort((a, b) => b.localeCompare(a));
  for (const file of files.slice(autoBackupKeep)) {
    fs.rmSync(path.join(directory, file), { force: true });
  }
}

function getDatabaseBackup(file) {
  const cleanFile = path.basename(String(file || ""));
  if (!/^teachingroom-\d{8}-\d{6}-[a-z_]+\.sqlite$/.test(cleanFile)) {
    const error = new Error("备份文件名不正确");
    error.statusCode = 400;
    throw error;
  }
  const backupPath = path.join(backupsDir, cleanFile);
  if (!fs.existsSync(backupPath)) {
    const error = new Error("备份文件不存在");
    error.statusCode = 404;
    throw error;
  }
  const stats = fs.statSync(backupPath);
  return { file: cleanFile, path: backupPath, size: stats.size };
}

function validateDatabaseFile(filePath) {
  let restoreDb;
  try {
    restoreDb = new Database(filePath, { readonly: true, fileMustExist: true });
    const integrity = restoreDb.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error("SQLite 完整性检查未通过");

    const tables = new Set(restoreDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of ["users", "field_definitions", "classrooms", "classroom_values", "change_requests", "audit_logs"]) {
      if (!tables.has(table)) throw new Error(`缺少必要数据表：${table}`);
    }

    const admin = restoreDb.prepare("SELECT COUNT(*) AS count FROM users WHERE username = 'admin'").get();
    if (!admin.count) throw new Error("数据库中缺少超级管理员 admin");
  } catch (error) {
    const validationError = new Error(`数据库文件校验失败：${error.message}`);
    validationError.statusCode = 400;
    throw validationError;
  } finally {
    restoreDb?.close();
  }
}

function queueDatabaseRestore(sourcePath, actorId, detail) {
  validateDatabaseFile(sourcePath);
  const preRestore = createDatabaseBackup("before_restore");
  const restoreSource = path.join(uploadsDir, `restore-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.sqlite`);
  fs.copyFileSync(sourcePath, restoreSource);
  logAudit(actorId, "restore_database_backup", "database_backup", null, { ...detail, preRestoreBackup: preRestore.file });

  setTimeout(() => {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
      fs.copyFileSync(restoreSource, dbPath);
      writeRestoreAuditToRestoredDatabase({ ...detail, preRestoreBackup: preRestore.file });
      fs.rmSync(restoreSource, { force: true });
      process.exit(0);
    } catch (error) {
      console.error("Database restore failed", error);
      process.exit(1);
    }
  }, 600);
}

function writeRestoreAuditToRestoredDatabase(detail) {
  let restoredDb;
  try {
    restoredDb = new Database(dbPath);
    restoredDb.pragma("journal_mode = WAL");
    const hasSessions = restoredDb.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'user_sessions'
    `).get().count;
    if (hasSessions) restoredDb.prepare("DELETE FROM user_sessions").run();
    restoredDb.prepare(`
      INSERT INTO audit_logs (actor_id, action, target_type, target_id, detail_json, created_at)
      VALUES (NULL, 'restore_database_backup', 'database_backup', NULL, ?, ${nowSql})
    `).run(JSON.stringify(detail));
  } finally {
    restoredDb?.close();
  }
}

function ensureDailyDatabaseBackup() {
  pruneDatabaseBackups(backupsDir);
  if (backupMirrorDir) pruneDatabaseBackups(backupMirrorDir);
  const today = beijingTimestampForFile().slice(0, 8);
  const hasTodayAuto = listDatabaseBackups().some((backup) => backup.kind === "auto" && backup.file.includes(`-${today}-`));
  if (!hasTodayAuto) createDatabaseBackup("auto");
}

function scheduleDailyDatabaseBackup() {
  const timer = setInterval(() => {
    try {
      ensureDailyDatabaseBackup();
    } catch (error) {
      console.error("Automatic database backup failed", error);
    }
  }, 1000 * 60 * 60);
  timer.unref?.();
}

function databaseBackupKindLabel(kind) {
  return {
    auto: "自动备份",
    manual: "手动备份",
    before_restore: "恢复前备份"
  }[kind] || kind;
}

function beijingTimestampForFile() {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

function formatBeijingDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(value).replaceAll("/", "-");
}

function createSqliteSessionStore() {
  const Store = session.Store;
  const cleanupExpired = () => {
    db.prepare("DELETE FROM user_sessions WHERE expires_at <= ?").run(Date.now());
  };

  class SqliteSessionStore extends Store {
    constructor() {
      super();
      this.getStmt = db.prepare("SELECT data, expires_at FROM user_sessions WHERE sid = ?");
      this.setStmt = db.prepare(`
        INSERT INTO user_sessions (sid, data, user_id, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ${nowSql})
        ON CONFLICT(sid) DO UPDATE SET
          data = excluded.data,
          user_id = excluded.user_id,
          expires_at = excluded.expires_at,
          updated_at = excluded.updated_at
      `);
      this.destroyStmt = db.prepare("DELETE FROM user_sessions WHERE sid = ?");
      this.touchStmt = db.prepare(`
        UPDATE user_sessions
        SET expires_at = ?, updated_at = ${nowSql}
        WHERE sid = ?
      `);
      this.destroyUserSessionsStmt = db.prepare("DELETE FROM user_sessions WHERE user_id = ? AND (? = '' OR sid <> ?)");
    }

    get(sid, callback) {
      try {
        const row = this.getStmt.get(sid);
        if (!row) return callback(null, null);
        if (row.expires_at <= Date.now()) {
          this.destroyStmt.run(sid);
          return callback(null, null);
        }
        return callback(null, JSON.parse(row.data));
      } catch (error) {
        return callback(error);
      }
    }

    set(sid, sessionData, callback) {
      try {
        this.setStmt.run(sid, JSON.stringify(sessionData), sessionData?.user?.id || null, getSessionExpiresAt(sessionData));
        callback?.(null);
      } catch (error) {
        callback?.(error);
      }
    }

    destroy(sid, callback) {
      try {
        this.destroyStmt.run(sid);
        callback?.(null);
      } catch (error) {
        callback?.(error);
      }
    }

    touch(sid, sessionData, callback) {
      try {
        this.touchStmt.run(getSessionExpiresAt(sessionData), sid);
        callback?.(null);
      } catch (error) {
        callback?.(error);
      }
    }

    destroyUserSessions(userId, exceptSid = "") {
      this.destroyUserSessionsStmt.run(Number(userId), String(exceptSid || ""), String(exceptSid || ""));
    }
  }

  cleanupExpired();
  const cleanupTimer = setInterval(cleanupExpired, 1000 * 60 * 30);
  cleanupTimer.unref?.();

  return new SqliteSessionStore();
}

function getSessionExpiresAt(sessionData) {
  const expires = sessionData?.cookie?.expires;
  if (expires) {
    const expiresAt = new Date(expires).getTime();
    if (Number.isFinite(expiresAt)) return expiresAt;
  }
  return Date.now() + sessionMaxAge;
}

function toPublicField(field) {
  return {
    key: field.key,
    label: field.label,
    group: field.group,
    type: field.type,
    options: field.options,
    filterable: field.filterable,
    required: field.required
  };
}

function getPublicFields() {
  return getFields().filter((field) => field.publicApi);
}

function toPublicClassroom(record, publishedKeys = new Set(getPublicFields().map((field) => field.key))) {
  const values = { ...record.values };
  const publicValue = (key) => publishedKeys.has(key) ? values[key] || "" : "";
  const publicValues = Object.fromEntries(Object.entries(values).filter(([key]) => publishedKeys.has(key)));
  return {
    id: record.id,
    code: publicValue("room"),
    building: publicValue("building"),
    orientation: publicValue("orientation"),
    buildingSide: formatBuildingSide(publicValue("orientation")),
    frontDoor: publicValue("front_door") || publicValue("room"),
    backDoor: publicValue("back_door"),
    className: publicValue("class_name"),
    department: publicValue("department"),
    current: {
      screen: publicValue("current_screen"),
      board: publicValue("current_board"),
      audio: publicValue("current_audio"),
      recording: publicValue("current_recording"),
      monitoring: publicValue("monitoring"),
      installDate: publicValue("install_date")
    },
    summer2026Plan: {
      screen: publicValue("plan_screen"),
      board: publicValue("plan_board"),
      audio: publicValue("plan_audio"),
      recording: publicValue("plan_recording")
    },
    extra: publicValues,
    updatedAt: record.updatedAt
  };
}

function latestClassroomUpdatedAt() {
  return db.prepare("SELECT MAX(updated_at) AS updatedAt FROM classrooms").get().updatedAt || null;
}

function formatBuildingSide(value) {
  if (!value) return "";
  return String(value).endsWith("侧") ? String(value) : `${value}侧`;
}

function buildSummary(records, pendingCreateCount = 0) {
  const pendingUpdates = records.filter((record) => record.pendingChanges > 0).length;
  return {
    total: records.length,
    planned: records.filter((record) => planFieldKeys().some((key) => record.values[key])).length,
    pending: pendingUpdates + pendingCreateCount,
    pendingUpdates,
    pendingCreates: pendingCreateCount,
    byBuilding: countBy(records, (record) => record.values.building || "未分组"),
    byPlan: {
      screen: records.filter((record) => record.values.plan_screen).length,
      board: records.filter((record) => record.values.plan_board).length,
      audio: records.filter((record) => record.values.plan_audio).length,
      recording: records.filter((record) => record.values.plan_recording).length
    }
  };
}

function planFieldKeys() {
  return ["plan_screen", "plan_board", "plan_audio", "plan_recording"];
}

function plannedFieldKey(value) {
  return {
    screen: "plan_screen",
    "屏幕": "plan_screen",
    audio: "plan_audio",
    "教师扩声": "plan_audio",
    "扩声": "plan_audio",
    "扩音": "plan_audio",
    board: "plan_board",
    "书写板": "plan_board",
    recording: "plan_recording",
    "录播": "plan_recording"
  }[value] || "";
}

function buildFilterOptions(classrooms, valueRows) {
  const values = {};
  for (const row of valueRows) {
    if (!values[row.field_key]) values[row.field_key] = new Set();
    if (row.value) values[row.field_key].add(row.value);
  }
  return {
    building: [...new Set(classrooms.map((row) => row.building))].sort(),
    department: [...(values.department || new Set())].sort(),
    orientation: [...(values.orientation || new Set())].sort()
  };
}

function countBy(records, getKey) {
  return records.reduce((acc, record) => {
    const key = getKey(record);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}
