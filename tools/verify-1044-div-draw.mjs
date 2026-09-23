// ===== 回归脚本：#1044 占卜「抽一张牌退出页面」三件套 =====
// 用法：node build.mjs && node tools/verify-1044-div-draw.mjs
// 背景：红米 K70/Via 实报「更多功能→占卜，抽一张牌就退出页面」（用户点名其他机型也有），
//   无头全链复现不出＝真机现场专属。本批三处改动（零机型分支）：
//   ①牌堆增量移除——pick 只摘被抽中的那张（元素身份定位，防增量后索引错位抽错牌），
//     不再每抽一张把剩余牌背全量销毁重建（78 张阵一记点按≈上百节点销毁+重建）；
//   ②占卜历史封顶 500 条（此前无上限，renderHistory 每次全量 innerHTML 重建＝随年限恶化）；
//   ③抽牌流程中 page-divine 被隐藏→console.error 取证（随 device.js 错误环进诊断 docx，
//     LS 写满设备也有 IDB 双写）＝下次真机报障直接点名「当时可见的是哪一页」。
// 本脚本盯：增量移除的结构不变量（存活牌元素身份跨 pick 保持＝没整堆重建）、封顶生效、
//   取证只认「抽牌进行中」、全流程零 window error、1 张/3 张牌阵正常出结果。
// 注意：pick 是同步处理（点完立刻断言）；1 张阵点完 550ms 结果面板替换舞台，结构断言放 3 张阵。
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

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
const cdpPort = 9555 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vd1044-' + Date.now()),
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
  if (r && r.exceptionDetails) { console.error('JS exception:', JSON.stringify(r.exceptionDetails).slice(0, 300)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable', {});
await cdp('Runtime.enable', {});
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });

let pass = 0, fail = 0;
function chk(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
const reopenDivine = `(function(){var pd=document.getElementById('page-divine');document.querySelectorAll('.page').forEach(function(x){x.hidden=true;});pd.hidden=false;return 'ok';})()`;
// 抽牌按钮有「重新抽牌→回待抽」状态机：连点两下保证真正进入抽牌流程
const drawStart = `(function(){var b=document.getElementById('div-draw');if(!b)return 'no-btn';b.click();return 'c1';})()`;

// 等模块就绪（divination.js 外置，等它的入口函数）
let ready = '';
for (let i = 0; i < 80; i++) { ready = await evalJs("typeof window.divineGetTarget"); if (ready === 'function') break; await sleep(400); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&s.parentNode)s.parentNode.removeChild(s);return 1;})()");
await evalJs("(function(){window.__cerr=[];var oe=console.error;console.error=function(){try{window.__cerr.push([].join.call(arguments,' '));}catch(e){}return oe.apply(console,arguments);};})()");
await evalJs("(function(){window.__werr=[];window.addEventListener('error',function(e){window.__werr.push(String(e.message).slice(0,120));});window.addEventListener('unhandledrejection',function(e){window.__werr.push('rej:'+String(e.reason&&e.reason.message||e.reason).slice(0,120));});})()");

chk('P0 divination 模块就绪', ready === 'function', 'typeof divineGetTarget=' + ready);

// 预置 505 条历史（测封顶）
await evalJs("(function(){var big=[];for(var i=0;i<505;i++){big.push({ts:1700000000000+i*1000,mode:'tarot',count:1,question:'q'+i,summary:'s'.repeat(50),cards:[{name:'愚人',icon:'sun',rev:false,meaning:'m'.repeat(40),detail:''}]});}window.activeStore().set('divine-history',JSON.stringify(big));return 'seeded';})()");

// ===== Round A：1 张牌阵（结果面板 + 封顶） =====
await evalJs(reopenDivine);
await sleep(200);
await evalJs("(function(){var b=document.querySelector('#div-counts [data-count=\"1\"]');if(b)b.click();})()");
await evalJs(drawStart); await evalJs(drawStart);
await sleep(2400);
const pile0 = await evalJs("document.querySelectorAll('.div-pile-card').length");
chk('P1 牌堆 78 张（塔罗）', pile0 === 78, 'pile=' + pile0);
await evalJs("(function(){var c=document.querySelector('.div-pile-card');if(c)c.click();})()");
await sleep(900);
const result1 = await evalJs("!!document.querySelector('#div-result .div-mini')");
chk('P2 1 张牌阵结果面板渲染', result1 === true);
const histLen = await evalJs("(function(){try{return JSON.parse(window.activeStore().get('divine-history')||'[]').length;}catch(e){return -1;}})()");
chk('P3 历史封顶 500（505+1→500）', histLen === 500, 'len=' + histLen);

