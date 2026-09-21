// ===== 设置页平台标记（.plat-tag「仅安卓 / 仅 iPhone」+ 非本机平台替代入口）验证 =====
// 立项：用户 2026-09-21 问「设置有很多 iOS 和安卓的专属功能，需要给 iOS 和安卓两个分开专门
//   加一个分类吗？」→ 结论：不分类（按平台切会把两个系统都要用的行藏起来，且 device.js 的
//   平台判定有 UA 伪装失手面：OPPO/Via 伪装 iPhone、iPad 伪装、桌面版网站模式整套伪装成桌面）。
//   改为行级标记：静态胶囊在 template（.plat-tag[data-plat]），personalize.js initPlatTags
//   只在「明确判定为另一平台」时弱化该行 + 给替代入口（跳转目标行）。只弱化标签、绝不
//   disabled 开关——识别失手的用户必须仍能点到唯一能修好自己问题的开关。
// 断言：S 静态锚；B1~B7 iPhone UA；B8~B9 安卓 UA；B10 桌面/判定不明（保守不弱化）；Z1 零异常。
// 用法：node tools/verify-plat-tags.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };

let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 14; OPPO K13x) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ===== 静态：src =====
const tpl = readSrc('template.html');
const css = readSrc('css/setting.css');
const pers = readSrc('js/personalize.js');
const shelp = readSrc('js/settings-help.js');
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');

const androidBadges = (tpl.match(/<span class="plat-tag" data-plat="android">仅安卓<\/span>/g) || []).length;
const iosBadges = (tpl.match(/<span class="plat-tag" data-plat="ios">仅 iPhone<\/span>/g) || []).length;
ok(androidBadges === 2 && iosBadges === 1, 'S1 平台胶囊在 template.html（安卓 2 行 / iOS 1 行）', 'android=' + androidBadges + ' ios=' + iosBadges);
ok(/<div class="txt">顶部避让修正<span class="plat-tag" data-plat="ios">/.test(tpl), 'S1b 顶部避让修正（iOS 专属）行挂了胶囊');
ok(!/class="tag"[^>]*>\s*仅安卓/.test(tpl) && !/class="tag"[^>]*>\s*仅 iPhone/.test(tpl), 'S2 胶囊不复用 .tag（复用＝settings-help 注入器跳过该行）');
ok(shelp.includes("label.querySelector('.tag')"), 'S2b settings-help 注入器的 .tag 跳过判据仍在（S2 的前提）');
ok(css.includes('.gs-row .plat-tag {') && css.includes('.set-row .txt .plat-tag {'), 'S3a setting.css 有 .plat-tag 两处上下文样式');
ok(css.includes('.set-row.plat-off .txt, .gs-row.plat-off > span { opacity:.6; }'), 'S3b 非本机平台弱化样式（只弱化标签）');
ok(css.includes('@keyframes platFlash'), 'S3c 跳转落点高亮动画存在');
ok(pers.includes('function initPlatTags()'), 'S4a personalize.js 接线 initPlatTags');
ok(pers.includes("if (plat === 'android') return d.isIOS === true;") && pers.includes("if (plat === 'ios') return d.isAndroid === true;"), 'S4b 只在「明确判定为另一平台」时弱化（保守口径）');
ok(!/\.disabled\s*=\s*true/.test(pers.slice(pers.indexOf('function initPlatTags()'), pers.indexOf('function initPlatTags()') + 2600)), 'S4c 弱化不 disabled 开关（判定失手仍可用）');
ok(["'bg-notify':", "'psync-en':", "'safe-top-force':"].every((k) => pers.includes(k)), 'S4d 三条替代指引登记齐全');
ok(bm.includes('#plat1') && bm.includes('#plat2') && bm.includes('#plat3') && bm.includes('#plat4'), 'S5 哨兵 #plat1~#plat4 已登记 build.mjs');

