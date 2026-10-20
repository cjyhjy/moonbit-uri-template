# 交付验收记录

## 2026-10-17：0.2.0 本地候选版

已实施资源预算、绑定预检、选择性必填、CLI caret/JSON/UTF-16 诊断和同核浏览器工作台。

- JS、wasm-gc、Native 各 295/295，通过固定 270 个逐项标准案例及新增边界回归。
- CLI 48/48，包含预算、stdin、隐私、Unicode 定位、JSON 深度和预检策略。
- 从源码包解包后的独立消费工程在三个后端通过。
- 两个同类固定源码在三个后端测试通过，另有共享行为探针；见 `reports/peer-audit-20261017.json`。
- 浏览器桌面/390px 窄屏检查、失败修复与复制反馈见 `reports/playground-qa.json`。
- 当前报告为 [verification.json](../reports/verification.json)，包含工作区修改标记和源码 SHA-256；打包器拒绝源码与验收摘要不一致。

这是本地交付，未将 0.2.0 发布到 GitHub/Mooncakes，也未运行该候选版远程 CI。0.1.1 发布仍是下面的历史记录。

## v0.1.1 历史交付验收记录

核查日期：2026-10-14。以下记录区分本地证据与外部发布状态。

## 本地已验证

| 原计划要求 | 证据 | 状态 |
| --- | --- | --- |
| 可复用 MoonBit 核心 | parser.mbt、expander.mbt、encoder.mbt、types.mbt；公共接口快照 | 完成 |
| RFC 6570 Level 4 | 270 个固定上游样例，全部操作符/复合值/修饰符；差异记录 | 完成，单引号扩展已公开 |
| parse 后复用与变量查询 | api_test.mbt 与 examples/main.mbt | 完成 |
| Unicode、空值、错误位置 | 公共 API 回归与固定随机输入测试 | 完成 |
| 固定标准夹具与来源 | testdata/upstream、manifest、NOTICE、上游许可证 | 完成 |
| JS / wasm-gc / Native | 各 285/285，所有上游 ID 各执行一次 | 完成 |
| JSON 适配和 CLI | adapter/json 与 tools/cli.mjs；27/27 集成测试 | 完成 |
| 三组可复现示例 | examples/*.json、npm run demo | 完成 |
| 格式、静态检查、API 快照 | npm test，警告视作错误，漂移检查 | 完成 |
| 干净消费工程 | 从 zip 解包，独立工作区运行三个后端 | 完成 |
| 包内容审查 | reports/package.log、verify.py 必要文件与敏感目录检查 | 完成 |
| 基准与复用说明 | reports/benchmark.json，公开原始样本与环境 | 完成 |
| CI 配置 | .github/workflows/ci.yml，与本地共用验收脚本 | 完成配置 |
| README / API / 许可证 / 变更 / AI 说明 | README.md、docs/API.md、LICENSE、CHANGELOG.md、docs/AI_USAGE.md | 完成 |

复现：`python3 tools/bootstrap.py`，`npm test`，`npm run demo`。当前工具链 `0.10.15+943464bfa`；当时的完整执行 ID、工具链、源码 SHA-256 与包摘要见 [历史 verification.json](../reports/history/v0.1.1/verification.json)。

## 公开交付与用户待办

| 项目 | 当前权威状态 | 下一步 |
| --- | --- | --- |
| GitHub 公开仓库 | 已按实际改进持续提交，发布修复时已有 11 个 commits | 保留真实历史，不制造拆分或空提交 |
| 远程 CI 全绿 | 修复提交 d0a71cd 的运行 38527270144 成功 | 后续变更继续检查对应提交的 Actions |
| Mooncakes 公共包 | cjyhjy/uri_template 0.1.1 已发布，并在全新消费工程验证三个后端及空 prefix 修复 | 证据见 reports/registry.json |
| GitHub Release | [v0.1.1](https://github.com/cjyhjy/moonbit-uri-template/releases/tag/v0.1.1) 已公开，源码指向 d0a71cd | 当时附件 SHA-256 见 reports/history/v0.1.1/release.json |
| 正式报名与验收提交 | 尚无官方提交记录 | 用户核对身份与正式材料要求，完成提交 |

核心库公开交付已完成，正式参赛提交由用户负责。在此历史版本中，浏览器 Playground 尚未实现；0.2.0 本地实现见上方记录。

后续维护发现并修复了验收生成器的项目级并行格式化误用，并补充转义回归与当前失败状态报告。历史失败邮件均对应生成夹具门槛，不能据此认定核心展开失败；也不能仅凭重跑成功保证没有其他问题。证据与历史故障不能完全还原的边界见 CI_INVESTIGATION.md；同类源码比较见 COMPARISON.md。

## 已知限制

默认接受并保留模板 literal 单引号；严格入口拒绝该扩展。CLI 数字/布尔值需显式字符串化；不进行 NFC 归一化。固定工具链历史下载有保留期限，更新必须重验。注册表补查已证实同类，定位和证据见 ECOSYSTEM.md。

## 演示说明

运行 `npm run demo`，依次展示用户分页、列表查询、保留路径与中文、非法模板诊断；再打开测试报告解释固定数据、三个后端和独立下游导入。正式视频是否必需、材料格式和截止时区需以主办方要求确认。

## 新确认的表单要求

用户提供的报名表截图要求：申报书 Markdown 一页以内、不得使用 AI 编写；至少三个完整使用场景；至少 10 个有效 commits，禁止无意义拆分、空提交或重复提交。在最初 4 个真实提交后，继续按严格解析、CLI 接入、覆盖率回归、多场景基准和发布产物等实质改进逐项提交。不会改写或伪造历史。PROPOSAL.md 已明确标为技术参考，不能作为正式申报书上传。

## 可运行发布产物

已生成 Mooncakes 源码包和 portable Node 发布 zip。后者包含编译核心、CLI、样例、标准库许可证和 SHA-256 清单；解压后 27/27 CLI 测试通过。打包脚本与 CI 会自动复现这一过程，证据见 reports/release.json。

GitHub v0.1.1 已发布附件 `moonbit-uri-template-0.1.1.zip`，公开 SHA-256 为 `abb655be5a7c05a0f52760ea54d148ad4ac427002b7d600995516303fb45430d`，与本地报告一致。页面截图见 reports/github-release.jpg。

## 2026-10-20 候选版扩展验收

本轮最新报告取代前文候选版测试数：JS、wasm、wasm-gc、Native 各 327 项通过；CLI 49 项、项目工作流及下游离线 25 项、Node SDK 22 项、工作台计算和生命周期 6 项。源码归档独立消费者验证四后端的计量/批量/目录、画像/差异和审计接口。分发包解压验证同一组 102 项 Node 测试；npm tarball 另经独立离线安装、运行与 TypeScript 正反例检查。

真实客户端从全新解压目录运行，通过公共 Node 目录 SDK 生成 9 个 GitHub 请求，证据见 `reports/github-integration-portable-live.json`；主动故障注入单独见 `reports/integration-faults.json`，六种离线升级演练见 `reports/integration-upgrades.json`。候选版的源码摘要与分发摘要必须和对应报告一致。复审材料入口见 RESUBMISSION.md。这些报告生成于源码提交前，保留当时 HEAD；正式发行、远端 CI、更新表单和发送邮件的状态应分别核对，不得从本地验收或源码推送推定完成。

本轮另验证公共运行时值类型契约、类型变化审查和实际客户端的直接 SDK 类型检查；同类快照更新至 JSJ222 ee7d3be，三后端各 134 项通过，并新增类型契约及增量会话共享探针。本轮已补齐不可变链接会话并验证依赖选择性重算，剩余性能与采用工作见 OPTIMIZATION.md。
