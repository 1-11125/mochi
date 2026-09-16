// ===== 验证 #582：设置「导出数据 / 导入数据」可选「仅聊天记录（全部桌面联系人）」 =====
// 用户反馈「设置里导出数据和导入数据，缺少可选 导出全部桌面联系人的聊天记录 / 导入全部桌面联系人的聊天记录」。
// 根因：① 导出侧的范围弹窗只在「本机数据 >150MB」时才出现（MODE_ASK_BYTES 门槛），小库用户点「导出数据」
// 直接进完整备份，「仅聊天记录」根本选不到；② 导入侧只有整包导入一条路，没有「只找回聊天」的入口；
// ③ 即便走 chat 导出（备份提醒条的「备份聊天」），范围也漏了两头——各桌面的旧顶层键
// xy-home-v2:chat-msgs 与群聊键不在导入侧白名单里，且消息图片/语音在 #142 令牌化后本体在媒体池
// （@@m:<hash> → xy-home-v2:media:<hash32>）而导出只收 chat-msgs，恢复后图片全空。
// 本脚本断言（内存拼装 src → 无头 Chrome 实测，不写产物）：
//   A 小库也弹范围选择（回归：>150MB 才弹）
//   B 导出范围弹窗含「仅聊天记录」胶囊
//   C 选「仅聊天记录」导出的文件：含各桌面 chat-msgs（含旧顶层键）+ 群聊键 + 被引用的媒体池条目，
//     不含未被引用的池条目、不含字卡库/音乐等非聊天键
//   D 导入入口弹窗含「仅聊天记录（全部桌面联系人）」并可路由到 runChatAllImport
//   E 用 C 导出的文件跑只导聊天：各桌面/群聊记录与图片全部恢复，非聊天键分毫未动
// 用法：node tools/verify-chat-backup-scope.mjs（需本机 Chrome/Edge）
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => readFileSync(join(root, 'src', p), 'utf8');

const bm = readFileSync(join(root, 'build.mjs'), 'utf8');
const arr = (name) => new Function('return ' + bm.match(new RegExp('const ' + name + ' = (\\[.*?\\]);', 's'))[1])();
const css = arr('cssFiles').map((f) => readFileSync(join(root, 'src', 'css', f), 'utf8')).join('\n');
const js = arr('jsFiles').map((f) => readFileSync(join(root, 'src', 'js', f), 'utf8')).join('\n');
let html = read('template.html').replace('__APP_VERSION__', 'v3.26.0-test');
html = html.replace('</head>', '<style>' + css + '</style></head>');
html = html.replace('</body>', '<script>' + js + '<\/script></body>');

const server = createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const chromePath = candidates.find((p) => { try { return statSync(p).isFile(); } catch (e) { return false; } });
if (!chromePath) { console.error('找不到 Chrome/Edge'); process.exit(1); }
const cdpPort = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + join(process.env.TEMP || '/tmp', 'mochi-vcbs-' + Date.now()), '--remote-debugging-port=' + cdpPort, 'about:blank'], { stdio: 'ignore' });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} server.close(); });

let ws = null, msgId = 0; const pend = new Map();
for (let i = 0; i < 60; i++) {
  try {
    const list = await (await fetch('http://127.0.0.1:' + cdpPort + '/json')).json();
    const page = list.find((t) => t.type === 'page');
    if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } }; break; }
  } catch (e) {}
  await sleep(150);
}
if (!ws) { console.error('无法连接无头浏览器'); process.exit(1); }
function cdp(method, params = {}) { const id = ++msgId; return new Promise((res) => { pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); }); }
const pageErrors = [];
await cdp('Runtime.enable');
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params && m.params.exceptionDetails && m.params.exceptionDetails.text);
});
async function ev(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r && r.exceptionDetails) pageErrors.push(r.exceptionDetails.text + ' ' + JSON.stringify((r.exceptionDetails.exception || {}).description || ''));
  return r && r.result ? r.result.value : undefined;
}
async function hit(expr, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); }
  return false;
}

let pass = 0, fail = 0;
const A = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); };

await cdp('Page.enable');
await cdp('Page.navigate', { url: baseUrl + '/' });
let ready = false;
for (let i = 0; i < 200; i++) { await sleep(150); ready = await ev('!!window.__mochiDataReady'); if (ready) break; }
console.log('数据就绪: ' + (ready ? 'YES' : 'NO (超时)'));

// 开屏 / 问答门 / 新手引导 / 弹层全部清掉，直接操作设置页行
await ev(`(()=>{ const s=document.getElementById('splash'); if(s) s.remove();
  const q=document.getElementById('qa-mask'); if(q) q.hidden=true;
  const g=document.querySelector('.mg-guide-mask'); if(g) g.remove();
  const m=document.getElementById('modal-mask'); if(m) m.hidden=true;
  return true; })()`);

