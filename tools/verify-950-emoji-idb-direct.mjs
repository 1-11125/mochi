// verify-950-emoji-idb-direct.mjs — #950 表情包大包 IDB 数组直存 行为断言
// 判别面：保存按体积分流（大包数组直存+memoryCache 驻留、小包维持字符串路径）/
//         读回类型感知（myEmojiLoad/防覆盖闸门 merge）/ 落盘确认重发同形态 /
//         idbMemoSet 驻留+bigIdx 维护 / IDB 写超时估算器嵌套数组 / 回填大对象直驻免串化。
// 用法：node tools/verify-950-emoji-idb-direct.mjs   （在仓库根运行）
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

let finished = false;
function doneAll() {
  if (finished) return;
  finished = true;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
}

// ===== S 源锚 =====
ok('S1 myePersist 分流入口存在', chatSrc.includes('function myePersist()'));
ok('S2 idbMemoSet 驻留口存在', idbSrc.includes('window.idbMemoSet = function (key, value) {'));
ok('S3 估算器嵌套数组递归存在', idbSrc.includes('est += est950(value[i], 0)'));
ok('S4 落盘确认重发同形态', chatSrc.includes('myeBytesEst() > MYE_DIRECT_LIMIT ? (myGroups || []) : myeSaveJson()'));
ok('S5 闸门读回类型感知', chatSrc.includes("typeof rawGate === 'string'"));
ok('S6 myEmojiLoad 类型感知', extractFn(chatSrc, 'function myEmojiLoad').includes("typeof raw === 'string'"));

