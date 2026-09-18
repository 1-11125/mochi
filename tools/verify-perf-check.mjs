// verify-perf-check.mjs — #726 卡顿自检（渲染层实测）回归断言（源级，不依赖产物构建）
// 断言 src 状态（build.mjs 从 src 合并，src 状态＝产物状态）：
//   A1 perf-check.js 已登记 jsFiles 且在 mobile-adapt.js 之前（漏登记＝整功能不打包）
//   A2 template.html 有 row-perf-check 且在 row-perf-optimize 之前（删行＝无入口）
//   A3 personalize.js 接线 mochiPerfCheck.start(10000（删＝点行无反应）
//   A4 零常驻开销：requestAnimationFrame 首次出现必须在 start 函数之后（rAF 常驻＝自造卡顿源）
//   A5 后台冻结帧剔除 BG_GAP=250 在位（#707 同款教训：后台 144s 冻结被算成一帧＝误报重度）
//   A6 键盘弹出期标记在位（innerHeight * KB_RATIO；删＝iOS 键盘期结论缺失）
//   A7 本地数据画像复用 mochiPerfLevel（删＝与 #411 一键优化断链、建议退化为空话）
//   A8 上次结果持久化 LAST_KEY：perf-check 写 + personalize 回显（删＝行副标题永远无上次结论）
//   A9 长任务观察器窗口内自建且 disconnect 收尾（漏 disconnect＝观察器泄漏常驻）
//   A10 报告走只读大弹窗（noInput+textarea+big，删＝报告进了可编辑输入框/窄窗难读）
//   A11 开屏公告双份镜像：template.html 第八章 与 notice.json 第八章同在（漏一份＝公告口径分裂）
//   A12 build.mjs 登记 #726a~d 四条哨兵（删哨兵＝修复被覆盖时构建照绿）
//   A13 node --check perf-check.js 语法过
// 用法：node tools/verify-perf-check.mjs [rootDir]
import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? ' —— ' + detail : '')); }
}
const read = (p) => readFileSync(join(root, 'src', p), 'utf8').replace(/^\uFEFF/, '');

// A1 jsFiles 登记与顺序
const build = readFileSync(join(root, 'build.mjs'), 'utf8');
const jm = build.match(/const jsFiles = \[([^\]]*)\]/);
const files = jm ? jm[1].split(',').map(s => s.trim().replace(/^'|'$/g, '').replace(/^"/, '').replace(/"$/, '')) : [];
const pcIdx = files.indexOf('perf-check.js');
const maIdx = files.indexOf('mobile-adapt.js');
check('A1 jsFiles 含 perf-check.js 且在 mobile-adapt.js 之前', pcIdx > 0 && maIdx > pcIdx, 'perf-check@' + pcIdx + ' mobile-adapt@' + maIdx);

// A2 设置行存在且顺序在 row-perf-optimize 之前
const tpl = read('template.html');
const rcIdx = tpl.indexOf('id="row-perf-check"');
const roIdx = tpl.indexOf('id="row-perf-optimize"');
check('A2 row-perf-check 在位且在 row-perf-optimize 之前', rcIdx > 0 && roIdx > rcIdx, 'check@' + rcIdx + ' optimize@' + roIdx);

// A3 接线
const pz = read('js/personalize.js');
check('A3 personalize 接线 start(10000)', pz.includes('window.mochiPerfCheck.start(10000'));

// A4 零常驻：rAF 首现必须在 start 之后
const pc = read('js/perf-check.js');
const sIdx = pc.indexOf('function start(ms, onTick)');
const rIdx = pc.indexOf('requestAnimationFrame');
check('A4 零常驻开销：rAF 只在 start 内使用', sIdx > 0 && rIdx > sIdx, 'start@' + sIdx + ' raf@' + rIdx);

// A5 后台剔除
check('A5 后台冻结帧剔除 BG_GAP=250', /var BG_GAP = 250;/.test(pc));

// A6 键盘期标记
check('A6 键盘期标记 innerHeight * KB_RATIO', pc.includes('window.innerHeight * KB_RATIO'));

// A7 数据分级复用
check('A7 复用 mochiPerfLevel 数据画像', pc.includes('window.mochiPerfLevel'));

// A8 上次结果持久化 + 回显
check('A8a perf-check 写 LAST_KEY', pc.includes("localStorage.setItem(LAST_KEY"));
check('A8b personalize 回显 LAST_KEY', pz.includes('window.mochiPerfCheck.LAST_KEY'));

// A9 观察器收尾
check('A9 长任务观察器 disconnect 收尾', pc.includes('po.disconnect()'));

// A10 报告只读大弹窗
check('A10 报告走 noInput+textarea+big 弹窗', pz.includes('noInput: true, textarea: true, textareaRows: 16, big: true'));

// A11 公告双份镜像
const notice = read('pwa/notice.json');
const sec = '八、卡顿自检（卡不卡，10 秒实测）';
check('A11 开屏公告双份（template+notice.json）', tpl.includes(sec) && notice.includes(sec));

// A12 哨兵登记
const sent = (build.match(/#726[a-d] /g) || []).length;
check('A12 build.mjs 登记 #726a~d 哨兵', sent === 4, '实际 ' + sent);

// A13 语法
const ck = spawnSync(process.execPath, ['--check', join(root, 'src', 'js', 'perf-check.js')], { stdio: 'ignore' });
check('A13 node --check perf-check.js', !ck.status, 'exit ' + ck.status);

console.log('----');
console.log('verify-perf-check: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
