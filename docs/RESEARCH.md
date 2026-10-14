# 来源与待确认事项

核查日期：2026-10-14。历史聊天用于识别用户已选定的 A1 方向；具体技术和赛程重新查看公开来源。

## 已查看的依据

| 来源 | 本次用途 | 结论边界 |
| --- | --- | --- |
| [RFC 6570](https://www.rfc-editor.org/rfc/rfc6570) | 语法和展开行为 | 标准依据；具体实现仍需验证 |
| [社区候选 #18](https://github.com/moonbit-community/auto-contrib-workflow/issues/18) | 生态需求与范围参考 | 2026-04-28 的查重记录不能直接证明十月仍空缺 |
| [赛事官网源码](https://github.com/moonbitlang/Hackathon2026/blob/main/src/App.tsx) | 十月截止、交付与开源要求 | 标注 10/31 报名和验收截止；正式章程及通知优先 |
| [社区测试集](https://github.com/uri-templates/uritemplate-test) | 标准一致性验证 | 已固定提交并保留许可证；三后端各 270/270 上游测试通过 |
| [MoonBit 命令文档](https://docs.moonbitlang.com/en/stable/toolchain/moon/commands.html) | 工程、测试与发布流程 | 命令在实际安装版本上再次验证 |
| [MoonBit 测试文档](https://docs.moonbitlang.com/en/stable/language/tests.html) | 黑盒/白盒组织 | 用于设计测试边界 |
| [MoonBit 官方更新](https://www.moonbitlang.com/updates) | 配置格式演进 | M0 锁定版本，避免滚动更新影响复现 |

## 本地情况

初始目录只有 `.git`，工作区没有 AGENTS.md，也未找到可用 moon。现已在项目 `.toolchain` 安装并固定官方工具链；代码、CLI、三后端测试及打包消费验证完成。远程仓库、注册表发布和报名状态见 ACCEPTANCE.md。

## 生态查重结果

本次检索包括 `MoonBit uritemplate`、`MoonBit uri-template` 和 Mooncakes 域名内的相关关键词，主要找到社区候选记录，没有找到可明确确认的成熟同类实现。

搜索索引并非完整注册表，因此结论仅为“尚未检出”，不能写成“生态中不存在”。M0 需继续检查 [Mooncakes](https://mooncakes.io/) 当前包列表及 GitHub 最新仓库，记录实际候选、版本、功能和维护状态。若存在相似库，优先判断能否形成实质改进和独立价值。

## 开发启动前要落实

1. GitHub 仓库归属与 Mooncakes 命名空间，避免在配置中保留假账号。
2. 报名是否已提交、是否已审核，以及正式章程对材料和截止时区的要求。
3. MoonBit 可用版本、JS 导出方式和 JS/wasm-gc 运行环境。
4. 上游测试提交号、许可证，以及 JSON 值到核心类型的适配方式。
5. 每日可投入时间是否支持 45–65 小时总工作量；若不足，提前缩减扩展项。

这些信息不影响本次架构设计完成，但会影响后续命名、工具链初始化、发布和报名操作。

## 实施阶段补充

重新检索 Mooncakes 与 GitHub 未找到可确认的同类成熟实现。直接读取 Mooncakes 注册表端点遇到网络/SSL 错误，因此未完成全量注册表扫描，仍不宣称“首个”或“唯一”。

实际工具链：moonc 0.10.15+943464bfa，moon 0.1.20261012；固定版本官方下载地址已验证，SHA-256 见 toolchain.lock.json。上游语料已保留提交和许可证。官方固定版本下载响应标注保留期限，维护策略见 RELEASE.md。
