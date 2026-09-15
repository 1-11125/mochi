// #525 设置页 tag 分类行为验证（无头 Chrome，测构建产物 index.html）
// 立项：用户反馈「清除本地数据的功能应该也放在设置的【工具】tag 里啊，设置的 tag 分类有问题，不正常」。
// 根因（src/template.html）：#520 设置页分区改版时，「清除本地数据」(#row-reset) 与「功能介绍」
//   一同放进 data-sec="about"，而导出/导入/查看存储/诊断等数据工具都在 data-sec="tools"——
//   同类功能被拆到两个 tag，用户按常识去「工具」找清理入口找不到。
// 修复（最小改动）：把 #row-reset 的整行搬进 tools 段（独立成组、置于该段末项），about 段只留功能介绍。
// 判别器：①src 静态——row-reset 在 tools 段内、不在 about 段；②产物行为——点「工具」tag 后该行可见且
//   可点开确认弹窗；点「关于」tag 后该行隐藏；③五个 tag 互斥切换且任一时刻只有一个 them-sec 可见；
//   ④结构回归兜底——#page-setting 仍正确闭合（tabbar 未被吞）。
// 用法：node build.mjs && node tools/verify-settings-tags.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-settings-tags.mjs
//   该目录需含 index.html 与 src/template.html；静态与行为断言都读该根，可用来实证本脚本的判别力。
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

// ===== 静态：src/template.html 的 tag 归属 =====
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const iTools = tpl.indexOf('data-sec="tools"');
const iAbout = tpl.indexOf('data-sec="about"');
const iVer = tpl.indexOf('<div class="ver">');
const toolsSrc = tpl.slice(iTools, iAbout);
const aboutSrc = tpl.slice(iAbout, iVer);
ok(iTools > 0 && iAbout > iTools, 'S1 tools/about 两段存在且顺序正确（tools 在前）');
ok(toolsSrc.includes('id="row-reset"'), 'S2 清除本地数据(#row-reset) 落在 tools 段内');
ok(!aboutSrc.includes('id="row-reset"'), 'S3 清除本地数据不在 about 段内');

const setTabsSrc = (function () {
  const i = tpl.indexOf('id="set-tabs"');
  if (i < 0) return '';
  const end = tpl.indexOf('</div>', tpl.indexOf('<div class="them-tab', i));
  return tpl.slice(i, tpl.indexOf('<!-- 通用：', i));
})();
const tabsSrc = setTabsSrc.match(/<div class="them-tab[^>]*data-tab="[^"]+"[^>]*>/g) || [];
ok(tabsSrc.length === 5, 'S4 设置页 #set-tabs 内 5 个 tag 存在', 'found=' + tabsSrc.length);

// ===== 行为：构建产物 index.html =====
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
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vst-' + Date.now()),
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
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
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
// 进入设置页
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});return true;})()");
await sleep(400);

// B1 五个 tag 文案（渲染后）
const tabs = J(await evalJs(`(function(){var out=[];document.querySelectorAll('#set-tabs .them-tab').forEach(function(t){out.push(t.dataset.tab+'='+t.textContent.trim());});return JSON.stringify(out);})()`));
const tabStr = (Array.isArray(tabs) ? tabs : []).join(',');
ok(tabStr === 'basic=通用,chat=聊天,system=系统,tools=工具,about=关于', 'B1 五个 tag＝通用/聊天/系统/工具/关于', tabStr);

// B2 逐一点击 tag：恰好一个 them-sec 可见，且为该 tag 对应段
let mutexOk = true, mutexDetail = '';
for (const name of ['basic', 'chat', 'system', 'tools', 'about']) {
  await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="${name}"]');if(t)t.click();return true;})()`);
  await sleep(160);
  const r = J(await evalJs(`(function(){var vis=[];document.querySelectorAll('#page-setting .them-sec').forEach(function(s){if(!s.hidden)vis.push(s.dataset.sec);});var act=document.querySelector('#set-tabs .them-tab.active');return JSON.stringify({vis:vis,act:act?act.dataset.tab:null});})()`));
  if (!(r.vis && r.vis.length === 1 && r.vis[0] === name && r.act === name)) { mutexOk = false; mutexDetail += name + '→' + JSON.stringify(r) + ' '; }
}
ok(mutexOk, 'B2 五个 tag 互斥切换（任一时刻仅对应段可见且高亮）', mutexDetail);

