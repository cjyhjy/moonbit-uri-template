# 公共 API

真实接口以 `pkg.generated.mbti` 为准。错误返回 `Result[T, TemplateError]`，不使用异常代表普通模板错误。

| 接口 | 用法 |
| --- | --- |
| `parse(String)` | 解析模板，保留已公开的单引号兼容扩展 |
| `parse_strict(String)` | 按 RFC literal ABNF 解析，拒绝 literal 单引号 |
| `expand(String, Variables)` | 一次性解析并展开 |
| `Template.expand(Variables)` | 复用已解析模板 |
| `Template.variables()` | 按首次出现顺序返回去重后的变量名 |
| `Variables.new()` | 创建空变量集合 |
| `Variables.set(name, value)` | 添加或覆盖绑定，复制输入集合 |
| `Variables.remove(name)` | 将变量恢复为未定义状态 |
| `OrderedEntries.from_entries(entries)` | 构造有序关联值，检查重复键 |

`Template`、`Variables` 和 `OrderedEntries` 的内部表示隐藏。`Value` 可构造为 `Scalar(String)`、`List(Array[String])` 或 `Assoc(OrderedEntries)`。核心要求字符串形式，数字的格式由下游决定。

关联值示例：

```moonbit
let entries = @uri.OrderedEntries::from_entries([("color", "red"), ("size", "large")])
match entries {
  Ok(entries) => {
    let vars = @uri.Variables::new()
    vars.set("filters", @uri.Assoc(entries))
    // {?filters*} -> ?color=red&size=large
  }
  Err(error) => println(error.message)
}
```

空字符串是已定义值，空集合视为未定义。未提供的变量被省略；查询表达式中存在空字符串仍会生成 `name=`。prefix 不适用于复合值，返回 `PrefixOnComposite`；scalar 上的 explode 不改变结果。

错误包含 `code`、`message` 和 `span`。span 使用零起点、左闭右开的 Unicode 码点偏移。主要 code：`InvalidLiteral`、`InvalidVariableName`、`InvalidModifier`、`NestedExpression`、`UnclosedExpression`、`PrefixOnComposite`、`DuplicateKey`。`DuplicateKey` 属于值构造错误，无模板位置，span 为 0..0。

JSON 适配包 `cjyhjy/uri_template/adapter/json` 提供：

- `parse_variables(String) -> Result[Variables, InputError]`：null 省略；复合对象按键排序；类型错误含 JSON Pointer。
- `request(command, template, variables_json) -> String`：返回 JSON envelope，成功为 `exitCode=0` 和 `output`；失败为 `exitCode` 和 `error`。供宿主进程使用。

Node 桥接包的导出 `request` 直接调用该适配包。JS 只读取文件、传递字符串、格式化位置和控制退出，不实现标准语义。

## 0.2.0 本地新增：预算与预检

此部分是本地候选版 API，尚未随 Mooncakes 0.1.1 发布。旧 `parse`、`parse_strict`、`Template.expand` 保留原输入限制策略；不可信输入应显式使用下列入口。

```moonbit
let vars = @uri.Variables::from_entries([
  ("id", @uri.Scalar("42")),
]).unwrap()
let template = @uri.parse_with_limits(
  "/users/{id}{?page}",
  @uri.ParseLimits::new(max_template_codepoints=4096),
  strict=true,
).unwrap()
let report = template.check_bindings(vars) // missing=[page]，不影响默认 RFC 展开
let uri = template.expand_checked(
  vars,
  required=["id"], // page 仍可省略
  reject_unused=true,
  limits=@uri.ExpansionLimits::new(max_output_bytes=2048),
)
```

