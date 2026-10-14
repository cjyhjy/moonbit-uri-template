# MoonBit URI Template

RFC 6570 Level 4 URI Template 解析与展开库，核心使用 MoonBit 实现，无第三方运行时依赖。

**版本：0.1.0。本地实现与验收已完成；公开仓库与 Mooncakes 发布状态见 [交付记录](docs/ACCEPTANCE.md)。**

给定 `/users/{id}{?page}`，输入 `id="42"`、`page="2"`，得到 `/users/42?page=2`。

## 功能

- 全部八种展开方式：简单、保留字符、fragment、label、path、path parameter、query 和 query continuation。
- 字符串、列表、有序关联值；prefix 与 explode 修饰符。
- UTF-8 百分号编码、Unicode 码点前缀、未定义与空值语义。
- 解析后复用模板、查询引用的变量、结构化错误与源位置。
- 核心库支持 JS、wasm-gc、Native；Node CLI 调用同一份 MoonBit 核心。

固定上游提交 `4171dac22aa67fc710b3f6df308a50bd08552986` 的 270 个标准/扩展/负例测试，以及 10 项公共 API/JSON 适配测试，均在三个后端通过；另有 23 项 Node CLI 测试。[详细证据](reports/verification.json)

## 本地开始

需要 Node.js 22+、Python 3.9+，以及工具链对应平台。无需 npm 第三方依赖。

```sh
python3 tools/bootstrap.py
npm run build
node tools/cli.mjs expand '/users/{id}{?page}' --vars '{"id":"42","page":"2"}'
# /users/42?page=2
npm test
```

bootstrap 只在项目 `.toolchain/` 内安装，不修改 shell 配置。固定 MoonBit 编译器 `0.10.15+943464bfa` 并校验下载文件。自动安装已准备 macOS arm64 与 Linux x86_64；其他平台可自行安装同版本官方工具链，`tools/moon` 会回退到 PATH 中的 `moon`。官方历史二进制存在保留期限；如固定下载过期，应显式更新并重新验收，禁止静默使用 latest。

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

**当前模块名 `cjyhjy/uri_template` 使用已确认的 GitHub 身份；Mooncakes 命名空间需在注册后确认。** 未公开发布前，使用本地 `moon.work` 将库和下游模块放入同一工作区。验收脚本已从打包产物创建独立工作区并验证导入；正式发布后再使用 `moon add` 安装。

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

支持 `expand`、`validate`、`variables`、`--help` 和 `--version`。`expand` 成功只向 stdout 输出 URI，错误到 stderr。退出码：0 成功，1 模板/展开错误，2 参数/JSON/文件/环境错误。模板在 shell 中应加引号。

JSON 变量接受字符串、字符串数组、字符串或 null 值的对象，以及 null。数字和布尔值应由调用者显式转换成字符串；嵌套集合报带 JSON Pointer 的类型错误。JSON 关联值按键排序，核心关联值保持输入顺序。

## 兼容性边界

遵循 RFC 的合法表达式和展开语义。为兼容上游两个单引号夹具，模板 literal 中的 ASCII 单引号被接受并原样保留；这是相对第 2.1 节 literal ABNF 的明确扩展，详见 [差异记录](docs/CONFORMANCE.md)。没有跳过或修改上游样例。

缺失变量默认省略。展开仅生成 URI 引用，不执行 HTTP 请求、URL 规范化或反向路由匹配；不自动进行 Unicode NFC 归一化。关联对象输出顺序由调用接口决定。具体行为与标准一致性声明以固定语料和公开差异记录为依据，不代表第三方认证。

## 验证、演示与发布

```sh
npm test                     # 格式、API、三后端测试、CLI、包与独立下游
npm run demo                 # 三组成功示例与一组错误诊断
node tools/benchmark.mjs      # 纯核心解析复用基准，输出原始测量记录
./tools/moon package --list   # 检查 Mooncakes 包内容
```

[GitHub Actions 工作流](.github/workflows/ci.yml) 运行相同的验收脚本并上传证据；配置存在不等于远程 CI 已运行。报告包含工具链、源码摘要、上游提交和逐文件测试统计。

| 文档 | 内容 |
| --- | --- |
| [架构](docs/ARCHITECTURE.md) | 模块、数据模型、运行方式和设计决策 |
| [测试策略](docs/TEST_STRATEGY.md) | 标准夹具、回归点和发布门槛 |
| [交付验收](docs/ACCEPTANCE.md) | 已完成证据与外部待办 |
| [项目规划](docs/PROJECT_PLAN.md) | 原始日程、范围与任务 |
| [申报说明](docs/PROPOSAL.md) | 项目价值、实现和交付材料 |
| [发布流程](docs/RELEASE.md) | 注册、包名确认、公开发布与版本验证 |
| [AI 辅助说明](docs/AI_USAGE.md) | 开发方式和参赛者需掌握的内容 |

## 来源与许可证

Apache-2.0，见 [LICENSE](LICENSE)。本项目为根据规范编写的实现；未复制其他语言实现的核心代码。测试夹具来自 [uri-templates/uritemplate-test](https://github.com/uri-templates/uritemplate-test)，保留 [原许可证](testdata/upstream/LICENSE)。规范依据 [RFC 6570](https://www.rfc-editor.org/rfc/rfc6570)。完整来源见 [NOTICE](NOTICE) 与 [研究记录](docs/RESEARCH.md)。
