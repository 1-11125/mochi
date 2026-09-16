// ===== 功能验证脚本：#572 页面内「先做这个」提示（复杂页首访自述 + 首选动作 + 空状态动作） =====
// 用法：node tools/verify-page-coach.mjs（需 node 21+ 与本机 Chrome/Edge）
// 背景（用户 2026-09-16「每个复杂页面里不知道先点哪儿」）：
//   ① 能说清「这是什么/从哪进」的只有设置页的功能大全与功能说明胶囊——人已经站在字卡库/美化页里
//      发懵时，答案在另一个页面后面；② 页面内层级平行（字卡库三 tab + 添加/批量导入/链接导入/分组），
//      没人说「先动这两项」；③ 空状态只陈述不动作。
// #572 做法：新模块 page-coach.js——每页首访在页面内插一条细提示（一句话「先做这个」+ 一键动作
//   + 可展开「这页还有什么（N）」，条目取自功能大全目录表 window.mochiHubItemsFor＝文案单一事实源）；
//   每页只提示一次（__coach-seen，已进 contacts.js EXCLUDE 免迁）；设置 → 工具 → 使用提示 可重置；
//   空状态补动作（#memo-empty-add / #feed-empty-pub / #dl-empty-put 委托既有入口）。
// 验证（无头 Chrome 384×752 真实产物）：S 层源码断言 + B 层行为断言——
//   B1 进字卡库出现提示条（含首选动作与索引 toggle）；B2 展开索引条目数正确可点；
//   B3 离开再进不再出现（已看标记生效）；B4 进美化页也提示；
//   B5 已经有字卡时字卡库不提示（need 门）；B6 设置里的重置行存在且点击后标记清空、提示重现；
//   B7 朋友圈空态带「我来发第一条」按钮（委托既有发布入口）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const chk = (name, ok, detail) => { if (ok) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name + (detail ? ' —— ' + detail : '')); } };

// ---------- S 层：源码断言 ----------
// 读不到就当空串（文件被删/改名时按「断言红」报出，而不是让脚本崩掉——RED 基线要能跑完）
const readSrc = (rel) => { try { return readFileSync(join(root, rel), 'utf8'); } catch (e) { return ''; } };
const pcSrc = readSrc('src/js/page-coach.js');
const hubSrc = readSrc('src/js/feature-hub.js');
const ctSrc = readSrc('src/js/contacts.js');
const bmSrc = readSrc('build.mjs');
console.log('S 层（源码作用域）');
chk('S1 提示条插入页面内（不是弹窗）', pcSrc.includes('page.insertBefore(buildBar(cfg), page.firstChild);'));
chk('S2 每页一次标记键', pcSrc.includes("const MARK = G + '__coach-seen';"));
chk('S3 功能大全目录表只读查询暴露（文案单一事实源）', hubSrc.includes('window.mochiHubItemsFor = function (sels) {'));
chk('S4 标记键进 contacts.js 免迁白名单', ctSrc.includes("'__coach-seen',"));
chk('S5 新模块登记进 build.mjs jsFiles', bmSrc.includes("'onboarding.js', 'page-coach.js'"));
chk('S6 设置页重置行 + 复位接口', pcSrc.includes('id="row-pagetips"') && pcSrc.includes('window.mochiPageTipsReset = resetAll;'));
const empties = [
  ['js/memo-app.js', 'memo-empty-add'],
  ['js/feed.js', 'feed-empty-pub'],
  ['js/drift-bottle.js', 'dl-empty-put'],
];
empties.forEach(function (e) {
  const src = readFileSync(join(root, 'src/' + e[0]), 'utf8');
  chk('S7 空状态动作 ' + e[1] + '（' + e[0] + '）', src.includes('id="' + e[1] + '"'));
});

