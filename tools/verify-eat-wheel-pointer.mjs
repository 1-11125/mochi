// ===== 回归脚本：#876 吃什么转盘「转盘抽取」中奖片不在指针下 =====
// 用法：node build.mjs && node tools/verify-eat-wheel-pointer.mjs
//       MOCHI_ROOT=<已构建目录> node tools/verify-eat-wheel-pointer.mjs   （红绿对照：测纯 HEAD 副本时本批应红）
// 背景（用户直派）：「吃什么，转盘抽取显示有bug 抽取后转的东西不在顶部，默认菜单哪个标下方」——
//   转盘停下后高亮片与「今天吃」菜名不在顶部指针（.eat-pointer）下方。
// 根因：中奖片公式 Math.floor(((2π - normalized + slice/2) % 2π) / slice) 把指针当作在转盘**右侧 0 角**
//   （3 点钟方向），而 CSS 里 .eat-pointer 钉在正上方（top:-12px、svg 尖(10,18)朝下＝屏幕 12 点＝画布角
//   3π/2）。转过 normalized 后指针压住的扇区＝画布角 (3π/2 - normalized) 所在片。2~30 格 ×500 组随机角
//   仿真：旧公式与真实指针下扇区 **100% 错位**（静置 n=20 旧公式说第 0 格在指针下、真实是第 15 格）＝
//   高亮片/菜名恒与指针错开约 1/4 圈。主转盘 eatSpinWheel 与切菜单转盘 eatSwitchSpin 同一条公式、同病。
// 修复：抽 eatIdxUnderPtr(normalized, n, slice)（顶部指针几何），两处接线替换；概率/动画/闪烁/震动不动。
// 断言面：S 产物锚（新公式在位＋旧形态不回流＋接线齐＋指针几何前提）/ B 主转盘三轮确定性抽取
//   （种子化 Math.random → 期望菜名 = 几何独立推算的指针下扇区；停盘后读终值（闪烁值不算）＋画布取
//   像素证明高亮白片就在指针下、高亮退去后指针下恢复该扇区本色）/ B4 切菜单转盘同验 / Z 抽取全程零异常。
// 时序（主转盘一次抽取）：点击 → 旋转 3200ms（期间 #eat-dish 是闪烁值，不作数）→ 停盘高亮 1200ms
//   （画布高亮白片）→ 终值文案在停盘 +200ms 落定。脚本在点击后 3600ms 读第一个终值、+500ms 复读比对。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const art = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return ''; } };
const IDX = art('index.html');                 // 内联产物（当前形态 p2-features.js 属 core 内联）
const P2_EXT = art('js/p2-features.js');       // 未来若外置则读外置件
const P2 = P2_EXT.includes('DEF_EAT_DISHES') ? P2_EXT : IDX;

// ---- 几何真相（与页面代码完全独立，本脚本是裁判）----
function norm(a) { return (a % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); }
function idxUnderTopPointer(totalAngle, n) { const slice = 2 * Math.PI / n; return Math.floor(norm(3 * Math.PI / 2 - norm(totalAngle)) / slice) % n; }
function idxAtRightZero(totalAngle, n) { const slice = 2 * Math.PI / n; return Math.floor(norm(2 * Math.PI - norm(totalAngle) + slice / 2) / slice) % n; }
function spinTotal(startAngle, r1, r2) { return startAngle + (3 + r1 * 4) * Math.PI * 2 + r2 * Math.PI * 2; } // 与页面同表达式同结合序
const COLORS = ['#ff6b6b', '#ffa94d', '#69db7c', '#4dabf7', '#f06595', '#ffd43b', '#a9e34b', '#74c0fc', '#e599f7', '#ff922b'].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));

const mDish = P2.match(/const DEF_EAT_DISHES = \[([^\]]*)\]/);
const DISHES = mDish ? mDish[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
const N = DISHES.length;

const results = [];
function check(desc, ok, detail) { results.push({ desc, ok: !!ok }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : '')); }

