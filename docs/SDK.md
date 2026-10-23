# Node / TypeScript SDK

SDK 直接调用编译后的 MoonBit 核心，RFC 语义不在 JS 里重写。需要 Node.js 22+（ESM），无运行时依赖。

## 安装

```sh
npm install moonbit-uri-template
```

在源码仓库中执行 `npm run build` 后，也可以直接 `import ... from './sdk/index.mjs'`。

## 基本用法

```ts
import { compileTemplate, expand, UriTemplateError } from 'moonbit-uri-template';

expand('/search{?q,tags*}', { q: 'moon bit', tags: ['sdk', 'api'] });
// /search?q=moon%20bit&tags=sdk&tags=api

const repo = compileTemplate('https://api.github.com/repos/{owner}/{repo}{?page}', {
  required: ['owner', 'repo'],
});
repo.expand({ owner: 'moonbitlang', repo: 'core', page: 2 });
// https://api.github.com/repos/moonbitlang/core?page=2
```

`compileTemplate` 只解析一次，之后可以反复调用。对字面量模板，TypeScript 会推导变量名：拼错变量名、漏掉 `required` 中的变量，都会在编译期报错。

### 值的转换

| 输入 | 结果 |
| --- | --- |
| 字符串 | 原样 |
| 数字、布尔 | `String(x)`，如 `42`、`2.5`、`true` |
| `null`、`undefined` | 未绑定（RFC 省略） |
| 数组 | 列表；成员可以是字符串、数字或布尔 |
| 普通对象 | 关联值，保持插入顺序；值为 `null`/`undefined` 的成员被跳过 |

`NaN`/`Infinity`、日期、类实例、函数、BigInt、稀疏数组、循环引用、getter 和含孤立 UTF-16 代理的字符串会被拒绝，错误码为 `InvalidInput`，`path` 字段给出 JSON Pointer。SDK 不调用 getter 或 `toJSON`。

### 选项

| 选项 | 默认 | 作用 |
| --- | --- | --- |
| `required` | `[]` | 这些变量必须有值；空字符串可以，空集合不行 |
| `types` | 无 | 每个变量声明 `'scalar'`、`'list'` 或 `'assoc'`，运行时由核心检查 |
| `rejectUnused` | `false` | 绑定了模板中不存在的变量时抛 `UnusedBinding` |
| `requireAll` | `false` | 模板引用的变量全部必填 |
| `strict` | `false` | 按 RFC 语法拒绝字面量中的单引号 |
| `maxOutput` 等 | 见 [API](API.md) | 模板、绑定、输出预算 |

默认值允许多传字段，便于把现成的请求参数对象直接传进来；拼写错误由 TypeScript 在编译期发现。想在运行时也拒绝多余字段，打开 `rejectUnused`。

## 检查与排错

```ts
repo.check({ owner: 'moonbitlang' });
// { missing: [{ name: 'repo', ... }, { name: 'page', ... }], unused: [], ... }  不展开

repo.inspect({ owner: 'moonbitlang' });
// [{ code: 'MissingBinding', ... }]  只报告业务契约问题，可选的 page 不算

const r = repo.tryExpand({ owner: 'x' });
if (!r.ok) console.error(r.error.code, r.error.line, r.error.column);
```

所有错误都是 `UriTemplateError`，带稳定的 `code`。和模板位置有关的错误另有码点 `start`/`end`、1 起点的 `line`/`column` 和 UTF-16 的 `utf16Start`/`utf16End`，可以直接用于编辑器跳转。

其他方法：`measure(vars)` 返回字节数；`trace(vars)` 返回 URI 和每段输出的来源；`analyze()` 返回变量画像；`audit(policy)` 做静态策略检查。

## 批量

```ts
repo.expandMany([
  { owner: 'moonbitlang', repo: 'core' },
  { owner: 'moonbitlang', repo: 'moon' },
], { maxTotalOutputBytes: 4096 });
```

每项展开一次，任一项失败就抛错，错误的 `index` 指出第几项，不返回半批结果。默认最多 256 项，整批输入 4,194,304 码点（按序列化后的 JSON 计），输出 4,194,304 字节。

## 模板目录

```ts
import { compileCatalog } from 'moonbit-uri-template';

const api = compileCatalog({
  repository: { template: '/repos/{owner}/{repo}', required: ['owner', 'repo'] },
  search: { template: '/search{?q}', requireAll: true },
});
api.expand('repository', { owner: 'moonbitlang', repo: 'core' });

const jobs = [
  { template: 'repository' as const, variables: { owner: 'moonbitlang', repo: 'core' } },
  { template: 'search' as const, variables: { q: 'moon' } },
];
api.inspect(jobs);       // 每个请求的契约问题
api.measureMany(jobs);   // 每项字节数和总数
api.expandMany(jobs);    // 原子批量
api.audit({ allowReserved: false });
```

模板名、变量名和必填项都有类型提示。默认最多 4096 个模板。`get(name)` 返回已编译模板，`templatesUsing(variable)` 反查使用某个变量的模板。

## 升级比较

```ts
const before = compileTemplate('/users/{id}{?page}', { maxOutput: 2048 });
const after = compileTemplate('/users/{+id:3}{?page}', { required: ['id'], maxOutput: 1024 });
const change = before.compare(after);
change.reservedAdded;     // true
change.becameScalarOnly;  // ['id']
change.addedRequired;     // ['id']
change.budgetChanges;     // [{ name: 'maxOutput', before: 2048, after: 1024, tightened: true }]
change.requiresReview;    // true
```

除模板结构外，还会比较必填集合、`rejectUnused`、类型声明和运行时预算。目录也有 `compare`。命令行：`uri-template compare BEFORE AFTER --json`（无变化退出 0，有变化退出 1）。

## 增量链接会话

```ts
const api = compileCatalog({
  search: { template: '/users/{id}/search{?q}', required: ['id'] },
  user: { template: '/users/{id}', required: ['id'] },
  health: { template: '/health' },
});
const before = api.startSession({ id: 42, q: 'old' });
const { session, changes, recomputed } = before.update({ q: 'new' });
recomputed;               // 1
session.get('search');    // /users/42/search?q=new
before.get('search');     // /users/42/search?q=old
```

补丁中的 `null` 删除绑定。更新是不可变的，失败时原会话和新会话都不受影响。

实现：绑定和 URI 按 32 个一块共享存储，更新只复制改动的块；预算只对补丁中的绑定增量计算；每个受影响的端点只展开一次。所以更新开销与补丁大小和受影响端点数成正比，与会话里其他数据的大小无关：

| 场景（200 个端点） | 改进前 | 现在 |
| --- | --- | --- |
| 改 1 个变量、重算 1 个端点 | 0.063 ms | 0.006 ms |
| 保留 1001 个历史快照，每个快照的额外内存 | 16.2 KB | 1.8 KB |
| 会话中另有 2 万成员的列表（不变），改 1 个标量 | 1.18 ms | 0.002 ms |

会话默认预算：4096 个绑定、65536 个集合成员、单值 1,048,576 码点、整体输入 4,194,304 码点（名字、键、值合计）、整体输出 4,194,304 字节、每个补丁 4096 项。

## 工作台

`npm run playground`（便携包里用 `node tools/serve-playground.mjs`）启动本地页面。页面在 worker 中调用同一份核心，可以编辑模板和变量、查看变量画像、点击错误跳转到源码位置，并对比当前模板和候选模板。计算超过 2 秒会被取消。
