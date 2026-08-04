# 生产运维手册

## 环境与网络

- 复制 `server/.env.example`，设置随机且不少于 32 位的 `JWT_SECRET`、不少于 12 位的 `ADMIN_INITIAL_PASSWORD`，并只在首次创建管理员时使用后者。
- `CORS_ORIGINS` 只填写正式 App Web 端和管理后台的 HTTPS Origin，不使用通配符。
- TLS 在反向代理或负载均衡器终止时设置 `TRUST_PROXY=1`、`REQUIRE_HTTPS=1`，并确保代理覆盖写入 `X-Forwarded-Proto`，不要信任客户端传入值。
- 为 `ERROR_MONITOR_WEBHOOK_URL` 配置内部监控接收端。服务端日志为单行 JSON，可按 `requestId` 串联请求与错误。

## SQLite 备份

服务运行期间可使用 SQLite 在线备份 API：

```bash
pnpm --dir server db:backup
pnpm --dir server db:backup /secure-backups/dietdigidose.db
```

建议每天备份、异地加密保存至少 30 天，并定期在隔离环境做恢复演练。备份文件包含用户数据，不应进入 Git 或放在公开对象存储。

## SQLite 恢复

1. 停止所有 server 实例，确认没有进程继续写入数据库。
2. 校验备份文件来源、大小、权限和可用磁盘空间。
3. 执行恢复；命令会先把现有数据库复制为带时间戳的安全副本。

```bash
pnpm --dir server db:restore /secure-backups/dietdigidose.db --force
```

4. 启动 server。版本化迁移会自动补齐缺失 schema。
5. 调用 `/api/v1/health`，再验证登录、库存读取和管理后台统计。

## 发布检查

```bash
pnpm -w lint:all
pnpm -w test:all
pnpm -w build:client
pnpm -w build:server
pnpm -w build:admin
pnpm -w audit:prod
```

AI 单价可通过 `AI_INPUT_COST_PER_MILLION_USD` 和 `AI_OUTPUT_COST_PER_MILLION_USD` 配置。调用日志记录模型、Token、耗时、估算费用与失败原因，不记录 API 密钥。
