#!/usr/bin/env node
import { openSync, closeSync, readSync } from 'node:fs';
import { locate, humanDiagnostic } from './diagnostics.mjs';

const help = `URI Template — RFC 6570 Level 4
Usage:
  uri-template expand TEMPLATE [--vars JSON | --vars-file FILE|-]
  uri-template measure TEMPLATE [--vars JSON | --vars-file FILE|-]
  uri-template trace TEMPLATE [--vars JSON | --vars-file FILE|-]
  uri-template openapi FILE [--format auto|json|yaml] [--json | --templates] [--max-bytes N]
  uri-template project MANIFEST.json [--json | --github]
  uri-template check TEMPLATE [--vars JSON | --vars-file FILE|-]
  uri-template validate TEMPLATE [--strict]
  uri-template variables TEMPLATE
  uri-template analyze TEMPLATE [--strict] [--json]
  uri-template compare BEFORE AFTER [--json]
  uri-template --help | --version

Options:
  --strict                  RFC literal grammar (also applies to expansion)
  --required NAME            Require one variable; repeat for multiple names
  --require-all              Require all referenced variables
  --reject-unused            Reject bindings not referenced by the template
  --json                    JSON envelope; errors on stderr, success on stdout
  --max-template N           Template Unicode code points (default 1048576)
  --max-expressions N        Expressions (4096)
  --max-vars-per-expression N  Variable specs in each expression (256)
  --max-variables N          Total variable specs (65536)
  --max-output N             Output ASCII bytes (1048576)
  --max-bindings N           Bindings including unused names (4096)
  --max-members N            Total collection members (65536)
  --max-value N              Code points per name, key or value (1048576)
  --max-total-value N        Total input code points (4194304)
  --max-json N               Raw variables JSON code points (4194304)
  --max-json-depth N         JSON nesting depth (32)

check reports missing/omitted/unused/invalid without expanding; findings exit 1.
compare strictly parses both templates; changes exit 1 with report on stdout, errors exit 2.
Required/unused flags apply to expand, measure and trace. Zero budgets are valid.
Quote templates in the shell. Values: strings, numbers, booleans, lists or objects of those, null.
Exit codes: 0 success; 1 template/expansion/preflight findings; 2 input/environment error.`;
const numberFlags = {
  '--max-template': 'maxTemplate', '--max-expressions': 'maxExpressions',
  '--max-vars-per-expression': 'maxVarsPerExpression', '--max-variables': 'maxVariables',
  '--max-output': 'maxOutput', '--max-bindings': 'maxBindings', '--max-members': 'maxMembers',
  '--max-value': 'maxValue', '--max-total-value': 'maxTotalValue', '--max-json': 'maxJson', '--max-json-depth': 'maxJsonDepth',
};
const args = process.argv.slice(2);
let jsonMode = false;
const bad = message => { throw Object.assign(new Error(message), { code: 'InvalidArguments' }); };
function readBounded(file, maxChars) {
  const fd = file === '-' ? 0 : openSync(file, 'r');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const buffer = Buffer.alloc(Math.min(65536, maxChars * 4 + 1 - size));
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      size += count;
      if (size > maxChars * 4) throw Object.assign(new Error('variables JSON file exceeds byte guard'), { code: 'JsonInputLimit' });
      chunks.push(buffer.subarray(0, count));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally { if (fd !== 0) closeSync(fd); }
}
async function main() {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(help); return; }
  if (args.length === 1 && args[0] === '--version') { console.log('0.4.0'); return; }
  if (args[0] === 'openapi') {
    const { openapiMain } = await import('./openapi.mjs');
    process.exitCode = await openapiMain(args.slice(1));
    return;
  }
  if (args[0] === 'project') {
    const { projectMain } = await import('./project.mjs');
    process.exitCode = await projectMain(args.slice(1));
    return;
  }
  if (args[0] === 'compare') {
    const [, before, after, ...flags] = args;
    jsonMode = flags.includes('--json');
    if (before === undefined || after === undefined || flags.length > 1 ||
      flags.some(f => f !== '--json')) bad('Usage: uri-template compare BEFORE AFTER [--json]');
    const { compileTemplate, UriTemplateError } = await import('../sdk/index.mjs');
    let side = 'before';
    try {
      const old = compileTemplate(before, { strict: true });
      side = 'after';
      const next = compileTemplate(after, { strict: true });
      const report = old.compare(next);
      process.exitCode = report.requiresReview ? 1 : 0;
      // Differences are a completed comparison, so the report stays on stdout.
      process.stdout.write(JSON.stringify(jsonMode ? { schemaVersion: 1, exitCode: process.exitCode, report } : report, null, jsonMode ? 0 : 2) + '\n');
    } catch (error) {
      if (!(error instanceof UriTemplateError)) throw error;
      process.exitCode = 2;
      const detail = { ...error, templateSide: side, message: error.message };
      process.stderr.write(jsonMode ? JSON.stringify({ schemaVersion: 1, exitCode: 2, error: detail }) + '\n' : `${side}: ${humanDiagnostic(error)}`);
    }
    return;
  }
  const [command, template, ...flags] = args;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--json') jsonMode = true;
    else if (flags[i] in numberFlags || ['--vars', '--vars-file', '--required'].includes(flags[i])) i++;
  }
  const config = {}, seen = new Set();
  let vars = '{}', varsFile, hasVars = false;
  // Recognize --json only in flag positions, never inside template/JSON values.
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (seen.has(flag) && flag !== '--required') bad(`duplicate option: ${flag}`);
    seen.add(flag);
    if (flag === '--json') { jsonMode = true; continue; }
    if (['--strict', '--require-all', '--reject-unused'].includes(flag)) {
      config[{ '--strict': 'strict', '--require-all': 'requireAll', '--reject-unused': 'rejectUnused' }[flag]] = true;
      continue;
    }
    if (!(flag in numberFlags) && !['--vars', '--vars-file', '--required'].includes(flag)) bad(`unknown option: ${flag}`);
    const value = flags[++i];
    if (value === undefined) bad(`missing value for ${flag}`);
    if (flag in numberFlags) {
      if (!/^\d+$/.test(value) || Number(value) > 2147483647) bad(`${flag} expects an integer in 0..2147483647`);
      config[numberFlags[flag]] = Number(value);
    } else if (flag === '--required') {
      (config.required ??= []).push(value);
    } else {
      if (hasVars) bad('choose one --vars or --vars-file');
      hasVars = true;
      if (flag === '--vars') vars = value; else varsFile = value;
    }
  }
  if (!['expand', 'check', 'validate', 'variables', 'measure', 'trace', 'analyze'].includes(command) || template === undefined) bad(help);
  if (hasVars && !['expand', 'check', 'measure', 'trace'].includes(command)) bad('variables input applies to expand or check');
  if (!['expand', 'measure', 'trace'].includes(command) && (config.required || config.requireAll || config.rejectUnused)) bad('required/unused flags apply to expand');
  if (varsFile !== undefined) {
    try { vars = readBounded(varsFile, config.maxJson ?? 4194304); }
    catch (e) { throw Object.assign(new Error(e.code === 'JsonInputLimit' ? e.message : 'cannot read variables file as UTF-8'), { code: e.code === 'JsonInputLimit' ? e.code : 'FileError' }); }
  }
  let request;
  try { ({ request_with_options: request } = await import('../dist/engine.mjs')); }
  catch { throw Object.assign(new Error('run npm run build first'), { code: 'BuildRequired' }); }
  const response = JSON.parse(request(command, template, vars, JSON.stringify(config)));
  if (response.error) response.error = locate(template, response.error);
  if (command === 'check' && response.exitCode === 0) {
    response.report = JSON.parse(response.output);
    if (['missing', 'omitted', 'unused', 'invalid'].some(k => response.report[k].length)) response.exitCode = 1;
  }
  process.exitCode = response.exitCode;
  const stream = response.exitCode ? process.stderr : process.stdout;
  if (jsonMode) stream.write(JSON.stringify({ schemaVersion: 1, ...response }) + '\n');
  else if (response.error) stream.write(humanDiagnostic(response.error));
  else if (response.report) stream.write(JSON.stringify(response.report, null, 2) + '\n');
  else stream.write(response.output + '\n');
}
try { await main(); }
catch (error) {
  process.exitCode = 2;
  const data = { code: error.code || 'InputError', message: error.message };
  process.stderr.write(jsonMode ? JSON.stringify({ schemaVersion: 1, exitCode: 2, error: data }) + '\n' : humanDiagnostic(data));
}
