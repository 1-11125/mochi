(function () { try {
(function () {
const uid = window.activePrefix();
const store = window.activeStore();
function fmtDT(ts) {
const d = new Date(ts);
const p = (n) => (n < 10 ? '0' + n : '' + n);
return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}
function dispName() {
return store.get('lbl-partner')
|| store.get('cs-lbl-partner')
|| (window.contactNameFor ? window.contactNameFor(window.__activeCid || 'default') : '')
|| (window.taWord ? window.taWord() : 'TA');
}
function avatarsLoad() {
try { return JSON.parse(store.get('records-avatar') || '[]'); } catch (e) { return []; }
}
function avatarsSave(list) { store.set('records-avatar', JSON.stringify(list.slice(0, 30))); }
window.addAvatarRecord = function (img, text) {
const list = avatarsLoad();
list.unshift({ img: img, text: text || '', ts: Date.now() });
avatarsSave(list);
if (!document.getElementById('page-home').hidden) render();
};
function callsLoad() {
try { return JSON.parse(store.get('records-call') || '[]'); } catch (e) { return []; }
}
function callsSave(list) { store.set('records-call', JSON.stringify(list.slice(0, 50))); }
window.addCallRecord = function (type, text) {
const list = callsLoad();
list.unshift({ type: type, text: text, ts: Date.now() });
callsSave(list);
if (!document.getElementById('page-home').hidden) render();
};
function catchesLoad() {
try { return JSON.parse(store.get('records-fishcatch') || '[]'); } catch (e) { return []; }
}
function catchesSave(list) { store.set('records-fishcatch', JSON.stringify(list)); } // v3.15.x：用户要求保留全部历史，不设上限（事件本身低频，量级可控）
window.addFishCatchRecord = function (type, text) {
const list = catchesLoad();
list.unshift({ type: type, text: text || '', ts: Date.now() });
catchesSave(list);
if (!document.getElementById('page-home').hidden) render();
};
function recEmpty(finalHtml) {
return (window.mochiDataPending && window.mochiDataPending()) ? '<div class="ta-empty">' + window.mochiLoadingText() + '</div>' : finalHtml;
}
function renderCatch() {
const el = document.getElementById('home-catch');
if (!el) return;
const name = dispName();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const list = catchesLoad();
el.innerHTML = list.length
? list.map(x =>
'<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' +
(x.type === 'ta'
? '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>' + name + ' 抓到我摸鱼'
: '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' + '抓到 ' + name + ' 摸鱼') +
'</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
(x.text ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(esc(x.text)) : esc(x.text)) + '</div>' : '') +
'</div>'
).join('')
: recEmpty('<div class="ta-empty">暂无摸鱼抓包记录（桌面浮字可点击抓包 TA；点太快会被 TA 反向抓包）</div>');
}
function renderCoinPanel(kind) {
const el = document.getElementById(kind === 'ask' ? 'home-coinask' : 'home-coinearn');
if (!el) return;
const list = (window.giftCoinLedgerLoad ? window.giftCoinLedgerLoad(kind) : []) || [];
const name = dispName();
const myName = store.get('lbl-user') || '我';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
if (!list.length) {
el.innerHTML = recEmpty('<div class="ta-empty">' + (kind === 'ask' ? '暂无申请记录（可点心意币余额行向 Mochi 申请）' : '暂无赚钱记录（玩游戏、种花、钓鱼都能赚心意币）') + '</div>');
return;
}
const yuan = (fen) => (fen / 100).toFixed(2);
el.innerHTML = list.map(x => {
let line;
if (x.myFen && x.taFen && x.myFen === x.taFen) line = '双方各 +¥' + yuan(x.myFen);
else {
const parts = [];
if (x.myFen) parts.push(myName + ' +¥' + yuan(x.myFen));
if (x.taFen) parts.push(name + ' +¥' + yuan(x.taFen));
line = parts.join(' · ') || '—';
}
const src = x.src ? esc(x.src) : (kind === 'ask' ? '向 Mochi 申请' : '赚钱');
return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🪙 ' + src + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
'<div class="tc-li-line">' + line + '</div></div>';
}).join('');
}
window.__renderHomeCoin = function () {
if (htab === 'coinearn') renderCoinPanel('earn');
else if (htab === 'coinask') renderCoinPanel('ask');
};
function caresLoad() {
try { return JSON.parse(store.get('records-care') || '[]'); } catch (e) { return []; }
}
function caresSave(list) { store.set('records-care', JSON.stringify(list.slice(0, 100))); }
window.addCareRecord = function (kind, text, ts) {
const list = caresLoad();
list.unshift({ kind: kind, text: text || '', ts: ts || Date.now() });
caresSave(list);
const hp = document.getElementById('page-home');
if (hp && !hp.hidden && htab === 'care') renderCarePanel();
};
window.addCareRecordFor = function (cid, kind, text, ts) {
try {
const s = (cid && window.storeFor) ? window.storeFor(cid) : store;
let list = [];
try { list = JSON.parse(s.get('records-care') || '[]'); } catch (e) { list = []; }
if (!Array.isArray(list)) list = [];
list.unshift({ kind: kind, text: text || '', ts: ts || Date.now() });
s.set('records-care', JSON.stringify(list.slice(0, 100)));
} catch (e) {}
};
function renderCarePanel() {
const el = document.getElementById('home-care');
if (!el) return;
const name = dispName();
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const KIND_ICON = { checkin: '📋', period: '🌸', water: '💧', eat: '🍚', pomo: '🍅', deskcheck: '🏠' };
const rows = [];
caresLoad().forEach(r => { if (r.kind === 'pomo') rows.push({ icon: '🍅', main: '番茄钟陪伴', sub: fmtDT(r.ts), ts: r.ts }); });
let careTs = [];
try { caresLoad().forEach(r => { if (r && r.kind === 'desk-checkin') careTs.push(r.ts || 0); }); } catch (e) {}
let msgs = [];
try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
const askCardTs = [];
(msgs || []).forEach(o => { if (o && o.special === 'ask-card' && o.askQuestion) askCardTs.push(o.ts || 0); });
askCardTs.sort((a, b) => a - b);
const hasAskCardNear = (t) => {
let lo = 0, hi = askCardTs.length;
const from = t - 30000, to = t + 30000;
while (lo < hi) { const mid = (lo + hi) >> 1; if (askCardTs[mid] <= from) lo = mid + 1; else hi = mid; }
return lo < askCardTs.length && askCardTs[lo] < to;
};
(msgs || []).forEach(m => {
if (!m) return;
const t = m.ts || 0;
const tag = (m.mood && m.mood[0] && m.mood[0].tag) || '';
if (tag === '经期关心') rows.push({ icon: KIND_ICON.period, main: '经期关心 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
else if (tag === '喝水提醒') rows.push({ icon: KIND_ICON.water, main: '提醒喝水 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
else if (tag === '吃饭提醒') rows.push({ icon: KIND_ICON.eat, main: '提醒吃饭 · ' + esc(m.text || ''), sub: fmtDT(t), ts: t });
else if (m.special === 'ask-card' && m.askQuestion && !(m.deskCk && careTs.some(ct => Math.abs(ct - t) <= 90000))) rows.push({ icon: KIND_ICON.checkin, main: '查岗 · ' + esc(m.askQuestion), sub: fmtDT(t), ts: t });
else if (m.special === 'ask-msg' && /查岗/.test(m.text || '')) {
const nearCard = hasAskCardNear(t); // #588：二分查，不再对全表 some()
if (!nearCard) rows.push({ icon: KIND_ICON.checkin, main: '查岗', sub: fmtDT(t), ts: t });
}
});
if (window.getContacts) {
(window.getContacts() || []).forEach(function (c) {
let care = [];
try {
const s = (c.id && window.storeFor) ? window.storeFor(c.id) : store;
care = JSON.parse(s.get('records-care') || '[]');
} catch (e) { care = []; }
(Array.isArray(care) ? care : []).forEach(function (r) {
if (!r || r.kind !== 'desk-checkin') return;
const cname = (c && c.name) || 'TA';
rows.push({ icon: KIND_ICON.deskcheck, main: '桌面查岗 · ' + esc(cname) + ' · ' + esc(r.text || ''), sub: fmtDT(r.ts || 0), ts: r.ts || 0 });
});
});
}
if (!rows.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无联系人的关心记录（TA 会主动查岗、提醒你喝水吃饭、关心经期、陪你专注）</div>'); return; }
rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
el.innerHTML = rows.map(r => '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + r.icon + ' ' + r.main + '</span><span class="tc-li-time">' + r.sub + '</span></div></div>').join('');
}
function renderRpPanel() {
const el = document.getElementById('home-coinrp');
if (!el) return;
const name = dispName();
const myName = store.get('lbl-user') || '我';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let msgs = [];
try { msgs = (window.getChatMsgs ? window.getChatMsgs() : JSON.parse(store.get('chat-msgs') || '[]')); } catch (e) {}
const list = (msgs || []).filter(m => m && m.special === 'redpacket');
if (!list.length) { el.innerHTML = recEmpty('<div class="ta-empty">暂无红包记录（红包也是心意币，快去发一个试试）</div>'); return; }
const stMap = { pending: '待领取', received: '已领取', expired: '已过期·退回', returned: '已退回' };
el.innerHTML = list.slice().reverse().map(m => {
const out = m.side === 'out';
const st = stMap[m.rpStatus || 'pending'] || '';
const amt = Number(m.rpAmount || 0).toFixed(2);
const sub = (out ? myName + ' 发给 ' + name : name + ' 发给 ' + myName) + ' · ' + (st || '待领取') +
(m.rpWish ? ' · 「' + esc(m.rpWish) + '」' : '');
return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + (out ? '🧧 我发红包 ¥' + amt : '🧧 ' + esc(name) + ' 发红包 ¥' + amt) + '</span><span class="tc-li-time">' + fmtDT(m.rpTs || m.ts) + '</span></div>' +
'<div class="tc-li-line">' + sub + '</div></div>';
}).join('');
}
function renderDivinePanel() {
const el = document.getElementById('home-divine');
if (!el) return;
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const list = histList('records-divine');
if (!list.length) {
el.innerHTML = recEmpty('<div class="ta-empty">暂无占卜记录（在「占卜」页选择对象抽牌后，牌面与解读自动存入这里）</div>');
return;
}
el.innerHTML = list.map((h, i) => {
const n = Array.isArray(h.cards) ? h.cards.length : (h.count || 0);
const cardsTxt = Array.isArray(h.cards) ? h.cards.map(c => ((c && c.name) || '') + (c && c.rev ? '(逆)' : '')).join('、') : '';
const title = (h.mode === 'tarot' ? '塔罗' : '雷诺曼') + ' · ' + n + ' 张' + (h.target ? ' · 为 ' + esc(h.target) + ' 占卜' : '');
return '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">🔮 ' + title +
(h.question ? ' · 问：' + esc(h.question) : '') + '</span><span class="tc-li-time">' + fmtDT(h.ts) + '</span></div>' +
(cardsTxt ? '<div class="tc-li-line">' + esc(cardsTxt) + '</div>' : '') +
(h.summary ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(esc(h.summary)) : esc(h.summary)) + '</div>' : '') +
'<button class="div-h-view hd-view" data-di="' + i + '">查看牌面</button></div>';
}).join('');
el.querySelectorAll('.hd-view').forEach(b => b.addEventListener('click', () => {
const h = histList('records-divine')[parseInt(b.dataset.di, 10)];
if (!h || !Array.isArray(h.cards) || !window.divineRenderResult) return;
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const dp = document.getElementById('page-divine');
if (dp) dp.hidden = false;
try { window.divineRenderResult(h.cards, h.mode, h.question || '', h.summary || ''); } catch (e) {}
}));
}
function histList(key) { try { return JSON.parse(store.get(key) || '[]'); } catch (e) { return []; } }
let htab = 'av';
window.renderFishHistory = function () {
const el = document.getElementById('home-fish');
if (!el) return;
const h = (window.getFishHistory && window.getFishHistory()) || [];
const name = dispName();
const myName = store.get('lbl-user') || '我';
const tot = (window.getFishTotals && window.getFishTotals()) || { mine: 0, ta: 0 };
const totalHtml =
'<div class="fish-total">' +
'<span class="ft-item"><b>' + myName + '</b> 累计 ' + (tot.mine || 0) + '</span>' +
'<span class="ft-item"><b>' + name + '</b> 累计 ' + (tot.ta || 0) + '</span>' +
'</div>';
const cb = (window.getFishComboBest && window.getFishComboBest()) || { today: 0, best: 0 };
const comboHtml = (cb && (cb.today > 0 || cb.best > 0))
? '<div class="fish-combo-line">今日最高连击 ×' + (cb.today || 0) + ' · 历史最高 ×' + (cb.best || 0) + '</div>'
: '';
el.innerHTML = totalHtml + comboHtml + (h.length
? h.map(x => '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
'<div class="tc-li-line">' + myName + ' 当天摸鱼：+' + (x.mine || 0) + '</div>' +
'<div class="tc-li-line">' + name + ' 当天摸鱼：+' + (x.ta || 0) + '</div></div>').join('')
: recEmpty('<div class="ta-empty">暂无摸鱼值记录</div>'));
};
window.renderWorkHistory = function () {
const el = document.getElementById('home-work');
if (!el) return;
const h = (window.getWorkHistory && window.getWorkHistory()) || [];
const name = dispName();
const myName = store.get('lbl-user') || '我';
const tot = (window.getWorkTotals && window.getWorkTotals()) || { mine: 0, ta: 0 };
const totalHtml =
'<div class="fish-total">' +
'<span class="ft-item"><b>' + myName + '</b> 累计 ' + (tot.mine || 0) + '</span>' +
'<span class="ft-item"><b>' + name + '</b> 累计 ' + (tot.ta || 0) + '</span>' +
'</div>';
el.innerHTML = totalHtml + (h.length
? h.map(x => '<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + x.date + '</span></div>' +
'<div class="tc-li-line">' + myName + ' 当天打工：+' + (x.mine || 0) + '</div>' +
'<div class="tc-li-line">' + name + ' 当天打工：+' + (x.ta || 0) + '</div></div>').join('')
: recEmpty('<div class="ta-empty">暂无打工值记录</div>'));
};
function render() {
const showOnly = htab;
if (showOnly === 'work') {
window.renderWorkHistory();
}
if (showOnly === 'fish') {
window.renderFishHistory();
}
if (showOnly === 'catch') {
renderCatch();
}
if (showOnly === 'coinearn') {
renderCoinPanel('earn');
}
if (showOnly === 'coinask') {
renderCoinPanel('ask');
}
if (showOnly === 'coinrp') {
renderRpPanel();
}
if (showOnly === 'care') {
renderCarePanel();
}
if (showOnly === 'divine') {
renderDivinePanel();
}
if (showOnly === 'av') {
const avEl = document.getElementById('home-av');
if (avEl) {
const list = avatarsLoad();
const name = dispName();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
avEl.innerHTML = list.length
? list.map(x =>
'<div class="tc-listitem"><div class="tc-li-top"><span class="tc-li-q">' + (window.taFit ? window.taFit(esc(x.text || (name + ' 更换了头像'))) : esc(x.text || (name + ' 更换了头像'))) + '</span><span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
(x.img ? '<img class="rec-av-img" src="' + x.img + '" alt="头像">' : '') +
'</div>'
).join('')
: recEmpty('<div class="ta-empty">暂无换头像记录</div>');
}
}
if (showOnly === 'call') {
const callEl = document.getElementById('home-call');
if (callEl) {
const list = callsLoad();
const name = dispName();
const icIn = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>';
const icOut = '<svg class="st-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/><path d="M16 3v6M19 6h-6"/></svg>';
callEl.innerHTML = list.length
? list.map(x => {
const itp = x.ended === 'interrupt';
return '<div class="tc-listitem' + (itp ? ' tc-call-interrupt' : '') + '"><div class="tc-li-top"><span class="tc-li-q">' +
(x.type === 'in' ? icIn + name + ' 来电' : icOut + name + ' 拨打') +
'</span>' + (itp ? '<span class="tc-li-interrupt-tag">中断</span>' : '') + '<span class="tc-li-time">' + fmtDT(x.ts) + '</span></div>' +
(x.text ? '<div class="tc-li-line">' + (window.taFit ? window.taFit(x.text) : x.text) + '</div>' : '') +
'</div>';
}).join('')
: recEmpty('<div class="ta-empty">暂无通话记录</div>');
}
}
}
document.querySelectorAll('#page-home .fav-tab').forEach(tab => {
tab.addEventListener('click', () => {
htab = tab.dataset.htab;
document.querySelectorAll('#page-home .fav-tab').forEach(x => x.classList.toggle('sel', x === tab));
document.querySelectorAll('#page-home .cal-card').forEach(c => { c.hidden = c.dataset.hpanel !== htab && c.dataset.hpanel !== '*'; });
render();
});
});
if (window.mochiOnDataReady) window.mochiOnDataReady(render);
const homeApp = document.querySelector('.app[data-app="home"]');
const homePage = document.getElementById('page-home');
if (homeApp && homePage) {
homeApp.addEventListener('click', () => {
const editing = Array.from(document.querySelectorAll('.app-grid')).some(g => g.classList.contains('editing'));
if (editing) return;
render();
document.querySelectorAll('.page').forEach(p => p.hidden = true);
homePage.hidden = false;
});
}
const homeBack = document.getElementById('home-back');
if (homeBack) {
homeBack.addEventListener('click', () => {
document.querySelectorAll('.page').forEach(p => p.hidden = true);
const phone = document.getElementById('page-phone');
if (phone) phone.hidden = false;
});
}
render();
try {
if (window.idbGet) {
const myPrefix = window.activePrefix();
window.idbGet(myPrefix + ':records-avatar').then(v => {
if (window.activePrefix() !== myPrefix) return;
if (v && typeof v === 'string' && v.length > 2) store.set('records-avatar', v);
});
}
} catch (e) {}
document.addEventListener('contact-switched', function () {
try {
const hp = document.getElementById('page-home');
if (hp && !hp.hidden) render();
} catch (e) {}
});
window.__renderHomeCall = function () {
try { if (!document.getElementById('page-home').hidden && htab === 'call') render(); } catch (e) {}
};
})();
if (window.__mochiLoaded) window.__mochiLoaded.push("records.js");
} catch (__e) { if (window.__mochiErrLoaded) window.__mochiErrLoaded.push("records.js"); try { console.error("[JS] records.js", __e && __e.message || __e); } catch (x) {} if (window.__jsErrors) window.__jsErrors.push("[records.js] " + String(__e && __e.message || __e)); } })();