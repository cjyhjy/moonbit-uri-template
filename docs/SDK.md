# JS / TypeScript 接入指南

这是 0.2.0 **本地候选版**的直接导入接口，尚未发布到 npm。它调用编译后的 MoonBit 核心，不在 JS 里重新实现 RFC 展开。要求 Node.js 22+，ESM，无第三方运行时依赖。TypeScript 仅用于开发期检查。

## 从分发包开始

解压便携分发包后，把其中的 `moonbit-uri-template-0.2.0.tgz` 安装到自己的项目：

```sh
npm install /实际路径/moonbit-uri-template-0.2.0.tgz
```

不要直接执行 `npm install moonbit-uri-template` 来取得本候选版：当前验证只覆盖本地 tarball，未核实同名 npm 注册表包。

```ts
import { compileTemplate, UriTemplateError } from 'moonbit-uri-template';

const repository = compileTemplate(
  'https://api.github.com/repos/{owner}/{repo}{?page}',
  { required: ['owner', 'repo'], maxOutput: 2048 },
);

repository.expand({ owner: 'moonbitlang', repo: 'core' });
// https://api.github.com/repos/moonbitlang/core

repository.expand({ owner: 'moonbitlang', repo: 'core', page: '2' });
// https://api.github.com/repos/moonbitlang/core?page=2

// TypeScript 对字面量模板推导变量名，并检查 required：
// repository.expand({ owner: 'moonbitlang' }); // 缺少 repo，编译错误
// repository.expand({ owner: 'x', repo: 'y', paeg: '2' }); // 拼写错误
```

`compileTemplate` 在构建对象时解析和校验模板/选项，后续调用复用已编译对象。没有持久全局缓存：调用者持有对象，释放引用后由运行时回收。`required` 选项复制为快照，外部修改原数组不会改变契约。

默认 `strict: true`、`rejectUnused: true`，查询变量仍可选择性省略。需要 RFC 允许的缺失省略语义时，只把业务真正必填的变量列入 `required`。保留旧字面量兼容行为可显式指定 `strict: false`；确实需要共享多余绑定时可指定 `rejectUnused: false`。既有 MoonBit 入口和 CLI 默认值不随 SDK 改变。

## 调用前检查、排错与批量生成

```ts
const report = repository.check({ owner: 'moonbitlang' });
// report.missing 包括 repo 和可选 page；check 是完整报告，并非必填契约判定。
const result = repository.tryExpand({ owner: 'moonbitlang', repo: 'core' });
if (result.ok) console.log(result.value);
else console.error(result.error.code, result.error.line, result.error.column);

const bytes = repository.measure({ owner: 'moonbitlang', repo: 'core' });
const trace = repository.trace({ owner: 'moonbitlang', repo: 'core' });
// trace.origins 将生成的 URI 字节范围关联到各次变量引用。

const urls = repository.expandMany([
  { owner: 'moonbitlang', repo: 'core' },
  { owner: 'Magic486', repo: 'moon-uri-template' },
], { maxItems: 20, maxTotalOutputBytes: 4096 });
```

`expandMany` 先检查/计量全部输入，再生成结果；任何一项失败都会抛出 `UriTemplateError`，包含零起始 `index`，不会返回半批 URL。整批数量错误使用 `index = -1`。它不发 HTTP 请求，不能撤销调用方自行发出的请求。

错误通过稳定 `code` 分类，不应依赖英文 message 文本。解析和变量引用错误带码点位置以及 UTF-16 编辑器位置；整批/全局输入错误不伪造源码范围。`tryExpand` 将本库校验失败变为 `{ ok: false, error }`。

JSON 配置用户可使用 `uri-template project requests.json --json`。例如 `owenr` 唯一接近且尚未绑定的变量是 `owner` 时，诊断包含文件行列、提示文字和 `suggestion: { kind: "rename-binding", from, to }` JSON Pointer。它不自动改文件；多个同样接近的目标、已绑定目标和过长名字不提供猜测。

## 输入与资源约定

- 值支持字符串、字符串数组、字符串/空值映射及 null；数字应由调用方明确格式化为字符串。JSON 关联对象按 JS 属性顺序转换；需要完全指定关联顺序可使用 MoonBit 的有序类型。
- null 表示未定义；必填空数组/空映射被拒绝，必填空字符串有效。
- SDK 拒绝 undefined、稀疏数组、循环引用、日期、自定义类实例、symbol、getter 等易被 JSON 静默改变的输入。没有执行用户的 `toJSON`。
- 核心预算覆盖模板、表达式、绑定/成员、名字/键/值、输出和 JSON。SDK 在序列化前另设固定快照上限：变量文本 4,194,304 码点、262,144 个值节点、嵌套 32 层；选项文本/节点各 65,536。配置不能放宽这层保护。此限制不是进程堆内存保证。
- SDK 整批输入预算计入序列化 JSON 标点；MoonBit 类型化批量按名字/值码点计数，两者的计数口径不同。
- 字面量模板的 TypeScript 提示不替代运行时校验；动态字符串无法在编译期推导精确变量名。`requireAll` 运行时执行，声明文件不把该布尔选项推导成必填类型；需要静态必填提示使用 `required`。