// ===== Round B：3 张牌阵（结构断言：增量移除不重建） =====
await evalJs("(function(){var b=document.querySelector('#div-counts [data-count=\"3\"]');if(b)b.click();})()");
await evalJs(drawStart); await evalJs(drawStart);
await sleep(2400);
const pileB0 = await evalJs("document.querySelectorAll('.div-pile-card').length");
chk('P4 重新开阵 78 张', pileB0 === 78, 'pile=' + pileB0);
await evalJs("(function(){var els=document.querySelectorAll('.div-pile-card');els[els.length-1].__vdMark=1;})()");
await evalJs("(function(){var c=document.querySelector('.div-pile-card');if(c)c.click();})()");
const pileB1 = await evalJs("document.querySelectorAll('.div-pile-card').length");
chk('P5 抽一张后 77 张（增量移除、同步生效）', pileB1 === 77, 'pile=' + pileB1);
const markedSurvives = await evalJs("(function(){var els=document.querySelectorAll('.div-pile-card');for(var i=0;i<els.length;i++){if(els[i].__vdMark)return true;}return false;})()");
chk('P6 存活牌元素身份保持（未整堆重建）', markedSurvives === true, 'marked element lost = full rebuild');
const drawnB1 = await evalJs("document.querySelectorAll('.div-drawn-card').length");
chk('P7 已抽翻面卡 1 张', drawnB1 === 1, 'drawn=' + drawnB1);
const hintB = await evalJs("(function(){var h=document.querySelector('.div-pile-hint');return h?h.textContent:'';})()");
chk('P8 提示行剩 77', /剩 77 张/.test(String(hintB)), 'hint=' + String(hintB).slice(0, 40));
// 连抽 2、3 张：身份保持 + 计数
for (let k = 0; k < 2; k++) {
  await evalJs("(function(){var c=document.querySelector('.div-pile-card');if(c)c.click();})()");
}
const pileB3 = await evalJs("document.querySelectorAll('.div-pile-card').length");
const drawnB3 = await evalJs("document.querySelectorAll('.div-drawn-card').length");
chk('P9 三张抽完牌堆 75 张', pileB3 === 75, 'pile=' + pileB3);
chk('P10 翻面卡 3 张', drawnB3 === 3, 'drawn=' + drawnB3);
const markedSurvives2 = await evalJs("(function(){var els=document.querySelectorAll('.div-pile-card');for(var i=0;i<els.length;i++){if(els[i].__vdMark)return true;}return false;})()");
chk('P11 跨多次 pick 身份仍保持', markedSurvives2 === true, 'marked lost mid-flow');
await sleep(900);
const result3 = await evalJs("!!document.querySelector('#div-result .div-mini')");
chk('P12 3 张结果面板渲染', result3 === true);

// ===== 取证：无抽牌进行中隐藏页面→不误记 =====
await evalJs("(function(){document.getElementById('page-divine').hidden=true;})()");
await sleep(200);
const cerrIdle = await evalJs("window.__cerr.filter(function(s){return s.indexOf('[div-draw]')>=0;}).length");
chk('P13 无抽牌进行中不误记', cerrIdle === 0, 'cerr[div-draw]=' + cerrIdle);

// ===== 取证：抽牌进行中隐藏页面→必须记（含可见页名） =====
await evalJs(reopenDivine);
await sleep(150);
await evalJs(drawStart); await evalJs(drawStart); // 第一击可能落「重新抽牌」复位，第二击真正开抽
await sleep(400);
const activeNow = await evalJs("!!window.__divActiveDraw");
await evalJs("(function(){document.getElementById('page-divine').hidden=true;document.getElementById('page-phone').hidden=false;})()");
await sleep(300);
const cerrHit = await evalJs("(function(){var hits=window.__cerr.filter(function(s){return s.indexOf('[div-draw]')>=0;});return hits.length?hits[0]:'';})()");
chk('P14 抽牌中被切走→console.error 取证', String(cerrHit).indexOf('[div-draw]') === 0, 'active=' + activeNow + ' got=' + String(cerrHit).slice(0, 70));
chk('P15 取证带当时可见页名', String(cerrHit).indexOf('page-phone') >= 0, 'got=' + String(cerrHit).slice(0, 90));

const werr = await evalJs("window.__werr");
chk('P16 全程零 window error', Array.isArray(werr) && werr.length === 0, JSON.stringify(werr).slice(0, 120));

console.log('\n结果：通过 ' + pass + ' / 失败 ' + fail);
chrome.kill();
server.close();
process.exit(fail ? 1 : 0);
