# Octokit endpoint 接入验证

在固定版本的真实第三方项目 `octokit/endpoint.js` 中，将 URL 模板展开接到已发布的 `moonbit-uri-template@0.5.1`。上游提交、源码 SHA-256 和 SDK integrity 固定在 [manifest.json](manifest.json)。

需要 Node.js 22+、npm 和 Python 3.9+。从本仓库根目录运行：

```sh
python3 integrations/octokit-endpoint/run.py --download  # 首次下载固定源码和依赖
python3 integrations/octokit-endpoint/run.py             # 使用缓存离线重放
python3 integrations/octokit-endpoint/run.py --live      # 额外执行一次匿名 GitHub GET
```

运行器依次验证原版与接入版的 59 项上游测试、原有 100% 覆盖率门槛和构建，再执行 8 项客户端检查。上游测试文件保持原样；报告写入 `reports/octokit-endpoint.json`，源码、依赖和日志留在忽略的 `_build/octokit-endpoint/` 中。GitHub Actions 的 `Verify Octokit endpoint integration` 工作流从空缓存复现，默认不请求公共 API。

直接替换旧 helper 有 3 项预期失败：尾斜杠约定和 bigint ID。适配器保留 Octokit 去尾斜杠的行为、把 bigint URL ID 转成十进制字符串，并只传入模板引用的变量，避免处理无关的二进制 body。

还有一项明确的兼容差异：旧 helper 将 `{?tags*}` 列表按逗号连接，本库按 RFC 6570 使用 `&`。两种输出均由独立探针验证。SDK 要求 Node >=22，上游声明 >=20，因此这里不承诺 Node 20 支持，也不宣称任意场景都可直接替换。

这是自行执行的第三方接入实验，不代表上游采用或独立用户反馈。第三方源码及其 MIT/BSD notice 保留在下载缓存，不随本仓库分发；适配器和运行器为本项目代码。
