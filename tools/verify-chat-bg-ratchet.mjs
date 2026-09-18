// verify-chat-bg-ratchet.mjs —— 验证 #751：聊天壁纸「基线棘轮」不得把冻结尺寸永久抬高。
// 用户报障（OPPO Reno14 + Edge 151，多机型同现）：「聊天里的背景图片的比例变了，莫名其妙放大了」。
//
// 根因（#750 引入的新回归，与 #750 修的「变小」是同一族但方向相反）：
//   #750 的 csBgStableBox() 基线**只涨不跌**——
//       if (w !== csBgStableW) { 重锚 } else if (h > csBgStableH) { csBgStableH = h; }
//   设计前提是「键盘只会压矮高度」，但移动端 .phone 走的是 height:100dvh，
//   **dvh 本身会随地址栏自动隐藏而变大**（诊断实测 inner=735 / screen=791）。OPPO/Edge 在
//   聊天消息区滚动时地址栏自动收起 → dvh 涨到 791 → 触发 resize → applySettings 读到更大的
//   盒高 → 基线被永久抬高到 791 档；地址栏回来后盒高落回 735，但基线**永远不会降回去**。
//   于是 cover 按「791 档的大盒」折算像素 ⇒ 壁纸被放大（用户视角「莫名其妙放大了、比例变了」）。
//
// 口径：
//   R1  装壁纸后基线与「当前盒」折算一致（初始无污染前提）
//   R2  盒临时变大（模拟地址栏自动隐藏 / dvh 涨）后 bgSize 确实被抬高过（证明现象可复现）
//   R3  盒落回原尺寸并把键盘/地址栏都收起后：bgSize 必须**回落**到与 R1 基线等价
//       ——这是本批的核心断言，棘轮版必红
//   R4  回落后的实际绘制尺寸（painted）必须与 R1 逐字节相同（用户视角「图不再被放大」）
//   R5  回落后的缩放比 与 R1 漂移 < 0.5%
//   R6  真正换环境（改宽＝旋转）仍要能重新锚定（不得因为「能降」就永远冻死）
//   R7  反复 涨→落 三次后最终仍回到 R1 等价尺寸（不得逐次漂移累积）
//
// RED 基线：
//   当前工作区（棘轮版）＝ R3/R4/R7 红（基线被永久抬高，图保持放大态）
//   强制 csBgStableBox 永远返回首值（完全不重锚）＝ R2/R6 红
// 用法：MOCHI_ROOT=<Windows 路径 to build> node tools/verify-chat-bg-ratchet.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || process.cwd());
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (p.endsWith('\\') || p.endsWith('/')) p += 'index.html';
    let body; let ct = 'application/octet-stream';
    try { statSync(p); } catch (e) { p = join(root, 'index.html'); }
    ct = types[extname(p).toLowerCase()] || ct;
    body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('x'); }
});
const port = 8800 + Math.floor(Math.random() * 900);
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + port;

const chromePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => { try { statSync(p); return true; } catch (e) { return false; } });
if (!chromePath) { console.log('FATAL 找不到 Chrome/Edge'); process.exit(1); }

const udd = join(tmpdir(), 'mochi-bg-ratchet-' + Date.now());
const ch = spawn(chromePath, [
  '--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + udd,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let cdpPort = 0;
ch.stderr.on('data', (d) => { const m = String(d).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) cdpPort = +m[1]; });
for (let i = 0; i < 80 && !cdpPort; i++) await sleep(150);
if (!cdpPort) { console.log('FATAL 无 CDP 端口'); ch.kill(); server.close(); process.exit(1); }

let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const p = l.find((t) => t.type === 'page');
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.log('FATAL 无法连接 CDP'); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'ERR:' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 200);
  return r && r.result ? r.result.value : null;
};

const results = [];
const chk = (id, ok, got) => { results.push({ id, ok: !!ok, got }); };
const isPxSize = (s) => /^\d+(\.\d+)?px \d+(\.\d+)?px$/.test(String(s || '').trim());
const ratio = (s) => { const m = String(s || '').split('x'); return m.length === 2 ? (parseFloat(m[0]) / parseFloat(m[1])) : NaN; };

await cdp('Runtime.enable');
await cdp('Page.enable');
// 基准视口 360x735（与用户诊断一致），模拟 OPPO Reno14
const VW = 360, VH0 = 735, VH_BIG = 791;
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH0, deviceScaleFactor: 3, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'userAgent',{get:function(){return 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36 EdgA/151.0.0.0';}});" });
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(2500);
for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s)s.click();return 1;})()");
await sleep(900);
await evalJs('(function(){var a=document.querySelector(\'.app[data-app="chat"]\');if(a)a.click();return 1;})()');
await sleep(1600);

