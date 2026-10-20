import { locate } from './diagnostics.mjs';
const el = id => document.getElementById(id);
let worker, timer, sequence = 0, lastOutput = '';
const presets = {
  sdk: ['/users/{id}{?tags*,page}', {id:'team/a',tags:['moon bit','中文']}, 'id', 8192],
  missing: ['/users/{id}{?tags*,page}', {tags:[],paeg:'2'}, 'id', 8192],
  budget: ['/hello/{name}', {name:'😀'}, 'name', 18],
  error: ['中文😀/users/{id', {id:'42'}, 'id', 8192],
};
function row(label, values) {
  const div = document.createElement('div'); div.className = 'binding-row';
  const name = document.createElement('strong'); name.textContent = label;
  const text = document.createElement('code'); text.textContent = values.length ? values.join(' · ') : '—';
  div.append(name,text); return div;
}
function show(source, data) {
  el('run').disabled = false;
  const r = data.expansion;
  el('diagnostic').hidden = !r.error;
  el('copy').disabled = !!r.error;
  el('bytes').textContent = r.error ? '— bytes' : `${new TextEncoder().encode(r.output).length} bytes`;
  lastOutput = r.error ? '' : r.output;
  el('output').textContent = r.error ? '未生成 URI。请修复下方问题后重试。' : (r.output || '（空 URI）');
  el('status').textContent = r.error ? '需要修复' : '展开成功';
  if (r.error) {
    const error = locate(source, r.error);
    el('error-message').textContent = `${error.code}: ${error.message}${error.line ? ` · 第 ${error.line} 行，第 ${error.column} 列` : ''}`;
    el('error-json').textContent = JSON.stringify(error,null,2);
    el('source-mark').replaceChildren();
    el('source-mark').hidden = !('start' in error);
    if ('start' in error) {
      const cs = Array.from(source), left = Math.max(0,error.start-35), right = Math.min(cs.length,Math.max(error.start+1,error.end)+35);
      const mark = document.createElement('mark'); mark.textContent = cs.slice(error.start,Math.min(error.end,error.start+80)).join('') || '▏';
      el('source-mark').append((left ? '…' : '')+cs.slice(left,error.start).join(''), mark, cs.slice(Math.min(error.end,error.start+80),Math.min(right,error.start+115)).join('')+(right<cs.length?'…':''));
    }
  }
  const target = el('bindings'); target.replaceChildren();
  if (data.check?.exitCode === 0) {
    const report = JSON.parse(data.check.output);
    target.append(row('引用变量',report.referenced),row('未绑定',report.missing.map(v=>v.name)),row('空集合省略',report.omitted.map(v=>v.name)),row('未使用',report.unused),row('类型冲突',report.invalid.map(v=>`${v.code} @${v.start}`)));
  } else target.textContent = '修复模板或输入错误后可查看绑定预检。';
}
function run() {
  worker?.terminate(); clearTimeout(timer);
  const id = ++sequence, source = el('template').value, variables = el('vars').value;
  const maxOutput = Number(el('budget').value);
  if (el('budget').value === '' || !Number.isInteger(maxOutput) || maxOutput < 0 || maxOutput > 1048576) {
    show(source,{expansion:{error:{code:'InvalidLimit',message:'输出预算必须是 0 到 1048576 的整数。'}}}); return;
  }
  const options = {strict:el('strict').checked,requireAll:el('all').checked,rejectUnused:el('unused').checked,
    required:el('required').value.split(',').map(s=>s.trim()).filter(Boolean),maxOutput,maxTemplate:16384,maxJson:131072,maxMembers:2048,maxValue:65536,maxTotalValue:131072};
  el('run').disabled = true; el('status').textContent = '正在检查…'; el('copy').disabled = true;
  worker = new Worker('./worker.mjs',{type:'module'});
  const failed = (code,message) => {worker.terminate();clearTimeout(timer);show(source,{expansion:{error:{code,message}}});};
  worker.onerror = () => failed('WorkerError','无法加载核心，请通过本地 HTTP 服务打开页面。');
  worker.onmessage = ({data}) => {if(data.id===sequence){clearTimeout(timer);worker.terminate();show(source,data);}};
  timer = setTimeout(()=>failed('TimeLimit','计算超过 2 秒，请减小输入后重试。'),2000);
  worker.postMessage({id,source,variables,options});
}
el('run').addEventListener('click',run);
document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{
  const [source,vars,required,budget] = presets[button.dataset.example];
  el('template').value=source;el('vars').value=JSON.stringify(vars,null,2);el('required').value=required;el('budget').value=budget;
  el('strict').checked=true;el('all').checked=false;el('unused').checked=false;run();
}));
el('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(lastOutput);el('status').textContent='URI 已复制';}catch{el('status').textContent='请选中结果手动复制';}});
run();
// Editing invalidates previous results immediately so stale URIs cannot be copied.
for (const input of document.querySelectorAll('textarea,input')) input.addEventListener('input',()=>{
  worker?.terminate();clearTimeout(timer);sequence++;lastOutput='';
  el('run').disabled=false;el('copy').disabled=true;el('status').textContent='输入已更改，请重新检查';
  el('output').textContent='等待重新检查。';el('bytes').textContent='— bytes';
  el('diagnostic').hidden=true;el('bindings').textContent='尚未检查';
});
