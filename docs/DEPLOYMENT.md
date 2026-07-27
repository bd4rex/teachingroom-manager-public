# 教室设备管理系统部署文档

[English](./DEPLOYMENT.en.md)

本文是完整的部署与运维手册。根目录 [DEPLOYMENT.md](../DEPLOYMENT.md) 是适合快速交付的精简部署指南。

## 1. 部署目标

本系统用于校内教室设备数据管理，适合部署在校内服务器、办公电脑、NAS 或小型 Ubuntu 主机上。

系统启动后，电脑、手机、平板只要能访问部署主机的 IP 和端口，即可通过浏览器使用。

默认访问地址：

```text
http://<SERVER_IP>:3000
```

## 2. 部署方式

推荐两种方式：

1. Node.js 直接运行，适合测试和小型长期部署。
2. Docker Compose 运行，适合容器化环境。

当前系统用户数量较少，Node.js + systemd 是最直接、可维护的部署方式。

## 3. 项目目录

示例部署目录：

```text
<APP_DIR>
```

关键文件：

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

## 4. 数据文件

SQLite 数据库：

```text
data/teachingroom.sqlite
```

SQLite 运行时可能同时出现：

```text
data/teachingroom.sqlite-shm
data/teachingroom.sqlite-wal
```

登录 session 也保存在同一个 SQLite 数据库中，表名为 `user_sessions`。

基础数据 API 令牌：

```text
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
```

首次启动时，如果数据库为空，系统会自动从以下文件导入数据：

```text
初始化数据表格（虚拟）.xlsx
```

该工作簿仅包含虚构示例数据。正式部署前应替换或删除虚构记录，不要把它当作真实教室台账。

## 5. 首次管理员账号

```text
超级管理员用户名：admin
密码：优先使用 INITIAL_ADMIN_PASSWORD；未设置时写入 data/initial-admin-password.txt
```

`INITIAL_ADMIN_PASSWORD` 至少需要 12 个字符。系统不创建固定密码，也不自动创建巡查员。首次登录后请立即修改管理员密码；随机生成的临时密码文件会自动删除。

权限说明：

- `admin` 是超级管理员，可以管理用户、操作记录、回滚和数据库备份。
- 普通管理员可以审核教室信息变更，但不能管理用户。
- 巡查员可以查看数据并提交变更申请。

## 6. Node.js 直接运行

安装依赖：

```bash
cd <APP_DIR>
npm ci --omit=dev
```

检查代码：

```bash
npm test
```

启动服务：

```bash
npm start
```

本机访问：

```text
http://localhost:3000
```

局域网访问：

```text
http://<SERVER_IP>:3000
```

## 7. systemd 部署

复制并编辑服务模板：

```bash
sudo cp deploy/teachingroom.service /etc/systemd/system/teachingroom.service
sudo nano /etc/systemd/system/teachingroom.service
```

需要替换：

```text
<DEPLOY_USER>
<APP_DIR>
<CHANGE_ME_LONG_RANDOM_SECRET>
```

启动并设置开机自启：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now teachingroom.service
sudo systemctl status teachingroom.service --no-pager
```

查看日志：

```bash
journalctl -u teachingroom.service -n 100 --no-pager
```

重启服务：

```bash
sudo systemctl restart teachingroom.service
```

## 8. Docker Compose 部署

启动：

```bash
export SESSION_SECRET="$(openssl rand -hex 48)"
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

停止服务：

```bash
docker compose down
```

## 9. 环境变量

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

说明：

- `PORT`：服务端口，默认 `3000`。
- `DB_PATH`：SQLite 数据库路径。
- `SESSION_SECRET`：登录 session 加密密钥。
- `INITIAL_ADMIN_PASSWORD`：可选首次管理员密码，至少 12 个字符；不设置则随机生成。
- `BASE_DATA_API_TOKEN`：可选固定开放 API 令牌。
- `BASE_DATA_CORS_ORIGIN`：允许跨域来源列表，默认不开放跨域。
- `AUTO_BACKUP_KEEP`：自动备份数量上限，默认 200。
- `BACKUP_MIRROR_DIR`：可选第二备份目录，可指向挂载磁盘或网络目录。

