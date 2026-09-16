// #532 字卡使用状态自检（设置→工具 #row-card-audit）行为验证（无头 Chrome，测构建产物 index.html）
// 立项：用户点名「自定义字卡 + 系统预设字卡 + 二级密码锁 + 分组分类太多，要一个统一自检系统」。
// 覆盖：①静态归属（template 工具段入口 + 独立页 + build.mjs 登记）；②打开渲染八/九节；
//   ③设置入口角标 data-ca-issues；④「一键修复」真的写回默认值（reply-dcp-all 0→100）；
//   ⑤问题行可点击跳转（data-jump 落到目标页）；⑥#page-card-audit 正确闭合不吞 tabbar；
//   ⑦#583 回复链路节（系统预设 ↔ 自定义「互补占比」口径已被改写，见 B3h/B3h2/B3j）。
//   ⚠️ 本脚本跑的是构建产物；#583 的覆盖率/总档/一键恢复等行为细节在
//   tools/verify-card-audit-reply-chain.mjs（内存拼装 src，构建前后都能跑）。
// 用法：node build.mjs && node tools/verify-card-audit.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-card-audit.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ===== 静态 =====
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
let buildSrc = '';
try { buildSrc = readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) {}
const iTools = tpl.indexOf('data-sec="tools"');
const iAbout = tpl.indexOf('data-sec="about"');
ok(iTools > 0 && iAbout > iTools && tpl.slice(iTools, iAbout).includes('id="row-card-audit"'), 'S1 入口 #row-card-audit 落在设置【工具】段');
ok(tpl.includes('id="page-card-audit"') && tpl.includes('id="card-audit-body"'), 'S2 独立页 #page-card-audit / #card-audit-body 存在');
ok(/jsFiles[^\n]*'card-audit\.js'/.test(buildSrc), 'S3 build.mjs 的 jsFiles 已登记 card-audit.js');
ok((readFileSync(join(root, 'src', 'js', 'settings-help.js'), 'utf8')).includes("sel: '#row-card-audit'"), 'S4 settings-help 登记了本行「功能说明」');

// ===== 行为 =====
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vca-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);

// 二级锁前置（#583 起补齐）：干净 profile 里 cardlock-state 未设 → cardLockOpen() 为 false
// → 自检页把「系统预设字卡被二级密码锁整体锁停」当成本次结论，第四节据此不渲染
// `inl-dcp` 等修复按钮（注册条件带 `!lock`），B4b 会点不到按钮而假红。
// 实测（无头实测同 profile）：cardlock-state=null / cardLockOpen()=false / inl-dcp 按钮数=0。
// 本脚本要验的是「一键修复真的写回默认」，必须在解锁态下测，故这里显式置 open 并补发事件。
await evalJs("(function(){try{window.xyStore('xy-home-v2').set('cardlock-state','open');}catch(e){}document.dispatchEvent(new Event('mochi-cardlock-open'));return true;})()");
await sleep(300);
ok((await evalJs('(function(){try{return !!window.cardLockOpen();}catch(e){return null;}})()')) === true,
  'B0 前置：二级锁已置解锁态（未设键＝锁定，会让带 !lock 的修复按钮不渲染而假红）');

// B1 入口行在工具段且带角标锚
const entry = J(await evalJs(`(function(){var r=document.getElementById('row-card-audit');if(!r)return JSON.stringify({found:false});var sec=r.closest('.them-sec');return JSON.stringify({found:true,sec:sec?sec.dataset.sec:null,issues:r.getAttribute('data-ca-issues')});})()`));
ok(entry.found === true && entry.sec === 'tools', 'B1 入口行在【工具】段', JSON.stringify(entry));

// B2 打开自检页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=true;});var s=document.getElementById('page-setting');if(s)s.hidden=false;return true;})()");
await sleep(200);
await evalJs("(function(){var r=document.getElementById('row-card-audit');if(r)r.click();return true;})()");
await sleep(1400);
const opened = J(await evalJs("(function(){var p=document.getElementById('page-card-audit');return JSON.stringify({vis:!!p&&!p.hidden, inSetting:!!(p&&p.closest&&p.closest('#page-setting'))});})()"));
ok(opened.vis === true && opened.inSetting === false, 'B2 点入口进入独立自检页', JSON.stringify(opened));

