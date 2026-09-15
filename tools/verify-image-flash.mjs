// ===== 回归验证：#508 图片「闪一下重新加载」——头像互动点选换头像 / 字卡库表情包页整格重渲 =====
// 症状（红米 K80 Chrome 等多机型）：头像互动里点一张头像换头像，网格图片全部闪一下重新加载；
// 字卡库表情包页同类操作（切分组/删除/导入后重渲）同样整格闪烁。
// 根因（零机型分支）：换头像后库内容没变、唯一变化是高亮，旧路径 renderGrid()/renderMeGrid()
// 整格 innerHTML='' 重建全部 cell＝img 全部新建+懒加载重新赋 src＝已解码图全部重新解码
// （无头节点身份实证：点一次 8/8 个 img 全部被替换）。字卡库 render() 同族：整格重渲丢弃全部
// 已解码 img。修复：①头像侧换头像只同步 .avlib-now 高亮类不重建；②字卡库 render() 清空前按
// 内容指纹（data-cc-sig）收集旧卡 img、建卡时同指纹原位移植＝已解码图零重解码。
// 断言：
//   A1 头像点击换头像后：网格 img 节点全部保留（replaced=0）
//   A2 头像点击换头像后：被点那张获得 avlib-now 高亮且聊天键已更新（功能不回归）
//   B1 字卡库表情包页切分组再切回：img 节点保留（移植复用，replaced 远小于 total）
//   B2 移植后图片仍真实显示（naturalWidth>0 计数不变）
// 用法：node tools/verify-image-flash.mjs（MOCHI_SERVE_ROOT=<目录> 可对临时构建产物红绿对照）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9760 + Math.floor(Math.random() * 50));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-505-' + Date.now()),
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
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(800);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(500);
}
// Node 侧生成 SVG dataURL（浏览器 eval 无 Buffer）；8 张可区分的图
const mkImg = (n) => 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="' + ['#4488cc', '#cc5544', '#55aa66', '#aa7722'][n % 4] + '"/><text x="8" y="40" font-size="28" fill="white">' + n + '</text></svg>').toString('base64');
const IMGS = JSON.stringify(Array.from({ length: 8 }, (_, i) => mkImg(i)));

await openPage();
// 种子：头像池 + 字卡库表情包分组（同 8 张图）；等 2.5s 让 IDB 写落盘（写太快会被启动取回竞态冲掉）
await evalJs('(function(){var lib=' + IMGS + ';window.activeStore().set("avatar-lib",JSON.stringify(lib));var g={text:[],kaomoji:[],emoji:[],sticker:[["测试分组",lib.slice()]],image:[],poke:[],voice:[]};window.activeStore().set("cc-groups",JSON.stringify(g));return true;})()');
await sleep(2500);

// ---- A：头像互动 点第 3 张换头像 ----
await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return true;})()");
await sleep(900);
const avOpen = await evalJs("(function(){window.openAvlib();var g=document.getElementById('avlib-grid');return g?g.querySelectorAll('img').length:-1;})()");
await sleep(800);
await evalJs("(function(){document.querySelectorAll('#avlib-grid img').forEach(function(im,n){im.__pid='av'+n;});return true;})()");
await evalJs("(function(){var im=document.querySelectorAll('#avlib-grid img')[2];if(im)im.click();return true;})()");
await sleep(1800);
const avResRaw = await evalJs(`(function(){
  var imgs=document.querySelectorAll('#avlib-grid img');var kept=0,lost=0,nowIdx=-1;
  imgs.forEach(function(im,n){if(im.__pid)kept++;else lost++;});
  var cells=document.querySelectorAll('#avlib-grid .avlib-cell');
  cells.forEach(function(d,n){if(d.classList.contains('avlib-now'))nowIdx=n;});
  return JSON.stringify({total:imgs.length,kept:kept,replaced:lost,nowIdx:nowIdx,csSet:!!(window.activeStore().get('cs-avatar-partner'))});
})()`);
const avRes = avResRaw ? JSON.parse(avResRaw) : null;
check('A1 换头像后网格 img 全部保留（replaced=0）', avRes && avRes.total === 8 && avRes.replaced === 0, JSON.stringify(avRes));
check('A2 高亮落到被点第 3 张且聊天键已更新', avRes && avRes.nowIdx === 2 && avRes.csSet, JSON.stringify(avRes));
await evalJs("(function(){window.closeAvlib&&window.closeAvlib();return true;})()");

// ---- B：字卡库表情包页 切分组再切回（整格重渲路径）----
// 重种一次防启动取回竞态，等落盘
await evalJs('(function(){var lib=' + IMGS + ';var g={text:[],kaomoji:[],emoji:[],sticker:[["测试分组",lib.slice()]],image:[],poke:[],voice:[]};window.activeStore().set("cc-groups",JSON.stringify(g));return true;})()');
await sleep(1200);
await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return true;})()");
await sleep(900);
const ccOpen = await evalJs("(function(){var tb=document.querySelector('.cc-tab[data-type=\"sticker\"]');if(tb)tb.click();return document.querySelectorAll('#page-custom-cards img').length;})()");
await sleep(900);
await evalJs("(function(){document.querySelectorAll('#page-custom-cards img').forEach(function(im,n){im.__pid='st'+n;});return true;})()");
// 全部 ↔ 测试分组 来回切（触发两次整格 render）
await evalJs("(function(){var chips=document.querySelectorAll('#page-custom-cards .cc-g-chip');if(chips[1])chips[1].click();return true;})()");
await sleep(700);
await evalJs("(function(){var chips=document.querySelectorAll('#page-custom-cards .cc-g-chip');if(chips[0])chips[0].click();return true;})()");
await sleep(700);
const stResRaw = await evalJs(`(function(){
  var imgs=document.querySelectorAll('#page-custom-cards img');var kept=0,lost=0,live=0;
  imgs.forEach(function(im,n){if(im.__pid)kept++;else lost++;if((im.naturalWidth||0)>0)live++;});
  return JSON.stringify({total:imgs.length,kept:kept,replaced:lost,live:live});
})()`);
const stRes = stResRaw ? JSON.parse(stResRaw) : null;
check('B1 表情包页切分组回来 img 节点保留（移植复用）', ccOpen === 8 && stRes && stRes.total === 8 && stRes.kept >= 6, 'open=' + ccOpen + ' ' + JSON.stringify(stRes));
check('B2 复用后图片仍真实显示（naturalWidth>0）', stRes && stRes.live === 8, JSON.stringify(stRes));

chrome.kill(); server.close();
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
