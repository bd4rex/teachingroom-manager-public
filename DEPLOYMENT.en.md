# Deployment Guide

[中文](./DEPLOYMENT.md)

This concise guide is intended for quick handoff. See the [complete deployment and operations manual](./docs/DEPLOYMENT.en.md) for detailed deployment, operations, Excel, user, audit, and rollback guidance.

This guide explains how to deploy TeachingRoom Manager on an internal Linux server.

Organization-specific addresses, usernames, secrets, and paths are represented as placeholders.

## Placeholders

| Placeholder | Meaning |
| --- | --- |
| `<SERVER_IP>` | Server address users open in the browser |
| `<SERVER_NAME>` | Optional DNS name, such as `classrooms.example.edu` |
| `<DEPLOY_USER>` | Linux account that runs the service |
| `<APP_DIR>` | Application directory, such as `/opt/teachingroom` |
| `<CHANGE_ME_LONG_RANDOM_SECRET>` | Long random session secret |

## Requirements

- Linux server.
- Node.js 20 or later. Node.js 22+ is recommended.
- TCP access to the selected web port.
- SQLite runtime support through `better-sqlite3`.

Check Node.js:

```bash
node -v
npm -v
```

## Runtime Parameters

The service is configured with environment variables:

```ini
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=<APP_DIR>/data
Environment=DB_PATH=<APP_DIR>/data/teachingroom.sqlite
Environment=SESSION_SECRET=<CHANGE_ME_LONG_RANDOM_SECRET>
Environment=INITIAL_ADMIN_PASSWORD=<OPTIONAL_FIRST_RUN_PASSWORD_AT_LEAST_12_CHARACTERS>
Environment=AUTO_BACKUP_KEEP=200
```

Optional:

```text
BASE_DATA_API_TOKEN=<fixed token for open API>
BASE_DATA_CORS_ORIGIN=<comma-separated allowed origins; disabled by default>
BACKUP_MIRROR_DIR=<optional second disk or mounted network directory>
```

## Manual Run

Copy or clone the repository to `<APP_DIR>`:

```bash
cd <APP_DIR>
npm ci --omit=dev
npm test
npm start
```

Open:

```text
http://<SERVER_IP>:3000/
```

Check health:

```bash
curl http://127.0.0.1:3000/api/health
```

## systemd Deployment

Edit the included unit file:

```text
deploy/teachingroom.service
```

Replace:

```ini
User=<DEPLOY_USER>
Group=<DEPLOY_USER>
WorkingDirectory=<APP_DIR>
Environment=DB_PATH=<APP_DIR>/data/teachingroom.sqlite
Environment=SESSION_SECRET=<CHANGE_ME_LONG_RANDOM_SECRET>
Environment=AUTO_BACKUP_KEEP=200
```

Install and start:

```bash
sudo cp deploy/teachingroom.service /etc/systemd/system/teachingroom.service
sudo systemctl daemon-reload
sudo systemctl enable --now teachingroom.service
sudo systemctl status teachingroom.service --no-pager
```

Logs:

```bash
journalctl -u teachingroom.service -n 100 --no-pager
```

Restart after updates:

```bash
sudo systemctl restart teachingroom.service
systemctl is-active teachingroom.service
```

## Docker Compose

```bash
export SESSION_SECRET="$(openssl rand -hex 48)"
docker compose up -d --build
docker compose ps
docker compose logs -f
```

The Compose file persists runtime data through local directories:

```text
data/
exports/
```

For production, set a strong `SESSION_SECRET` before starting.

## Data Files

Runtime files are not committed:

```text
data/teachingroom.sqlite
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
backups/
uploads/
exports/
```

The repository contains this synthetic seed workbook:

```text
初始化数据表格（虚拟）.xlsx
```

On first startup, if the SQLite database is empty, the app imports the workbook data. Every record is fictional and must be replaced or removed before production use.

## Backup And Restore

The app creates daily automatic database backups under:

```text
backups/
```

Super administrators can use the web UI to:

- Create a manual backup.
- Download a backup to a local computer.
- Restore a server-side backup.
- Upload and enable a SQLite database file.

Before enabling any backup or upload, the app validates SQLite integrity and required tables. It also creates a `before_restore` backup of the current database.

All login sessions contained in the restored database are cleared, so every user must sign in again after a restore.

Backups are not removed by age. Automatic backups retain the newest `AUTO_BACKUP_KEEP` files; manual and `before_restore` backups remain until an administrator removes them outside the app. For off-host resilience, mount a second disk or network directory and set `BACKUP_MIRROR_DIR`.

## Open API

Read-only base-data API calls require:

```text
X-API-Token: <TOKEN>
```

Do not place the token in a URL. Query-string tokens are rejected. Configure `BASE_DATA_CORS_ORIGIN` only for known consumer origins, separated by commas.

Get the generated token from:

```bash
cat data/base-data-api-token.txt
```

Example:

```bash
curl -H "X-API-Token: <TOKEN>" http://<SERVER_IP>:3000/api/open/classrooms
```

## Validation Checklist

- `npm test` passes.
- `/api/health` returns `{ "ok": true }`.
- Login works with the expected administrator account.
- Each classroom history dialog shows old/new values, people, and Beijing time.
- Mobile layout is usable on a narrow viewport.
- Excel export downloads successfully.
- Database backup list shows at least one automatic backup.
- A non-super administrator cannot approve their own classroom, field, or photo request.
- A disabled, demoted, deleted, or password-reset user loses other active sessions immediately.
- Downloaded backup can be validated or restored in a test environment.

## Repository Hygiene

- Do not commit passwords, tokens, internal server IPs, or real deployment paths.
- Keep runtime data out of Git.
- Use placeholders such as `<SERVER_IP>`, `<APP_DIR>`, and `<DEPLOY_USER>`.
- Record upload and handoff events in `TIMESTAMP_LOG.en.md`.
