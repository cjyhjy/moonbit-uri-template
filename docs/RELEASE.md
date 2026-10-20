# 发布

## 名称

- GitHub：`cjyhjy/moonbit-uri-template`
- Mooncakes：`cjyhjy/uri_template`，已发布 0.1.1
- npm：未发布；分发包内含 `moonbit-uri-template-0.2.0.tgz`

## 便携分发包

```sh
npm run release:package
```

生成 `_build/releases/moonbit-uri-template-<版本>.zip`，内含编译后的核心、CLI、SDK tarball、示例、测试、许可证、Mooncakes 源码包和逐文件 SHA-256。脚本会解压产物并重新运行全部 Node 测试。使用者只需要 Node.js 22+。

## Mooncakes

1. `npm test` 全部通过，检查 `./tools/moon package --list` 的包内容。
2. `./tools/moon login`，凭据不进仓库。
3. 确认 `moon.mod` 的版本号后执行 `./tools/moon publish`。
4. 在全新工程中执行 `moon add cjyhjy/uri_template@<版本>` 并运行示例，确认注册表安装可用。

0.1.1 的发布日志和注册表安装记录见 `reports/publish-0.1.1.log`、`reports/registry.json`。

## GitHub Release

推送标签后确认 Actions 运行成功，再附上便携包。[v0.1.1](https://github.com/cjyhjy/moonbit-uri-template/releases/tag/v0.1.1) 对应提交 `d0a71cd`。

## 工具链

`toolchain.lock.json` 固定编译器版本和下载校验值。官方历史二进制大约保留 60 天，过期后需要显式升级、更新校验值、重跑全部后端，不能自动改用 latest。
