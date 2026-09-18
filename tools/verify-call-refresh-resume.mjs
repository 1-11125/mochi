// ===== 回归脚本：#699 刷新网页后通话没续上、也没保存通话记录到主页（多机型） =====
// 用法：node tools/verify-call-refresh-resume.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-call-refresh-resume.mjs   （测临时构建副本）
// 根因（2026-09-17）：saveCallActive 里 sessionStorage 与 localStorage 双写同处一个 try，
// 存储亚健康机型（LS 配额满 QuotaExceededError 同 #406 实锤 / 隐私模式 / WebView 禁用
// sessionStorage）第一句一抛整块中止，call-active 一份都没落盘＝recoverCall 读不到任何标记，
// 通话不续上、也不补「通话中断」记录，整通电话无声消失。且 call-active 从没写 IDB
// （call-hold #406 补了、call-active 漏了）。
// 断言：
//   A 轴（源码锚）：三路写入拆开各吃各的 try + IDB 副本；clear 写 {ts:0} 墓碑；
//                   recoverCall 回读链 sessionStorage→localStorage→IDB；IDB 副本卡新鲜度窗。
//   B 轴（真实产物）：真实去电接通后三路 call-active 都有；刷新后续上；挂断后 records-call
//                     有记录；模拟存储亚健康机型（两路 LS 写入全抛）仅 IDB 幸存时仍能写入
//                     且刷新后从 IDB 续上（RED 判别核心）；过期 IDB 旧标记不翻旧账。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

// ---------- A 轴：源码锚 ----------
let callSrc = '';
try { callSrc = readFileSync(join(root, 'src/js/call.js'), 'utf8'); } catch (e) {}
check('A1 saveCallActive 三路写入拆开各吃各的 try（并回同一 try＝亚健康机型一抛全丢）',
  /try \{ sessionStorage\.setItem\(CALL_ACTIVE_KEY, payload\); \} catch \(e\) \{\}\s*\n\s*try \{ localStorage\.setItem\(CALL_ACTIVE_KEY, payload\); \} catch \(e\) \{\}\s*\n\s*try \{ if \(window\.idbSet\) window\.idbSet\(CALL_ACTIVE_KEY, JSON\.parse\(payload\)\); \} catch \(e\) \{\}/.test(callSrc));
check('A2 clearCallActive 写 {ts:0} 墓碑进 IDB（防 idbRestore 幽灵回填）', callSrc.includes('window.idbSet(CALL_ACTIVE_KEY, { ts: 0 })'));
check('A3 recoverCall 回读链补 IDB 兜底（recoverProcess(ih, \'idb\')）', callSrc.includes("recoverProcess(ih, 'idb')"));
check('A4 IDB 副本卡 10 分钟新鲜度窗（防数天后翻出早已结束的旧通话）', callSrc.includes("src === 'idb' && Date.now() - (info.ts || 0) > 600000"));
if (results.some(r => !r.ok)) {
  console.log('----');
  console.log('A 轴有 FAIL：源码锚缺失（修复被覆盖或未接入），B 轴跳过');
  process.exit(1);
}

// ---------- B 轴：真实浏览器行为 ----------
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.log('----');
  console.log('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 后重跑）');
  process.exit(2);
}

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9980 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-698-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            jsErrors.push((d && d.exception && d.exception.description || d && d.text || 'js error').slice(0, 200));
          }
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
    if (r && r.exceptionDetails) {
      jsErrors.push((r.exceptionDetails.exception && r.exceptionDetails.exception.description || 'eval err').slice(0, 200));
      return null;
    }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
