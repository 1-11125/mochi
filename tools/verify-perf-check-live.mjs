// verify-perf-check-live.mjs — #770 卡顿自检运行时行为断言（无头 Chrome，测构建产物 index.html）
// 配套源级脚本 verify-perf-check.mjs（A1~A26+）。红米 K80 Chrome 实报复现：
//   ①旧码停在设置页自检，「掉帧集中」归因到桌面图标（该机报「占卜(100%)」）——本脚本在
//     桌面人为制造阻塞，断言掉帧归因为当前页（旧码在桌面也只会报某个图标名）；
//   ②阈值自适应 jankMs 落在 [24,34]；报告含平均 fps/正常帧间隔/采样页面分布；
//   ③判「流畅」但确有掉帧时结论说真话（可忽略），不再自称「未捕获掉帧」。
// —— #934 追加（红米 K80 Chrome 自检 docx：平均 24.2fps 与 16.4ms 自相矛盾；「掉帧集中：
//    朋友圈（该页 0.5% vs 全窗 1%）」把停留最久的页当集中页；后台占比提示恒不触发；最长
//    1630ms 无归因且 >250ms 的亮屏阻塞被当后台剔除）——
//   C1 亮屏下的 420ms 阻塞＝前台冻结：不再计入 hid，单独点名并进最慢帧现场（旧码恒 hid=1 隐身）
//   C2 长任务补归因：最长的三次带「第几秒·哪页」（旧码只有 N 次/最长两个孤数）
//   C3 集中页按「掉帧率」选（旧码按计数＝选中停留最久、掉帧率更低的页）
//   C5 fps/后台占比按「实测时长」（窗口 C 伪造 2.5s 后台：fps 分母＝前台，占比提示按秒触发）
//   C6 各页掉帧率相当 → 如实报「分散」而不是点名某页
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
const READ_REP = `JSON.stringify((function(){var r=window.__perfRep||{};return{frames:r.frames,janky:r.janky,severe:r.severe,worst:r.worst,hid:r.hid,fz:r.fz,fzWorst:r.fzWorst,jankMs:r.jankMs,bgMs:r.bgMs,effMs:r.effMs,ms:r.ms,period:r.period,fps:r.fps,verdict:r.verdict,jankPct:r.jankPct,topPage:r.topPage,topCnt:r.topCnt,pages:r.pages,pageFrames:r.pageFrames,scene:r.scene,lt:r.lt?{ok:r.lt.ok,n:r.lt.n,worst:r.lt.worst,bgN:r.lt.bgN,top:r.lt.top}:null,text:r.text||''};})())`;
async function waitRep(maxMs) {
  for (let i = 0; i < Math.ceil(maxMs / 300); i++) { await sleep(300); if (await evalJs('!!window.__perfRep') === true) return true; }
  return false;
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

// ===== 窗口 A（8s，手机桌面）：B 组原有断言 + C1 前台冻结 + C2 长任务归因 =====
// 挂 1px 常驻动画保证持续出帧；0.6s/1.2s 各阻塞 80ms（长任务+掉帧），1.8s 阻塞 420ms（>BG_GAP＝前台冻结）
// 三次阻塞都排在窗口前 1/4：页面启动期 setTimeout 有 ~1s 延迟，且长任务条目在阻塞结束后才投递给
// 观察器——贴窗尾会被 finish() 的 disconnect 抢掉（实测踩过：条目丢了、掉帧还在）
await evalJs(`(function(){
  var st=document.createElement('style');st.textContent='@keyframes vk770{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}';document.head.appendChild(st);
  var d=document.createElement('div');d.style.cssText='position:fixed;top:0;left:0;width:2px;height:2px;opacity:.01;z-index:99999;animation:vk770 1s linear infinite;';document.body.appendChild(d);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<80){}},600);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<80){}},1200);
  setTimeout(function(){var t=Date.now();while(Date.now()-t<420){}},1800);
  window.__perfRep=null;
  window.mochiPerfCheck.start(8000).then(function(r){window.__perfRep=r;});
  return true;
})()`);
await waitRep(11000);
const rep = JSON.parse(await evalJs(READ_REP));

ok(rep.frames > 100, 'B2 检测窗内持续采到帧（frames=' + rep.frames + '）');
ok(rep.janky >= 1, 'B3 人为阻塞被捕获为掉帧（janky=' + rep.janky + ' worst=' + rep.worst + 'ms）');
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
  ok(!rep.text.includes('属正常波动，无需处理') && /但窗口内有[^—]*前台冻结 1 次/.test(rep.text), 'B12 #934 零星掉帧但窗内有前台冻结/长任务 → 建议不武断「无需处理」并点名', rep.text.split('\n')[0]);
} else {
  ok(true, 'B11 本轮判级=' + rep.verdict + '（非「流畅+零星掉帧」组合，文案断言跳过）');
  ok(true, 'B12 跳过');
}
ok(rep.text.includes('采样期间主要在：手机桌面'), 'B13 报告含采样页面分布', rep.text.split('\n')[2] || '');
if (rep.janky < 3) ok(!rep.text.includes('掉帧集中：'), 'B14 少于 3 帧掉帧不输出「掉帧集中」页（janky=' + rep.janky + '）');
else ok(rep.text.includes('掉帧集中：手机桌面'), 'B14 ≥3 帧掉帧输出「掉帧集中」且归因 main（janky=' + rep.janky + '）', rep.text);

