# 食光烙记（DietDigiDose）

> **2026-10-12 状态：** 当前为 W42（10 月 12–18 日）。Android `26w41a / 264101` 已构建，服务端 `fbd9b1a4` 已部署并通过备份恢复、迁移与 HTTPS 烟测，详见[服务端更新记录](docs/server-update-2026-10-11.md)。官网页面与素材改动随本分支同步，尚未部署。真实短信、APK 下载源配置与双端真机验收仍待完成；下方明确标注的旧记录保留作历史。

<p align="center">
  <img src="client/assets/logo.svg" alt="食光烙记 Logo" width="160" />
</p>

<p align="center">
  <strong>从家中现有食材出发，把“有什么”变成“下一顿吃什么”。</strong>
</p>

<p align="center">
  简体中文 · <a href="README.en.md">English</a>
</p>

食光烙记是一款面向个人与小家庭的开源饮食管理应用。它以家庭食材库存和临期提醒为起点，将菜谱匹配、采购、烹饪扣减与饮食记录串成一条可验证的日常闭环，并提供健康档案、社区内容和带安全边界的 AI 辅助能力。

> [!IMPORTANT]
> 移动客户端目前仍处于可信 Beta 收口阶段，尚未公开发布。营养估算与 AI 输出仅供日常参考，不能替代医疗诊断或治疗建议；内测期间也不应承载真实敏感健康数据。

## 核心体验

```text
录入家庭食材
  → 识别临期或可用食材
  → 匹配真正能做的菜谱
  → 完成烹饪并扣减库存
  → 自动形成饮食记录
```

围绕这条主线，仓库当前包含：

- 家庭食材库存、保质期、厨房用具与采购清单管理
- 基于库存、临期食材、过敏原和厨具条件的菜谱匹配
- 烹饪队列、步骤模式、幂等库存扣减与饮食记录
- 营养摄入、健康档案、提醒与趋势洞察
- 菜谱搜索、收藏、投稿、关注与社区内容
- AI 营养问答、食材/餐食识别、票据扫描和语音交互
- 用户、菜谱、社区、Agent 运行、AI 配置与安全审计管理后台

## 当前版本与完成度

