# 分层测试与质量门禁

仓库支持并在 CI 固定使用 Node.js 22.23.2 与 pnpm 10.18.0。Linux 是完整发布门禁环境，Windows 使用同一工具链执行冻结安装、三端 lint/test/build、产物预算和生产依赖审计；macOS 可用于本地 Expo/iOS 开发，但不能替代 CI。

## 测试层次

| 层次 | 命令 | 边界 |
| --- | --- | --- |
| 单元 | `pnpm -w test:unit` | 客户端纯逻辑与组件、服务端无网络模块、管理端模型与工具 |
| API contract | `pnpm -w test:contract` | HTTP 状态、错误 envelope、认证/授权、请求与响应字段 |
| 核心 E2E | `pnpm -w test:e2e` | 注册、库存、饮食记录、家庭与账号删除等跨模块流程 |
| migration/recovery | `pnpm -w test:migrations` | 空库、上一 migration、在线备份、独立恢复和安全副本回滚 |
| 全量回归 | `pnpm -w test:all` | client、server、admin 的全部自动化测试 |

测试数据库必须位于各测试创建的系统临时目录；不得读取开发、staging 或 production 数据库。未来 PostgreSQL 测试必须为每个 job 创建独立数据库或 schema，并在结束时清理，不能让并行任务共享可写 schema。

## 覆盖率

`pnpm -w test:coverage` 是合并门禁。当前下限保留合理增长空间，但任何提交都不能让已覆盖的关键范围低于：

- client：statements 40%、branches 40%、functions 35%、lines 42%；采集 `utils`、`services`、已抽离 screen model/hook、`Screen` 与主题上下文。
- server：lines 70%、branches 60%、functions 70%；采集全部 `server/src/**/*.ts`。

下限不是质量目标，也不能通过缩小采集范围绕过。提高阈值或增加关键目录不需要等待大版本；降低阈值必须在 PR 中附原因、恢复 issue、负责人和到期日期。

## 产物预算

三端构建后运行 `pnpm -w quality:build-budgets`。预算保存在 `quality/build-budgets.json`，同时限制目录总大小、JavaScript 总大小和最大单个 JavaScript 文件。超过预算直接阻止合并；确有产品需求时，PR 必须记录增量来源、弱网/启动影响和后续拆分计划，不能只放大数字。

## Flaky 与跳过测试

CI 的 `stability` job 从同一提交连续运行两轮全量测试，并上传 `test-stability-<SHA>` JSON 报告，任意一轮失败都会阻止合并。处理规则：

1. 先保存失败 job、系统、随机输入和日志，创建或关联 issue；禁止仅重跑到绿色后合并。
2. 修复后至少在失败平台连续通过两轮，并保留正常测试入口。
3. `test.only`、`describe.only` 等 focused test 一律失败。
4. `test.skip`、`test.todo` 等只能临时隔离；`quality/test-quarantine.json` 必须登记文件、issue URL、负责人、原因和不超过 14 天的 `expiresOn`。过期、重复、无实际 skip 或未登记的 skip 都会失败。
5. 隔离项仍由对应 issue 跟踪；到期前必须修复或由维护者重新评估，不能无限续期。

本地可运行 `pnpm -w test:stability` 生成 `artifacts/quality/test-stability.json`；该目录被 Git 忽略，不得提交包含环境敏感信息的测试日志。

## 依赖告警

`pnpm -w audit:prod` 对任何新增生产依赖告警失败。`pnpm-workspace.yaml` 只允许精确、已记录且有上游跟踪 issue 的临时 CVE 例外；上游发布修复后必须升级并删除例外，不能用通配规则掩盖告警。

若安全版本改变模块格式而旧版上游消费者尚未兼容，可用 `patchedDependencies` 仅恢复模块互操作层；不得回退安全实现，并必须同时验证真实消费路径、客户端构建与生产依赖审计。

### node-forge 临时安全回补（2026-10-02）

- `CVE-2026-85393` / [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)：RSA PKCS#1 v1.5 验签未拒绝嵌套 `DigestAlgorithm` 中的额外元素。当前 npm 最新版 `1.4.0` 仍受影响。
- 实际依赖来自 Expo CLI 和 `@expo/code-signing-certificates`；后者在证书、CSR 和 manifest 签名验证中调用该解析器，不能仅按开发工具豁免。
- `patches/node-forge@1.4.0.patch` 回补[上游 PR #1152](https://github.com/digitalbazaar/forge/pull/1152) 提交 `ceba34402e329f0365134f23fe19898756527d65` 的 `lib/rsa.js` 修复，增加嵌套元素数量校验。上游跟踪：[issue #1149](https://github.com/digitalbazaar/forge/issues/1149)。这是项目本地回补，上游尚未发布修复版本。
- 版本审计无法识别 pnpm 补丁，因此仅对该 CVE 设置临时精确例外。`audit:prod` 必须先运行 `test:dependency-security`：沿两个真实消费者解析依赖，验证有/无 NULL 参数时拒绝额外元素，并验证正常证书、CSR、manifest 签名和 Node 原生验签兼容。原版有 4 项回归失败，应用补丁后全部通过；移除补丁会阻止审计命令继续。完整测试也包含此检查。
- 维护责任：仓库依赖维护者。上游发布修复后，升级 `node-forge` override，同时移除补丁、`patchedDependencies` 条目与该 CVE 例外，保留回归测试并重新运行完整 CI。其他新漏洞仍直接阻止合并。
