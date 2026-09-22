// verify-973-splash-top-warn.mjs — #973 开屏最顶端「使用前必看」标红提醒卡（常驻）
// #981（2026-09-21）用户重写顶卡文案为四段（工具与个人理解 / 需给适应时间或不适用建议不用 / 回复设置概率与功能时间概率全部公开可调、
//   功能可关 / 聊天字卡可按分组或单张关、默认聊天字卡的词典字卡太多不适用建议关闭），本脚本文案类断言随之更新；
//   位置/红色形态/摘要口径/门控类断言不变。
// #1019（2026-09-22）用户追加第 5 段（「字卡回复高频和通话高频都可以自行调整」＋「不要因为帮人修不同手机型号的设备兼容bug，
//   就把我的功能和设计也当成bug」＋「已无力解释，可自行在功能说明里查看」），段数 4→5、新增 S13b~S13d 三条文案断言；
//   几何余量实测（390×844）＝顶卡 252px → 357px（限 420px）、#864 指引条 top 607 → 712（vh 844，仍在首屏）（同 tip 纯 HEAD 对照跑过）。
// #1046（2026-09-22）用户直派追加第 6 段（重申工具属性、好不好用取决于个人 ＋ 任何设置都没自己调整就报不好用/混乱＝开屏里已经
//   提示和强调过、需按个人使用自行设置），段数 5→6、新增 S13e/S13f 两条文案断言；不加行距收紧时卡高 357→495px 会把
//   #864 指引条挤出首屏（top 885 > vh 844），同批把顶卡行距 1.8→1.6、段间距/内边距/下边距微收（字号 12.5px、颜色、内容一字不动），
//   收紧后实测顶卡 495→435px、#864 指引条 top 885→825（vh 844，仍在首屏）；S5 上限随本批 420→470（S6 首屏边界断言不变、仍硬）。
// 用户直派（2026-09-21）：「开屏顶部最显眼还需要标红提醒：网站内置内容非常非常多，不适用就建议不用这个网站。
//   或给适应一定时间，回复设置概率什么的，全部都是公开的可以自己调，功能也可以自己设置关闭。」
//   ＋追补两条：「加上：系统预设字卡觉得不好用，也可以自己关闭，一直都是全部公开的，全部都可以自己调。」
//               「加上：抱着必定好用的想法是不可能实现的，都需要适应和调整。」
// 结构（本批定型）：顶卡只留三句（≈270px 高，压在首屏内、不挤掉 #864 指引条），四条可调入口的明细落在必读摘要第 2 条。
// #976（2026-09-21）：7 张必读卡整组前移到品牌卡之前（#splash-mustread），本脚本 B1 的五张卡选择器随口径平移
//   （只关心「一张不少」，组内次序与颜色语义由 tools/verify-976-splash-order-colors.mjs 专判）。
// 无头实机断言：红卡在开屏顶部（.splash-box 首个子节点、排在品牌卡之前、首屏内完整可见）、红色形态（亮/暗主题）、
//   文案含用户三条口径 + 关键词、摘要两条口径在线/离线一致、其余开屏卡与「滑到底才能进入」门控零回归，
//   并守住跨批边界：顶卡不得把 #864「公告已精简」指引条挤出首屏。
// 用法：node tools/verify-973-splash-top-warn.mjs
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const probe = () => page.evaluate(() => {
  const box = document.getElementById('splash-box');
  const card = document.querySelector('.splash-bigwarn');
  const brand = document.querySelector('.splash-brandcard');
  const abouttip = document.querySelector('[data-about-tip]');
  const cs = card ? getComputedStyle(card) : null;
  const tEl = card ? card.querySelector('.splash-bigwarn-t') : null;
  const r = card ? card.getBoundingClientRect() : null;
  const at = abouttip ? abouttip.getBoundingClientRect() : null;
  const hls = Array.from(document.querySelectorAll('.splash-summary .splash-hl')).map((p) => p.textContent || '');
  return {
    hasCard: !!card,
    firstChild: !!(box && card && box.firstElementChild === card),
    beforeBrand: !!(card && brand && (card.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
    inFirstScreen: !!(r && box && box.scrollTop === 0 && r.top >= 0 && r.bottom <= window.innerHeight + 1),
    rect: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) } : null,
    aboutTipTop: at ? Math.round(at.top) : null,
    vh: window.innerHeight,
    title: tEl ? tEl.textContent.trim() : '',
    text: card ? card.textContent : '',
    strongColor: card ? (card.querySelector('strong') ? getComputedStyle(card.querySelector('strong')).color : '') : '',
    borderColor: cs ? cs.borderLeftColor : '',
    borderWidth: cs ? cs.borderLeftWidth : '',
    bg: cs ? cs.backgroundColor : '',
    titleColor: tEl ? getComputedStyle(tEl).color : '',
    noHOverflow: !!(box && box.scrollWidth <= box.clientWidth + 1),
    hls: hls,
    otherCards: {
      antiScam: document.querySelectorAll('#splash-mustread .splash-alert[data-anti-scam="1"]').length,
      browser: document.querySelectorAll('#splash-mustread [data-browser-warn]').length,
      what: document.querySelectorAll('#splash-mustread .splash-alert[data-anti-scam="w"]').length,
      disclaimer: document.querySelectorAll('#splash-mustread .splash-alert[data-anti-scam="d"]').length,
      cardlock: document.querySelectorAll('#splash-cardlock').length,
      stopupdate: document.querySelectorAll('.splash-stopupdate').length,
      abouttip: document.querySelectorAll('[data-about-tip]').length
    }
  };
});

