// ===== 常驻回归：#874 进聊天页「跳到历史聊天记录、看不到最新消息」（摩托罗拉 G100 Edge 实报，多机型同现）=====
// 根因（零机型分支，纯时序）：enterChat 走分帧整窗重建（≥80 条）时有一整段「空窗期」——
// body 已被 innerHTML='' 清空、新窗口还在 setTimeout 逐块构建（慢设备 0.5~3s），这期间
// batchRendering 恒真但没有任何监听者据此让路：
//  ① 空窗期收到一个 scroll 事件（清空旧滚动位被钳回 0 必然派发；重进聊天/第二次重建都会），
//     防抖 100ms 后落在 scrollTop=0<150 → loadOlderIncremental() 在构建中途跑：把
//     appendTarget 改指它自己的 frag（body 空＝preNum=0 走 else 分支，frag 整个被丢弃＝
//     上翻的 100 条没画出来但 renderStart 已前移）→ renderWindow 后续 chunk 改直挂 body、
//     finishSwap 又把首批 50 条补挂到列表末尾＝「底部」变成最老的记录且永久钉住＝
//     「跳到历史聊天记录，看不到最新的聊天消息」。时间闸 suppressScrollUntil(+200ms) 在
//     慢设备上必被构建时长击穿，所以只有快设备不犯。
//  ② 空窗期收到 touchstart（进度条期用户不耐烦上滑一下）→ unpinChatAndAnchor 解钉，
//     finishSwap 的贴底被跳过、#706 看门狗/#504 稳定窗全被 pinned=false 关在门外＝
//     换装后停在列表顶部（旧记录），同症状第二条路。
// 修法＝空窗期（batchRendering）隔离这两类事件：scroll 防抖回调直接不作数；
// loadOlder/loadNewer 入口守卫；touchstart/wheel 空窗期不解钉。屏上没有任何列表可滚，
// #162「不打扰用户翻阅」契约针对的是有内容的列表，空窗期不豁免。
// 断言（每场景全新存储；15× CPU 节流把空窗期拉到远超 100ms 防抖＝确定性站在缺陷一侧）：
//  P1 前提：本轮真的发生过「清空且 150ms 后仍空」的分帧空窗（防空转假绿）
//  A1/A2 干扰=空窗期派发 scroll：末帧窗口尾贴最新（lastIdx===maxIdx）且 data-idx 升序无乱序
//  B1/B2 干扰=空窗期派发 touchstart：末帧仍贴底(gap≤8) 且窗口尾贴最新
//  C1 无干扰：正常进页落底落最新（守卫修复没改坏主链路）
//  C2 无干扰：落底后用户手动上翻（解钉）不被拽回底部（#162 契约不回归）
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-chat-entry-load-window.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9780 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-874-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); return; }
          if (m.method === 'Runtime.exceptionThrown') jsExcepts.push((m.params && m.params.exceptionDetails && (m.params.exceptionDetails.exceptionDetails || {}).description || 'err').slice(0, 120));
        };
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
// 15× CPU 节流＝摩托罗拉 G100 这类中低端机的等效慢速：把分帧构建的空窗期拉到远超 100ms 防抖
await cdp('Emulation.setCPUThrottlingRate', { rate: 15 });

