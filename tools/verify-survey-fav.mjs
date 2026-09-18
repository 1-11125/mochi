// ===== 回归脚本：#713 批量问卷收藏两缺（用户直派） =====
// 用法：node tools/verify-survey-fav.mjs [--root <目录>]（需 node 21+ 与本机 Chrome/Edge；测构建产物 index.html）
// 立项：用户反馈「聊天里用【问问ta】发送的批量问卷，点击查看详情：没有整体的卡片的收藏功能，
//   没有单个问题的批量收藏功能」。修复两件：
//   ①问卷卡（special:'ask-survey'）挂常显收藏心形 + cardSnapshot 问卷分支（qarr/aarr 快照）
//     → 整卡收藏进聊天收藏夹，收藏页按问卷卡重放（fav 页 renderFavItem 问卷分支）；
//   ②openSurveyDetail 由 openModal 纯文本改 openTCPanel 面板：♡ 收藏整份问卷（复用
//     favCardFromMsg）＋逐题勾选 ☆ 收藏所选 / ★ 全部收藏题目 → 按题干查重写入 问问TA 题库。
// 判据：
//   A 轴（源码锚）：心形 / 快照分支 / 收藏页重放 / 详情操作条 / 题库写入。
//   B 轴（真实产物 390×844，种入一张 2 题已交卷问卷卡）：
//     B1 心形常显可见；B2 点心形→收藏夹入问卷卡（qarr/aarr 齐全），再点判重；
//     B3 详情面板操作条＋全选→收藏所选→题库 +2（单选题带 options）＋★ 徽标就地刷新；
//     B4 已收藏后再点全部收藏＝零重复入库；B5 面板 ♢ 收藏整份问卷按钮与心形同一落库；
//     B6 收藏页重放：标签「互动卡片 · 问卷」＋题干/选项/TA 作答齐全。
//   Z 轴：全程零 JS 异常。
// RED 基线（HEAD 版产物）：B1~B6 与 A 轴修复面全红（无 心形/分支/操作条）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import net from 'node:net';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 端口先绑定探测再用（并行会话各自拉 chrome 跑 verify，撞端口会连进别人浏览器＝测到别人的旧产物）
function portFree(p) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(p, '127.0.0.1');
  });
}
async function findFreePort(start) {
  for (let p = start; p < start + 500; p++) { if (await portFree(p)) return p; }
  throw new Error('no free cdp port');
}

// --root <目录>：测任意隔离副本构建（缺省=本仓）。**有此参数必须真生效**——曾因漏实现
// 导致 --root 指向隔离副本、实际却测了主仓旧产物（B 轴全红假象）
const argRoot = (() => {
  const i = process.argv.indexOf('--root');
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : '';
})();
const root = normalize(process.env.MOCHI_ROOT || argRoot || join(dirname(fileURLToPath(import.meta.url)), '..'));

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ---------- A 轴：源码锚 ----------
console.log('A 轴（源码作用域）');
let chatSrc = '', taSrc = '';
try { chatSrc = readFileSync(join(root, 'src/js/chat.js'), 'utf8'); } catch (e) {}
try { taSrc = readFileSync(join(root, 'src/js/ta-ask.js'), 'utf8'); } catch (e) {}
ok(chatSrc.includes('favHeartHtml(rec, true)'), 'A1 问卷卡挂常显收藏心形（#713a）');
ok(chatSrc.includes("else if (special === 'ask-survey') {") && chatSrc.includes('qarr: qarr'), 'A2 cardSnapshot 问卷分支（qarr/aarr 快照，#713b）');
ok(chatSrc.includes("f.special === 'ask-survey' && Array.isArray(f.qarr)"), 'A3 收藏页问卷重放分支（#713c）');
ok(taSrc.includes('id="sv-fav-card"') && taSrc.includes('id="sv-fav-allbtn"') && taSrc.includes('id="sv-fav-sel"'), 'A4 问卷详情收藏操作条（整卡/全部/所选，#713d）');
ok(taSrc.includes('道题到问问TA题库') && taSrc.includes('function openTCPanel'), 'A5 单题收藏写入问问TA题库（#713e）');

