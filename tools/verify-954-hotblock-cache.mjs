// ===== 回归脚本：#954 聊天热片会话缓存——第二次进同一桌面零 IDB 等待 =====
// 用法：node tools/verify-954-hotblock-cache.mjs   （MOCHI_ROOT 可指向隔离副本）
// 症状背景：大历史分块桌面每次进聊天/切桌面回来都要真读 blk-idx + 末尾热块（2MB×N）并
//   反序列化，慢设备上「正在加载聊天记录」体感明显；预读链（contact-switched）同样白付。
// 修复：blk-idx 与热块读一次后驻留会话缓存（chatHotCache），loadMsgs 读热片前先查缓存命中
//   直取；写侧（chatBlkWriteFull/chatBlkRewriteTail）写成功同步回填＋死块缓存随写清除；
//   chatBlkPurgePrefix/mochi-restore-done 全量作废；forceIdb（重试/强读）绕过缓存直读。
// 用例：
//   S1~S7 静态锚（缓存读命中×2 / 写回填×2 / 死块清除 / 失效×2）＋哨兵 #954a~i 登记 build.mjs
//   B1 首次进聊天照常读库并加载成功（零回归基线）
//   B2 【判别力核心】切走再切回＋重进聊天：default 桌面的 chat-blk-* 真读 idbGet 次数=0（修复前每次 ≥3：idx+2 热块）
//   B3 切回后内容正确且加载条收敛（缓存命中的内容与库一致）
//   B4 发消息（走写链回填缓存）后再切走切回：新消息仍在屏且 blk 真读仍=0（写后读旧防回归）
//   B5 restore 作废→forceIdb 真读（≥3）→真读回填→再切走切回又归零读（重新变热；防修过头）
//   Z1 零 JS 异常
// RED 基线（纯 HEAD）：S1~S7 红（锚缺失）、B2 红（blk 真读 ≥3）、B4 红（blk 真读 ≥3）、
//   B5 红（第二段 blk 真读 ≥3）；B1/B3/Z1 两侧同绿
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }

let pass = 0, fail = 0;
function A(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? '  ← ' + JSON.stringify(extra).slice(0, 300) : '')); }
}

