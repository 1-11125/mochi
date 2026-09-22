// ===== 回归脚本：#1033 拍卖会「自制拍品点了没反应」根治 =====
// 用法：node build.mjs && node tools/verify-1033-au-custom-add.mjs
// 背景（用户实报「拍卖回自制商品无反应」）：addCustomModal/customBidModal 五处调用 openModal
//   ctl 上不存在的 val() 方法（值读写口只有 text()）。点确定时 stay() 先置「本次不关窗」，
//   随后 TypeError 掐断回调——ph/okText 全不执行＝弹窗原地不动，三步表单永远卡在第一步。
// 本脚本驱动完整行为面：①➕ 能开弹窗且提示正确 ②名称→底价→彩蛋三步就地推进（判别面：
//   修复前第一步点确定即卡死）③入库字段正确 ④输入已有名称＝删除 ⑤满 20 上限支路提示
//   ⑥全程零 window error。纯基线必红 B2 及之后（B1 两侧同绿＝旧版「弹窗能开」假象）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('need node 21+'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
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
const cdpPort = 9760 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-au1033-' + Date.now()),
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
  throw new Error('cdp connect failed');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
await evalJs(`(function(){ window.__jsErrors = []; window.addEventListener('error', function(e){ try { window.__jsErrors.push(String(e.message).slice(0, 120)); } catch (x) {} }); return 1; })()`);

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, detail || ''); }
}
// 开屏关闭（同族三条件口径）
let splashClosed = false;
for (let i = 0; i < 30 && !splashClosed; i++) {
  const s = await evalJs(`(function(){
    var mm = document.getElementById('splash-mandatory');
    if (mm && !mm.hidden) {
      var sc = document.getElementById('splash-mandatory-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
      var men = document.getElementById('splash-mandatory-enter');
      if (men && !men.classList.contains('is-disabled')) { men.click(); return 'mclicked'; }
      return 'mwait';
    }
    var sp = document.getElementById('splash');
    if (!sp || sp.classList.contains('hide')) return 'closed';
    var sb = document.getElementById('splash-box');
    if (sb) sb.scrollTop = sb.scrollHeight;
    var se = document.getElementById('splash-enter');
    if (se && !se.disabled) { se.click(); return 'clicked'; }
    return 'wait';
  })()`);
  splashClosed = s === 'closed';
  if (!splashClosed) await sleep(300);
}
const splashDiag = await evalJs(`(function(){
  var sp = document.getElementById('splash');
  return { spHidden: sp ? sp.hidden : null, disp: sp ? getComputedStyle(sp).display : null };
})()`);
chk('A0 开屏已关闭（同族三条件口径）', splashClosed || splashDiag.disp === 'none' || splashDiag.spHidden === true, JSON.stringify(splashDiag));

await evalJs(`(function(){ var app = document.querySelector('.app[data-app="chat"]'); if (app) app.click(); return 1; })()`);
await sleep(1200);
const opened = await evalJs(`(function(){
  var b = document.getElementById('more-auction');
  if (b) { b.click(); return 'btn'; }
  return 'no-entry';
})()`);
await sleep(800);
chk('A1 拍卖会面板可打开', opened === 'btn', String(opened));

// 弹窗读写助手（openModal 单例：#modal-mask/#modal-title/#modal-input/#modal-static/#modal-ok）
const modalState = async () => JSON.parse(await evalJsSafe(`(function(){
  var m = document.getElementById('modal-mask');
  var t = document.getElementById('modal-title');
  var i = document.getElementById('modal-input');
  var s = document.getElementById('modal-static');
  var ok = document.getElementById('modal-ok');
  return JSON.stringify({
    open: !!m && !m.hidden,
    title: t ? t.textContent : '',
    ph: i ? i.placeholder : '', val: i ? i.value : '',
    ok: ok ? ok.textContent : '',
    static: s && !s.hidden ? s.textContent : ''
  });
})()`));
async function evalJsSafe(expr) { const v = await evalJs(expr); return v == null ? '{}' : v; }
async function typeAndOk(v) {
  await evalJs(`(function(){
    var i = document.getElementById('modal-input');
    if (!i) return 0;
    i.focus(); i.value = ${JSON.stringify(v)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await sleep(120);
  await evalJs(`(function(){ var b = document.getElementById('modal-ok'); if (b) b.click(); return 1; })()`);
  await sleep(350);
}
const readCustom = async () => JSON.parse(await evalJsSafe(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  var raw = null;
  try { if (window.xyStore) raw = window.xyStore(pre).get('auction-custom'); } catch (e) {}
  if (raw == null) { try { raw = localStorage.getItem(pre + ':auction-custom'); } catch (e) {} }
  try { var a = JSON.parse(raw || '[]'); return JSON.stringify(Array.isArray(a) ? a : []); } catch (e) { return '[]'; }
})()`));

