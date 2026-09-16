// ===== 回归验证（#572 / #572b）：点【撤回了一条消息】查看原文，消息列表必须一条都不动 =====
// 用户报障（2026-09-16，单聊+群聊都有，明说「以前没有这个问题」＝回归）：点【对方撤回了一条消息】
// 「全部聊天消息都会弹和闪」。根因（无头实测）：查看原文原先是把原文写回这条气泡本身，撤回提示只有
// 一行、原文必更高 ⇒ 该气泡当场变高，.chat-body 是纵向 flex 列表，气泡一变高就必然推动列表的一侧：
//   · 不补偿（#199 把 .chat-body 原生滚动锚定 overflow-anchor:none 关掉后的现网行为）→ 下面 8 条
//     消息下移 55px（长原文 5 条 ×160px）；
//   · 加滚动补偿（#572 第一版）→ 变成上面 3~6 条上移 34px（被点那条自身也上移）。
// 用户要的是「我只是查看内容」，所以 #572b 改为浮层查看：点提示弹只读卡片，列表一条都不动；内容按
// 消息记录安全渲染（图片 <img> / 语音名称 / 文本转义换行），不再直出 rec.orig 快照（老数据展开变整屏
// base64、字卡 HTML 被当标签执行——群聊 #244 已修，单聊本次对齐）。
//
// 断言口径：点开与关闭前后，聊天区**所有** .msg 的视口坐标逐个相同（含被点那条），且浮层里出现原文。
// RED 基线（修复前产物，无头 390×844）：单聊 T4 位移 ["30:-34","31:-34","32:-34","33:-34"]、
// 群聊 6 条 ×-34px；修复后全绿。
// 用法：node tools/verify-recall-view.mjs   （BROWSER=webkit 可选；VERIFY_ROOT=目录 指向隔离构建）
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// VERIFY_ROOT：可选，指定要验证的站点根目录（默认本仓库）——用于「修复前 RED 基线 / 隔离副本构建后
// GREEN」对照，不必改仓库产物即可确认 src 改动是否真的生效。
const root = process.env.VERIFY_ROOT ? normalize(process.env.VERIFY_ROOT) : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const results = [];
let skipped = 0;
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
function skip(desc, why) { skipped++; console.log('SKIP  ' + desc + '  [' + why + ']'); }

const engine = process.env.BROWSER || 'chromium';
const { chromium, webkit } = await import('playwright');
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// 原文 2~3 行（真实字卡口径）＋可识别关键词，用来断言浮层里显示的确实是原文
const MARK = '围巾';
const LONG_ORIG = '今天降温了记得多穿一件外套，我把' + MARK + '洗好放在门口了，出门别忘带伞。再冷也要记得吃早饭。';
// 12 条足够撑出一屏多（390×844 实测），且首屏渲染稳定：历史太长时开屏「LS 快照 + IDB 权威」合并
// 偶尔只渲出个位数条（另案，见 WORKLOG），会让本脚本量到空列表＝假 FAIL
const TOTAL = 8;
const RECALL_IDX = 3; // 贴底后仍在视口内、下面还有 4 条消息（位移最容易暴露的位置）

function seedSingle() {
  const msgs = [];
  for (let i = 0; i < TOTAL; i++) msgs.push({ side: i % 2 ? 'in' : 'out', text: '测试消息 ' + i, ts: Date.now() - (TOTAL - i) * 60000, initiative: i % 2 === 1 });
  msgs[RECALL_IDX] = { side: 'in', text: LONG_ORIG, ts: Date.now() - (TOTAL - RECALL_IDX) * 60000, initiative: true, retracted: true, orig: LONG_ORIG };
  return msgs;
}
function seedGroup() {
  const msgs = [];
  for (let i = 0; i < TOTAL; i++) msgs.push({ side: i % 2 ? 'in' : 'out', text: '群消息 ' + i, ts: Date.now() - (TOTAL - i) * 60000, cid: 'c1' });
  msgs[RECALL_IDX] = { side: 'in', text: LONG_ORIG, ts: Date.now() - (TOTAL - RECALL_IDX) * 60000, cid: 'c1', retracted: true, orig: LONG_ORIG };
  return msgs;
}

