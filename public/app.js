const state = {
  user: null,
  fields: [],
  records: [],
  filters: {},
  suggestions: {},
  users: [],
  auditLogs: [],
  auditActors: [],
  auditPage: 1,
  auditTotal: 0,
  auditHasMore: false,
  historyEntries: [],
  historyPage: 1,
  historyTotal: 0,
  historyHasMore: false,
  historyRecord: null,
  backups: [],
  serverReachable: null,
  outboxCount: 0,
  processingOutbox: false,
  auditQuery: {
    search: "",
    action: "",
    actorId: ""
  },
  query: {
    search: "",
    building: "",
    department: "",
    planned: "",
    pending: ""
  },
  editingRecord: null
};

const fieldLabels = new Map();
let datalistCounter = 0;

const el = {
  loginView: document.querySelector("#loginView"),
  appView: document.querySelector("#appView"),
  loginForm: document.querySelector("#loginForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  userLabel: document.querySelector("#userLabel"),
  roleLabel: document.querySelector("#roleLabel"),
  networkStatus: document.querySelector("#networkStatus"),
  passwordButton: document.querySelector("#passwordButton"),
  logoutButton: document.querySelector("#logoutButton"),
  searchInput: document.querySelector("#searchInput"),
  buildingFilter: document.querySelector("#buildingFilter"),
  departmentFilter: document.querySelector("#departmentFilter"),
  plannedFilter: document.querySelector("#plannedFilter"),
  pendingFilter: document.querySelector("#pendingFilter"),
  exportButton: document.querySelector("#exportButton"),
  uploadButton: document.querySelector("#uploadButton"),
  addClassroomButton: document.querySelector("#addClassroomButton"),
  uploadInput: document.querySelector("#uploadInput"),
  auditButton: document.querySelector("#auditButton"),
  backupButton: document.querySelector("#backupButton"),
  userButton: document.querySelector("#userButton"),
  totalCount: document.querySelector("#totalCount"),
  plannedCount: document.querySelector("#plannedCount"),
  plannedLabel: document.querySelector("#plannedLabel"),
  plannedBreakdown: document.querySelector("#plannedBreakdown"),
  pendingCount: document.querySelector("#pendingCount"),
  buildingCount: document.querySelector("#buildingCount"),
  classroomRows: document.querySelector("#classroomRows"),
  cardList: document.querySelector("#cardList"),
  emptyState: document.querySelector("#emptyState"),
  reviewList: document.querySelector("#reviewList"),
  refreshReviewsButton: document.querySelector("#refreshReviewsButton"),
  editDialog: document.querySelector("#editDialog"),
  editTitle: document.querySelector("#editTitle"),
  editFields: document.querySelector("#editFields"),
  photoPanel: document.querySelector("#photoPanel"),
  photoList: document.querySelector("#photoList"),
  photoUploadButton: document.querySelector("#photoUploadButton"),
  photoInput: document.querySelector("#photoInput"),
  noteDialog: document.querySelector("#noteDialog"),
  noteTitle: document.querySelector("#noteTitle"),
  noteBody: document.querySelector("#noteBody"),
  notePhotoList: document.querySelector("#notePhotoList"),
  historyDialog: document.querySelector("#historyDialog"),
  historyTitle: document.querySelector("#historyTitle"),
  historySubtitle: document.querySelector("#historySubtitle"),
  historyList: document.querySelector("#historyList"),
  historyCountLabel: document.querySelector("#historyCountLabel"),
  historyMoreButton: document.querySelector("#historyMoreButton"),
  reasonInput: document.querySelector("#reasonInput"),
  submitChangeButton: document.querySelector("#submitChangeButton"),
  createClassroomDialog: document.querySelector("#createClassroomDialog"),
  createClassroomFields: document.querySelector("#createClassroomFields"),
  submitCreateClassroomButton: document.querySelector("#submitCreateClassroomButton"),
  passwordDialog: document.querySelector("#passwordDialog"),
  selfUsernameInput: document.querySelector("#selfUsernameInput"),
  currentPasswordInput: document.querySelector("#currentPasswordInput"),
  selfNewPasswordInput: document.querySelector("#selfNewPasswordInput"),
  confirmNewPasswordInput: document.querySelector("#confirmNewPasswordInput"),
  submitPasswordButton: document.querySelector("#submitPasswordButton"),
  userDialog: document.querySelector("#userDialog"),
  newUsernameInput: document.querySelector("#newUsernameInput"),
  newDisplayNameInput: document.querySelector("#newDisplayNameInput"),
  newRoleInput: document.querySelector("#newRoleInput"),
  newPasswordInput: document.querySelector("#newPasswordInput"),
  createUserButton: document.querySelector("#createUserButton"),
  refreshUsersButton: document.querySelector("#refreshUsersButton"),
  userRows: document.querySelector("#userRows"),
  auditDialog: document.querySelector("#auditDialog"),
  auditSearchInput: document.querySelector("#auditSearchInput"),
  auditActionFilter: document.querySelector("#auditActionFilter"),
  auditActorFilter: document.querySelector("#auditActorFilter"),
  refreshAuditButton: document.querySelector("#refreshAuditButton"),
  auditList: document.querySelector("#auditList"),
  auditCountLabel: document.querySelector("#auditCountLabel"),
  auditMoreButton: document.querySelector("#auditMoreButton"),
  backupDialog: document.querySelector("#backupDialog"),
  createBackupButton: document.querySelector("#createBackupButton"),
  uploadBackupButton: document.querySelector("#uploadBackupButton"),
  backupUploadInput: document.querySelector("#backupUploadInput"),
  refreshBackupsButton: document.querySelector("#refreshBackupsButton"),
  backupList: document.querySelector("#backupList"),
  backupPolicy: document.querySelector("#backupPolicy"),
  toast: document.querySelector("#toast")
};

bindEvents();
await init();

function bindEvents() {
  el.loginForm.addEventListener("submit", login);
  el.passwordButton.addEventListener("click", openPasswordDialog);
  el.logoutButton.addEventListener("click", logout);
  el.searchInput.addEventListener("input", debounce(() => {
    state.query.search = el.searchInput.value.trim();
    loadClassrooms();
  }, 180));

  for (const [node, key] of [
    [el.buildingFilter, "building"],
    [el.departmentFilter, "department"],
    [el.plannedFilter, "planned"],
    [el.pendingFilter, "pending"]
  ]) {
    node.addEventListener("change", () => {
      state.query[key] = node.value;
      loadClassrooms();
    });
  }

  el.exportButton.addEventListener("click", exportExcel);
  el.uploadButton.addEventListener("click", () => el.uploadInput.click());
  el.addClassroomButton.addEventListener("click", openCreateClassroom);
  el.uploadInput.addEventListener("change", uploadExcel);
  el.refreshReviewsButton.addEventListener("click", loadReviews);
  el.submitChangeButton.addEventListener("click", submitChange);
  el.photoUploadButton.addEventListener("click", () => el.photoInput.click());
  el.photoInput.addEventListener("change", uploadClassroomPhoto);
  el.submitCreateClassroomButton.addEventListener("click", createClassroom);
  el.submitPasswordButton.addEventListener("click", changeOwnPassword);
  el.auditButton.addEventListener("click", openAuditLog);
  el.backupButton.addEventListener("click", openBackupManager);
  el.userButton.addEventListener("click", openUserManager);
  el.createUserButton.addEventListener("click", createUser);
  el.refreshUsersButton.addEventListener("click", loadUsers);
  el.refreshAuditButton.addEventListener("click", loadAuditLogs);
  el.auditMoreButton.addEventListener("click", () => loadAuditLogs({ append: true }));
  el.historyMoreButton.addEventListener("click", () => loadClassroomHistory({ append: true }));
  el.createBackupButton.addEventListener("click", createBackup);
  el.uploadBackupButton.addEventListener("click", () => el.backupUploadInput.click());
  el.backupUploadInput.addEventListener("change", uploadAndRestoreBackup);
  el.refreshBackupsButton.addEventListener("click", loadBackups);
  el.auditSearchInput.addEventListener("input", debounce(() => {
    state.auditQuery.search = el.auditSearchInput.value.trim();
    loadAuditLogs();
  }, 220));
  for (const [node, key] of [
    [el.auditActionFilter, "action"],
    [el.auditActorFilter, "actorId"]
  ]) {
    node.addEventListener("change", () => {
      state.auditQuery[key] = node.value;
      loadAuditLogs();
    });
  }
  window.addEventListener("online", () => {
    state.serverReachable = null;
    updateNetworkStatus();
    processOutbox();
  });
  window.addEventListener("offline", () => {
    state.serverReachable = false;
    updateNetworkStatus();
  });
  window.setInterval(() => processOutbox(), 15000);
}

async function init() {
  await refreshOutboxCount();
  updateNetworkStatus();
  try {
    const session = await getJson("/api/session");
    state.user = session.user;
    renderAuth();
    if (state.user) await bootApp();
  } catch (error) {
    renderAuth();
    showToast("暂时无法连接服务器，请检查网络后重试");
  }
}

async function login(event) {
  event.preventDefault();
  const result = await requestJson("/api/login", {
    method: "POST",
    body: JSON.stringify({
      username: el.usernameInput.value.trim(),
      password: el.passwordInput.value
    })
  });
  state.user = result.user;
  await refreshOutboxCount();
  el.passwordInput.value = "";
  renderAuth();
  await bootApp();
}

async function logout() {
  await requestJson("/api/logout", { method: "POST" });
  state.user = null;
  await refreshOutboxCount();
  renderAuth();
}

async function bootApp() {
  await loadClassrooms();
  await loadSuggestions();
  await loadReviews();
  await processOutbox();
}

async function loadClassrooms() {
  const data = await getJson(`/api/classrooms?${new URLSearchParams(cleanQuery(state.query))}`);
  state.fields = data.fields;
  state.records = data.records;
  state.filters = data.filters;
  fieldLabels.clear();
  for (const field of state.fields) fieldLabels.set(field.key, field.label);
  renderFilters();
  renderSummary(data.summary);
  renderRecords();
}

async function loadSuggestions() {
  const data = await getJson("/api/suggestions");
  state.suggestions = data.suggestions || {};
}

async function loadReviews() {
  if (!state.user) return;
  const data = await getJson("/api/change-requests?status=pending");
  renderReviews(data.requests);
}

function renderAuth() {
  el.loginView.hidden = Boolean(state.user);
  el.appView.hidden = !state.user;
  if (!state.user) return;
  el.userLabel.textContent = `账号：${state.user.username}`;
  el.roleLabel.textContent = `角色：${roleText(state.user)}`;
  const canManageSystem = isSuperAdmin();
  el.addClassroomButton.style.display = state.user.role === "admin" ? "" : "none";
  el.auditButton.style.display = canManageSystem ? "" : "none";
  el.backupButton.style.display = canManageSystem ? "" : "none";
  el.userButton.style.display = canManageSystem ? "" : "none";
}

function renderFilters() {
  fillSelect(el.buildingFilter, "全部楼栋", state.filters.building || [], state.query.building);
  fillSelect(el.departmentFilter, "全部级部", state.filters.department || [], state.query.department);
  el.plannedFilter.value = state.query.planned;
  el.pendingFilter.value = state.query.pending;
}

function renderSummary(summary) {
  el.totalCount.textContent = summary.total;
  el.plannedCount.textContent = summary.planned;
  el.plannedLabel.textContent = plannedSummaryLabel();
  el.plannedBreakdown.textContent = planBreakdownText(summary.byPlan || {});
  el.pendingCount.textContent = summary.pending;
  el.buildingCount.textContent = Object.entries(summary.byBuilding)
    .map(([name, count]) => `${name}${count}`)
    .join(" / ") || "0";
}

function renderRecords() {
  const rows = state.records.map((record) => {
    const v = record.values;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="room"><strong>${escapeHtml(doorTitle(v))}</strong><span>${escapeHtml(doorSubtitle(v))}</span></span></td>
      <td>${escapeHtml(v.class_name || "")}</td>
      <td>${badge(v.department || "")}</td>
      <td>${escapeHtml(v.current_screen || "")}</td>
      <td>${escapeHtml(v.current_board || "")}</td>
      <td>${badge(v.current_audio || "无")}</td>
      <td>${badge(v.current_recording || "无")}</td>
      <td>${badge(v.monitoring || "无")}</td>
      <td>${escapeHtml(v.install_date || "")}</td>
      <td>${renderPlan(v)}</td>
      <td>${renderNoteLink(record)}</td>
      <td>${record.pendingChanges ? badge(`${record.pendingChanges} 待审`, "warn") : badge("无")}</td>
      <td><div class="actions recordActions"><button type="button" data-action="edit">变更</button><button type="button" data-action="history">历史</button></div></td>
    `;
    tr.querySelector('[data-action="view-note"]')?.addEventListener("click", () => openNoteViewer(record));
    tr.querySelector('[data-action="history"]').addEventListener("click", () => openClassroomHistory(record));
    tr.querySelector('[data-action="edit"]').addEventListener("click", () => openEditor(record));
    return tr;
  });

  el.classroomRows.replaceChildren(...rows);
  el.emptyState.style.display = state.records.length ? "none" : "block";
  renderCards();
}

function renderCards() {
  const cards = state.records.map((record) => {
    const v = record.values;
    const card = document.createElement("article");
    card.className = "classroomCard";
    card.innerHTML = `
      <header>
        <div class="room">
          <strong>${escapeHtml(doorTitle(v))}</strong>
          <span>${escapeHtml(v.building || "")} · ${escapeHtml(formatBuildingSide(v.orientation || ""))}${v.back_door ? ` · 后门 ${escapeHtml(v.back_door)}` : ""}</span>
        </div>
        <div class="cardBadges">
          ${record.pendingChanges ? badge("待审核", "warn") : ""}
          ${badge(v.department || "")}
          <div class="cardRecordActions">
            <button class="cardEditButton" type="button">变更</button>
            <button class="cardHistoryButton" type="button">历史</button>
          </div>
        </div>
      </header>
      <div class="cardFacts">
        <div class="fact fact-main"><span>班级/用途</span><strong>${escapeHtml(v.class_name || "未填写")}</strong></div>
        <div class="fact"><span>屏幕</span><strong>${escapeHtml(v.current_screen || "未填写")}</strong></div>
        <div class="fact"><span>书写板</span><strong>${escapeHtml(v.current_board || "未填写")}</strong></div>
        <div class="fact"><span>教师扩声</span><strong>${escapeHtml(v.current_audio || "无")}</strong></div>
        <div class="fact"><span>录播</span><strong>${escapeHtml(v.current_recording || "无")}</strong></div>
        <div class="fact"><span>监控</span><strong>${escapeHtml(v.monitoring || "无")}</strong></div>
        <div class="fact"><span>安装日期</span><strong>${escapeHtml(v.install_date || "未填写")}</strong></div>
        <div class="fact fact-plan"><span>暑期计划</span><div class="planChips">${renderPlan(v)}</div></div>
        ${hasNoteContent(record) ? `<div class="fact"><span>备注</span><button class="noteLink" type="button" data-action="view-note">查看</button></div>` : ""}
      </div>
    `;
    card.querySelector(".cardHistoryButton").addEventListener("click", () => openClassroomHistory(record));
    card.querySelector(".cardEditButton").addEventListener("click", () => openEditor(record));
    card.querySelector('[data-action="view-note"]')?.addEventListener("click", () => openNoteViewer(record));
    return card;
  });
  el.cardList.replaceChildren(...cards);
}

function hasNoteContent(record) {
  return Boolean((record.values.inspection_note || "").trim() || Number(record.photoCount || 0) > 0);
}

function renderNoteLink(record) {
  if (!hasNoteContent(record)) return "";
  return `<button class="noteLink" type="button" data-action="view-note">查看</button>`;
}

async function openNoteViewer(record) {
  el.noteTitle.textContent = `${record.values.building || ""} ${doorTitle(record.values)} 备注信息`;
  const note = (record.values.inspection_note || "").trim();
  el.noteBody.textContent = note || "暂无文字备注";
  el.notePhotoList.innerHTML = `<div class="photoEmpty">照片加载中</div>`;
  el.noteDialog.showModal();
  try {
    const data = await getJson(`/api/classrooms/${record.id}/photos`);
    renderPhotoListInto(el.notePhotoList, data.photos || [], { readonly: true });
  } catch {
    el.notePhotoList.innerHTML = `<div class="photoEmpty">照片列表加载失败，请恢复网络后重试</div>`;
  }
}

async function openClassroomHistory(record) {
  state.historyRecord = record;
  state.historyEntries = [];
  state.historyPage = 1;
  state.historyTotal = 0;
  state.historyHasMore = false;
  el.historyTitle.textContent = `${record.values.building || ""} ${doorTitle(record.values)} 配置历史`;
  el.historySubtitle.textContent = "按北京时间显示正式生效的字段、照片、新增和回滚记录";
  el.historyList.innerHTML = `<div class="historyEmpty">历史记录加载中</div>`;
  el.historyCountLabel.textContent = "正在加载";
  el.historyMoreButton.hidden = true;
  el.historyDialog.showModal();
  await loadClassroomHistory();
}

async function loadClassroomHistory({ append = false } = {}) {
  if (!state.historyRecord) return;
  const nextPage = append ? state.historyPage + 1 : 1;
  el.historyMoreButton.disabled = true;
  try {
    const data = await getJson(`/api/classrooms/${state.historyRecord.id}/history?page=${nextPage}&pageSize=30`);
    state.historyEntries = append ? [...state.historyEntries, ...(data.entries || [])] : (data.entries || []);
    state.historyPage = data.page || nextPage;
    state.historyTotal = data.total || 0;
    state.historyHasMore = Boolean(data.hasMore);
    renderClassroomHistory();
  } catch (error) {
    if (!append) el.historyList.innerHTML = `<div class="historyEmpty">历史记录加载失败，请恢复网络后重试</div>`;
    el.historyCountLabel.textContent = "加载失败";
  } finally {
    el.historyMoreButton.disabled = false;
  }
}

function renderClassroomHistory() {
  if (!state.historyEntries.length) {
    el.historyList.innerHTML = `<div class="historyEmpty">暂无配置历史</div>`;
  } else {
    el.historyList.replaceChildren(...state.historyEntries.map((entry) => {
      const item = document.createElement("article");
      item.className = "historyItem";
      const actorText = entry.actorName || entry.actorUsername || "系统";
      const peopleText = entry.reviewerName || entry.reviewerUsername
        ? `${actorText} 提交 · ${entry.reviewerName || entry.reviewerUsername} 审核`
        : `${actorText} 操作`;
      const changes = (entry.changes || []).map((change) => `
        <div class="historyChange">
          <strong>${escapeHtml(change.label || change.fieldKey)}</strong>
          <span class="historyOld">${historyValue(change.oldValue)}</span>
          <span class="historyArrow" aria-hidden="true">→</span>
          <span class="historyNew">${historyValue(change.newValue)}</span>
        </div>
      `).join("");
      const isBaseline = entry.eventType === "history_baseline";
      item.innerHTML = `
        <header>
          <div>
            <strong>${escapeHtml(historyEventLabel(entry.eventType))}</strong>
            <span>${escapeHtml(formatBeijingTime(entry.occurredAt))}</span>
          </div>
          <span class="historySource">${escapeHtml(historySourceLabel(entry.sourceType))}</span>
        </header>
        <p class="historyPeople">${escapeHtml(peopleText)}</p>
        ${entry.reason ? `<p class="historyReason"><strong>变更说明：</strong>${escapeHtml(entry.reason)}</p>` : ""}
        ${entry.reviewNote ? `<p class="historyReason"><strong>审核意见：</strong>${escapeHtml(entry.reviewNote)}</p>` : ""}
        ${changes ? `
          <details class="historyDetails" ${isBaseline ? "" : "open"}>
            <summary>${entry.changes.length} 项内容</summary>
            <div class="historyChanges">${changes}</div>
          </details>
        ` : `<p class="historyReason">${escapeHtml(entry.detail?.note || "该条旧记录没有可恢复的字段明细")}</p>`}
      `;
      return item;
    }));
  }
  el.historyCountLabel.textContent = `已显示 ${state.historyEntries.length} / ${state.historyTotal} 条`;
  el.historyMoreButton.hidden = !state.historyHasMore;
}

function historyEventLabel(eventType) {
  return {
    classroom_created: "新增教室",
    fields_changed: "配置变更",
    photo_uploaded: "上传照片",
    photo_deleted: "删除照片",
    change_rolled_back: "撤销一次修改",
    state_restored: "整体状态还原",
    timeline_change_rolled_back: "撤销时间线操作",
    timeline_state_restored: "还原到历史记录之前",
    classroom_removed_by_rollback: "回滚删除教室",
    history_baseline: "启用历史记录时的教室配置"
  }[eventType] || eventType;
}

function historySourceLabel(sourceType) {
  return {
    web: "网页",
    excel: "Excel",
    rollback: "回滚",
    system: "系统"
  }[sourceType] || sourceType || "系统";
}

function historyValue(value) {
  const text = String(value ?? "");
  return escapeHtml(text || "（空）");
}

function renderReviews(requests) {
  if (!requests.length) {
    el.reviewList.innerHTML = `<div class="empty" style="display:block">暂无待审核变更</div>`;
    return;
  }

  el.reviewList.replaceChildren(...requests.map((request) => {
    const item = document.createElement("article");
    const isOwnRequest = Number(request.submitter_id) === Number(state.user?.id);
    const needsCrossReview = isOwnRequest && !isSuperAdmin();
    const canReview = state.user.role === "admin" && !needsCrossReview;
    const isCreateRequest = request.requestType === "create";
    const isPhotoRequest = request.requestType === "photo";
    item.className = "reviewItem";
    item.innerHTML = `
      <header>
        <div>
          <strong>${escapeHtml(request.building)} ${escapeHtml(request.front_door || request.room)}${request.back_door ? ` / ${escapeHtml(request.back_door)}` : ""}</strong>
          <div class="muted">${escapeHtml(request.submitter_name)} · ${escapeHtml(formatBeijingTime(request.created_at))}</div>
        </div>
        ${badge(isCreateRequest ? "新增待审核" : isPhotoRequest ? "照片待审核" : "待审核", "warn")}
      </header>
      <div class="diffGrid">
        ${request.items.map((diff) => `
          <div class="diffRow">
            <span><strong>${escapeHtml(diff.label)}</strong></span>
            ${isCreateRequest ? "" : `<span>原值：${escapeHtml(diff.oldValue || "空")}</span>`}
            <span>${isCreateRequest ? "新增值" : "新值"}：${escapeHtml(diff.newValue || "空")}</span>
          </div>
        `).join("")}
      </div>
      ${request.reason ? `<p class="muted">说明：${escapeHtml(request.reason)}</p>` : ""}
      ${needsCrossReview ? `<p class="muted">这是你提交的${isCreateRequest ? "新增申请" : isPhotoRequest ? "照片申请" : "变更"}，需要其他管理员审核。</p>` : ""}
      <div class="actions" style="margin-top:10px">
        <button class="primary" type="button" data-action="approve">通过</button>
        <button class="danger" type="button" data-action="reject">拒绝</button>
      </div>
    `;
    const actions = item.querySelector(".actions");
    actions.style.display = canReview ? "flex" : "none";
    item.querySelector('[data-action="approve"]').addEventListener("click", () => reviewRequest(request, "approved"));
    item.querySelector('[data-action="reject"]').addEventListener("click", () => reviewRequest(request, "rejected"));
    return item;
  }));
}

function openEditor(record) {
  state.editingRecord = record;
  el.editTitle.textContent = `${record.values.building} ${doorTitle(record.values)} 提交变更`;
  el.reasonInput.value = "";
  renderPhotoList([]);

  const inputs = state.fields
    .filter((field) => field.editable)
    .map((field) => buildClassroomFieldControl(field, record.values, "edit"));

  el.editFields.replaceChildren(...inputs);
  el.editDialog.showModal();
  loadClassroomPhotos(record.id).catch(() => {
    el.photoList.innerHTML = `<div class="photoEmpty">照片列表加载失败，请恢复网络后重试</div>`;
  });
}

function openCreateClassroom() {
  if (state.user?.role !== "admin") return;
  const inputs = state.fields
    .filter((field) => field.key === "building" || field.key === "room" || field.editable)
    .map((field) => buildClassroomFieldControl(field, {}, "create"));
  el.createClassroomFields.replaceChildren(...inputs);
  el.createClassroomDialog.showModal();
  el.createClassroomFields.querySelector('[name="building"]')?.focus();
}

function buildClassroomFieldControl(field, values = {}, mode = "edit") {
  const label = document.createElement("label");
  label.innerHTML = `<span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>`;
  const storedCurrent = values[field.key] || "";
  const current = field.key === "orientation" ? formatBuildingSide(storedCurrent) : storedCurrent;
  const input = field.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
  input.name = field.key;
  input.value = current;
  input.dataset.original = current;
  if (field.required || ["building", "room"].includes(field.key)) input.required = true;
  if (field.type === "textarea") input.rows = 3;

  if (isPlanUpdateField(field.key)) {
    label.className = "checkboxField";
    input.type = "checkbox";
    input.checked = Boolean(current);
    input.value = "更新";
    input.dataset.originalChecked = input.checked ? "1" : "0";

    const control = document.createElement("div");
    control.className = "checkboxControl";
    const text = document.createElement("strong");
    text.textContent = "需要更新";
    control.append(input, text);
    label.append(control);
    return label;
  }

  const suggestions = suggestionsForField(field);
  if (suggestions.length && field.type !== "textarea") {
    input.placeholder = mode === "create" ? "可以填写新内容" : "可以手动输入";
    const datalist = document.createElement("datalist");
    datalist.id = `fieldSuggestions${++datalistCounter}`;
    datalist.replaceChildren(...suggestions.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      return option;
    }));
    input.setAttribute("list", datalist.id);
    label.append(input, datalist);
    return label;
  }

  label.append(input);
  return label;
}

function suggestionsForField(field) {
  const values = new Set(state.suggestions[field.key] || []);
  if (field.key === "building") for (const value of state.filters.building || []) values.add(value);
  if (field.key === "orientation") for (const value of state.filters.orientation || []) values.add(value);
  for (const option of field.options || []) if (option) values.add(option);
  return [...values].filter(Boolean);
}

async function submitChange() {
  if (!state.editingRecord) return;
  const changes = {};
  for (const input of el.editFields.querySelectorAll("input, textarea")) {
    if (input.type === "checkbox") {
      const checkedValue = input.checked ? "1" : "0";
      if (checkedValue !== input.dataset.originalChecked) changes[input.name] = input.checked ? "更新" : "";
      continue;
    }
    if (input.value.trim() !== input.dataset.original) changes[input.name] = input.value.trim();
  }
  if (!Object.keys(changes).length) {
    showToast("没有检测到实际变化");
    return;
  }

  const payload = {
    classroomId: state.editingRecord.id,
    changes,
    reason: el.reasonInput.value.trim(),
    clientRequestId: makeClientRequestId()
  };
  el.submitChangeButton.disabled = true;
  try {
    const result = await sendReliableJsonMutation("/api/change-requests", "POST", payload, "教室变更");
    el.editDialog.close();
    if (result.queued) {
      showToast("网络不稳定，变更已保存在本机，联网后自动提交");
      return;
    }
    showToast("已提交管理员审核");
    await loadClassrooms();
    await loadReviews();
  } finally {
    el.submitChangeButton.disabled = false;
  }
}

async function loadClassroomPhotos(classroomId) {
  const data = await getJson(`/api/classrooms/${classroomId}/photos`);
  renderPhotoList(data.photos || [], data.pendingRequests || []);
}

function renderPhotoList(photos, pendingRequests = []) {
  renderPhotoListInto(el.photoList, photos, { readonly: false, pendingRequests });
}

function renderPhotoListInto(container, photos, { readonly = false, pendingRequests = [] } = {}) {
  if (!photos.length && (!pendingRequests.length || readonly)) {
    container.innerHTML = `<div class="photoEmpty">暂无照片</div>`;
    return;
  }

  const photoItems = photos.map((photo) => {
    const item = document.createElement("article");
    item.className = "photoItem";
    item.innerHTML = `
      <a href="${escapeHtml(photo.url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.originalName || "巡查照片")}" loading="lazy" />
      </a>
      <div>
        <strong>${escapeHtml(photo.originalName || "巡查照片")}</strong>
        <span>${escapeHtml(photo.uploaderName || photo.uploaderUsername || "未知用户")} · ${escapeHtml(formatBeijingTime(photo.createdAt))} · ${escapeHtml(photo.sizeLabel || "")}</span>
      </div>
      ${!readonly && photo.canDelete ? `<button class="danger" type="button" data-action="delete-photo">删除</button>` : ""}
    `;
    if (!readonly) item.querySelector('[data-action="delete-photo"]')?.addEventListener("click", () => deleteClassroomPhoto(photo));
    return item;
  });
  const pendingItems = readonly ? [] : pendingRequests.map((request) => {
    const item = document.createElement("article");
    item.className = "photoPending";
    item.innerHTML = `
      <strong>${request.action === "upload" ? "照片上传待审核" : "照片删除待审核"}</strong>
      <span>${escapeHtml(request.originalName || `照片 #${request.photoId || request.id}`)}</span>
      <span>${escapeHtml(request.submitterName || "")} · ${escapeHtml(formatBeijingTime(request.createdAt))}</span>
    `;
    return item;
  });
  container.replaceChildren(...photoItems, ...pendingItems);
}

async function uploadClassroomPhoto() {
  if (!state.editingRecord) return;
  const classroomId = state.editingRecord.id;
  const file = el.photoInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("只能上传图片文件");
    el.photoInput.value = "";
    return;
  }

  el.photoUploadButton.disabled = true;
  el.photoUploadButton.textContent = "上传中";
  let uploaded = false;
  try {
    const result = await sendReliablePhotoMutation(classroomId, file);
    if (result.queued) {
      showToast("网络不稳定，照片已保存在本机，联网后自动提交");
      return;
    }
    uploaded = true;
    showToast(result.status === "pending" ? "照片已提交，等待其他管理员审核" : "照片已上传");
  } catch (error) {
    if (error.name === "AbortError") {
      showToast("上传响应超时，正在刷新照片列表");
    }
  } finally {
    el.photoInput.value = "";
    el.photoUploadButton.disabled = false;
    el.photoUploadButton.textContent = "上传照片";
  }

  if (state.editingRecord?.id !== classroomId) return;
  try {
    await loadClassroomPhotos(classroomId);
  } catch {
    showToast(uploaded ? "照片已上传，列表刷新失败" : "上传状态未确认，请稍后刷新");
  }
}

async function deleteClassroomPhoto(photo) {
  if (!state.editingRecord) return;
  const confirmed = window.confirm(`确定删除照片 ${photo.originalName || photo.id} 吗？`);
  if (!confirmed) return;
  const result = await sendReliableJsonMutation(
    `/api/classrooms/${state.editingRecord.id}/photos/${photo.id}`,
    "DELETE",
    { clientRequestId: makeClientRequestId() },
    "照片删除"
  );
  if (result.queued) {
    showToast("网络不稳定，删除申请已保存在本机，联网后自动提交");
    return;
  }
  showToast(result.status === "pending" ? "照片删除已提交审核" : "照片已删除");
  await loadClassroomPhotos(state.editingRecord.id);
}

async function createClassroom() {
  if (state.user?.role !== "admin") return;
  const values = collectClassroomFormValues(el.createClassroomFields);
  if (!values.building || !values.room) {
    showToast("楼栋和教室编号不能为空");
    return;
  }

  el.submitCreateClassroomButton.disabled = true;
  el.submitCreateClassroomButton.textContent = "提交中";
  try {
    const result = await sendReliableJsonMutation(
      "/api/classrooms",
      "POST",
      { values, clientRequestId: makeClientRequestId() },
      "新增教室"
    );
    el.createClassroomDialog.close();
    if (result.queued) {
      showToast("网络不稳定，新增教室已保存在本机，联网后自动提交");
      return;
    }
    if (result.status === "pending") {
      showToast("已提交新增申请，等待其他管理员审核");
    } else {
      showToast("教室记录已新增");
      state.query.building = "";
      state.query.department = "";
      state.query.planned = "";
      state.query.pending = "";
      el.searchInput.value = result.record?.values?.room || "";
      state.query.search = el.searchInput.value;
    }
    await loadClassrooms();
    await loadSuggestions();
    await loadReviews();
  } finally {
    el.submitCreateClassroomButton.disabled = false;
    el.submitCreateClassroomButton.textContent = "保存记录";
  }
}

function openPasswordDialog() {
  el.selfUsernameInput.value = state.user?.username || "";
  el.currentPasswordInput.value = "";
  el.selfNewPasswordInput.value = "";
  el.confirmNewPasswordInput.value = "";
  el.passwordDialog.showModal();
  el.currentPasswordInput.focus();
}

async function changeOwnPassword() {
  const currentPassword = el.currentPasswordInput.value;
  const newPassword = el.selfNewPasswordInput.value;
  const confirmPassword = el.confirmNewPasswordInput.value;
  if (!currentPassword) {
    showToast("请先输入当前密码");
    el.currentPasswordInput.focus();
    return;
  }
  if (newPassword.length < 6) {
    showToast("新密码至少 6 位");
    el.selfNewPasswordInput.focus();
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast("两次输入的新密码不一致");
    el.confirmNewPasswordInput.focus();
    return;
  }

  await requestJson("/api/me/password", {
    method: "POST",
    body: JSON.stringify({ currentPassword, newPassword })
  });
  el.passwordDialog.close();
  el.currentPasswordInput.value = "";
  el.selfNewPasswordInput.value = "";
  el.confirmNewPasswordInput.value = "";
  showToast("密码已修改");
}

function collectClassroomFormValues(container) {
  const values = {};
  for (const input of container.querySelectorAll("input, textarea")) {
    if (input.type === "checkbox") {
      values[input.name] = input.checked ? "更新" : "";
      continue;
    }
    values[input.name] = input.value.trim();
  }
  return values;
}

async function reviewRequest(request, decision) {
  const endpoint = request.requestType === "create"
    ? `/api/classroom-create-requests/${request.id}/review`
    : request.requestType === "photo"
      ? `/api/classroom-photo-requests/${request.id}/review`
      : `/api/change-requests/${request.id}/review`;
  await requestJson(endpoint, {
    method: "POST",
    body: JSON.stringify({ decision })
  });
  if (request.requestType === "create") {
    showToast(decision === "approved" ? "已通过并新增教室" : "已拒绝新增申请");
  } else if (request.requestType === "photo") {
    showToast(decision === "approved" ? "照片申请已通过" : "照片申请已拒绝");
  } else {
    showToast(decision === "approved" ? "已通过并更新正式数据" : "已拒绝该变更");
  }
  await loadClassrooms();
  await loadSuggestions();
  await loadReviews();
}

async function createUser() {
  await requestJson("/api/users", {
    method: "POST",
    body: JSON.stringify({
      username: el.newUsernameInput.value,
      displayName: el.newDisplayNameInput.value,
      role: el.newRoleInput.value,
      password: el.newPasswordInput.value
    })
  });
  el.newUsernameInput.value = "";
  el.newDisplayNameInput.value = "";
  el.newPasswordInput.value = "";
  showToast("用户已新增");
  await loadUsers();
  el.newUsernameInput.focus();
}

async function openUserManager() {
  if (!isSuperAdmin()) return;
  el.userDialog.showModal();
  await loadUsers();
}

async function loadUsers() {
  if (!isSuperAdmin()) return;
  const data = await getJson("/api/users");
  state.users = data.users || [];
  renderUsers();
}

function renderUsers() {
  const rows = state.users.map((user) => {
    const tr = document.createElement("tr");
    tr.dataset.userId = user.id;
    const locked = user.username === "admin";
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(user.username)}</strong>
        ${locked ? `<span class="miniNote">超级管理员</span>` : ""}
      </td>
      <td><input class="userDisplayName" value="${escapeHtml(user.displayName || "")}" /></td>
      <td>
        <select class="userRole" ${locked ? "disabled" : ""}>
          <option value="inspector" ${user.role === "inspector" ? "selected" : ""}>巡查员</option>
          <option value="admin" ${user.role === "admin" ? "selected" : ""}>管理员</option>
        </select>
      </td>
      <td>
        <select class="userActive" ${locked ? "disabled" : ""}>
          <option value="1" ${user.active ? "selected" : ""}>启用</option>
          <option value="0" ${user.active ? "" : "selected"}>停用</option>
        </select>
      </td>
      <td><span class="muted">提交 ${user.submittedCount || 0} / 审核 ${user.reviewedCount || 0}</span></td>
      <td>
        <div class="passwordReset">
          <input class="userPassword" type="password" autocomplete="new-password" placeholder="新密码" />
          <button type="button" data-action="reset-password">重置</button>
        </div>
      </td>
      <td>
        <div class="actions userActions">
          <button class="primary" type="button" data-action="save-user">保存资料</button>
          ${locked ? "" : `<button class="danger" type="button" data-action="delete-user">删除</button>`}
        </div>
      </td>
    `;
    tr.querySelector('[data-action="save-user"]').addEventListener("click", () => saveUser(tr, user));
    tr.querySelector('[data-action="reset-password"]').addEventListener("click", () => resetUserPassword(tr, user));
    tr.querySelector('[data-action="delete-user"]')?.addEventListener("click", () => deleteUser(user));
    return tr;
  });

  el.userRows.replaceChildren(...rows);
}

async function saveUser(row, user) {
  await requestJson(`/api/users/${user.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      displayName: row.querySelector(".userDisplayName").value.trim(),
      role: row.querySelector(".userRole").value,
      active: row.querySelector(".userActive").value === "1"
    })
  });
  showToast("用户信息已保存");
  await loadUsers();
}

async function resetUserPassword(row, user) {
  const passwordInput = row.querySelector(".userPassword");
  const password = passwordInput.value;
  if (!password) {
    showToast("请先输入新密码");
    return;
  }
  await requestJson(`/api/users/${user.id}/password`, {
    method: "POST",
    body: JSON.stringify({ password })
  });
  passwordInput.value = "";
  showToast(`已重置 ${user.username} 的密码`);
}

async function deleteUser(user) {
  if (user.username === "admin") return;
  const confirmed = window.confirm(`确定删除用户 ${user.username} 吗？删除后该账号不能再登录，历史记录会保留。`);
  if (!confirmed) return;
  await requestJson(`/api/users/${user.id}`, { method: "DELETE" });
  showToast(`已删除用户 ${user.username}`);
  await loadUsers();
}

async function openAuditLog() {
  if (!isSuperAdmin()) return;
  el.auditDialog.showModal();
  await loadAuditLogs({ append: false });
}

async function openBackupManager() {
  if (!isSuperAdmin()) return;
  el.backupDialog.showModal();
  await loadBackups();
}

async function loadBackups() {
  if (!isSuperAdmin()) return;
  const data = await getJson("/api/backups");
  state.backups = data.backups || [];
  const policy = data.policy || {};
  el.backupPolicy.textContent = `备份不按天数清理；自动备份超过 ${policy.autoBackupKeep || 200} 份时删除最旧记录，手动及恢复前备份永久保留${policy.mirrorEnabled ? "，已启用外部镜像目录" : "，尚未配置外部镜像目录"}。`;
  renderBackups();
}

function renderBackups() {
  if (!state.backups.length) {
    el.backupList.innerHTML = `<div class="empty" style="display:block">暂无数据库备份</div>`;
    return;
  }

  el.backupList.replaceChildren(...state.backups.map((backup) => {
    const item = document.createElement("article");
    item.className = "backupItem";
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(backup.kindLabel || backup.kind)}</strong>
        <span>${escapeHtml(backup.createdAt)} · ${escapeHtml(backup.sizeLabel)}</span>
        <code>${escapeHtml(backup.file)}</code>
      </div>
      <div class="backupActions">
        <a class="buttonLink" href="${escapeHtml(backup.downloadUrl)}">下载</a>
        <button class="danger" type="button" data-file="${escapeHtml(backup.file)}">启用此备份</button>
      </div>
    `;
    item.querySelector("[data-file]").addEventListener("click", () => restoreServerBackup(backup.file));
    return item;
  }));
}

