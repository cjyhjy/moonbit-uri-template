#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const help = `URI Template — RFC 6570 Level 4
Usage:
  uri-template expand TEMPLATE [--vars JSON | --vars-file FILE]
  uri-template validate TEMPLATE [--strict]
  uri-template variables TEMPLATE
  uri-template --help
  uri-template --version

Quote templates in the shell. JSON values are strings, string lists,
string/null objects, or null. Numbers and booleans require explicit strings.
Exit codes: 0 success; 1 template/expansion error; 2 input/environment error.`;

function inputError(code, message) {
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 2;
}
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(help);
} else if (args.length === 1 && args[0] === '--version') {
  console.log('0.1.0');
} else {
  const [command, template, ...options] = args;
  if (!['expand', 'validate', 'variables'].includes(command) || template === undefined) {
    inputError('InvalidArguments', help);
  } else {
    let vars = '{}';
    let engineCommand = command;
    let valid = true;
    if (command === 'validate' && options.length === 1 && options[0] === '--strict') {
      engineCommand = 'validate-strict';
    } else if (options.length) {
      if (command !== 'expand' || options.length !== 2 || !['--vars', '--vars-file'].includes(options[0])) {
        valid = false;
        inputError('InvalidArguments', 'expected at most one --vars JSON or --vars-file FILE');
      } else if (options[0] === '--vars') {
        vars = options[1];
      } else {
        try { vars = readFileSync(options[1], 'utf8'); }
        catch (error) { valid = false; inputError('FileError', error.message); }
      }
    }
    if (valid) {
      let request;
      try { ({ request } = await import('../dist/engine.mjs')); }
      catch { inputError('BuildRequired', 'run npm run build first'); }
      if (request) {
        const response = JSON.parse(request(engineCommand, template, vars));
        process.exitCode = response.exitCode;
        if (response.exitCode === 0) process.stdout.write(response.output + '\n');
        else {
          const error = response.error;
          let where = '';
          if ('start' in error) {
            const before = Array.from(template).slice(0, error.start);
            let line = 1, column = 1;
            for (const char of before) {
              if (char === '\n') { line++; column = 1; }
              else column++;
            }
            where = ` at ${line}:${column} (code points ${error.start}..${error.end})`;
          } else if ('path' in error) where = ` at JSON Pointer ${JSON.stringify(error.path)}`;
          process.stderr.write(`${error.code}${where}: ${error.message}\n`);
        }
      }
    }
  }
}
