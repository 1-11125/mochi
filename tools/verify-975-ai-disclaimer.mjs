// verify-975-ai-disclaimer.mjs — #975 开屏两页「问 AI」建议补免责口径（常驻）
// 用户直派（2026-09-21）：「关于开屏的第一页，第二页里说的可以问AI。需要增加：可以问AI只是使用建议，
//   但实际问题问AI也不无法保证100%正确，AI也会出错和骗人，请自行甄别。」
// 落点三处：第一页开屏公告两处「建议直接问 AI」下方各补一条（在线权威源 src/pwa/notice.json ＋
//   离线兜底 src/template.html 两份同步）；第二页强制公告（进入前 · 作者必读公告）底部 note 补同口径
//   （本页「让 AI 修」＋开屏「问 AI」都只是使用建议，答案自行甄别）。哨兵 #975a~e。
// 断言面：src 两份同步且紧跟原句 ／ 产物（根 notice.json + index.html）接入 ／ 无头实测在线与离线路径
//   第一页都渲染出口径 ／ 强制公告页 note 带口径且原句未动 ／ 进入流程零回归 ／ 哨兵登记体检。
// 用法：node tools/verify-975-ai-disclaimer.mjs
//   MOCHI_SERVE_ROOT=<仓外副本目录> 可指向隔离副本（默认 = 本仓根）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

// ===== 口径文案（与 src 一字不差；改文案必须连哨兵 #975a~e 一起改） =====
const D1 = '「可以问 AI」只是使用建议：实际问题时去问 AI，也无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。';
const D2 = '注意：AI 的回答无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。';
const D3 = '另：本页说的「让 AI 修」和开屏公告里的「问 AI」都只是使用建议——AI 无法保证 100% 正确，AI 也会出错和骗人，AI 给的答案请自行甄别。';
const A1 = '使用问题请先看网站里的使用说明与开屏各章节；基础疑问建议直接问 AI。';
const A2 = '问「为什么会出现这个问题」这类基础疑问，建议直接问 AI，比作者回复快。';
const ANOTE = '使用之前请先看第一页的开屏公告，很多问题上面都写了。说实话是公告越来越长了，但是大部分人就是不看，我也没有办法。';

// ===== S 系列：src 静态（两份同步、紧跟原句、原句未动） =====
let jsrc = null;
try { jsrc = JSON.parse(readFileSync(join(root, 'src', 'pwa', 'notice.json'), 'utf8')); } catch (e) {}
const jText = JSON.stringify(jsrc || '');
const aj1 = jText.indexOf(A1), ad1 = jText.indexOf(D1);
const aj2 = jText.indexOf(A2), ad2 = jText.indexOf(D2);
ok(jsrc && ad1 > 0, 'S1 在线权威源 notice.json：互助群公告章补免责条', jsrc ? 'missing' : 'JSON parse fail');
ok(aj1 > 0 && ad1 > aj1 && ad1 - aj1 < A1.length + 120, 'S2 在线：免责条紧跟互助群章「建议直接问 AI」原句之后（不打乱章节顺序）', 'a=' + aj1 + ' d=' + ad1);
ok(ad2 > 0, 'S3 在线权威源 notice.json：报修章补免责条');
ok(aj2 > 0 && ad2 > aj2 && ad2 - aj2 < A2.length + 120, 'S4 在线：免责条紧跟报修章「建议直接问 AI」原句之后', 'a=' + aj2 + ' d=' + ad2);
ok(jText.indexOf(D1, ad1 + 1) < 0 && jText.indexOf(D2, ad2 + 1) < 0, 'S5 在线：两条免责各只出现一次（不重复刷屏）');

const tpl = readFileSync(join(root, 'src', 'template.html'), 'utf8');
const t1 = tpl.indexOf(D1), t2 = tpl.indexOf(D2), t3 = tpl.indexOf(D3);
const ta1 = tpl.indexOf(A1), ta2 = tpl.indexOf(A2), tn = tpl.indexOf(ANOTE);
ok(t1 > 0 && ta1 > 0 && t1 > ta1 && t1 - ta1 < A1.length + 160, 'S6 离线兜底 template.html：互助群章免责条紧跟原句');
ok(t2 > 0 && ta2 > 0 && t2 > ta2 && t2 - ta2 < A2.length + 160, 'S7 离线兜底：报修章免责条紧跟原句');
ok(tn > 0 && t3 > 0 && t3 > tn && tpl.indexOf(ANOTE, tn + 1) < 0, 'S8 第二页强制公告 note：原句未动、免责口径追加在同一段内', 'n=' + tn + ' d=' + t3);
ok(/另：本页说的「让 AI 修」和开屏公告里的「问 AI」都只是使用建议/.test(tpl), 'S9 第二页口径把本页「让 AI 修」与开屏「问 AI」一起纳入免责范围');

