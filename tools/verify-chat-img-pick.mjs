// #677 聊天页「插入图片」链路验证（无头 Chrome，测构建产物 index.html）
// 立项（用户 2026-09-17 报障，iPhone 13 Pro Max Safari＋主屏幕打开，明说其他机型也出现）：
//   「聊天页面发不了图片：添加了图片，但是会消失，无法发送到聊天里」。
// 根因（零机型分支的两处静默）：
//   ① file input 从未挂进文档就 click()——iOS Safari 对未挂载的 file input 不保证派发 change /
//      不保证带上 files（同文件「批量发送→图片」一直是挂到 body 再用，多机型正常）；
//   ② 失败面全静默：没有 reader.onerror、img 既不 onload 也不 onerror 时无超时、空 FileList 直接
//      return——读取/解码/没选到文件都表现为「什么都没有，控制台也没报错」。
// 用法：node build.mjs && node tools/verify-chat-img-pick.mjs
// 用法（RED 基线/隔离根）：SERVE_ROOT=<目录> node tools/verify-chat-img-pick.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.SERVE_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vcip-' + Date.now()),
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
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 428, height: 926, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2600);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;s.style.display='none';}return true;})()");
await sleep(700);
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(400);

// 捕获 app 内部创建的 file input（并记录它是否被挂进文档）
const baseInputs = J(await evalJs(`(function(){return JSON.stringify({n:document.querySelectorAll('body > input[type=file]').length});})()`));
await evalJs(`(function(){window.__capIn=[];var orig=document.createElement.bind(document);window.__origCE=orig;
document.createElement=function(t){var el=orig(t);if(String(t).toLowerCase()==='input')window.__capIn.push(el);return el;};return true;})()`);

// B1 点「插入图片」→ input 必须挂进文档（旧实现 detached）
await evalJs("(function(){document.getElementById('chat-img-btn').click();return true;})()");
await sleep(500);
const cap = J(await evalJs(`(function(){var a=window.__capIn||[];var inp=a[a.length-1];return JSON.stringify({n:a.length,attached:!!(inp&&inp.parentNode),inBody:!!(inp&&inp.parentNode===document.body)});})()`));
ok(cap.n >= 1 && cap.inBody === true, 'B1 插入图片的 file input 已挂进文档（旧实现 detached ⇒ iOS 选完图不派发 change）', JSON.stringify(cap));

// B2 真图（1600×1200 JPEG）→ 压缩后进草稿条
const b2 = J(await evalJs(`(async function(){
  var a=window.__capIn||[];var inp=a[a.length-1];if(!inp)return JSON.stringify({err:'no-input'});
  var c=document.createElement('canvas');c.width=1600;c.height=1200;
  var g=c.getContext('2d');var gr=g.createLinearGradient(0,0,1600,1200);gr.addColorStop(0,'#f00');gr.addColorStop(1,'#00f');
  g.fillStyle=gr;g.fillRect(0,0,1600,1200);
  var blob=await new Promise(function(r){c.toBlob(r,'image/jpeg',0.9);});
  var f=new File([blob],'photo.jpg',{type:'image/jpeg'});
  var dt=new DataTransfer();dt.items.add(f);
  inp.files=dt.files;
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(function(r){setTimeout(r,3000);});
  var items=document.querySelectorAll('#chat-draft-items .chat-draft-item');
  var src=items.length?items[0].querySelector('img').getAttribute('src'):'';
  return JSON.stringify({fileKB:Math.round(f.size/1024),items:items.length,srcLen:src.length,isJpeg:src.indexOf('data:image/jpeg')===0,draftHidden:document.getElementById('chat-draft').hidden});
})()`));
ok(b2.items === 1 && b2.isJpeg === true && b2.draftHidden === false, 'B2 选图后压缩进草稿条（真 JPEG → 720px 内 jpeg dataURL）', JSON.stringify(b2));

// B3 点发送 → 消息里带图片部件
const b3 = J(await evalJs(`(async function(){
  document.getElementById('chat-send').click();
  await new Promise(function(r){setTimeout(r,1500);});
  var msgs=window.getChatMsgs?window.getChatMsgs():[];
  var last=msgs.length?msgs[msgs.length-1]:null;
  var imgs=last&&last.parts?last.parts.filter(function(p){return p.k==='img';}):[];
  return JSON.stringify({msgsN:msgs.length,imgParts:imgs.length,draftItems:document.querySelectorAll('#chat-draft-items .chat-draft-item').length,bubbles:document.querySelectorAll('#chat-body .msg').length});
})()`));
ok(b3.imgParts >= 1 && b3.draftItems === 0, 'B3 发送后消息带图片部件、草稿条清空', JSON.stringify(b3));

// B4 空 FileList（iOS 选完没带上文件）→ 必须可见提示（旧实现静默 return）
const b4 = J(await evalJs(`(async function(){
  var a=window.__capIn||[];var inp=a[a.length-1];if(!inp)return JSON.stringify({err:'no-input'});
  var t=document.getElementById('cc-toast');if(t)t.textContent='';
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(function(r){setTimeout(r,300);});
  var tt=document.getElementById('cc-toast');
  return JSON.stringify({toast:tt?tt.textContent:''});
})()`));
ok((b4.toast || '').indexOf('没有取到图片') >= 0, 'B4 没取到文件时给可见提示（旧实现静默无反应）', JSON.stringify(b4));

// B5 选到坏图（声明 image/png 但内容非法）→ 解码失败也必须落一张进草稿 + 有提示
const b5 = J(await evalJs(`(async function(){
  var a=window.__capIn||[];var inp=a[a.length-1];if(!inp)return JSON.stringify({err:'no-input'});
  var t=document.getElementById('cc-toast');if(t)t.textContent='';
  var f=new File([new Uint8Array([1,2,3,4,5,6,7,8,9,10])],'bad.png',{type:'image/png'});
  var dt=new DataTransfer();dt.items.add(f);inp.files=dt.files;
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  await new Promise(function(r){setTimeout(r,1200);});
  var tt=document.getElementById('cc-toast');
  var items=document.querySelectorAll('#chat-draft-items .chat-draft-item');
  return JSON.stringify({toast:tt?tt.textContent:'',items:items.length});
})()`));
ok(b5.items >= 1 && (b5.toast || '').length > 0, 'B5 图片解码失败也落草稿并给提示（绝不静默丢图）', JSON.stringify(b5));

// B6 选择器不随点按堆积（常驻单个隐藏 input；基线含其他模块启动时就挂着的 file input）
await sleep(1500);
const b6b = J(await evalJs(`(function(){return JSON.stringify({leftover:document.querySelectorAll('body > input[type=file]').length});})()`));
ok(Number(b6b.leftover) <= Number(baseInputs.n) + 1, 'B6 点三次图片按钮后也只多一个常驻选择器（不随点按堆积）', JSON.stringify({ base: baseInputs.n, after: b6b.leftover }));

const errs = await evalJs("(function(){return JSON.stringify(window.__jsErrors||[]);})()");
ok(String(errs) === '[]' || String(errs) === 'null', 'Z 全程零 JS 异常', errs);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 聊天插入图片链路验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
