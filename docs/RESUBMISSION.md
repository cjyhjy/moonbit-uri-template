# MoonBit URI Template 复审材料入口

本次补充交付把项目从单一 RFC 6570 展开库扩展为可运行的 URI 请求契约检查工具：目录配置、选择性必填、类型与预算检查、文件定位、自动化注解，以及实际 GitHub 仓库巡检接入。标准展开与同类重叠是事实；复审依据应是新增工作和实际使用流程，而非“首个”“唯一”或“全面最快”。

当前材料对应 **0.2.0 候选版本**，本分支提供对应源码。附带验证报告和本地材料包生成于本次源码提交前，保留当时的 HEAD 和工作区状态；正式发行版仍为 0.1.1。源码推送不代表已注册表发布、重新报名或获得赛方认可。

## 材料清单

| 材料 | 评审可核查的内容 |
| --- | --- |
| `docs/REVIEW_EVIDENCE.md` | 技术补充说明、差异化任务、真实案例和证据索引 |
| `docs/COMPARISON.md` | 固定同类提交、能力矩阵、共享探针与剩余差距 |
| `docs/PERFORMANCE.md` | 同设备同目标的全部性能样本与限制 |
| `docs/SDK.md` | TypeScript 接入、修复建议、目录批量与输入边界 |
| `reports/sdk-package.json` | 从本地 tarball 独立离线安装与类型检查，非 npm 发布记录 |
| `reports/verification.json` | 四后端测试、独立源代码包消费者和工具回归 |
| `reports/peer-audit-20261020.json` | 两个同类的原测试与共享行为实测 |
| `reports/github-integration-portable-live.json` | 从解压分发包运行的 9 次真实 GitHub 请求 |
| `reports/github-links-portable-live.json` | 参数切换的 3+2 次真实请求，仅刷新两个相关链接，旧快照和非法补丁检查 |
| `reports/integration-faults.json` | 三种主动注入故障、诊断和零网络调用验证 |
| `reports/integration-upgrades.json` | 六种离线升级演练、旧请求在新契约下复验；非真实 API 升级记录 |
| `reports/playground-browser.json` 与三张截图 | 桌面/窄屏升级比较、精确跳转、取消、超时后重试和旧结果失效的实际浏览器验收 |
| `moonbit-uri-template-0.2.0.zip` | 便携 CLI、检查工具、下游客户端、测试及完整 Mooncakes 源码归档 |
| `docs/ORGANIZER_EMAIL.txt` | 补充材料邮件草稿，尚未发送 |

归档内的 `SHA256SUMS.json` 可校验附件内容。验证脚本会拒绝源码、分发包或接入证据已过期的材料包。

## 评审快速复现

解压便携包，安装 Node.js 22+ 后执行：

```sh
node tools/cli.mjs project integrations/github-audit/requests.json --json
node --test sdk/sdk.test.mjs tools/cli.test.mjs tools/project.test.mjs tools/playground.test.mjs integrations/github-audit/integration.test.mjs
node tools/serve-playground.mjs
# 升级审查不联网；将第二个配置换成候选文件即可比较。
node integrations/github-audit/upgrade.mjs integrations/github-audit/requests.json integrations/github-audit/requests.json
```

如需重跑真实联网案例，另需 GitHub CLI 已登录：

```sh
node integrations/github-audit/main.mjs --gh
```

无账号环境可去掉 `--gh` 使用匿名请求，但可能遭到限流。一次运行 9 次只读 GET，不修改 GitHub 仓库。离线测试可独立复现契约检查及“有错误就不发请求”，不会将模拟响应写成真实联网成功。

## 在原报名表修改

2026-10-20 通过实际页面核实：[原报名表](https://bxup9uklfcb.feishu.cn/share/base/form/shrcnWUMlgpbwHaXgzV7HmNhNhg)有“查看提交记录”入口，并写明“问卷仅能提交三次，可以重复修改”。优先从原记录修改，不另造重复项目。尚未打开或修改个人提交记录。

原通知允许在 **2026-10-31 前**修改并提交最新信息；[官方赛事规则](https://github.com/moonbitlang/Hackathon2026/blob/main/src/App.tsx)也说明未通过项目可以修改。截止具体时刻、时区及复审结论以赛方为准。邮件是补充说明，不能替代表单更新。

当前表单的新项目方向要求：Markdown 申报书、一页以内、不要使用 AI 编写；至少三个完整预期场景；说明原创/移植/参考关系及来源；仓库不少于 10 个有效提交且禁止无意义拆分。已有仓库本轮修改前有 15 个提交，数量不等于赛方认定全部有效。本次不为凑数拆分提交。

**本目录中的技术补充材料由 AI 辅助整理，不应直接作为正式的一页申报书上传。** 参赛者需要亲自撰写并理解正式申报书。既有 `项目申报书.md` 保持原样，以下只提供更新事实核对表：

- 定位：URI 模板基础库，以及请求配置契约检查/排错工具。
- 场景一：API 客户端路径参数必填、查询参数可选，拼写错误在发请求前定位。
- 场景二：多请求配置检查，单项与总预算、文件定位、CI 非零退出与错误注解。
- 场景三：SDK 固定组织或前缀变量，复用模板，检测目录与参数契约变更。
- 真实案例：作者自建 GitHub 仓库巡检客户端，从独立解压包访问三个真实仓库；不是第三方生产采用。
- 完成功能与待办：按 API/证据说明填写，不把候选版本写成已公开发布。
- 参考关系：Magic486（MIT）和 JSJ222（Apache-2.0）作为同类对比对象；固定社区标准语料保留原来源和许可。没有复制同类核心实现；对比工具会下载并运行其固定版本。

## 提交前最后核对

1. 核对原仓库中的候选源码、案例和文档，并在表单记录最终提交链接；本地候选包不能代替远端提交链接。
2. 本人更新一页申报书，并通过原记录修改入口提交。备注指向技术补充说明和固定版本，保留提交成功回执。
3. 确认赛方有效收件邮箱或邮件 Reply-To；截图中的 no-reply 发件地址不能证明能够接收回复。
4. 核对邮件中版本和附件，附本次证据包后发送。材料不得包含银行卡、联系方式或认证令牌。

源码提交与正式发行、表单提交、发信分别记录，后三者不能由代码推送推定完成。是否重叠及是否符合赛事标准，最终由赛方判断。
