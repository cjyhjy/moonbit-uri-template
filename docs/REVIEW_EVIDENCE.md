# MoonBit URI Template 增量功能与实际接入证据

本说明用于回应“项目选题与近期维护的 Mooncakes RFC 6570 同类库直接重叠”。本项目承认标准展开能力已经有同类实现，本轮交付围绕请求配置的业务契约检查、问题定位和实际下游接入形成增量。本文是 AI 辅助整理的技术附件，不是正式申报书。

## 交付与差异

| 实际任务 | 本次实现 | 核查位置 |
| --- | --- | --- |
| 路径参数必填、查询参数可选 | required 子集；missing 与空集合 omitted 分开；空字符串仍遵循 RFC 定义 | `bindings.mbt`、`bindings_test.mbt`、共享探针 |
| 发请求前查完整项目配置 | 一次读取目录和请求；类型、无用绑定、单项/总预算；任一失败不输出部分 URI | `tools/project.mjs`、项目/客户端测试 |
| 找到可修复的位置 | JSON Pointer、文件行列、转义/emoji 映射、requestIndex、拼写修复建议、GitHub Actions 注解 | `tools/json-source.mjs`、`tools/project.test.mjs` |
| 直接安装接入 | ESM/TypeScript 导入、变量名与必填类型提示、准备后复用、干净项目安装验证 | `sdk/`、`reports/sdk-package.json` |
| 有界处理与计量 | 源码/绑定/成员/值/输出预算；JSON 长度深度；计量共用输出遍历；整批预检后构造输出 | `limits.mbt`、`expander.mbt`、`advanced.mbt` |
| 多端点 SDK 管理 | 模板目录、固定部分变量、策略检查、变量画像、详细契约差异、目录静态/请求审计、显式稀疏成员规范化 | `catalog.mbt`、`analysis.mbt`、`catalog_audit.mbt`、`policy.mbt` |
| 升级配置前验证旧调用方 | 比较目录、类型、总预算及请求变化；候选请求和旧请求分别在新定义下校验，检查目标地址；离线报告和明确退出码 | `integrations/github-audit/upgrade.mjs`、`reports/integration-upgrades.json` |
| 交互查看与修复 | 变量画像、引用/错误跳转、独立候选约束和同绑定比较；编辑失效、取消及超时 | `playground/`、`reports/playground-browser.json`、三张验收图片 |
| 解释生成 URI 的来源 | 非空字面量或每个变量出现位置的输出范围，包含操作符分隔符 | `Template.expand_mapped`、标准语料交叉测试 |

Magic486 已有默认解析/输出预算与 CLI；JSJ222 已有计量、批量、目录、预绑定、策略和输出映射，新版另加入公共运行时类型契约及增量会话。这些通用能力不能宣称为本项目首创。本次补齐这些主要类别后，差异化重点转向**可直接运行的项目检查流程、可直接使用的类型化 Node 接口、文件源位置，以及变量级输出归因**。例如 `{?x,y}` 的共享探针中，本项目返回两条变量来源，JSJ222 当前快照返回一条表达式来源。两者均可正确生成 URI。

同类可通过额外编程组合出类似流程；“当前版本未直接交付完整工具”不等于“对方无法实现”。完整矩阵、原始行为和性能结果见 COMPARISON.md 与 PERFORMANCE.md。

## 实际接入案例

下游为作者新建的 **GitHub 仓库巡检客户端**，它是独立运行的 Node 消费项目，不是第三方生产采用。配置使用 repository、commits、releases 三个模板，对 cjyhjy/moonbit-uri-template、Magic486/moon-uri-template、JSJ222/MoonUriTemplate 三个真实仓库执行 9 个只读请求。

全部 URL 通过公共 Node 目录 SDK 生成，底层执行编译的 MoonBit 核心。文件检查阶段只校验和计量，之后由 `compileCatalog`、`inspect`、`expandMany` 完成实际请求计划；所有请求在联网前完成契约和总预算检查。客户端另外限制允许访问的 GitHub 主机与路径，设置响应体上限与超时；这些 HTTP 策略属于客户端，不冒充 RFC 模板展开的安全保证。

`reports/github-integration-portable-live.json` 记录从全新临时目录解压分发包后执行的真实结果：HTTP 状态、GitHub 请求编号、响应时间/摘要、返回提交 SHA、引擎与分发归档摘要。它不导入源仓库中的模块。首次匿名访问遇到限流，失败报告保留在 history；成功运行通过本机已有 GitHub CLI 登录执行，不读取或保存令牌。

这份联网报告生成于本次源码提交前，返回的仓库提交和发行版本分别保留在报告中；不能把正式发行版号视为当时仓库 HEAD 的版本，也不用于推断当前远端状态。本分支提供新功能候选源码，正式发行状态需另行核对。空发行列表也是有效业务结果，不等于请求失败。

