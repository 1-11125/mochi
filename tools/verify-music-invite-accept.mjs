// ===== #904 音乐·听歌邀请「一起听」接受后静默死亡 兜底验证 =====
// 用户实报（红米 K80 Chrome PWA）：邀请弹窗点「一起听」→ 小框消失、没播放、无提示。
// 两类缺陷面（零机型分支，判据全取元素状态/时序）：
//   A（#904a）残留来电 hold：musicHoldForCall(true) 后未释放（stale callHoldPending），
//     startPlayback 在 hold 门上静默 return——没声、没提示、被 hold 藏起的悬浮小框不回来。
//   B（#904b）同意后 4 秒起播校验：歌被外部打停（paused）且前台无人拉起＝永不响也不提示。
// 用法：node tools/verify-music-invite-accept.mjs（需先 node build.mjs；MOCHI_ROOT 可指副本）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(process.env.MOCHI_ROOT || (dirname(fileURLToPath(import.meta.url)) + '/..'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }

function makeWavDataUrl(seconds, sr) {
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt32LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / sr * 440) * 4000), 44 + i * 2);
  return 'data:audio/wav;base64,' + buf.toString('base64');
}

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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = Number(process.env.MOCHI_CDP_PORT) || (9700 + Math.floor(Math.random() * 90));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-mia-' + Date.now()),
  '--remote-debugging-port=' + cdpPort, 'about:blank'
], { stdio: 'ignore' });
let ws = null, msgId = 0; const pend = new Map();
async function cdpConnect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
        ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } };
        return;
      }
    } catch (e) {}
    await sleep(150);
  }
  throw new Error('无法连接无头浏览器');
}
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
async function evalJs(expr) {
  try {
    const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r && r.exceptionDetails) return null;
    return r && r.result ? r.result.value : null;
  } catch (e) { return null; }
}

const results = [];
function check(desc, ok, detail) {
  results.push({ desc, ok: !!ok });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + desc + (detail !== undefined ? '  [' + detail + ']' : ''));
}

const wav = JSON.stringify(makeWavDataUrl(40, 8000));
const GS = JSON.stringify({ reqProb: 100, cooldownMs: 0, taNextProb: 0, taRandProb: 0, taModeProb: 0, taFavProb: 0, taReserveProb: 0, taPauseProb: 0 });

async function bootWithSong() {
  // 种歌→刷新→等就绪；idbRestore 偶发回填清库，最多重试 6 次
  for (let att = 0; att < 6; att++) {
    await evalJs("(async function(){var lib=JSON.stringify([{id:'mia1',name:'邀请验证歌',artist:'',url:" + wav + ",source:'url',duration:40,playlistId:'default',addedAt:Date.now()}]);window.activeStore().set('music-library',lib);window.activeStore().set('music-global'," + JSON.stringify(GS) + ");if(window.idbSet){await window.idbSet('xy-home-v2:default:music-library',lib);await window.idbSet('xy-home-v2:default:music-global'," + JSON.stringify(GS) + ");}return true;})()");
    await cdp('Page.navigate', { url: baseUrl + '/index.html' });
    await sleep(2400);
    for (let i = 0; i < 40; i++) { if (await evalJs('!!window.__mochiDataReady')) break; await sleep(300); }
    await sleep(400);
    await evalJs("(function(){var s=document.getElementById('splash');if(s)s.remove();return true;})()");
    await evalJs("(function(){window.__mia={plays:0};var OP=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.__mia.plays++;return OP.apply(this,arguments);};return true;})()");
    if (await evalJs("(function(){window.maybeMusicRequest();return !!document.getElementById('sm-req-yes');})()")) return true;
    await sleep(600);
  }
  return false;
}
async function acceptInvite() {
  for (let i = 0; i < 10; i++) {
    const y = await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y){y.click();return true;}return false;})()");
    if (y) break;
    await sleep(400);
  }
  await evalJs("(function(){var y=document.getElementById('sm-req-yes');if(y)y.click();return true;})()");
}
const audioState = () => evalJs("(function(){var as=document.querySelectorAll('audio');for(var i=as.length-1;i>=0;i--){if(as[i].src)return JSON.stringify({paused:as[i].paused,ct:+as[i].currentTime.toFixed(1),srcSet:true});}return 'nosong';})()");

console.log('--- #904 听歌邀请接受后静默死亡 兜底验证 ---');
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

// ===== A. 残留来电 hold（#904a）：hold 未释放时接受邀请，新播放必须不被吞 =====
if (!(await bootWithSong())) { console.log('FAIL  A0 邀请弹窗未能弹出'); results.push({ desc: 'A0', ok: false }); }
await evalJs("(function(){if(window.musicHoldForCall)window.musicHoldForCall(true);return true;})()"); // 模拟来电 hold 且从未释放
await sleep(300);
await acceptInvite();
let aPlaying = false;
for (let i = 0; i < 10 && !aPlaying; i++) { await sleep(700); const st = await audioState(); if (st && st.indexOf('"paused":false') >= 0) aPlaying = true; }
check('A1 残留 hold 下接受邀请，音乐照常起播（不被 callHoldPending 静默吞掉）', aPlaying, await audioState());
// 切到聊天页再查小框：桌面页（page-phone）上音乐小组件在场，小框按设计让位（floatOwnSurfaceShown）
await evalJs("(function(){document.querySelectorAll('.page').forEach(function(p){p.hidden=(p.id!=='page-chat');});return true;})()");
await sleep(500);
check('A2 悬浮小框从 hold 隐藏态恢复显示', (await evalJs("(function(){var f=document.getElementById('sm-float');return f?!f.hidden:false;})()")) === true, 'sm-float hidden=' + await evalJs("(function(){var f=document.getElementById('sm-float');return f?f.hidden:'nofloat';})()"));

// ===== B. 起播校验兜底（#904b）：播放被外部打停后 4 秒内自动拉起 =====
if (!(await bootWithSong())) { console.log('FAIL  B0 邀请弹窗未能弹出'); results.push({ desc: 'B0', ok: false }); }
await acceptInvite();
let bPlaying = false;
for (let i = 0; i < 10 && !bPlaying; i++) { await sleep(700); const st = await audioState(); if (st && st.indexOf('"paused":false') >= 0) bPlaying = true; }
check('B1 接受邀请正常起播', bPlaying, await audioState());
const playsBefore = await evalJs('window.__mia.plays') || 0;
await evalJs("(function(){var as=document.querySelectorAll('audio');for(var i=as.length-1;i>=0;i--){if(as[i].src){as[i].pause();break;}}return true;})()"); // 模拟外部打停（无任何恢复路径接管）
await sleep(5200); // 4 秒校验窗 + 起播余量
const playsAfter = await evalJs('window.__mia.plays') || 0;
check('B2 被外部打停后校验兜底自动补播（play 被再次调用）', playsAfter > playsBefore, 'before=' + playsBefore + ' after=' + playsAfter);
const st2 = await audioState();
check('B3 补播后音乐恢复播放', st2 && st2.indexOf('"paused":false') >= 0, st2);

const pass = results.filter(r => r.ok).length;
console.log('--- ' + pass + '/' + results.length + ' ---');
chrome.kill(); server.close();
process.exit(pass === results.length ? 0 : 1);