// 下载链路降级到「确认后 a[download]」并捕获 blob（不真下载）
await ev(`(()=>{ try { Object.defineProperty(navigator,'share',{value:undefined,configurable:true}); } catch(e){}
  try { Object.defineProperty(navigator,'canShare',{value:undefined,configurable:true}); } catch(e){}
  window.__blobs=[];
  const _c=URL.createObjectURL.bind(URL);
  URL.createObjectURL=(b)=>{ try{ window.__blobs.push(b); }catch(e){} return _c(b); };
  return true; })()`);

// 种子数据：3 个桌面（当前 default / 旧顶层键 / 联系人 c 命名空间）+ 2 个群聊 + 媒体池（1 引用 / 1 孤儿）
const H_REF = 'a'.repeat(32), H_ORPHAN = 'b'.repeat(32);
const seedJson = await ev(`(async()=>{
  const mk=(n,tag,img)=>{const a=[];for(let i=0;i<n;i++)a.push({side:i%2?'in':'out',text:tag+i,ts:1700000000000+i});if(img)a[0].img='@@m:'+img;return a;};
  const R='${H_REF}', O='${H_ORPHAN}';
  await window.idbSet('xy-home-v2:default:chat-msgs', mk(3,'DEF ',R));
  await window.idbSet('xy-home-v2:chat-msgs', mk(2,'LEGACY '));
  await window.idbSet('xy-home-v2:cabc12345:chat-msgs', mk(2,'CONTACT '));
  await window.idbSet('xy-home-v2:group-chat-msgs', mk(2,'GC '));
  await window.idbSet('xy-home-v2:gc-msgs-g1', mk(1,'GCG1 '));
  await window.idbSet('xy-home-v2:media:'+R, 'data:image/png;base64,REF');
  await window.idbSet('xy-home-v2:media:'+O, 'data:image/png;base64,ORPHAN');
  await window.idbSet('xy-home-v2:cc-groups', 'NON_CHAT_SENTINEL');
  await window.idbSet('xy-home-v2:music-file:1', 'data:audio/mpeg;base64,MUSIC');
  return JSON.stringify({ok:1, list: await window.idbListKeys()}); })()`);
const seeded = JSON.parse(String(seedJson || '{}'));
A('S0 种子数据写入 IDB（清单可读）', seeded.ok === 1 && Array.isArray(seeded.list) && seeded.list.length >= 8, 'keys=' + (seeded.list || []).length);

// ===== A/B：小库点「导出数据」也必须弹范围选择，且含「仅聊天记录」 =====
await ev(`document.getElementById('row-export').click()`);
const chooserUp = await hit(`(()=>{ const m=document.getElementById('modal-mask'); return !!m && !m.hidden && (document.getElementById('modal-pills')||{}).innerHTML.indexOf('仅聊天记录')>=0; })()`, 12000);
const pillText = await ev(`(()=>{ const p=document.getElementById('modal-pills'); return p?p.textContent:''; })()`);
A('A 小库导出也弹范围选择（回归：>150MB 门槛）', chooserUp, 'pills=' + pillText);
A('B 导出弹窗含「仅聊天记录」胶囊', String(pillText || '').indexOf('仅聊天记录') >= 0 && String(pillText || '').indexOf('取消') >= 0, pillText);

// ===== C：选「仅聊天记录」导出，检查文件里的键集合 =====
await ev(`(()=>{ const ps=[...document.querySelectorAll('#modal-pills .pill')];
  const p=ps.find(x=>x.textContent.indexOf('仅聊天记录')>=0); if(p) p.click(); return !!p; })()`);
