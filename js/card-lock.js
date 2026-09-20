(function () { try {
(function () {
const GNS = 'xy-home-v2';
const STATE_SHORT = 'cardlock-state';
const LS_KEY = 'xy-home-v2:cardlock-state'; // 'locked' | 'open'
const PW_HASH = '4240701628';
function fnv1a(s) {
let h = 0x811c9dc5;
for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
return String(h >>> 0);
}
function stGet() {
try {
if (window.xyStore) {
const v = window.xyStore(GNS).get(STATE_SHORT);
if (v !== null && v !== undefined) return v;
}
} catch (e) {}
try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
}
function stSet(v) {
try { if (window.xyStore) { window.xyStore(GNS).set(STATE_SHORT, v); return; } } catch (e) {}
try { localStorage.setItem(LS_KEY, v); } catch (e) {}
}
function isOpen() { try { return stGet() === 'open'; } catch (e) { return false; } }
(function healMigrated() {
try {
if (localStorage.getItem(LS_KEY)) return;
const moved = localStorage.getItem('xy-home-v2:default:cardlock-state');
if (moved === 'open') stSet('open');
} catch (e) {}
})();
let lastOpen = isOpen();
window.cardLockOpen = isOpen;
document.addEventListener('mochi-wrj-heal', function () {
try {
const open = isOpen();
if (open !== lastOpen) {
lastOpen = open;
document.dispatchEvent(new Event(open ? 'mochi-cardlock-open' : 'mochi-cardlock-locked'));
}
} catch (e) {}
});
document.addEventListener('mochi-restore-done', function () {
try {
const open = isOpen();
if (open !== lastOpen) {
lastOpen = open;
document.dispatchEvent(new Event(open ? 'mochi-cardlock-open' : 'mochi-cardlock-locked'));
}
} catch (e) {}
});
let fails = 0, failUntil = 0;
window.cardLockTryUnlock = function (pw) {
const now = Date.now();
if (now < failUntil) return { ok: false, msg: '尝试太频繁，请 ' + Math.ceil((failUntil - now) / 1000) + ' 秒后再试' };
if (fnv1a('mochi#' + String(pw == null ? '' : pw)) === PW_HASH) {
fails = 0;
stSet('open');
lastOpen = true;
document.dispatchEvent(new Event('mochi-cardlock-open'));
return { ok: true };
}
fails++;
if (fails >= 5) { failUntil = now + 60000; fails = 0; return { ok: false, msg: '错误次数过多，请 1 分钟后再试' }; }
return { ok: false, msg: '密码不对（还剩 ' + (5 - fails) + ' 次机会）' };
};
window.cardLockRelock = function () {
stSet('locked');
lastOpen = false;
document.dispatchEvent(new Event('mochi-cardlock-locked'));
};
window.cardLockConfirmPersisted = function (expect, cb) {
let tries = 0;
(function poll() {
try {
if (window.idbGet) {
window.idbGet(LS_KEY).then(function (v) {
if (v === expect || ++tries > 15) { cb(); return; }
setTimeout(poll, 200);
}).catch(cb);
} else { cb(); }
} catch (e) { cb(); }
})();
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("card-lock.js");
} catch (__e) { try { console.error("[JS] card-lock.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[card-lock.js] " + String(__e && __e.message || __e)); } })();