# MoonBit 原生 GitHub 客户端

一个独立的 MoonBit 程序（native 后端）：读入 GitHub 官方 OpenAPI 描述，用 `cjyhjy/uri_template/openapi` 按 operationId 生成地址，再用 `moonbitlang/async` 发出 HTTPS 请求。依赖直接从 Mooncakes 安装，与任何下游项目的用法相同。

```text
moon.mod: import { "cjyhjy/uri_template@0.4.0", "moonbitlang/async@0.22.5" }
```

## 运行

需要 C 编译器和系统 TLS 库（macOS：Xcode Command Line Tools；Ubuntu：gcc、libssl3）。

```sh
python3 tools/bootstrap.py                       # 固定版本的 MoonBit 工具链
python3 integrations/moonbit-github/run.py         # 只打印请求计划
python3 integrations/moonbit-github/run.py --live  # 发出 3 个只读 GET
```

首次运行会下载固定提交、校验 SHA-256 的 GitHub 描述（`upstream.json`）。`requests.json` 是请求配置：

```json
{"operationId": "repos/list-commits", "variables": {"owner": "cjyhjy", "repo": "moonbit-uri-template", "per_page": 2}}
```

计划输出：

```text
https://api.github.com/repos/cjyhjy/moonbit-uri-template
https://api.github.com/repos/cjyhjy/moonbit-uri-template/commits?per_page=2
https://api.github.com/repos/cjyhjy/moonbit-uri-template/releases?per_page=2
```

## 行为

- 只允许 `repos/get`、`repos/list-commits`、`repos/list-releases` 三个 GET 接口，核对方法和路径，固定 `https://api.github.com`，不跟随重定向，不需要令牌。
- 所有请求先整体预检；任何一条缺参数（`MissingBinding`）、参数名写错（`UnknownParameter`）或所选接口的描述有错误，一个请求都不发。
- 每份配置最多 8 个请求；描述最大 32 MiB，配置 64 KiB，每个响应 1 MiB（流式读取），每个请求 15 秒。
- 核对响应中的仓库名、提交 SHA 和发行版，输出请求编号与摘要。
- 退出码：0 成功；1 HTTP 状态异常、响应不符、超限、超时或网络错误；2 配置、输入或预检错误。

## 验证

```sh
python3 tools/verify_native_client.py         # 在全新临时工程中从 Mooncakes 安装依赖，运行 16 项 native 测试和 CLI 检查
python3 tools/verify_native_client.py --live  # 另外发出 3 个真实请求
```

测试覆盖地址展开、错误码、整批预检、回环 HTTP 上的请求头、重定向拒绝、响应上限和超时。CI（`.github/workflows/native-client.yml`）在 Linux 上运行离线检查；手动触发时可加真实请求。记录见 `reports/native-client-offline.json`、`reports/native-client-live.json`、`reports/native-client-linux-live.json`。