- **当前周：** `26w42`（上海时区 ISO 第 42 周，2026-10-12～10-18）
- **仓库版本元数据：** `1.0.6` / `26w36a` / build `263601`（不是最新构建产物）
- **最近成功 Android 构建：** [`26w41a` / build `264101`](https://github.com/AdlinZ/DietDigiDose/actions/runs/38143602557)，源码 `f4ba92c3`
- **阶段：** 可信 Beta 收口
- **最近更新：** 2026-10-12

主分支 `f4ba92c3` 已合并 [PR #248](https://github.com/AdlinZ/DietDigiDose/pull/248)，包含营养来源、数据导入、依赖安全修复、手机恢复和 APK 更新实现。[main CI](https://github.com/AdlinZ/DietDigiDose/actions/runs/38143565538) 全部通过，`26w41a` 预览包已生成。此前分轮审阅及测试记录保留在 W41 文档；服务端已于 10 月 11 日更新，真实设备验收仍待完成。

10 月 11 日已将 W41 的 **20 项未完成 Issue** 结转至 [W42 里程碑](https://github.com/AdlinZ/DietDigiDose/milestone/12)（10 月 12–18 日），W41 按周归档。范围包括：W40 结转 18 项，10 月 7 日新增 [#221 自助找回密码](https://github.com/AdlinZ/DietDigiDose/issues/221) 和 [#219 应用内更新](https://github.com/AdlinZ/DietDigiDose/issues/219)。两项代码已合并并随 41a 打包，服务端已更新，仍待真实短信与 Android 真机验收；Android 更新模块原生编译已通过。恢复一期支持已验证绑定手机，不支持邮箱；更新一期为完整 APK，OTA 留待二期，详见[实现与验收记录](docs/w41-account-recovery-and-app-updates.md)。Backlog 剩余 21 项待排期。[W40](https://github.com/AdlinZ/DietDigiDose/milestone/10) 保留 4 项已关闭 Issue 作为历史记录。官网、管理端、API、PostgreSQL 与 workers 已有公网运行记录，最新服务端部署为 `w41-fbd9b1a4`（10 月 11 日），官网与 App 网页保持原版本。独立环境与持久化验收、同候选完整恢复演练、同提交双端候选与真机闭环（#105、#106、#107）仍是三项 P0 门槛；排期不代表验收通过或承诺本周完成全部 20 项。

当前打包检查与下周安排见 [W42 进度与执行计划](docs/milestone-26w42-progress.md)、[开发与 Beta 收口清单](TODO.md) 与 [真机验收清单](docs/device-beta-checklist.md)。[W40 历史验收记录](docs/milestone-26w40-progress.md) 和 [历史候选验收记录](docs/release-candidate-26w37a.md) 保留既有证据及当时的版本号；仓库元数据仅在新打包前分配更新，文档更新不会生成候选包或递增快照。

## 在线服务

| 入口 | 地址 |
| --- | --- |
| 产品官网 | [dietdigidose.top](https://dietdigidose.top/) |
| 管理端 | [dietdigidose.top/login](https://dietdigidose.top/login) |
| API 健康检查 | [dietdigidose.top/api/v1/health](https://dietdigidose.top/api/v1/health) |

官网页脚的 ICP 备案文案和链接由管理端“站点设置”统一配置，不写死在前端代码中。

## 技术架构

本项目是基于 pnpm workspace 的 monorepo：

| 模块 | 主要技术 | 用途 |
| --- | --- | --- |
| `client` | Expo 54、React Native、Expo Router、Uniwind | iOS、Android 与 Web 客户端 |
| `server` | Express、TypeScript、SQLite/PostgreSQL、Drizzle、LangGraph | API、业务事务、数据与 AI Agent 运行时 |
| `admin` | React、Vite、Tailwind CSS | 运营审核与系统管理后台 |
| `deploy` | Docker Compose、Caddy | HTTPS 部署、持久化与恢复演练 |

本地开发默认使用 SQLite，当前公网服务使用 PostgreSQL；Supabase 用于可选的社区媒体对象存储，独立 staging bucket 仍待验收。

## 仓库结构

```text
Dietdigidose/
├── client/          # Expo 客户端：路由、页面、组件与资源
├── server/          # Express API、数据库迁移与导入脚本
├── admin/           # React 管理后台
├── deploy/          # staging 部署、代理与烟测配置
├── docs/            # 产品路线图、验收清单与运维文档
├── eslint-plugins/  # 项目自定义 ESLint 规则
└── scripts/         # 工作区与发布校验脚本
```

## 快速开始

### 环境要求

- Node.js 22.23.2（以 `.nvmrc` 和 `.node-version` 为准）
- pnpm 10.18.0

### 安装与配置

```bash
corepack enable
corepack prepare pnpm@10.18.0 --activate
pnpm install --frozen-lockfile
cp client/.env.example client/.env
cp server/.env.example server/.env
```

使用 nvm、fnm、mise 或 asdf 时，请先让版本管理器读取仓库中的 Node 版本文件。普通 CI、Android 构建和本地推荐环境必须使用同一 Node 版本；升级时应在一个 PR 中同步更新版本文件、根包 `engines` 与全部工作流。

客户端至少需要指向本地 API：

```dotenv
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9090
```

服务端开发模式可以使用默认 SQLite 并自动生成本地 JWT 密钥。生产与 staging 必须设置强 `JWT_SECRET`、`ADMIN_INITIAL_PASSWORD`、明确的 `CORS_ORIGINS`，并用 `DATABASE_DRIVER=postgresql`、`DATABASE_URL` 连接持久化 PostgreSQL。完整字段与说明见 [`server/.env.example`](server/.env.example)。

### 启动

启动 Expo Web 客户端与 Express API：

```bash
pnpm dev
```

另开终端启动管理后台：

```bash
pnpm dev:admin
```

如需在同一终端查看三端日志，可运行 `pnpm dev:all`。

| 服务 | 默认地址 |
| --- | --- |
| Expo Web | `http://localhost:8080` |
| API | `http://localhost:9090` |
| 健康检查 | `http://localhost:9090/api/v1/health` |
| 管理后台 | `http://localhost:5173` |

本地 SQLite 数据库会自动创建在 `server/data/dietdigidose.db`，该目录已被 Git 忽略。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动客户端与 API |
| `pnpm dev:admin` | 启动管理后台 |
| `pnpm dev:all` | 同时启动客户端、API 与管理后台 |
| `pnpm lint:all` | 校验 client、server 与 admin |
| `pnpm test:all` | 运行三端自动化测试 |
| `pnpm test:coverage` | 运行 client/server 覆盖率门禁 |
| `pnpm test:stability` | 连续两轮运行全量测试并生成稳定性报告 |
| `pnpm build:client` | 导出 Expo Web 构建 |
| `pnpm build:server` | 构建 Express 服务端 |
| `pnpm build:admin` | 构建管理后台 |
| `pnpm validate:toolchain` | 校验 Node/pnpm 与 CI 声明一致 |
| `pnpm validate:release` | 校验版本、快照和双端构建号 |
| `pnpm audit:prod` | 审计生产依赖 |

测试分层、覆盖率、产物预算和 flaky/quarantine 处理规则见 [分层测试与质量门禁](docs/testing.md)。

## 发布与安全边界

`client/eas.json` 提供 iOS/Android 的 preview 与 production 配置，所有可分发构建都必须连接 HTTPS API。只有本机 simulator 调试可显式使用 localhost HTTP，不得使用真实敏感数据。

依赖审计通过不代表“零漏洞”。截至 2026-10-06，主分支 `a22c6cb5` 配置了三项精确临时审计例外，并包含 `node-forge` 项目补丁；草稿 PR #248 的 `258d0dba` 增加 `braces` 补丁及强制回归后共四项例外，该新增修复尚未合并或部署。例外原因、补丁校验和复查要求见 [分层测试与质量门禁](docs/testing.md) 与 [`pnpm-workspace.yaml`](pnpm-workspace.yaml)，每次依赖升级和候选验收都必须重新检查。

部署前请阅读：

- [开发与 Beta 收口清单](TODO.md)
- [产品路线图](docs/product-roadmap.md)
- [部署与恢复手册](docs/operations.md)
- [安全政策](SECURITY.md)

## 数据与第三方内容

项目支持从 HowToCook、Open Food Facts、Wikibooks、USDA 与台湾 FDA 等来源导入数据。导入数据应保留来源 URL、版本与许可证信息；不得提交包含用户信息的本地数据库、备份或真实密钥。

第三方源码、字体与食谱资源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，许可证副本位于 [`LICENSES/`](LICENSES/)。

## 项目沿革

“食光烙记”的产品构想形成于 2025 年高校软件创新竞赛期间，曾获[第十八届全国大学生软件创新大赛·软件设计创新赛](https://www.swcontest.com.cn/information?activeTab=notice&detailId=d6d9f4a293ba48f59cec8824ca901332)西南赛区一等奖、全国赛三等奖。

2026 年，项目以全新代码库重新启动。[早期参赛版本](https://github.com/heathcetide/shiguang-brand) 作为历史资料保留；当前实现仅延续项目名称、问题背景与产品愿景，技术架构、数据模型和工程实现均按当前需求重新设计。

## 参与项目

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开披露仍可利用的漏洞。

## 许可证

项目自有代码采用 [MIT License](LICENSE)。第三方组件与内容继续受各自许可证约束。
