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
