// ===== 常驻回归 #985：礼物卡的【领取】与【追加回复】（用户 2026-09-21 直派）=====
// 需求（用户原话，分两段）：
//   ①「当我联系人礼物，然后联系触发了追加回复。这个回复没有加到联系人领取礼物的卡片里，
//      也没有加到心意柜的卡片里。」
//   ②「需要新增联系人送我礼物时的礼物卡片，我可以点击领取，同样也可以点击这个卡片追加回复，
//      这条回复可以在我领取卡片里和发送到聊天消息里。同样可以添加到心意柜的卡片里。」
//   ③（追问追加）「我的追加回复没有保留原本这礼物文案，应该是原本礼物的文案就显示，然后我可以
//      自己选择删除或者保留。直接追加回复。聊天里是只显示追加回复，卡片里是显示礼物原本文案和
//      追加回复。」
// 设计定案（用户在两问里选定）：领取＝「数据不丢＋状态仪式」（礼物立刻进心意柜，点了才转
// 「已领取」，没点标待领取）；回复＝点卡片弹输入框自己写，输入框预填礼物原本文案可删可留。
// 断言组：
//   S  源码口径（心意柜字段/互指、聊天卡动作区、预填与切分、迁移口径、样式）
//   B1 联系人送我礼物 → 卡片出【领取】+【回复】、记录 giftClaimed:0 + giftBoxId、心意柜 claimed:0
//   B2 点【领取】→ 卡片就地转「✓ 已领取」、记录/心意柜同步 1、聊天留痕「你收下了 …」
//   B3 点【回复】→ 输入框**预填原本文案**；留着原文往后接一句 ⇒ 聊天只发新加那句、卡片原文与
//      回复并存；删掉原文直接写 ⇒ 整段算我的回复
//   B4 心意柜页面：卡片上能看到回复；未领取的那件带「待领取」
//   B5 我送礼 → TA 回话同时贴到「我送出」那张卡与心意柜那件（原缺口）
//   B6 迁移口径：存量记录（无 giftClaimed/giftBoxId、柜子无 claimed）不出【领取】也不标待领取
//   B7 反向守卫：TA 自己买的礼物卡（giftSelf）不出【领取】/【回复】；重载后卡片状态与回复仍在
//   Z1 全程零未捕获 JS 异常
// 红基线（纯 HEAD 副本）预期：S 层大半红、B1/B2/B3/B4/B5 红（功能整体不存在），B6/B7 绿。
// 用法：node tools/verify-985-gift-claim-reply.mjs            （自组装 src，不依赖构建产物）
//       MOCHI_ROOT=<仓外副本> node tools/verify-985-gift-claim-reply.mjs   （红/绿对照必传）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 容错取值：红侧读不到东西时返回 null，断言自己会红，脚本绝不中断
const J = (v) => { try { return JSON.parse(v); } catch (e) { return null; } };

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? ' \u2014 ' + extra : '')); }
};

