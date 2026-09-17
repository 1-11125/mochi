// ===== 专项验证 #694：多字卡「拼接符号」六枚 chips（默认全开 + 逐项开关 + 选中态不被 hover 压掉） =====
// 用户原话（2026-09-17）：「拼接符号，我需要默认空格、。！？...... 全部开启，然后用户可以自己选择开启或关闭某个」
//   ＋「现在我开关好像交互有点问题，就是这个句号点击开，点击关按钮没有颜色变化」。
// 本脚本锁定三条不可回退的性质：
//   A 默认：六枚（空格/，/。/！/？/......）全部选中，含句号（此前默认 py-punct-per=0）；
//   B 逐项开关：点一下关、再点一下开，存储键即时落盘并 toast 反馈，至少保留一个；
//   C 选中态颜色：真实鼠标悬停在选中 chip 上时底色必须仍是选中色（原实现 .ppy-chip.sel
//     特异性 0,2,0 被 `.gs-row .tag:hover` 0,3,0 压掉 → 手指点上去 :hover 常驻，看着像没生效）。
// 用法：node tools/verify-punct-chips.mjs   （RED 对照：MOCHI_PUNCT_OLD=1 会用旧选择器口径重跑 C 门）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
// MOCHI_ROOT=<副本> 可对隔离副本（含其 index.html 产物）直测；MOCHI_PUNCT_SRC=1 强制走 src 自组装
const RW = process.env.MOCHI_ROOT ? normalize(process.env.MOCHI_ROOT) : root;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function read(p) { return readFileSync(join(RW, p), 'utf8'); }
const b = read('build.mjs');
function arrOf(n) { const m = b.match(new RegExp('const ' + n + '\\s*=\\s*\\[([\\s\\S]*?)\\]')); return m ? m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : []; }
let css = '', js = '';
for (const f of arrOf('cssFiles')) { try { css += read('src/css/' + f) + '\n'; } catch (e) {} }
for (const f of arrOf('jsFiles')) { try { js += '/* ' + f + ' */\n' + read('src/js/' + f) + '\n'; } catch (e) {} }
const RED = process.env.MOCHI_PUNCT_OLD === '1';
if (RED) {
  // RED 基线：把选中态选择器还原成修复前的裸 .ppy-chip.sel（会被 .gs-row .tag:hover 压过）
  css = css.replace(/\.ppy-chips \.ppy-chip\.sel[^{]*\{[^}]*\}/g, '')
           .replace(/\[data-theme="dark"\] \.ppy-chips \.ppy-chip\.sel[^{]*\{[^}]*\}/g, '')
           .replace('.ppy-chip.dis {', '.ppy-chip.sel { background:var(--ink,#111); color:#fff; border-color:var(--ink,#111); }\n[data-theme="dark"] .ppy-chip.sel { background:var(--btn-bg,#eee); color:var(--btn-ink,#111); border-color:var(--btn-bg,#eee); }\n.ppy-chip.dis {');
  // 默认值也退回 #650 口径（句号默认关）
  js = js.replace("'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 1", "'py-punct-space': 1, 'py-punct-dou': 1, 'py-punct-per': 0");
}
let page = null;
try { if (!RED && process.env.MOCHI_PUNCT_SRC !== '1') page = read('index.html'); } catch (e) {}
const target = page ? '真实产物 index.html' : 'src 自组装';
if (!page) page = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>' + css + '</style></head><body>' + read('src/template.html') +
  '<scr' + 'ipt>window.__APP_VERSION__="t";</scr' + 'ipt><scr' + 'ipt>' + js + '</scr' + 'ipt></body></html>';
