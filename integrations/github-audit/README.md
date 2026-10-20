# GitHub 仓库巡检客户端

一个真实的下游程序：从配置文件读取三个公开仓库，用本库生成 GitHub REST API 地址，先检查整份请求配置，通过后再读取仓库信息、最新提交和发行列表。

## 运行

```sh
npm run build                                                     # 源码仓库中需要；便携包里不需要
node tools/cli.mjs project integrations/github-audit/requests.json --json  # 只检查，不联网
node integrations/github-audit/main.mjs --gh                      # 发出 9 个只读 GET
```

`--gh` 通过已登录的 GitHub CLI 发请求，不读取或保存令牌；不加时使用匿名请求，可能被限流。客户端只允许访问固定的 GitHub API 路径，每个响应限制 1 MiB，并设有超时。

## 用到了库的哪些能力

- `repository`、`commits`、`releases` 三个模板共享必填的 `owner`、`repo`，`per_page` 可选；配置中还声明了变量类型和单项/整批预算。
- 用 `compileCatalog` 编译，`inspect` 预检，`expandMany` 原子生成全部 URL。任一请求有问题时不发任何请求。
- 把 `owner` 写成 `owenr`，会同时报告缺少必填变量和存在无用变量，并给出 JSON 文件的行列和改名建议：

```sh
node tools/cli.mjs project integrations/github-audit/requests.json --github
```

## 参数切换只刷新相关链接

`link-selection.mjs` 用 `startSession` / `update` 切换列表参数，只重新请求 URI 发生变化的 commits 和 releases，repository 链接沿用缓存。

## 升级前审查

```sh
node integrations/github-audit/upgrade.mjs requests.json candidate.json   # 不联网
```

比较两份配置的模板、必填项、类型、预算和请求，再分别用新定义校验候选请求和旧请求，并检查生成的地址是否仍在允许范围内。

| 状态 | 含义 | 退出码 |
| --- | --- | --- |
| unchanged | 没有变化，新旧请求都通过 | 0 |
| review-required | 有变化，请求都通过 | 1 |
| blocked | 候选请求或旧请求在新定义下失败 | 1 |
| invalid-* / input-error | 配置或文件无效 | 2 |

例如新增一个必填查询参数：候选请求已经补上，旧请求没补，旧请求会在 `existingRequests` 中失败。

## 记录

| 文件 | 内容 |
| --- | --- |
| `reports/github-integration-portable-live.json` | 从解压的便携包运行，9 个真实请求的状态、请求编号和响应摘要 |
| `reports/github-links-portable-live.json` | 参数切换：先 3 个请求，再只刷新 2 个 |
| `reports/integration-faults.json` | 三种故意构造的配置错误，均在发请求前被拦下 |
| `reports/integration-upgrades.json` | 六种离线升级演练 |

离线测试：`node --test integrations/github-audit/integration.test.mjs`。