await ev(`document.getElementById('modal-ok').click()`);
// 打包完成 → 二级确认弹窗（点确定走 a[download]，blob 到手）；最多等 30s，顺带兜住「导出未完成」
for (let i = 0; i < 100; i++) {
  if (await ev(`(window.__blobs||[]).some(x=>String(x.type).indexOf('json')>=0)`)) break;
  const t = await ev(`(()=>{ const m=document.getElementById('modal-mask'); return (m&&!m.hidden)?document.getElementById('modal-title').textContent:''; })()`);
  if (t && t.indexOf('备份已打包完成') >= 0) { await ev(`document.getElementById('modal-ok').click()`); await sleep(400); continue; }
  if (t && t.indexOf('导出未完成') >= 0) { console.log('INFO 导出报错弹窗：' + await ev(`document.getElementById('modal-static').textContent`)); await ev(`document.getElementById('modal-ok').click()`); break; }
  await sleep(300);
}
await hit(`(window.__blobs||[]).length>0`, 5000);
const blobTxt = await ev(`(async()=>{ const b=(window.__blobs||[]).find(x=>String(x.type).indexOf('json')>=0); if(!b) return ''; return await b.text(); })()`);
let backup = null;
try { backup = JSON.parse(String(blobTxt || '')); } catch (e) { backup = null; }
A('C0 仅聊天记录导出成功且可解析', !!backup && !!backup.idb, 'size=' + String(blobTxt || '').length);
if (!backup) { console.log('结果：' + pass + '/' + (pass + fail) + ' 通过（导出未产出文件，后续断言跳过）'); process.exit(1); }
const fileKeys = backup ? Object.keys(backup.ls || {}).concat(Object.keys(backup.idb || {})) : [];
const fileSeg = (k) => (backup && backup.ls && backup.ls[k] !== undefined) ? 'ls' : ((backup && backup.idb && backup.idb[k] !== undefined) ? 'idb' : '-');
const has = (k) => fileKeys.indexOf(k) >= 0;
A('C1 文件含当前桌面 + 旧顶层键 + 联系人桌面 chat-msgs',
  has('xy-home-v2:default:chat-msgs') && has('xy-home-v2:chat-msgs') && has('xy-home-v2:cabc12345:chat-msgs'),
  fileKeys.map(k => k + '@' + fileSeg(k)).join(','));
A('C2 文件含默认群 + 自定义群消息键', has('xy-home-v2:group-chat-msgs') && has('xy-home-v2:gc-msgs-g1'), '');
A('C3 文件含消息引用到的媒体池条目', has('xy-home-v2:media:' + H_REF), '');
A('C4 文件不含未被引用的池条目', !has('xy-home-v2:media:' + H_ORPHAN), '');
A('C5 文件不含非聊天键（字卡库/音乐）', !has('xy-home-v2:cc-groups') && !fileKeys.some(k => /:music-file:/.test(k)), '');
A('C6 仅聊天记录不更新全量备份时间（备份提醒不被压制）', (await ev(`localStorage.getItem('xy-home-v2:__last-backup')===null`)) === true, '');
A('C7 群聊写回通道在位（group-chat.js gcWriteGroupMsgs）', (await ev('typeof window.gcWriteGroupMsgs')) === 'function', '');

// ===== D：导入入口弹窗含两条范围 =====
await ev(`(()=>{ window.__impCalled=0; window.__realImp=window.runChatAllImport;
  window.runChatAllImport=function(){ window.__impCalled++; };
  document.getElementById('row-import').click(); return true; })()`);
const impChooser = await hit(`(()=>{ const m=document.getElementById('modal-mask'); return !!m && !m.hidden && document.getElementById('modal-pills').innerHTML.indexOf('仅聊天记录')>=0; })()`, 8000);
const impPills = await ev(`document.getElementById('modal-pills').textContent`);
A('D1 导入弹窗弹出且含「仅聊天记录（全部桌面联系人）」', impChooser && String(impPills).indexOf('完整备份') >= 0, impPills);
await ev(`(()=>{ const ps=[...document.querySelectorAll('#modal-pills .pill')];
  const p=ps.find(x=>x.textContent.indexOf('仅聊天记录')>=0); if(p) p.click(); document.getElementById('modal-ok').click(); return true; })()`);
await sleep(600);
const impCalls = await ev('window.__impCalled');
A('D2 选「仅聊天记录」路由到 runChatAllImport', impCalls === 1, 'calls=' + impCalls);
await ev(`window.runChatAllImport=window.__realImp; delete window.__realImp; true`);

// ===== E：把各桌面/群聊清成垃圾值，再用 C 的文件只导聊天 =====
await ev(`(async()=>{
  const junk=[{side:'out',text:'JUNK',ts:1}];
  for (const k of ['xy-home-v2:default:chat-msgs','xy-home-v2:chat-msgs','xy-home-v2:cabc12345:chat-msgs','xy-home-v2:group-chat-msgs','xy-home-v2:gc-msgs-g1']) {
    await window.idbSet(k, junk);
    try { localStorage.setItem(k, JSON.stringify(junk)); } catch(e){}
  }
  await window.idbDelete('xy-home-v2:media:${H_REF}');
  return true; })()`);