| 接口 | 行为 |
| --- | --- |
| `parse_with_limits(source, ParseLimits, strict?=false)` | 在构造字符数组前扫描源码大小；变量规格预算按出现次数计数 |
| `Template.expand_with_limits(vars, ExpansionLimits)` | 扫描所有绑定预算，再有界写入；不返回部分结果 |
| `Template.check_bindings(vars)` | 只审查，不展开；返回 referenced/missing/omitted/unused/invalid |
| `Template.check_bindings_with_limits(vars, limits)` | 先检查绑定预算，再产生报告 |
| `Template.expand_checked(vars, required?=[], reject_unused?=false, limits?=defaults)` | 先验证预算和业务策略，再展开；可选变量照常省略 |
| `Variables.from_entries(entries)` | 复制集合，拒绝重复变量名（`DuplicateBinding`） |

`BindingIssue` 含 name/span。missing、omitted 按首次出现顺序去重；unused 按名字排序；invalid 逐个列出非空复合值的 prefix 冲突位置。`required` 名称必须被模板引用，否则 `UnknownRequired`；缺失为 `MissingBinding`，空集合为 `OmittedBinding`；空字符串仍是有效定义。报告可修改，但不共享模板/绑定内部集合。

### 默认预算和计数单位

| ParseLimits 字段 | 默认 |
| --- | --- |
| max_template_codepoints | 1,048,576 |
| max_expressions | 4,096 |
| max_variables_per_expression | 256 |
| max_total_variables | 65,536 |

| ExpansionLimits 字段 | 默认 |
| --- | --- |
| max_bindings | 4,096 |
| max_members | 65,536，全部列表/关联值成员合计 |
| max_value_codepoints | 1,048,576，分别约束变量名、关联键和字符串值 |
| max_total_value_codepoints | 4,194,304，含所有名称、键、值，含未使用绑定 |
| max_output_bytes | 1,048,576，编码后 ASCII 字节 |

限额为非负 Int，零有效，负值返回 `InvalidLimit`。其他预算错误：`TemplateLimit`、`ExpressionLimit`、`VariableLimit`、`BindingLimit`、`MemberLimit`、`ValueLimit`、`TotalValueLimit`、`OutputLimit`。核心无源位置的绑定/配置错误 span=0..0；JSON 桥接对此省略范围并给 scope。

这些是逻辑大小预算，不是 OS 进程内存/CPU 硬隔离：调用者构造 Variables 之前的分配不受展开预算约束；解析会缓存编码后的字面量，其大小受模板预算约束，不能仅靠输出上限约束解析内存。旧 `parse_variables` 是兼容的无界适配入口。

### JSON 桥接与 CLI

新增 `request_with_options(command, source, variables_json, options_json)`，Node 导出同名函数。`request` 等价于 options=`{}`，现在桥接默认有界。命令为 expand / check / validate / validate-strict / variables。

options 可包含 `strict`、`requireAll`、`rejectUnused`、`required` 字符串数组，以及 `maxTemplate`、`maxExpressions`、`maxVarsPerExpression`、`maxVariables`、`maxBindings`、`maxMembers`、`maxValue`、`maxTotalValue`、`maxOutput`、`maxJson`、`maxJsonDepth`。数字必须是 0..2147483647 的整数；未知键/错误类型拒绝，返回 `InvalidOptions`。

JSON 变量原文默认最多 4,194,304 码点、32 层嵌套，先检查再交给 JSON 解析器。options 原文固定最多 65,536 码点、8 层嵌套。超限为 `JsonInputLimit` / `JsonDepthLimit`。这些检查不改变原来的字符串类型转换规则。

桥接 `check` 成功表示报告产生成功（exitCode=0），报告 findings 不作为协议失败；CLI 将有 missing/omitted/unused/invalid 的报告映射为退出 1，方便 CI 使用。CLI `--json` 输出 schemaVersion=1 envelope：成功 stdout、错误或有发现的 check stderr；普通 expand 保持仅输出 URI。诊断字段提供码点 start/end、1 起点 line/column、UTF-16 start/end 及有界 excerpt/marker；JSON 类型错误提供 path。

```sh
node tools/cli.mjs check '/users/{id}{?page}' --vars '{"paeg":"2"}' --json
node tools/cli.mjs expand '/users/{id}{?page}' --vars '{"id":"42"}' --required id --max-output 128
node tools/cli.mjs expand '{x}' --vars-file - --require-all --strict --json
```

