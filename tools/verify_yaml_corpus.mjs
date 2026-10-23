// Compare real catalog JSON/YAML pairs, pinning both byte representations.
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {sha256, download, runWorker} from './openapi_corpus.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = name => root + name;
const lockPath = path('testdata/openapi-corpus/yaml-manifest.json');
const reportPath = path('reports/openapi-yaml-parity.json');
const args = process.argv.slice(2);
if (args.some(x => !['--snapshot','--download','--help'].includes(x))) throw new Error('unknown option');
if (args.includes('--help')) {
  console.log('Usage: node tools/verify_yaml_corpus.mjs [--snapshot | --download]\n--snapshot pins YAML equivalents for the corpus entries with YAML original URLs. Otherwise compare cached pinned pairs; --download permits missing-file downloads. JSON/YAML equivalence is not an upstream correctness claim.');
  process.exit(0);
}
const report = {schemaVersion:1,status:'running',startedAt:new Date().toISOString(),
  evidence:'same-catalog-document-json-yaml-parity', analyzerSha256:sha256(readFileSync(path('dist/engine.mjs'))),
  runnerSha256:sha256(readFileSync(fileURLToPath(import.meta.url))),
  adapterSha256:sha256(['tools/openapi.mjs','tools/json-source.mjs','tools/yaml-source.mjs','sdk/openapi.mjs'].map(name => name+'\0'+readFileSync(path(name),'utf8')).join('\0')),
  parserVersion:JSON.parse(readFileSync(path('dist/vendor/yaml/package.json'))).version, results:[]};
const save = () => writeFileSync(reportPath, JSON.stringify(report,null,2)+'\n');
save();
try {
  mkdirSync(path('_build/openapi-corpus'),{recursive:true});
  const snapshot = args.includes('--snapshot');
  const lock = snapshot ? {schemaVersion:1,createdAt:new Date().toISOString(),
    documents:JSON.parse(readFileSync(path('testdata/openapi-corpus/manifest.json'))).documents.filter(x =>
      x.origins.some(o => /\.ya?ml(?:\?|$)/i.test(o.url ?? ''))).map(x => ({id:x.id,json:{url:x.url,sha256:x.sha256,bytes:x.bytes},yaml:{url:x.yamlUrl}}))}
    : JSON.parse(readFileSync(lockPath));
  if (snapshot) writeFileSync(lockPath,JSON.stringify(lock,null,2)+'\n');
  for (const item of lock.documents) {
    const row = {id:item.id};
    try {
      for (const format of ['json','yaml']) {
        const meta = item[format];
        if (format === 'yaml' && snapshot) {
          const bytes = await download(meta.url);
          meta.sha256 = sha256(bytes); meta.bytes = bytes.length;
          writeFileSync(path('_build/openapi-corpus/'+meta.sha256+'.yaml'),bytes);
          writeFileSync(lockPath,JSON.stringify(lock,null,2)+'\n');
        }
        if (!/^[a-f0-9]{64}$/.test(meta.sha256 ?? '')) throw new Error('unpinned '+format+' input');
        const cached = path('_build/openapi-corpus/'+meta.sha256+'.'+format);
        if (!existsSync(cached) && args.includes('--download')) writeFileSync(cached,await download(meta.url));
        const bytes = readFileSync(cached);
        if (bytes.length !== meta.bytes || sha256(bytes) !== meta.sha256) throw new Error(format+' checksum mismatch');
        const result = runWorker(cached);
        row[format] = {sha256:meta.sha256,bytes:meta.bytes, ...result};
      }
      row.equal = Boolean(row.json.semanticSha256 && row.json.semanticSha256 === row.yaml.semanticSha256);
      if (!row.equal) row.error = 'JSON and YAML analysis differ';
    } catch (error) {row.equal=false;row.error=error.message.replaceAll(root,'<repository>/');}
    report.results.push(row); save();
    console.log(`${row.equal ? 'equal' : 'FAILED'}: ${row.id}`);
  }
  report.manifestSha256=sha256(readFileSync(lockPath));
  report.summary={documents:report.results.length,equal:report.results.filter(x=>x.equal).length};
  report.status=report.results.length && report.results.every(x=>x.equal) ? 'passed' : 'failed';
  if (report.status !== 'passed') process.exitCode=1;
} catch (error) {report.status='failed';report.error=error.message;process.exitCode=1;}
finally {report.finishedAt=new Date().toISOString();save();}
