// ===== 专项验证：#658 开屏「为什么慢」说明（用户直派：用户只想知道开屏为什么卡顿，总以为卡顿是 bug） =====
// 需求：① 公告（在线 notice.json / 离线 template.html 双份）写明「打开 / 开屏时偶尔慢一下，多半不是 bug」
//       及原因（整站代码要读完 + 本机数据要读回；只有公告文案与版本检测需要联网）；
//       ② 等得较久时在加载提示下就地补一行原因，用户不必去翻公告章节。
// 用例组：
//   A 默认（快）：加载提示在位，解释行默认隐藏——不能一上来就多一行文字
//   B 数据慢（slow）：派发 mochi-restore-slow → 加载文案转「数据较多，仍在加载…」且解释行出现
//   C 数据就绪且页面加载完：解释行收回（没在等就不解释）
//   D 文案：解释行含「不是坏了」；公告章节含该块（离线兜底 DOM + 在线 notice.json 源）
//   E 样式：.splash-loading-sub 规则已进样式表
//   F 无 JS 异常
// 说明：本脚本直接从 src/ 拼测试页（同 verify-entry-flow.mjs），不依赖已构建产物，改完 src 即可跑。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
let cssFiles = [], jsFiles = [];
{
  const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
  cssFiles = (bm.match(/const cssFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  jsFiles = (bm.match(/const jsFiles = \[([^\]]+)\]/) || [])[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
let testHtml = readFileSync(join(root, 'src/template.html'), 'utf8');
const cssAll = cssFiles.map((f) => readFileSync(join(root, 'src/css', f), 'utf8')).join('\n');
testHtml = testHtml.replace('/*__STYLES__*/', cssAll);
testHtml = testHtml.replace('/*__SCRIPTS__*/', jsFiles.map((f) => '(function () { try {\n' + readFileSync(join(root, 'src/js', f), 'utf8') + '\n} catch (__e) { if (window.__jsErrors) window.__jsErrors.push(String(__e && __e.message || __e)); } })();').join('\n'));
testHtml = testHtml.split('__BUILD_INFO__').join('verify-splash-slow-hint').split('__BUILD_TS__').join(String(Date.now())).split('__APP_VERSION__').join('v0.0.0');
const tmpRoot = join(process.env.TEMP || '/tmp', 'mochi-splash-slow-' + Date.now());
mkdirSync(tmpRoot, { recursive: true });
writeFileSync(join(tmpRoot, 'index.html'), testHtml);
const server = createServer((req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    // notice.json 显式指向 src 源：根目录那份是构建产物，可能还没重建（本脚本要能在改完 src 后直接跑）
    let p = rel === '/notice.json' ? join(root, 'src/pwa/notice.json') : normalize(join(tmpRoot, rel));
    if (rel !== '/notice.json' && !p.startsWith(tmpRoot)) { res.writeHead(403); res.end(); return; }
    let hit = false;
    try { hit = statSync(p).isFile(); } catch (e) {}
    if (!hit) {
      p = normalize(join(root, rel));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      try { hit = statSync(p).isFile(); } catch (e) {}
    }
    if (!hit) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9600 + Math.floor(Math.random() * 100));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=390,844', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-splash-slow-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });

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
  if (r && r.exceptionDetails) { console.error('JS 异常:', JSON.stringify(r.exceptionDetails).slice(0, 400)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? ' —— ' + JSON.stringify(extra) : '')); }
}

// 开屏状态读取：加载提示文案 / 解释行可见性、文案 / 元素是否带 hidden 属性
const STATE = `(function () {
  const sub = document.getElementById('splash-loading-sub');
  const load = document.getElementById('splash-loading');
  const vis = (el) => !!(el && !el.hidden && getComputedStyle(el).display !== 'none');
  return {
    hasSub: !!sub,
    subAttrHidden: !!(sub && sub.hasAttribute('hidden')),
    subVisible: vis(sub),
    subText: sub ? sub.textContent : null,
    loadText: load ? load.textContent : null,
    loadVisible: vis(load),
    splashOn: !!document.getElementById('splash') && !document.getElementById('splash').classList.contains('hide')
  };
})()`;
const SLOW = "document.dispatchEvent(new Event('mochi-restore-slow')); true";
// 改完标志位后强制重算开屏态（clock.js 的 updateEnterState 挂在 window load 上）
const REFRESH = "window.dispatchEvent(new Event('load')); true";
const NOT_READY = "window.__mochiDataReady = false; true";
const IS_READY = "window.__mochiDataReady = true; true";

try {
  await cdpConnect();
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  const jsErrors = [];
  const rawHandler = ws.onmessage;
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') jsErrors.push(JSON.stringify(m.params).slice(0, 200));
    if (rawHandler) rawHandler(ev);
  };
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(4200);

  console.log('\n== A 常态（数据已就绪、页面加载完）：不无谓多一行 ==');
  let s = await evalJs(STATE);
  ok('开屏仍在（未被自动进入）', s && s.splashOn === true, s);
  ok('没在等：加载提示已隐藏', s && s.loadVisible === false, s && s.loadText);
  ok('解释行元素存在', s && s.hasSub === true, s);
  ok('解释行随之隐藏（数据就绪不显示）', s && s.subVisible === false, s);

  console.log('\n== B 数据读得慢：就地解释「为什么慢、不是坏了」 ==');
  // 测试环境本机数据极少、瞬间就绪，故把「未就绪」与「慢标志」造出来（两者都是 clock.js 真实读的运行时状态）
  await evalJs(NOT_READY);
  await evalJs(REFRESH);
  await sleep(200);
  s = await evalJs(STATE);
  ok('数据未就绪：加载提示出现且为普通等待文案（短等待不打扰）', s && s.loadVisible === true && /正在加载数据/.test(s.loadText || ''), s && s.loadText);
  ok('短等待时解释行仍隐藏', s && s.subVisible === false, s);
  await evalJs(SLOW);
  await sleep(250);
  s = await evalJs(STATE);
  ok('慢标志生效：文案转「数据较多，仍在加载…」', !!(s && s.loadText && s.loadText.indexOf('数据较多') >= 0), s && s.loadText);
  ok('解释行出现', s && s.subVisible === true, s);
  ok('解释行不再带 hidden 属性', s && s.subAttrHidden === false, s);
  ok('解释行说清「不是坏了」', !!(s && s.subText && s.subText.indexOf('不是坏了') >= 0), s && s.subText);
  ok('解释行说清原因（读代码 / 读本机数据 / 设备与数据量）', !!(s && s.subText && s.subText.indexOf('代码') >= 0 && s.subText.indexOf('本机') >= 0 && s.subText.indexOf('越旧') >= 0), s && s.subText);

  console.log('\n== C 数据随后就绪：没在等就收回解释 ==');
  await evalJs(IS_READY);
  await evalJs(REFRESH);
  await sleep(300);
  s = await evalJs(STATE);
  ok('数据就绪后加载提示隐藏', s && s.loadVisible === false, s);
  ok('解释行随之收回（不残留）', s && s.subVisible === false, s);

  console.log('\n== D 位置与文案：独立成章 + 放显眼处（目录第一位 + 必读摘要高亮），且不在 Bug 章 ==');
  const domText = await evalJs("(function(){ const n=document.getElementById('splash-notice'); return n ? n.textContent : ''; })()");
  const onlineSub = await evalJs("(function(){ const e=document.querySelector('#splash-notice .splash-notice-sub'); return e ? e.textContent : ''; })()");
  ok('在线 notice.json 真渲染了（副标题取在线文案，非 template 兜底）', !!(onlineSub && onlineSub.indexOf('详细说明见目录各章节') >= 0), onlineSub);

  const place = await evalJs(`(function(){
    const wraps = Array.prototype.slice.call(document.querySelectorAll('#splash-notice .splash-sec-wrap'));
    const heads = wraps.map(function (w) { const h = w.querySelector('.splash-sec'); return h ? h.textContent : ''; });
    const hl = Array.prototype.slice.call(document.querySelectorAll('#splash-notice .splash-summary .splash-hl')).map(function (p) { return p.textContent; });
    const bugWrap = wraps.filter(function (w) { return w.textContent.indexOf('关于 Bug、报修与适配') >= 0; })[0];
    return {
      heads: heads,
      first: heads[0] || '',
      inSummary: hl.some(function (t) { return t.indexOf('开屏 / 打开时偶尔慢几秒是正常的，不是 bug') >= 0; }),
      bugHasIt: !!(bugWrap && bugWrap.textContent.indexOf('开屏偶尔慢') >= 0)
    };
  })()`);
  ok('独立成章：章标题「开屏偶尔慢一下，是正常的（不是 bug）」在位', !!(place && place.heads.some((h) => h.indexOf('开屏偶尔慢一下，是正常的（不是 bug）') >= 0)), place && place.heads);
  ok('摆在显眼处：是目录里的第一个章节（默认展开）', !!(place && place.first.indexOf('开屏偶尔慢一下，是正常的（不是 bug）') >= 0), place && place.first);
  ok('必读摘要里有高亮一条（不进章节点也看得到）', !!(place && place.inSummary === true), place);
  ok('Bug 章（二、关于 Bug、报修与适配）不再夹带该解释', !!(place && place.bugHasIt === false), place);
  ok('公告含原因说明（读整站代码 + 读本机数据）', !!(domText && domText.indexOf('整站代码') >= 0 && domText.indexOf('本机的数据') >= 0));
  ok('公告含「只有公告文案和版本检测需要联网」', !!(domText && domText.indexOf('版本检测') >= 0));
  ok('公告含「还一直卡→数据体积→一键优化」去处', !!(domText && domText.indexOf('卡顿自检') >= 0));

  let noticeSrc = null;
  try { noticeSrc = JSON.parse(readFileSync(join(root, 'src/pwa/notice.json'), 'utf8')); } catch (e) {}
  ok('在线源 notice.json：新章就是 sections[0]', !!(noticeSrc && noticeSrc.sections && noticeSrc.sections[0] && noticeSrc.sections[0].h === '开屏偶尔慢一下，是正常的（不是 bug）'), noticeSrc && noticeSrc.sections && noticeSrc.sections[0] && noticeSrc.sections[0].h);
  ok('在线源：摘要含该高亮条', !!(noticeSrc && noticeSrc.summary && JSON.stringify(noticeSrc.summary).indexOf('开屏 / 打开时偶尔慢几秒是正常的，不是 bug') >= 0));
  const bugSec = noticeSrc && noticeSrc.sections && noticeSrc.sections.find((x) => String(x.h).indexOf('二、') === 0);
  ok('在线源：Bug 章已无该解释块（删干净）', !!bugSec && JSON.stringify(bugSec).indexOf('开屏偶尔慢') < 0);
  ok('在线源：新章含原因与去处（口径与离线兜底一致）', !!(noticeSrc && noticeSrc.sections && JSON.stringify(noticeSrc.sections[0]).indexOf('整站代码') >= 0 && JSON.stringify(noticeSrc.sections[0]).indexOf('卡顿自检') >= 0));
  let tplSrc = '';
  try { tplSrc = readFileSync(join(root, 'src/template.html'), 'utf8'); } catch (e) {}
  ok('离线兜底 template.html 同为新章 + 摘要高亮行（断网/弱网用户也看得到）', tplSrc.indexOf('<p class="splash-sec">开屏偶尔慢一下，是正常的（不是 bug）</p>') >= 0 && tplSrc.indexOf('<p class="splash-hl">开屏 / 打开时偶尔慢几秒是正常的，不是 bug') >= 0);

  console.log('\n== E 样式：解释行有独立规则（小字次级色，不抢加载提示） ==');
  ok('.splash-loading-sub 样式规则已进样式表', /\.splash-loading-sub\s*\{/.test(cssAll));
  const styleInfo = await evalJs(`(function(){
    const sub=document.getElementById('splash-loading-sub');
    if(!sub) return null;
    const cs=getComputedStyle(sub);
    return { fs: parseFloat(cs.fontSize), maxw: cs.maxWidth, color: cs.color };
  })()`);
  ok('解释行字号小于加载提示（12px）', !!(styleInfo && styleInfo.fs > 0 && styleInfo.fs < 12), styleInfo);

  console.log('\n== F 无 JS 异常 ==');
  ok('全程无未捕获异常', jsErrors.length === 0, jsErrors.slice(0, 3));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
} catch (e) {
  console.error('脚本异常：', e && e.message || e);
  fail++;
} finally {
  try { if (ws) ws.close(); } catch (e) {}
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  process.exit(fail ? 1 : 0);
}
