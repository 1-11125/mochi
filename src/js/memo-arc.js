// ===== 梦角档案 v2（重构：与【我的档案】互为镜像的「认识TA」档案） =====
// 入口：桌面第三页「梦角档案」图标。
// 定位：【我的档案】=认识自己；【梦角档案】=认识TA——记录「TA是谁，以及我逐渐了解到TA什么」。
// 结构（10 个分区）：
//   TA是谁 / TA的喜好 / TA的习惯 / TA与我的相处 / 我对TA的了解（核心）
//   / TA的位置感 / TA的物品 / TA的梦境 / 我们的共同记录 / 当前IF世界
// 数据键不变：xy-home-v2:narc-<rosterId>（全局根命名空间共享，contacts.js EXCLUDE 已登记）。
// 老数据全兼容（零迁移丢失）：
//   loves(旧了解卡)→「我对TA的了解·发现卡片」（惰性规范化补 src+dots，原字段一律保留）
//   wonders→还不了解；history→理解变化；bonds/moments/records→我们的共同记录（含时间线合并视图）
// 新增容器（ensureArc 惰性补齐）：who / tastes / habits / relate / pos / things / ifw / ifchanges。
// 弹窗注意：多阶段切换离开胶囊阶段必须 ctl.pills([]) 显式隐藏——fire() 的 pills 分支按 pillClicked
//   判断，残留会让下一阶段点确定收到旧胶囊值；cb 里链式开新弹窗必须 setTimeout 0（外层 finally
//   close 会把新弹窗 cb 清空，room.js 三处同款教训）。
(function () {
  const GNS = 'xy-home-v2';
  const page = document.getElementById('page-memo-arc');
  const root = document.getElementById('narc-root');

  function gStore() { try { return window.xyStore(GNS); } catch (e) { return null; } }
  function toast(m) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = m; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 1800);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function mdstr(ts) { const d = new Date(ts); return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }
  function short(s, n) { s = String(s == null ? '' : s); n = n || 18; return s.length > n ? s.slice(0, n) + '…' : s; }
  function strim(v) { return String(v == null ? '' : v).trim(); }

  // ---- 「了解」类型：新卡用新词表；旧数据类型保留映射照常渲染 ----
  const KTYPES = [
    ['klike', '我发现TA喜欢'], ['kdislike', '我知道TA不喜欢'], ['kdo', '我发现TA会'],
    ['kusual', 'TA平时会'], ['konlyme', 'TA只在我面前'], ['kless', 'TA不太会表达'],
    ['kcare', 'TA其实很在意'], ['kmicro', 'TA的小习惯'], ['ksurprise', '让我意外的地方'],
    ['kother', '其他发现']
  ];
  const LEGACY_TYPES = [
    ['like', 'TA喜欢'], ['dislike', 'TA不喜欢'], ['habit', 'TA习惯'], ['care', 'TA在意'],
    ['do', 'TA会'], ['dont', 'TA不会'], ['good', 'TA擅长'], ['bad', 'TA不擅长'],
    ['fear', 'TA害怕'], ['need', 'TA需要'], ['truth', 'TA其实'], ['us', '我们之间'], ['other', '其他']
  ];
  const TYPE_MAP = {};
  LEGACY_TYPES.concat(KTYPES).forEach(t => { TYPE_MAP[t[0]] = t[1]; });
  function typeLabel(t) { return TYPE_MAP[t] || '其他发现'; }

  // ---- 来源（可信程度）与了解程度圆点：来源是性质，圆点是把握；都不是好感度 ----
  const SRCS = [['think', '我认为'], ['told', 'TA告诉我的'], ['seen', '我观察到的'], ['confirmed', '已确认']];
  const SRC_MAP = {}; SRCS.forEach(s => { SRC_MAP[s[0]] = s[1]; });
  const SRC_PILLS = SRCS.map(s => ({ label: s[1], value: s[0] }));
  const SRC_DOT = { think: 2, told: 4, seen: 3, confirmed: 5 };
  const DOT_PILLS = [[1, '●○○○○ 刚有感觉'], [2, '●●○○○ 有几分'], [3, '●●●○○ 比较确定'], [4, '●●●●○ 很确定'], [5, '●●●●● 已确认']]
    .map(d => ({ label: d[1], value: String(d[0]) }));
  function dotsStr(n) { n = parseInt(n, 10); if (isNaN(n)) n = 0; n = Math.max(0, Math.min(5, n)); return '●'.repeat(n) + '○'.repeat(5 - n); }
  function legacyLevelOf(d) { return d >= 5 ? '2' : (d >= 3 ? '1' : '0'); }

  // ---- 字段定义：key, label, placeholder(空态也显示它当引导), 是否多行 ----
  const WHO_GROUPS = [
    { name: '基本资料', fields: [
      ['nick', '昵称', '例如：小梦、阿梦', 0],
      ['call', '称呼', '你们互相怎么叫对方？', 0],
      ['bday', '生日', '例如：3月14日（不确定也可以猜）', 0],
      ['age', '年龄', '例如：看起来十七八岁 / 永远十七岁', 0],
      ['identity', '身份', '例如：住在梦里的人', 0],
      ['nature', '性格', '例如：安静、慢热，其实很温柔', 0],
      ['looks', '外貌', '头发、眼睛、常穿的衣服……', 1],
      ['intro', '自我介绍', '如果TA要介绍自己，会怎么说？', 1]
    ] },
    { name: '世界设定', fields: [
      ['origin', '来自哪里', '例如：梦的另一边', 0],
      ['realm', '属于什么世界', '例如：梦境 / 现实的倒影', 0],
      ['relation', '与现实世界的关系', '例如：偶尔重叠，大多时候平行', 1]
    ] },
    { name: '存在方式', sub: '不用写成绝对设定，「不固定」「说不好」也是答案。', fields: [
      ['visible', '能否被看见', '例如：不固定 / 偶尔能被看见', 0],
      ['touch', '能否被触碰', '例如：可以产生体感', 0],
      ['exist', '存在方式', '例如：通常在身边，但不一定能被直接观察', 0],
      ['where', '平时在哪里', '例如：说不好，感觉就在旁边', 0],
      ['leave', '是否会离开', '例如：会离开一阵子，但总会回来', 0],
      ['power', '特殊能力 / 特殊设定', '例如：能让房间变得安静', 1]
    ] }
  ];
  const RELATE_FIELDS = [
    ['call', 'TA对我的称呼', '例如：名字、小笨蛋，或者只是「你」', 0],
    ['attitude', 'TA对我的态度', '例如：嘴上平淡，其实很纵容', 0],
    ['intimacy', '表达亲密的方式', '例如：不会抱，但会把头靠过来', 0],
    ['approach', '主动靠近我的方式', '例如：假装路过，然后停下来', 0],
    ['accompany', '陪伴我的方式', '例如：我不说话的时候，就安静待着', 0],
    ['comfort', '安慰我的方式', '例如：不讲道理，只说「有我在」', 0],
    ['loveway', '表达喜欢的方式', '例如：不说喜欢，但记得我说过的每件小事', 0]
  ];
  const POS_FIELDS = [
    ['usual', '通常', '例如：身边', 0],
    ['often', '偶尔', '例如：身后 / 左侧 / 房间另一边', 0],
    ['special', '特殊情况', '例如：感觉不到TA位置的时候，可能是在打盹', 1]
  ];
  const IFW_FIELDS = [
    ['world', '当前世界', '例如：海边小镇', 0],
    ['mine', '我的身份', '例如：花店老板', 0],
    ['role', 'TA的身份', '例如：咖啡店老板', 0],
    ['rel', '我们的关系', '例如：恋人 / 刚认识', 0]
  ];
  const FIELD_INDEX = {};
  WHO_GROUPS.forEach(g => g.fields.forEach(f => { FIELD_INDEX[f[0]] = { map: 'who', label: f[1], ph: f[2], multi: f[3] }; }));
  RELATE_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'relate', label: f[1], ph: f[2], multi: f[3] }; });
  POS_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'pos', label: f[1], ph: f[2], multi: f[3] }; });
  IFW_FIELDS.forEach(f => { FIELD_INDEX[f[0]] = { map: 'ifw', label: f[1], ph: f[2], multi: f[3] }; });

  // ---- 各分区列表词表 ----
  const TASTE_TABS = [['like', '喜欢'], ['dislike', '不喜欢'], ['pref', '偏好']];
  const LIKE_CATS = ['食物', '饮料', '颜色', '动物', '植物', '天气', '季节', '地方', '活动', '音乐', '游戏', '其他'];
  const HABIT_TABS = [['daily', '日常习惯'], ['micro', '小动作'], ['expr', '表达习惯'], ['comp', '陪伴习惯']];
  const HABIT_PH = {
    daily: '例如：天黑以后才出现 / 喜欢待在窗边',
    micro: '例如：想事情的时候会沉默',
    expr: '例如：不说想你，会问「你梦见什么了」',
    comp: '例如：我难过的时候不说话，只是待在旁边'
  };
  const THING_TABS = [['use', 'TA常用'], ['fav', 'TA喜欢'], ['gave', 'TA送我'], ['igave', '我送TA'], ['ours', '我们共有']];
  const THING_PH = {
    use: '例如：常用的耳机',
    fav: '例如：那把旧伞',
    gave: '例如：TA送给我的玩偶',
    igave: '例如：我送TA的发绳',
    ours: '例如：我们的小屋钥匙'
  };
  const SHARED_TABS = [['first', '第一次'], ['habit', '共同经历'], ['secret', '只有我们知道的事'], ['day', '特别日子'], ['thing', '特别物品'], ['place', '特别地点'], ['timeline', '时间线']];
  const BOND_CATS = { first: '第一次', habit: '共同经历', secret: '只有我们知道的事', day: '特别日子', thing: '特别物品', place: '特别地点' };
  const BOND_PH = {
    first: '例如：第一次一起玩游戏',
    habit: '例如：每晚互道晚安',
    secret: '例如：只有我们知道的暗号',
    day: '例如：在一起的第一百天',
    thing: '例如：那半块橡皮',
    place: '例如：常一起发呆的天台'
  };
  // ---- 数据存取（名单合并所有桌面命名空间 cjian-roster + 旧根键兜底，同 v3.14.x） ----
  // v3.16.x：条目带 cid（属于哪个桌面联系人）；还没有梦角的联系人也给出「虚拟」chip
  // （virtual:true，id 为空串）——点击即按 cjian.seedIfEmpty 同款语义落一份真身。
  // 虚拟条件：该桌面 roster 为空且没有 cjian-seeded 标记（有标记=用户删过，尊重不复活）。
  function partnerNameOf(cid) {
    let name = '';
    try { name = String(window.xyStore(GNS + ':' + cid).get('lbl-partner') || '').trim(); } catch (e) {}
    if (!name) {
      try {
        const cs = window.getContacts ? window.getContacts() : [];
        const c = cs.find(x => x.id === cid);
        if (c && c.name) name = c.name;
      } catch (e) {}
    }
    return name || 'TA';
  }
  function deskRoster(cid) {
    let list = [];
    try { list = JSON.parse(window.xyStore(GNS + ':' + cid).get('cjian-roster') || '[]'); } catch (e) {}
    return Array.isArray(list) ? list : [];
  }
  function roster() {
    const out = [], seen = {};
    const push = (a, cid) => { (Array.isArray(a) ? a : []).forEach(x => { if (x && x.name && x.id && !seen[x.id]) { seen[x.id] = 1; out.push({ id: x.id, name: x.name, cid: cid || null, virtual: false }); } }); };
    let cs = null;
    try { cs = window.getContacts ? window.getContacts() : null; } catch (e) {}
    const desks = (cs && cs.length ? cs : [{ id: 'default' }]);
    desks.forEach(c => {
      const list = deskRoster(c.id);
      if (list.length) push(list, c.id);
      else {
        let seeded = false;
        try { seeded = !!window.xyStore(GNS + ':' + c.id).get('cjian-seeded'); } catch (e) {}
        if (!seeded) out.push({ id: '', name: partnerNameOf(c.id), cid: c.id, virtual: true });
      }
    });
    push(JSON.parse(gStore().get('cjian-roster') || '[]'), null);
    return out;
  }
  // 把某个桌面的虚拟名单落成真身（返回新梦角 id）；已有名单直接返回首个；
  // 该桌面带 cjian-seeded 标记且名单为空 = 用户删过，尊重不复活（返回空串）。
  function materializeDesk(cid) {
    try {
      const ds = window.xyStore(GNS + ':' + cid);
      const list = deskRoster(cid);
      if (list.length) { ds.set('cjian-seeded', '1'); return list[0].id; }
      let seeded = false;
      try { seeded = !!ds.get('cjian-seeded'); } catch (e) {}
      if (seeded) return '';
      const entry = { id: makeId(), name: partnerNameOf(cid), offsetMin: 0 };
      ds.set('cjian-roster', JSON.stringify([entry]));
      ds.set('cjian-seeded', '1');
      return entry.id;
    } catch (e) { return ''; }
  }
  function keyOf(id) { return 'narc-' + id; }
  function loadRaw(id) { const s = gStore(); if (!s) return null; try { const o = JSON.parse(s.get(keyOf(id)) || 'null'); if (o && typeof o === 'object') return o; } catch (e) {} return null; }
  function saveArc(id, o) { const s = gStore(); if (s) { try { s.set(keyOf(id), JSON.stringify(o)); } catch (e) {} } }
  function normObj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null; }
  function makeId() { return 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
  function ensureArc(id) {
    let o = loadRaw(id), dirty = false;
    if (!o) { o = { created: Date.now(), loves: [], bonds: [], moments: [], records: [], wonders: [], history: [] }; dirty = true; }
    ['loves', 'bonds', 'moments', 'records', 'wonders', 'history', 'tastes', 'habits', 'things', 'ifchanges', 'dreams'].forEach(k => { if (!Array.isArray(o[k])) { o[k] = []; dirty = true; } });
    if (!normObj(o.who)) { o.who = { f: {} }; dirty = true; } else if (!normObj(o.who.f)) { o.who.f = {}; dirty = true; }
    if (!normObj(o.relate)) { o.relate = { f: {}, notes: [] }; dirty = true; }
    else { if (!normObj(o.relate.f)) { o.relate.f = {}; dirty = true; } if (!Array.isArray(o.relate.notes)) { o.relate.notes = []; dirty = true; } }
    if (!normObj(o.pos)) { o.pos = { usual: '', often: '', special: '' }; dirty = true; }
    else ['usual', 'often', 'special'].forEach(k => { if (typeof o.pos[k] !== 'string') { o.pos[k] = ''; dirty = true; } });
    if (!normObj(o.ifw)) { o.ifw = { world: '', mine: '', role: '', rel: '' }; dirty = true; }
    else ['world', 'mine', 'role', 'rel'].forEach(k => { if (typeof o.ifw[k] !== 'string') { o.ifw[k] = ''; dirty = true; } });
    // 旧了解卡惰性规范化：补 src（来源）与 dots（了解程度），原字段一律保留
    (o.loves || []).forEach(it => {
      if (!it) return;
      if (!it.src) { it.src = (String(it.level) === '2') ? 'confirmed' : 'seen'; dirty = true; }
      if (it.dots == null) { it.dots = (String(it.level) === '2') ? 5 : (String(it.level) === '1' ? 3 : 2); dirty = true; }
    });
    if (dirty) saveArc(id, o);
    return o;
  }
  function curId() { try { return gStore().get('narc-cur') || ''; } catch (e) { return ''; } }
  function setCur(id) { try { gStore().set('narc-cur', id); } catch (e) {} }

  // ---- 默认播种：全局还没有任何真身梦角时，把当前桌面的联系人（TA）先落成真身 ----
  // 与 cjian.js seedIfEmpty 同源同键：取 lbl-partner → 联系人名 → 'TA'；写该桌面
  // cjian-roster 并落 cjian-seeded 标记——用户之后删光梦角不会复活（标记已存在）。
  function seedDefaultRoster() {
    try {
      if (roster().some(x => !x.virtual)) return; // 已有真身，不播种
      let cid = 'default';
      try {
        const m = String(window.activePrefix ? window.activePrefix() : '').match(/xy-home-v2:([^:]+)$/);
        if (m) cid = m[1];
      } catch (e) {}
      materializeDesk(cid);
    } catch (e) {}
  }

  // ---- 页面状态 ----
  let cur = '';
  let view = 'home';           // home|who|tastes|habits|relate|knows|pos|things|dream|shared|ifw
  const tab = { tastes: 'like', habits: 'daily', things: 'use', shared: 'first', knows: 'cards' };

  // ---- 打开/关闭 ----
  const VALID_VIEWS = ['home', 'who', 'tastes', 'habits', 'relate', 'knows', 'pos', 'things', 'dream', 'shared', 'ifw'];
  window.openNarc = function (view0) {
    syncCur();
    if (!page || !root) return;
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    page.hidden = false;
    view = (view0 && VALID_VIEWS.indexOf(view0) >= 0) ? view0 : 'home';
    tab.tastes = 'like'; tab.habits = 'daily'; tab.things = 'use'; tab.shared = 'first'; tab.knows = 'cards';
    render();
  };
  // 我的档案桥接入口：直接打开当前梦角的「我们的共同记录」（无梦角时回总览给引导）
  window.openNarcShared = function () {
    syncCur();
    if (!roster().length) { window.openNarc(); return; }
    window.openNarc('shared');
  };
  window.closeNarc = function () {
    if (!page) return;
    page.classList.remove('full');
    document.querySelectorAll('.page').forEach(p => p.hidden = true);
    const home = document.getElementById('page-phone');
    if (home) home.hidden = false;
  };
  function syncCur() {
    seedDefaultRoster(); // 全局还没有真身时，把当前桌面联系人种为第一个梦角（与 cjian.seedIfEmpty 同键同标记）
    const real = roster().filter(x => !x.virtual); // 虚拟 chip 只作入口展示，不参与选中
    if (!real.length) { cur = ''; return; }
    const c = curId();
    cur = real.some(x => x.id === c) ? c : real[0].id;
    setCur(cur);
  }

  // ---- 渲染主入口 ----
  function render() {
    if (!root) return;
    syncCur();
    const r = roster();
    let h = '';
    h += '<div class="narc-chips">';
    r.forEach(c => {
      h += '<button class="narc-chip' + (!c.virtual && c.id === cur ? ' on' : '') + '" data-op="pick-roster" data-rid="' + esc(c.id) + '" data-cid="' + esc(c.cid || '') + '">' + esc(c.name) + '</button>';
    });
    h += '<button class="narc-chip narc-addchip" data-op="add-roster">＋ 添加</button>';
    h += '</div>';
    if (!cur) {
      h += '<div class="narc-empty">还没有可以写档案的梦角<br>点上方联系人创建，或从「此间」添加';
      h += '<br><button class="ne-btn" data-op="add-roster">去添加梦角</button></div>';
      root.innerHTML = h;
      return;
    }
    const arc = ensureArc(cur); // created 初始化在这：打开即开始计相处天数
    h += (view === 'home') ? overviewHTML(arc, r) : sectionHTML(arc, r);
    root.innerHTML = h;
  }
  function activeLovesOf(arc) { return arc.loves.filter(x => x.status !== 'retired'); }
  function filledN(m, keys) { return keys.filter(k => String(m[k] || '').trim()).length; }

  // ---- 总览：英雄区 + 分区菜单 ----
  function overviewHTML(arc, r) {
    const rosterName = (r.find(x => x.id === cur) || {}).name || 'TA';
    const days = Math.max(0, Math.floor((Date.now() - arc.created) / 86400000));
    const activeLoves = activeLovesOf(arc);
    const sharedN = arc.bonds.length + arc.moments.length + arc.records.length;
    const wondersOpen = arc.wonders.filter(w => !w.solved).length;
    let recent = null;
    activeLoves.forEach(x => { if (!recent || x.updated > recent.updated) recent = x; });

    let h = '<div class="narc-hero">';
    h += '<div class="narc-hero-top"><span class="narc-name">' + esc(rosterName) + '</span><span class="narc-days">一起留下 · ' + days + ' 天</span></div>';
    h += '<div class="narc-hero-sub">「我对TA的了解」不是TA的全部，是我和TA相处以后、慢慢知道的事。</div>';
    h += '<div class="narc-stats">';
    h += '<div class="narc-stat"><b>' + activeLoves.length + '</b><span>了解</span></div>';
    h += '<div class="narc-stat"><b>' + sharedN + '</b><span>共同记录</span></div>';
    h += '<div class="narc-stat"><b>' + arc.moments.length + '</b><span>重要时刻</span></div>';
    h += '<div class="narc-stat"><b>' + wondersOpen + '</b><span>还不了解</span></div>';
    h += '</div>';
    if (recent) {
      h += '<div class="narc-recent"><b>最近发现</b>　' + esc(typeLabel(recent.type)) + '……' + esc(short(recent.text, 26));
      h += '<span class="nr-date">' + mdstr(recent.updated) + '</span></div>';
    }
    h += '</div>';
    h += menuHTML(arc);
    return h;
  }

  function menuHTML(arc) {
    const whoFilled = WHO_GROUPS.reduce((n, g) => n + g.fields.filter(f => String(arc.who.f[f[0]] || '').trim()).length, 0);
    const relFilled = RELATE_FIELDS.filter(f => String(arc.relate.f[f[0]] || '').trim()).length + arc.relate.notes.length;
    const posFilled = filledN(arc.pos, ['usual', 'often', 'special']);
    const ifwFilled = IFW_FIELDS.filter(f => String(arc.ifw[f[0]] || '').trim()).length + arc.ifchanges.length;
    const wondersOpen = arc.wonders.filter(w => !w.solved).length;
    const rows = [
      ['who', 'TA是谁', '基本资料 · 世界设定 · 存在方式', whoFilled],
      ['tastes', 'TA的喜好', '喜欢 / 不喜欢 / 偏好', arc.tastes.length],
      ['habits', 'TA的习惯', '日常 · 小动作 · 表达 · 陪伴', arc.habits.length],
      ['relate', 'TA与我的相处', '称呼 · 态度 · 亲密 · 陪伴的方式', relFilled],
      ['knows', '我对TA的了解', '发现 ' + activeLovesOf(arc).length + ' · 未解 ' + wondersOpen, activeLovesOf(arc).length, true],
      ['pos', 'TA的位置感', 'TA常出现的位置与方位', posFilled],
      ['things', 'TA的物品', '常用 · 喜欢 · 互赠 · 共有', arc.things.length],
      ['dream', 'TA的梦境', 'TA做过的、愿意让你知道的梦', arc.dreams.length],
      ['shared', '我们的共同记录', '第一次 · 共同经历 · 时间线', arc.bonds.length + arc.moments.length + arc.records.length],
      ['ifw', '当前IF世界', 'TA在这个世界里的身份与变化', ifwFilled]
    ];
    let h = '<div class="narc-menu">';
    rows.forEach(row => {
      h += '<button class="narc-mrow" data-op="nav" data-view="' + row[0] + '">';
      h += '<span class="nm-main"><span class="nm-title">' + esc(row[1]) + (row[4] ? '<i class="nm-core">核心</i>' : '') + '</span>';
      h += '<span class="nm-desc">' + esc(row[2]) + '</span></span>';
      h += (row[3] > 0 ? '<span class="nm-count">' + row[3] + '</span>' : '');
      h += '<span class="nm-arrow">›</span></button>';
    });
    h += '</div>';
    return h;
  }

  // ---- 分区详情壳 ----
  function backHomeRow() {
    return '<div class="narc-backrow"><button class="narc-backhome" data-op="nav" data-view="home">‹ 返回总览</button></div>';
  }
  function sectHead(title, sub, addBtnHtml) {
    let h = '<div class="narc-sect"><div><h3>' + esc(title) + '</h3>' + (sub ? '<div class="narc-sect-sub">' + esc(sub) + '</div>' : '') + '</div>';
    if (addBtnHtml) h += addBtnHtml;
    h += '</div>';
    return h;
  }
  function fieldRowsHTML(mapObj, fields, mapName) {
    let h = '<div class="narc-fields">';
    fields.forEach(f => {
      const val = String(mapObj[f[0]] == null ? '' : mapObj[f[0]]);
      const empty = !val.trim();
      h += '<button class="narc-frow" data-op="efield" data-map="' + mapName + '" data-key="' + f[0] + '">';
      h += '<span class="nf-label">' + esc(f[1]) + '</span>';
      h += '<span class="nf-val' + (empty ? ' empty' : '') + '">' + (empty ? esc(f[2]) : esc(val)) + '</span>';
      h += '<span class="nf-edit">›</span></button>';
    });
    h += '</div>';
    return h;
  }
  function tabsHTML(tabs, curVal, viewKey) {
    let h = '<div class="narc-btabs">';
    tabs.forEach(t => { h += '<button class="narc-btab' + (curVal === t[0] ? ' on' : '') + '" data-op="stab" data-view="' + viewKey + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; });
    h += '</div>';
    return h;
  }
  function itemShell(inner, metaHtml) {
    return '<div class="narc-item">' + inner + '<div class="ni-meta">' + (metaHtml || '') + '</div></div>';
  }
  function opBtn(op, label, attrs, warn) {
    return '<button class="nk-op' + (warn ? ' warn' : '') + '" data-op="' + op + '"' + (attrs || '') + '>' + label + '</button>';
  }
  function sectionHTML(arc, r) {
    const SECS = {
      who: ['TA是谁', '对应「关于我」——这里记的是TA。'], tastes: ['TA的喜好', '喜欢什么、不喜欢什么、以及那些说不清的偏好。'],
      habits: ['TA的习惯', '相处久了才会注意到的部分。'], relate: ['TA与我的相处', '我的档案记「我希望怎么相处」，这里记「TA实际上怎么和我相处」。'],
      knows: ['我对TA的了解', '不是系统告诉你的设定，是你一点点发现的TA。'], pos: ['TA的位置感', '不是固定坐标，是「我感觉TA常在哪边」。'],
      things: ['TA的物品', '和TA有关的物件，也是记忆的一部分。'], dream: ['TA的梦境', 'TA做过的梦——有时候梦比话更真实。'],
      shared: ['我们的共同记录', '只记录「我们」共同发生的事——这是两个人的档案。'],
      ifw: ['当前IF世界', '世界母档在【我的档案·IF世界】；这里只写TA在这一侧的样子。']
    };
    const meta = SECS[view] || SECS.who;
    let h = backHomeRow();
    h += sectHead(meta[0], meta[1], null);
    if (view === 'who') h += whoHTML(arc);
    else if (view === 'tastes') h += tastesHTML(arc);
    else if (view === 'habits') h += habitsHTML(arc);
    else if (view === 'relate') h += relateHTML(arc);
    else if (view === 'knows') h += knowsHTML(arc);
    else if (view === 'pos') h += posHTML(arc);
    else if (view === 'things') h += thingsHTML(arc);
    else if (view === 'dream') h += dreamHTML(arc);
    else if (view === 'shared') h += sharedHTML(arc);
    else if (view === 'ifw') h += ifwHTML(arc);
    return h;
  }

  // ---- 1. TA是谁 ----
  function whoHTML(arc) {
    let h = '';
    WHO_GROUPS.forEach(g => {
      h += '<div class="narc-ghead">' + esc(g.name) + (g.sub ? '<span class="narc-gsub">' + esc(g.sub) + '</span>' : '') + '</div>';
      h += fieldRowsHTML(arc.who.f, g.fields, 'who');
    });
    return h;
  }

  // ---- 2. TA的喜好 ----
  function tastesHTML(arc) {
    let h = tabsHTML(TASTE_TABS, tab.tastes, 'tastes');
    const curLabel = (TASTE_TABS.find(t => t[0] === tab.tastes) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="taste">＋ 记一条</button>');
    const items = arc.tastes.filter(x => x.g === tab.tastes).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      const tip = tab.tastes === 'like' ? 'TA喜欢什么呢？<br>从最确定的一件开始记吧。' : (tab.tastes === 'dislike' ? 'TA不喜欢什么呢？<br>同样自由地记录。' : '例如：喜欢安静的地方。<br>比起热闹，更喜欢两个人待着。');
      return h + '<div class="narc-empty">' + tip + '</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top">' + (it.cat ? '<span class="ni-cat">' + esc(it.cat) + '</span>' : '') + '</div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="taste" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="taste" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 3. TA的习惯 ----
  function habitsHTML(arc) {
    let h = tabsHTML(HABIT_TABS, tab.habits, 'habits');
    const curLabel = (HABIT_TABS.find(t => t[0] === tab.habits) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="habit">＋ 记一条</button>');
    const items = arc.habits.filter(x => x.g === tab.habits).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      const tips = { daily: '通常什么时候出现？喜欢待在哪里？<br>独处的时候、无聊的时候会做什么？', micro: '想事情的时候会沉默、靠近的时候不马上说话……<br>这种小动作最容易拼出真实的TA。', expr: 'TA习惯怎么表达？直接说出口，还是绕个弯？', comp: 'TA是怎么陪你的？' };
      return h + '<div class="narc-empty">' + (tips[tab.habits] || '') + '</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="habit" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="habit" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 4. TA与我的相处 ----
  function relateHTML(arc) {
    let h = fieldRowsHTML(arc.relate.f, RELATE_FIELDS, 'relate');
    h += '<div class="narc-ghead">相处里的瞬间<span class="narc-gsub">那些说不进分类里的小事</span></div>';
    h += '<div style="margin:0 2px 10px;text-align:right"><button class="narc-add" data-op="add-li" data-kind="rnote">＋ 记一件小事</button></div>';
    if (!arc.relate.notes.length) h += '<div class="narc-empty">例如：TA不一定会直接说喜欢，但是会待在我旁边。</div>';
    arc.relate.notes.slice().sort((a, b) => b.created - a.created).forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="rnote" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="rnote" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 5. 我对TA的了解（核心） ----
  function knowsHTML(arc) {
    const KT = [['cards', '发现卡片'], ['wonders', '还不了解'], ['changes', '理解变化']];
    let h = tabsHTML(KT, tab.knows, 'knows');
    if (tab.knows === 'cards') return h + cardsHTML(arc);
    if (tab.knows === 'wonders') return h + wondersHTML(arc);
    return h + changesHTML(arc);
  }

  function cardsHTML(arc) {
    let h = sectHead('我发现…', '每一条都是你自己的发现——不必全是事实，感觉也算数。', '<button class="narc-add" data-op="add-know">＋ 记录新的发现</button>');
    const items = arc.loves.slice().sort((a, b) => b.created - a.created);
    if (!items.length) return h + '<div class="narc-empty">还没有发现卡片。<br>从今天的一个小观察开始：TA今天做了什么？</div>';
    items.forEach(it => {
      const retired = it.status === 'retired';
      h += '<div class="narc-k' + (retired ? ' retired' : '') + '">';
      h += '<div class="nk-top"><span class="nk-type">' + esc(typeLabel(it.type)) + '……</span>';
      h += '<span class="nk-src">' + esc(SRC_MAP[it.src] || '我观察到的') + '</span>';
      h += '<span class="nk-dots">' + dotsStr(it.dots) + '</span>';
      h += '</div>';
      h += '<div class="nk-text">' + esc(it.text) + '</div>';
      const note = (it.note != null && String(it.note).trim()) ? it.note : (it.why || '');
      if (note) h += '<div class="nk-why">' + esc(note) + '</div>';
      h += '<div class="nk-meta"><span class="nk-date">' + (retired ? '' : '记录于 ' + mdstr(it.updated || it.created)) + '</span>';
      h += '<span class="nk-ops">';
      if (retired) {
        h += opBtn('restore-know', '恢复适用', ' data-id="' + it.id + '"') + opBtn('del-know', '删除', ' data-id="' + it.id + '"', 1);
      } else {
        h += opBtn('edit-know', '编辑', ' data-id="' + it.id + '"') + opBtn('revise-know', '重新理解', ' data-id="' + it.id + '"') + opBtn('retire-know', '暂不适用', ' data-id="' + it.id + '"') + opBtn('del-know', '删除', ' data-id="' + it.id + '"', 1);
      }
      h += '</span></div></div>';
    });
    return h;
  }

  // 还不了解（沿用旧数据 wonders）
  function wondersHTML(arc) {
    let h = sectHead('我还不了解TA的地方', '档案里的留白——留给未来的你们。', '<button class="narc-add" data-op="add-wonder">＋ 记一个想了解的事</button>');
    const open = arc.wonders.filter(w => !w.solved);
    const solved = arc.wonders.filter(w => w.solved);
    if (!open.length && !solved.length) {
      return h + '<div class="narc-empty">不要急着把TA研究透。<br>把正想知道、还没答案的问题留在这里。</div>';
    }
    open.forEach(w => {
      const inner = '<div class="ni-top"><span class="ni-tag">还不了解</span></div><div class="ni-text">' + esc(w.text) + '</div>';
      h += itemShell(inner, '<span class="ni-date">' + mdstr(w.created) + '</span><span class="nk-ops">' + opBtn('solve-wonder', '已了解', ' data-id="' + w.id + '"') + opBtn('del-wonder', '删除', ' data-id="' + w.id + '"', 1) + '</span>');
    });
    if (solved.length) {
      h += '<div class="narc-sect" style="margin-top:16px"><h3 style="opacity:.7">已解开的疑问</h3></div>';
      solved.forEach(w => {
        const inner = '<div class="ni-top"><span class="ni-tag">已了解</span></div><div class="ni-text">' + esc(w.text) + '</div>';
        h += '<div class="narc-item solved">' + inner + '<div class="ni-meta"><span class="ni-date">' + (w.solvedAt ? mdstr(w.solvedAt) + ' 有了答案' : '') + '</span><span class="nk-ops">' + opBtn('reopen-wonder', '重新打开', ' data-id="' + w.id + '"') + opBtn('del-wonder', '删除', ' data-id="' + w.id + '"', 1) + '</span></div></div>';
      });
    }
    return h;
  }

  // 理解变化（沿用旧数据 history）
  function changesHTML(arc) {
    const hist = arc.history.slice().sort((a, b) => b.time - a.time);
    if (!hist.length) {
      return '<div class="narc-empty">还没有理解上的变化。<br>当有一天你发现自己——「原来TA不是我以为的那样」——它会出现在这里。</div>';
    }
    let h = '';
    hist.forEach(ev => {
      h += '<div class="narc-hist"><span class="nh-dot"></span><div class="nh-wrap"><div class="nh-date">' + mdstr(ev.time) + '</div><div class="nh-text">' + String(ev.text || '').replace(/〈([^〈]*)〉/g, '<em>「$1」</em>') + '</div></div></div>';
    });
    return h;
  }

  // ---- 6. TA的位置感 ----
  function posHTML(arc) { return fieldRowsHTML(arc.pos, POS_FIELDS, 'pos'); }

  // ---- 7. TA的物品 ----
  function thingsHTML(arc) {
    let h = tabsHTML(THING_TABS, tab.things, 'things');
    const curLabel = (THING_TABS.find(t => t[0] === tab.things) || [])[1] || '';
    h += sectHead(curLabel, '', '<button class="narc-add" data-op="add-li" data-kind="thing">＋ 记一件</button>');
    const items = arc.things.filter(x => x.g === tab.things).slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">TA常用的东西、TA送你的东西、你们共有的东西……<br>都可以记在这里。</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="thing" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="thing" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 8. TA的梦境 ----
  function dreamHTML(arc) {
    let h = sectHead('TA的梦境', 'TA做过的梦——有时候梦比话更真实。', '<button class="narc-add" data-op="add-dream">＋ 记一个梦</button>');
    const items = arc.dreams.slice().sort((a, b) => b.created - a.created);
    if (!items.length) {
      return h + '<div class="narc-empty">TA说过的、被你记住的那些梦。<br>梦见你了吗？梦里有你吗？</div>';
    }
    items.forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.text) + '</div>';
      h += itemShell(inner, '<span class="ni-date">' + esc(it.date) + '</span><span class="nk-ops">' + opBtn('edit-dream', '编辑', ' data-id="' + it.id + '"') + opBtn('del-dream', '删除', ' data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }
  // ---- 9. 我们的共同记录（沿用 bonds/moments/records，新增 day/thing/place 分类与时间线） ----
  function timelineItems(arc) {
    const arr = [];
    arc.bonds.forEach(b => arr.push({ t: b.created, text: b.text, date: b.date || '', tag: BOND_CATS[b.cat] || '共同经历', kind: 'bond', id: b.id }));
    arc.moments.forEach(m => arr.push({ t: m.created, text: m.text, date: m.date || '', tag: '重要时刻', star: true, kind: 'moment', id: m.id }));
    arc.records.forEach(rc => arr.push({ t: rc.created, text: rc.text, date: rc.date || '', tag: '相处记录', kind: 'record', id: rc.id, momentId: rc.momentId }));
    return arr.sort((a, b) => b.t - a.t);
  }
  function sharedHTML(arc) {
    let h = tabsHTML(SHARED_TABS, tab.shared, 'shared');
    if (tab.shared === 'timeline') {
      h += sectHead('我们的时间线', '第一次、共同经历、特别的日子，都在这里连成一条线。', '<button class="narc-add" data-op="add-record">＋ 写一条相处</button>');
      const arr = timelineItems(arc);
      if (!arr.length) return h + '<div class="narc-empty">还没有共同记录。<br>第一次见面、第一次聊天、第一次被TA主动找……都值得记下来。</div>';
      arr.forEach(x => {
        let inner = '<div class="ni-top">';
        if (x.kind === 'record') {
          inner += '<button class="ni-star' + (x.momentId ? ' on' : '') + '" data-op="toggle-moment" data-kind="record" data-id="' + x.id + '" title="记为重要时刻">⭐</button>';
        } else if (x.star) {
          inner += '<span class="ni-star on">⭐</span>';
        }
        inner += '<span class="ni-tag">' + esc(x.tag) + '</span></div>';
        inner += '<div class="ni-text">' + esc(x.text) + '</div>';
        const ops = '<span class="nk-ops">' + opBtn('edit-entry', '编辑', ' data-kind="' + x.kind + '" data-id="' + x.id + '"') + opBtn('del-entry', '删除', ' data-kind="' + x.kind + '" data-id="' + x.id + '"', 1) + '</span>';
        h += itemShell(inner, '<span class="ni-date">' + esc(x.date) + '</span>' + ops);
      });
      return h;
    }
    const catLabel = BOND_CATS[tab.shared];
    h += sectHead(catLabel, '', '<button class="narc-add" data-op="add-bond" data-cat="' + tab.shared + '">＋ 记一条「' + catLabel + '」</button>');
    const items = arc.bonds.filter(b => b.cat === tab.shared).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (!items.length) {
      const tips = { first: '第一次见面、第一次聊天、第一次被TA主动找、第一次一起玩游戏……', habit: '你们之间自然形成的共同习惯。', secret: '只有我们知道的事。', day: '值得标记的日子。', thing: '有故事的物件。', place: '有回忆的地方。' };
      return h + '<div class="narc-empty">' + (tips[tab.shared] || '') + '<br>点上面「＋」记下来。</div>';
    }
    items.forEach(b => {
      const inner = '<div class="ni-top"><span class="ni-tag">' + esc(BOND_CATS[b.cat]) + '</span></div><div class="ni-text">' + esc(b.text) + '</div>';
      h += itemShell(inner, '<span class="ni-date">' + esc(b.date || '') + '</span><span class="nk-ops">' + opBtn('edit-entry', '编辑', ' data-kind="bond" data-id="' + b.id + '"') + opBtn('del-entry', '删除', ' data-kind="bond" data-id="' + b.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 10. 当前IF世界 ----
  function ifwHTML(arc) {
    let h = fieldRowsHTML(arc.ifw, IFW_FIELDS, 'ifw');
    h += '<div class="narc-ghead">TA在这个世界的变化<span class="narc-gsub">例如：在这个世界TA可以被看见 / 住在我家隔壁</span></div>';
    h += '<div style="margin:0 2px 10px;text-align:right"><button class="narc-add" data-op="add-li" data-kind="ifch">＋ 记一条变化</button></div>';
    if (!arc.ifchanges.length) h += '<div class="narc-empty">换到IF世界后，TA有什么不一样？</div>';
    arc.ifchanges.slice().sort((a, b) => b.created - a.created).forEach(it => {
      const inner = '<div class="ni-top"></div><div class="ni-text">' + esc(it.t) + '</div>';
      h += itemShell(inner, '<span class="nk-ops">' + opBtn('edit-li', '编辑', ' data-kind="ifch" data-id="' + it.id + '"') + opBtn('del-li', '删除', ' data-kind="ifch" data-id="' + it.id + '"', 1) + '</span>');
    });
    return h;
  }

  // ---- 字段编辑 ----
  function fieldMapOf(mapName, arc) {
    if (mapName === 'who') return arc.who.f;
    if (mapName === 'relate') return arc.relate.f;
    if (mapName === 'pos') return arc.pos;
    return arc.ifw;
  }
  function editField(mapName, key) {
    const def = FIELD_INDEX[key]; if (!def || !window.openModal) return;
    const arc = ensureArc(cur);
    const m = fieldMapOf(mapName, arc);
    window.openModal(def.label, m[key] || '', function (v) {
      m[key] = strim(v);
      saveArc(cur, arc); toast('已记下'); render();
    }, def.multi ? { textarea: true, textareaPlaceholder: def.ph } : { placeholder: def.ph, maxlength: 120 });
  }
  // ---- 列表项（喜好/习惯/物品/瞬间/IF变化） ----
  function listOf(kind, arc) {
    if (kind === 'taste') return arc.tastes;
    if (kind === 'habit') return arc.habits;
    if (kind === 'thing') return arc.things;
    if (kind === 'rnote') return arc.relate.notes;
    return arc.ifchanges;
  }
  function liPh(kind) {
    if (kind === 'taste') return tab.tastes === 'like' ? '例如：布丁 / 雨天的窗边' : (tab.tastes === 'dislike' ? '例如：被催着做决定' : '例如：比起热闹，更喜欢两个人待着。');
    if (kind === 'habit') return HABIT_PH[tab.habits];
    if (kind === 'thing') return THING_PH[tab.things];
    if (kind === 'rnote') return '例如：TA不一定会直接说喜欢，但是会待在我旁边。';
    return '例如：在这个世界TA可以被看见了。';
  }
  function liTitle(kind) {
    if (kind === 'taste') return (TASTE_TABS.find(t => t[0] === tab.tastes) || [])[1] || '';
    if (kind === 'habit') return (HABIT_TABS.find(t => t[0] === tab.habits) || [])[1] || '';
    if (kind === 'thing') return (THING_TABS.find(t => t[0] === tab.things) || [])[1] || '';
    if (kind === 'rnote') return '相处里的一件小事';
    return 'TA在这个世界的变化';
  }
  function addLi(kind) {
    if (!window.openModal) return;
    const useCat = kind === 'taste' && tab.tastes === 'like';
    let cat = '', phase = useCat ? 'cat' : 'text', ctl = null;
    ctl = window.openModal(liTitle(kind), '', function (v) {
      if (phase === 'cat') {
        if (!v) return;
        cat = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]); ctl.title('具体是什么呢？');
        ctl.input(true); ctl.maxLen(100); ctl.ph(liPh(kind)); ctl.okText('保存');
        return;
      }
      const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
      const arc = ensureArc(cur);
      const item = { id: makeId(), t: t, created: Date.now() };
      if (kind === 'taste') { item.g = tab.tastes; item.cat = (tab.tastes === 'like') ? (cat || '其他') : ''; }
      else if (kind === 'habit') item.g = tab.habits;
      else if (kind === 'thing') item.g = tab.things;
      listOf(kind, arc).push(item);
      saveArc(cur, arc); toast('已记下'); render();
    }, useCat ? { noInput: true, pills: LIKE_CATS.map(c => ({ label: c, value: c })) } : { placeholder: liPh(kind), maxlength: 120 });
  }
  function editLi(kind, id) {
    const arc = ensureArc(cur); const it = listOf(kind, arc).find(x => x.id === id); if (!it || !window.openModal) return;
    const reCat = kind === 'taste' && it.g === 'like';
    let phase = reCat ? 'cat' : 'text', newCat = it.cat || '', ctl = null;
    ctl = window.openModal('编辑', it.t, function (v) {
      if (phase === 'cat') {
        if (!v) return;
        newCat = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]); ctl.title('内容');
        ctl.input(true); ctl.text(it.t); ctl.maxLen(120); ctl.ph('内容'); ctl.okText('保存');
        return;
      }
      const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
      it.t = t; if (reCat) it.cat = newCat;
      saveArc(cur, arc); toast('已更新'); render();
    }, reCat ? { noInput: true, pill: it.cat, pills: LIKE_CATS.map(c => ({ label: c, value: c })) } : { placeholder: '内容', maxlength: 120 });
  }
  function delLi(kind, id) {
    if (!window.openModal) return;
    window.openModal('删除这条？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      const arr = listOf(kind, arc);
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr.splice(i, 1);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }
  // ---- 了解卡片（核心）流程 ----
  function addKnow(prefill) {
    if (!window.openModal) return;
    let phase = 'type', pType = '', pText = '', pNote = '', pSrc = 'seen', ctl = null;
    ctl = window.openModal('记录一条新的发现', prefill || '', function (v) {
      if (phase === 'type') {
        if (!v) return;
        pType = String(v); phase = 'text';
        ctl.stay(); ctl.pills([]);
        ctl.title(typeLabel(pType) + '……');
        ctl.hint('写下你的发现，一句话就好。');
        ctl.input(true); ctl.maxLen(140); ctl.ph('例如：喜欢在下雨天待在窗边');
        if (prefill) ctl.text(prefill);
        ctl.okText('下一步');
        return;
      }
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        pText = t; phase = 'note';
        ctl.stay(); ctl.title('我的备注（可选）'); ctl.hint('后来发现的事、当时的场景，都可以补在这里。');
        ctl.text(''); ctl.maxLen(160); ctl.ph('可留空'); ctl.okText('下一步');
        return;
      }
      if (phase === 'note') {
        pNote = strim(v); phase = 'src';
        ctl.stay(); ctl.input(false); ctl.pills(SRC_PILLS, pSrc);
        ctl.title('这条发现是怎么来的？'); ctl.hint('不必都是「事实」——你的感觉也算数。');
        ctl.okText('下一步');
        return;
      }
      if (phase === 'src') {
        if (!v) return;
        pSrc = String(v); phase = 'dots';
        ctl.stay(); ctl.pills(DOT_PILLS, String(SRC_DOT[pSrc] || 3));
        ctl.title('现在有多确定？'); ctl.hint('了解程度不是好感度——只是「我有多大把握」。');
        ctl.okText('保存');
        return;
      }
      if (phase === 'dots') {
        const d = Math.max(1, Math.min(5, parseInt(v, 10) || 3));
        const arc = ensureArc(cur); const now = Date.now();
        arc.loves.push({ id: makeId(), type: pType, text: pText, note: pNote, why: pNote, src: pSrc, dots: d, level: legacyLevelOf(d), created: now, updated: now, status: 'active', revisions: [] });
        arc.history.push({ time: now, text: '「' + typeLabel(pType) + '」新增了解：' + short(pText) });
        saveArc(cur, arc); toast('记下了一条了解'); render();
      }
    }, { noInput: true, pills: KTYPES.map(t => ({ label: t[1], value: t[0] })) });
  }

  function editKnowFlow(id, revise) {
    const arc0 = ensureArc(cur); const it = arc0.loves.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', nt = '', nn = '', ns = it.src || 'seen', nd = (it.dots != null ? it.dots : 3), ctl = null;
    ctl = window.openModal(revise ? '重新理解TA' : '编辑这条了解', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        nt = t; phase = 'note';
        ctl.stay(); ctl.title('我的备注（可选）'); ctl.hint(revise ? '旧的看法会保留在「理解变化」里。' : '改动理解，也可以留一句话理由。');
        ctl.text(it.note != null ? (it.note || '') : (it.why || '')); ctl.maxLen(160); ctl.ph('可留空'); ctl.okText('下一步');
        return;
      }
      if (phase === 'note') {
        nn = strim(v); phase = 'src';
        ctl.stay(); ctl.input(false); ctl.pills(SRC_PILLS, ns);
        ctl.title('这条发现是怎么来的？'); ctl.okText('下一步');
        return;
      }
      if (phase === 'src') {
        if (!v) return;
        ns = String(v); phase = 'dots';
        ctl.stay(); ctl.pills(DOT_PILLS, String(nd));
        ctl.title('现在有多确定？'); ctl.okText('保存');
        return;
      }
      if (phase === 'dots') {
        nd = Math.max(1, Math.min(5, parseInt(v, 10) || nd || 3));
        const arc = ensureArc(cur); const t2 = arc.loves.find(x => x.id === id); if (!t2) return;
        const now = Date.now();
        if (revise) {
          t2.revisions.push({ text: t2.text, why: t2.why || '', note: t2.note || '', level: t2.level, dots: t2.dots, src: t2.src, time: now });
          arc.history.push({ time: now, text: '「' + typeLabel(t2.type) + '」重新理解：〈' + short(t2.text) + '〉→〈' + short(nt) + '〉' });
        } else if (t2.text !== nt) {
          arc.history.push({ time: now, text: '「' + typeLabel(t2.type) + '」修改：〈' + short(t2.text) + '〉→〈' + short(nt) + '〉' });
        }
        t2.text = nt; t2.note = nn; t2.why = nn; t2.src = ns; t2.dots = nd; t2.level = legacyLevelOf(nd);
        t2.updated = now; if (revise) t2.status = 'active';
        saveArc(cur, arc); toast(revise ? '更新了对TA的理解' : '已更新'); render();
      }
    }, { placeholder: '你发现的TA', maxlength: 140 });
  }
  function retireKnow(id) {
    const arc = ensureArc(cur); const it = arc.loves.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'ask', ctl = null;
    ctl = window.openModal('暂不适用这条了解？', '', function (v) {
      if (phase === 'ask') {
        if (v !== 'yes') return;
        phase = 'note';
        ctl.stay(); ctl.title('想留句话吗？（可选）');
        ctl.hint('以后还能回来看，当初为什么暂停。');
        ctl.input(true); ctl.maxLen(120); ctl.ph('可留空'); ctl.okText('确认'); ctl.text('');
        return;
      }
      if (phase === 'note') {
        it.note = strim(v);
        it.status = 'retired'; it.updated = Date.now();
        arc.history.push({ time: it.updated, text: '「' + typeLabel(it.type) + '」暂时不再适用：' + short(it.text) });
        saveArc(cur, arc); toast('已暂不适用'); render();
      }
    }, { noInput: true, pill: 'yes', pills: [{ label: '取消', value: 'no' }, { label: '暂不适用', value: 'yes' }] });
  }
  function restoreKnow(id) {
    const arc = ensureArc(cur); const it = arc.loves.find(x => x.id === id); if (!it) return;
    it.status = 'active'; it.updated = Date.now();
    arc.history.push({ time: it.updated, text: '「' + typeLabel(it.type) + '」恢复适用：' + short(it.text) });
    saveArc(cur, arc); toast('已恢复'); render();
  }
  function delKnow(id) {
    if (!window.openModal) return;
    window.openModal('删除这条了解？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      arc.loves = arc.loves.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }

  // ---- 共同记录流程 ----
  function addBond(cat) {
    if (!window.openModal) return;
    let phase = 'text', text = '', ctl = null;
    ctl = window.openModal('记一条「' + BOND_CATS[cat] + '」', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'date';
        ctl.stay(); ctl.title('发生在哪一天？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc(cur);
        arc.bonds.push({ id: makeId(), cat: cat, text: text, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        saveArc(cur, arc); toast('已记下'); render();
      }
    }, { placeholder: BOND_PH[cat] || '', maxlength: 100 });
  }
  function addRecord() {
    if (!window.openModal) return;
    let phase = 'text', text = '', ctl = null;
    ctl = window.openModal('记一条相处', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'date';
        ctl.stay(); ctl.title('在哪一天？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月25日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc(cur);
        arc.records.push({ id: makeId(), text: text, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        saveArc(cur, arc); toast('已记下'); render();
      }
    }, { placeholder: '今天和TA聊了很久……', maxlength: 120 });
  }
  function editEntry(kind, id) {
    const arc = ensureArc(cur);
    const arr = kind === 'bond' ? arc.bonds : (kind === 'moment' ? arc.moments : arc.records);
    const it = arr.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', newText = '', ctl = null;
    ctl = window.openModal('编辑', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        newText = t; phase = 'date';
        ctl.stay(); ctl.title('在哪一天？');
        ctl.text(it.date || mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        it.text = newText; it.date = strim(v) || mdstr(Date.now());
        saveArc(cur, arc); toast('已更新'); render();
      }
    }, { placeholder: '内容', maxlength: 120 });
  }
  function delEntry(kind, id) {
    if (!window.openModal) return;
    window.openModal('删除这条？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      if (kind === 'bond') arc.bonds = arc.bonds.filter(x => x.id !== id);
      else if (kind === 'moment') arc.moments = arc.moments.filter(x => x.id !== id);
      else arc.records = arc.records.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }
  function toggleMoment(recId) {
    const arc = ensureArc(cur); const rec = arc.records.find(x => x.id === recId); if (!rec) return;
    if (rec.momentId) {
      arc.moments = arc.moments.filter(m => m.id !== rec.momentId);
      rec.momentId = '';
    } else {
      const m = { id: makeId(), text: rec.text, date: rec.date || mdstr(Date.now()), created: Date.now() };
      arc.moments.push(m); rec.momentId = m.id;
      arc.history.push({ time: Date.now(), text: '重要时刻：' + short(rec.text) });
    }
    saveArc(cur, arc); render();
  }
  // ---- 梦境流程：内容 → 日期 ----
  function addDream() {
    if (!window.openModal) return;
    let phase = 'text', text = '', ctl = null;
    ctl = window.openModal('记一个梦', '', function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        text = t; phase = 'date';
        ctl.stay(); ctl.title('梦到哪天？'); ctl.hint('留空默认今天。');
        ctl.text(mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        const arc = ensureArc(cur);
        arc.dreams.push({ id: makeId(), text: text, date: strim(v) || mdstr(Date.now()), created: Date.now() });
        saveArc(cur, arc); toast('记住了一个梦'); render();
      }
    }, { placeholder: 'TA梦见……', maxlength: 200 });
  }
  function editDream(id) {
    const arc = ensureArc(cur); const it = arc.dreams.find(x => x.id === id); if (!it || !window.openModal) return;
    let phase = 'text', newText = '', ctl = null;
    ctl = window.openModal('编辑这个梦', it.text, function (v) {
      if (phase === 'text') {
        const t = strim(v); if (!t) { ctl.stay(); ctl.focus(); return; }
        newText = t; phase = 'date';
        ctl.stay(); ctl.title('梦到哪天？');
        ctl.text(it.date || mdstr(Date.now())); ctl.maxLen(30); ctl.input(true); ctl.ph('如 8月3日'); ctl.okText('保存');
        return;
      }
      if (phase === 'date') {
        it.text = newText; it.date = strim(v) || mdstr(Date.now());
        saveArc(cur, arc); toast('已更新'); render();
      }
    }, { placeholder: 'TA梦见……', maxlength: 200 });
  }
  function delDream(id) {
    if (!window.openModal) return;
    window.openModal('删掉这个梦？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      arc.dreams = arc.dreams.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }
  // ---- 还不了解流程 ----
  function addWonder() {
    if (!window.openModal) return;
    window.openModal('记一个想了解的事', '', function (v) {
      const t = strim(v); if (!t) return;
      const arc = ensureArc(cur);
      arc.wonders.push({ id: makeId(), text: t, solved: false, created: Date.now(), solvedAt: null });
      saveArc(cur, arc); toast('记下了，留给未来的你们'); render();
    }, { placeholder: '例如：TA真正害怕的是什么？', maxlength: 80 });
  }
  function solveWonder(id) {
    const arc = ensureArc(cur); const w = arc.wonders.find(x => x.id === id); if (!w || !window.openModal) return;
    window.openModal('「' + short(w.text, 20) + '」已经有答案了吗？', '', function (v) {
      if (v === 'only') { w.solved = true; w.solvedAt = Date.now(); saveArc(cur, arc); toast('已了解'); render(); return; }
      if (v === 'convert') {
        w.solved = true; w.solvedAt = Date.now(); saveArc(cur, arc); render();
        setTimeout(function () { addKnow(w.text); }, 0); // 链式开新弹窗必须延后一拍（外层 finally close 会清 cb）
      }
    }, { noInput: true, pill: 'only', pills: [{ label: '只是已了解', value: 'only' }, { label: '已了解 · 也记为了解', value: 'convert' }] });
  }
  function reopenWonder(id) {
    const arc = ensureArc(cur); const w = arc.wonders.find(x => x.id === id); if (!w) return;
    w.solved = false; w.solvedAt = null; saveArc(cur, arc); render();
  }
  function delWonder(id) {
    if (!window.openModal) return;
    window.openModal('删除这个疑问？', '', function (v) {
      if (v !== 'del') return;
      const arc = ensureArc(cur);
      arc.wonders = arc.wonders.filter(x => x.id !== id);
      saveArc(cur, arc); toast('已删除'); render();
    }, { noInput: true, pill: 'del', pills: [{ label: '取消', value: 'no' }, { label: '删除', value: 'del' }] });
  }

  // ---- 事件分发 ----
  function dispatch(op, el) {
    const id = el.getAttribute('data-id');
    const kind = el.getAttribute('data-kind');
    switch (op) {
      case 'nav': view = el.getAttribute('data-view') || 'home'; render(); break;
      case 'stab': { const tv = el.getAttribute('data-view'), tb = el.getAttribute('data-tab'); if (tv && tab[tv] != null) tab[tv] = tb; render(); break; }
      case 'pick-roster': {
        // 虚拟 chip（rid 为空 + 带 cid）：点击即把该桌面联系人落成真身再选中——
        // 已被用户删过的桌面（有 cjian-seeded 标记）不会复活，materializeDesk 返回空串
        const rid = el.getAttribute('data-rid') || '';
        const cid = el.getAttribute('data-cid') || '';
        cur = rid || (cid ? materializeDesk(cid) : '');
        if (cur) setCur(cur);
        tab.tastes = 'like'; tab.habits = 'daily'; tab.things = 'use'; tab.shared = 'first'; tab.knows = 'cards';
        render();
        break;
      }
      case 'add-roster': if (window.cjianManage) window.cjianManage(); break;
      case 'efield': editField(el.getAttribute('data-map'), el.getAttribute('data-key')); break;
      case 'add-li': addLi(el.getAttribute('data-kind')); break;
      case 'edit-li': editLi(el.getAttribute('data-kind'), id); break;
      case 'del-li': delLi(el.getAttribute('data-kind'), id); break;
      case 'add-know': addKnow(''); break;
      case 'edit-know': editKnowFlow(id, false); break;
      case 'revise-know': editKnowFlow(id, true); break;
      case 'retire-know': retireKnow(id); break;
      case 'restore-know': restoreKnow(id); break;
      case 'del-know': delKnow(id); break;
      case 'add-bond': addBond(el.getAttribute('data-cat')); break;
      case 'add-record': addRecord(); break;
      case 'edit-entry': editEntry(kind, id); break;
      case 'del-entry': delEntry(kind, id); break;
      case 'toggle-moment': if (kind === 'record') toggleMoment(id); break;
      case 'add-dream': addDream(); break;
      case 'edit-dream': editDream(id); break;
      case 'del-dream': delDream(id); break;
      case 'add-wonder': addWonder(); break;
      case 'solve-wonder': solveWonder(id); break;
      case 'reopen-wonder': reopenWonder(id); break;
      case 'del-wonder': delWonder(id); break;
    }
  }

  // ---- 绑定 ----
  function bind() {
    const back = document.getElementById('narc-back');
    if (back) back.addEventListener('click', function () { window.closeNarc(); });
    const manage = document.getElementById('narc-manage');
    if (manage) manage.addEventListener('click', function (e) { e.stopPropagation(); if (window.cjianManage) window.cjianManage(); });
    const appIcon = document.querySelector('.app[data-app="memo-arc"]');
    if (appIcon) {
      appIcon.addEventListener('click', function () {
        const editing = Array.prototype.some.call(document.querySelectorAll('.app-grid'), g => g.classList.contains('editing'));
        if (editing) return;
        window.openNarc();
      });
    }
    if (root) {
      root.addEventListener('click', function (e) {
        const b = e.target.closest('[data-op]');
        if (!b) return;
        dispatch(b.getAttribute('data-op'), b);
      });
    }
  }

  function boot() { bind(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