// ---- S. 产物锚 ----
const NEEDLE_HELPER = 'function eatIdxUnderPtr(normalized, n, slice) { return Math.floor((((3 * Math.PI / 2 - normalized)';
check('S1 顶部指针几何函数在产物（画布角 3π/2 所在片＝指针压住的扇区）', P2.indexOf(NEEDLE_HELPER) >= 0);
check('S2 旧「右侧 0 角」公式不回流（2π-normalized+slice/2；回流＝高亮/菜名恒不在指针下）', P2.indexOf('2 * Math.PI - normalized + slice / 2') < 0);
check('S3 主转盘接线在位（eatSpinWheel → dishes.length）', P2.indexOf('eatIdxUnderPtr(normalized, dishes.length, slice)') >= 0);
check('S3b 切菜单转盘接线在位（eatSwitchSpin → names.length）', P2.indexOf('eatIdxUnderPtr(normalized, names.length, slice)') >= 0);
check('S4 指针几何前提未被挪动（.eat-pointer 仍钉在正上方 top:-12px；挪位则本脚本几何需随之换锚）', /\.eat-pointer\s*\{[^}]*top:-12px/.test(IDX));
check('S5 指针仍尖朝下（svg 多边形 (10,18) 尖、(3,2)(17,2) 底边在上）', P2.indexOf('points="10,18 3,2 17,2"') >= 0);
check('S0 默认菜单解析成功（≥2 道才可转）', N >= 2, 'n=' + N);

// ---- 无头浏览器 ----
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge，请设置 CHROME_PATH'); process.exit(1); }
if (typeof WebSocket !== 'function') { console.error('需要 Node 21+'); process.exit(1); }

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

