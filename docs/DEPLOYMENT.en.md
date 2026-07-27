# TeachingRoom Manager Deployment

[中文](./DEPLOYMENT.md)

This is the complete deployment and operations manual. The root [DEPLOYMENT.en.md](../DEPLOYMENT.en.md) is the concise guide for quick handoff.

## 1. Deployment Goal

The system manages internal classroom equipment data and is suitable for a school server, office computer, NAS, or small Ubuntu host.

After startup, desktops, phones, and tablets can use the app through a browser if they can reach the host IP and port.

Default URL:

```text
http://<SERVER_IP>:3000
```

## 2. Deployment Options

Recommended options:

1. Run directly with Node.js, suitable for testing and small long-term deployments.
2. Run with Docker Compose, suitable for containerized environments.

For the current small user count, Node.js plus systemd is the most direct and maintainable deployment mode.

## 3. Project Directory

Example deployment directory:

```text
<APP_DIR>
```

Key files:

```text
package.json
src/server.js
src/database.js
src/excel.js
public/
data/
backups/
deploy/teachingroom.service
初始化数据表格（虚拟）.xlsx
```

## 4. Data Files

SQLite database:

```text
data/teachingroom.sqlite
```

Runtime SQLite sidecar files:

```text
data/teachingroom.sqlite-shm
data/teachingroom.sqlite-wal
```

Login sessions are stored in the same SQLite database in the `user_sessions` table.

Base data API token:

```text
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
```

On first startup, if the database is empty, the app imports data from:

```text
初始化数据表格（虚拟）.xlsx
```

This workbook contains synthetic examples only. Replace or remove the fictional records before production deployment; do not treat it as a real classroom inventory.

## 5. First Administrator Account

```text
Super administrator username: admin
Password: INITIAL_ADMIN_PASSWORD when set; otherwise data/initial-admin-password.txt
```

`INITIAL_ADMIN_PASSWORD` must contain at least 12 characters. The app has no fixed password and does not create an inspector automatically. Change the administrator password immediately after first login; the generated temporary-password file is then deleted.

Permission notes:

- `admin` is the super administrator and can manage users, audit logs, rollback, and database backups.
- Normal administrators can review classroom changes but cannot manage users.
- Inspectors can view data and submit change requests.

## 6. Direct Node.js Run

Install dependencies:

```bash
cd <APP_DIR>
npm ci --omit=dev
```

Check code:

```bash
npm test
```

Start service:

```bash
npm start
```

Local access:

```text
http://localhost:3000
```

LAN access:

```text
http://<SERVER_IP>:3000
```

## 7. systemd Deployment

Copy and edit the service template:

```bash
sudo cp deploy/teachingroom.service /etc/systemd/system/teachingroom.service
sudo nano /etc/systemd/system/teachingroom.service
```

Replace:

```text
<DEPLOY_USER>
<APP_DIR>
<CHANGE_ME_LONG_RANDOM_SECRET>
```

