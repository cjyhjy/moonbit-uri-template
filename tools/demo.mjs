import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
for (const args of [
  ['expand', '/users/{id}{?page,limit}', '--vars-file', 'examples/users.json'],
  ['expand', '/search{?q,tags*}', '--vars-file', 'examples/search.json'],
  ['expand', 'https://example.com{+path}{#fragment}', '--vars-file', 'examples/resource.json'],
  ['validate', '/users/{id'],
]) {
  console.log('\n$ uri-template ' + args.map(x => JSON.stringify(x)).join(' '));
  const result = spawnSync(process.execPath, ['tools/cli.mjs', ...args], { cwd: root, encoding: 'utf8' });
  process.stdout.write(result.stdout);
  process.stdout.write(result.stderr);
  if (result.status !== (args[0] === 'validate' ? 1 : 0)) process.exit(1);
}
