# 26w44 执行计划与进度记录

更新：2026-10-31（上海时区）。本周周期为 **2026-10-26 至 2026-11-01，ISO 第 44 周**。

[W44 里程碑](https://github.com/AdlinZ/DietDigiDose/milestone/14) 承接 W43 的 **19 项未完成 Issue，含 3 项 P0（#105/#106/#107）**。原优先级、标签及验收标准保留；Backlog 项不自动纳入。W43 按周归档，已有实现、真机验证与部署证据保留在 [W43 历史记录](milestone-26w43-progress.md)。

## 2026-10-31 完整收口启动与邮箱恢复

- 用户确认目标为剩余 17 项全部完成，允许跨周；新增 SMTP 邮箱自助恢复，旧邮箱必须先在已登录状态完成密码复核与邮箱验证码验证。灾备目标固定为 RPO 24 小时、完整 RTO 2 小时。
- 用户确认 staging、SMTP/短信、bucket、签名/设备和语音服务资源当前均未准备；已另开资源讨论对话。完整逐项要求、责任和阻塞见 [W44 验收矩阵](w44-acceptance-matrix.md)。
- #192 数字截断修复由 [PR #291](https://github.com/AdlinZ/DietDigiDose/pull/291) 四项 CI 通过后按预期 SHA 合并，合并提交 `508de5af87a5fb50136166f10561e3f75af14cd9`。
- #221 本轮实现注册邮箱验证、标准 SMTP 发码、独立邮箱找回通道及复用密码重设；新增 SQLite 90/PostgreSQL 0031，历史邮箱不自动验证，管理员换邮箱清除验证并吊销旧会话。真实邮件/短信送达未验收。
- 本轮本地验证（Node 22.23.2 / pnpm 10.18.0）：客户端 119 suites / 838 tests；服务端 750 passed / 3 skipped / 0 failed；管理端 21 files / 142 tests。邮箱恢复 SQLite/PostgreSQL 三项集成全部通过、无跳过；独立 PostgreSQL 17 完整迁移/恢复集成与 SQLite 90 演练通过。`lint:all`、契约、架构/数据库边界、schema、文档检查和 Web/服务端/管理端构建及体积预算通过。PostgreSQL 16 由 PR CI 门禁执行；本地 PG17 和模拟邮件不替代目标环境与真实送达。
- #62 代码链路仍为 base64 音频片段→multipart `/audio/transcriptions`→完整 JSON，并非持续供应商音频上行；供应商及费用在资源对话确定后实施。
- #187 冻结参考包审计复跑成功，仍存在大量份数/用量/设备证据缺口；未执行人工批准、正式发布或目标环境导入。

## 2026-10-31 PR #289 合并后续

- PR [#289](https://github.com/AdlinZ/DietDigiDose/pull/289) 最新 head 四项 CI 全部通过，完整差异和审核线程复核无阻断项；按预期 SHA 合并为 `a7461ba00a5d419d789fc84229a220b161860ffc`。
- #192 继续修复本地偏好摘要：原先“不可以吃辣、不会带饭、不可以冷藏、不可以加热”会误匹配肯定词片段，四个条件均被反向识别。先补测试复现，再补全否定匹配；页面回归确认正确摘要仍需用户确认才应用，默认仅本次使用。
- 客户端全量 118 套件 / 833 项、静态检查、Expo Web 构建及体积预算通过；其他端预算沿用已有构建产物。发布检查 20 项、核心闭环 11 项通过，没有分配新打包编号或发布 APK。
- #187 数据导入首轮 15 项通过、8 项因未配置测试数据库跳过；随后在新建的本机隔离 PostgreSQL 17.11 实例补跑，23 项全部通过、0 跳过，覆盖重放、用户修改保护、冲突和失败回滚。实例已停止并清理，未使用业务数据库。此结果不替代目标环境导入、人工语义审核或正式 v1 发布。
- 重新核对 #185/#191/#192/#193/#187 当前 Issue：配置、识别依据、偏好摘要与多餐排程已有实现；剩余真机并存/升级、真实照片和语音、可靠数据依据及目标部署验收继续保持 open。

## 2026-10-31 PR #288 合并后续

- PR [#288](https://github.com/AdlinZ/DietDigiDose/pull/288) 最新 head 四项 CI 全部通过，完整差异和审核线程复核无阻断项；按预期 SHA 合并为 `c64a647b8748c2a5af0c6ed4321e0b8d18f38e52`。
- #62 / #183 语音播放取消保护继续补强：已取消队列尚未执行的初始化回调原本仍会递增播放代次，导致紧接着开始的新播报被丢弃。新增队列代次检查，在初始化之前阻止过期回调；不改变正在执行任务的取消机制。
- 先用队列回归和实际 `voicePackManager` 调用路径复现失败，再修复；覆盖同名/不同名队列重建以及分段播报被即时新播报替换。语音相关 5 套件 / 97 项、客户端全量 118 套件 / 831 项测试、客户端静态检查、Expo Web 构建、体积预算和文档检查通过；其他端预算沿用已有构建产物。
- 本轮仅验证本地逻辑，物理麦克风停止、弱网、扬声器回声、持续供应商音频及真实多轮对话仍需外部验收；#62/#183 保持 open。

## 2026-10-31 PR #287 合并后续

- PR [#287](https://github.com/AdlinZ/DietDigiDose/pull/287) 完整差异及审核线程复核无阻断项；最新 head 的四项 CI 全部通过，按预期 SHA 合并为 `580dadadaefc5c09739b2d5ba99e357766cae795`。
- #190/#194 待吃餐多餐选择与冲突保护的客户端/服务端逻辑核对未确认新增缺陷；保留现有规则，不把代码核对替代真实跨日验收。
- #219 发布工具继续补齐：复制完整 APK SHA-256 遇到浏览器剪贴板缺失或权限拒绝时，捕获失败并展示可手动复制的完整校验值；仅在异步写入成功后提示已复制，允许重试。
- 管理端全量 142 项测试、静态检查及构建通过；新增回归覆盖剪贴板不可用、拒绝、等待写入和失败后重试。没有部署、发布新 APK 或关闭外部验收事项。

## 2026-10-31 PR #286 合并后续

- PR [#286](https://github.com/AdlinZ/DietDigiDose/pull/286) 已完成代码复核，最新提交的 verify、stability、windows-compatibility、ai-resource-integration 均通过；按预期 head SHA 合并至 main，合并提交 `95484a1543108d7276a9bb75aaa2a042b0d9529f`。
- 继续推进 #219 的本地缺口：修复后台错误显示“清单服务可用”的问题。缺失、损坏、超限或含未授权来源的清单现在显示不可用及原因，与客户端更新接口的 503 一致。首次发布仍能创建清单，问题版本仍可撤下，修复后刷新恢复可用状态。
- 新增服务端 HTTP 和管理端页面回归，覆盖错误状态与恢复；更新接口/管理接口专项 14 项、服务端全量 746 passed / 3 PostgreSQL 条件跳过、管理端全量 140 项测试通过，受影响端静态检查、服务端/管理端构建及体积预算、文档检查通过。客户端代码未改，本轮体积预算沿用此前客户端构建产物。
- 仍未部署、发布 APK 或执行真实升级。该修复补齐运维诊断，不证明线上配置已恢复；#219 及下表依赖真机、部署、短信、bucket 或审核依据的事项继续保持 open。

## 2026-10-31 实际推进与验收边界（PR #286 合并前）

本轮代码基线为 `d4902d49d0c4086aac6316cf5943e49f8b908e32`，与检查时远端 main 一致。以下为本轮实际执行结果；后文早期进展保留作为历史记录，不自动作为当前部署或候选验收证据。GitHub W44 当前仍为 **17 open / 2 closed**，本轮没有关闭 Issue。

### 环境与灾备（#105 / #106 / #107）

- 线上 `https://dietdigidose.top/api/v1/health` 返回 200、PostgreSQL / china / local-filesystem；HTTP 返回 308 跳转 HTTPS。不允许的测试 Origin 未收到 `Access-Control-Allow-Origin`，仅证明这一拒绝样例，不能代替完整 CORS 白名单检查。
- 线上版本为 `1.0.6`，构建时间 `2026-10-22T06:39:44.018Z`；接口没有源码 SHA，**不能确认线上等于本轮 main**。
- `STAGING_BASE_URL=https://dietdigidose.top node deploy/staging-smoke.mjs` 实际完成 20 项 HTTPS 检查：注册、登录、三项库存、菜谱读取、制作、重复制作、食用、重复食用、丢弃、旧请求重放、剩余库存与摄入核对、注销。合成账号已删除；这证明当前线上 HTTP 路径可用，不替代真机或同候选验证。
- `pnpm test:migrations` 通过：SQLite 全新 89 迁移、合成 58→89 升级、备份、独立恢复、安全覆盖恢复及失败回滚。合成升级库不是脱敏真实历史库。
- 在新建、仅本机访问的 PostgreSQL **17.11** 隔离实例上完成 `test:postgres-migration`：迁移、业务 repository、最小权限、回滚、备份恢复和恢复后 HTTP 校验全部通过。首次使用 Unix socket URL 因备份工具只支持 `sslmode` 查询参数而停止，改用隔离实例的 loopback TCP URL 后完整重跑通过；未改动本地业务库或线上库。此结果不替代目标 PostgreSQL 16/staging 验收。
- 修复候选身份缺口：服务端构建可显式注入 `SERVER_GIT_SHA`，版本接口增加 `serverGitSha`；Compose 从 `CANDIDATE_GIT_SHA` 传入构建参数。烟测保存执行时间和服务版本，并支持 `EXPECTED_SERVER_GIT_SHA`，缺失或不匹配会在注册/写入前失败。未提供身份时返回 null，保留旧烟测用法，但不能用于证明同候选。
- 对当前线上执行严格身份检查已按预期失败：只发出 health/version 两个读取请求，未创建账号。本轮没有部署修复、重启服务或生成安装包。

### 更新发布与账号恢复（#219 / #171 / #185 / #221）

- 携带有效 Android/preview 包名、平台和 buildNumber 查询线上更新接口，实际返回 **503 / APP_UPDATES_UNAVAILABLE**。这确认更新当前不可用；具体是缺清单、来源配置还是清单内容问题，仍须部署端核查。
- 客户端和服务端的更新、包名、签名、密码恢复与错误通道回归包含在本轮全量测试中。额外执行 PostgreSQL 首绑 repository 及 HTTP 集成，验证用途/用户隔离、单次使用、账号安全及原用户业务数据保留；没有发送真实短信。
- 本机未发现标准 Android SDK 路径下的 adb，PATH 中无 adb/EAS；`xcrun xctrace list devices` 不可用。不能据此断言用户没有设备，但当前没有可执行真机验收的工具链/连接证据。

### 库存、备餐、语音与数据（#189—#194 / #183 / #62 / #108 / #187）

- 全量本地测试：客户端 **118 suites / 828 tests** 通过；服务端 **744 passed / 3 skipped / 0 failed**；管理端 **21 files / 139 tests** 通过。服务端跳过的 PostgreSQL 队列取消、食材资产审核状态、手机号首绑三项均在上述独立实例补跑通过。
- SQLite/PostgreSQL 回归覆盖结构化扣减、精度失败回滚、共用制作、餐次分配与实际食用等；线上烟测补充制作/食用/丢弃及重放证据。未执行真实 Agent 语音、相机识别、跨日真机完整备餐流程，#189—#194 保持 open。
- `pnpm -w lint:all`、后续受影响服务端静态检查、契约、架构边界、SQLite 冻结边界及文档检查通过；服务端、管理端与 Expo Web 构建和三端体积预算均通过；Compose 配置解析确认五个服务端构建入口均收到提交标识。新增烟测/报告测试 **10 项**通过，版本 HTTP 回归通过；构建产物实测确认运行时环境变量不能覆盖已注入的 SHA。该测试注入值是本地夹具，不声称未提交改动属于那个提交。
- `source_coverage.py` 对仓库冻结包 `system-data-2026-09-15.2` 审计成功：389 个 recipe methods，其中缺份数 279、缺食材身份或精确用量 272、缺设备 290；369 个有来源 URL 和声明许可。此为该冻结参考包的范围，不是线上菜谱计数或全部新版数据结论，也不等于人工审核通过。
- #108 当前线上仍报告 local-filesystem；本轮未取得独立 bucket 配置与真实迁移证据。#183/#62 的实际停录、连续五轮、插话和回声仍须设备及真实语音服务验证。

### CI 新发现的依赖审计阻断与修复

草稿 PR [#286](https://github.com/AdlinZ/DietDigiDose/pull/286) 首轮 CI 的 Windows 测试、构建和体积预算通过后，生产依赖审计失败；稳定性与 AI 配置集成通过。核对上游公告后升级 follow-redirects/node-forge、现代 glob/minimatch，并定向升级 Edge 启动器、React Native/codegen 同步 glob 和 test-exclude，移除旧生产依赖链；不将旧版 callable minimatch 全局替换为新模块 API。删除已被上游修复取代的 node-forge 本地补丁及对应 CVE 例外，没有添加新例外。

新增四项兼容/安全回归编入依赖门禁，与已有用例合计 20 项；覆盖真实消费者加载、原生 TypeScript/podspec 扫描、展开上限、取消目录遍历及跨 realm 敏感头清除。升级后全量测试、三端构建/预算和客户端 828 项覆盖率检查通过；最终 PR CI 状态以 [检查页](https://github.com/AdlinZ/DietDigiDose/pull/286/checks) 为准，不把首轮失败写成全绿。详细版本与兼容边界见 [测试记录](testing.md)。

### 外部条件与下一步执行清单

| Issue | 下一步所需条件及验收 |
|---|---|
| #105 | 可用的 staging SSH/部署入口与实际部署版本；核对隔离、数据库角色、管理员轮换、种子开关和允许的 CORS；在可执行窗口验证重启持久化。当前未找到仓库 deploy/.env、deploy/server.env 或可用 SSH Host 别名。 |
| #106 | 同候选目标 PostgreSQL 环境、脱敏上一候选数据、独立恢复目标和备份存储；确定 RPO/RTO 目标、计时、回滚及负责人。 |
| #107 | 同源码 Android/iOS 签名构建条件、两端设备及验收执行人；复用环境/恢复证据后完成核心闭环与异常矩阵。 |
| #219 / #171 / #185 | 稳定 HTTPS APK 下载源、正确清单/来源、两个同签名且递增构建号的 preview 包、正式包与 Android 设备；验证更新、并存、数据保留及异常路径。 |
| #221 | 可用短信供应商配置、已授权并绑定的测试手机号、实际收码和设备操作；验证新密码、旧密码/会话失效及错误/过期/重放。本地存在短信配置键不代表线上已启用。 |
| #189—#194 | 真实账号与移动端，具备审核依据的菜谱；依次做拍照入库、语音扣减、偏好覆盖、多餐、替换、制作分配和跨日食用/丢弃，补弱网/重启和撤销。 |
| #108 | 独立 staging bucket、最小权限配置、生命周期、脱敏历史图片迁移与故障恢复。不能以本地文件卷替代。 |
| #187 | 逐条食材/配方/来源许可审核依据，正式不可变包及目标环境导入/幂等/回滚证据；已有数据不能自动提升审核状态。 |
| #183 / #62 | Android/Web 麦克风和扬声器/耳机、权限和弱网条件、真实语音供应商；先验停录，再核实持续音频适配与五轮/插话/延迟。 |

本轮本地运行时为 Node **25.2.1** / pnpm **10.18.0**；仓库固定 Node **22.23.2**，本地结果不冒充固定 CI 工具链结果。原始日志位于忽略目录 `artifacts/quality/w44-20261031/`，不提交数据库、备份、凭据或用户数据。

## W44 关键落地与闭环进展

- **AI 审批业务表单正式验收与结项（#229）**：PR [#273](https://github.com/AdlinZ/DietDigiDose/pull/273)（commit `60354ea3`）全面落地采购清单、厨房用具、餐食计划、菜谱提议与宏量营养素微调 5 大业务表单，输入数值安全浮点解析并空值净化。经全仓核验，8 项单测及构建预算 100% 达标，已于 2026-10-29 在 GitHub 正式关闭 [#229](https://github.com/AdlinZ/DietDigiDose/issues/229)。
- **客户端相对媒体路径解耦与静态资源交付加固（PR #283 / #108）**：PR [#283](https://github.com/AdlinZ/DietDigiDose/pull/283)（commit `d6046d0c`）已合并至 `main`。客户端引入 `resolveMediaUrl` 统一解析相对媒体路径与绝对路径，全面适配社区、饮食记录、主页、帖子详情及个人中心，消除对服务端硬编码 host 的依赖；服务端 `/api/v1/media/images` 返回纯净相对路径，静态路由受控挂载；并在 `admin/vite.config.ts` 中补齐 `/media` 代理支持管理端本地开发环境图片预览；全量灾备演练 `pnpm test:migrations` 100% 通过，CI 门禁全绿通过。
- **历史周 Draft PR 清理与 W43 完全归档**：确认 Draft PR [#259](https://github.com/AdlinZ/DietDigiDose/pull/259) 中 28 个文件修改已完全被已合并的主干候选 PR #260（commit `cc7ea4e7`）涵盖，已正式关闭整理，使 W43 里程碑实现 0 Open PR / 0 Open Issue 完全归档。
- **社区评论软键盘定位遮挡实机闭环（#17）**：2026-10-25 使用 `26w43d` / build `264304` 预览包在 Android 物理真机上完成实机测试。软键盘弹出后评论框与操作按钮均稳定位于键盘上方可见区域，各输入法切换正常，已正式关闭 [#17](https://github.com/AdlinZ/DietDigiDose/issues/17)。
- **应用内更新客户端模块与 UI 交互真实验证（#219）**：真机进入“关于食光烙记”页面成功读取原生包版本身份（`1.0.6 (26w43d · build 264304 · preview)`），点击“检查应用更新”正确弹出更新检查对话框并优雅处理未配置清单的服务端返回，无崩溃闪退；已在 Issue 记录阶段性成果。
- **AI 审批业务表单扩充与输入净化防御（#229）**：PR [#273](https://github.com/AdlinZ/DietDigiDose/pull/273) 补齐了采购清单（name/amount）、厨具（name/category）、餐食备餐计划（title/startDate/endDate）、菜谱提议（title/cookTime）与宏量营养素微调（calories/protein/carbs/fat）原生表单支持，增加数值安全浮点解析与清空置空保护，8 项单测全数通过，CI 全绿（verify、stability、windows-compatibility、ai-resource-integration 均通过），已合并至 `main`（commit `60354ea3`）。
- **云端食谱审核发布与 Android 真实验收闭环（#218）**：已验证线上 Staging 环境（`https://dietdigidose.top`）公开食谱库总量已由历史的 1 条（番茄炒蛋）更新为 386 条（`official: 386, publicTotal: 386`），分类搜索（如“白菜”）能正常返回“乾隆白菜”、“香菇炒白菜”、“醋溜白菜”等结构化菜品；Android 物理真机（预览包 `26w43d` / build `264304`）实测下拉刷新并检索成功加载多食谱，卡片与列表展示顺畅，已正式关闭 [#218](https://github.com/AdlinZ/DietDigiDose/issues/218)。
- **烹饪模式计时器前后台与锁屏恢复实机闭环（#220）**：Android 物理真机实测启动步骤计时后切入后台与锁屏静置，重新点亮返回 App，倒计时保持准确物理时间流逝校准，未发生任何意外重置或停滞，结合此前 PR #232 的时间基准校正与单测彻底闭环，已正式关闭 [#220](https://github.com/AdlinZ/DietDigiDose/issues/220)。
- **26w44 首个 Android 预览候选包构建完成（#219 / #171）**：CI 工作流运行 31m55s 成功生成产物 `DietDigiDose-1.0.6-26w44a-build264401-preview-...apk`（SHA-256 `1460059844b4960ae95312bc9e39a419db089b3056bf4be7d267359f969b38a4`），构建号 `264401` 严格高于真机现存包 `264304`，且签名与现存包保持完全一致（证书 `0c7b4821...`），8 项安全门禁全部通过。
- **根布局 Stack 路由全量显式声明（PR #277）**：PR [#277](https://github.com/AdlinZ/DietDigiDose/pull/277) 补齐了 `forgot-password`、`custom-food`、`household-*` 等 11 个应用路由在 `client/app/_layout.tsx` 中的显式注册，统一受控无标题栏与转场生命周期，已合并至 `main`（commit `fe3a9277`）。
- **Node 25 Web Storage 单测环境隔离修复（PR #279）**：修复 Node 25.2.1 引入的实验性 `globalThis.localStorage` 污染 jsdom 的问题，确保管理端测试稳定运行，已合并至 `main`（commit `185f63b9`）。
- **应用更新发布管理页面与服务端控制接口（PR #280 / #219）**：完成应用更新清单管理控制台开发，服务端提供 `/api/v1/admin/app-updates` 查看、发布与撤下接口，管理端提供 `/admin/app-updates` 页面并遵循构建预算（体积从 150kB 优化至 15.48kB）；同步将上游突发漏洞的 `qs` 依赖升级至 `6.16.1`，全部 CI 绿灯并合并至 `main`（commit `4e6d8232`）。
- **应用更新并发写互斥锁与管理端多包名版本呈现**：为服务端 `appUpdateManifestService` 增加异步互斥锁，彻底杜绝并发发布与撤下的写竞争；统一严格校验白名单格式；管理端完整支持同一渠道下多个不同 `applicationId` 版本的独立展示、更新与撤下。
- **Android 全局高频 Modal 硬件返回键统一响应规范（#258）**：补齐 `health-data`、`profile`、`inventory`、`ai-assistant`、`community` 等核心高频页面中原生 `Modal` 的 `onRequestClose` 属性，彻底解决 Android 物理返回键无法收起浮层的体验缺陷。
- **用户端密码找回人工核验模板与未验证通道防护（#221）**：补齐未登录 `/password` 路由直达找回密码引导；在 `forgot-password` 界面增加输入邮箱地址的主动引导拦截与“一键复制人工核验申诉模板”能力，避免误填邮箱或泄露敏感凭证；服务端 `/password-recovery/send` 增加显式邮箱拦截防御与错误码 `EMAIL_RECOVERY_UNSUPPORTED`，全流程单测与 HTTP 集成测试覆盖通过。
- **候选基准全量空库/升级库灾备演练（#106）**：本地执行 `pnpm test:migrations`（`db:rehearse`），完成全新 89 迁移空库、58$\to$89 升级库、目录治理核查、备份生成（6ms）、独立恢复（10ms）、就地覆盖恢复安全副本保留与回滚测试，全部 100% 通过。

## W44 推进顺序与核心目标

1. **三项 P0 发布卡点演练**：
   - [#105](https://github.com/AdlinZ/DietDigiDose/issues/105) 部署独立 HTTPS staging 并验证持久化配置；
   - [#106](https://github.com/AdlinZ/DietDigiDose/issues/106) 完成空库、升级库与备份恢复演练；
   - [#107](https://github.com/AdlinZ/DietDigiDose/issues/107) 生成同提交双端候选包并完成核心闭环真机验收。
2. **应用内更新与账号恢复实机闭环**：
   - [#219](https://github.com/AdlinZ/DietDigiDose/issues/219) 服务端配置清单与下载源，打出更高构建号候选包，验证 Android 真机同签名覆盖升级与数据保留；
   - [#221](https://github.com/AdlinZ/DietDigiDose/issues/221) 验证真实短信验证码找回密码与旧会话失效。
3. **内容、库存与烹饪体验收口**：
   - [#218](https://github.com/AdlinZ/DietDigiDose/issues/218) 云端食谱审核发布，验证移动端多食谱可见性（已完成真机实测并闭环关闭）；
   - [#220](https://github.com/AdlinZ/DietDigiDose/issues/220) 烹饪计时前后台与锁屏恢复真实验收（已完成真机实测并闭环关闭）；
   - [#189](https://github.com/AdlinZ/DietDigiDose/issues/189) ~ [#194](https://github.com/AdlinZ/DietDigiDose/issues/194) 库存结构化扣减、多餐制作与食用状态贯通。

## 结转清单（2 项已关闭，当前剩余 17 项）

- [#62](https://github.com/AdlinZ/DietDigiDose/issues/62) feat(cooking): 支持可打断的实时双向语音烹饪助手
- [#105](https://github.com/AdlinZ/DietDigiDose/issues/105) [P0][release] 部署独立 HTTPS staging 并验证持久化配置
- [#106](https://github.com/AdlinZ/DietDigiDose/issues/106) [P0][data] 完成空库、升级库与备份恢复演练
- [#107](https://github.com/AdlinZ/DietDigiDose/issues/107) [P0][release] 生成同提交双端候选包并完成核心闭环真机验收
- [#108](https://github.com/AdlinZ/DietDigiDose/issues/108) [P1][storage] 配置 staging 媒体 bucket 并迁移历史内联图片
- [#171](https://github.com/AdlinZ/DietDigiDose/issues/171) [P1][Release] HTTPS preview 持久签名与覆盖升级验收
- [#183](https://github.com/AdlinZ/DietDigiDose/issues/183) [P1][voice] 修复静音切换并发与断网时麦克风继续录音
- [#185](https://github.com/AdlinZ/DietDigiDose/issues/185) [P2][release] 修复示例环境变量覆盖 preview 隔离包名
- [#187](https://github.com/AdlinZ/DietDigiDose/issues/187) [P1][data] 整理并发布版本化基础数据包 v1
- [#189](https://github.com/AdlinZ/DietDigiDose/issues/189) [P1][fix] Agent 库存操作复用结构化数量与部分消耗规则
- [#190](https://github.com/AdlinZ/DietDigiDose/issues/190) [P1][feat] 分离制作完成、待吃餐与实际食用
- [#191](https://github.com/AdlinZ/DietDigiDose/issues/191) [P1][feat] 明确识别项自动入库，模糊项确认，支持撤销
- [#192](https://github.com/AdlinZ/DietDigiDose/issues/192) [P1][feat] 扩展常用备餐偏好并支持一次性语音覆盖
- [#193](https://github.com/AdlinZ/DietDigiDose/issues/193) [P1][feat] 按待吃餐、库存份量和总耗时生成一套多餐方案
- [#194](https://github.com/AdlinZ/DietDigiDose/issues/194) [P1][feat] 将方案局部替换、制作分配和食用更新贯通到真实记录
- ~~[#218](https://github.com/AdlinZ/DietDigiDose/issues/218) [P1][data] 云端食谱未完成审核通过，实际仅一个食谱可见~~（2026-10-26 真机实测通过已关闭）
- [#219](https://github.com/AdlinZ/DietDigiDose/issues/219) feat: 实现应用内版本检查与 Android APK 更新，配套发布流程
- ~~[#220](https://github.com/AdlinZ/DietDigiDose/issues/220) [P1][fix] 修复烹饪计时意外重置并支持后台恢复与到时提醒~~（2026-10-27 真机实测通过已关闭）
- [#221](https://github.com/AdlinZ/DietDigiDose/issues/221) [P1][feat] 补齐用户端修改密码与忘记密码流程