async function createBackup() {
  el.createBackupButton.disabled = true;
  try {
    await requestJson("/api/backups", { method: "POST" });
    showToast("已创建数据库备份");
    await loadBackups();
  } finally {
    el.createBackupButton.disabled = false;
  }
}

async function restoreServerBackup(file) {
  if (!confirm(`确认启用这个数据库备份吗？\n\n${file}\n\n系统会先自动备份当前数据库，然后重启服务。`)) return;
  await requestJson(`/api/backups/${encodeURIComponent(file)}/restore`, { method: "POST" });
  showToast("正在启用备份，服务即将重启");
  el.backupDialog.close();
  setTimeout(() => window.location.reload(), 4000);
}

async function uploadAndRestoreBackup() {
  const file = el.backupUploadInput.files?.[0];
  if (!file) return;
  if (!confirm(`确认上传并启用这个数据库文件吗？\n\n${file.name}\n\n系统会先校验文件并自动备份当前数据库。`)) {
    el.backupUploadInput.value = "";
    return;
  }

  const formData = new FormData();
  formData.append("database", file);
  el.uploadBackupButton.disabled = true;
  el.uploadBackupButton.textContent = "上传中";
  try {
    await requestJson("/api/backups/upload-restore", {
      method: "POST",
      body: formData
    });
    showToast("数据库已上传，服务即将重启");
    el.backupDialog.close();
    setTimeout(() => window.location.reload(), 4000);
  } finally {
    el.backupUploadInput.value = "";
    el.uploadBackupButton.disabled = false;
    el.uploadBackupButton.textContent = "上传并启用";
  }
}

