// ===== 功能：设置 → 工具 →【所有字卡使用状态自检系统】 =====
// 需求（用户）：字卡分「自定义字卡」和「系统预设字卡」，系统预设又被二级密码（#319 防未
//   成年人锁）整体锁住，且分组/分类非常多——出一个统一自检页，一次看清「每类字卡现在到底
//   能不能被联系人用到、为什么用不到」。
// 设计：只读诊断，不写任何业务键、不改任何开关。入口设置页 #row-card-audit（工具段），
//   点击进入独立页 #page-card-audit；打开/重新检测时现算，随解锁事件与切桌面实时刷新。
// 数据来源（全部读现有键/现有 API，不复制业务逻辑到本文件）：
//   · 锁：window.cardLockOpen()（card-lock.js，#319 二级密码）
//   · 系统预设开关/概率：activeStore 的 dc-* / dcf-* / dict-* / mc-* / rc-*/rcard-* / tm-* 等
//   · 卡数：window.DEFAULT_CARD_DATA / MOOD_FOLLOWUP_DATA / TA_MOOD_DATA
//   · 自定义字卡：window.getScopedGroups(type, scope)（已按停用分组过滤 + 令牌化池视图，
//     不整库 JSON.parse，避免大库卡死）+ cc-groups[-public]-off 停用记录
// 安全：绝不对各桌面 cc-groups 巨型串做 JSON.parse（实测单键 150MB+），各桌面概览只报
//   键体积与停用数（字符串 length 为 O(1)），当前桌面/公用走已缓存的池视图。
(function () {
  var page = document.getElementById('page-card-audit');
  if (!page) return;
  var row = document.getElementById('row-card-audit');
  var back = document.getElementById('card-audit-back');
  var bodyEl = document.getElementById('card-audit-body');
  var refreshBtn = document.getElementById('card-audit-refresh');
  var copyBtn = document.getElementById('card-audit-copy');
  if (!bodyEl) return;

  var GNS = 'xy-home-v2';
  var lastText = '';

  // ---------- 基础读取 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function activeCid() { try { return window.getActiveContact ? window.getActiveContact() : (window.__activeCid || 'default'); } catch (e) { return 'default'; } }
  function activePrefix() { try { return window.activePrefix ? window.activePrefix() : (GNS + ':' + activeCid()); } catch (e) { return GNS + ':' + activeCid(); } }
  function store(k) { try { return window.activeStore().get(k); } catch (e) { return null; } }
  function glob(k) { try { return window.xyStore(GNS).get(k); } catch (e) { return null; } }
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

  // 单卡关闭计数：<prefix>:dc-off-<cat>:<内容>（每次自检内缓存，避免反复扫 localStorage）
  var offCache = {};
  function offCount(cat) {
    if (offCache[cat] !== undefined) return offCache[cat];
    var pre = activePrefix() + ':dc-off-' + cat + ':';
    var n = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(pre) === 0) n++;
      }
    } catch (e) {}
    offCache[cat] = n;
    return n;
  }
  // 预设内容计数
  function presetGroups(cat) {
    try { return (window.DEFAULT_CARD_DATA && window.DEFAULT_CARD_DATA[cat]) || []; } catch (e) { return []; }
  }
  var presetCntCache = {};
  function presetCount(cat) {
    if (presetCntCache[cat] !== undefined) return presetCntCache[cat];
    var n = 0;
    presetGroups(cat).forEach(function (g) { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; });
    presetCntCache[cat] = n;
    return n;
  }
  function dataCount(node) {
    // 兼容 [ [name,[...cards]] ] 与 { k:[cards] } 与 { k:{...} }
    var n = 0;
    try {
      if (Array.isArray(node)) {
        node.forEach(function (g) { if (Array.isArray(g) && Array.isArray(g[1])) n += g[1].length; else if (Array.isArray(g)) n += g.length; });
      } else if (node && typeof node === 'object') {
        Object.keys(node).forEach(function (k) {
          var v = node[k];
          if (Array.isArray(v)) n += v.length;
          else if (v && typeof v === 'object') n += dataCount(v);
        });
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
  var CK_TYPES = ['place', 'action', 'msg'];
  var CK_LABEL = { place: '地点', action: '在做什么', msg: '说的话' };

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

  // 功能字卡定义（与 default-cards.js DCF_DEF / DCF_DEF_NAME 对齐）
  var DCF = [
    ['fish', '摸鱼', 35, true], ['eat', '吃饭', 35, true], ['period', '经期', 25, true], ['water', '喝水', 35, true],
    ['garden', '花园', 40, true], ['sync', '同频', 60, true], ['reach', '伸手', 55, true], ['cjian', '此间', 100, true],
    ['room', '房间', 100, true], ['piggy', '存钱罐', 100, true], ['drift', '漂流瓶', 100, true], ['interact', '互动回应', 100, true],
    ['music', '音乐', 100, true], ['deskcheck', '跨桌面查岗', 50, true],
    ['checkin', '寻踪日常', 100, false], ['pomo', '番茄钟', 100, false], ['care', 'TA的关心（经期）', 100, false],
    ['memo', '备忘提醒', 100, false], ['ask', 'TA主动提问', 100, false]
  ];

  var OK = '#2e9e6b', WARN = '#c98a1b', BAD = '#d9534f', MUTE = 'var(--muted)';
  function colorOf(level) { return level === 'ok' ? OK : level === 'warn' ? WARN : level === 'bad' ? BAD : MUTE; }

  // ---------- 报告构建 ----------
  function build() {
    offCache = {}; presetCntCache = {}; poolCache = {}; // 每次自检重置缓存
    var lines = [];         // 纯文本报告（复制用）
    var html = [];          // 页面 HTML
    var verdicts = [];

    var lock = locked();
    var dcEn = boolOf(store('dc-enabled'), true);
    var dcfEn = boolOf(store('dcf-enabled'), true);
    var mcEn = boolOf(store('mc-enabled'), true);
    var customTotal = 0;
    try { customTotal = window.cardLockCustomCount ? window.cardLockCustomCount() : 0; } catch (e) { customTotal = 0; }
    var contactsArr = contacts();
    var pubOff = offRecord('public');
    var ownOff = offRecord('own');
    var ownC = customCard('own', 'own', ownOff);
    var pubC = customCard('public', 'public', pubOff);
    if (!pubC.any) verdicts.push({ lv: 'warn', t: '公用字卡库为空（所有桌面共享的库）。' });
    if (!ownC.any) verdicts.push({ lv: 'warn', t: '当前桌面「' + deskName(activeCid()) + '」专属字卡库为空。' });

    function h(s) { html.push(s); }
    function ln(s) { lines.push(s); }
    function stripHtml(s) {
      return String(s)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|span|b|em|p|li)>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    function card(title, inner, note) {
      h('<div class="cal-card glass"><div class="cal-card-title">' + esc(title) + '</div>' + inner + (note ? '<div class="storage-hint">' + note + '</div>' : '') + '</div>');
      ln('【' + title + '】');
      ln(stripHtml(inner));
      if (note) ln(stripHtml(note));
      ln('');
    }
    function onOff(v) { return v ? '开启' : '关闭'; }
    function statusOf(usable, why) { return usable ? { t: '可用', lv: 'ok' } : { t: why || '不可用', lv: 'warn' }; }

    // ===== 顶部结论 =====
    if (lock) {
      verdicts.push({ lv: 'bad', t: '系统预设字卡被「二级密码锁」整体锁定（#319 防未成年人保护）——默认聊天字卡、词典（含词典拼字）等系统预设池当前都取不到，下方开关全开也无效。到开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」即可恢复。' });
    }
    if (customTotal === 0 && lock) {
      verdicts.push({ lv: 'bad', t: '你还没有任何自定义字卡，且系统预设字卡被锁定：联系人回复会非常单薄。建议先在「字卡库」里添加几张自定义字卡，或解锁系统预设。' });
    }
    if (dcEn && !dcfEn) verdicts.push({ lv: 'warn', t: '「其他互动功能字卡」总开关关闭：摸鱼/吃饭/花园等功能触发时不再出字卡（不影响聊天默认字卡）。' });
    if (dcpAll() === 0) verdicts.push({ lv: 'warn', t: '系统预设字卡「聊天触发概率总档」为 0%：所有系统预设聊天概率归零。' });
    if (customTotal > 0 && !lock && !dcEn && !dcfEn && !mcEn) verdicts.push({ lv: 'warn', t: '系统预设各总开关大多关闭，实际主要靠自定义字卡。' });

    // 当前桌面池可用量
    var ownUsable = 0, pubUsable = 0;
    CC_ORDER.forEach(function (t) {
      scopePool('own', t).forEach(function (g) { ownUsable += (g && Array.isArray(g[1]) ? g[1].length : 0); });
      scopePool('public', t).forEach(function (g) { pubUsable += (g && Array.isArray(g[1]) ? g[1].length : 0); });
    });
    var presetUsable = false;
    if (!lock) {
      ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
        if (dcEn && boolOf(store('dc-cat-' + k), true) && presetCount(k) > offCount(k)) presetUsable = true;
      });
      DCF.forEach(function (d) { if (d[0] !== 'deskcheck' && dcfEn && dcfEff(num(store('dcf-' + d[0]), d[2]), d[0]) > 0 && presetCount(d[0]) > offCount(d[0])) presetUsable = true; });
    }
    if (!presetUsable && (mcEn || boolOf(store('rc-enabled'), true) || boolOf(store('tm-enabled'), true) || boolOf(store('quote-cards-default'), true) || boolOf(store('loc-lib-default'), true))) presetUsable = true; // #499 豁免链不受锁，始终有内容
    var replyPoolTotal = ownUsable + pubUsable;
    if (replyPoolTotal === 0 && !presetUsable) verdicts.push({ lv: 'bad', t: '当前桌面「自定义字卡 + 可用系统预设」合计为空：联系人的自动回复/字卡互动几乎没有素材。' });
    else if (replyPoolTotal + (presetUsable ? 1 : 0) > 0 && verdicts.filter(function (v) { return v.lv === 'bad'; }).length === 0) {
      verdicts.push({ lv: 'ok', t: '字卡链路整体可用：系统预设按各开关取用，自定义字卡公用 ' + pubUsable + ' 张 + 本桌面专属 ' + ownUsable + ' 张。' });
    }

    h('<div class="cal-card glass"><div class="cal-card-title">自检结论</div>');
    verdicts.forEach(function (v) {
      h('<div style="font-size:12.5px;line-height:1.7;color:' + colorOf(v.lv) + ';margin:4px 0">● ' + esc(v.t) + '</div>');
      ln('[' + (v.lv === 'ok' ? '正常' : v.lv === 'warn' ? '注意' : '问题') + '] ' + v.t);
    });
    h('</div>');

    // ===== 二级密码锁 =====
    var lockInner = '';
    lockInner += '<div class="storage-row"><span>当前状态</span><b style="color:' + (lock ? BAD : OK) + '">' + (lock ? '锁定中（系统预设字卡整体停用）' : '已解锁') + '</b></div>';
    lockInner += '<div class="storage-row"><span>存储键</span><b>' + GNS + ':cardlock-state（全局，不随桌面）</b></div>';
    card('一、二级密码锁（#319 防未成年人）', lockInner,
      '锁定时：默认聊天字卡、词典（含词典拼字）、其他互动功能字卡的系统预设内容全部取不到，各页开关看起来「开了却没效果」属正常。<br><b>不受此锁影响（#499 豁免）</b>：聊天情绪字卡、心意字卡、交流意图、聊天回应字卡、TA 的心情、今日情话、位置卡、查岗问题库、TA 主动提问——未解锁也照常使用。<br>解锁：开屏公告区「防未成年人·内置字卡锁定」卡点「输入密码解锁」；重锁：同卡一键重新上锁。');

    // ===== 系统预设·聊天默认字卡 =====
    var dcInner = '';
    dcInner += '<div class="storage-row"><span>总开关（dc-enabled）</span><b style="color:' + (dcEn ? OK : WARN) + '">' + (dcEn ? '开启' : '关闭') + '</b></div>';
    ['chat', 'mail', 'feed'].forEach(function (k) {
      dcInner += '<div class="storage-row"><span>' + (k === 'chat' ? '聊天' : k === 'mail' ? '信箱' : '朋友圈') + '使用（dc-use-' + k + '）</span><b>' + onOff(boolOf(store('dc-use-' + k), true)) + '</b></div>';
    });
    ['chat', 'mail', 'feed'].forEach(function (k) {
      dcInner += '<div class="storage-row"><span>' + (k === 'chat' ? '聊天' : k === 'mail' ? '写信' : '朋友圈') + '概率（dc-overall-' + k + '）</span><b>' + num(store('dc-overall-' + k), k === 'feed' ? 100 : 30) + '%</b></div>';
    });
    ['main', 'kaomoji', 'emoji', 'touch'].forEach(function (k) {
      var cat = boolOf(store('dc-cat-' + k), true);
      var total = presetCount(k), off = offCount(k);
      var usable = !lock && dcEn && cat && (total - off > 0);
      var st = statusOf(usable, lock ? '被锁停' : !dcEn ? '总开关关' : !cat ? '分类关' : (total - off <= 0 ? '无可用户卡' : '停用'));
      dcInner += '<div class="storage-row"><span>' + esc(CC_LABEL[k]) + '（dc-cat-' + k + ' / dc-prob-' + k + '）</span><b style="color:' + colorOf(st.lv) + '">' + onOff(cat) + ' · 占比 ' + num(store('dc-prob-' + k), 25) + '% · ' + total + ' 张' + (off ? '（关 ' + off + '）' : '') + ' · ' + st.t + '</b></div>';
    });
    card('二、系统预设 · 聊天默认字卡', dcInner,
      '概率 = 联系人回复时混入默认字卡的几率；分类占比 = 命中后内部按四大分类分配（相对权重）。系统预设字卡与自定义字卡机会互补（合计 100%）。');

    // ===== 系统预设·词典 =====
    var dictInner = '';
    ['chat', 'mail', 'feed'].forEach(function (k) {
      dictInner += '<div class="storage-row"><span>' + (k === 'chat' ? '聊天' : k === 'mail' ? '写信' : '朋友圈') + '使用（dict-use-' + k + '）</span><b>' + onOff(boolOf(store('dict-use-' + k), true)) + '</b></div>';
    });
    dictInner += '<div class="storage-row"><span>一键全关（dict-use-closeall）</span><b>' + (boolOf(store('dict-use-closeall'), false) ? '已全关' : '未使用') + '</b></div>';
    ['chat', 'mail', 'feed'].forEach(function (k) {
      dictInner += '<div class="storage-row"><span>' + (k === 'chat' ? '聊天' : k === 'mail' ? '写信' : '朋友圈') + '概率（dict-overall-' + k + '）</span><b>' + num(store('dict-overall-' + k), k === 'chat' ? 75 : 30) + '%</b></div>';
    });
    dictInner += '<div class="storage-row"><span>词典内置词条</span><b>' + presetGroups('dict').length + ' 组 · ' + presetCount('dict') + ' 条' + (offCount('dict') ? '（单卡关 ' + offCount('dict') + '）' : '') + '</b></div>';
    var dq = 0, dw = 0;
    try { dq = (JSON.parse(glob('dict-custom-quotes') || '[]') || []).length; } catch (e) {}
    try { dw = (JSON.parse(glob('dict-custom-words') || '[]') || []).length; } catch (e) {}
    dictInner += '<div class="storage-row"><span>自建词条（全局）</span><b>语录 ' + dq + ' 条 · 词 ' + dw + ' 条</b></div>';
    dictInner += '<div class="storage-row"><span>实际可用</span><b style="color:' + (lock ? BAD : OK) + '">' + (lock ? '被二级锁整体停用' : '可用') + '</b></div>';
    card('三、系统预设 · 词典（拼字抽句/切词）', dictInner,
      '词典属系统内置字卡，二级锁锁定时整池停用（下方开关全开也无效）；自建词条为全局键，不随桌面隔离。');

    // ===== 系统预设·其他互动功能字卡 =====
    var fInner = '';
    fInner += '<div class="storage-row"><span>总开关（dcf-enabled）</span><b style="color:' + (dcfEn ? OK : WARN) + '">' + (dcfEn ? '开启' : '关闭（deskcheck 除外）') + '</b></div>';
    fInner += '<div class="storage-row"><span>聊天概率总档（reply-dcp-all）</span><b>' + dcpAll() + '%</b></div>';
    DCF.forEach(function (d) {
      var key = d[0], name = d[1], def = d[2], hasPool = d[3];
      var raw = num(store('dcf-' + key), def);
      var eff = dcfEff(raw, key);
      var total = hasPool ? presetCount(key) : -1;
      var off = hasPool ? offCount(key) : 0;
      var gate = key === 'deskcheck' ? true : dcfEn;
      var usable = !lock && gate && eff > 0 && (!hasPool || (total - off > 0));
      var why = lock && hasPool ? '预设被锁停' : !gate ? '总开关关' : eff <= 0 ? '概率 0' : hasPool && total - off <= 0 ? '无可用户卡' : '停用';
      var st = statusOf(usable, why);
      var cnt = hasPool ? (total + ' 张' + (off ? '（关 ' + off + '）' : '')) : '—（发到聊天型，无独立字卡池）';
      fInner += '<div class="storage-row"><span>' + esc(name) + '（dcf-' + key + '）</span><b style="color:' + colorOf(st.lv) + '">存盘 ' + raw + '% · 生效 ' + eff + '% · ' + cnt + ' · ' + st.t + '</b></div>';
    });
    card('四、系统预设 · 其他互动功能字卡（19 类）', fInner,
      '生效概率 = 分类存盘值 × 聊天概率总档 ÷ 100；总开关关闭时除「跨桌面查岗」外全部归 0。二级锁锁定时系统预设内容不可用，但你自建的同类功能字卡仍可用（本页只统计系统预设张数）。');

    // ===== 系统预设·其他字卡池 =====
    var oInner = '';
    var MC = window.MOOD_FOLLOWUP_DATA || {};
    oInner += '<div class="storage-row"><span>聊天情绪/心意/意图（mc-enabled）</span><b style="color:' + (mcEn ? OK : WARN) + '">' + onOff(mcEn) + '</b></div>';
    oInner += '<div class="storage-row"><span>　情绪 / 心意 / 意图 概率</span><b>mc-prob-mood ' + num(store('mc-prob-mood'), 70) + '% · heart ' + num(store('mc-prob-heart'), 40) + '% · intent ' + num(store('mc-prob-intent'), 40) + '%</b></div>';
    oInner += '<div class="storage-row"><span>　情绪池张数</span><b>' + dataCount(MC.mood) + ' 张（不受二级锁影响）</b></div>';
    var rcEn = boolOf(store('rc-enabled'), true);
    oInner += '<div class="storage-row"><span>聊天回应字卡（rc-enabled）</span><b style="color:' + (rcEn ? OK : WARN) + '">' + onOff(rcEn) + ' · 整条替换 rcard-prob ' + num(store('rcard-prob'), 30) + '% · 连接词追加 cf-prob ' + num(store('cf-prob'), 20) + '% · ' + dataCount(MC.followup) + ' 张</b></div>';
    var tmEn = boolOf(store('tm-enabled'), true);
    oInner += '<div class="storage-row"><span>TA 的心情（tm-enabled）</span><b style="color:' + (tmEn ? OK : WARN) + '">' + onOff(tmEn) + ' · tm-prob ' + num(store('tm-prob'), 15) + '% · ' + dataCount((window.TA_MOOD_DATA || {}).groups) + ' 张</b></div>';
    oInner += '<div class="storage-row"><span>桌面今日情话（quote-cards-default）</span><b>' + onOff(boolOf(store('quote-cards-default'), true)) + '</b></div>';
    oInner += '<div class="storage-row"><span>TA在身边位置卡（loc-lib-default）</span><b>' + onOff(boolOf(store('loc-lib-default'), true)) + '</b></div>';
    oInner += '<div class="storage-row"><span>寻踪日常字卡（checkin-cards-default / dcf-checkin）</span><b>' + onOff(boolOf(store('checkin-cards-default'), true)) + ' · 概率 ' + num(store('dcf-checkin'), 100) + '%</b></div>';
    var ck = null;
    try { ck = JSON.parse(store('ta-checkin') || 'null'); } catch (e) {}
    var ckUseDef = ck && ck.settings ? ck.settings.useDefault !== false : true;
    oInner += '<div class="storage-row"><span>查岗问题库（ta-checkin.settings.useDefault）</span><b>' + onOff(ckUseDef) + ' · 触发 ckq-en ' + onOff(boolOf(store('ckq-en'), true)) + ' / ckq-prob ' + num(store('ckq-prob'), 2) + '%</b></div>';
    ['ta-ask:询问', 'ta-choose:小问题', 'ta-curious:好奇', 'ta-roast:吐槽'].forEach(function (pair) {
      var key = pair.split(':')[0], label = pair.split(':')[1];
      var blob = null;
      try { blob = JSON.parse(store(key) || 'null'); } catch (e) {}
      var s = blob && blob.settings ? blob.settings : {};
      var en = s.enabled !== false;
      var pr = s.prob === undefined ? 5 : s.prob;
      oInner += '<div class="storage-row"><span>TA 主动·' + label + '（' + key + '.settings）</span><b>' + onOff(en) + ' · 概率 ' + pr + '%</b></div>';
    });
    card('五、系统预设 · 其他字卡池（不受二级锁影响）', oInner,
      '这一组按 #499 明确豁免：未解锁二级密码也照常使用。各池开关存于各自数据块/键，本页只读展示，不改动。');

    // ===== 自定义字卡：公用 / 专属 =====
    function customCard(scope, title, offRec) {
      var inner = '';
      var any = false;
      CC_ORDER.forEach(function (t) {
        var grps = scopePool(scope, t);
        var gc = grps.length, cc = 0;
        grps.forEach(function (g) { cc += (g && Array.isArray(g[1]) ? g[1].length : 0); });
        var offs = (offRec && Array.isArray(offRec[t])) ? offRec[t] : [];
        if (!gc && !cc && !offs.length) return;
        any = true;
        var offTxt = offs.length ? ' · <span style="color:' + WARN + '">已停用 ' + offs.length + ' 组：' + esc(offs.join('、')) + '</span>' : '';
        inner += '<div class="storage-row"><span>' + esc(CC_LABEL[t]) + '</span><b>' + gc + ' 组 / ' + cc + ' 张' + offTxt + '</b></div>';
      });
      if (!any) inner = '<div class="storage-hint">该库为空：没有任何自定义字卡。</div>';
      return { inner: inner, any: any };
    }
    card('六、自定义字卡 · 公用库（全桌面共享）', pubC.inner, '这里统计的是「可用」状态：已被停用的分组不计入组/张数，但在右侧列出停用名单可随时回字卡库重新启用。');
    card('七、自定义字卡 · 当前桌面专属库（' + esc(deskName(activeCid())) + '）', ownC.inner, '专属库仅当前桌面的联系人生效；分组停用只影响「使用」，字卡本身仍保留在字卡库中。');

    // ===== 各桌面概览 =====
    var deskInner = '';
    if (!contactsArr.length) deskInner = '<div class="storage-hint">未读取到联系人列表。</div>';
    contactsArr.forEach(function (c) {
      var cid = c && c.id ? c.id : 'default';
      var name = (c && c.name) || cid;
      var raw = rawFor(cid, 'cc-groups');
      var kb = raw ? Math.round(String(raw).length * 2 / 1024) : 0;
      var ofRec = {};
      try { ofRec = JSON.parse(rawFor(cid, 'cc-groups-off') || '{}') || {}; } catch (e) { ofRec = {}; }
      var offN = 0;
      Object.keys(ofRec).forEach(function (t) { if (Array.isArray(ofRec[t])) offN += ofRec[t].length; });
      var isCur = cid === activeCid();
      deskInner += '<div class="storage-row"><span>' + esc(name) + (isCur ? '（当前桌面）' : '') + '</span><b>' + (raw ? '约 ' + kb + ' KB' : '空库') + ' · 停用分组 ' + offN + ' 个</b></div>';
    });
    card('八、各桌面专属字卡概览', deskInner,
      '为避免超大库（单键可达 150MB+）卡死页面，此处只报整库体积与停用分组数，不逐张解析各桌面；当前桌面的分组明细见上一节。');

    var reportHtml = html.join('');
    var reportText = lines.join('\n');
    return { html: reportHtml, text: reportText };
  }

  function render() {
    var r = build();
    lastText = r.text;
    bodyEl.innerHTML = r.html;
  }

  function openPage() {
    try {
      render();
      document.querySelectorAll('.page').forEach(function (p) { p.hidden = true; });
      page.hidden = false;
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
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('自检报告已复制'); }, fallback);
      } else fallback();
    } catch (e) { fallback(); }
  }

  if (row) row.addEventListener('click', openPage);
  if (back) back.addEventListener('click', closePage);
  if (refreshBtn) refreshBtn.addEventListener('click', function () { render(); toast('已重新自检'); });
  if (copyBtn) copyBtn.addEventListener('click', copyReport);

  // 锁状态 / 切桌面 / 数据回填完成后，若自检页正开着则实时刷新
  ['mochi-cardlock-open', 'mochi-cardlock-locked', 'contact-switched', 'mochi-restore-done'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      try { if (!page.hidden) render(); } catch (e) {}
    });
  });
})();
