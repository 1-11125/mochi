// ===== 验证：使用说明「后台弹窗 / 手机卡顿 / 设备与浏览器限制」三块内容在位且可搜 =====
// 用户直派（2026-09-16）：「后台弹窗也要有使用说明、详细说清楚」「安卓和 iOS 卡顿要给说明和
// 优化建议，让用户去做，也要写在设置里」「很多设备限制和浏览器限制，出现的问题用户以为是
// 网站 bug，也要详细说清楚」。
// 落点：① 使用说明页（设置 → 关于 → 帮助与支持 → 使用说明）新增第 10/11/12 节（长文）；
//      ② 设置页对应行的「功能说明」胶囊（src/js/settings-help.js 的 #bg-notify /
//         #row-perf-optimize / #row-guide / #row-diagnostics）为同口径要点版；
//      ③ 系统分区的「后台通知」行与工具分区的「卡顿自检」行下各加一条可见提示（gs-sub），
//         不点开弹窗也能看到要点。
// 断言分两层：静态锚（src 文本）＋ 无头 Chrome 实跑（节数/计数/页内搜索/胶囊弹窗/设置搜索）。
// 用法：node tools/verify-guide-help.mjs（需本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

// 内存拼装 src（与 build.mjs 同序，不写产物）
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
const tpl = read('template.html');
let html = tpl.replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

let fail = 0, total = 0;
const A = (name, ok, extra) => { total++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };

// ---- S 静态断言：内容锚点在 src 里（不用起浏览器） ----
const sh = read('js/settings-help.js');
A('S1 settings-help 后台弹窗长文在位（使用说明 + 收不到排查）',
  sh.includes('后台弹窗 · 使用说明') && sh.includes('【收不到怎么办】') && sh.includes('【开启步骤（安卓）】'));
A('S2 settings-help 卡顿长文在位（原因 + 占地方实测排序 + 按顺序优化清单）',
  sh.includes('手机卡顿怎么办（安卓 / iPhone）· 使用说明') && sh.includes('【按这个顺序优化') && sh.includes('不要用「清除本地数据」来治卡顿')
  && sh.includes('实测出现过单个聊天数据块 155MB / 1656 条') && sh.includes('别误会：不是让你少存图'));
A('S3 settings-help 使用说明行已登记（#row-guide 说明可被设置搜索命中）', sh.includes("sel: '#row-guide'"));
A('S4 settings-help 设备限制清单入口挂在设备兼容诊断行',
  sh.includes('像 bug 的问题') && sh.includes('使用说明 第 12 节'));
A('S5 使用说明页三节标题在位',
  tpl.includes('后台弹窗 · 怎么用（安卓）') && tpl.includes('手机卡顿怎么办（安卓 / iPhone）') && tpl.includes('设备与浏览器限制（看着像 bug，其实不是）'));
A('S6 设置页两条可见提示（后台通知行 / 卡顿自检行）在位',
  tpl.includes('id="bg-notify-sub"') && tpl.includes('id="perf-help-sub"'));

A('S7 说明页第 11 节含「占地方实测排序 / 卡法不同 / 别误会少存图」三条要点',
  tpl.includes('到底谁在占地方（实测排序）') && tpl.includes('iPhone 和安卓的「卡法」不一样') && tpl.includes('别误会：不是让你少存图'));

// ---- 起本地服务 + 无头 Chrome ----
const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('环境不满足：找不到 Chrome/Edge（设 CHROME_PATH 或安装后重试）'); process.exit(2); }
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vgh-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} try { server.close(); } catch (e) {} });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
      ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
      break;
    }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('环境不满足：无法连接无头浏览器'); process.exit(2); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
