// verify-chat-bg-kb-stable.mjs —— 验证 #748 / #748b：聊天壁纸在安卓键盘弹起时不得缩放。
// 用户报障（iQOO Neo9 + Chrome，多机型复现）：「打字时背景图会变小、比例大小会变」。
//
// 两个叠加的根因（同一症状的两半）：
//   #748b  UI 档位值是非法 CSS：#731 把「铺满裁剪」档的 value 定成 'fill' 并原样写进
//          style.backgroundSize。'fill' 不是合法 background-size ⇒ 浏览器丢弃整条声明
//          ⇒ 计算值回退 auto ＝ 按原图原始像素渲染（压缩后壁纸可达 2160×4096）。
//   #748   即便修正成 cover，键盘弹出时 mobile-adapt.syncAndroidKb 把 .phone 内联高度压到
//          visualViewport.height，cover 会按**变矮后的盒**重算缩放比 ⇒ 图整体缩小。
//          修法：把绘制尺寸冻结在「无键盘时的盒尺寸」折算出的显式像素（Wpx Hpx）。
//
// 口径：
//   BG1  装壁纸后 #page-chat 的 backgroundImage 已设置
//   BG2  壁纸自然尺寸测量成功（#page-chat.__csBgNat 有值）
//   BG3  基线（键盘前）backgroundSize 是显式像素尺寸（不是 auto/cover/contain 关键字）
//   BG3b 默认档计算值不是 auto（证明非法 'fill' 已修——RED 基线此条必红）
//   BG4  键盘弹起（布局视口压到 60%）后 #page-chat 实际高度确实变小
//        —— 前置断言：盒高没变说明模拟没生效，直接判红（不许假绿）
//   BG5  键盘弹起后 backgroundSize 字符串与基线逐字节相同
//   BG5b 键盘弹起后壁纸**实际绘制尺寸**不变（用户视角的核心断言）
//   BG5c 键盘弹起后壁纸**缩放比**不变（长宽比漂移 < 0.5%）
//   BG6  键盘收起后 backgroundSize 仍与基线相同（不得漂移）
//   BG7  旋转/真实改宽后 backgroundSize 必须重新锚定（宽度变化要重算，不许永久冻结）
//
// RED 基线（三种）：
//   HEAD 原版（无任何 #748 改动）：4/10（BG2/BG3/BG3b/BG5b/BG5c/BG7 红）
//   「只修非法值、不冻结」半修复态：BG3/BG3b/BG7 红
//   把 csBgPaintSize 强制返回 null：BG3/BG7 红
// 用法：MOCHI_ROOT=<Windows 路径 to build> node tools/verify-chat-bg-kb-stable.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { tmpdir } from 'node:os';

const root = normalize(process.env.MOCHI_ROOT || process.cwd());
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const server = createServer((req, res) => {
  try {
    let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0])));
    if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
    if (statSync(p).isDirectory()) p = join(p, 'index.html');
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' });
    res.end(readFileSync(p));
  } catch (e) { res.writeHead(404); res.end('nf'); }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 10480 + (process.pid % 500);
const ch = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(tmpdir(), 'mochi-bgv-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'],
  { stdio: 'ignore' });

let ws = null, msgId = 0;
const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const l = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const p = l.find((t) => t.type === 'page');
    if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.log('FATAL 无法连接 CDP'); process.exit(1); }
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
const cdp = (method, params = {}) => { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); };
const evalJs = async (expr) => {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) return 'ERR:' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description).slice(0, 200);
  return r && r.result ? r.result.value : null;
};

const results = [];
const chk = (id, ok, got) => { results.push({ id, ok: !!ok, got }); };
// 显式像素尺寸口径：CSS 序列化成 "401px 801px"（每个分量自带单位）
const isPxSize = (s) => /^\d+(\.\d+)?px \d+(\.\d+)?px$/.test(String(s || '').trim());