Start and enable on boot:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teachingroom.service
sudo systemctl status teachingroom.service --no-pager
```

View logs:

```bash
journalctl -u teachingroom.service -n 100 --no-pager
```

Restart:

```bash
sudo systemctl restart teachingroom.service
```

## 8. Docker Compose Deployment

Start:

```bash
export SESSION_SECRET="$(openssl rand -hex 48)"
docker compose up -d --build
```

Check status:

```bash
docker compose ps
```

View logs:

```bash
docker compose logs -f
```

Stop:

```bash
docker compose down
```

## 9. Environment Variables

```text
PORT=3000
DB_PATH=<APP_DIR>/data/teachingroom.sqlite
SESSION_SECRET=<CHANGE_ME_LONG_RANDOM_SECRET>
INITIAL_ADMIN_PASSWORD=<OPTIONAL_FIRST_RUN_PASSWORD_AT_LEAST_12_CHARACTERS>
BASE_DATA_API_TOKEN=<OPTIONAL_FIXED_TOKEN>
BASE_DATA_CORS_ORIGIN=<OPTIONAL_COMMA_SEPARATED_ALLOWLIST>
AUTO_BACKUP_KEEP=200
BACKUP_MIRROR_DIR=<OPTIONAL_SECOND_BACKUP_DIRECTORY>
```

Notes:

- Web service port, default `3000`.
- SQLite database path.
- Secret used to sign login sessions.
- Optional first administrator password, at least 12 characters; otherwise generated randomly.
- Optional fixed token for the read-only open API.
- Comma-separated CORS allowlist; cross-origin access is disabled by default.
- Maximum automatic backup count, default 200.
- Optional mirror directory on a second disk or mounted network location.

## 10. Data Backup

The app automatically maintains database backups:

```text
backups/
```

Backup filename format:

```text
teachingroom-YYYYMMDD-HHMMSS-<type>.sqlite
```

Types:

```text
auto            automatic backup
manual          manual backup
before_restore  backup before restore
```

Super administrators can:

- Create a backup now
- Download a backup
- Enable a backup
- Upload and enable a database file

Backups are not pruned by age. Automatic backups remove the oldest files only after reaching the count limit; manual and pre-restore backups remain until an administrator removes them outside the app. Configure `BACKUP_MIRROR_DIR` and periodically validate that mirrored SQLite files can be opened.

Before restore, the app validates SQLite integrity, required tables, and the `admin` super administrator account.

After restore, all login sessions contained in the backup are cleared so stale sessions cannot be resurrected; every user must sign in again.

## 11. Excel Workflow

Export:

```text
Export Excel
```

Upload:

```text
Upload Excel
```

After upload, the app will:

1. Parse the workbook.
2. Match classroom rows.
3. Compare against current official data.
4. Create pending review requests.
5. Not overwrite official data directly.

Exported workbooks contain a hidden `字段定义` worksheet that preserves field keys and labels. Keep this sheet so future fields and inspection notes can be mapped correctly when the workbook is uploaded again.

## 12. User Management

The entry is in the top-right area and is visible only to the super administrator `admin`.

Supports:

- Create users
- Update display names
- Update roles
- Enable or disable accounts
- Reset passwords
- Delete users
- View submitted and reviewed counts

User deletion is soft deletion; historical records are retained.

The `History` button on each classroom is visible to every signed-in user and shows effective field, photo, creation, and rollback events. Approved legacy requests are backfilled during upgrade; an enablement snapshot provides the baseline where older logs cannot reconstruct every earlier detail.

## 13. Audit Logs And Rollback

Super administrators can view:

- Login and logout
- Excel export
- Excel upload
- Change submission
- Approval and rejection
- Photo upload and deletion requests
- User creation, update, and deletion
- Database backup and restore

For approved official-data records:

- Undo this change, creation, or photo operation
- Restore to before this record

Rollback affects classroom base data only and follows field, classroom-creation, and photo events in audit order. It does not roll back users, sessions, field definitions, or backup files. Old events without complete inverse data are blocked and require a database backup restore.

## 14. Base Data API

Get token:

```bash
cat data/base-data-api-token.txt
```

Request example:

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

Tokens are accepted only in `X-API-Token` or `Authorization: Bearer` headers. The API returns only explicitly published fields, and cross-origin access is disabled unless allowed through `BASE_DATA_CORS_ORIGIN`.

Endpoints:

```text
GET /api/open/meta
GET /api/open/fields
GET /api/open/summary
GET /api/open/classrooms
GET /api/open/classrooms/:id
```

## 15. Troubleshooting

Port in use:

```bash
PORT=3001 npm start
```

Other devices cannot access:

1. Confirm the service is running.
2. Confirm the firewall allows the port.
3. Confirm devices are on the same LAN.
4. Use the server IP, not `localhost` on the phone.

Open API returns 401:

```bash
curl -H "X-API-Token: $TOKEN" http://<SERVER_IP>:3000/api/open/classrooms
```

## 16. Maintenance Recommendations

1. Change the administrator password after first login and confirm that `data/initial-admin-password.txt` has been deleted.
2. Regularly download database backups to local or external storage.
3. Do not expose `base-data-api-token.txt`.
4. After Excel upload, review pending changes before bulk approval.
5. Before adding a field, confirm name, type, and export requirements.
