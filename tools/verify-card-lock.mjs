// ===== 验证脚本：#319 防未成年人·系统内置字卡二级验证锁（行为断言）=====
// 用法：node build.mjs && node tools/verify-card-lock.mjs（需本机 Chrome/Edge）
// 覆盖：锁定态闸门（分组/同源池/回复池全空）→ 开屏锁卡渲染与顺序 → 解锁弹窗交互
//       （错密码 stay+hint、对密码写 open）→ 解锁后闸开 → 重锁回空。
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = normalize(dirname(fileURLToPath(import.meta.url)) + '/..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>{try{return statSync(p).isFile()}catch(e){return false}});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = normalize(join(root, decodeURIComponent(req.url.split('?')[0] || '/')));
  if (!p.startsWith(root)) { res.writeHead(403); res.end(); return; }
  if (statSync(p).isDirectory()) p = join(p, 'index.html');
  try { res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p)); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = 'http://127.0.0.1:' + server.address().port;
const cdpPort = 9950 + Math.floor(Math.random() * 40);
const chrome = spawn(exe, ['--headless=new','--disable-gpu','--no-first-run','--user-data-dir='+join(process.env.TEMP||'/tmp','mochi-lock-'+Date.now()),'--remote-debugging-port='+cdpPort,'about:blank'], { stdio: 'ignore' });
let ws=null, msgId=0; const pend=new Map();
async function cdpConnect() {
  for (let i=0;i<60;i++){ try {
    const list = await (await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();
    const page = list.find(t=>t.type==='page');
    if (page){ ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
      ws.onmessage=(ev)=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};
      return; }
  } catch(e){} await sleep(150); }
  throw new Error('no cdp');
}
function cdp(method, params={}){ const id=++msgId; return new Promise(res=>{pend.set(id,res); ws.send(JSON.stringify({id,method,params}));}); }
async function ev(expr){ try{ const r=await cdp('Runtime.evaluate',{expression:expr,returnByValue:true}); return r&&r.result?r.result.value:null; }catch(e){ return null; } }
await cdpConnect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await cdp('Page.navigate',{url:baseUrl+'/index.html'});
await sleep(3500);
const results=[];
function check(d,ok,detail){ results.push(ok); console.log((ok?'PASS':'FAIL')+'  '+d+(detail?'  ['+detail+']':'')); }
// 1) 锁定态：闸 API 在、卡在、顺序 d→l→1、按钮存在
check('锁定态 cardLockOpen=false', await ev('window.cardLockOpen&&window.cardLockOpen()===false')===true);
check('开屏锁卡在位且顺序 d→l→1', await ev("(function(){var n=document.getElementById('splash-notice');if(!n)return false;var tags=[].map.call(n.children,function(c){return c.getAttribute('data-anti-scam');}).filter(Boolean);var i1=tags.indexOf('d'),i2=tags.indexOf('l'),i3=tags.indexOf('1');return i1>-1&&i2>-1&&i3>-1&&i1<i2&&i2<i3;})()")===true);
check('锁卡上有解锁按钮', await ev("(document.getElementById('splash-cardlock-actions')||{}).textContent")==='输入密码解锁');
// 2) 锁定态闸生效：分组全空、回复池无预设、词典拼字语录池空
check('锁定 getDefaultCardGroups(main)=0', await ev("(window.getDefaultCardGroups('main')||[]).length===0")===true);
check('锁定 getLibPool(fish) 空', await ev("(window.getLibPool('fish','摸鱼浮字')||[]).length===0")===true);
check('锁定 getPool 无预设兜底（text 空或全自建）', await ev("(function(){var p=window.getPool();return p.text.length===0;})()")===true);
check('锁定 quoteSpellPick 存在（quote-spell 未坏）', await ev('typeof window.quoteSpellPick==="function"')===true);
// 3) 解锁交互：错密码 stay+hint；对密码→state 写验证通过
await ev("document.querySelector('#splash-cardlock-actions .cardlock-btn').click()");
await sleep(600);
check('弹窗已打开（modal-mask 显示）', await ev("(function(){var m=document.getElementById('modal-mask');return m&&!m.hidden;})()")===true);
check('splash 已压层 under-modal', await ev("(function(){var s=document.getElementById('splash');return s&&s.classList.contains('under-modal');})()")===true);
await ev("(function(){var i=document.getElementById('modal-input')||(document.querySelector('.modal-input')||{});if(i){i.value='000000';}var b=document.getElementById('modal-ok')||(document.querySelector('#modal-mask .modal-btn, #modal-mask button'));if(b)b.click();return true;})()");
await sleep(600);
check('错密码：弹窗未关（stay）', await ev("(function(){var m=document.getElementById('modal-mask');return m&&!m.hidden;})()")===true);
check('错密码：提示文案在', await ev("(function(){var s=document.getElementById('modal-static');return s&&!s.hidden&&s.textContent.indexOf('密码不对')>-1;})()")===true);
await ev("(function(){var i=document.getElementById('modal-input')||(document.querySelector('.modal-input')||{});if(i){i.value='990815';}var b=document.getElementById('modal-ok')||(document.querySelector('#modal-mask .modal-btn, #modal-mask button'));if(b)b.click();return true;})()");
await sleep(400);
check('对密码：localStorage 写 open', await ev("(function(){try{return localStorage.getItem('xy-home-v2:cardlock-state')==='open';}catch(e){return false;}})()")===true);
// 4) 解锁后闸开（不等待 reload）：直接调 API 验证
await ev("window.cardLockTryUnlock('990815')");
await sleep(400); // 解锁事件异步重建分组池，等一帧避免竞态闪断
check('解锁后 getDefaultCardGroups(main)>0', await ev("(window.getDefaultCardGroups('main')||[]).length>0")===true);
check('解锁后 getLibPool(fish) 非空', await ev("(window.getLibPool('fish','摸鱼浮字')||[]).length>0")===true);
// 5) 重锁
await ev("window.cardLockRelock()");
check('重锁后分组回空', await ev("(window.getDefaultCardGroups('main')||[]).length===0")===true);
// 6) 进入应用后的强制弹窗提醒（#XXX）：仅「锁定 且 自定义字卡总数<500」才弹；≥500 不弹；
//    已解锁不弹；pill「输入密码解锁」就地拉出二级验证弹窗
await ev("window.cardLockRelock()"); // 确保回到锁定态
// 模拟已进入应用（开屏已 hide）+ 数据就绪（冷启动回填后 __mochiDataReady=true）；默认自定义字卡=0
await ev("document.getElementById('splash').classList.add('hide');window.__mochiDataReady=true;");
await ev("window.__cardLockTest&&window.__cardLockTest.fire()");
await sleep(900);
check('锁定+0卡：强制弹窗打开（modal-mask 显示）', await ev("(function(){var m=document.getElementById('modal-mask');return m&&!m.hidden;})()")===true);
check('锁定+0卡：弹窗标题为「系统字卡未解锁」', await ev("(function(){var t=document.querySelector('.modal-t')||document.querySelector('#modal-mask .modal-title');if(!t)return false;return String(t.textContent).indexOf('系统字卡未解锁')>-1;})()")===true);
check('锁定+0卡：弹窗含锁定影响面长文案', await ev("(function(){var s=document.getElementById('modal-static');return s&&!s.hidden&&s.textContent.indexOf('面向未成年人')>-1&&s.textContent.indexOf('默认聊天字卡')>-1;})()")===true);
check('锁定+0卡：弹窗确定按钮文案为「知道了」', await ev("(function(){var b=document.getElementById('modal-ok')||(document.querySelector('#modal-mask .modal-btn')||{});return b&&String(b.textContent)=='知道了';})()")===true);
check('锁定+0卡：弹窗含「输入密码解锁」pill', await ev("(function(){var bs=document.querySelectorAll('#modal-mask .modal-pills .pill');for(var i=0;i<bs.length;i++){if(String(bs[i].textContent).indexOf('输入密码解锁')>-1)return true;}return false;})()")===true);
// 点 pill → 就地带出二级验证弹窗
await ev("(function(){var bs=document.querySelectorAll('#modal-mask .modal-pills .pill');for(var i=0;i<bs.length;i++){if(String(bs[i].textContent).indexOf('输入密码解锁')>-1){bs[i].click();break;}}return true;})()");
await sleep(600);
check('pill 就地带出二级验证弹窗', await ev("(function(){var s=document.getElementById('modal-static');return s&&!s.hidden&&s.textContent.indexOf('字卡生日')>-1&&s.textContent.indexOf('前两位是 99')>-1;})()")===true);
// 关掉二级验证弹窗
await ev("(function(){var b=document.getElementById('modal-cancel');if(b)b.click();return true;})()");
await sleep(200);
// 锁定 + 500 卡（stub 计数到阈值）：不应弹
await ev("window.cardLockCustomCount=function(){return 500;};window.__cardLockTest.fire();");
await sleep(900);
check('锁定+500卡：不弹强制弹窗', await ev("(function(){var m=document.getElementById('modal-mask');return !m||m.hidden;})()")===true);
// 恢复真实计数(0)，解锁后再触发不应弹
await ev("delete window.cardLockCustomCount;window.cardLockTryUnlock('990815')");
await sleep(400);
check('解锁后 getDefaultCardGroups(main)>0', await ev("(window.getDefaultCardGroups('main')||[]).length>0")===true);
await ev("window.__cardLockTest.fire()");
await sleep(900);
check('已解锁：不弹强制弹窗', await ev("(function(){var m=document.getElementById('modal-mask');return !m||m.hidden;})()")===true);
await ev("window.cardLockRelock()");
console.log('== 结果: ' + results.filter(Boolean).length + '/' + results.length + ' ==');
try { ws.close(); } catch(e){}
try { chrome.kill(); } catch(e){}
try { server.close(); } catch(e){}
process.exit(results.every(Boolean) ? 0 : 1);
