# MoonBit URI Template 项目申报初稿（AI 辅助，仅供本人整理思路）

> 按用户要求准备的初稿。赛事截图要求“不要使用 AI 编写”；本文件不能直接作为正式申报书上传，需参赛者独立撰写最终文本。团队、报名和资格信息以本人及主办方确认为准。

**项目名称：** MoonBit URI Template —— RFC 6570 模板解析与展开库。

**简介与方向：** 面向 MoonBit API 客户端、SDK 和开发者工具的通用基础库，将 URI 模板与变量展开为字符串，减少手动拼接路径、查询参数和 Unicode 编码时的错误。拟按新生态项目方向申报，是否适用以正式审核为准。

**三个完整使用场景：**

1. **API 客户端生成请求地址。** 模板 `/users/{id}{?page,limit}`，变量 id="42"、page="2"、limit="20"，生成 `/users/42?page=2&limit=20`；客户端随后自行发送请求。模板可预先解析并复用。
2. **搜索工具生成集合查询。** 模板 `/search{?q,tags*}`，变量 q="moon bit"、tags=["sdk","api"]，生成 `/search?q=moon%20bit&tags=sdk&tags=api`，正确编码空格并展开重复查询参数。
3. **命令行或构建流程校验模板配置。** 对 `/users/{id` 执行 validate，返回 `UnclosedExpression` 和位置，进程非零退出；修正后从 JSON 文件读变量并展开。适用于在发布 SDK 配置前发现模板错误。

**已实现核心功能：** RFC 6570 Level 4 的八种操作符、标量/列表/关联值、prefix/explode；解析复用、变量查询、有序关联值与重复键检查；兼容及严格解析入口、Unicode 码点错误位置、JSON Pointer 类型诊断；JSON 适配和可解压运行的 Node CLI。

**来源与区别：** 根据 RFC 6570 独立实现，项目代码 Apache-2.0；固定社区 uritemplate-test 测试提交并保留其 Apache-2.0 许可证。生态已有 Magic486/moon-uri-template（MIT）和 JSJ222/moonuritemplate（Apache-2.0），本项目不是首个，也不宣称全面优于它们。现有交付特点是范围较小的 Result API、隐藏内部表示、码点位置诊断及包含编译引擎和测试的便携 CLI；资源限额、批量与目录能力尚不及上述成熟实现。

**交付与验证：** 0.1.1 已发布至 Mooncakes，独立消费工程验证 JS、wasm-gc、Native。每个后端 285 项测试，包括全部 270 个固定上游用例；27 项 CLI 测试及解压运行通过。默认单引号兼容扩展已公开，严格入口拒绝该扩展；不把测试通过视为 IETF 认证。

**仓库：** https://github.com/cjyhjy/moonbit-uri-template 。保留不少于 10 个真实有效提交，未通过空提交或无意义拆分凑数。后续重点是接入体验、诊断与维护，不将未实现能力写为成果。
