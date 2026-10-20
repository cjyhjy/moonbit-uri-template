# MoonBit URI Template

RFC 6570 Level 4 URI Template 解析与展开库，核心使用 MoonBit 实现，无第三方运行时依赖。

**当前源码：0.2.0 候选版，新增预算、绑定预检、计量、批量/目录 API、类型化 Node SDK、文件诊断及实际 GitHub 接入，尚未正式发行到 GitHub Releases、Mooncakes 或 npm。已发布版本 0.1.1 的历史记录见 [交付记录](docs/ACCEPTANCE.md)；本轮本地验证见 [验收报告](reports/verification.json)。**

给定 `/users/{id}{?page}`，输入 `id="42"`、`page="2"`，得到 `/users/42?page=2`。

## 功能

- 全部八种展开方式：简单、保留字符、fragment、label、path、path parameter、query 和 query continuation。
- 字符串、列表、有序关联值；prefix 与 explode 修饰符。
- UTF-8 百分号编码、Unicode 码点前缀、未定义与空值语义。
- 解析后复用模板、查询引用的变量、结构化错误与源位置。
- 模板/变量/成员/输出预算、选择性必填、missing/omitted/unused 预检。
- 带源片段和 caret 的 CLI 诊断、稳定 JSON 输出和 UTF-16 编辑器偏移。
- 核心库支持 JS、wasm、wasm-gc、Native；Node CLI 与浏览器工作台调用同一份 MoonBit 核心。
- JS/TypeScript 直接导入、字面量变量名提示、编译复用；多模板批量与明确的配置拼写建议。
- 完整变量画像、逐次修饰符差异、目录审计；升级时检查必填和运行时预算变化。

固定上游提交 `4171dac22aa67fc710b3f6df308a50bd08552986` 的 270 个标准/扩展/负例测试，以及公共 API、预算、绑定与 JSON 适配测试，在四个后端执行；Node CLI 另有专项回归。具体数量与当前状态见报告。[详细证据](reports/verification.json)

## 本地开始

需要 Node.js 22+、Python 3.9+，以及工具链对应平台。运行时无需 npm 第三方依赖；开发检查使用锁定版本的 TypeScript。

```sh
python3 tools/bootstrap.py
npm ci --ignore-scripts
npm run build
node tools/cli.mjs expand '/users/{id}{?page}' --vars '{"id":"42","page":"2"}'
# /users/42?page=2
npm test
```

bootstrap 只在项目 `.toolchain/` 内安装，不修改 shell 配置。固定 MoonBit 编译器 `0.10.15+943464bfa` 并校验下载文件。自动安装已准备 macOS arm64 与 Linux x86_64；其他平台可自行安装同版本官方工具链，`tools/moon` 会回退到 PATH 中的 `moon`。官方历史二进制存在保留期限；如固定下载过期，应显式更新并重新验收，禁止静默使用 latest。

## Node / TypeScript 快速接入

本地构建后可从 `./sdk/index.mjs` 导入。独立项目使用分发包内的 `.tgz` 安装；候选版尚未发布到 npm。

```ts
import { compileTemplate } from './sdk/index.mjs';

const user = compileTemplate('/users/{id}{?page}', { required: ['id'] });
user.expand({ id: '42' });                    // /users/42
user.expand({ id: '42', page: '2' });         // /users/42?page=2
user.expandMany([{ id: '42' }, { id: '99' }]); // 复用同一模板，失败时不返回半批结果
```

变量名与必填参数可获得 TypeScript 提示。完整安装、错误处理、预算及迁移边界见 [SDK 接入指南](docs/SDK.md)。

## MoonBit API

下游包的 `moon.pkg`：

```text
import {
  "cjyhjy/uri_template" @uri,
}
```

示例：

```moonbit
let vars = @uri.Variables::new()
vars.set("id", @uri.Scalar("42"))
vars.set("page", @uri.Scalar("2"))
match @uri.parse("/users/{id}{?page}") {
  Ok(template) => {
    match template.expand(vars) {
      Ok(uri) => println(uri)
      Err(error) => println(error.message)
    }
  }
  Err(error) => println(error.message)
}
```

