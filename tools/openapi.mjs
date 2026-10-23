// CLI and source positions for the SDK's OpenAPI analysis; no second URI engine.
import { analyzeOpenApi } from '../sdk/openapi.mjs';
import { parseSource, filePosition } from './json-source.mjs';
import { readProjectFile } from './project.mjs';
// Public descriptions are large: GitHub's is 13.5 MB.
export const DEFAULT_MAX_BYTES = 33554432;
// Cloudflare's description nests 44 levels deep.
const MAX_DEPTH = 128;
const SCOPE = 'OpenAPI 3.0/3.1 JSON paths, path parameters and RFC 6570 serialization of path and query parameters';

export function checkOpenAPI(text, file = 'openapi.json', {maxBytes = DEFAULT_MAX_BYTES} = {}) {
  const failed = (code, message, path = '', offset = 0) => ({schemaVersion:2,ok:false,complete:false,file,scope:SCOPE,operations:[],
    diagnostics:[{code,severity:'error',message,file,path,...filePosition(text,offset)}],truncated:{errors:0,warnings:0}});
  if (Buffer.byteLength(text) > maxBytes) return failed('OpenAPIInputLimit',`document exceeds ${maxBytes} bytes`);
  let parsed;
  try { parsed = parseSource(text, MAX_DEPTH); } catch(e) { return failed(e.code ?? 'InvalidJson',e.message,e.path ?? '',e.start ?? 0); }
  const report = analyzeOpenApi(parsed.value);
  // Diagnostics point at the JSON value their pointer names, or at the document root.
  // Line starts are indexed once; slicing a 27 MB document per diagnostic took seconds.
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const at = path => {
    const offset = (parsed.nodes.get(path) ?? parsed.nodes.get(''))?.start ?? 0;
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
  return {...report,file,scope:SCOPE,diagnostics:report.diagnostics.map(d => ({...d,file,...at(d.path)}))};
}

function parseArgs(args) {
  const [file, ...rest] = args;
  let json = false, templates = false, maxBytes = DEFAULT_MAX_BYTES;
  if (!file || file.startsWith('--')) return null;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--json' && !json) json = true;
    else if (rest[i] === '--templates' && !templates) templates = true;
    else if (rest[i] === '--max-bytes' && /^[1-9]\d{0,9}$/.test(rest[i+1] ?? '')) maxBytes = Number(rest[++i]);
    else return null;
  }
  if (json && templates) return null;
  return {file, json, templates, maxBytes};
}
const line = d => `${d.file ?? ''}:${d.line ?? 1}:${d.column ?? 1} ${d.severity === 'warning' ? 'warning ' : ''}${d.code}: ${d.message}\n`;
export function summary(report) {
  const ops = report.operations, templated = ops.filter(o => o.template !== null).length;
  const unsupported = ops.reduce((n, o) => n + o.unsupported.length, 0);
  const warnings = report.diagnostics.filter(d => d.severity === 'warning').length + report.truncated.warnings;
  return `Checked ${ops.length} OpenAPI operations; ${templated} RFC 6570 templates; ${unsupported} parameters without an RFC 6570 equivalent; ${warnings} warnings\n`;
}
export async function openapiMain(args) {
  const options = parseArgs(args), json = args.includes('--json');
  let report;
  if (!options) {
    report = {ok:false,complete:false,operations:[],diagnostics:[{code:'InvalidArguments',severity:'error',message:'Usage: uri-template openapi FILE.json [--json | --templates] [--max-bytes N]'}],truncated:{errors:0,warnings:0}};
  } else {
    const {file, maxBytes} = options;
    try { report = checkOpenAPI(readProjectFile(file, maxBytes), file, {maxBytes}); }
    catch(e) { report = {ok:false,complete:false,operations:[],truncated:{errors:0,warnings:0},diagnostics:[e.code === 'ProjectInputLimit'
      ? {code:'OpenAPIInputLimit',severity:'error',message:`document exceeds ${maxBytes} bytes; raise with --max-bytes`}
      : {code:'FileError',severity:'error',message:'cannot read OpenAPI JSON as UTF-8'}]}; }
  }
  const exit = report.ok ? 0 : report.complete ? 1 : 2;
  const stream = exit ? process.stderr : process.stdout;
  if (json) { stream.write(JSON.stringify({...report,exitCode:exit})+'\n'); return exit; }
  if (options?.templates) for (const o of report.operations)
    process.stdout.write(`${o.method} ${o.path}\t${o.template ?? '(no RFC 6570 template)'}\n`);
  for (const d of report.diagnostics) stream.write(line(d));
  if (report.operations.length || report.ok) stream.write(summary(report));
  return exit;
}