`--required NAME` 可重复；`--reject-unused` 和 `--require-all` 仅用于 expand。重复其他选项或冲突变量输入会报参数错误。CLI 文件/stdin 读取先按最多 maxJson×4 字节加一字节探测截断，随后核心执行精确码点检查；非法 UTF-8 拒绝。JavaScript 对象重复键仍由 JSON 解析器处理，需明确重复名拒绝时使用核心 `Variables.from_entries`。

## 0.2.0 新增的高级 SDK 与项目契约工具

以下均为本地候选版本接口，正式签名以 `pkg.generated.mbti` 为准。

| 入口 | 行为与边界 |
| --- | --- |
| `Template.measure(vars, required?, reject_unused?, limits?)` | 与展开共用编码遍历，只计数，不构造 URI 结果；仍检查输入、前缀类型、必填和输出预算。前缀截取可分配有界小字符串。 |
| `Template.expand_batch(inputs, required?, reject_unused?, limits?, batch_limits?)` | 先验证并计量全部输入，再构造结果；任一错误都不返回部分数组。错误含从零开始的 index；批次级参数错误 index=-1。 |
| `BatchLimits.new(...)` | 默认最多 256 项，整批输入 4,194,304 码点、输出 4,194,304 字节；输入包括所有名字、键、值和未使用绑定。用剩余额度避免累加溢出。 |
| `compile_catalog(entries, max_templates?, max_total_codepoints?, limits?, strict?)` | 默认 256 模板、名字和模板合计 4,194,304 码点；拒绝空名/重复名，有界编译后复用。 |
| `TemplateCatalog.get/names/expand/measure/templates_using/diff` | 查找、排序名字、展开、计量、反查变量与目录变更；目录错误含模板名。 |
| `TemplateCatalog.measure_batch/expand_batch` | 跨模板整批计量/原子展开；输入 CatalogRequest 数组，每项有 name、variables、required。错误包含 index/name/error，支持单项与总预算，总输入还计入请求的模板名。 |
| `Template.bind(fixed)` | 拷贝固定变量；禁止固定未引用变量；返回保留原操作符语义的 BoundTemplate，不生成剩余模板文本。 |
| `BoundTemplate.expand/measure` | 合并后再验证总输入；不允许覆盖固定变量，拒绝无用额外绑定；固定值不能绕过总预算。 |
| `Template.expand_mapped(...)` | 返回 output、bytes、origins；每个非空字面量或变量出现位置产生一段来源，含该变量的前缀/分隔符。空省略不产生空映射。 |
| `Template.source/inspect/level` | 原模板、表达式位置/操作符/变量和最高 RFC 等级；无表达式为 0。 |
| `Template.audit(policy)` | 检查保留字符、fragment、prefix、explode、变量白名单、最大等级/引用数、重复变量。非法策略返回 InvalidPolicy 发现；不替代 URL 主机或协议校验。 |
| `Template.diff(newer)` | 新增/删除变量、新增仅标量约束和 source_changed；字面量/操作符/修饰符改变都会使 source_changed 为 true，不直接判定业务兼容。 |
| `sparse_list/sparse_assoc` | 显式规范化可选成员，省略 None，关联重复键仍拒绝。JSON 列表 null 继续严格拒绝，不能混淆两种入口。 |

`TemplatePolicy.new` 默认允许全部 RFC 特性，max_level=4、max_references=65536。策略检查是显式操作，调用 audit 本身不会改变 expand 的行为。应用应在发现错误时拒绝继续。

### 项目清单格式

```json
{
  "schemaVersion": 1,
  "maxTotalOutputBytes": 1048576,
  "maxTotalInputCodepoints": 4194304,
  "templates": [{
    "name": "users", "template": "/users/{id}{?tags*}",
    "required": ["id"], "types": {"id": "scalar", "tags": "list"},
    "maxOutputBytes": 8192
  }],
  "requests": [{"template": "users", "label": "get-user", "variables": {"id": "42"}}]
}
```

