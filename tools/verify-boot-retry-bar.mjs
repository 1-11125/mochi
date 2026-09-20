// #939 「网络不佳·点此重试」条假阳性根治——行为级验证
// 缺陷面（HEAD）：①看门狗只查 load+3s/8s 两次、条挂上后永不摘除＝慢机数据回填>3s 被误标
// 「网络不佳」，之后就绪也不消失，点重试重载再走一遍同时序又挂上＝「刷新也没用」；
// ②模块运行期抛错（取到了但执行失败）被算进 missing()＝与网络无关的确定性失败，
// 条永挂 + #921h 每 2h 白重载。
// 本脚本从 build.mjs 提取注入的看门狗代码串，在 mock 环境里跑行为断言。
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
let fail = 0;
const t = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) fail++; };

// ---- S 组：源级锚（只对代码区断言——FIX_SENTINELS 登记行本身含相同文本，会假绿）----
const srcCode = src.slice(0, src.indexOf('const FIX_SENTINELS'));
t('S1 catch 登记错误清单（__mochiErrLoaded.push）', /catch \(__e\) \{ if \(window\.__mochiErrLoaded\) window\.__mochiErrLoaded\.push/.test(srcCode));
t('S2 初始化行含错误清单', srcCode.includes('window.__mochiErrLoaded = window.__mochiErrLoaded || [];'));
t('S3 健康判据扣除错误清单（sweep 自包含口径）', srcCode.includes('ex - (window.__mochiLoaded || []).length - (window.__mochiErrLoaded || []).length <= 0'));
t('S4 sweep 健康撤条', srcCode.includes('function sweep() { var ex = (window.__mochiJsFiles || []).length, ok = !!window.__mochiDataReady && ex'));
t('S5 mochi-restore-done 事件复查', srcCode.includes('document.addEventListener("mochi-restore-done"'));

// ---- 提取看门狗代码串（纯 HEAD 红基线上 sweep 不存在 → 提取仍成功，B 组逐条报红）----
function extractWatchdog() {
  const start = src.indexOf('jsWrapped.push(');
  if (start < 0) throw new Error('watchdog push not found');
  const seg = src.slice(start, start + 20000);
  const strs = [];
  const re = /'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(seg))) {
    const s = m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
    strs.push(s);
    if (s === '})();') break;
  }
  return strs.join('');
}
const watchdog = extractWatchdog();
if (!watchdog.includes('__mochiBootRetry')) { console.log('FAIL S0 看门狗注入串提取失败'); process.exit(1); }

function makeEnv({ dataReady, errFiles = [], loadedFiles = [], expectedN = 3 }) {
  const doc = {
    rawBar: null, readyState: 'complete',
    body: { appendChild(el) { this.owner.rawBar = el; }, owner: null },
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    getElementById(id) { return this.rawBar && this.rawBar.id === id ? this.rawBar : null; },
    createElement() {
      const self = this;
      return { id: '', addEventListener() {}, style: {}, parentNode: { removeChild() { self.rawBar = null; } } };
    },
    dispatch(ev) { (this.listeners[ev] = this.listeners[ev] || []).forEach(f => f({})); },
  };
  doc.body.owner = doc;
  const timers = [];
  const win = {
    __mochiJsFiles: Array.from({ length: expectedN }, (_, i) => 'f' + i + '.js'),
    __mochiLoaded: loadedFiles.slice(), __mochiErrLoaded: errFiles.slice(),
    __mochiDataReady: dataReady,
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    addEventListener() {},
  };
  const showBar = function () { doc.rawBar = doc.createElement(); };
  const state = { reloaded: 0 };
  const navigator = { onLine: true };
  const sessionStorage = { _s: {}, getItem(k) { return this._s[k] || null; }, setItem(k, v) { this._s[k] = String(v); } };
  const location = { replace() { state.reloaded++; }, href: 'x', reload() { state.reloaded++; } };
  return { win, doc, timers, showBar, state, navigator, sessionStorage, location };
}

function runWatchdog(e) {
  const fn = new Function('window', 'document', 'bar', 'navigator', 'sessionStorage', 'location', 'setTimeout', 'clearTimeout', watchdog);
  fn(e.win, e.doc, e.showBar, e.navigator, e.sessionStorage, e.location, e.win.setTimeout, () => {});
}
function runChecks(e) {
  for (const tm of e.timers) if (tm.ms !== 50 && tm.ms !== 400) tm.fn();
}
function runDeferred(e) {
  for (const tm of e.timers) if (tm.ms === 50 || tm.ms === 400) tm.fn();
}

// ---- B 组：行为 ----
// B1 健康态（数据就绪+全模块到位）：两次 check 都不挂条
{
  const e = makeEnv({ dataReady: true, loadedFiles: ['f0.js', 'f1.js', 'f2.js'] });
  runWatchdog(e); runChecks(e);
  t('B1 健康态不挂条', e.doc.rawBar === null);
}
// B2 慢数据（3s/8s 时未就绪 → 挂条；之后 mochi-restore-done → 撤条）＝本批主修复
{
  const e = makeEnv({ dataReady: false, loadedFiles: ['f0.js', 'f1.js', 'f2.js'] });
  runWatchdog(e); runChecks(e);
  t('B2a 慢数据 3s/8s 挂条', e.doc.rawBar !== null);
  e.win.__mochiDataReady = true;
  e.doc.dispatch('mochi-restore-done'); runDeferred(e);
  t('B2b 数据就绪事件后撤条（HEAD 恒红＝条永不摘除）', e.doc.rawBar === null);
}
// B3 运行期抛错模块不进 missing()（HEAD 恒红＝missing 永远>0）
{
  const e = makeEnv({ dataReady: true, loadedFiles: ['f0.js'], errFiles: ['f1.js'] }); // f2 真缺
  runWatchdog(e); runChecks(e);
  t('B3a 抛错件被豁免、真缺件仍挂条', e.doc.rawBar !== null);
  const e2 = makeEnv({ dataReady: true, loadedFiles: ['f0.js'], errFiles: ['f1.js', 'f2.js'] });
  runWatchdog(e2); runChecks(e2);
  t('B3b 抛错全部豁免后健康不挂条', e2.doc.rawBar === null);
}
// B4/B5/B6 依赖 #921h 的 heal（在途批）；本批提交形态（HEAD＋仅本批）无 heal，条件跳过
const hasHeal = watchdog.includes('function heal');
{
  const e = makeEnv({ dataReady: true, loadedFiles: ['f0.js'], errFiles: ['f1.js', 'f2.js'] });
  runWatchdog(e); runChecks(e);
  t('B4 抛错件不触发自愈重载', !hasHeal || e.state.reloaded === 0);
}
{
  const e = makeEnv({ dataReady: false, loadedFiles: ['f0.js'] }); // f1/f2 真缺
  runWatchdog(e); runChecks(e);
  t('B5a 真缺失挂条', e.doc.rawBar !== null);
  runDeferred(e);
  t('B5b 真缺失触发自愈重载（无 heal 的提交形态下豁免）', !hasHeal || e.state.reloaded === 1);
}
{
  const e = makeEnv({ dataReady: false, loadedFiles: ['f0.js', 'f1.js', 'f2.js'] });
  runWatchdog(e); runChecks(e);
  t('B6 慢数据不触发自愈重载', !hasHeal || e.state.reloaded === 0);
}

console.log(fail === 0 ? 'ALL PASS' : fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);