## 故障注入与真实运行分开

`reports/integration-faults.json` 为主动构造的测试，明确标记 intentional-fault-injection：

1. 将 owner 改为 owenr，同时发现 MissingBinding 和 UnusedBinding；网络调用为 0。
2. 将必填 owner 改为空列表，同时报告类型问题和 OmittedBinding；网络调用为 0。
3. 将整批输出预算设为 1 字节，报告 ProjectOutputLimit；网络调用为 0。

这些证明错误会被拦截，不声称真实用户曾发生上述事故，也不捏造节省工时、生产请求量或采用者。

`reports/integration-upgrades.json` 另包含六种主动构造的离线升级演练：无变化、增加可选参数、候选已补齐但旧请求遗漏新必填项、类型收紧、整批预算收紧、目标地址改变。升级比较使用真实客户端的配置结构与公共目录 SDK；没有发送 HTTP，也没有实际应用升级。旧请求复演位置明确标为生成文档；报告不复制绑定值或生成 URL。

## 验证方式

- JS、wasm、wasm-gc、Native 四后端各 327 项测试；270 条固定上游标准/扩展/负例分别执行。
- 正向标准语料同时验证实际输出、计量字节数和来源范围完整覆盖；另有 800 组确定性字符串/操作符组合测试。
- CLI 49 项；项目工作流及下游离线测试 25 项；SDK 22 项；工作台计算和生命周期 6 项；便携包解压后执行同样的 102 项 Node 测试。另从本地 npm tarball 离线安装到全新项目，验证公共导入、CLI、TypeScript 正例和预期错误，包含新目录接口的批量、预检、审计及比较。新真实报告另外要求 `executionPath=typed-catalog-sdk` 且九项请求均经过目录预检；此前通过旧入口运行的报告保留在 history，不混用。
- 从真实 Mooncakes 源码归档创建独立 MoonBit 消费项目，在四后端验证原展开及新计量/批量/目录 API；这不是新版注册表安装记录。
- 两个同类固定提交均重跑原有三后端测试，并执行同输入共享探针。测试数量不作为质量排名。
- 同机 JS release 基准保留四类场景、两种使用模式、七轮轮换顺序原始样本；不声称内存占用、所有平台或所有场景领先。
- 真浏览器在 1280×900 桌面和 390×844 窄屏完成七组交互验收，截图逐张检查。超时由主动延迟 worker 脚本加载触发，与真实性能测试分开；观测到的 HTTP(S) 均为本地静态资源，浏览器扩展协议另记，不将扩展加载误判为工作台发送绑定数据。

复现入口：`npm test`、`npm run compare:peers`、`npm run benchmark:peers`。分发包无需 MoonBit 即可运行项目检查和客户端。所有当前状态以对应 JSON 报告与源码摘要为准。

## 尚存差异

最新版 JSJ222 的依赖选择性重算和不可变链接快照现已在本项目核心与 Node SDK 实现，尚不能凭功能覆盖声称性能或采用全面领先。新增公共运行时类型契约已在核心、Node SDK 与真实客户端接入。旧 parse/expand 为兼容调用保留原策略，不会自动获得有界入口的默认保护；使用不可信输入时选择有界 API。变量画像、详细差异和目录审计的原有类别差距已经补齐，具体语义仍以矩阵说明为准。Node 目录接入、离线升级命令与单模板交互比较已实现；页面只验证当前绑定，不替代多请求升级复演；本项目没有长期第三方使用或实测 RSS 优势证据。CI 状态需按提交独立核查，源码公开不等于 0.2.0 注册表发行。持续计划见 OPTIMIZATION.md；工程价值和赛事选题是否足够独立，应由评审基于具体任务判断。

## 增量链接接入的独立记录

`integrations/github-audit/link-selection.mjs` 是同一作者客户端的参数切换场景，使用公共 `catalog.startSession` 与 `update`。先对本项目仓库读取 repository/commits/releases 三类信息，再移除 per_page=1 恢复 GitHub 默认列表大小，仅对改变的 commits/releases URI 发出两个请求；原 repository 链接及旧快照保持不变。`reports/github-links-portable-live.json` 从独立解压包运行，记录 3+2 次实际响应、每次 HTTP 状态/请求编号/摘要、重算计数、旧快照保持及分发包摘要。

同一场景中的相同值补丁和错误类型补丁为主动构造的检查，不是用户事故；这两步零网络调用单独标记。缓存的是 URI 与调用方保留的先前响应，不冒充自动 HTTP 缓存、更低实际账单或第三方采用。核心和 Node 回归各执行 200 次更新，逐次与完整重算比较，证明这些负载的结果一致；这不是时延或 RSS 测量。
