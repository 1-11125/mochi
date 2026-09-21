// ===== 常驻回归：#962 屏幕适配微调「只能在设置里盲调」根治（用户 2026-09-21 直派
// 「现在只能在这个设置里面调、不能在桌面的页面调，需要区分在桌面页面调和在聊天页面里调，
//   现在是盲调什么也看不见」；同批收口从未入库的 #940 面板段）=====
// 根因（无头 390×844 实测，零机型分支）：面板贴底 bottom:0 时占距底 0~338px，而底部导航占
// 距底 18~82px、聊天输入栏占距底 0~43px，连收起态也占 0~70px ⇒ 切页的唯一入口（tabbar）与
// 说话的唯一入口（输入栏）被整条盖死，用户在设置里开了面板就再也走不到桌面/聊天页，只能盲调。
// 断言：
//  S 组＝产物源锚（红侧必红）：底部导航/输入栏留白、默认落位、收起成胶囊、看桌面/看聊天直达、
//      页面名、聊天/桌面两处入口与接线、哨兵登记
//  B 组＝行为面（真浏览器，红侧必红）：B1 开面板不压底部导航／B2 收起＝小胶囊且不压导航／
//      B3 胶囊点开复活／B4 聊天页不压输入栏／B5「看聊天」落到聊天页／B6「看桌面」落回桌面页／
//      B7 面板开着仍能点到底部导航（命中测试）／B8 聊天「更多→屏幕适配」开面板并收掉更多面板／
//      B9 装修栏入口接线可用／B10 页面名随页切换（区分桌面/聊天）
//  C 组＝防修过头（两侧同过）：C1 滑杆仍落 LS（本地永久保存语义不变）／C2 全部恢复默认仍归零／
//      C3 面板仍在返回键清单内（tabs.js）／C4 十一个哨兵 needle 各自在登记 file 内唯一
//  Z1 全程零未捕获 JS 异常
// 用法：node tools/verify-962-screen-adj-entry.mjs
//       MOCHI_SERVE_ROOT=<产物目录> 做红绿对照（缺省回退仓库根产物——对照时务必显式传）。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_SERVE_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('SKIP: 找不到 Chrome/Edge'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('SKIP: 需要 Node 21+'); process.exit(2); }
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9960 + Math.floor(Math.random() * 40));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-957-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map(); const jsExcepts = [];
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
          if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params && m.params.exceptionDetails;
            const desc = (d && ((d.exception && d.exception.description) || d.text)) || 'err';
            jsExcepts.push(String(desc).split('\n').slice(0, 2).join(' | ').slice(0, 180));
          }
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
  if (r && r.exceptionDetails) return 'EVAL_ERR:' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  return r && r.result ? r.result.value : null;
}