await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 40000 });
await page.waitForFunction(() => !!document.querySelector('.splash-bigwarn'), null, { timeout: 20000 }).catch(() => {});
await sleep(1600); // 等开屏入场动画（splash-fade-up .6s）落定再量几何

let s = await probe();

// ===== 位置：开屏顶部最显眼处 =====
ok(s.hasCard, 'S1 开屏存在 #973 红卡 .splash-bigwarn');
ok(s.firstChild, 'S2 它是 .splash-box 的首个子节点（＝开屏顶部第一位）');
ok(s.beforeBrand, 'S3 它排在品牌卡 .splash-brandcard 之前（比 #793/#864 更靠前）');
ok(s.inFirstScreen, 'S4 未滚动时整张卡完整落在首屏内（进页第一眼可见）', JSON.stringify(s.rect));
ok(s.rect && s.rect.h <= 470, 'S5 顶卡高度受控（≤470px，#1046 六段＋行距收紧后的上限；不喧宾夺主、真正的首屏边界由 S6 钉）', s.rect ? s.rect.h + 'px' : 'null');
ok(s.aboutTipTop !== null && s.aboutTipTop < s.vh, 'S6 跨批边界：#864「公告已精简」指引条仍落在首屏滚动区（top < vh，与 #864 脚本同口径；顶卡占第一屏顶位后它被底部卡片压住一截，要完整看需轻微下滑——如需恢复完整可见只能缩短顶卡）', 'top=' + s.aboutTipTop + ' vh=' + s.vh);

// ===== 文案：用户定稿口径 =====
ok(/使用前必看/.test(s.title) && /本站内容非常多/.test(s.title) && /不适用建议不使用/.test(s.title), 'S7 标题写明「使用前必看 · 本站内容非常多，不适用建议不使用本站」', s.title);
ok(/网站本质只是工具/.test(s.text) && /使用效果取决于个人使用和个人理解/.test(s.text) && /各种原因都需要适应和调整/.test(s.text), 'S8 第 1 段＝「网站本质只是工具，使用效果取决于个人使用和个人理解，各种原因都需要适应和调整」');
ok(/内置内容非常非常多/.test(s.text) && /需给一定时间适应和根据个人使用习惯调整/.test(s.text) && /不适用建议不使用这个网站/.test(s.text), 'S9 第 2 段＝「网站内置内容非常非常多，需给一定时间适应和根据个人使用习惯调整，或不适用建议不使用这个网站」');
ok(/回复设置概率/.test(s.text) && /非常多功能的时间和概率/.test(s.text) && /全部都是公开的可以自己调/.test(s.text), 'S10 第 3 段＝「回复设置概率，非常多功能的时间和概率，全部都是公开的可以自己调」');
ok(/功能也可以自己设置关闭/.test(s.text), 'S11 第 3 段含「功能也可以自己设置关闭」');
ok(/聊天字卡也可以单独关闭某个分组或关闭某个单独的字卡/.test(s.text), 'S12 第 4 段＝「聊天字卡也可以单独关闭某个分组或关闭某个单独的字卡」');
ok(/默认聊天字卡的词典字卡太多，不适用建议关闭/.test(s.text), 'S13 第 4 段新增＝「默认聊天字卡的词典字卡太多，不适用建议关闭」（哨兵 #981a）');
ok(/字卡回复高频和通话高频都可以自行调整/.test(s.text), 'S13b 第 5 段＝「字卡回复高频和通话高频都可以自行调整」（用户 2026-09-22 直派追加；哨兵 #1019a）');
ok(/不同手机型号的设备兼容bug/.test(s.text) && /就把我的功能和设计也当成bug啊/.test(s.text), 'S13c 第 5 段＝作者口径「不要因为帮人修不同手机型号的设备兼容bug，就把我的功能和设计也当成bug」逐字保留（哨兵 #1019b）');
ok(/已无力解释，可自行在功能说明里查看/.test(s.text), 'S13d 第 5 段收尾＝「已无力解释，可自行在功能说明里查看」（指向 settings-help 的「回复设置」「通话设置」两行）');
ok(/这个字卡网站本质只是工具/.test(s.text) && /好不好用取决于个人/.test(s.text), 'S13e 第 6 段前半＝「这个字卡网站本质只是工具，好不好用取决于个人」（用户 2026-09-22 直派追加；哨兵 #1046a 前半口径）');
ok(/如果说任何设置都没有自己调整/.test(s.text) && /开屏里已经提示和强调过了需按个人使用自行设置/.test(s.text), 'S13f 第 6 段后半＝「任何设置都没自己调整就报不好用/混乱 ⇒ 开屏里已经提示和强调过了，需按个人使用自行设置」（哨兵 #1046a/#1046b）');
const paras = await page.evaluate(() => document.querySelectorAll('.splash-bigwarn > p').length);
ok(paras === 6, 'S14 顶卡正文恰好 6 段（#981 用户四段 ＋ #1019 第 5 段 ＋ #1046 第 6 段，逐字照抄、未增未删）', 'p=' + paras);