执行 `node tools/cli.mjs project FILE --json` 或 `--github`。这是 Node 项目边界工具；所有 URI 解析、预检、计量、展开均调用编译的 MoonBit 核心。现在每个目录条目只编译一次，后续预检、计量和来源展开复用同一个对象。低层桥接新增 prepare_request/prepared_call；Node 用户推荐使用带类型声明的 compileTemplate，详见 [SDK 指南](SDK.md)。

项目清单限制 1 MiB、JSON 深度 32、256 模板和 256 请求；重复 JSON 键及未知字段拒绝。最多输出 256 条诊断，达到上限以 DiagnosticLimit 标记截断。输出预算是实际 ASCII URI 字节；项目工具和 Node SDK 的总输入预算保守地计算**序列化变量 JSON 的码点数**，与 MoonBit 类型化 batch 的名字/键/值计数定义不同。

模板默认严格解析，每项默认输出 8,192 字节，总输出 1,048,576 字节。必填只针对显式 required，可选查询变量缺失可通过；所有无用绑定拒绝。types 支持 scalar/list/assoc，未绑定与 null 是否可省略由 required 决定。每个请求先检查和计量；整个清单无错误才生成 URI，任一失败 outputs 都为空。输出来源按原始模板变量范围返回。

文件行列从 1 开始、列使用 UTF-16 代码单元；包含嵌套的 templateLocation 时另提供码点/UTF-16 范围。转义字符串如 `\ud83d\ude00` 会映射回文件原文。错误包含 file、JSON Pointer、requestIndex 和稳定 code；不输出绑定值。stdout 成功、stderr 失败；`--github` 为 Actions 协议向 stdout 输出经过转义的注解，退出码仍非零。文件/JSON/输入限制错误返回 2，契约问题返回 1。

CLI 另提供 `measure`（输出字节数）和 `trace`（URI 与来源 JSON），支持与 expand 相同的 required/预算参数。

项目文件 UnusedBinding 可附 `suggestion.kind=rename-binding` 及 from/to JSON Pointer；建议仅针对唯一的、尚未绑定的近似变量名，不会修改配置。

### 直接导入的 Node SDK

公共 ESM 导出为 `compileTemplate`、`expand`、`CompiledTemplate`、`UriTemplateError`，带 `.d.mts` 声明。编译阶段拒绝非法模板和未知 required；默认严格解析及拒绝无用绑定。提供本地 npm tarball 的独立安装验证，尚未发布到 npm。详见 [SDK 接入指南](SDK.md)。

### 分析、契约升级与审计

- `Template.variable_uses/variable_profiles/analyze/reference_count/composite_capable_variables` 提供完整引用、画像与结构信息，位置仍使用码点。画像按变量首次出现顺序；每次使用保留自己的修饰符。
- `Template.diff_contract` 返回 DetailedContractDiff，保留每项变化的旧/新画像、字面量和布局变化、前缀/操作符/explode 的逐次差异。`requires_review()` 对任意源码变化返回 true，并非“不兼容”证明。旧 `diff` 摘要接口不变。
- `Template.audit_with_limit` 默认最多 256 条发现；超限返回 FindingLimit，不输出不完整报告。旧 `audit` 保留原返回类型与行为。
- `Template.check_contract` 收集选择性必填、空集合、无用绑定、复合前缀和未知 required 问题，成功报告可含多个发现；预算错误以 Err 表示。required 名字计入输入码点和独立数量限额。
- `TemplateCatalog.audit/inspect_requests/diff_contract/contains` 分别提供静态审计、跨模板绑定审计、详细目录差异与查询。绑定审计不生成 URI，也不检查输出总量。
- Node `CompiledTemplate.analyze/compare` 对应核心分析/比较；compare 还包含 required、rejectUnused 及运行时预算变化。CLI 新增 analyze 与 compare，行为和例子见 SDK 指南。
