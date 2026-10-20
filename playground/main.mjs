import { locate } from './diagnostics.mjs';
import { createRunner } from './controller.mjs';
const el = id => document.getElementById(id);
let lastOutput = '', snapshot, revision = 0;
const presets = {
  sdk: ['/users/{id}{?tags*,page}', {id:'team/a',tags:['moon bit','中文']}, 'id', 8192],
  missing: ['/users/{id}{?tags*,page}', {tags:[],paeg:'2'}, 'id', 8192],
  budget: ['/hello/{name}', {name:'😀'}, 'name', 18],
  error: ['中文😀/users/{id', {id:'42'}, 'id', 8192],
  upgrade: ['/users/{id}{?page}', {id:'team/a'}, 'id', 8192],
};
const node = (tag, text, className) => {
  const result = document.createElement(tag); result.textContent = text;
  if (className) result.className = className;
  return result;
};
function jump(location) {
  const input = el(location.target);
  input.focus();
  if (Number.isInteger(location.start)) input.setSelectionRange(location.start, location.end);
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function locationButton(text, location) {
  const button = node('button', text, 'location');
  button.type = 'button'; button.addEventListener('click', () => jump(location));
  return button;
}
function displayError(error) {
  el('diagnostic').hidden = false;
  const location = error.location ?? (error.target ? { target: error.target } : undefined);
  const label = location?.target === 'candidate' ? '候选模板' : location?.target === 'vars' ? '变量 JSON' : location?.target === 'template' ? '当前模板' : '';
  el('error-message').textContent = `${label ? label+' · ' : ''}${error.code}: ${error.message}${error.line ? ` · 第 ${error.line} 行，第 ${error.column} 列` : ''}`;
  el('error-json').textContent = JSON.stringify(error, null, 2);
  el('jump-error').hidden = !location;
  el('jump-error').onclick = () => location && jump(location);
  const excerpt = el('source-mark'); excerpt.replaceChildren();
  excerpt.hidden = !Number.isInteger(location?.start);
  if (!excerpt.hidden) {
    const source = el(location.target).value, start = location.start, end = Math.min(location.end, start + 100);
    excerpt.append((start > 40 ? '…' : '') + source.slice(Math.max(0, start - 40), start),
      node('mark', source.slice(start, end) || '▏'), source.slice(end, end + 40) + (end + 40 < source.length ? '…' : ''));
  }
}
function showBindings(result, title) {
  const target = el('bindings');
  target.append(node('h4', title));
  if (result?.check?.error) { target.append(node('p', '修复模板或输入错误后可查看预检。', 'note')); return; }
  const report = JSON.parse(result.check.output);
  for (const [label, values] of [
    ['引用变量', report.referenced], ['未绑定（含可选）', report.missing.map(v => v.name)],
    ['空集合省略', report.omitted.map(v => v.name)], ['未使用', report.unused],
    ['类型冲突', report.invalid.map(v => v.code)],
  ]) {
    const row = node('div', '', 'binding-row');
    row.append(node('strong', label), node('code', values.length ? values.slice(0, 64).join(' · ') + (values.length > 64 ? ' …' : '') : '—'));
    target.append(row);
  }
}
function showProfiles(result, source, target, title) {
  if (result?.analysis?.error) return;
  const profiles = JSON.parse(result.analysis.output).profiles, container = el('profiles');
  container.append(node('h4', title));
  if (!profiles.length) container.append(node('p', '纯字面量模板，没有变量。', 'note'));
  for (const p of profiles.slice(0, 32)) {
    const card = node('article', '', 'profile');
    card.append(node('strong', p.name), node('p', `${p.occurrences} 次引用 · ${p.scalarOnly ? '仅标量' : '可用复合值'}${p.usesReserved ? ' · 允许保留字符' : ''}${p.usesQuery ? ' · 查询参数' : ''}${p.usesExplode ? ' · 集合展开' : ''}`, 'note'));
    for (const use of p.uses.slice(0, 8)) {
      const at = locate(source, { start: use.span.start, end: use.span.end });
      const text = `${use.operator || '简单'}${use.prefix === null ? '' : ':'+use.prefix}${use.explode ? '*' : ''} · ${at.line}:${at.column}`;
      card.append(locationButton(text, { target, start: at.utf16Start, end: at.utf16End }));
    }
    if (p.uses.length > 8) card.append(node('p', `仅展示前 8 / ${p.uses.length} 处引用。`, 'note'));
    container.append(card);
  }
  if (profiles.length > 32) container.append(node('p', `仅展示前 32 / ${profiles.length} 个变量。完整分析可使用 CLI analyze。`, 'note'));
}
function showComparison(data) {
  el('comparison').hidden = false;
  const list = el('changes'); list.replaceChildren();
  const add = text => list.append(node('li', text));
  if (data.comparison?.error) {
    el('comparison-status').textContent = '无法完成比较：先修复模板或约束。';
  } else {
    const c = JSON.parse(data.comparison.output);
    el('comparison-status').textContent = c.requiresReview ? '发现变化，需要审查' : '未发现契约变化';
    for (const [label, names] of [
      ['新增变量', c.addedVariables], ['删除变量', c.removedVariables],
      ['新增必填', c.addedRequired], ['取消必填', c.removedRequired],
      ['变为仅标量', c.becameScalarOnly], ['变为支持复合值', c.becameCompositeCapable],
      ['新增重复引用', c.newRepeatedVariables],
    ]) if (names.length) add(`${label}：${names.slice(0, 32).join('、')}${names.length > 32 ? '（仅显示前 32 项）' : ''}`);
    if (c.reservedAdded) add('新增保留字符展开：斜杠等字符可能改变 URL 结构。');
    if (c.fragmentAdded) add('新增 fragment。');
    if (c.literalsChanged) add('固定路径或文字发生变化。');
    if (c.oldLevel !== c.newLevel) add(`RFC 等级：${c.oldLevel} → ${c.newLevel}`);
    if (c.rejectUnusedBefore !== c.rejectUnusedAfter) add(`未使用绑定：${c.rejectUnusedAfter ? '改为拒绝' : '改为允许'}`);
    for (const b of c.budgetChanges) add(`${b.name}：${b.before} → ${b.after}${b.tightened ? '（收紧）' : ''}`);
    for (const change of c.variableChanges.slice(0, 32))
      add(`${change.name} 的引用发生变化：${[change.operatorsChanged && '操作符', change.prefixesChanged && '截断长度', change.explodeChanged && '集合展开', change.occurrencesChanged && '次数', change.usesChanged && '出现位置/修饰符'].filter(Boolean).join('、')}`);
    if (c.variableChanges.length > 32) add(`仅展示前 32 / ${c.variableChanges.length} 项变量变化。`);
    if (!list.childElementCount) add(c.requiresReview ? '模板源码或表达式布局发生变化，请审查。' : '同一份绑定仍需检查；相同模板也可能输入无效。');
  }
  el('candidate-output').textContent = data.after?.expansion.error ? '候选版本未通过当前绑定检查。' : data.after?.expansion.output || '（空 URI）';
}
function ready() { el('run').disabled = false; el('cancel').disabled = true; el('results').setAttribute('aria-busy', 'false'); }
function show(data) {
  ready();
  const before = data.before?.expansion, after = data.after?.expansion;
  const error = data.error ?? before?.error ?? after?.error ?? data.comparison?.error;
  el('status').dataset.tone = error ? 'error' : 'success';
  el('status').textContent = data.error ? '需要修复' : snapshot.compare ? (error ? '升级检查未通过' : '升级检查完成') : error ? '需要修复' : '展开成功';
  const success = before && !before.error;
  lastOutput = success ? before.output : '';
  el('copy').disabled = !success;
  el('bytes').textContent = success ? `${new TextEncoder().encode(before.output).length} bytes` : '— bytes';
  el('output').textContent = success ? before.output || '（空 URI）' : '未生成 URI。请修复问题后重试。';
  el('diagnostic').hidden = !error;
  if (error) displayError(error);
  el('bindings').replaceChildren(); el('profiles').replaceChildren();
  if (data.before) {
    showBindings(data.before, '当前版本'); showProfiles(data.before, snapshot.source, 'template', '当前版本');
  }
  if (data.after) {
    showBindings(data.after, '候选版本'); showProfiles(data.after, snapshot.candidate, 'candidate', '候选版本');
  }
  if (snapshot.compare && data.comparison) showComparison(data);
}
const runner = createRunner({
  createWorker: () => new Worker('./worker.mjs', { type: 'module' }),
  onPending: () => { el('run').disabled = true; el('cancel').disabled = false; el('status').textContent = '正在检查…'; el('results').setAttribute('aria-busy', 'true'); },
  onResult: show, onError: error => show({ error }),
});
function clear(message) {
  revision++; runner.cancel(); ready(); lastOutput = ''; el('copy').disabled = true;
  el('status').textContent = message; el('output').textContent = '等待重新检查。'; el('bytes').textContent = '— bytes';
  el('status').dataset.tone = '';
  el('diagnostic').hidden = true; el('comparison').hidden = true;
  el('bindings').textContent = '尚未检查'; el('profiles').textContent = '尚未分析';
}
function options(prefix = '') {
  const field = el(prefix+'budget'), maxOutput = Number(field.value);
  if (field.value === '' || !Number.isInteger(maxOutput) || maxOutput < 0 || maxOutput > 1048576)
    throw { code: 'InvalidLimit', message: '输出预算必须是 0 到 1048576 的整数。', target: prefix+'budget' };
  return { strict: el(prefix+'strict').checked, requireAll: el(prefix+'all').checked, rejectUnused: el(prefix+'unused').checked,
    required: el(prefix+'required').value.split(',').map(s=>s.trim()).filter(Boolean), maxOutput,
    maxTemplate: 16384, maxJson: 131072, maxMembers: 2048, maxValue: 65536, maxTotalValue: 131072 };
}
function run() {
  clear('正在准备…');
  snapshot = { source: el('template').value, variables: el('vars').value, compare: el('compare-mode').checked, candidate: el('candidate').value };
  try { snapshot.options = options(); snapshot.candidateOptions = snapshot.compare ? options('candidate-') : undefined; }
  catch (error) { show({ error }); return; }
  runner.run(snapshot);
}
el('run').addEventListener('click', run);
el('cancel').addEventListener('click', () => clear('已取消计算'));
el('compare-mode').addEventListener('change', () => {
  el('candidate-panel').hidden = !el('compare-mode').checked;
  el('run').textContent = el('compare-mode').checked ? '比较并验证绑定 ↗' : '检查并展开 ↗';
  el('copy').textContent = el('compare-mode').checked ? '复制当前版本 URI' : '复制 URI';
});
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  const [source, vars, required, budget] = presets[button.dataset.example];
  el('template').value = source; el('vars').value = JSON.stringify(vars, null, 2); el('required').value = required; el('budget').value = budget;
  el('strict').checked = true; el('all').checked = false; el('unused').checked = false;
  el('compare-mode').checked = button.dataset.example === 'upgrade';
  el('compare-mode').dispatchEvent(new Event('change'));
  if (el('compare-mode').checked) {
    el('candidate').value = '/users/{+id:3}{?page}'; el('candidate-required').value = 'id,page'; el('candidate-budget').value = 8192;
    el('candidate-strict').checked = true; el('candidate-all').checked = false; el('candidate-unused').checked = false;
  }
  run();
}));
el('copy').addEventListener('click', async () => {
  const copied = lastOutput, atRevision = revision;
  try { await navigator.clipboard.writeText(copied); if (revision === atRevision) el('status').textContent = 'URI 已复制'; }
  catch { if (revision === atRevision) el('status').textContent = '请选中结果手动复制'; }
});
for (const input of document.querySelectorAll('textarea,input')) input.addEventListener('input', () => clear('输入已更改，请重新检查'));
run();
