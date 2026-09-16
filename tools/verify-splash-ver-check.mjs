// ===== 验证 #570：开屏新版检测（独立功能，开屏直接显示「现在是不是新版」） =====
// 用户指派：「做一个独立的新版检测功能放在开屏显示现在是不是新版」。
// 实现：ver-check.js 冷启动 fetch version.json 一次，比 #splash-ver 的 data-build-ts，
// 在开屏版本块第三行（#splash-ver-check）渲染 检测中 / ✓已是最新 / ⇩有新版本·点此更新；
// 「点此更新」走 pwa.js 暴露的 window.mochiRefreshNow（PRECACHE 预取再 reload）。
// 本脚本：内存拼装 src（与 build.mjs 同序、不写产物）→ 无头 Chrome 实测三种网络结论
// （一致 / 落后 / 拉不到）与静态登记；#629 追加 B4~B7：点更新即记「刷过」标记、刷过却
// 仍落后时换「仍是旧版·点此再试」+ 指引行（等 3~5 分钟 / 换流量 / 别连点）、刷上后清标记。
// 用法：node tools/verify-splash-ver-check.mjs。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');

// 本机（页面）构建 ts：写进 data-build-ts；服务端 version.json 的 ts 由用例改 verTs 控制
const LOCAL_TS = 1789511404054;
let verTs = LOCAL_TS;      // 每个用例改写
let verOk = true;          // false = version.json 404（弱网/离线用例）

let html = readFileSync(join(root, 'src', 'template.html'), 'utf8')
  .replace('__APP_VERSION__', 'v3.26.0-test')
  .replace('__BUILD_TS__', String(LOCAL_TS));
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
  if (url === '/version.json') {
    // verOk=false 模拟真断连（销毁 socket → fetch reject 走 catch）；404 走的是「未能读取」分支
    if (!verOk) { res.socket.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ts: verTs, info: '测试部署' }));
    return;
  }
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
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9800 + Math.floor(Math.random() * 100);
// 每次跑都新建一个 Chrome profile（约 40~55MB）：跑完必须删掉。历次脚本只 kill 不删，
// 曾把 %TEMP% 堆到 1937 个目录 / 67GB → C 盘写满（2026-09-16 实测，连编辑器的 file write
// 都 ENOSPC）。cleanProfile 同时挂在 exit 上兜底（异常退出也不留），正常路径先 kill 再删。
const profileDir = join(process.env.TEMP || '/tmp', 'mochi-vsvc-' + Date.now());
function cleanProfile() { try { rmSync(profileDir, { recursive: true, force: true }); } catch (e) {} }
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profileDir, '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} server.close(); cleanProfile(); });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expr) { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; }

await cdp('Page.enable'); await cdp('Runtime.enable');

let fail = 0;
const A = (name, ok, extra) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + extra : '')); if (!ok) fail++; };
const readLine = () => ev(`(()=>{ const el=document.getElementById('splash-ver-check'); if(!el) return null;
  return { hidden: !!el.hidden, cls: el.className, text: el.textContent, clickable: el.style.cursor === 'pointer' && typeof el.onclick === 'function' }; })()`);

// S 静态断言：登记与锚点在 src 里
const vjs = readFileSync(join(root, 'src', 'js', 'ver-check.js'), 'utf8');
const pwajs = readFileSync(join(root, 'src', 'js', 'pwa.js'), 'utf8');
const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const bcss = readFileSync(join(root, 'src', 'css', 'base.css'), 'utf8');
A('S1 ver-check.js 已登记进 jsFiles', arr('jsFiles').indexOf('ver-check.js') > 0);
A('S2 开屏锚点 #splash-ver-check 在 template.html', tpl.includes('id="splash-ver-check"'));
A('S3 pwa.js 暴露预取刷新链 mochiRefreshNow', pwajs.includes('window.mochiRefreshNow = function () { refreshNow(); };'));
A('S4 base.css 检测行三态样式在位', bcss.includes('.splash-ver .sv-check.ok') && bcss.includes('.splash-ver .sv-check.stale'));
A('S5 #629 刷过仍落后的判定分支 + 指引三要素在位', vjs.includes('if (retryMarked() || isReloadEntry()) {') && vjs.includes('等 3~5 分钟') && vjs.includes('别再连着点'));

async function nav(tag) { await cdp('Page.navigate', { url: baseUrl + '/?case=' + tag }); await sleep(2200); }

// B1 一致：远端 ts == 本机构建 ts → ✓ 已是最新版（绿、不可点）
await nav('latest');
let r = await readLine();
A('B1 ts 一致 → 「✓ 已是最新版」', !!r && !r.hidden && r.text === '✓ 已是最新版' && r.cls.indexOf('ok') >= 0 && !r.clickable, JSON.stringify(r));

