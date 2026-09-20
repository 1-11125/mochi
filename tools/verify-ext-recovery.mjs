// ===== 验证脚本：#802 外置功能包「加载失败」页面侧自愈 =====
// 立项（用户实报「更多功能里的小功能全部，打开显示加载失败」）：外置化后 35 个 js 任一拉取失败
// ＝该功能永久死、页面零重试。修复三层：build.mjs 外置标签 onerror 记 __mochiExtFail（#802a）／
// pwa.js 三波自动重注入 + 顶部恢复条（#802b）／sw.js js/* 缓存优先+后台刷新（#802c）。
// 本脚本做行为断言（不 mock 产品码，/js/* 故障由服务端真实 404 注入）：
//   S 阶段（正常服务，对照）：S1 全部 ext 执行（差集空）；S2 恢复条从未出现（不误报）。
//   R 阶段（/js/* 一律 404 → 页面加载完成后放开为 200）：
//     R1 结构：产物 index.html 外置标签带 onerror=__mochiExtFail 标记（≥30 条）；
//     R2 恢复条在 ~19s 内出现（三波静默重试后）且文案带计数；
//     R3 诊断环补了 [ext-recovery] 一条；
//     R4 点「点此重试」→ 放开的 200 被重新注入执行：差集清零、window.openDecision 变 function；
//     R5 全部到位后恢复条自动撤下。
// 用法：node tools/verify-ext-recovery.mjs（需 playwright；MOCHI_ROOT 可指仓外副本做红/绿基线：
//       纯 HEAD 副本（无修复）应在 R1/R2/R4 处红＝判别力在）。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const SERVE_ROOT = normalize(process.env.MOCHI_ROOT || root);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const isJsArtifact = (p) => extname(p) === '.js' && p.indexOf(sep + 'js' + sep) >= 0;

let jsFailMode = false; // true：/js/* 一律 404（故障注入）
const stat = { js200: 0, js404: 0 };
const srv = createServer((req, res) => {
  let p = '';
  try {
    p = normalize(join(SERVE_ROOT, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(SERVE_ROOT)) { res.writeHead(403); res.end(); return; }
    if (jsFailMode && isJsArtifact(p)) { stat.js404++; res.writeHead(404); res.end('nf'); return; }
    const body = readFileSync(p);
    if (isJsArtifact(p)) stat.js200++;
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('nf');
    if (p && isJsArtifact(p)) stat.js404++;
  }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;

let fails = 0;
function check(tag, desc, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + tag + ' ' + desc + (detail ? '  [' + detail + ']' : ''));
  if (!ok) fails++;
}
async function newState(ctx) {
  const page = await ctx.newPage();
  return page;
}
async function poll(page, fn, timeoutMs, stepMs) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(stepMs || 300);
  }
}

const browser = await chromium.launch();

// ===== R1 结构断言（读产物 HTML，不需起页面） =====
{
  let html = '';
  try { html = readFileSync(join(SERVE_ROOT, 'index.html'), 'utf8'); } catch (e) {}
  const n = (html.match(/onerror="window\.__mochiExtFail=/g) || []).length;
  check('R1', '产物外置标签带 onerror=__mochiExtFail 标记', n >= 30, '命中 ' + n + ' 条');
}

// ===== S 阶段：正常服务（对照：自愈引擎不得误报） =====
{
  jsFailMode = false;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newState(ctx);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  await sleep(8000); // 盖过第 1、2 波自愈扫描（1.5s/6s）
  const st = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0),
    bar: !!document.getElementById('ext-recovery-bar')
  }));
  check('S1', '正常网络下 ext 全部执行（差集空）', st.missing.length === 0, '缺 ' + st.missing.length);
  check('S2', '正常网络下恢复条从未出现（不误报）', !st.bar, st.bar ? 'bar 在' : '');
  await ctx.close();
}

// ===== R 阶段：故障注入（/js/* 404）→ 页面加载完成后放开 200 → 点恢复条 → 功能复活 =====
{
  jsFailMode = true;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newState(ctx);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });
  const st0 = await page.evaluate(() => ({
    missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0),
    failMarked: (window.__mochiExtFail || []).length
  }));
  check('R0', '故障注入下 ext 缺口与 onerror 标记在案', st0.missing.length >= 30 && st0.failMarked >= 30, '缺 ' + st0.missing.length + ' / 标记 ' + st0.failMarked);
  const barShown = await poll(page, async () => page.evaluate(() => {
    const b = document.getElementById('ext-recovery-bar');
    return !!b && b.hidden === false && /个功能包/.test(b.textContent || '');
  }), 40000, 400);
  check('R2', '三波静默重试后恢复条出现', barShown, '40s 内未出现');
  if (barShown) {
    const diag = await page.evaluate(() => (window.__jsErrors || []).filter((s) => String(s).indexOf('[ext-recovery]') >= 0).length);
    check('R3', '诊断环补 [ext-recovery] 一条', diag >= 1, '命中 ' + diag);
    jsFailMode = false; // 网络恢复
    // 开屏层（#splash）在故障场景可能仍盖在最上（#784 同款教训）：点按走元素 .click()
    //（真实触发监听器），不经坐标命中测试
    await page.evaluate(() => { const b = document.getElementById('ext-recovery-bar'); if (b) b.click(); });
    const healed = await poll(page, async () => page.evaluate(() =>
      (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0).length === 0 &&
      typeof window.openDecision === 'function'
    ), 30000, 400);
    const stEnd = await page.evaluate(() => ({
      missing: (window.__mochiExtFiles || []).filter((f) => (window.__mochiLoaded || []).indexOf(f) < 0),
      openDecision: typeof window.openDecision
    }));
    check('R4', '点重试后缺口清零、功能入口当场复活（无需刷新）', healed && stEnd.missing.length === 0 && stEnd.openDecision === 'function',
      '缺 ' + stEnd.missing.length + ' openDecision=' + stEnd.openDecision);
    const barGone = await poll(page, async () => page.evaluate(() => {
      const b = document.getElementById('ext-recovery-bar');
      return !b || b.hidden === true;
    }), 10000, 300);
    check('R5', '全部到位后恢复条自动撤下', barGone);
  }
  await ctx.close();
}

await browser.close();
srv.close();
console.log('服务器 /js/*：200=' + stat.js200 + ' 404=' + stat.js404 + '（服务根：' + SERVE_ROOT + '）');
console.log(fails ? '✗ verify-ext-recovery 失败 ' + fails + ' 条' : '✓ verify-ext-recovery 全部通过');
process.exit(fails ? 1 : 0);
