// ===== 验证脚本：群聊「继续说」按钮（构建后无头 Chrome） =====
// 用法：node build.mjs && node tools/verify-gc-continue.mjs
// 检查项：①#674 顶部三点菜单左侧「让对方继续说」按钮：默认可见（不依赖 cs-trigger-bar 开关）、
//           位置在三点菜单左边、点它收起已打开的三点菜单、点它 → 群聊成员回复（新 in 消息落库）
//         ②开启「底部聊天栏按钮触发」后输入栏继续说按钮显示，点它 → 群聊成员回复
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
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) {
  console.error('找不到 Chrome/Edge，请设置环境变量 CHROME_PATH 指定浏览器路径');
  process.exit(1);
}

const types = { '.html': 'text/html' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9950 + Math.floor(Math.random() * 30));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-gc-cont-' + Date.now()),
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
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { console.error('  eval 异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 200)); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

await cdpConnect();
await cdp('Page.enable');
await cdp('Runtime.enable');

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}

await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide'))s.click();return true;})()");
await sleep(900);
// 开局：进群聊页，并刻意把「底部聊天栏按钮触发」关掉——顶部那枚按钮不归这个开关管。
// 回复速度钉到 1 秒：群聊默认 1~40 秒随机，不钉死的话「点完等回复」的断言会随机超时。
// 注意群聊设置的真实存储键是 xy-home-v2:reply-gc-gc-*（reply-settings 的 gcRead/gcWrite 对
// gc- 前缀的键会再拼一次 'reply-gc-'）——只写 reply-gc-* 读不到，等于没设。
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-group-chat');});try{var st=window.activeStore();st.set('cs-trigger-bar','0');}catch(e){}try{var g=window.xyStore('xy-home-v2');g.set('reply-gc-gc-rs-min','1');g.set('reply-gc-gc-rs-max','1');g.set('reply-gc-rs-min','1');g.set('reply-gc-rs-max','1');}catch(e){}document.dispatchEvent(new Event('continue-say-changed'));return true;})()");
await sleep(400);
const speed = await evalJs("(function(){try{var c=window.groupChatCfg?window.groupChatCfg():{};return JSON.stringify({min:c['gc-rs-min'],max:c['gc-rs-max']});}catch(e){return ''+e;}})()");
let sp = null; try { sp = JSON.parse(speed); } catch (e) {}
check('前提 群聊回复速度已钉到 1~1 秒（否则本脚本会因 1~40 秒随机延迟假红）', sp && sp.max === 1, speed);

const countMsgs = "var msgs=JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs')||'[]');";
const before = await evalJs("(function(){" + countMsgs + "window.__gcErrs=[];window.addEventListener('error',function(ev){window.__gcErrs.push(String(ev.message||ev.error||''));});return msgs.length;})()");
// 诊断：群聊成员、继续说按钮、是否进入群聊页
const diag = await evalJs("(function(){" +
  "var members=[];try{members=(window.getContacts&&window.getContacts())||[];}catch(e){}" +
  "var page=document.getElementById('page-group-chat');" +
  "var typing=document.getElementById('gc-typing');" +
  "return JSON.stringify({contacts:members.length,pageVisible:page?!page.hidden:false,typingHidden:typing?typing.hidden:'na',msgs:JSON.parse(localStorage.getItem('xy-home-v2:group-chat-msgs')||'[]').length});" +
  "})()");

// ---- A 轴（#674）：顶部三点菜单左侧「让对方继续说」按钮 ----
// 先点开三点菜单，再点顶部继续说按钮：既验证按钮位置/可见性，也验证点它会把已打开的菜单收起来
const headState = await evalJs("(function(){" +
  "var h=document.getElementById('gc-head-continue');if(!h)return 'missing';" +
  "var more=document.getElementById('gc-more-btn');var menu=document.getElementById('gc-more-menu');" +
  "if(more)more.click();var opened=menu?menu.hidden===false:null;" +
  "h.click();var closed=menu?menu.hidden===true:null;" +
  "var left=null;try{left=h.getBoundingClientRect().left<more.getBoundingClientRect().left;}catch(e){left='na';}" +
  "return JSON.stringify({display:getComputedStyle(h).display,title:h.title,opened:opened,closed:closed,leftOfMore:left});" +
  "})()");
await sleep(20000);
const afterA = await evalJs("(function(){" + countMsgs + "var n=msgs.slice(" + before + ");return JSON.stringify({count:n.length,inCount:n.filter(function(m){return m.side==='in';}).length});})()");

let hs = null;
try { hs = JSON.parse(headState); } catch (e) {}
check('A1 #674 顶部「让对方继续说」按钮存在且默认可见（cs-trigger-bar 关着也在）',
  hs && hs.display !== 'none' && hs.display !== 'missing' && hs.title === '让对方继续说',
  headState);
check('A2 #674 按钮在三点菜单左侧（用户要求的落位）', hs && hs.leftOfMore === true, hs ? 'leftOfMore=' + hs.leftOfMore : '');
check('A3 点顶部继续说按钮会收起已打开的三点菜单（stopPropagation 后不靠外点关闭）',
  hs && hs.opened === true && hs.closed === true, hs ? 'open=' + hs.opened + ' closed=' + hs.closed : '');
let aA = null; try { aA = JSON.parse(afterA); } catch (e) {}
check('A4 点顶部按钮 → 群聊成员回复（新增 in 消息落库）',
  aA && aA.count > 0 && aA.inCount > 0, afterA);

// ---- B 轴：输入栏「继续说」按钮（原有行为，开关控制显隐） ----
await evalJs("(function(){try{window.activeStore().set('cs-trigger-bar','1');}catch(e){}document.dispatchEvent(new Event('continue-say-changed'));return true;})()");
await sleep(400);
const beforeB = await evalJs("(function(){" + countMsgs + "return msgs.length;})()");
const btn = await evalJs("(function(){var b=document.getElementById('gc-continue-btn');if(!b)return 'missing';var d=getComputedStyle(b).display;b.click();return d;})()");
await sleep(20000);
const afterB = await evalJs("(function(){" + countMsgs + "var n=msgs.slice(" + beforeB + ");return JSON.stringify({count:n.length,inCount:n.filter(function(m){return m.side==='in';}).length});})()");
const errs = await evalJs("JSON.stringify(window.__gcErrs||[])");
check('B1 开启开关后输入栏继续说按钮显示且可点击', btn !== 'missing' && btn !== 'none', 'display=' + btn);
let bB = null; try { bB = JSON.parse(afterB); } catch (e) {}
check('B2 点输入栏继续说按钮 → 群聊成员回复（新增 in 消息落库）', bB && bB.inCount > 0, afterB);
check('C 全程零 JS 异常', errs === '[]', errs);
try { if (ws) ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
try { server.close(); } catch (e) {}

const fails = results.filter((r) => !r.ok).length;
console.log('\n结果：' + (results.length - fails) + '/' + results.length + ' 项通过');
process.exit(fails ? 1 : 0);