// ---------------- S 层：源码断言 ----------------
console.log('S 层：源码口径');
{
  const gs = readFileSync(join(root, 'src/js/gift-shop.js'), 'utf8');
  const cj = readFileSync(join(root, 'src/js/chat.js'), 'utf8');
  const mc = readFileSync(join(root, 'src/css/market.css'), 'utf8');
  // 心意柜侧
  ok(/side: side, tm: Date\.now\(\), replies: \[\] \}/.test(gs), 'S1 心意柜记录带 replies 字段（这件礼物上的回复）');
  ok(/if \(side === 'in'\) e\.claimed = 0;/.test(gs), 'S2 仅真礼物（side:in）带 claimed:0＝待领取');
  ok(/const entry = boxEntry\(gift, side, wish\);[\s\S]{0,120}return entry;/.test(gs), 'S3 recordBox 把记录回给调用方（卡片与柜子互指的凭据）');
  ok(/if \(entry && entry\.id\) rec\.giftBoxId = entry\.id;/.test(gs), 'S4 buyAndSend 把心意柜记录 id 写进聊天卡');
  ok(/window\.giftGiftMeta = function \(boxId\) \{/.test(gs), 'S5 聊天卡片的领取态/回复从心意柜记录读（giftGiftMeta＝单一事实源）');
  ok(/function boxMetaMap\(\) \{[\s\S]{0,320}claimed: it\.claimed === 0 \? 0 : \(it\.claimed === 1 \? 1 : null\)/.test(gs),
    'S5b 记忆化映射只认显式 claimed 0/1（存量记录判 null＝按已领取渲染）');
  ok(/function boxMetaInvalidate\(\) \{ _boxMeta = null; \}/.test(gs) && (gs.match(/boxMetaInvalidate\(\);/g) || []).length >= 4,
    'S5c 所有写入路径都失效记忆（新增/领取/回复后卡片立刻拿到新数据）');
  ok(/const entryAt = recordBoxAt\(cid, gift, 'in', wish\);[\s\S]{0,120}rec\.giftBoxId = entryAt\.id;/.test(gs),
    'S6 跨桌面投递（deliverInGift 另一半）同样互指');
  ok(/window\.chatGiftAttachReplyTo\(cid, chatRec\.ts, 'ta', txt, chatRec\)/.test(gs), 'S7 TA 收礼回话贴到「我送出」那张卡');
  ok(/if \(boxId\) boxAttachReply\(cid, boxId, 'ta', txt\)/.test(gs), 'S8 TA 收礼回话同时写进心意柜那件礼物');
  ok(/function boxAttachReply\(cid, boxId, who, text\)/.test(gs) && /window\.giftBoxAttachReply = function/.test(gs),
    'S9 心意柜侧回复写入接口（跨桌面按 cid + boxId 定位）');
  ok(/function boxPending\(it\) \{ return !!\(it && it\.side === 'in' && it\.claimed === 0\); \}/.test(gs),
    'S10 迁移口径：只认显式 claimed===0 才是待领取（存量记录不翻成待领取）');
  ok(/boxReplies\(it\)\.length \? '<div class="giftbox-repls">' \+ boxReplyRows\(it\)/.test(gs), 'S11 心意柜列表卡渲染回复');
  ok(/gb-detail-repl-title/.test(gs) && /gb-detail-repls/.test(gs), 'S12 心意柜详情卡渲染回复');
  // 聊天侧
  ok(/function giftIsIncoming\(rec\) \{ return !!\(rec && rec\.side === 'in' && !rec\.giftSelf && rec\.giftBoxId\); \}/.test(cj),
    'S13 动作区只对「真·联系人送我的礼物」且必须有心意柜指针（TA 自买卡/存量卡不响应）');
  ok(/const meta = giftMetaOf\(rec\) \|\| \{\};[\s\S]{0,120}meta\.claimed === 0[\s\S]{0,160}msg-gift-claim/.test(cj),
    'S14 待领取（心意柜 claimed:0）才出【领取】按钮');
  ok(/function giftMetaOf\(rec\) \{[\s\S]{0,300}window\.giftGiftMeta\(rec\.giftBoxId\)/.test(cj),
    'S14b 卡片状态全部经 giftMetaOf 读心意柜（聊天记录里不再存领取态/回复副本）');
  ok(!/giftReplies/.test(cj), 'S14c 聊天记录不再写 giftReplies（改已有记录字段的表达不出增量，会被基线合并盖回去）');
  ok(/'<button class="msg-gift-reply" type="button">回复<\/button>'/.test(cj), 'S15 卡片上有【回复】按钮');
  ok(/giftCardReplHtml\(rec\) \+\s*giftCardActsHtml\(rec\) \+/.test(cj), 'S16 渲染分支同时挂回复区与动作区');
  ok(/function giftPatchCard\(idx\)/.test(cj), 'S17 领取/回复就地打补丁（不整窗重建）');
  ok(/const orig = String\(rec\.giftWish \|\| ''\)\.trim\(\);/.test(cj), 'S18 回复输入框预填礼物原本文案');
  ok(/const added = \(orig && full\.indexOf\(orig\) === 0\) \? full\.slice\(orig\.length\)\.trim\(\) : full;/.test(cj),
    'S19 原文留在开头 ⇒ 只把新加的那段当回复；删掉/改写 ⇒ 整段算回复');
  ok(/addOut\(added\);\s*\/\/ ① 只把新增的这句发进聊天消息/.test(cj), 'S20 聊天里只发新增的那句（原文不重复进聊天）');
  ok(/giftWhoLabel\(r\.who\)/.test(cj) && /mg-repl-tx/.test(cj), 'S21 卡片上回复行按 who 标「我/联系人」');
  ok(/window\.chatGiftAttachReplyTo = function/.test(cj) && /window\.giftBoxAttachReply\(rec\.giftBoxId, whoNorm, text, cid\)/.test(cj),
    'S22 暴露给 gift-shop 的贴卡接口（TA 回话也写心意柜；跨桌面走 chatDeskCardReply 认指针）');
  // 样式
  ok(/\.msg-gift-acts \{/.test(mc) && /\.msg-gift-claim \{/.test(mc) && /\.msg-gift-reply \{/.test(mc), 'S23 卡片动作区样式在位');
  ok(/\.msg-gift-repl \{/.test(mc) && /\.mg-repl-tx \{/.test(mc), 'S24 卡片回复行样式在位');
  ok(/\.giftbox-repl-tx \{/.test(mc) && /\.giftbox-pending \{/.test(mc), 'S25 心意柜回复/待领取样式在位');
  ok(/\[data-theme="dark"\] \.msg-gift-reply \{/.test(mc) && /\[data-theme="dark"\] \.giftbox-repl-tx \{/.test(mc),
    'S26 深色适配在位（回复行提亮、待领取暗底浅红）');
}

// ---------------- B 层：无头 Chrome 行为 ----------------
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
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arrOf = (k) => (bm.match(new RegExp(k + '\\s*=\\s*\\[([\\s\\S]*?)\\]')) || [])[1]
  .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
const cssFiles = arrOf('cssFiles'), jsFiles = arrOf('jsFiles');
let html = readFileSync(join(root, 'src', 'template.html'), 'utf8');
html = html.replace('/*__STYLES__*/', () => cssFiles.map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n'));
html = html.replace('/*__SCRIPTS__*/', () => jsFiles.map((f) => {
  let code = '';
  try { code = readFileSync(join(root, 'src', 'js', f), 'utf8'); } catch (e) {}
  return '(function(){try{\n' + code + '\n}catch(__e){if(window.__jsErrors)window.__jsErrors.push("' + f + ':"+(__e&&__e.message||__e));}})();';
}).join('\n'));

const site = join(tmpdir(), 'mochi-g985-' + Date.now());
const profDir = join(tmpdir(), 'mochi-g985-prof-' + Date.now());
mkdirSync(site, { recursive: true });
writeFileSync(join(site, 'index.html'), html);
const server = createServer((req, res) => {
  try {
    const p = normalize(join(site, decodeURIComponent(req.url.split('?')[0])));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(readFileSync(p));
  } catch (e) { try { res.writeHead(404); res.end('nf'); } catch (e2) {} }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9550 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

let ws = null, msgId = 0; const pend = new Map();
let booted = false;
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); booted = true; break; }
  } catch (e) {}
  await sleep(150);
}
if (!booted) { console.error('无法连接无头 Chrome'); try { chrome.kill(); } catch (e) {} server.close(); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return '__ERR__' + JSON.stringify(r.exceptionDetails).slice(0, 300);
  return r && r.result ? r.result.value : null;
}
const goto = async () => {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 80; i++) { if ((await evalJs('!!window.__mochiDataReady')) === true) return true; await sleep(250); }
  return false;
};
const finish = () => {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {}
  try { rmSync(site, { recursive: true, force: true }); } catch (e) {}
};

await cdp('Page.enable');
await cdp('Runtime.enable');
await evalJs('window.__jsErrors=[]');
if (!(await goto())) { console.error('应用未就绪'); finish(); process.exit(1); }
await sleep(1000);

// 只留「① 心愿单兑现（TA 买下我的心愿送我）」这条可掷中的路径，其余自动行为概率归 0
const BASE = { wlVer: 2, wlOn: 1, giftInOn: 1, wlBuyPct: 100, wlAddPct: 0, giftInPct: 0, selfOn: 0, selfPct: 0, wishChatOn: 0, wishChatPct: 0, giftReplyOn: 0, giftReplyPct: 0, giftReplyMode: 0 };
const setSettings = (extra) => evalJs(`(function(){ window.xyStore('xy-home-v2').set('market-wl-settings', ${JSON.stringify(JSON.stringify(Object.assign({}, BASE, extra || {})))}); return 1; })()`);
const MY_WISH = [{ giftId: 'g_v985a', name: '验证蜡烛', emoji: '\uD83D\uDD6F\uFE0F', img: '', price: 88, cat: 'gcare', wish: '给你暖暖的', tm: Date.now() }];
// 心愿单必须写进**当前桌面命名空间**（gift-shop 的 wishSave/wishLoad 走 store()=activeStore()；
// 写入根键只在命名空间还没有该键时被回退读到，一旦产品自己写过一次就再也看不见——踩过）
const setMyWish = (list) => evalJs(`(function(){ window.activeStore().set('gift-wishlist', ${JSON.stringify(JSON.stringify(list))}); return 1; })()`);
// 聊天落盘是防抖写：领取/回复后的「记录态」要轮询等落库，DOM 侧是同步的就地补丁（立即断言）
const waitFor = async (fn, ms) => {
  const t0 = Date.now();
  let v = await fn();
  while (!v && Date.now() - t0 < (ms || 6000)) { await sleep(250); v = await fn(); }
  return v;
};
const waitGifts = (n) => waitFor(async () => (J(await chatState()).gifts >= n), 8000);
const waitClaimedBox = () => waitFor(async () => (J(await boxState()).filter((x) => x.side === 'in').some((x) => x.claimed === 1)), 6000);

const waitInBox = (n) => waitFor(async () => (J(await boxState()).filter((x) => x.side === 'in').length >= n), 8000);
// 回复条数（心意柜侧，同步写＝可靠）
const waitBoxReplies = (side, n) => waitFor(async () => {
  const list = J(await boxState()).filter((x) => x.side === side);
  return list.length > 0 && Array.isArray(list[0].replies) && list[0].replies.length >= n;
}, 6000);
// 我发出的聊天消息：走聊天追加通道＋快照写入有延迟 → 轮询等到它出现在存储里
const waitOutText = (txt) => waitFor(async () => (J(await chatState()).outTexts || []).some((t) => String(t).indexOf(txt) >= 0), 6000);
const openChat = () => evalJs("(function(){ document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');}); var a=document.querySelector('.app[data-app=chat]'); if(a)a.click(); return 1; })()");
const openBoxPage = () => evalJs("(function(){ var a=document.querySelector('.app[data-app=giftbox]'); if(!a) return 0; a.click(); return 1; })()");
// 落库事实（不读 DOM）：聊天记录里的礼物卡与心意柜记录
const chatState = () => evalJs(`(function(){
  var s = window.storeFor('default');
  var msgs = []; try { msgs = JSON.parse(s.get('chat-msgs')||'[]'); } catch(e){}
  var gifts = msgs.filter(function(m){ return m && m.special === 'gift'; });
  var last = gifts.length ? gifts[gifts.length-1] : null;
  return JSON.stringify({
    gifts: gifts.length,
    lastSide: last ? last.side : '',
    lastSelf: last ? !!last.giftSelf : null,
    lastClaimed: last ? (last.giftClaimed === undefined ? null : last.giftClaimed) : null,
    lastBoxId: last ? (last.giftBoxId || '') : '',
    lastReplies: last && Array.isArray(last.giftReplies) ? last.giftReplies : [],
    outTexts: msgs.filter(function(m){ return m && m.side === 'out' && !m.special && String(m.text||'').trim(); }).map(function(m){ return String(m.text); }),
    pokes: msgs.filter(function(m){ return m && m.special === 'poke'; }).map(function(m){ return String(m.text||''); })
  });
})()`);
const boxState = () => evalJs(`(function(){
  var s = window.storeFor('default');
  var box = []; try { box = JSON.parse(s.get('giftbox-items')||'[]'); } catch(e){}
  return JSON.stringify(box.map(function(b){ return { id: b.id, side: b.side, name: b.name, wish: b.wish || '', claimed: (b.claimed === undefined ? null : b.claimed), replies: Array.isArray(b.replies) ? b.replies : [] }; }));
})()`);
// 屏上这张礼物卡（最后一张 / 按名字取）
const cardDom = (name) => evalJs(`(function(){
  var els = document.querySelectorAll('#chat-body .msg-gift');
  var el = null;
  if (${JSON.stringify(name || '')}) {
    for (var i=0;i<els.length;i++){ var n=els[i].querySelector('.msg-gift-name'); if (n && n.textContent === ${JSON.stringify(name || '')}) { el = els[i]; break; } }
  } else el = els.length ? els[els.length-1] : null;
  if (!el) return JSON.stringify({ found: false });
  var repl = el.querySelector('.msg-gift-repl');
  return JSON.stringify({
    found: true,
    hasClaim: !!el.querySelector('.msg-gift-claim'),
    hasReplyBtn: !!el.querySelector('.msg-gift-reply'),
    got: el.querySelector('.msg-gift-got') ? String(el.querySelector('.msg-gift-got').textContent) : '',
    wish: el.querySelector('.msg-gift-wish') ? String(el.querySelector('.msg-gift-wish').textContent) : '',
    replHidden: repl ? !!repl.hidden : null,
    replText: repl ? String(repl.textContent) : ''
  });
})()`);
const boxDom = () => evalJs(`(function(){
  var cards = document.querySelectorAll('#giftbox-list .giftbox-card');
  var out = [];
  for (var i=0;i<cards.length;i++) {
    var c = cards[i];
    out.push({
      name: (c.querySelector('.giftbox-name')||{}).textContent || '',
      pending: !!c.querySelector('.giftbox-pending'),
      repl: c.querySelector('.giftbox-repls') ? String(c.querySelector('.giftbox-repls').textContent) : ''
    });
  }
  return JSON.stringify(out);
})()`);
const modalState = () => evalJs(`(function(){
  var m = document.getElementById('modal-mask');
  var inp = document.getElementById('modal-input');
  var st = document.getElementById('modal-static');
  return JSON.stringify({ open: !!(m && !m.hidden), hiddenInput: !!(inp && inp.hidden), value: inp ? String(inp.value || '') : '', static: st && !st.hidden ? String(st.textContent || '') : '' });
})()`);
const clickReplyThenType = async (text) => {
  await evalJs("(function(){ var b=document.querySelectorAll('#chat-body .msg-gift-reply'); if(b.length) b[b.length-1].click(); return b.length; })()");
  await sleep(350);
  const st = J(await modalState()) || {};
  await evalJs(`(function(){ var i=document.getElementById('modal-input'); i.value=${JSON.stringify(text)}; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
  await sleep(120);
  await evalJs("(function(){ var b=document.getElementById('modal-ok'); if(b) b.click(); return !!b; })()");
  await sleep(450);
  return st;
};

console.log('B 层：无头行为');
try {

// ---- B1：联系人送我礼物 → 卡片出【领取】+【回复】、记录与心意柜都进「待领取」 ----
await setSettings({});
await setMyWish(MY_WISH);
if (!(await goto())) { console.error('冷启动未就绪'); finish(); process.exit(1); }
await sleep(900);
await openChat();
await sleep(300);
await evalJs('window.maybeAutoGift()');
await waitGifts(1);                                 // deliverInGift 投递窗 1.5~4s
await sleep(300);
{
  const c = J(await chatState());
  const b = J(await boxState());
  const d = J(await cardDom()) || {};
  const inBox = b.filter((x) => x.side === 'in');
  ok(c.gifts === 1 && c.lastSide === 'in', 'B1 联系人送我的礼物卡落进聊天', JSON.stringify({ gifts: c.gifts, side: c.lastSide }));
  ok(!!c.lastBoxId && inBox.some((x) => x.id === c.lastBoxId),
    'B1b 卡片只带心意柜指针（giftBoxId 命中），领取态/回复都不写进聊天记录', c.lastBoxId);
  ok(inBox.length === 1 && inBox[0].claimed === 0, 'B1c 心意柜那件记 claimed:0（待领取）', JSON.stringify(inBox));
  ok(inBox.length === 1 && Array.isArray(inBox[0].replies) && inBox[0].replies.length === 0, 'B1d 新记录带空 replies 数组', JSON.stringify(inBox[0] && inBox[0].replies));
  ok(d.found && d.hasClaim && d.hasReplyBtn, 'B1e 屏上卡片有【领取】与【回复】', JSON.stringify(d));
  ok(String(d.wish).indexOf('给你暖暖的') >= 0, 'B1f 卡片仍显示礼物原本文案', String(d.wish));
}

// ---- B2：点【领取】→ 就地转「已领取」＋心意柜同步＋聊天留痕 ----
{
  await evalJs("(function(){ var b=document.querySelector('#chat-body .msg-gift-claim'); if(b) b.click(); return !!b; })()");
  await sleep(400);
  const dImmediate = J(await cardDom()) || {};
  await waitClaimedBox();                             // 领取代价：等心意柜写入生效（同步小键，几乎即时）
  const c = J(await chatState());
  const b = J(await boxState());
  const d = J(await cardDom()) || {};
  const inBox = b.filter((x) => x.side === 'in');
  ok(dImmediate.hasClaim === false && String(dImmediate.got).indexOf('已领取') >= 0,
    'B2 卡片就地转「✓ 已领取」（不整窗重建、点完立刻生效）', JSON.stringify(dImmediate));
  ok(d.hasClaim === false && String(d.got).indexOf('已领取') >= 0, 'B2a 落库后卡片仍是已领取', JSON.stringify({ got: d.got }));
  ok(c.lastClaimed === null, 'B2b 领取态不写进聊天记录（单一事实源在心意柜；旧字段不回流）', String(c.lastClaimed));
  ok(inBox.length === 1 && inBox[0].claimed === 1, 'B2c 心意柜那件同步 claimed:1', JSON.stringify(inBox));
  await waitFor(async () => J(await chatState()).pokes.some((t) => t.indexOf('你收下了') >= 0), 6000);
  ok(J(await chatState()).pokes.some((t) => t.indexOf('你收下了') >= 0),
    'B2d 聊天留痕「你收下了 …」', JSON.stringify(J(await chatState()).pokes));
}

// ---- B3：点【回复】→ 预填原本文案；保留原文往后接 ↔ 删掉原文直接写 ----
{
  const KEEP = '给你暖暖的 谢谢你呀，我很喜欢';
  const st = await clickReplyThenType(KEEP);
  const dLive = J(await cardDom()) || {};
  await waitBoxReplies('in', 1);
  await waitOutText('谢谢你呀，我很喜欢');           // 我发的这条走聊天追加通道（快照写入有延迟）
  const c = J(await chatState());
  const d = J(await cardDom()) || {};
  const b = J(await boxState());
  const inBox = b.filter((x) => x.side === 'in');
  ok(st.open && !st.hiddenInput, 'B3 点【回复】弹出输入框（不是纯提示弹窗）', JSON.stringify({ open: st.open, hidden: st.hiddenInput }));
  ok(st.value === '给你暖暖的', 'B3b 输入框预填礼物原本的文案（可删可留）', JSON.stringify(st.value));
  ok(dLive.replHidden === false && String(dLive.replText).indexOf('谢谢你呀，我很喜欢') >= 0,
    'B3c 卡片当场出现追加回复（就地补丁，不等落库）', JSON.stringify({ hidden: dLive.replHidden, text: dLive.replText }));
  ok(c.outTexts.indexOf('给你暖暖的 谢谢你呀，我很喜欢') < 0 && c.outTexts.indexOf('谢谢你呀，我很喜欢') >= 0,
    'B3d 聊天只发新加的那句（原文保留在输入框里也不重复发）', JSON.stringify(c.outTexts));
  ok(c.outTexts.indexOf('给你暖暖的') < 0, 'B3e 聊天里没有把礼物原文当消息发出去（用户口径：聊天只显示追加回复）', JSON.stringify(c.outTexts));
  ok(d.replHidden === false && String(d.replText).indexOf('谢谢你呀，我很喜欢') >= 0, 'B3f 落库后卡片上仍是这条追加回复', JSON.stringify({ hidden: d.replHidden, text: d.replText }));
  ok(String(d.wish).indexOf('给你暖暖的') >= 0 && String(d.replText).indexOf('谢谢你呀，我很喜欢') >= 0,
    'B3g 卡片同时显示礼物原本文案与追加回复', JSON.stringify({ wish: d.wish, repl: d.replText }));
  ok(c.lastReplies.length === 0 && inBox.length === 1 && inBox[0].replies.length === 1 && inBox[0].replies[0].who === 'me' && inBox[0].replies[0].text === '谢谢你呀，我很喜欢',
    'B3h 回复只落在心意柜那件（内容＝纯「追加的那句」，原文不重复入记录；聊天记录不带副本）', JSON.stringify({ rec: c.lastReplies, box: inBox[0] && inBox[0].replies }));

  // 删掉原文直接写自己的 ⇒ 整段算我的回复
  const st2 = await clickReplyThenType('换个说法：我很喜欢这件');
  await waitBoxReplies('in', 2);
  await waitOutText('换个说法：我很喜欢这件');
  const c2 = J(await chatState());
  const d2 = J(await cardDom()) || {};
  const b2 = J(await boxState()).filter((x) => x.side === 'in');
  const rs2 = (b2[0] && b2[0].replies) || [];
  ok(st2.value === '给你暖暖的', 'B3i 再次点【回复】仍预填原本文案（可再次选择删或留）', JSON.stringify(st2.value));
  ok(c2.outTexts.indexOf('换个说法：我很喜欢这件') >= 0, 'B3j 删掉原文直接写 ⇒ 整段作为回复发进聊天', JSON.stringify(c2.outTexts));
  ok(rs2.length === 2 && rs2[1].text === '换个说法：我很喜欢这件' && rs2[0].text === '谢谢你呀，我很喜欢',
    'B3k 两条回复都留在心意柜那件上（顺序＝先第一条，后追加的）', JSON.stringify(rs2));
  ok(String(d2.wish).indexOf('给你暖暖的') >= 0 && String(d2.replText).indexOf('谢谢你呀') >= 0 && String(d2.replText).indexOf('换个说法') >= 0,
    'B3l 卡片上原文与两条回复同时在场', JSON.stringify({ wish: d2.wish, repl: d2.replText }));
}

// ---- B4：心意柜页面：卡片上能看到回复；再送一件未领取的 → 标「待领取」 ----
{
  await openBoxPage();
  await sleep(700);
  const dom1 = J(await boxDom()) || [];
  const claimedCard = dom1.find((x) => x.name === '验证蜡烛') || {};
  ok(String(claimedCard.repl || '').indexOf('谢谢你呀，我很喜欢') >= 0, 'B4 心意柜卡片上能看到这件礼物的回复', JSON.stringify(claimedCard));
  ok(claimedCard.pending === false, 'B4b 已领取的那件不再标「待领取」', JSON.stringify(claimedCard));
  // 再投一件（留着不领）
  await setMyWish([Object.assign({}, MY_WISH[0], { giftId: 'g_v985b', name: '验证围巾', emoji: '\uD83E\uDDE3' })]);
  await openChat();
  await sleep(300);
  await evalJs('window.maybeAutoGift()');
  await waitInBox(2);
  await sleep(400);
  await openBoxPage();
  await sleep(700);
  const dom2 = J(await boxDom()) || [];
  const pend = dom2.find((x) => x.name === '验证围巾') || {};
  ok(pend.pending === true, 'B4c 没点领取的那件在心意柜里标「待领取」', JSON.stringify(pend));
  const b2 = J(await boxState()).filter((x) => x.side === 'in');
  ok(b2.length === 2, 'B4d 未领取也照常进心意柜（数据不丢＋状态仪式，不是红包那种硬闸门）', JSON.stringify(b2.map((x) => x.name + ':' + x.claimed)));
}

// ---- B5：我送礼给 TA → TA 的回话贴到「我送出」那张卡与心意柜那件 ----
{
  await setSettings({ giftReplyOn: 1, giftReplyPct: 100, giftReplyMode: 0, wlBuyPct: 0, giftInPct: 0, wlAddPct: 0 });
  await openChat();
  await sleep(400);
  const before = J(await chatState()).gifts;
  await evalJs("(function(){ var m=document.getElementById('tc-mask'); if(m) m.hidden=true; var b=document.getElementById('more-gift'); if(b) b.click(); return !!b; })()");
  await sleep(700);
  await evalJs("(function(){ var b=document.querySelector('#gift-grid .gift-item'); if(b){ b.click(); return 1; } return 0; })()");
  await sleep(600);
  await evalJs("(function(){ var b=document.getElementById('gb-ok'); if(b) b.click(); return !!b; })()");
  await waitFor(async () => {
    const bb = J(await boxState()).filter((x) => x.side === 'out');
    return bb.length > 0 && Array.isArray(bb[0].replies) && bb[0].replies.length >= 1;
  }, 8000);                                          // TA 回话延迟 0.9~2.4s + 写入
  const c = J(await chatState());
  const b = J(await boxState());
  const outBox = b.filter((x) => x.side === 'out');
  const d = J(await cardDom()) || {};
  const taTxt = String((outBox[0] && outBox[0].replies && outBox[0].replies[0] || {}).text || '');
  ok(c.gifts === before + 1 && c.lastSide === 'out', 'B5 送出一件（我送出）', JSON.stringify({ before: before, now: c.gifts, side: c.lastSide }));
  ok(outBox.length === 1 && taTxt.length > 0, 'B5b TA 的自动回话写进了这件礼物的心意柜记录（原缺口）', JSON.stringify(outBox[0] && outBox[0].replies));
  ok(d.replHidden === false && taTxt.length > 0 && String(d.replText).indexOf(taTxt) >= 0,
    'B5c 同一句话也贴到了「我送出」那张卡片上（卡片从心意柜记录读，不再只是聊天里飘过一句）',
    JSON.stringify({ hidden: d.replHidden, text: d.replText, ta: taTxt }));
  ok(outBox.length === 1 && outBox[0].replies[0].who === 'ta', 'B5d 回复归属标为 TA', JSON.stringify(outBox[0] && outBox[0].replies));
}

// ---- B6/B7：迁移口径 + 反向守卫 + 重载后仍在 ----
// 存量形态用产品自己的整包导入通道（window.chatImportMsgs）造：直接往存储里塞记录会被离页 flush
// 用内存态盖回去（本会话踩过），导入通道会连带把基准段/日志换成新数组＝跨重载也站得住。
{
  const seeded = await evalJs(`(function(){
    var s = window.storeFor('default');
    var cur = []; try { cur = JSON.parse(s.get('chat-msgs')||'[]'); } catch(e){}
    var legacyTs = Date.now() - 60000, selfTs = Date.now() - 50000;
    // 存量形态：旧版自动收下的礼物卡（没有 giftBoxId 指针）
    cur.push({ side:'in', special:'gift', giftId:'g_legacy1', giftName:'老礼物', giftEmoji:'\uD83C\uDF81', giftImg:'', giftPrice:20, giftWish:'旧文案', giftCat:'gcare', ts: legacyTs });
    // TA 自己买的礼物卡（giftSelf）
    cur.push({ side:'in', special:'gift', giftId:'g_legacy2', giftName:'TA自买', giftEmoji:'\uD83C\uDF81', giftImg:'', giftPrice:30, giftWish:'TA 文案', giftCat:'gcare', giftSelf:1, ts: selfTs });
    if (window.chatImportMsgs) window.chatImportMsgs(cur);
    var box = []; try { box = JSON.parse(s.get('giftbox-items')||'[]'); } catch(e){}
    box.unshift({ id:'gb_legacy1', giftId:'g_legacy1', name:'老礼物', emoji:'\uD83C\uDF81', img:'', price:20, cat:'gcare', wish:'旧文案', side:'in', tm: legacyTs });
    s.set('giftbox-items', JSON.stringify(box));
    return typeof window.chatImportMsgs;
  })()`);
  ok(seeded === 'function', 'B6 前置：产品自带整包导入通道可用（造存量夹具用）', String(seeded));
  await sleep(900);
  await openChat();
  await sleep(700);
  const legacy = J(await cardDom('老礼物')) || { found: false };
  const selfCard = J(await cardDom('TA自买')) || { found: false };
  ok(legacy.found && legacy.hasClaim === false && legacy.hasReplyBtn === false,
    'B6b 存量礼物卡没有动作区（旧版自动收下的：不翻成待领取、也没有心意柜指针可写回复）', JSON.stringify(legacy));
  ok(selfCard.found && selfCard.hasClaim === false && selfCard.hasReplyBtn === false,
    'B7 TA 自己买的礼物卡不出动作区（不是送我的礼物）', JSON.stringify(selfCard));
  // 重载：状态全部按记录判定（心意柜＝单一事实源），不靠一次性 DOM 补丁
  if (!(await goto())) { console.error('二次冷启动未就绪'); finish(); process.exit(1); }
  await sleep(1200);
  await openChat();
  await sleep(800);
  const claimed = J(await cardDom('验证蜡烛')) || { found: false };
  ok(claimed.found && claimed.hasClaim === false && String(claimed.got).indexOf('已领取') >= 0,
    'B7b 重载后「已领取」状态仍在（读心意柜记录渲染，不靠一次性 DOM 补丁）', JSON.stringify({ found: claimed.found, got: claimed.got }));
  ok(claimed.replHidden === false && String(claimed.replText).indexOf('谢谢你呀，我很喜欢') >= 0,
    'B7c 重载后卡片上的追加回复仍在', JSON.stringify({ hidden: claimed.replHidden, text: claimed.replText }));
  const b = J(await boxState());
  ok(b.some((x) => x.name === '验证蜡烛' && x.replies.some((r) => String(r.text).indexOf('谢谢你呀') >= 0)),
    'B7d 重载后心意柜那件的回复仍在（单一事实源）', JSON.stringify(b.filter((x) => x.name === '验证蜡烛')));
  ok(b.some((x) => x.name === '老礼物' && x.claimed === null),
    'B7e 存量心意柜记录不带 claimed（渲染侧当已领取，不标待领取）', JSON.stringify(b.filter((x) => x.name === '老礼物')));
  await openBoxPage();
  await sleep(700);
  const domBox = J(await boxDom()) || [];
  const legacyCard = domBox.find((x) => x.name === '老礼物') || {};
  const pendCard = domBox.find((x) => x.name === '验证围巾') || {};
  ok(legacyCard.pending === false, 'B7f 存量礼物在心意柜里不标「待领取」（不把历史礼物翻成待领取）', JSON.stringify(legacyCard));
  ok(pendCard.pending === true, 'B7g 新送未领的那件仍标「待领取」（重载后按记录判定）', JSON.stringify(pendCard));
}

} catch (eB) {
  fail++;
  console.log('  \u2717 B 层断言中断（红基线常见：功能不存在时读不到卡片/记录）— ' + (eB && eB.message));
}

{
  const errs = await evalJs('JSON.stringify((window.__jsErrors||[]).slice(0,5))');
  ok(errs === '[]', 'Z1 全程零 JS 错误', String(errs));
}

console.log('\n通过 ' + pass + ' / 断言失败 ' + fail);
finish();
process.exit(fail ? 1 : 0);
