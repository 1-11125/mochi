// ===== 验证脚本：#553 经期语境分流——经前预警日/推迟日不再发「经期中」口吻关心，改发带天数的「经期预警」 =====
// 用法：
//   node tools/verify-period-care-warn.mjs          —— 修复版应全绿（A 静态锚点 + B 行为断言）
//   node tools/verify-period-care-warn.mjs --red    —— 对 HEAD 原码跑 B 段，应恰好 4 项判别断言失败（判别力实证）
//
// 背景（用户反馈）：「还没到经期时间，联系人直接在聊天里发送了经期关心」——
//   旧版 checkCare 三种触发语境（经期中 / 经前 advanceDays 提醒日 / 推迟≥5 天）共用
//   「经期关心」语料（经期中口吻，如「今天经期第几天了？肚子还痛不痛」），经期还没到
//   就把这种话发进聊天。修复 = 语境分流：经前预警日/推迟日只从新增「经前预警」「经期
//   推迟」分组抽预警语（{d} 占位符替换为具体天数），附「经期预警」标签；「经期关心」
//   标签与原语料仅经期中使用。B 段用 vm 桩环境加载真实源码（default-cards-data.js +
//   period.js），种子 period-records 控制周期相位，Math.random=0 全确定性。
import { readFileSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import vm from 'node:vm';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const RED = process.argv.includes('--red');
const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok, discriminating: false });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '  [' + detail + ']' : ''));
}
function checkDisc(desc, ok) {
  results.push({ desc, ok: !!ok, discriminating: true });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail ? '' : ''));
  function detail() {}
}

// ---- A 段：静态锚点（RED 模式跳过——HEAD 原码本来就没有这些锚点）----
if (!RED) {
  const periodSrc = read('src/js/period.js');
  const dataSrc = read('src/js/default-cards-data.js');
  const dcSrc = read('src/js/default-cards.js');
  check('A1 period.js 按分组名取语料助手 + 经期关心同源读取', periodSrc.includes("cardGroupLines('经期关心', PERIOD_CARE_FALLBACK)") && periodSrc.includes('function cardGroupLines(name, fb)'));
  check('A2 预警语抽取器（经前预警/经期推迟分组，全关返回空串不发送）', periodSrc.includes("cardGroupLines(kind === 'adv' ? '经前预警' : '经期推迟'") && periodSrc.includes('function pickWarnLine(kind)'));
  check('A3 checkCare 语境 kind 分流（in/adv/delay）', periodSrc.includes("ctx = 'inPeriod'; kind = 'in';") && periodSrc.includes("ctx = 'adv' + d; kind = 'adv';") && periodSrc.includes("ctx = 'delay'; kind = 'delay';"));
  check('A4 预警语 {d} 替换为具体天数', periodSrc.includes('String(line).replace(/\\{d\\}/g, String(diffDays(today, st.nextStart)));') && periodSrc.includes('String(line).replace(/\\{d\\}/g, String(delayDays));'));
  check('A5 标签按语境区分（经期关心/经期预警）', periodSrc.includes("{ tag: kind === 'in' ? '经期关心' : '经期预警' }"));
  check('A6 数据源：经期关心保持第 0 组 + 新增经前预警/经期推迟分组', dataSrc.indexOf('["经期关心"') >= 0 && dataSrc.indexOf('["经期关心"') < dataSrc.indexOf('["温柔前缀"') && dataSrc.includes('["经前预警", [') && dataSrc.includes('["经期推迟", ['));
  check('A7 预警语带 {d} 占位符', dataSrc.includes('还有 {d} 天左右可能就来经期了') && dataSrc.includes('经期已经推迟 {d} 天了'));
  check('A8 字卡库「TA的关心」说明更新（语境分流 + 标签区分）', dcSrc.includes('按语境分流') && dcSrc.includes('「经期预警」'));
}

