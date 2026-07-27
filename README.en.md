# TeachingRoom Manager

[中文](./README.md)

TeachingRoom Manager is a lightweight browser-based classroom equipment data system.

The repository includes `初始化数据表格（虚拟）.xlsx` for first-run demonstrations. It contains synthetic data only; the application supports classroom inventory, inspection updates, review workflows, Excel import/export, audit logs, rollback, backups, and read-only base-data integration.

The app is designed for small internal teams. The expected user count is about ten people, so the runtime stays simple: Node.js, Express, SQLite, and plain frontend assets.

## Documentation

- [Concise deployment guide](./DEPLOYMENT.en.md)
- [Complete deployment and operations manual](./docs/DEPLOYMENT.en.md)
- [Development notes](./DEVELOPMENT.en.md)
- [Changelog](./docs/CHANGELOG.en.md)
- [Project work log](./docs/WORK_LOG_2026-05-18.en.md)
- [Version and upload log](./TIMESTAMP_LOG.en.md)
- [All documentation](./docs/README.en.md)

## Features

- Import demonstration records from the synthetic Excel template on first startup.
- Responsive desktop table view and mobile/tablet card view.
- Quick filtering by building, department, update plan, pending review state, and keyword.
- Role model for super administrator, administrator, and inspector.
- Inspectors and administrators submit data changes as review requests.
- Classroom creation, field changes, photo uploads, and photo deletions require cross-review for all users except the super administrator.
- Administrators review old/new field differences before official data is updated.
- Each classroom has a dedicated configuration history showing old/new values, submitter, reviewer, source, notes, photos, and rollback events in Beijing time.
- Super administrator-only user management and operation log.
- Single approved-change rollback and cross-type point-in-time rollback for fields, classrooms, and photos.
- Excel export based on current filters.
- Excel upload generates pending review requests instead of overwriting data directly.
- SQLite-backed login sessions.
- Persistent browser outbox with idempotent automatic retry for weak-network submissions.
- Automatic, manual, downloadable, uploadable, and restorable database backups.
- Read-only base-data API for other departments or internal systems.

## Quick Start

```bash
npm install
npm test
npm start
```

Open:

```text
http://localhost:3000/
```

First administrator account:

```text
Super administrator username: admin
Password: INITIAL_ADMIN_PASSWORD when set; otherwise data/initial-admin-password.txt
```

The app has no fixed password and does not create an inspector automatically. Change the administrator password immediately after first login; the generated temporary-password file is then deleted. Create inspectors and normal administrators from User Management.

## Runtime Defaults

```text
PORT=3000
DATA_DIR=./data
DB_PATH=./data/teachingroom.sqlite
SESSION_SECRET=<optional; generated into data/session-secret.txt when omitted>
INITIAL_ADMIN_PASSWORD=<optional first-run password; at least 12 characters>
BASE_DATA_CORS_ORIGIN=<empty by default; comma-separated allowlist>
AUTO_BACKUP_KEEP=200
BACKUP_MIRROR_DIR=<optional second backup directory>
```

The first run creates `data/teachingroom.sqlite`. If the database is empty, the app imports classroom records from:

```text
初始化数据表格（虚拟）.xlsx
```

All buildings, room signs, classes, departments, devices, and notes in this file are fictional. Replace or remove these records before production use.

## Data And Backups

Runtime data is intentionally excluded from Git:

```text
data/*.sqlite
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
backups/
uploads/
exports/
```

The application creates daily automatic backups under:

```text
backups/
```

Super administrators can also create, download, upload, and enable backups from the web UI.

Backups are not pruned by age. Automatic backups retain the newest 200 files by default; manual and pre-restore backups remain until an administrator removes them outside the app. Set `BACKUP_MIRROR_DIR` to copy backups to a second mounted disk or network directory.

## Base Data API

The app creates a token file for read-only API access:

```text
data/base-data-api-token.txt
```

Example:

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

Tokens are accepted only through `X-API-Token` or `Authorization: Bearer`; query-string tokens are rejected. Only fields explicitly marked for the public API are returned, and CORS is disabled unless an allowlist is configured.

Endpoints:

```text
GET /api/open/meta
GET /api/open/fields
GET /api/open/summary
GET /api/open/classrooms
GET /api/open/classrooms/:id
```

Common filters:

```text
building=X栋
department=小学
orientation=南
side=南侧
planned=yes
planned=screen
planned=board
planned=audio
search=X101
```

## Deployment

A systemd unit template is included at:

```text
deploy/teachingroom.service
```

See [DEPLOYMENT.en.md](./DEPLOYMENT.en.md) and [docs/DEPLOYMENT.en.md](./docs/DEPLOYMENT.en.md) for deployment and maintenance instructions.

## Development

See [DEVELOPMENT.en.md](./DEVELOPMENT.en.md) for architecture, workflow, and repository hygiene.

## Version And Upload Log

See [TIMESTAMP_LOG.en.md](./TIMESTAMP_LOG.en.md). It records GitHub upload events, repository location, commit IDs, and handoff notes.