await cdp('Runtime.enable');
await cdp('Page.enable');
// 用手机视口 + 触摸，让 mobile-adapt 的 android 分支真正生效
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 801, deviceScaleFactor: 3.5, mobile: true });
await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator,'userAgent',{get:function(){return 'Mozilla/5.0 (Linux; Android 14; V2338A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';}});" });
await cdp('Page.navigate', { url: base + '/index.html' });
await sleep(2500);
for (let i = 0; i < 50; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
await evalJs("(function(){var s=document.getElementById('splash');if(s)s.click();return 1;})()");
await sleep(900);

// 进入聊天页
await evalJs('(function(){var a=document.querySelector(\'.app[data-app="chat"]\');if(a)a.click();return 1;})()');
await sleep(1600);

// 装壁纸：直接写 cs-bg（走 store 命名空间）再调 applySettings 目标函数。
// 用 2160x4096 逼近真实压缩产物尺寸——`fill` 被判非法而回退 auto 时，这种大图
// 在 360 宽的盒子里只露出中间一小块，症状才明显（小图看不出差别）。
const seeded = await evalJs(`(function(){
  try {
    var svg='<svg xmlns="http://www.w3.org/2000/svg" width="2160" height="4096"><rect width="2160" height="4096" fill="#cce6ff"/><circle cx="1080" cy="2048" r="900" fill="#ff6677"/></svg>';
    var url='data:image/svg+xml;base64,'+btoa(svg);
    var st = (typeof window.activeStore==='function') ? window.activeStore() : null;
    if (st && st.set) { st.set('cs-bg', url); st.set('cs-bg-active-id','w1'); try{ st.remove('cs-bg-fit'); }catch(e){} }
    else localStorage.setItem('xy-home-v2:default:cs-bg', url);
    if (typeof window.applyChatSettings==='function') window.applyChatSettings();
    else if (typeof window.applySettings==='function') window.applySettings();
    return 'seeded';
  } catch(e){ return 'err:'+e; }
})()`);
await sleep(1400);

const geom = `(function(){
  try{
    var pc=document.getElementById('page-chat');
    var ph=document.querySelector('.phone');
    if(!pc||!ph) return JSON.stringify({err:'no el'});
    var cs=getComputedStyle(pc);
    var nat=pc.__csBgNat;
    // 计算「壁纸在屏幕上实际被画成多大」——这是用户眼睛看到的量。
    // 显式 px / cover / contain / auto 四种形态分别折算；auto 就是原图原始像素。
    var sizeStr=cs.backgroundSize;
    var painted='?';
    if(nat&&nat.w&&nat.h){
      var bw=pc.clientWidth, bh=pc.clientHeight;
      var w,h;
      var mPx=sizeStr.match(/^([\\d.]+)px\\s+([\\d.]+)px$/);
      if(mPx){ w=parseFloat(mPx[1]); h=parseFloat(mPx[2]); }
      else if(sizeStr==='cover'){ var s=Math.max(bw/nat.w,bh/nat.h); w=nat.w*s; h=nat.h*s; }
      else if(sizeStr==='contain'){ var s2=Math.min(bw/nat.w,bh/nat.h); w=nat.w*s2; h=nat.h*s2; }
      else if(sizeStr==='auto'){ w=nat.w; h=nat.h; }
      else { w=NaN; h=NaN; }
      if(!isNaN(w)) painted=Math.round(w)+'x'+Math.round(h);
    }
    // 可见裁剪窗口（盒内实际露出壁纸的像素范围）——盒高变化时它会不会变，是用户
    // 「比例变化」的直接来源。auto（原图大于盒）时窗口高永远等于盒高，但窗口在
    // 原图里的**位置**会因 center 重新居中而漂移，故这里也算出窗口对应的原图切片。
    var win='?';
    if(painted!=='?'){
      var pw=parseFloat(painted.split('x')[0]), phh=parseFloat(painted.split('x')[1]);
      var sx=pw/bw, sy=phh/bh;               // 原图 1px 对应屏幕几 px
      var srcW=Math.round(bw*sx), srcH=Math.round(bh*sy);
      win=srcW+'x'+srcH;
    }
    return JSON.stringify({
      pcH: Math.round(pc.getBoundingClientRect().height),
      pcW: Math.round(pc.getBoundingClientRect().width),
      phoneH: Math.round(ph.getBoundingClientRect().height),
      inlineBg: (pc.style.backgroundImage||'').slice(0,24),
      inlineSize: pc.style.backgroundSize||'',
      bgSize: cs.backgroundSize,
      bgPos: cs.backgroundPosition,
      painted: painted,
      win: win,
      nat: (nat && nat.w) ? (nat.w+'x'+nat.h) : 'none'
    });
  }catch(e){ return JSON.stringify({err:String(e)}); }
})()`;

const base0 = JSON.parse(await evalJs(geom));
chk('BG1 壁纸已设置', /url\(/.test(base0.inlineBg), base0.inlineBg);
chk('BG2 自然尺寸已测量', base0.nat !== 'none', base0.nat);
chk('BG3 基线为显式像素尺寸', isPxSize(base0.bgSize), base0.bgSize);
// BG3b（#748b）：默认档必须真正落成「铺满裁剪」——计算值不许是 auto
// （#731 把非法值 'fill' 原样写进 style ⇒ 浏览器丢弃 ⇒ auto ⇒ 原图原始像素渲染）。
chk('BG3b 默认档计算值不是 auto（非法 fill 已修）', base0.bgSize !== 'auto', base0.bgSize);

// 模拟键盘：用 CDP 把**布局视口高度**压到 60%（安卓键盘期 .phone 的内联高度被压到
// visualViewport.height，等效结果就是 .phone / #page-chat 一起变矮）。此举同时会派发
// 真实 resize 事件 ⇒ 顺带验证「resize 重跑 applySettings 不得把冻结尺寸算歪」。
//
// FIX 2026-09-18 #751：真机键盘期 mobile-adapt 的 _setPhoneH() 会给 .phone 写上**内联 height**，
// 这是「当前盒高是被键盘压出来的」的设备无关证据。#751 的基线闸门正靠这个信号区分
// 「键盘压矮（不得重锚）」与「地址栏/dvh 涨落（要能双向重锚）」——若只压视口而不 pin .phone，
// 模拟出来的就是「窗口真被改小」，那本就**应该**重锚（那是 R6/BG7 的场景），断言会失真。
// 故这里补上内联高度，忠实还原安卓键盘现场。
await evalJs("(function(){var ph=document.querySelector('.phone');if(ph){ph.style.height='481px';}return 1;})()");
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 481, deviceScaleFactor: 3.5, mobile: true });
await sleep(1200);
const kb = JSON.parse(await evalJs(geom));