async function killSplash() {
  await page.evaluate("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.style.display='none';s.style.pointerEvents='none';}var b=document.getElementById('splash-box');if(b)b.style.display='none';return true;})()");
}
// 清掉 app 自己的全屏遮罩（开屏公告/存储异常/应用锁等）——它们会 intercept pointer events，
// 让点击落不到撤回气泡上（表现为偶发「浮层没弹」的假 FAIL：实测 #modal-mask 拦截过 tap）
async function clearOverlays() {
  await page.evaluate(`(function(){
    var s = document.getElementById('splash');
    if (s) { s.classList.add('hide'); s.style.display = 'none'; s.style.pointerEvents = 'none'; }
    ['modal-mask', 'applock-mask'].forEach(function (id) {
      var m = document.getElementById(id);
      if (!m) return;
      var cancel = m.querySelector('.modal-cancel, .modal-btn-cancel, [data-act="cancel"]');
      if (cancel && !cancel.hidden) { try { cancel.click(); } catch (e) {} }
      if (!m.hidden) { try { m.hidden = true; } catch (e) {} }
    });
    return true;
  })()`);
  await sleep(120);
}
// 单聊种子改走产品自己的整包替换入口（data-backup 导入同款 chatImportMsgs）——直接写 LS/IDB 会跟
// app 的「防抖落盘 / LS 快照 + IDB 权威合并 / 账本」抢时序：实测偶发首屏只渲出 1~3 条（种子被内存态
// 盖回），表现为 T0 no-bubble 的假红。走 chatImportMsgs = 同步替换内存 + 渲染 + 落盘，零竞态。
async function seedViaImport(arr) {
  const r = await page.evaluate(`(function(){ try { return window.chatImportMsgs ? String(window.chatImportMsgs(${JSON.stringify(arr)})) : 'no-api'; } catch (e) { return 'err:' + e.message; } })()`);
  await sleep(800);
  return r;
}
async function boot(entries) {
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 50; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await sleep(300); }
  await page.evaluate(`(async function(){
    for (const it of ${JSON.stringify(entries)}) {
      const raw = JSON.stringify(it.arr);
      if (window.idbSet) { try { await window.idbSet(it.key, raw); } catch (e) {} }
      try { localStorage.setItem(it.key, raw); } catch (e) {}
    }
    // 关掉「联系人主动发消息」与撤回掷签（reply-settings 的 as-en / rc-en）——后台自己往列表插消息会
    // 带动 maybeScrollChatBottom 滚动，量测位移时必须排除这个干扰源
    try { localStorage.setItem('xy-home-v2:reply-as-en', '0'); } catch (e) {}
    try { localStorage.setItem('xy-home-v2:reply-rc-en', '0'); } catch (e) {}
    try { if (window.idbSet) { await window.idbSet('xy-home-v2:reply-as-en', '0'); await window.idbSet('xy-home-v2:reply-rc-en', '0'); } } catch (e) {}
    return true;
  })()`);
  await sleep(600);
  await page.reload({ waitUntil: 'load', timeout: 25000 });
  for (let i = 0; i < 50; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await sleep(300); }
  await killSplash();
}
// 量测：视口内消息坐标（按各页自己的下标属性认领；群聊是 data-gc-idx、单聊是 data-idx）
function measureFn(container, idxAttr) {
  return `(function(){
    return JSON.stringify(Array.from(document.querySelectorAll('${container} .msg')).map(function(el){
      var r = el.getBoundingClientRect();
      return { idx: el.getAttribute('data-${idxAttr}'), top: Math.round(r.top), visible: (r.bottom > 0 && r.top < window.innerHeight) };
    }));
  })()`;
}
function noticeFn(container, idxAttr) {
  return `(function(){
    var bs = Array.from(document.querySelectorAll('${container} .msg-bubble')).filter(function(x){ return x.textContent.indexOf('撤回了一条消息') >= 0; });
    if (!bs.length) return 'null';
    var b = bs[0], r = b.getBoundingClientRect();
    return JSON.stringify({ idx: b.closest('.msg').getAttribute('data-${idxAttr}'), text: b.textContent,
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      inView: (r.top > 0 && r.bottom < window.innerHeight), h: Math.round(r.height) });
  })()`;
}
// 等撤回提示就绪（进页/读库/合并都是异步的，固定 sleep 会偶发量到空列表＝假 FAIL）
async function waitForNotice(container, idxAttr, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 12000)) {
    const raw = await page.evaluate(noticeFn(container, idxAttr));
    if (raw && raw !== 'null') {
      const o = JSON.parse(raw);
      if (o && o.inView) return o;
    }
    await sleep(400);
  }
  return null;
}
const viewState = `(function(){
  var v = document.getElementById('recall-view');
  if (!v) return JSON.stringify({ exists: false, hidden: true, text: '' });
  var bd = v.querySelector('#recall-view-body');
  var inner = bd ? bd.querySelector('.recall-view-bubble .msg-bubble') : null;
  return JSON.stringify({ exists: true, hidden: v.hidden, text: bd ? bd.textContent : '',
    hasBubble: !!inner, innerHtml: inner ? inner.innerHTML : '',
    imgs: bd ? bd.querySelectorAll('img').length : 0 });
})()`;
// 逐条比对坐标：返回位移清单（空 = 一条都没动）
function diffMoved(before, after) {
  const map = {};
  after.forEach((m) => { map[m.idx] = m; });
  const moved = [];
  before.forEach((b) => {
    if (b.idx === null) return;
    const a = map[b.idx];
    if (!a) return;
    if (!b.visible && !a.visible) return; // 都不在视口：用户无感知，不计
    if (Math.abs(a.top - b.top) > 2) moved.push(b.idx + ':' + (a.top - b.top));
  });
  return moved;
}

