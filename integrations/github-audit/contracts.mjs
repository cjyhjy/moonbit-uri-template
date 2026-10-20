import { compileCatalog, UriTemplateError } from '../../sdk/index.mjs';
import { checkProject } from '../../tools/project.mjs';
import { parseSource } from '../../tools/json-source.mjs';

// Call only after project schema validation. The CLI's scalar/list/assoc schema
// is also captured by the SDK, so direct plans and upgrade reviews enforce it.
export function catalogFromDocument(doc) {
  return compileCatalog(Object.fromEntries(doc.templates.map(entry => [entry.name, {
    template: entry.template,
    required: entry.required ?? [],
    types: entry.types ?? {},
    maxOutput: entry.maxOutputBytes ?? 8192,
  }])));
}

export function planRequests(doc, catalog = catalogFromDocument(doc)) {
  const inspection = catalog.inspect(doc.requests, { maxTotalInputCodepoints: doc.maxTotalInputCodepoints ?? 4194304 });
  if (!inspection.ok) return { ok: false, inspection, outputs: [] };
  const uris = catalog.expandMany(doc.requests, {
    maxTotalInputCodepoints: doc.maxTotalInputCodepoints ?? 4194304,
    maxTotalOutputBytes: doc.maxTotalOutputBytes ?? 1048576,
  });
  const outputs = uris.map((uri, index) => ({
    index, template: doc.requests[index].template,
    label: doc.requests[index].label ?? String(index), uri, bytes: Buffer.byteLength(uri),
  }));
  return { ok: true, inspection, outputs, totalOutputBytes: outputs.reduce((sum, x) => sum + x.bytes, 0) };
}

export function prepareAudit(manifest, file) {
  const checks = checkProject(manifest, file, { materialize: false });
  if (!checks.ok) return { ok: false, checks, outputs: [] };
  try {
    // checkProject has already rejected duplicate keys, invalid types and limits.
    const plan = planRequests(JSON.parse(manifest));
    return { ...plan, checks, executionPath: 'typed-catalog-sdk' };
  } catch (error) {
    if (!(error instanceof UriTemplateError)) throw error;
    return { ok: false, checks, outputs: [], executionPath: 'typed-catalog-sdk',
      error: { code: error.code, message: error.message, index: error.index, templateName: error.templateName } };
  }
}

// Validate the entire batch before any HTTP. No URL normalization is accepted.
export function destinationProblems(outputs) {
  const problems = [];
  for (const item of outputs) {
    let accepted = false;
    try {
      const url = new URL(item.uri);
      accepted = url.origin === 'https://api.github.com' && !url.username && !url.password && !url.hash &&
        /^\/repos\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+(?:\/(?:commits|releases))?$/.test(url.pathname) &&
        url.href === item.uri && [...url.searchParams.keys()].every(k => k === 'per_page') &&
        (!url.search || url.search === '?per_page=1');
    } catch { /* Relative or malformed URLs are rejected, not uncaught exceptions. */ }
    if (!accepted) problems.push({ code: 'DestinationRejected', index: item.index, template: item.template, label: item.label });
  }
  return problems;
}

// Upgrade review needs valid definitions even when candidate requests no longer
// satisfy them. Original-file diagnostics are retained by the caller; the
// definitions-only check is explicitly separate from request acceptance.
export function readCatalogDocument(text, file) {
  if (Buffer.byteLength(text) > 1048576) throw Object.assign(new Error('manifest exceeds 1 MiB'), { code: 'ProjectInputLimit' });
  const doc = parseSource(text).value;
  if (!doc || !Array.isArray(doc.requests) || doc.requests.length > 256)
    throw Object.assign(new Error('requests must be an array of at most 256 items'), { code: 'InvalidRequests' });
  const definitions = checkProject(JSON.stringify({ ...doc, requests: [] }), '<definitions-only>');
  if (!definitions.ok) throw Object.assign(new Error('invalid catalog definitions'), { code: 'InvalidCatalog', file });
  return { doc, catalog: catalogFromDocument(doc) };
}
