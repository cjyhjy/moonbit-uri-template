import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkOpenAPI} from './openapi.mjs';
import {parseSource} from './json-source.mjs';
const parameter = (name='id',extra={}) => ({name,in:'path',required:true,...extra});
const doc = (item={get:{parameters:[parameter()]}},path='/pets/{id}') => ({openapi:'3.1.0',paths:{[path]:item}});
const check = d => checkOpenAPI(JSON.stringify(d));
const codes = d => check(d).diagnostics.map(x=>x.code);
test('range-only JSON indexing preserves escaped values, pointer names and token ranges', () => {
 const text = String.raw`{"a/b~c":"😀\u4e2d\"\\\n","nested":[0,true,null,{"__proto__":"x"}]}`;
 const full = parseSource(text), compact = parseSource(text, 32, {stringOffsets:false});
 assert.deepEqual(compact.value, full.value);
 assert.equal(compact.value['a/b~c'], '😀中"\\\n');
 assert.equal(compact.value.nested[3].__proto__, 'x');
 for (const name of ['nodes','keys']) {
  assert.deepEqual([...compact[name].keys()], [...full[name].keys()]);
  for (const [path, token] of compact[name]) {
   assert.equal(Object.hasOwn(token, 'offsets'), false);
   assert.equal(token.start, full[name].get(path).start);
   assert.equal(token.end, full[name].get(path).end);
  }
 }
 const token = full.nodes.get('/a~1b~0c');
 assert.equal(text.slice(token.offsets[2], token.offsets[3]), String.raw`\u4e2d`);
 assert.equal(text.slice(token.offsets[3], token.offsets[4]), String.raw`\"`);
 assert.equal(text.slice(compact.keys.get('/a~1b~0c').start, compact.keys.get('/a~1b~0c').end), '"a/b~c"');
});
test('range-only JSON indexing retains malformed, duplicate-key and depth rejection', () => {
 for (const [text, depth, code] of [['{"x":',32,'InvalidJson'],[String.raw`{"id":1,"i\u0064":2}`,32,'DuplicateJsonKey'],['[[[]]]',2,'JsonDepthLimit']]) {
  const capture = options => { try { parseSource(text,depth,options); assert.fail('input accepted'); } catch(e) { assert.equal(e.code,code); return {code:e.code,path:e.path,start:e.start,end:e.end}; } };
  assert.deepEqual(capture({stringOffsets:false}), capture({stringOffsets:true}));
 }
});
test('same core validates inherited and overridden parameters per operation',()=>{
 const d=doc({parameters:[parameter()],get:{parameters:[parameter('id',{description:'override'})]},post:{}});
 const r=check(d); assert.equal(r.ok,true); assert.equal(r.operations.length,2); assert.equal(r.operations[0].template,'/pets/{id}');
});
test('operation-only declaration does not cover siblings',()=>assert.deepEqual(codes(doc({get:{parameters:[parameter()]},post:{}})),['MissingPathParameter']));
test('missing, unused, optional and query names are distinct',()=>{
 assert.deepEqual(codes(doc({get:{parameters:[parameter('other',{required:false}),parameter('id',{in:'query'})]}})),['PathParameterRequired','UnusedPathParameter','MissingPathParameter']);
});
test('duplicate parameters are forbidden within a level, overrides allowed',()=>assert.ok(codes(doc({get:{parameters:[parameter(),parameter()]}})).includes('DuplicateParameter')));
test('parameter names are case sensitive and support hyphens and unicode',()=>{
 assert.equal(check(doc({get:{parameters:[parameter('user-id')] }},'/users/{user-id}')).ok,true);
 assert.equal(check(doc({get:{parameters:[parameter('用户')] }},'/users/{用户}')).ok,true);
 assert.ok(codes(doc({get:{parameters:[parameter('ID')]}})).includes('MissingPathParameter'));
});
test('path items without operations need no path parameters',()=>{
 for(const item of [{},{summary:'filtered'},{'x-internal':true}]) assert.equal(check(doc(item)).ok,true);
 assert.deepEqual(codes(doc({parameters:[parameter('id',{required:false})]})),['PathParameterRequired']);
});
test('repeated placeholders are not an error before OpenAPI 3.2',()=>{for(const v of ['3.0.3','3.1.0']){const d=doc(undefined,'/a/{id}/b/{id}');d.openapi=v;assert.equal(check(d).ok,true,v);}});
test('real descriptions nest deeper than 32 levels',()=>{
 const d=doc();let s={type:'string'};for(let i=0;i<40;i++)s={items:s};d.components={schemas:{deep:s}};assert.equal(check(d).ok,true);
});
test('query and fragment in a path are reported by name',()=>{
 assert.match(check(doc(undefined,'/files/{id}#get')).diagnostics[0].message,/fragment/);
 assert.match(check(doc(undefined,'/files/{id}?x=1')).diagnostics[0].message,/query/);
});
test('path literals follow RFC 3986 pchar',()=>{
 for(const path of ["/o'brien/{id}",'/a%5Bb%5D/{id}','/v1/{id}:cancel','/a;b=c/@x/{id}']) assert.equal(check(doc(undefined,path)).ok,true,path);
 for(const path of ['/a[b]/{id}','/中文/{id}','/a|b/{id}','/100%/{id}','/a%zz/{id}']) assert.deepEqual(codes(doc(undefined,path)),['InvalidPath'],path);
});
test('3.1 documents without paths are complete',()=>{
 assert.equal(check({openapi:'3.1.0',webhooks:{}}).ok,true);
 assert.equal(check({openapi:'3.0.3'}).complete,false);
});
test('equivalent templates conflict but concrete paths coexist',()=>{
 const d=doc(); d.paths['/pets/{name}']={get:{parameters:[parameter('name')]}}; assert.ok(codes(d).includes('EquivalentPaths'));
 delete d.paths['/pets/{name}']; d.paths['/pets/mine']={get:{}}; assert.equal(check(d).ok,true);
});
test('local parameter and path-item references resolve including pointer escapes',()=>{
 const d=doc({$ref:'#/components/pathItems/P'});
 d.components={pathItems:{P:{get:{parameters:[{$ref:'#/components/parameters/a~1b~0c'}]}}},parameters:{'a/b~c':parameter()}};
 assert.equal(check(d).ok,true);
});
test('external, missing, cyclic and sibling references cannot pass silently',()=>{
 for (const ref of ['https://example.com/p.json','#/missing']) {const r=check(doc({$ref:ref}));assert.equal(r.ok,false);assert.equal(r.complete,false);}
 const d=doc({$ref:'#/paths/~1pets~1{id}'}); assert.ok(codes(d).includes('ReferenceCycle'));
 assert.ok(codes(doc({$ref:'#/components/pathItems/P',get:{}})).includes('ReferenceSiblings'));
});
test('brace errors and illegal literal paths rejected',()=>{
 for(const path of ['pets/{id}','/pets/{}','/pets/{id','/pets/{a{b}}','/pets/{id}?q=x','/pets/a b']) assert.equal(check(doc({},path)).ok,false,path);
});
test('3.0 supported, other versions explicitly incomplete',()=>{
 const d=doc();d.openapi='3.0.3';assert.equal(check(d).ok,true);d.openapi='3.2.0';assert.equal(check(d).complete,false);
});
test('invalid parameter and operation shapes rejected',()=>{
 for(const item of [{get:null},{get:{parameters:{}}},{parameters:[null],get:{}},{get:{parameters:[{name:'id',in:'wrong'}]}}]) assert.equal(check(doc(item)).ok,false);
});
test('duplicate JSON keys, malformed JSON, depth and input limits',()=>{
 for(const text of ['{"openapi":"3.1.0","paths":{},"paths":{}}','{','['.repeat(130)+']'.repeat(130),]) assert.equal(checkOpenAPI(text).complete,false);
 const r=checkOpenAPI(JSON.stringify(doc()),'spec.json',{maxBytes:16});assert.equal(r.diagnostics[0].code,'OpenAPIInputLimit');assert.equal(r.complete,false);
});
test('diagnostics have source locations and bounded output',()=>{
 const d=doc({get:{}}); const r=checkOpenAPI(JSON.stringify(d,null,2),'spec.json');assert.equal(r.diagnostics[0].file,'spec.json');assert.ok(r.diagnostics[0].line>1);
 const huge={openapi:'3.1.0',paths:Object.fromEntries(Array.from({length:300},(_,i)=>['/'+i+'/{id}',{get:{}}]))};const x=check(huge);assert.equal(x.diagnostics.length,256);assert.equal(x.complete,false);
});
test('CLI exit codes and JSON streams for clean, findings and unsupported input',()=>{
 const dir=mkdtempSync(join(tmpdir(),'openapi-test-'));
 try {for(const [d,status] of [[doc(),0],[doc({get:{}}),1],[{openapi:'2.0',paths:{}},2]]) {
 const file=join(dir,'spec.json');writeFileSync(file,JSON.stringify(d));const p=spawnSync(process.execPath,['tools/cli.mjs','openapi',file,'--json'],{encoding:'utf8'});assert.equal(p.status,status,p.stderr);assert.equal(JSON.parse(status?p.stderr:p.stdout).exitCode,status);
 }  const file=join(dir,'spec.json');writeFileSync(file,JSON.stringify(doc()));
  const limited=spawnSync(process.execPath,['tools/cli.mjs','openapi',file,'--max-bytes','16'],{encoding:'utf8'});
  assert.equal(limited.status,2);assert.match(limited.stderr,/--max-bytes/);
  const listed=spawnSync(process.execPath,['tools/cli.mjs','openapi','examples/openapi.json','--templates'],{encoding:'utf8'});
  assert.equal(listed.status,0);assert.match(listed.stdout,/^GET \/users\/\{user-id\}\t\/users\/\{user%2Did\}\n/);assert.match(listed.stdout,/1 RFC 6570 templates/);
  for(const bad of [['--max-bytes','0'],['--max-bytes'],['--json','--json'],['--other'],['--json','--templates']]) assert.equal(spawnSync(process.execPath,['tools/cli.mjs','openapi',file,...bad],{encoding:'utf8'}).status,2,bad.join(' '));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI reports unpaired surrogates at values and object keys with exit 2',()=>{
 const value='{"openapi":"3.1.0",\n"description":"\\ud800","paths":{}}';
 const vr=checkOpenAPI(value,'value.json');
 assert.equal(vr.complete,false);assert.equal(vr.diagnostics[0].code,'InvalidInput');
 assert.equal(vr.diagnostics[0].path,'/description');assert.deepEqual([vr.diagnostics[0].line,vr.diagnostics[0].column],[2,15]);
 const key='{"openapi":"3.1.0",\n"\\udfff":true,"paths":{}}';
 const kr=checkOpenAPI(key,'key.json');
 assert.equal(kr.diagnostics[0].path,'/\udfff');assert.deepEqual([kr.diagnostics[0].line,kr.diagnostics[0].column],[2,1]);
 const nested='{"openapi":"3.1.0",\n"😀":{"description":"\\ud800"},"paths":{}}';
 const nr=checkOpenAPI(nested,'nested.json');
 assert.equal(nr.diagnostics[0].path,'/😀/description');assert.deepEqual([nr.diagnostics[0].line,nr.diagnostics[0].column],[2,21]);
 const dir=mkdtempSync(join(tmpdir(),'openapi-surrogate-'));
 try {
  const file=join(dir,'spec.json');writeFileSync(file,value);
  const run=spawnSync(process.execPath,['tools/cli.mjs','openapi',file,'--json'],{encoding:'utf8'});
  assert.equal(run.status,2);const report=JSON.parse(run.stderr);assert.equal(report.exitCode,2);assert.equal(report.diagnostics[0].code,'InvalidInput');
 } finally {rmSync(dir,{recursive:true,force:true});}
 for(const text of ['{"openapi":"3.1.0","description":"\\ud83d\\ude00","paths":{}}','{"openapi":"3.1.0","description":"中文","paths":{}}','{"openapi":"3.1.0","description":"\\\\ud800","paths":{}}']) assert.equal(checkOpenAPI(text).ok,true);
});
