# 教室设备管理系统

[English](./README.en.md)

教室设备管理系统是一个轻量级 Web 系统，用于把教室设备 Excel 台账转成可持续维护、可审核、可备份的数据管理工具。

仓库附带 `初始化数据表格（虚拟）.xlsx`，用于演示首次初始化。该文件只包含虚构数据；系统支持教室台账、巡查更新、审核流程、Excel 导入导出、操作记录、数据回滚、数据库备份，以及面向其他部门的只读基础数据接口。

本系统面向校内小团队使用，预计用户规模约 10 人，因此技术栈保持简单：Node.js、Express、SQLite 和原生前端页面。

## 文档导航

- [精简部署指南](./DEPLOYMENT.md)
- [完整部署与运维手册](./docs/DEPLOYMENT.md)
- [开发说明](./DEVELOPMENT.md)
- [更新日志](./docs/CHANGELOG.md)
- [项目工作记录](./docs/WORK_LOG_2026-05-18.md)
- [版本与上传记录](./TIMESTAMP_LOG.md)
- [全部文档](./docs/README.md)

## 功能

- 首次启动时从虚构 Excel 模板自动导入演示数据。
- 支持桌面表格视图，以及手机、平板卡片视图。
- 支持按楼栋、级部、更新计划、待审核状态和关键字快速筛选。
- 支持超级管理员、管理员、巡查员三类角色。
- 巡查员和管理员提交的数据变更会进入审核流程。
- 除超级管理员外，新增教室、字段变更、照片上传和照片删除均需其他管理员交叉审核。
- 管理员对字段级新旧值进行审核后，正式数据才会更新。
- 每间教室提供独立配置历史，按北京时间展示字段旧值/新值、提交人、审核人、来源、说明、照片和回滚记录。
- 用户管理和操作记录仅超级管理员可见。
- 支持撤销单次已审核修改，以及跨字段、教室新增和照片操作还原到某条记录之前。
- 支持按当前筛选结果导出 Excel。
- Excel 上传不会直接覆盖正式数据，而是生成待审核变更。
- 登录 session 保存到 SQLite。
- 弱网提交会进入浏览器持久队列，并通过幂等请求自动补交。
- 支持自动备份、手动备份、下载备份、上传备份和启用备份。
- 提供只读基础数据 API，便于其他部门或内部系统接入。

## 快速开始

```bash
npm install
npm test
npm start
```

打开：

```text
http://localhost:3000/
```

首次管理员账号：

```text
超级管理员用户名：admin
密码：优先使用 INITIAL_ADMIN_PASSWORD；未设置时写入 data/initial-admin-password.txt
```

系统不创建固定密码，也不自动创建巡查员。首次登录后请立即修改管理员密码；随机生成的临时密码文件会在改密成功后删除。巡查员和普通管理员可在用户管理页面创建。

## 默认运行参数

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

首次运行会创建 `data/teachingroom.sqlite`。如果数据库为空，系统会从以下 Excel 文件导入教室数据：

```text
初始化数据表格（虚拟）.xlsx
```

该文件中的楼栋、门牌号、班级、部门、设备和备注均为虚构示例。正式使用前请替换或删除这些记录。

## 数据和备份

运行数据不会提交到 Git：

```text
data/*.sqlite
data/base-data-api-token.txt
data/session-secret.txt
data/initial-admin-password.txt
backups/
uploads/
exports/
```

系统会在以下目录创建每日自动备份：

```text
backups/
```

超级管理员也可以在页面中手动创建、下载、上传并启用数据库备份。

备份不按天数清理。自动备份默认保留最新 200 份；手动备份和恢复前备份永久保留，需由管理员在系统外按制度归档或删除。可设置 `BACKUP_MIRROR_DIR` 将备份同步到第二块磁盘或网络目录。

## 基础数据 API

系统会生成只读 API 令牌文件：

```text
data/base-data-api-token.txt
```

示例：

```bash
TOKEN="$(cat data/base-data-api-token.txt)"
curl -H "X-API-Token: $TOKEN" http://localhost:3000/api/open/classrooms
```

令牌只能通过 `X-API-Token` 或 `Authorization: Bearer` 传递，不接受 URL 查询参数。接口仅返回明确标记为可发布的字段；未配置来源白名单时不启用跨域。

接口：

```text
GET /api/open/meta
GET /api/open/fields
GET /api/open/summary
GET /api/open/classrooms
GET /api/open/classrooms/:id
```

常用筛选参数：

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

## 部署

仓库提供 systemd 服务模板：

```text
deploy/teachingroom.service
```

部署和维护说明见 [DEPLOYMENT.md](./DEPLOYMENT.md) 和 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)。

## 开发

架构、开发流程和仓库规范见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

## 版本和上传记录

GitHub 上传、仓库地址、提交 ID 和交接记录见 [TIMESTAMP_LOG.md](./TIMESTAMP_LOG.md)。
