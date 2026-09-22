(function () { try {
(function () {
const pages = document.getElementById('desktop-pages');
if (!pages) return;
function getSlides() { return Array.prototype.slice.call(pages.querySelectorAll('.page-slide')); }
function getDots() { return Array.prototype.slice.call(document.querySelectorAll('#desktop-dots .dot')); }
let idx = 0;
let dotsCache = [];
let gapCache = null;
function refreshCache() {
dotsCache = getDots();
gapCache = null;
}
function pageStep() {
if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;
return pages.clientWidth + gapCache;
}
function paint(cur) {
if (cur === idx) return;
idx = cur;
for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
}
function sync() {
if (!pages.clientWidth) return;
const step = pageStep();
if (!(step > 0)) return;
const max = Math.max(dotsCache.length - 1, 0);
paint(Math.max(0, Math.min(max, Math.round(pages.scrollLeft / step))));
}
function go(i) {
refreshCache(); // 圆点可能刚被重建过（点击落在 deskRebuild 之后的首帧）
const slides = getSlides();
idx = Math.max(0, Math.min(slides.length - 1, i));
if (!pages.clientWidth) return;
pages.scrollLeft = idx * pageStep();
for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
}
const PERF_KEY = 'xy-home-v2:__diag-deskperf';
const PERF_FRAMES = 60;
let perfOn = false;
function perfSample() {
if (perfOn) return;
perfOn = true;
const gaps = [];
let last = 0;
let hid = 0;
const tick = (now) => {
if (typeof document !== 'undefined' && document.hidden) {
hid++;
last = 0;
requestAnimationFrame(tick);
return;
}
if (last) gaps.push(now - last);
last = now;
if (gaps.length < PERF_FRAMES) { requestAnimationFrame(tick); return; }
perfOn = false;
gaps.sort((a, b) => a - b);
const sum = gaps.reduce((a, b) => a + b, 0);
try {
localStorage.setItem(PERF_KEY, JSON.stringify({
t: Date.now(), n: gaps.length, hid: hid,
mean: Math.round(sum / gaps.length),
p90: Math.round(gaps[Math.floor(gaps.length * 0.9)]),
worst: Math.round(gaps[gaps.length - 1]),
pages: dotsCache.length // 圆点数＝桌面页数（随手可得，不额外查 DOM）
}));
} catch (e) {}
};
requestAnimationFrame(tick);
}
const pageScrollGuard = (function () {
function inkBottom(sl, pageTop) {
let maxB = 0;
const all = sl.querySelectorAll('*');
for (let i = 0; i < all.length; i++) {
const el = all[i];
if (el.children.length) continue;
const c = getComputedStyle(el);
if (c.display === 'none' || c.visibility === 'hidden') continue;
if (c.position === 'absolute' || c.position === 'fixed') continue;
const r = el.getBoundingClientRect();
if (r.height <= 0) continue;
const b = r.bottom - pageTop;
if (b > maxB) maxB = b;
}
return maxB;
}
let timer = null, retries = 0;
function later(ms) { clearTimeout(timer); timer = setTimeout(run, ms); }
function run() {
const slides = getSlides();
let skipped = false;
for (let i = 0; i < slides.length; i++) {
const sl = slides[i];
if (!sl.clientHeight || getComputedStyle(sl).visibility === 'hidden') { skipped = true; continue; }
const over = sl.scrollHeight - sl.clientHeight;
const blind = over > 0 && inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1;
if (blind) {
if (sl.style.overflowY !== 'hidden') sl.style.overflowY = 'hidden';
if (sl.scrollTop) sl.scrollTop = 0;
} else {
if (sl.style.overflowY) sl.style.overflowY = '';   // 回落到 CSS 的 auto
if (over <= 0 && sl.scrollTop) sl.scrollTop = 0;
}
}
if (skipped && retries < 8) { retries++; later(800); } else if (!skipped) retries = 0;
}
return { run: run, later: later };
})();
pageScrollGuard.run();
pages.addEventListener('scroll', () => pageScrollGuard.later(300), true);
pages.addEventListener('load', () => pageScrollGuard.later(400), true);
window.addEventListener('resize', () => pageScrollGuard.later(120));
document.addEventListener('visibilitychange', () => { if (!document.hidden) pageScrollGuard.later(80); });
try {
new MutationObserver(() => pageScrollGuard.later(400)).observe(pages, { childList: true, subtree: true });
} catch (e) {}
try { document.addEventListener('mochi-restore-done', () => pageScrollGuard.later(400)); } catch (e) {}
pageScrollGuard.later(900);
setTimeout(() => pageScrollGuard.run(), 2600);
const SW_KEY = 'xy-home-v2:__diag-swperf';
const SW_FRAMES = 30;
function swSample() {
if (swOn) return;
const now943 = Date.now();
if (now943 - (swSample.last || 0) < 300000) return;
swSample.last = now943;
swOn = true;
const gaps = [];
let last = 0, hid = 0;
const tick = (now) => {
if (document.hidden) { hid++; last = 0; requestAnimationFrame(tick); return; }
if (last) gaps.push(now - last);
last = now;
if (gaps.length < SW_FRAMES) { requestAnimationFrame(tick); return; }
swOn = false;
gaps.sort((a, b) => a - b);
const sum = gaps.reduce((a, b) => a + b, 0);
try {
localStorage.setItem(SW_KEY, JSON.stringify({
t: Date.now(), n: gaps.length, hid: hid,
mean: Math.round(sum / gaps.length),
p90: Math.round(gaps[Math.floor(gaps.length * 0.9)]),
worst: Math.round(gaps[gaps.length - 1])
}));
} catch (e) {}
};
requestAnimationFrame(tick);
}
let swOn = false;
let rafId = 0;
let settleTimer = null;
let swipeBlurTimer = null; // #976：滑页暂停壁纸模糊的收尾计时
function syncFrame() {
rafId = 0;
sync();
}  pages.addEventListener('scroll', () => {
if (!rafId) rafId = requestAnimationFrame(syncFrame);
perfSample(); // #690：翻页现场记一段帧耗时（静止时不跑）
try {
document.documentElement.classList.add('desk-swiping');
clearTimeout(swipeBlurTimer);
swipeBlurTimer = setTimeout(function () { document.documentElement.classList.remove('desk-swiping'); }, 150);
} catch (e0) {}
clearTimeout(settleTimer);
settleTimer = setTimeout(sync, 80);
}, { passive: true });
document.getElementById('desktop-dots').addEventListener('click', (e) => {
const dot = e.target.closest('.dot');
if (!dot) return;
go(getDots().indexOf(dot));
});
window.addEventListener('resize', () => {
refreshCache(); // 视口变了重算 gap 缓存（clientWidth 每帧现读，无需缓存）
if (pages.clientWidth) pages.scrollLeft = idx * pageStep();
});
const phonePage = document.getElementById('page-phone');
if (phonePage) {
const mo = new MutationObserver(() => {
if (!phonePage.hidden && pages.clientWidth) {
refreshCache();
pages.scrollLeft = idx * pageStep();
sync();
pageScrollGuard.later(60); // #989：回桌面复核一次（残留滚动量在进桌面当帧就修掉）
swSample(); // #884：从聊天/其他页切回桌面那一刻现场采一段帧耗时
}
});
mo.observe(phonePage, { attributes: true, attributeFilter: ['hidden'] });
}
window.deskRebuild = function () {
const slides = getSlides();
idx = Math.max(0, Math.min(Math.max(slides.length - 1, 0), idx));
const dotsBox = document.getElementById('desktop-dots');
if (dotsBox) {
dotsBox.innerHTML = '';
for (let i = 0; i < slides.length; i++) {
const d = document.createElement('span');
d.className = 'dot' + (i === idx ? ' active' : '');
dotsBox.appendChild(d);
}
}
refreshCache();
if (pages.clientWidth) {
pages.scrollLeft = idx * pageStep();
sync();
}
};
refreshCache();
sync();
window.deskGo = go;
window.deskIdx = function () { return idx; };
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("desktop-slider.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("desktop-slider.js"); try { console.error("[JS] desktop-slider.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[desktop-slider.js] " + String(__e && __e.message || __e)); } })();