一次性调用 `@uri.expand(source, vars)`；重复使用时保留解析后的 `Template`。使用 `OrderedEntries::from_entries` 构造关联值，重复键会报错。`Variables::set` 复制集合输入，防止调用者意外修改已绑定值。

模块已发布到 Mooncakes，命名空间 `cjyhjy/uri_template`。下游先运行 `moon add cjyhjy/uri_template@0.1.1`，再在 `moon.pkg` 中导入。也可使用本地 `moon.work` 联合开发；归档消费和注册表消费均已验证。

```sh
./tools/moon run examples --target js
# /users/42?page=2
# /users/99?page=2
```

完整接口见 [API 文档](docs/API.md) 与编译器生成的 [接口快照](pkg.generated.mbti)。

## CLI

```sh
node tools/cli.mjs expand '/search{?q,tags*}' --vars-file examples/search.json
# /search?q=moon%20bit&tags=sdk&tags=api

node tools/cli.mjs expand 'https://example.com{+path}{#fragment}' --vars-file examples/resource.json
# https://example.com/docs/%E4%B8%AD%E6%96%87#overview

node tools/cli.mjs variables '/users/{id}{?page,id}'
# ["id","page"]

node tools/cli.mjs validate '/users/{id'
# stderr: UnclosedExpression at 1:8 (code points 7..10): expected closing brace
# exit code: 1
```

支持 `expand`、`measure`、`trace`、`project`、`check`、`validate`、`variables`、`--help` 和 `--version`。`expand` 成功只向 stdout 输出 URI，错误到 stderr。退出码：0 成功，1 模板/展开错误，2 参数/JSON/文件/环境错误。模板在 shell 中应加引号。

JSON 变量接受字符串、字符串数组、字符串或 null 值的对象，以及 null。数字和布尔值应由调用者显式转换成字符串；嵌套集合报带 JSON Pointer 的类型错误。JSON 关联值按键排序，核心关联值保持输入顺序。

### 预算、预检与选择性必填

```sh
node tools/cli.mjs check '/users/{id}{?page}' --vars '{"paeg":"2"}' --json
node tools/cli.mjs expand '/users/{id}{?page}' --vars '{"id":"42"}' --required id --max-output 128
node tools/cli.mjs validate '中文😀/{id' --json
```

`check` 区分未绑定、空集合省略、多余绑定和类型冲突；有发现时退出 1。`--required` 可重复，`--require-all` 要求所有变量，`--reject-unused` 拒绝多余绑定；这些均为可选业务策略。CLI 默认使用有界核心入口，完整限额与错误协议见 [API 文档](docs/API.md)。终端片段转义 Unicode/控制字符以保证标记对齐，浏览器直接高亮原字符。

工作台在浏览器 worker 内调用同核，输入仅在本机计算；`npm run playground` 启动的服务器只提供六个静态文件，不暴露仓库目录。示例覆盖正常展开、遗漏、输出边界、中文/emoji 诊断。便携包可直接 `node tools/serve-playground.mjs`。

## 项目契约检查与真实接入

```sh
node tools/cli.mjs project integrations/github-audit/requests.json --json
node tools/cli.mjs project integrations/github-audit/requests.json --github
node tools/cli.mjs measure '/users/{id}' --vars '{"id":"42"}'
node tools/cli.mjs trace '/users/{id}' --vars '{"id":"42"}'
# 以下命令会通过已登录的 GitHub CLI 发出 9 个只读 HTTP 请求
npm run integration:live
```

[GitHub 仓库巡检工具](integrations/github-audit/README.md)实际读取三个公开仓库。先检查整个请求目录的必填、类型、无用绑定与总预算，再执行网络请求；JSON 文件诊断支持转义/emoji 行列和 Actions 注解。检查失败不返回部分 URI。真实联网记录与故障注入证据分开保存。

