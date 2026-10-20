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
- 字面量模板的 TypeScript 提示不替代运行时校验；动态字符串无法在编译期推导精确变量名。单模板 `compileTemplate` 的 `requireAll` 运行时执行，静态必填提示使用 `required`；下面的目录入口还能推导字面量 `requireAll: true`。

## 类型化 Node 目录

```ts
import { compileCatalog } from 'moonbit-uri-template';

const api = compileCatalog({
  repository: {
    template: 'https://api.github.com/repos/{owner}/{repo}',
    required: ['owner', 'repo'],
  },
  search: { template: '/search{?q}', requireAll: true },
});
api.expand('repository', { owner: 'moonbitlang', repo: 'core' });
// 模板名称拼错、必填参数遗漏、参数属于另一个模板，均可在 TypeScript 中提示。
const jobs = [
  { template: 'repository' as const, variables: { owner: 'moonbitlang', repo: 'core' } },
  { template: 'search' as const, variables: { q: 'moon' } },
];
const inspection = api.inspect(jobs); // 收集各请求的独立契约问题
const sizes = api.measureMany(jobs);
const urls = api.expandMany(jobs, { maxTotalOutputBytes: 4096 });
const policy = api.audit({ allowReserved: false, allowFragment: false });
const changes = api.compare(compileCatalog({
  repository: {
    template: 'https://api.github.com/repos/{owner}/{repo}{?page}',
    required: ['owner', 'repo', 'page'],
  },
}));
```

`get(name)` 返回可复用的已编译对象，`names` 是只读排序列表，`templatesUsing(variable)` 查找变量使用方。单模板同样支持 `inspect` 和 `audit`。`inspect` 区别于 `check`：只按业务契约报告问题，可选遗漏不算失败；但输出预算仍需 `measureMany` 或 `expandMany` 检查。

目录默认最多 256 个模板，名字加模板原文总计最多 4,194,304 码点，可通过 `maxTemplates`、`maxTotalTemplateCodepoints` 调整；快照层仍有固定文本和节点上限。批量默认最多 256 项、输入 4,194,304 码点、输出 4,194,304 字节；目录输入计入每个请求序列化后的完整 JSON，包括模板名、label、绑定及标点。批量先校验、计量全部请求，再返回完整结果。

审计/预检默认最多 256 条发现，超出时抛出 `FindingLimit`，不返回被截断的成功报告。比较默认最多 512 个有变化的目录项，可传 `maxChanges`；计数单位是目录项，内部变量变化仍受模板预算约束。比较同时覆盖增删模板和相同文字下的必填、无用绑定策略、运行时预算变化；`requiresReview` 仍是审查提示，不是兼容性证明。

执行错误有 `templateName`；逐项处理失败另有零起始 `index`。外层输入快照失败可能只含 JSON Pointer，不保证每类输入错误都能确定请求序号。未知模板发现没有虚构的源码范围。调用方修改原定义、绑定或返回的分析报告不会改变已编译目录。

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

## 浏览器中的分析和升级比较

源码仓库执行 `npm run playground`，便携包执行 `node tools/serve-playground.mjs`，然后打开提示的本地地址。选择“升级示例”即可比较当前/候选模板；两边可以设置不同的必填变量、输出预算和无用绑定策略，共用一份变量 JSON。

工作台分别显示两个版本的展开结果，同时解释新增必填、操作符、截断长度、集合展开与运行时预算变化。点击“定位到输入”或变量画像中的引用按钮，会选择对应编辑框里的原始文本，中文、emoji 和转义 JSON 也按编辑器实际位置处理。重复 JSON 键会明确拒绝。

“升级检查完成”只表示当前这一份绑定通过了所选约束；变化仍需审查，不代表全部旧调用方兼容。多请求、变量类型与目标地址审查使用前述 GitHub 客户端的离线升级命令。核心使用同一 MoonBit 引擎，但浏览器没有执行 HTTP 请求。

输入编辑、取消或超时都会终止旧 worker 并禁用旧结果复制。超过两秒返回 TimeLimit，可缩小输入后重试。界面最多展示 32 个变量、每个变量 8 处引用及 32 项变量变化，超过时明确提示；完整机器报告可使用 CLI analyze/compare。此展示上限不等于输入检查被省略。

真实浏览器验收包含 1280×900 桌面和 390×844 窄屏；超时测试人为延迟 worker 脚本 2.5 秒，用于验证两秒期限与重试，不冒充真实负载耗时。报告、图片与代码摘要见 `reports/playground-browser.json`，六项计算/生命周期回归另由 `npm test` 和便携包验收执行。

## 验证与当前边界

`npm ci --ignore-scripts` 后运行 `npm test`。验证会打包 tarball，在临时空项目里离线安装，检查公共导入、运行结果、已安装 CLI，以及 TypeScript 正例和预期错误。证据在 `reports/sdk-package.json`；测试不依赖工作区相对导入。

目前不提供 CommonJS 专用导出或 npm 公共版本，不声称已在全部 Node 版本实测。浏览器工作台已有独立入口，npm SDK 的浏览器打包兼容性未单独验收。真实 GitHub 案例仍是作者自建下游，不能视为外部用户采用。

