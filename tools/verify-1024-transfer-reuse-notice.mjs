// verify-1024-transfer-reuse-notice.mjs — #1024 开屏第一页新增「网站公告 · 关于转载与二次创作」
// 用户直派（2026-09-22）：「开屏第一页要写：网站公告 / 关于转载与二次创作 + 四条要求 + 侵权声明」，
// 原文逐字落库，一字未改（四条要求保留原句与句末「；」）。
// 落点：开屏第一页公告（#splash-notice）的**首个章节**（顶部最显眼的一章）＋ 必读摘要新增一条高亮；
//   两份同步——联网用户看 src/pwa/notice.json 的 sections[0]/summary（在线权威源），
//   断网/弱网用户看 src/template.html 的静态兜底 DOM（renderNotice 用在线列表整段替换静态段）。
// 为什么必须是首个章节：用户口径是「开屏第一页要写」＝第一眼可见；静态兜底章节默认折叠，
//   只在摘要里出现会让「不点章节就看不到」的老问题重现（#661d 同族），故摘要同步补一条高亮。
// 不进 build.mjs 哨兵：内容型批次（同 #1022 口径），行为断言由本脚本承担。
// 用法：node tools/verify-1024-transfer-reuse-notice.mjs
//   MOCHI_SERVE_ROOT=<仓外隔离副本目录> 可指向隔离产物（默认 = 本仓根）
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const root = normalize(process.env.MOCHI_SERVE_ROOT || here);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const srv = createServer((req, res) => {
  try {
    const p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const body = readFileSync(p);
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
console.log('serve root = ' + root);

let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  [' + x + ']' : '')); } };

// ===== 用户原文（逐字；改文案必须连本脚本一起改）=====
const TITLE = '网站公告 · 关于转载与二次创作';
const LEAD = '本网站所有字卡内容遵循「开放二传二改」原则，欢迎分享与再创作。但请遵守以下要求：';
const RULES = [
  '转载或二传链接，必须保留作者署名（言序）；',
  '二次创作作品请注明「基于言序作品修改」；',
  '禁止抹除署名、伪装原创、或将内容用于恶意引流；',
  '仅分享网站聊天记录、不涉及搬运字卡的，只需标注 mochi 字卡 tag 即可。',
];
const TAIL = '未经署名转载视为侵权，作者保留追究权利。';

console.log('\n== A 在线权威源 src/pwa/notice.json ==');
let j = null;
try { j = JSON.parse(readFileSync(join(root, 'src/pwa/notice.json'), 'utf8')); } catch (e) {}
ok(!!j, 'notice.json 可解析');
const s0 = j && Array.isArray(j.sections) ? j.sections[0] : null;
ok(!!s0 && s0.h === TITLE, '首章标题＝网站公告 · 关于转载与二次创作', s0 && s0.h);
const flat = s0 && Array.isArray(s0.p) ? s0.p.map((x) => (x && typeof x === 'object' ? (x.b !== undefined ? x.b : x.hl) : x)) : [];
ok(flat[0] === LEAD, '首句＝开放二传二改原则 + 请遵守以下要求（逐字）', flat[0]);
RULES.forEach((r, i) => ok(flat[i + 1] === r, '第 ' + (i + 1) + ' 条要求逐字在位', flat[i + 1]));
ok(flat[5] === TAIL, '收尾＝未署名视为侵权（逐字在位）', flat[5]);
ok(!!s0 && Array.isArray(s0.p) && s0.p[5] && s0.p[5].hl === TAIL, '侵权声明走 hl 高亮条目（与页面红线口径一致）');
ok(!!j && j.summary.some((x) => x && x.hl && x.hl.indexOf('【转载 · 二次创作】') === 0), '摘要新增转载高亮条（不点章节也看得到）');
ok(!!j && j.summary[0] && j.summary[0].hl.indexOf('【有问题先去「关于」找答案') === 0, '摘要第一条未被顶掉（#864/about 断言面不变）');
ok(!!j && (j.sections.find((x) => String(x.h).indexOf('四、许可') === 0) || {}).h !== undefined, '四、许可 · 署名 · 灵感来源 章仍在（未被我方替换/删除）');

console.log('\n== B 离线兜底 src/template.html ==');
const tpl = readFileSync(join(root, 'src/template.html'), 'utf8');
ok(tpl.indexOf('<p class="splash-sec">' + TITLE + '</p>') >= 0, '兜底章节标题在位');
ok(tpl.indexOf('<p class="splash-item">' + LEAD + '</p>') >= 0, '兜底首句在位');
RULES.forEach((r, i) => ok(tpl.indexOf('<p class="splash-bullet">' + r + '</p>') >= 0, '兜底第 ' + (i + 1) + ' 条要求在位'));
ok(tpl.indexOf('<p class="splash-item splash-hl">' + TAIL + '</p>') >= 0, '兜底侵权声明（高亮）在位');
ok(tpl.indexOf('【转载 · 二次创作】所有字卡内容开放二传二改') >= 0, '兜底摘要高亮条在位');
ok(tpl.indexOf('<p class="splash-hl">本站完全免费，个人出资搭建') >= 0, '原有免费/署名摘要条未被删（用户原文保全）');
ok(tpl.indexOf('<p class="splash-sec">互助群公告</p>') >= 0, '互助群公告章仍在（只插入、未替换）');
const o = (tpl.match(/<!--/g) || []).length, c = (tpl.match(/-->/g) || []).length;
ok(o === c, 'HTML 注释配平（未闭合注释会连锁打碎 .phone 结构，#301）', o + '/' + c);

console.log('\n== C 产物实测：真实进入流程渲染第一页 ==');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e && e.message || e)));
await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#splash-notice .splash-toc', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1000);
const r = await page.evaluate((title) => {
  const wraps = Array.from(document.querySelectorAll('#splash-notice .splash-sec-wrap'));
  const head = (w) => { const e = w.querySelector(':scope > .splash-sec'); return e ? e.textContent.trim() : ''; };
  const first = wraps[0] || null;
  const notice = document.getElementById('splash-notice');
  const toc = Array.from(document.querySelectorAll('.splash-toc-chip')).map((x) => x.textContent);
  const nchars = (s) => (s || '').replace(/\s/g, '').length;
  const norm = (s) => (s || '').replace(/\s/g, '');
  return {
    chapterCount: wraps.length,
    firstTitle: head(first),
    firstText: norm(first ? first.textContent : ''),
    tocHasIt: toc.some((x) => x.indexOf(title) >= 0),
    tocCount: toc.length,
    inSummary: norm(document.querySelector('.splash-summary') ? document.querySelector('.splash-summary').textContent : '').indexOf('【转载·二次创作】') >= 0,
    noticeHasTail: norm(notice.textContent).indexOf(norm('未经署名转载视为侵权，作者保留追究权利。')) >= 0,
    keepDisclaimer: norm(notice.textContent).indexOf(norm('本站禁止未满 18 周岁的未成年人使用')) >= 0,
    keepPermit: norm(notice.textContent).indexOf(norm('Mochi字卡为原创独立作品（即原版）')) >= 0,
    firstHasAll: ['网站公告·关于转载与二次创作', '本网站所有字卡内容遵循「开放二传二改」原则，欢迎分享与再创作。但请遵守以下要求：',
      '转载或二传链接，必须保留作者署名（言序）；', '二次创作作品请注明「基于言序作品修改」；',
      '禁止抹除署名、伪装原创、或将内容用于恶意引流；', '仅分享网站聊天记录、不涉及搬运字卡的，只需标注mochi字卡tag即可。',
      '未经署名转载视为侵权，作者保留追究权利。'].every((s) => norm(first ? first.textContent : '').indexOf(s) >= 0),
    ncharsFirst: nchars(first ? first.textContent : ''),
  };
}, TITLE);
ok(r.chapterCount >= 12, '第一页公告章节数 ≥ 12（在线源 11 → 12）', r.chapterCount);
ok(r.firstTitle === TITLE, '渲染后首章就是该公告（第一眼可见）', r.firstTitle);
ok(r.firstHasAll, '首章七段原文（首句 + 四条 + 侵权声明）全部渲染到位');
ok(r.tocHasIt, '目录里能跳转到该章', r.tocCount + ' 章');
ok(r.inSummary, '必读摘要里渲染出转载高亮条');
ok(r.noticeHasTail, '侵权声明在页面上可见');
ok(r.keepDisclaimer, '免责声明内容未被覆盖（只增不改）');
ok(r.keepPermit, '四、许可章的原文仍在（未被新增章替换）');
ok(errs.length === 0, '全程无未捕获 JS 异常', errs.slice(0, 3));
await browser.close();
srv.close();

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