async function loadAuditLogs({ append = false } = {}) {
  if (!isSuperAdmin()) return;
  const nextPage = append ? state.auditPage + 1 : 1;
  const query = { ...state.auditQuery, page: nextPage, pageSize: 100 };
  const data = await getJson(`/api/audit-logs?${new URLSearchParams(cleanQuery(query))}`);
  state.auditPage = nextPage;
  state.auditLogs = append ? [...state.auditLogs, ...(data.logs || [])] : data.logs || [];
  state.auditActors = data.actors || [];
  state.auditTotal = Number(data.total || 0);
  state.auditHasMore = Boolean(data.hasMore);
  renderAuditActors();
  renderAuditLogs();
  el.auditCountLabel.textContent = `已显示 ${state.auditLogs.length} / ${state.auditTotal} 条记录`;
  el.auditMoreButton.hidden = !state.auditHasMore;
}

function renderAuditActors() {
  const current = state.auditQuery.actorId;
  el.auditActorFilter.replaceChildren(
    createOption("", "全部用户", current === ""),
    ...state.auditActors.map((actor) => createOption(String(actor.id), `${actor.displayName || actor.username} (${actor.username})`, String(actor.id) === current))
  );
}

function renderAuditLogs() {
  if (!state.auditLogs.length) {
    el.auditList.innerHTML = `<div class="empty" style="display:block">没有匹配的操作记录</div>`;
    return;
  }
  el.auditList.replaceChildren(...state.auditLogs.map((log) => {
    const item = document.createElement("article");
    item.className = "auditItem";
    item.innerHTML = `
      <header>
        <div>
          <strong>${escapeHtml(log.actionLabel)}</strong>
          <span>${escapeHtml(log.actorName)}${log.actorUsername ? ` · ${escapeHtml(log.actorUsername)}` : ""}</span>
        </div>
        <time>${escapeHtml(formatBeijingTime(log.createdAt))}</time>
      </header>
      <div class="auditMeta">
        ${log.targetLabel ? `<span>对象：${escapeHtml(log.targetLabel)}</span>` : ""}
        ${log.roomLabel ? `<span>房间：${escapeHtml(log.roomLabel)}</span>` : ""}
      </div>
      ${renderAuditItems(log)}
      ${renderAuditDetail(log.detail)}
      ${renderRollbackActions(log)}
    `;
    item.querySelectorAll("[data-rollback-scope]").forEach((button) => {
      button.addEventListener("click", () => previewRollback(log, button.dataset.rollbackScope));
    });
    return item;
  }));
}