let pass = 0, fail = 0;
const check = (d, ok, detail) => { if (ok) { pass++; console.log('  PASS  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } else { fail++; console.log('  FAIL  ' + d + (detail !== undefined ? '  [' + detail + ']' : '')); } };

// ---------- S 组：产物源锚（src + 产物双查）----------
console.log('[S] 源锚与哨兵');
const srcPers = (() => { try { return readFileSync(join(root, 'src/js/personalize.js'), 'utf8'); } catch (e) { return ''; } })();
const srcTpl = (() => { try { return readFileSync(join(root, 'src/template.html'), 'utf8'); } catch (e) { return ''; } })();
const srcTabs = (() => { try { return readFileSync(join(root, 'src/js/tabs.js'), 'utf8'); } catch (e) { return ''; } })();
const srcHelp = (() => { try { return readFileSync(join(root, 'src/js/settings-help.js'), 'utf8'); } catch (e) { return ''; } })();
const srcBuild = (() => { try { return readFileSync(join(root, 'build.mjs'), 'utf8'); } catch (e) { return ''; } })();
const sNeed = [
  ['S1 底部导航留白（删＝面板又贴底盖住切页入口）', srcPers.includes('Math.round(window.innerHeight - t.top + 8)')],
  ['S2 聊天输入栏留白（删＝聊天页开面板盖住输入栏）', srcPers.includes('return Math.max(gap, Math.round(window.innerHeight - r.top + 8))')],
  ['S3 默认落位在留白之上（删＝回到贴底 bottom:0）', srcPers.includes('(adjBottom == null ? bottomReserve() : adjBottom)')],
  ['S4 收起＝小胶囊（删＝收起态仍横贯底边）', srcPers.includes('function setMini(on) {')],
  ['S5 胶囊点一下展开（删＝收起后回不到滑杆）', srcPers.includes('if (tapToOpen && !moved) { setMini(false); return; }')],
  ['S6 「看桌面 / 看聊天」直达（删＝现场调回流）', srcPers.includes('goPage(pair[0])') && srcPers.includes("['page-phone', '看桌面'], ['chat', '看聊天']")],
  ['S7 页面名「正在调：X」（删＝分不清在调哪一页）', srcPers.includes("'正在调：' + nm")],
  ['S8 聊天页入口接线（删＝按钮点了没反应）', srcPers.includes("getElementById('more-screen-adj')")],
  ['S9 桌面页入口接线（删＝装修栏按钮点了没反应）', srcPers.includes("getElementById('decor-fit')")],
  ['S10 聊天更多面板入口按钮（删＝聊天里没入口）', srcTpl.includes('id="more-screen-adj"')],
  ['S11 装修栏入口按钮（删＝桌面上没入口）', srcTpl.includes('id="decor-fit"')],
  ['S12 入口行小字随新交互更新（删＝说明与实际不符）', srcTpl.includes('收起」变一枚小胶囊')],
  ['S13 settings-help 写明三处入口（删＝使用提示缺入口）', srcHelp.includes('桌面长按空白进装修模式') && srcHelp.includes('更多 → 工具 → 屏幕适配')]
];
sNeed.forEach(([n, ok]) => check(n, ok));
check('S14 返回键清单仍含面板（#764h 契约不回退）', srcTabs.includes("'screen-adj-panel'];"));
const sentIds = ['#940a', '#940b', '#940c', '#940d', '#962a', '#962b', '#962c', '#962d', '#962e', '#962f', '#962g', '#962h', '#962i', '#962j', '#962k'];
const missingS = sentIds.filter((id) => srcBuild.indexOf("name: '" + id + ' ') < 0);
check('S15 十五条哨兵（#940a~d 换锚 + #962a~k）全部登记', missingS.length === 0, missingS.join(','));
// S16 needle 在各自登记 file 内唯一（哑哨兵体检，防「删掉修复仍报绿」）
const needles = [
  ['js/personalize.js', 'z-index:96;max-height:40vh;background:var(--card-bg,#fff);background:color-mix(in srgb, var(--card-bg,#fff) 72%, transparent);'],
  ['js/personalize.js', 'adjBottom = Math.max(0, Math.min(Math.round(window.innerHeight * 0.7), Math.round(sb + sy - e.clientY)));'],
  ['js/personalize.js', 'if (adjBottom != null && adjBottom <= bottomReserve() + 6) adjBottom = null;'],
  ['js/personalize.js', "if (elBody) elBody.style.display = adjMini ? 'none' : 'flex';"],
  ['js/personalize.js', 'if (t && t.height && t.top > 0) gap = Math.max(gap, Math.round(window.innerHeight - t.top + 8));'],
  ['js/personalize.js', 'if (r && r.height) return Math.max(gap, Math.round(window.innerHeight - r.top + 8));'],
  ['js/personalize.js', 'function setMini(on) {'],
  ['js/personalize.js', 'if (tapToOpen && !moved) { setMini(false); return; }'],
  ['js/personalize.js', "ctx.textContent = '正在调：' + nm;"],
  ['js/personalize.js', "const chatEntry = document.getElementById('more-screen-adj');"],
  ['js/personalize.js', "const decorEntry = document.getElementById('decor-fit');"],
  ['template.html', 'id="more-screen-adj"'],
  ['template.html', 'id="decor-fit"']
];
const readSrc = (f) => { try { return readFileSync(join(root, 'src', f), 'utf8'); } catch (e) { return ''; } };
const uniqBad = needles.filter(([f, n]) => readSrc(f).split(n).length - 1 !== 1).map(([f, n]) => f + ':' + n.slice(0, 26));
check('S16 哨兵 needle 各自在登记 file 内唯一（哑哨兵体检）', uniqBad.length === 0, uniqBad.join(' | '));

// ---------- 浏览器 ----------
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: "try{localStorage.setItem('xy-home-v2:__guide-done','1');localStorage.setItem('xy-home-v2:__onboard-done','1');}catch(e){}"
});
await cdp('Page.navigate', { url: baseUrl + '/index.html' });
await sleep(3500);
for (let i = 0; i < 60; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await sleep(800);
await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();var s=document.getElementById('splash');if(s&&!s.classList.contains('hide')){s.classList.add('hide');s.hidden=true;}var m=document.getElementById('modal-mask');if(m)m.hidden=true;var g=document.getElementById('pc-sheet-mask');if(g)g.hidden=true;return true;})()");
await sleep(700);