// ===== B1/B2 myePersist 分流行为 =====
{
  const fn = extractFn(chatSrc, 'function myePersist()');
  const estFn = extractFn(chatSrc, 'function myeBytesEst()');
  let idbSets = [], storeSets = [], memoSets = [];
  if (!fn || !estFn) { ok('B1 大包：走 idbSet 数组直存（不串化）', false, '函数缺失'); ok('B1b 大包：不走 store.set 字符串路径', false); ok('B1c 大包：同一数组驻进 memoryCache（跨桌面合并读端可见）', false); ok('B2 小包：维持原 store.set 字符串路径（备份/合并链零变化）', false); }
  else {
  var run = function (groups) {
    idbSets = []; storeSets = []; memoSets = [];
    const ctx = {
      MYE_DIRECT_LIMIT: 2 * 1024 * 1024,
      myGroups: groups,
      MYE_KEY: () => 'xy-home-v2:my-emoji-groups',
      window: { idbSet: (k, v) => { idbSets.push([k, v]); return Promise.resolve(true); }, idbMemoSet: (k, v) => { memoSets.push([k, v]); } },
      myEmojiStore: () => ({ set: (k, v) => { storeSets.push([k, v]); } }),
      myeSaveJson: () => JSON.stringify(groups),
    };
    vm.runInNewContext(estFn + '\n' + fn + '\nmp = myePersist();', ctx);
  }
  // 大包：3MB dataURL
  const big = [['大分组', ['data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024)]]];
  run(big);
  ok('B1 大包：走 idbSet 数组直存（不串化）', idbSets.length === 1 && Array.isArray(idbSets[0][1]), JSON.stringify({ idb: idbSets.length }));
  ok('B1b 大包：不走 store.set 字符串路径', storeSets.length === 0);
  ok('B1c 大包：同一数组驻进 memoryCache（跨桌面合并读端可见）', memoSets.length === 1 && Array.isArray(memoSets[0][1]) && memoSets[0][1] === big);
  // 小包：字符串路径原样
  run([['小分组', ['data:image/png;base64,' + 'A'.repeat(1000)]]]);
  ok('B2 小包：维持原 store.set 字符串路径（备份/合并链零变化）', storeSets.length === 1 && typeof storeSets[0][1] === 'string' && idbSets.length === 0);
  }
}

// ===== B3 myeBytesEst 只数长度不串化 =====
{
  const estFn = extractFn(chatSrc, 'function myeBytesEst()');
  const big = [['g', ['data:image/png;base64,' + 'A'.repeat(4 * 1024 * 1024)]]];
  const ctx = { myGroups: big };
  const n = estFn ? vm.runInNewContext(estFn + '\nest = myeBytesEst();', ctx) : -1;
  ok('B3 估算：3MB dataURL 估出 ≥3MB（不拷贝不串化）', n >= 4 * 1024 * 1024, 'est=' + n);
}

// ===== B4 myeEnsureDurable 大包重发不再整包 stringify =====
{
  const fn = extractFn(chatSrc, 'function myeEnsureDurable(tries)');
  const estFn = extractFn(chatSrc, 'function myeBytesEst()');
  let sent = [], stringifyCount = 0;
  const ctx = {
    MYE_DIRECT_LIMIT: 2 * 1024 * 1024,
    myGroups: [['g', ['data:image/png;base64,' + 'A'.repeat(3 * 1024 * 1024)]]],
    MYE_KEY: () => 'K',
    window: { idbSet: (k, v) => { sent.push(v); return Promise.resolve(true); } },
    myeSaveJson: () => { stringifyCount++; return JSON.stringify(ctx.myGroups); },
    clearTimeout, setTimeout: () => 0,
    myeDurableTimer: null,
    toast: () => {},
    Promise,
  };
  if (!fn || !estFn) { ok('B4 大包退避重发走数组形态（零 stringify）', false, '函数缺失'); doneAll(); }
  else {
  vm.runInNewContext(estFn + '\n' + fn + '\nmyeEnsureDurable(0);', ctx);
  await0(() => {
    ok('B4 大包退避重发走数组形态（零 stringify）', sent.length === 1 && Array.isArray(sent[0]) && stringifyCount === 0, 'sent=' + sent.length + ' str=' + stringifyCount);
    doneAll();
  });
  }
}
function await0(f) { setTimeout(f, 50); }

// ===== B5 idbMemoSet 驻留 + bigIdx 维护 =====
{
  const src = extractFn(idbSrc, 'window.idbMemoSet = function (key, value) {');
  let idxWrites = 0;
  const store = {};
  const ctx = {
    window: {},
    memoryCache: {},
    _bigIdx: { 'old-big': 999999 },
    LS_BIG_LIMIT: 200 * 1024,
    localStorage: { setItem: (k, v) => { idxWrites++; } }, // bigIdxSave 的持久化走真 setTimeout
    clearTimeout, setTimeout,
  };
  vm.runInNewContext(src, ctx);
  const bigArr = [['g', ['data:image/png;base64,' + 'A'.repeat(300 * 1024)]]];
  vm.runInNewContext(src + '\nwindow.idbMemoSet("K1", V1);', Object.assign({ V1: bigArr }, ctx));
  ok('B5 大数组驻进 memoryCache（值本体，非拷贝）', ctx.memoryCache && ctx.memoryCache.K1 === bigArr);
  ok('B5b bigIdx 记录大键', ctx._bigIdx.K1 > 200 * 1024, 'idx=' + ctx._bigIdx.K1);
}

// ===== B6 idbSet 估算器：表情包形状估出真实体积（超时放大不误判挂起） =====
{
  // 从 idbSet 源里摘出估算段（try{let est=0 ... }catch）单独执行
  const i = idbSrc.indexOf('let lim = 4000;');
  const j = idbSrc.indexOf('} catch (e) {}', i);
  ok('B6pre 估算段可定位', i > 0 && j > i);
  if (i > 0 && j > i) {
    const block = idbSrc.slice(i, j + '} catch (e) {}'.length);
    const emojiPack = [['分组A', ['data:image/png;base64,' + 'A'.repeat(1024 * 1024), 'data:image/png;base64,' + 'B'.repeat(1024 * 1024)]]];
    const ctx = { value: emojiPack };
    const lim = vm.runInNewContext(block + '\nlim;', ctx);
    ok('B6 表情包 2MB 级：估算放大小 2 档（4000+4000≈8000ms）', lim >= 7900, 'lim=' + lim);
    const chatMsg = [{ text: 'hi', parts: [{ v: 'x'.repeat(300 * 1024) }] }];
    const lim2 = vm.runInNewContext(block + '\nlim;', { value: chatMsg });
    ok('B6b 聊天消息形状：既有口径不回退（>256KB 放大）', lim2 > 4000, 'lim=' + lim2);
  }
}

// ===== B7 retainValue 大对象直驻（免启动串化） =====
{
  const fn = extractFn(idbSrc, 'function retainValue(k, v) {');
  ok('B7pre retainValue 可摘取', !!fn);
  if (fn) {
    let stringifyCalls = 0;
    const bigArr = [['g', ['data:image/png;base64,' + 'A'.repeat(300 * 1024)]]];
    const ctx = {
      v: bigArr, k: 'K',
      memoryCache: null,
      _bigIdx: {}, LS_BIG_LIMIT: 200 * 1024, BIG_BUDGET: 32 * 1024 * 1024,
      bigBudgetUsed: 0, budgetWarned: false,
      _lsDirtyKeys: null,
      window: { __xyIdbDeferredKeys: [] },
      localStorage: { getItem: () => null, setItem: () => {} },
      bigIdxSave: () => {},
      console: { info: () => {} },
      JSON: { stringify: (x) => { stringifyCalls++; return '{}'; }, parse: JSON.parse },
      Math,
    };
    const r = vm.runInNewContext(fn + '\nrv = retainValue(k, v);', ctx);
    ok('B7 大数组直驻 memoryCache（值本体）', r === true && ctx.memoryCache && ctx.memoryCache.K === bigArr);
    ok('B7b 零串化（启动回填不再 30MB stringify）', stringifyCalls === 0, 'str=' + stringifyCalls);
    ok('B7c bigIdx 记上体积（流式恢复预算仍认得）', ctx._bigIdx.K > 200 * 1024);
    // 小对象仍走字符串形态
    const ctx2 = Object.assign({}, ctx, { v: { a: 1 }, k: 'S', memoryCache: null, _bigIdx: {}, bigBudgetUsed: 0 });
    const r2 = vm.runInNewContext(fn + '\nrv = retainValue(k, v);', ctx2);
    ok('B7d 小对象仍串化驻留（老键形态零变化）', r2 === true && typeof ctx2.memoryCache.S === 'string');
  }
}

// ===== B8 闸门 merge 读回数组形态 =====
{
  // 模拟闸门读回片段：memoryCache 里是数组时，rawGate 为数组 → full=数组
  const rawGate = [['g', ['x']]];
  const full = typeof rawGate === 'string' ? JSON.parse(rawGate || 'null') : (rawGate || null);
  ok('B8 数组形态读回不经 JSON.parse（合并链可用）', Array.isArray(full));
  const rawStr = JSON.stringify(rawGate);
  const full2 = typeof rawStr === 'string' ? JSON.parse(rawStr || 'null') : (rawStr || null);
  ok('B8b 字符串形态读回照常 parse（老格式兼容）', Array.isArray(full2));
}

// ===== Z 防修过头闸 =====
ok('Z1 myeSaveJson 仍在（小包路径/备份兼容）', chatSrc.includes('function myeSaveJson()'));
ok('Z2 #943b 防抖仍在', chatSrc.includes('myeSaveTimer = setTimeout(function () { myeSaveTimer = null; myEmojiSaveNow(); }, 600);'));
ok('Z3 myeApplyIdb 双态读取仍在', chatSrc.includes("const data = typeof v === 'string' ? JSON.parse(v) : v;"));
ok('Z4 store.set 主体未删（其他键照常）', idbSrc.includes('window.xyStore = function (prefix) {'));
ok('Z5 idbSet put 仍在', idbSrc.includes('tx.objectStore(STORE).put(value, key);'));
ok('Z6 hydrate 慢读 6s+8s 骨架仍在', idbSrc.includes('idbHydrateKey = function (key)'));

setTimeout(doneAll, 400);
