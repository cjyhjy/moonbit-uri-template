# 评审指南

Mooncakes 上已有 Magic486、JSJ222 两个 RFC 6570 库。下表列出本项目在它们之外提供的能力，以及可以直接查看的证据。

## 差异与证据

| 问题 | 本项目的做法 | 证据 |
| --- | --- | --- |
| 展开结果是否可信 | 270 条上游用例；与两个 Python 参考实现做 644 条差分，分歧逐条说明理由；修正了三个 MoonBit 库共有的前缀截断问题 | [CONFORMANCE.md](CONFORMANCE.md)、`testdata/differential/results.json`、同类共享探针 |
| 发请求前发现配置错误 | 选择性必填、类型契约、无用绑定、输入/输出预算；整份配置一次检查，任一失败不生成任何 URL | `tools/project.mjs`、`reports/integration-faults.json` |
| 出错时能直接定位修复 | 模板位置、JSON 文件行列（含转义和 emoji）、JSON Pointer、唯一候选的改名建议、GitHub Actions 注解 | `tools/project.test.mjs` |
| JS 项目直接接入 | TypeScript 推导变量名和必填项；数字、`undefined` 和对象顺序按 JS 习惯处理；独立安装验证 | [SDK.md](SDK.md)、`reports/sdk-package.json` |
| 升级模板时不破坏旧调用 | 比较结构、必填、类型和预算；用新定义复验旧请求 | `integrations/github-audit/upgrade.mjs`、`reports/integration-upgrades.json` |
| 参数变化时只刷新相关链接 | 不可变增量会话；更新开销取决于补丁大小，与会话规模无关 | `link_session.mbt`、`sdk/index.mjs`、[PERFORMANCE.md](PERFORMANCE.md) |
| 直接使用真实 API 描述 | 按 OpenAPI 附录 C 把每个接口的路径和 query 参数转换成 RFC 6570 模板，SDK 按接口名生成地址。分析在 MoonBit 包 `openapi` 中实现，Mooncakes 与 npm 共用。GitHub（1242 个接口，0.6 s）、Stripe（612，0.3 s）、Cloudflare（3767，1.3 s）全部转换；发现 GitHub 2 处违反规范的等价路径（已提交 issue #7367）、2 处与声明不符的示例，以及 Cloudflare 1783 处与 schema 不符的示例 | [OPENAPI.md](OPENAPI.md)、`reports/openapi-public.json` |
| 大规模公开描述回归 | 200 个服务商的 OpenAPI 描述（12,963 个接口）固定哈希、保存行为基线；189 份无错误，11 份共 63 个错误，0 份检查不完整；60 份 YAML 原文与 JSON 结果逐字段一致 | [OPENAPI.md](OPENAPI.md)、`testdata/openapi-corpus/`、`reports/openapi-corpus.json` |
| 已发布、可安装 | Mooncakes `cjyhjy/uri_template` 和 npm `moonbit-uri-template`（带来源证明）；全新工程从注册表安装后四后端运行通过 | [RELEASE.md](RELEASE.md)、`reports/registry-0.5.1.json`、`reports/npm-release-0.5.1.json` |
| 真实下游 | MoonBit 原生客户端：从 Mooncakes 安装本库，按 GitHub 官方描述生成地址，用 `moonbitlang/async` 发出 3 个真实 HTTPS 请求（macOS、Linux）；Node 侧的 GitHub 巡检客户端（9 个真实请求）和 npm、Open Library 客户端 | [moonbit-github](../integrations/moonbit-github/README.md)、`reports/native-client-live.json`、`reports/native-client-linux-live.json`、`reports/github-integration-portable-live.json` |

与同类库的逐项对比见 [COMPARISON.md](COMPARISON.md)。

## 复现

需要 Node.js 22+ 和 Python 3.9+：

```sh
python3 tools/bootstrap.py && npm ci --ignore-scripts && npm run build
npm test                                      # 四后端、SDK、CLI、差分回放、打包与独立消费者
node tools/cli.mjs project integrations/github-audit/requests.json --github
npm run openapi:public                        # 联网，检查 GitHub、Stripe、Cloudflare 官方 OpenAPI 描述
node tools/openapi_corpus.mjs check --download --baseline testdata/openapi-corpus/baseline.json   # 200 份公开描述
node tools/verify_yaml_corpus.mjs --download   # 60 份 YAML 原文与 JSON 结果对照
tools/moon update                             # 首次运行原生客户端前同步 Mooncakes 索引
python3 integrations/moonbit-github/run.py --live   # MoonBit 原生客户端，需要 C 编译器
npm run compare:peers && npm run benchmark:resources   # 与同类库的行为对比和基准
npm run playground                            # 浏览器工作台
```
