# Staging 与生产运维手册

> 更新于 2026-08-06。当前系统的实际主数据源是 SQLite，适合单实例封闭 Beta。完成 [开发 TODO](../TODO.md) 中的发布阻断项之前，本手册是部署目标和演练步骤，不代表仓库已经具备公开生产能力。

## 当前部署边界

- server 只运行一个会写入数据库的实例，不做水平扩容；多实例共享同一个 SQLite 文件不在当前支持范围内。
- 显式设置 `DATABASE_PATH` 到持久化磁盘，不能依赖容器临时文件系统。数据库、备份和上传媒体都视为用户数据。
- staging 与 production 使用不同数据库、JWT、管理员密码、AI 密钥、域名和备份目录，禁止复制真实生产健康数据到 staging。
- 演示用户、社区内容和高互动数据仅在 `ENABLE_DEMO_SEED=1` 时生成；staging 与 production 必须保持为 `0`。
- SQLite 是否需要迁移到 Postgres，以实测并发、备份窗口和部署需求决定，不因“准备上线”提前迁移。

## 环境与网络

以 `server/.env.example` 为字段清单，并至少确认：

- `NODE_ENV=production`
- `DATABASE_PATH` 指向持久化、权限受限的绝对路径
- `JWT_SECRET` 为随机且不少于 32 个字符的独立密钥
- `ADMIN_INITIAL_PASSWORD` 不少于 12 位，只用于首次创建管理员；首次登录后立即修改
- `CORS_ORIGINS` 只列出 App Web 端和管理后台的 HTTPS Origin，不使用通配符
- TLS 在可信反向代理终止时设置 `TRUST_PROXY=1`、`REQUIRE_HTTPS=1`，并由代理覆盖写入 `X-Forwarded-Proto`
- `ERROR_MONITOR_WEBHOOK_URL` 指向受控监控接收端
- `SUPABASE_MEDIA_BUCKET` 指向 staging 独立的 public 社区媒体 bucket，service-role key 只进入服务端密钥存储；未配置时图片发布应明确失败

外部内测客户端必须使用 HTTPS staging。发布候选包不得包含 HTTP 后端地址、`EXPO_PUBLIC_ALLOW_INSECURE_HTTP=1`、iOS 任意网络加载或 Android cleartext 放行。先从外部网络调用 `/api/v1/health`，再验证客户端连接；不要只在服务器本机测试。

## 敏感数据与 AI

- AI 密钥只保存在服务端环境变量或受控管理设置中，绝不放入 `EXPO_PUBLIC_` 变量。
- 当前 AI 流程会处理健康档案、过敏/用药上下文并保存完整用户与助手消息。外部内测前必须让隐私政策、首次告知、供应商说明、保留期限、管理员权限和删除流程与实际行为一致。
- 日志和核心漏斗不记录登录凭据、Token、完整 AI 文本或不必要的健康字段。使用匿名用户标识和 requestId 定位问题。
- 管理员读取用户对话属于高敏感操作，应最小授权、记录审计，并能够响应导出和删除请求。

## 全新数据库与迁移验收

每个候选版本都要同时验证“空库初始化”和“旧库升级”，不能只在开发者现有数据库上启动成功：

1. 在隔离环境把 `DATABASE_PATH` 指向新的空路径并启动 server。
2. 验证健康检查、注册、登录、库存和饮食记录。
3. 提交一条自定义食物，使用管理员完成审核，再打开管理统计。
4. 确认 `user_custom_foods.status` 等所有业务代码依赖的字段由版本化迁移创建。
5. 复制脱敏的上一版本数据库，在隔离环境启动新版本并重复核心读取、写入与管理统计。
6. 保留迁移日志、提交 SHA、数据库版本和执行结果；任何失败都阻断候选发布。

仓库已包含 `user_custom_foods.status` 的 v16 迁移和空库自动化检查；候选发布仍需按上述步骤在实际 staging 完成投稿、审核和统计验收。

## SQLite 备份

服务运行期间使用 SQLite 在线备份 API，并始终显式传入安全目标路径：

```bash
pnpm --dir server db:backup /secure-backups/dietdigidose.db
```

不带目标参数时会写入已被 Git 忽略的 `server/backups/`；候选和生产仍应显式使用权限受限、独立于应用工作目录的备份位置。备份应加密、限制访问、每天执行并异地保留至少 30 天。备份文件含用户及健康数据，不得进入 Git、构建产物或公开对象存储。

每次备份记录时间、版本、文件大小、校验值和保存位置。只有实际恢复并通过验证的备份才算可用。

## SQLite 恢复与回滚

1. 停止所有 server 实例，确认没有进程继续写入数据库。
2. 校验备份来源、大小、权限、校验值和可用磁盘空间。
3. 执行恢复；命令会先把现有数据库复制为带时间戳的安全副本。

```bash
pnpm --dir server db:restore /secure-backups/dietdigidose.db --force
```