## 10. 数据备份

系统会自动维护数据库备份：

```text
backups/
```

备份文件命名格式：

```text
teachingroom-YYYYMMDD-HHMMSS-<类型>.sqlite
```

类型：

```text
auto            自动备份
manual          手动备份
before_restore  恢复前备份
```

超级管理员可以在页面中执行：

- 立即备份
- 下载备份
- 启用此备份
- 上传并启用

备份不按天数自动删除。自动备份超过数量上限后删除最旧文件；手动备份和恢复前备份永久保留，需由管理员在系统外归档或删除。建议设置 `BACKUP_MIRROR_DIR`，并定期抽查镜像目录中的 SQLite 文件可以打开。

恢复前系统会校验 SQLite 完整性、必要数据表和 `admin` 超级管理员账号。

恢复完成后系统会清空备份中携带的登录 session，所有用户需要重新登录，避免旧会话随数据库恢复而重新生效。

## 11. Excel 工作流

导出：

```text
导出 Excel
```

上传：

```text
上传 Excel
```

上传后系统会：

1. 解析 Excel。
2. 匹配教室。
3. 与当前正式数据比对。
4. 生成待审核变更。
5. 不直接覆盖正式数据。

导出的工作簿包含一个不可见的 `字段定义` 工作表，用于保存字段标识与显示名称。请保留该工作表，这样后续新增字段和巡查备注在 Excel 修改后仍可准确回传。

## 12. 用户管理

入口位于页面右上角，仅超级管理员 `admin` 可见。

支持：

- 新增用户
- 修改姓名
- 修改角色
- 启用或停用账号
- 重置密码
- 删除用户
- 查看提交和审核记录数量

删除用户采用软删除，历史记录保留。

每条教室记录的 `历史` 按钮对所有已登录用户可见，用于查看已经正式生效的字段、照片、新增和回滚记录。旧的已审核申请会在升级后自动回填；无法从旧日志还原的早期细节以启用快照作为基准。

## 13. 操作记录和回滚

超级管理员可以查看：

- 登录/退出
- Excel 导出
- Excel 上传
- 提交变更
- 审核通过/拒绝
- 照片上传/删除申请
- 用户新增/修改/删除
- 数据库备份和恢复

对已审核通过的正式数据记录可执行：

- 撤销此修改、新增或照片操作
- 还原到此记录之前

回滚只影响教室基础数据，不回滚用户、session、字段定义或备份文件。

## 14. 基础数据 API

获取令牌：

```bash
cat data/base-data-api-token.txt
```

请求示例：

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

令牌只能放在 `X-API-Token` 或 `Authorization: Bearer` 请求头中。开放 API 只返回显式发布字段；跨域访问默认关闭，需要通过 `BASE_DATA_CORS_ORIGIN` 配置明确来源。

接口：

```text
GET /api/open/meta
GET /api/open/fields
GET /api/open/summary
GET /api/open/classrooms
GET /api/open/classrooms/:id
```

## 15. 常见问题

端口被占用：

```bash
PORT=3001 npm start
```

其他设备无法访问：

1. 确认服务已启动。
2. 确认防火墙允许端口。
3. 确认设备在同一局域网。
4. 使用服务器 IP，不要使用手机上的 `localhost`。

开放 API 返回 401：

```bash
curl -H "X-API-Token: $TOKEN" http://<SERVER_IP>:3000/api/open/classrooms
```

## 16. 维护建议

1. 首次登录后立即修改管理员密码，并确认 `data/initial-admin-password.txt` 已删除。
2. 定期下载数据库备份到本地或其他备份介质。
3. 不要公开 `base-data-api-token.txt`。
4. Excel 上传后先检查审核列表，再批量通过。
5. 新增字段前先确认字段名称、类型、是否需要导出。