// ---------- B 层：真实产物行为 ----------
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
const profDir = join(process.env.TEMP || '/tmp', 'mochi-prof-' + Date.now());
const cdpPort = 9750 + Math.floor(Math.random() * 400);
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profDir,
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
await cdp('Emulation.setDeviceMetricsOverride', { width: 384, height: 752, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(4500);

const seeded = await evalJs(`(function () {
  try { localStorage.setItem('xy-home-v2:cc-scope-migrated', '1'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:__coach-seen'); } catch (e) {}
  try { localStorage.removeItem(window.activePrefix() + 'cc-groups'); } catch (e) {}
  try { localStorage.removeItem('xy-home-v2:cc-groups-public'); } catch (e) {}
  return !!document.querySelector('.tab[data-page="page-chatcard"]');
})()`);
chk('B0 就绪（全新环境无字卡 + 字卡库 tab 存在）', seeded === true, String(seeded));

const openCards = `(function () {
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  const c = document.querySelector('.tab[data-page="page-chatcard"]'); if (c) c.click();
  return 1;
})()`;
const openPhone = `(function () { const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click(); return 1; })()`;

// B1 进字卡库 → 提示条
await evalJs(openCards);
await sleep(900);
const b1 = await evalJs(`(function () {
  const bar = document.querySelector('.pc-bar[data-pc="chatcard"]');
  if (!bar) return { bar: false, hasApi: typeof window.mochiHubItemsFor };
  return {
    bar: true,
    inPage: !!document.querySelector('#page-chatcard > .pc-bar'),
    tip: /公用字卡/.test(bar.textContent),
    act: !!bar.querySelector('[data-pcact]'),
    actLabel: (bar.querySelector('[data-pcact]') || {}).textContent || '',
    toggle: !!bar.querySelector('[data-pctoggle]'),
    toggleTxt: (bar.querySelector('[data-pctoggle]') || {}).textContent || ''
  };
})()`);
chk('B1 进字卡库出现页面内提示条（含「先做这个」文案）', b1 && b1.bar && b1.tip, JSON.stringify(b1));
chk('B1.1 提示条插在页面内（#page-chatcard 首子节点）', b1 && b1.inPage, JSON.stringify(b1 && b1.inPage));
chk('B1.2 带首选动作按钮与「这页还有什么」索引', b1 && b1.act && b1.toggle, JSON.stringify(b1));

// B2 展开索引
const n = await evalJs(`(function () {
  const m = (document.querySelector('.pc-bar[data-pc="chatcard"] .pc-toggle').textContent.match(/（(\\d+)）/) || [])[1];
  return m ? parseInt(m, 10) : -1;
})()`);
const b2 = await evalJs(`(async function () {
  const bar = document.querySelector('.pc-bar[data-pc="chatcard"]');
  bar.querySelector('[data-pctoggle]').click();
  await new Promise(r => setTimeout(r, 200));
  const more = bar.querySelector('.pc-more');
  return { opened: more && !more.hidden, items: bar.querySelectorAll('.pc-item').length, sample: (bar.querySelector('.pc-item .pc-n') || {}).textContent || '' };
})()`);
chk('B2 展开「这页还有什么」后条目数与该页功能数一致', b2 && b2.opened && n > 0 && b2.items === n, JSON.stringify({ n: n, b2: b2 }));

// B3 离开再进不再出现
await evalJs(openPhone);
await sleep(400);
const b3pre = await evalJs(`(function () { return (localStorage.getItem('xy-home-v2:__coach-seen') || '') ; })()`);
await evalJs(openCards);
await sleep(800);
const b3 = await evalJs(`(function () { return { bars: document.querySelectorAll('.pc-bar[data-pc="chatcard"]').length }; })()`);
chk('B3 已看标记写入（含 chatcard）', /chatcard/.test(String(b3pre)), String(b3pre));
chk('B3.1 再进字卡库不再出现（只提示一次）', b3 && b3.bars === 0, JSON.stringify(b3));

// B4 美化页也提示
const b4 = await evalJs(`(async function () {
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  await new Promise(r => setTimeout(r, 300));
  const row = document.getElementById('row-appearance');
  if (!row) return { row: false };
  row.click();
  await new Promise(r => setTimeout(r, 900));
  const bar = document.querySelector('.pc-bar[data-pc="theme"]');
  return { row: true, bar: !!bar, inPage: !!(bar && bar.closest('#page-theme')), act: !!(bar && bar.querySelector('[data-pcact]')) };
})()`);
chk('B4 进桌面美化页出现提示条（含「先套用方案」动作）', b4 && b4.bar && b4.inPage && b4.act, JSON.stringify(b4));

// B5 已经有字卡时字卡库不提示（need 门）
const b5 = await evalJs(`(async function () {
  window.mochiPageTipsReset(); // 清标记，制造「会提示」的条件
  const json = JSON.stringify({ text: [['G1', ['随便一张卡']]], kaomoji: [], emoji: [], sticker: [], image: [], poke: [], voice: [] });
  window.xyStore(window.activePrefix()).set('cc-groups', json);
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  await new Promise(r => setTimeout(r, 200));
  const c = document.querySelector('.tab[data-page="page-chatcard"]'); if (c) c.click();
  await new Promise(r => setTimeout(r, 900));
  return { bars: document.querySelectorAll('.pc-bar[data-pc="chatcard"]').length };
})()`);
chk('B5 已有字卡时字卡库不再提示（不打扰已完成用户）', b5 && b5.bars === 0, JSON.stringify(b5));

// B6 设置里的重置行
const b6 = await evalJs(`(async function () {
  window.mochiPageTipsReset();
  const t = document.querySelector('.tab[data-page="page-setting"]');
  if (t) t.click();
  await new Promise(r => setTimeout(r, 500));
  const row = document.getElementById('row-pagetips');
  if (!row) return { row: false };
  row.click();
  await new Promise(r => setTimeout(r, 200));
  return { row: true, cleared: !localStorage.getItem('xy-home-v2:__coach-seen') };
})()`);
chk('B6 设置 → 工具存在「使用提示」重置行', b6 && b6.row, JSON.stringify(b6));
chk('B6.1 点击重置后已看标记清空（可重新看提示）', b6 && b6.cleared, JSON.stringify(b6));

// B7 朋友圈空态带动作按钮（委托既有发布入口）
const b7 = await evalJs(`(async function () {
  const t = document.querySelector('.tab[data-page="page-phone"]'); if (t) t.click();
  await new Promise(r => setTimeout(r, 300));
  const app = document.querySelector('.app[data-app="feed"]');
  if (!app) return { app: false };
  app.click();
  await new Promise(r => setTimeout(r, 900));
  const btn = document.getElementById('feed-empty-pub');
  const pub = document.getElementById('feed-publish-btn');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 400));
  return { app: true, btn: !!btn, pub: !!pub, inPage: !!(btn && btn.closest('#page-feed')) };
})()`);
chk('B7 朋友圈空态出现「我来发第一条」按钮（位于动态页内）', b7 && b7.btn && b7.inPage, JSON.stringify(b7));
chk('B7.1 点击该按钮不报错且发布入口可达', b7 && b7.pub, JSON.stringify(b7));

const errs = await evalJs(`(window.__jsErrors || []).length`);
chk('B8 无页面 JS 错误', (errs || 0) === 0, 'errors=' + errs);

try { chrome.kill(); } catch (e) {}
await sleep(900);
try { rmSync(profDir, { recursive: true, force: true }); } catch (e) {} // 退出即清 profile：单次约 40~50MB，累积会把盘写满（2026-09-16 实测 ENOSPC）
server.close();
console.log('');
console.log('==== verify-page-coach（#572）：' + pass + ' 通过 / ' + fail + ' 失败 ====');
process.exit(fail ? 1 : 0);
