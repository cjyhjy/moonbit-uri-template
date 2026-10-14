# 测试与验收设计

以下门槛已由 tools/verify.py 实现。当前结果为各后端 280/280、CLI 23/23；详细执行证据见 reports/verification.json。

## 1. 测试依据

规范以 [RFC 6570](https://www.rfc-editor.org/rfc/rfc6570) 为准。外部夹具使用社区维护的 [uritemplate-test](https://github.com/uri-templates/uritemplate-test)，它不是 IETF 的认证服务。固定提交号 4171dac22aa67fc710b3f6df308a50bd08552986，，保留许可证；不在每次 CI 临时拉取 main。

纳入 `spec-examples.json`、`spec-examples-by-section.json`、`extended-tests.json` 和 `negative-tests.json`。上游说明前两个文件只有部分重叠，所以都运行。测试适配器支持预期单字符串、多个可接受字符串、以及 `false` 表示失败三种形式；未标明 level 的测试组按上游约定视为 Level 4。[夹具格式](https://github.com/uri-templates/uritemplate-test#test-format)

为避免后端文件读取差异，开发脚本将固定 JSON 转成 MoonBit 测试输入，所有后端执行同一份语料。保留转换脚本、生成数据和源文件，CI 检查重新生成后无差异。负例必须进入 parser/expander 得到失败，不能因测试适配器崩溃而算通过。

## 2. 测试分层

| 层 | 内容 | 主要发现的问题 |
| --- | --- | --- |
| 内部单元 | parser、encoder、策略、prefix | 索引、编码和局部分支错误 |
| 公共 API 黑盒 | 导入、parse/expand、错误类型、重复展开 | 不可访问接口、状态泄漏 |
| 标准一致性 | 固定版本四类夹具 | RFC 行为遗漏或组合出错 |
| 扩展回归 | Unicode、长输入、恶意语法、顺序 | 上游未覆盖的边界 |
| 适配器/CLI | JSON 类型、stdout/stderr、退出码 | 产品边界与核心行为不一致 |
| 跨后端 | JS、wasm-gc，后续 Native | 字符串和集合实现差异 |

MoonBit 官方提供黑盒与白盒测试组织方式；分别用于公开契约和内部边界验证。[官方测试文档](https://docs.moonbitlang.com/en/stable/language/tests.html)

## 3. 必须覆盖的语义回归点

建立表驱动矩阵，覆盖全部操作符与标量/列表/关联值，以及无修饰、prefix、explode 的合法和非法组合。每个 bug 增加最小回归样例。

重点审查：未定义与空字符串的差异；空集合；中文/emoji；UTF-8 编码；合法和非法百分号序列；变量名大小写、点和百分号；重复引用；prefix 对 Unicode 和编码序列的边界；未闭合表达式及错误位置。每类期望值在实现前对照 RFC 条款或上游夹具确认，避免用被测函数生成自己的预期值。

项目自己补充的示例契约：

| 模板 | 变量 | 预期 |
| --- | --- | --- |
| `/users/{id}{?page}` | id="42", page="2" | `/users/42?page=2` |
| `/search{?q,tags*}` | q="moon bit", tags=["sdk","api"] | `/search?q=moon%20bit&tags=sdk&tags=api` |
| `{x}` | x="a/b" | `a%2Fb` |
| `{+x}` | x="a/b" | `a/b` |
| `/users/{id` | 任意 | 解析错误，包含源位置 |

增加固定随机种子的生成测试：解析任意输入不崩溃；同模板和变量重复展开结果一致；一次性 expand 与复用 Template 的结果一致；添加未引用变量不改变结果。不要把“编码幂等”当作性质，因为普通展开本来可能再编码百分号。

## 4. CI 与报告

以下步骤已转成实际验收脚本与 GitHub Actions 工作流：

1. 检查格式、静态检查和公开 API 快照。
2. 验证夹具转换结果没有漂移。
3. 对核心库和适用包运行 JS、wasm-gc 测试矩阵；Node CLI 只在 JS 作业运行。
4. 构建示例，执行 CLI 集成测试。
5. 输出按后端/文件/级别统计的 total、passed、failed、skipped 和失败 ID。
6. 发布候选版本时检查包内容和干净下游导入。

候选命令为 `moon check`、`moon test --target js`、`moon test --target wasm-gc`、`moon info`、`moon package --list`，具体包筛选和参数在固定工具链上验证。格式检查采用实际工具支持的方式，禁止只运行会修改文件的格式化命令却忽略差异。[命令文档](https://docs.moonbitlang.com/en/stable/toolchain/moon/commands.html)

报告记录仓库提交、工具链版本、测试数据提交、操作系统和运行后端。不预设测试总数或覆盖率数字。外部测试如有争议，建立可复现差异记录，写明规范依据和状态；不得默默排除后宣称全部通过。

## 5. 发布门槛

- 声明 Level 4 前，固定语料的全部相关测试通过；任何例外必须先解决或降低支持声明。
- JS 与 wasm-gc 上核心契约一致，CLI 示例可由第三方复现。
- 没有已知崩溃、错误编码、静默失败或公共 API 阻断问题。
- README 的功能、支持后端和限制与实际报告一致。
- 测试数据许可证、来源、参考实现和 AI 辅助方式记录完整。
- 公开包从干净工程可以导入；示例、版本号、发布包内容一致。

覆盖率作为查漏工具，不以任意百分比替代语义覆盖。性能为 P1：记录冷解析、重复展开、长模板和集合输入的耗时及环境；在测量前不写“高性能”结论。

## 当前证据

上游用例逐条执行并核对 ID，三后端无 skips；生成数据与接口快照无漂移。CLI 集成测试验证 stdout/stderr 与退出码；验收脚本从真实 zip 解包，创建独立消费工程并运行三后端。单引号公开差异已解决为兼容扩展，没有修改夹具。远程 CI 与注册表安装仍需公开发布后补证。

## 覆盖率诊断

`python3 tools/coverage.py` 运行本地插桩并保存摘要，不向外部服务上传。报告统计插桩点，不设随意的百分比门槛。已根据报告补充编码前缀的双字节/小写十六进制、IRI 字面量边界和大模板/大集合测试。示例另由 verify.py 实际执行，未将未插桩的示例运行伪称为覆盖率。
