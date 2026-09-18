// ===== 专项验证：#773 「多字卡回复」来源 tag 与气泡实际内容不符 =====
// 用户实报：联系人只发了一条消息、气泡里只有一张字卡，左下角 chip 却写着「多字卡回复」。
// 两条根因（都在 chat.js genOneReply）：
//   ① 判据用「掷出的张数 n」而非「实际拼出的张数」——pickN 无放回、池空即停，字卡池不足 n 张
//      时只拼出 1 张，旧写法 if (n >= 2) 照样挂 tag；
//   ② 多字卡文本并没有提前 return，继续落到下方的「系统预设字卡」覆盖链路：默认字卡
//      （csp-cust 掷签让位）/ 聊天回应字卡 getReplyCard（命中即整条替换）/ 空文兜底，
//      三处都会把已拼好的多字卡换成**一张**卡，pyMultiDrawn 不回冲＝一张卡挂着多字卡 chip。
// 用法：node tools/verify-py-multicard-tag.mjs
//   双基线取证：MOCHI_ROOT=<仓外副本> node tools/verify-py-multicard-tag.mjs
//   A 组（新消息生成链，#773/#773b）：红根＝纯 HEAD 应恰红 A2/A3/A4/A5，绿根＝含 #773+#773b 全绿；A1 不误伤。
//   B 组（#773c 存量错标签自愈）：脏历史直推独立测试桌内存 → 切走收口落包 → 切回权威读库跑归一化自愈。
//   绿根＝B1/B3/B4 摘标、B2/B5 真两张不误摘、B3b 其它 chip 保留；红根（纯 HEAD 无自愈）恰红 B1/B3/B4，
//   B2/B3b/B5 两侧皆绿＝对照组（旧码不动 mood，标签原样留着）。
// 冻结 Math.random=0.3 做确定性对照：hit(100) 命中、randInt(2,2)=2、randInt(1,1)=1、hit(0) 不中。
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync, rmSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.MOCHI_ROOT
  ? normalize(process.env.MOCHI_ROOT)
  : normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
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
const udd = join(process.env.TEMP || '/tmp', 'mochi-py771-' + Date.now());
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9900 + Math.floor(Math.random() * 80));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + udd, '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
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
          if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
        };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) {
  const id = ++msgId;
  return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r && r.exceptionDetails) { console.log('EVAL-ERR', JSON.stringify(r.exceptionDetails).slice(0, 200)); return null; }
  return r && r.result ? r.result.value : null;
}
let pass = 0, fail = 0;
const t = (n, c, d) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, d || ''); } };