// 文件里额外塞一个非聊天键：只导聊天绝不碰它（设备上的哨兵值必须原样）
const hybrid = JSON.parse(JSON.stringify(backup));
hybrid.ls = hybrid.ls || {}; hybrid.ls['xy-home-v2:cc-groups'] = 'FROM_FILE';
const hybridStr = JSON.stringify(hybrid);
await ev(`(()=>{ const f=new File([${JSON.stringify(hybridStr)}],'x.json',{type:'application/json'});
  window.runChatAllImport(f); return true; })()`);
const confirmUp = await hit(`(()=>{ const m=document.getElementById('modal-mask'); return !!m && !m.hidden && document.getElementById('modal-title').textContent.indexOf('确认导入聊天记录')>=0; })()`, 8000);
const previewTxt = String(await ev(`document.getElementById('modal-static').textContent`));
// 旧顶层键 xy-home-v2:chat-msgs 也算一个「默认桌面」——两条默认桌面行＝旧键已被白名单收进
// （改回旧正则 /^xy-home-v2:(default|c\d+):chat-msgs$/ 时这里只剩 1 条）
const defLines = (previewTxt.match(/默认桌面/g) || []).length;
A('E1 导入预览按桌面/群聊列出条数（含旧顶层键的默认桌面）',
  confirmUp && defLines >= 2 && previewTxt.indexOf('群聊') >= 0, '默认桌面行=' + defLines + ' | ' + previewTxt.replace(/\n/g, ' | '));
await ev(`document.getElementById('modal-ok').click()`);
await sleep(2500);
const countsJson = await ev(`(async()=>{
  // get：数组＝条数；JSON 串＝解析后条数；非 JSON 串（媒体池 dataURL 等）＝非空计 1
  const get=async(k)=>{ const v=await window.idbGet(k); if(v===undefined||v===null) return 0;
    if (typeof v==='string') { try { const a=JSON.parse(v); return Array.isArray(a)?a.length:1; } catch(e){ return v.length?1:0; } }
    return Array.isArray(v)?v.length:1; };
  const texts=async(k)=>{ const v=await window.idbGet(k); try { const a=typeof v==='string'?JSON.parse(v):v; return Array.isArray(a)?a.map(m=>String((m&&m.text)||'')).join('|'):String(v); } catch(e){ return 'ERR'; } };
  let lsLeg=-1; try { lsLeg=JSON.parse(localStorage.getItem('xy-home-v2:chat-msgs')||'[]').length; } catch(e){}
  return JSON.stringify({
    defT: await texts('xy-home-v2:default:chat-msgs'),
    leg: await get('xy-home-v2:chat-msgs'), lsLeg: lsLeg,
    con: await get('xy-home-v2:cabc12345:chat-msgs'), conT: await texts('xy-home-v2:cabc12345:chat-msgs'),
    gc: await get('xy-home-v2:group-chat-msgs'), gcT: await texts('xy-home-v2:group-chat-msgs'),
    gcg1: await get('xy-home-v2:gc-msgs-g1'),
    media: await get('xy-home-v2:media:${H_REF}'),
    nonchat: await window.idbGet('xy-home-v2:cc-groups')
  }); })()`);
const counts = JSON.parse(String(countsJson || '{}'));
// 当前桌面由 app 自己掌管（TA/系统消息会自动追加），只断言「垃圾值被导入覆盖」+「种子内容在场」；
// 旧顶层键与 :default: 键都归当前桌面，两者都会被写入（后写者胜），故两种种子都算通过
A('E2 当前桌面聊天被导入覆盖（垃圾值消失、种子内容在场）',
  /DEF 0/.test(counts.defT || '') && !/JUNK/.test(counts.defT || ''), String(counts.defT).slice(0, 60));
A('E3 旧顶层键已进白名单（其内容被写进当前桌面）',
  !/JUNK/.test(counts.defT || ''), 'leg(磁盘旧键)=' + counts.leg);
A('E4 联系人桌面聊天恢复（IDB + LS 快照）', counts.con === 2 && /CONTACT 0/.test(counts.conT || ''), counts.con + ' ' + String(counts.conT).slice(0, 40));
A('E5 默认群聊天恢复（覆盖垃圾值）', counts.gc === 2 && /GC 0/.test(counts.gcT || ''), counts.gc + ' ' + String(counts.gcT).slice(0, 40));
A('E6 自定义群聊天恢复', counts.gcg1 === 1, String(counts.gcg1));
A('E7 消息引用的图片一并恢复', counts.media === 1, String(counts.media));
A('E8 非聊天键分毫不碰（文件里塞了也不写）', counts.nonchat === 'NON_CHAT_SENTINEL', String(counts.nonchat));
A('E9 整页无 JS 异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' / '));

console.log('结果：' + pass + '/' + (pass + fail) + ' 通过');
process.exit(fail ? 1 : 0);
