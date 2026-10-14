import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync('./tools/moon', ['build', '--target', 'js', '--release', '--deny-warn'], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) process.exit(result.status || 1);
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
copyFileSync(new URL('../_build/js/release/build/cmd/uri_template/uri_template.js', import.meta.url), new URL('../dist/engine.mjs', import.meta.url));
console.log('Built dist/engine.mjs (MoonBit core + JSON adapter)');
