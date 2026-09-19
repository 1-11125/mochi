// ===== 回归脚本：#823 寻踪（TA 的日常）总开关 —— 关闭即全静 =====
// 用法：node tools/verify-checkin-disable.mjs（MOCHI_ROOT 可指到仓外隔离副本的产物根）
// 用户直派（2026-09-19）：「寻踪功能缺少禁用，关闭这个功能」——经确认要的是「加总开关，关了就全静」。
//   旧实现只有「寻踪日常发送到聊天」概率（dcf-checkin）：调到 0% 只停聊天推送，寻踪页与记录照旧生成，
//   桌面上【寻踪】图标、聊天「更多功能」里的寻踪、点 TA 头像的寻踪半框一个都收不掉＝用户说的「缺少禁用」。
// 新增 per-cid 键 checkin-en（从未写过＝默认开启，老用户零迁移）。关闭后：
//   ① doCheckin 单点收口——日常不生成、不推聊天、不落记录、不重置计时（自动轮询/手动刷新/半框/寻踪页全经它）；
//   ② 三入口一并收起——桌面图标（与装修手动隐藏同轴，applyHiddenIcons 复位也不放回来）、更多面板 #more-ck、点头像的半框；
//   ③ 寻踪页不再打开，并给出「设置 → 工具 → 寻踪 可重新开启」指引（功能大全等程序化跳转不落空）；
//   ④ 已有日常与寻踪记录原样保留，重新开启即恢复（不补发关闭期间的消息）。
// 断言：
//   P1 开关在位且默认开启（HEAD 无此 API＝必红）
//   A2 关到实设：per-cid 键落 '0' ＋ 桌面图标收起 ＋ 字卡库同名开关同步
//   A3 关闭后聊天「更多功能」里寻踪项收起（面板每次打开都重算，冷启动持久化态也算）
//   A4 关闭后点顶部 TA 头像不再弹寻踪半框
//   A5 关闭后寻踪页不再打开且有可恢复指引（不再静默死跳）
//   A6 关闭后自动轮询路径零副作用（节奏键/当前日常/记录三样都不动）
//   A7 已有日常与寻踪记录保留（关闭不删数据）
//   A8 切桌面、装修「恢复隐藏图标」后入口不复活
//   A9 重新开启即全恢复（图标/半框/页）
//   S1 产物锚点（逻辑锚：修复被覆盖即消失）
// 需要：Node 21+ ＋ 本机 Chrome/Edge（CHROME_PATH 可指定）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9890 + Math.floor(Math.random() * 50);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-ck-disable-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
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
  // 页面被原生对话框/长任务卡住时 Runtime.evaluate 永不返回——回归脚本必须给出 FAIL 而不是挂死
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; pend.delete(id); res(v); };
    pend.set(id, finish);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => finish(null), 15000);
  });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  [eval err]', (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 240)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
// 总时长看门狗：某步把无头浏览器卡死时也要落地结论，不让回归脚本无限挂着
const watchdog = setTimeout(() => {
  console.log('\nTIMEOUT 看门狗触发（4 分钟未完成），已出结果 ' + results.length + ' 条');
  try { chrome.kill(); } catch (e) {}
  process.exit(2);
}, 240000);
const toObj = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return {}; } };

// ---- 开屏：进应用（与真机同路径：等数据就绪 → 点「进入」→ splash 退场） ----
async function boot() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2600);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await evalJs(`(function(){
    try {
      var mm = document.getElementById('splash-mandatory');
      if (mm && !mm.hidden) {
        var sc = document.getElementById('splash-mandatory-scroll'); if (sc) sc.scrollTop = sc.scrollHeight;
        var me = document.getElementById('splash-mandatory-enter'); if (me && !me.hidden) me.click();
        mm.hidden = true;
      }
      var sp = document.getElementById('splash');
      if (sp) { sp.classList.add('hide'); sp.hidden = true; }
      var mask = document.getElementById('modal-mask');
      if (mask && !mask.hidden) mask.hidden = true;
    } catch (e) {}
    return 1;
  })()`);
  await sleep(800);
  // splash「进入」后可能逢页面刷新（pwa/ver-check），刷完才谈得上运行期断言
  await waitReady();
}
// 等页面重新就绪（核心运行时在位）；纯 HEAD 上 window.checkinEnabled 本就没有，故不参与判定
async function waitReady() {
  for (let i = 0; i < 20; i++) {
    if (await evalJs("(typeof window.activeStore === 'function' && !!window.__mochiDataReady) ? 1 : 0")) return true;
    await sleep(300);
  }
  return false;
}
// 取现场（不抛异常）：页面尚未重新就绪时读到 undefined 属正常，交由各断言判红
async function snap() {
  const v = await evalJs(SNAPSHOT);
  const s = toObj(v);
  if (s && s.api !== undefined) return s;
  await sleep(1200);
  const again = toObj(await evalJs(SNAPSHOT));
  return again && again.api !== undefined ? again : {};
}

