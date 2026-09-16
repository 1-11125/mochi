// ===== 功能：开屏新版检测（#570，独立于 pwa.js 轮询更新条与 device.js 诊断） =====
// 需求（用户原话）：「做一个独立的新版检测功能放在开屏显示现在是不是新版」。
// 口径：与 pwa.js 轮询 / 设备兼容诊断同源——比 version.json 构建 ts 与本机
// #splash-ver 的 data-build-ts；每次冷启动只检测一次（不轮询、不加常驻网络负担）；
// 检测行渲染在开屏版本块第三行（template.html #splash-ver-check，base.css .sv-check）。
// 有新版时整行可点，复用 pwa.js 的 refreshNow（PRECACHE 预取最新 index 再 reload；
// 裸 location.reload 在弱网/iOS 上导航请求会回退旧缓存＝「刷了还在旧版」，故经其暴露的
// window.mochiRefreshNow 走同一条链）。开屏进应用后节点随 #splash-ver 一起被 clock.js
// 移除，取回晚于移除时赋值无害（离屏节点，零副作用）。
// FIX 2026-09-16 #629：用户反馈「无线网和流量都正常、多次刷新更新仍是旧版」。真因不是
// 没网——新产物要靠后台完整下载一次才会换上（pwa.js 预取只等 2.5s 就 reload、sw.js 给
// index 的下载上限 30s，中途重开＝白下；见 #157/#273/#570 同族），用户越连点越刷不上。
// 故：只要「已经刷过却还是旧版」（点过「点此更新」留有标记，或本次文档本就是刷新进来的），
// 检测行换成「仍是旧版·点此再试」并补一行怎么才算刷上的指引（等 3~5 分钟 / 换流量 / 别连点）。
(function () {
  'use strict';
  // #386 同族：file:// 直开本地文件时 fetch 同目录 json 被浏览器禁（origin 'null'），
  // 只会白报一条错，检测行直接不显示（线上 http/https 才启用）。
  if (location.protocol === 'file:') return;
  var el = document.getElementById('splash-ver-check');
  var sv = document.getElementById('splash-ver');
  if (!el || !sv) return;
  var localTs = Number(sv.getAttribute('data-build-ts')) || 0;
  // 与 device.js devStr 同档位：不足 1 分钟 / 约 N 分钟 / 约 N.N 小时 / 约 N 天
  function gapStr(ms) {
    if (!(ms > 0)) return '';
    var min = Math.round(ms / 60000);
    if (min < 1) return '不足 1 分钟';
    if (min < 60) return '约 ' + min + ' 分钟';
    var hr = ms / 3600000;
    if (hr < 48) return '约 ' + (Math.round(hr * 10) / 10) + ' 小时';
    return '约 ' + Math.round(hr / 24) + ' 天';
  }
  // ===== FIX 2026-09-16 #629：刷过却仍旧版时的指引（见文件头） =====
  // 标记只在「点此更新/点此再试」时写、只在「✓ 已是最新版」时清——标记还在＝这台设备上
  // 更新失败过（写标记时还不知道结果，所以清除点必须放在成功那一侧，不能放在点击那一侧）。
  var RETRY_KEY = 'xy-home-v2:ver-retry';
  function retryMarked() {
    try { return !!localStorage.getItem(RETRY_KEY); } catch (e) { return false; }
  }
  function markRetry(ts) {
    try {
      var n = Number(String(localStorage.getItem(RETRY_KEY) || '').split('|')[1]) || 0;
      localStorage.setItem(RETRY_KEY, String(ts > 0 ? ts : 0) + '|' + (n + 1) + '|' + Date.now());
    } catch (e) {}
  }
  function clearRetry() { try { localStorage.removeItem(RETRY_KEY); } catch (e) {} }
  // 本次文档是被「刷新」带进来的（浏览器刷新/下拉刷新/点更新条），不是冷启动——
  // 覆盖「用户没用我们那个按钮、直接反复刷新」的场景（用户原话里的「多次刷新」多是这一类）。
  function isReloadEntry() {
    try {
      var n = performance.getEntriesByType && performance.getEntriesByType('navigation');
      if (n && n.length && n[0] && n[0].type) return n[0].type === 'reload';
      if (performance.navigation) return performance.navigation.type === 1;
    } catch (e) {}
    return false;
  }
  // 指引文案：说清「不是没网、是没下完」，并给两条可执行动作（用户可感知口径）
  var HINT = [
    '点了刷新还是旧版？先别再连着点了——新版本要在后台完整下载一次才会换上。',
    '① 停在这个页面别动，等 3~5 分钟，再刷新一次；',
    '② 或换成流量（手机数据）再试，同样是「等一会儿再刷一次」。'
  ];
  // 指引行：随检测行一起挂在开屏版本块里（JS 自建节点，模板/样式零改动；base.css 在途改不动，
  // 故此处用内联样式，色值取 --hint-ink 与 .sv-check 同源，暗色主题自动跟随）
  var hint = null;
  function showHint() {
    try {
      if (!hint) {
        hint = document.createElement('span');
        hint.className = 'sv-check-hint';
        hint.style.cssText = 'font-size:10.5px;line-height:1.6;color:var(--hint-ink);opacity:.9;' +
          'max-width:100%;text-align:left;white-space:pre-line;';
        if (!el.parentNode) return;
        el.parentNode.insertBefore(hint, el.nextSibling);
      }
      hint.textContent = HINT.join('\n');
      hint.hidden = false;
    } catch (e) {}
  }
  var onlineTs = 0;
  function tap() {
    markRetry(onlineTs);
    if (typeof window.mochiRefreshNow === 'function') window.mochiRefreshNow();
    else { try { location.reload(); } catch (e) {} }
  }
  function set(cls, text, clickable) {
    el.hidden = false;
    el.className = 'sv-check' + (cls ? ' ' + cls : '');
    el.textContent = text;
    el.style.cursor = clickable ? 'pointer' : '';
    el.style.textDecoration = clickable ? 'underline' : '';
    el.onclick = clickable ? tap : null;
  }
  set('', '版本检测中…');
  var done = false;
  var abort = null;
  try { if (typeof AbortController === 'function') abort = new AbortController(); } catch (e) {}
  var to = abort ? setTimeout(function () { try { abort.abort(); } catch (e) {} }, 3000) : 0;
  var opts = { cache: 'no-store' };
  if (abort) opts.signal = abort.signal;
  try {
    fetch('version.json?t=' + Date.now(), opts).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (to) clearTimeout(to);
      if (done) return;
      done = true;
      var ts = j ? Number(j.ts) : 0;
      if (!(ts > 0)) { set('warn', '未能读取版本信息（不影响使用）'); return; }
      if (!localTs) { set('warn', '本机缺构建时间，无法比对'); return; }
      if (ts === localTs) { clearRetry(); set('ok', '✓ 已是最新版'); return; }
      if (ts > localTs) {
        onlineTs = ts;
        // #629：已经刷过却还是旧版 → 换成「仍是旧版·点此再试」并给出怎么才算刷上的指引
        if (retryMarked() || isReloadEntry()) {
          set('stale', '⇩ 仍是旧版（落后' + gapStr(ts - localTs) + '）· 点此再试', true);
          showHint();
          return;
        }
        set('stale', '⇩ 有新版本（落后' + gapStr(ts - localTs) + '）· 点此更新', true);
        return;
      }
      set('warn', '本机比云端还新（CDN 同步中，可忽略）');
    }).catch(function () {
      if (to) clearTimeout(to);
      if (done) return;
      done = true;
      set('warn', '未能检测版本（离线或网络受限）· 不影响使用');
    });
  } catch (e) {
    if (to) clearTimeout(to);
    try { el.hidden = true; } catch (e2) {}
  }
})();