// ---------- B 轴：真实产物 ----------
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
if (!existsSync(join(root, 'index.html'))) { console.error('no index.html in ' + root + '（先 node build.mjs）'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (await findFreePort(18000 + Math.floor(Math.random() * 1000)));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vsvfav-' + Date.now()),
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
function cleanup(code) {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(code);
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
// 归属校验：连到的必须是本脚本自己拉的 chrome + 自己的 server（防并行会话撞端口测到别人产物）
const host = await evalJs('location.host');
if (host !== '127.0.0.1:' + server.address().port) {
  console.error('FATAL: 页面不在本脚本的 server 上（host=' + host + '，期望 127.0.0.1:' + server.address().port + '）＝CDP 端口被并行会话占用');
  cleanup(1);
}
const ownHtml = await evalJs(`fetch('/index.html?_=' + Date.now()).then(function(r){return r.text()}).then(function(t){return JSON.stringify({hasHeart:t.indexOf('favHeartHtml(rec, true)')>=0, len:t.length})})`);
console.log('self-check served index.html: ' + ownHtml + '  disk=' + existsSync(join(root, 'index.html')));
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(600);
await evalJs('(function(){if(window.enterChat)window.enterChat();return true;})()');
await sleep(1200);

// —— S0 种入一张「已交卷」问卷卡（2 题：1 单选 + 1 文字，TA 已作答） ——
const seeded = await evalJs(`(function(){
  if (!window.chatImportMsgs) return 'no-fn';
  var ts=Date.now();
  var arr=[{side:'out',type:'text',text:'问卷发出去咯',ts:ts-1000}];
  arr.push({side:'in',special:'ask-survey',text:'问卷（2 题）',ts:ts,
    surveyTs:ts,
    surveyQs:[
      {type:'single',text:'更喜欢哪种约会',options:['看电影','去公园','在家待着']},
      {type:'text',text:'最近有什么心事',options:[]}
    ],
    surveyStatus:'done',surveyAnswers:['看电影','最近有点累']});
  window.__surveyTs=ts;
  return window.chatImportMsgs(arr)?'true':'false';
})()`);
ok(seeded === 'true', 'S0 种入已交卷问卷卡（2 题）', String(seeded));
await sleep(1200);

// —— B1 心形常显可见 ——
const b1 = JSON.parse(await evalJs(`(function(){
  var h=document.querySelector('.msg-survey-card .msg-fav-heart');
  var c=document.querySelector('.msg-survey-card');
  var cs=h?getComputedStyle(h):null;
  return JSON.stringify({heart:!!h, display:cs?cs.display:null, text:h?h.textContent:'',
    cards:document.querySelectorAll('.msg-survey-card').length,
    msgsN:(window.chatExportMsgs?window.chatExportMsgs():[]).length,
    chatVisible:!(document.getElementById('page-chat')||{}).hidden,
    pages:document.querySelectorAll('.page').length,
    bodyEls:document.querySelectorAll('#chat-body, .chat-body').length,
    errs:JSON.stringify((window.__jsErrors||[]).slice(0,3)),
    cardTail:c?c.innerHTML.slice(-160):null,
    cardCls:c?c.className:null,
    wrapCls:c&&c.closest('[data-idx]')?c.closest('[data-idx]').className:null});
})()`) || '{}');
ok(b1.heart === true && b1.display !== 'none', 'B1 问卷卡有收藏心形且常显（点卡片=看详情，心形藏起来就没人看得到）', JSON.stringify(b1));
ok(b1.cards >= 1 && Number(b1.msgsN) >= 2, 'B1b 前置：问卷卡渲染且消息在库', JSON.stringify({cards:b1.cards, msgsN:b1.msgsN}));

// —— B3 先测详情面板批量收藏（在整卡收藏前做，B5 的整卡收藏才能验「首次入库」） ——
await evalJs("(function(){var c=document.querySelector('.msg-survey-card');if(c)c.click();return true;})()");
await sleep(500);
const b3a = JSON.parse(await evalJs(`(function(){
  var mask=document.getElementById('tc-mask');
  return JSON.stringify({panelOpen:!!(mask&&!mask.hidden),
    title:(document.getElementById('tc-panel-title')||{}).textContent||'',
    favCard:!!document.getElementById('sv-fav-card'),
    favAll:!!document.getElementById('sv-fav-allbtn'),
    favSel:!!document.getElementById('sv-fav-sel'),
    chkAll:!!document.getElementById('sv-fav-chkall'),
    cbs:document.querySelectorAll('#sv-detail-list .sv-fav-cb').length,
    starred:document.querySelectorAll('#sv-detail-list .sv-fav-state').length});
})()`) || '{}');
ok(b3a.panelOpen === true && b3a.title === '问卷详情', 'B3a 详情=tc 面板「问卷详情」', JSON.stringify(b3a));
ok(b3a.favCard === true && b3a.favAll === true && b3a.favSel === true && b3a.chkAll === true && b3a.cbs === 2, 'B3b 操作条齐全：整卡/全部收藏/收藏所选/全选＋逐题勾选 2 行', JSON.stringify(b3a));
// 全选 → 收藏所选
await evalJs("(function(){var k=document.getElementById('sv-fav-chkall');if(k){k.checked=true;k.dispatchEvent(new Event('change',{bubbles:true}));}return true;})()");
await evalJs("(function(){var b=document.getElementById('sv-fav-sel');if(b)b.click();return true;})()");
await sleep(500);
const b3b = JSON.parse(await evalJs(`(async function(){
  var d=null; try{d=JSON.parse(window.activeStore().get('ta-ask'))}catch(e){}
  var qs=(d&&d.questions)||[];
  var mine=qs.filter(function(q){return q&&q.isPreset!==true&&/更喜欢哪种约会|最近有什么心事/.test(String(q.text||''))});
  var single=mine.filter(function(q){return q.type==='single'&&Array.isArray(q.options)&&q.options.length===3});
  var starred=document.querySelectorAll('#sv-detail-list .sv-fav-state');
  var st=['','']; starred.forEach(function(el){var i=Number(el.dataset.i);st[i]=el.textContent||''});
  return JSON.stringify({added:mine.length, single:(single||{}).length, st0:st[0], st1:st[1],
    optsText: single.length?single[0].options.join(','):'', enabled: mine.length===2&&mine.every(function(q){return q.enabled!==false&&q.cat==='daily'})});
})()`) || '{}');
ok(b3b.added === 2, 'B3c 收藏所选 → 两题写入问问TA题库（我的添加）', JSON.stringify(b3b));
ok(b3b.single === 1 && /看电影,去公园,在家待着/.test(b3b.optsText || ''), 'B3d 单选题带 options 入库（≥2 成单选，与批量导入同口径）', JSON.stringify(b3b));
ok(b3b.enabled === true, 'B3e 入库题目 enabled:true、归「日常」分类', JSON.stringify(b3b));
ok(b3b.st0 === '★ 已收藏' && b3b.st1 === '★ 已收藏', 'B3f ★ 徽标就地刷新（面板不关可继续看）', JSON.stringify([b3b.st0, b3b.st1]));
// —— B4 已收藏后「全部收藏」＝零重复入库 ——
const bankBefore = await evalJs("(function(){var d=null;try{d=JSON.parse(window.activeStore().get('ta-ask'))}catch(e){}return (d&&d.questions||[]).length;})()");
await evalJs("(function(){var b=document.getElementById('sv-fav-allbtn');if(b)b.click();return true;})()");
await sleep(400);
const bankAfter = await evalJs("(function(){var d=null;try{d=JSON.parse(window.activeStore().get('ta-ask'))}catch(e){}return (d&&d.questions||[]).length;})()");
ok(Number(bankBefore) === Number(bankAfter), 'B4 全部收藏对已入库题目零重复（题库条数不变 ' + bankBefore + '）', bankBefore + '→' + bankAfter);
// —— B5 面板「♡ 收藏整份问卷」＝整卡进收藏夹（含 qarr/aarr） ——
await evalJs("(function(){var b=document.getElementById('sv-fav-card');if(b)b.click();return true;})()");
await sleep(500);
const b5 = JSON.parse(await evalJs(`(function(){
  var fav=[]; try{fav=JSON.parse(window.activeStore().get('fav-msgs')||'[]')}catch(e){}
  var it=fav.filter(function(f){return f.kind==='card'&&f.special==='ask-survey'})[0]||null;
  return JSON.stringify({n:(it?1:0), q:it&&it.q, qarrN:it&&it.qarr?it.qarr.length:0, aarrN:it&&it.aarr?it.aarr.length:0,
    a0:it&&it.aarr?it.aarr[0]:''});
})()`) || '{}');
ok(b5.n === 1 && Number(b5.qarrN) === 2 && Number(b5.aarrN) === 2, 'B5 详情「收藏整份问卷」→ 收藏夹入问卷卡（题目列表与 TA 作答留档）', JSON.stringify(b5));
// 关面板
await evalJs("(function(){var b=document.getElementById('tc-mask-close');if(b)b.click();return true;})()");
await sleep(300);

// —— B2 点卡片心形收藏＋判重（B5 已入库一份，这里点应判重不重复） ——
await evalJs("(function(){var h=document.querySelector('.msg-survey-card .msg-fav-heart');if(h)h.click();return true;})()");
await sleep(400);
const b2 = JSON.parse(await evalJs(`(function(){
  var fav=[]; try{fav=JSON.parse(window.activeStore().get('fav-msgs')||'[]')}catch(e){}
  var n=fav.filter(function(f){return f.kind==='card'&&f.special==='ask-survey'}).length;
  return JSON.stringify({n:n});
})()`) || '{}');
ok(b2.n === 1, 'B2 点心形收藏整卡，重复点击判重不重复入库（收藏夹恒 1 份）', JSON.stringify(b2));

// —— B6 收藏页重放：标签/题干/选项/TA 作答 ——
await evalJs('(function(){if(window.renderFav)window.renderFav();return true;})()');
await sleep(400);
const b6 = JSON.parse(await evalJs(`(function(){
  var list=document.getElementById('fav-list'); if(!list) return JSON.stringify({list:false});
  var t=list.textContent||'';
  return JSON.stringify({list:true,
    tag:t.indexOf('互动卡片 · 问卷')>=0, head:t.indexOf('问卷 · 2 题')>=0,
    q1:t.indexOf('更喜欢哪种约会')>=0, q2:t.indexOf('最近有什么心事')>=0,
    opts:t.indexOf('看电影')>=0&&t.indexOf('去公园')>=0, a1:t.indexOf('最近有点累')>=0,
    items:list.querySelectorAll('.fav-item-card').length});
})()`) || '{}');
ok(b6.list === true && b6.tag === true, 'B6a 收藏页标签=「互动卡片 · 问卷」（FAV_KIND_LABEL 已认问卷）', JSON.stringify(b6));
ok(b6.head === true && b6.q1 === true && b6.q2 === true, 'B6b 收藏页重放题干（两题齐全）', JSON.stringify({head:b6.head,q1:b6.q1,q2:b6.q2}));
ok(b6.opts === true && b6.a1 === true, 'B6c 收藏页重放选项与 TA 作答', JSON.stringify({opts:b6.opts,a1:b6.a1}));

// —— Z 零异常 ——
const errs = await evalJs('JSON.stringify(window.__jsErrors||[])');
ok(errs === '[]', 'Z1 全程零 JS 异常', String(errs));

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
cleanup(fail ? 1 : 0);
