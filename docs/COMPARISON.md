# 同类对比与可用性改进

核查日期：2026-10-14。对比对象为源码快照，而非只看包描述：

- [Magic486/moon-uri-template](https://github.com/Magic486/moon-uri-template/tree/8fecb90c2190e4715935b5f4ea0937b0b5c8d08b)，提交 8fecb90c；源码依赖 moonbitlang/x 0.5.1。此前注册表发布元数据记录 0.4.45，两者不是同一证据范围。
- [JSJ222/MoonUriTemplate](https://github.com/JSJ222/MoonUriTemplate/tree/76b11916c91cd48d42102104fab82337a276b225)，提交 76b11916。
- 本项目 0.1.1 核心；本次维护补丁仅修改开发验收工具。

阅读了 README、公共接口与相关实现，并在同一固定工具链下运行小样例。没有执行同类的完整标准测试、性能或压力测试，所以不作全面正确性、速度或成熟度排名。

## 已核实的差异

| 维度 | 本项目 | Magic486 | JSJ222 |
| --- | --- | --- | --- |
| 常规展开与解析复用 | Level 4；支持 | Level 4；支持 | Level 4；支持 |
| 错误处理 | Result，code/message/span | raise，结构化子错误 | Result，分阶段错误与诊断 API |
| 错误偏移 | Unicode 码点；CLI 提供行列 | UTF-16 代码单元 | UTF-16 代码单元；另有输出映射 |
| JSON 顶层 null | 省略该变量 | 当前快照拒绝 | 省略该变量 |
| JSON 集合内 null | 列表拒绝；对象省略 | 列表及对象拒绝 | 支持 SparseList/SparseAssoc |
| 严格字面量语法 | 显式 parse_strict；默认兼容单引号 | 当前接口未提供双模式参数 | 默认严格；strict_literals 可配置 |
| 命令行交付 | 便携 Node zip；stdout/stderr 分离；错误写 stderr | MoonBit CLI，含 inspect；当前实现错误写 stdout | 当前 cmd 是样例程序；API 与示例更丰富 |
| 资源限额 | 尚无公开 parse/output 限额 | 模板、表达式、变量与输出限额 | 模板、绑定、值、成员、批量及输出限额 |
| SDK 高级能力 | 变量查询、绑定复制、有序关联值 | 模板 level/inspect 等 | 必填/未使用检查、批量、部分绑定、目录、策略、计量、迁移诊断 |
| 标准语料 | 固定 270 条，实际三后端逐项执行 | README 声明 153 条；本次未运行其完整测试 | 声明固定 270 条与四后端；本次未运行其完整测试 |
| 许可证 | Apache-2.0 | MIT | Apache-2.0 |

“未提供”限于所核查的接口/CLI 快照，不表示以后不会添加。UTF-16 偏移适合 JavaScript/editor 接口，码点偏移适合按字符解释；这不是正确与错误的排名。153 与 270 也不能直接代表库质量差距，必须比较覆盖范围和同一测试执行结果。

## 实际小样例结果

三库在 JS、wasm-gc、Native 上都将 `/users/{id}{?tags*}` 与 id="team/a"、tags=["a b","sdk"] 展开为 `/users/team%2Fa?tags=a%20b&tags=sdk`。

对非法模板 `😀{x`，本项目报起点 1，另两库报 2，与各自偏移约定一致。Magic486 对 JSON 顶层 null 报 InvalidValue，JSJ222 接受；本项目 null 省略行为由现有 CLI/适配器测试验证。

原始输出见 [peer-comparison.json](../reports/peer-comparison.json) 与日志；消费源码为 [main.mbt.txt](../testdata/peer-smoke/main.mbt.txt)。复现时在临时 moon.work 中列入三个固定源码模块与消费模块，消费模块将三个包别名为 ours/magic/jsj，运行该源码；工具链见 toolchain.lock.json。当前消费样例不会调用网络或发送 HTTP 请求。

## 能否更好用

可以优化特定使用场景，目前不能宣称全面优于已有库。我们的已交付特点是较小的 API 范围、复制绑定与隐藏表示、明确的诊断和不需 MoonBit 工具链的便携 CLI。JSJ222 在复杂 SDK 和批量工具方面明显提供更多能力；Magic486 也已有 CLI、限额和差异测试，不能将这些作为我们的独有创新。

下一轮建议按以下真实使用任务推进，以下均是规划，尚未实现：

1. **先补可控资源预算。** 增加显式 parse/expand 限额，在分配大输出之前失败；保持现有便利入口兼容。以超长模板、超大变量和输出边界回归验证。
2. **减少 SDK 接入中的遗漏。** 增加一次构造 Variables 的入口与绑定预检，可列出 missing/unused；显式 required 模式与 RFC 默认省略行为分开，避免改变标准语义。
3. **让错误立即可修。** CLI 显示模板所在行和定位标记，提供稳定 JSON 诊断输出；不回显变量值。按中文、emoji、长行和机器管道任务验证。
4. **再做交互演示与真实下游。** P2 Playground 调用同一核心，并选择一个实际 API/SDK 接入验证；不能仅凭界面数量称“更好用”。

评估方式：比较首次安装到成功展开所需步骤、定位非法模板所需信息、遗漏变量能否在发请求前被发现、流水线能否可靠读取退出码和诊断。性能结论需同机器同工作量实测，本次未作此结论。
