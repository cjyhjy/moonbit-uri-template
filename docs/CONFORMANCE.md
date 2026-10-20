# 标准一致性

## 上游用例

固定 [uri-templates/uritemplate-test](https://github.com/uri-templates/uritemplate-test) 提交 `4171dac22aa67fc710b3f6df308a50bd08552986`，在 JS、wasm、wasm-gc、Native 四个后端全部通过，没有跳过或修改任何用例。

| 文件 | 用例 |
| --- | --- |
| spec-examples.json | 64 |
| spec-examples-by-section.json | 117 |
| extended-tests.json | 53 |
| negative-tests.json | 36（均按预期报错） |

## 与参考实现的差分测试

[tools/differential.py](../tools/differential.py) 生成 644 条用例：5 组取值（普通、保留字符、百分号、Unicode、空值）× 16 种变量写法 × 8 种操作符，外加 4 条边界用例。这些用例与 Python `uritemplate` 4.2.0、`std-uritemplate` 2.0.11 逐字节比较，依赖按哈希固定。

| 结果 | 用例数 |
| --- | --- |
| 三方完全一致 | 583 |
| 只与 `std-uritemplate` 一致 | 49 |
| 只与 `uritemplate` 一致 | 9 |
| 与两者都不同 | 3 |

剩下 61 条的情况：

- **两个参考库彼此不一致。** `uritemplate` 会把关联值按键排序，并把空列表展开成 `#` 或 `;name=`。`std-uritemplate` 在保留展开中会重新编码已有的 `%XX`。在这些用例上，我们分别与另一方一致，也就是与 RFC 一致的那一方。
- **与两者都不同的 3 条，都有 RFC 依据：**
  1. `{;keys*}`，其中 `keys={a: ""}`：我们输出 `;a`。RFC 附录 A 规定，命名操作符遇到空值时使用 `ifemp`，而 `;` 的 `ifemp` 是空串。两个参考库输出 `;a=`。
  2. 字面量中的 `中`：我们编码为 `%E4%B8%AD`。RFC 3.1 节要求不允许出现在 URI 中的字面量字符做百分号编码，两个参考库原样输出。
  3. `{+x:4}`，其中 `x="%E4%B8%ADz"`：截取前 4 个码点得到 `%E4%`，末尾单独的 `%` 再编码成 `%25`，结果 `%E4%25`。`uritemplate` 输出 `%E4%`，不是合法的 URI；`std-uritemplate` 输出 `%25E4%25`。

结果保存在 [testdata/differential/results.json](../testdata/differential/results.json)。`npm test` 会离线回放：当前输出一旦偏离记录就失败；与两个参考库都不同的用例如果超出上面 3 条，也会失败。重新与参考库比较：

```sh
python3 -m venv .venv-diff
.venv-diff/bin/pip install --require-hashes -r tools/differential-requirements.txt
npm run differential
```

## 语义选择

**前缀按原始码点截断。** `{x:3}` 取变量值的前 3 个码点再编码，与两个参考实现一致。例如 `x="%41bc"` 时，`{x:3}` 得到 `%2541`，`{+x:3}` 得到 `%41`。被截断的三元组剩下的 `%` 会编码成 `%25`，所以输出始终是合法的 URI。0.1.1 以及另外两个 MoonBit 库会把 `%41` 当作一个字符，得到 `%2541bc`。

**字面量单引号。** 上游 `spec-examples.json` 的 `'{var}'` 等用例要求接受字面量中的 ASCII 单引号，而 RFC 2.1 节的字面量语法排除它。默认解析接受并原样保留；`parse_strict`、SDK 的 `strict: true` 和 CLI 的 `--strict` 会拒绝。变量值中的单引号按操作符规则处理，不受影响。

**关联值顺序。** 按输入顺序展开，MoonBit 用 `OrderedEntries`，JSON 和 JS 对象按成员顺序。

**其他。**
- 变量名按原始拼写匹配，`%61` 不等同于 `a`。
- 不做 Unicode 归一化或 URI 规范化。
- `{=x}`、`{,x}`、`{!x}`、`{@x}`、`{|x}` 使用了 RFC 保留的操作符，报 `ReservedOperator`。
- 前缀修饰符作用于非空列表或关联值时报 `PrefixOnComposite`。