// B2 落后：远端更新 → 有新版本 + 差值人话 + 整行可点（走 mochiRefreshNow）
// （#629：先清掉「刷过」标记，才走首次提示分支；标记逻辑见 B4~B7）
verTs = LOCAL_TS + 21286326; // ≈5.9 小时
await nav('prime1');
await ev("localStorage.removeItem('xy-home-v2:ver-retry')");
await nav('stale');
r = await readLine();
A('B2 落后 → 「⇩ 有新版本（落后约 5.9 小时）· 点此更新」且可点', !!r && !r.hidden && r.text.indexOf('有新版本') >= 0 && r.text.indexOf('落后约 5.9 小时') >= 0 && r.cls.indexOf('stale') >= 0 && r.clickable, JSON.stringify(r));

// B3 拉不到：version.json 404（离线/弱网）→ 未能检测提示、不可点、不误报有新版
verOk = false;
await nav('offline');
r = await readLine();
A('B3 拉不到 → 「未能检测版本」提示且不可点', !!r && !r.hidden && r.text.indexOf('未能检测') >= 0 && r.cls.indexOf('warn') >= 0 && !r.clickable, JSON.stringify(r));
verOk = true;

// ===== #629：刷过却仍旧版 → 换成「仍是旧版·点此再试」+ 怎么才算刷上的指引 =====
// B4 点「点此更新」当场就记「刷过」标记（此时结果未知，故清除点只能放在成功侧）
await nav('prime2');
await ev("localStorage.removeItem('xy-home-v2:ver-retry')");
await nav('stale2');
const tapRes = await ev(`(()=>{ let hit=0; window.mochiRefreshNow=function(){hit=1;};
  const el=document.getElementById('splash-ver-check'); if(el) el.click();
  return { hit:hit, mark:localStorage.getItem('xy-home-v2:ver-retry') }; })()`);
A('B4 点「点此更新」即写「刷过」标记（结果未知）', !!tapRes && tapRes.hit === 1 && !!tapRes.mark, JSON.stringify(tapRes));

// B5/B6 标记还在（＝这台设备更新失败过）+ 仍落后 → 检测行换文案 + 指引行三要素齐全
// 标记由本用例显式写入（不依赖 B4 那一次；B4 只证「点击即写」），并在加载 2.2s 后回读——
// 顺带守住「根键必须登记进 contacts.js 的 EXCLUDE」：漏登记会被 migrateLegacy 当旧顶层业务键
// 迁进 default 桌面并删根键，标记写一次就没了（实测写入后 navigate 2.2s 读回即 null，
// 而且当时检测行早就渲染完了＝断言会假绿，所以必须回读磁盘态而不是只看文案）。
await ev(`localStorage.setItem('xy-home-v2:ver-retry','${verTs}|1|' + Date.now())`);
await nav('retried');
r = await readLine();
const markKept = await ev("localStorage.getItem('xy-home-v2:ver-retry')");
const hint = await ev(`(()=>{const h=document.querySelector('.sv-check-hint');return h?{d:!!h.hidden,t:h.textContent}:null;})()`);
A('B5 刷过仍落后 → 「⇩ 仍是旧版（落后约 5.9 小时）· 点此再试」且仍可点', !!r && !r.hidden && r.text.indexOf('仍是旧版') >= 0 && r.text.indexOf('落后约 5.9 小时') >= 0 && r.cls.indexOf('stale') >= 0 && r.clickable, JSON.stringify(r));
A('B6 指引行可见：等 3~5 分钟 / 换流量 / 别连着点', !!hint && !hint.d && hint.t.indexOf('3~5 分钟') >= 0 && hint.t.indexOf('流量') >= 0 && hint.t.indexOf('别再连着点') >= 0, JSON.stringify(hint));
A('B7 「刷过」标记跨加载存活（根键已登记 contacts.js EXCLUDE）', !!markKept, 'mark=' + markKept);

// B8 终于刷上（ts 一致）→ ✓ 并把标记清掉，下次落后重新回到「点此更新」（不常驻恐吓）
verTs = LOCAL_TS;
await nav('latest2');
r = await readLine();
const markAfter = await ev("localStorage.getItem('xy-home-v2:ver-retry')");
A('B8 更新成功 → 「✓ 已是最新版」且清掉「刷过」标记', !!r && r.text === '✓ 已是最新版' && (markAfter === null || markAfter === undefined), JSON.stringify(r) + ' mark=' + markAfter);

// B9 全程零 JS 错误（device.js 的 __jsErrors 探针）
const e = await ev('window.__jsErrors ? window.__jsErrors.length : -1');
A('B9 零 JS 错误', e === 0, 'errs=' + e);

console.log(fail === 0 ? 'ALL PASS' : 'FAIL ' + fail);
// 先杀浏览器、等文件句柄释放再删 profile（Windows 上锁着的目录删不干净），最后才退出
try { chrome.kill(); } catch (e) {}
await sleep(600);
cleanProfile();
process.exit(fail === 0 ? 0 : 1);
