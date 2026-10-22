import {compileTemplate} from '../../sdk/index.mjs';
import {checkOpenAPI} from '../../tools/openapi.mjs';
import {createHash} from 'node:crypto';
// Curated path contracts, not upstream-published OpenAPI documents.
export const pathContract = {openapi:'3.1.0',paths:{
  '/{package}/{version}':{get:{parameters:['package','version'].map(name=>({name,in:'path',required:true,schema:{type:'string'}}))}},
  '/api/books':{get:{}}
}};
const checked = checkOpenAPI(JSON.stringify(pathContract));
if (!checked.ok) throw new Error('Client path contract failed');
const npmTemplate=compileTemplate('https://registry.npmjs.org/{package}/{version}',{required:['package','version'],rejectUnused:true,types:{package:'scalar',version:'scalar'},maxOutput:4096});
const booksTemplate=compileTemplate('https://openlibrary.org/api/books{?bibkeys,format,jscmd}',{required:['bibkeys','format','jscmd'],rejectUnused:true,types:{bibkeys:'scalar',format:'scalar',jscmd:'scalar'},maxOutput:4096});
export function npmVersionUrl(name,version='latest') {
  if(typeof name!=='string'|| !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) || name==='.'||name==='..') throw new Error('InvalidPackage');
  if(typeof version!=='string'|| !/^[a-zA-Z0-9][a-zA-Z0-9.+_-]*$/.test(version)) throw new Error('InvalidVersion');
  return npmTemplate.expand({package:name,version});
}
export function bookUrl(isbn) {
  if(typeof isbn!=='string'|| !/^(?:\d{9}[\dX]|\d{13})$/.test(isbn)) throw new Error('InvalidISBN');
  return booksTemplate.expand({bibkeys:'ISBN:'+isbn,format:'json',jscmd:'data'});
}
async function getJson(url,fetcher) {
  const response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'application/json','User-Agent':'moonbit-uri-template-integration/0.3 (+https://github.com/cjyhjy/moonbit-uri-template)'}});
  if(!response.ok) throw new Error('HTTP '+response.status);
  if(!response.body) throw new Error('EmptyResponse');
  const chunks=[];let length=0;
  for await(const chunk of response.body) {length+=chunk.length;if(length>1048576) {throw new Error('ResponseSizeLimit');}chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  return {payload:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),evidence:{url,status:response.status,bytes:length,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
export async function npmVersion(name,version='latest',{fetcher=fetch}={}) {
  const {payload,evidence}=await getJson(npmVersionUrl(name,version),fetcher);
  if(payload?.name!==name || typeof payload.version!=='string' || (version!=='latest' && /^\d/.test(version) && payload.version!==version)) throw new Error('UnexpectedPackageResponse');
  return {...evidence,result:{name:payload.name,version:payload.version}};
}
export async function book(isbn,{fetcher=fetch}={}) {
  const {payload,evidence}=await getJson(bookUrl(isbn),fetcher);
  const data=payload?.['ISBN:'+isbn];
  if(!data||typeof data.title!=='string') throw new Error('BookNotFoundOrInvalidResponse');
  return {...evidence,result:{isbn,title:data.title}};
}