// —— C1：420ms 亮屏阻塞＝前台冻结（旧码按「后台冻结」剔除＝hid=1、报告里隐身）——
ok(rep.hid === 0, 'C1a #934 亮屏下的 >250ms 阻塞不再被当「后台冻结」剔除（hid=' + rep.hid + '；旧码此处恒为 1）');
ok(rep.fz >= 1 && rep.fzWorst >= 400, 'C1b #934 识别为前台冻结并记最长（fz=' + rep.fz + ' fzWorst=' + rep.fzWorst + 'ms）');
ok(rep.text.includes('· 前台冻结'), 'C1c #934 报告单独点名前台冻结');
ok((rep.scene || []).some((s) => s && s.fz === 1) && rep.text.includes('·前台冻结'), 'C1d #934 最慢帧现场带「前台冻结」标记', JSON.stringify(rep.scene));

// —— C2：长任务归因（旧码只有「N 次/最长 Xms」两个孤数）——
ok(!!(rep.lt && rep.lt.ok && rep.lt.n >= 1), 'C2a 长任务照常观测（n=' + (rep.lt && rep.lt.n) + '）');
const lt0 = rep.lt && rep.lt.top && rep.lt.top[0];
ok(!!(lt0 && lt0.ms >= 400 && lt0.pg === 'main'), 'C2b #934 最长长任务带「第几秒/哪页」归因（' + JSON.stringify(lt0) + '）');
ok(/最长的 \d+ 次：第[\d.]+秒 手机桌面 \d+ms/.test(rep.text), 'C2c #934 报告正文含「第X秒 手机桌面」归因', rep.text);

// ===== 窗口 B（6s）：朋友圈期灌 4 次阻塞、手机桌面期灌 5 次 → 按计数选页会错选手机桌面（旧码），
//       按掉帧率选页正确落在朋友圈（C3）=====
await evalJs(`(function(){
  function blk(ms){var t=Date.now();while(Date.now()-t<ms){}}
  function showFeed(on){
    var f=document.getElementById('page-feed'); if(!f) return;
    if(on){ f.removeAttribute('hidden'); f.style.zIndex='9999'; }
    else { f.setAttribute('hidden',''); f.style.zIndex=''; }
  }
  window.__perfRep=null;
  window.mochiPerfCheck.start(6000).then(function(r){window.__perfRep=r;});
  setTimeout(function(){ showFeed(true); }, 700);
  setTimeout(function(){ blk(80); }, 900);
  setTimeout(function(){ blk(80); }, 1150);
  setTimeout(function(){ blk(80); }, 1400);
  setTimeout(function(){ blk(80); }, 1650);
  setTimeout(function(){ showFeed(false); }, 1900);
  setTimeout(function(){ blk(80); }, 2600);
  setTimeout(function(){ blk(80); }, 3200);
  setTimeout(function(){ blk(80); }, 3800);
  setTimeout(function(){ blk(80); }, 4400);
  setTimeout(function(){ blk(80); }, 5000);
  return true;
})()`);
await waitRep(9000);
const repB = JSON.parse(await evalJs(READ_REP));
// curPage() 归因输出的是页面显示名（'page-feed' → pageName → '朋友圈'；手机桌面特例仍为 'main'），
// 所以二级页在报告里的键是中文名——断言按显示名取
const FEED_KEY = '朋友圈';
const pjFeed = (repB.pages && repB.pages[FEED_KEY]) || 0, pjMain = (repB.pages && repB.pages.main) || 0;
const pfFeed = (repB.pageFrames && repB.pageFrames[FEED_KEY]) || 0, pfMain = (repB.pageFrames && repB.pageFrames.main) || 0;
ok(pjMain > pjFeed && pfFeed > 30, 'C3pre 场景成立：桌面掉帧计数更多、朋友圈样本足够（main ' + pjMain + '/' + pfMain + '，朋友圈 ' + pjFeed + '/' + pfFeed + '）');
ok(repB.topPage === FEED_KEY, 'C3a #934 集中页按掉帧率选（topPage=' + repB.topPage + '；旧码按计数会选 main）', JSON.stringify({ pages: repB.pages, pageFrames: repB.pageFrames }));
ok(repB.text.includes('掉帧集中：朋友圈') && !repB.text.includes('掉帧集中：手机桌面'), 'C3b #934 不再把停留最久（计数最多）的页当集中页', repB.text);

