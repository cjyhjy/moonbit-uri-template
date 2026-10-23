import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

// Ship the pinned YAML input parser with the CLI so tarballs and portable ZIPs
// remain usable offline. OpenAPI analysis stays in the MoonBit engine.
const yamlRoot = join(root, 'node_modules/yaml');
const yamlPackage = JSON.parse(readFileSync(join(yamlRoot, 'package.json'), 'utf8'));
const expectedYaml = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies.yaml;
if (yamlPackage.version !== expectedYaml) throw new Error('YAML parser version differs from package lock');
const yamlOut = join(root, 'dist/vendor/yaml');
rmSync(yamlOut, {recursive:true, force:true});
mkdirSync(yamlOut, {recursive:true});
cpSync(join(yamlRoot, 'dist'), join(yamlOut, 'dist'), {recursive:true});
writeFileSync(join(yamlOut, 'package.json'), JSON.stringify({name:'yaml',version:yamlPackage.version,type:'commonjs',license:yamlPackage.license}) + '\n');
copyFileSync(join(yamlRoot, 'LICENSE'), join(yamlOut, 'LICENSE'));
copyFileSync(join(yamlRoot, 'LICENSE'), join(root, 'dist/licenses/yaml-LICENSE'));

mkdirSync(new URL('../dist/playground/', import.meta.url), { recursive: true });
for (const name of ['index.html','style.css','main.mjs','worker.mjs','compute.mjs','controller.mjs']) copyFileSync(new URL('../playground/'+name, import.meta.url), new URL('../dist/playground/'+name, import.meta.url));
copyFileSync(new URL('../dist/engine.mjs', import.meta.url), new URL('../dist/playground/engine.mjs', import.meta.url));
copyFileSync(new URL('./diagnostics.mjs', import.meta.url), new URL('../dist/playground/diagnostics.mjs', import.meta.url));
copyFileSync(new URL('./json-source.mjs', import.meta.url), new URL('../dist/playground/json-source.mjs', import.meta.url));