// ---- 静态断言 ----
console.log('静态断言:');
const cj = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
A('S1 热块读缓存命中', cj.includes('if (!noCache) { const cv = chatHotCacheGet(fk); if (cv !== undefined) return cv; } // #954：热块缓存命中＝零 IDB 等待'));
A('S2 blk-idx 读缓存命中', cj.includes("bidxP = Promise.resolve(ci954); } // #954：索引缓存命中"));
A('S3 全量重分块块写回填', cj.includes('chatHotCacheSet(prefix + \':\' + k, a); // #954w'));
A('S4 尾部重写块写回填', cj.includes('chatHotCacheSet(prefix + \':\' + k, a); // #954t'));
A('S5 清空/导入整前缀作废', cj.includes('chatHotCacheDropPrefix(prefix); // #954'));
A('S6 备份恢复全表作废＋forceIdb 绕过', cj.includes('chatHotCacheDropAll(); // #954') && cj.includes('chatBlkHotLoad(myPrefix, bidxRaw, !!forceIdb)'));
A('S7 死块缓存随写清除', cj.includes('if (!live[k.slice(prefix.length + 1)]) delete chatHotCache[k]; // #954'));
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
A('S8 哨兵 #954a~i 已登记 build.mjs', (bm.match(/#954[a-i] /g) || []).length >= 9);

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9820 + Math.floor(Math.random() * 60);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-v-954-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  throw new Error('无法连接');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) throw new Error('JS 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r && r.result ? r.result.value : null;
}
async function gotoApp() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 100; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
}
// idbGet 计数探针
const PROBE = `(function(){
  window.__idbCalls = [];
  const iv = setInterval(function () {
    if (typeof window.idbGet === 'function' && !window.idbGet.__logged) {
      clearInterval(iv);
      const origGet = window.idbGet;
      const w = function (k, o) { window.__idbCalls.push(String(k)); return origGet.call(window, k, o); };
      w.__logged = true; window.idbGet = w;
    }
  }, 5);
})();`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ---- 第 1 次加载：种 default 桌面＝分块格式大历史（触发冷启动懒读）＋二号小桌面 ----
await gotoApp();
const seeded = await evalJs(`(async () => {
  const G = 'xy-home-v2';
  const pairs = [];
  const mkMsg = (say, i) => ({ role: i % 2 ? 'ta' : 'me', text: say + i + '，一段中等长度的聊天文本内容。'.repeat(260), tm: Date.now() - i * 60e3 });
  const big = []; const PER = 580, NB = 5;
  for (let b = 0; b < NB; b++) { for (let i = 0; i < PER; i++) big.push(mkMsg('大桌面消息', b * PER + i)); }
  const blocks = []; let cur = [], bytes = 0;
  for (const m of big) { cur.push(m); bytes += 96 + m.text.length; if (bytes >= 2 * 1024 * 1024) { blocks.push(cur); cur = []; bytes = 0; } }
  if (cur.length) blocks.push(cur);
  const idx = { v: 1, blocks: blocks.map((b, i) => ({ k: 'chat-blk-' + i, bytes: b.reduce((s, m) => s + 96 + m.text.length, 0), n: b.length })), total: big.length, nextSeq: blocks.length };
  for (let i = 0; i < blocks.length; i++) pairs.push({ k: G + ':default:chat-blk-' + i, v: JSON.stringify(blocks[i]) });
  pairs.push({ k: G + ':default:chat-blk-idx', v: JSON.stringify(idx) });
  pairs.push({ k: G + ':default:chat-meta', v: JSON.stringify({ n: big.length, t: Date.now(), b: idx.blocks.reduce((s, b) => s + b.bytes, 0) }) });
  const small = []; for (let i = 0; i < 100; i++) small.push(mkMsg('二号桌面消息', i));
  const cid2 = window.createContact('验证二号');
  pairs.push({ k: G + ':' + cid2 + ':chat-msgs', v: JSON.stringify(small) });
  pairs.push({ k: G + ':' + cid2 + ':chat-meta', v: JSON.stringify({ n: 100, t: Date.now(), b: small.reduce((s, m) => s + 96 + m.text.length, 0) }) });
  await window.idbSetAll(pairs);
  return { cid2: cid2, blocks: blocks.length, total: big.length };
})()`);
console.log('种子完成: ' + JSON.stringify(seeded));

// ---- 第 2 次加载：冷启动回填稳定（大历史 b>8MB → 冷启动懒读，缓存未热） ----
await gotoApp();
await sleep(4500);

// B1：首次进聊天＝真读（缓存未热），必须加载成功
const first = await evalJs(`(async () => {
  window.__idbCalls.length = 0;
  if (!window.enterChat) return { err: 'enterChat 缺失' };
  window.enterChat();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
    const bar = document.getElementById('chat-loading');
    if (t.indexOf('大桌面消息') >= 0 && (!bar || bar.hidden)) break;
  }
  const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
  const blkReads = window.__idbCalls.filter(k => k.indexOf(':default:chat-blk-') >= 0).length;
  return { up: !document.getElementById('page-chat').hidden, hasMsgs: t.indexOf('大桌面消息') >= 0, blkReads: blkReads };
})()`);
console.log('行为断言:');
A('B1 首次进聊天真读且加载成功（零回归基线）', first && first.up === true && first.hasMsgs === true && first.blkReads >= 3, first);

// B2/B3：切二号桌面再切回＋重进聊天 → default 桌面 blk 真读必须=0（缓存命中）
const back = await evalJs(`(async () => {
  window.setActiveContact(${JSON.stringify(seeded.cid2)});
  await new Promise(r => setTimeout(r, 1500));
  window.__idbCalls.length = 0;
  window.setActiveContact('default');
  await new Promise(r => setTimeout(r, 800));
  window.enterChat();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
    const bar = document.getElementById('chat-loading');
    if (t.indexOf('大桌面消息') >= 0 && (!bar || bar.hidden)) break;
  }
  const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
  const blkReads = window.__idbCalls.filter(k => k.indexOf(':default:chat-blk-') >= 0).length;
  const bar = document.getElementById('chat-loading');
  return { up: !document.getElementById('page-chat').hidden, hasMsgs: t.indexOf('大桌面消息') >= 0, blkReads: blkReads, barGone: !bar || bar.hidden };
})()`);
A('B2 【判别力核心】切走再切回重进聊天：blk-idx/热块真读 idbGet=0（修复前每次 ≥3）', back && back.blkReads === 0, back);
A('B3 切回后内容正确且加载条收敛（缓存命中内容与库一致）', back && back.up === true && back.hasMsgs === true && back.barGone === true, back);

// B4：发消息（写链回填缓存）→ 再切走切回 → 新消息仍在且 blk 真读仍=0
const sent = await evalJs(`(async () => {
  const inp = document.getElementById('chat-input');
  if (!inp) return { err: '输入框缺失' };
  inp.textContent = '缓存写回验证954';
  try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  const btn = document.getElementById('chat-send');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 5000));
  window.setActiveContact(${JSON.stringify(seeded.cid2)});
  await new Promise(r => setTimeout(r, 1200));
  window.__idbCalls.length = 0;
  window.setActiveContact('default');
  await new Promise(r => setTimeout(r, 800));
  window.enterChat();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
    const bar = document.getElementById('chat-loading');
    if (t.indexOf('缓存写回验证954') >= 0 && (!bar || bar.hidden)) break;
  }
  const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
  const blkReads = window.__idbCalls.filter(k => k.indexOf(':default:chat-blk-') >= 0).length;
  return { hasNew: t.indexOf('缓存写回验证954') >= 0, hasOld: t.indexOf('大桌面消息') >= 0, blkReads: blkReads };
})()`);
A('B4 发消息后切走切回：新消息在屏（写回填正确）且 blk 真读仍=0', sent && sent.hasNew === true && sent.hasOld === true && sent.blkReads === 0, sent);

// B5：派发 mochi-restore-done（全表作废）→ restore 链 loadMsgs(true) forceIdb 绕过缓存
//   必须真读（blk 读 ≥3）；真读成功回填后，再切走切回重进 → blk 真读又归零（缓存重新变热）。
//   （注：不在屏上断言底层直改的块内容——直改 IDB 绕过账本属非常规场景，与合并守卫语义纠缠，
//   HEAD 上同样不上屏，与缓存无关；本批只验证「作废→真读→重新变热」的缓存属性。）
const forced = await evalJs(`(async () => {
  document.dispatchEvent(new Event('mochi-restore-done'));
  await new Promise(r => setTimeout(r, 1500));
  window.enterChat();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const bar = document.getElementById('chat-loading');
    const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
    if (t.indexOf('大桌面消息') >= 0 && (!bar || bar.hidden)) break;
  }
  await new Promise(r => setTimeout(r, 1500));
  const blkReads1 = window.__idbCalls.filter(k => k.indexOf(':default:chat-blk-') >= 0).length;
  window.__idbCalls.length = 0;
  window.setActiveContact(${JSON.stringify(seeded.cid2)});
  await new Promise(r => setTimeout(r, 1200));
  window.setActiveContact('default');
  await new Promise(r => setTimeout(r, 800));
  window.enterChat();
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const bar = document.getElementById('chat-loading');
    const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
    if (t.indexOf('大桌面消息') >= 0 && (!bar || bar.hidden)) break;
  }
  // 只在「加载条收敛且内容上屏」那一刻取读数＝用户体感的加载完成点；
  // 其后后台冷块水合（设计上不缓存、不在等待路径）不计入。
  const bar2 = document.getElementById('chat-loading');
  const t2 = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
  const loaded2 = t2.indexOf('大桌面消息') >= 0 && (!bar2 || bar2.hidden);
  const blkReads2 = loaded2 ? window.__idbCalls.filter(k => k.indexOf(':default:chat-blk-') >= 0).length : -1;
  const t = (document.getElementById('chat-body') || { textContent: '' }).textContent || '';
  return { blkReads1: blkReads1, blkReads2: blkReads2, stillOk: t.indexOf('大桌面消息') >= 0 };
})()`);
A('B5 restore 作废→forceIdb 真读（≥3）→真读回填→再进入又归零读（重新变热；防「缓存吞强读/作废失效」修过头）', forced && forced.blkReads1 >= 3 && forced.blkReads2 === 0 && forced.stillOk === true, forced);

// Z1：零 JS 异常
const errs = await evalJs(`(window.__jsErrors || []).slice(0, 5)`);
A('Z1 零 JS 异常', !errs || errs.length === 0, errs);

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
chrome.kill(); server.close();
process.exit(fail ? 1 : 0);
