// Author-built GitHub repository browser scenario: changing the query size
// refreshes commits/releases while retaining the repository link and old state.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {catalogFromDocument} from './contracts.mjs';
import {fetchAuditOutputs,githubCliFetch} from './main.mjs';

export async function runLinkSelection({fetcher=fetch,evidence='live-github-api'}={}) {
  const startedAt = new Date().toISOString();
  const manifest = await readFile(new URL('requests.json',import.meta.url),'utf8');
  const catalog = catalogFromDocument(JSON.parse(manifest));
  const original = catalog.startSession({owner:'cjyhjy',repo:'moonbit-uri-template',per_page:'1'},
    {maxTotalOutputBytes:4096,maxTotalInputCodepoints:8192});
  const oldLinks = original.links();
  let networkCalls = 0;
  const counted = (...args) => { networkCalls++; return fetcher(...args); };
  const outputs = links => links.map((link,index)=>({...link,index,label:link.template}));
  const initial = await fetchAuditOutputs(outputs(oldLinks),{fetcher:counted});
  const report = {status:'running',evidence,executionPath:'incremental-catalog-sdk',
    startedAt,initial,networkCalls,
    manifestSha256:createHash('sha256').update(manifest).digest('hex')};
  if (initial.status !== 'passed') return {...report,status:'failed'};
  const noop = original.update({per_page:'1'});
  if (noop.recomputed !== 0 || noop.changes.length !== 0) throw Error('No-op regenerated links');
  // Removing per_page returns to GitHub's default page size; only these two
  // dependent links change, so the repository metadata need not be fetched again.
  const update = original.update({per_page:null});
  if (update.recomputed !== 2 || update.changes.length !== 2) throw Error('Unexpected dependency set');
  const changed = update.changes.map(change=>({template:change.template,uri:change.after}));
  const refreshed = await fetchAuditOutputs(outputs(changed),{fetcher:counted});
  const countBeforeRejected = networkCalls;
  let rejection;
  try { update.session.update({owner:[]}); }
  catch (error) { rejection = {code:error.code,templateName:error.templateName}; }
  if (rejection?.code !== 'BindingType') throw Error('Invalid typed patch was not rejected');
  const preserved = JSON.stringify(original.links()) === JSON.stringify(oldLinks);
  if (!preserved || update.session.get('repository') !== original.get('repository')) throw Error('Cached state mutated');
  return {...report,status:refreshed.status === 'passed' && networkCalls === 5 ? 'passed' : 'failed',
    completedAt:new Date().toISOString(),refreshed,networkCalls,
    noop:{recomputed:noop.recomputed,changes:noop.changes.length,networkCalls:0},
    update:{recomputed:update.recomputed,changes:update.changes,retained:['repository'],totalBytes:update.session.totalBytes},
    rejectedPatch:{...rejection,networkCalls:networkCalls-countBeforeRejected},oldSnapshotPreserved:preserved};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2), useGh=args[0]==='--gh'; if(useGh)args.shift();
  const [reportPath=fileURLToPath(new URL('../../reports/github-links-live.json',import.meta.url)),...extra]=args;
  if(extra.length)throw Error('Usage: node link-selection.mjs [--gh] [report.json]');
  const report=await runLinkSelection(useGh?{fetcher:githubCliFetch}:{});
  report.transport=useGh?'authenticated-gh-cli':'node-fetch-anonymous';
  report.engineSha256=createHash('sha256').update(await readFile(new URL('../../dist/engine.mjs',import.meta.url))).digest('hex');
  await mkdir(dirname(resolve(reportPath)),{recursive:true});
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(`${report.status}: ${report.networkCalls} HTTP requests; incremental links`);
  process.exitCode=report.status==='passed'?0:1;
}