// ===== 明细：必读摘要第 2 条（在线渲染 + 静态兜底同口径） =====
const sum2 = s.hls[1] || '';
ok(s.hls[0] && /有问题先去「关于」找答案/.test(s.hls[0]), 'S14 摘要首条仍是 #620 的「先去关于找答案」（顶卡插在第 2 条，不动首条口径）', (s.hls[0] || '').slice(0, 24));
ok(/不适用建议不使用/.test(sum2) && /本质只是工具/.test(sum2), 'S15 摘要第 2 条＝顶卡同口径（不适用建议不使用 + 本质只是工具）', sum2.slice(0, 30));
ok(/回复设置/.test(sum2) && /调 0 = 不触发/.test(sum2) && /总档/.test(sum2) && /隐藏池/.test(sum2) && /整组停用/.test(sum2) && /搜索框/.test(sum2), 'S17 摘要第 2 条含可调入口明细（回复设置 / 总档 / 隐藏池 / 整组停用 / 搜索框）');
ok(/默认聊天字卡的词典字卡太多/.test(sum2) && /字卡库 → 词典/.test(sum2), 'S18 摘要第 2 条补了「词典字卡在哪关」（字卡库 → 词典；哨兵 #981b）');

// ===== 形态：标红（亮色 + 暗色） =====
ok(s.borderWidth === '4px' && s.borderColor === 'rgb(210, 52, 48)', 'S17 红色左竖条 4px（#d23430）', s.borderWidth + ' / ' + s.borderColor);
ok(s.bg === 'rgb(253, 236, 236)', 'S18 淡红底（#fdecec）', s.bg);
ok(s.titleColor === 'rgb(194, 43, 39)' && s.strongColor === 'rgb(194, 43, 39)', 'S19 标题与强调字均为警示红（#c22b27）', s.titleColor + ' / ' + s.strongColor);
ok(s.noHOverflow, 'S20 新卡未把开屏撑出横向溢出');

await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
await sleep(120);
const dk = await probe();
ok(dk.bg === 'rgba(210, 52, 48, 0.2)' && dk.borderColor === 'rgb(255, 107, 107)', 'S21 暗色主题红卡底色/描边切换', dk.bg + ' / ' + dk.borderColor);
ok(dk.titleColor === 'rgb(255, 143, 143)' && dk.strongColor === 'rgb(255, 143, 143)', 'S22 暗色主题标题/强调字提亮为 #ff8f8f', dk.titleColor);
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

// ===== 其余开屏卡零回归 =====
ok(s.otherCards.antiScam === 1 && s.otherCards.browser === 1 && s.otherCards.what === 1 && s.otherCards.disclaimer === 1 && s.otherCards.cardlock === 1, 'B1 必读卡组五张卡各仍在位（防倒卖/安卓浏览器/使用前提/免责/字卡锁；#976 起在 #splash-mustread）', JSON.stringify(s.otherCards));
ok(s.otherCards.stopupdate === 1 && s.otherCards.abouttip === 1, 'B2 品牌卡内 #793 停更公告与 #864 公告精简条仍在位', JSON.stringify(s.otherCards));

