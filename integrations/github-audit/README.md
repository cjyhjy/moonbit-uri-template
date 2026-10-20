# GitHub 仓库巡检接入案例

这是本项目新增的实际下游工具：从配置文件读取三个公开仓库，通过 MoonBit URI Template 生成 GitHub REST API 地址，检查所有请求契约后，再读取仓库信息、最新提交和发行列表。它与库放在同一仓库维护，属于作者自建下游的真实联网接入，不是第三方采用证明，也不是生产部署。

## 运行

在仓库根目录执行：

```sh
npm run build
node tools/cli.mjs project integrations/github-audit/requests.json --json
node integrations/github-audit/main.mjs --gh
```

在解压的便携包中不需要 MoonBit 或构建步骤，直接执行后两条命令。Node.js 22+ 即可运行检查；`--gh` 联网模式另需 GitHub CLI 及已有登录。工具仅让 `gh` 执行 GET，不提取、记录或打包令牌。不使用 `--gh` 时使用匿名 Node fetch，可能被 GitHub 限流。

可从本目录执行 `npm run check`、`npm test`；`npm run audit` 默认匿名联网。也支持指定配置和报告：

```sh
node main.mjs --gh requests.json ../../reports/github-integration-live.json
```

正常情况发出 9 个 GET；所有配置先检查，任一失败则不发送请求。只允许固定 GitHub API 源、仓库路径、commits/releases 路径和 `per_page=1`，不跟随 Node fetch 重定向。每个响应限制 1 MiB，网络有超时，HTTP 错误或响应结构错误会终止并记录失败。

## 为什么使用此库

`repository`、`commits`、`releases` 三个模板共享 `owner`、`repo` 必填契约；`per_page` 可选。manifest 还声明变量类型和每项/整批预算。文件检查阶段只校验和计量，然后使用公共 `compileCatalog`、`inspect`、`expandMany` 生成实际传给 HTTP 的 URL；报告的 `executionPath` 为 `typed-catalog-sdk`。不同 URI 操作符、编码、必填预检、实际长度和展开都通过编译后的 MoonBit 核心执行，Node 负责文件位置、网络和报告。

客户端还执行 SDK 的整批输入预算，计入模板名、label、绑定及 JSON 标点；项目文件检查的变量输入预算只计序列化绑定。相同配置在客户端可能因新增的完整请求预算而失败，此时返回 `sdk-contract-failed`，不发送请求。默认示例预算覆盖这两层检查。

将 `owner` 改成 `owenr` 后，检查同时指出模板中缺少必填变量、配置中存在无用变量，并给出真实 JSON 文件的行列。错误中不输出绑定值，诊断仍含模板变量名和文件路径。GitHub Actions 模式可输出原生错误注解：

```sh
node ../../tools/cli.mjs project requests.json --github
```

文件列位置使用 UTF-16；模板内部同时保留 Unicode 码点和 UTF-16 位置。JSON 字符串含转义或代理对时也映射回原文件。发现问题时返回非零退出码，整个结果不包含部分成功 URL。

## 升级前审查

```sh
# 在本目录执行，两个参数分别是当前配置和候选配置；此命令不联网。
node upgrade.mjs requests.json candidate.json > upgrade-review.json
# 同一份配置可验证无变化流程：
npm run review -- requests.json requests.json
```

先检查基线配置，再比较目录的模板、必填和单项预算，以及应用层的变量类型、整批预算、请求内容/执行顺序。接着分别验证候选请求、旧请求在新定义下的结果，并检查所有生成地址是否仍满足客户端目标限制。只检查并生成报告，不应用升级、不修改输入、不发 HTTP。

| 状态 | 意义 | 退出码 |
| --- | --- | --- |
| unchanged | 在本工具检查的字段中没有变化，当前和旧请求均通过 | 0 |
| review-required | 有变化，所检查请求均通过，仍需人工审查 | 1 |
| blocked | 候选请求或旧请求有契约、预算、地址问题 | 1 |
| invalid-baseline / invalid-candidate / input-error | 基线、候选定义或文件无效，无法完成比较 | 2 |

例如新增必填查询参数后，即使候选请求已经补上它，旧请求遗漏仍会在 `existingRequests` 中失败。仅改变类型声明或整批预算也会被报告；不能只看 `catalog.requiresReview`。`requiresReview` 不证明兼容性，未覆盖未知调用方和 GitHub 的业务响应变化。旧请求复演的诊断文件名为 `<existing-requests-with-candidate-definitions>`，位置对应生成的复演文档，不伪称来自原文件。

报告保留输入 SHA-256、变量名和错误位置，不复制绑定值或完整生成 URL。模板定义和变量名本身仍可能是敏感信息。仓库根目录运行 `node tools/integration_evidence.mjs` 可复现六个明确标记的升级演练；它们是主动构造的测试，不是生产事故或实际 API 升级记录。

## 证据与边界

- `reports/github-integration-portable-live.json`：从独立解压包运行的新目录 SDK 接入记录，包括真实请求状态、时间、请求编号、响应正文摘要、返回提交 SHA、引擎及分发包摘要；直接运行 main.mjs 的默认报告另为 `reports/github-integration-live.json`。
- `reports/integration-faults.json`：刻意注入的配置故障及“没有网络请求”的验证，与真实联网结果分开。
- `reports/integration-upgrades.json`：六种主动构造的离线升级演练，包含比较结果、候选与旧请求复验、定义/脚本摘要，不能当作真实网络证据。
- `reports/history/github-integration-anonymous-failed.json`：首次匿名运行失败记录。
- `integration.test.mjs`：离线 HTTP 替身与故障测试，不冒充真实服务响应。

默认读取 cjyhjy、Magic486、JSJ222 的三个实际仓库。客户端展示的是当前公开版本；库的本地候选版本是否发布，以发布报告为准。使用的 API 见 [GitHub 仓库接口](https://docs.github.com/en/rest/repos/repos#get-a-repository)、[提交接口](https://docs.github.com/en/rest/commits/commits#list-commits)、[发行接口](https://docs.github.com/en/rest/releases/releases#list-releases)。
