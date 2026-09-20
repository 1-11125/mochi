// verify-943-hotpath.mjs — #943 iOS 热路径卡顿根治 行为断言
// 判别面：超限 LS 聊天快照跳过合并 parse / 表情包整包写防抖+离页补发 /
//         写日志落盘防抖+离页冲刷 / 桌面视觉重应用拆帧 / 回桌面自动采样限频。
// 用法：node tools/verify-943-hotpath.mjs            （在仓库根运行）
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

const ROOT = process.cwd();
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// —— 从源码里按函数名摘出平衡花括号块 ——
function extractFn(src, startMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) return null;
  let depth = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  return null;
}

const chatSrc = read('src/js/chat.js');
const idbSrc = read('src/js/idb.js');
const persSrc = read('src/js/personalize.js');
const sliderSrc = read('src/js/desktop-slider.js');

// ===== S 源锚 =====
ok('S1 #943a 超限快照跳过合并 guard 存在于 mergeLsSnapshotWith',
  extractFn(chatSrc, 'function mergeLsSnapshotWith').includes("raw.length > LS_SNAP_LIMIT"));
ok('S2 #943b myEmojiSaveNow 已声明（防抖目标函数存在）', chatSrc.includes('function myEmojiSaveNow()'));
ok('S3 #943c 离页冲刷已接入 hidden/pagehide', idbSrc.includes('wrjMarkFlush(); wrjPersistFlush();'));
ok('S4 #943d 桌面视觉拆帧队列存在', persSrc.includes('const rest = [applyAllWidgetTexts, applyAllWidgetOpacities, renderDeskImages, syncBgUI];'));
ok('S5 #943e 回桌面自动采样限频存在', sliderSrc.includes('(swSample.last || 0) < 300000'));

// ===== B1/B2 mergeLsSnapshotWith 行为 =====
{
  const fn = extractFn(chatSrc, 'function mergeLsSnapshotWith');
  const BIG = 'x'.repeat(3 * 1024 * 1024); // > 2MB 上限
  function run(raw) {
    if (!fn) return { snapCalls: [], parsed: -1 };
    let snapCalls = [], parsed = 0;
    const ctx = {
      LS_SNAP_LIMIT: 2 * 1024 * 1024,
      store: { get: () => raw },
      performLsSnapWrite: (arr, p) => snapCalls.push([arr, p]),
      lsMergeSig: () => 'sig', recKindIndex: () => ({}), recKindCovers: () => true,
      chatRecKeysAdd: () => {}, chatRecKeysHit: () => false,
      JSON: { parse: () => { parsed++; return []; }, stringify: JSON.stringify },
    };
    vm.runInNewContext('(' + fn + ')([{ts: 1, side: "ta", text: "hi"}], "default")', ctx);
    return { snapCalls, parsed };
  }
  const big = run(BIG);
  ok('B1 超限快照：不做整包 JSON.parse（省下 2.7MB 解析）', big.parsed === 0, 'parsed=' + big.parsed);
  ok('B1b 超限快照：仍用 msgsNow 直接落一份新快照（兜底不空）', big.snapCalls.length === 1 && big.snapCalls[0][1] === 'default');
  const small = run('[]');
  ok('B2 小快照：仍走原有合并路径（parse 恰一次）', small.parsed === 1 && small.snapCalls.length === 1);
}

// ===== B3/B4 myEmojiSave 防抖 + 离页补发 =====
{
  const wrap = extractFn(chatSrc, 'function myEmojiSave()');
  const flushFn = extractFn(chatSrc, 'function myeDurableFlush');
  let nowCalls = 0, durableCalls = 0;
  const ctx = {
    window: {},
    myEmojiStore: () => ({ set: () => { nowCalls++; } }),
    myeSaveJson: () => '[]', MYE_KEY: () => 'k',
    myEmojiSaveNow: () => { nowCalls++; },
    myeDurablePending: true,
    myeEnsureDurable: () => { durableCalls++; },
    clearTimeout, setTimeout,
    __t: {},
  };
  if (!wrap || !flushFn) {
    ok('B3 防抖：点按当帧不整包写', false, '函数缺失');
    ok('B4 离页当场补发防抖中的写', false);
    ok('B4b 离页同时补发 durable 确认', false);
  } else {
    vm.runInNewContext('var myeSaveTimer = null;\n' + wrap + '\n' + flushFn + '\n__t.save = myEmojiSave; __t.flush = myeDurableFlush;', ctx);
    ctx.__t.save(); ctx.__t.save(); // 连点两次
    ok('B3 防抖：点按当帧不整包写', nowCalls === 0, 'nowCalls=' + nowCalls);
    ctx.__t.flush(); // 离页
    ok('B4 离页当场补发防抖中的写', nowCalls === 1, 'nowCalls=' + nowCalls);
    ok('B4b 离页同时补发 durable 确认', durableCalls === 1);
  }
}

// ===== B5/B6 wrjPersist 防抖 + 冲刷 =====
{
  const flushFn = extractFn(idbSrc, 'function wrjPersistFlush');
  const debFn = extractFn(idbSrc, 'function wrjPersist()');
  let writes = 0;
  const ctx = {
    _wrj: [{ k: 'a', v: '1', t: 1 }],
    WRJ_KEY: 'xy-home-v2:__wr-journal',
    localStorage: { setItem: () => { writes++; }, getItem: () => null },
    clearTimeout, setTimeout,
    __t: {},
  };
  if (!flushFn || !debFn) {
    ok('B5 防抖：连写三个键当帧 0 次 setItem', false, '函数缺失');
    ok('B5b 200ms 后合并成恰一次落盘', false);
    ok('B6 离页冲刷：立即落盘不再等 200ms', false);
  } else
  vm.runInNewContext('let _wrjPersistT = null;\n' + flushFn + '\n' + debFn + '\n__t.p = wrjPersist; __t.f = wrjPersistFlush;', ctx);
  if (flushFn && debFn) {
  ctx.__t.p(); ctx.__t.p(); ctx.__t.p();
  ok('B5 防抖：连写三个键当帧 0 次 setItem', writes === 0, 'writes=' + writes);
  setTimeout(() => {
    ok('B5b 200ms 后合并成恰一次落盘', writes === 1, 'writes=' + writes);
    ctx.__t.p();
    ctx.__t.f();
    ok('B6 离页冲刷：立即落盘不再等 200ms', writes === 2, 'writes=' + writes);
    finish();
  }, 300);
  }
}

