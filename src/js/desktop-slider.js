// ===== 功能：桌面左右滑动翻页（scroll-snap 原生滚动） =====
// 支持触摸/鼠标横向拖动（原生滚动），指示器圆点点击切换
// v3.6.x：支持动态页数——新增/删除桌面页后由 personalize.js 调用 deskRebuild()
// 重建圆点与索引，无需刷新页面
// v3.27.x（#580）：圆点改为「滚动中每帧跟随」。用户反馈「切换 1/2/3 桌面页时，
// 底部导航圆点反应慢，没有与滑动完全同步」——原实现在 scroll 里
// clearTimeout + setTimeout(sync, 120)，每次滚动事件都把同步推迟到 120ms 后，
// 滚动全程圆点被冻结、松手吸附结束后才跳一次（实测滞后 127ms），再加上圆点
// 变形动画 250ms，合计约 0.4s 的滞后感。
// ⚠️ 性能红线（用户要求：安卓 / iOS 都不能卡）——本文件从此跑在滚动的每一帧上：
//   ① rAF 节流：一帧最多算一次，索引没变不碰 DOM；
//   ② 每帧零 DOM 查询、零样式读取——页步长(gap) 与圆点数组缓存在增删页/resize 时
//      重算（refreshCache），每帧只剩 scrollLeft / clientWidth 两个布局读 + 一次取整；
//   ③ 不引入 smooth 滚动、不读写会触发布局的样式属性，只切 class。
(function () {
  const pages = document.getElementById('desktop-pages');
  if (!pages) return;

  // 动态查询（新增/删除页后结构变化，不能缓存 NodeList）
  function getSlides() { return Array.prototype.slice.call(pages.querySelectorAll('.page-slide')); }
  function getDots() { return Array.prototype.slice.call(document.querySelectorAll('#desktop-dots .dot')); }

  let idx = 0;

  // v3.27.x（#580）：每帧跟随用的缓存——防卡顿的关键。
  // 跟随改为每帧执行后，若每帧都 querySelectorAll + getComputedStyle，等于把滚动帧
  // 的预算花在查询上（安卓低端机必掉帧）。两者只在「增/删页」「resize」时失效重算。
  let dotsCache = [];
  let gapCache = null;

  function refreshCache() {
    dotsCache = getDots();
    gapCache = null;
  }

  // v3.6.x：页间有 gap 缝隙，每页滚动步长 = clientWidth + gap
  // gap 是 CSS 固定值（.desktop-pages 的 flex gap），不随布局变化，但元素
  // display:none 时 getComputedStyle 仍返回 CSS 值，可安全读取
  function pageStep() {
    if (gapCache === null) gapCache = parseFloat(getComputedStyle(pages).columnGap) || 0;
    return pages.clientWidth + gapCache;
  }

  // 只切 class，不读任何样式（每帧只走到这里，见 syncFrame）
  function paint(cur) {
    if (cur === idx) return;
    idx = cur;
    for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
  }

  // 按当前 scrollLeft 校正圆点（松手吸附后、旋转、外部重建时调用）
  function sync() {
    // v3.5.132：隐藏时跳过（防抖窗口内切页 → clientWidth=0 → idx 写坏、圆点全灭）
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
    // v3.5.132：页面隐藏（display:none）时 clientWidth=0，直接赋值会产生 Infinity 下标
    if (!pages.clientWidth) return;
    // 直接赋值 scrollLeft 立即切换（scroll-snap 会自动吸附），避免 smooth 滚动被 snap 打断
    pages.scrollLeft = idx * pageStep();
    for (let k = 0; k < dotsCache.length; k++) dotsCache[k].classList.toggle('active', k === idx);
  }

  // ===== v3.27.x（#690）：翻页帧耗时现场采样 =====
  // 背景：用户报「桌面三页滑动灰屏/卡顿/手机发烫（iOS 多机型同现）」，而无头内核
  // （无 GPU 的 WebKit/Blink）复现不出真机的图层栅格化与显存压力——诊断里那句
  // 「实测帧率≈61 fps」是**打开诊断那一刻**的静态值，跟翻页现场无关，于是每次
  // 报障都只能猜。这里补上唯一可信的读数来源：用户自己翻页的那一秒。
  // 约束（本文件性能红线不变，见文件头）：
  //   ① 只在翻页进行中采，采满 PERF_FRAMES 帧（≈1 秒）即停——空闲/静止页零开销；
  //   ② 每帧只做 performance.now() 相减 + 数组 push，不查 DOM、不读样式；
  //   ③ 收尾也只跑一次：写一个全局小键（同 mobile-adapt 的 __diag-stuck 做法），
  //      设置→诊断【性能】段读出。同一秒内不重复起采（perfOn 闸）。
  const PERF_KEY = 'xy-home-v2:__diag-deskperf';
  const PERF_FRAMES = 60;
  let perfOn = false;
  function perfSample() {
    if (perfOn) return;
    perfOn = true;
    const gaps = [];
    let last = 0;
    // FIX 2026-09-17 #707：切后台/锁屏期间 rAF 冻结（或部分内核降到 1fps），恢复后的
    // 第一帧会量出「整段后台时长」的巨帧——真机实测 60 帧样本里混进一条 144s 后台
    // 间隙，把「平均 2543ms」整行拉成严重卡顿（p90 才是真实水平），报障判读被带偏。
    // 现改为：隐藏帧只重置基线不记样本，恢复后重采；剔除条数随 hid 字段落键，
    // 诊断【性能】一节据此标注「已剔除后台帧 N」。
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

  // ===== #989 桌面页竖向滚动护栏（用户实报「桌面的第一页和第二页的图标按钮和文字没有完全
  // 对齐，第二页和第三页是完全对齐的」，随后追报「第三页也没有对齐了」＝错位会换页出现）=====
  // 现象/根因（无头实证，零机型分支）：桌面页内容高 636px（含页底 18px 留白 + 图标组尾部
  // 6+8px），而浏览器模式（非全屏，地址栏占高）下桌面区只有 ~610px ⇒ 每页都成了**可竖向
  // 滚动容器**，而超出的那 26px **全是不可见尾垫**（标签下沿之上再没有别的内容，滚下去
  // 什么也看不到）。于是：①翻页时手指的斜滑被内核轴锁判成竖向 ⇒ 滚动量落在「起手那一页」
  // 上（起手页常是第一页，故症状先在 1/2 页间出现；用户在第三页起手翻页后第三页也错开）；
  // ②滚动量没有任何东西复位，永久留在那一页 ⇒ 该页图标+文字整块上移几像素，与另两页错开
  //（无头实证：第一页 scrollTop=20 ⇒ 行 y 427.3/537.3 vs 另两页 447.3/557.3，Δ=20 精确等于
  // 残留滚动量）。旧验证全跑 390×844（桌面区 714 > 内容 636）⇒ 桌面页根本不可滚，本 bug 在
  // 验证里结构性不可见，所以「每次都验 Δ=0、用户每次依旧错位」。
  // 修法（纯判据，无机型/无 UA 分支）：只要**翻下去看不到任何东西**（溢出全部来自容器自身的
  // 内边距/外边距——实测该页 scrollHeight 636 vs clientHeight 610，而最深「实心盒」下沿只有
  // 604），该页就设 overflow-y:hidden 并把 scrollTop 归零：被裁掉的是不可见留白，零视觉变化，
  // 而该页从此不可能再被斜滑/内核几何风暴顶出滚动量；**真溢出**（用户往页里加了组件、或桌面
  // 区矮到标签都放不下）时保持 auto 照旧可滚，绝不吞掉用户真正要看的内容。任何滚动（含斜滑）
  // 落定后复核一次，残留滚动量最迟 300ms 内自愈。
  const pageScrollGuard = (function () {
    // 页内最深「实心盒」下沿（相对页顶）＝真正看得见的内容底：
    // 只取没有子元素的叶子盒（容器的 padding 不是内容），跳过隐藏项与绝对/固定定位装饰
    // （角标 .app-badge、连击 .we-combo 这类负偏移装饰不参与，免得把「没内容」误判成「有内容」）
    function inkBottom(sl, pageTop) {
      const stopAt = sl.clientHeight + 1; // 与调用方那句比较共用同一阈值，早退才等价
      let maxB = 0;
      const all = sl.querySelectorAll('*');
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el.firstElementChild) continue;
        const r = el.getBoundingClientRect();
        const b = r.bottom - pageTop;
        if (r.height <= 0 || b <= maxB) continue;
        const c = getComputedStyle(el);
        if (c.display === 'none' || c.visibility === 'hidden') continue;
        if (c.position === 'absolute' || c.position === 'fixed') continue;
        maxB = b;
        if (maxB > stopAt) return maxB; // 已经证明「有看得见的内容越过可视底」＝不用再扫
      }
      return maxB;
    }
    // FIX 2026-09-24 #1201（iPhone 17 / iOS 26.4 实报「切页面、滑动时最卡」，perfcheck：桌面翻页
    //   平均 91ms·最慢 1513ms、切回桌面 p90 702ms）：这条护栏挂在桌面每一次「滚动落定 / 切回桌面 /
    //   回前台」上，旧写法每次都要把三页子树整个走一遍（默认小桌面实测一次 run＝380 次
    //   getComputedStyle ＋ 356 次 getBoundingClientRect；用户桌面越满越贵）。而它要的结论只随
    //   **该页自身几何**变化——scrollHeight 与 clientHeight 都不变，溢出量和「内容有没有越过可视底」
    //   就不变。于是按页记忆化裁决：几何没变＝照抄上次结论、不碰子树；组件增删/图标注入/图片解码
    //   完成/restore/resize 这些**内容真的到位**的触发点带 force 强制重扫（见下方接线）。
    //   #989（残留滚动量复位）与 #1013（真溢出一律可滚）的判据一字未动。
    const verdicts = new WeakMap();
    let timer = null, retries = 0;
    function later(ms, force) { clearTimeout(timer); timer = setTimeout(function () { run(force); }, ms); }
    function run(force) {
      const slides = getSlides();
      let skipped = false;
      for (let i = 0; i < slides.length; i++) {
        const sl = slides[i];
        // 桌面页整体隐藏（切到聊天/设置）时 clientHeight=0；开屏期 .phone 被 visibility:hidden
        // 盖住时页内每个盒子都算「不可见」＝量出来的 inkBottom 恒 0，会被误判成「翻下去什么也
        // 看不到」而错误裁掉真溢出——两种都跳过（读数何时可得见下方的有界重试）。
        if (!sl.clientHeight || getComputedStyle(sl).visibility === 'hidden') { skipped = true; continue; }
        const sh = sl.scrollHeight, ch = sl.clientHeight, over = sh - ch;
        const seen = verdicts.get(sl);
        let blind;
        if (!force && seen && seen.sh === sh && seen.ch === ch) {
          blind = seen.blind; // 几何没变＝裁决没变，省掉整棵子树
        } else {
          // #960 取证口径：只有真扫了子树才打点——下份 perfcheck 里「desk-guard ×N」的 N
          // 就是全量遍历次数，能直接分辨「护栏还在咬人」与「不是它」。
          try { if (window.__mochiPhase) window.__mochiPhase('desk-guard'); } catch (e0) {}
          // FIX 2026-09-22 #1013（回拉）：基准必须是**未滚动**的内容坐标——pageTop 减掉 scrollTop，
          // 否则页滚到越靠下、量到的「最深实心盒下沿」越浅（每个盒子都被整体上移了 scrollTop），
          // 真溢出页滚到底时必然落进 ch+1 以内＝误判成「翻下去什么也看不到」→ 归零滚动量。
          // 用户所见＝「在桌面滑动屏幕会回拉，无法滑到下面」（vivo S30/Edge 实报，同族多机型）。
          blind = over > 0 && inkBottom(sl, sl.getBoundingClientRect().top - sl.scrollTop) <= sl.clientHeight + 1;
          verdicts.set(sl, { sh: sh, ch: ch, blind: blind });
        }
        if (blind) {
          if (sl.style.overflowY !== 'hidden') sl.style.overflowY = 'hidden';
          if (sl.scrollTop) sl.scrollTop = 0;
        } else {
          if (sl.style.overflowY) sl.style.overflowY = '';   // 回落到 CSS 的 auto
          if (over <= 0 && sl.scrollTop) sl.scrollTop = 0;
        }
      }
      // 开屏收起那一刻不派发任何事件（开屏是 #desktop-pages 的兄弟节点，MutationObserver 收不到），
      // 而开屏在位期间整页不可见、量不出读数 ⇒ 量不到就自己重试，最多 8 次（≈6.4s，覆盖各设备
      // 开屏快慢），一旦拿到读数即停；真读得到时把计数清零，供下一次开屏/隐藏复用。
      if (skipped && retries < 8) { retries++; later(800); } else if (!skipped) retries = 0;
    }
    return { run: run, later: later };
  })();
  pageScrollGuard.run(true);
  // 页自身的竖向滚动事件不冒泡，捕获相才能收到（外层 #desktop-pages 的横向翻页不受影响）
  pages.addEventListener('scroll', () => pageScrollGuard.later(300), true);
  // FIX 2026-09-22 #1013（锁死）：护栏按「当下量到的几何」裁决，而桌面图片组件
  // （.desk-image-widget img 是 width:100% / height:auto）在解码完成前高 0px——那一拍整页
  // 「翻下去什么也看不到」成立 ⇒ 被设成 overflow-y:hidden；图片随后撑开真溢出，可 load 既不改
  // #desktop-pages 的子节点（上面那个 MutationObserver 只收 childList）也不派 scroll ⇒ 没人复核，
  // 该页就永久停在「有内容在下方却滚不动」＝用户说的「无法滑到下面」。资源 load 同样不冒泡，走捕获相。
  pages.addEventListener('load', () => pageScrollGuard.later(400), true);
  window.addEventListener('resize', () => pageScrollGuard.later(120, true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pageScrollGuard.later(80); });
  // 组件增删/图标注入/切桌面重建都会动 DOM，统一在这里复核（拖动组件期间每帧多次也只在停手后跑一次）
  try {
    new MutationObserver(() => pageScrollGuard.later(400, true)).observe(pages, { childList: true, subtree: true });
  } catch (e) {}
  // 开屏消失/数据回填/图标注入都不动 #desktop-pages 的子节点（开屏是它的兄弟），补两个启动期
  // 复核点：数据就绪事件 + 两次定时（开屏收起后各设备快慢不一，早跑那次会因整页不可见被跳过）
  try { document.addEventListener('mochi-restore-done', () => pageScrollGuard.later(400, true)); } catch (e) {}
  pageScrollGuard.later(900, true);
  setTimeout(() => pageScrollGuard.run(true), 2600);

  // ===== #884：切回桌面帧耗时现场采样 =====
  // 用户主诉「聊天返回主页面卡、主页面切换卡」（iPhone 15 Pro / 16 Pro 实报，iOS 18.7 PWA），
  // 而诊断里「实测帧率」是静态页读数、「桌面翻页帧耗时」只采左右滑——切页现场没尺子。
  // 本采样器在 page-phone 从隐藏变可见那一刻起采 30 帧（≈0.5s，覆盖切页布局+栅格化窗口），
  // 写 xy-home-v2:__diag-swperf，device.js 诊断【性能】段读出。约束同 #690：只在切页瞬间
  // 采、采满即停；每帧只做 now 相减 + push；同一次隐藏→可见只起采一回（swOn 闸）；
  // 后台冻结帧只重置基线不记样本（#707 同款）。
  const SW_KEY = 'xy-home-v2:__diag-swperf';
  const SW_FRAMES = 30;
  function swSample() {
    if (swOn) return;
    // FIX 2026-09-20 #943e：自动采样限频——原实现每次从聊天/设置切回桌面都开一轮 30 帧
    // rAF 循环，恰在回桌面/翻页的卡顿敏感窗口自我加压（采的正是自己扰动的帧）。限到
    // 5 分钟一次；设置→性能检测的手动 perfcheck 走 perf-check.js 独立通道，不受影响。
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

  // v3.27.x（#580）：滚动中每帧跟随——手指滑到哪，圆点跟到哪（原来只在松手后 120ms 才动）
  let rafId = 0;
  let settleTimer = null;
  let swipeBlurTimer = null; // #976：滑页暂停壁纸模糊的收尾计时
  function syncFrame() {
    rafId = 0;
    sync();
  }  pages.addEventListener('scroll', () => {
    if (!rafId) rafId = requestAnimationFrame(syncFrame);
    perfSample(); // #690：翻页现场记一段帧耗时（静止时不跑）
    // #976：滑页期间挂 desk-swiping（暂停壁纸全屏模糊，见 home.css 注释），停下 150ms 后摘
    try {
      document.documentElement.classList.add('desk-swiping');
      clearTimeout(swipeBlurTimer);
      swipeBlurTimer = setTimeout(function () { document.documentElement.classList.remove('desk-swiping'); }, 150);
    } catch (e0) {}
    // 吸附/回弹终点再校一次：末次 scroll 事件与 snap 终点可能差一帧亚像素；
    // 对不派 rAF 的内核（后台标签页/被节流）也是兜底。跟随本身由上面的 rAF 负责。
    clearTimeout(settleTimer);
    settleTimer = setTimeout(sync, 80);
  }, { passive: true });

  // 圆点点击切换：事件委托（v3.6.x：圆点是动态重建的，不能直接绑每颗）
  document.getElementById('desktop-dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.dot');
    if (!dot) return;
    go(getDots().indexOf(dot));
  });

  // v3.5.132：旋转后按新宽度重设 scrollLeft（否则停在 1.x 页位置，圆点与内容不符）
  window.addEventListener('resize', () => {
    refreshCache(); // 视口变了重算 gap 缓存（clientWidth 每帧现读，无需缓存）
    if (pages.clientWidth) pages.scrollLeft = idx * pageStep();
  });

  // v3.6.x：桌面页隐藏时（切到聊天/设置等）旋转，resize 里 clientWidth=0 会跳过——
  // 返回桌面时按新宽度重设一次，避免 scrollLeft 停在两页之间、圆点与内容错位
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

  // v3.6.x：外部（新增/删除桌面页后）调用，重建圆点数量 + 校正当前索引
  // v3.27.x（#140）：页数钳到实际 slide 数——deskRebuild 可能在 buildDeskPages
  // 删页完成前被触发（回填重放/恢复默认竞态），此时 idx 可能 ≥ slides.length；
  // 旧实现把 scrollLeft 设到超界页位（Chrome 上 snap 到空白区，视觉=当前页空白、
  // 卡片全部「不显示」）。钳制后圆点/索引与实际页数一致。
  window.deskRebuild = function () {
    const slides = getSlides();
    idx = Math.max(0, Math.min(Math.max(slides.length - 1, 0), idx));
    // 重建圆点
    const dotsBox = document.getElementById('desktop-dots');
    if (dotsBox) {
      dotsBox.innerHTML = '';
      for (let i = 0; i < slides.length; i++) {
        const d = document.createElement('span');
        d.className = 'dot' + (i === idx ? ' active' : '');
        dotsBox.appendChild(d);
      }
    }
    // 圆点已重建：缓存必须换成新节点（旧节点已脱离文档，继续改等于改了个空）
    refreshCache();
    if (pages.clientWidth) {
      pages.scrollLeft = idx * pageStep();
      sync();
    }
  };

  refreshCache();
  sync();

  // v3.x：暴露给桌面长按拖拽（跨页翻页 + 当前页索引）
  window.deskGo = go;
  window.deskIdx = function () { return idx; };
})();
