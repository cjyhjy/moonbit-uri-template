import { prepare_request, prepared_call, prepared_compare, prepared_inspect, prepared_audit } from '../dist/engine.mjs';
import { locate } from '../tools/diagnostics.mjs';

export class UriTemplateError extends Error {
  constructor(detail, source = '') {
    super(detail.message);
    this.name = 'UriTemplateError';
    Object.assign(this, locate(source, detail));
  }
}
const invalid = (message, path = '') => new UriTemplateError({ code: 'InvalidInput', message, path });
const plain = x => x !== null && typeof x === 'object' &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);

// Copy input without invoking getters or toJSON, so a snapshot cannot change
// between passes. Variable numbers and booleans become strings (String(x));
// undefined object properties are treated as unbound.
function jsonSnapshot(value, options = false, textLimit = options ? 65536 : 4194304, nodeLimit = options ? 65536 : 262144) {
  const seen = new Set();
  let remaining = textLimit, nodes = nodeLimit;
  const count = (text, path) => {
    if (!text.isWellFormed()) throw invalid('string contains an unpaired UTF-16 surrogate', path);
    for (const _ of text) if (--remaining < 0)
      throw new UriTemplateError({ code: 'JsonInputLimit', message: 'SDK snapshot exceeds text budget' });
  };
  const copy = (x, depth, path) => {
    if (--nodes < 0) throw new UriTemplateError({ code: 'JsonInputLimit', message: 'SDK snapshot exceeds node budget' });
    if (depth > 32) throw invalid('input nesting exceeds 32 levels', path);
    if (typeof x === 'number' && !Number.isFinite(x)) throw invalid('number must be finite', path);
    if ((typeof x === 'number' || typeof x === 'boolean') && !options) x = String(x);
    if (x === null || typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') {
      if (typeof x === 'string') count(x, path);
      return x;
    }
    if (x === undefined) throw invalid('list members cannot be undefined', path);
    if (!Array.isArray(x) && !plain(x)) throw invalid('expected a string, number, boolean, null, array or plain object', path);
    if (seen.has(x)) throw invalid('cyclic input is not supported', path);
    seen.add(x);
    const out = Array.isArray(x) ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(x)) {
      if (Array.isArray(x) && key === 'length') continue;
      if (typeof key !== 'string') throw invalid('symbol properties are not supported', path);
      const child = path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1');
      count(key, child);
      const descriptor = Object.getOwnPropertyDescriptor(x, key);
      if (!descriptor.enumerable || !('value' in descriptor)) throw invalid('use enumerable data properties without getters', child);
      if (Array.isArray(x) && !/^(0|[1-9][0-9]*)$/.test(key)) throw invalid('array properties must be indices', path);
      if (descriptor.value === undefined && !Array.isArray(x)) continue;
      out[key] = copy(descriptor.value, depth + 1, child);
    }
    if (Array.isArray(x) && Object.keys(out).length !== x.length) throw invalid('sparse arrays are not supported', path);
    seen.delete(x);
    return out;
  };
  if (!plain(value)) throw invalid('expected a plain object');
  return JSON.stringify(copy(value, 0, ''));
}
function result(handle, command, json, source) {
  const r = JSON.parse(prepared_call(handle, command, json));
  if (r.error) throw new UriTemplateError(r.error, source);
  return r.output;
}
function batchLimits(value = {}) {
  return checkedLimits(value, { maxItems: 256, maxTotalInputCodepoints: 4194304, maxTotalOutputBytes: 4194304 });
}
function checkedLimits(value, defaults) {
  if (!plain(value)) throw invalid('limits must be an object');
  const limits = { ...defaults };
  const snapshot = JSON.parse(jsonSnapshot(value, true));
  for (const [key, n] of Object.entries(snapshot)) {
    if (!Object.hasOwn(limits, key) || !Number.isInteger(n) || n < 0 || n > 2147483647) throw invalid('invalid batch limit', '/' + key);
    limits[key] = n;
  }
  return limits;
}
function spendText(text, remaining, code) {
  for (const _ of text) {
    if (remaining === 0) throw new UriTemplateError({ code, message: 'aggregate input exceeds budget' });
    remaining--;
  }
  return remaining;
}
function findings(response, source) {
  const r = JSON.parse(response);
  if (r.error) throw new UriTemplateError(r.error, source);
  return JSON.parse(r.output).map(f => locate(source, f));
}
const compileKey = Symbol('compiled');
export class CompiledTemplate {
  #handle;
  #source;
  #names;
  constructor(key, source, handle) {
    if (key !== compileKey) throw invalid('use compileTemplate()');
    this.#handle = handle;
    this.#source = source;
    this.#names = Object.freeze(JSON.parse(result(handle, 'variables', '{}', source)));
    Object.freeze(this);
  }
  get source() { return this.#source; }
  get variables() { return this.#names; }
  analyze() { return JSON.parse(result(this.#handle, 'analyze', '{}', this.#source)); }
  compare(newer) {
    if (!(newer instanceof CompiledTemplate) || !(#handle in newer)) throw invalid('compare expects a compiled template');
    const response = JSON.parse(prepared_compare(this.#handle, newer.#handle));
    if (response.error) throw new UriTemplateError(response.error);
    return JSON.parse(response.output);
  }
  expand(variables = {}) { return this.#call('expand', variables); }
  measure(variables = {}) { return Number(this.#call('measure', variables)); }
  trace(variables = {}) { return JSON.parse(this.#call('trace', variables)); }
  check(variables = {}) { return JSON.parse(this.#call('check', variables)); }
  inspect(variables = {}, options = {}) {
    const { maxFindings } = checkedLimits(options, { maxFindings: 256 });
    return findings(prepared_inspect(this.#handle, jsonSnapshot(variables), maxFindings), this.#source);
  }
  audit(policy = {}, options = {}) {
    const { maxFindings } = checkedLimits(options, { maxFindings: 256 });
    return findings(prepared_audit(this.#handle, jsonSnapshot(policy, true), maxFindings), this.#source);
  }
  tryExpand(variables = {}) {
    try { return { ok: true, value: this.expand(variables) }; }
    catch (error) { if (!(error instanceof UriTemplateError)) throw error; return { ok: false, error }; }
  }
  #call(command, variables) {
    return result(this.#handle, command, jsonSnapshot(variables), this.#source);
  }
  expandMany(inputs, budgets) {
    if (!Array.isArray(inputs)) throw invalid('inputs must be an array');
    const limits = batchLimits(budgets);
    if (inputs.length > limits.maxItems) throw new UriTemplateError({ code: 'BatchItemLimit', message: 'batch count exceeds budget', index: -1 });
    // One expansion per item (output is ASCII, so length is bytes). Each call is
    // bounded by the template's own maxOutput; nothing is returned on failure.
    const outputs = [];
    let remainingInput = limits.maxTotalInputCodepoints, remainingOutput = limits.maxTotalOutputBytes;
    for (let index = 0; index < inputs.length; index++) {
      try {
        const json = jsonSnapshot(inputs[index]);
        remainingInput = spendText(json, remainingInput, 'BatchInputLimit');
        const uri = result(this.#handle, 'expand', json, this.#source);
        if (uri.length > remainingOutput) throw new UriTemplateError({ code: 'BatchOutputLimit', message: 'total output exceeds batch budget' });
        remainingOutput -= uri.length;
        outputs.push(uri);
      } catch (error) {
        if (error instanceof UriTemplateError) error.index = index;
        throw error;
      }
    }
    return outputs;
  }
}

export function compileTemplate(source, options = {}) {
  if (typeof source !== 'string') throw invalid('template must be a string');
  const snapshot = JSON.parse(jsonSnapshot(options, true));
  const handle = prepare_request(source, JSON.stringify(snapshot));
  return new CompiledTemplate(compileKey, source, handle);
}
export function expand(source, variables, options) {
  return compileTemplate(source, options).expand(variables);
}

const catalogKey = Symbol('catalog');
export class CompiledCatalog {
  #entries;
  #names;
  constructor(key, entries) {
    if (key !== catalogKey) throw invalid('use compileCatalog()');
    this.#entries = entries;
    this.#names = Object.freeze([...entries.keys()].sort());
    Object.freeze(this);
  }
  get names() { return this.#names; }
  get size() { return this.#names.length; }
  has(name) { return this.#entries.has(name); }
  #entry(name) {
    if (typeof name !== 'string') throw invalid('template name must be a string');
    const entry = this.#entries.get(name);
    if (!entry) throw new UriTemplateError({ code: 'UnknownTemplate', message: 'template name is not in catalog', templateName: name });
    return entry;
  }
  get(name) { return this.#entry(name).template; }
  #one(name, command, variables) {
    const entry = this.#entry(name);
    try { return result(entry.handle, command, jsonSnapshot(variables), entry.template.source); }
    catch (error) {
      if (error instanceof UriTemplateError) error.templateName = name;
      throw error;
    }
  }
  expand(name, variables = {}) { return this.#one(name, 'expand', variables); }
  measure(name, variables = {}) { return Number(this.#one(name, 'measure', variables)); }
  trace(name, variables = {}) { return JSON.parse(this.#one(name, 'trace', variables)); }
  startSession(variables = {}, options = {}) {
    return createSession(this.#entries, variables, options);
  }
  templatesUsing(variable) {
    if (typeof variable !== 'string') throw invalid('variable name must be a string');
    return this.#names.filter(name => this.#entries.get(name).template.variables.includes(variable));
  }
  #requests(inputs, limits) {
    if (!Array.isArray(inputs)) throw invalid('requests must be an array');
    if (inputs.length > limits.maxItems) throw new UriTemplateError({ code: 'BatchItemLimit', message: 'request count exceeds budget', index: -1 });
    // Snapshot the outer array too: a getter must not run between passes.
    const copied = JSON.parse(jsonSnapshot({ requests: inputs })).requests;
    let remaining = limits.maxTotalInputCodepoints;
    return copied.map((request, index) => {
      try {
        if (!plain(request) || typeof request.template !== 'string' || !plain(request.variables) ||
          (Object.hasOwn(request, 'label') && typeof request.label !== 'string'))
          throw invalid('request requires a template name, variables object and optional string label', `/requests/${index}`);
        for (const key of Object.keys(request)) if (!['template', 'variables', 'label'].includes(key))
          throw invalid('unknown request field', `/requests/${index}/${key}`);
        remaining = spendText(JSON.stringify(request), remaining, 'BatchInputLimit');
        return { request, index, json: JSON.stringify(request.variables) };
      } catch (error) {
        if (error instanceof UriTemplateError) { error.index = index; error.templateName = request?.template; }
        throw error;
      }
    });
  }
  #measure(inputs, budgets, command = 'measure') {
    const limits = batchLimits(budgets);
    const requests = this.#requests(inputs, limits);
    let remaining = limits.maxTotalOutputBytes;
    const plan = requests.map(item => {
      try {
        const entry = this.#entry(item.request.template);
        const value = result(entry.handle, command, item.json, entry.template.source);
        const bytes = command === 'expand' ? value.length : Number(value);
        if (bytes > remaining) throw new UriTemplateError({ code: 'BatchOutputLimit', message: 'total output exceeds budget' });
        remaining -= bytes;
        return { ...item, entry, bytes, value };
      } catch (error) {
        if (error instanceof UriTemplateError) { error.index = item.index; error.templateName = item.request.template; }
        throw error;
      }
    });
    return { plan, totalBytes: limits.maxTotalOutputBytes - remaining };
  }
  measureMany(inputs, budgets = {}) {
    const { plan, totalBytes } = this.#measure(inputs, budgets);
    return { bytes: plan.map(item => item.bytes), totalBytes };
  }
  expandMany(inputs, budgets = {}) {
    return this.#measure(inputs, budgets, 'expand').plan.map(item => item.value);
  }
  inspect(inputs, options = {}) {
    const limits = checkedLimits(options, { maxItems: 256, maxTotalInputCodepoints: 4194304, maxFindings: 256 });
    let remaining = limits.maxFindings;
    const requests = this.#requests(inputs, limits).map(item => {
      let issues;
      try {
        const entry = this.#entries.get(item.request.template);
        if (!entry) {
          if (remaining === 0) throw new UriTemplateError({ code: 'FindingLimit', message: 'findings exceed budget' });
          issues = [{ code: 'UnknownTemplate', message: 'template name is not in catalog' }];
        } else {
          issues = findings(prepared_inspect(entry.handle, item.json, remaining), entry.template.source);
        }
        remaining -= issues.length;
        return { index: item.index, template: item.request.template, ...(item.request.label === undefined ? {} : { label: item.request.label }), findings: issues };
      } catch (error) {
        if (error instanceof UriTemplateError) { error.index = item.index; error.templateName = item.request.template; }
        throw error;
      }
    });
    return { ok: remaining === limits.maxFindings, totalFindings: limits.maxFindings - remaining, requests };
  }
  audit(policy = {}, options = {}) {
    const { maxFindings } = checkedLimits(options, { maxFindings: 256 });
    const policyJson = jsonSnapshot(policy, true);
    // Validate policy even if there are no templates.
    findings(prepared_audit(prepare_request('', '{}'), policyJson, maxFindings), '');
    let remaining = maxFindings;
    const entries = this.#names.map(name => {
      const entry = this.#entries.get(name);
      try {
        const issues = findings(prepared_audit(entry.handle, policyJson, remaining), entry.template.source);
        remaining -= issues.length;
        return { template: name, findings: issues };
      } catch (error) {
        if (error instanceof UriTemplateError) error.templateName = name;
        throw error;
      }
    });
    return { ok: remaining === maxFindings, totalFindings: maxFindings - remaining, entries };
  }
  compare(newer, options = {}) {
    if (!(newer instanceof CompiledCatalog) || !(#entries in newer)) throw invalid('compare expects a compiled catalog');
    const { maxChanges } = checkedLimits(options, { maxChanges: 512 });
    const added = [], removed = [], changed = [];
    let count = 0;
    const record = () => {
      if (count === maxChanges) throw new UriTemplateError({ code: 'CatalogChangeLimit', message: 'catalog changes exceed budget' });
      count++;
    };
    for (const name of newer.#names) if (!this.#entries.has(name)) { record(); added.push(name); }
    for (const name of this.#names) {
      if (!newer.#entries.has(name)) { record(); removed.push(name); }
      else {
        const change = this.#entries.get(name).template.compare(newer.#entries.get(name).template);
        if (change.requiresReview) { record(); changed.push({ template: name, change }); }
      }
    }
    return { added, removed, changed, totalChanges: count, requiresReview: count > 0 };
  }
}

export function compileCatalog(definitions, options = {}) {
  const limits = checkedLimits(options, { maxTemplates: 4096, maxTotalTemplateCodepoints: 4194304 });
  if (!plain(definitions)) throw invalid('catalog definitions must be an object');
  if (Reflect.ownKeys(definitions).length > limits.maxTemplates)
    throw new UriTemplateError({ code: 'CatalogLimit', message: 'template count exceeds budget' });
  const copied = JSON.parse(jsonSnapshot(definitions, true, 4194304, 262144));
  const entries = new Map();
  let remaining = limits.maxTotalTemplateCodepoints;
  for (const [name, definition] of Object.entries(copied)) {
    try {
      if (!name || !plain(definition) || typeof definition.template !== 'string')
        throw invalid('each named definition needs a template string');
      remaining = spendText(name, remaining, 'CatalogInputLimit');
      remaining = spendText(definition.template, remaining, 'CatalogInputLimit');
      const { template: source, ...config } = definition;
      const handle = prepare_request(source, JSON.stringify(config));
      entries.set(name, { handle, template: new CompiledTemplate(compileKey, source, handle) });
    } catch (error) {
      if (error instanceof UriTemplateError) error.templateName = name;
      throw error;
    }
  }
  return new CompiledCatalog(catalogKey, entries);
}


const sessionKey = Symbol('link session');
const sessionProblem = (code, message) => new UriTemplateError({code, message});
function sessionLimits(value) {
  return checkedLimits(value, {maxBindings:4096, maxMembers:65536, maxValueCodepoints:1048576,
    maxTotalInputCodepoints:4194304, maxTotalOutputBytes:4194304, maxPatchBindings:4096,
    maxDependencyEdges:65536});
}
// Persistent arrays in blocks of 32: an update copies the spine and touched
// blocks only, so retained snapshots share everything that did not change.
const chunk = items => { const blocks = []; for (let i = 0; i < items.length; i += 32) blocks.push(items.slice(i, i + 32)); return blocks; };
const at = (blocks, i) => blocks[i >> 5][i & 31];
function withUpdates(blocks, updates) {
  const next = blocks.slice(), copied = new Set();
  for (const [i, value] of updates) {
    const b = i >> 5;
    if (!copied.has(b)) { next[b] = next[b].slice(); copied.add(b); }
    next[b][i & 31] = value;
  }
  return next;
}
// Members and code points of one binding (name, keys and values), validated
// against per-value limits. Matches the MoonBit core's input budget.
function bindingCost(name, value, limits) {
  const text = t => limits.maxValueCodepoints - spendText(t, limits.maxValueCodepoints, 'ValueLimit');
  let points = text(name), members = 0;
  if (typeof value === 'string') points += text(value);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item !== 'string') throw invalid('list members must be strings');
      points += text(item);
    }
    members = value.length;
  } else if (plain(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (item !== null && typeof item !== 'string') throw invalid('associative members must be strings or null');
      points += text(key) + (item === null ? 0 : text(item));
      members++;
    }
  } else throw invalid('invalid shared value');
  return {members, points};
}
function checkUsage(usage, limits) {
  if (usage.bindings > limits.maxBindings) throw sessionProblem('BindingLimit', 'shared binding count exceeds budget');
  if (usage.members > limits.maxMembers) throw sessionProblem('MemberLimit', 'shared members exceed budget');
  if (usage.points > limits.maxTotalInputCodepoints) throw sessionProblem('SessionInputLimit', 'shared input exceeds budget');
}
function equalSessionValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x,i) => x === b[i]);
  if (!plain(a) || !plain(b)) return false;
  // Key order changes the URI; null members change captured input size.
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every((k, i) => k === bk[i] && a[k] === b[k]);
}
function sessionExpand(s, index, values) {
  const entry = s.entries[index], subset = Object.create(null);
  for (const name of entry.template.variables) {
    const value = at(values, s.slots.get(name));
    if (value !== undefined) subset[name] = value;
  }
  try { return result(entry.handle, 'expand', JSON.stringify(subset), entry.template.source); }
  catch (error) {
    if (error instanceof UriTemplateError) error.templateName = entry.name;
    throw error;
  }
}
function createSession(catalog, variables, options) {
  const limits = sessionLimits(options), entries = [...catalog].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, entry]) => ({...entry,name}));
  const dependencies = new Map(), slots = new Map(), positions = new Map();
  let edges = limits.maxDependencyEdges;
  for (let i=0;i<entries.length;i++) {
    positions.set(entries[i].name, i);
    for (const variable of entries[i].template.variables) {
      if (edges-- === 0) throw sessionProblem('DependencyLimit', 'endpoint dependencies exceed budget');
      if (!dependencies.has(variable)) { dependencies.set(variable, []); slots.set(variable, slots.size); }
      dependencies.get(variable).push(i);
    }
  }
  const captured = JSON.parse(jsonSnapshot(variables)), initial = new Array(slots.size).fill(undefined);
  const usage = {bindings:0, members:0, points:0};
  for (const [name, value] of Object.entries(captured)) {
    if (!dependencies.has(name)) throw sessionProblem('UnusedBinding', 'shared binding is not used by any endpoint');
    if (value === null) continue;
    const cost = bindingCost(name, value, limits);
    usage.bindings++; usage.members += cost.members; usage.points += cost.points;
    initial[slots.get(name)] = value;
  }
  checkUsage(usage, limits);
  const s = {entries, dependencies, slots, positions, limits, values: chunk(initial)};
  let total = 0;
  const outputs = entries.map((_, i) => {
    const uri = sessionExpand(s, i, s.values);
    if (uri.length > limits.maxTotalOutputBytes - total) throw sessionProblem('SessionOutputLimit','snapshot output exceeds budget');
    total += uri.length; return uri;
  });
  return new LinkSession(sessionKey, {...s, usage, outputs: chunk(outputs), total});
}
export class LinkSession {
  #state;
  constructor(key, state) {
    if (key !== sessionKey) throw invalid('use catalog.startSession()');
    this.#state = state; Object.freeze(this);
  }
  get totalBytes() { return this.#state.total; }
  links() {
    const s = this.#state;
    return s.entries.map((e,i) => { const uri = at(s.outputs, i); return {template:e.name, uri, bytes:uri.length}; });
  }
  get(name) {
    const index = this.#state.positions.get(name);
    if (index === undefined) throw new UriTemplateError({code:'UnknownTemplate',message:'template name is not in session',templateName:name});
    return at(this.#state.outputs, index);
  }
  update(patch) {
    const s = this.#state;
    if (!plain(patch)) throw invalid('patch must be an object; null removes a binding');
    if (Reflect.ownKeys(patch).length > s.limits.maxPatchBindings) throw sessionProblem('PatchLimit','patch count exceeds budget');
    const captured = JSON.parse(jsonSnapshot(patch));
    const usage = {...s.usage}, valueUpdates = new Map(), affected = new Set();
    // Only patched bindings are costed; the rest were checked when they were set.
    for (const [name, value] of Object.entries(captured)) {
      if (!s.dependencies.has(name)) throw sessionProblem('UnusedBinding', 'shared binding is not used by any endpoint');
      const slot = s.slots.get(name), before = at(s.values, slot);
      const next = value === null ? undefined : value;
      const cost = next === undefined ? null : bindingCost(name, next, s.limits);
      if (before === undefined ? next === undefined : next !== undefined && equalSessionValue(before, next)) continue;
      if (before !== undefined) {
        const old = bindingCost(name, before, s.limits);
        usage.bindings--; usage.members -= old.members; usage.points -= old.points;
      }
      if (cost) { usage.bindings++; usage.members += cost.members; usage.points += cost.points; }
      valueUpdates.set(slot, next);
      for (const i of s.dependencies.get(name)) affected.add(i);
    }
    checkUsage(usage, s.limits);
    if (affected.size === 0) return {session:this,changes:[],recomputed:0};
    const values = withUpdates(s.values, valueUpdates), ordered = [...affected].sort((a,b)=>a-b);
    let remaining = s.limits.maxTotalOutputBytes - s.total;
    for (const i of ordered) remaining += at(s.outputs, i).length;
    const outputUpdates = new Map(), changes = [];
    for (const i of ordered) {
      const uri = sessionExpand(s, i, values), before = at(s.outputs, i);
      if (uri.length > remaining) throw sessionProblem('SessionOutputLimit','snapshot output exceeds budget');
      remaining -= uri.length;
      if (uri !== before) changes.push({template:s.entries[i].name, before, after:uri});
      outputUpdates.set(i, uri);
    }
    const next = {...s, values, usage, outputs: withUpdates(s.outputs, outputUpdates),
      total: s.limits.maxTotalOutputBytes - remaining};
    return {session:new LinkSession(sessionKey, next), changes, recomputed:affected.size};
  }
}
