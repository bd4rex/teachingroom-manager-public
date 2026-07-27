# Changelog

[中文](./CHANGELOG.md)

## 2026-07-27

### History Action Display Fix

- Expanded the desktop action column and changed `History` plus `Edit` into a stable two-column action layout so neither button extends beyond the table.
- Standardized desktop-row and mobile-card actions so `Edit` appears before `History`.
- Hardened long-text wrapping for the history dialog title, source badge, and old/new field values so real data cannot crowd the close button or overflow the content area.
- Rechecked 1280px desktop and 390px mobile viewports with zero horizontal page overflow.

### Classroom Configuration History And Full Review

- Added an immutable classroom-scoped history with effective timestamp, field old/new values, submitter, reviewer, source, reason, and review note.
- Classroom creation, web or Excel approvals, photo upload/deletion, single undo, and point-in-time restore now all enter classroom history.
- Upgrades backfill approved change and photo records and create one history-enablement snapshot per existing classroom; unique keys make the migration restart-safe and duplicate-free.
- Added `History` actions to desktop rows and mobile cards, with a paginated timeline rendered in Beijing time.
- Successful login now rotates the session ID; fresh deployments retain configured or protected randomly generated administrator credentials and do not introduce fixed default passwords.
- Direct photo persistence, audit, and classroom history now share one SQLite transaction; global audit logs also resolve directly targeted classrooms.
- Invalid `AUTO_BACKUP_KEEP` values now safely fall back to 200 so automatic backups are not mistakenly pruned; field normalization consistently trims surrounding whitespace.
- Updated affected transitive dependencies, returning the production dependency audit to zero known vulnerabilities.
- Added regression coverage for history, migration backfill, secure bootstrap, and rollback, plus desktop and 390px mobile browser acceptance.

## 2026-07-18

### Sanitized Public Edition

- Created an independent public repository from a history-free file snapshot, inheriting no private commits, branches, or pull-request references.
- Removed fixed default passwords; first startup creates only `admin`, whose password is supplied by `INITIAL_ADMIN_PASSWORD` or generated into a protected runtime file.
- Inspectors are no longer created automatically, and the temporary password file is deleted after the administrator's first password change.
- Removed the private repository address, local absolute paths, and metadata intended only for internal handoff.

### Synthetic Initialization Data

- Removed the real classroom equipment workbook from the current repository and replaced it with `初始化数据表格（虚拟）.xlsx`.
- The new workbook contains usage guidance and 12 fully synthetic classroom records covering all 18 currently supported standard fields.
- First-run import, Docker mounts, bilingual deployment documentation, and API filter examples now use synthetic data.

### Documentation Language Split

- Chinese and English are no longer mixed in the same Markdown file.
- Files without a language suffix are the default Chinese versions; English versions consistently use `.en.md`.
- Every document pair now has bidirectional language links, and Chinese plus English documentation centers were added.
- Both languages retain the same section structure, command examples, and feature scope.

## 2026-07-13

### Automatic Backup Limit

- Removed age-based backup expiration; automatic backups remain until the 200-file limit and then discard the oldest files, while manual and pre-restore backups are never deleted automatically.

## 2026-07-12

### Full-System Review And Hardening

- Login sessions now carry a user index; disabling, demoting, deleting, resetting a password, or changing one's own password invalidates affected sessions, and every protected request refreshes the current role.
- Classroom creation, field changes, photo uploads, and photo deletions from non-super-admin users all require cross-review; submitters cannot approve their own requests.
- Pending fields now use conflict detection, and approval rechecks the official old value to prevent stale requests from overwriting newer data.
- Added unified timeline rollback across fields, classroom creation, and photo operations; old events without sufficient inverse data are safely blocked with guidance to use a database backup.
- Excel exports now include a hidden field-definition worksheet so inspection notes and future fields can round-trip through upload while still producing review requests.
- Weak-network submissions now use a persistent IndexedDB outbox, idempotency keys, connection state, and backoff retries; review, rollback, and restore operations are never queued.
- Audit logs now filter the complete result set before pagination instead of searching only the latest 500 records; photo and unified rollback events are included.
- The open API publishes only explicitly allowed fields, accepts header tokens only, and disables CORS by default; photo uploads validate format and signatures and block same-origin SVG/HTML execution.
- Automatic backups now support age retention, a count limit, and an optional mirror directory; Docker Compose persists database, backup, upload, and export directories.
- Backup retention now runs on every service startup, even when the current day's automatic backup already exists.
- Database restore now clears all sessions contained in the backup so stale logins cannot be resurrected.
- Desktop table widths were rebalanced, the mobile building statistic returned to 23px, and photo guidance plus building-side editing now match review rules.
- Added real SQLite integration coverage for cross-review, session invalidation, idempotency, conflicts, photos, unified rollback preview, open API, audit pagination, and Excel round-trip; dependency audit reports zero known vulnerabilities.

## 2026-06-24

### Monitoring Field

- Added a `Monitoring` column after `Recording` in the classroom list.
- Mobile cards, edit forms, Excel export, and the open API now support the `monitoring` field.
- The search placeholder now includes `Monitoring`; search still covers all field values including notes.
- Classrooms already tagged as `Standard Exam Room` in inspection notes are set to `monitoring = Yes`.

## 2026-06-23

### Self-Service Password Change

