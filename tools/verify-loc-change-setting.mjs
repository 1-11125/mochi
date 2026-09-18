// ===== #790 专项回归：TA在身边「换位提醒」三开关（弹窗可关 / 自动换位可关 / 换位是否发进聊天） =====
// 用户反馈：TA 自动换位置时顶部黑色轻提示弹窗，希望①设置里能关掉弹窗；②弹窗（换位事件）能设置是否发到聊天里。
// 实现（p2-features.js，全部只管 doLocAuto 这条「TA 自动」路，手动发卡/问TA一声不受限）：
//   #790a showLocChangeBubble 入口闸门   store.get('loc-bubble')==='0' → 直接 return（不建/不弹 #loc-change-bubble）
//   #790b doLocAuto 发聊天闸门           store.get('loc-chat')==='0' → 不调 chatAddIn，但仍写 loc-current/loc-history（时间线保留）
//   #790c doLocAuto 自动总开关           store.get('loc-auto')==='0' → 到点直接 return（拦设置后仍残留的当次定时器）
//   #790d 位置面板设置组                  loc-auto-tg / loc-bubble-tg / loc-chat-tg 三行 toggle，写入 per-cid 键
// 用例（对提取出的真实函数体做单元级行为断言，stub 掉 store/DOM/window）：
//   B1 默认（无键）自动换位：chatAddIn 落聊天 + 时间线写入 + 弹窗链路走到（现状行为不变）
//   B2 loc-chat='0'：chatAddIn 不调，时间线仍写、光点仍放、弹窗仍走
//   B3 loc-auto='0'：整条路静默——chatAddIn/时间线/光点/弹窗全不碰
//   B4 loc-bubble='0'：真实 showLocChangeBubble 早退，不建 #loc-change-bubble；loc-chat='0' 组合下聊天也不落
//   B5 loc-bubble 开：真实 showLocChangeBubble 建元素、文案含「换了位置」
//   S1 源码含三开关渲染 id（loc-auto-tg/loc-bubble-tg/loc-chat-tg）＋ change 写回对应键
// 红对照：MOCHI_P2_FILE=<HEAD 版 p2-features.js> MOCHI_EXPECT=red node tools/verify-loc-change-setting.mjs
//   ——旧代码无三道闸门与设置组，B2/B3/B4/S1 必红。
// 纯 node 单元验证（vm 提取函数体＋stub），不依赖不触发 node build.mjs，多会话并行可安全跑。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECT = process.env.MOCHI_EXPECT || 'green';
const root = normalize(process.env.MOCHI_ROOT || dirname(fileURLToPath(import.meta.url)) + '/..');
const p2Path = process.env.MOCHI_P2_FILE || join(root, 'src/js/p2-features.js');
const src = readFileSync(p2Path, 'utf8');