// ===== S 系列（续）：哨兵登记体检 =====
const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const s975 = (bm.match(/\{ name: '#975[a-e] /g) || []).length;
ok(s975 === 5, 'S10 build.mjs 登记 #975a~e 共 5 条哨兵', String(s975));
const needles = [...bm.matchAll(/needle: '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]);
const n975 = ["「可以问 AI」只是使用建议：实际问题时去问 AI", D2, '也无法保证 100% 正确——AI 也会出错和骗人，请自行甄别。</p>', D2 + '</p>', 'AI 给的答案请自行甄别。</div>'];
ok(new Set(n975).size === 5 && n975.every((n) => needles.filter((v) => v === n).length === 1), 'S11 本批 5 条 needle 两两不同、且在全部哨兵 needle 中各只出现一次（哑哨兵 B 类零新增；既有存量哑哨兵不归本批管）');
const nCheck = [
  ['#975a', 'pwa/notice.json', n975[0]],
  ['#975b', 'pwa/notice.json', n975[1]],
  ['#975c', 'template.html', n975[2]],
  ['#975d', 'template.html', n975[3]],
  ['#975e', 'template.html', n975[4]]
];
for (const [nm, file, nd] of nCheck) {
  const registered = bm.includes("file: '" + file + "', needle: '" + nd + "'");
  const inSrc = readFileSync(join(root, 'src', file), 'utf8').includes(nd);
  ok(registered && inSrc, 'S12 ' + nm + ' 登记在 ' + file + ' 且 needle 在该 src 文件里真实存在', registered ? (inSrc ? '' : 'needle not in src') : 'not registered');
}

// ===== P 系列：产物接入（根 notice.json + index.html） =====
let jprod = null;
try { jprod = JSON.parse(readFileSync(join(root, 'notice.json'), 'utf8')); } catch (e) {}
const jp = JSON.stringify(jprod || '');
ok(jprod && jp.includes(D1) && jp.includes(D2), 'P1 产物根 notice.json 已带两条免责（联网用户可见）', jprod ? 'missing' : 'JSON parse fail');
const idx = readFileSync(join(root, 'index.html'), 'utf8');
ok(idx.includes(D1) && idx.includes(D2) && idx.includes(D3), 'P2 产物 index.html 已带离线兜底两条＋第二页 note 口径');

// ===== B 系列：无头实测 =====
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));

const bodyHas = () => page.evaluate(([d1, d2, d3]) => {
  const t = document.body.textContent || '';
  return { d1: t.includes(d1), d2: t.includes(d2), d3: t.includes(d3) };
}, [D1, D2, D3]);

await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForFunction(() => !!document.querySelector('.splash-notice-list'), null, { timeout: 20000 }).catch(() => {});
await sleep(1600);
let b = await bodyHas();
ok(b.d1 && b.d2, 'B1 第一页开屏（在线路径）渲染出两处免责口径', JSON.stringify(b));

// 离线兜底：掐掉 notice.json 重载，静态模板路径同样要能看到
await page.route('**/notice.json*', (r) => r.abort());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!document.querySelector('.splash-notice-list'), null, { timeout: 20000 }).catch(() => {});
await sleep(1600);
b = await bodyHas();
ok(b.d1 && b.d2, 'B2 第一页开屏（离线兜底路径）同样渲染出两处免责口径', JSON.stringify(b));
await page.unroute('**/notice.json*');

// 第二页强制公告：走真实进入流程（勾年龄 → 滑到底 → 我已阅读并知晓 → 强制层弹出）
await page.evaluate(() => {
  const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight;
  const c = document.getElementById('splash-age-check');
  if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
});
await sleep(900);
await page.evaluate(() => { const b = document.getElementById('splash-enter'); if (b) b.click(); });
await sleep(700);
const mand = await page.evaluate(() => { const m = document.getElementById('splash-mandatory'); return { shown: !!m && !m.hidden }; });
ok(mand.shown, 'B3 点「我已阅读并知晓」后强制公告层照常弹出（进入流程未被文案改动打断）');
const note = await page.evaluate(() => {
  const n = document.querySelector('.splash-mandatory-note');
  return n ? (n.textContent || '') : null;
});
ok(!!note && note.includes(D3), 'B4 第二页强制公告 note 带免责口径', note ? note.slice(0, 40) : 'null');
ok(!!note && note.includes(ANOTE), 'B5 第二页 note 原句未动（追加而非改写）');
ok(pageErrors.length === 0, 'Z1 全程零 JS 异常', pageErrors.slice(0, 2).join(' | '));

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-975-ai-disclaimer: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
