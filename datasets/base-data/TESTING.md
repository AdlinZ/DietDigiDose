# 数据测试输入与执行方式

## 日常 CI

从仓库根目录运行，与 GitHub 的 `verify` 检查一致：

```sh
python3 datasets/base-data/build.py --download --output-dir .cache/base-data-ci-build
curl --fail --location --retry 2 https://github.com/user-attachments/files/31905208/dietdigidose-base-data-0.1.0-rc.7.zip --output .cache/base-data-rc7.zip
python3 datasets/base-data/verify.py .cache/base-data-rc7.zip
DDD_BASE_DATA_RC7_ARCHIVE="$PWD/.cache/base-data-rc7.zip" python3 -m unittest discover -s datasets/base-data -p 'test_*.py' -v
```

构建器下载 `sources.lock.json` 中的三份公开来源，逐一核对 SHA256。
rc.7 附件另由 `archive.lock.json` 校验。缺文件、下载失败或哈希不符都会失败，
不会把无法取得的公开数据当作通过。初次下载 HowToCook（含图片）可能较慢。

日常套件包含源包重建及逐字节复现、清洗回归、解析与营养计算测试；
`test_system_release.py` 还直接校验 Git 中实际分发的冻结 ZIP、每个清单成员、
目录引用和全部 20 道菜的营养重算，保留未知值及禁止自动配餐的约束。
营养逻辑测试使用冻结包中的输入，不依赖开发者电脑上的输出目录。

字符转换使用随仓库固定分发的 OpenCC 字符字典，Linux/macOS/Windows 结果一致；
不再调用 Windows NLS。来源及许可见 `reclean/opencc/README.md`。

## 历史完整重建

历史评估和中间产物未全部公开分发，部分还包含未确认再分发授权的 CN6 来源。
不能通过重新下载动态来源、伪造样本或修改锁定哈希来代替它们。以下重建测试
默认明确显示 `skipped`，不代表历史产物已验证；CI 仍必测上面的公开源和当前冻结包。

在具备对应固定输入的工作目录中显式启用：

```sh
DDD_TEST_HISTORICAL_DATA=1 DDD_BASE_DATA_RC7_ARCHIVE="$PWD/.cache/base-data-rc7.zip" python3 -m unittest discover -s datasets/base-data -p 'test_*.py' -v
```

启用后缺少输入直接失败，原始断言和哈希检查仍全部执行。所需目录如下：

| 测试 | 固定输入（仓库根目录相对路径） |
| --- | --- |
| `test_round1.IntegrationTests` | `artifacts/base-data/0.2.0-rc.1/dietdigidose-base-data-0.2.0-rc.1.zip`，或 `DDD_BASE_DATA_ROUND1_BASELINE` |
| `test_round2` 完整重建 | `artifacts/base-data/0.2.0-rc.2/dietdigidose-base-data-0.2.0-rc.2.zip`；`.cache/base-data-sources/round2/` 中的 `sanotsu.zip`、`sanotsu.commit`、`tfda.zip` |
| `test_bindings_batch1` 完整重建 | `artifacts/base-data/round2-assessment-1/round2-assessment-1.zip`；上述 `tfda.zip` |
| `test_bindings_batch2` 完整重建 | 上述 rc.2、assessment、tfda；`artifacts/base-data/nutrition-bindings-batch1/nutrition-bindings-batch1.zip` |
| `test_concepts.ConceptPackageTests` | rc.2、两个 nutrition-bindings ZIP；`.cache/base-data-sources/concept-v1/` 下 `concepts.SNAPSHOTS` 固定的七份 Wikidata JSON |
| `test_add_cn6` | `artifacts/base-data/concept-base-1.0.0-rc.1/concept-base-1.0.0-rc.1.zip`、assessment、sanotsu |
| `test_enrich_core` 历史重建 | `artifacts/base-data/concept-base-1.0.0-rc.2/`、`concept-enrichment-2026-09-15.1/`、`enrichment-inputs/usda-sr-legacy-2018-04.zip` |
| `test_enrich_next` 历史重建 | 上述 concept-base、两轮 `concept-enrichment-2026-09-15.*` 完整目录、tfda |

历史归档的哈希不因构建器或字典更新而调整。使用新代码构建的新产物不冒充旧快照；
比较历史归档本身须使用其中附带的构建器。跨平台字符规则变化应作为新产物差异审阅。