async function runCase(label, container, idxAttr, seed, openFn, waitMs, importSeed) {
  await boot(seed);
  await page.evaluate(openFn);
  await sleep(waitMs);
  if (importSeed) await seedViaImport(importSeed);
  await killSplash();
  await page.evaluate(`(function(){var b=document.getElementById('${container.slice(1)}'); b.scrollTop = b.scrollHeight; return true;})()`);
  await sleep(300);

  await clearOverlays();
  // 首屏偶发只渲出个位数条（LS 快照 + IDB 权威合并的竞态，见 WORKLOG「#572b 观察」）→ 重载一次再试，
  // 免得把 app 侧的加载竞态算成本脚本的假红
  let n = await waitForNotice(container, idxAttr, 8000);
  for (let round = 0; round < 2 && !n; round++) {
    await page.reload({ waitUntil: 'load', timeout: 25000 });
    for (let i = 0; i < 50; i++) { if (await page.evaluate('!!window.__mochiDataReady')) break; await sleep(300); }
    await clearOverlays();
    await page.evaluate(openFn);
    await sleep(waitMs);
    if (importSeed) await seedViaImport(importSeed);
    await clearOverlays();
    await page.evaluate(`(function(){var b=document.getElementById('${container.slice(1)}'); b.scrollTop = b.scrollHeight; return true;})()`);
    await sleep(300);
    n = await waitForNotice(container, idxAttr, 8000);
  }
  if (!n) {
    const dbg = await page.evaluate(`(function(){
      var c = document.querySelector('${container}');
      return 'msgs=' + (c ? c.querySelectorAll('.msg').length : -1) + ' pageHidden=' + (document.getElementById('${container.slice(1)}') ? document.getElementById('${container.slice(1)}').closest('.page').hidden : '?');
    })()`);
    check(label + ' T0 撤回提示渲染且在视口内', false, 'no-bubble（' + dbg + '）');
    return;
  }
  check(label + ' T0 撤回提示渲染且在视口内', true, 'idx=' + n.idx + ' y=' + n.y);
  if (!n) return;

  const before = JSON.parse(await page.evaluate(measureFn(container, idxAttr)));
  const visOthers = before.filter((m) => m.visible && m.idx !== n.idx).length;
  check(label + ' T1 量测样本足够（视口内另有 ≥4 条消息）', visOthers >= 4, visOthers + ' 条');

  // 用 locator 点击（点击时重新定位元素）：直接按测量坐标点会跟「图片迟到解码/贴底纠偏」导致的
  // 布局漂移赛跑——量到的 y 与点下去那一瞬的 y 不同就会点空，表现为偶发「浮层没弹」的假 FAIL
  await clearOverlays();
  try {
    await page.locator(container + ' .msg-bubble', { hasText: '撤回了一条消息' }).first().tap({ timeout: 5000 });
  } catch (e) { // 弹层仍在拦截 pointer events（环境噪音）→ 退回合成 click，别让脚本直接崩掉
    await clearOverlays();
    await page.evaluate(`(function(){
      var bs = Array.from(document.querySelectorAll('${container} .msg-bubble')).filter(function(x){ return x.textContent.indexOf('撤回了一条消息') >= 0; });
      if (bs[0]) bs[0].click();
      return true;
    })()`);
  }
  await sleep(450);
  const after = JSON.parse(await page.evaluate(measureFn(container, idxAttr)));
  const vs = JSON.parse(await page.evaluate(viewState));
  const moved = diffMoved(before, after);

  check(label + ' T2 点开弹出查看浮层', vs.exists === true && vs.hidden === false, JSON.stringify({ exists: vs.exists, hidden: vs.hidden }));
  check(label + ' T3 浮层里是原文（不是提示文本）', !!vs.text && vs.text.indexOf(MARK) >= 0 && vs.text.indexOf('撤回了一条消息') < 0, (vs.text || '').slice(0, 22));
  // #572c（用户点名「浮层 + 恢复原来的排版」）：卡片内容必须按原气泡样式渲染那份原文快照——原快照
  // 就存在 rec.orig 里，种子正是它，所以逐字节比对即可（降级成纯文本兜底＝观感变了，判红）
  const snapExpect = label === '单聊' ? seedSingle()[RECALL_IDX].orig : seedGroup()[RECALL_IDX].orig;
  check(label + ' T3b 卡片用原气泡样式渲染原文快照（观感与就地展开一致）',
    vs.hasBubble === true && vs.innerHtml === snapExpect, 'hasBubble=' + vs.hasBubble + ' 快照一致=' + (vs.innerHtml === snapExpect));
  check(label + ' T4 展开后消息列表一条都没动（#572 核心）', moved.length === 0, moved.length ? '位移: ' + JSON.stringify(moved) : '0 条位移');
  const bubbleSame = await page.evaluate(`(function(){
    var b = document.querySelector('${container} .msg[data-${idxAttr}="${n.idx}"] .msg-bubble');
    return !!(b && b.textContent.indexOf('撤回了一条消息') >= 0 && Math.abs(Math.round(b.getBoundingClientRect().height) - ${n.h}) <= 2);
  })()`);
  check(label + ' T5 提示气泡自身没变（仍是提示行）', bubbleSame === true, n.h + 'px');

  await page.evaluate("(function(){var b=document.getElementById('recall-view-close'); if(b) b.click(); return true;})()");
  await sleep(350);
  const after2 = JSON.parse(await page.evaluate(measureFn(container, idxAttr)));
  const vs2 = JSON.parse(await page.evaluate(viewState));
  check(label + ' T6 关闭后浮层收起', vs2.hidden === true, 'hidden=' + vs2.hidden);
  const moved2 = diffMoved(after, after2);
  check(label + ' T7 关闭后消息列表仍一条没动', moved2.length === 0, moved2.length ? '位移: ' + JSON.stringify(moved2) : '0 条位移');
}

await runCase('单聊', '#chat-body', 'idx', [{ key: 'xy-home-v2:chat-msgs', arr: seedSingle() }],
  "(function(){if(window.enterChat) window.enterChat();document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()", 2000, seedSingle());

await runCase('群聊', '#gc-body', 'gc-idx', [{ key: 'xy-home-v2:group-chat-msgs', arr: seedGroup() }],
  "(function(){var app=document.querySelector('.app[data-app=\"group-chat\"]');if(app)app.click();return true;})()", 2200);

check('无 JS 报错', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

const pass = results.filter((r) => r.ok).length;
console.log('\n结果: ' + pass + '/' + results.length + ' 通过' + (skipped ? '，' + skipped + ' 项环境不满足' : ''));
await browser.close();
server.close();
process.exit(pass === results.length ? 0 : 1);