// 一次性取全部寻踪相关现场（同一次求值内读，避免多次往返之间被别的路径改写）
const SNAPSHOT = `(function(){
  var st = (typeof window.activeStore === 'function') ? window.activeStore() : { get: function () { return null; }, set: function () {} };
  var app = document.querySelector('.app[data-app="checkin"]');
  var hist = [];
  try { hist = JSON.parse(st.get('checkin-history') || '[]'); } catch (e) {}
  var cur = null;
  try { cur = JSON.parse(st.get('checkin-current') || 'null'); } catch (e) {}
  var pg = document.getElementById('page-checkin');
  var panel = document.getElementById('ck-panel');
  var fe = document.getElementById('ck-fe-en');
  return JSON.stringify({
    api: typeof window.checkinEnabled === 'function' ? (window.checkinEnabled() ? 1 : 0) : -1,
    key: st.get('checkin-en'),
    desk: app ? (getComputedStyle(app).display) : 'no-app',
    setRow: !!document.getElementById('sf-checkin-row'),
    setChk: (function(){ var i = document.getElementById('sf-checkin-en'); return i ? (i.checked ? 1 : 0) : -1; })(),
    feChk: fe ? (fe.checked ? 1 : 0) : -1,
    last: st.get('checkin-last'), next: st.get('checkin-next'),
    curTs: cur && cur.ts ? curTsOf(cur) : (cur && cur.place ? 'no-ts' : ''),
    curPlace: cur && cur.place ? cur.place : '',
    hist: hist.length,
    page: pg && !pg.hidden ? 1 : 0,
    panel: panel && !panel.hidden ? 1 : 0,
    errs: (window.__jsErrors || []).length
  });
  function curTsOf(o){ return String(o.ts); }
})()`;

await boot();

// ---- P1 开关在位且默认开启（老用户从未写过该键＝开启，图标可见、设置行已勾选） ----
{
  const s = await snap();
  check('P1 总开关在位、默认开启（桌面图标可见＋设置行已渲染并勾选）',
    s.api === 1 && s.setRow && s.setChk === 1 && s.desk !== 'none',
    JSON.stringify({ api: s.api, setRow: s.setRow, setChk: s.setChk, desk: s.desk, key: s.key }));
}

// ---- A2 点设置页真实开关关闭：键落 '0' ＋ 桌面图标收起 ＋ 字卡库同名开关同步 ----
{
  await evalJs("(function(){ var i=document.getElementById('sf-checkin-en'); if(i) i.click(); return 1; })()");
  await sleep(400);
  const s = await snap();
  check('A2 关闭生效：per-cid 键＝0、桌面【寻踪】图标收起、字卡库同名开关同步为关',
    s.api === 0 && s.key === '0' && s.desk === 'none' && s.feChk === 0,
    JSON.stringify({ api: s.api, key: s.key, desk: s.desk, feChk: s.feChk }));
}

// ---- A3 关闭后聊天「更多功能」里寻踪项收起（真实点「+」开面板；面板每次打开重算分类＝持久化冷态也收得住） ----
{
  await evalJs("(function(){ if (window.enterChat) window.enterChat(); return 1; })()");
  await sleep(500);
  await evalJs("(function(){ var b=document.getElementById('chat-more-btn'); if(b) b.click(); return 1; })()");
  await sleep(400);
  const r = toObj(await evalJs(`(function(){
    var it = document.getElementById('more-ck');
    var tool = document.querySelector('#more-tabs .more-tab[data-mcat="tool"]');
    if (tool) tool.click();
    return JSON.stringify({ before: it ? (it.hidden ? 1 : 0) : -1 });
  })()`));
  await sleep(200);
  const after = await evalJs("(function(){ var it=document.getElementById('more-ck'); return it ? (it.hidden?1:0) : -1; })()");
  check('A3 关闭后「更多功能」里的寻踪项收起（开面板与切到「工具」分类都不显示）',
    r.before === 1 && after === 1, JSON.stringify({ openPanel: r.before, toolTab: after }));
  await evalJs("(function(){ var p=document.getElementById('chat-more-panel'); if(p) p.hidden = true; return 1; })()");
}

// ---- A4 关闭后点顶部 TA 头像不再弹寻踪半框（chat.js 头像入口走 toggleCkPanel） ----
{
  await evalJs("(function(){ if (window.toggleCkPanel) window.toggleCkPanel(); return 1; })()");
  await sleep(400);
  const s = await snap();
  check('A4 关闭后点 TA 头像不弹寻踪半框', s.panel === 0, 'ck-panel 可见=' + s.panel);
}

// ---- A5 关闭后寻踪页不再打开，并给出可恢复指引（不静默死跳） ----
{
  await evalJs(`(function(){
    window.__ckToast = [];
    var t = window.toast;
    window.toast = function (m) { try { window.__ckToast.push(String(m)); } catch (e) {} if (t) return t.apply(null, arguments); };
    return 1;
  })()`);
  await evalJs("(function(){ if (window.openCheckinPage) window.openCheckinPage(); return 1; })()");
  await sleep(400);
  const s = await snap();
  const toasts = toObj(await evalJs("(function(){ return JSON.stringify(window.__ckToast || []); })()")) || [];
  const guided = toasts.some((m) => m.indexOf('寻踪已关闭') >= 0);
  check('A5 关闭后寻踪页打不开，且提示「设置 → 工具 → 寻踪 可重新开启」',
    s.page === 0 && guided, JSON.stringify({ page: s.page, toasts: toasts }));
}