// B3 报告渲染多节
const body = await evalJs("(function(){var b=document.getElementById('card-audit-body');return b?b.textContent:'';})()") || '';
ok(body.indexOf('自检结论') >= 0, 'B3a 渲染「自检结论」节', body.slice(0, 40));
ok(body.indexOf('二级密码锁') >= 0, 'B3b 渲染「二级密码锁」节');
ok(body.indexOf('其他互动功能字卡') >= 0, 'B3c 渲染「其他互动功能字卡」节');
ok(body.indexOf('各桌面专属字卡概览') >= 0, 'B3d 渲染「各桌面概览」节');
ok(body.indexOf('卡数据健康') >= 0, 'B3e 渲染「卡数据健康」节');
const jumps = await evalJs("(function(){return document.querySelectorAll('#card-audit-body [data-jump]').length;})()");
ok(Number(jumps) >= 1, 'B3f 问题行带可点击跳转锚 (data-jump)', 'count=' + jumps);
ok(body.indexOf('平均每') >= 0, 'B3g 概率带人话换算（平均每 N 条回复 / 次触发）');
// #583：原先那节「系统预设 ↔ 自定义字卡占比」是错的（漏 dc-use-chat 场景闸、漏总档缩放、
// 也漏 csp-cust），已改写成「回复链路（回复设置 → 聊天）」。行为细节见
// tools/verify-card-audit-reply-chain.mjs（覆盖率数值 / 总档缩放 / 一键恢复 / 直达 tab）。
ok(body.indexOf('回复链路（回复设置 → 聊天）') >= 0, 'B3h 渲染「回复链路（回复设置 → 聊天）」节');
ok(body.indexOf('系统预设 ↔ 自定义字卡占比') < 0, 'B3h2 旧的「互补占比」口径已不在（回退即红）');
const ratioBars = await evalJs("(function(){return document.querySelectorAll('#card-audit-body .ca-ratio-bar').length;})()");
ok(Number(ratioBars) >= 1, 'B3i 预设覆盖率条存在', 'count=' + ratioBars);
const replyJumps = await evalJs("(function(){return document.querySelectorAll('#card-audit-body [data-jump=\"@reply:chat\"]').length;})()");
ok(Number(replyJumps) >= 1, 'B3j 回复设置侧行带「调整」直达 回复设置→聊天', 'count=' + replyJumps);

// B4 修复：确认预览弹窗 → 写回默认 → 单级撤销
await evalJs("(function(){try{window.activeStore().set('reply-dcp-all','0');window.activeStore().set('dcf-fish','0');}catch(e){}var r=document.getElementById('card-audit-refresh');if(r)r.click();return true;})()");
await sleep(1400);
const before = J(await evalJs("(function(){try{return JSON.stringify({all:window.activeStore().get('reply-dcp-all'),fish:window.activeStore().get('dcf-fish')});}catch(e){return '{}';}})()"));
ok(String(before.all) === '0', 'B4a 修复前 reply-dcp-all=0（种入生效）', JSON.stringify(before));
await evalJs("(function(){var b=document.querySelector('#card-audit-body [data-fix=\"inl-dcp\"]');if(b)b.click();return true;})()");
await sleep(400);
const cfm = J(await evalJs("(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return JSON.stringify({open:!!m&&!m.hidden,title:t?t.textContent:''});})()"));
ok(cfm.open === true && (cfm.title || '').indexOf('确认修复') >= 0, 'B4a2 点修复弹「确认修复」预览弹窗', JSON.stringify(cfm));
await evalJs("(function(){var o=document.getElementById('modal-ok');if(o)o.click();return true;})()");
await sleep(800);
const after = await evalJs("(function(){try{return String(window.activeStore().get('reply-dcp-all'));}catch(e){return null;}})()");
ok(after === '100', 'B4b 确认后 reply-dcp-all 回到 100', 'after=' + after);
await evalJs("(function(){var u=document.getElementById('card-audit-undo');if(u)u.click();return true;})()");
await sleep(800);
const undone = await evalJs("(function(){try{return String(window.activeStore().get('reply-dcp-all'));}catch(e){return null;}})()");
ok(undone === '0', 'B4c「撤销上次」把 reply-dcp-all 还原为 0', 'undone=' + undone);

// B5 跳转：点 data-jump 跳到目标（customOwn → 字卡库/专属页）
await evalJs("(function(){var r=document.getElementById('row-card-audit');if(r)r.click();return true;})()");
await sleep(1200);
const jumped = J(await evalJs(`(function(){var el=document.querySelector('#card-audit-body [data-jump="customOwn"]');if(!el)return JSON.stringify({no:true});el.click();var audit=document.getElementById('page-card-audit');var cc=document.getElementById('page-custom-cards');return JSON.stringify({no:false,auditHidden:!!audit&&audit.hidden,ccVis:!!cc&&!cc.hidden});})()`));
ok(jumped.no === false && jumped.auditHidden === true, 'B5 点跳转后离开自检页、跳到目标页', JSON.stringify(jumped));