async function waitAppReady() {
  for (let i = 0; i < 80; i++) {
    const ok = await evalJs(`!!(window.placeCall && window.getCallState && window.idbGet)`);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}
async function waitCallConnected(timeout = 12000) {
  for (let i = 0; i < Math.ceil(timeout / 300); i++) {
    const st = await evalJs(`JSON.stringify(window.getCallState ? window.getCallState() : null)`);
    try {
      const o = JSON.parse(st);
      if (o && o.status === 'connected' && o.durationSec >= 0) return o;
    } catch (e) {}
    await sleep(300);
  }
  return null;
}

const CALL_KEY = 'xy-home-v2:call-active';
try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('应用未就绪');

  // B1 真实去电接通（Math.random 钉 0.5：去电结果落 70% 接通档、结果延迟固定 ~2.5s）
  //    → 三路 call-active 全部落盘（sessionStorage / localStorage / IDB，含 connectedTime）
  await evalJs(`Math.random = (function(orig){ return function(){ return 0.5; }; })(Math.random); window.placeCall(); 'dialing'`);
  const b1 = await waitCallConnected();
  await sleep(400); // IDB 写入是异步，稍等结算
  const b1stores = await evalJs(`(async function(){
    var ss=null, ls=null, idb=null;
    try { ss = JSON.parse(sessionStorage.getItem('${CALL_KEY}')||'null'); } catch(e){}
    try { ls = JSON.parse(localStorage.getItem('${CALL_KEY}')||'null'); } catch(e){}
    try { idb = await window.idbGet('${CALL_KEY}'); } catch(e){}
    return JSON.stringify({
      ss: !!(ss && ss.connectedTime), ls: !!(ls && ls.connectedTime),
      idb: !!(idb && idb.connectedTime), idbTs: idb ? !!idb.ts : false
    });
  })()`);
  let o = null; try { o = JSON.parse(b1stores); } catch (e) {}
  check('B1 去电接通：call-active 三路落盘（sessionStorage/localStorage/IDB）', b1 && o && o.ss && o.ls && o.idb, b1stores);

  // B2 刷新 → 通话续上（status connected，时长从接通时刻继续）
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('刷新后应用未就绪');
  await sleep(800); // 等 mochi-restore-done → bootCallResume → recoverCall
  const b2 = await waitCallConnected(8000);
  check('B2 刷新后通话续上（getCallState=connected）', !!b2, JSON.stringify(b2));

  // B3 挂断 → 主页通话记录落库（records-call 有「通话已挂断」条目）
  await evalJs(`window.hangupCall(); 'hangup'`);
  await sleep(400);
  const b3 = await evalJs(`(function(){
    var raw = localStorage.getItem('xy-home-v2:default:records-call') || '[]';
    var arr; try { arr = JSON.parse(raw); } catch(e){ return 'parse-err'; }
    var hit = (Array.isArray(arr) ? arr : []).some(function(r){ return r && String(r.text||'').indexOf('已挂断') >= 0; });
    return JSON.stringify({ n: (Array.isArray(arr)?arr.length:0), hit: hit, first: (Array.isArray(arr)&&arr[0]) ? arr[0].text : '' });
  })()`);
  o = null; try { o = JSON.parse(b3); } catch (e) {}
  check('B3 续上后挂断：主页 records-call 落一条「已挂断」记录', o && o.hit, b3);

  // B4/B5 RED 判别核心：模拟存储亚健康机型（sessionStorage.setItem 与 localStorage.setItem 全抛，
  //   复刻 #699/#406 故障形态）→ 去电接通 → 两路 LS 必然全空、IDB 副本必须幸存（双写拆开+IDB 兜底）；
  //   该状态下刷新 → 仍能从 IDB 续上（原实现此处 call-active 一份都没有＝通话消失且无记录）
  //   口径更新（2026-09-18 #722 会话，对照 #705 墓碑制）：先摘掉 B3 挂断留下的 SS/LS {"ts":0}
  //   墓碑——recoverCall 读到 SS 墓碑即 return、从不下探 IDB，不摘就测不到「仅 IDB 幸存」这条链
  //   （原版此处恒红＝过期口径，非回归）。
  await evalJs(`(function(){
    sessionStorage.setItem = function(){ throw new Error('quota'); };
    localStorage.setItem = function(){ throw new Error('quota'); };
    try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}
    try { localStorage.removeItem('${CALL_KEY}'); } catch(e){}
    return 'stubbed';
  })()`);
  await evalJs(`window.placeCall(); 'dialing'`);
  const b4conn = await waitCallConnected();
  await sleep(500);
  const b4 = await evalJs(`(async function(){
    var ls=null, idb=null;
    try { ls = JSON.parse(localStorage.getItem('${CALL_KEY}')||'null'); } catch(e){ ls = 'throw'; }
    try { idb = await window.idbGet('${CALL_KEY}'); } catch(e){}
    return JSON.stringify({ lsEmpty: !ls || ls === 'throw' || !ls.connectedTime, idb: !!(idb && idb.connectedTime) });
  })()`);
  o = null; try { o = JSON.parse(b4); } catch (e) {}
  check('B4 存储亚健康机型（两路 LS 写入全抛）：接通后 IDB 副本幸存', !!b4conn && o && o.lsEmpty && o.idb, b4);

  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('再次刷新后应用未就绪');
  await sleep(800);
  const b5 = await waitCallConnected(8000);
  check('B5 同机型刷新：仅 IDB 副本幸存也能续上通话', !!b5, JSON.stringify(b5));
  await evalJs(`window.hangupCall(); 'hangup'`);

  // B6 IDB 里塞 2 小时前的旧标记（心跳早停＝早已结束）→ 刷新后不恢复、不翻旧账。
  //   口径更新（2026-09-18 #722 会话，对照 #705 墓碑制）：clearCallActive 现写 {"ts":0}
  //   墓碑而非 removeItem，「被清」＝读到 ts:0 墓碑；且种子前先摘掉 SS/LS 旧标记，
  //   让 recoverCall 真正走到 IDB 兜底回读路径（原版 SS 墓碑命中即 return，测不到 A4）。
  await evalJs(`(async function(){
    await window.idbSet('${CALL_KEY}', { cid:'default', direction:'out', status:'connected',
      startTime: Date.now()-7200000, connectedTime: Date.now()-7200000, name:'TA', av:'', ts: Date.now()-7200000 });
    try { sessionStorage.removeItem('${CALL_KEY}'); } catch(e){}
    try { localStorage.removeItem('${CALL_KEY}'); } catch(e){}
    return 'seeded';
  })()`);
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  if (!(await waitAppReady())) throw new Error('三次刷新后应用未就绪');
  await sleep(1200);
  const b6 = await evalJs(`(function(){
    function tomb(v){ if(!v) return true; try { var o=JSON.parse(v); return !!o && o.ts===0; } catch(e){ return false; } }
    var st = window.getCallState ? window.getCallState() : null;
    return JSON.stringify({ noGhost: !st, cleared: tomb(sessionStorage.getItem('${CALL_KEY}')) && tomb(localStorage.getItem('${CALL_KEY}')) });
  })()`);
  o = null; try { o = JSON.parse(b6); } catch (e) {}
  check('B6 过期 IDB 旧标记：不恢复旧通话、标记被清（10 分钟新鲜度窗）', o && o.noGhost && o.cleared, b6);

  const errs = jsErrors.filter((e) => e.indexOf('quota') < 0); // B4 故意抛的 quota 不算
  check('B7 全程无意外 JS 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
}

const fails = results.filter(r => !r.ok).length;
console.log('----');
console.log(fails === 0 ? 'ALL PASS ' + results.length + '/' + results.length : 'FAIL ' + (results.length - fails) + '/' + results.length);
process.exit(fails === 0 ? 0 : 1);