function renderRollbackActions(log) {
  const canRollbackUpdate = log.action === "review_approved" && log.targetType === "change_request";
  const canRollbackCreate = log.action === "review_create_approved" && log.targetType === "classroom_create_request";
  const canRollbackPhoto = ["review_photo_upload_approved", "review_photo_delete_approved"].includes(log.action)
    && log.targetType === "classroom_photo_request";
  if (!isSuperAdmin() || (!canRollbackUpdate && !canRollbackCreate && !canRollbackPhoto)) return "";
  const singleLabel = canRollbackCreate ? "撤销此新增" : canRollbackPhoto ? "撤销此照片操作" : "撤销此修改";
  return `
    <div class="auditActions">
      <button type="button" data-rollback-scope="single">${singleLabel}</button>
      <button class="danger" type="button" data-rollback-scope="before">还原到此记录之前</button>
    </div>
  `;
}

async function previewRollback(log, scope) {
  const useTimeline = scope === "before" || log.targetType === "classroom_photo_request";
  const path = log.targetType === "classroom_create_request" ? "classroom-create-requests" : "change-requests";
  const previewUrl = useTimeline
    ? `/api/rollback/timeline/${log.id}/preview?${new URLSearchParams({ scope })}`
    : `/api/rollback/${path}/${log.targetId}/preview?${new URLSearchParams({ scope })}`;
  const applyUrl = useTimeline
    ? `/api/rollback/timeline/${log.id}`
    : `/api/rollback/${path}/${log.targetId}`;
  const preview = await getJson(previewUrl);
  const lines = [
    preview.summary,
    preview.reason ? `注意：${preview.reason}` : "",
    "",
    ...preview.changes.slice(0, 12).map((change) => `${change.roomLabel} · ${change.label}：${change.currentValue || "空"} → ${change.restoreValue || "空"}`),
    preview.changes.length > 12 ? `还有 ${preview.changes.length - 12} 项未显示` : ""
  ].filter(Boolean);
  if (!preview.canExecute) {
    alert(lines.join("\n"));
    return;
  }
  if (!confirm(`${lines.join("\n")}\n\n确认执行吗？`)) return;
  await requestJson(applyUrl, {
    method: "POST",
    body: JSON.stringify({ scope })
  });
  showToast(scope === "single" ? "已撤销该次修改" : "已还原到该记录之前");
  await loadClassrooms();
  await loadSuggestions();
  await loadReviews();
  await loadAuditLogs();
}

