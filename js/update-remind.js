(function () { try {
/* ===== 功能：线上有新版 · 强制刷新提醒弹窗（移植自言字卡 update-check.js 的提醒层） =====
归属：系统 / PWA / 开屏（AI-B 域）。build.mjs jsFiles 插在 pwa.js 之后加载。
触发：pwa.js 版本轮询判出「线上 version.json 比本页构建 ts 新」（本页是旧缓存包）时调用
window.mochiUpdateRemindShow()；已是最新＝不弹。静默自动升级（tryAutoUpgrade）照旧并行。
层位：#splash 内的自绘遮罩卡——开屏期间 modal-mask 不可见（.phone 整棵 visibility:hidden、
modal z-998 低于 splash z-999），不能用 openModal；与开屏同层，不新建全局遮罩、不改 z-index。
动作：主动作只有「点击刷新」＝走 pwa.js 的 mochiRefreshNow（预取最新 index 落进 SW 缓存再
reload，弱网根治「刷了还在旧版」）；下方留「暂不刷新」小字逃生口——离线/弱网刷不动时
不至于被钉死在开屏；关掉后本会话不再弹，下次打开仍是旧包会再弹。
无头/回归环境（webdriver / Headless UA）与 file:// 直开不弹，避免 278 个回归脚本被挡在门外。
====================================================== */
(function () {
'use strict';
const IS_AUTOMATION = (typeof navigator !== 'undefined') &&
(navigator.webdriver === true || /Headless/i.test(String(navigator.userAgent)));
const TITLE = '强制刷新更新至2026.10.16';
const BODY = '本来9.30已永久停更，不该再更改任何内容，但mochi 的密码早已被大范围泄露（有人私传、二传链接时把密码一起传、确认成年就直接传密码），违规使用、不遵守使用规则的情况越来越多。密码暂不修改，但新增入站问卷：答对全部题目才能恢复使用。题目都是公告与使用规则里的内容，答对一次本机永久放行（问卷更新后需重新作答）。提示：点击刷新后要重新下载全部内容（约 5.6MB），网络慢时可能需要一两分钟，请保持页面打开等它自动完成；如果刷新后进来还是旧版，说明刚才没下载完，再点一次刷新（或多试几次）就好。';
const BTN = '点击刷新更新至2026.10.16问卷版本';
let done = false; // 本会话已弹过（含被「暂不刷新」关掉）＝不再重复弹
function esc(s) {
return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
window.mochiUpdateRemindShow = function () {
if (done || IS_AUTOMATION) return false;
if (!/^https?:$/.test(location.protocol)) return false;
const sp = document.getElementById('splash');
if (!sp || sp.classList.contains('hide')) return false; // 已进应用＝静默通道接管，不打扰会话
done = true;
const wrap = document.createElement('div');
wrap.className = 'ur-wrap';
wrap.id = 'update-remind-wrap';
wrap.innerHTML =
'<div class="ur-card">' +
'<div class="ur-t">' + esc(TITLE) + '</div>' +
'<div class="ur-d">' + esc(BODY) + '</div>' +
'<button type="button" class="ur-go">' + esc(BTN) + '</button>' +
'<div class="ur-st" role="status"></div>' +
'<button type="button" class="ur-later">暂不刷新</button>' +
'</div>';
sp.appendChild(wrap);
const go = wrap.querySelector('.ur-go');
const st = wrap.querySelector('.ur-st');
let refreshing = false, failTimer = 0, msgOn = false;
function urMsg(e) {
if (e.data && e.data.type === 'PRECACHE_DONE') {
try { navigator.serviceWorker.removeEventListener('message', urMsg); } catch (x) {}
msgOn = false;
try { location.reload(); } catch (x2) {}
}
}
function armMsg() {
if (msgOn || !(navigator.serviceWorker && navigator.serviceWorker.addEventListener)) return;
msgOn = true;
navigator.serviceWorker.addEventListener('message', urMsg);
}
function onFail() {
if (!refreshing) return;
refreshing = false;
if (msgOn) { try { navigator.serviceWorker.removeEventListener('message', urMsg); } catch (x) {} msgOn = false; }
if (!wrap.parentNode) return; // 弹窗已被「暂不刷新」关掉＝后台继续下、DONE 到了照样换版
go.disabled = false;
go.textContent = BTN;
st.textContent = '新版没下载完（网络太慢），本次等待已停止。可以再点一次上面的按钮重试，或点「暂不刷新」先进入（下次打开仍是旧版时会再提醒）。';
st.classList.add('show');
}
go.addEventListener('click', function () {
if (refreshing) return;
refreshing = true;
go.disabled = true;
go.textContent = '正在刷新…请保持页面打开';
st.textContent = '正在下载新版（网络慢时可能需要一两分钟），完成后会自动刷新，不用手动操作。';
st.classList.add('show');
armMsg();
if (failTimer) clearTimeout(failTimer);
failTimer = setTimeout(onFail, 185000); // 比 refreshNow 手动通道的 180s 超时晚一点，只补「如实告知」
try { if (window.mochiRefreshNow) { window.mochiRefreshNow(); return; } } catch (e) {}
try { location.reload(); } catch (e2) {}
});
wrap.querySelector('.ur-later').addEventListener('click', function () {
if (failTimer) { clearTimeout(failTimer); failTimer = 0; }
if (msgOn) { try { navigator.serviceWorker.removeEventListener('message', urMsg); } catch (x) {} msgOn = false; }
if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
});
return true;
};
window.__updateRemindReady = true;
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("update-remind.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("update-remind.js"); try { console.error("[JS] update-remind.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[update-remind.js] " + String(__e && __e.message || __e)); } })();