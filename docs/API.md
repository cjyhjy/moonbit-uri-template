# MoonBit API

准确签名以 [pkg.generated.mbti](../pkg.generated.mbti) 为准。模板错误以 `Result[T, TemplateError]` 返回，不抛异常。

## 基础

| 接口 | 说明 |
| --- | --- |
| `parse(source)` | 解析模板；字面量中的 ASCII 单引号按兼容扩展接受 |
| `parse_strict(source)` | 按 RFC 字面量语法解析，拒绝单引号 |
| `parse_with_limits(source, ParseLimits, strict?)` | 有界解析，先检查源码大小再分配 |
| `expand(source, vars)` | 解析并展开一次 |
| `Template::expand(vars, required?, reject_unused?, limits?)` | 展开已解析模板，见下文 |
| `Template::variables()` | 变量名，按首次出现去重 |
| `Template::source()` | 原始模板文本 |
| `Variables::new / from_entries / set / remove` | 构造绑定；`set` 复制集合，`from_entries` 拒绝重复名 |
| `OrderedEntries::from_entries(entries)` | 有序关联值，拒绝重复键 |
| `sparse_list / sparse_assoc` | 把含 `None` 的成员规范化（省略 `None`） |

`Value` 为 `Scalar(String)`、`List(Array[String])` 或 `Assoc(OrderedEntries)`。空字符串是已定义值；空列表和空关联值视为未定义并被省略。

```moonbit
let vars = @uri.Variables::from_entries([("id", @uri.Scalar("42"))]).unwrap()
let t = @uri.parse("/users/{id}{?page}").unwrap()
t.expand(vars)                                     // 无界，与 0.1 相同
t.expand(vars, limits=@uri.ExpansionLimits::new()) // 先检查全部输入预算，再有界输出
t.expand(vars, required=["id"], reject_unused=true) // 业务契约；page 仍可省略
```

不传任何选项时，`expand` 不设预算（0.1 的行为）。传入 `limits`、`required` 或 `reject_unused` 中任意一个，都会先检查全部绑定，再在输出预算内流式写入，失败时不返回部分结果。处理不可信输入时应传 `limits`。

## 预算

| ParseLimits | 默认值 |
| --- | --- |
| `max_template_codepoints` | 1,048,576 |
| `max_expressions` | 4,096 |
| `max_variables_per_expression` | 256 |
| `max_total_variables` | 65,536 |

| ExpansionLimits | 默认值 | 计数方式 |
| --- | --- | --- |
| `max_bindings` | 4,096 | 绑定数，含未使用的 |
| `max_members` | 65,536 | 所有列表/关联成员合计 |
| `max_value_codepoints` | 1,048,576 | 单个名字、键或值 |
| `max_total_value_codepoints` | 4,194,304 | 所有名字、键、值合计 |
| `max_output_bytes` | 1,048,576 | 编码后的 ASCII 字节 |

限额为非负整数，0 有效，负数返回 `InvalidLimit`。超限错误码：`TemplateLimit`、`ExpressionLimit`、`VariableLimit`、`BindingLimit`、`MemberLimit`、`ValueLimit`、`TotalValueLimit`、`OutputLimit`。

## 预检与契约

| 接口 | 说明 |
| --- | --- |
| `Template::check_bindings(vars, limits?)` | 不展开，返回 referenced / missing / omitted / unused / invalid 报告 |
| `Template::check_contract(vars, required?, reject_unused?, limits?, max_findings?)` | 收集所有业务契约问题（必填缺失、必填空集合、无用绑定、复合值前缀） |
| `Template::with_contract(rules, required?, reject_unused?)` | 声明每个变量的形状（`ScalarKind` / `ListKind` / `AssocKind`），返回 `ContractTemplate` |
| `ContractTemplate::validate / inspect / expand / measure / expand_mapped` | 按契约校验或展开 |

必填名字必须出现在模板里，否则编译报 `UnknownRequired`。必填变量缺失为 `MissingBinding`，必填空集合为 `OmittedBinding`，空字符串合法。

## 计量、批量与来源