// ===== B7/B8/B11/B12 refreshDeskVisuals 拆帧 =====
{
  const fn = extractFn(persSrc, 'function refreshDeskVisuals');
  const calls = {};
  const mk = (n) => () => { calls[n] = (calls[n] || 0) + 1; };
  let rafQ = [];
  const ctx = {
    window: { applyAvatars: mk('avatars') }, document: { hidden: false },
    requestAnimationFrame: (f) => { rafQ.push(f); },
    applyAvatars: mk('avatars'), applyAllCardBgs: mk('cards'), applyPageBgs: mk('pagebgs'),
    applyAllWidgetTexts: mk('texts'), applyAllWidgetOpacities: mk('opac'),
    renderDeskImages: mk('imgs'), syncBgUI: mk('syncui'),
    __t: {},
  };
  vm.runInNewContext(fn + '\n__t.rdv = refreshDeskVisuals;', ctx);
  const drain = () => { let g = 0; while (rafQ.length && g++ < 20) { const q = rafQ; rafQ = []; q.forEach(f => f()); } };
  ctx.__t.rdv();
  ok('B7 本帧：头像/卡背/页背已落位（不闪旧桌面）', calls.avatars === 1 && calls.cards === 1 && calls.pagebgs === 1, JSON.stringify(calls));
  ok('B7b 本帧：文本组件已让出（不压交互帧）', !calls.texts, 'texts=' + calls.texts);
  drain();
  ok('B8 rAF 排空后：七项各恰跑一次', ['avatars', 'cards', 'pagebgs', 'texts', 'opac', 'imgs', 'syncui'].every(n => calls[n] === 1), JSON.stringify(calls));
  ctx.__t.rdv(); // 再来一轮（切桌面扇出重复调用）
  drain();
  ok('B11 重复调用：各项目仍恰为 2 次（无重复渲染/无丢项）', ['avatars', 'cards', 'pagebgs', 'texts', 'opac', 'imgs', 'syncui'].every(n => calls[n] === 2), JSON.stringify(calls));
  const calls2 = {};
  const ctx2 = {
    window: { applyAvatars: () => { calls2.a = 1; } }, document: { hidden: true }, requestAnimationFrame: () => { throw new Error('hidden 不得排帧'); },
    applyAllCardBgs: () => {}, applyPageBgs: () => {},
    applyAllWidgetTexts: () => { calls2.t = 1; }, applyAllWidgetOpacities: () => {},
    renderDeskImages: () => {}, syncBgUI: () => {},
  };
  vm.runInNewContext(fn + '\nrefreshDeskVisuals();', ctx2);
  ok('B12 隐藏态一次跑完（不排 rAF）', calls2.a === 1 && calls2.t === 1);
}

// ===== B9/B10 swSample 限频 =====
{
  const fn = extractFn(sliderSrc, 'function swSample');
  let clock = 1000000, rafRuns = 0; const samples = [];
  const ctx = {
    swOn: false, SW_FRAMES: 3, SW_KEY: 'k',
    Date: { now: () => clock },
    document: { hidden: false },
    requestAnimationFrame: (f) => { rafRuns++; f(clock); },
    localStorage: { setItem: (k, v) => samples.push(JSON.parse(v)) },
    __t: {},
  };
  vm.runInNewContext(fn + '\n__t.s = swSample;', ctx);
  ctx.__t.s();
  const runsAfterFirst = rafRuns;
  ok('B9a 首次采样照常运行', runsAfterFirst > 0 && samples.length === 1, 'runs=' + runsAfterFirst);
  clock += 60 * 1000; // 1 分钟后回桌面
  ctx.__t.s();
  ok('B9 5 分钟内再次回桌面：不再开采样循环', rafRuns === runsAfterFirst && samples.length === 1);
  clock += 6 * 60 * 1000; // 越过 5 分钟
  ctx.__t.s();
  ok('B10 超过 5 分钟：采样恢复（限频不死锁）', rafRuns > runsAfterFirst && samples.length === 2);
}

// ===== Z 防修过头闸（HEAD 既有行为仍在） =====
ok('Z1 超限快照折半兜底仍在（#180）', chatSrc.includes('while (snap.length > LS_SNAP_LIMIT && snapArr.length > 1 && round < 5)'));
ok('Z2 表情包 durable 确认链仍在', (chatSrc.match(/myeEnsureDurable\(0\)/g) || []).length >= 2);
ok('Z3 写日志回放/合并入口未被触碰', idbSrc.includes('function wrjReplay(entries)'));
ok('Z4 桌面重应用仍含页背（同步段）', extractFn(persSrc, 'function refreshDeskVisuals').includes('applyPageBgs'));
ok('Z5 手动性能检测通道未被限频波及', !read('src/js/perf-check.js').includes('swSample'));
ok('Z6 采样器仍保留（只限频不删除）', sliderSrc.includes('localStorage.setItem(SW_KEY'));

// ===== 汇总 =====
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
}
setTimeout(finish, 600);