console.log('# 验证对象：' + target + (RED ? '（RED 基线：旧选择器 + 句号默认关）' : ''));
const server = createServer((q, r) => { try { const p = q.url.split('?')[0]; if (p === '/blank.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end('<html><body>b</body></html>'); return; } if (p === '/test.html') { r.writeHead(200, { 'Content-Type': 'text/html' }); r.end(page); return; } r.writeHead(404); r.end(); } catch (e) {} });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cands = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].filter(Boolean);
const cp = cands.find(p => { try { return statSync(p).isFile(); } catch (e) { return false; } });
const tmp = join(os.tmpdir(), 'verifypunct-' + Date.now()); const port = 13100 + Math.floor(Math.random() * 90);
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

// 打开「回复设置 → 字卡与概率」页并把 statusbar/开屏收掉（并行在途稿会干扰点击）
async function openPage() {
  for (let i = 0; i < 40; i++) { if (await ev('!!window.__mochiDataReady') === true) break; await sleep(300); }
  await ev("(function(){var mm=document.getElementById('splash-mandatory');if(mm&&!mm.hidden){var men=document.getElementById('splash-mandatory-enter');if(men)men.click();}var sp=document.getElementById('splash');if(sp&&!sp.classList.contains('hide')){sp.classList.add('hide');sp.hidden=true;}return true;})()");
  await sleep(400);
  await ev("(function(){var ok=document.getElementById('modal-ok');var m=document.getElementById('modal-mask');if(m&&!m.hidden){if(ok)ok.click();if(!m.hidden){m.hidden=true;m.style.display='none';}}return true;})()");
  await sleep(200);
  return ev(`(function(){
    var page=document.getElementById('page-reply-settings'); if(!page) return 'no-page';
    [].forEach.call(document.querySelectorAll('.page'),function(p){ p.hidden = (p!==page); });
    var tab=page.querySelector('.rps-tab[data-rps="cards"]'); if(tab) tab.click();
    var box=document.getElementById('ppy-chips'); if(!box) return 'no-box';
    var pan=box.closest('.rps-panel'); if(pan) pan.hidden=false;
    return 'ok';
  })()`);
}
await cdp('Page.navigate', { url: base + '/test.html' }); await sleep(2500);
chk('S0 回复设置页可打开、pply-chips 存在', (await openPage()) === 'ok', 'open-failed');

// ---- A. 默认六枚全开（含句号） ----
const A = await ev(`(function(){
  var box=document.getElementById('ppy-chips');
  var chips=[].map.call(box.querySelectorAll('.ppy-chip'),function(c){return c.dataset.k+':'+(c.classList.contains('sel')?'1':'0');});
  var cfg=window.replyCfg?window.replyCfg():{};
  return JSON.stringify({ n:box.querySelectorAll('.ppy-chip').length, chips:chips.join(','),
    def:['py-punct-space','py-punct-dou','py-punct-per','py-punct-ex','py-punct-q','py-punct-el'].map(function(k){return cfg[k];}).join(','),
    en:cfg['py-punct-en'] });
})()`);
const oA = JSON.parse(String(A));
chk('A1 六枚符号 chip 顺序为 空格/，/。/！/？/......', oA.n === 6 && oA.chips === 'py-punct-space:1,py-punct-dou:1,py-punct-per:1,py-punct-ex:1,py-punct-q:1,py-punct-el:1', A);
chk('A2 默认配置六键全为 1（含句号 py-punct-per，此前默认 0）', oA.def === '1,1,1,1,1,1', A);
chk('A3 拼接随机标点总开关默认开', oA.en === 1, A);

// ---- C1. 真实悬停：选中态不被 hover 压掉 ----
async function chipRect(k) {
  return ev(`(function(){
    var c=document.querySelector('#ppy-chips .ppy-chip[data-k="${k}"]');
    c.scrollIntoView({block:'center'});
    var r=c.getBoundingClientRect();
    return { x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2), top:Math.round(r.top), bottom:Math.round(r.bottom), ih:window.innerHeight };
  })()`);
}
const bg = (k) => ev(`(function(){var c=document.querySelector('#ppy-chips .ppy-chip[data-k="${k}"]');var s=getComputedStyle(c);return JSON.stringify({bg:s.backgroundColor,color:s.color});})()`);
const hover = async (k) => { const r = await chipRect(k); await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y, button: 'none', buttons: 0 }); await sleep(140); };
const hoverNone = async () => { await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'none', buttons: 0 }); await sleep(140); };
const clickKey = (k) => ev(`(function(){document.querySelector('#ppy-chips .ppy-chip[data-k="${k}"]').click();return true;})()`);
await hoverNone();
const selBase = JSON.parse(String(await bg('py-punct-per')));          // 「。」选中·未悬停
chk('C0 「。」默认即选中态（底色为深色、非透明）', selBase.bg === 'rgb(17, 17, 17)' && selBase.color === 'rgb(255, 255, 255)', JSON.stringify(selBase));
await clickKey('py-punct-dou'); await hoverNone();
const unselBase = JSON.parse(String(await bg('py-punct-dou')));        // 「，」未选中·未悬停
chk('C2 选中态与未选中态底色可辨（不再一模一样）', selBase.bg !== unselBase.bg, JSON.stringify({ selBase, unselBase }));
await clickKey('py-punct-dou'); await hover('py-punct-dou');
const selHover = JSON.parse(String(await bg('py-punct-dou')));         // 「，」选中·悬停（bug 现场：旧版会变浅灰）
chk('C1 悬停在选中的 chip 上底色仍是选中色（原 bug：被 :hover 浅灰压掉）', selHover.bg === selBase.bg && selHover.color === selBase.color,
  JSON.stringify({ selBase, selHover, unselBase }));

// ---- B. 逐项开关（指针停在 chip 上的点按场景） ----
await hover('py-punct-per');
await clickKey('py-punct-per'); await sleep(140);
const B1 = await ev(`(function(){var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-per"]');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-per$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ sel:c.classList.contains('sel'), store:st, cfg:window.replyCfg()['py-punct-per'],
    toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`);
