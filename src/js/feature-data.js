// ===== 功能：各功能数据 单独导出 / 导入 / 清空（v3.27.x） =====
// 需求（用户 2026-09-17）：桌面上每个功能都要能「单独导出数据 / 导入数据 / 清空数据」，
// 原来只有聊天、朋友圈、信箱三处零散实现（chat-settings.js 的 cs-export-msgs 三行、
// feed.js 的 feed-clear-all、mail.js 的 mailExportData/mailImportFile/mailClearAll），
// 其余功能（花园/房间/记账/经期/占卜/音乐/小游戏…）用户只能整库备份，不能只搬一个功能。
//
// 做法：本文件集中登记「功能 → 存储键范围」，一套通用引擎对任意功能做导出/导入/清空，
// 不逐个改各功能源码（避免 38 个功能文件各写一套 + 各功能的 store 边界漂移）。
//   · 键空间解析：全站键只有三种形态——xy-home-v2:<后缀>（全局/默认桌面旧顶层键）、
//     xy-home-v2:<cid>:<后缀>（联系人独立命名空间）、以及归属某个功能的动态后缀
//     （cal-2026-09-17 / memo-2026-09-17 / music-file:<id> 等）。
//   · 作用域 scope：desk＝只碰当前桌面（清空花园不影响另一个桌面）、global＝全局键
//     （所有桌面共用，如音乐/抉择）、both＝两类键都算该功能的数据。
//   · 清空只删「本功能匹配到的键」，绝不碰媒体池 xy-home-v2:media:<hash>（跨功能共享，
//     消息/动态里的 @@m: 令牌都指向它）与字体包 font-blob-<hash>（各桌面引用同一份）。
//   · 导出按内容寻址带上值里引用到的媒体池条目（@@m: 令牌），导入时回写——否则换机后
//     图片/语音全空。清空永不删池子，避免「清空备忘录把聊天图片一起删了」。
//   · 导入/清空后强制 reload：各功能的 store 有一层内存缓存（xyStore 的 memoryCache）
//     与 IDB 回填时序，就地改内存无法覆盖全部模块（chat.js/feed.js 各有内存真相），
//     重载是唯一能保证「界面与落盘一致」的收口方式。
(function () {
  var G = 'xy-home-v2';
  var CID_RE = /^(default|c[0-9a-z]{5,}):(.*)$/; // 联系人 id 生成见 contacts.js：'c' + base36 时间戳 + 随机
  var MEDIA_RE = /@@m:([0-9a-f]{32})/g;
  var MEDIA_PREFIX = 'media:';
  var BLOB_PREFIX = 'font-blob-'; // 上传字体包：全局唯一存储 + 各桌面引用，不属于任何单功能

  // ---- 键空间解析：full → {cid, suffix}；cid === null 表示「顶层键」（全局键或默认桌面旧键位） ----
  function parseKey(full) {
    if (typeof full !== 'string' || full.indexOf(G + ':') !== 0) return null;
    var rest = full.slice(G.length + 1);
    if (!rest) return null;
    var m = CID_RE.exec(rest);
    if (m) return { cid: m[1], suffix: m[2], full: full };
    return { cid: null, suffix: rest, full: full };
  }
  // 命名空间前缀（写/删都经它，见 idb.js xyStore：同时管内存缓存 + LS + IDB 三层）
  function nsOf(cid) { return cid === null ? G : G + ':' + cid; }

  function curCid() {
    try { var c = window.__activeCid; if (c) return c; } catch (e) {}
    return 'default';
  }

  // ================= 功能登记表 =================
  // scope：'desk' 当前桌面 / 'global' 全局共用 / 'both' 两类都含
  // res：后缀正则（匹配 parseKey 后的 suffix，不含命名空间）
  // page：该功能自己的页面 id（#679 各功能页内直达入口；跨域声明见 WORKLOG——
  //       只读各功能 template/JS 已有的静态 id，不改任何归属文件）
  var FEATURES = [
    { id: 'chat', name: '聊天', group: '聊天与社交', scope: 'desk', page: 'page-chat', btns: 'cs-export-msgs,cs-import-msgs,cs-clear-msgs',
      desc: '聊天记录、聊天设置（气泡/字号/时间轴/输入栏）、表情包与文字库、拍一拍、红包、引用',
      res: [/^chat-/, /^cs-(?!avatar-|lbl-)/, /^rp-cover-/, /^rp-wallet$/, /^emoji-last$/, /^my-emoji-groups$/, /^my-text-groups$/, /^my-invite-groups$/, /^mye-global-migrated$/, /^hide-tab-/, /^hide-ta-sticker$/, /^invite-ask-history$/, /^poke-/, /^rps-score$/, /^scroll-anchor-auto$/, /^sysmsg-nick-/, /^more-tab$/, /^more-cat$/, /^mail-emoji-mode$/, /^qixi-today$/] },
    { id: 'gc', name: '群聊', group: '聊天与社交', scope: 'desk', page: 'page-group-chat',
      desc: '群聊记录、群分组、群成员资料、群聊美化与设置',
      res: [/^gc-/, /^group-chat-msgs$/] },
    { id: 'cards', name: '字卡库与回复设置', group: '聊天与社交', scope: 'desk', page: 'page-custom-cards', btns: 'cc-export,cc-import-data,cc-clear-all',
      desc: '自定义/公用/默认字卡、词典、TA 回复字卡、各类概率与开关（回复设置）',
      res: [/^cc-/, /^quote-cards/, /^reply-/, /^dc-/, /^dcf-/, /^dict-/, /^rcard-/, /^tm-/, /^rps-/] },
    { id: 'fav', name: '收藏', group: '聊天与社交', scope: 'desk', page: 'page-fav',
      desc: '我收藏的消息/字卡/图片与 TA 的收藏',
      res: [/^fav-msgs$/, /^fav-img-/, /^fav-media-/, /^fav-settings/] },
    { id: 'identity', name: '昵称与头像', group: '聊天与社交', scope: 'desk',
      desc: '双方当前昵称、头像、聊天页昵称与头像（各功能显示处共用这份资料）',
      res: [/^lbl-user$/, /^lbl-partner$/, /^cs-lbl-/, /^avatar-user$/, /^avatar-partner$/, /^cs-avatar-/, /^records-avatar$/] },
    { id: 'interact', name: '头像和昵称互动', group: '聊天与社交', scope: 'desk', page: 'page-interact',
      desc: '头像库/昵称库与其自动更换进度、开关',
      res: [/^avatar-lib/, /^avatar-me-lib/, /^nick-lib/] },
    { id: 'mail', name: '信箱', group: '聊天与社交', scope: 'desk', page: 'page-mail', btns: 'mail-export,mail-import,mail-clear',
      desc: '收信/寄信/回信、待回信计划、信箱设置（含每周摸鱼小结）',
      res: [/^mail-/, /^ml-/] },
    { id: 'feed', name: '朋友圈', group: '聊天与社交', scope: 'both', page: 'page-feed', btns: 'feed-clear-all',
      desc: '全部动态、评论点赞、通知提醒、封面与昵称头像',
      res: [/^feed-/] },
    { id: 'ask', name: 'TA 的提问与问卷', group: '聊天与社交', scope: 'desk', page: 'page-ta-ask',
      desc: 'TA 的提问/选择题/好奇/吐槽、问卷作答记录、询问提醒时间',
      res: [/^ta-ask$/, /^ta-survey$/, /^ta-choose$/, /^ta-curious$/, /^ta-roast$/, /^ta-cc-state$/, /^ta-checkin$/, /^interact-card-last$/, /^ta-chime:/] },
    { id: 'requests', name: '跨桌面查岗 / 来电开关', group: '聊天与社交', scope: 'global',
      desc: '跨桌面查岗开关与频率、跨桌面来电、夜间静默模式、待处理请求',
      res: [/^incoming-requests$/, /^desk-checkin-en$/, /^desk-call-en$/, /^desk-freq-mode$/, /^desk-msg-en$/, /^night-mode-en$/] },

    { id: 'calendar', name: '日历与每日留言', group: '桌面功能', scope: 'desk', page: 'page-calendar',
      desc: '每日留言、心情与语录历史、恋爱开始日、首次使用日、日历标注',
      res: [/^cal-/, /^memo-(?!app)/, /^mood-history$/, /^quote-history$/, /^today-mood-/, /^first-use-date$/, /^love-start$/] },
    { id: 'records', name: '纪念与统计', group: '桌面功能', scope: 'desk', page: 'page-home',
      desc: '纪念日、通话记录、关心/摸鱼收获等纪念页数据',
      res: [/^records-(?!coin)/] },
    { id: 'divination', name: '占卜', group: '桌面功能', scope: 'desk', page: 'page-divine',
      desc: '占卜历史、自定义牌面与图鉴、牌面编号开关',
      res: [/^divine-/, /^divf-/] },
    { id: 'music', name: '音乐', group: '桌面功能', scope: 'global', page: 'page-music',
      desc: '本地上传的音乐文件、歌单、收藏、播放顺序与播放记录',
      res: [/^music-/] },
    { id: 'fish', name: '摸鱼与上班天数', group: '桌面功能', scope: 'both',
      desc: '摸鱼累计天数、上班打卡天数、双方各自的摸鱼记录',
      res: [/^fish-/, /^work-/, /^day-fish/, /^day-work/, /^weekend-fish/] },
    { id: 'tongpin', name: '同频', group: '桌面功能', scope: 'desk', page: 'page-tongpin',
      desc: '同频状态与发送记录',
      res: [/^tongpin-/] },
    { id: 'shenshou', name: '伸手', group: '桌面功能', scope: 'desk', page: 'page-shenshou',
      desc: '伸手次数、上次伸手时间与字卡',
      res: [/^shenshou-/] },
    { id: 'water', name: '喝水', group: '桌面功能', scope: 'desk', page: 'page-water',
      desc: '喝水目标与历史、连续天数、提醒语',
      res: [/^water-/] },
    { id: 'eat', name: '吃什么', group: '桌面功能', scope: 'desk', page: 'page-eat',
      desc: '菜单、抽取历史与提醒开关',
      res: [/^eat-/] },
    { id: 'piggy', name: '存钱罐', group: '桌面功能', scope: 'desk', page: 'page-piggy',
      desc: '存钱目标与流水、心意币两套罐子、来访记录',
      res: [/^piggy-/] },
    { id: 'pomo', name: '番茄钟', group: '桌面功能', scope: 'desk', page: 'page-pomodoro',
      desc: '番茄钟设置、累计次数与今日进度、陪伴记录',
      res: [/^pomo-/] },
    { id: 'checkin', name: '打卡与查岗记录', group: '桌面功能', scope: 'desk', page: 'page-checkin',
      desc: '打卡记录与历史、查岗卡片状态、连续天数',
      res: [/^checkin-/, /^ck-/, /^ck-off-/] },
    { id: 'loc', name: '定位', group: '桌面功能', scope: 'desk', page: 'page-loc-cards',
      desc: '定位历史、气泡与特效开关、自动定位、定位组合',
      res: [/^loc-/, /^loc-auto/, /^loc-sense/] },
    { id: 'garden', name: '花园', group: '桌面功能', scope: 'desk', page: 'page-garden',
      desc: '种下的花与生长进度、收获记录',
      res: [/^garden-/] },
    { id: 'cjian', name: '此间与梦角档案', group: '桌面功能', scope: 'both', page: 'page-cjian',
      desc: '此间状态与换家标记、成员名册、梦角档案（含时辰区间）',
      res: [/^cjian-/, /^narc-/] },
    { id: 'myarc', name: '我的档案', group: '桌面功能', scope: 'desk', page: 'page-my-arc',
      desc: '我的档案资料与共享给 TA 的部分',
      res: [/^myarc/] },
    { id: 'room', name: '房间', group: '桌面功能', scope: 'desk', page: 'page-room',
      desc: '房间摆放与装修、家具位置',
      res: [/^room-/] },
    { id: 'drift', name: '漂流瓶', group: '桌面功能', scope: 'desk', page: 'page-drift',
      desc: '我扔出/收到的漂流瓶与回复',
      res: [/^drift-/] },
    { id: 'memo', name: '备忘录', group: '桌面功能', scope: 'desk', page: 'page-memo',
      desc: '备忘录条目、发送记录、全局迁移标记',
      res: [/^memo-app-/] },
    { id: 'period', name: '经期记录', group: '桌面功能', scope: 'both', page: 'page-period',
      desc: '经期记录与预测、每日状态、关心语与提醒设置',
      res: [/^period-/] },
    { id: 'accounting', name: '记账', group: '桌面功能', scope: 'desk', page: 'page-accounting',
      desc: '账目记录、分类、预算与心意币记录',
      res: [/^accounting-/, /^records-coin/] },
    { id: 'gift', name: '礼物与集市', group: '桌面功能', scope: 'both', page: 'page-market',
      desc: '礼物盒、集市商品与自定义、钱包与心愿单、每日购买额度',
      res: [/^gift-/, /^market-/, /^giftbox-items$/, /^ml2_/, /^rp-wallet$/, /^wl-/, /^gift-wishlist/] },
    { id: 'decision', name: '抉择', group: '桌面功能', scope: 'global',
      desc: '抉择历史与设置（全局，所有桌面共用）',
      res: [/^decision-/, /^dec-/] },
    { id: 'gdec', name: '群抉择', group: '桌面功能', scope: 'global',
      desc: '群抉择历史、成员与设置（全局，所有桌面共用）',
      res: [/^gdec-/] },
    { id: 'mood', name: '心情日记', group: '桌面功能', scope: 'desk', page: 'page-mood',
      desc: '心情日记条目与记录',
      res: [/^mood-diary$/] },
    { id: 'games', name: '小游戏', group: '桌面功能', scope: 'desk',
      desc: '各小游戏的音效/动画开关与进行中的局面标记',
      res: [/^snake-/, /^snk-/, /^brick-/, /^c4-/, /^ms-(?!g-)/, /^m3-/, /^lk-/, /^gk-/, /^au-/, /^pong-/, /^game-/] },
    { id: 'desktop', name: '桌面布局与美化', group: '桌面与系统', scope: 'desk',
      desc: '桌面图标位置/顺序/大小、隐藏图标、壁纸与组件美化、主题色、美化方案',
      res: [/^desk-/, /^hidden-icons/, /^page-bg-/, /^card-bg-/, /^ico-/, /^phone-bg/, /^widget-/, /^app-icon/, /^app-name-color$/, /^beauty-/, /^full-beauty-/, /^decor-/, /^home-/, /^p2apps-order/, /^p2icons-/, /^rel-/, /^mem-extras$/, /^no-statusbar$/, /^bg-blur$/, /^bg-mask-op$/, /^bg-keep/, /^loading-/] },
    { id: 'lock', name: '二级密码锁', group: '桌面与系统', scope: 'desk',
      desc: '应用锁密码、密保问答、锁定开关与字卡锁状态',
      res: [/^applock/, /^cardlock/] },
    { id: 'sys', name: '音效与开屏设置', group: '桌面与系统', scope: 'both', page: 'page-sfx-settings',
      desc: '音效总开关与统一模式、开屏公告已读、引导完成标记、数据备份提醒时间',
      res: [/^sfx-/, /^notice-/, /^onboarding/, /^guide-/, /^splash-/, /^backup-/, /^last-export$/, /^install-/] }
  ];

  // ================= #679 各功能页内数据卡的挂点 =================
  // 值＝该功能页里的**滚动内容容器**（卡 append 进容器末尾：随内容滚动、位于页面最下方，
  // 不占固定高度容器的位置、不挤压原有布局）。只用各功能 template/JS 已有的静态 class/id，
  // 不改任何归属文件。找不到挂点的功能页放弃注入（绝不动原页面结构），见 FD_SKIP。
  // ⚠️ 有的容器会被所属模块整块 innerHTML 重写（实测：#myarc-root ← my-arc.js、#gc-body ←、
  // #fav-list ← 等），所以注入后必须挂 childList 观察者把卡补回，见 watchBarHost。
  var FD_MOUNTS = {
    calendar: '.cal-scroll',
    records: '.cal-scroll',
    interact: '.cal-scroll',
    divination: '.div-scroll',
    music: '.sm-scroll, .cal-scroll',
    tongpin: '.tp-body',
    shenshou: '.ss-body',
    water: '.water-body',
    eat: '.eat-body',
    piggy: '.piggy-body',
    pomo: '.pomo-body',
    checkin: '.cal-scroll',
    loc: '.gs-scroll',
    garden: '.garden-scroll',
    cjian: '#cj-main',
    myarc: '.narc-scroll',
    drift: '.drift-scroll',
    memo: '.memo-body',
    period: '.period-scroll',
    accounting: '.acc-scroll',
    gift: '.market-body',
    mood: '.cal-scroll',
    fav: '#fav-list',
    ask: '.gs-scroll',
    sys: '.gs-scroll'
  };
  // 刻意不注入的功能页：
  //   · 房间页 #page-room 是 overflow:hidden 的固定全屏场景（场景/clamp 高度/底部按钮条各占
  //     一份），塞任何卡片都会挤压小屋内景；要加得先重排房间布局。
  //   · 群聊页 #page-group-chat 的主体 #gc-body 就是**消息列表**，卡会混进消息流里、且每次渲染
  //     都被重建，既难看也可能干扰贴底逻辑；群聊数据改走集中页（设置 → 工具 → 各功能数据管理）。
  var FD_SKIP = { room: 1, gc: 1 };

  // 一个键最多归属一个功能（first match wins）——避免同一键被两个功能各删一次/各导一份
  function featureOfKey(full, cid) {
    var info = parseKey(full);
    if (!info) return null;
    if (info.suffix.indexOf(MEDIA_PREFIX) === 0 || info.suffix.indexOf(BLOB_PREFIX) === 0) return null; // 共享资源池不归属任何功能
    for (var i = 0; i < FEATURES.length; i++) {
      var f = FEATURES[i];
      var hit = false;
      for (var j = 0; j < f.res.length; j++) { if (f.res[j].test(info.suffix)) { hit = true; break; } }
      if (!hit) continue;
      var isTop = info.cid === null;
      if (f.scope === 'global') { if (isTop) return f; continue; }
      if (f.scope === 'both') { if (isTop || info.cid === cid) return f; continue; }
      if (info.cid === cid || (isTop && cid === 'default')) return f;
    }
    return null;
  }
  // 导入用：只看后缀像不像（不限定命名空间形态），文件来自别的桌面也能认出来
  function featureOfSuffix(f, suffix) {
    if (suffix.indexOf(MEDIA_PREFIX) === 0 || suffix.indexOf(BLOB_PREFIX) === 0) return false;
    for (var j = 0; j < f.res.length; j++) { if (f.res[j].test(suffix)) return true; }
    return false;
  }

  // ================= 键枚举与取值 =================
  function allKeys() {
    var set = Object.create(null);
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(G + ':') === 0) set[k] = 1;
      }
    } catch (e) {}
    var p = (window.idbListKeys ? window.idbListKeys() : Promise.resolve([]));
    return Promise.resolve(p).then(function (keys) {
      (keys || []).forEach(function (k) { if (k && String(k).indexOf(G + ':') === 0) set[String(k)] = 1; });
      return Object.keys(set);
    }).catch(function () { return Object.keys(set); });
  }
  function keysOf(f, cid) {
    return allKeys().then(function (all) {
      return all.filter(function (k) { var o = featureOfKey(k, cid); return o && o.id === f.id; });
    });
  }
  // 取值优先级：IDB 权威值 → xyStore（内存缓存 + LS 快照）
  function readFallback(full) {
    var info = parseKey(full);
    if (!info) return null;
    try {
      var v = window.xyStore ? window.xyStore(nsOf(info.cid)).get(info.suffix) : null;
      if (v !== null && v !== undefined) return v;
    } catch (e) {}
    try { return localStorage.getItem(full); } catch (e) { return null; }
  }
  function readValues(keys) {
    var p = (window.idbGetMany ? window.idbGetMany(keys) : Promise.resolve({}));
    return Promise.resolve(p).catch(function () { return {}; }).then(function (map) {
      var out = {};
      keys.forEach(function (k) {
        var v = map ? map[k] : null;
        if (v === undefined) v = null;
        if (v === null) v = readFallback(k);
        if (v !== null && v !== undefined) out[k] = v;
      });
      return out;
    });
  }
  function mediaRefsOf(values) {
    var set = Object.create(null);
    Object.keys(values).forEach(function (k) {
      var v = values[k];
      if (typeof v !== 'string' || v.indexOf('@@m:') < 0) return;
      var m; MEDIA_RE.lastIndex = 0;
      while ((m = MEDIA_RE.exec(v))) set[m[1]] = 1;
    });
    return Object.keys(set).map(function (h) { return G + ':' + MEDIA_PREFIX + h; });
  }

  // ================= 统计与体积 =================
  function byteLen(s) { try { return new Blob([s]).size; } catch (e) { return (s || '').length; } }
  function fmtSize(n) {
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }
  function countOf(v) {
    // 值可能是 JSON 文本（LS/IDB 里统一以字符串存），也可能已是对象
    var d = v;
    if (typeof d === 'string') {
      if (d.length > 1048576) return ''; // 超大键不整包 parse（聊天记录/字卡库可达几十 MB）
      try { d = JSON.parse(d); } catch (e) { return ''; }
    }
    if (Array.isArray(d)) return d.length + ' 条';
    if (d && typeof d === 'object') return Object.keys(d).length + ' 项';
    return '';
  }
  function summarize(values) {
    var keys = Object.keys(values);
    var bytes = 0, items = 0, sample = '';
    keys.forEach(function (k) {
      var v = values[k];
      bytes += byteLen(typeof v === 'string' ? v : String(v));
      var c = countOf(v);
      if (c) { var n = parseInt(c, 10); if (!isNaN(n)) { items += n; if (!sample) sample = c; } }
    });
    return { keyCount: keys.length, bytes: bytes, items: items, sample: sample };
  }

  // ================= 导出 =================
  function exportFeature(f, cb) {
    var cid = curCid();
    keysOf(f, cid).then(function (keys) {
      return readValues(keys).then(function (values) {
        if (!keys.length) { toast('「' + f.name + '」在本桌面还没有数据'); if (cb) cb(false); return; }
        var media = mediaRefsOf(values);
        return readValues(media).then(function (mv) {
          Object.keys(mv).forEach(function (k) { values[k] = mv[k]; });
          var st = summarize(values);
          var lines = ['将导出「' + f.name + '」的 ' + st.keyCount + ' 项数据' + (st.items ? '（约 ' + st.items + ' 条记录）' : '') +
            '，打包体积约 ' + fmtSize(st.bytes) + '。'];
          lines.push('作用范围：' + scopeText(f) + '。');
          if (media.length) lines.push('已附带这些数据里引用到的 ' + media.length + ' 张图片/语音（媒体池条目）。');
          lines.push('导出不会改动本机任何数据。');
          if (!window.openModal) return;
          window.openModal('导出「' + f.name + '」数据？', '', function () {
            var payload = { app: 'mochi-feature-data', version: '1.0', feature: f.id, featureName: f.name, cid: cid, exportTime: new Date().toISOString(), keys: values };
            var json;
            try {
              var parts = ['{"app":"mochi-feature-data","version":"1.0","feature":' + JSON.stringify(f.id) + ',"featureName":' + JSON.stringify(f.name) + ',"cid":' + JSON.stringify(cid) + ',"exportTime":"' + new Date().toISOString() + '","keys":{'];
              var ks = Object.keys(values);
              for (var i = 0; i < ks.length; i++) {
                if (i) parts.push(',');
                parts.push(JSON.stringify(ks[i]) + ':' + JSON.stringify(values[ks[i]]));
              }
              parts.push('}}');
              json = parts.join('');
            } catch (e) { toast('导出失败：' + (e && e.message || '未知错误')); return; }
            var fname = 'mochi' + f.name.replace(/[\/\\:*?"<>|]/g, '') + '_' + localDate() + '.json';
            if (window.mochiExportFile) window.mochiExportFile(json, fname, '导出' + f.name + '数据');
            else { toast('导出功能暂不可用'); return; }
            if (cb) cb(true);
            void payload;
          }, { noInput: true, staticText: lines.join('\n') });
        });
      });
    }).catch(function (e) { toast('导出失败：' + (e && e.message || '未知错误')); if (cb) cb(false); });
  }
  function localDate() {
    var d = new Date();
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function scopeText(f) {
    if (f.scope === 'global') return '全局键，所有桌面共用';
    if (f.scope === 'both') return '当前桌面 + 全局键';
    return '当前桌面（不影响其他桌面）';
  }
  // 行内标签用短名：同一个标签每行都出现，长句会把 39 行列表读成噪音；
  // 完整含义在页首说明与导出/清空弹窗里给全（弹窗仍走 scopeText）。
  function shortScope(f) {
    if (f.scope === 'global') return '全局';
    if (f.scope === 'both') return '本桌面+全局';
    return '本桌面';
  }

  // ================= 导入 =================
  // 支持三种文件：本页导出的 {app:'mochi-feature-data',keys} / 整份 mochi 备份 {ls,idb} / 裸的 {键:值}
  function extractKeyMap(data) {
    if (!data || typeof data !== 'object') return null;
    if (data.keys && typeof data.keys === 'object' && !Array.isArray(data.keys)) return data.keys;
    var out = Object.create(null), n = 0;
    var take = function (obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(function (k) { if (k.indexOf(G + ':') === 0) { out[k] = obj[k]; n++; } });
    };
    if (data.ls || data.idb) { take(data.ls); take(data.idb); return n ? out : null; }
    Object.keys(data).forEach(function (k) { if (k.indexOf(G + ':') === 0) { out[k] = data[k]; n++; } });
    return n ? out : null;
  }
  function targetOf(f, srcKey, cid) {
    var info = parseKey(srcKey);
    if (!info) return null;
    if (info.suffix.indexOf(MEDIA_PREFIX) === 0) return { ns: G, suffix: info.suffix };
    if (f.scope === 'global' || (f.scope === 'both' && info.cid === null)) return { ns: G, suffix: info.suffix };
    // desk / both 的桌面键：一律落到当前桌面命名空间（别的桌面导出的数据搬进本桌面）
    return { ns: G + ':' + cid, suffix: info.suffix };
  }
  function importFromFile(f, file, cb) {
    readFileText(file).then(function (text) {
      var data = null;
      try { data = JSON.parse(text || 'null'); } catch (e) {}
      if (!data) { toast('文件不是有效的 JSON，无法导入'); if (cb) cb(false); return; }
      var map = extractKeyMap(data);
      if (!map) { toast('文件里没有数据'); if (cb) cb(false); return; }
      var cid = curCid();
      var incoming = Object.create(null); // 目标键 → 值
      var mediaCount = 0, otherFeature = 0;
      Object.keys(map).forEach(function (k) {
        var info = parseKey(k);
        if (!info) return;
        if (info.suffix.indexOf(MEDIA_PREFIX) === 0) { incoming[G + ':' + info.suffix] = map[k]; mediaCount++; return; }
        if (info.suffix.indexOf(BLOB_PREFIX) === 0) return; // 字体包不随功能数据搬运
        var owner = featureOfSuffix(f, info.suffix);
        if (!owner) { otherFeature++; return; }
        var t = targetOf(f, k, cid);
        if (t) incoming[t.ns + ':' + t.suffix] = map[k];
      });
      var nKeys = Object.keys(incoming).length - mediaCount;
      if (!nKeys) { toast('文件里没有「' + f.name + '」的数据' + (otherFeature ? '（含 ' + otherFeature + ' 项其他功能的数据，已忽略）' : '')); if (cb) cb(false); return; }
      var bytes = 0;
      Object.keys(incoming).forEach(function (k) { bytes += byteLen(typeof incoming[k] === 'string' ? incoming[k] : String(incoming[k])); });
      var lines = ['文件里有「' + f.name + '」的 ' + nKeys + ' 项数据，约 ' + fmtSize(bytes) + '。'];
      if (mediaCount) lines.push('含 ' + mediaCount + ' 张图片/语音（媒体池条目，按内容去重写入）。');
      if (otherFeature) lines.push('另有 ' + otherFeature + ' 项其他功能的数据，本次不会改动。');
      lines.push('导入后页面会自动刷新。');
      var re = /^xy-home-v2:(?:default|c[0-9a-z]{5,}):(.+)$/;
      var deskKeys = Object.keys(incoming).filter(function (k) { return re.test(k); }).length;
      void deskKeys;
      if (!window.openModal) return;
      window.openModal('导入「' + f.name + '」数据？', '', function (v) {
        var replace = (v === 'replace');
        var todo = function () {
          var pairs = Object.keys(incoming);
          if (replace) {
            return keysOf(f, cid).then(function (old) {
              old.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
              return pairs;
            });
          }
          return Promise.resolve(pairs);
        };
        todo().then(function (pairs) {
          pairs.forEach(function (k) {
            var i = parseKey(k);
            if (!i) return;
            try { window.xyStore(nsOf(i.cid)).set(i.suffix, incoming[k]); } catch (e) {}
          });
          toast(replace ? '已替换为文件数据，正在刷新…' : '已导入，正在刷新…');
          scheduleReload();
          if (cb) cb(true);
        });
      }, { noInput: true, staticText: lines.join('\n'), pill: 'merge', pills: [
        { label: '合并（同项以文件为准）', value: 'merge' },
        { label: '清空本功能后导入', value: 'replace' }
      ] });
    });
  }
  function readFileText(file) {
    return new Promise(function (resolve) {
      if (file && typeof file.text === 'function') { file.text().then(resolve).catch(function () { viaReader(); }); return; }
      viaReader();
      function viaReader() {
        try {
          var r = new FileReader();
          r.onload = function () { resolve(String(r.result || '')); };
          r.onerror = function () { resolve(''); };
          r.readAsText(file, 'utf-8');
        } catch (e) { resolve(''); }
      }
    });
  }
  function pickFile(f, cb) {
    // FIX 2026-09-18 #755：统一走 window.mochiFilePick（原实现 detached＋无 label＋accept 迟到）
    window.mochiFilePick({
      id: 'mochi-featuredata-import-pick', accept: '.json,application/json',
      onFiles: function (files) {
        var file = files && files[0];
        if (!file) { try { toast('没有取到文件，请再选一次'); } catch (e) {} return; }
        importFromFile(f, file, cb);
      }
    });
  }

  // ================= #679 各功能页内操作（数据卡按钮） =================
  // 按钮在功能页内点击＝与集中页完全同一条引擎路径（导出弹窗/导入范围/清空确认都一致）；
  // 清空/导入完成后 scheduleReload 自动刷新，用户自然回到该功能页看新数据。

  // ================= 清空 =================
  function rmKey(info) {
    try { window.xyStore(nsOf(info.cid)).remove(info.suffix); } catch (e) {}
    // xyStore.remove 已含内存缓存 + LS + IDB 三层；IDB 不可用时再兜一次裸删
    try { if (!window.xyStore) localStorage.removeItem(info.full); } catch (e) {}
  }
  // 导入/清空后自动刷新（内存缓存 + 各模块内存真相无法就地同步）。
  // __mochiFdNoReload 是 verify 脚本的钩子：只验「数据确实写/删了」，不刷新页面。
  function scheduleReload() {
    if (window.__mochiFdNoReload) return;
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 600);
  }
  function clearFeature(f, cb) {
    var cid = curCid();
    keysOf(f, cid).then(function (keys) {
      if (!keys.length) { toast('「' + f.name + '」在本桌面没有可清空的数据'); if (cb) cb(false); return; }
      return readValues(keys).then(function (values) {
        var st = summarize(values);
        var lines = ['将删除「' + f.name + '」的 ' + st.keyCount + ' 项数据' + (st.items ? '（约 ' + st.items + ' 条记录）' : '') +
          '，约 ' + fmtSize(st.bytes) + '，删除后无法恢复。'];
        lines.push('作用范围：' + scopeText(f) + '。');
        lines.push('图片/语音媒体池与其他功能的数据不会被删（属于各功能自己的那条记录会被删掉）。');
        lines.push('清空后页面会自动刷新。');
        if (!window.openModal) return;
        window.openModal('清空「' + f.name + '」数据？', '', function () {
          keys.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
          // 清完再复查一次：IDB 删除是异步的，漏删会在刷新后来回来
          var gone = keysOf(f, cid);
          Promise.resolve(gone).then(function (left) {
            left.forEach(function (k) { var i = parseKey(k); if (i) rmKey(i); });
            toast('「' + f.name + '」数据已清空，正在刷新…');
            scheduleReload();
            if (cb) cb(true);
          });
        }, { noInput: true, staticText: lines.join('\n') });
      });
    }).catch(function (e) { toast('清空失败：' + (e && e.message || '未知错误')); if (cb) cb(false); });
  }

  // ================= 页面 UI =================
  function toast(msg) {
    try {
      if (typeof window.toast === 'function') { window.toast(msg); return; }
    } catch (e) {}
    var t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; t.className = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  var page, bodyEl, pageReady = false;
  function deskName() {
    var cid = curCid();
    var nick = '';
    try { nick = window.activeStore().get('lbl-partner') || ''; } catch (e) {}
    return (nick ? nick : 'TA') + '（' + cid + '）';
  }
  function render() {
    if (!bodyEl) return;
    var groups = [], gi = {};
    FEATURES.forEach(function (f) {
      if (!gi[f.group]) { gi[f.group] = { name: f.group, items: [] }; groups.push(gi[f.group]); }
      gi[f.group].items.push(f);
    });
    var html = ['<div class="cal-card glass"><div class="fd-intro">',
      '这里是<b>每个功能自己的数据</b>：导出＝把这个功能的数据单独存成一个文件；导入＝把文件里的数据放回这个功能；清空＝只删这个功能的数据。',
      '当前桌面：<b>' + esc(deskName()) + '</b>；带「全局」标记的功能所有桌面共用一份数据，清空会影响所有桌面。',
      '整机级别的「导出数据 / 导入数据」（含全部功能）仍在 设置 → 工具 顶部；聊天记录也有专门的整桌面入口。',
      '纯展示的功能（统计、计算器等）没有独立数据，不在此列。',
      '</div><div class="fd-legend">按钮含义：<b>导出</b> 下载 JSON；<b>导入</b> 选文件恢复（可选合并或先清空再导入）；<b>清空</b> 只删本功能数据，不可恢复。</div></div>'];
    groups.forEach(function (g) {
      html.push('<div class="fd-group-title">' + esc(g.name) + '</div>');
      html.push('<div class="cal-card glass fd-card">');
      g.items.forEach(function (f) {
        html.push('<div class="fd-row" data-fid="' + esc(f.id) + '">',
          '<div class="fd-main"><div class="fd-head"><span class="fd-name">' + esc(f.name) + '</span>' +
          '<span class="fd-scope ' + (f.scope === 'desk' ? 'desk' : 'global') + '">' + esc(shortScope(f)) + '</span></div>',
          '<div class="fd-count" data-count="' + esc(f.id) + '">统计中…</div>',
          '<div class="fd-desc">' + esc(f.desc) + '</div>',
          '<div class="fd-btns">',
          '<button class="fd-btn" type="button" data-op="export" data-fid="' + esc(f.id) + '">导出</button>',
          '<button class="fd-btn" type="button" data-op="import" data-fid="' + esc(f.id) + '">导入</button>',
          '<button class="fd-btn danger" type="button" data-op="clear" data-fid="' + esc(f.id) + '">清空</button>',
          '</div></div></div>');
      });
      html.push('</div>');
    });
    bodyEl.innerHTML = html.join('');
    refreshCounts();
  }
  function refreshCounts() {
    var cid = curCid();
    FEATURES.forEach(function (f) {
      var el = bodyEl.querySelector('[data-count="' + f.id + '"]');
      if (!el) return;
      keysOf(f, cid).then(function (keys) {
        if (el.dataset.done) return;
        el.dataset.done = '1';
        if (!keys.length) { el.textContent = '无数据'; el.classList.add('empty'); return; }
        return readValues(keys).then(function (values) {
          var st = summarize(values);
          el.textContent = st.keyCount + ' 项 · ' + fmtSize(st.bytes) + (st.items ? ' · 约 ' + st.items + ' 条' : '');
        });
      });
    });
  }
  function openPage() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      page.hidden = false;
      render();
      var sc = page.querySelector('.cal-scroll');
      if (sc) sc.scrollTop = 0;
    } catch (e) {}
  }
  function closePage() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var s = document.getElementById('page-setting');
      if (s) s.hidden = false;
    } catch (e) {}
  }
  function byId(id) { for (var i = 0; i < FEATURES.length; i++) if (FEATURES[i].id === id) return FEATURES[i]; return null; }

  // ================= #679 功能页内的数据管理入口 =================
  // 需求（用户 2026-09-17）：导出/导入/清空「现在没有在每个功能里面显示，只显示在了集中里」。
  // 做法：把一张「数据管理」卡注进每个功能自己的页面（fd-bar），三个按钮复用集中页同一条
  // 导出/导入/清空引擎（含桌面隔离、媒体池保全、确认弹窗、导入范围选择）——不在 38 个功能
  // 文件里各写一套，也不会与各功能的按钮/表格争布局（卡片是块级、独占一行）。
  // 跳过三类：没有登记 page 的功能（锁/音效等设置型，本就没有独立页面入口）、已有自己三行
  // 数据按钮的页面（chat-settings / 信箱 / 朋友圈，btns 字段登记原入口 id 供验证脚本对照）、
  // 以及找不到锚点节点的页面（老版本产物/渲染失败时不注入，绝不影响原页面）。
  function fdBarHost(f, pageEl) {
    if (f.btns || FD_SKIP[f.id]) return null;
    var sel = FD_MOUNTS[f.id];
    if (!sel) return null;
    var host = pageEl.querySelector(sel);
    return host || null;
  }
  function buildFdBar(f) {
    var card = document.createElement('div');
    card.className = 'cal-card glass fd-fbar';
    card.setAttribute('data-fbar', f.id);
    card.innerHTML =
      '<div class="fd-fbar-head"><span class="fd-fbar-name">' + esc(f.name) + ' · 数据管理</span>' +
      '<button class="fd-fbar-go" type="button" data-op="open" data-fid="' + esc(f.id) + '">全部功能 ›</button></div>' +
      '<div class="fd-count" data-fcount="' + esc(f.id) + '">统计中…</div>' +
      '<div class="fd-btns">' +
      '<button class="fd-btn" type="button" data-op="export" data-fid="' + esc(f.id) + '">导出数据</button>' +
      '<button class="fd-btn" type="button" data-op="import" data-fid="' + esc(f.id) + '">导入数据</button>' +
      '<button class="fd-btn danger" type="button" data-op="clear" data-fid="' + esc(f.id) + '">清空数据</button>' +
      '</div>';
    return card;
  }
  function mountFdBars() {
    FEATURES.forEach(function (f) {
      if (!f.page) return;
      var pageEl = document.getElementById(f.page);
      if (!pageEl || pageEl.querySelector('[data-fbar]')) return;
      var host = fdBarHost(f, pageEl);
      if (!host) return;
      host.appendChild(buildFdBar(f));   // 容器末尾：随内容滚动，位于该功能页最下方
      watchBarHost(f, host);
    });
  }
  // #679 生存性：容器被所属模块整块重写时把卡补回去（实测 #myarc-root 每次打开都被
  // my-arc.js 的 innerHTML 冲掉＝用户打开「我的档案」根本看不到卡）。用 childList 观察者按需
  // 补挂，不轮询；补挂后重算一次计数（新节点是「统计中…」）。
  function watchBarHost(f, host) {
    if (!window.MutationObserver || host.__fdBarWatch) return;
    try {
      host.__fdBarWatch = 1;
      new MutationObserver(function () {
        if (!host.isConnected || host.querySelector('[data-fbar="' + f.id + '"]')) return;
        host.appendChild(buildFdBar(f));
        fdCount(f);
      }).observe(host, { childList: true });
    } catch (e) {}
  }
  function fdBarClick(e) {
    var b = e.target.closest ? e.target.closest('.fd-btn, .fd-fbar-go') : null;
    if (!b) return;
    var f = byId(b.getAttribute('data-fid'));
    if (!f) return;
    var op = b.getAttribute('data-op');
    if (op === 'export') exportFeature(f);
    else if (op === 'import') pickFile(f);
    else if (op === 'clear') clearFeature(f);
    else if (op === 'open') openPage();
  }
  function fdCount(f) {
    var el = document.querySelector('[data-fcount="' + f.id + '"]');
    if (!el || el.dataset.done) return;
    keysOf(f, curCid()).then(function (keys) {
      if (el.dataset.done) return;
      el.dataset.done = '1';
      if (!keys.length) { el.textContent = '本桌面暂无数据'; el.classList.add('empty'); return; }
      return readValues(keys).then(function (values) {
        var st = summarize(values);
        el.textContent = st.keyCount + ' 项 · ' + fmtSize(st.bytes) + (st.items ? ' · 约 ' + st.items + ' 条' : '');
      });
    });
  }
  function refreshFdCounts() {
    FEATURES.forEach(function (f) {
      if (!f.page || f.btns) return;
      if (!document.querySelector('[data-fcount="' + f.id + '"]')) return;
      fdCount(f);
    });
  }
  // #679 计数不谎报：卡上的「几项 · 多少 B」只在注入后算一次会越用越旧（用户加了数据仍显示
  // 旧值）。改成每次该功能页被显示时重算——用 MutationObserver 盯 .page 的 hidden 属性变化
  // （不轮询、不碰各功能自己的显示逻辑；只有 .page 本身且变为可见时才动作）。
  function refreshPageCount(pageEl) {
    FEATURES.forEach(function (f) {
      if (!f.page || f.page !== pageEl.id) return;
      var el = pageEl.querySelector('[data-fcount="' + f.id + '"]');
      if (!el) return;
      delete el.dataset.done;
      el.classList.remove('empty');
      fdCount(f);
    });
  }
  function watchPageVisibility() {
    var root = document.querySelector('.phone') || document.body;
    if (!root || !window.MutationObserver) return;
    try {
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          if (!t || !t.classList || !t.classList.contains('page') || t.hidden) continue;
          refreshPageCount(t);
        }
      }).observe(root, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    } catch (e) {}
  }

  function init() {
    page = document.getElementById('page-feature-data');
    bodyEl = document.getElementById('feature-data-body');
    var row = document.getElementById('row-feature-data');
    var back = document.getElementById('feature-data-back');
    if (!page || !bodyEl) return;
    pageReady = true;
    if (row) row.addEventListener('click', openPage);
    if (back) back.addEventListener('click', closePage);
    if (bodyEl) {
      bodyEl.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.fd-btn') : null;
        if (!b) return;
        var f = byId(b.getAttribute('data-fid'));
        if (!f) return;
        var op = b.getAttribute('data-op');
        if (op === 'export') exportFeature(f);
        else if (op === 'import') pickFile(f);
        else if (op === 'clear') clearFeature(f);
      });
    }
    var refresh = document.getElementById('feature-data-refresh');
    if (refresh) refresh.addEventListener('click', function () {
      bodyEl.querySelectorAll('[data-count]').forEach(function (el) { delete el.dataset.done; el.classList.remove('empty'); el.textContent = '统计中…'; });
      refreshCounts();
      toast('已重新统计');
    });
    // #679：功能页内数据管理卡——注入 + 事件委托（卡在各自 .page 里，页面 hidden 时
    // .page[hidden] 自动连带隐藏，无需额外显隐逻辑）。各功能页有静态的（template）与
    // 运行时生成的（p2-features / memo-app 等），且数据回填可能晚于本脚本，故多次补注入。
    mountFdBars();
    document.addEventListener('click', fdBarClick, true);
    watchPageVisibility();
    setTimeout(mountFdBars, 800);
    setTimeout(function () { mountFdBars(); refreshFdCounts(); }, 2500);
    document.addEventListener('mochi-restore-done', function () { mountFdBars(); refreshFdCounts(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // 数据恢复完成后重渲染（导入备份后页面会刷新，这里是同会话回到本页时的兜底）
  try { document.addEventListener('mochi-restore-done', function () { if (pageReady && page && !page.hidden) render(); }); } catch (e) {}

  // 供验证脚本/其他模块调用（不进入任何既有功能路径）
  window.mochiFeatureData = {
    features: FEATURES,
    scopeText: scopeText,
    parseKey: parseKey,
    featureOfKey: featureOfKey,
    keysOf: function (fid) { var f = byId(fid); return f ? keysOf(f, curCid()) : Promise.resolve([]); },
    valuesOf: function (fid) { var f = byId(fid); return f ? keysOf(f, curCid()).then(readValues) : Promise.resolve({}); },
    exportFeature: function (fid, cb) { var f = byId(fid); return f ? exportFeature(f, cb) : null; },
    importFile: function (fid, file, cb) { var f = byId(fid); return f ? importFromFile(f, file, cb) : null; },
    clearFeature: function (fid, cb) { var f = byId(fid); return f ? clearFeature(f, cb) : null; },
    describe: function (fid) { var f = byId(fid); return f ? { id: f.id, name: f.name, scope: f.scope } : null; },
    // #679：功能页内数据卡（供验证脚本与后续功能接续）
    fdBarOf: function (fid) { var f = byId(fid); return f && f.page && !f.btns && document.querySelector('[data-fbar="' + f.id + '"]') ? true : false; },
    // 重叠自检：同一键被多个功能匹配＝清空/导出会互相牵连（供 verify 脚本断言为空）
    overlaps: function () { return allKeys().then(function (keys) { var m = {}; keys.forEach(function (k) { var f = featureOfKey(k, curCid()); if (f) m[k] = f.id; }); return m; }); }
  };
})();
