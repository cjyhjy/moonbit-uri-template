# 复审材料

初审意见是选题与 Mooncakes 上已有的 RFC 6570 库重叠。下表列出本项目相对已有库新增的能力，以及评委可以直接查看的证据。

## 新增价值

| 问题 | 本项目的做法 | 证据 |
| --- | --- | --- |
| 展开结果是否可信 | 270 条上游用例；与两个 Python 参考实现做 644 条差分，分歧逐条说明理由；修正了三个 MoonBit 库共有的前缀截断问题 | [CONFORMANCE.md](CONFORMANCE.md)、`testdata/differential/results.json`、同类共享探针 |
| 发请求前发现配置错误 | 选择性必填、类型契约、无用绑定、输入/输出预算；整份配置一次检查，任一失败不生成任何 URL | `tools/project.mjs`、`reports/integration-faults.json` |
| 出错时能直接定位修复 | 模板位置、JSON 文件行列（含转义和 emoji）、JSON Pointer、唯一候选的改名建议、GitHub Actions 注解 | `tools/project.test.mjs` |
| JS 项目直接接入 | TypeScript 推导变量名和必填项；数字、`undefined` 和对象顺序按 JS 习惯处理；独立安装验证 | [SDK.md](SDK.md)、`reports/sdk-package.json` |
| 升级模板时不破坏旧调用 | 比较结构、必填、类型和预算；用新定义复验旧请求 | `integrations/github-audit/upgrade.mjs`、`reports/integration-upgrades.json` |
| 参数变化时只刷新相关链接 | 不可变增量会话；更新开销取决于补丁大小，与会话规模无关 | `link_session.mbt`、`sdk/index.mjs`、[PERFORMANCE.md](PERFORMANCE.md) |
| 检查真实 API 描述 | OpenAPI 路径检查：0.4 秒检查 GitHub 官方描述的 1242 个接口，发现 2 处违反 OpenAPI 规范的等价路径；Stripe 612 个、Cloudflare 3767 个接口通过 | [OPENAPI.md](OPENAPI.md)、`reports/openapi-public.json` |
| 真实下游 | GitHub 仓库巡检客户端，从便携包运行，发出 9 个真实请求；npm、Open Library 两个只读客户端 | `reports/github-integration-portable-live.json`、`reports/public-clients-live.json` |

与同类库的逐项对比见 [COMPARISON.md](COMPARISON.md)。

## 评审复现

需要 Node.js 22+ 和 Python 3.9+：

```sh
python3 tools/bootstrap.py && npm ci --ignore-scripts && npm run build
npm test                                      # 四后端、SDK、CLI、差分回放、打包与独立消费者
node tools/cli.mjs project integrations/github-audit/requests.json --github
npm run openapi:public                        # 联网，检查 GitHub、Stripe、Cloudflare 官方 OpenAPI 描述
npm run compare:peers && npm run benchmark:resources   # 与同类库的行为对比和基准
npm run playground                            # 浏览器工作台
```
