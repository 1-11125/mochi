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
const BODY = '本来9.30已永久停更，不该再更改任何内容，但mochi 的密码早已被大范围泄露（有人私传、二传链接时把密码一起传、确认成年就直接传密码），违规使用、不遵守使用规则的情况越来越多。密码暂不修改，但新增入站问卷：答对全部题目才能恢复使用。题目都是公告与使用规则里的内容，答对一次本机永久放行（问卷更新后需重新作答）。';
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
'<button type="button" class="ur-later">暂不刷新</button>' +
'</div>';
sp.appendChild(wrap);
wrap.querySelector('.ur-go').addEventListener('click', function () {
try { if (window.mochiRefreshNow) { window.mochiRefreshNow(); return; } } catch (e) {}
try { location.reload(); } catch (e2) {}
});
wrap.querySelector('.ur-later').addEventListener('click', function () {
if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
});
return true;
};
window.__updateRemindReady = true;
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("update-remind.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("update-remind.js"); try { console.error("[JS] update-remind.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[update-remind.js] " + String(__e && __e.message || __e)); } })();