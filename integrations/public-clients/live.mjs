import {npmVersion,book} from './clients.mjs';
import {writeFileSync} from 'node:fs';
const report={schemaVersion:1,evidence:'live-public-api',startedAt:new Date().toISOString(),contractOrigin:'locally curated; not an official upstream OpenAPI document',externalUserFeedback:false,results:[]};
// Sequential requests, no credentials and no writes to external services.
for(const [name,run] of [['npm-unscoped',()=>npmVersion('typescript','7.0.2')],['npm-scoped',()=>npmVersion('@types/node','22.0.0')],['openlibrary-book',()=>book('9780980200447')]]) {
 try {report.results.push({name,ok:true,...await run()});}catch(e){report.results.push({name,ok:false,error:e.message});}
}
report.finishedAt=new Date().toISOString();report.ok=report.results.every(x=>x.ok);
writeFileSync(new URL('../../reports/public-clients-live.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));process.exitCode=report.ok?0:1;
