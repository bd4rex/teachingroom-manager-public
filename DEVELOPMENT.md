# 开发说明

[English](./DEVELOPMENT.en.md)

本文说明教室设备管理系统的架构、数据模型、前端行为和维护流程。

## 目标

本项目提供一个面向校内使用的小型教室设备数据管理系统。

它不是简单替代 Excel，而是把直接改表格改为可审核、可导入导出、可追溯、可回滚、可备份的数据管理流程。

## 技术栈

- Node.js 20 或更高版本
- Express 5
- 通过 `better-sqlite3` 使用 SQLite
- 使用 ExcelJS 处理 Excel 导入导出
- Express session，session 数据保存到 SQLite
- 原生 HTML、CSS、JavaScript

## 目录结构

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

运行目录不进入 Git：

```text
data/
backups/
uploads/
exports/
output/
node_modules/
```

## 后端

`src/server.js` 负责：

- 提供 `public/` 静态文件。
- 登录和 session 接口。
- 教室列表和筛选。
- 变更申请提交。
- 管理员审核流程。
- 超级管理员用户管理。
- 操作记录查询和筛选。
- 单条撤销和按记录整体还原。
- Excel 导出。
- Excel 上传生成待审核变更。
- 只读开放 API。
- 数据库备份、下载、上传和恢复。

`src/database.js` 负责：

- SQLite 连接。
- 数据表初始化。
- 默认字段定义。
- 默认用户。
- 操作记录写入。
- 教室字段值写入。

`src/excel.js` 负责：

- 首次运行导入源 Excel。
- 解析上传的 Excel。
- 生成导出 Excel。

## 数据模型

核心数据表：

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

教室字段以 key/value 形式保存，因此新增字段时不需要修改 `classrooms` 主表结构。

`classroom_history` 是按教室组织的不可变生效历史。每条事件保存教室、发生时间、来源、提交人、审核人、变更说明、审核意见和字段级旧值/新值。系统升级时会从已审核申请和照片申请回填旧记录，并为现有教室生成一次启用快照；后续新增、审核、照片和回滚会在正式数据事务中同步写入。

## 角色

- 超级管理员：固定用户名 `admin`，可管理用户、操作记录、回滚和数据库备份。
- 管理员：可审核教室数据变更。
- 巡查员：可查看数据并提交变更申请。

系统中 `role=admin` 表示具备数据审核权限；超级管理员权限由用户名 `admin` 判断。

## 变更流程

1. 用户提交某间教室的字段级变更。
2. 系统写入 `change_requests` 和 `change_request_items`，保存旧值和新值。
3. 管理员审核变更申请。
4. 审核通过后写入 `classroom_values` 正式数据。
5. 审核拒绝的变更保留历史记录。
6. 操作记录保留完整流程。
7. 审核通过后同时写入该教室的配置历史。

除超级管理员外的正式数据变更均执行交叉审核。提交人不能审核自己的新增教室、字段变更、照片上传或照片删除；待审核请求通过 `clientRequestId` 保证幂等，审核通过前还会校验正式旧值是否已变化。

## 回滚

回滚仅超级管理员可用。

- 单条撤销会反向处理某一次已审核通过的修改。
- 整体还原会按操作记录逆序处理选中记录及之后受支持的字段、教室新增和照片变更。

回滚只影响教室基础数据，不回滚用户、session、字段定义或备份文件。旧版本记录若缺少完整逆向数据，系统会阻止不完整回滚，并提示超级管理员改用数据库备份。

## 备份

备份以 SQLite 文件形式保存在 `backups/` 目录。

备份类型：

```text
auto
manual
before_restore
```

恢复前系统会校验：

- SQLite 完整性。
- 必要数据表。
- 是否存在 `admin` 超级管理员。

## 前端

`public/app.js` 只使用浏览器原生 API。

页面包括：

- 桌面表格视图。
- 手机卡片视图。
- 变更提交弹窗。
- 审核面板。
- 用户管理弹窗。
- 操作记录弹窗。
- 数据库备份弹窗。

时间以 UTC 风格 SQLite 字符串保存，浏览器端按 `Asia/Shanghai` 显示。

弱网下的教室变更、新增教室、照片上传和照片删除会进入 IndexedDB 持久队列。审核、回滚、用户管理和数据库恢复不会排队，避免延迟执行造成错误授权或状态覆盖。

## 开发流程

```bash
npm install
npm test
npm start
```

打开：

```text
http://localhost:3000/
```

## 提交前检查

```bash
npm audit
npm test
git status --short
```

手动浏览器检查：

- 使用 `admin` 登录。
- 打开操作记录。
- 打开数据库备份。
- 创建一次备份。
- 导出 Excel。
- 检查约 `375px` 手机宽度。

## 仓库规范

- 不提交真实部署 IP、用户名、密码、密钥、token 和本地路径。
- 运行数据不进入 Git。
- 只提交源码、静态资源、文档、部署模板和种子 Excel。
- GitHub 上传和交接信息记录到 `TIMESTAMP_LOG.md`。
