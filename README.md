# 食光烙记（DietDigiDose）

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
> 项目目前处于可信 Beta 收口阶段，尚未公开发布。营养估算与 AI 输出仅供日常参考，不能替代医疗诊断或治疗建议；当前版本也不应承载真实敏感健康数据。

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

- **产品版本：** `1.0.5`
- **候选快照：** `26w35a`
- **阶段：** 可信 Beta 收口
- **最近更新：** 2026-08-27

三端代码、自动化测试、构建、版本元数据校验和生产依赖审计均已纳入 CI。仓库内候选基线已经通过；正式进入外部内测前，仍需完成 HTTPS staging 验收、同一提交的 iOS/Android 候选包、双端真机闭环及隔离备份恢复演练。

详见 [1.0.5 候选验收记录](docs/release-candidate-26w35a.md) 与 [真机验收清单](docs/device-beta-checklist.md)。

## 技术架构

本项目是基于 pnpm workspace 的 monorepo：

| 模块 | 主要技术 | 用途 |
| --- | --- | --- |
| `client` | Expo 54、React Native、Expo Router、Uniwind | iOS、Android 与 Web 客户端 |
| `server` | Express、TypeScript、SQLite、Drizzle、LangGraph | API、业务事务、数据与 AI Agent 运行时 |
| `admin` | React、Vite、Tailwind CSS | 运营审核与系统管理后台 |
| `deploy` | Docker Compose、Caddy | HTTPS staging、持久化与恢复演练 |

SQLite 是当前实际运行时数据库；Supabase 用于可选的社区媒体对象存储。Postgres 相关能力属于后续容量演进预留，不代表当前生产数据源。

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

- Node.js 20 或更新版本（CI 使用 Node.js 22）
- pnpm 10.18.0

### 安装与配置

```bash
pnpm install --frozen-lockfile
cp client/.env.example client/.env
cp server/.env.example server/.env
```

客户端至少需要指向本地 API：

```dotenv
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9090
```

服务端开发模式可以自动生成本地 JWT 密钥。生产与 staging 必须设置强 `JWT_SECRET`、`ADMIN_INITIAL_PASSWORD`、明确的 `CORS_ORIGINS`，并将 `DATABASE_PATH` 指向持久化磁盘。完整字段与说明见 [`server/.env.example`](server/.env.example)。

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
| `pnpm build:client` | 导出 Expo Web 构建 |
| `pnpm build:server` | 构建 Express 服务端 |
| `pnpm build:admin` | 构建管理后台 |
| `pnpm validate:release` | 校验版本、快照和双端构建号 |
| `pnpm audit:prod` | 审计生产依赖 |

## 发布与安全边界

`client/eas.json` 提供 iOS/Android 的 preview 与 production 配置，它们必须连接 HTTPS API。`preview-http` 和 simulator 配置只用于受控开发测试，不得作为外部 Beta 候选包，也不得使用真实敏感数据。

生产依赖审计目前对 Expo/Metro 构建链中的 `CVE-2025-71329` 与 `CVE-2025-71330` 设置了精确临时例外；上游尚无修复版本，因此不能将当前状态描述为“零漏洞”。每次 Expo/Metro 升级及候选验收都必须重新检查。

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

2026 年，项目以全新代码库重新启动。当前实现没有迁移、复制或参考早期参赛版本源码；仅延续项目名称、问题背景与产品愿景，技术架构、数据模型和工程实现均按当前需求重新设计。

## 参与项目

提交改动前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要公开披露仍可利用的漏洞。

## 许可证

项目自有代码采用 [MIT License](LICENSE)。第三方组件与内容继续受各自许可证约束。
