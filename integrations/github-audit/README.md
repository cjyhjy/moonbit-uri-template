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

`repository`、`commits`、`releases` 三个模板共享 `owner`、`repo` 必填契约；`per_page` 可选。manifest 还声明变量类型和每项/整批预算。不同 URI 操作符、编码、必填预检、实际长度和展开都通过编译后的 MoonBit 核心执行，Node 负责文件位置、网络和报告。

将 `owner` 改成 `owenr` 后，检查同时指出模板中缺少必填变量、配置中存在无用变量，并给出真实 JSON 文件的行列。错误中不输出绑定值，诊断仍含模板变量名和文件路径。GitHub Actions 模式可输出原生错误注解：

```sh
node ../../tools/cli.mjs project requests.json --github
```

文件列位置使用 UTF-16；模板内部同时保留 Unicode 码点和 UTF-16 位置。JSON 字符串含转义或代理对时也映射回原文件。发现问题时返回非零退出码，整个结果不包含部分成功 URL。

## 证据与边界

- `reports/github-integration-live.json`：真实请求状态、时间、请求编号、响应正文摘要、返回提交 SHA，以及使用的引擎摘要。
- `reports/integration-faults.json`：刻意注入的配置故障及“没有网络请求”的验证，与真实联网结果分开。
- `reports/history/github-integration-anonymous-failed.json`：首次匿名运行失败记录。
- `integration.test.mjs`：离线 HTTP 替身与故障测试，不冒充真实服务响应。

默认读取 cjyhjy、Magic486、JSJ222 的三个实际仓库。客户端展示的是当前公开版本；库的本地候选版本是否发布，以发布报告为准。使用的 API 见 [GitHub 仓库接口](https://docs.github.com/en/rest/repos/repos#get-a-repository)、[提交接口](https://docs.github.com/en/rest/commits/commits#list-commits)、[发行接口](https://docs.github.com/en/rest/releases/releases#list-releases)。
