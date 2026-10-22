import { openSync, closeSync, readSync } from 'node:fs';
import { parseSource, filePosition } from './json-source.mjs';
import { locate } from './diagnostics.mjs';
import { prepare_request, prepared_call } from '../dist/engine.mjs';
import { suggestBinding } from './suggestions.mjs';

const MAX_FILE = 1048576;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ptr = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
const call = (handle, command, vars) =>
  JSON.parse(prepared_call(handle, command, JSON.stringify(vars)));

export function readProjectFile(file, max = MAX_FILE) {
  const fd = openSync(file, 'r'), chunks = [];
  let size = 0;
  try {
    while (true) {
      const buf = Buffer.alloc(Math.min(65536, max + 1 - size));
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      size += n;
      if (size > max) throw Object.assign(new Error('input exceeds byte limit'), { code: 'ProjectInputLimit' });
      chunks.push(buf.subarray(0, n));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { closeSync(fd); }
}

export function checkProject(text, file = 'manifest.json', { materialize = true } = {}) {
  const diagnostics = [], outputs = [];
  let plannedBytes = 0;
  let parsed, activeRequest;
  const add = (code, message, path, error, template, suggestion) => {
    if (diagnostics.length >= 256) return;
    if (diagnostics.length === 255) {
      code = 'DiagnosticLimit'; message = 'diagnostics truncated at 256 entries';
      path = ''; error = undefined; template = undefined; suggestion = undefined;
    }
    const token = parsed?.nodes.get(path) ?? parsed?.nodes.get('');
    let start = token?.start ?? error?.start ?? 0, end = token?.end ?? error?.end ?? start;
    let templateLocation;
    if (template !== undefined && Number.isInteger(error?.start)) {
      templateLocation = locate(template, error);
      start = token.offsets[templateLocation.utf16Start] ?? token.end - 1;
      end = token.offsets[templateLocation.utf16End] ?? token.end - 1;
    }
    const begin = filePosition(text, start), finish = filePosition(text, end);
    diagnostics.push({ code, message, file, path, ...(activeRequest === undefined ? {} : { requestIndex: activeRequest }), ...begin, endLine: finish.line, endColumn: finish.column,
      offsetUnit: 'utf-16-code-unit', ...(templateLocation ? { templateLocation } : {}),
      ...(suggestion ? { suggestion } : {}) });
  };
  const finish = () => ({
    schemaVersion: 1, ok: diagnostics.length === 0, file, diagnostics,
    // Atomic: no generated URL escapes if any request/contract failed.
    outputs: diagnostics.length ? [] : outputs,
    totalOutputBytes: diagnostics.length ? 0 : plannedBytes,
  });
  if (Buffer.byteLength(text) > MAX_FILE) { add("ProjectInputLimit", "manifest exceeds 1 MiB", ""); return finish(); }
  try { parsed = parseSource(text); }
  catch (e) { add(e.code || 'InvalidJson', e.message, e.path ?? '', e); return finish(); }
  const doc = parsed.value;
  const known = (x, keys, path) => {
    for (const key of Object.keys(x)) if (!keys.includes(key)) add('UnknownField', 'unknown manifest field', path + '/' + ptr(key));
  };
  if (!object(doc)) { add('InvalidManifest', 'manifest must be an object', ''); return finish(); }
  known(doc, ['schemaVersion', 'templates', 'requests', 'maxTotalOutputBytes', 'maxTotalInputCodepoints'], '');
  if (doc.schemaVersion !== 1) add('InvalidManifest', 'schemaVersion must be 1', '/schemaVersion');
  if (!Array.isArray(doc.templates) || !Array.isArray(doc.requests)) {
    add('InvalidManifest', 'templates and requests must be arrays', ''); return finish();
  }
  if (doc.templates.length > 256 || doc.requests.length > 256) {
    add('ProjectItemLimit', 'at most 256 templates and 256 requests', ''); return finish();
  }
  const budget = (value, fallback, path) => {
    if (value === undefined) return fallback;
    if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
      add('InvalidLimit', 'budget must be an integer in 0..2147483647', path); return 0;
    }
    return value;
  };
  let remaining = budget(doc.maxTotalOutputBytes, 1048576, '/maxTotalOutputBytes');
  let remainingInput = budget(doc.maxTotalInputCodepoints, 4194304, '/maxTotalInputCodepoints');
  const catalog = new Map();
  doc.templates.forEach((entry, i) => {
    const path = `/templates/${i}`;
    if (!object(entry)) { add('InvalidTemplate', 'template entry must be an object', path); return; }
    known(entry, ['name', 'template', 'required', 'types', 'maxOutputBytes'], path);
    if (typeof entry.name !== 'string' || !entry.name || catalog.has(entry.name)) {
      add('CatalogName', 'empty, duplicate or invalid template name', path + '/name'); return;
    }
    if (typeof entry.template !== 'string') { add('InvalidTemplate', 'expected template string', path + '/template'); return; }
    const options = { strict: true, required: entry.required === undefined ? [] : entry.required, rejectUnused: true,
      maxOutput: budget(entry.maxOutputBytes, 8192, path + '/maxOutputBytes') };
    if (!Array.isArray(options.required) || options.required.some(n => typeof n !== 'string')) {
      add('InvalidRequired', 'required must be a string array', path + '/required'); return;
    }
    const handle = prepare_request(entry.template, JSON.stringify(options));
    const response = call(handle, 'variables', {});
    if (response.error) { add(response.error.code, response.error.message,
      path + (response.error.code === 'UnknownRequired' ? '/required' : '/template'),
      response.error, entry.template); return; }
    const names = JSON.parse(response.output);
    for (const name of options.required) if (!names.includes(name)) add('UnknownRequired', 'required name is not in template', path + '/required');
    if (entry.types !== undefined && !object(entry.types)) { add('InvalidTypes', 'types must be an object', path + '/types'); return; }
    for (const [name, type] of Object.entries(entry.types ?? {})) {
      if (!names.includes(name) || !['scalar', 'list', 'assoc'].includes(type)) add('InvalidTypes', 'unknown variable or type', path + '/types/' + ptr(name));
    }
    catalog.set(entry.name, { ...entry, options, path, names, handle });
  });
  const planned = [];
  doc.requests.forEach((req, i) => {
    if (diagnostics.length >= 256) return;
    activeRequest = i;
    const path = `/requests/${i}`;
    if (!object(req)) { add('InvalidRequest', 'request must be an object', path); return; }
    known(req, ['template', 'variables', 'label'], path);
    if (req.label !== undefined && typeof req.label !== 'string') add('InvalidLabel', 'label must be a string', path + '/label');
    const entry = catalog.get(req.template);
    if (!entry) { add('UnknownTemplate', 'unknown template name', path + '/template'); return; }
    if (!object(req.variables)) { add('InvalidVariables', 'variables must be an object', path + '/variables'); return; }
    for (const [name, type] of Object.entries(entry.types ?? {})) {
      const value = req.variables[name];
      if (value === undefined || value === null) continue; // required checks omission separately
      if (!(type === 'scalar' ? typeof value === 'string' : type === 'list' ? Array.isArray(value) : object(value))) {
        add('BindingType', `expected ${type}`, path + '/variables/' + ptr(name));
      }
    }
    // JSON serialization is also counted: a conservative aggregate input budget.
    remainingInput -= Array.from(JSON.stringify(req.variables)).length;
    if (remainingInput < 0) { add('ProjectInputLimit', 'aggregate serialized variables exceed budget', path + '/variables'); return; }
    const preflight = call(entry.handle, 'check', req.variables);
    if (preflight.error) { add(preflight.error.code, preflight.error.message, path + '/variables'); return; }
    const report = JSON.parse(preflight.output);
    for (const issue of report.missing) if (entry.options.required.includes(issue.name))
      add('MissingBinding', `required variable ${issue.name} is missing`, entry.path + '/template', issue, entry.template);
    for (const issue of report.omitted) if (entry.options.required.includes(issue.name))
      add('OmittedBinding', `required collection ${issue.name} is empty`, path + '/variables/' + ptr(issue.name));
    for (const name of report.unused) {
      const target = suggestBinding(name, entry.names.filter(n => !Object.hasOwn(req.variables, n)));
      const from = path + '/variables/' + ptr(name);
      add('UnusedBinding', target
        ? `binding ${JSON.stringify(name)} is not referenced; did you mean ${JSON.stringify(target)}?`
        : 'binding is not referenced by template', from, undefined, undefined,
        target ? { kind: 'rename-binding', from, to: path + '/variables/' + ptr(target) } : undefined);
    }
    for (const issue of report.invalid) add(issue.code, 'prefix requires a scalar', entry.path + '/template', issue, entry.template);
    // Validate/measure every request before allocating output strings.
    const result = call(entry.handle, 'measure', req.variables);
    if (result.error) {
      if (!['MissingBinding', 'OmittedBinding', 'UnusedBinding', 'PrefixOnComposite', 'UnknownRequired'].includes(result.error.code))
        add(result.error.code, result.error.message, entry.path + '/template', result.error, entry.template);
      return;
    }
    const bytes = Number(result.output);
    if (bytes > remaining) { add('ProjectOutputLimit', 'aggregate output exceeds budget', path); return; }
    remaining -= bytes;
    plannedBytes += bytes;
    planned.push({ req, entry, bytes, index: i });
  });
  activeRequest = undefined;
  if (diagnostics.length || !materialize) return finish();
  for (const { req, entry, bytes, index } of planned) {
    const result = call(entry.handle, 'trace', req.variables);
    if (result.error) { add(result.error.code, result.error.message, `/requests/${index}`); break; }
    const traced = JSON.parse(result.output);
    outputs.push({ index, label: req.label ?? String(index), template: req.template, uri: traced.uri, bytes, origins: traced.origins });
  }
  return finish();
}

const annotationEscape = value => String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
export function githubAnnotation(d) {
  const file = annotationEscape(d.file).replaceAll(':', '%3A').replaceAll(',', '%2C');
  return `::error file=${file},line=${d.line},col=${d.column},endLine=${d.endLine},endColumn=${d.endColumn}::${annotationEscape(d.code + ': ' + d.message)}`;
}
export async function projectMain(args) {
  const [file, mode] = args;
  if (!file || args.length > 2 || (mode && !['--json', '--github'].includes(mode))) {
    process.stderr.write('Usage: uri-template project MANIFEST.json [--json | --github]\n'); return 2;
  }
  let result;
  try { result = checkProject(readProjectFile(file), file); }
  catch (e) {
    result = { schemaVersion: 1, ok: false, file, outputs: [], diagnostics: [{ code: e.code === 'ProjectInputLimit' ? e.code : 'FileError', message: 'cannot read manifest within UTF-8/size limits', file, line: 1, column: 1, endLine: 1, endColumn: 1 }] };
  }
  if (mode === '--github') {
    for (const diagnostic of result.diagnostics) process.stdout.write(githubAnnotation(diagnostic) + '\n');
    if (result.ok) process.stdout.write(`Checked ${result.outputs.length} requests (${result.totalOutputBytes} URI bytes)\n`);
  } else if (mode === '--json') {
    (result.ok ? process.stdout : process.stderr).write(JSON.stringify(result) + '\n');
  } else if (result.ok) process.stdout.write(`Checked ${result.outputs.length} requests (${result.totalOutputBytes} URI bytes)\n`);
  else for (const d of result.diagnostics)
    process.stderr.write(JSON.stringify(`${d.file}:${d.line}:${d.column} ${d.code}: ${d.message}`) + '\n');
  return result.ok ? 0 : result.diagnostics.some(d => ['FileError', 'InvalidJson', 'JsonDepthLimit', 'ProjectInputLimit'].includes(d.code)) ? 2 : 1;
}