// ===== 时钟回填 + pwa 5s 看门狗跑过之后，红卡仍在首位（不被摘掉/挪位） =====
await sleep(5200);
const after = await probe();
ok(after.hasCard && after.firstChild && after.beforeBrand, 'B3 开屏回填与 5s 看门狗跑过后，红卡仍在 .splash-box 首位');

// ===== 在线 notice.json（权威源）与静态兜底两份同步 =====
const json = JSON.parse(readFileSync(join(root, 'notice.json'), 'utf8'));
const j = (json.summary || []).map((x) => x.hl || '');
ok(/有问题先去「关于」找答案/.test(j[0] || ''), 'S23 notice.json summary 首条未动（仍是「先去关于找答案」）', (j[0] || '').slice(0, 24));
ok(/不适用建议不使用/.test(j[1] || '') && /本质只是工具/.test(j[1] || '') && /整组停用/.test(j[1] || ''), 'S24 notice.json summary 第 2 条＝同口径（不适用建议不使用 + 本质只是工具 + 字卡整组停用）', (j[1] || '').slice(0, 30));

// 离线兜底：掐掉 notice.json 后重载，静态列表第 2 条必须仍是同口径
await page.route('**/notice.json*', (r) => r.abort());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!document.querySelector('.splash-bigwarn'), null, { timeout: 20000 }).catch(() => {});
await sleep(1800);
const off = await probe();
ok(/不适用建议不使用/.test((off.hls[1] || '')) && /本质只是工具/.test((off.hls[1] || '')), 'S25 离线兜底（notice.json 拉不到）时静态摘要第 2 条仍是同口径', (off.hls[1] || '').slice(0, 30));
ok(off.hasCard && off.firstChild, 'S26 离线兜底时红卡本身照常在最顶端');
await page.unroute('**/notice.json*');

// ===== 进入门控零回归（新增高度不得破坏「滑到底才能进入」） =====
const pre = await page.evaluate(() => {
  const b = document.getElementById('splash-enter');
  const c = document.getElementById('splash-age-check');
  if (c && !c.checked) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
  return { exists: !!b, hidden: b ? b.hidden : null, disabled: b ? b.classList.contains('is-disabled') : null };
});
ok(pre.exists && (pre.hidden === true || pre.disabled === true), 'B4 未滑到底时进入按钮不可点（门控在）', JSON.stringify(pre));
await page.evaluate(() => { const b = document.getElementById('splash-box'); if (b) b.scrollTop = b.scrollHeight; });
await sleep(900);
const post = await page.evaluate(() => {
  const b = document.getElementById('splash-enter');
  return { hidden: b ? b.hidden : null, disabled: b ? b.classList.contains('is-disabled') : null };
});
ok(post.hidden === false && post.disabled === false, 'B5 滑到底后进入按钮可点', JSON.stringify(post));
await page.evaluate(() => { const b = document.getElementById('splash-enter'); if (b) b.click(); });
await sleep(700);
const mand = await page.evaluate(() => { const m = document.getElementById('splash-mandatory'); return { shown: !!m && !m.hidden }; });
ok(mand.shown, 'B6 点进入后强制公告层照常弹出（进入流程未被新卡打断）');
await page.evaluate(() => {
  const sc = document.getElementById('splash-mandatory-scroll');
  if (sc) sc.scrollTop = sc.scrollHeight;
});
// 强制层按钮置灰由 scroll 事件驱动（clock.js checkMandScrolled），等它自己转可点再点
const mandReady = await page.waitForFunction(() => {
  const e = document.getElementById('splash-mandatory-enter');
  return !!e && !e.classList.contains('is-disabled');
}, null, { timeout: 6000 }).then(() => true).catch(() => false);
const mandState = await page.evaluate(() => {
  const sc = document.getElementById('splash-mandatory-scroll');
  const e = document.getElementById('splash-mandatory-enter');
  return {
    scroll: sc ? { top: Math.round(sc.scrollTop), h: sc.scrollHeight, ch: sc.clientHeight } : null,
    disabled: e ? e.classList.contains('is-disabled') : null
  };
});
ok(mandReady, 'B6b 强制公告层滑到底后确认按钮转为可点', JSON.stringify(mandState));
await page.evaluate(() => { const e = document.getElementById('splash-mandatory-enter'); if (e && !e.classList.contains('is-disabled')) e.click(); });
await sleep(1200);
const entered = await page.evaluate(() => { const s = document.getElementById('splash'); return !s || s.classList.contains('hide') || s.hidden; });
ok(entered, 'B7 强制层滑到底确认后正常进入（开屏隐藏）');

await browser.close();
srv.close();
console.log('\n' + (fail === 0 ? '✅' : '❌') + ' verify-973-splash-top-warn: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
