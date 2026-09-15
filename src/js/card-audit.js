// ===== 功能：设置 → 工具 →【所有字卡使用状态自检系统】 =====
// 需求（用户）：字卡分「自定义字卡」和「系统预设字卡」，系统预设又被二级密码（#319 防未
//   成年人锁）整体锁住，且分组/分类非常多——要一个统一自检页，一次看清「每类字卡现在到底
//   能不能被联系人用到、卡在链路哪一步、坏在哪」，并能一键跳去修 / 就地修。
// 设计：只读诊断 + 安全修复。诊断不写任何键；修复只在用户点按钮时写「恢复可用」类键
//   （概率回默认、开关打开、分组启用、单卡关闭清空），全部走 activeStore/xyStore，不改动
//   任何自定义字卡内容。
// 数据来源（读现有键/现有 API，不复制业务逻辑到本文件）：
//   · 锁：window.cardLockOpen()（card-lock.js #319）
//   · 系统预设开关/概率：activeStore 的 dc-* / dcf-* / dict-* / mc-* / rc-*/rcard-* / tm-* 等
//   · 卡数：window.DEFAULT_CARD_DATA / MOOD_FOLLOWUP_DATA / TA_MOOD_DATA
//   · 卡数据健康：window.__ccAuditHealth()（chatcard.js，媒体池丢失令牌/语音坏数据/超大图）
//   · 自定义字卡：window.getScopedGroups(type, scope)（已按停用分组过滤 + 令牌化池视图）
// 安全：绝不对各桌面 cc-groups 巨型串 JSON.parse（实测单键 150MB+）——各桌面概览只报体积
//   （字符串 length 为 O(1)），明细仅按需解析（体积上限保护）。
(function () {
  var page = document.getElementById('page-card-audit');
  if (!page) return;
  var row = document.getElementById('row-card-audit');
  var back = document.getElementById('card-audit-back');
  var bodyEl = document.getElementById('card-audit-body');
  var refreshBtn = document.getElementById('card-audit-refresh');
  var copyBtn = document.getElementById('card-audit-copy');
  var filterBtn = document.getElementById('card-audit-filter');
  if (!bodyEl) return;

  var GNS = 'xy-home-v2';
  var lastText = '';
  var sections = [];   // 本次 build 的分节 HTML
  var lines = [];      // 本次 build 的纯文本报告
  var fixMap = {};     // 修复按钮 id → 执行函数（每次 build 重建）
  var bulkFixes = [];  // 「一键修复系统预设可用」批量执行列表
  var issueCount = 0;
  var issues = [];
  var onlyProblems = false; // 「只看有问题」筛选

  // ---------- 基础读取 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function activeCid() { try { return window.getActiveContact ? window.getActiveContact() : (window.__activeCid || 'default'); } catch (e) { return 'default'; } }
  function activePrefix() { try { return window.activePrefix ? window.activePrefix() : (GNS + ':' + activeCid()); } catch (e) { return GNS + ':' + activeCid(); } }
  function store(k) { try { return window.activeStore().get(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { window.activeStore().set(k, String(v)); return true; } catch (e) { return false; } }
  function glob(k) { try { return window.xyStore(GNS).get(k); } catch (e) { return null; } }
  function globSet(k, v) { try { window.xyStore(GNS).set(k, String(v)); return true; } catch (e) { return false; } }
  function rawFor(cid, k) { try { var s = window.storeFor ? window.storeFor(cid) : window.xyStore(GNS + ':' + cid); return s.get(k); } catch (e) { return null; } }
  function num(v, d) { if (v === null || v === undefined || v === '') return d; var n = Number(v); return isNaN(n) ? d : n; }
  function boolOf(v, d) { if (v === null || v === undefined || v === '') return d; return v === '1'; }
  function locked() { try { return !(window.cardLockOpen && window.cardLockOpen()); } catch (e) { return false; } }
  function dcpAll() { return Math.max(0, Math.min(100, num(store('reply-dcp-all'), 100))); }
  function dcfEff(raw, key) {
    var a = dcpAll();
    var eff = a >= 100 ? raw : Math.round(raw * a / 100);
    if (key !== 'deskcheck' && !boolOf(store('dcf-enabled'), true)) eff = 0;
    return Math.max(0, Math.min(100, eff));
  }
  function contacts() { try { return (window.getContacts ? window.getContacts() : []) || []; } catch (e) { return []; } }
  function deskName(cid) { try { return (window.contactNameFor ? window.contactNameFor(cid) : '') || cid; } catch (e) { return cid; } }
  function parseGroups(raw) {
    try { var g = JSON.parse(raw || 'null'); if (g && g.text) return g; } catch (e) {}
    return {};
  }

  // 单卡关闭计数：<prefix>:dc-off-<cat>:<内容>。一次自检内「一次性索引 + 缓存」，不再反复扫。
  var offCache = null; // {cat:n}
  function buildOffIndex() {
    var idx = {};
    try {
      var pre = activePrefix() + ':dc-off-';
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(pre) !== 0) continue;
        var rest = k.slice(pre.length);
        var c = rest.indexOf(':');
        var cat = c < 0 ? rest : rest.slice(0, c);
        idx[cat] = (idx[cat] || 0) + 1;
      }
    } catch (e) {}
    return idx;
  }
  function offCount(cat) { return (offCache && offCache[cat]) || 0; }
  function offKeysOf(cat) {
    var out = [];
    try {
      var pre = activePrefix() + ':dc-off-' + cat + ':';
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(pre) === 0) out.push(k.slice(activePrefix().length + 1));
      }
    } catch (e) {}
    return out;
  }

  var presetCntCache = {};
  function presetGroups(cat) {
    try { return (window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA[cat]) || []; } catch (e) { return []; }
  }
  function presetCount(cat) {
    if (presetCntCache[cat] !== undefined) return presetCntCache[cat];
    var n = 0;
    presetGroups(cat).forEach(function (g) { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; });
    presetCntCache[cat] = n;
    return n;
  }
  function dataCount(node) {
    var n = 0;
    try {
      if (Array.isArray(node)) {
        node.forEach(function (g) { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; else if (Array.isArray(g)) n += g.length; });
      } else if (node && typeof node === 'object') {
        Object.keys(node).forEach(function (k) { var v = node[k]; if (Array.isArray(v)) n += v.length; else if (v && typeof v === 'object') n += dataCount(v); });
      }
    } catch (e) {}
    return n;
  }

  // 自定义字卡分类标签与顺序
  var CC_LABEL = {
    text: '文字', kaomoji: '颜文字', emoji: 'emoji', sticker: '表情包', image: '图片', poke: '拍一拍', voice: '语音',
    fish: '摸鱼', eat: '吃饭', period: '经期', water: '喝水', garden: '花园', sync: '同频', reach: '伸手',
    cjian: '此间', room: '房间', piggy: '存钱罐', drift: '漂流瓶', interact: '互动回应', music: '音乐', mjfree: '梦角自由造句'
  };
  var CC_ORDER = Object.keys(CC_LABEL);

  // 当前桌面/公用池视图（带停用过滤；不整库 parse）
  var poolCache = {};
  function scopePool(scope, type) {
    var key = scope + '|' + type;
    if (poolCache[key] !== undefined) return poolCache[key];
    var v = [];
    try { v = (window.getScopedGroups ? window.getScopedGroups(type, scope) : []) || []; } catch (e) { v = []; }
    poolCache[key] = v;
    return v;
  }
  function offRecord(scope) {
    var raw;
    try { raw = scope === 'public' ? glob('cc-groups-public-off') : store('cc-groups-off'); } catch (e) { raw = null; }
    try { var o = raw ? JSON.parse(raw) : null; return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
  }
  function offCountIn(rec) { var n = 0; Object.keys(rec).forEach(function (t) { if (Array.isArray(rec[t])) n += rec[t].length; }); return n; }

  // 功能字卡定义（与 default-cards.js DCF_DEF / DCF_DEF_NAME 对齐；末位=是否有独立字卡池）
  var DCF = [
    ['fish', '摸鱼', 35, true], ['eat', '吃饭', 35, true], ['period', '经期', 25, true], ['water', '喝水', 35, true],
    ['garden', '花园', 40, true], ['sync', '同频', 60, true], ['reach', '伸手', 55, true], ['cjian', '此间', 100, true],
    ['room', '房间', 100, true], ['piggy', '存钱罐', 100, true], ['drift', '漂流瓶', 100, true], ['interact', '互动回应', 100, true],
    ['music', '音乐', 100, true], ['deskcheck', '跨桌面查岗', 50, true],
    ['checkin', '寻踪日常', 100, false], ['pomo', '番茄钟', 100, false], ['care', 'TA的关心（经期）', 100, false],
    ['memo', '备忘提醒', 100, false], ['ask', 'TA主动提问', 100, false]
  ];

  // 跳转目标（选择器链，逐个 .click()；'#row-...' 为设置行，走 showSettingRow）
  var JUMPS = {
    defaultCards: ['.tab[data-page="page-chatcard"]', '#li-default-cards'],
    dictCards: ['.tab[data-page="page-chatcard"]', '#li-dict-cards'],
    funCards: ['.tab[data-page="page-chatcard"]', '#li-fun-cards'],
    customPublic: ['.tab[data-page="page-chatcard"]', '#li-custom-cards-public'],
    customOwn: ['.tab[data-page="page-chatcard"]', '#li-custom-cards'],
    moodCards: ['.tab[data-page="page-chatcard"]', '#li-mood-cards'],
    replyCards: ['.tab[data-page="page-chatcard"]', '#li-reply-cards'],
    taMood: ['.tab[data-page="page-chatcard"]', '#li-ta-mood'],
    quoteCards: ['.tab[data-page="page-chatcard"]', '#li-quote-cards'],
    locCards: ['.tab[data-page="page-chatcard"]', '#li-loc-cards'],
    checkinCards: ['.tab[data-page="page-chatcard"]', '#li-checkin-cards'],
    deskcheck: ['.tab[data-page="page-chatcard"]', '#li-deskcheck'],
    taCheckin: ['.tab[data-page="page-chatcard"]', '#li-ta-checkin'],
    taAsk: ['.tab[data-page="page-chatcard"]', '#li-ta-ask'],
    taChoose: ['.tab[data-page="page-chatcard"]', '#li-ta-choose'],
    taCurious: ['.tab[data-page="page-chatcard"]', '#li-ta-curious'],
    taRoast: ['.tab[data-page="page-chatcard"]', '#li-ta-roast'],
    replySettings: '#row-general',
    storage: '#row-storage-view'
  };

  // ---------- HTML 片段 ----------
  function cls(lv) { return lv === 'ok' ? 'ca-ok' : lv === 'warn' ? 'ca-warn' : lv === 'bad' ? 'ca-bad' : 'ca-mute'; }
  function rowHtml(label, value, lv, opt) {
    opt = opt || {};
    var lab = esc(label);
    if (opt.jump) lab = '<span class="ca-jump" data-jump="' + esc(opt.jump) + '">' + lab + '</span>';
    var v = esc(value);
    var edit = opt.edit ? '<span class="ca-jump ca-edit" data-jump="' + esc(opt.edit) + '">调整</span>' : '';
    var fix = '';
    if (opt.fix) fix = '<button class="ca-fix" type="button" data-fix="' + esc(opt.fix) + '">' + esc(opt.fixLabel || '修复') + '</button>';
    return '<div class="storage-row"><span>' + lab + '</span><b class="' + cls(lv) + '">' + v + edit + fix + '</b></div>';
  }
  function funnelHtml(items) {
    var parts = [];
    items.forEach(function (it, i) {
      if (i) parts.push('<span class="sep">→</span>');
      parts.push('<span class="st ' + (it.ok ? 'ca-flow-ok' : 'ca-flow-no') + '">' + (it.ok ? '✓' : '✕') + esc(it.t) + '</span>');
    });
    return '<div class="ca-funnel">' + parts.join('') + '</div>';
  }
  function cardHtml(title, inner, note) {
    return '<div class="cal-card glass"><div class="cal-card-title">' + esc(title) + '</div>' + inner + (note ? '<div class="storage-hint">' + note + '</div>' : '') + '</div>';
  }
  function stripHtml(s) {
    return String(s)
      .replace(/<button[^>]*data-fix="[^"]*"[^>]*>[^<]*<\/button>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|span|b|em|p|li)>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  function push(title, inner, note) {
    sections.push(cardHtml(title, inner, note));
    lines.push('【' + title + '】');
    lines.push(stripHtml(inner));
    if (note) lines.push(stripHtml(note));
    lines.push('');
  }
  function addFix(id, fn) { fixMap[id] = fn; }
  function addIssue(lv, text) {
    if (lv === 'warn' || lv === 'bad') issueCount++;
    issues.push({ lv: lv, text: text });
  }

  // ---------- 修复动作 ----------
  function fixProb(id, key, def, after) {
    addFix(id, function () {
      var ok = storeSet(key, def);
      if (ok && after) { try { after(); } catch (e) {} }
      return ok ? true : 'fail';
    });
  }
  function fixEnable(id, key, after) {
    addFix(id, function () { var ok = storeSet(key, '1'); if (ok && after) { try { after(); } catch (e) {} } return ok ? true : 'fail'; });
  }
  function fixGroupOff(id, scope, type) {
    addFix(id, function () {
      var key = scope === 'public' ? 'cc-groups-public-off' : 'cc-groups-off';
      var raw = scope === 'public' ? glob(key) : store(key);
      var o = {}; try { o = JSON.parse(raw || '{}') || {}; } catch (e) { o = {}; }
      if (!o[type]) return false;
      delete o[type];
      var json = JSON.stringify(o);
      var ok = scope === 'public' ? globSet(key, json) : storeSet(key, json);
      try { if (window.ccReloadGroupsAfterExternalWrite) window.ccReloadGroupsAfterExternalWrite(); } catch (e) {}
      return ok ? true : 'fail';
    });
  }
  function fixCardOffs(id, cat) {
    addFix(id, function () {
      var ks = offKeysOf(cat);
      if (!ks.length) return false;
      var ok = false;
      ks.forEach(function (short) { if (storeSet(short, '0')) ok = true; });
      return ok ? true : 'fail';
    });
  }
  function registerBulk(id) { bulkFixes.push(id); }

  // ---------- 报告构建 ----------
  function build() {
    offCache = buildOffIndex();
    presetCntCache = {}; poolCache = {};
    sections = []; lines = []; fixMap = {}; bulkFixes = []; issueCount = 0; issues = [];

    var lock = locked();
    var dcEn = boolOf(store('dc-enabled'), true);
    var dcfEn = boolOf(store('dcf-enabled'), true);
    var mcEn = boolOf(store('mc-enabled'), true);
    var all = dcpAll();
    var customTotal = 0;
    try { customTotal = window.cardLockCustomCount ? window.cardLockCustomCount() : 0; } catch (e) { customTotal = 0; }
    var contactsArr = contacts();
    var pubOff = offRecord('public');
    var ownOff = offRecord('own');

    // 当前桌面可用量（一次）
    var ownUsable = 0, pubUsable = 0;
    CC_ORDER.forEach(function (t) {
      scopePool('own', t).forEach(function (g) { ownUsable += (g && Array.isArray(g[1]) ? g[1].length : 0); });
      scopePool('public', t).forEach(function (g) { pubUsable += (g && Array.isArray(g[1]) ? g[1].length : 0); });
    });
    var ownGroups = CC_ORDER.reduce(function (n, t) { return n + scopePool('own', t).length; }, 0);
    var pubGroups = CC_ORDER.reduce(function (n, t) { return n + scopePool('public', t).length; }, 0);

    // ===== 问题清单（先算，结论卡与角标都用） =====
    if (lock) addIssue('bad', '系统预设字卡被「二级密码锁」整体锁定（#319 防未成年人保护）——默认聊天字卡、词典（含词典拼字）等系统预设池当前都取不到，下方开关全开也无效。到开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」即可恢复。');
    if (customTotal === 0 && lock) addIssue('bad', '你还没有任何自定义字卡，且系统预设字卡被锁定：联系人回复会非常单薄。建议先在「字卡库」里添加几张自定义字卡，或解锁系统预设。');
    if (!dcEn) addIssue('warn', '系统预设「聊天默认字卡」总开关关闭：聊天/信箱/朋友圈都不会混入系统预设聊天字卡。');
    if (!dcfEn) addIssue('warn', '「其他互动功能字卡」总开关关闭：摸鱼/吃饭/花园等功能触发时不再出字卡（不影响聊天默认字卡）。');
    if (all === 0) addIssue('warn', '系统预设字卡「聊天触发概率总档」为 0%：所有系统预设聊天概率归零。');
    if (ownUsable + pubUsable === 0 && !lock) addIssue('warn', '当前桌面没有任何「可用的自定义字卡」。');
    if (!pubGroups) addIssue('warn', '公用字卡库为空（所有桌面共享的库）。');
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      var total = presetCount(k), off = offCount(k);
      if (total > 0 && off >= total) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类内 ' + total + ' 张已全部单卡关闭，实际无可用内容。');
      if (!boolOf(store('dc-cat-' + k), true)) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类开关被关闭。');
      if (num(store('dc-prob-' + k), 25) === 0) addIssue('warn', '默认聊天字卡「' + CC_LABEL[k] + '」分类占比为 0%，该分类不会被抽中。');
    });
    DCF.forEach(function (d) {
      var key = d[0], name = d[1], def = d[2], hasPool = d[3];
      if (key === 'deskcheck') return;
      if (num(store('dcf-' + key), def) === 0 && dcfEn) addIssue('warn', '功能字卡「' + name + '」概率为 0%，该功能不再出字卡。');
      if (hasPool && presetCount(key) > 0 && offCount(key) >= presetCount(key)) addIssue('warn', '功能字卡「' + name + '」预设内容已全部单卡关闭。');
    });
    Object.keys(ownOff).forEach(function (t) { if ((ownOff[t] || []).length) addIssue('warn', '本桌面专属字卡「' + (CC_LABEL[t] || t) + '」有 ' + ownOff[t].length + ' 个分组被停用。'); });
    Object.keys(pubOff).forEach(function (t) { if ((pubOff[t] || []).length) addIssue('warn', '公用字卡「' + (CC_LABEL[t] || t) + '」有 ' + pubOff[t].length + ' 个分组被停用。'); });
    var health = { tokens: 0, missing: 0, bigMedia: 0, badVoice: 0 };
    try { if (window.__ccAuditHealth) health = window.__ccAuditHealth() || health; } catch (e) {}
    if (health.missing > 0) addIssue('bad', '检测到 ' + health.missing + ' 张图片/表情卡在媒体池里已丢失（聊天里会显示占位或发不出），多为导入的备份未含图片——需从有完整图片的源头设备重新导出「完整备份」再导入，或用「查看存储→媒体池重建」尝试自愈。');
    if (health.badVoice > 0) addIssue('warn', '检测到 ' + health.badVoice + ' 条语音卡数据格式异常（可能无法播放）。');
    if (health.bigMedia > 0) addIssue('warn', '检测到 ' + health.bigMedia + ' 张超大图片卡（>512KB），字卡库体积大、iOS/安卓容易卡顿，建议到「查看存储→字卡库瘦身」清理。');
    if (!issues.length) addIssue('ok', '未发现明显问题：字卡各链路按当前设置正常取用。');

    // ===== 结论卡 =====
    var badN = 0, warnN = 0;
    issues.forEach(function (v) { if (v.lv === 'bad') badN++; else if (v.lv === 'warn') warnN++; });
    var verdictInner = '';
    var headLv, headTxt;
    if (lock) { headLv = 'bad'; headTxt = '系统预设字卡被二级密码锁住，先用开屏密码解锁'; }
    else if (badN) { headLv = 'bad'; headTxt = '有 ' + badN + ' 个需要处理的问题（字卡可能用不到）'; }
    else if (warnN) { headLv = 'warn'; headTxt = '整体可用，有 ' + warnN + ' 项可优化'; }
    else { headLv = 'ok'; headTxt = '一切正常：字卡按当前设置正常参与回复'; }
    verdictInner += '<div class="ca-headline ' + cls(headLv) + '">' + (headLv === 'ok' ? '✓ ' : headLv === 'warn' ? '! ' : '✕ ') + esc(headTxt) + '</div>';
    issues.forEach(function (v) { verdictInner += '<div class="ca-issues ' + cls(v.lv) + '">● ' + esc(v.text) + '</div>'; });
    verdictInner += rowHtml('系统预设字卡', lock ? '被锁停' : ((dcEn || dcfEn) ? '部分/全部可用' : '总开关关闭'), lock ? 'bad' : 'ok', { edit: 'defaultCards' });
    verdictInner += rowHtml('当前桌面可用自定义字卡', '本桌面 ' + ownUsable + ' 张 · 公用 ' + pubUsable + ' 张（' + (ownGroups + pubGroups) + ' 组）', ownUsable + pubUsable > 0 ? 'ok' : 'mute', { edit: 'customOwn' });

    var fixable = [];
    if (!lock) {
      if (!dcEn) fixable.push({ id: 'fx-dc-en', key: 'dc-enabled', kind: 'en' });
      if (!dcfEn) fixable.push({ id: 'fx-dcf-en', key: 'dcf-enabled', kind: 'en' });
      if (all === 0) fixable.push({ id: 'fx-dcp-all', key: 'reply-dcp-all', kind: 'num', v: 100 });
      ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
        if (!boolOf(store('dc-cat-' + k), true)) fixable.push({ id: 'fx-dc-cat-' + k, key: 'dc-cat-' + k, kind: 'en' });
        if (num(store('dc-prob-' + k), 25) === 0) fixable.push({ id: 'fx-dc-prob-' + k, key: 'dc-prob-' + k, kind: 'num', v: 25 });
        if (presetCount(k) > 0 && offCount(k) >= presetCount(k)) fixable.push({ id: 'fx-dc-off-' + k, kind: 'cardoff', cat: k });
      });
      DCF.forEach(function (d) {
        if (d[0] === 'deskcheck') return;
        if (num(store('dcf-' + d[0]), d[2]) === 0) fixable.push({ id: 'fx-dcf-' + d[0], key: 'dcf-' + d[0], kind: 'num', v: d[2] });
        if (d[3] && presetCount(d[0]) > 0 && offCount(d[0]) >= presetCount(d[0])) fixable.push({ id: 'fx-dcf-off-' + d[0], kind: 'cardoff', cat: d[0] });
      });
    }
    fixable.forEach(function (f) {
      if (f.kind === 'en') fixEnable(f.id, f.key);
      else if (f.kind === 'num') fixProb(f.id, f.key, f.v, f.key.indexOf('dcf-') === 0 ? function () { try { window.dcfRefreshUI(f.key.slice(4)); } catch (e) {} } : null);
      else if (f.kind === 'cardoff') fixCardOffs(f.id, f.cat);
      registerBulk(f.id);
    });
    Object.keys(ownOff).forEach(function (t) { if ((ownOff[t] || []).length) { var id = 'fx-goff-own-' + t; fixGroupOff(id, 'own', t); registerBulk(id); } });
    Object.keys(pubOff).forEach(function (t) { if ((pubOff[t] || []).length) { var id2 = 'fx-goff-pub-' + t; fixGroupOff(id2, 'public', t); registerBulk(id2); } });
    if (bulkFixes.length) {
      addFix('__allfix', function () {
        bulkFixes.forEach(function (id) { try { if (fixMap[id]) fixMap[id](); } catch (e) {} });
        try { if (window.dcfRefreshUI) DCF.forEach(function (d) { window.dcfRefreshUI(d[0]); }); } catch (e) {}
        return true;
      });
      verdictInner += '<div class="ca-fixbar"><button class="storage-clear" type="button" data-fix="__allfix">一键修复系统预设可用</button></div>';
      verdictInner += '<div class="ca-sub">上述修复只把「概率回默认、开关打开、分组启用、单卡关闭清空」，不改动任何字卡内容；二级密码锁需本人去开屏解锁。</div>';
    }
    push('自检结论', verdictInner, null);

    // ===== 一、二级密码锁 =====
    var lockInner = '';
    lockInner += rowHtml('当前状态', lock ? '锁定中（系统预设字卡整体停用）' : '已解锁', lock ? 'bad' : 'ok');
    lockInner += rowHtml('存储键', GNS + ':cardlock-state（全局，不随桌面）', 'mute');
    push('一、二级密码锁（#319 防未成年人）', lockInner,
      '锁定时：默认聊天字卡、词典（含词典拼字）、其他互动功能字卡的系统预设内容全部取不到，各页开关看起来「开了却没效果」属正常。<br><b>不受此锁影响（#499 豁免）</b>：聊天情绪字卡、心意字卡、交流意图、聊天回应字卡、TA 的心情、今日情话、位置卡、查岗问题库、TA 主动提问——未解锁也照常使用。<br>解锁：开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」；重锁：同卡一键重新上锁。');

    // ===== 二、默认聊天字卡 =====
    var dcInner = '';
    var idDcEn = 'inl-dc-en';
    if (!dcEn && !lock) fixEnable(idDcEn, 'dc-enabled');
    dcInner += rowHtml('总开关（dc-enabled）', dcEn ? '开启' : '关闭', dcEn ? 'ok' : 'warn', { fix: (!dcEn && !lock) ? idDcEn : '', edit: 'defaultCards' });
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '信箱', '朋友圈'][i];
      var on = boolOf(store('dc-use-' + k), true);
      var id = 'inl-dc-use-' + k;
      if (!on && !lock) fixEnable(id, 'dc-use-' + k);
      dcInner += rowHtml(nm + '使用（dc-use-' + k + '）', on ? '开启' : '关闭', on ? 'ok' : 'warn', { fix: (!on && !lock) ? id : '', edit: 'defaultCards' });
    });
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '写信', '朋友圈'][i];
      var def = k === 'feed' ? 100 : 30;
      var v = num(store('dc-overall-' + k), def);
      var id = 'inl-dc-ov-' + k;
      if (v === 0 && !lock) fixProb(id, 'dc-overall-' + k, def);
      dcInner += rowHtml(nm + '概率（dc-overall-' + k + '）', v + '%', v === 0 ? 'warn' : 'ok', { fix: (v === 0 && !lock) ? id : '', edit: 'defaultCards' });
    });
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      var cat = boolOf(store('dc-cat-' + k), true);
      var prob = num(store('dc-prob-' + k), 25);
      var total = presetCount(k), off = offCount(k);
      var funnel = funnelHtml([
        { t: '锁', ok: !lock }, { t: '总开关', ok: dcEn }, { t: '分类', ok: cat },
        { t: '占比', ok: prob > 0 }, { t: '内容', ok: (total - off) > 0 }
      ]);
      var usable = !lock && dcEn && cat && prob > 0 && (total - off > 0);
      var idCat = 'inl-dc-cat-' + k, idProb = 'inl-dc-prob-' + k, idOff = 'inl-dc-off-' + k;
      if (!lock) {
        if (!cat) fixEnable(idCat, 'dc-cat-' + k);
        if (prob === 0) fixProb(idProb, 'dc-prob-' + k, 25);
        if (total > 0 && off >= total) fixCardOffs(idOff, k);
      }
      dcInner += '<div class="storage-row"><span>' + esc(CC_LABEL[k]) + '（dc-cat-' + k + ' · dc-prob-' + k + '）</span><b class="' + (usable ? 'ca-ok' : 'ca-warn') + '">' +
        (cat ? '开' : '关') + ' · 占比 ' + prob + '% · ' + total + ' 张' + (off ? '（单卡关 ' + off + '）' : '') +
        (!cat && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idCat + '">启用</button>' : '') +
        (prob === 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idProb + '">恢复占比</button>' : '') +
        (total > 0 && off >= total && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idOff + '">恢复单卡</button>' : '') +
        ' <span class="ca-jump ca-edit" data-jump="defaultCards">调整</span></b></div>' + funnel;
    });
    push('二、系统预设 · 聊天默认字卡', dcInner,
      '漏斗＝「锁 → 总开关 → 分类开关 → 分类占比>0 → 有未关闭的内容」，任一 ✕ 该分类就抽不到。概率 = 联系人回复时混入默认字卡的几率；分类占比 = 命中后内部按四大分类分配（相对权重）。系统预设字卡与自定义字卡机会互补（合计 100%）。<br><b>怎么调</b>：点每行「调整」进「聊天默认字卡」页改开关/占比，或点「修复」恢复默认。');

    // ===== 三、词典 =====
    var dictInner = '';
    var dictAnyUse = false, dictAnyProb = false;
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '写信', '朋友圈'][i];
      var on = boolOf(store('dict-use-' + k), true); if (on) dictAnyUse = true;
      var id = 'inl-dict-use-' + k;
      if (!on && !lock) fixEnable(id, 'dict-use-' + k);
      dictInner += rowHtml(nm + '使用（dict-use-' + k + '）', on ? '开启' : '关闭', on ? 'ok' : 'warn', { fix: (!on && !lock) ? id : '', edit: 'dictCards' });
    });
    dictInner += rowHtml('一键全关（dict-use-closeall）', boolOf(store('dict-use-closeall'), false) ? '已全关' : '未使用', boolOf(store('dict-use-closeall'), false) ? 'warn' : 'mute');
    ['chat', 'mail', 'feed'].forEach(function (k, i) {
      var nm = ['聊天', '写信', '朋友圈'][i];
      var def = k === 'chat' ? 75 : 30;
      var v = num(store('dict-overall-' + k), def); if (v > 0) dictAnyProb = true;
      var id = 'inl-dict-ov-' + k;
      if (v === 0 && !lock) fixProb(id, 'dict-overall-' + k, def);
      dictInner += rowHtml(nm + '概率（dict-overall-' + k + '）', v + '%', v === 0 ? 'warn' : 'ok', { fix: (v === 0 && !lock) ? id : '', edit: 'dictCards' });
    });
    dictInner += rowHtml('词典内置词条', presetGroups('dict').length + ' 组 · ' + presetCount('dict') + ' 条' + (offCount('dict') ? '（单卡关 ' + offCount('dict') + '）' : ''), 'mute');
    var dq = 0, dw = 0;
    try { dq = (JSON.parse(glob('dict-custom-quotes') || '[]') || []).length; } catch (e) {}
    try { dw = (JSON.parse(glob('dict-custom-words') || '[]') || []).length; } catch (e) {}
    dictInner += rowHtml('自建词条（全局）', '语录 ' + dq + ' 条 · 词 ' + dw + ' 条', 'mute');
    var dictUsable = !lock && dictAnyUse && dictAnyProb;
    dictInner += rowHtml('实际可用', dictUsable ? '可用' : (lock ? '被二级锁整体停用' : '不可用'), dictUsable ? 'ok' : 'warn');
    dictInner += funnelHtml([{ t: '锁', ok: !lock }, { t: '场景', ok: dictAnyUse }, { t: '概率', ok: dictAnyProb }]);
    push('三、系统预设 · 词典（拼字抽句/切词）', dictInner,
      '词典属系统内置字卡，二级锁锁定时整池停用（下方开关全开也无效）；自建词条为全局键，不随桌面隔离。聊天词典内容走「词典拼字」，写信/朋友圈开启后按概率混入文案。<br><b>怎么调</b>：点每行「调整」进「默认字卡·词典」页。');

    // ===== 四、其他互动功能字卡 =====
    var fInner = '';
    var idDcfEn = 'inl-dcf-en';
    if (!dcfEn && !lock) fixEnable(idDcfEn, 'dcf-enabled');
    fInner += rowHtml('总开关（dcf-enabled）', dcfEn ? '开启' : '关闭（跨桌面查岗除外）', dcfEn ? 'ok' : 'warn', { fix: (!dcfEn && !lock) ? idDcfEn : '', edit: 'funCards' });
    var idDcp = 'inl-dcp';
    if (all === 0 && !lock) fixProb(idDcp, 'reply-dcp-all', 100);
    fInner += rowHtml('聊天概率总档（reply-dcp-all）', all + '%', all === 0 ? 'warn' : 'ok', { fix: (all === 0 && !lock) ? idDcp : '', edit: 'replySettings' });
    DCF.forEach(function (d) {
      var key = d[0], name = d[1], def = d[2], hasPool = d[3];
      var raw = num(store('dcf-' + key), def);
      var eff = dcfEff(raw, key);
      var total = hasPool ? presetCount(key) : -1;
      var off = hasPool ? offCount(key) : 0;
      var gate = key === 'deskcheck' ? true : dcfEn;
      var usable = !lock && gate && eff > 0 && (!hasPool || (total - off > 0));
      var funnel = funnelHtml([
        { t: '锁', ok: !(lock && hasPool) }, { t: '总开关', ok: gate }, { t: '概率', ok: eff > 0 },
        { t: '内容', ok: !hasPool || (total - off > 0) }
      ]);
      var id = 'inl-dcf-' + key, idOff = 'inl-dcf-off-' + key;
      if (raw === 0 && !lock) fixProb(id, 'dcf-' + key, def, function () { try { window.dcfRefreshUI(key); } catch (e) {} });
      if (hasPool && total > 0 && off >= total && !lock) fixCardOffs(idOff, key);
      var cnt = hasPool ? (total + ' 张' + (off ? '（单卡关 ' + off + '）' : '')) : '—（发到聊天型，无独立字卡池）';
      fInner += '<div class="storage-row"><span>' + esc(name) + '（dcf-' + key + '）</span><b class="' + (usable ? 'ca-ok' : 'ca-warn') + '">存盘 ' + raw + '% · 生效 ' + eff + '% · ' + cnt +
        (raw === 0 && !lock ? ' <button class="ca-fix" type="button" data-fix="' + id + '">恢复概率</button>' : '') +
        (hasPool && total > 0 && off >= total && !lock ? ' <button class="ca-fix" type="button" data-fix="' + idOff + '">恢复单卡</button>' : '') +
        ' <span class="ca-jump ca-edit" data-jump="funCards">调整</span></b></div>' + funnel;
    });
    push('四、系统预设 · 其他互动功能字卡（19 类）', fInner,
      '生效概率 = 分类存盘值 × 聊天概率总档 ÷ 100；总开关关闭时除「跨桌面查岗」外全部归 0。二级锁锁定时系统预设内容不可用，但你自建的同类功能字卡仍可用（本页只统计系统预设张数）。<br><b>怎么调</b>：点每行「调整」进「其他互动功能字卡」页（聊天概率总档在「回复设置 → 聊天」里调）。');

    // ===== 五、其他字卡池（#499 豁免） =====
    var oInner = '';
    var MC = window.MOOD_FOLLOWUP_DATA || {};
    var idMc = 'inl-mc-en';
    if (!mcEn) fixEnable(idMc, 'mc-enabled');
    oInner += rowHtml('聊天情绪/心意/意图（mc-enabled）', mcEn ? '开启' : '关闭', mcEn ? 'ok' : 'warn', { fix: !mcEn ? idMc : '', edit: 'moodCards' });
    ['mood', 'heart', 'intent'].forEach(function (k, i) {
      var nm = ['情绪', '心意', '交流意图'][i], def = [70, 40, 40][i], key = 'mc-prob-' + k;
      var v = num(store(key), def), id = 'inl-mc-' + k;
      if (v === 0) fixProb(id, key, def);
      oInner += rowHtml('　' + nm + '概率（' + key + '）', v + '%', v === 0 ? 'warn' : 'ok', { fix: v === 0 ? id : '', edit: 'moodCards' });
    });
    oInner += rowHtml('　情绪池张数', dataCount(MC.mood) + ' 张（不受二级锁影响）', 'mute');
    var rcEn = boolOf(store('rc-enabled'), true), rcProb = num(store('rcard-prob'), 30);
    var idRc = 'inl-rc';
    addFix(idRc, function () { if (!boolOf(store('rc-enabled'), true)) storeSet('rc-enabled', '1'); if (num(store('rcard-prob'), 30) === 0) storeSet('rcard-prob', 30); return true; });
    oInner += rowHtml('聊天回应字卡（rc-enabled / rcard-prob）', (rcEn ? '开启' : '关闭') + ' · 整条替换 ' + rcProb + '% · 连接词追加 cf-prob ' + num(store('cf-prob'), 20) + '% · ' + dataCount(MC.followup) + ' 张', (rcEn && rcProb > 0) ? 'ok' : 'warn', { fix: (!rcEn || rcProb === 0) ? idRc : '', edit: 'replyCards' });
    var tmEn = boolOf(store('tm-enabled'), true), tmProb = num(store('tm-prob'), 15);
    var idTm = 'inl-tm';
    addFix(idTm, function () { if (!boolOf(store('tm-enabled'), true)) storeSet('tm-enabled', '1'); if (num(store('tm-prob'), 15) === 0) storeSet('tm-prob', 15); return true; });
    oInner += rowHtml('TA 的心情（tm-enabled / tm-prob）', (tmEn ? '开启' : '关闭') + ' · ' + tmProb + '% · ' + dataCount((window.TA_MOOD_DATA || {}).groups) + ' 张', (tmEn && tmProb > 0) ? 'ok' : 'warn', { fix: (!tmEn || tmProb === 0) ? idTm : '', edit: 'taMood' });
    [['quote-cards-default', '桌面今日情话', 'quoteCards'], ['loc-lib-default', 'TA在身边位置卡', 'locCards'], ['checkin-cards-default', '寻踪日常字卡', 'checkinCards']].forEach(function (t) {
      var on = boolOf(store(t[0]), true), id = 'inl-' + t[0];
      if (!on) fixEnable(id, t[0]);
      oInner += rowHtml(t[1] + '（' + t[0] + '）', on ? '开启' : '关闭', on ? 'ok' : 'warn', { fix: !on ? id : '', jump: t[2] });
    });
    var ck = null; try { ck = JSON.parse(store('ta-checkin') || 'null'); } catch (e) {}
    var ckUseDef = ck && ck.settings ? ck.settings.useDefault !== false : true;
    oInner += rowHtml('查岗问题库（ta-checkin.settings.useDefault）', (ckUseDef ? '使用系统预设' : '仅用自建') + ' · 触发 ckq-en ' + (boolOf(store('ckq-en'), true) ? '开' : '关') + ' / ckq-prob ' + num(store('ckq-prob'), 2) + '%', 'mute', { jump: 'taCheckin' });
    var TA_EDIT = { 'ta-ask': 'taAsk', 'ta-choose': 'taChoose', 'ta-curious': 'taCurious', 'ta-roast': 'taRoast' };
    ['ta-ask:询问', 'ta-choose:小问题', 'ta-curious:好奇', 'ta-roast:吐槽'].forEach(function (pair) {
      var key = pair.split(':')[0], label = pair.split(':')[1];
      var blob = null; try { blob = JSON.parse(store(key) || 'null'); } catch (e) {}
      var s = blob && blob.settings ? blob.settings : {};
      var en = s.enabled !== false, pr = s.prob === undefined ? 5 : s.prob;
      oInner += rowHtml('TA 主动·' + label + '（' + key + '.settings）', (en ? '开启' : '关闭') + ' · 概率 ' + pr + '%', (en && pr > 0) ? 'ok' : 'warn', { edit: TA_EDIT[key] });
    });
    push('五、系统预设 · 其他字卡池（不受二级锁影响）', oInner,
      '这一组按 #499 明确豁免：未解锁二级密码也照常使用。各池开关存于各自数据块/键。<br><b>怎么调</b>：点每行「调整」进对应管理页；个别概率/开关可就地「修复」回默认。');

    // ===== 六/七、自定义字卡 =====
    function customCard(scope, offRec) {
      var inner = '', any = false;
      CC_ORDER.forEach(function (t) {
        var grps = scopePool(scope, t);
        var gc = grps.length, cc = 0;
        grps.forEach(function (g) { cc += (g && Array.isArray(g[1]) ? g[1].length : 0); });
        var offs = (offRec && Array.isArray(offRec[t])) ? offRec[t] : [];
        if (!gc && !cc && !offs.length) return;
        any = true;
        var offTxt = offs.length ? ' · <span class="ca-warn">已停用 ' + offs.length + ' 组：' + esc(offs.join('、')) + '</span>' : '';
        var offBtn = offs.length ? ' <button class="ca-fix" type="button" data-fix="inl-goff-' + scope + '-' + t + '">全部启用</button>' : '';
        inner += '<div class="storage-row"><span>' + esc(CC_LABEL[t]) + '</span><b>' + gc + ' 组 / ' + cc + ' 张' + offTxt + offBtn + '</b></div>';
        if (offs.length) fixGroupOff('inl-goff-' + scope + '-' + t, scope, t);
      });
      if (!any) inner = '<div class="storage-hint">该库为空：没有任何自定义字卡。</div>';
      return { inner: inner, any: any };
    }
    var ownC = customCard('own', ownOff);
    var pubC = customCard('public', pubOff);
    push('六、自定义字卡 · 公用库（全桌面共享）', pubC.inner,
      '这里统计「可用」状态：被停用的分组不计入组/张数，右侧列出停用名单并可就地「全部启用」。点 <span class="ca-jump" data-jump="customPublic">公用字卡库</span> 去管理。');
    push('七、自定义字卡 · 当前桌面专属库（' + esc(deskName(activeCid())) + '）', ownC.inner,
      '专属库仅当前桌面的联系人生效；分组停用只影响「使用」，字卡本身仍保留在字卡库中。点 <span class="ca-jump" data-jump="customOwn">专属字卡库</span> 去管理。');

    // ===== 八、各桌面概览（按需展开） =====
    var deskInner = '';
    if (!contactsArr.length) deskInner = '<div class="storage-hint">未读取到联系人列表。</div>';
    contactsArr.forEach(function (c, i) {
      var cid = c && c.id ? c.id : 'default';
      var name = (c && c.name) || cid;
      var isCur = cid === activeCid();
      var raw = rawFor(cid, 'cc-groups');
      var kb = raw ? Math.round(String(raw).length * 2 / 1024) : 0;
      var ofRec = {}; try { ofRec = JSON.parse(rawFor(cid, 'cc-groups-off') || '{}') || {}; } catch (e) { ofRec = {}; }
      var offN = offCountIn(ofRec);
      deskInner += '<div class="storage-row"><span>' + esc(name) + (isCur ? '（当前桌面）' : '') + '<span class="ca-sub">' + (raw ? '库约 ' + kb + ' KB' : '空库') + ' · 停用分组 ' + offN + ' 个</span></span>' +
        '<b>' + (raw ? '<button class="ca-jump" type="button" data-desk="' + i + '" data-cid="' + esc(cid) + '">查看明细</button>' : '—') + '</b></div>' +
        '<div class="ca-detail" id="ca-desk-' + i + '" hidden></div>';
    });
    push('八、各桌面专属字卡概览', deskInner,
      '为避免超大库（单键可达 150MB+）卡死页面，默认只报整库体积与停用分组数；点「查看明细」按需解析单个桌面（超过约 12MB 会拒绝解析以防卡顿）。');

    // ===== 九、卡数据健康 =====
    var hInner = '';
    hInner += rowHtml('媒体池丢失图片卡', health.missing + ' 张' + (health.tokens ? '（令牌 ' + health.tokens + ' 张）' : ''), health.missing ? 'bad' : 'ok');
    hInner += rowHtml('语音卡数据异常', health.badVoice + ' 条', health.badVoice ? 'warn' : 'ok');
    hInner += rowHtml('超大图片卡（>512KB）', health.bigMedia + ' 张', health.bigMedia ? 'warn' : 'ok');
    push('九、卡数据健康（图片/语音）', hInner,
      '丢失图片卡多因导入的备份未含图片，可从有完整图片的源头设备重新导出「完整备份」再导入，或到「查看存储 → 媒体池重建」尝试自愈；超大图片卡会让字卡库体积膨胀、iOS/安卓卡顿，可到「查看存储 → 字卡库瘦身」清理。点 <span class="ca-jump" data-jump="storage">查看存储</span>。');

    lastText = lines.join('\n');
    return { issueCount: issueCount };
  }

  // ---------- 渲染（分帧填充，避免大库首开空白） ----------
  function render() {
    var r = build();
    updateBadge(r.issueCount);
    var secs = sections.slice();
    bodyEl.innerHTML = '';
    var i = 0;
    (function step() {
      var end = Math.min(i + 2, secs.length);
      for (; i < end; i++) {
        var wrap = document.createElement('div');
        wrap.innerHTML = secs[i];
        while (wrap.firstChild) bodyEl.appendChild(wrap.firstChild);
      }
      if (i < secs.length) setTimeout(step, 0);
      else applyFilter();
    })();
  }
  // 「只看有问题」：隐藏 ✓/灰字的行与无问题的卡片（问题信号＝本体带 ca-warn/ca-bad/✕漏斗/修复按钮）
  function applyFilter() {
    try {
      bodyEl.querySelectorAll('.cal-card').forEach(function (card) {
        var hasIssue = !!card.querySelector('.ca-warn, .ca-bad, .ca-flow-no, [data-fix]');
        card.style.display = (onlyProblems && !hasIssue) ? 'none' : '';
        card.querySelectorAll('.storage-row').forEach(function (r) {
          var dirty = !!r.querySelector('.ca-warn, .ca-bad, [data-fix]');
          var b = r.querySelector('b');
          var clean = b && (b.classList.contains('ca-ok') || b.classList.contains('ca-mute')) && !dirty;
          r.style.display = (onlyProblems && clean) ? 'none' : '';
        });
        card.querySelectorAll('.ca-funnel').forEach(function (f) {
          f.style.display = (onlyProblems && !f.querySelector('.ca-flow-no')) ? 'none' : '';
        });
      });
    } catch (e) {}
  }

  // 角标（不打开也显示问题数）：只读键的轻量计数，不触发池解析
  function quickIssueCount() {
    var n = 0;
    try {
      if (locked()) n++;
      if (!boolOf(store('dc-enabled'), true)) n++;
      if (!boolOf(store('dcf-enabled'), true)) n++;
      if (num(store('reply-dcp-all'), 100) === 0) n++;
      if (!boolOf(store('mc-enabled'), true)) n++;
      ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
        if (!boolOf(store('dc-cat-' + k), true)) n++;
        if (num(store('dc-prob-' + k), 25) === 0) n++;
      });
      DCF.forEach(function (d) { if (d[0] !== 'deskcheck' && num(store('dcf-' + d[0]), d[2]) === 0) n++; });
      var oo = offRecord('own'), po = offRecord('public');
      if (offCountIn(oo)) n++;
      if (offCountIn(po)) n++;
    } catch (e) {}
    return Math.min(n, 99);
  }
  function updateBadge(n) {
    if (!row) return;
    try {
      var txt = row.querySelector('.txt');
      if (!txt) return;
      var b = row.querySelector('.ca-badge');
      if (!b) { b = document.createElement('span'); b.className = 'ca-badge'; txt.appendChild(b); }
      b.textContent = String(n);
      b.classList.toggle('zero', !(n > 0));
      row.setAttribute('data-ca-issues', String(n));
    } catch (e) {}
  }

  // ---------- 跳转 ----------
  function showSettingRow(sel) {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var sp = document.getElementById('page-setting'); if (sp) sp.hidden = false;
      var el = document.querySelector(sel); if (!el) return false;
      var sec = el.closest ? el.closest('.them-sec') : null;
      if (sec && sec.dataset && sec.dataset.sec) {
        var tab = document.querySelector('#set-tabs .them-tab[data-tab="' + sec.dataset.sec + '"]');
        if (tab) tab.click();
      }
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      return true;
    } catch (e) { return false; }
  }
  function jump(key) {
    if (!key) return false;
    if (key.charAt(0) === '#') return showSettingRow(key);
    var chain = JUMPS[key];
    if (!chain) return false;
    if (typeof chain === 'string') return showSettingRow(chain);
    var ok = false;
    try { document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; }); } catch (e) {}
    chain.forEach(function (sel) { var el = document.querySelector(sel); if (el && el.click) { el.click(); ok = true; } });
    if (!ok) toast('入口暂不可达：请到「字卡库」里找对应页');
    return ok;
  }

  // ---------- 各桌面明细（按需解析） ----------
  var MAX_DETAIL_CHARS = 6000000;
  function expandDesk(btn) {
    var i = btn.getAttribute('data-desk');
    var cid = btn.getAttribute('data-cid');
    var box = document.getElementById('ca-desk-' + i);
    if (!box) return;
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; btn.textContent = '查看明细'; return; }
    var raw = rawFor(cid, 'cc-groups');
    var chars = raw ? String(raw).length : 0;
    if (chars > MAX_DETAIL_CHARS) { toast('该桌面字卡库约 ' + Math.round(chars * 2 / 1048576) + ' MB，明细解析可能造成卡顿，已跳过（可在字卡库瘦身里处理）'); return; }
    var g = parseGroups(raw);
    var ofRec = {}; try { ofRec = JSON.parse(rawFor(cid, 'cc-groups-off') || '{}') || {}; } catch (e) {}
    var html = '';
    var total = 0, groupsTotal = 0;
    CC_ORDER.forEach(function (t) {
      var arr = (g[t] || []);
      if (!arr.length) return;
      var cc = 0; arr.forEach(function (x) { cc += (x && Array.isArray(x[1]) ? x[1].length : 0); });
      var offs = (ofRec[t] && ofRec[t].length) ? ofRec[t] : [];
      total += cc; groupsTotal += arr.length;
      html += '<div class="storage-row"><span>' + esc(CC_LABEL[t]) + '</span><b>' + arr.length + ' 组 / ' + cc + ' 张' + (offs.length ? ' · <span class="ca-warn">停用 ' + offs.length + ' 组</span>' : '') + '</b></div>';
    });
    html = '<div class="ca-sub">合计 ' + groupsTotal + ' 组 / ' + total + ' 张</div>' + html;
    box.innerHTML = html || '<div class="ca-sub">该桌面没有自定义字卡。</div>';
    box.hidden = false;
    btn.textContent = '收起';
  }

  // ---------- 复制/轻提示 ----------
  function toast(msg) {
    try {
      var t = document.getElementById('cc-toast');
      if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
      t.textContent = msg;
      t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
      clearTimeout(t._timer);
      t._timer = setTimeout(function () { t.className = 'cc-toast'; }, 2000);
    } catch (e) {}
  }
  function copyReport() {
    var txt = lastText || '';
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        toast(ok ? '自检报告已复制' : '复制失败，请长按页面手动选择');
      } catch (e) { toast('复制失败'); }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(function () { toast('自检报告已复制'); }, fallback); }
      else fallback();
    } catch (e) { fallback(); }
  }

  // ---------- 事件 ----------
  function openAudit() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      page.hidden = false;
      render();
      var sc = page.querySelector('.cal-scroll');
      if (sc) sc.scrollTop = 0;
    } catch (e) {}
  }
  function closeAudit() {
    try {
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      var s = document.getElementById('page-setting');
      if (s) s.hidden = false;
    } catch (e) {}
  }
  if (row) row.addEventListener('click', openAudit);
  if (back) back.addEventListener('click', closeAudit);
  if (refreshBtn) refreshBtn.addEventListener('click', function () { render(); toast('已重新自检'); });
  if (copyBtn) copyBtn.addEventListener('click', copyReport);
  if (filterBtn) filterBtn.addEventListener('click', function () {
    onlyProblems = !onlyProblems;
    filterBtn.textContent = onlyProblems ? '显示全部' : '只看有问题';
    applyFilter();
  });

  // 委托：修复 / 跳转 / 桌面明细
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var fixBtn = t.closest('[data-fix]');
    if (fixBtn) {
      e.preventDefault();
      var id = fixBtn.getAttribute('data-fix');
      var fn = fixMap[id];
      if (!fn) return;
      var res = false;
      try { res = fn(); } catch (err) { res = 'fail'; }
      render();
      if (res === false) toast('没有需要修复的项（或已是最新）');
      else if (res === 'fail') toast('修复未生效：本机存储可能已满或被拦截');
      else toast('已修复，正在重新自检');
      return;
    }
    var jumpEl = t.closest('[data-jump]');
    if (jumpEl) { e.preventDefault(); jump(jumpEl.getAttribute('data-jump')); return; }
    var deskBtn = t.closest('[data-desk]');
    if (deskBtn) { e.preventDefault(); expandDesk(deskBtn); return; }
  });

  // 锁状态 / 切桌面 / 数据回填完成后：页开着就刷新；角标随时更新
  function refreshAll() { try { updateBadge(quickIssueCount()); } catch (e) {} try { if (!page.hidden) render(); } catch (e) {} }
  ['mochi-cardlock-open', 'mochi-cardlock-locked', 'contact-switched', 'mochi-restore-done'].forEach(function (ev) { document.addEventListener(ev, refreshAll); });
  setTimeout(refreshAll, 1200);
})();
