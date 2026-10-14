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
| JS / wasm-gc / Native | 各 280/280，所有上游 ID 各执行一次 | 完成 |
| JSON 适配和 CLI | adapter/json 与 tools/cli.mjs；23/23 集成测试 | 完成 |
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
| GitHub 公开仓库 | 本地没有 remote；浏览器要求登录，gh 凭据失效 | 登录后创建 cjyhjy/moonbit-uri-template 并推送 |
| 远程 CI 全绿 | 尚无远程运行 | 推送后检查实际 Actions 运行 |
| Mooncakes 公共包 | 用户尚未确认注册与命名空间 | 注册、确认用户名、发布并全新注册表安装验证 |
| 正式报名与验收提交 | 尚无官方提交记录 | 用户核对身份与正式材料要求，完成提交 |

公开交付仍未完成，不将本地通过当作上述外部状态的证据。浏览器 Playground 为原计划 P2 可选扩展，当前未实现。

## 已知限制

默认接受并保留模板 literal 单引号；差异解释见 CONFORMANCE.md。CLI 输入数字/布尔值需显式字符串化。核心处理符合 Unicode 字符串输入，不进行 NFC 归一化。固定工具链历史下载有保留期限，更新必须重验；完整注册表查重受 endpoint 网络失败影响，未宣称唯一实现。

## 演示说明

运行 `npm run demo`，依次展示用户分页、列表查询、保留路径与中文、非法模板诊断；再打开测试报告解释固定数据、三个后端和独立下游导入。正式视频是否必需、材料格式和截止时区需以主办方要求确认。
