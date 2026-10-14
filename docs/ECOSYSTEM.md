# 生态查重与项目定位

2026-10-14 完成注册表索引补查。固定索引快照 `a98cb3302f4b09d5334a551d1115810054d84679`，扫描 3007 个模块索引的最新条目名称、description 和 keywords。该扫描覆盖注册表元数据，不代表检查了所有包的源码和功能。原始结果见 reports/ecosystem-scan.json。

## 已存在的同类项目

| 模块 | 扫描时版本 | 公开信息 | 来源 |
| --- | --- | --- | --- |
| Magic486/moon-uri-template | 0.1.2 | RFC 6570 Level 4；注册表依赖 moonbitlang/x 0.4.45；最初发布于 2026-07-25 | [作者仓库](https://github.com/Magic486/moon-uri-template) |
| JSJ222/moonuritemplate | 0.1.0 | 注册表描述为 RFC 6570 Level 4；发布于 2026-10-03 | [注册表记录指向的仓库](https://github.com/JSJ222/MoonUriTemplate) |
| xubowen1234/moonuri | 0.1.1 | 相关 URI 解析、百分号编码和 path templates；不据此认定为完整 RFC 6570 库 | [作者仓库](https://github.com/xubowen1234/moonuri) |

Magic486 的 README 列出 153 个互操作用例和 CLI。后续已读取两个同类的源码、公共接口，并运行三后端小样例，详见 COMPARISON.md。未完整执行其他库的测试，不作性能或正确性优劣判断。

此前网页搜索没有检出同类模块，属于检索覆盖不足。现在已证实存在同类，不能再以“MoonBit 没有 URI Template 库”“首个”或“唯一”申报。

## 本项目可证明的设计与交付特点

- 独立实现 parser、operator、encoder、expander，核心只依赖官方标准库；没有复制上述项目的代码。
- 固定同一上游提交的四份语料：64 overview、117 section walkthrough、53 extended、36 negative，共 270 个样例全部执行。
- 显式提供兼容解析与 RFC literal ABNF 严格解析两种入口，公开单引号差异。
- 隐藏模板和关联值表示，复制集合绑定，保留稳定顺序和 Unicode 码点错误位置。
- 提供可直接解压运行的 Node CLI，归档内含许可证、SHA-256 和测试；不要求使用者安装 MoonBit 工具链。
- 发布后在真实注册表消费工程验证三后端；0.1.1 修复空复合值在 prefix 前应视为未定义的边界。

这些是本项目已经验证的能力，不把它们全部宣称为其他实现不具备的功能。申报定位应为“独立的标准实现与可复现互操作工具”，强调具体工程成果和下游使用方式。是否满足赛事新项目要求由正式审核决定；参赛者应在自己撰写的申报书中如实说明已有同类与参考来源。