const seeded = await evalJs(`(function(){
  try {
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="4096"><rect width="2160" height="4096" fill="#cce6ff"/><circle cx="1080" cy="2048" r="900" fill="#ff6677"/></svg>';
    var url='data:image/svg+xml;base64,'+btoa(svg);
    var st = (typeof window.activeStore==='function') ? window.activeStore() : null;
    if (st && st.set) { st.set('cs-bg', url); st.set('cs-bg-active-id','w1'); try{ st.remove('cs-bg-fit'); }catch(e){} }
    else localStorage.setItem('xy-home-v2:default:cs-bg', url);
    if (typeof window.applyChatSettings==='function') window.applyChatSettings();
    return 'seeded';
  } catch(e){ return 'err:'+e; }
})()`);
await sleep(1400);

const geom = `(function(){
  try{
    var pc=document.getElementById('page-chat');
    if(!pc) return JSON.stringify({err:'no el'});
    var cs=getComputedStyle(pc);
    var nat=pc.__csBgNat;
    var sizeStr=cs.backgroundSize;
    var painted='?';
    if(nat&&nat.w&&nat.h){
      var bw=pc.clientWidth, bh=pc.clientHeight;
      var w,h;
      var mPx=sizeStr.match(/^([\\d.]+)px\\s+([\\d.]+)px$/);
      if(mPx){ w=parseFloat(mPx[1]); h=parseFloat(mPx[2]); }
      else if(sizeStr==='cover'){ var s=Math.max(bw/nat.w,bh/nat.h); w=nat.w*s; h=nat.h*s; }
      else if(sizeStr==='contain'){ var s2=Math.min(bw/nat.w,bh/nat.h); w=nat.w*s2; h=nat.h*s2; }
      else if(sizeStr==='auto'){ w=nat.w; h=nat.h; }
      else { w=NaN; h=NaN; }
      if(!isNaN(w)) painted=Math.round(w)+'x'+Math.round(h);
    }
    return JSON.stringify({
      pcH: Math.round(pc.getBoundingClientRect().height),
      pcW: Math.round(pc.getBoundingClientRect().width),
      inlineSize: pc.style.backgroundSize||'',
      bgSize: cs.backgroundSize,
      painted: painted,
      nat: (nat && nat.w) ? (nat.w+'x'+nat.h) : 'none'
    });
  }catch(e){ return JSON.stringify({err:String(e)}); }
})()`;

const R1 = JSON.parse(await evalJs(geom));
chk('R1 装壁纸后为显式像素尺寸', isPxSize(R1.bgSize) && R1.painted !== '?', R1.inlineSize + ' / ' + R1.painted);

// 场景：地址栏自动隐藏（dvh 涨到 791）→ 盒变大
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH_BIG, deviceScaleFactor: 3, mobile: true });
await sleep(1300);
const R2 = JSON.parse(await evalJs(geom));
const upShifted = R2.painted !== R1.painted;
chk('R2 盒临时变大后壁纸确实被抬高（现象可复现）', upShifted, R1.painted + ' -> ' + R2.painted);

// 场景：地址栏回来（dvh 落回 735）→ 盒落回原尺寸
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH0, deviceScaleFactor: 3, mobile: true });
await sleep(1400);
const R3 = JSON.parse(await evalJs(geom));
chk('R3 盒落回后尺寸必须回落（棘轮版必红）', R3.painted === R1.painted, R1.painted + ' -> ' + R3.painted);
chk('R4 回落绘制尺寸与基线逐字节相同', R3.painted === R1.painted && R1.painted !== '?', R1.painted + ' -> ' + R3.painted);
chk('R5 回落缩放比漂移 < 0.5%',
  (function () { const a = ratio(R1.painted), b = ratio(R3.painted); if (isNaN(a) || isNaN(b)) return false; return Math.abs(a - b) < 0.005; })(),
  R1.painted + ' -> ' + R3.painted);

// 真换环境（旋转/改宽）仍要能重锚
await cdp('Emulation.setDeviceMetricsOverride', { width: 801, height: 360, deviceScaleFactor: 3, mobile: true });
await sleep(1500);
const R6 = JSON.parse(await evalJs(geom));
chk('R6 改宽后仍能重新锚定（不许冻死）', R6.painted !== R1.painted && isPxSize(R6.bgSize), R1.painted + ' -> ' + R6.painted);

// 反复 涨→落 三次，最终必须回到 R1 等价（不得累积漂移）
await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH0, deviceScaleFactor: 3, mobile: true });
await sleep(1300);
for (let k = 0; k < 3; k++) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH_BIG, deviceScaleFactor: 3, mobile: true });
  await sleep(700);
  await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH0, deviceScaleFactor: 3, mobile: true });
  await sleep(900);
}
await sleep(600);
const R7 = JSON.parse(await evalJs(geom));
chk('R7 反复进出三次后仍回到基线（无累积漂移）', R7.painted === R1.painted, R1.painted + ' -> ' + R7.painted);

let pass = 0;
console.log('=== #751 聊天壁纸基线棘轮（OPPO Reno14 + Edge 实报「背景图放大」） ===');
console.log('seed:', seeded, ' nat:', R1.nat);
for (const r of results) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id + '  [' + r.got + ']'); if (r.ok) pass++; }
console.log('---- ' + pass + '/' + results.length + ' ----');

ch.kill(); server.close(); process.exit(pass === results.length ? 0 : 1);