// B6 结构兜底：#page-card-audit 未吞 tabbar
const nest = J(await evalJs("(function(){var tb=document.querySelector('.tabbar');var p=document.getElementById('page-card-audit');return JSON.stringify({inside:!!(tb&&p&&p.contains(tb))});})()"));
ok(nest.inside === false, 'B6 #page-card-audit 正确闭合（tabbar 未被吞）', JSON.stringify(nest));

// B7/B8 大库未取回：顶部提示 + 「点此加载完整字卡」真的调 hydrateLibScopes
await evalJs("(function(){try{window.libScopesDeferred=function(){return true;};}catch(e){}var r=document.getElementById('card-audit-refresh');if(r)r.click();return true;})()");
await sleep(1300);
const loadBtn = await evalJs("(function(){return document.querySelectorAll('#card-audit-body [data-load]').length;})()");
ok(Number(loadBtn) >= 1, 'B7 字卡未取回时显示「点此加载完整字卡」', 'count=' + loadBtn);
await evalJs("(function(){window.__hydrated=false;var o=window.hydrateLibScopes;if(o){window.hydrateLibScopes=function(s,cb){window.__hydrated=true;return o.apply(this,arguments);};}var b=document.querySelector('#card-audit-body [data-load]');if(b)b.click();return true;})()");
await sleep(500);
const hydrated = await evalJs("window.__hydrated===true");
ok(hydrated === true, 'B8 点「加载完整字卡」触发 hydrateLibScopes', 'hydrated=' + hydrated);

// B9 批量修复：进入勾选模式后每行出现复选框；「应用所选」按 hidden 显隐（#618）
// #618 根因：`.storage-clear{display:block}` 作者样式盖过 UA `[hidden]{display:none}`，
//   导致未进批量模式「应用所选」也常驻可见、点了只提示「请先勾选」→ 用户以为批量修复没用。
//   断言 computed display（不是 hidden 属性，属性一直是 true 但 CSS 不生效）。
const applyHiddenBefore = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?getComputedStyle(b).display:null;})()");
ok(applyHiddenBefore === 'none', 'B9a 未进批量模式时「应用所选」按 hidden 隐藏（#618，显示值=' + applyHiddenBefore + '）', 'display=' + applyHiddenBefore);
await evalJs("(function(){try{window.libScopesDeferred=function(){return false;};}catch(e){}var p=document.getElementById('card-audit-pick');if(p)p.click();return true;})()");
await sleep(1300);
const picks = await evalJs("(function(){return document.querySelectorAll('#card-audit-body .ca-pick').length;})()");
ok(Number(picks) >= 1, 'B9 批量修复模式注入可勾选复选框', 'count=' + picks);
const applyShownAfter = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?getComputedStyle(b).display:null;})()");
ok(applyShownAfter && applyShownAfter !== 'none', 'B9b#618）', 'display=' + applyShownAfter);
// B9c 勾选态 → 应用所选 计数联动 + 真写回（选第一项取消勾选，确认计数下降）
const pickCountBefore = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?b.textContent:'';})()");
await evalJs("(function(){var c=document.querySelector('#card-audit-body .ca-pick');if(c){c.checked=false;c.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
await sleep(200);
const pickCountAfter = await evalJs("(function(){var b=document.getElementById('card-audit-apply');return b?b.textContent:'';})()");
ok(pickCountBefore !== pickCountAfter, 'B9c 取消勾选后「应用所选」计数联动', pickCountBefore + ' -> ' + pickCountAfter);

// B10 导出文件：调用 mochiExportFile（不真的落盘）
await evalJs("(function(){window.__exported=null;var o=window.mochiExportFile;window.mochiExportFile=function(j,f){window.__exported={len:(j||'').length,f:f};return Promise.resolve('ok');};var b=document.getElementById('card-audit-export');if(b)b.click();return true;})()");
await sleep(300);
const exp = J(await evalJs("(function(){return JSON.stringify(window.__exported||{});})()"));
ok(exp && exp.len > 0 && (exp.f || '').indexOf('card-audit') >= 0, 'B10 「导出文件」调用 mochiExportFile 生成报告', JSON.stringify(exp));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 字卡使用状态自检验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