await sleep(2600);
// 拆掉开屏 / 问答门 / 新手引导 / 遮罩，停在设置页
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove();
  const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove();
  const m=document.getElementById('modal-mask'); if(m) m.hidden=true;
  document.querySelectorAll('.page').forEach(p=>p.hidden=true);
  const sp=document.getElementById('page-setting'); if(sp) sp.hidden=false; })()`);
await sleep(300);

const setSearch = (q) => ev(`(()=>{ const i=document.getElementById('set-search-input'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1; })()`);
const rowVisible = (sel) => ev(`(()=>{ const r=document.querySelector(${JSON.stringify(sel)}); return !!r && r.style.display!=='none'; })()`);

// ---- P 设置页：胶囊存在 → 点开弹窗内容 → 不跳页 ----
A('P1 设置页「功能说明」胶囊已注入（后台通知 / 卡顿自检 / 使用说明 / 设备兼容诊断）',
  await ev(`['#bg-notify','#row-perf-optimize','#row-guide','#row-diagnostics'].every(s=>{
    const el=document.querySelector(s); if(!el) return false;
    const row=el.closest('.set-row, .gs-row'); return !!(row && row.querySelector('[data-setdesc="'+s+'"]'));
  })`));

const clickCapsule = (sel) => ev(`(()=>{ const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return 0;
  const row=el.closest('.set-row, .gs-row'); if(!row) return 0;
  const t=[...row.querySelectorAll('[data-setdesc]')].find(x=>x.getAttribute('data-setdesc')===${JSON.stringify(sel)});
  if(!t) return 0; t.click(); return 1; })()`);
const modalText = () => ev(`(()=>{ const el=document.getElementById('modal-static'); const m=document.getElementById('modal-mask'); return (el && m && !m.hidden) ? el.textContent : ''; })()`);

await clickCapsule('#bg-notify'); await sleep(200);
let mt = await modalText();
A('P2 后台通知「功能说明」= 后台弹窗完整使用说明',
  mt.includes('后台弹窗 · 使用说明') && mt.includes('后台保活') && mt.includes('离线消息提醒') && mt.includes('iPhone') && mt.includes('测试'),
  'len=' + (mt ? mt.length : 0));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

// 后台保活说明里必须写明「只是浏览器网页保活、没有别的意思」（用户直派补的澄清段）
await clickCapsule('#bg-keepalive'); await sleep(200);
mt = await modalText();
A('P2b 后台保活「功能说明」写明「只是网页保活，没有别的意思」',
  mt.includes('【它只是这个网页的「保活」，没有别的意思】') && mt.includes('不联网上传') && mt.includes('【为什么会影响其他 App 的声音】'),
  'len=' + (mt ? mt.length : 0));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

await clickCapsule('#row-perf-optimize'); await sleep(200);
mt = await modalText();
A('P3 卡顿自检「功能说明」= 卡顿原因 + 占地方排序 + 用户可做的优化清单',
  mt.includes('手机卡顿怎么办（安卓 / iPhone）· 使用说明') && mt.includes('字卡库瘦身') && mt.includes('压缩图片') && mt.includes('不要用「清除本地数据」来治卡顿')
  && mt.includes('实测出现过单个聊天数据块 155MB / 1656 条') && mt.includes('别误会：不是让你少存图'),
  'len=' + (mt ? mt.length : 0));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

await clickCapsule('#row-guide'); await sleep(200);
mt = await modalText();
const stillSetting = await ev(`(()=>{ const g=document.getElementById('page-guide'); const s=document.getElementById('page-setting'); return (!!g && g.hidden) && (!!s && !s.hidden); })()`);
A('P4 使用说明「功能说明」列全 14 节，且点胶囊不会跳页', mt.includes('后台弹窗 · 怎么用（安卓）') && mt.includes('设备与浏览器限制') && stillSetting, 'jump=' + !stillSetting);
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

await clickCapsule('#row-diagnostics'); await sleep(200);
mt = await modalText();
A('P5 设备兼容诊断「功能说明」点名设备/浏览器限制清单', mt.includes('浏览器限制') && mt.includes('第 12 节'));
await ev(`(()=>{ const m=document.getElementById('modal-mask'); if(m) m.hidden=true; })()`);

// 设置搜索：卡顿 / 后台弹窗 / 浏览器限制 都能找到入口行
await setSearch('卡顿'); await sleep(150);
const perfVis = await rowVisible('#row-perf-optimize');
const guideVis = await rowVisible('#row-guide');
A('P6 设置搜索「卡顿」命中 卡顿自检 + 使用说明', perfVis && guideVis);
await setSearch('后台弹窗'); await sleep(150);
A('P7 设置搜索「后台弹窗」命中 使用说明', await rowVisible('#row-guide'));
await setSearch('浏览器限制'); await sleep(150);
A('P8 设置搜索「浏览器限制」命中 设备兼容诊断', await rowVisible('#row-diagnostics'));
await setSearch(''); await sleep(150);

// ---- G 使用说明页：节数 / 计数 / 页内搜索 ----
await ev(`document.getElementById('row-guide').click()`);
await sleep(300);
A('G0 点「使用说明」行进入说明页', await ev(`(()=>{ const g=document.getElementById('page-guide'); return !!g && !g.hidden; })()`));

const secInfo = () => ev(`(()=>[...document.querySelectorAll('#page-guide .lic-grp')].map(g=>({
  num:(g.querySelector('.lg-num')||{}).textContent||'',
  name:(g.querySelector('.lg-name')||{}).textContent||'',
  count:Number((g.querySelector('.lg-count')||{}).textContent||0),
  items:g.querySelectorAll('.lic-li').length,
  hidden:!!g.hidden,
  shown:[...g.querySelectorAll('.lic-li')].filter(li=>li.style.display!=='none').length
})))()`);

const secs = await secInfo();
A('G1 说明页共 14 节、编号 1..14 连续', secs.length === 14 && secs.every((s, i) => s.num === String(i + 1)), 'n=' + secs.length + ' nums=' + secs.map(s => s.num).join(','));
const badCount = secs.filter(s => s.count !== s.items);
A('G2 每节 lg-count 与实际条目数一致', badCount.length === 0, badCount.map(s => s.name + ':' + s.count + '≠' + s.items).join(' '));
const byName = (kw) => secs.find(s => s.name.indexOf(kw) >= 0);
A('G3 三节都在说明页（后台弹窗 10 / 卡顿 11 / 设备限制 12）',
  !!byName('后台弹窗') && byName('后台弹窗').num === '10' && !!byName('手机卡顿') && byName('手机卡顿').num === '11' && !!byName('设备与浏览器限制') && byName('设备与浏览器限制').num === '12');

const guideSearch = async (q) => {
  await ev(`(()=>{ const i=document.getElementById('guide-search'); i.value=${JSON.stringify(q)}; i.dispatchEvent(new Event('input')); return 1; })()`);
  await sleep(120);
  return secInfo();
};
let gs = await guideSearch('卡顿');
let g11 = gs.find(s => s.name.indexOf('手机卡顿') >= 0);
const unrelatedHidden = gs.filter(s => ['快速开始', '功能都在哪里', '许可与免责'].indexOf(s.name) >= 0).every(s => s.hidden);
A('G4 说明页搜「卡顿」→ 第 11 节展开且有命中、无关节隐藏',
  !!g11 && !g11.hidden && g11.shown >= 5 && unrelatedHidden,
  'shown=' + (g11 ? g11.shown : -1) + ' visSecs=' + gs.filter(s => !s.hidden).length + ' unrelatedHidden=' + unrelatedHidden);

gs = await guideSearch('后台弹窗');
const g10 = gs.find(s => s.name.indexOf('后台弹窗') >= 0);
A('G5 说明页搜「后台弹窗」→ 第 10 节展开', !!g10 && !g10.hidden && g10.shown >= 5, 'shown=' + (g10 ? g10.shown : -1));

gs = await guideSearch('桌面版网站');
const g12 = gs.find(s => s.name.indexOf('设备与浏览器限制') >= 0);
A('G6 说明页搜「桌面版网站」→ 第 12 节命中', !!g12 && !g12.hidden && g12.shown >= 1, 'shown=' + (g12 ? g12.shown : -1));

gs = await guideSearch('语音');
A('G7 说明页搜「语音」仍能命中（既有行为未破坏）', gs.some(s => !s.hidden && s.shown > 0), 'visSecs=' + gs.filter(s => !s.hidden).length);

gs = await guideSearch('');
A('G8 清空搜索 → 14 节全部恢复可见', gs.length === 14 && gs.every(s => !s.hidden), 'n=' + gs.length);

const jsErr = await ev('window.__jsErrors ? window.__jsErrors.length : -1');
A('E1 全程无 JS 异常', jsErr === 0 || jsErr === -1, 'jsErrors=' + jsErr);

console.log('\n' + (fail ? 'FAIL ' + fail + ' 项' : 'ALL PASS') + '（共 ' + total + ' 项断言）');
process.exit(fail ? 1 : 0);
