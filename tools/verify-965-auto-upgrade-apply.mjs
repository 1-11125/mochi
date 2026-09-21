// verify-965-auto-upgrade-apply.mjs — #965「用户一直用旧版本」根治回归断言（源级 + vm 行为）
// 背景：自动升级旧行为＝「用户已交互就放弃自动重载，只弹更新条」；多数用户不点更新条＝长期停在
//   旧版、拿已修好的旧版 bug 反馈。修法＝不再放弃——后台照常预取，reload 改为「页面转后台
//   （切走/回桌面/锁屏）时落地」的待换版登记；前台轮询发现新版也走自动通道；会话守卫改按版本 ts。
//
//   S1 armAutoReloadWhenHidden 定义在位 + 探针暴露 pending/arm
//   S2 自动通道落地改为「登记待换版 + 弹条」（不再只弹条）
//   S3 前台轮询 checkVersion 发现新版走 tryAutoUpgrade（失败才弹条）
//   S4 tryAutoUpgrade 移除「已交互即放弃」早退；会话守卫按版本 ts
//   S5 build.mjs 登记 #965a~d 四条哨兵
//   B1 前台登记：不 reload、pending=true（不打断活跃用户）
//   B2 登记后转 hidden + visibilitychange：reload 恰一次（切走即换版）
//   B3 已 hidden 时登记：立即 reload
//   B4 重复登记只挂一次监听（幂等）
//   Z 提取/运行零异常
// 用法：node tools/verify-965-auto-upgrade-apply.mjs [rootDir]
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' —— ' + detail : '')); }
}
const read = (p) => readFileSync(join(root, 'src', p), 'utf8').replace(/^\uFEFF/, '');

const pwa = read('js/pwa.js');
const build = readFileSync(join(root, 'build.mjs'), 'utf8');

check('S1 待换版登记函数与探针（pending/arm）在位',
  pwa.includes('function armAutoReloadWhenHidden()') &&
  pwa.includes('pending: function () { return _pendingAutoReload; },') &&
  pwa.includes('arm: function () { armAutoReloadWhenHidden(); }'));

check('S2 自动通道落地改为「登记待换版 + 弹条」',
  pwa.includes('if (auto && !autoReloadAllowed()) { armAutoReloadWhenHidden(); showVerBar(autoTs); return; }'));

check('S3 前台轮询发现新版也走自动通道（checkVersion → tryAutoUpgrade）',
  pwa.includes('if (ts > baseTs) { if (!tryAutoUpgrade(ts)) showVerBar(ts); }'));

check('S4 已交互不再早退 + 会话守卫按版本 ts',
  !pwa.includes('if (!autoReloadAllowed()) return false;') &&
  pwa.includes('if (_ts > 0 && last >= _ts) return false;'));

const s965 = (build.match(/#965[a-d] /g) || []).length;
check('S5 build.mjs 登记 #965a~d 四哨兵', s965 === 4, '实际 ' + s965);

// —— 行为：把 armAutoReloadWhenHidden 段摘出来在独立 vm 沙箱里真跑 ——
function loadArm() {
  const start = pwa.indexOf('let _pendingAutoReload = false;');
  const end = pwa.indexOf('// 无头验证专用探针');
  if (start < 0 || end < 0 || end <= start) return { err: '定位 arm 段失败' };
  const snippet = pwa.slice(start, end);
  const sandbox = { reloads: 0, handlers: [], visibility: 'visible' };
  const doc = {
    addEventListener: function (type, fn) { if (type === 'visibilitychange') sandbox.handlers.push(fn); },
    get visibilityState() { return sandbox.visibility; }
  };
  const loc = { reload: function () { sandbox.reloads++; } };
  let api = null;
  try {
    const factory = new Function('document', 'location',
      snippet + '\nreturn { arm: armAutoReloadWhenHidden, pending: function () { return _pendingAutoReload; } };');
    api = factory(doc, loc);
  } catch (e) { sandbox.err = String((e && e.message) || e); }
  return { api: api, sandbox: sandbox, err: sandbox.err };
}
function fire(sandbox) { sandbox.handlers.slice().forEach(function (h) { try { h(); } catch (e) {} }); }

{
  const h = loadArm();
  if (!h.api) check('B1/B2 提取 armAutoReloadWhenHidden', false, h.err || '提取失败');
  else {
    h.api.arm();
    const p1 = h.api.pending(), r1 = h.sandbox.reloads;
    h.sandbox.visibility = 'hidden';
    fire(h.sandbox);
    check('B1 前台登记不 reload 且 pending=true（got pending=' + p1 + ' reload=' + r1 + '）', p1 === true && r1 === 0);
    check('B2 转 hidden 后 reload 恰一次（got ' + h.sandbox.reloads + '）', h.sandbox.reloads === 1);
  }
}
{
  const h = loadArm();
  if (!h.api) check('B3 已 hidden 时登记立即 reload', false, h.err || '');
  else {
    h.sandbox.visibility = 'hidden';
    h.api.arm();
    check('B3 已 hidden 时登记立即 reload（got ' + h.sandbox.reloads + '）', h.sandbox.reloads === 1);
  }
}
{
  const h = loadArm();
  if (!h.api) check('B4 重复登记幂等', false, h.err || '');
  else {
    h.api.arm(); h.api.arm(); h.api.arm();
    check('B4 重复登记只挂一个监听（got ' + h.sandbox.handlers.length + '）', h.sandbox.handlers.length === 1);
  }
}
check('Z 提取/运行全程零异常', true);

console.log('----');
console.log('verify-965-auto-upgrade-apply: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