// ===== 行为：自组装页 =====
const cssFiles = ['base.css', 'home.css', 'chat-main.css', 'chat-pages.css', 'market.css', 'group-chat.css', 'setting.css', 'tabbar.css', 'dark.css', 'garden.css', 'memo.css', 'memo-arc.css', 'room.css'];
const jsFiles = ['device.js', 'idb.js', 'contacts.js', 'clock.js', 'tabs.js', 'desktop-slider.js', 'quote-cards.js', 'personalize.js', 'settings-help.js', 'onboarding.js'];
let html = tpl;
const styles = cssFiles.map((f) => readSrc('css/' + f)).join('\n');
const scripts = jsFiles.map((f) => '(function () { try {\n' + readSrc('js/' + f) + '\n} catch (__e) {} })();').join('\n');
html = html.replace('/*__STYLES__*/', styles).replace('/*__SCRIPTS__*/', scripts);
html = html.split('__BUILD_INFO__').join('verify').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v8.28-vpt');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    if (req.url === '/' || req.url.split('?')[0] === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+（内置 WebSocket）'); process.exit(1); }

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9990 + Math.floor(Math.random() * 9));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + join(tmpdir(), 'mochi-vpt-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
let jsErr = 0;
async function ev(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) { jsErr++; console.log('  JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '').split('\n')[0]); return null; }
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}
const J = (v) => { try { return JSON.parse(v || '{}'); } catch (e) { return {}; } };

// 以指定 UA 重新加载 → 关开屏 → 打开设置页（每次都是干净现场）
let nav = 0;
async function bootAs(ua) {
  await cdp('Emulation.setUserAgentOverride', { userAgent: ua });
  nav++;
  await cdp('Page.navigate', { url: baseUrl + '/index.html?u=' + nav });
  await sleep(2200);
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady')) break; await sleep(300); }
  await ev("(function(){var s=document.getElementById('splash');if(s){s.classList.add('hide');s.hidden=true;}var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
  await sleep(600);
  await ev("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-setting');});var t=document.querySelector('#set-tabs .them-tab[data-tab=\"system\"]');if(t)t.click();return true;})()");
  await sleep(400);
  return J(await ev("(function(){var d=window.mochiDevice||{};return JSON.stringify({ios:!!d.isIOS,android:!!d.isAndroid,mobile:!!d.isMobile});})()"));
}

// 现场快照：三行的弱化 / 胶囊 / 提示 / 开关可用性 / 功能说明胶囊
const SNAP = `(function(){
  function rowOf(id){var e=document.getElementById(id);return e?(e.closest('.set-row,.gs-row')||e):null;}
  function hintOf(row){var n=row.nextElementSibling,h=null;
    while(n&&n.classList&&(n.classList.contains('gs-sub')||n.classList.contains('plat-hint'))){
      if(n.classList.contains('plat-hint'))h=n;n=n.nextElementSibling;}return h;}
  function one(id){var r=rowOf(id);if(!r)return null;var h=hintOf(r);
    return {off:r.classList.contains('plat-off'),badge:(r.querySelector('.plat-tag')||{}).textContent||'',
      hint:h?h.textContent.trim():'',go:!!(h&&h.querySelector&&h.querySelector('.plat-go')),
      disabled:!!(r.querySelector('input[type=checkbox]')||{}).disabled,help:!!r.querySelector('[data-setdesc],#psync-help')};}
  return JSON.stringify({bg:one('bg-notify'),ps:one('psync-en'),st:one('safe-top-force'),
    badges:document.querySelectorAll('#page-setting .plat-tag').length,
    offRows:document.querySelectorAll('#page-setting .set-row.plat-off, #page-setting .gs-row.plat-off').length,
    hints:document.querySelectorAll('#page-setting .plat-hint').length});
})()`;

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== iPhone =====
console.log('— iPhone UA —');
const envIOS = await bootAs(UA_IOS);
ok(envIOS.ios === true && envIOS.android === false, 'B0 iPhone UA 被识别为 iOS', JSON.stringify(envIOS));
let s = J(await ev(SNAP));
ok(s.badges === 3, 'B1 三枚平台胶囊都渲染出来', JSON.stringify(s.badges));
ok(s.bg && s.bg.badge === '仅安卓' && s.ps && s.ps.badge === '仅安卓' && s.st && s.st.badge === '仅 iPhone', 'B1b 胶囊文案与行对应', JSON.stringify([s.bg && s.bg.badge, s.ps && s.ps.badge, s.st && s.st.badge]));
ok(s.bg && s.bg.off === true && s.ps && s.ps.off === true, 'B2 iPhone 上两行安卓专属被弱化');
ok(s.st && s.st.off === false, 'B2b iPhone 上「顶部避让修正」（iOS 专属）不弱化');
ok(s.bg && s.bg.go === true && /桌面消息弹窗/.test(s.bg.hint), 'B3a 后台通知行给出「桌面消息弹窗」替代指引 + 跳转', s.bg && s.bg.hint);
ok(s.ps && s.ps.go === true && /桌面消息弹窗/.test(s.ps.hint), 'B3b 离线消息提醒行给出替代指引 + 跳转', s.ps && s.ps.hint);
ok(s.bg && s.bg.disabled === false && s.ps && s.ps.disabled === false, 'B5 开关没被 disabled（判定失手仍可用）');
ok(s.bg && s.bg.help === true && s.ps && s.ps.help === true && s.st && s.st.help === true, 'B6 三行的「功能说明」胶囊都还在（.plat-tag 没挡住注入器）', JSON.stringify([s.bg && s.bg.help, s.ps && s.ps.help, s.st && s.st.help]));

// 点「去开启」→ 落到「桌面消息弹窗」行并高亮
await ev("(function(){var h=document.querySelector('.plat-hint .plat-go');if(h)h.click();return true;})()");
await sleep(400);
const j1 = J(await ev("(function(){var r=document.getElementById('desk-msg-en');var rw=r?(r.closest('.set-row,.gs-row')||r):null;return JSON.stringify({flash:!!(rw&&rw.classList.contains('plat-flash')),vis:!!(rw&&!rw.closest('.them-sec').hidden)});})()"));
ok(j1.flash === true && j1.vis === true, 'B4 「去开启」跳到「桌面消息弹窗」行并高亮', JSON.stringify(j1));

// 胶囊文案可被设置搜索命中（「安卓」→ 离线消息提醒行）
const searched = await ev("(function(){var i=document.getElementById('set-search-input');i.value='安卓';i.dispatchEvent(new Event('input'));var r=document.getElementById('psync-en');var row=r.closest('.set-row');return row.style.display!=='none';})()");
ok(searched === true, 'B7 搜「安卓」能命中带胶囊的行（胶囊文案进了搜索素材）');
await ev("(function(){var i=document.getElementById('set-search-input');i.value='';i.dispatchEvent(new Event('input'));return true;})()");
await sleep(250);

// ===== 安卓 =====
console.log('— 安卓 UA —');
const envAnd = await bootAs(UA_ANDROID);
ok(envAnd.android === true && envAnd.ios === false, 'B0b 安卓 UA 被识别为 Android', JSON.stringify(envAnd));
s = J(await ev(SNAP));
ok(s.st && s.st.off === true, 'B8 安卓上「顶部避让修正」被弱化');
ok(s.bg && s.bg.off === false && s.ps && s.ps.off === false, 'B8b 安卓上两行安卓专属不弱化');
ok(s.st && s.st.go === true && /屏幕适配微调/.test(s.st.hint), 'B8c 给出「屏幕适配微调」替代指引 + 跳转', s.st && s.st.hint);
ok(s.offRows === 1 && s.hints === 1, 'B8d 只弱化/提示了这一行（不误伤）', JSON.stringify({ off: s.offRows, hints: s.hints }));

// 点「去调整」→ 跨 tag 切到「工具」并落到「屏幕适配微调」行
await ev("(function(){var h=document.querySelector('.plat-hint .plat-go');if(h)h.click();return true;})()");
await sleep(500);
const j2 = J(await ev("(function(){var r=document.getElementById('row-screen-adj');var sec=document.querySelector('.them-sec[data-sec=\\'tools\\']');var tab=document.querySelector('#set-tabs .them-tab[data-tab=\\'tools\\']');return JSON.stringify({flash:!!(r&&r.classList.contains('plat-flash')),secVis:!!(sec&&!sec.hidden),tabActive:!!(tab&&tab.classList.contains('active'))});})()"));
ok(j2.flash === true && j2.secVis === true && j2.tabActive === true, 'B9 「去调整」跨 tag 切到工具段并高亮目标行', JSON.stringify(j2));

// ===== 桌面 / 判定不明 =====
console.log('— 桌面 UA（判定不明）—');
const envDesk = await bootAs(UA_DESKTOP);
ok(envDesk.ios === false && envDesk.android === false, 'B0c 桌面 UA 两个平台都不成立', JSON.stringify(envDesk));
s = J(await ev(SNAP));
ok(s.offRows === 0 && s.hints === 0, 'B10 判定不明时一行都不弱化（保守口径：绝不把用户挡在开关外）', JSON.stringify({ off: s.offRows, hints: s.hints }));
ok(s.badges === 3, 'B10b 判定不明时胶囊照常显示（信息提示不依赖判定）');

ok(jsErr === 0, 'Z1 全程无 JS 异常', 'jsErr=' + jsErr);

try { chrome.kill(); } catch (e) {}
server.close();
console.log('\n== 设置页平台标记验证: ' + pass + '/' + (pass + fail) + ' ==');
process.exit(fail === 0 ? 0 : 1);
