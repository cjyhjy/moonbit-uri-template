// OpenAPI rules adapt into the existing MoonBit-backed SDK; no second URI engine.
import { compileTemplate } from '../sdk/index.mjs';
import { parseSource, filePosition } from './json-source.mjs';
import { readProjectFile } from './project.mjs';
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ptr = x => x.replaceAll('~', '~0').replaceAll('/', '~1');
const methods = ['get','put','post','delete','options','head','patch','trace'];
// Public descriptions are large: GitHub's is 13.5 MB.
export const DEFAULT_MAX_BYTES = 33554432;
export function checkOpenAPI(text, file = 'openapi.json', {maxBytes = DEFAULT_MAX_BYTES} = {}) {
  const diagnostics = [], operations = [];
  let parsed, complete = true;
  const add = (code, message, path = '', incomplete = false) => {
    if (incomplete) complete = false;
    if (diagnostics.length >= 256) return;
    if (diagnostics.length === 255) { code = 'DiagnosticLimit'; message = 'diagnostics truncated'; complete = false; }
    const token = parsed?.nodes.get(path) ?? parsed?.nodes.get('');
    diagnostics.push({code,message,file,path,...filePosition(text, token?.start ?? 0)});
  };
  const finish = () => ({schemaVersion:1,ok:diagnostics.length === 0,complete,file,scope:'OpenAPI 3.0/3.1 JSON path-parameter consistency',operations,diagnostics});
  if (Buffer.byteLength(text) > maxBytes) { add('OpenAPIInputLimit',`document exceeds ${maxBytes} bytes`,'',true); return finish(); }
  try { parsed = parseSource(text); } catch(e) { add(e.code ?? 'InvalidJson',e.message,e.path ?? '',true); return finish(); }
  const doc = parsed.value;
  if (!obj(doc) || !/^3\.(0|1)\.\d+$/.test(doc.openapi ?? '')) { add('UnsupportedVersion','expected OpenAPI 3.0.x or 3.1.x','/openapi',true); return finish(); }
  // 3.1 documents may describe only webhooks or components.
  if (doc.paths === undefined && doc.openapi.startsWith('3.1.')) return finish();
  if (!obj(doc.paths)) { add('InvalidPaths','paths must be an object','/paths',true); return finish(); }
  function resolve(value, path) {
    const seen = new Set();
    while (obj(value) && Object.hasOwn(value,'$ref')) {
      const ref = value.$ref;
      if (typeof ref !== 'string' || !ref.startsWith('#/')) { add('UnsupportedReference','only local JSON Pointer references are supported',path,true); return null; }
      // Path Item siblings have undefined merge semantics; never guess.
      if (Object.keys(value).some(k => !['$ref','summary','description'].includes(k))) { add('ReferenceSiblings','reference siblings need review',path,true); return null; }
      if (seen.has(ref) || seen.size >= 32) { add('ReferenceCycle','cyclic or excessive reference chain',path,true); return null; }
      seen.add(ref);
      let parts;
      try { parts = decodeURIComponent(ref.slice(1)).slice(1).split('/').map(x => {
        if (/~(?![01])/u.test(x)) throw Error();
        return x.replaceAll('~1','/').replaceAll('~0','~');
      }); } catch { add('InvalidReference','invalid JSON Pointer',path,true); return null; }
      value = doc;
      for (const part of parts) { if (!obj(value) && !Array.isArray(value) || !Object.hasOwn(value,part)) { value = undefined; break; } value = value[part]; }
      if (value === undefined) { add('UnresolvedReference','reference target does not exist',path,true); return null; }
    }
    if (!obj(value)) { add('InvalidObject','expected an object',path,true); return null; }
    return value;
  }
  function parameters(value,path,names) {
    const result = new Map();
    if (value === undefined) return result;
    if (!Array.isArray(value)) { add('InvalidParameters','parameters must be an array',path,true); return result; }
    for (const [i,raw] of value.entries()) {
      const where = `${path}/${i}`, p = resolve(raw,where);
      if (!p) continue;
      if (typeof p.name !== 'string' || !p.name || !['path','query','header','cookie'].includes(p.in)) { add('InvalidParameter','parameter requires name and valid in',where); continue; }
      const key = JSON.stringify([p.in,p.name]);
      if (result.has(key)) add('DuplicateParameter','duplicate name and location in the same parameter list',where);
      result.set(key,p);
      if (p.in === 'path') {
        if (p.required !== true) add('PathParameterRequired','path parameter must set required: true',where);
        if (!names.includes(p.name)) add('UnusedPathParameter',`path does not contain parameter ${p.name}`,where);
      }
    }
    return result;
  }
  const shapes = new Map();
  for (const [path,raw] of Object.entries(doc.paths)) {
    if (path.startsWith('x-')) continue;
    const where = '/paths/'+ptr(path);
    if (!path.startsWith('/') || /[?#]/.test(path)) { add('InvalidPath','path must start with / and cannot contain query or fragment',where); continue; }
    const names = [], aliases = new Map();
    // OAS names need not satisfy RFC 6570 varname grammar. Use opaque aliases.
    const normalized = path.replace(/\{([^{}]+)\}/g, (_,name) => {
      if (!aliases.has(name)) { aliases.set(name,'v'+names.length); names.push(name); }
      return '{'+aliases.get(name)+'}';
    });
    const literal = path.replace(/\{[^{}]+\}/g,'');
    if (/[{}]/.test(literal)) { add('InvalidPathTemplate','unbalanced or empty path placeholder',where); continue; }
    // RFC 6570 literals admit more than RFC 3986 pchar (e.g. [ ] and non-ASCII); OAS paths use pchar.
    const bad = literal.replace(/%[0-9A-Fa-f]{2}/g,'').match(/[^A-Za-z0-9\-._~!$&'()*+,;=:@/]/u);
    if (bad) { add('InvalidPath',`path literal contains ${JSON.stringify(bad[0])}; percent-encode it`,where); continue; }
    let core;
    // Non-strict parsing admits the apostrophe, which OAS path literals allow.
    try { core = compileTemplate(normalized); } catch(e) { add('InvalidPathTemplate',e.message,where); continue; }
    const shape = normalized.replace(/\{v\d+\}/g,'{}');
    if (shapes.has(shape)) add('EquivalentPaths',`same path hierarchy as ${shapes.get(shape)}`,where);
    else shapes.set(shape,path);
    const item = resolve(raw,where);
    if (!item) continue;
    const base = parameters(item.parameters,where+'/parameters',names);
    const ops = methods.filter(m => Object.hasOwn(item,m));
    // A Path Item without operations (e.g. filtered by ACL) needs no path parameters.
    for (const method of ops) {
      const opWhere = where+'/'+method, op = item[method];
      if (!obj(op)) { add('InvalidOperation','operation must be an object',opWhere); continue; }
      const effective = new Map([...base,...parameters(op.parameters,opWhere+'/parameters',names)]);
      for (const alias of core.variables) {
        const name = names[Number(alias.slice(1))];
        if (!effective.has(JSON.stringify(['path',name]))) add('MissingPathParameter',`missing path parameter ${name}`,opWhere);
      }
      operations.push({path,method:method.toUpperCase(),variables:names,coreTemplate:normalized});
    }
  }
  return finish();
}
function parseArgs(args) {
  const [file, ...rest] = args;
  let json = false, maxBytes = DEFAULT_MAX_BYTES;
  if (!file || file.startsWith('--')) return null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json' && !json) json = true;
    else if (rest[i] === '--max-bytes' && /^[1-9]\d{0,9}$/.test(rest[i+1] ?? '')) maxBytes = Number(rest[++i]);
    else return null;
  }
  return {file, json, maxBytes};
}
export async function openapiMain(args) {
  const options = parseArgs(args), json = args.includes('--json');
  let report;
  if (!options) {
    report = {ok:false,complete:false,diagnostics:[{code:'InvalidArguments',message:'Usage: uri-template openapi FILE.json [--json] [--max-bytes N]'}]};
  } else {
    const {file, maxBytes} = options;
    try { report = checkOpenAPI(readProjectFile(file, maxBytes), file, {maxBytes}); }
    catch(e) { report = e.code === 'ProjectInputLimit'
      ? {ok:false,complete:false,diagnostics:[{code:'OpenAPIInputLimit',message:`document exceeds ${maxBytes} bytes; raise with --max-bytes`}]}
      : {ok:false,complete:false,diagnostics:[{code:'FileError',message:'cannot read OpenAPI JSON as UTF-8'}]}; }
  }
  const exit = report.ok ? 0 : report.complete ? 1 : 2;
  const stream = exit ? process.stderr : process.stdout;
  if (json) stream.write(JSON.stringify({...report,exitCode:exit})+'\n');
  else if (report.ok) stream.write(`Checked ${report.operations.length} OpenAPI operations\n`);
  else for (const d of report.diagnostics) stream.write(`${d.file ?? ''}:${d.line ?? 1}:${d.column ?? 1} ${d.code}: ${d.message}\n`);
  return exit;
}
