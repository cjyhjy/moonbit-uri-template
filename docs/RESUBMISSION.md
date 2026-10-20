# 复审材料

初审意见是选题与 Mooncakes 上已有的 RFC 6570 库重叠。本次补充的内容如下。

## 新增价值

| 问题 | 本项目的做法 | 证据 |
| --- | --- | --- |
| 展开结果是否可信 | 270 条上游用例；与两个 Python 参考实现做 644 条差分，分歧逐条说明理由；修正了三个 MoonBit 库共有的前缀截断问题 | [CONFORMANCE.md](CONFORMANCE.md)、`testdata/differential/results.json`、同类共享探针 |
| 发请求前发现配置错误 | 选择性必填、类型契约、无用绑定、输入/输出预算；整份配置一次检查，任一失败不生成任何 URL | `tools/project.mjs`、`reports/integration-faults.json` |
| 出错时能直接定位修复 | 模板位置、JSON 文件行列（含转义和 emoji）、JSON Pointer、唯一候选的改名建议、GitHub Actions 注解 | `tools/project.test.mjs` |
| JS 项目直接接入 | TypeScript 推导变量名和必填项；数字、`undefined` 和对象顺序按 JS 习惯处理；独立安装验证 | [SDK.md](SDK.md)、`reports/sdk-package.json` |
| 升级模板时不破坏旧调用 | 比较结构、必填、类型和预算；用新定义复验旧请求 | `integrations/github-audit/upgrade.mjs`、`reports/integration-upgrades.json` |
| 参数变化时只刷新相关链接 | 不可变增量会话；更新开销取决于补丁大小，与会话规模无关 | `link_session.mbt`、`sdk/index.mjs`、[PERFORMANCE.md](PERFORMANCE.md) |
| 真实下游 | GitHub 仓库巡检客户端，从便携包运行，发出 9 个真实请求 | `reports/github-integration-portable-live.json` |

与同类库的逐项对比见 [COMPARISON.md](COMPARISON.md)。

## 评审复现

解压便携包（只需要 Node.js 22+）：

```sh
node tools/cli.mjs project integrations/github-audit/requests.json --json
node --test sdk/sdk.test.mjs tools/differential.test.mjs tools/cli.test.mjs tools/project.test.mjs tools/playground.test.mjs integrations/github-audit/integration.test.mjs
node tools/serve-playground.mjs
node integrations/github-audit/main.mjs --gh   # 联网，需要已登录 GitHub CLI
```

源码仓库：`npm test`、`npm run compare:peers`、`npm run benchmark:peers`、`npm run benchmark:resources`。

材料包由 `python3 tools/prepare_submission.py` 生成，内含便携包、报告和 `SHA256SUMS.json`。

## 提交

- 通过[原报名表](https://bxup9uklfcb.feishu.cn/share/base/form/shrcnWUMlgpbwHaXgzV7HmNhNhg)的“查看提交记录”修改原记录，表单最多提交三次。通知允许在 2026-10-31 前修改。
- 表单要求：Markdown 申报书一页以内，由参赛者本人撰写，不得用 AI 编写；至少三个完整使用场景；说明原创、移植或参考关系；仓库不少于 10 个有效提交。
- 本目录的材料只作技术附件，`项目申报书.md` 需要本人更新。
- 邮件草稿见 [ORGANIZER_EMAIL.txt](ORGANIZER_EMAIL.txt)。发送前确认收件地址，附件中不要包含联系方式或令牌。