const rectOf = (sel) => evalJs(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),vis:!e.hidden&&getComputedStyle(e).display!=='none'};})()`);
const overlap = (a, b) => !!(a && b && a.vis && b.vis && a.y < b.y + b.h && a.y + a.h > b.y && a.x < b.x + b.w && a.x + a.w > b.x);
const hitInside = (sel, cls) => evalJs(`(function(){var t=document.querySelector(${JSON.stringify(sel)});if(!t)return 'no-el';var r=t.getBoundingClientRect();var el=document.elementFromPoint(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2));if(!el)return 'none';return (el.closest(${JSON.stringify(cls)})?'IN':'OUT')+':'+(el.id||el.className||el.tagName);})()`);
// 命中测试前先静场：开屏/引导/弹窗等整屏遮罩会盖住底部导航，命中的是遮罩而不是「面板有没有挡」
const clearOverlays = () => evalJs("(function(){['splash','modal-mask','qa-mask','pc-sheet-mask','img-view-mask','tc-mask','avlib-card'].forEach(function(id){var e=document.getElementById(id);if(e)e.hidden=true;});return [].filter.call(document.querySelectorAll('#modal-mask,#qa-mask,#pc-sheet-mask'),function(e){return e.offsetParent!==null;}).map(function(e){return e.id;}).join(',');})()");

console.log('[B] 行为面（真浏览器 390×844）');
// 切到设置页并开面板
await evalJs("document.querySelector('.tab[data-page=\"page-setting\"]').click(); true");
await sleep(400);
await evalJs("document.getElementById('row-screen-adj').click(); true");
await sleep(500);
let panelR = await rectOf('#screen-adj-panel');
let tabR = await rectOf('.tabbar');
check('B0 面板已打开', !!(panelR && panelR.vis), panelR ? JSON.stringify(panelR) : 'null');
check('B1 开面板不压底部导航（盲调根因）', !!panelR && !!tabR && !overlap(panelR, tabR), 'panel.b=' + (panelR && panelR.y + panelR.h) + ' tab.top=' + (tabR && tabR.y));
const stillMasked = await clearOverlays();
await sleep(200);
check('B2 面板开着仍能点到底部导航（命中测试）', String(await hitInside('.tabbar .tab', '.tabbar')).startsWith('IN'), '残留遮罩=' + stillMasked + '｜' + await hitInside('.tabbar .tab', '.tabbar'));
// 收起 → 小胶囊
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return false;var b=[].slice.call(p.querySelectorAll('button')).filter(function(x){return x.textContent==='收起';});if(!b.length)return 'no-fold';b[0].click();return true;})()");
await sleep(400);
panelR = await rectOf('#screen-adj-panel');
tabR = await rectOf('.tabbar');
check('B3 收起＝小胶囊（不再横贯底边）', !!panelR && panelR.w < 390 * 0.7 && panelR.h < 90, panelR ? ('w=' + panelR.w + ' h=' + panelR.h) : 'null');
check('B4 胶囊不压底部导航', !!panelR && !!tabR && !overlap(panelR, tabR), 'pill.b=' + (panelR && panelR.y + panelR.h) + ' tab.top=' + (tabR && tabR.y));
check('B5 胶囊上写着当前页面名（区分桌面/聊天）', String(await evalJs("(function(){var e=document.querySelector('#screen-adj-panel [data-adj-page]');return e?e.textContent:'none';})()")) === '设置');
// 点胶囊展开（红侧没有胶囊，这一条必须判红：先确认胶囊真的存在）
const miniExists = await evalJs("(function(){var m=document.querySelector('#screen-adj-panel [data-adj-mini]');return !!m;})()");
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var m=p&&p.querySelector('[data-adj-mini]');if(!m)return false;m.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));m.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));return true;})()");
await sleep(400);
panelR = await rectOf('#screen-adj-panel');
check('B6 胶囊点一下展开（没有胶囊/展不开＝红）', miniExists === true && !!panelR && panelR.h > 140, 'mini=' + miniExists + ' h=' + (panelR && panelR.h));
// 「看聊天」
await evalJs("(function(){var b=[].slice.call(document.querySelectorAll('#screen-adj-panel button')).filter(function(x){return x.textContent==='看聊天';});if(!b.length)return 'no-btn';b[0].click();return true;})()");
await sleep(1200);
const chatVisible = await evalJs("!document.getElementById('page-chat').hidden");
check('B7 「看聊天」切到聊天页（面板仍开着）', chatVisible === true && !!(await rectOf('#screen-adj-panel')));
panelR = await rectOf('#screen-adj-panel');
const rowR = await rectOf('#page-chat .chat-input-row');
check('B8 聊天页面板不压输入栏（开口就能说话）', chatVisible === true && !!panelR && !!rowR && rowR.vis && !overlap(panelR, rowR), 'panel.b=' + (panelR && panelR.y + panelR.h) + ' input.top=' + (rowR && rowR.y) + ' vis=' + (rowR && rowR.vis));
check('B9 页面名随页切到「聊天」', String(await evalJs("(function(){var e=document.querySelector('#screen-adj-panel [data-adj-page]');return e?e.textContent:'none';})()")) === '聊天');
// 回面板展开态看「看桌面」
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');var m=p.querySelector('[data-adj-mini]');if(m&&m.style.display!=='none'){m.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));m.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));}return true;})()");
await sleep(300);
await evalJs("(function(){var b=[].slice.call(document.querySelectorAll('#screen-adj-panel button')).filter(function(x){return x.textContent==='看桌面';});if(!b.length)return 'no-btn';b[0].click();return true;})()");
await sleep(700);
check('B10 「看桌面」切回桌面页', (await evalJs("!document.getElementById('page-phone').hidden")) === true);
// 聊天「更多 → 屏幕适配」（面板节点先外部摘掉：顺带验「节点没了入口仍能重建」＝防 zombie 面板）
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(p)p.remove();return true;})()");
await sleep(200);
await evalJs("window.enterChat && window.enterChat(); true");
await sleep(1200);
const moreOpened = await evalJs("(function(){var b=document.getElementById('chat-more-btn');if(!b)return 'no-more-btn';b.click();return !document.getElementById('chat-more-panel').hidden;})()");
check('B11 聊天「更多」可打开', moreOpened === true, String(moreOpened));
const entryInTool = await evalJs("(function(){var e=document.getElementById('more-screen-adj');if(!e)return 'no-entry';e.click();return {panel:!!document.getElementById('screen-adj-panel'),more:document.getElementById('chat-more-panel').hidden};})()");
check('B12 聊天「更多→屏幕适配」开面板并收掉更多面板（节点被摘掉也能重建）', !!(entryInTool && entryInTool.panel && entryInTool.more), JSON.stringify(entryInTool));
await sleep(300);
// 装修栏入口接线（按钮在装修栏里，此处直接验接线可用）
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(p)p.remove();var bar=document.getElementById('decor-bar');if(bar)bar.hidden=false;return true;})()");
await sleep(200);
const decorRes = await evalJs("(function(){var e=document.getElementById('decor-fit');if(!e)return 'no-entry';e.click();return !!document.getElementById('screen-adj-panel');})()");
check('B13 装修栏「屏幕适配」开面板', decorRes === true, String(decorRes));

console.log('[C] 防修过头（两侧同过）');
await evalJs("document.getElementById('row-screen-adj').click(); true"); // 统一从设置入口重开面板
await sleep(500);
await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return false;var s=p.querySelector('[data-adj-slider=\"top\"]');if(!s)return 'no-slider';s.value='12';s.dispatchEvent(new Event('input',{bubbles:true}));return localStorage.getItem('xy-home-v2:screen-adj-top');})()");
await sleep(200);
check('C1 滑杆仍落 LS（本地永久保存语义不变）', (await evalJs("localStorage.getItem('xy-home-v2:screen-adj-top')")) === '12');
check('C2 全部恢复默认仍归零', (await evalJs("(function(){var p=document.getElementById('screen-adj-panel');if(!p)return false;var b=[].slice.call(p.querySelectorAll('button')).filter(function(x){return x.textContent.indexOf('全部恢复默认')===0;});if(!b.length)return 'no-btn';b[0].click();return window.mochiScreenAdj.all().top===0 && !localStorage.getItem('xy-home-v2:screen-adj-top');})()")) === true);
check('C3 返回键清单仍含面板（tabs.js）', srcTabs.includes("'screen-adj-panel'];"));

check('Z1 全程零未捕获 JS 异常', jsExcepts.length === 0, jsExcepts.slice(0, 3).join(' || '));

console.log('\n结果：' + pass + '/' + (pass + fail) + (fail ? ' 失败 ' + fail : ' 全绿'));
try { chrome.kill(); } catch (e) {}
server.close();
process.exit(fail ? 1 : 0);
