import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teachingroom-test-"));
process.env.NODE_ENV = "test";
process.env.SKIP_SOURCE_IMPORT = "1";
process.env.DATA_DIR = path.join(tempDir, "data");
process.env.DB_PATH = path.join(tempDir, "data", "test.sqlite");
process.env.EXPORTS_DIR = path.join(tempDir, "exports");
process.env.UPLOADS_DIR = path.join(tempDir, "uploads");
process.env.BACKUPS_DIR = path.join(tempDir, "backups");
process.env.INITIAL_ADMIN_PASSWORD = "test-admin-password";

const { app, normalizeAutoBackupKeep, pruneDatabaseBackups } = await import("../src/server.js");
const { db, getFields, initDb, logAudit, setClassroomValue } = await import("../src/database.js");
const { buildExportWorkbook, parseUploadedWorkbook } = await import("../src/excel.js");

const server = await new Promise((resolve) => {
  const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

class ApiClient {
  cookie = "";

  async request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (options.body && !(options.body instanceof FormData) && !headers["content-type"]) {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(`${baseUrl}${url}`, { ...options, headers });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";", 1)[0];
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : await response.arrayBuffer();
    return { response, data };
  }

  async json(url, method = "GET", body) {
    return this.request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  }

  async login(username, password) {
    const result = await this.json("/api/login", "POST", { username, password });
    assert.equal(result.response.status, 200, JSON.stringify(result.data));
    return result.data.user;
  }
}

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("backup pruning uses only the automatic backup count limit", () => {
  assert.equal(normalizeAutoBackupKeep(undefined), 200);
  assert.equal(normalizeAutoBackupKeep("not-a-number"), 200);
  assert.equal(normalizeAutoBackupKeep("1"), 7);
  assert.equal(normalizeAutoBackupKeep("250"), 250);

  const backupsDir = process.env.BACKUPS_DIR;
  for (let index = 0; index < 202; index += 1) {
    const timestamp = String(index).padStart(6, "0");
    fs.writeFileSync(path.join(backupsDir, `teachingroom-20260101-${timestamp}-auto.sqlite`), "auto");
  }
  const manualBackup = path.join(backupsDir, "teachingroom-20200101-000000-manual.sqlite");
  const preRestoreBackup = path.join(backupsDir, "teachingroom-20200101-000000-before_restore.sqlite");
  fs.writeFileSync(manualBackup, "manual");
  fs.writeFileSync(preRestoreBackup, "before_restore");

  pruneDatabaseBackups(backupsDir);

  const automaticBackups = fs.readdirSync(backupsDir).filter((file) => file.endsWith("-auto.sqlite"));
  assert.equal(automaticBackups.length, 200);
  assert.equal(fs.existsSync(path.join(backupsDir, "teachingroom-20260101-000000-auto.sqlite")), false);
  assert.equal(fs.existsSync(path.join(backupsDir, "teachingroom-20260101-000001-auto.sqlite")), false);
  assert.equal(fs.existsSync(manualBackup), true);
  assert.equal(fs.existsSync(preRestoreBackup), true);
});

test("critical review, session, rollback, API and Excel workflows", async () => {
  const superAdmin = new ApiClient();
  await superAdmin.login("admin", "test-admin-password");
  const firstSessionCookie = superAdmin.cookie;
  await superAdmin.login("admin", "test-admin-password");
  assert.notEqual(superAdmin.cookie, firstSessionCookie);

  const backupPolicy = await superAdmin.json("/api/backups");
  assert.equal(backupPolicy.response.status, 200);
  assert.equal(backupPolicy.data.policy.autoBackupKeep, 200);
  assert.equal(backupPolicy.data.policy.retentionMode, "count_only");
  assert.equal(Object.hasOwn(backupPolicy.data.policy, "retentionDays"), false);

  const createUser = async (username, displayName) => {
    const result = await superAdmin.json("/api/users", "POST", {
      username,
      displayName,
      role: "admin",
      password: "test1234"
    });
    assert.equal(result.response.status, 201, JSON.stringify(result.data));
    return result.data.user;
  };
  const adminOneUser = await createUser("reviewer_one", "审核员一");
  const adminTwoUser = await createUser("reviewer_two", "审核员二");
  const adminOne = new ApiClient();
  const adminTwo = new ApiClient();
  await adminOne.login("reviewer_one", "test1234");
  await adminTwo.login("reviewer_two", "test1234");

  const createIdempotencyKey = "create-room-request-0001";
  const createPayload = {
    clientRequestId: createIdempotencyKey,
    values: {
      building: "T栋",
      room: "T101",
      front_door: "T101",
      back_door: "T102",
      class_name: "测试教室",
      inspection_note: "标准化考场"
    }
  };
  const createRequest = await adminOne.json("/api/classrooms", "POST", createPayload);
  assert.equal(createRequest.response.status, 202, JSON.stringify(createRequest.data));
  const duplicateCreate = await adminOne.json("/api/classrooms", "POST", createPayload);
  assert.equal(duplicateCreate.response.status, 202);
  assert.equal(duplicateCreate.data.id, createRequest.data.id);

  const ownCreateReview = await adminOne.json(`/api/classroom-create-requests/${createRequest.data.id}/review`, "POST", { decision: "approved" });
  assert.equal(ownCreateReview.response.status, 403);
  const approvedCreate = await adminTwo.json(`/api/classroom-create-requests/${createRequest.data.id}/review`, "POST", { decision: "approved" });
  assert.equal(approvedCreate.response.status, 200, JSON.stringify(approvedCreate.data));

  const classrooms = await adminOne.json("/api/classrooms");
  const classroom = classrooms.data.records.find((record) => record.values.room === "T101");
  assert.ok(classroom);
  const anonymousHistory = await new ApiClient().json(`/api/classrooms/${classroom.id}/history`);
  assert.equal(anonymousHistory.response.status, 401);
  const createHistory = await adminOne.json(`/api/classrooms/${classroom.id}/history`);
  assert.equal(createHistory.response.status, 200);
  const createdEntry = createHistory.data.entries.find((entry) => entry.eventType === "classroom_created");
  assert.ok(createdEntry);
  assert.equal(createdEntry.actorName, "审核员一");
  assert.equal(createdEntry.reviewerName, "审核员二");
  assert.ok(createdEntry.changes.some((item) => item.fieldKey === "room" && item.newValue === "T101"));

  const changePayload = {
    classroomId: classroom.id,
    clientRequestId: "change-room-request-0001",
    reason: "集成测试",
    changes: { class_name: "测试教室（更新）" }
  };
  const changeRequest = await adminOne.json("/api/change-requests", "POST", changePayload);
  assert.equal(changeRequest.response.status, 201, JSON.stringify(changeRequest.data));
  const duplicateChange = await adminOne.json("/api/change-requests", "POST", changePayload);
  assert.equal(duplicateChange.response.status, 200);
  assert.equal(duplicateChange.data.id, changeRequest.data.id);

  const conflictingChange = await adminTwo.json("/api/change-requests", "POST", {
    classroomId: classroom.id,
    clientRequestId: "change-room-request-0002",
    changes: { class_name: "冲突值" }
  });
  assert.equal(conflictingChange.response.status, 409);

  const ownChangeReview = await adminOne.json(`/api/change-requests/${changeRequest.data.id}/review`, "POST", { decision: "approved" });
  assert.equal(ownChangeReview.response.status, 403);
  const approvedChange = await adminTwo.json(`/api/change-requests/${changeRequest.data.id}/review`, "POST", { decision: "approved" });
  assert.equal(approvedChange.response.status, 200, JSON.stringify(approvedChange.data));
  const changedHistory = await adminOne.json(`/api/classrooms/${classroom.id}/history`);
  const changedEntry = changedHistory.data.entries.find((entry) => entry.eventType === "fields_changed");
  assert.ok(changedEntry);
  assert.equal(changedEntry.actorName, "审核员一");
  assert.equal(changedEntry.reviewerName, "审核员二");
  assert.equal(changedEntry.sourceType, "web");
  assert.deepEqual(
    changedEntry.changes.find((item) => item.fieldKey === "class_name"),
    {
      fieldKey: "class_name",
      label: "班级/用途",
      oldValue: "测试教室",
      newValue: "测试教室（更新）"
    }
  );

  db.prepare("DELETE FROM classroom_history WHERE dedupe_key = ?").run(`change_request:${changeRequest.data.id}`);
  initDb();
  const backfilledHistory = await adminOne.json(`/api/classrooms/${classroom.id}/history`);
  assert.equal(backfilledHistory.data.entries.filter((entry) => entry.eventType === "fields_changed").length, 1);

  const staleRequest = await adminOne.json("/api/change-requests", "POST", {
    classroomId: classroom.id,
    clientRequestId: "change-room-request-0003",
    changes: { current_screen: "待审核屏幕" }
  });
  assert.equal(staleRequest.response.status, 201);
  setClassroomValue(classroom.id, "current_screen", "后台已更新屏幕");
  const staleApproval = await adminTwo.json(`/api/change-requests/${staleRequest.data.id}/review`, "POST", { decision: "approved" });
  assert.equal(staleApproval.response.status, 409);
  const staleReject = await adminTwo.json(`/api/change-requests/${staleRequest.data.id}/review`, "POST", { decision: "rejected" });
  assert.equal(staleReject.response.status, 200);

  const disguisedSvg = new FormData();
  disguisedSvg.append("photo", new Blob([Buffer.from("<svg></svg>")], { type: "image/svg+xml" }), "room.svg");
  const rejectedPhoto = await adminOne.request(`/api/classrooms/${classroom.id}/photos`, { method: "POST", body: disguisedSvg });
  assert.equal(rejectedPhoto.response.status, 400);

  const photoForm = new FormData();
  photoForm.append("photo", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43])], { type: "image/jpeg" }), "room.jpg");
  photoForm.append("clientRequestId", "photo-room-request-0001");
  const photoRequest = await adminOne.request(`/api/classrooms/${classroom.id}/photos`, { method: "POST", body: photoForm });
  assert.equal(photoRequest.response.status, 202, JSON.stringify(photoRequest.data));
  const photosBeforeReview = await adminOne.json(`/api/classrooms/${classroom.id}/photos`);
  assert.equal(photosBeforeReview.data.photos.length, 0);
  assert.equal(photosBeforeReview.data.pendingRequests.length, 1);
  const ownPhotoReview = await adminOne.json(`/api/classroom-photo-requests/${photoRequest.data.id}/review`, "POST", { decision: "approved" });
  assert.equal(ownPhotoReview.response.status, 403);
  const approvedPhoto = await adminTwo.json(`/api/classroom-photo-requests/${photoRequest.data.id}/review`, "POST", { decision: "approved" });
  assert.equal(approvedPhoto.response.status, 200, JSON.stringify(approvedPhoto.data));
  const photosAfterReview = await adminOne.json(`/api/classrooms/${classroom.id}/photos`);
  assert.equal(photosAfterReview.data.photos.length, 1);
  assert.equal(photosAfterReview.data.pendingRequests.length, 0);
  const photoHistory = await adminOne.json(`/api/classrooms/${classroom.id}/history`);
  const photoEntry = photoHistory.data.entries.find((entry) => entry.eventType === "photo_uploaded");
  assert.ok(photoEntry);
  assert.equal(photoEntry.actorName, "审核员一");
  assert.equal(photoEntry.reviewerName, "审核员二");
  assert.ok(photoEntry.changes.some((item) => item.fieldKey === "__photo__" && item.newValue === "room.jpg"));

  const approvedAudit = db.prepare(`
    SELECT id FROM audit_logs
    WHERE action = 'review_approved' AND target_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(changeRequest.data.id);
  const timelinePreview = await superAdmin.json(`/api/rollback/timeline/${approvedAudit.id}/preview?scope=before`);
  assert.equal(timelinePreview.response.status, 200, JSON.stringify(timelinePreview.data));
  assert.equal(timelinePreview.data.canExecute, true);
  assert.ok(timelinePreview.data.changes.some((item) => item.type === "field"));
  assert.ok(timelinePreview.data.changes.some((item) => item.type === "photo"));

  const rollbackChange = await superAdmin.json(`/api/rollback/change-requests/${changeRequest.data.id}`, "POST", { scope: "single" });
  assert.equal(rollbackChange.response.status, 200, JSON.stringify(rollbackChange.data));
  const rollbackHistory = await adminOne.json(`/api/classrooms/${classroom.id}/history`);
  const rollbackEntry = rollbackHistory.data.entries.find((entry) => entry.eventType === "change_rolled_back");
  assert.ok(rollbackEntry);
  assert.equal(rollbackEntry.actorUsername, "admin");
  assert.ok(rollbackEntry.changes.some((item) => (
    item.fieldKey === "class_name"
      && item.oldValue === "测试教室（更新）"
      && item.newValue === "测试教室"
  )));

  const fieldCreate = await superAdmin.json("/api/fields", "POST", {
    key: "custom_asset_code",
    label: "自定义资产编号",
    group: "扩展",
    type: "text",
    editable: true,
    publicApi: false
  });
  assert.equal(fieldCreate.response.status, 200, JSON.stringify(fieldCreate.data));
  const fields = getFields();
  const recordValues = Object.fromEntries(fields.map((field) => [field.key, ""]));
  Object.assign(recordValues, {
    building: "T栋",
    room: "T101",
    front_door: "T101",
    inspection_note: "标准化考场",
    custom_asset_code: "ASSET-001"
  });
  const workbook = await buildExportWorkbook([{ id: classroom.id, values: recordValues, pendingChanges: 0 }], fields, {
    query: { building: "T栋" },
    allSummary: { total: 2 }
  });
  assert.equal(workbook.getWorksheet("字段定义").state, "veryHidden");
  const excelPath = path.join(tempDir, "round-trip.xlsx");
  await workbook.xlsx.writeFile(excelPath);
  const parsedRows = await parseUploadedWorkbook(excelPath, fields);
  assert.equal(parsedRows.length, 1);
  assert.equal(parsedRows[0].values.custom_asset_code, "ASSET-001");
  assert.equal(parsedRows[0].values.inspection_note, "标准化考场");

  const excelForm = new FormData();
  excelForm.append(
    "file",
    new Blob([fs.readFileSync(excelPath)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    "history-round-trip.xlsx"
  );
  const excelUpload = await adminOne.request("/api/import-review", { method: "POST", body: excelForm });
  assert.equal(excelUpload.response.status, 200, JSON.stringify(excelUpload.data));
  assert.equal(excelUpload.data.requestsCreated, 1);
  const pendingAfterExcel = await adminTwo.json("/api/change-requests?status=pending");
  const excelRequest = pendingAfterExcel.data.requests.find((request) => (
    request.requestType === "update"
      && request.classroom_id === classroom.id
      && request.reason === "Excel上传：history-round-trip.xlsx"
  ));
  assert.ok(excelRequest);
  const approveExcel = await adminTwo.json(`/api/change-requests/${excelRequest.id}/review`, "POST", {
    decision: "approved",
    note: "Excel 历史测试"
  });
  assert.equal(approveExcel.response.status, 200, JSON.stringify(approveExcel.data));
  const excelHistory = await adminOne.json(`/api/classrooms/${classroom.id}/history`);
  const excelEntry = excelHistory.data.entries.find((entry) => (
    entry.eventType === "fields_changed" && entry.sourceType === "excel"
  ));
  assert.ok(excelEntry);
  assert.equal(excelEntry.reason, "Excel上传：history-round-trip.xlsx");
  assert.equal(excelEntry.reviewerName, "审核员二");

  const token = fs.readFileSync(path.join(tempDir, "data", "base-data-api-token.txt"), "utf8").trim();
  const queryToken = await new ApiClient().json(`/api/open/classrooms?token=${encodeURIComponent(token)}`);
  assert.equal(queryToken.response.status, 401);
  const openFields = await new ApiClient().request("/api/open/fields", { headers: { "x-api-token": token } });
  assert.equal(openFields.response.status, 200);
  assert.equal(openFields.response.headers.get("access-control-allow-origin"), null);
  assert.ok(!openFields.data.fields.some((field) => field.key === "inspection_note" || field.key === "custom_asset_code"));
  const privateSearch = await new ApiClient().request("/api/open/classrooms?search=%E6%A0%87%E5%87%86%E5%8C%96%E8%80%83%E5%9C%BA", {
    headers: { "x-api-token": token }
  });
  assert.equal(privateSearch.response.status, 200);
  assert.equal(privateSearch.data.count, 0);

  for (let index = 0; index < 45; index += 1) {
    logAudit(adminOneUser.id, "integration_pagination", "test", index, { marker: `audit-${index}` });
  }
  const firstAuditPage = await superAdmin.json("/api/audit-logs?action=integration_pagination&page=1&pageSize=20");
  assert.equal(firstAuditPage.response.status, 200);
  assert.equal(firstAuditPage.data.logs.length, 20);
  assert.equal(firstAuditPage.data.total, 45);
  assert.equal(firstAuditPage.data.hasMore, true);
  const thirdAuditPage = await superAdmin.json("/api/audit-logs?action=integration_pagination&page=3&pageSize=20");
  assert.equal(thirdAuditPage.data.logs.length, 5);
  assert.equal(thirdAuditPage.data.hasMore, false);

  const demote = await superAdmin.json(`/api/users/${adminOneUser.id}`, "PATCH", {
    displayName: "审核员一",
    role: "inspector",
    active: true
  });
  assert.equal(demote.response.status, 200);
  const expiredSession = await adminOne.json("/api/classrooms");
  assert.equal(expiredSession.response.status, 401);

  const activeAdminTwo = await adminTwo.json("/api/session");
  assert.equal(activeAdminTwo.response.status, 200);
  assert.equal(activeAdminTwo.data.user.id, adminTwoUser.id);

  const initialPasswordPath = path.join(tempDir, "data", "initial-admin-password.txt");
  fs.writeFileSync(initialPasswordPath, "temporary bootstrap credential", { mode: 0o600 });
  const passwordChange = await superAdmin.json("/api/me/password", "POST", {
    currentPassword: "test-admin-password",
    newPassword: "test-admin-password-updated"
  });
  assert.equal(passwordChange.response.status, 200, JSON.stringify(passwordChange.data));
  assert.equal(fs.existsSync(initialPasswordPath), false);

  fs.writeFileSync(initialPasswordPath, "temporary bootstrap credential", { mode: 0o600 });
  const resetOwnPassword = await superAdmin.json("/api/users/1/password", "POST", {
    password: "test-admin-password-final"
  });
  assert.equal(resetOwnPassword.response.status, 200, JSON.stringify(resetOwnPassword.data));
  assert.equal(fs.existsSync(initialPasswordPath), false);
});
