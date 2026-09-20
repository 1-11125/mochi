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
//   A11 卡顿自检说明在 设置→关于→使用说明 11（原开屏公告第八章已按用户要求删除，template+notice.json 双份不留）
//   A12 build.mjs 登记 #726a~d 四条哨兵（删哨兵＝修复被覆盖时构建照绿）
//   A13 node --check perf-check.js 语法过
// —— #770 追加（2026-09-18 红米 K80 Chrome 实报：停在设置页自检，报告称「掉帧集中:占卜(100%)」，
//    且「结论:流畅(未捕获掉帧)」与下方「掉帧 1 帧」并存）——
//   A14 掉帧归因读最上层全屏页 .page（旧实现读 .app 桌面图标＝图标显隐不随页面切换，归因恒错）
//   A15 旧桌面图标归因读取已删（回流＝「掉帧集中」恒报图标名而非实际所在页）
//   A16 掉帧阈值自适应 jankThr + 24/34 上下限（固定 32ms 在高刷屏漏计、持续掉帧窗口漏判）
//   A17 「流畅」但对零星掉帧的结论说真话（x% 可忽略；删＝与「掉帧 N 帧」自相矛盾回流）
//   A18 「掉帧集中」≥3 帧门槛 concOk（单帧噪声不引导用户排查该页大图/长内容）
//   A19 按页采样帧数 pageFrames + 页面分布行（集中度对比的分母）
//   A20 build.mjs 登记 #770a~e 五条哨兵
// —— #818 追加（2026-09-19 iOS 卡顿定位诊断增强：点按响应延迟/最慢帧现场/低电量档识别，
//    全部仍只活在检测窗口内、窗口结束即拆＝零常驻开销）——
//   A21 点按响应采样：窗口内 passive down 戳记＋下一帧结算（删＝「点了没反应」类 iOS 报障无数据）
//   A22 响应监听随窗口拆除 removeEventListener（泄漏＝常驻监听自造卡顿源）
//   A23 最慢帧现场 top3 截断（卡在哪个页/什么动作后可定位）
//   A24 iOS 低电量 30fps 档识别 minD≥28（低电量减半帧率被误判成应用卡顿）
//   A25 build.mjs 登记 #818a~d 四条哨兵
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

// A11 公告八章已删、说明移入 设置→关于→使用说明 11（新落点在位＋旧章双份不留）
const notice = read('pwa/notice.json');
const oldSec = '八、卡顿自检（卡不卡，10 秒实测）';
check('A11 卡顿自检说明在关于·使用说明11，公告双份已删', tpl.includes("<b>先实测：卡不卡不用靠感觉——「卡顿自检」</b>") && !tpl.includes(oldSec) && !notice.includes(oldSec));

// A12 哨兵登记
const sent = (build.match(/#726[a-d] /g) || []).length;
check('A12 build.mjs 登记 #726a~d 哨兵', sent === 4, '实际 ' + sent);

// A13 语法
const ck = spawnSync(process.execPath, ['--check', join(root, 'src', 'js', 'perf-check.js')], { stdio: 'ignore' });
check('A13 node --check perf-check.js', !ck.status, 'exit ' + ck.status);

// —— #770 追加 ——
check('A14 掉帧归因读最上层全屏页 .page', pc.includes("querySelectorAll('.page:not([hidden])')"));
check('A15 旧桌面图标归因读取已删', !pc.includes(".app:not([hidden])"));
check('A16 掉帧阈值自适应 jankThr + 24/34 上下限', pc.includes('function jankThr()') && pc.includes('var MIN_JANK = 24;') && pc.includes('var MAX_JANK = 34;'));
check('A17 「流畅」+零星掉帧结论说真话（x% 可忽略）', pc.includes("'%，可忽略）'"));
check('A18 「掉帧集中」≥3 帧门槛 concOk', pc.includes('function concOk(r)'));
check('A19 按页采样帧数 pageFrames + 页面分布行', pc.includes('pageFrames') && pc.includes('采样期间主要在：'));
const sent770 = (build.match(/#770[a-e] /g) || []).length;
check('A20 build.mjs 登记 #770a~e 哨兵', sent770 === 5, '实际 ' + sent770);

// —— #818 追加 ——
check('A21 点按响应采样：窗口内 passive down 戳记＋下一帧结算', pc.includes("var downEv = window.PointerEvent ? 'pointerdown' : 'mousedown';") && pc.includes('var lat = now - lastDown; lastDown = -1;'));
check('A22 响应监听随窗口拆除（removeEventListener 收尾）', pc.includes('removeEventListener(downEv, onDown)'));
check('A23 最慢帧现场 top3 截断', pc.includes('scene.length = 3;'));
check('A24 iOS 低电量 30fps 档识别（minD≥28ms）', pc.includes('rep.lp = minD >= 28;'));
const sent818 = (build.match(/#818[a-d] /g) || []).length;
check('A25 build.mjs 登记 #818a~d 哨兵', sent818 === 4, '实际 ' + sent818);

console.log('----');
console.log('verify-perf-check: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
