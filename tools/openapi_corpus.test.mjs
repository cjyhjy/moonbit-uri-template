import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectDocuments, inspectReport, runWorker, download, sha256, compareBaseline} from './openapi_corpus.mjs';
import {checkOpenAPI} from './openapi.mjs';

test('corpus selection is deterministic, version-filtered and provider-diverse', () => {
  const index = {};
  for (const [id, version] of [['large:a','3.0.3'],['large:b','3.0.0'],['small','3.1.0'],['third','3.0.1'],['legacy','2.0']])
    index[id] = {preferred:'v1',versions:{v1:{openapiVer:version,swaggerUrl:'https://api.apis.guru/v2/example', info:{'x-providerName':id.split(':')[0]}}}};
  const selected = selectDocuments(index,3);
  assert.equal(selected[0].id,'small');
  assert.equal(new Set(selected.map(x=>x.provider)).size,3);
  assert.ok(selected.every(x=>x.openapi.startsWith('3.')));
  assert.deepEqual(selectDocuments(Object.fromEntries(Object.entries(index).reverse()),3),selected);
});
test('incomplete results remain incomplete and warning-only results remain clean within scope', () => {
  const report = {ok:false,complete:false,operations:[],diagnostics:[{code:'UnsupportedReference',severity:'error'}],truncated:{errors:0,warnings:0}};
  assert.equal(inspectReport(report).outcome,'incomplete');
  assert.equal(inspectReport({...report,complete:true}).outcome,'complete-with-diagnostics');
  assert.equal(inspectReport({...report,ok:true,complete:true,diagnostics:[{code:'ExampleShapeMismatch',severity:'warning'}]}).outcome,'complete-clean');
});
test('corpus baseline fails closed on missing inputs, changed bytes or changed semantics', () => {
  const row={id:'example',sha256:'input',semanticSha256:'output'}, baseline={documents:[row]};
  assert.deepEqual(compareBaseline([row],baseline),[]);
  for (const changed of [{...row,id:'unknown'},{...row,sha256:'other'},{...row,semanticSha256:'different'},{...row,semanticSha256:undefined,outcome:'crash'}])
    assert.equal(compareBaseline([changed],baseline).length,1);
});
test('isolated corpus worker reports actual analysis, process failures and deadlines', () => {
  const dir=mkdtempSync(join(tmpdir(),'uri-corpus-'));
  try {
    const path=join(dir,'spec.json');
    writeFileSync(path,JSON.stringify({openapi:'3.1.0',paths:{'/pets/{id}':{get:{}}}}));
    const r=runWorker(path);
    assert.equal(r.outcome,'complete-with-diagnostics'); assert.equal(r.codes.MissingPathParameter,1);
    assert.equal(r.operations,1); assert.match(r.semanticSha256,/^[a-f0-9]{64}$/);
    assert.equal(runWorker(path,1).outcome,'timeout');
    assert.equal(runWorker(join(dir,'missing.json')).outcome,'crash');
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('corpus downloads enforce the catalog host and streamed byte cap', async () => {
  await assert.rejects(download('https://127.0.0.1/spec.json'),/catalog origin/);
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('12345');
    await assert.rejects(download('https://api.apis.guru/v2/spec.json',4),/size limit/);
    assert.equal(sha256(await download('https://api.apis.guru/v2/spec.json',5)),sha256('12345'));
    globalThis.fetch=async()=>new Response('',{status:503});
    await assert.rejects(download('https://api.apis.guru/v2/spec.json'),/HTTP 503/);
  } finally {globalThis.fetch=original;}
});

for (const fixture of JSON.parse(readFileSync(new URL('../testdata/openapi-corpus/regressions.json', import.meta.url))).cases) {
  test('public-input reduction: '+fixture.name, () => {
    const report=checkOpenAPI(JSON.stringify(fixture.spec));
    assert.equal(report.complete,true);
    assert.deepEqual(report.diagnostics.map(({code,severity})=>({code,severity})),fixture.expected);
    assert.equal(report.ok,!fixture.expected.some(x=>x.severity==='error'));
    if (fixture.template) assert.equal(report.operations[0].template,fixture.template);
  });
}
