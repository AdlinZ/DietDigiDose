# 食光烙记（DietDigiDose）

![食光烙记（DietDigiDose）项目 Logo](client/assets/logo.svg)

食光烙记（英文名：DietDigiDose）是一个面向日常饮食管理的全栈应用，包含 Expo 客户端、Express API 和 React 管理后台。项目围绕家庭食材库存、饮食记录、健康数据、菜谱社区和 AI 营养助手展开。

> 当前项目仍在开发阶段，不应被视为医疗诊断或治疗工具。营养估算和 AI 输出仅供日常参考。

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
| `server` | Express、TypeScript、SQLite、Drizzle ORM，可选 Supabase |
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
- pnpm 9（项目在 `package.json` 中固定为 `pnpm@9.0.0`）

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
EXPO_PUBLIC_BACKEND_BASE_URL=http://localhost:9091
```

服务端开发模式可以自动生成本地 JWT 密钥；生产环境必须设置至少 32 个字符的 `JWT_SECRET`，并设置强度足够的 `ADMIN_INITIAL_PASSWORD`。AI、USDA 和 Supabase 配置都是可选项，完整字段见 [server/.env.example](server/.env.example)。

不要把 `.env`、`server/data` 或真实密钥提交到版本库。

### 3. 启动应用

同时启动 Expo Web 客户端和 Express API：

```bash
pnpm dev
```

另开终端启动管理后台：

```bash
pnpm dev:admin
```

默认地址：

- Expo Web：由 Expo CLI 输出，通常为 `http://localhost:8081`
- API：`http://localhost:9091`
- API 健康检查：`http://localhost:9091/api/v1/health`
- 管理后台：`http://localhost:5174`

SQLite 数据库会在 `server/data/dietdigidose.db` 中自动创建，该目录只用于本地运行并已被 Git 忽略。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 启动客户端和 API |
| `pnpm dev:admin` | 启动管理后台 |
| `pnpm lint:all` | 检查 client、server 和 admin |
| `pnpm test:client` | 运行客户端 Jest 测试 |
| `pnpm build:client` | 导出 Expo Web 构建 |
| `pnpm build:server` | 构建 Express 服务端 |
| `pnpm build:admin` | 构建管理后台 |
| `pnpm audit:prod` | 使用 npm 官方安全数据库审计生产依赖 |

## 数据和第三方内容

项目支持从 HowToCook、Open Food Facts、Wikibooks、USDA 和台湾 FDA 等来源导入数据。导入数据应保留来源 URL、版本和许可证字段；不要提交包含用户信息的本地数据库。

项目内置的第三方源码、字体和食谱资源说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，对应许可证副本位于 `LICENSES/`。

## 安全建议

- 生产环境显式设置 `NODE_ENV=production`、`JWT_SECRET` 和 `CORS_ORIGINS`。
- 管理员首次登录后立即修改初始密码。
- AI 密钥只保存在服务端环境变量或管理端系统设置中，不要使用 `EXPO_PUBLIC_` 暴露密钥。
- 部署前运行 `pnpm lint:all`、`pnpm test:client` 和 `pnpm audit:prod`。

## 许可证

项目自有代码采用 [MIT License](LICENSE)。第三方组件和内容继续受各自许可证约束，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
