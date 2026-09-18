// verify-perf-check-live.mjs — #770 卡顿自检运行时行为断言（无头 Chrome，测构建产物 index.html）
// 配套源级脚本 verify-perf-check.mjs（A1~A20）。红米 K80 Chrome 实报复现：
//   ①旧码停在设置页自检，「掉帧集中」归因到桌面图标（该机报「占卜(100%)」）——本脚本在
//     桌面人为制造 80ms 主线程阻塞，断言掉帧归因为 main（旧码在桌面也只会报某个图标名，
//     永远报不出 main＝RED 有牙）；
//   ②阈值自适应 jankMs 落在 [24,34]；报告含平均 fps/正常帧间隔/采样页面分布；
//   ③判「流畅」但确有掉帧时结论说真话（可忽略），不再自称「未捕获掉帧」。
// 用法：node build.mjs && node tools/verify-perf-check-live.mjs（隔离验证：MOCHI_ROOT=<副本目录>）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
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

const cdpPort = 9900 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-pchk-live-' + Date.now()),
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
    if (r && r.exceptionDetails) return 'EX:' + JSON.stringify(r.exceptionDetails).slice(0, 200);
    return r && r.result ? r.result.value : null;
  } catch (e) { return 'ERR:' + e.message; }
}

let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html?x=' + Date.now() });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}return true;})()");
await sleep(700);

const b1 = await evalJs("typeof window.mochiPerfCheck + '|' + typeof window.mochiPerfCheck.start");
ok(b1 === 'object|function', 'B1 桌面产物挂出 mochiPerfCheck.start', String(b1));

// 桌面上跑 3.6s 实测：挂 1px 常驻动画保证持续出帧，1.2s 时阻塞主线程 80ms 制造一次真掉帧
await evalJs(`(function(){
  var st=document.createElement('style');st.textContent='@keyframes vk770{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';document.head.appendChild(st);
  var d=document.createElement('div');d.style.cssText='position:fixed;top:0;left:0;width:2px;height:2px;opacity:.01;z-index:99999;animation:vk770 1s linear infinite;';document.body.appendChild(d);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<80){}},1200);
  window.__perfRep=null;
  window.mochiPerfCheck.start(3600).then(function(r){window.__perfRep=r;});
  return true;
})()`);
let ready = null;
for (let i = 0; i < 30; i++) { await sleep(300); ready = await evalJs('!!window.__perfRep'); if (ready === true) break; }
const rep = JSON.parse(await evalJs(`JSON.stringify((function(){var r=window.__perfRep||{};return{frames:r.frames,janky:r.janky,severe:r.severe,worst:r.worst,hid:r.hid,pages:r.pages,pageFrames:r.pageFrames,jankMs:r.jankMs,period:r.period,fps:r.fps,verdict:r.verdict,jankPct:r.jankPct,text:r.text||''};})())`));

ok(rep.frames > 100, 'B2 检测窗内持续采到帧（frames=' + rep.frames + '）');
ok(rep.janky >= 1, 'B3 人为 80ms 阻塞被捕获为掉帧（janky=' + rep.janky + ' worst=' + rep.worst + 'ms）');
ok(rep.worst >= 60, 'B4 最慢帧 ≥60ms（worst=' + rep.worst + '）');
const pageKeys = Object.keys(rep.pages || {});
ok(pageKeys.length > 0 && pageKeys.every((k) => k === 'main'), 'B5 桌面上的掉帧归因为 main 而非桌面图标名（旧码永远报不出 main＝本条 RED 有牙）', 'pages=' + JSON.stringify(rep.pages));
ok(rep.pageFrames && rep.pageFrames.main > 0, 'B6 按页采样帧数入账（pageFrames.main=' + (rep.pageFrames && rep.pageFrames.main) + '）');
ok(rep.jankMs >= 24 && rep.jankMs <= 34, 'B7 自适应阈值落在 [24,34]ms（jankMs=' + rep.jankMs + ' period=' + rep.period + '）');
ok(rep.period >= 4 && rep.period <= 100, 'B8 实测刷新周期合理（period=' + rep.period + 'ms）');
ok(/平均 [\d.]+fps/.test(rep.text) && /正常帧间隔约 \d+(\.\d+)?ms/.test(rep.text), 'B9 报告含平均 fps 与正常帧间隔');
ok(rep.text.indexOf('掉帧 ' + rep.janky + ' 帧') >= 0, 'B10 掉帧统计行在（janky=' + rep.janky + '）');
if (rep.verdict === '流畅' && rep.janky > 0) {
  ok(rep.text.includes('可忽略') && !rep.text.includes('（本窗口未捕获掉帧）'), 'B11 判「流畅」但确有掉帧 → 结论说真话不再自称未捕获', rep.text.split('\n')[0]);
  ok(rep.text.includes('属正常波动，无需处理'), 'B12 零星掉帧给「无需处理」建议而非引导排查');
} else {
  ok(true, 'B11 本轮判级=' + rep.verdict + '（非「流畅+零星掉帧」组合，文案断言跳过）');
  ok(true, 'B12 跳过');
}
ok(rep.text.includes('采样期间主要在：手机桌面'), 'B13 报告含采样页面分布', rep.text.split('\n')[2] || '');
if (rep.janky < 3) ok(!rep.text.includes('掉帧集中：'), 'B14 少于 3 帧掉帧不输出「掉帧集中」页（janky=' + rep.janky + '）');
else ok(rep.text.includes('掉帧集中：手机桌面'), 'B14 ≥3 帧掉帧输出「掉帧集中」且归因 main（janky=' + rep.janky + '）');

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
