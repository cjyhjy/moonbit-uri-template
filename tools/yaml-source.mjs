// YAML 1.2 -> JSON values and source locations. All OpenAPI semantics stay in MoonBit.
import { parseDocument, isAlias, isMap, isSeq, isScalar } from '../dist/vendor/yaml/dist/index.js';

export function parseYamlSource(text, maxDepth = 128, maxBytes = 33554432) {
  const fail = (code, message, node, path = '') => {
    throw Object.assign(new Error(message), {code, path, start: node?.range?.[0] ?? 0});
  };
  const doc = parseDocument(text, {version:'1.2', schema:'core', strict:true, stringKeys:true, uniqueKeys:true, prettyErrors:false});
  const issue = doc.errors[0] ?? doc.warnings[0];
  if (issue) throw Object.assign(new Error(issue.code === 'DUPLICATE_KEY' ? 'duplicate YAML key' : 'invalid or unsupported YAML document'),
    {code:issue.code === 'DUPLICATE_KEY' ? 'DuplicateYamlKey' : 'InvalidYaml', start:issue.pos?.[0] ?? 0});
  if (doc.directives.yaml.version !== '1.2') fail('UnsupportedYaml', 'only YAML 1.2 is supported', doc.contents);
  const nodes = new Map(), keys = new Map(), active = new Set();
  let aliases = 0, count = 0, expandedBytes = 0;
  const pointer = key => key.replaceAll('~', '~0').replaceAll('/', '~1');
  const range = node => ({start:node?.range?.[0] ?? 0, end:node?.range?.[1] ?? 0});
  const charge = (size, node, path) => {
    expandedBytes += size;
    if (expandedBytes > maxBytes) fail('OpenAPIInputLimit', 'expanded YAML exceeds input byte budget', node, path);
  };
  function visit(node, path, depth, aliasSite = null) {
    if ((isMap(node) || isSeq(node)) && depth > maxDepth) fail('YamlDepthLimit', 'YAML nesting exceeds budget', aliasSite ?? node, path);
    if (++count > 1000000) fail('YamlNodeLimit', 'expanded YAML exceeds node budget', aliasSite ?? node, path);
    nodes.set(path, range(aliasSite ?? node));
    if (isAlias(node)) {
      if (++aliases > 100) fail('YamlAliasLimit', 'YAML alias expansion exceeds budget', node, path);
      const target = node.resolve(doc);
      if (!target) fail('InvalidYaml', 'unresolved YAML alias', node, path);
      if (active.has(target)) fail('YamlAliasCycle', 'cyclic YAML alias', node, path);
      return visit(target, path, depth, aliasSite ?? node);
    }
    if (active.has(node)) fail('YamlAliasCycle', 'cyclic YAML alias', node, path);
    if (!node) { charge(4, aliasSite, path); return null; }
    active.add(node);
    try {
      if (isMap(node)) {
        const out = Object.create(null);
        charge(2, aliasSite ?? node, path);
        for (const [index, pair] of node.items.entries()) {
          if (!isScalar(pair.key) || typeof pair.key.value !== 'string') fail('InvalidYaml', 'YAML object keys must be strings', pair.key, path);
          const key = pair.key.value, child = path + '/' + pointer(key);
          if (Object.hasOwn(out, key)) fail('DuplicateYamlKey', 'duplicate YAML key', pair.key, child);
          if (key === '<<' && (isAlias(pair.value) || (isSeq(pair.value) && pair.value.items.some(isAlias))))
            fail('UnsupportedYaml', 'YAML merge keys are not supported; use explicit properties', pair.key, child);
          charge(Buffer.byteLength(JSON.stringify(key)) + 1 + (index > 0 ? 1 : 0), aliasSite ?? pair.key, child);
          keys.set(child, range(aliasSite ?? pair.key));
          out[key] = visit(pair.value, child, depth + 1, aliasSite);
        }
        return out;
      }
      if (isSeq(node)) {
        charge(2 + Math.max(0, node.items.length - 1), aliasSite ?? node, path);
        return node.items.map((value, i) => visit(value, path + '/' + i, depth + 1, aliasSite));
      }
      if (!isScalar(node) || ![null, 'string', 'boolean', 'number'].includes(node.value === null ? null : typeof node.value))
        fail('InvalidYaml', 'YAML value is not JSON-compatible', node, path);
      if (typeof node.value === 'number' && !Number.isFinite(node.value)) fail('InvalidYaml', 'YAML numbers must be finite', node, path);
      charge(Buffer.byteLength(JSON.stringify(node.value)), aliasSite ?? node, path);
      return node.value;
    } finally { active.delete(node); }
  }
  return {value:visit(doc.contents, '', 1), nodes, keys};
}