function renderAuditItems(log) {
  if (!log.items?.length) return "";
  return `
    <div class="auditChanges">
      ${log.items.map((item) => `
        <div>
          <strong>${escapeHtml(item.label || item.fieldKey)}</strong>
          <span>${escapeHtml(item.oldValue || "空")} → ${escapeHtml(item.newValue || "空")}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAuditDetail(detail = {}) {
  const visible = [];
  if (detail.file) visible.push(`文件：${detail.file}`);
  if (detail.count !== undefined) visible.push(`数量：${detail.count}`);
  if (detail.requestsCreated !== undefined) visible.push(`生成审核：${detail.requestsCreated}`);
  if (detail.changedFields !== undefined) visible.push(`变化字段：${detail.changedFields}`);
  if (detail.requestsIncluded !== undefined) visible.push(`回滚记录：${detail.requestsIncluded}`);
  if (detail.fieldCount !== undefined) visible.push(`回滚字段：${detail.fieldCount}`);
  if (detail.sizeLabel) visible.push(`大小：${detail.sizeLabel}`);
  if (detail.preRestoreBackup) visible.push(`恢复前备份：${detail.preRestoreBackup}`);
  if (detail.note) visible.push(`备注：${detail.note}`);
  if (!visible.length) return "";
  return `<p class="muted auditDetail">${visible.map(escapeHtml).join(" · ")}</p>`;
}

function exportExcel() {
  syncQueryFromControls();
  const query = cleanQuery(state.query);
  const visibleIds = state.records.map((record) => record.id).filter(Boolean);
  if (visibleIds.length) query.ids = visibleIds.join(",");
  window.location.href = `/api/export?${new URLSearchParams(query)}`;
}

async function uploadExcel() {
  const file = el.uploadInput.files?.[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);
  el.uploadButton.disabled = true;
  el.uploadButton.textContent = "上传中";

  try {
    const result = await requestJson("/api/import-review", {
      method: "POST",
      body: formData
    });
    showToast(result.message || "Excel 已上传");
    await loadClassrooms();
    await loadSuggestions();
    await loadReviews();
  } finally {
    el.uploadInput.value = "";
    el.uploadButton.disabled = false;
    el.uploadButton.textContent = "上传 Excel";
  }
}

function renderPlan(values) {
  const parts = [];
  if (values.plan_screen) parts.push("屏幕");
  if (values.plan_board) parts.push("书写板");
  if (values.plan_audio) parts.push("教师扩声");
  if (values.plan_recording) parts.push("录播");
  return parts.length
    ? `<span class="planList">${parts.map((part) => `<span class="badge badge-ok planBadge">${escapeHtml(part)}</span>`).join("")}</span>`
    : badge("无");
}

function plannedSummaryLabel() {
  return {
    screen: "屏幕更新",
    board: "书写板更新",
    audio: "教师扩声更新",
    recording: "录播更新",
    yes: "涉及更新",
    no: "无更新项目"
  }[state.query.planned] || "涉及更新";
}

function planBreakdownText(byPlan) {
  return [
    `屏幕${byPlan.screen || 0}`,
    `书写板${byPlan.board || 0}`,
    `教师扩声${byPlan.audio || 0}`,
    `录播${byPlan.recording || 0}`
  ].join(" / ");
}

function isPlanUpdateField(key) {
  return ["plan_screen", "plan_board", "plan_audio", "plan_recording"].includes(key);
}

function doorTitle(values) {
  return values.front_door || values.room || "";
}

function doorSubtitle(values) {
  const parts = [`${values.building || ""} · ${formatBuildingSide(values.orientation || "")}`.trim()];
  if (values.back_door) parts.push(`后门 ${values.back_door}`);
  else parts.push("后门待补充");
  return parts.filter(Boolean).join(" · ");
}

function formatBuildingSide(value) {
  if (!value) return "";
  return String(value).endsWith("侧") ? String(value) : `${value}侧`;
}

function formatBeijingTime(value) {
  if (!value) return "";
  const text = String(value).trim();
  const isoText = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date).replaceAll("/", "-");
}

