// ===== 卡顿自检·渲染层实测（#726，设置→工具「卡顿自检」行；与 #411 数据层「一键优化」互补）=====
// 用户点开始后 10 秒 rAF 帧间隔实测（可去任意页面现场复现），产出掉帧率/最慢帧/
// 掉帧集中页/键盘期占比，判级（流畅/轻度/中度/重度）并给对症建议；
// 查明本地数据过大（字卡库等，复用 storage-slim 的 mochiCcSlimScan/mochiPerfLevel 分级）
// 时在建议里指向「卡顿自检 · 一键优化」。
// #770 四处收口（红米 K80 Chrome 实报：停在设置页自检，报告却称「掉帧集中：占卜(100%)」，
// 且「结论:流畅(未捕获掉帧)」与下方「掉帧 1 帧」并存）：
// ①掉帧归因改读最上层打开的全屏页（可见 .page 里 z-index 最高、同层取 DOM 靠后；只剩
//   手机桌面时归为 main）——旧实现读 .app 桌面图标挂件，图标自身的显隐不随页面切换变化，
//   停在任何全屏页采样都会被记到「DOM 里最后一个可见图标」头上（该机恰好是占卜）＝归因恒错；
// ②「掉帧集中」改为该页掉帧率 vs 全窗口对比、且掉帧 ≥3 帧才输出（单帧噪声不做页面归因、
//   不引导用户去排查该页大图/长内容）；另报采样期间页面分布供对照；
// ③掉帧阈值自适应：取窗口内实测最小帧间隔为刷新周期（首帧是启动延迟不采、<4ms 视为同
//   vsync 补帧伪象不采），阈值＝min(max(周期×2, 24), 34)ms——60Hz≈33ms 与旧 32ms 基本一致，
//   90/120Hz 高刷屏按实测收紧不再漏计；自适应刷新率屏降到 60 帧档由 24ms 下限兜住、持续
//   幻灯片式掉帧由 34ms 上限兜住（周期被抬高一劲也不会漏判）；
// ④判「流畅」但确有零星掉帧时结论说真话（掉帧率 x% 可忽略），不再与下方「掉帧 N 帧」
//   自相矛盾；建议也只在真一帧没掉时才说「未捕获掉帧」。
// iOS Safari 无 longtask / performance.memory 观测——结论由帧间隔等效判定；长任务仅在
// 内核支持时用窗口内自建 PerformanceObserver 附带计数，不支持自动降级（不碰 device.js
// 常驻观察器）。零常驻开销：rAF 循环与观察器只在检测窗口内存在，结束即全部停止。
// #818 iOS 卡顿定位诊断增强（三样，全部仍只活在检测窗口内，窗口结束即拆干净）：
// ①点按响应延迟——窗口内 passive 按下戳记、下一帧结算「点到画面有反应」的真实等待
//   （含主线程拥堵；iOS 无 longtask 时这比掉帧率更贴近「点了隔一下才动」的体感），
//   报告中位/最慢/超 100ms 次数/最慢发生页；
// ②最慢帧现场——掉帧按「采样第几秒·所在页·键盘期·是否切页后 0.5s 内」记 top3，
//   把「卡在什么时候、哪个页、什么动作之后」说清楚，不再只有「最慢 N ms」一个孤数；
// ③低电量档识别——实测刷新周期 ≥28ms（≈30fps 档）＝整机在半帧率运行：iOS 低电量
//   模式会把帧率减半（系统行为、不是应用卡），报告点名提示关闭后复测对照，防误判。
(function () {
  'use strict';
  if (window.mochiPerfCheck) return;

  var LAST_KEY = 'xy-home-v2:perf-check-last';
  var BG_GAP = 250;    // 帧间隔 >250ms ＝ 切后台/锁屏冻结帧，剔除不计（#707 同款教训：后台 144s 间隙会被误判成超级卡顿）
  var MIN_JANK = 24;   // 自适应掉帧阈值下限 ms（60Hz 算出 ≈33ms≈旧 32ms；高刷屏收紧；自适应刷新率降档时靠下限不误报）
  var MAX_JANK = 34;   // 自适应掉帧阈值上限 ms（持续掉帧会把实测周期抬高，上限兜住不漏判幻灯片式卡顿）
  var SEVERE_MS = 100; // >100ms ＝ 严重卡顿
  var KB_RATIO = 0.85; // 可视高度 < 视口高度 85% ＝ 键盘弹出期（iOS 键盘期视口变形掉帧常见）
  var PAGE_CN = { main: '手机桌面', chat: '聊天', 'group-chat': '群聊', home: '桌面二页', mail: '信箱', feed: '朋友圈', calendar: '日历', memory: '纪念', divination: '占卜', note: '备忘录', p2: '功能页', music: '音乐', records: '记录', garden: '花园', room: '房间', 'drift-bottle': '漂流瓶' };
  // 全屏页 id（page-* 去前缀）→ 中文名；查不到的 id 原样显示（#770 起归因读全屏页，
  // PAGE_CN 里旧的桌面图标名映射保留兜底旧报告/旧调用方）
  var PAGE_ID_CN = { phone: '手机桌面', chat: '聊天', 'group-chat': '群聊', home: '桌面二页', mail: '信箱', 'mail-write': '写信箱', 'mail-reply': '回信箱', feed: '朋友圈', calendar: '日历', memory: '纪念', divine: '占卜', music: '音乐', stats: '统计', interact: '互动', checkin: '打卡', 'checkin-cards': '打卡字卡', garden: '花园', room: '房间', drift: '漂流瓶', period: '经期', accounting: '记账', theme: '主题', setting: '设置', storage: '查看存储', 'card-audit': '字卡自检', chatcard: '字卡库', featurehub: '功能中心', 'feature-data': '功能数据', deskcheck: '屏幕适配诊断', guide: '功能介绍', about: '关于', 'chat-settings': '聊天设置', 'reply-settings': '回复设置', 'call-settings': '通话设置', 'sfx-settings': '音效设置', 'custom-cards': '自定义字卡', 'default-cards': '默认字卡', 'dict-cards': '词典字卡', 'fun-cards': '趣味字卡', 'quote-cards': '语录字卡', 'loc-cards': '定位字卡', 'mood-cards': '心情字卡', 'reply-cards': '回复字卡', fav: '收藏', 'fav-settings': '收藏设置' };
  var _running = false;
  var minD = 0; // 窗口内实测最小帧间隔 ≈ 刷新周期（模块级：jankThr 要读；_running 保证同一时间只有一个窗口在写）

  function pageName(key) { return PAGE_ID_CN[key] || PAGE_CN[key] || key; }
  function curPage() {
    // #770：最上层打开的全屏页——可见 .page 里取 z-index 最高（同为 auto/0 时 DOM 靠后者
    // 胜出，覆盖「设置叠在桌面上」「聊天设置叠在聊天上」等叠层）；只剩手机桌面时归为 main。
    try {
      var pages = document.querySelectorAll('.page:not([hidden])');
      var best = null, bestZ = -1;
      for (var i = 0; i < pages.length; i++) {
        var z = 0;
        try { z = parseInt(getComputedStyle(pages[i]).zIndex, 10) || 0; } catch (e1) {}
        if (z >= bestZ) { bestZ = z; best = pages[i]; }
      }
      if (!best) return '?';
      var id = best.id || '';
      if (id === 'page-phone') return 'main';
      return pageName(id.replace(/^page-/, ''));
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
  function concOk(r) { return r.janky >= 3 && !!r.topPage; } // #770：掉帧 ≥3 帧才做页面归因输出
  function jankThr() { return Math.min(Math.max(minD * 2, MIN_JANK), MAX_JANK); } // #770：阈值随实测刷新周期自适应
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
                  kbFrames: 0, kbJanky: 0, pages: {}, pageFrames: {}, jankMs: 0, period: 0, fps: 0, lt: null,
                  int: null, scene: [], lp: false };
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
      // #818 窗口内采样状态：点按戳记 / 切页时刻 / 最慢帧现场 top3（窗口结束全部随窗销毁）
      var lastDown = -1, intArr = [], intWorst = -1, intWorstPg = '';
      var swAt = -1e9, lastPgSeen = '', scene = [];
      var downEv = window.PointerEvent ? 'pointerdown' : 'mousedown';
      function onDown() { lastDown = performance.now(); }
      try { document.addEventListener(downEv, onDown, { passive: true }); } catch (e) {}
      minD = 0;
      var first = true;
      function finish() {
        if (done) return;
        done = true;
        try { if (po) po.disconnect(); } catch (e) {}
        try { document.removeEventListener(downEv, onDown); } catch (e) {} // #818 响应监听随窗拆除
        rep.lt = lt.ok ? lt : null;
        rep.jankMs = Math.round(jankThr());
        rep.period = Math.round(minD * 10) / 10;
        rep.fps = Math.round(rep.frames * 10000 / Math.max(1, rep.ms)) / 10;
        // #818 点按响应聚合（中位/最慢/超 100ms 次数/最慢页）＋低电量档标记（周期 ≥28ms ≈ 30fps）
        if (intArr.length) {
          var sorted = intArr.slice().sort(function (a, b) { return a - b; });
          var slowN = 0;
          for (var si = 0; si < intArr.length; si++) { if (intArr[si] >= 100) slowN++; }
          rep.int = { n: intArr.length, med: Math.round(sorted[Math.floor(sorted.length / 2)]), worst: Math.round(intWorst), slow: slowN, worstPg: intWorstPg };
        }
        rep.scene = scene;
        rep.lp = minD >= 28;
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
          var pg = curPage();
          rep.pageFrames[pg] = (rep.pageFrames[pg] || 0) + 1;
          if (pg !== lastPgSeen) { lastPgSeen = pg; swAt = now; } // #818 切页时刻（最慢帧现场归因用）
          if (lastDown >= 0) { // #818 点按→下一帧结算响应延迟（含主线程拥堵；≥2s 视为切后台噪声丢弃）
            var lat = now - lastDown; lastDown = -1;
            if (lat >= 0 && lat < 2000) {
              intArr.push(lat);
              if (lat > intWorst) { intWorst = lat; intWorstPg = pg; }
            }
          }
          if (first) { first = false; } // 首帧间隔是启动延迟，只计样本、不进周期/掉帧判定
          else {
            if (d >= 4 && (!minD || d < minD)) minD = d; // <4ms＝同 vsync 补帧伪象，不当刷新周期
            var kb = kbOn();
            if (kb) rep.kbFrames++;
            if (d > jankThr()) {
              rep.janky++;
              if (kb) rep.kbJanky++;
              if (d > SEVERE_MS) rep.severe++;
              if (d > rep.worst) rep.worst = Math.round(d);
              rep.pages[pg] = (rep.pages[pg] || 0) + 1;
              // #818 最慢帧现场 top3（掉帧本就低频，push+排序开销可忽略）
              scene.push({ at: Math.round((now - t0) / 100) / 10, ms: Math.round(d), pg: pg, kb: kb ? 1 : 0, sw: (now - swAt) <= 500 ? 1 : 0 });
              if (scene.length > 3) { scene.sort(function (a, b) { return b.ms - a.ms; }); scene.length = 3; }
            }
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
    // #770：结论说真话——「未捕获掉帧」只在真一帧没掉时说
    var concl;
    if (r.verdict === '流畅') concl = r.janky > 0 ? '（掉帧率 ' + r.jankPct + '%，可忽略）' : '（本窗口未捕获掉帧）';
    else concl = '（掉帧率 ' + r.jankPct + '%）';
    L.push('结论：' + r.verdict + concl);
    var per = r.period > 0 ? '，正常帧间隔约 ' + r.period + 'ms' : '';
    L.push('采样 ' + Math.round(r.ms / 1000) + ' 秒 / 有效帧 ' + r.frames + '（平均 ' + r.fps + 'fps' + per + '；已剔除后台/锁屏冻结 ' + r.hid + ' 帧）');
    if (r.lp) L.push('· 实测刷新周期约 ' + r.period + 'ms（≈30fps 档）：iOS 低电量模式会把帧率减半，属系统行为——开了低电量请关闭后复测对照');
    // #770：采样期间页面分布——帮读「掉帧集中」（该页采了多少帧才有可比性）
    var majors = [];
    for (var pk in r.pageFrames) { if (pk !== '?' && r.pageFrames[pk] > 0) majors.push([pk, r.pageFrames[pk]]); }
    majors.sort(function (a, b) { return b[1] - a[1]; });
    var mtxt = majors.slice(0, 2).map(function (m) { return pageName(m[0]) + ' ' + pct(m[1], r.frames) + '%'; }).join('、');
    if (mtxt) L.push('· 采样期间主要在：' + mtxt);
    if (r.frames < 120) L.push('· 有效样本偏少（可能大部分时间在后台），建议亮屏状态下重测');
    if (r.janky > 0) {
      L.push('· 掉帧 ' + r.janky + ' 帧（间隔>' + r.jankMs + 'ms），其中严重 ' + r.severe + ' 帧（>100ms），最慢一帧 ' + r.worst + 'ms');
      if (concOk(r)) {
        L.push('· 掉帧集中：' + pageName(r.topPage) + '（掉帧 ' + r.pages[r.topPage] + '/' + (r.pageFrames[r.topPage] || 0) + ' 帧，该页 ' + pct(r.pages[r.topPage], r.pageFrames[r.topPage]) + '% vs 全窗 ' + r.jankPct + '%）');
      }
      if (r.kbJanky > 0) L.push('· 其中键盘弹出期 ' + r.kbJanky + ' 帧（键盘期视口变形 iOS 上常见；收起键盘对照可分辨）');
      if (r.scene && r.scene.length) {
        var ss = [];
        for (var i2 = 0; i2 < r.scene.length; i2++) {
          var sc = r.scene[i2];
          ss.push('第' + sc.at + '秒 ' + pageName(sc.pg) + ' ' + sc.ms + 'ms' + (sc.kb ? '·键盘期' : '') + (sc.sw ? '·切页后' : ''));
        }
        L.push('· 最慢帧现场：' + ss.join('；') + '（「切页后」＝紧跟页面切换 0.5s 内，多为打开该页的一次性渲染成本）');
      }
    }
    if (r.lt) {
      L.push(r.lt.n > 0 ? '· 长任务（>50ms 主线程阻塞）窗口内 ' + r.lt.n + ' 次，最长 ' + r.lt.worst + 'ms' : '· 长任务（>50ms）：窗口内无');
    } else {
      L.push('· 长任务：此内核不支持观测（iOS WebKit），已用帧间隔等效判定');
    }
    if (r.int) {
      L.push('· 点按响应：采样 ' + r.int.n + ' 次，中位 ' + r.int.med + 'ms、最慢 ' + r.int.worst + 'ms（最慢在' + pageName(r.int.worstPg) + '）' + (r.int.slow > 0 ? '；' + r.int.slow + ' 次超过 100ms＝「点了隔一下才动」体感的直接来源' : ''));
    }
    if (r.storage) {
      L.push('· 本地数据画像：字卡库 ' + r.storage.libs + ' 个作用域 约 ' + r.storage.mb + ' MB（' + (r.storage.level === '重' ? '较重' : r.storage.level === '中' ? '中度' : '轻量') + '）');
    }
    L.push('');
    L.push('建议：');
    var adv = [];
    if (r.storage && r.storage.level === '重') adv.push('本地数据过大（字卡库等）是本应用最常见的间歇卡顿主因——先做旁边「卡顿自检 · 一键优化」（不删数据）');
    if (r.janky === 0) adv.push('本窗口未捕获掉帧；若体感仍卡，在卡顿出现的当下立即复测，更容易抓到现场');
    else if (r.verdict === '流畅') adv.push('仅零星掉帧（' + r.janky + ' 帧、最慢 ' + r.worst + 'ms），属正常波动，无需处理');
    if (concOk(r)) adv.push('掉帧集中在「' + pageName(r.topPage) + '」——该页操作时最明显，可对照排查最近往该页存过的大图/长内容');
    if (r.int && r.int.slow > 0) adv.push('点按响应最慢 ' + r.int.worst + 'ms（在「' + pageName(r.int.worstPg) + '」）：掉帧集中在操作瞬间，优先排查该页的大图/长列表/数据落盘时机');
    if (r.lp && r.verdict === '流畅') adv.push('本机在约 30fps 档运行＝iOS 低电量模式减半帧率（系统行为），关闭低电量模式即可恢复，无需其他处理');
    if (r.kbJanky > 0 && r.kbPct >= 30) adv.push('掉帧多发生在键盘弹出期（iOS 视口变形属系统行为）：收起键盘复测对照，若明显好转则无需处理');
    if (r.verdict !== '流畅' && (!r.storage || r.storage.level !== '重')) adv.push('可按 设置→「手机卡顿说明」的顺序清一遍存量（先「查看存储」看哪项最大）；别用「清除本地数据」治卡顿');
    if (!adv.length) adv.push('保持现状即可');
    adv.forEach(function (a, i) { L.push((i + 1) + '. ' + a); });
    L.push('');
    L.push('（采样只在本机进行、不上传任何数据；掉帧＝帧间隔>' + r.jankMs + 'ms ≈ 2 倍实测刷新周期，后台/锁屏冻结帧已剔除）');
    return L.join('\n');
  }

  window.mochiPerfCheck = {
    start: start,
    running: function () { return _running; },
    LAST_KEY: LAST_KEY
  };
})();