const oB1 = JSON.parse(String(B1));
chk('B1 点「。」即取消选中并落盘 0、toast 提示已关闭', oB1.sel === false && oB1.cfg === 0 && String(oB1.store) === '0' && /拼接符号 。/.test(oB1.toast) && /（关）/.test(oB1.toast), B1);
const bgPerOff = JSON.parse(String(await bg('py-punct-per'))); // 指针仍停在上面（:hover 常驻）
chk('B2 取消选中后「。」底色立刻变为非选中色（hover 常驻也不变回选中样）', bgPerOff.bg !== selBase.bg, JSON.stringify({ bgPerOff, selBase }));
await clickKey('py-punct-per'); await sleep(140);
const B3 = await ev(`(function(){var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-per"]');
  var st=null; for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i); if(/reply-py-punct-per$/.test(k)) st=localStorage.getItem(k);}
  return JSON.stringify({ sel:c.classList.contains('sel'), store:st, cfg:window.replyCfg()['py-punct-per'],
    toast:(document.getElementById('cc-toast')||{}).textContent||'' });})()`);
const oB3 = JSON.parse(String(B3));
chk('B3 再点「。」恢复选中、落盘 1、toast 提示已开启', oB3.sel === true && oB3.cfg === 1 && String(oB3.store) === '1' && /（开）/.test(oB3.toast), B3);
const bgPerOn = JSON.parse(String(await bg('py-punct-per')));
chk('B4 恢复选中后底色回到选中色', bgPerOn.bg === selBase.bg, JSON.stringify({ bgPerOn, selBase }));

// ---- E. 至少保留一个 ----
await clickKey('py-punct-per'); await sleep(80);
for (const k of ['py-punct-dou', 'py-punct-ex', 'py-punct-q', 'py-punct-el']) { await clickKey(k); await sleep(60); }
const E1 = JSON.parse(String(await ev(`(function(){
  document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-space"]').click();
  var c=document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-space"]');
  return JSON.stringify({ sel:c.classList.contains('sel'), cfg:window.replyCfg()['py-punct-space'], toast:(document.getElementById('cc-toast')||{}).textContent||'' });
})()`)));
chk('E1 关掉最后一枚时被拦下（保持选中 + 提示至少保留一个）', E1.sel === true && E1.cfg === 1 && /至少保留一个/.test(E1.toast), JSON.stringify(E1));

// 恢复全开，供 F（持久化）用
for (const k of ['py-punct-space', 'py-punct-dou', 'py-punct-per', 'py-punct-ex', 'py-punct-q', 'py-punct-el']) { await clickKey(k); await sleep(60); }
await clickKey('py-punct-per'); await sleep(120); // 「。」再次关掉，验证重载后仍记得

// ---- F. 持久化：重载后逐项状态被记住 ----
await cdp('Page.reload'); await sleep(2500);
await openPage();
const F = JSON.parse(String(await ev(`(function(){
  var cfg=window.replyCfg();
  return JSON.stringify({ per:cfg['py-punct-per'], others:['py-punct-space','py-punct-dou','py-punct-ex','py-punct-q','py-punct-el'].map(function(k){return cfg[k];}).join(','),
    selPer:document.querySelector('#ppy-chips .ppy-chip[data-k="py-punct-per"]').classList.contains('sel'),
    selN:document.querySelectorAll('#ppy-chips .ppy-chip.sel').length });
})()`)));
chk('F1 重载后「。」仍是用户关闭的状态（存储生效、不回到默认）', F.per === 0 && F.selPer === false, JSON.stringify(F));
chk('F2 重载后其余五枚仍选中（5 枚 sel）', F.others === '1,1,1,1,1' && F.selN === 5, JSON.stringify(F));

// ---- G. 暗色主题同款关系（选中色不被 hover 覆盖） ----
await ev("document.documentElement.setAttribute('data-theme','dark')");
await sleep(150);
const rPer2 = await chipRect('py-punct-per');
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rPer2.x, y: rPer2.y, button: 'none', buttons: 0 });
await sleep(120);
const gSel = JSON.parse(String(await bg('py-punct-per')));
const gR = await chipRect('py-punct-dou');
await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: gR.x, y: gR.y, button: 'none', buttons: 0 });
await sleep(120);
const gUnsel = JSON.parse(String(await bg('py-punct-dou')));
chk('G1 暗色下选中态同样不被 hover 覆盖（且与未选态可辨）', gSel.bg !== gUnsel.bg && gSel.color !== gUnsel.color, JSON.stringify({ gSel, gUnsel }));
await ev("document.documentElement.setAttribute('data-theme','light')");

// ---- H. 零未捕获异常 ----
const errs = await ev("JSON.stringify((window.__jsErrors||[]).slice(-4))");
chk('H1 全程零未捕获异常', String(errs).length <= 2, errs);

ch.kill(); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) {} server.close();
const f = results.filter(x => !x).length;
console.log((RED ? '[RED 基线] ' : '') + (f ? ('FAILED ' + f + '/' + results.length) : ('ALL PASS ' + results.length + '/' + results.length)));
process.exit(f ? 1 : 0);
