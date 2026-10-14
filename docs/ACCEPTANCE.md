# v0.1.0 交付验收记录

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

复现：`python3 tools/bootstrap.py`，`npm test`，`npm run demo`。当前工具链 `0.10.15+943464bfa`；完整执行 ID、工具链、源码 SHA-256 与包摘要见 [verification.json](../reports/verification.json)。

## 外部待完成

| 项目 | 当前权威状态 | 下一步 |
| --- | --- | --- |
| GitHub 公开仓库 | 公开仓库已创建，main 已收到按实质改进持续提交的代码 | 以真实 Git 历史核对不少于 10 个有效 commits |
| 远程 CI 全绿 | 首次运行成功：38522448090 | 后续变更继续检查对应提交的 Actions |
| Mooncakes 公共包 | 用户已通过 GitHub 注册，截图用户名 cjyhjy；CLI 已登录 | 完成改进和材料后发布并验证注册表安装 |
| 正式报名与验收提交 | 尚无官方提交记录 | 用户核对身份与正式材料要求，完成提交 |

公开交付仍未完成，不将本地通过当作上述外部状态的证据。浏览器 Playground 为原计划 P2 可选扩展，当前未实现。

## 已知限制

默认接受并保留模板 literal 单引号；差异解释见 CONFORMANCE.md。CLI 输入数字/布尔值需显式字符串化。核心处理符合 Unicode 字符串输入，不进行 NFC 归一化。固定工具链历史下载有保留期限，更新必须重验；完整注册表查重受 endpoint 网络失败影响，未宣称唯一实现。

## 演示说明

运行 `npm run demo`，依次展示用户分页、列表查询、保留路径与中文、非法模板诊断；再打开测试报告解释固定数据、三个后端和独立下游导入。正式视频是否必需、材料格式和截止时区需以主办方要求确认。

## 新确认的表单要求

用户提供的报名表截图要求：申报书 Markdown 一页以内、不得使用 AI 编写；至少三个完整使用场景；至少 10 个有效 commits，禁止无意义拆分、空提交或重复提交。在最初 4 个真实提交后，继续按严格解析、CLI 接入、覆盖率回归、多场景基准和发布产物等实质改进逐项提交。不会改写或伪造历史。PROPOSAL.md 已明确标为技术参考，不能作为正式申报书上传。

## 可运行发布产物

已生成 Mooncakes 源码包和 portable Node 发布 zip。后者包含编译核心、CLI、样例、标准库许可证和 SHA-256 清单；解压后 27/27 CLI 测试通过。打包脚本与 CI 会自动复现这一过程，证据见 reports/release.json。
