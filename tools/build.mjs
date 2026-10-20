import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('./tools/moon', ['build', '--target', 'js', '--release', '--deny-warn'], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(result.status || 1);
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
copyFileSync(new URL('../_build/js/release/build/cmd/uri_template/uri_template.js', import.meta.url), new URL('../dist/engine.mjs', import.meta.url));
console.log('Built dist/engine.mjs (MoonBit core + JSON adapter)');
const license = [join(root, '.toolchain/lib/core/LICENSE'),
  join(process.env.MOON_HOME ?? join(homedir(), '.moon'), 'lib/core/LICENSE')].find(existsSync);
if (!license) throw new Error('MoonBit core license is required for distribution');
mkdirSync(new URL('../dist/licenses/', import.meta.url), { recursive: true });
copyFileSync(license, new URL('../dist/licenses/moonbit-core-LICENSE', import.meta.url));

mkdirSync(new URL('../dist/playground/', import.meta.url), { recursive: true });
for (const name of ['index.html','style.css','main.mjs','worker.mjs','compute.mjs','controller.mjs']) copyFileSync(new URL('../playground/'+name, import.meta.url), new URL('../dist/playground/'+name, import.meta.url));
copyFileSync(new URL('../dist/engine.mjs', import.meta.url), new URL('../dist/playground/engine.mjs', import.meta.url));
copyFileSync(new URL('./diagnostics.mjs', import.meta.url), new URL('../dist/playground/diagnostics.mjs', import.meta.url));
copyFileSync(new URL('./json-source.mjs', import.meta.url), new URL('../dist/playground/json-source.mjs', import.meta.url));
