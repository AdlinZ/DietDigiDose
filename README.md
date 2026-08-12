# 食光烙记（DietDigiDose）

![食光烙记（DietDigiDose）项目 Logo](client/assets/logo.svg)

食光烙记（英文名：DietDigiDose）是一个面向日常饮食管理的全栈应用，包含 Expo 客户端、Express API 和 React 管理后台。项目围绕家庭食材库存、饮食记录、健康数据、菜谱社区和 AI 营养助手展开。

> 当前项目仍在开发阶段，不应被视为医疗诊断或治疗工具。营养估算和 AI 输出仅供日常参考。

## 当前状态（2026-08-09）

项目处于 **Beta 收口期**：主要页面和服务端业务已经实现，工程基线可以支持候选包验收，但尚未达到可公开发布或承载真实敏感健康数据的标准。

已验证的基线：

- client、server、admin 的 TypeScript/Lint 校验通过。
- 自动化测试共 22 个测试文件、102 条测试通过，其中包括服务端核心业务、菜谱质量回填与公开过滤、管理审核、登录续接白名单、无障碍树、构建传输策略、事务幂等、用户隔离、游标分页和媒体格式校验。
- CI 会安装冻结依赖、执行三端校验与测试、构建 client/server/admin，并审计生产依赖。
- 仓库已包含 iOS/Android preview、production、受控 `preview-http` 测试包和独立 simulator 配置；HTTP 测试包只允许使用一次性测试账号，不属于可外发候选包。本轮只完成仓库内与本地构建验收，尚未生成双端候选包或执行外部内测。

代码内的公开身份隔离、可信菜谱门槛、登录续接、采购与烹饪闭环、版本化迁移、安全会话存储和演示数据隔离已完成；对外内测前仍须完成 HTTPS staging 验收、双端候选包、真机闭环和备份恢复演练。

当前执行计划见 [开发 TODO](TODO.md)，产品阶段目标见 [产品路线图](docs/product-roadmap.md)，Agent 改造验收见 [Agent 系统模拟用户验收清单](docs/agent-user-journey-checklist.md)，发布候选验收见 [真机验收与小范围内测清单](docs/device-beta-checklist.md)，部署与恢复见 [运维手册](docs/operations.md)。

## 项目沿革与重启说明

“食光烙记”的早期产品构想形成于 2025 年高校软件创新竞赛期间，围绕智能食材管理、减少家庭食材浪费、饮食记录和健康饮食建议完成过产品规划与原型验证。该构想曾在第十八届全国大学生软件创新大赛·软件设计创新赛中获得西南赛区一等奖和全国赛三等奖。

2026 年，项目以“复活 / 重启”的方式重新开始开发。当前仓库不是早期参赛版本的迁移或续写：

- 当前源代码为从零开始的独立实现，没有查看、参考、复制或迁移早期项目的源代码。
- 重启版本仅延续项目名称、问题背景和产品愿景，技术架构、数据模型及工程实现均基于当前需求重新设计。
- 历史材料只用于补充产品沿革与需求脉络，不代表当前功能完成度、技术架构或医疗有效性。

为保护相关人员隐私，公开说明不包含早期团队成员、学校、指导人员、联系方式、文档作者元数据、内部部署信息和预算等内容，原始历史文档也不会提交到本仓库。

## 主要功能

- 食材库存、保质期和厨房用具管理
- 饮食打卡、营养素记录和健康数据追踪
- 菜谱搜索、收藏、投稿和社区内容
- AI 营养问答、食物识别、票据扫描和语音转写
- 用户、菜谱、社区内容、AI 配置和安全审计管理后台

## 技术栈

| 模块 | 技术 |
| --- | --- |
| `client` | Expo 54、React Native、Expo Router、Uniwind |
| `server` | Express、TypeScript、better-sqlite3；SQLite 是当前实际运行时数据源 |
| `admin` | React、Vite、Tailwind CSS |
| 工作区 | pnpm workspace |

## 仓库结构

```text
Dietdigidose/
├── client/          # Expo 客户端：路由、页面、组件和静态资源
├── server/          # Express API、数据导入脚本和服务端媒体
├── admin/           # Web 管理后台
├── eslint-plugins/  # 项目自定义 ESLint 规则
├── patches/         # pnpm patchedDependencies 补丁
└── pnpm-workspace.yaml
```

## 本地运行

### 1. 准备环境

- Node.js 20 或更新版本
- pnpm 10.18.0（项目在根目录 `package.json` 中固定版本）