// ---- 提取 IIFE 内指定函数体（花括号配平），失败=锚点没了 ----
function extractFn(name, sig) {
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
function extractStr(needle) {
  if (src.indexOf(needle) < 0) throw new Error('源码缺锚点：' + needle);
  return needle;
}

const failures = [];
const note = (id, ok, why) => { if (!ok) failures.push(id + '：' + why); };

// ---- stub 工厂 ----
function mkStore(init) { const m = Object.assign({}, init || {}); return { get: (k) => (k in m ? m[k] : ''), set: (k, v) => { m[k] = v; } }; }
function mkDoc() {
  const doc = {
    hidden: false,
    created: [],
    appended: [],
    getElementById: () => null,
    createElement: (tag) => { const el = { tag, id: '', className: '', textContent: '', _t: 0, classList: { add() {}, remove() {} } }; doc.created.push(el); return el; },
    body: { appendChild: (el) => { doc.appended.push(el); } },
    addEventListener: () => {}
  };
  return doc;
}
const NOOP_TIMER = (fn) => 0; // 不真排程，防挂起

// 跑真实 showLocChangeBubble：返回 {created, appended}
function runBubble(store, keyVal) {
  const s = mkStore(keyVal ? { 'loc-bubble': keyVal } : {});
  const doc = mkDoc();
  const fn = new Function('store', 'window', 'document', 'setTimeout', 'clearTimeout',
    '"use strict";' + extractFn('showLocChangeBubble', 'function showLocChangeBubble(text)') +
    '; showLocChangeBubble("再近一点"); return { created: document.created, appended: document.appended };');
  return fn(s, {}, doc, NOOP_TIMER, () => {});
}

// 跑真实 doLocAuto：bubbleImpl 可注入（默认 spy），返回各 spy 计数
function runAuto(store, opts) {
  const o = opts || {};
  const doc = mkDoc();
  const spy = { chat: 0, saveCur: 0, saveHist: 0, fx: 0, bubble: 0, bubbleEl: 0, bubbleText: '' };
  let bubbleImpl;
  if (o.realBubble) {
    const bdoc = mkDoc();
    const bfn = new Function('store', 'window', 'document', 'setTimeout', 'clearTimeout',
      '"use strict";' + extractFn('showLocChangeBubble', 'function showLocChangeBubble(text)') +
      '; showLocChangeBubble("再近一点"); return { created: document.created, appended: document.appended };');
    bubbleImpl = (text) => {
      spy.bubble++;
      const r = bfn(store, {}, bdoc, NOOP_TIMER, () => {});
      spy.bubbleEl += r.appended.length;
      if (r.appended[0]) spy.bubbleText = r.appended[0].textContent;
    };
  } else {
    bubbleImpl = () => { spy.bubble++; };
  }
  const fn = new Function('store', 'window', 'document', 'locWakeAt', 'locTypeOf', 'loadCur', 'saveCur',
    'loadHist', 'saveHist', 'playLocFx', 'showLocChangeBubble',
    '"use strict";' + extractFn('doLocAuto', 'function doLocAuto()') + '; doLocAuto();');
  fn(store, { __mochiDataReady: true, chatAddIn: () => { spy.chat++; } }, doc, 0,
    () => 'custom',
    () => (o.oldCur === undefined ? { text: '旧位置', ts: 1 } : o.oldCur),
    () => { spy.saveCur++; },
    () => [],
    () => { spy.saveHist++; },
    () => { spy.fx++; },
    bubbleImpl);
  return spy;
}

// ---- B 组行为断言 ----
try {
  // B1 默认（现状不变）：落聊天 + 时间线 + 弹窗链
  const b1 = runAuto(mkStore());
  note('B1', b1.chat === 1 && b1.saveCur === 1 && b1.saveHist === 1 && b1.fx === 1 && b1.bubble === 1,
    '默认自动换位应 聊天1/时间线2写/光点1/弹窗1，实得 ' + JSON.stringify(b1));

  // B2 关「换位发到聊天」：不落聊天，时间线/光点/弹窗照旧
  const b2 = runAuto(mkStore({ 'loc-chat': '0' }));
  note('B2', b2.chat === 0 && b2.saveCur === 1 && b2.saveHist === 1 && b2.fx === 1 && b2.bubble === 1,
    'loc-chat=0 应不落聊天但时间线/光点/弹窗照旧，实得 ' + JSON.stringify(b2));

  // B3 关「TA 自动换位」：整条路静默（拦残留定时器到点那次）
  const b3 = runAuto(mkStore({ 'loc-auto': '0' }));
  note('B3', b3.chat === 0 && b3.saveCur === 0 && b3.saveHist === 0 && b3.fx === 0 && b3.bubble === 0,
    'loc-auto=0 应全部静默，实得 ' + JSON.stringify(b3));

  // B4/B5 真实弹窗函数：关=不建元素；开=建元素且文案带「换了位置」
  const b4 = runAuto(mkStore({ 'loc-bubble': '0', 'loc-chat': '0' }), { realBubble: true });
  note('B4', b4.bubbleEl === 0 && b4.chat === 0,
    'loc-bubble=0 应不建弹窗元素（组合 loc-chat=0 也不落聊天），实得 ' + JSON.stringify(b4));
  const b5 = runAuto(mkStore(), { realBubble: true });
  note('B5', b5.bubbleEl === 1 && b5.bubbleText.indexOf('换了位置') >= 0,
    '弹窗开应建 #loc-change-bubble 且文案含「换了位置」，实得 ' + JSON.stringify(b5));
} catch (e) {
  failures.push('B*：行为断言执行失败——' + e.message);
}

// ---- S 组源码锚点（设置组 UI） ----
try {
  extractStr('id="loc-auto-tg"');
  extractStr('id="loc-bubble-tg"');
  extractStr('id="loc-chat-tg"');
  extractStr("bindLocTg('loc-auto-tg', 'loc-auto')");
  extractStr("bindLocTg('loc-bubble-tg', 'loc-bubble')");
  extractStr("bindLocTg('loc-chat-tg', 'loc-chat')");
} catch (e) {
  failures.push('S1：' + e.message);
}

// ---- 全文件语法自检（编译不执行） ----
try { new Function(src); } catch (e) { failures.push('SYN：整文件编译失败——' + e.message); }

// ---- 汇总（red 对照：旧代码应至少违反一条新闸门断言） ----
if (EXPECT === 'red') {
  if (failures.length) { console.log('RED-OK（旧代码如预期红 ' + failures.length + ' 条：' + failures.join('；') + '）'); process.exit(0); }
  console.error('红对照失败：旧代码竟全绿，断言没咬合'); process.exit(1);
}
if (failures.length) { console.error('FAIL ' + failures.length + ' 条：\n- ' + failures.join('\n- ')); process.exit(1); }
console.log('OK #790 换位提醒三开关：B1~B5 行为 + S1 设置组锚点 + 语法 全过');
process.exit(0);