let pass = 0, fail = 0;
function check(desc, ok, detail) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}
const N_MSGS = 300; // ≥RENDER_CHUNK_MIN(80)＋跨过 RENDER_MAX(200) 钳位＝重进必走分帧整窗重建
async function openPage() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4000);
  for (let i = 0; i < 80; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
  await sleep(1500);
  await evalJs("(function(){var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){try{s.click();}catch(e){}}return true;})()");
  await sleep(1000);
}
// 每场景全新存储（about:blank 上清＝既有教训：导航走再清，防 IDB 回填上一场景状态），
// 种 300 条纯文本历史（序号内嵌文本＝底部是哪一条可直接断言）。IDB 权威不手播——首进时
// 应用自己落盘；重进距首读的 IDB_RELOAD_MIN_GAP(8s) 时间闸内，loadMsgs 跳过全量重读。
// 顺手关掉联系人主动发消息概率（cs-rp-auto-prob=0），消掉场景里随机长出来的新消息。
async function resetAndSeed() {
  await cdp('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await cdp('Storage.clearDataForOrigin', { origin: baseUrl, storageTypes: 'local_storage,indexeddb' });
  await openPage();
  await evalJs(`(function(){
    const now = Date.now(); const arr = [];
    for (let i = 0; i < ${N_MSGS}; i++) arr.push({ side: i % 2 ? 'in' : 'out', text: '记录' + String(i).padStart(3, '0'), ts: now - (${N_MSGS} - i) * 60000 });
    window.activeStore().set('cs-rp-auto-prob', '0');
    window.activeStore().set('chat-msgs', JSON.stringify(arr));
    return true;
  })()`);
  await sleep(300);
}
async function clickChat() { await evalJs("(function(){var a=document.querySelector('.app[data-app=\"chat\"]');if(a)a.click();return !!a;})()"); }
async function exitChat() { await evalJs("(function(){var b=document.getElementById('chat-back');if(b)b.click();return true;})()"); }
// 干扰探针：MutationObserver 蹲守「body 被清空」那一瞬（＝分帧空窗起点），按 mode 派发等效事件
function installProbe(mode) {
  return `(function(mode){
    const b = document.getElementById('chat-body');
    window.__pw = { clears: 0, empty150: 0, dispatched: 0 };
    new MutationObserver(function(){
      if (b.children.length === 0) {
        window.__pw.clears++;
        if (mode === 'scroll') { b.dispatchEvent(new Event('scroll')); window.__pw.dispatched++; }
        else if (mode === 'touch') { b.dispatchEvent(new Event('touchstart')); window.__pw.dispatched++; }
        setTimeout(function(){ if (b.children.length === 0) window.__pw.empty150++; }, 150);
      }
    }).observe(b, { childList: true });
    return true;
  })(${JSON.stringify(mode)})`;
}
async function probe() { return await evalJs('JSON.stringify(window.__pw||null)'); }
// 末帧观感：data-idx 序列（升序＝无乱序）、窗口尾是否贴最新（lastIdx===maxIdx）、贴底间隙
async function readList() {
  return JSON.parse(await evalJs(`(function(){
    const b = document.getElementById('chat-body');
    const idxs = [];
    for (const el of b.children) { if (el.dataset && el.dataset.idx !== undefined) idxs.push(Number(el.dataset.idx)); }
    let asc = true; for (let i = 1; i < idxs.length; i++) if (idxs[i] <= idxs[i-1]) { asc = false; break; }
    const maxIdx = idxs.length ? Math.max.apply(null, idxs) : -1;
    return JSON.stringify({
      lastIdx: idxs.length ? idxs[idxs.length - 1] : -1,
      firstIdx: idxs.length ? idxs[0] : -1, count: idxs.length, asc, maxIdx,
      gap: Math.round(b.scrollHeight - b.scrollTop - b.clientHeight),
      top: Math.round(b.scrollTop), sh: b.scrollHeight, ch: b.clientHeight
    });
  })()`) || {});
}
// 每场景：全新存储＋种库 → 首进落底 → 退出 → 改昵称作废同窗补丁（重进必走整窗分帧重建）
// → 装探针 → 重进 → 等构建+稳定窗落定 → 读末帧。mode='none' 时 C2 再验用户上翻解钉契约。
async function scenario(mode) {
  await resetAndSeed();
  await clickChat();
  await sleep(7000); // 首进：分帧构建＋权威核对全部落定
  const r1 = await readList();
  await exitChat();
  await sleep(1500);
  await evalJs("(function(){window.activeStore().set('cs-lbl-user','偶' + (Date.now() % 1000));return true;})()"); // #775b 昵称签名作废同窗补丁
  await evalJs(installProbe(mode));
  await clickChat();
  await sleep(9000); // 15× 节流下的构建＋#504 稳定窗
  const pw = await probe();
  const r2 = await readList();
  let c2 = null;
  if (mode === 'none') {
    await evalJs("(function(){var b=document.getElementById('chat-body');b.dispatchEvent(new Event('touchstart'));b.scrollTop=3000;b.dispatchEvent(new Event('scroll'));return true;})()");
    await sleep(2500);
    c2 = await readList();
  }
  return { pw: JSON.parse(pw || 'null'), r1, r2, c2 };
}

// ---- A：空窗期 scroll 干扰（根因①：上翻误触发打断分帧重建）----
{
  const s = await scenario('scroll');
  // 前提证据＝探针确在空窗起点出手：MutationObserver 只在 children.length===0 那一瞬派发（dispatched 计数），
  // 不要求空窗撑满 150ms（#868 后首批换装可能快于 150ms，empty150 仅留作诊断打印）
  check('P1a 前提：清空瞬窗内注入过 scroll 干扰', !!s.pw && s.pw.clears >= 1 && s.pw.dispatched >= 1, JSON.stringify(s.pw));
  check('A1 空窗期 scroll 后，窗口尾贴最新 (lastIdx===maxIdx)', s.r2.lastIdx === s.r2.maxIdx && s.r2.maxIdx >= 0, JSON.stringify(s.r2));
  check('A2 空窗期 scroll 后，data-idx 无乱序（首批没被甩到最后）', s.r2.asc === true, JSON.stringify(s.r2));
}
// ---- B：空窗期 touchstart 干扰（根因②：进度条期一次上滑把贴底永久解掉）----
{
  const s = await scenario('touch');
  check('P1b 前提：清空瞬窗内注入过 touchstart 干扰', !!s.pw && s.pw.clears >= 1 && s.pw.dispatched >= 1, JSON.stringify(s.pw));
  check('B1 空窗期 touchstart 后，末帧仍贴底 (gap≤8)', s.r2.gap !== undefined && s.r2.gap <= 8, JSON.stringify(s.r2));
  check('B2 空窗期 touchstart 后，窗口尾贴最新', s.r2.lastIdx === s.r2.maxIdx && s.r2.maxIdx >= 0, JSON.stringify(s.r2));
}
// ---- C：无干扰主链路 + #162 解钉契约 ----
{
  const s = await scenario('none');
  check('P1c 前提：重进发生过分帧重建（body 清空）', !!s.pw && s.pw.clears >= 1, JSON.stringify(s.pw));
  check('C1 无干扰重进正常落底且窗口尾贴最新（首进也落底）', s.r2.lastIdx === s.r2.maxIdx && s.r2.gap <= 8 && s.r1.lastIdx === s.r1.maxIdx, JSON.stringify({ r1: s.r1, r2: s.r2 }));
  check('C2 落底后用户手动上翻不被拽回（#162 解钉契约）', !!s.c2 && Math.abs(s.c2.top - 3000) <= 120 && s.c2.gap > 100, JSON.stringify(s.c2));
}
check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' | '));

chrome.kill(); server.close();
console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
