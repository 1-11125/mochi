// #408 粘贴导入 JSON 自救解析——纯 Node 抽源码真函数行为断言（防回归，零浏览器依赖）
// 抽取 personalize.js 的 window.mochiParsePastedJSON，覆盖：原文/BOM零宽/nbsp/包裹文字/
// 中文引号/字符串外全角标点/尾逗号/字符串内中文标点保护/空文本与垃圾抛错。
import { readFileSync } from 'node:fs';

const SRC = new URL('../src/js/personalize.js', import.meta.url);
const src = readFileSync(SRC, 'utf8');
const startMark = 'window.mochiParsePastedJSON = function (raw) {';
const si = src.indexOf(startMark);
if (si < 0) { console.error('FATAL: 找不到 mochiParsePastedJSON 定义'); process.exit(1); }
const throwMark = src.indexOf("throw (lastErr || new Error('不是有效的方案 JSON'));", si);
if (throwMark < 0) { console.error('FATAL: 找不到函数收尾 throw'); process.exit(1); }
const ei = src.indexOf('};', throwMark);
const fnSrc = src.slice(si, ei + 2);

const mochiParsePastedJSON = new Function('window', fnSrc + '\nreturn window.mochiParsePastedJSON;')({});

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('ok   ' + name); }
  else { fail++; console.error('FAIL ' + name + '\n  got:  ' + g + '\n  want: ' + w); }
};
const throws = (name, fn) => {
  try { fn(); fail++; console.error('FAIL ' + name + '（未抛错）'); }
  catch (e) { pass++; console.log('ok   ' + name + ' → ' + (e.message || e)); }
};

// 1 原文直过
eq('原文合法 JSON', mochiParsePastedJSON('{"a":1}'), { a: 1 });
// 2 BOM/零宽/双向控制
eq('BOM+零宽+双向控制字符', mochiParsePastedJSON('\uFEFF\u200B{"a\u200E":\u200F1}\u2060'), { a: 1 });
// 3 nbsp（contenteditable 粘贴常见，JSON 规范空白外字符）
eq('nbsp 空格清洗', mochiParsePastedJSON('{"a":\u00A01,\u00A0"b":2}'), { a: 1, b: 2 });
// 4 前后包裹说明文字（转发/复制带出）
eq('前后包裹说明文字裁剪', mochiParsePastedJSON('这是方案：\n{"a":1}\n复制以上内容导入'), { a: 1 });
// 5 全中文引号（无半角引号，输入法/转发改写）
eq('中文引号归一', mochiParsePastedJSON('{“a”：1，“b”：“樱花”}'), { a: 1, b: '樱花' });
// 6 字符串外全角标点（有半角引号）
eq('字符串外全角逗号冒号', mochiParsePastedJSON('{"a":1，"b":2，"c"：3}'), { a: 1, b: 2, c: 3 });
// 7 字符串内中文标点保护（值不被污染）
eq('字符串内全角标点保留', mochiParsePastedJSON('{"a":"x，y：z"}'), { a: 'x，y：z' });
// 8 尾逗号（字符串外）
eq('尾逗号丢弃', mochiParsePastedJSON('{"a":1,"b":2,}'), { a: 1, b: 2 });
eq('数组尾逗号+全角括号', mochiParsePastedJSON('｛"a"：［1，2，］｝'), { a: [1, 2] });
// 9 字符串内含 ,} 序列不被尾逗号/扫描破坏
eq('字符串内逗号右括号保护', mochiParsePastedJSON('{"a":"x,}","b":1,}'), { a: 'x,}', b: 1 });
// 10 混合脏：包裹+零宽+全角
eq('混合脏链路', mochiParsePastedJSON('\u200B方案如下\n{"a"：1\uFEFF，}\n请复制'), { a: 1 });
// 11 抛错类：空文本 / 垃圾 / 顶层数组 / 顶层标量
throws('空文本抛错', () => mochiParsePastedJSON('   '));
throws('垃圾文本抛错', () => mochiParsePastedJSON('这不是方案'));
throws('顶层数组抛错', () => mochiParsePastedJSON('[1,2]'));
throws('顶层标量抛错', () => mochiParsePastedJSON('"abc"'));
// 12 脏 JSON 抛错时错误信息非空（供 toast/诊断带出）
throws('损坏 JSON 带真实报错', () => mochiParsePastedJSON('{"a":1,,}'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
