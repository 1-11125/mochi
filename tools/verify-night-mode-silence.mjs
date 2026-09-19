// ===== #876 专项回归：夜间模式「完全静默」总闸收口 =====
// 用户反馈：开了夜间模式（22:00–7:00 静默）挂后台睡觉，联系人还在发——大头是换头像换昵称、
// 互动卡，小部分是主动消息。根因＝旧夜间模式只装在 tryAutoSend/来电/跨桌面三条链，换头像换
// 昵称（avatar-lib 四个 60s 轮询）、互动卡（ta-ask 五类 maybeTrigger）、被动回复、群聊回复、
// 红包礼物换位朋友圈等各自独立链全部无夜间检查。
// 本批修法（「夜间什么也不能发」口径）：
//   #876a chat.js addRec 收件总闸（nightAllow＝唯一例外通道，放行用户当刻回执/账目/到点提醒）
//   #876b chat.js addIn 音效前同款守卫（音效在 addRec 之前播，防止「响一声没消息」）
//   #876c chat.js scheduleReply 被动回复夜间顺延到次日 7:00 后 1–10 分钟（不丢回复、夜里零打扰）
//   #876d chat.js continueChat（点名字/继续说＝用户当刻要求）置 3 分钟放行窗口
//   #876e avatar-lib avNightQuiet 助手＋四轮询守卫（被拦当次不推进周期，7 点后补发不丢失）
//   #876f ta-ask interactGateOk 内夜间 return false（五类互动卡+查岗卡一处收口，手动不受限）
//   #876g group-chat memberReply 夜间顺延（gcContinueSay 传 __force 放行）
//   #876h/i/j/k p2 换位 / gift 送礼 / feed 动态 / bg-keep 跨桌面回放 各源头闸
// 用例：
//   S1~S12 源码锚（总闸/守卫/顺延/窗口/助手/五链闸/放行标记抽查）
//   B1 addIn 三态：夜间拦（音效不播、addRec 不调）｜nightAllow 放行｜放行窗口内放行｜白天放行
//   B2 avNightQuiet 三态：主路径 nightModeActive｜兜底全局根键+小时（22/7 边界、白天）
//   B3 interactGateOk：夜间恒 false（且不读冷却）｜白天按冷却
//   B4 memberReply：夜间排队顺延（>60min 一次性）｜__force 不走顺延
//   B5 scheduleReply：夜间顺延（delay 到次日 7 点后、不出「正在输入」）｜白天即时（rs 秒级、出 typing）
// 红对照：MOCHI_EXPECT=red node tools/verify-night-mode-silence.mjs（MOCHI_ROOT 指纯 HEAD 副本）
//   ——HEAD 无全部闸门与助手，S 组必红；B 组提取失败按红计。
// 纯 node 单元验证（vm 提取函数体＋stub），不依赖无头浏览器、不触发 node build.mjs。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const rd = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch (e) { return null; } };
const srcChat = rd('src/js/chat.js') || '';
const srcAv = rd('src/js/avatar-lib.js') || '';
const srcAsk = rd('src/js/ta-ask.js') || '';
const srcGc = rd('src/js/group-chat.js') || '';
const srcP2 = rd('src/js/p2-features.js') || '';
const srcGift = rd('src/js/gift-shop.js') || '';
const srcFeed = rd('src/js/feed.js') || '';
const srcBg = rd('src/js/bg-keep.js') || '';
const srcPeriod = rd('src/js/period.js') || '';
const srcMusic = rd('src/js/music-player.js') || '';
const srcDecision = rd('src/js/decision.js') || '';

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };
const has = (src, needle) => src.indexOf(needle) >= 0;
const count = (src, needle) => src.split(needle).length - 1;

// ---- 提取 IIFE 内指定函数体（花括号配平） ----
function extractFn(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) throw new Error('找不到 ' + sig);
  const bodyStart = src.indexOf('{', at);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(sig + ' 花括号不配平');
}
function tryExtract(src, sig) { try { return extractFn(src, sig); } catch (e) { return null; } }

