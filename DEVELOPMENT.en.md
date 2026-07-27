# Development Notes

[中文](./DEVELOPMENT.md)

This document describes the architecture, data model, frontend behavior, and maintenance workflow for TeachingRoom Manager.

## Goal

The project provides a small internal web system for classroom equipment data.

It replaces direct spreadsheet editing with reviewable changes, Excel import/export, audit logs, rollback, and database backup controls.

## Stack

- Node.js 20+
- Express 5
- SQLite through `better-sqlite3`
- ExcelJS for workbook import/export
- Express session with a SQLite-backed session store
- Plain HTML, CSS, and JavaScript

## Directory Layout

```text
teachingroom/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src/
│   ├── server.js
│   ├── database.js
│   ├── excel.js
│   ├── timeline-rollback.js
│   └── seed.js
├── tests/
│   └── integration.test.js
├── docs/
│   ├── README.md
│   ├── README.en.md
│   ├── CHANGELOG.md
│   ├── CHANGELOG.en.md
│   ├── DEPLOYMENT.md
│   ├── DEPLOYMENT.en.md
│   ├── WORK_LOG_2026-05-18.md
│   └── WORK_LOG_2026-05-18.en.md
├── deploy/
│   └── teachingroom.service
├── README.md
├── README.en.md
├── DEPLOYMENT.md
├── DEPLOYMENT.en.md
├── DEVELOPMENT.md
├── DEVELOPMENT.en.md
├── TIMESTAMP_LOG.md
├── TIMESTAMP_LOG.en.md
├── Dockerfile
├── docker-compose.yml
└── package.json
```

Runtime directories are excluded from Git:

```text
data/
backups/
uploads/
exports/
output/
node_modules/
```

## Backend

`src/server.js` handles:

- Static files from `public/`.
- Authentication and session endpoints.
- Classroom list and filters.
- Change request submission.
- Administrator review workflow.
- Super administrator user management.
- Audit log search and filtering.
- Single-change rollback and point-in-time rollback.
- Excel export.
- Excel upload-to-review workflow.
- Read-only open API.
- Database backup, download, upload, and restore.

`src/database.js` handles:

- SQLite connection.
- Schema initialization.
- Default field definitions.
- Default users.
- Audit logging.
- Classroom value writes.

`src/excel.js` handles:

- First-run source workbook import.
- Uploaded workbook parsing.
- Export workbook generation.

## Data Model

Core tables:

```text
users
field_definitions
classrooms
classroom_values
change_requests
change_request_items
classroom_create_requests
classroom_photos
classroom_photo_requests
audit_logs
classroom_history
user_sessions
```

Classroom fields are stored as key/value rows so new fields can be added without changing the main `classrooms` table.

`classroom_history` is the immutable, classroom-scoped ledger of effective changes. Each event stores the classroom, timestamp, source, submitter, reviewer, reason, review note, and field-level old/new values. Upgrades backfill approved change and photo requests and create one enablement snapshot for every existing classroom. Future creation, approval, photo, and rollback transactions write history atomically with official data.

## Roles

- Super administrator: fixed username `admin`; can manage users, audit logs, rollback, and database backups.
- Administrator: can review classroom data changes.
- Inspector: can view data and submit change requests.

The app treats `role=admin` as data-review permission. Super administrator permission is determined by username `admin`.

## Change Workflow

1. A user submits field-level changes for a classroom.
2. The app stores a `change_requests` row plus `change_request_items` old/new values.
3. An administrator reviews the request.
4. Approved changes are written to `classroom_values`.
5. Rejected changes remain in history.
6. Audit logs preserve the workflow.
7. Approval also writes the classroom-scoped configuration history.

All non-super-admin mutations use cross-review. A submitter cannot approve their own classroom creation, field change, photo upload, or photo deletion. Pending requests are idempotent through `clientRequestId`, and approval verifies that the official old value has not changed.

## Rollback

Rollback is available only to the super administrator.

- Single rollback reverses one approved change request.
- Point-in-time rollback reverses the selected mutation and later supported field, classroom-creation, and photo mutations in reverse audit order.

Rollback only affects classroom base data. It does not roll back users, sessions, field definitions, or backup files. If an old audit event lacks sufficient inverse data, the system blocks partial rollback and instructs the super administrator to use a database backup.

## Backups

Backups are stored as SQLite files under `backups/`.

Backup types:

```text
auto
manual
before_restore
```

Before restore, the app validates:

- SQLite integrity.
- Required system tables.
- Presence of the `admin` user.

## Frontend

`public/app.js` uses browser APIs only.

It renders:

- Desktop table view.
- Mobile card view.
- Change request editor.
- Review panel.
- User management dialog.
- Audit log dialog.
- Database backup dialog.

Timestamps are stored as UTC-like SQLite timestamps and displayed in `Asia/Shanghai` in the browser.

Weak-network classroom changes, classroom creation, photo upload, and photo deletion use an IndexedDB outbox. Review, rollback, user management, and database restore are intentionally never queued because delayed execution would be unsafe.

## Development Workflow

```bash
npm install
npm test
npm start
```

Open:

```text
http://localhost:3000/
```

## Suggested Checks Before Commit

```bash
npm audit
npm test
git status --short
```

Manual browser checks:

- Login as `admin`.
- Open operation log.
- Open database backup dialog.
- Create a backup.
- Export Excel.
- Check mobile width around `375px`.

## Repository Hygiene

- Keep real deployment IPs, usernames, passwords, secrets, tokens, and local paths out of committed files.
- Keep runtime data out of Git.
- Commit source code, static assets, documentation, deployment templates, and the seed workbook only.
- Record GitHub upload and handoff details in `TIMESTAMP_LOG.en.md`.
