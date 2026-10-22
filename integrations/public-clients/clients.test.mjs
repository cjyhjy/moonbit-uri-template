import test from 'node:test';
import assert from 'node:assert/strict';
import {npmVersionUrl,bookUrl,npmVersion,book,pathContract} from './clients.mjs';
import {checkOpenAPI} from '../../tools/openapi.mjs';
test('curated path contract passes same core checker',()=>assert.equal(checkOpenAPI(JSON.stringify(pathContract)).ok,true));
test('SDK encodes scoped package as one path parameter',()=>assert.equal(npmVersionUrl('@types/node','22.0.0'),'https://registry.npmjs.org/%40types%2Fnode/22.0.0'));
test('SDK encodes book query and preserves fixed origin',()=>assert.equal(bookUrl('9780980200447'),'https://openlibrary.org/api/books?bibkeys=ISBN%3A9780980200447&format=json&jscmd=data'));
test('invalid inputs never reach transport',async()=>{
 let calls=0;const fetcher=()=>{calls++;};
 for(const name of ['..','https://evil.example/a','a?b','a/b']) await assert.rejects(npmVersion(name,'latest',{fetcher}));
 await assert.rejects(book('bad',{fetcher}));assert.equal(calls,0);
});
test('GET-only transport disables redirects and checks response identity',async()=>{
 const fetcher=async(url,opts)=>{assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');return Response.json({name:'typescript',version:'7.0.2'});};
 assert.equal((await npmVersion('typescript','7.0.2',{fetcher})).result.version,'7.0.2');
 await assert.rejects(npmVersion('other','7.0.2',{fetcher}),/UnexpectedPackageResponse/);
});
test('HTTP, malformed and oversized responses fail',async()=>{
 for(const fetcher of [async()=>new Response('',{status:429}),async()=>new Response('not json'),async()=>new Response('x'.repeat(1048577))]) await assert.rejects(npmVersion('typescript','latest',{fetcher}));
});
test('book response validated and summarized',async()=>{
 const r=await book('9780980200447',{fetcher:async()=>Response.json({'ISBN:9780980200447':{title:'Slow reading'}})});assert.equal(r.result.title,'Slow reading');assert.equal(r.sha256.length,64);
 await assert.rejects(book('9780980200447',{fetcher:async()=>Response.json({})}),/BookNotFound/);
});
