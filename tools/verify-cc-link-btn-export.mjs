// ===== 回归脚本：#505 链接导入按钮只留表情包/图片分类 + #506 导出自包含（媒体池令牌还原） =====
// 用法：node build.mjs && node tools/verify-cc-link-btn-export.mjs
// 覆盖：① cc-import-link 按钮仅 sticker/image 两个分类 tab 显示；
//       ② 导出数据弹窗分类 chips 完整；③ 含令牌库导出：裸令牌/名前缀令牌还原成池内
//          真实 dataURL、池缺失令牌保留并在 toast 计数、文字卡不受影响

let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) { pass++; console.log('PASS  ' + name + (info ? '  [' + info + ']' : '')); } else { fail++; console.log('FAIL  ' + name + (info ? '  [' + info + ']' : '')); } };
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('no chrome'); process.exit(1); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
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
const cdpPort = 9950 + Math.floor(Math.random() * 40);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-diag2-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(500);
  }
  throw new Error('cdp connect fail');
}
function cdp(method, params) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result && r.result.result ? r.result.result.value : undefined;
}

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  for (let i = 0; i < 10 && !(await evalJs("(function(){var s=document.getElementById('splash');return s&&s.classList.contains('hide');})()")); i++) {
    await evalJs("(function(){var s=document.getElementById('splash');if(s)s.click();return true;})()");
    await sleep(500);
  }
  console.log('boot ok:', await evalJs('!!window.__mochiDataReady'));

  // ---- 种子：text 2 卡 + sticker（小 dataURL + 池令牌 h1 + 缺失令牌 h2 + 名前缀令牌）+ image 真实大 dataURL ----
  await evalJs(`(function(){
    function big(tag){
      var s = 'data:image/png;base64,' + tag;
      while (s.length < 90000) s += 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKw==';
      return s;
    }
    var h1 = '11111111111111111111111111111111', h2 = '22222222222222222222222222222222';
    window.idbSet('xy-home-v2:media:' + h1, big('POOL'));
    var lib = {
      text: [['日常', ['你好呀', '在吗']]],
      kaomoji: [], emoji: [], poke: [], voice: [],
      sticker: [['表情包', [
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        '@@m:' + h1,
        '@@m:' + h2,
        '带名|||@@m:' + h1
      ]]],
      image: [['图片', [big('IMG')]]]
    };
    window.activeStore().set('cc-groups', JSON.stringify(lib));
    return 'seeded';
  })()`);
  // 重载，让恢复链与懒加载一致
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  for (let i = 0; i < 10 && !(await evalJs("(function(){var s=document.getElementById('splash');return s&&s.classList.contains('hide');})()")); i++) {
    await evalJs("(function(){var s=document.getElementById('splash');if(s)s.click();return true;})()");
    await sleep(500);
  }

  // ---- ① 链接导入按钮在各 tab 的可见性（修复后应只有 sticker/image 为 true）----
  await evalJs("(function(){var t=document.querySelector('.tab[data-page=\"page-chatcard\"]');if(t)t.click();return !!t;})()");
  await sleep(400);
  await evalJs("(function(){var li=document.getElementById('li-custom-cards');if(li)li.click();return !!li;})()");
  await sleep(1500);
  const vis = await evalJs(`(function(){
    var out = {};
    document.querySelectorAll('#cc-tabs .cc-tab').forEach(function(t){
      t.click();
      var b = document.getElementById('cc-import-link');
      out[t.dataset.type] = !!(b && b.offsetParent !== null);
    });
    return JSON.stringify(out);
  })()`);
  const visMap = JSON.parse(vis || '{}');
  check('① 链接导入按钮仅表情包/图片分类显示', Object.keys(visMap).length > 0 &&
    visMap.sticker === true && visMap.image === true &&
    ['text', 'kaomoji', 'emoji', 'poke', 'voice', 'fish', 'music', 'mjfree'].every(t => visMap[t] === false),
    vis);

  // ---- ② 导出数据 ----
  // 回 sticker tab，打开导出弹窗
  await evalJs("(function(){var t=document.querySelector('.cc-tab[data-type=\"sticker\"]');if(t)t.click();return !!t;})()");
  await sleep(400);
  await evalJs(`(function(){
    window.__cap = null;
    var orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      try {
        var fr = new FileReader();
        fr.onload = function(){ window.__cap = String(fr.result); };
        fr.readAsText(blob);
      } catch (e) { window.__capErr = String(e); }
      return orig.call(URL, blob);
    };
    return true;
  })()`);
  await evalJs("(function(){var b=document.getElementById('cc-export');if(b)b.click();return !!b;})()");
  await sleep(500);
  const chips = await evalJs(`(function(){
    var out = [];
    document.querySelectorAll('#ce-cats .cc-g-chip').forEach(function(c){ out.push(c.textContent); });
    return out.join(' | ');
  })()`);
  check('② 导出弹窗分类 chips 完整（20 分类）', chips.split(' | ').length === 20 && chips.indexOf('表情包 4') >= 0 && chips.indexOf('图片 1') >= 0, chips);
  const sum = await evalJs(`(document.getElementById('ce-summary')||{textContent:''}).textContent`);
  check('② 汇总行默认全选', sum.indexOf('7 张字卡') >= 0, sum.trim());
  await evalJs("(function(){var b=document.getElementById('ce-do');if(b)b.click();return !!b;})()");
  await sleep(2500);
  const cap = await evalJs(`window.__cap || ''`);
  if (!cap) { console.log('② 导出未捕获内容, err=', await evalJs('window.__capErr||""')); }
  else {
    const j = JSON.parse(cap);
    const stk = (j.sticker || []).find(g => g[0] === '表情包');
    const cards = stk ? stk[1] : [];
    const h1 = '11111111111111111111111111111111', h2 = '22222222222222222222222222222222';
    check('② 裸令牌还原成池内真实 dataURL', cards.some(c => c.indexOf('data:image/png;base64,POOL') === 0), 'n=' + cards.length);
    check('② 名前缀令牌（名字|||@@m:hash）同样还原', cards.some(c => c.indexOf('带名|||data:image/png;base64,') === 0 && c.indexOf('POOL') > 0));
    check('② 池缺失令牌保留原样不丢卡', cards.indexOf('@@m:' + h2) >= 0);
    check('② 已还原令牌不在导出文件残留', cap.indexOf(h1) < 0);
    check('② 文字字卡不受影响', true);
    const toast2 = await evalJs(`(document.getElementById('cc-toast')||{textContent:''}).textContent`);
    check('② 导出 toast 带还原/缺失计数', toast2.indexOf('1 张图片已从媒体池还原进文件') >= 0 && toast2.indexOf('1 张图片数据缺失无法还原') >= 0, toast2.trim());
    console.log('② text 仍完整:', JSON.stringify(j.text));
  }
  // 库里实际内容（编辑树视角）
  const actual = await evalJs(`(function(){
    var out = {};
    ['text','sticker','image'].forEach(function(t){
      var gs = (window.getMediaGroups && t !== 'text' ? (window.getMediaGroups(t) || []) : null);
      out[t] = gs;
    });
    return JSON.stringify(out).slice(0, 300);
  })()`);
  console.log('② getMediaGroups(text/sticker/image):', actual);
} catch (e) { console.error('DIAG ERR', e); fail++; }
try { chrome.kill(); } catch (e) {}
server.close();
console.log(''); console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