该客户端现直接使用公共 Node 目录接口生成实际 HTTP URL；完整配置升级命令还比较类型/整批预算，并重新检查旧请求和目标地址。使用步骤见 [GitHub 接入与升级审查](../integrations/github-audit/README.md)。升级演练报告与真实 HTTP 报告分别保存，不能相互代替。

## 公共运行时类型契约

```ts
const users = compileTemplate('/users/{id}{?fields*,filter*}', {
  required: ['id'],
  types: { id: 'scalar', fields: 'list', filter: 'assoc' },
});
users.expand({ id: '42', fields: ['name', 'email'] });
// TypeScript 提示错误，绕过类型检查的 JavaScript 调用也会被核心拒绝：
// users.expand({ id: [] });
const findings = users.inspect({ id: '42', fields: '' }); // BindingType
```

`types` 是可选声明，值为 `scalar`、`list` 或 `assoc`。它由 MoonBit 核心检查，并覆盖 `expand`、`measure`、`trace`、批量和 `inspect`；同样适用于目录定义及 `get` 返回的对象。类型化的 `compileTemplate` 和目录调用保留静态形状提示，动态模板仍须依靠运行时校验。

未声明的普通变量保持任意 RFC 值类型；显式 `types: {}` 也开启前缀变量的标量约束，空复合值不能绕过。完全省略 `types` 则保留旧入口行为。可选变量仍可省略；必填空字符串有效，必填空集合拒绝；可选的错误类型即使为空也拒绝。`check` 仍是原始 RFC 绑定报告，业务契约检查使用 `inspect`。

重复或未引用的规则、与前缀冲突的类型会在编译时报错。核心声明数量和名字总码点有界；JSON 选项还有固定上限。类型检查不做数字格式、域名或完整 JSON Schema 验证。`compare` 新增 `typeChanges`、`typedBefore` 和 `typedAfter`；类型或契约模式变化即使模板原文相同也要求审查。实际 GitHub 客户端把配置中的 `types` 直接传给公共 SDK，文件检查和 SDK 调用都执行约束。

类型契约的输入总码点预算与 `inspect` 一致，计入绑定名字、键、值及必填名字；例如 id="1" 且 id 必填，共计 2+1+2=5 码点。`validate`、计量、展开和预检在该边界上一致。规则声明的大小在编译阶段另行限制。

## 参数变化时只更新相关链接

```ts
const api = compileCatalog({
  search: {template:'/users/{id}/search{?q}',required:['id'],types:{id:'scalar',q:'scalar'}},
  user: {template:'/users/{id}',required:['id']},
  health: {template:'/health'},
});
const before = api.startSession({id:'42',q:'old'}, {maxTotalOutputBytes:4096});
const update = before.update({q:'new'});
console.log(update.recomputed); // 1
console.log(update.changes);    // 只有 search
console.log(update.session.get('search')); // /users/42/search?q=new
console.log(before.get('search'));         // /users/42/search?q=old
// update({id:null}) 会因必填契约失败，before 和 update.session 都保持有效。
```

`startSession` 复用已编译目录，`update` 是不可变更新；补丁中的 null 删除绑定，其他值覆盖绑定。所有端点仍执行各自编译时的类型、必填、单 URI 等约束。整个快照先计量，再生成受影响 URI。`links()` 返回 `{template, uri, bytes}` 数组，`get(name)` 查询一个结果，`totalBytes` 是整个快照的字节数。返回数组及变化列表可供调用方处理，不会改变会话。

默认会话限额：4096 个已定义绑定、65536 个累计集合成员、单名字/键/值 1,048,576 码点、整份输入 JSON 4,194,304 码点、输出 4,194,304 字节、补丁 4096 项、依赖边 65536 条。可用 `SessionLimits` 中的对应字段调整；底层编译对象预算和 SDK 固定快照限制仍适用。补丁及完整候选状态分别检查输入预算，后者包含保留的绑定；整份输出预算包含缓存链接。

SDK 会话输入总量按序列化 JSON（含标点）计数，MoonBit 会话按绑定名字/键/值码点计数。JS 对象不能表示重复的补丁键；MoonBit 补丁数组会主动拒绝重复。关联对象键顺序不改变 JSON 核心输出，含 null 成员的原始输入大小仍被记录。参数名和端点名获得 TypeScript 提示；共享参数的必填/形状冲突由各端点运行时契约判断，不宣称静态类型能证明所有跨端点组合有效。

缓存与依赖调度由各语言的宿主层管理，所有标准展开、计量和类型校验仍调用 MoonBit 核心。一次更新会扫描完整输入并复制状态引用，不能把只重算一个 URI 描述为整个操作 O(1)。初始和更新预算失败不会返回部分快照；不变的补丁不发起外部操作，网络请求始终由调用方控制。

实际作者下游：`node integrations/github-audit/link-selection.mjs --gh` 先读取三类 GitHub 信息，再移除 `per_page=1` 恢复默认列表大小，仅重请求 commits/releases 两条变化链接。仓库信息链接保持缓存；它不是自动 HTTP 缓存系统。真实记录与故障演练的说明见 REVIEW_EVIDENCE.md。