// 清场：确保自定义列表为空
await evalJs(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  try { if (window.xyStore) window.xyStore(pre).set('auction-custom', '[]'); } catch (e) {}
  try { localStorage.setItem(pre + ':auction-custom', '[]'); } catch (e) {}
  return 1;
})()`);

// B1 ➕ 打开自制拍品弹窗（旧版也能过＝只证明「弹窗开」，不算修复证据）
await evalJs(`(function(){ var b = document.getElementById('au-add'); if (b) b.click(); return 1; })()`);
await sleep(400);
const b1 = await modalState();
chk('B1 ➕ 打开自制拍品弹窗（标题/占位/已有清单）', b1.open === true && b1.title.indexOf('自制拍品') >= 0 && b1.ph.indexOf('名称') >= 0 && b1.static.indexOf('还没有自制拍品') >= 0, JSON.stringify(b1));
// B2 核心判别：第一步「名称」点确定 → 弹窗就地推进（修复前此处卡死：占位/按钮/内容全不变）
await typeAndOk('星星灯牌');
const b2 = await modalState();
chk('B2 步骤推进①：名称→底价（弹窗不关、占位与按钮就地切换、输入框已清）', b2.open === true && b2.ph.indexOf('底价') >= 0 && b2.ok === '下一步' && b2.val === '', JSON.stringify(b2));
// B3 第二步「底价」非法值 → stay + 提示（同款死点之二）
await typeAndOk('abc');
const b3 = await modalState();
chk('B3 非法底价被拦（留在本步并给出可执行提示）', b3.open === true && b3.ph.indexOf('大于 0') >= 0 && b3.ok === '下一步', JSON.stringify(b3));
// B4 合法底价 → 第三步彩蛋
await typeAndOk('20');
const b4 = await modalState();
chk('B4 步骤推进②：底价→彩蛋（占位/按钮切到完成态）', b4.open === true && b4.ph.indexOf('彩蛋') >= 0 && b4.ok === '完成', JSON.stringify(b4));
// B5 第三步完成 → 关窗入库
await typeAndOk('夜宵配对暗号');
const b5 = await modalState();
const list5 = await readCustom();
const item = list5[0] || {};
chk('B5 步骤推进③：完成后弹窗关闭且入库一条', b5.open === false && list5.length === 1 && item.name === '星星灯牌' && item.base === 2000 && item.wish === '夜宵配对暗号', JSON.stringify({ open: b5.open, n: list5.length, item: item }));
chk('B6 入库 emoji 仍取自固定池（本批未改行为，改版批换锚）', ['🎁', '💎', '🧸', '🌈', '⭐', '🍰', '🎧', '🧿', '🌙', '🎀'].indexOf(item.ico) >= 0, String(item.ico));
// B7 输入已有名称＝删除（一步关窗，不推进）
await evalJs(`(function(){ var b = document.getElementById('au-add'); if (b) b.click(); return 1; })()`);
await sleep(300);
await typeAndOk('星星灯牌');
const b7 = await modalState();
const list7 = await readCustom();
chk('B7 重名即删：弹窗关闭且列表清空', b7.open === false && list7.length === 0, JSON.stringify({ open: b7.open, n: list7.length }));
// C1 满 20 上限支路（stay + 换提示＝同款死点之三）
await evalJs(`(function(){
  var pre = (window.activePrefix && window.activePrefix()) || 'xy-home-v2';
  var a = []; for (var k = 0; k < 20; k++) a.push({ ico: '🎁', name: '占位' + k, desc: '', base: 100, wish: '', mystery: 0 });
  var s = JSON.stringify(a);
  try { if (window.xyStore) window.xyStore(pre).set('auction-custom', s); } catch (e) {}
  try { localStorage.setItem(pre + ':auction-custom', s); } catch (e) {}
  return 1;
})()`);
await evalJs(`(function(){ var b = document.getElementById('au-add'); if (b) b.click(); return 1; })()`);
await sleep(300);
await typeAndOk('第二十一个');
const c1 = await modalState();
chk('C1 满 20 拦截：不关窗、提示「先删再加」', c1.open === true && c1.ph.indexOf('已满 20') >= 0, JSON.stringify(c1));
await evalJs(`(function(){ var b = document.getElementById('modal-cancel'); if (b) b.click(); return 1; })()`);
await sleep(200);
// C2 开场已有清单计数正确（staticText 走 loadCustom）
await evalJs(`(function(){ var b = document.getElementById('au-add'); if (b) b.click(); return 1; })()`);
await sleep(300);
const c2 = await modalState();
chk('C2 已有 20/20 计数如实显示', c2.open === true && c2.static.indexOf('已有 20/20') >= 0, String(c2.static).slice(0, 60));
await evalJs(`(function(){ var b = document.getElementById('modal-cancel'); if (b) b.click(); return 1; })()`);
// Z 全程零 window error（修复前 B2 起每次点确定各抛一枚 TypeError）
const errs = JSON.parse(await evalJsSafe(`JSON.stringify(window.__jsErrors || [])`));
chk('Z 全程零 window error', errs.length === 0, JSON.stringify(errs).slice(0, 200));

console.log(`\nverify-1033-au-custom-add: ${pass} PASS / ${fail} FAIL`);
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