| 接口 | 说明 |
| --- | --- |
| `Template::measure(vars, ...)` | 与展开共用编码路径，只计算字节数 |
| `Template::expand_batch(inputs, ..., batch_limits?)` | 先检查并计量全部输入，再生成；任一失败返回带 `index` 的错误 |
| `Template::expand_mapped(vars, ...)` | 返回 URI 及每段输出对应的字面量或变量引用 |
| `Template::bind(fixed)` | 固定部分变量，返回 `BoundTemplate`，之后不允许覆盖 |

`BatchLimits` 默认：256 项，整批输入 4,194,304 码点，整批输出 4,194,304 字节。

## 分析、审计与升级比较

| 接口 | 说明 |
| --- | --- |
| `Template::analyze()` | 表达式列表、每次变量引用、变量画像（次数、操作符、前缀、用途）、最高 RFC 等级 |
| `Template::audit(policy, max_findings?)` | 按 `TemplatePolicy` 检查保留展开、fragment、前缀、explode、变量白名单、等级、引用数、重复变量 |
| `Template::diff(newer)` | 变量增删、标量约束变化、等级、保留/fragment、字面量与布局变化、每次引用的修饰符变化；`requires_review()` 在源码有任何变化时为 true |

## 模板目录

`compile_catalog(entries, ...)` 一次编译多个具名模板（默认最多 256 个）。

| 接口 | 说明 |
| --- | --- |
| `get / names / contains / templates_using` | 查询 |
| `expand / measure` | 按名字展开或计量 |
| `expand_batch / measure_batch` | 跨模板整批处理，`CatalogRequest::new(name, vars, required?)` |
| `inspect_requests` | 收集每个请求的契约问题，不生成 URI |
| `audit(policy, max_findings?)` | 对全部模板做静态审计 |
| `diff(newer)` | 模板增删及每个变化模板的详细差异 |
| `start_session(vars, contracts?, limits?, ...)` | 增量链接会话，见下文 |

## 增量链接会话

```moonbit
let catalog = @uri.compile_catalog([("search", "/search{?q}"), ("health", "/health")]).unwrap()
let vars = @uri.Variables::from_entries([("q", @uri.Scalar("old"))]).unwrap()
let before = catalog.start_session(vars).unwrap()
let update = before.update([@uri.SetBinding("q", @uri.Scalar("new"))]).unwrap()
update.recomputed()          // 1，只重算依赖 q 的端点
update.session().get("search") // /search?q=new
before.get("search")         // /search?q=old，旧快照不变
```

- `update` 接收 `SetBinding` / `RemoveBinding`，返回新会话、实际变化的 URI 和重算端点数。相同值不触发重算。
- 预算覆盖整份状态：绑定数、成员、输入码点、每个 URI 和整份快照输出（默认 4,194,304 字节）。失败时不产生部分快照。
- 绑定、URI 和长度都按 32 个一块存储。更新只复制改动的块，预算只对补丁涉及的绑定增量计算，所以单次更新的开销取决于补丁大小和受影响的端点数，不取决于会话总规模。
- 可用 `contracts=[(name, contract)]` 给端点绑定类型契约。

## JSON 适配包

`cjyhjy/uri_template/adapter/json` 供 CLI、Node SDK 和工作台使用：

- `parse_variables(json)`：字符串、数字（保留 JSON 原文）、布尔、null（未绑定），以及由它们组成的数组和对象。对象成员保持文档顺序。嵌套集合或数组中的 null 报 `InvalidValueType`，附 JSON Pointer。
- `request(command, template, variables_json)` / `request_with_options(...)`：返回 JSON 信封（`exitCode` 加 `output` 或 `error`）。

## 错误

`TemplateError` 含 `code`、`message` 和 `span`（零起点、左闭右开的 Unicode 码点区间）。常见解析错误：`InvalidLiteral`、`InvalidVariableName`、`InvalidModifier`、`ReservedOperator`（`{=x}` 等 RFC 保留的操作符）、`NestedExpression`、`UnclosedExpression`。展开错误：`PrefixOnComposite`。没有源码位置的错误 span 为 `0..0`。