// ---- B 段：vm 桩环境跑真实源码的行为断言 ----
const srcPeriod = RED ? execSync('git show HEAD:src/js/period.js', { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
                      : read('src/js/period.js');
const srcData = RED ? execSync('git show HEAD:src/js/default-cards-data.js', { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
                    : read('src/js/default-cards-data.js');

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function dayStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function daysAgoStr(n) { var d = new Date(); d.setDate(d.getDate() - n); return dayStr(d); }
function todayLocal() { return dayStr(new Date()); }

// 取当前源码里「经前预警」分组语料（给 B8 全关断言用；RED 模式下无该分组则用空表）
function prewarnLines() {
  try {
    const s = { window: {} };
    vm.createContext(s);
    vm.runInContext(srcData, s, { filename: 'default-cards-data.js' });
    const g = s.window.DEFAULT_CARD_DATA && s.window.DEFAULT_CARD_DATA.period;
    if (Array.isArray(g)) for (const grp of g) if (grp && grp[0] === '经前预警') return grp[1];
  } catch (e) {}
  return [];
}
const PREWARN = prewarnLines();

// 建一个全新桩环境：种子经期记录（start = 今天-agoAgo 天前）、提醒配置；返回 { calls, api }
function scenario(startDaysAgo, opts) {
  opts = opts || {};
  const lsMap = new Map();
  lsMap.set('period-records', JSON.stringify([{ id: 'r1', start: daysAgoStr(startDaysAgo), end: opts.end || null }]));
  lsMap.set('period-notify', JSON.stringify({ enabled: false, advanceDays: [3, 1, 0], hour: 9, careEnabled: opts.careEnabled !== false, fired: {} }));
  if (opts.blockPrewarn) PREWARN.forEach((l) => lsMap.set('dc-off-period:' + l, '1'));
  const store = {
    get: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    set: (k, v) => lsMap.set(k, v),
    remove: (k) => lsMap.delete(k)
  };
  const calls = [];
  const sandbox = {
    setTimeout: function () { return 0; },
    clearTimeout: function () {},
    setInterval: function () { return 0; },
    clearInterval: function () {},
    console: { info: function () {}, warn: function () {}, error: function () {}, log: function () {} }
  };
  sandbox.window = sandbox;
  sandbox.window.xyStore = function () { return store; };
  sandbox.window.chatAddIn = function (text, opts2) { calls.push({ text: String(text), tag: (opts2 && opts2.tag) || '' }); };
  sandbox.Math = Object.assign(Object.create(Math), { random: function () { return 0; } });
  // page-period 桩：truthy 即可（period.js 早期判空），hidden=true 防 render
  sandbox.document = {
    getElementById: function (id) { return id === 'page-period' ? { hidden: true } : null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    addEventListener: function () {},
    removeEventListener: function () {},
    createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {} }, addEventListener: function () {} }; },
    body: { classList: { add: function () {}, remove: function () {} } }
  };
  vm.createContext(sandbox);
  vm.runInContext(srcData, sandbox, { filename: 'default-cards-data.js' });
  vm.runInContext(srcPeriod, sandbox, { filename: 'period.js' });
  sandbox.window.periodCheckCare();
  return calls;
}
const errs = [];
function run(name, fn) {
  try { fn(); } catch (e) { errs.push(name + ': ' + (e && e.message)); console.log('FAIL  ' + name + '  [异常: ' + (e && e.message) + ']'); results.push({ desc: name, ok: false, discriminating: false }); }
}

run('B1 经前预警日（距预测经期 3 天）→ 发「经期预警」且带天数、不含 {d}、非经期中口吻', () => {
  const calls = scenario(25);
  if (calls.length !== 1) throw new Error('应发 1 条，实发 ' + calls.length);
  checkDisc('B1a 标签=经期预警（RED 必失败：旧版=经期关心）', calls[0].tag === '经期预警');
  checkDisc('B1b 文案带具体天数「3 天」（RED 必失败：旧版无天数）', calls[0].text.indexOf('3 天') >= 0);
  if (calls[0].text.indexOf('{d}') >= 0) throw new Error('占位符未替换: ' + calls[0].text);
  if (PREWARN.length && !PREWARN.some((l) => l.replace(/\{d\}/g, '3') === calls[0].text)) throw new Error('文案不在经前预警分组: ' + calls[0].text);
  console.log('PASS  B1c 文案来自「经前预警」分组且 {d} 已替换');
  results.push({ desc: 'B1c 文案来自「经前预警」分组且 {d} 已替换', ok: true, discriminating: false });
});
run('B2 推迟 ≥5 天（已推迟 13 天）→ 发「经期预警」且带推迟天数', () => {
  const calls = scenario(40);
  if (calls.length !== 1) throw new Error('应发 1 条，实发 ' + calls.length);
  checkDisc('B2a 标签=经期预警（RED 必失败）', calls[0].tag === '经期预警');
  checkDisc('B2b 文案带推迟天数「13 天」（RED 必失败）', calls[0].text.indexOf('13 天') >= 0);
  if (calls[0].text.indexOf('{d}') >= 0) throw new Error('占位符未替换: ' + calls[0].text);
});
run('B3 经期中 → 仍发「经期关心」（原语料，语境不受影响）', () => {
  const calls = scenario(0);
  if (calls.length !== 1) throw new Error('应发 1 条，实发 ' + calls.length);
  if (calls[0].tag !== '经期关心') throw new Error('标签应为经期关心: ' + calls[0].tag);
  if (calls[0].text.indexOf('{d}') >= 0) throw new Error('占位符泄漏: ' + calls[0].text);
  console.log('PASS  B3 经期中标签/语料不变'); results.push({ desc: 'B3 经期中标签/语料不变', ok: true, discriminating: false });
});
run('B4 距下次经期 18 天（不在预警日）→ 不发任何消息（无预警日不主动提经期）', () => {
  const calls = scenario(10);
  if (calls.length !== 0) throw new Error('不应发消息，实发 ' + calls.length + ': ' + JSON.stringify(calls));
  console.log('PASS  B4 非预警日零消息'); results.push({ desc: 'B4 非预警日零消息', ok: true, discriminating: false });
});
run('B5 经前预警日（提前 1 天）→ 发「经期预警」且带「1 天」', () => {
  const calls = scenario(27);
  if (calls.length !== 1) throw new Error('应发 1 条，实发 ' + calls.length);
  checkDisc('B5a 标签=经期预警（RED 必失败）', calls[0].tag === '经期预警');
  checkDisc('B5b 文案带「1 天」（RED 必失败）', calls[0].text.indexOf('1 天') >= 0);
});
run('B6 同一语境同日只发一条（冷却不受分流影响）', () => {
  const lsMap = new Map();
  lsMap.set('period-records', JSON.stringify([{ id: 'r1', start: daysAgoStr(25), end: null }]));
  lsMap.set('period-notify', JSON.stringify({ enabled: false, advanceDays: [3, 1, 0], hour: 9, careEnabled: true, fired: {} }));
  const store = { get: (k) => (lsMap.has(k) ? lsMap.get(k) : null), set: (k, v) => lsMap.set(k, v), remove: (k) => lsMap.delete(k) };
  const calls = [];
  const sandbox = { setTimeout: function () { return 0; }, console: { info: function () {}, warn: function () {}, error: function () {}, log: function () {} } };
  sandbox.window = sandbox;
  sandbox.window.xyStore = function () { return store; };
  sandbox.window.chatAddIn = function (text, o) { calls.push({ text: String(text), tag: (o && o.tag) || '' }); };
  sandbox.Math = Object.assign(Object.create(Math), { random: function () { return 0; } });
  sandbox.document = {
    getElementById: function (id) { return id === 'page-period' ? { hidden: true } : null; },
    querySelector: function () { return null; }, querySelectorAll: function () { return []; },
    addEventListener: function () {}, removeEventListener: function () {},
    createElement: function () { return { style: {}, classList: { add: function () {}, remove: function () {} }, addEventListener: function () {} }; },
    body: { classList: { add: function () {}, remove: function () {} } }
  };
  vm.createContext(sandbox);
  vm.runInContext(srcData, sandbox, { filename: 'default-cards-data.js' });
  vm.runInContext(srcPeriod, sandbox, { filename: 'period.js' });
  sandbox.window.periodCheckCare();
  sandbox.window.periodCheckCare();
  if (calls.length !== 1) throw new Error('同日两次判定应只发 1 条，实发 ' + calls.length);
  console.log('PASS  B6 同日冷却'); results.push({ desc: 'B6 同日冷却', ok: true, discriminating: false });
});
run('B7 经期页「梦角关心」开关关闭 → 完全不发', () => {
  const calls = scenario(25, { careEnabled: false });
  if (calls.length !== 0) throw new Error('不应发消息，实发 ' + calls.length);
  console.log('PASS  B7 开关关断'); results.push({ desc: 'B7 开关关断', ok: true, discriminating: false });
});
run('B8 字卡库把「经前预警」整组关掉 → 经前预警日一条不发（不再回落经期中语料）', () => {
  if (!PREWARN.length) { console.log('SKIP  B8（源码无经前预警分组）'); return; }
  const calls = scenario(25, { blockPrewarn: true });
  checkDisc('B8 整组关闭时经前预警日零发送（RED 必失败：旧版照发经期关心）', calls.length === 0);
});

// ---- 汇总 ----
const total = results.length;
const pass = results.filter((r) => r.ok).length;
console.log('----');
console.log((RED ? 'RED 基线' : '结果') + ': ' + pass + '/' + total);
const failedDisc = results.filter((r) => r.discriminating && !r.ok);
const failedPlain = results.filter((r) => !r.discriminating && !r.ok);
if (errs.length) console.log('异常项: ' + errs.length);
if (RED) {
  // RED 基线：判别断言（B1a/B1b/B2a/B2b/B5a/B5b/B8）应全失败；其余应全通过
  const discAll = results.filter((r) => r.discriminating);
  const discFail = discAll.filter((r) => !r.ok);
  const plainFail = failedPlain;
  if (discFail.length === discAll.length && discAll.length > 0 && plainFail.length === 0 && errs.length === 0) {
    console.log('✅ RED 基线成立：判别断言 ' + discFail.length + '/' + discAll.length + ' 全失败、非判别断言全通过（脚本有牙）');
    process.exitCode = 0;
  } else {
    console.log('❌ RED 基线不符合预期：判别失败 ' + discFail.length + '/' + discAll.length + '（应全失败），非判别失败 ' + plainFail.length + '（应全通过）');
    process.exitCode = 1;
  }
} else {
  if (pass === total && errs.length === 0) { console.log('✅ 全部通过'); process.exitCode = 0; }
  else { console.log('❌ 有失败项'); process.exitCode = 1; }
}
