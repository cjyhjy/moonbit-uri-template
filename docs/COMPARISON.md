# 同类对比

对比对象固定在以下提交。`npm run compare:peers` 会检出这些提交，在 JS、wasm-gc、Native 上运行各自的测试，再用同一个程序调用三家的公开接口（`testdata/peer-smoke/`），输出与 `expected-usability.txt` 不一致即失败。结果见 `reports/peer-audit-20261020.json`。

| 项目 | 提交 | 许可证 | 自带测试 |
| --- | --- | --- | --- |
| 本项目 | 本分支 | Apache-2.0 | 每个后端 336 项（四后端） |
| [Magic486/moon-uri-template](https://github.com/Magic486/moon-uri-template/tree/8fecb90c2190e4715935b5f4ea0937b0b5c8d08b) | `8fecb90`（0.1.2） | MIT | 每个后端 194 项 |
| [JSJ222/MoonUriTemplate](https://github.com/JSJ222/MoonUriTemplate/tree/ee7d3be94e80459d5e4f2fc9eafcc8b1a11ae3df) | `ee7d3be`（0.2.0） | Apache-2.0 | 每个后端 134 项 |

三家都通过各自的测试。测试数量与每项测试的粒度有关，不代表质量高低。

## 同一输入的行为

| 输入 | 本项目 | Magic486 | JSJ222 |
| --- | --- | --- | --- |
| `/users/{id}{?tags*}`，id=`team/a`，tags=[`a b`,`sdk`] | `/users/team%2Fa?tags=a%20b&tags=sdk` | 相同 | 相同 |
| `{x:3}` / `{+x:3}`，x=`%41bc` | `%2541` / `%41` | `%2541bc` / `%41bc` | `%2541bc` / `%41bc` |
| 非法模板 `😀{x` 的错误起点 | 码点 1 | UTF-16 2 | UTF-16 2 |
| `{x}`，x=😀，输出预算 11 字节 | 拒绝 | 拒绝 | 拒绝 |
| `{?x}`，x 为空列表且 x 必填 | `OmittedBinding` | 无必填接口 | `expand_required` 接受，展开为空 |
| `/users/{id}{?page}`，只给 id，id 必填 | `/users/42` | 无必填接口 | `with_contract` 得到 `/users/42`；`expand_required` 报 `missing_variable`，它要求 page 也存在 |
| `{?x,y}` 的输出来源 | 2 段（每个变量一段） | 无对应接口 | 1 段（整个表达式） |
| `{x:2}` 改为 `{x:3}` 的差异报告 | `prefixes_changed=true` | 无对应接口 | `has_flagged_changes=false`（它的摘要不含前缀长度） |
| 两端点会话只改 q | 重算 1 个，旧快照不变 | 无对应接口 | 重算 1 个，旧快照不变 |

第二行与 Python `uritemplate`、`std-uritemplate` 对照：两者给出 `%2541` / `%41`，与本项目一致（见 [一致性](CONFORMANCE.md)）。

## 能力

| 能力 | 本项目 | Magic486 | JSJ222 |
| --- | --- | --- | --- |
| RFC 6570 Level 4、模板复用 | ✓ | ✓ | ✓ |
| 与外部参考实现的差分测试 | 644 条，Python 两库 | 16 条，Python 两库 | — |
| 严格 / 兼容两种字面量模式 | 默认兼容，可选严格 | 只有一种 | 默认严格，可选兼容 |
| 解析与输出预算 | ✓ | ✓ | ✓ |
| 独立的绑定输入预算 | ✓ | — | ✓ |
| 计量、批量、模板目录、部分绑定 | ✓ | — | ✓ |
| 选择性必填、类型契约 | ✓ | — | ✓ |
| 预检报告（missing / omitted / unused） | ✓ | — | ✓ |
| 静态策略审计、变量画像、升级差异 | ✓，差异细到每次引用的修饰符 | — | ✓ |
| 增量链接会话 | ✓，分块共享存储，预算增量计算 | — | ✓ |
| 输出来源映射 | 每次变量引用 | — | 每个表达式 |
| 稀疏成员 | `sparse_list` / `sparse_assoc` 规范化 | — | `SparseList` / `SparseAssoc` 类型 |
| Node / TypeScript SDK | ✓，从模板推导变量名 | — | — |
| CLI | Node 便携 CLI，含 check / trace / compare / project | MoonBit CLI，含 inspect | 示例入口 |
| 请求配置文件检查（行列、Actions 注解、改名建议） | ✓ | — | — |
| 浏览器工作台 | ✓ | — | — |
| 已验证后端 | JS、wasm、wasm-gc、Native | JS、wasm-gc、Native | JS、wasm-gc、Native |

“—”表示固定提交中没有对应的公开接口。

## 各自适合的场景

- **Magic486**：API 小而集中，默认有界，MIT 许可证，自带 MoonBit 原生 CLI。只需要标准展开时是简洁的选择。
- **JSJ222**：MoonBit 侧的高级接口（目录、契约、会话）和本项目大致相当，有一等的稀疏值类型。
- **本项目**：需要在 JS/TypeScript 里直接使用、在发请求前检查整份请求配置、在 CI 中定位错误，或者关心与主流实现逐字节一致时。

性能对比见 [PERFORMANCE.md](PERFORMANCE.md)。
