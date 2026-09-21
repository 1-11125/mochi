// #963 内联图片（data: URI）解码失败→blob: 换路重试 行为验证（纯 Node，零浏览器依赖）
// 立项：iPhone 14 Plus Safari 实报「图片位置一直空着/报加载失败」；诊断附件里错误环 20 条全是
// <img> data:image/…;base64,… 加载失败（同一张 jpeg 失败 56 次＝同一条消息里的图每渲染一次报一次）。
// 本批把「失败即判死」改成「同一份字节换 blob: 通路重试一次」，并要求：①同一份载荷全站共享一个
// objectURL（56 个 <img> 只驻留一份字节）；②只换一次路（不成环）；③仍失败才回占位，且把这张图的
// 形态（MIME/字节数/base64 头）写进 __jsErrors，供下次诊断点名真因。
// 用法：node tools/verify-img-blob-retry.mjs
import { readFileSync } from 'node:fs';

const chatSrc = readFileSync(new URL('../src/js/chat.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' | ' + extra : '')); }
};

// ---- 抽取真实源码：helpers + 失败分支接线 ----
const START = 'const _chatBlobCache = new Map();';
const END = 'function bindMediaFailPlaceholder(b) {';
const i = chatSrc.indexOf(START), j = chatSrc.indexOf(END);
ok(i >= 0 && j > i, 'S1 助手段可抽取（const _chatBlobCache … bindMediaFailPlaceholder 之前）');
const seg = (i >= 0 && j > i) ? chatSrc.slice(i, j) : '';
ok(/if \(!im\.dataset\.blobTried && chatBlobRetry\(im, s\)\) return;/.test(chatSrc),
  'S2 失败分支接线在位（删＝内联图解码失败直接判死回占位，用户侧「图片一直空着」原样复发）');
ok(/if \(window\.__jsErrors\) window\.__jsErrors\.push\(chatImgFailNote\(s, im\)\);/.test(chatSrc),
  'S3 仍失败时写可点名真因的诊断（删＝下次报障只知道「图片加载失败」）');

// ---- 受控环境跑真源码 ----
const revoked = [];
let seq = 0;
const URLstub = {
  createObjectURL(b) { seq++; return 'blob:stub/' + seq + '#' + (b && b.size); },
  revokeObjectURL(u) { revoked.push(u); }
};
const win = { __jsErrors: [] };
const env = {
  window: win, String, Math, Map, Object, Uint8Array, atob, Blob,
  decodeURIComponent, console, URL: URLstub
};
const loaded = new Function('env',
  'with (env) { ' + seg + '\n return { chatDataUrlParts: typeof chatDataUrlParts === "function" ? chatDataUrlParts : null,' +
  ' chatBlobRetry: typeof chatBlobRetry === "function" ? chatBlobRetry : null,' +
  ' chatImgFailNote: typeof chatImgFailNote === "function" ? chatImgFailNote : null,' +
  ' chatImgFailNoteOnce: typeof chatImgFailNoteOnce === "function" ? chatImgFailNoteOnce : null,' +
  ' cache: typeof _chatBlobCache !== "undefined" ? _chatBlobCache : null }; }')(env);
const P = loaded || {};

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAPg';
const png = 'data:image/png;base64,' + PNG_B64;
const png2 = 'data:image/png;base64,' + PNG_B64.slice(0, 20) + 'zz';
const svg = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
const tok = '@@m:58395ec7c37e171594d598aeec80cb87';
const urlImg = 'https://x.com/a.png';

// ---- B1 头解析 ----
{
  const f = P.chatDataUrlParts;
  const a = f ? f(png) : null;
  ok(!!(a && a.mime === 'image/png' && a.b64 === true), 'B1a 标准 base64 图片载荷解析出 MIME 与 base64 标记');
  const up = f ? f('DATA:IMAGE/PNG;base64,AAAA') : null;
  ok(!!(up && up.b64 === true), 'B1b 大小写不敏感（DATA:/DATA 形态同样是 base64）');
  const g = f ? f(svg) : null;
  ok(!!(g && g.b64 === false), 'B1c 非 base64 的 data: 载荷（svg 文本）标为非 base64（走 decodeURIComponent 而非 atob）');
  ok((f ? f(tok) : 'x') === null && (f ? f(urlImg) : 'x') === null && (f ? f('') : 'x') === null,
    'B1d 令牌/图片直链/空串都判「不是 data: 载荷」（不误换路）');
}

// ---- B2 换路重试 ----
{
  const retry = P.chatBlobRetry;
  const im = { dataset: {}, src: '' };
  const u1 = retry ? retry(im, png) : '';
  ok(!!u1 && im.src === u1 && im.dataset.blobTried === '1', 'B2a 失败图换 blob: 通路：src 改写为 blob 地址并标记已换路');
  const im2 = { dataset: {}, src: '' };
  const u2 = retry ? retry(im2, png) : '';
  ok(!!u2 && u2 === u1, 'B2b 同一份载荷全站共享一个 objectURL（56 个 <img> 只驻留一份字节＝本批内存要点）');
  const im3 = { dataset: {}, src: '' };
  const u3 = retry ? retry(im3, png2) : '';
  ok(!!u3 && u3 !== u1, 'B2c 不同载荷各建各的 blob（不串图）');
  const im4 = { dataset: {}, src: '' };
  ok((retry ? retry(im4, urlImg) : 'x') === '' && im4.dataset.blobTried === undefined,
    'B2d 非 data: 载荷（http 图断网/失效）不换路、不打标记（语义不变，仍走 #202 占位）');
  const im5 = { dataset: {}, src: '' };
  const u5 = retry ? retry(im5, svg) : '';
  ok(!!u5 && /^blob:/.test(u5), 'B2e 非 base64 的 data: 载荷也能换路（走文本分支）');
}

// ---- B3 LRU：缓存封顶且逐出即 revoke ----
{
  const retry = P.chatBlobRetry, cache = P.cache;
  // 30 份互不相同且 base64 合法的载荷（否则 atob 抛错＝根本没进缓存，测不到逐出）
  for (let n = 0; n < 30; n++) retry({ dataset: {}, src: '' }, 'data:image/png;base64,' + Buffer.from('img-' + n).toString('base64'));
  const size = cache ? cache.size : -1;
  ok(size > 0 && size <= 24, 'B3a 缓存封顶 24（同一份载荷长期只占一份；封顶＝防长会话把 blob 攒到吃内存）', 'size=' + size);
  ok(revoked.length >= 6, 'B3b 逐出的 objectURL 当场 revoke（删＝blob 永不释放，换路反而成了新泄漏）', 'revoked=' + revoked.length);
}

// ---- B4 诊断文案 ----
{
  const f = P.chatImgFailNote;
  const t = f ? String(f(png, { naturalWidth: 335, naturalHeight: 480 })) : '';
  ok(t.indexOf('mime=image/png') >= 0 && t.indexOf('字节≈') >= 0 && t.indexOf('base64头=' + PNG_B64.slice(0, 12)) >= 0,
    'B4a 诊断含 MIME/字节数/base64 头（下次报障可直接点名 HEIC 未解码、截断还是超大图）', t.slice(0, 80));
  const t2 = f ? String(f(urlImg, null)) : '';
  ok(t2.indexOf('mime=?') >= 0, 'B4b 非 data: 载荷的诊断不炸（MIME 记 ?）');
}

// ---- B5 诊断去重 ----
{
  const f = P.chatImgFailNoteOnce;
  const before = win.__jsErrors.length;
  if (f) { f(png, { naturalWidth: 0 }); f(png, { naturalWidth: 0 }); f(png2, { naturalWidth: 0 }); }
  const added = win.__jsErrors.length - before;
  ok(added === 2, 'B5a 同一份载荷只写一条诊断（两张不同的坏图＝两条），错误环不被同一张图刷屏', 'added=' + added);
}

// ---- Z 零异常 ----
{
  let threw = '';
  try {
    const retry = P.chatBlobRetry;
    retry({ dataset: {}, src: '' }, 'data:image/png;base64,!!!not-base64!!!');
    retry({ dataset: {}, src: '' }, 'data:,');
    retry(null, png);
  } catch (e) { threw = String(e && e.message); }
  ok(!threw, 'Z1 坏载荷/空载荷/空元素一律不抛（catch 兜底在位）', threw);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