// ================= S 组：源码锚 =================
note('S1a', has(srcChat, '!rec.nightAllow && !(window.__nightReplyOpen'), 'addRec 收件总闸（nightAllow+放行窗口+nightModeActive）缺失');
note('S1b', has(srcChat, "rec.side === 'in'"), '总闸只拦收件方向（out/系统操作不受限）');
note('S2', has(srcChat, '!opts.nightAllow && !(window.__nightReplyOpen'), 'addIn 音效前守卫缺失');
note('S3a', has(srcChat, 'const __nmHold = window.nightModeActive && window.nightModeActive();'), 'scheduleReply 夜间顺延判定缺失');
note('S3b', has(srcChat, 'setHours(7, 0, 0, 0)'), '顺延目标时刻「次日 7:00」缺失');
note('S3c', has(srcChat, 'if (!__nmHold) showTyping();'), '夜间顺延不出「正在输入」缺失');
note('S4', has(srcChat, 'window.__nightReplyOpen = Date.now();'), 'continueChat 放行窗口置位缺失');
note('S5a', has(srcAv, 'function avNightQuiet() {'), 'avatar-lib 夜间静默助手缺失');
note('S5b', count(srcAv, 'if (avNightQuiet()) return;') === 4, '四个换头像/换昵称轮询守卫应恰 4 处，实得 ' + count(srcAv, 'if (avNightQuiet()) return;'));
note('S5c', has(srcAv, "xyStore('xy-home-v2').get('night-mode-en')"), '助手全局根键兜底缺失（启动直调时 incoming-requests 未加载）');
note('S6', has(srcAsk, 'if (window.nightModeActive && window.nightModeActive()) return false;'), '互动卡频率闸夜间拦截缺失');
note('S7a', has(srcGc, 'if (!__force && window.nightModeActive && window.nightModeActive()) {'), '群聊成员回复夜间顺延缺失');
note('S7b', has(srcGc, "memberReply(cid, '', gid, true, true)"), '群聊「继续说」__force 放行缺失');
note('S8', count(srcP2, 'window.nightModeActive && window.nightModeActive()) return;') >= 1, 'TA 自动换位夜间闸缺失');
note('S9', count(srcGift, 'window.nightModeActive && window.nightModeActive()) return;') >= 1, 'TA 自动送礼源头闸缺失');
note('S10', count(srcFeed, 'window.nightModeActive && window.nightModeActive()) return;') >= 1, '朋友圈自动动态夜间闸缺失');
note('S11', has(srcBg, 'if (!force && window.nightModeActive && window.nightModeActive()) return 0;'), '跨桌面回放夜间暂停缺失');
note('S12a', has(srcPeriod, "'经期预警', nightAllow: true"), '经期提醒放行标记缺失（拦掉＝提醒永久丢）');
note('S12b', has(srcMusic, '{ silent: true, nightAllow: true }'), '音乐互动台词放行标记缺失（用户听歌当刻操作）');
note('S12c', has(srcChat, "{ special: 'poke', nightAllow: true }"), '红包领取/退回回执放行标记缺失（账目先行不可无痕）');
note('S12d', has(srcDecision, 'dedupExempt: true, nightAllow: true'), '帮我决定结果放行标记缺失（用户当刻操作）');

// ================= B 组：行为断言（vm + stub） =================
function runFn(fnSrc, sandbox) {
  const ctx = vm.createContext(sandbox);
  return vm.runInContext('(' + fnSrc + ')', ctx);
}