chk('BG4 键盘期盒高确实变小（模拟生效）', kb.pcH < base0.pcH, base0.pcH + ' -> ' + kb.pcH);
chk('BG5 键盘期 bgSize 字符串不漂移', kb.bgSize === base0.bgSize, base0.bgSize + ' -> ' + kb.bgSize);
// BG5b 是用户视角的核心断言：壁纸**被画出来的尺寸**必须一字不变。
// 只比 backgroundSize 字符串不够——RED 基线里它恒为 auto 也「不变」，但画出来的图会随盒高缩水。
chk('BG5b 键盘期壁纸实际绘制尺寸不变（用户视角）', kb.painted === base0.painted && base0.painted !== '?', base0.painted + ' -> ' + kb.painted);
// BG5c：可见裁剪窗口对应的原图切片也必须不变——盒变矮而图不缩时，窗口本身必然变小
// （那是正常的「露出更少」，不是「图变小」）；这里断言的是**图的缩放比**没变。
chk('BG5c 键盘期壁纸缩放比不变（原图切片按同比例）',
  (function () {
    const r = (s) => { const m = String(s || '').split('x'); return m.length === 2 ? (parseFloat(m[0]) / parseFloat(m[1])) : NaN; };
    const a = r(base0.painted), b2 = r(kb.painted);
    if (isNaN(a) || isNaN(b2)) return false;
    return Math.abs(a - b2) < 0.005; // 长宽比漂移 < 0.5% ＝ 等比未变
  })(), base0.painted + ' -> ' + kb.painted);

// 收起键盘：恢复原高度（真机此时 mobile-adapt 会清掉 .phone 内联高 ＝ _setPhoneH(null)）
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 801, deviceScaleFactor: 3.5, mobile: true });
await evalJs("(function(){var ph=document.querySelector('.phone');if(ph){ph.style.height='';}try{window.applyChatSettings&&window.applyChatSettings();}catch(e){}return 1;})()");
await sleep(1200);
const after = JSON.parse(await evalJs(geom));
chk('BG6 键盘收起后 bgSize 仍与基线一致', after.bgSize === base0.bgSize, base0.bgSize + ' -> ' + after.bgSize);

// 真实改宽（旋转）必须重新锚定：把视口转成 801x360
await cdp('Emulation.setDeviceMetricsOverride', { width: 801, height: 360, deviceScaleFactor: 3.5, mobile: true });
await sleep(1400);
const rot = JSON.parse(await evalJs(geom));
chk('BG7 改宽后尺寸重新锚定（不再冻结旧值）', rot.bgSize !== base0.bgSize && isPxSize(rot.bgSize), base0.bgSize + ' -> ' + rot.bgSize);

// BG8（#751，与 verify-chat-bg-ratchet.mjs 同族，此处做交叉兜底）：
// 地址栏自动收起让 dvh 变大（盒临时变高）后再回落——基线与绘制尺寸都必须回到原值。
// #750 的棘轮基线会永久停在"大盒"档 ⇒ 壁纸被放大且不复原（OPPO Reno14 + Edge 实报）。
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 801, deviceScaleFactor: 3.5, mobile: true });
await sleep(1300);
const preVar = JSON.parse(await evalJs(geom));
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 861, deviceScaleFactor: 3.5, mobile: true });
await sleep(1300);
const bigVar = JSON.parse(await evalJs(geom));
await cdp('Emulation.setDeviceMetricsOverride', { width: 360, height: 801, deviceScaleFactor: 3.5, mobile: true });
await sleep(1600);
const postVar = JSON.parse(await evalJs(geom));
chk('BG8 dvh 涨落一轮后绘制尺寸回到原值（棘轮已除）',
  postVar.painted === preVar.painted && preVar.painted !== '?',
  preVar.painted + ' --dvh涨--> ' + bigVar.painted + ' --回落--> ' + postVar.painted);

let pass = 0;
console.log('=== #748 聊天壁纸键盘稳定 ===');
console.log('seed:', seeded, ' nat:', base0.nat);
for (const r of results) { console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id + '  [' + r.got + ']'); if (r.ok) pass++; }
console.log('---- ' + pass + '/' + results.length + ' ----');

ch.kill(); server.close(); process.exit(pass === results.length ? 0 : 1);