- Added a `Change Password` entry in the top account area for all logged-in users.
- Password changes require the current password, a new password, and confirmation.
- The server verifies the current password and requires the new password to be at least 6 characters.
- Self-service password changes are written to the audit log for super-administrator review.
- The super-administrator password reset feature in user management remains unchanged.

### P1-P3 Review Fixes

- Super administrators can now use `Undo This Creation` or `Restore To Before This Record` on approved classroom creation audit records.
- Classroom creation rollback checks for later changes or photos before deletion to avoid breaking history.
- Pending review statistics now include both field-change requests and classroom creation requests.
- When an Excel upload contains unmatched new classrooms, administrator uploads now create pending classroom creation requests.
- Excel-created classroom requests now write per-room audit entries and preserve the source file name.
- User-management submission and review counts now include classroom creation requests.
- Excel import now recognizes classroom codes beginning with any letter, supporting additional buildings such as I and J.

### Classroom Creation Review

- Normal administrators now create a `Pending Creation` request instead of writing directly to official classroom data.
- Only another administrator can review the creation request; submitters cannot review their own creation requests.
- The super administrator `admin` can still create classrooms directly.
- A creation request writes to official classroom data only after approval; rejected requests do not reserve classroom codes.
- Added audit log types for creation submission, creation approval, and creation rejection.

### Weak-Network Creation Submission

- Classroom creation now includes a client request ID to identify the same submission.
- On mobile or weak networks, classroom creation automatically retries on timeout or network errors.
- Retries for the same request do not create duplicate classrooms or duplicate review requests.

## 2026-06-15

### Inspection Photos

- Added a `Notes` column between `Summer Plan` and `Review` in the classroom list.
- When inspection notes or photos exist, the list shows a `View` link that opens a read-only dialog for notes and photos.
- Added an `Inspection Photos` section after inspection notes in the classroom edit dialog.
- Logged-in users can upload classroom photos, and photos are stored directly in SQLite.
- Photos support thumbnail preview, full image viewing, uploader, timestamp, and file size display.
- Administrators can delete photos, and normal users can delete photos they uploaded.
- Photos are preserved with database backups for restore and migration.

### Cross Review

- Change review now requires cross review; submitters cannot review their own change requests.
- The super administrator `admin` can still review changes submitted by that account.
- Pending requests submitted by a normal administrator show a notice and hide approve/reject buttons for that user.
- Other administrators can still review the request normally.

### Administrator Classroom Creation

- Added an `Add Classroom` entry in the administrator interface, visible only to administrator-role users.
- The classroom creation form is generated from current field definitions, so future fields can appear automatically.
- Building and classroom code are required, and the system prevents duplicate classroom codes within the same building.
- New records support front door, back door, department, current equipment, summer plan, inspection notes, and related fields.
- Classroom creation is written to the audit log for later super-administrator review.

## 2026-06-05

### Excel Export Notes

- The `Export Notes` worksheet now includes export scope, filtered status, and filter criteria.
- Unfiltered exports show `All Data`; filtered or partial-list exports show `Filtered Results`.
- The notes worksheet now includes statistics for the exported scope, including record count, update-related rooms, pending reviews, building distribution, and update-plan breakdown.
- Statistics are calculated only from the records included in the exported workbook, making daily verification easier.

## 2026-05-19

### Database Backup And Restore

- Added a super-administrator-only `Database Backup` entry.
- On startup, the app checks whether an automatic backup already exists for the day and creates one if needed.
- While running, the app checks the daily automatic backup state once per hour.
- Backup files are stored under `backups/`; filenames include a Beijing-time timestamp and backup type.
- Super administrators can manually create a backup of the current database.
- Super administrators can download any backup file.
- Super administrators can enable an existing server-side backup.
- Super administrators can upload and enable a SQLite database file.
- Before enabling a backup or uploaded database, the app validates SQLite integrity and required tables.
- Before restore, the app creates a `before_restore` backup as a rollback point.
- After a database is enabled, the service restarts automatically and records the restore operation in the restored database.

### Super Administrator Rollback

- Added `Undo This Change`; super administrators can reverse one approved change from the operation log.
- Added `Restore To Before This Record`; super administrators can restore classroom base data to the state before a selected approved record.
- Rollback shows a preview before execution, including affected classrooms, fields, current values, and restored values.
- Single rollback detects later changes to the same field and blocks unsafe overwrites.
- If pending review changes affect rollback target fields, rollback is blocked until pending items are handled.
- Rollback operations are written to the audit log.

### Beijing Time Display

- Review and audit timestamps are displayed in UTC+8 Beijing time.
- The database keeps UTC-style timestamps; the frontend renders them as `Asia/Shanghai`.
- Excel export metadata uses Beijing time.

### Persistent Login Sessions

- Switched login sessions from Express MemoryStore to SQLite storage.
- Added the `user_sessions` table for session data, expiration, creation time, and update time.
- Expired sessions are cleaned on startup.
- Expired sessions are cleaned every 30 minutes while the service runs.
- Logout deletes the corresponding session.

Impact:

- Unexpired login sessions can survive service restarts.
- The Express `MemoryStore` production warning is removed.
- Deployment still only depends on Node.js and SQLite; Redis or other services are not required.

### Example Server Deployment

- The app was deployed as a systemd service named `teachingroom.service`.
- The service port is `3000`.
- The service is enabled to start on boot.