function badge(text, tone = "") {
  const className = tone === "warn" ? "badge badge-warn" : text && text !== "无" ? "badge badge-ok" : "badge";
  return `<span class="${className}">${escapeHtml(text || "无")}</span>`;
}

function roleText(user) {
  if (!user) return "";
  if (user.isSuperAdmin || user.username === "admin") return "超级管理员";
  return user.role === "admin" ? "管理员" : "巡查员";
}

function isSuperAdmin() {
  return Boolean(state.user?.isSuperAdmin || state.user?.username === "admin");
}

function fillSelect(node, allLabel, values, current, formatLabel = (value) => value) {
  const options = [{ value: "", label: allLabel }, ...values.map((value) => ({ value, label: formatLabel(value) }))];
  node.replaceChildren(...options.map((option) => createOption(option.value, option.label, option.value === current)));
}

function createOption(value, label, selected = false) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  item.selected = selected;
  return item;
}

function cleanQuery(query) {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ""));
}

function syncQueryFromControls() {
  state.query.search = el.searchInput.value.trim();
  state.query.building = el.buildingFilter.value;
  state.query.department = el.departmentFilter.value;
  state.query.planned = el.plannedFilter.value;
  state.query.pending = el.pendingFilter.value;
}

const outboxDatabaseName = "teachingroom-offline";
const outboxStoreName = "outbox";