## 升级前分析与比较

```ts
const before = compileTemplate('/users/{id}{?page}', { maxOutput: 2048 });
const after = compileTemplate('/users/{+id:3}{?page}', {
  required: ['id'], maxOutput: 1024,
});
const analysis = before.analyze();
const change = before.compare(after);
console.log(change.reservedAdded);       // true
console.log(change.becameScalarOnly);    // ['id']
console.log(change.addedRequired);       // ['id']
console.log(change.budgetChanges);       // maxOutput: 2048 -> 1024, tightened: true
```

`analyze` 包含每个变量的引用次数、操作符、前缀、explode、用途摘要及每次引用位置。所有 span 是原始模板的 Unicode 码点范围。返回结果是新快照，修改结果不会修改已编译模板。

`compare` 包含字面量、表达式布局、变量增删、标量限制、重复引用、每次修饰符的变化，以及旧/新变量画像。即使最大前缀长度相同，也能识别 `{x:2}{x:8}` 与 `{x:8}{x:2}` 的顺序差异。它还比较编译对象保存的必填集合、rejectUnused 和运行时输入/输出预算；解析阶段预算不在运行时预算差异中。

`requiresReview` 表示需要人工检查，**不等于必然不兼容**。任何模板源码变化都会触发检查，包括可能等价的不同写法；它不证明 URL 等价，也不代替应用的目标主机检查。

```sh
uri-template analyze '/users/{id}{?page}' --json
uri-template compare '/users/{id}' '/users/{+id:3}' --json
```

compare 严格解析两份模板。无变化退出 0，有变化退出 1，比较报告均在 stdout；解析/输入失败退出 2 并写 stderr，包含 before/after 一侧和源位置。CLI 比较只接收模板文字；SDK 比较还能看见各对象的必填/运行时预算配置。

## MoonBit 多模板批量

目录现在可以把不同模板的请求作为一个有总预算的计划执行：

```moonbit
let catalog = @uri.compile_catalog([
  ("repository", "/repos/{owner}/{repo}"),
  ("commits", "/repos/{owner}/{repo}/commits{?page}"),
]).unwrap()
let vars = @uri.Variables::from_entries([
  ("owner", @uri.Scalar("moonbitlang")),
  ("repo", @uri.Scalar("core")),
]).unwrap()
let jobs = [
  @uri.CatalogRequest::new("repository", vars, required=["owner", "repo"]),
  @uri.CatalogRequest::new("commits", vars, required=["owner", "repo"]),
]
let sizes = catalog.measure_batch(jobs) // 只计量，不生成 URI
let results = catalog.expand_batch(jobs, reject_unused=true,
  batch_limits=@uri.BatchLimits::new(max_total_output_bytes=4096))
```

失败包含请求 `index`、目录 `name` 和原始错误。总输入预算包含请求模板名与绑定名字/值。每项预算和整批预算同时生效，空批次也会校验选项。

目录另提供 `audit(policy, max_findings?)` 静态审计、`inspect_requests(jobs, ...)` 绑定契约检查和 `diff_contract(newer)` 详细升级对比。`inspect_requests` 返回全部请求的独立问题，不把可选遗漏当作错误；输出是否超限仍由 measure_batch/expand_batch 验证。单独的 `Template.check_contract` 同样可收集业务契约问题。

审计发现默认最多 256 条，超过时返回 FindingLimit，不会返回“部分结果但检查通过”。请求审计将 required 名字计入输入预算：每项变量和 required 共用总码点预算，required 数量另受 max_bindings 限制；整批还计入模板名。空目录/空请求也校验预算。旧无界 `audit` 保持兼容，新代码可选 `audit_with_limit`。

## 验证与当前边界

`npm ci --ignore-scripts` 后运行 `npm test`。验证会打包 tarball，在临时空项目里离线安装，检查公共导入、运行结果、已安装 CLI，以及 TypeScript 正例和预期错误。证据在 `reports/sdk-package.json`；测试不依赖工作区相对导入。

目前不提供 CommonJS 专用导出或 npm 公共版本，不声称已在全部 Node 版本实测。浏览器工作台已有独立入口，npm SDK 的浏览器打包兼容性未单独验收。真实 GitHub 案例仍是作者自建下游，不能视为外部用户采用。