4. 启动与该数据版本兼容的 server。迁移会在启动时运行，但仍需按上一节验证目标 schema，不能假设迁移一定完整。
5. 调用 `/api/v1/health`，再依次验证登录、库存读取、写入、管理统计和媒体访问。
6. 记录恢复耗时和数据时间点。若验证失败，停止写入，恢复命令生成的安全副本或上一份已验证备份，并回滚应用版本。

至少在首次外部内测前、每次 schema 变更后和公开发布前完成一次隔离恢复演练。

## 后台 worker

通知投递与媒体清理不随 API 进程启动。部署必须独立运行 `node dist/worker.js`；staging Compose 已包含共享同一持久化数据库的 `worker` 服务。API 与 worker 可以独立重启，worker 故障不会改变 API 健康状态。

worker 默认启动后立即执行一次，之后每小时执行；可用 `WORKER_INTERVAL_MS`、`WORKER_TASK_TIMEOUT_MS`、`WORKER_LEASE_MS` 和 `MEDIA_CLEANUP_BATCH_SIZE` 调整。SQLite lease 防止多 worker 同时领取同一类任务，通知的投递预留和媒体清理 job claim 继续提供业务幂等保护。

手动重跑全部任务或单项任务：

```bash
pnpm --dir server worker:run
pnpm --dir server worker:run -- --task=notifications
pnpm --dir server worker:run -- --task=media-cleanup
```

每批执行会写入 `worker_task_runs`，包含开始/结束时间、耗时、处理量、成功量、失败量和脱敏错误；管理员可用 `GET /api/v1/admin/worker-runs` 按 `task`、`status` 分页查看批次和当前 lease，`worker.task.*` 单行 JSON 日志可交给日志平台查询。失败会发送到 `ERROR_MONITOR_WEBHOOK_URL`，未完成媒体清理保持 `pending`，下一批自动重试。若 worker 异常退出，等待 `WORKER_LEASE_MS` 到期后再手动重跑；不要直接删除 `worker_task_leases`，除非已确认旧进程停止且记录了处置原因。

## 候选发布检查

记录提交 SHA、client/server/admin 版本、数据库版本、构建号、后端域名和备份编号，然后执行：

```bash
node --version  # 必须为 v22.23.2
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm -w validate:toolchain
pnpm install --frozen-lockfile
pnpm -w lint:all
pnpm -w test:all
pnpm -w build:client
pnpm -w build:server
pnpm -w build:admin
pnpm -w audit:prod
```

随后完成：

- 空库初始化、旧库升级和备份恢复三类演练；
- iOS/Android 同一提交候选包的全新安装、升级安装和核心闭环；
- HTTPS、CORS、401、限流、权限拒绝、弱网、AI 超时和服务端重启恢复；
- 普通用户越权、公开身份泄露、AI 数据告知与账号删除检查；
- 管理员初始密码修改、错误监控通知和 requestId 检索；
- 明确回滚负责人、触发条件、上一稳定包与上一份已验证备份。

完整步骤见 [真机验收与小范围内测清单](device-beta-checklist.md)。P0 未清零、核心 P1 未回归、备份不可恢复或客户端仍允许明文传输时，停止发布。

## 监控与事件处置

服务端日志为单行 JSON，使用 requestId 串联请求与错误。配置 `ERROR_MONITOR_WEBHOOK_URL` 后，未捕获服务端错误会以 3 秒超时投递到监控端。AI 调用可记录模型、Token、耗时、估算费用和失败原因，但不得记录 API 密钥或完整敏感上下文。AI 单价通过 `AI_INPUT_COST_PER_MILLION_USD` 和 `AI_OUTPUT_COST_PER_MILLION_USD` 配置。

注册、登录、库存录入和完成烹饪会写入仅含 HMAC 匿名标识与事件名的漏斗事件，不附带登录标识、IP、食材、健康数据或 AI 文本。管理员可通过 `GET /api/v1/admin/funnel?days=30` 查看 1～90 天的聚合事件数与匿名用户数。

登录失败、邮箱注册、社区分享码、匿名外部食品查询与高成本 AI 请求的限流桶保存在主数据库中，不依赖单进程内存；共享同一数据库的服务实例会看到同一配额。默认 AI 与食品查询上限分别通过 `AI_RATE_LIMIT`、`FOOD_SEARCH_RATE_LIMIT` 配置，窗口均为 15 分钟。邮箱注册使用 `REGISTER_RATE_LIMIT`、`REGISTER_GLOBAL_RATE_LIMIT` 和 `REGISTER_RATE_LIMIT_WINDOW_MS`，社区分享使用 `COMMUNITY_SHARE_RATE_LIMIT` 与 `COMMUNITY_SHARE_RATE_LIMIT_WINDOW_MS`；生产环境启用 `TRUST_PROXY=1` 时，反向代理必须覆盖而不是透传客户端伪造的转发头。

发生疑似越权、公开登录标识、健康数据泄露、批量重复写入或数据库损坏时：停止新候选分发和相关写入，保存日志与时间线，轮换受影响密钥，评估受影响用户与数据范围，从已验证备份恢复，并在恢复服务前完成根因和回归检查。