// B1 addIn 三态
const addInSrc = tryExtract(srcChat, 'function addIn(text, opts)');
if (addInSrc) {
  const mk = (nm) => {
    const recs = []; let sfx = 0;
    const sb = { window: { playSfx: () => { sfx++; } }, addRec: (r) => { recs.push(r); return r; }, console, Date };
    sb.window.nightModeActive = nm;
    return { fn: runFn(addInSrc, sb), recs, sfxBox: { get() { return sfx; } } };
  };
  // 夜间：拦——addRec 不调、音效不播、返回 null
  const night = mk(() => true);
  const r1 = night.fn('晚上好', {});
  note('B1a', r1 === null && night.recs.length === 0 && night.sfxBox.get() === 0, '夜间普通收件应静默（返回 null、不落库、不响音效），实得 r=' + r1 + ' recs=' + night.recs.length + ' sfx=' + night.sfxBox.get());
  // 夜间 + nightAllow：放行且标记透传（放行＝完整正常路径，非 silent 照常响音效）
  const allow = mk(() => true);
  const r2 = allow.fn('红包已领取', { nightAllow: true });
  note('B1b', r2 && r2.nightAllow === true && allow.recs.length === 1 && allow.sfxBox.get() === 1, 'nightAllow 应放行且透传（正常路径响音效），实得 r=' + JSON.stringify(r2 && r2.nightAllow) + ' recs=' + allow.recs.length + ' sfx=' + allow.sfxBox.get());
  // 夜间 + 放行窗口（continueChat 置位 3 分钟内）：放行
  const win = mk(() => true);
  win.fn.__sb = null;
  const sbWin = { window: { playSfx: () => {}, __nightReplyOpen: Date.now() - 60000, nightModeActive: () => true }, addRec: (r) => r, console, Date };
  const r3 = vm.runInContext('(' + addInSrc + ')', vm.createContext(sbWin))('继续说的话', {});
  note('B1c', r3 && r3.text === '继续说的话', '放行窗口内（__nightReplyOpen 3 分钟内）应放行，实得 r=' + JSON.stringify(r3 && r3.text));
  // 白天：放行
  const day = mk(() => false);
  const r4 = day.fn('早上好', {});
  note('B1d', r4 && day.recs.length === 1, '白天（时段外）普通收件应放行');
} else note('B1', false, 'addIn 函数体提取失败');

// B2 avNightQuiet 三态
const avNightSrc = tryExtract(srcAv, 'function avNightQuiet() {');
if (avNightSrc) {
  const mk = (nm, en, hour) => {
    const sb = { window: {}, Date: class extends Date { getHours() { return hour; } } };
    if (nm) sb.window.nightModeActive = nm;
    sb.window.xyStore = () => ({ get: (k) => (k === 'night-mode-en' ? en : '') });
    const f = runFn(avNightSrc, sb);
    return f();
  };
  note('B2a', mk(() => true, '0', 12) === true, '主路径：nightModeActive()=true 应判夜间');
  note('B2b', mk(null, '0', 23) === false, '兜底：开关未开（根键≠1）即使深夜 23 点也应不静默');
  note('B2c', mk(null, '1', 23) === true && mk(null, '1', 6) === true, '兜底：开关开＋23 点/6 点应判夜间');
  note('B2d', mk(null, '1', 12) === false, '兜底：开关开＋中午 12 点应不静默');
} else note('B2', false, 'avNightQuiet 函数体提取失败');

// B3 interactGateOk
const gateSrc = tryExtract(srcAsk, 'function interactGateOk() {');
if (gateSrc) {
  let gateRead = 0;
  const mk = (nm, last) => {
    gateRead = 0;
    const sb = { window: {}, store: { get: () => { gateRead++; return String(last); } }, Number, Date, INTERACT_GATE_KEY: 'interact-card-last', INTERACT_GATE_MS: 60 * 60000 };
    if (nm) sb.window.nightModeActive = nm;
    const f = runFn(gateSrc, sb);
    return f();
  };
  note('B3a', mk(() => true, 0) === false && gateRead === 0, '夜间应恒 false 且不读冷却键（被拦当次不推进冷却）');
  note('B3b', mk(() => false, Date.now()) === false, '白天＋冷却期内应 false（原频率闸语义保持）');
  note('B3c', mk(() => false, 0) === true, '白天＋无冷却应 true（原语义保持）');
} else note('B3', false, 'interactGateOk 函数体提取失败');

