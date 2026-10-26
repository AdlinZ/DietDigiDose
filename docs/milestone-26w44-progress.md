# 26w44 执行计划与进度记录

更新：2026-10-26（上海时区）。本周周期为 **2026-10-26 至 2026-11-01，ISO 第 44 周**。

[W44 里程碑](https://github.com/AdlinZ/DietDigiDose/milestone/14) 承接 W43 的 **19 项未完成 Issue，含 3 项 P0（#105/#106/#107）**。原优先级、标签及验收标准保留；Backlog 21 项不自动纳入。W43 按周归档，已有实现、真机验证与部署证据保留在 [W43 历史记录](milestone-26w43-progress.md)。

## W43 关键落地与闭环回顾

- **社区评论软键盘定位遮挡实机闭环（#17）**：2026-10-25 使用 `26w43d` / build `264304` 预览包在 Android 物理真机上完成实机测试。软键盘弹出后评论框与操作按钮均稳定位于键盘上方可见区域，各输入法切换正常，已正式关闭 [#17](https://github.com/AdlinZ/DietDigiDose/issues/17)。
- **应用内更新客户端模块与 UI 交互真实验证（#219）**：真机进入“关于食光烙记”页面成功读取原生包版本身份（`1.0.6 (26w43d · build 264304 · preview)`），点击“检查应用更新”正确弹出更新检查对话框并优雅处理未配置清单的服务端返回，无崩溃闪退；已在 Issue 记录阶段性成果。
- **AI 审批业务表单扩充与输入净化防御（#229）**：PR [#273](https://github.com/AdlinZ/DietDigiDose/pull/273) 补齐了采购清单（name/amount）、厨具（name/category）、餐食备餐计划（title/startDate/endDate）、菜谱提议（title/cookTime）与宏量营养素微调（calories/protein/carbs/fat）原生表单支持，增加数值安全浮点解析与清空置空保护，8 项单测全数通过，CI 全绿（verify、stability、windows-compatibility、ai-resource-integration 均通过），已合并至 `main`（commit `60354ea3`）。
- **云端食谱审核发布与 Android 真实验收闭环（#218）**：已验证线上 Staging 环境（`https://dietdigidose.top`）公开食谱库总量已由历史的 1 条（番茄炒蛋）更新为 386 条（`official: 386, publicTotal: 386`），分类搜索（如“白菜”）能正常返回“乾隆白菜”、“香菇炒白菜”、“醋溜白菜”等结构化菜品；Android 物理真机（预览包 `26w43d` / build `264304`）实测下拉刷新并检索成功加载多食谱，卡片与列表展示顺畅，已正式关闭 [#218](https://github.com/AdlinZ/DietDigiDose/issues/218)。
- **烹饪模式计时器前后台与锁屏恢复实机闭环（#220）**：Android 物理真机实测启动步骤计时后切入后台与锁屏静置，重新点亮返回 App，倒计时保持准确物理时间流逝校准，未发生任何意外重置或停滞，结合此前 PR #232 的时间基准校正与单测彻底闭环，已正式关闭 [#220](https://github.com/AdlinZ/DietDigiDose/issues/220)。

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
   - **烹饪模式计时器前后台与锁屏恢复实机闭环（#220）**：Android 物理真机实测启动步骤计时后退入后台/锁屏静置，重新点亮返回 App，倒计时保持准确物理时间流逝校准，未发生任何意外重置或停滞，结合此前 PR #232 的时间基准校正与单测已彻底闭环，已正式关闭 [#220](https://github.com/AdlinZ/DietDigiDose/issues/220)。
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
