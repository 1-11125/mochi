// ===== 卡顿自检·渲染层实测（#726，设置→工具「卡顿自检」行；与 #411 数据层「一键优化」互补）=====
// 用户点开始后 10 秒 rAF 帧间隔实测（可去任意页面现场复现），产出掉帧率/最慢帧/
// 掉帧集中页/键盘期占比，判级（流畅/轻度/中度/重度）并给对症建议；
// 查明本地数据过大（字卡库等，复用 storage-slim 的 mochiCcSlimScan/mochiPerfLevel 分级）
// 时在建议里指向「卡顿自检 · 一键优化」。
// iOS Safari 无 longtask / performance.memory 观测——结论由帧间隔等效判定；长任务仅在
// 内核支持时用窗口内自建 PerformanceObserver 附带计数，不支持自动降级（不碰 device.js
// 常驻观察器）。零常驻开销：rAF 循环与观察器只在检测窗口内存在，结束即全部停止。
(function () {
  'use strict';
  if (window.mochiPerfCheck) return;

  var LAST_KEY = 'xy-home-v2:perf-check-last';
  var BG_GAP = 250;    // 帧间隔 >250ms ＝ 切后台/锁屏冻结帧，剔除不计（#707 同款教训：后台 144s 间隙会被误判成超级卡顿）
  var JANK_MS = 32;    // >32ms ＝ 掉帧（<31fps）
  var SEVERE_MS = 100; // >100ms ＝ 严重卡顿
  var KB_RATIO = 0.85; // 可视高度 < 视口高度 85% ＝ 键盘弹出期（iOS 键盘期视口变形掉帧常见）
  var PAGE_CN = { main: '手机桌面', chat: '聊天', 'group-chat': '群聊', home: '桌面二页', mail: '信箱', feed: '朋友圈', calendar: '日历', memory: '纪念', divination: '占卜', note: '备忘录', p2: '功能页', music: '音乐', records: '记录', garden: '花园', room: '房间', 'drift-bottle': '漂流瓶' };
  var _running = false;

  function curPage() {
    try {
      var apps = document.querySelectorAll('.app:not([hidden])');
      var el = apps[apps.length - 1];
      return (el && el.dataset && el.dataset.app) || '?';
    } catch (e) { return '?'; }
  }
  function kbOn() {
    try {
      var vv = window.visualViewport;
      return !!(vv && window.innerHeight && vv.height < window.innerHeight * KB_RATIO);
    } catch (e) { return false; }
  }
  function pct(n, d) { return d > 0 ? Math.round(n / d * 1000) / 10 : 0; }
  function verdictOf(jankPct, severe) {
    if (jankPct >= 20 || severe >= 10) return '重度';
    if (jankPct >= 8) return '中度';
    if (jankPct >= 2) return '轻度';
    return '流畅';
  }
  function storageAgg() {
    // 复用 #411 的扫描/分级；调用方保证在检测窗结束后才跑（大库扫描本身是已知耗时点）
    try {
      if (!window.mochiCcSlimScan || !window.mochiPerfAgg || !window.mochiPerfLevel) return null;
      var agg = window.mochiPerfAgg(window.mochiCcSlimScan());
      return (agg && agg.ok) ? agg : null;
    } catch (e) { return null; }
  }

  // start(ms, onTick) → Promise<report|null>（已在跑则 resolve(null)）
  // onTick({ left, frames, janky, hid }) 每 ~500ms 回调一次，供进度条显示
  function start(ms, onTick) {
    return new Promise(function (resolve) {
      if (_running) return resolve(null);
      _running = true;
      ms = Math.max(3000, Math.min(30000, Number(ms) || 10000));
      onTick = typeof onTick === 'function' ? onTick : function () {};
      var rep = { t: Date.now(), ms: ms, frames: 0, janky: 0, severe: 0, worst: 0, hid: 0,
                  kbFrames: 0, kbJanky: 0, pages: {}, lt: null };
      // 长任务：窗口内自建观察器（iOS WebKit observe('longtask') 抛错 → ok=false 降级为纯帧间隔判定）
      var lt = { ok: false, n: 0, worst: 0 }, po = null;
      try {
        po = new PerformanceObserver(function (list) {
          try {
            var es = list.getEntries() || [];
            for (var i = 0; i < es.length; i++) {
              if (es[i] && es[i].duration >= 50) { lt.n++; lt.worst = Math.max(lt.worst, Math.round(es[i].duration)); }
            }
          } catch (e2) {}
        });
        po.observe({ type: 'longtask' }); lt.ok = true;
      } catch (e) {}
      var last = performance.now(), t0 = last, raf = 0, done = false;
      function finish() {
        if (done) return;
        done = true;
        try { if (po) po.disconnect(); } catch (e) {}
        rep.lt = lt.ok ? lt : null;
        rep.jankPct = pct(rep.janky, rep.frames);
        rep.kbPct = pct(rep.kbJanky, rep.janky);     // 掉帧里键盘期占比
        rep.kbShare = pct(rep.kbFrames, rep.frames); // 全部帧里键盘期占比
        var top = null, topN = 0, tot = 0;
        for (var k in rep.pages) { tot += rep.pages[k]; if (rep.pages[k] > topN) { top = k; topN = rep.pages[k]; } }
        rep.topPage = tot > 0 ? top : '';
        rep.verdict = verdictOf(rep.jankPct, rep.severe);
        // 大库扫描让出几十 ms 再跑：扫描耗时不能混进检测窗最后一个样本
        setTimeout(function () {
          var agg = storageAgg();
          rep.storage = agg ? { level: window.mochiPerfLevel(agg.totalBytes, agg.bigGroups), libs: agg.libs, mb: Math.round((agg.totalBytes || 0) / 104857) / 10 } : null;
          rep.text = buildText(rep);
          try { localStorage.setItem(LAST_KEY, JSON.stringify({ t: rep.t, verdict: rep.verdict, jankPct: rep.jankPct })); } catch (e2) {}
          _running = false;
          resolve(rep);
        }, 50);
      }
      function frame(now) {
        if (done) return;
        var d = now - last; last = now;
        if (document.hidden || d > BG_GAP) {
          rep.hid++; // 后台/锁屏冻结帧剔除，不计入样本
        } else {
          rep.frames++;
          var kb = kbOn();
          if (kb) rep.kbFrames++;
          if (d > JANK_MS) {
            rep.janky++;
            if (kb) rep.kbJanky++;
            if (d > SEVERE_MS) rep.severe++;
            if (d > rep.worst) rep.worst = Math.round(d);
            var p = curPage();
            rep.pages[p] = (rep.pages[p] || 0) + 1;
          }
        }
        if (now - t0 >= ms) return finish();
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      var tick = setInterval(function () {
        if (done) { clearInterval(tick); return; }
        onTick({ left: Math.max(0, Math.ceil((ms - (performance.now() - t0)) / 1000)), frames: rep.frames, janky: rep.janky, hid: rep.hid });
      }, 500);
    });
  }

  function buildText(r) {
    var L = [];
    L.push('结论：' + r.verdict + (r.verdict === '流畅' ? '（本窗口未捕获掉帧）' : '（掉帧率 ' + r.jankPct + '%）'));
    L.push('采样 ' + Math.round(r.ms / 1000) + ' 秒 / 有效帧 ' + r.frames + '（已剔除后台/锁屏冻结 ' + r.hid + ' 帧）');
    if (r.frames < 120) L.push('· 有效样本偏少（可能大部分时间在后台），建议亮屏状态下重测');
    if (r.janky > 0) {
      L.push('· 掉帧 ' + r.janky + ' 帧（间隔>32ms），其中严重 ' + r.severe + ' 帧（>100ms），最慢一帧 ' + r.worst + 'ms');
      if (r.topPage) L.push('· 掉帧集中：' + (PAGE_CN[r.topPage] || r.topPage) + '（' + pct(r.pages[r.topPage], r.janky) + '%）');
      if (r.kbJanky > 0) L.push('· 其中键盘弹出期 ' + r.kbJanky + ' 帧（键盘期视口变形 iOS 上常见；收起键盘对照可分辨）');
    }
    if (r.lt) {
      L.push(r.lt.n > 0 ? '· 长任务（>50ms 主线程阻塞）窗口内 ' + r.lt.n + ' 次，最长 ' + r.lt.worst + 'ms' : '· 长任务（>50ms）：窗口内无');
    } else {
      L.push('· 长任务：此内核不支持观测（iOS WebKit），已用帧间隔等效判定');
    }
    if (r.storage) {
      L.push('· 本地数据画像：字卡库 ' + r.storage.libs + ' 个作用域 约 ' + r.storage.mb + ' MB（' + (r.storage.level === '重' ? '较重' : r.storage.level === '中' ? '中度' : '轻量') + '）');
    }
    L.push('');
    L.push('建议：');
    var adv = [];
    if (r.storage && r.storage.level === '重') adv.push('本地数据过大（字卡库等）是本应用最常见的间歇卡顿主因——先做旁边「卡顿自检 · 一键优化」（不删数据）');
    if (r.verdict === '流畅') adv.push('本窗口未捕获掉帧；若体感仍卡，在卡顿出现的当下立即复测，更容易抓到现场');
    if (r.janky > 0 && r.topPage) adv.push('掉帧集中在「' + (PAGE_CN[r.topPage] || r.topPage) + '」——该页操作时最明显，可对照排查最近往该页存过的大图/长内容');
    if (r.kbJanky > 0 && r.kbPct >= 30) adv.push('掉帧多发生在键盘弹出期（iOS 视口变形属系统行为）：收起键盘复测对照，若明显好转则无需处理');
    if (r.verdict !== '流畅' && (!r.storage || r.storage.level !== '重')) adv.push('可按 设置→「手机卡顿说明」的顺序清一遍存量（先「查看存储」看哪项最大）；别用「清除本地数据」治卡顿');
    if (!adv.length) adv.push('保持现状即可');
    adv.forEach(function (a, i) { L.push((i + 1) + '. ' + a); });
    L.push('');
    L.push('（采样只在本机进行、不上传任何数据；掉帧＝帧间隔>' + JANK_MS + 'ms，后台/锁屏冻结帧已剔除）');
    return L.join('\n');
  }

  window.mochiPerfCheck = {
    start: start,
    running: function () { return _running; },
    LAST_KEY: LAST_KEY
  };
})();
