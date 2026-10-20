import { compileTemplate, compileCatalog, expand, type TemplateVariables } from './index.mjs';
const users = compileTemplate('/users/{id}{?tags*}', { required: ['id'] });
users.expand({ id: '42', tags: ['sdk'] });
users.expandMany([{ id: '42' }]);
// @ts-expect-error required id must be supplied
users.expand({ tags: [] });
// @ts-expect-error misspelled binding
users.expand({ id: '42', tag: ['sdk'] });
// @ts-expect-error unknown required name
compileTemplate('/{id}', { required: ['typo'] });
// @ts-expect-error explicit string formatting required
users.expand({ id: 42 });
const valid: TemplateVariables<'{+path}{?x,y*}{id:3}'> = 'y';
void valid;
expand('/{x}', { x: 'a' });
const dynamic: string = '/{x}';
compileTemplate(dynamic).expand({ arbitrary: 'value' });
const outcome = users.tryExpand({ id: '42' });
if (!outcome.ok) console.log(outcome.error.code);
const analysis = users.analyze();
const count: number = analysis.profiles[0].occurrences;
const change = users.compare(compileTemplate('/users/{+id}'));
const review: boolean = change.requiresReview;
void count; void review;
// @ts-expect-error comparison requires a compiled object
users.compare('/users/{id}');
const catalog = compileCatalog({
  user: { template: '/users/{id}{?page}', required: ['id'] },
  search: { template: '/search{?q}', requireAll: true },
});
catalog.expand('user', { id: '42' });
catalog.get('search').expand({ q: 'moon' });
catalog.expandMany([{ template: 'search', variables: { q: 'moon' } }]);
catalog.measureMany([{ template: 'user', variables: { id: '42' } }]);
catalog.inspect([{ template: 'unknown', variables: { typo: 'value' } }]);
catalog.audit({ allowReserved: false });
catalog.compare(compileCatalog({ another: { template: '/{x}' } }));
// @ts-expect-error missing required id
catalog.expand('user', { page: '2' });
// @ts-expect-error no such template
catalog.expand('typo', { id: '42' });
// @ts-expect-error variable belongs to a different template
catalog.expandMany([{ template: 'search', variables: { id: '42' } }]);
// @ts-expect-error requireAll literal infers required q in a catalog definition
catalog.get('search').expand({});
// @ts-expect-error required variable must occur in the literal template
compileCatalog({ user: { template: '/{id}', required: ['typo'] } });

const shaped = compileTemplate('/{id}{?tags*,meta*}', {
  required: ['id'], types: {id:'scalar', tags:'list', meta:'assoc'},
});
shaped.expand({id:'42',tags:['sdk'],meta:{sort:'new'}});
// @ts-expect-error id is a scalar, including at compile time
shaped.expand({id:[]});
// @ts-expect-error optional list has the wrong shape
shaped.measure({id:'42',tags:'sdk'});
// @ts-expect-error type declarations must reference a variable
compileTemplate('/{id}', {types:{typo:'scalar'}});
const shapedCatalog = compileCatalog({ user: {template:'/{id}{?tags*}', required:['id'], types:{id:'scalar',tags:'list'}} });
shapedCatalog.expand('user', {id:'42',tags:['sdk']});
// @ts-expect-error catalog batches enforce the declared shape
shapedCatalog.expandMany([{template:'user',variables:{id:['42']}}]);
// @ts-expect-error get preserves the declared shape
shapedCatalog.get('user').expand({id:'42',tags:'sdk'});