try {
  await cdpConnect();
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp('Page.navigate', { url: baseUrl + '/index.html' });
  await sleep(2500);
  for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(200); }
  await evalJs("(function(){var e=document.getElementById('splash-enter');if(e&&!e.hidden)e.click();return true;})()");
  await sleep(500);
  await evalJs("(function(){var c=document.getElementById('splash-confirm');if(c&&!c.hidden){var b=c.querySelector('#splash-confirm-ok');if(b)b.click();}return true;})()");
  await sleep(900);
  await evalJs("(function(){var a=document.querySelector('.tab[data-tab=\"chat\"]');if(a)a.click();return true;})()");
  await sleep(800);

  // 压噪：只留「多字卡抽卡」这一个变量（回复条数固定 1 条＝用户实报的那条消息形态）
  const NOISE = { 'rn-prob': 0, 'touch-prob': 0, 'sticker-prob': 0, 'emoji-prob': 0, 'image-prob': 0, 'voice-prob': 0,
    'kaomoji-prob': 0, 'quote-prob': 0, 'rc-prob': 0, 'rc-refix': 0, 'cf-prob': 0, 'as-en': 0, 'call-incoming': 0,
    'ckq-en': 0, 'ai-rps-en': 0, 'ai-game-en': 0, 'ai-cuddle-en': 0, 'ai-cc-en': 0, 'desk-call-prob': 0,
    'py-punct-en': 0, // #650 拼接符号关＝空格连接（A5 需要空白卡拼出真空文才落 #185 兜底；其余用例连接符无涉判据）
    'rs-min': 1, 'rs-max': 2, 'reply-min': 1, 'reply-max': 1, 'py-en': 1, 'py-prob': 100, 'py-min': 2, 'py-max': 2 };
  const setup = (cards, over) => evalJs('(function(){var o=' + JSON.stringify(NOISE) + ';' +
    'var x=' + JSON.stringify(over || {}) + ';for(var k2 in x){if(k2.indexOf("-")>=0)o[k2]=x[k2];}' +
    'for(var k in o)window.saveReplyCfg(k,o[k]);' +
    'window.getCustomCards=function(){return ' + JSON.stringify(cards) + ';};' +
    'window.getDefaultCards=function(){return ' + (over && over.__defs ? JSON.stringify(over.__defs) : 'null') + ';};' +
    'window.getReplyCard=function(){return ' + JSON.stringify((over && over.replyWord) || '') + ';};' +
    (over && over.__noSys ? 'window.getDefaultCardGroups=function(){return [];};' : '') +
    'window.quoteSpellPick=function(){return null;};window.dreamFreePick=function(){return null;};' +
    'window.tryTaMoodShare=function(){return null;};window.maybeMusicRequest=null;window.callMaybeTrigger=null;' +
    'window.maybeAutoGift=null;window.periodCheckCare=null;window.triggerEmotionChain=function(){return null;};' +
    'window.periodWarmText=null;' +
    'return true;})()');
  const freeze = () => evalJs('(function(){window.__realRandom=Math.random;Math.random=function(){return 0.3;};return true;})()');
  const unfreeze = () => evalJs('(function(){if(window.__realRandom){Math.random=window.__realRandom;window.__realRandom=null;}return true;})()');
  const findMsg = (marker) => evalJs("(function(){var ms=(window.getChatMsgs&&window.getChatMsgs())||[];" +
    "for(var i=ms.length-1;i>=0;i--){var r=ms[i];if(!r||r.side!=='in'||!r.text)continue;" +
    "if(String(r.text).indexOf(" + JSON.stringify(marker) + ")>=0){" +
    "return JSON.stringify({text:String(r.text),chips:(r.mood||[]).map(function(md){return (md&&md.tag)||'';})});}}" +
    "return null;})()");
  async function sendOnce(label, cards, over, expect) {
    await setup(cards, over);
    await evalJs("(function(){document.getElementById('chat-input').innerText='在吗';document.getElementById('chat-send').click();return true;})()");
    await sleep(9000);
    const raw = await findMsg(expect.has);
    const r = raw ? JSON.parse(raw) : null;
    const text = r ? r.text : '';
    const chips = r ? r.chips.join('|') : '';
    const tagOk = r && (expect.tag ? chips.indexOf('多字卡回复') >= 0 : chips.indexOf('多字卡回复') < 0);
    const singleOk = !r || !expect.notHas || text.indexOf(expect.notHas) < 0;
    t(label + '（气泡文本「' + text.slice(0, 30) + '」/ chip「' + chips + '」）',
      !!r && tagOk && singleOk,
      '期望 tag=' + (expect.tag ? '有' : '无') + '、含「' + expect.has + '」' +
      (expect.notHas ? '、不含「' + expect.notHas + '」' : '') + (r ? '' : '（未找到该气泡）'));
  }

  await freeze();

  // A1 正面用例：池里 3 张、掷 2 张 → 真拼出 2 张，tag 该在（改动不能被误伤）
  await sendOnce('A1 实拼 2 张 → 挂「多字卡回复」', ['甲一号卡', '甲二号卡', '甲三号卡'], { 'csp-cust': 100 },
    { tag: true, has: '甲一号卡', notHas: null });

  // A2 根因①：py-min/max=2~2 但可用文字卡只有 1 张 → 实际 1 张，不该挂 tag
  await sendOnce('A2 池仅 1 张（掷 2 抽不到）→ 不挂 tag', ['独苗一张卡'], { 'csp-cust': 100 },
    { tag: false, has: '独苗一张卡' });

  // A3 根因②（聊天回应字卡整条替换）
  await sendOnce('A3 回应字卡替换成一张 → 不挂 tag', ['乙一号卡', '乙二号卡', '乙三号卡'],
    { 'csp-cust': 100, replyWord: '一张回应卡' },
    { tag: false, has: '一张回应卡', notHas: '乙二号卡' });

  // A4 根因②（系统默认字卡覆盖：csp-cust=0 → 掷签让位默认字卡）
  await sendOnce('A4 默认字卡覆盖成一张 → 不挂 tag', ['丙一号卡', '丙二号卡', '丙三号卡'],
    { 'csp-cust': 0, __defs: { type: 'text', text: '一张默认卡' } },
    { tag: false, has: '一张默认卡', notHas: '丙二号卡' });

  // A5 #773b 漏网分支：整池都是空白卡（#185 滤空白后 nbTextPool 空、回落 pool.text 仍抽 2 张空白），
  // 拼出空文落到 #185 非空兜底换成一张话术（Math.random 冻结 0.3 → FALLBACK_REPLY_POOL[2]='好～'）——
  // 一张卡的气泡不得挂「多字卡回复」。__noSys 屏蔽系统预设并入，否则可读默认卡会灌满文字池。
  await sendOnce('A5 空白池空文兜底换一张 → 不挂 tag', [' ', '  ', '   '], { 'csp-cust': 100, __noSys: true },
    { tag: false, has: '好～' });

  await unfreeze();

  // ===== B 组 #773c 存量错标签自愈 =====
  // 脏数据注入通道＝**独立联系人测试桌＋内存 msgs 直推**：尾巴日志通道实测走不通（chatTailAppend
  // 只存 {ts,side,special,text,x}，mood 永不回放），故造一条干净小桌，把「一张卡带多字卡回复 chip」
  // 的历史记录直接 push 进该桌 msgs（小桌 getChatMsgs 返回活数组），再切走——#127 切走前收口整包
  // 落基准包；切回＝权威读库 → 分批归一化 → normCell 逐条自愈。二次切换周期证明摘标已持久化。
  const B1 = '独苗历史一张卡', B2 = '历史一号卡 历史二号卡', B3 = '知道啦';
  const goDesk = (cid) => evalJs('(function(){try{window.setActiveContact(' + JSON.stringify(cid) + ');return true;}catch(e){return false;}})()');
  const mkDesk = () => evalJs('(function(){var id=window.createContact("标签清扫测试桌");if(id)window.setActiveContact(id);return String(id||"");})()');
  const pushLegacy = () => evalJs('(function(){var ms=window.getChatMsgs();var n0=ms.length;var now=Date.now();' +
    'ms.push({side:"in",text:' + JSON.stringify(B1) + ',ts:now+1,mood:[{tag:"多字卡回复",label:""}]});' +
    'ms.push({side:"in",text:' + JSON.stringify(B2) + ',ts:now+2,mood:[{tag:"多字卡回复",label:""}]});' +
    'ms.push({side:"in",text:' + JSON.stringify(B3) + ',ts:now+3,mood:[{tag:"多字卡回复",label:""},{tag:"情绪",label:"开心"}]});' +
    'return window.getChatMsgs().length===n0+3?"ok":"copy";})()');
  const chipOf = async (marker) => {
    const raw = await findMsg(marker);
    return raw ? JSON.parse(raw).chips : null;
  };
  const bCheck = (label, chips, want, note) => t(label + '（chip「' + (chips || []).join('|') + '」）',
    chips !== null && (want ? chips.indexOf('多字卡回复') >= 0 : chips.indexOf('多字卡回复') < 0),
    note + (chips === null ? '（未找到该气泡）' : ''));
  // 自愈落库时机＝切回权威读库（异步 idbGet）→ 80ms 延迟 → 分批归一化，无头下波动大；
  // 首轮断言轮询到收敛为止（超时保留末次读数，让失败信息仍指向真实 chip 形态）
  const waitChip = async (marker, wantGone, maxMs) => {
    const t0 = Date.now(); let chips = null;
    while (Date.now() - t0 < maxMs) {
      chips = await chipOf(marker);
      if (chips !== null) { if ((chips.indexOf('多字卡回复') < 0) === wantGone) return chips; }
      await sleep(700);
    }
    return chips;
  };

  const bCid = await mkDesk();
  await sleep(1800); // 新桌装载（空库也算权威就绪）
  const pushed = await pushLegacy();
  t('B0 脏记录注入到测试桌内存（直推活数组）', pushed === 'ok' && !!bCid, 'push=' + pushed + ' cid=' + bCid);
  await goDesk('default'); await sleep(1500); // 切走收口：#127 整包落基准包
  await goDesk(bCid); await sleep(4500); // 切回：权威读库 → 延迟分批归一化跑自愈
  bCheck('B1 历史单卡带错标 → 切回后自愈摘标', await waitChip(B1, true, 12000), false, '期望无 tag');
  bCheck('B2 历史真两张 → 标签不误摘', await waitChip(B2, false, 12000), true, '期望保留 tag');
  {
    const chips3 = await waitChip(B3, true, 12000);
    bCheck('B3 错标摘除、同气泡其它 chip 保留', chips3, false, '期望仅摘「多字卡回复」');
    t('B3b「情绪」chip 未被牵连', chips3 !== null && chips3.indexOf('情绪') >= 0, 'chip「' + (chips3 || []).join('|') + '」');
  }
  await goDesk('default'); await sleep(1200); await goDesk(bCid); await sleep(4500); // 二次周期：读库读到的就该是摘标后的库
  bCheck('B4 二次装载不复活（B1）', await chipOf(B1), false, '期望仍无 tag');
  bCheck('B5 二次装载不误伤（B2）', await chipOf(B2), true, '期望仍挂 tag');
  console.log(pass + ' 通过 / ' + fail + ' 失败');
} finally {
  try { chrome.kill(); } catch (e) {}
  try { server.close(); } catch (e) {}
  try { rmSync(udd, { recursive: true, force: true }); } catch (e) {}
}
process.exitCode = fail ? 1 : 0;