async function sendReliableJsonMutation(url, method, payload, label) {
  try {
    return await requestJson(url, {
      method,
      body: JSON.stringify(payload),
      timeoutMs: 12000,
      retries: 2,
      retryDelayMs: 900,
      retryMessage: `网络不稳定，正在重试${label}`
    });
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await addOutboxEntry({
      kind: "json",
      url,
      method,
      payload,
      label,
      userId: state.user?.id || null,
      status: "pending",
      createdAt: new Date().toISOString()
    });
    await refreshOutboxCount();
    return { queued: true, status: "queued" };
  }
}

async function sendReliablePhotoMutation(classroomId, file) {
  const clientRequestId = makeClientRequestId();
  const url = `/api/classrooms/${classroomId}/photos`;
  const buildFormData = () => {
    const formData = new FormData();
    formData.append("photo", file, file.name);
    formData.append("clientRequestId", clientRequestId);
    return formData;
  };
  try {
    return await requestJson(url, {
      method: "POST",
      body: buildFormData(),
      timeoutMs: 45000,
      retries: 2,
      retryDelayMs: 1200,
      retryMessage: "网络不稳定，正在重试照片上传"
    });
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await addOutboxEntry({
      kind: "photo",
      url,
      method: "POST",
      classroomId,
      clientRequestId,
      blob: file,
      fileName: file.name,
      mimeType: file.type,
      label: "照片上传",
      userId: state.user?.id || null,
      status: "pending",
      createdAt: new Date().toISOString()
    });
    await refreshOutboxCount();
    return { queued: true, status: "queued" };
  }
}

