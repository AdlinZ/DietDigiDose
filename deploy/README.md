# Staging 部署与演练

该目录提供独立 HTTPS staging 的可复现部署基线：Caddy 自动签发 TLS 并提供产品官网与管理端静态页面、PostgreSQL 16 持久卷、一次性 Drizzle migration、独立 API/worker，以及不会保留烟测账号的核心闭环验证。

## 部署

1. 将 staging 域名的 DNS 指向 Linux 主机，开放 TCP 80/443 与 UDP 443。
2. 在本目录复制 `.env.example` 为 `.env`，复制 `server.env.example` 为 `server.env`，填写真实密钥、官网“打开 App”链接和允许的前端域名；这两个文件均被 Git 忽略。
   `DATABASE_MIGRATION_URL` 与应用 `DATABASE_URL` 应使用不同账号；应用账号不应拥有 schema/role 管理权限。若 staging 使用 `DEPLOYMENT_PROFILE=global`，同时在独立 Supabase 项目中创建 public `community-media` bucket，填写 URL、anon key 与仅服务端可见的 service-role key；社区新图片只保存对象 URL。正式迁移前先核验 bucket 的上传、读取与删除策略。
3. 执行：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy up -d --build
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy ps
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy logs migrate
   ```

4. 执行核心闭环烟测：

   ```bash
   STAGING_BASE_URL=https://staging-api.example.com node deploy/staging-smoke.mjs
   ```

   如果服务器使用 Nginx 而非 Caddy，可从 `deploy/nginx.staging.conf.example` 创建站点配置。必须将 `/api/`、`/media/` 和 `/share/` 都反向代理到 API；其中 `/share/` 是动态分享承接页，不能交给管理端 SPA 的 `try_files`。

5. 先盘点、再迁移旧版内联社区图片；脚本使用与 API 相同的 `DATABASE_DRIVER`/`DATABASE_URL`，对象名由内容摘要确定，失败后可安全重跑。`--apply` 前先备份数据库并验证 bucket：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec api node dist/migrate-community-media.js
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec api node dist/migrate-community-media.js --apply
   ```

6. `worker` 与 API 为独立进程。查看最近任务批次或手动触发单项任务：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy logs worker
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec worker node dist/worker.js --once --task=media-cleanup
   ```

## 备份与隔离恢复

使用 PostgreSQL custom archive 在线备份到宿主机的权限受限目录；不要把备份写入 Git 工作区或公开对象存储。

```bash
mkdir -p /secure-backups/dietdigidose
docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec -T postgres \
  pg_dump --username=dietdigidose --dbname=dietdigidose --format=custom --no-owner --no-acl \
  > /secure-backups/dietdigidose/staging.dump
sha256sum /secure-backups/dietdigidose/staging.dump
docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec -T postgres \
  psql --username=dietdigidose --dbname=dietdigidose --tuples-only --command \
  "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM inventory_items; SELECT COUNT(*) FROM schema_migrations;"
```

恢复演练必须使用独立 PostgreSQL 实例或独立 compose project/volume。先对空目标应用同一提交的 Drizzle migrations，再以 `pg_restore --clean --if-exists --no-owner --no-acl` 恢复；随后启动隔离 API，验证 health 中 `databaseDriver=postgresql`、登录、库存读取、管理统计、媒体引用、关键表行数和用户隔离。记录 archive SHA-256、源/目标 PostgreSQL 版本、候选 SHA、负责人、RPO/RTO 和回滚结果。生产恢复前停止 API 与 worker，并保留目标恢复前快照。

旧版 SQLite 文件的最终迁移与回滚步骤仍见 [`docs/postgresql-migration.md`](../docs/postgresql-migration.md)；`database-backup.js` 只用于该旧版迁移窗口，不是 PostgreSQL 日常备份工具。