const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 60));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(tmpdir(), 'mochi-eat-wheel-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
const jsErrors = [];
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
          if (m.method === 'Runtime.exceptionThrown') jsErrors.push(String(m.params && m.params.exceptionDetails && m.params.exceptionDetails.text).slice(0, 120));
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
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) { console.log('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
  return r && r.result ? r.result.value : null;
}

await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

async function bootAndOpenEat() {
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  for (let i = 0; i < 90; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await sleep(1000);
  await evalJs(`(function(){ var s=document.querySelector('.splash'); if(s) s.classList.add('hide'); var q=document.getElementById('qa-close'); if(q) q.click(); })()`);
  await sleep(500);
  for (let i = 0; i < 25; i++) { if (await evalJs('!!document.querySelector(\'.app[data-app="eat"]\')')) break; await sleep(200); }
  await evalJs(`(function(){ var a=document.querySelector('.app[data-app="eat"]'); if(a) a.click(); })()`);
  await sleep(700);
  return evalJs(`(function(){ var p=document.getElementById('page-eat'); return p ? !p.hidden : false; })()`);
}

// 采样转盘顶部扇区一点（半径 0.688r、偏离文字射线 0.361 slice＝字带之外、边界线之内）周围 5×5 像素
// 放置依据：菜名字形沿中线从 r-8 向内铺，半径 d 处字形半角≈315/d 度（d=80 时 ±3.9°）；扇区边线在
// 中线 ±9°（±1px 描边＋AA 再吃 ~1°）⇒ 净空带 ≈ 中线 ±(5~8°)，取 6.5°（=0.361·18°slice）、半径 80。
async function sampleTopSlice(n, offFrac) {
  return evalJs(`(function(){
    var c=document.getElementById('eat-wheel'); if(!c) return null;
    var ctx=c.getContext('2d'); var dpr=window.devicePixelRatio||1;
    var cx=120, cy=120, r=116; var slice=2*Math.PI/${n}; var a=3*Math.PI/2 + ${offFrac}*slice;
    var R=0.688*r; var x=Math.round((cx+R*Math.cos(a))*dpr)-2, y=Math.round((cy+R*Math.sin(a))*dpr)-2;
    var d=ctx.getImageData(x, y, 5, 5).data; var white=0, acc=[0,0,0], tot=25;
    for(var i=0;i<d.length;i+=4){ acc[0]+=d[i]; acc[1]+=d[i+1]; acc[2]+=d[i+2]; if(d[i]>=235&&d[i+1]>=235&&d[i+2]>=235) white++; }
    return { w: white/tot, c: [Math.round(acc[0]/tot), Math.round(acc[1]/tot), Math.round(acc[2]/tot)] };
  })()`);
}
const near = (a, b, tol) => Array.isArray(a) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

// ---- B1~B3. 主转盘三轮（种子化 Math.random；每轮刷新页面保持 eatSpinAngle 起点为 0；旋转期闪烁值不作数）----
const ROUNDS = [
  { r1: 0.13, r2: 0.77 },
  { r1: 0.51, r2: 0.23 },
  { r1: 0.88, r2: 0.62 },
];
let pixelDone = false;
for (let k = 0; k < ROUNDS.length; k++) {
  const { r1, r2 } = ROUNDS[k];
  const opened = await bootAndOpenEat();
  if (!opened) { check('B' + (k + 1) + ' 吃什么页打开', false, 'page-eat 未显示'); continue; }
  await evalJs(`(function(){ window.__sq=[${r1},${r2}]; Math.random=function(){ return window.__sq.length ? window.__sq.shift() : 0.42; }; })()`);
  await evalJs(`document.getElementById('eat-spin').click()`);
  await sleep(3600);                       // 旋转 3200ms＋终值 +200ms 落定，读的一定是终值
  const expIdx = idxUnderTopPointer(spinTotal(0, r1, r2), N);
  const oldIdx = idxAtRightZero(spinTotal(0, r1, r2), N);
  const txt1 = await evalJs(`document.getElementById('eat-dish').textContent`);
  if (k === 0) {
    const hl = await sampleTopSlice(N, 0.361);
    check('B1b 停盘瞬间指针下是高亮白片（1.2s 高亮窗内）', !!hl && hl.w >= 0.7, hl ? 'whiteFrac=' + hl.w.toFixed(2) : 'null');
    pixelDone = true;
  }
  await sleep(500);
  const txt2 = await evalJs(`document.getElementById('eat-dish').textContent`);
  const stable = txt1 === txt2;
  check('B' + (k + 1) + ' 「今天吃」终值 = 指针下扇区的菜（几何推算 idx=' + expIdx + '「' + DISHES[expIdx] + '」；旧公式会指 idx=' + oldIdx + '「' + DISHES[oldIdx] + '」）',
    stable && txt1 === DISHES[expIdx], '实际=' + txt2 + (stable ? '' : '（两次读数不同=' + txt1 + '/' + txt2 + '）'));
  if (k === 0) {
    await sleep(1400);                     // 高亮窗（停盘+1200ms）已过
    const rest = await sampleTopSlice(N, 0.361);
    check('B1c 高亮退去后指针下恢复该扇区本色 colors[' + (expIdx % 10) + ']', !!rest && near(rest.c, COLORS[expIdx % 10], 45), rest ? 'avg=' + rest.c.join(',') : 'null');
  } else {
    await sleep(1200);
  }
}
check('B1b/B1c 像素采样已执行', pixelDone);

// ---- B4. 切菜单转盘（同一条公式第二处接线；modal 造第二个菜单后转；终值读法同主转盘）----
let b4 = false, b4detail = '未执行';
{
  const opened = await bootAndOpenEat();
  if (!opened) b4detail = 'page-eat 未显示';
  else {
    await evalJs(`document.getElementById('eat-menu-btn').click()`);
    await sleep(300);
    await evalJs(`document.getElementById('eat-menu-new').click()`);
    await sleep(400);
    await evalJs(`(function(){ var i=document.getElementById('modal-input'); if(i) i.value='夜宵菜单'; })()`);
    await evalJs(`document.getElementById('modal-ok').click()`);
    await sleep(400);
    await evalJs(`document.getElementById('eat-switch-menu').click()`);
    await sleep(400);
    const ovOpen = await evalJs(`(function(){ var o=document.getElementById('eat-switch-overlay'); return o ? !o.hidden : false; })()`);
    if (!ovOpen) b4detail = '切换菜单浮层未打开（第二个菜单没建成？）';
    else {
      const names = await evalJs(`(function(){ return [].slice.call(document.querySelectorAll('#eat-switch-chips .eat-chip')).map(function(x){ return x.textContent; }); })()`);
      const m = names && names.length >= 2 ? names.length : 0;
      if (m < 2) b4detail = 'chips<2';
      else {
        await evalJs(`(function(){ window.__sq=[0.31,0.66]; Math.random=function(){ return window.__sq.length ? window.__sq.shift() : 0.42; }; })()`);
        await evalJs(`document.getElementById('eat-switch-go').click()`);
        await sleep(3600);                 // 旋转 3200ms＋终值 +200ms；浮层在停盘 +1200ms 才关，读得到
        const expIdx = idxUnderTopPointer(spinTotal(0, 0.31, 0.66), m);
        const nm1 = await evalJs(`document.getElementById('eat-switch-name').textContent`);
        await sleep(400);
        const nm2 = await evalJs(`document.getElementById('eat-switch-name').textContent`);
        b4 = nm1 === nm2 && nm1 === names[expIdx];
        b4detail = '期望「' + names[expIdx] + '」(idx=' + expIdx + ') 实际「' + nm2 + '」' + (nm1 !== nm2 ? '（两次读数不同）' : '');
      }
    }
  }
}
check('B4 切菜单转盘中奖菜单 = 指针下扇区（同公式第二处）', b4, b4detail);

// ---- Z. 抽取全程零 JS 异常 ----
check('Z 全程零 JS 异常', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

chrome.kill(); server.close();
const fail = results.filter((r) => !r.ok).length;
console.log('==== ' + (results.length - fail) + '/' + results.length + ' PASS' + (fail ? '  (FAIL ' + fail + ')' : ''));
process.exit(fail ? 1 : 0);
