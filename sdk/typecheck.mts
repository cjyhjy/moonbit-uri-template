import { compileTemplate, expand, type TemplateVariables } from './index.mjs';
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
