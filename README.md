# MoonBit URI Template

RFC 6570 Level 4 URI 模板库。核心用 MoonBit 编写，无第三方运行时依赖，可运行于 JS、wasm、wasm-gc 和 Native；同一份核心还提供 Node/TypeScript SDK、命令行和浏览器工作台。

```text
/users/{id}{?page,tags*}  +  id=42, page=2, tags=[sdk, api]
→ /users/42?page=2&tags=sdk&tags=api
```

版本：0.3.0，已发布到 Mooncakes（`cjyhjy/uri_template`）和 npm（`moonbit-uri-template`，带来源证明）。

## 为什么用它

- **展开结果和主流实现一致。** 除 270 条上游标准用例外，另有 644 条用例与 Python `uritemplate`、`std-uritemplate` 逐字节比对，其中 583 条三方完全一致，其余分歧逐条说明理由（见 [一致性](docs/CONFORMANCE.md)）。前缀截断按原始码点计数，与两个参考实现一致；另外两个 MoonBit 同类库在这里都与参考实现不同。
- **发请求前发现配置错误。** 可选择性声明必填变量和值类型（标量/列表/关联），并检查无用绑定和输入/输出预算；出错时给出模板位置、JSON 文件行列和拼写修复建议。
- **按 JS 开发者习惯工作。** 数字和布尔值会自动转成字符串，`undefined` 视为未绑定，对象成员保持插入顺序；TypeScript 能从字面量模板推导变量名并检查必填项。
- **直接使用 OpenAPI 描述。** OpenAPI 用 RFC 6570 定义参数怎样进入 URL。本项目把每个接口的路径和 query 参数转换成一个 URI 模板，按接口名生成请求地址；GitHub 官方描述的 1242 个接口全部转换并检查只需 0.4 秒，查出 2 处违反规范的路径和 2 处与声明不符的示例（[OpenAPI](docs/OPENAPI.md)）。
- **快。** 固定负载下，与两个同类库同机对比，全部场景的耗时中位数最低（[性能](docs/PERFORMANCE.md)）。

## Node / TypeScript

```ts
// npm install moonbit-uri-template
import { compileTemplate } from 'moonbit-uri-template';

const user = compileTemplate('/users/{id}{?page}', { required: ['id'] });
user.expand({ id: 42 });               // /users/42
user.expand({ id: 42, page: 2 });      // /users/42?page=2
user.expandMany([{ id: 1 }, { id: 2 }]); // 任一失败则整批抛错，不返回半批结果
```

目录、批量、预检、升级比较和增量链接会话见 [SDK 指南](docs/SDK.md)。

## MoonBit

```text
// 下游 moon.pkg
import { "cjyhjy/uri_template" @uri }
```

```moonbit
let vars = @uri.Variables::from_entries([
  ("id", @uri.Scalar("42")),
  ("page", @uri.Scalar("2")),
]).unwrap()
let template = @uri.parse("/users/{id}{?page}").unwrap()
println(template.expand(vars).unwrap()) // /users/42?page=2
// 有界并检查必填：
template.expand(vars, required=["id"], limits=@uri.ExpansionLimits::new())
```

安装：`moon add cjyhjy/uri_template@0.3.0`。全部接口见 [API](docs/API.md) 与 [接口快照](pkg.generated.mbti)。

## 命令行

```sh
node tools/cli.mjs expand '/search{?q,tags*}' --vars '{"q":"moon bit","tags":["sdk","api"]}'
# /search?q=moon%20bit&tags=sdk&tags=api

node tools/cli.mjs check '/users/{id}{?page}' --vars '{"paeg":2}'
# 报告 missing: id, page；unused: paeg；退出码 1

node tools/cli.mjs validate '/users/{id'
# UnclosedExpression at 1:8 (code points 7..10): expected closing brace
#   /users/{id
#          ^^^

node tools/cli.mjs project integrations/github-audit/requests.json --github
# 一次检查整个请求配置，输出 GitHub Actions 注解

node tools/cli.mjs openapi api.github.com.json
# api.github.com.json:29475:50 EquivalentPaths: same path hierarchy as /orgs/{org}/attestations/{attestation_id}
```

命令：`expand`、`measure`、`trace`、`check`、`validate`、`variables`、`analyze`、`compare`、`project`、`openapi`。退出码 0 成功，1 模板或检查问题，2 参数/文件/JSON 错误。

## 从源码开始

需要 Node.js 22+ 和 Python 3.9+。

```sh
python3 tools/bootstrap.py   # 在 .toolchain/ 内安装固定版本的 MoonBit 工具链
npm ci --ignore-scripts
npm run build
npm test                     # 四后端测试、SDK、CLI、差分回放、打包与独立消费者
npm run playground           # 浏览器工作台 http://127.0.0.1:4173
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [SDK](docs/SDK.md) | Node/TypeScript 接入 |
| [API](docs/API.md) | MoonBit 公共接口 |
| [一致性](docs/CONFORMANCE.md) | RFC 语义选择、上游用例与差分结果 |
| [同类对比](docs/COMPARISON.md) | 与 Magic486、JSJ222 的功能和行为对比 |
| [OpenAPI](docs/OPENAPI.md) | 从 OpenAPI 描述生成模板、检查与公开文档实测 |
| [性能](docs/PERFORMANCE.md) | 基准方法与结果 |
| [架构](docs/ARCHITECTURE.md) | 模块划分与测试策略 |
| [发布](docs/RELEASE.md) | 打包、发布与工具链维护 |
| [GitHub 接入案例](integrations/github-audit/README.md) | 真实下游客户端 |
| [公共 API 客户端](integrations/public-clients/README.md) | npm、Open Library 只读客户端 |
| [AI 辅助说明](docs/AI_USAGE.md) | 开发方式 |

## 范围

只生成 URI 引用：不发 HTTP 请求，不做 URL 规范化、反向路由匹配或 Unicode 归一化。模板字面量默认接受 ASCII 单引号以兼容上游用例，`parse_strict` / `strict: true` 按 RFC 语法拒绝。

## 来源与许可证

Apache-2.0。依据 [RFC 6570](https://www.rfc-editor.org/rfc/rfc6570) 独立实现，未复制其他实现的代码。测试用例来自 [uri-templates/uritemplate-test](https://github.com/uri-templates/uritemplate-test)，保留其[许可证](testdata/upstream/LICENSE)。详见 [NOTICE](NOTICE)。
