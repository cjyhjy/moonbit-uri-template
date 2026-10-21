# 发布

## 名称

- GitHub：`cjyhjy/moonbit-uri-template`
- Mooncakes：`cjyhjy/uri_template`，已发布 0.2.0（2026-10-21）
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

0.2.0 的发布日志见 `reports/publish-0.2.0.log`；全新工程从注册表安装并通过四后端运行的记录见 `reports/registry-0.2.0.json`。

0.1.1 的历史发布日志和注册表安装记录见 `reports/publish-0.1.1.log`、`reports/registry.json`。

## npm

`package.json` 和 `moon.mod` 的版本必须一致。推送 `v<版本>` 标签会触发
`.github/workflows/publish-npm.yml`：安装固定工具链、运行 `npm test`，沿用
`tools/verify_sdk_package.mjs` 验证全新目录中的 tarball 安装、运行时和类型检查，
随后核对 SHA-256 并发布同一个 tarball，启用 npm provenance。

发布使用 GitHub Trusted Publishing（OIDC），不配置 `NPM_TOKEN`。
在 npm 包设置的 Trusted Publisher 中选择 GitHub Actions，填写用户 `cjyhjy`、
仓库 `moonbit-uri-template`、工作流 `publish-npm.yml`，Environment 留空，允许直接发布。
工作流使用 Node 24 和固定 npm 11.19.0，通过 `id-token: write` 取得短期身份凭证。

首次创建包时，可先在本机使用 `npm stage publish <已验证的tgz>` 创建待批准版本。
npm 会为新包建立公开的 `0.0.0-stage` 占位版本；本机暂存版本不要批准。
配置可信发布者后，拒绝本机暂存记录，再推送正式标签，让 GitHub 构建并发布正式版本。
身份验证由账号持有人在 npm 页面完成。正式版本必须验证 provenance 和注册表安装。

```sh
git tag v0.2.0
git push origin v0.2.0
```

标签应指向已提交并审核的发布内容。只有工作流成功且在全新目录中执行
`npm install moonbit-uri-template@0.2.0`、验证 SDK 和 CLI 后，才记录 npm 发布完成。
npm 同名同版本不能重复发布；认证配置应在推送标签前完成。

## GitHub Release

推送标签后确认 Actions 运行成功，再附上便携包。[v0.1.1](https://github.com/cjyhjy/moonbit-uri-template/releases/tag/v0.1.1) 对应提交 `d0a71cd`。

## 工具链

`toolchain.lock.json` 固定编译器版本和下载校验值。官方历史二进制大约保留 60 天，过期后需要显式升级、更新校验值、重跑全部后端，不能自动改用 latest。