// ---- A6 关闭后自动轮询零副作用：把节奏键推回「该更新了」再走一遍启动同款触发（mochi-restore-done → bootCheckin → checkAutoCheckin） ----
{
  const before = await snap();
  await evalJs("(function(){ if (typeof window.activeStore !== 'function') return 0; var st=window.activeStore(); st.set('checkin-last','0'); st.set('checkin-next','0'); return 1; })()");
  await evalJs("(function(){ document.dispatchEvent(new Event('mochi-restore-done')); return 1; })()");
  await sleep(1500);
  const after = await snap();
  check('A6 关闭后自动链一步都不做：节奏键停在播种值、当前日常与记录不动、零推送',
    after.last === '0' && after.next === '0' && after.hist === before.hist && after.curTs === before.curTs && after.key === '0' && after.errs === before.errs,
    JSON.stringify({ last: [before.last, after.last], next: after.next, cur: [before.curTs, after.curTs], hist: [before.hist, after.hist], errs: [before.errs, after.errs] }));
}

// ---- A7 已有日常与寻踪记录原样保留（关闭不删数据；两侧同绿＝不破坏存量） ----
{
  const s = await snap();
  check('A7 关闭状态下已有日常与寻踪记录保留（记录条数 >0 且当前日常仍在库里）',
    s.hist > 0 && !!s.curPlace, JSON.stringify({ hist: s.hist, cur: s.curPlace }));
}

// ---- A8 切桌面、装修里「恢复隐藏图标」后入口不复活（applyHiddenIcons 会把名单外图标 display 复位） ----
{
  await evalJs("(function(){ document.dispatchEvent(new Event('contact-switched')); document.dispatchEvent(new Event('decor-exited')); return 1; })()");
  await sleep(600);
  const s = await snap();
  check('A8 切桌面／退出装修后桌面图标仍收起（不随隐藏名单复位而复活）',
    s.desk === 'none' && s.api === 0 && s.feChk === 0, JSON.stringify({ desk: s.desk, api: s.api, feChk: s.feChk }));
}

// ---- A9 重新开启即全恢复（图标回来、半框能开、寻踪页能开；开关两处同步） ----
{
  await evalJs("(function(){ var i=document.getElementById('sf-checkin-en'); if(i) i.click(); return 1; })()");
  await sleep(400);
  await evalJs("(function(){ if (window.toggleCkPanel) window.toggleCkPanel(); return 1; })()");
  await sleep(400);
  const s0 = await snap();
  await evalJs("(function(){ if (window.openCheckinPage) window.openCheckinPage(); return 1; })()");
  await sleep(500);
  const s1 = await snap();
  check('A9 重新开启即恢复：图标显示、点头像弹半框、寻踪页能打开、两处开关同步为开',
    s1.api === 1 && s1.key === '1' && s1.desk !== 'none' && s0.panel === 1 && s1.page === 1 && s1.feChk === 1,
    JSON.stringify({ api: s1.api, key: s1.key, desk: s1.desk, panel: s0.panel, page: s1.page, feChk: s1.feChk }));
}

// ---- S1 产物锚点（逻辑锚；修复被并行会话覆盖即消失） ----
{
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const c = (n) => html.split(n).length - 1;
  const SL = String.fromCharCode(47, 47); // 斜杠对，避免本文件里出现裸注释串
  const anchors = {
    gateDo: c('if (!ckEn()) return; ' + SL + ' #823a'),
    gatePanel: c('if (!ckEn()) return; ' + SL + ' #823b'),
    gatePage: c('if (!ckEn()) { ' + SL + ' #823c'),
    key: c("const CK_EN_KEY = 'checkin-en';"),
    deskOff: c('window.checkinDeskOff = function () { return !ckEn(); };'),
    more: c("it.id === 'more-ck' && window.checkinEnabled"),
    iconUnion: c("if (hidden.indexOf(key) >= 0 || (ckOff && key === 'checkin')) app.style.display = 'none';"),
    help: c('寻踪（TA 的日常）'),
    lic: c('不想用寻踪可以整体关闭')
  };
  const all = Object.values(anchors).every((n) => n >= 1);
  check('S1 产物锚点齐备（三道闸门＋开关键＋入口收口口径＋桌面图标并集＋设置说明＋使用说明条目）',
    all, JSON.stringify(anchors));
  let sh = '';
  try { sh = readFileSync(join(root, 'js', 'settings-help.js'), 'utf8'); } catch (e) {}
  check('S2 设置页搜索/说明素材登记在位（外置 settings-help.js 认 #sf-checkin-row）',
    sh.indexOf("sel: '#sf-checkin-row'") >= 0);
}

const failed = results.filter((r) => !r.ok);
clearTimeout(watchdog);
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' 通过' + (failed.length ? '；失败：' + failed.map((f) => f.desc).join(' | ') : ''));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(failed.length ? 1 : 0);