MoonBit SDK 另提供 `measure`、原子 `expand_batch`、`compile_catalog`、固定部分变量的 `bind`、`expand_mapped`、`audit`、`diff` 和显式稀疏集合规范化。计量和输出使用同一编码器。映射精确到变量出现位置，包含该变量产生的分隔符，不细分列表成员。[新增 API 和契约](docs/API.md)

本轮改进及重新审核参考见 [复审材料入口](docs/RESUBMISSION.md)。这些是技术补充材料，不能替代参赛者按表单要求独立撰写的一页申报书。

## 兼容性边界

遵循 RFC 的合法表达式和展开语义。为兼容上游两个单引号夹具，默认模板 literal 中的 ASCII 单引号被接受并原样保留；这是相对第 2.1 节 literal ABNF 的明确扩展，详见 [差异记录](docs/CONFORMANCE.md)。没有跳过或修改上游样例。需要严格语法检查可使用 `parse_strict` 或 `node tools/cli.mjs validate TEMPLATE --strict`。

缺失变量默认省略。展开仅生成 URI 引用，不执行 HTTP 请求、URL 规范化或反向路由匹配；不自动进行 Unicode NFC 归一化。关联对象输出顺序由调用接口决定。具体行为与标准一致性声明以固定语料和公开差异记录为依据，不代表第三方认证。

## 验证、演示与发布

```sh
npm test                     # 格式、API、四后端测试、CLI、包与独立下游
npm run demo                 # 三组成功示例与一组错误诊断
npm run playground           # 本地交互工作台：http://127.0.0.1:4173
npm run compare:peers        # 固定同类源码、四后端测试与共享探针
node tools/benchmark.mjs      # 纯核心解析复用基准，输出原始测量记录
./tools/moon package --list   # 检查 Mooncakes 包内容
```

[GitHub Actions 工作流](.github/workflows/ci.yml) 运行相同的验收脚本并上传证据；配置存在不等于远程 CI 已运行。报告包含工具链、源码摘要、上游提交和逐文件测试统计。

| 文档 | 内容 |
| --- | --- |
| [架构](docs/ARCHITECTURE.md) | 模块、数据模型、运行方式和设计决策 |
| [测试策略](docs/TEST_STRATEGY.md) | 标准夹具、回归点和发布门槛 |
| [交付验收](docs/ACCEPTANCE.md) | 已完成证据与外部待办 |
| [生态定位](docs/ECOSYSTEM.md) | 已存在的同类项目与本项目可验证特点 |
| [同类比较](docs/COMPARISON.md) | 源码与小样例核查、当前差异及可用性改进计划 |
| [CI 排查](docs/CI_INVESTIGATION.md) | 夹具漂移证据、工具修复与失败报告边界 |
| [项目规划](docs/PROJECT_PLAN.md) | 原始日程、范围与任务 |
| [技术参考](docs/PROPOSAL.md) | 项目事实参考；正式申报书需由参赛者自己写 |
| [发布流程](docs/RELEASE.md) | 注册、包名确认、公开发布与版本验证 |
| [AI 辅助说明](docs/AI_USAGE.md) | 开发方式和参赛者需掌握的内容 |

## 来源与许可证

Apache-2.0，见 [LICENSE](LICENSE)。本项目为根据规范编写的实现；未复制其他语言实现的核心代码。测试夹具来自 [uri-templates/uritemplate-test](https://github.com/uri-templates/uritemplate-test)，保留 [原许可证](testdata/upstream/LICENSE)。规范依据 [RFC 6570](https://www.rfc-editor.org/rfc/rfc6570)。完整来源见 [NOTICE](NOTICE) 与 [研究记录](docs/RESEARCH.md)。

生态中已存在其他 RFC 6570 库；本项目是独立实现，不宣称首个或唯一。正式赛事申报书应由参赛者自己撰写，AI 辅助的技术参考文档不能直接用作申报书。
