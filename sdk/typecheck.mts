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
