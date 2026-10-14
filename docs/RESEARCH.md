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

早期网页检索没有检出同类，不是当前结论。后续通过官方注册表索引补查，找到 Magic486/moon-uri-template 和 JSJ222/moonuritemplate 两个明确的 RFC 6570 Level 4 同类模块，以及相关 URI/path template 包。详情见 ECOSYSTEM.md 和 reports/ecosystem-scan.json。

已完成注册表元数据范围的补查，不能申报为“生态空白”“首个”或“唯一”。本项目定位为独立实现和可复现互操作工具，具体设计特点见 ECOSYSTEM.md。

## 实施结果与用户待办

1. GitHub 仓库与 Mooncakes 命名空间均已确认属于 cjyhjy，并完成公开发布。
2. 工具链已固定，JS 导出与 JS/wasm-gc/Native 运行均已验证。
3. 上游语料固定提交、保留许可证；JSON 适配规则已实现并测试。
4. 核心库、CLI、基准与发布验收已完成；浏览器 Playground 保留为 P2 可选扩展。
5. 用户需自行核对报名是否已提交、是否已审核，以及正式章程对材料和截止时区的要求；正式申报书由用户本人撰写。

## 实施阶段补充

直接读取注册表 API 曾遇到网络错误，后来通过 moon update 获取官方索引并完成元数据扫描，证实有同类；早期检索结论已被这一证据替代。

实际工具链：moonc 0.10.15+943464bfa，moon 0.1.20261012；固定版本官方下载地址已验证，SHA-256 见 toolchain.lock.json。上游语料已保留提交和许可证。官方固定版本下载响应标注保留期限，维护策略见 RELEASE.md。
