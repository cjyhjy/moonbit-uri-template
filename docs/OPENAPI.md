# OpenAPI

OpenAPI 用 RFC 6570 定义参数怎样进入 URL（OpenAPI 3.1.1 附录 C）。本项目据此把每个接口的路径参数和 query 参数转换成一个完整的 URI 模板，再用核心检查和展开：

```text
GET /repos/{owner}/{repo}/commits
→ /repos/{owner}/{repo}/commits{?sha,path,author,committer,since,until,per_page,page}
```

支持 OpenAPI 3.0.x、3.1.x 的 JSON 文档。

## 在代码里使用

```js
import { compileOpenApi } from 'moonbit-uri-template/openapi';

const github = compileOpenApi(spec, { baseUrl: 'https://api.github.com' });
github.expand('repos/list-commits', { owner: 'cjyhjy', repo: 'moonbit-uri-template', since: '2026-10-01T00:00:00Z', per_page: 5 });
// https://api.github.com/repos/cjyhjy/moonbit-uri-template/commits?since=2026-10-01T00%3A00%3A00Z&per_page=5

github.expand('repos/list-commits', { owner: 'a', repo: 'b', perpage: 5 });
// UnknownParameter: repos/list-commits has no parameter perpage
```

- 接口按 `operationId` 或 `"GET /path"` 查找。
- 路径参数和 `required: true` 的 query 参数必须提供；schema 类型明确时检查值的形状（标量、列表、对象）。
- header、cookie 参数可以一起传入，不进入 URL。
- 参数名不符合 RFC 6570 变量名语法时按附录 C.3 百分号编码，例如 `filter[since]` 在模板中是 `filter%5Bsince%5D`。
- GitHub 的完整描述（13.5 MB、1242 个接口）编译约 60 ms；之后每次展开约 4 µs。
- `strict: true` 时，文档有任何错误级诊断都会抛出 `OpenApiInvalid`。

## 命令行

```sh
node tools/cli.mjs openapi spec.json              # 诊断和汇总
node tools/cli.mjs openapi spec.json --templates  # 每个接口的模板
node tools/cli.mjs openapi spec.json --json       # 结构化报告，含每个接口的模板和示例 URL
node tools/cli.mjs openapi spec.json --max-bytes 67108864   # 默认上限 32 MiB
npm run openapi:public                            # 检查 GitHub、Stripe、Cloudflare 的官方描述
```

退出码：0 无错误（可以有警告），1 有错误，2 输入无效或检查不完整（外部引用、OpenAPI 3.2、超过上限等）。

## 公开文档的检查结果

`npm run openapi:public` 下载固定提交的官方描述，校验 SHA-256 后检查，结果写入 `reports/openapi-public.json`。

| 文档 | 大小 | 接口 | 生成模板 | 无对应写法的参数 | 错误 | 警告 | 耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [GitHub](https://github.com/github/rest-api-description/blob/755ee33b4a81d51f6f07a902cce26cbec3b822f2/descriptions/api.github.com/api.github.com.json) `755ee33` | 13.5 MB | 1242 | 1242 | 0 | 2 | 2 | 0.4 s |
| [Stripe](https://github.com/stripe/openapi/blob/b339867409bf2fb41b6c3411804de1ec4ebf6a49/openapi/spec3.json) `b339867` | 8.3 MB | 612 | 612 | 366（`deepObject`） | 0 | 0 | 0.2 s |
| [Cloudflare](https://github.com/cloudflare/api-schemas/blob/b3bacb18fcfbb6c5b5c4e9cc0990d055673b39a4/openapi.json) `b3bacb1` | 27.5 MB | 3767 | 3767 | 0 | 0 | 1783 | 0.9 s |

**GitHub 的 2 个错误**是层级相同的路径：

```text
/orgs/{org}/attestations/{attestation_id}      DELETE
/orgs/{org}/attestations/{subject_digest}      GET
/users/{username}/attestations/{attestation_id} DELETE
/users/{username}/attestations/{subject_digest} GET
```

OpenAPI 规定“层级相同、只是变量名不同的路径 MUST NOT 同时存在，因为它们是同一个路径”。已报告给上游：[github/rest-api-description#7367](https://github.com/github/rest-api-description/issues/7367)。

**GitHub 的 2 个警告**：`GET /orgs/{org}/personal-access-tokens` 的 `owner`、`token_id` 声明为数组，示例却是序列化后的字符串 `"owner[]=octocat1,owner[]=octocat2"`。按声明，模板是 `{?owner*}`，展开为 `owner=octocat1&owner=octocat2`；示例暗示服务端期望的参数名是 `owner[]`。

**Cloudflare 的 1783 个警告**都是 `ExampleShapeMismatch`：schema 为数组，示例却是单个值（如 `action_result` 的 `"success"`）或拼好的字符串（如 `fields` 的 `"uuid,name,version"`）。OpenAPI 规定参数示例 SHOULD 符合其 schema。

## 检查项

错误：

| 代码 | 含义 |
| --- | --- |
| `MissingPathParameter` | 路径中的 `{name}` 在该接口及其 Path Item 中都没有声明 |
| `UnusedPathParameter` | 声明了路径参数，路径中却没有 |
| `PathParameterRequired` | 路径参数没有 `required: true` |
| `DuplicateParameter` | 同一参数列表中 `in` 和 `name` 重复 |
| `DuplicateOperationId` | `operationId` 重复 |
| `EquivalentPaths` | 层级相同的模板路径 |
| `InvalidPath` / `InvalidPathTemplate` | 不以 `/` 开头；含查询串 `?` 或片段 `#`（片段不会发给服务器）；括号不配对；字面量含 RFC 3986 路径不允许的字符（如 `[`、`|`、未编码的中文） |

警告（不影响退出码）：

| 代码 | 含义 |
| --- | --- |
| `ExampleShapeMismatch` | 示例是标量、列表或对象，与 schema 类型不一致 |
| `ExampleNotSerializable` | 示例嵌套超过一层，RFC 6570 没有定义如何展开 |

同一个共享参数的示例问题只在定义处报告一次。

## 参数到模板的对应

| OpenAPI | RFC 6570 |
| --- | --- |
| 路径 `style: simple`（默认）/ `label` / `matrix` | `{x}` / `{.x}` / `{;x}` |
| query `style: form`（默认） | 同一接口的全部 form 参数合并为一个 `{?a,b}` |
| `explode: true`（form 默认） | `*`；schema 为标量时省略，结果相同 |
| header、cookie | 不进入 URL |

没有对应写法的参数会列在接口的 `unsupported` 中，不会被猜测：`deepObject`、`pipeDelimited`、`spaceDelimited`、`form` 与 `allowReserved: true` 同时使用，以及用 `content` 描述的参数。示例 URL 只在每个路径参数都有可用示例时生成。

## 其他规则

- Path Item 级参数由每个接口继承，接口级按 `(in, name)` 覆盖；一个接口的声明不会替另一个接口补缺。
- 没有任何接口的 Path Item（例如按权限过滤后）不要求声明路径参数。
- 文档内的 `$ref` 按 JSON Pointer 解析，支持 `~0` `~1` 和百分号解码；外部引用、循环引用和缺失目标会让报告标为不完整。
- 诊断给出 JSON Pointer 和文件行列。

不检查 schema 本身、响应、security 和 server URL；YAML 文档需要先转换成 JSON。