async function processOutbox() {
  if (state.processingOutbox || !state.user || !navigator.onLine) return;
  state.processingOutbox = true;
  let sent = 0;
  try {
    const entries = (await getOutboxEntries())
      .filter((entry) => entry.userId === state.user.id && entry.status === "pending" && Number(entry.nextAttemptAt || 0) <= Date.now())
      .sort((a, b) => a.id - b.id);
    for (const entry of entries) {
      try {
        if (entry.kind === "photo") {
          const formData = new FormData();
          formData.append("photo", entry.blob, entry.fileName || "photo");
          formData.append("clientRequestId", entry.clientRequestId);
          await requestJsonOnce(entry.url, { method: entry.method, body: formData, timeoutMs: 45000 });
        } else {
          await requestJsonOnce(entry.url, {
            method: entry.method,
            body: JSON.stringify(entry.payload),
            timeoutMs: 15000
          });
        }
        await deleteOutboxEntry(entry.id);
        sent += 1;
      } catch (error) {
        if (isNetworkError(error)) break;
        entry.status = "pending";
        entry.attempts = Number(entry.attempts || 0) + 1;
        entry.lastError = error.message || "服务器拒绝了该请求";
        entry.nextAttemptAt = Date.now() + Math.min(5 * 60 * 1000, 30000 * (2 ** Math.min(entry.attempts, 4)));
        await updateOutboxEntry(entry);
      }
    }
  } finally {
    state.processingOutbox = false;
    await refreshOutboxCount();
  }

  if (sent) {
    showToast(`已自动补交 ${sent} 项离线操作`);
    await loadClassrooms();
    await loadSuggestions();
    await loadReviews();
    if (state.editingRecord) await loadClassroomPhotos(state.editingRecord.id).catch(() => {});
  }
}

function openOutboxDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("当前浏览器不支持离线存储"));
    const request = window.indexedDB.open(outboxDatabaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(outboxStoreName)) {
        request.result.createObjectStore(outboxStoreName, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开离线队列"));
  });
}

async function withOutboxStore(mode, action) {
  const database = await openOutboxDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(outboxStoreName, mode);
    const store = transaction.objectStore(outboxStoreName);
    let result;
    try {
      result = action(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      database.close();
      resolve(result?.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("离线队列操作失败"));
    };
  });
}

function addOutboxEntry(entry) {
  return withOutboxStore("readwrite", (store) => store.add(entry));
}

function updateOutboxEntry(entry) {
  return withOutboxStore("readwrite", (store) => store.put(entry));
}

function deleteOutboxEntry(id) {
  return withOutboxStore("readwrite", (store) => store.delete(id));
}

async function getOutboxEntries() {
  const database = await openOutboxDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(outboxStoreName, "readonly");
    const request = transaction.objectStore(outboxStoreName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("无法读取离线队列"));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
  });
}

async function refreshOutboxCount() {
  try {
    const entries = await getOutboxEntries();
    state.outboxCount = entries.filter((entry) => {
      if (state.user && entry.userId !== state.user.id) return false;
      return entry.status === "pending";
    }).length;
  } catch {
    state.outboxCount = 0;
  }
  updateNetworkStatus();
}

function updateNetworkStatus() {
  if (!el.networkStatus) return;
  const connected = navigator.onLine && state.serverReachable !== false;
  el.networkStatus.classList.toggle("offline", !connected);
  el.networkStatus.classList.toggle("queued", connected && state.outboxCount > 0);
  el.networkStatus.textContent = connected
    ? state.outboxCount ? `在线 · ${state.outboxCount} 项待发送` : "在线"
    : state.outboxCount ? `离线 · ${state.outboxCount} 项待发送` : "离线";
}

function isNetworkError(error) {
  return error?.name === "AbortError" || error?.name === "TypeError" || error?.networkError === true;
}

async function getJson(url) {
  return requestJson(url);
}

async function requestJson(url, options = {}) {
  const { retries = 0, retryDelayMs = 800, retryMessage = "网络不稳定，正在重试", ...requestOptions } = options;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestJsonOnce(url, requestOptions);
    } catch (error) {
      const shouldRetry = (error.name === "AbortError" || error.name === "TypeError") && attempt < retries;
      if (!shouldRetry) throw error;
      showToast(`${retryMessage}（${attempt + 1}/${retries}）`);
      await delay(retryDelayMs * (attempt + 1));
    }
  }
}

async function requestJsonOnce(url, options = {}) {
  const { headers: optionHeaders, timeoutMs = 0, ...fetchOptions } = options;
  const headers = options.body instanceof FormData
    ? { ...(optionHeaders || {}) }
    : { "Content-Type": "application/json", ...(optionHeaders || {}) };
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers,
      signal: controller?.signal || fetchOptions.signal
    });
    state.serverReachable = true;
    updateNetworkStatus();
  } catch (error) {
    state.serverReachable = false;
    updateNetworkStatus();
    error.networkError = true;
    throw error;
  } finally {
    if (timeout) window.clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    showToast(payload.error || "请求失败");
    const error = new Error(payload.error || "request failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function makeClientRequestId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 2200);
}

function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
