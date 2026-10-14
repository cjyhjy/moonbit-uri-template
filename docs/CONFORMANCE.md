# 标准一致性与差异记录

规范：RFC 6570。测试数据固定提交：`4171dac22aa67fc710b3f6df308a50bd08552986`。

| 固定语料 | 用例数 | 结果 |
| --- | --- | --- |
| spec-examples.json | 64 | 全部通过 |
| spec-examples-by-section.json | 117 | 全部通过 |
| extended-tests.json | 53 | 全部通过 |
| negative-tests.json | 36 | 全部按预期失败 |

以上语料在 JS、wasm-gc、Native 各执行一次，没有 skips。真实执行 ID、工具链和日志见 `reports/verification.json` 与 `reports/tests-*.log`。

## 单引号兼容扩展

上游 `spec-examples.json/0/1/L1` 使用 `'{var}'`，预期 `'value'`；`spec-examples-by-section.json/0/0/L4` 使用 `'{count}'`，预期 `'one,two,three'`。RFC 6570 第 2.1 节 literal ABNF 排除了 ASCII 单引号，但这些夹具接受并保留它。

项目选择明确接受并保留模板 literal 的单引号，作为兼容扩展。该选择不改变变量中的单引号处理：普通展开编码，保留字符展开保留。没有编辑上游夹具、特殊匹配测试模板或跳过样例；所有模板单引号统一处理。

需要严格语法检查时使用 `parse_strict`：它拒绝 literal 单引号，合法表达式的展开与默认 API 一致。

这是标准语法与社区互操作期望之间的公开差异，不将“全部夹具通过”等同于正式认证，也不声称完全拒绝所有 RFC 外语法。

## 测试适配

原始夹具保留不变。生成器只将其编译成 MoonBit 测试输入。上游数字和布尔标量转成 JSON 文字，null 作为未定义，关联值保持源对象顺序。核心字符串类型与 CLI 的严格 JSON 输入政策分别验证。

## 其他明确边界

- prefix 按 Unicode 码点计数，保留编码序列边界；不按字节、UTF-16 code unit 或可见字素计数。
- 变量名按原始拼写查找，百分号形式不解码成另一个名称。
- 不进行 Unicode 归一化或 URI 规范化。
- 固定测试通过是可复现证据；新语料与 bug 修复必须增加回归验证。
