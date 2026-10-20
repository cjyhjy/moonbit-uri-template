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

// Reject values JSON.stringify would silently omit or transform. No user getters
// or toJSON hooks are invoked; input snapshots cannot mutate between batch passes.
function jsonSnapshot(value, options = false, textLimit = options ? 65536 : 4194304, nodeLimit = options ? 65536 : 262144) {
  const seen = new Set();
  let remaining = textLimit, nodes = nodeLimit;
  const count = text => {
    for (const _ of text) if (--remaining < 0)
      throw new UriTemplateError({ code: 'JsonInputLimit', message: 'SDK snapshot exceeds text budget' });
  };
  const copy = (x, depth, path) => {
    if (--nodes < 0) throw new UriTemplateError({ code: 'JsonInputLimit', message: 'SDK snapshot exceeds node budget' });
    if (depth > 32) throw invalid('input nesting exceeds 32 levels', path);
    if (x === null || typeof x === 'string' || (options && ['number', 'boolean'].includes(typeof x))) {
      if (typeof x === 'number' && !Number.isFinite(x)) throw invalid('number must be finite', path);
      if (typeof x === 'string') count(x);
      return x;
    }
    if (!Array.isArray(x) && !plain(x)) throw invalid('expected strings, null, arrays or plain objects', path);
    if (seen.has(x)) throw invalid('cyclic input is not supported', path);
    seen.add(x);
    const out = Array.isArray(x) ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(x)) {
      if (Array.isArray(x) && key === 'length') continue;
      if (typeof key !== 'string') throw invalid('symbol properties are not supported', path);
      count(key);
      const descriptor = Object.getOwnPropertyDescriptor(x, key);
      if (!descriptor.enumerable || !('value' in descriptor)) throw invalid('use enumerable data properties without getters', path);
      if (Array.isArray(x) && !/^(0|[1-9][0-9]*)$/.test(key)) throw invalid('array properties must be indices', path);
      out[key] = copy(descriptor.value, depth + 1, path + '/' + key.replaceAll('~', '~0').replaceAll('/', '~1'));
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
    const snapshots = [];
    let remainingInput = limits.maxTotalInputCodepoints, remainingOutput = limits.maxTotalOutputBytes;
    for (let index = 0; index < inputs.length; index++) {
      try {
        const json = jsonSnapshot(inputs[index]);
        remainingInput = spendText(json, remainingInput, 'BatchInputLimit');
        const bytes = Number(result(this.#handle, 'measure', json, this.#source));
        if (bytes > remainingOutput) throw new UriTemplateError({ code: 'BatchOutputLimit', message: 'total output exceeds batch budget' });
        remainingOutput -= bytes;
        snapshots.push(json);
      } catch (error) {
        if (error instanceof UriTemplateError) error.index = index;
        throw error;
      }
    }
    return snapshots.map(json => result(this.#handle, 'expand', json, this.#source));
  }
}

export function compileTemplate(source, options = {}) {
  if (typeof source !== 'string') throw invalid('template must be a string');
  const snapshot = JSON.parse(jsonSnapshot(options, true));
  const handle = prepare_request(source, JSON.stringify({ strict: true, rejectUnused: true, ...snapshot }));
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
  #measure(inputs, budgets) {
    const limits = batchLimits(budgets);
    const requests = this.#requests(inputs, limits);
    let remaining = limits.maxTotalOutputBytes;
    const plan = requests.map(item => {
      try {
        const entry = this.#entry(item.request.template);
        const bytes = Number(result(entry.handle, 'measure', item.json, entry.template.source));
        if (bytes > remaining) throw new UriTemplateError({ code: 'BatchOutputLimit', message: 'total output exceeds budget' });
        remaining -= bytes;
        return { ...item, entry, bytes };
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
    const { plan } = this.#measure(inputs, budgets);
    return plan.map(item => result(item.entry.handle, 'expand', item.json, item.entry.template.source));
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
  const limits = checkedLimits(options, { maxTemplates: 256, maxTotalTemplateCodepoints: 4194304 });
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
      const handle = prepare_request(source, JSON.stringify({ strict: true, rejectUnused: true, ...config }));
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
function checkSessionValues(values, dependencies, limits) {
  const names = Object.keys(values);
  if (names.filter(name => values[name] !== null).length > limits.maxBindings)
    throw sessionProblem('BindingLimit', 'shared binding count exceeds budget');
  let members = limits.maxMembers;
  const text = value => spendText(value, limits.maxValueCodepoints, 'ValueLimit');
  for (const name of names) {
    if (!dependencies.has(name)) throw sessionProblem('UnusedBinding', 'shared binding is not used by any endpoint');
    text(name);
    const value = values[name];
    if (typeof value === 'string') text(value);
    else if (Array.isArray(value)) {
      if (value.length > members) throw sessionProblem('MemberLimit', 'shared members exceed budget');
      members -= value.length;
      for (const item of value) {
        if (typeof item !== 'string') throw invalid('list members must be strings');
        text(item);
      }
    } else if (plain(value)) {
      const keys = Object.keys(value);
      if (keys.length > members) throw sessionProblem('MemberLimit', 'shared members exceed budget');
      members -= keys.length;
      for (const key of keys) {
        text(key);
        if (typeof value[key] === 'string') text(value[key]);
        else if (value[key] !== null) throw invalid('associative members must be strings or null');
      }
    } else if (value !== null) throw invalid('invalid shared value');
  }
  // Includes JSON punctuation and null fields, just as the SDK batch budgets do.
  spendText(JSON.stringify(values), limits.maxTotalInputCodepoints, 'SessionInputLimit');
}
function equalSessionValue(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x,i) => x === b[i]);
  if (!plain(a) || !plain(b)) return false;
  // Key order is immaterial to the JSON core. Retain null-member differences:
  // they change captured input size even if the resulting URI is unchanged.
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b,k) && a[k] === b[k]);
}
function sessionCall(entry, command, values) {
  const subset = Object.create(null);
  for (const name of entry.template.variables) if (Object.hasOwn(values,name)) subset[name] = values[name];
  try { return result(entry.handle, command, JSON.stringify(subset), entry.template.source); }
  catch (error) {
    if (error instanceof UriTemplateError) error.templateName = entry.name;
    throw error;
  }
}
function createSession(catalog, variables, options) {
  const limits = sessionLimits(options), entries = [...catalog].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, entry]) => ({...entry,name}));
  const dependencies = new Map();
  let edges = limits.maxDependencyEdges;
  for (let i=0;i<entries.length;i++) for (const variable of entries[i].template.variables) {
    if (edges-- === 0) throw sessionProblem('DependencyLimit', 'endpoint dependencies exceed budget');
    if (!dependencies.has(variable)) dependencies.set(variable, []);
    dependencies.get(variable).push(i);
  }
  const values = JSON.parse(jsonSnapshot(variables));
  checkSessionValues(values, dependencies, limits);
  for (const key of Object.keys(values)) if (values[key] === null) delete values[key];
  let remaining = limits.maxTotalOutputBytes;
  const sizes = entries.map(entry => {
    const bytes = Number(sessionCall(entry,'measure',values));
    if (bytes > remaining) throw sessionProblem('SessionOutputLimit','snapshot output exceeds budget');
    remaining -= bytes; return bytes;
  });
  const outputs = entries.map(entry => sessionCall(entry,'expand',values));
  return new LinkSession(sessionKey, {entries,dependencies,values,limits,sizes,outputs,total:limits.maxTotalOutputBytes-remaining});
}
export class LinkSession {
  #state;
  constructor(key, state) {
    if (key !== sessionKey) throw invalid('use catalog.startSession()');
    this.#state = state; Object.freeze(this);
  }
  get totalBytes() { return this.#state.total; }
  links() { return this.#state.entries.map((e,i) => ({template:e.name,uri:this.#state.outputs[i],bytes:this.#state.sizes[i]})); }
  get(name) {
    const index = this.#state.entries.findIndex(e => e.name === name);
    if (index < 0) throw new UriTemplateError({code:'UnknownTemplate',message:'template name is not in session',templateName:name});
    return this.#state.outputs[index];
  }
  update(patch) {
    const s = this.#state;
    if (!plain(patch)) throw invalid('patch must be an object; null removes a binding');
    if (Reflect.ownKeys(patch).length > s.limits.maxPatchBindings) throw sessionProblem('PatchLimit','patch count exceeds budget');
    const captured = JSON.parse(jsonSnapshot(patch));
    checkSessionValues(captured,s.dependencies,s.limits);
    const values = Object.assign(Object.create(null),s.values), affected = new Set();
    for (const [name,value] of Object.entries(captured)) {
      if (value === null) {
        if (!Object.hasOwn(values,name)) continue;
        delete values[name];
      } else {
        if (Object.hasOwn(values,name) && equalSessionValue(value,values[name])) continue;
        values[name] = value;
      }
      for (const i of s.dependencies.get(name)) affected.add(i);
    }
    checkSessionValues(values,s.dependencies,s.limits);
    if (affected.size === 0) return {session:this,changes:[],recomputed:0};
    let remaining = s.limits.maxTotalOutputBytes - s.total;
    for (const i of affected) remaining += s.sizes[i];
    const sizes = [...s.sizes], outputs = [...s.outputs], changes = [];
    const ordered = [...affected].sort((a,b)=>a-b);
    for (const i of ordered) {
      const size = Number(sessionCall(s.entries[i],'measure',values));
      if (size > remaining) throw sessionProblem('SessionOutputLimit','snapshot output exceeds budget');
      remaining -= size; sizes[i] = size;
    }
    for (const i of ordered) {
      const uri = sessionCall(s.entries[i],'expand',values);
      if (uri !== outputs[i]) changes.push({template:s.entries[i].name,before:outputs[i],after:uri});
      outputs[i] = uri;
    }
    return {session:new LinkSession(sessionKey,{...s,values,sizes,outputs,total:s.limits.maxTotalOutputBytes-remaining}),
      changes,recomputed:affected.size};
  }
}