// B4 memberReply 夜间顺延
const memberReplySrc = tryExtract(srcGc, 'function memberReply(cid, quoteText, gid, continuation, __force) {');
if (memberReplySrc) {
  const mk = (nm, force) => {
    const queued = []; let typing = 0;
    const sb = {
      window: { nightModeActive: nm }, setTimeout: (fn, d) => { queued.push(d); return 1; }, clearTimeout: () => {},
      console, Date, Math, Number,
      gcCfg: () => ({ 'gc-cs-normal': 0, 'gc-rs-min': 1, 'gc-rs-max': 2, 'gc-touch-prob': 0, 'gc-py-en': 0 }),
      curGid: 'g1', gid: 'g1', showTyping: () => { typing++; }, hideTyping: () => {}, hit: () => false,
      memberName: () => '甲', randInt: (a, b) => a, gcDeliverReply: () => 0, gcGenReply: () => ({ text: 'x', type: 'text' }),
      getInteractPool: () => [], gcReadGroupKey: () => [], gcWriteGroupKey: () => {}, msgs: [], saveMsgs: () => {}, renderMsg: () => {}, followGcBottom: () => {}
    };
    const fn = runFn(memberReplySrc, sb);
    try { fn('c1', '', 'g1', undefined, force); } catch (e) { queued.push('ERR:' + e.message); }
    return { queued, typing };
  };
  const night = mk(() => true, undefined);
  note('B4a', night.queued.length === 1 && typeof night.queued[0] === 'number' && night.queued[0] >= 60000 && night.typing === 0, '夜间成员回复应一次性排队到 7 点后（≥60s）且不出「正在输入」，实得 ' + JSON.stringify(night.queued) + ' typing=' + night.typing);
  const force = mk(() => true, true);
  note('B4b', !force.queued.some((d) => typeof d === 'number' && d >= 60000), '「继续说」__force 不应走夜间顺延队列，实得 ' + JSON.stringify(force.queued));
} else note('B4', false, 'memberReply 函数体提取失败');

// B5 scheduleReply 夜间顺延
const scheduleReplySrc = tryExtract(srcChat, 'function scheduleReply() {');
if (scheduleReplySrc) {
  const mk = (nm) => {
    const queued = []; let typing = 0;
    const sb = {
      window: { nightModeActive: nm }, setTimeout: (fn, d) => { queued.push(d); return 1; }, clearTimeout: () => {},
      console, Date, Math, Number,
      syncLastMineText: () => {}, lastMineQuote: null, lastMineIdx: -1, chatUserFollowScroll: false,
      cfg: () => ({ 'rn-prob': 0, 'rs-min': 2, 'rs-max': 3, 'touch-prob': 0 }),
      hit: () => false, addIn: () => ({}), randInt: (a, b) => a, showTyping: () => { typing++; }, hideTyping: () => {}
    };
    const fn = runFn(scheduleReplySrc, sb);
    try { fn(); } catch (e) { queued.push('ERR:' + e.message); }
    return { queued, typing };
  };
  const night = mk(() => true);
  const big = night.queued.filter((d) => typeof d === 'number' && d >= 60000);
  note('B5a', big.length >= 1 && night.typing === 0, '夜间被动回复应顺延（≥60s，目标次日 7:00 后）且不出「正在输入」，实得 ' + JSON.stringify(night.queued) + ' typing=' + night.typing);
  const day = mk(() => false);
  note('B5b', day.queued.some((d) => typeof d === 'number' && d >= 1000 && d < 60000) && day.typing >= 1, '白天被动回复应即时（rs 秒级）且出「正在输入」，实得 ' + JSON.stringify(day.queued) + ' typing=' + day.typing);
} else note('B5', false, 'scheduleReply 函数体提取失败');

// ================= 汇总 =================
const total = failures.length;
if (EXPECT === 'red') {
  console.log('[red-mode] 红 ' + total + ' 项（对照纯 HEAD，全部红＝判别力成立；出现绿＝锚误报）');
  console.log(failures.map((f) => '  RED ' + f).join('\n'));
  process.exit(0);
}
if (total) {
  console.log('❌ verify-night-mode-silence ' + total + ' 项失败：\n' + failures.map((f) => '  · ' + f).join('\n'));
  process.exit(1);
}
console.log('✅ verify-night-mode-silence 全绿（S1~S12 源码锚 + B1~B5 行为断言）');