// ===== 窗口 C（4.5s）：伪造 0.9s~3.4s 为后台（document.hidden 假 getter + visibilitychange）
//       → fps 分母＝前台 2 秒、后台占比按秒触发（旧码 fps 分母＝整窗、占比提示恒不触发）=====
await evalJs(`(function(){
  window.__perfRep=null;
  window.mochiPerfCheck.start(4500).then(function(r){window.__perfRep=r;});
  setTimeout(function(){
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return true;}});
    document.dispatchEvent(new Event('visibilitychange'));
  }, 900);
  setTimeout(function(){
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  }, 3400);
  return true;
})()`);
await waitRep(8000);
const repC = JSON.parse(await evalJs(READ_REP));
const oldFps = Math.round(repC.frames * 1000 / repC.ms * 10) / 10;
ok(repC.bgMs >= 2200 && repC.bgMs <= 2800, 'C4a #934 后台时长实测入账（bgMs=' + repC.bgMs + ' 期望≈2500）');
ok(Math.abs(repC.effMs - (repC.ms - repC.bgMs)) <= 2, 'C4b #934 前台有效时长＝窗口－后台（effMs=' + repC.effMs + ' ms=' + repC.ms + ' bgMs=' + repC.bgMs + '）');
ok(repC.effMs > 0 && Math.abs(repC.fps - repC.frames * 1000 / repC.effMs) < 1.5, 'C4c #934 fps 按前台时长算（fps=' + repC.fps + '；整窗口径会是 ' + oldFps + '）');
const mC = repC.text.match(/约 ([\d.]+)% 时间在后台\/锁屏/);
ok(!!mC && repC.text.includes('已剔除、不影响判定'), 'C5a #934 后台占比过半按实测时长点名（旧码拿冻结段数与帧数比＝恒不触发）', repC.text);
ok(!!mC && Math.abs(parseFloat(mC[1]) - repC.bgMs / repC.ms * 100) <= 4, 'C5b 点位与 bgMs 口径一致（文案 ' + (mC && mC[1]) + '% vs 实测 ' + (Math.round(repC.bgMs / repC.ms * 1000) / 10) + '%）');
ok(/前台约 \d+ 秒，后台\/锁屏 \d+ 秒已剔除/.test(repC.text), 'C5c 采样行写明前台/后台秒数', repC.text.split('\n')[1] || '');

// ===== 窗口 D（5.6s）：两页掉帧「率」相当（朋友圈 4 次阻塞 / 桌面 8 次，各占各自停留时长的同一比例）
//       → 如实报「分散」而不是点名某页（旧码按计数会输出「掉帧集中：手机桌面」）=====
await evalJs(`(function(){
  function blk(ms){var t=Date.now();while(Date.now()-t<ms){}}
  function showFeed(on){
    var f=document.getElementById('page-feed'); if(!f) return;
    if(on){ f.removeAttribute('hidden'); f.style.zIndex='9999'; }
    else { f.setAttribute('hidden',''); f.style.zIndex=''; }
  }
  window.__perfRep=null;
  window.mochiPerfCheck.start(5600).then(function(r){window.__perfRep=r;});
  setTimeout(function(){ showFeed(true); }, 500);
  setTimeout(function(){ blk(80); }, 700);
  setTimeout(function(){ blk(80); }, 1050);
  setTimeout(function(){ blk(80); }, 1400);
  setTimeout(function(){ blk(80); }, 1750);
  setTimeout(function(){ showFeed(false); }, 2100);
  setTimeout(function(){ blk(80); }, 2500);
  setTimeout(function(){ blk(80); }, 2850);
  setTimeout(function(){ blk(80); }, 3200);
  setTimeout(function(){ blk(80); }, 3550);
  setTimeout(function(){ blk(80); }, 3900);
  setTimeout(function(){ blk(80); }, 4250);
  setTimeout(function(){ blk(80); }, 4600);
  setTimeout(function(){ blk(80); }, 4950);
  return true;
})()`);
await waitRep(9000);
const repD = JSON.parse(await evalJs(READ_REP));
const rjFeed = (repD.pages && repD.pages[FEED_KEY]) || 0, rjMain = (repD.pages && repD.pages.main) || 0;
const rfFeed = (repD.pageFrames && repD.pageFrames[FEED_KEY]) || 0, rfMain = (repD.pageFrames && repD.pageFrames.main) || 0;
ok(rjMain >= 3 && rjFeed >= 3 && rfFeed >= 30 && rfMain >= 30, 'C6pre 场景成立：两页各 ≥3 帧掉帧、样本足够（main ' + rjMain + '/' + rfMain + '，朋友圈 ' + rjFeed + '/' + rfFeed + '）');
ok(repD.text.includes('掉帧分散') && !repD.text.includes('掉帧集中：'), 'C6 #934 各页掉帧率相当 → 如实报「分散」而不是点名某页（旧码会点名计数最多的桌面）', repD.text);

console.log(fail ? ('FAIL ' + pass + '/' + (pass + fail)) : ('ALL PASS ' + pass + '/' + (pass + fail)));
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