// B3 row-reset 的 tag 归属（DOM 祖先）
const anc = J(await evalJs(`(function(){var r=document.getElementById('row-reset');if(!r)return JSON.stringify({found:false});var sec=r.closest('.them-sec');return JSON.stringify({found:true,sec:sec?sec.dataset.sec:null,inAbout:!!r.closest('.them-sec[data-sec="about"]')});})()`));
ok(anc.found === true && anc.sec === 'tools', 'B3 【工具】tag 下能找到清除本地数据（祖先 data-sec=tools）', JSON.stringify(anc));
ok(anc.inAbout === false, 'B4 清除本地数据不再是【关于】tag 的成员', JSON.stringify(anc));

// B5 切到「工具」：该行可见、几何非零
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="tools"]');if(t)t.click();return true;})()`);
await sleep(220);
const geo = J(await evalJs(`(function(){var r=document.getElementById('row-reset');if(!r)return JSON.stringify({found:false});var b=r.getBoundingClientRect();return JSON.stringify({found:true,vis:(r.offsetParent!==null),h:Math.round(b.height),w:Math.round(b.width),txt:r.querySelector('.txt')?r.querySelector('.txt').textContent.trim():''});})()`));
ok(geo.found === true && geo.vis === true && geo.h > 0 && geo.w > 0, 'B5 「工具」tag 下该行可见且几何非零', JSON.stringify(geo));
ok((geo.txt || '').indexOf('清除本地数据') >= 0, 'B6 该行文案＝清除本地数据', geo.txt);

// B7 点击该行弹出确认弹窗（清除入口真的通了，不只是搬了个位置）
await evalJs(`(function(){var r=document.getElementById('row-reset');if(r)r.click();return true;})()`);
await sleep(400);
const mdl = J(await evalJs(`(function(){var m=document.getElementById('modal-mask');var t=document.getElementById('modal-title');return JSON.stringify({open:!!m&&!m.hidden,title:t?t.textContent.trim():''});})()`));
ok(mdl.open === true && (mdl.title || '').indexOf('清除') >= 0, 'B7 点该行弹出「确认清除所有本地数据」弹窗', JSON.stringify(mdl));
// 关掉弹窗（取消），避免残留
await evalJs(`(function(){var c=document.getElementById('modal-cancel');if(c)c.click();var m=document.getElementById('modal-mask');if(m)m.hidden=true;return true;})()`);
await sleep(200);

// B8 切到「关于」：该行随 tools 段隐藏（不该在关于里再现）
await evalJs(`(function(){var t=document.querySelector('#set-tabs .them-tab[data-tab="about"]');if(t)t.click();return true;})()`);
await sleep(220);
const aboutState = J(await evalJs(`(function(){var r=document.getElementById('row-reset');var a=document.getElementById('row-about');return JSON.stringify({resetVisible:r?r.offsetParent!==null:false,aboutVisible:a?a.offsetParent!==null:false,aboutTxt:a&&a.querySelector('.txt')?a.querySelector('.txt').textContent.trim():''});})()`));
ok(aboutState.aboutVisible === true && aboutState.resetVisible === false, 'B8 【关于】tag 只剩功能介绍、清除本地数据已不在此处', JSON.stringify(aboutState));

// B9 结构兜底：#page-setting 正确闭合，tabbar 未被吞进设置页（#519/#520 同族回归）
const nest = J(await evalJs(`(function(){var tb=document.querySelector('.tabbar');var st=document.getElementById('page-setting');return JSON.stringify({tabbarInSetting:!!(tb&&st&&st.contains(tb)),tabbarParent:tb&&tb.parentElement?(tb.parentElement.className||tb.parentElement.id):null});})()`));
ok(nest.tabbarInSetting === false, 'B9 #page-setting 已正确闭合（tabbar 未被吞进设置页）', JSON.stringify(nest));

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 设置页 tag 分类验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
