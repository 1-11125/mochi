// ===== 专项验证 #577：美化页「边看边调」入口必须排最前 + 最显眼（无头 Chrome） =====
// 背景（用户原话）：「桌面美化里的【边看边调】功能应该放最前面而且最显眼」。
// 此前它是 desk-quick 行里 5 个按钮的最后一个（第 5 位、跟四个「跳到某设置行」的小描边按钮同款），
// 进美化页第一眼看不到这个主功能。本脚本锁定：位置（在搜索框 / 5 个 tab / 首个分区之前）、
// 体量（整宽主色条，不是小胶囊）、以及「点了仍然打开抽屉」这三条不可回退的性质。
// 用法：node tools/verify-beauty-cta-first.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(root, p), 'utf8'); }
const b = read('build.mjs');
function arrOf(n) { const m = b.match(new RegExp('const ' + n + '\\s*=\\s*\\[([\\s\\S]*?)\\]')); return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []; }
let css = '', js = '';
for (const f of arrOf('cssFiles')) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of arrOf('jsFiles')) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + read('src/template.html') +
  '<scr' + 'ipt>window.__APP_VERSION__="t";</scr' + 'ipt><scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';
const server = createServer((q, r) => { try { const p = q.url.split('?')[0]; if (p === '/blank.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><body>b</body></html>'); return; } if (p === '/test.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(page); return; } r.writeHead(404); r.end(); } catch (e) {} });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const cp = cands.find(p => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const tmp = join(os.tmpdir(), 'verifycta-' + Date.now()); const port = 13000 + Math.floor(Math.random() * 90);
const ch = spawn(cp, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + tmp, '--remote-debugging-port=' + port, 'about:blank'], { stdio: 'ignore' });
let ws = null, id = 0; const pend = new Map();
for (let i = 0; i < 100; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const pg = l.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; } } catch (e) {} await sleep(150); }
const cdp = (m, p = {}) => { const i = ++id; return new Promise(r => { pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); }); };
async function ev(e) { const r = await cdp('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r && r.exceptionDetails) return { __exc: (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text }; return r && r.result ? r.result.value : null; }
const results = [];
const chk = (n, ok, d) => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  [' + String(d).slice(0, 300) + ']')); };
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.navigate', { url: base + '/blank.html' }); await sleep(400);
await cdp('Page.navigate', { url: base + '/test.html' }); await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(300); }
// 关掉开屏与可能出现的弹窗（并行会话在途稿会干扰点击）
await ev("(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var men=document.getElementById('splash-mandatory-enter');if(men)men.click();}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()");
await sleep(500);
await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
await sleep(400);
await ev("(function(){var r=document.getElementById('row-appearance');if(r)r.click();return true;})()");
await sleep(500);

// ---- A. 结构：入口在哪、是不是还在旧的 desk-quick 行里 ----
const m = await ev(`(function(){
  var btn=document.getElementById('dq-drawer');
  var page=document.getElementById('page-theme');
  var quick=document.getElementById('desk-quick-panel');
  // 注意：不能量 #theme-search-input——安卓口径下 mobile-adapt.js 把它转成 .ce-box，
  // 原 input 只剩 1px 幽灵锚点（AGENTS.md），量到的 rect 不是肉眼位置，改量外层 wrap。
  var search=page.querySelector('.theme-search-wrap');
  var tabs=document.getElementById('them-tabs');
  var firstSec=page.querySelector('.them-sec');
  if(!btn) return JSON.stringify({miss:'no-btn'});
  var r=btn.getBoundingClientRect(), pr=page.getBoundingClientRect();
  var cs=getComputedStyle(btn);
  var title=btn.querySelector('span span');
  var tcs=title?getComputedStyle(title):null;
  var chip=quick?quick.querySelector('.dq-btn'):null;
  var chipBg=chip?getComputedStyle(chip).backgroundColor:'';
  var counts=[].filter.call(page.querySelectorAll('button'),function(){return true;}).length;
  return JSON.stringify({
    visible: !page.hidden && btn.offsetParent!==null && r.height>0,
    inQuick: quick ? quick.contains(btn) : false,
    quickChipCount: quick ? quick.querySelectorAll('.dq-btn').length : -1,
    w: Math.round(r.width), h: Math.round(r.height),
    pageW: Math.round(pr.width),
    aboveSearch: search ? (r.top < search.getBoundingClientRect().top) : null,
    aboveTabs: tabs ? (r.top < tabs.getBoundingClientRect().top) : null,
    aboveFirstSec: firstSec ? (r.top < firstSec.getBoundingClientRect().top) : null,
    gapBelowHead: Math.round(r.top - page.querySelector('.chat-head').getBoundingClientRect().bottom),
    bg: cs.backgroundColor, chipBg: chipBg, differsFromChip: cs.backgroundColor !== chipBg,
    fw: tcs?tcs.fontWeight:null, fs: tcs?parseFloat(tcs.fontSize):null,
    hasHint: /即时生效/.test(btn.textContent||''),
    pageButtons: counts
  });
})()`);
const o = JSON.parse(String(m));
chk('A1 美化页存在可见的 #dq-drawer', o.visible === true, m);
chk('A2 入口已移出 desk-quick 行（该行只剩 4 个跳转按钮）', o.inQuick === false && o.quickChipCount === 4, m);
chk('A3 排在最前：在搜索框之上', o.aboveSearch === true, m);
chk('A4 排在最前：在 5 个 tab 之上', o.aboveTabs === true, m);
chk('A5 排在最前：在第一个分区之上', o.aboveFirstSec === true, m);
chk('A6 紧贴标题下方（≤ 24px）', typeof o.gapBelowHead === 'number' && o.gapBelowHead <= 24, m);
chk('A7 最显眼：整宽主色条（宽 ≥ 页面 85% 且高 ≥ 46px）', o.w >= o.pageW * 0.85 && o.h >= 46, m);
chk('A8 最显眼：底色与同页小胶囊按钮不同（不再是同款描边小按钮）', o.differsFromChip === true, m);
chk('A9 最显眼：标题加粗放大（≥700 / ≥14px）+ 一行说明', o.fw === '700' && o.fs >= 14 && o.hasHint === true, m);

// ---- B. 行为：点了仍然打开抽屉 ----
await ev("(function(){var b=document.getElementById('dq-drawer');if(b)b.click();return true;})()");
await sleep(800);
const mB = await ev(`(function(){
  var d=document.getElementById('beauty-drawer');
  if(!d) return JSON.stringify({miss:'no-drawer'});
  var r=d.getBoundingClientRect();
  return JSON.stringify({ shown:getComputedStyle(d).display!=='none', h:Math.round(r.height),
    bottomPinned: Math.abs(r.bottom - window.innerHeight) <= 2,
    pctOfVh: Math.round(r.height/window.innerHeight*100),
    title: /边看边调/.test(d.textContent||'') });
})()`);
const oB = JSON.parse(String(mB));
chk('B1 点入口打开边看边调抽屉', oB.shown === true, mB);
chk('B2 抽屉仍是贴底、高度 ≤ 40vh（不盖掉大半个桌面）', oB.bottomPinned === true && oB.pctOfVh <= 40, mB);
chk('B3 抽屉标题仍是「边看边调」', oB.title === true, mB);
chk('B4 全程零未捕获异常', (await ev("JSON.stringify(window.__jsErrors||[])")).length <= 2, await ev("JSON.stringify((window.__jsErrors||[]).slice(-3))"));

ch.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} server.close();
const f = results.filter(x => !x).length;
console.log(f ? ('FAILED ' + f + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length));
process.exit(f ? 1 : 0);