只使用 pnpm 安装工作区依赖：

```bash
pnpm install --frozen-lockfile
```

### 2. 配置环境变量

```bash
cp client/.env.example client/.env
cp server/.env.example server/.env
```

客户端最少需要配置后端地址：

```dotenv
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9090
```

服务端开发模式可以自动生成本地 JWT 密钥；生产环境必须设置至少 32 个字符的 `JWT_SECRET`，并设置强度足够的 `ADMIN_INITIAL_PASSWORD`。AI 和 USDA 配置是可选项；Supabase 字段目前只是预留，当前运行时仍使用 SQLite。完整字段见 [server/.env.example](server/.env.example)。

不要把 `.env`、`server/data`、`server/backups`、数据库备份或真实密钥提交到版本库。生产与 staging 应显式设置 `DATABASE_PATH` 到持久化磁盘。

### 3. 启动应用

同时启动 Expo Web 客户端和 Express API：

```bash
pnpm dev
```

另开终端启动管理后台：

```bash
pnpm dev:admin
```

管理端是独立的开发进程：即使它因 Vite 配置、端口或热更新问题退出，`pnpm dev` 启动的客户端和 API 仍会继续运行。若确实需要在同一个终端查看三者日志，可使用：

```bash
pnpm dev:all
```

默认地址：

- Expo Web：`http://localhost:8080`
- API：`http://localhost:9090`
- API 健康检查：`http://localhost:9090/api/v1/health`
- 管理后台：`http://localhost:5173`

SQLite 数据库会在 `server/data/dietdigidose.db` 中自动创建，该目录只用于本地运行并已被 Git 忽略。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动客户端和 API |
| `pnpm dev:admin` | 启动管理后台 |
| `pnpm dev:all` | 同时启动客户端、API 和管理后台（仅用于需要统一查看日志时） |
| `pnpm lint:all` | 检查 client、server 和 admin |
| `pnpm test:all` | 运行 client、server 和 admin 的全部测试 |
| `pnpm test:client` | 仅运行客户端 Jest 测试 |
| `pnpm build:client` | 导出 Expo Web 构建 |
| `pnpm build:server` | 构建 Express 服务端 |
| `pnpm build:admin` | 构建管理后台 |
| `pnpm audit:prod` | 使用 npm 官方安全数据库审计生产依赖 |

## 候选包说明

`client/eas.json` 已包含双端内部预览和 production profile；二者必须从受控环境提供 HTTPS `EXPO_PUBLIC_BACKEND_BASE_URL`。临时 `preview-http` profile 仅用于当前受控打包测试，会启用 iOS 非安全网络访问和 Android cleartext，只能使用一次性测试账号，不得作为外部 Beta 候选包。尚未完成同一提交的双端 HTTPS 候选包生成与真机验收，因此仍不得用于外部用户或真实健康数据内测。

## 数据和第三方内容

项目支持从 HowToCook、Open Food Facts、Wikibooks、USDA 和台湾 FDA 等来源导入数据。导入数据应保留来源 URL、版本和许可证字段；不要提交包含用户信息的本地数据库。

项目内置的第三方源码、字体和食谱资源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，对应许可证副本位于 `LICENSES/`。

## 安全建议

- 生产环境显式设置 `NODE_ENV=production`、`JWT_SECRET` 和 `CORS_ORIGINS`。
- 管理员首次登录后立即修改初始密码。
- AI 密钥只保存在服务端环境变量或管理端系统设置中，不要使用 `EXPO_PUBLIC_` 暴露密钥。
- 外部内测和生产环境只能通过 HTTPS 传输登录凭据、Token、健康资料和 AI 上下文。
- 部署前运行 `pnpm lint:all`、`pnpm test:all`、三端构建和 `pnpm audit:prod`，并完成真机与备份恢复验收。

### 生产依赖审计例外

`pnpm audit --prod` 当前会报告两项已精确忽略的高危告警：`CVE-2025-71329` 与 `CVE-2025-71330`。它们来自 Expo/Metro 构建链中的 `image-size`，当前上游尚无已修复版本；例外范围仅限这两个 CVE，不得将审计结果描述为“零漏洞”。每次 Expo/Metro 升级以及每次 Beta 候选验收前都必须重新运行审计、确认依赖路径与上游修复状态，并在出现可用修复后移除例外。

## 许可证

项目自有代码采用 [MIT License](LICENSE)。第三方组件和内容继续受各自许可证约束，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
