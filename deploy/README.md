# Staging 部署与演练

该目录提供独立 HTTPS staging 的可复现部署基线：Caddy 自动签发 TLS、API 健康检查、持久化 SQLite volume，以及不会保留烟测账号的核心闭环验证。

## 部署

1. 将 staging 域名的 DNS 指向 Linux 主机，开放 TCP 80/443 与 UDP 443。
2. 在本目录复制 `.env.example` 为 `.env`，复制 `server.env.example` 为 `server.env`，填写真实密钥和允许的前端域名；这两个文件均被 Git 忽略。
   同时在独立 Supabase 项目中创建 public `community-media` bucket，填写 URL、anon key 与仅服务端可见的 service-role key；社区新图片只保存对象 URL。正式迁移前先核验 bucket 的上传、读取与删除策略。
3. 执行：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy up -d --build
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy ps
   ```

4. 执行核心闭环烟测：

   ```bash
   STAGING_BASE_URL=https://staging-api.example.com node deploy/staging-smoke.mjs
   ```

   如果服务器使用 Nginx 而非 Caddy，可从 `deploy/nginx.staging.conf.example` 创建站点配置。必须将 `/api/`、`/media/` 和 `/share/` 都反向代理到 API；其中 `/share/` 是动态分享承接页，不能交给管理端 SPA 的 `try_files`。

5. 先盘点、再迁移旧版内联社区图片；`--apply` 前先备份数据库并验证 bucket：

   ```bash
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec api node dist/migrate-community-media.js
   docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec api node dist/migrate-community-media.js --apply
   ```

## 备份与隔离恢复

先在线备份，再把备份复制到临时 volume 中启动隔离 API；不要覆盖正在服务的数据库。

```bash
docker compose -f deploy/docker-compose.staging.yml --project-directory deploy exec api \
  node dist/database-backup.js backup /data/backups/staging.db
docker compose -f deploy/docker-compose.staging.yml --project-directory deploy cp \
  api:/data/backups/staging.db ./staging-backup.db
```

恢复演练应在独立 compose project/volume 上进行，并记录开始时间、恢复完成时间、健康检查、登录、库存读取、管理统计和回滚结果。生产恢复前必须停止 API；恢复脚本会先保留 `.before-restore-*` 安全副本。
