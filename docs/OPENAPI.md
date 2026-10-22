# OpenAPI 路径检查

OpenAPI 的路径是 URI 模板。`uri-template openapi` 用本库的核心解析每条路径，再逐个接口核对路径参数的声明。

```sh
node tools/cli.mjs openapi examples/openapi.json          # Checked 1 OpenAPI operations
node tools/cli.mjs openapi spec.json --json               # 结构化报告
node tools/cli.mjs openapi spec.json --max-bytes 67108864 # 默认上限 32 MiB
npm run openapi:public                                    # 检查 GitHub、Stripe 的官方描述
```

支持 OpenAPI 3.0.x、3.1.x 的 JSON 文档。

## 公开文档的检查结果

`npm run openapi:public` 下载固定提交的官方描述，校验 SHA-256 后检查，结果写入 `reports/openapi-public.json`。

| 文档 | 大小 | 接口 | 耗时 | 发现 |
| --- | --- | --- | --- | --- |
| [github/rest-api-description](https://github.com/github/rest-api-description/blob/755ee33b4a81d51f6f07a902cce26cbec3b822f2/descriptions/api.github.com/api.github.com.json) `755ee33` | 13.5 MB | 1242 | 0.4 s | 2 处 `EquivalentPaths` |
| [stripe/openapi](https://github.com/stripe/openapi/blob/b339867409bf2fb41b6c3411804de1ec4ebf6a49/openapi/spec3.json) `b339867` | 8.3 MB | 612 | 0.2 s | 无 |

GitHub 的两处：

```text
/orgs/{org}/attestations/{attestation_id}      DELETE
/orgs/{org}/attestations/{subject_digest}      GET
/users/{username}/attestations/{attestation_id} DELETE
/users/{username}/attestations/{subject_digest} GET
```

OpenAPI 规定“层级相同、只是变量名不同的路径 MUST NOT 同时存在，因为它们是同一个路径”。按路径匹配请求的路由和代码生成器只能靠 HTTP 方法区分这两组接口。已报告给上游：[github/rest-api-description#7367](https://github.com/github/rest-api-description/issues/7367)。

## 检查项

| 代码 | 含义 |
| --- | --- |
| `MissingPathParameter` | 路径中的 `{name}` 在该接口及其 Path Item 中都没有声明 |
| `UnusedPathParameter` | 声明了路径参数，路径中却没有 |
| `PathParameterRequired` | 路径参数没有 `required: true` |
| `DuplicateParameter` | 同一参数列表中 `in` 和 `name` 重复 |
| `EquivalentPaths` | 层级相同的模板路径 |
| `InvalidPath` / `InvalidPathTemplate` | 不以 `/` 开头、含 `?` `#`、括号不配对，或字面量含 RFC 3986 路径不允许的字符（如 `[`、`|`、未编码的中文） |

- Path Item 级参数由每个接口继承，接口级按 `(in, name)` 覆盖；一个接口的声明不会替另一个接口补缺。
- 没有任何接口的 Path Item（例如按权限过滤后）不要求声明路径参数。
- 文档内的 `$ref` 按 JSON Pointer 解析，支持 `~0` `~1` 和百分号解码；外部引用、循环引用和缺失目标会让报告标为不完整。
- 占位符名称按原样比较，区分大小写，允许连字符和中文；内部先映射成 `v0`、`v1` 再交给核心，因为 OpenAPI 名称不受 RFC 6570 变量名语法限制。
- 诊断给出 JSON Pointer 和文件行列，路径类问题指向对应的 Path Item。

退出码：0 通过，1 发现问题，2 输入无效或检查不完整（外部引用、OpenAPI 3.2、超过上限等）。成功输出写 stdout，失败写 stderr。

不检查 schema、响应、security、server URL 和 query 参数序列化；YAML 文档需要先转换成 JSON。
