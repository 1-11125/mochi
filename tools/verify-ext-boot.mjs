// ===== 验证脚本：PERF-PLAN 阶段 1「JS 外置化」404 桩裁决门 =====
// 立项：PERF-PLAN §2 裁决门——「core 在 ext 全缺时能正常启动」。实现要点（已核实）：
// verify 一律用时间戳临时 profile 启 Chrome，首屏导航不受 SW 控制，所以「ext 文件按
// 404 供给」是真 404，不会被 SW 缓存兜住。服务端同时计数 /js/* 的 200/404，防
// 「桩没生效、文件其实被加载」的假绿（比读产品诊断环更直接、不依赖产品内部）。
// 断言：
//   S 阶段（正常服务，基线）：S1 ext 全部执行完（__mochiJsFiles−__mochiLoaded＝空）；
//     S2 外置入口 typeof 就绪（openRoom，room.js 暴露的全局）；S3 服务器 /js/* 全 200。
//   G 阶段（/js/* 一律 404）：G1 window.__jsErrors 为空（core 加载期零 ext 依赖）；
//     G2 差集恰等于外置清单（core 全执行、ext 全没执行）；G3 开屏/手机壳/聊天页锚点
//     仍在（文档骨架完整）；G4 服务器侧 /js/* 请求数 ≥20 且全部 404（桩真生效）。
// 用法：node tools/verify-ext-boot.mjs（需 playwright；产物 index.html + js/ 必须已构建）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const isJsArtifact = (p) => extname(p) === '.js' && p.indexOf(sep + 'js' + sep) >= 0;

function makeServer(stubJs404) {
  const stat = { js200: 0, js404: 0 };
  const srv = createServer((req, res) => {
    let p = '';
    try {
      p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
      if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (stubJs404 && isJsArtifact(p)) { stat.js404++; res.writeHead(404); res.end('nf'); return; }
      const body = readFileSync(p);
      if (isJsArtifact(p)) stat.js200++;
      res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      res.writeHead(404); res.end('nf');
      if (p && isJsArtifact(p)) stat.js404++;
    }
  });
  return { stat, ready: new Promise((r) => srv.listen(0, '127.0.0.1', r)), srv };
}

async function bootPage(base, browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 等 __mochiLoaded 增长停滞（defer 外置全部执行完），最长 6s
  let prev = -1, stable = 0;
  for (let i = 0; i < 60 && stable < 8; i++) {
    const n = await page.evaluate(() => (window.__mochiLoaded || []).length);
    if (n === prev) stable++; else { stable = 0; prev = n; }
    await sleep(100);
  }
  const state = await page.evaluate(() => ({
    jsErrors: window.__jsErrors || null,
    expected: window.__mochiJsFiles || null,
    ext: window.__mochiExtFiles || null,
    loaded: window.__mochiLoaded || null,
    hasSplash: !!document.getElementById('splash'),
    hasPhone: !!document.querySelector('.phone'),
    hasChat: !!document.getElementById('page-chat'),
    openRoom: typeof window.openRoom
  }));
  await ctx.close();
  return state;
}

let fails = 0;
function check(tag, desc, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + tag + ' ' + desc + (detail ? '  [' + detail + ']' : ''));
  if (!ok) fails++;
}

const browser = await chromium.launch();

// ===== S 阶段：正常服务（基线，证明外置接线正确、全部可执行） =====
{
  const srv1 = makeServer(false);
  await srv1.ready;
  const base = 'http://127.0.0.1:' + srv1.srv.address().port;
  const state = await bootPage(base, browser);
  const missing = (state.expected || []).filter((n) => (state.loaded || []).indexOf(n) < 0);
  check('S1', '正常服务：期望清单全部执行完（差集=空）', state.expected && state.loaded && missing.length === 0, 'missing=' + missing.join(','));
  check('S2', '正常服务：外置入口 typeof 就绪（openRoom）', state.openRoom === 'function', 'typeof=' + state.openRoom);
  check('S3', '正常服务：/js/* 全部 200 且有请求', srv1.stat.js200 >= 20 && srv1.stat.js404 === 0, '200=' + srv1.stat.js200 + ' 404=' + srv1.stat.js404);
  srv1.srv.close();
}

// ===== G 阶段：/js/* 一律 404（core 在 ext 全缺时独立启动） =====
{
  const srv2 = makeServer(true);
  await srv2.ready;
  const base = 'http://127.0.0.1:' + srv2.srv.address().port;
  const state = await bootPage(base, browser);
  const missing = (state.expected || []).filter((n) => (state.loaded || []).indexOf(n) < 0);
  const extMissing = (state.ext || []).slice().sort();
  const missingSorted = missing.slice().sort();
  check('G1', '404 桩：window.__jsErrors 为空', Array.isArray(state.jsErrors) && state.jsErrors.length === 0, JSON.stringify(state.jsErrors));
  check('G2', '404 桩：差集恰等于外置清单（core 全执行、ext 全缺）', JSON.stringify(missingSorted) === JSON.stringify(extMissing) && missing.length > 0, 'missing=' + missing.length + '/' + (state.expected || []).length);
  check('G3', '404 桩：开屏/.phone/聊天页锚点仍在', state.hasSplash && state.hasPhone && state.hasChat, 'splash=' + state.hasSplash + ' phone=' + state.hasPhone + ' chat=' + state.hasChat);
  check('G4', '404 桩：/js/* 有请求且全部 404（桩真生效）', srv2.stat.js404 >= 20 && srv2.stat.js200 === 0, '200=' + srv2.stat.js200 + ' 404=' + srv2.stat.js404);
  srv2.srv.close();
}

await browser.close();
console.log(fails === 0 ? '\nverify-ext-boot: ALL PASS' : '\nverify-ext-boot: ' + fails + ' FAIL');
process.exit(fails === 0 ? 0 : 1);
