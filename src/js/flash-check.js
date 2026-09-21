// ===== v3.26.x #946：闪屏自测（设置 → 工具 一行；把 #938 那把无头尺子搬到真机的只读诊断）=====
// 需求（用户直派「在红米 K80 真机验证闪屏修复」）：#938 修的是「值没变也把全站内联样式重写一遍」型闪屏。
// 无头环境只能拿参数代理（同屏幕参数＋CPU 节流）做 A/B，测不到用户手上那一台；而「有没有闪」全靠主观
// 感觉，用户报回来也只有一句「还在闪」。本自测让真机自己出数字：点【开始】后去
// 聊天设置/群聊设置 → 美化 → 边看边调 按浮条提示点 4 下（第 2 下故意重复点同一个档＝「值没变」的那一下），
// 每一次点击单独量三件事：
//   ①全站样式翻动＝:root / #page-chat / #page-group-chat 的 style 属性真被改了几次（MutationObserver，整篇文档样式作用域
//     重解析＝闪屏的直接来源；不认写入方是谁，别的模块在写也算得出来）
//   ②同值白写＝值一个字没变仍写进 DOM 的条数（内联变量同值 setProperty／空 removeProperty／空摘 cs-*
//     类／cs-* 样式表拆建，按 --msg-/--chat-/--typing-/--send-/--cs- 名族判定）——#938 的根因面
//   ③帧＝rAF 真实帧间隔（最慢帧与 >50ms 掉帧数）＝那一下到底卡没卡
// 分段以「用户的点击」为锚，不以「写入事件」为锚：修好之后值没变那一下是彻底零写入的，若靠写入事件开段
// 就永远不会留下记录，报告会假称「没采到」——这是探针可用性的前提（点击之外的事件一律不单独成段）。
// 抽屉与宿主都是一族（#966，红米 K80 实报「没有采到抽屉里的点击」）：单聊 #chat-beauty-drawer 把变量
// 写在 :root/#page-chat，群聊 #gc-beauty-drawer 写在 #page-group-chat——只认单聊那一套时，用户在群聊
// 「边看边调」里点档位判成「不在抽屉里」且写入没人看，报告静默变「没采到」。现在两族都认，
// 且「没采到」会拆开讲是「压根没点」还是「点了但不在抽屉里」。
// 判据：只有「值没变的那一下」翻动/白写为 0 才算修好；值真变了要重写样式＝功能必要开销，不算缺陷。
// 口径：全程只读——不写任何业务键、不改任何设置值（档位本来就是用户自己点的），【结束】即摘干净全部探针、
// 浮条与监听零残留；只有最后一次报告存 xy-home-v2:flash-check-last（同 #935 两个自测的 *_last 口径）。
(function () {
  'use strict';
  if (window.mochiFlashCheck) return;

  var LAST_KEY = 'xy-home-v2:flash-check-last';
  // 聊天美化抽屉写的变量名族（chat-settings.js 的 applySettings 全部落在这里面）
  var VAR_NS = /^(--msg-|--chat-|--typing-|--send-|--cs-)/;
  var GAP_MS = 400;      // 一次点击往后收 400ms 的写入事件（同一记点击的同步写入与随后微任务里的计数）
  var TAIL_MS = 700;     // 一次点击往后收 700ms 的帧（点击后的重排/重合成都落在这段）
  var MAX_OPS = 8;
  var JANK_MS = 50;      // 手机 60fps 下 >50ms 视为肉眼可见的跳帧

  var _on = false;
  var _clicks = [], _ev = [], _flips = [], _frames = [];
  var _styleHooks = [], _obs = [], _origRemove = null, _chip = null, _onClick = null;
  var _seen = 0, _seenIn = 0;   // #966：屏幕点击总数 / 其中落在抽屉内的次数（报障时区分「没点」与「点错地方」）

  function now() { try { return performance.now(); } catch (e) { return Date.now(); } }
  // 版本号：#about-ver-val 是构建时替换的真值（window.APP_VERSION 未必赋值，见 card-audit.js 同款注释）
  function appVer() {
    try { var el = document.getElementById('about-ver-val'); var t = el && String(el.textContent || '').trim(); if (t && t.indexOf('__') < 0) return t; } catch (e) {}
    try { return String(window.APP_VERSION || '未知'); } catch (e2) { return '未知'; }
  }

  function mark(kind, name) { if (_on) _ev.push({ t: now(), k: kind, n: name || '' }); }
  // :root / #page-chat 的 style 真被改（带时刻入表；归哪一次点击由 collect() 判定，落不进窗口的算局外改写）
  function flip(where) { if (_on) _flips.push({ t: now(), w: where }); }
  var _other = 0;

  // —— 内联变量写入钩子：按元素挂钩（documentElement.style 上 mobile-adapt 已有实例级包装，
  //    只钩原型会被它遮蔽＝抓到 0 次写入的假绿，故必须链在实例上；【结束】原样还原）——
  function getVal(s, n) { try { return s.getPropertyValue(n); } catch (e) { return ''; } }
  function hookStyle(el, tag) {
    if (!el || !el.style) return;
    var s = el.style, _set = s.setProperty, _del = s.removeProperty;
    s.setProperty = function (n, v) {
      if (_on) {
        try {
          var name = String(n);
          if (VAR_NS.test(name)) {
            if (getVal(s, name) === String(v)) mark('n');       // 同值白写
            else mark('w', tag + ':' + name);                    // 必要写入
          }
        } catch (e) {}
      }
      return _set.apply(s, arguments);
    };
    s.removeProperty = function (n) {
      if (_on) {
        try { if (VAR_NS.test(String(n)) && getVal(s, String(n)) === '') mark('dn'); } catch (e) {}
      }
      return _del.apply(s, arguments);
    };
    _styleHooks.push({ s: s, set: _set, del: _del });
  }

  function arm() {
    var root = document.documentElement;
    hookStyle(root, 'root');
    // #966：宿主是一族。单聊把美化变量写在 :root 与 #page-chat 上；群聊写在 #page-group-chat 上
    // （group-chat.js applyGcBeauty 的 page.style.setProperty，变量名族与单聊同款）。只挂单聊两个宿主＝
    // 用户在群聊「边看边调」里点档位时写到的地方没人看，报告静默变成「没采到」（红米 K80 实报面）。
    var hosts = [];
    for (var h = 0; h < HOSTS.length; h++) {
      var el = document.getElementById(HOSTS[h]);
      if (el) { hookStyle(el, HOSTS[h]); hosts.push(el); }
    }
    // 真属性变更＝整篇文档样式作用域重解析的直接证据（与写入方是谁无关）
    var mo = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type !== 'attributes' || m.attributeName !== 'style') continue;
        flip(m.target === root ? 'root' : String(m.target.id || 'chat'));
      }
    });
    mo.observe(root, { attributes: true, attributeFilter: ['style'] });
    for (var j = 0; j < hosts.length; j++) mo.observe(hosts[j], { attributes: true, attributeFilter: ['style'] });
    _obs.push(mo);
    // cs-* 样式表拆建（enforce / contrast 两层）：重建＝整层样式重新解析
    var mo2 = new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var bump = function (list) {
          for (var k = 0; k < list.length; k++) {
            var nd = list[k];
            if (nd.nodeName === 'STYLE' && String(nd.id || '').indexOf('cs-') === 0) mark('ss');
          }
        };
        bump(ms[i].addedNodes); bump(ms[i].removedNodes);
      }
    });
    mo2.observe(document.head, { childList: true });
    _obs.push(mo2);
    // 空摘 cs-* 类（remove 一个本来就没有的类＝纯白动作）
    _origRemove = DOMTokenList.prototype.remove;
    DOMTokenList.prototype.remove = function () {
      if (_on) {
        for (var i = 0; i < arguments.length; i++) {
          var c = String(arguments[i]);
          if (c.indexOf('cs-') === 0 && !this.contains(c)) mark('cn');
        }
      }
      return _origRemove.apply(this, arguments);
    };
    // 点击锚：抽屉里每一次点击＝一次测量段（值没变、零写入也照样留记录，这是「修好了」能被证明的前提）
    _onClick = function (e) {
      if (!_on) return;
      var t = now();
      var hit = drawerHit(e.target);
      _seen++;
      if (hit) _seenIn++;
      if (_clicks.length >= MAX_OPS * 6) _clicks.shift();
      _clicks.push({ t: t, in: hit });
    };
    document.addEventListener('click', _onClick, true);
    (function frames() {
      var last = now();
      requestAnimationFrame(function tick() {
        if (!_on) return;
        var t = now();
        _frames.push({ t: t, gap: t - last });
        last = t;
        if (_frames.length > 6000) _frames.splice(0, 3000);
        requestAnimationFrame(tick);
      });
    })();
  }
  // #966：抽屉是一族（单聊 #chat-beauty-drawer／群聊 #gc-beauty-drawer，两个「边看边调」同源同貌）。
  // 只看单聊那一个＝用户在群聊抽屉里点档位被判成「不在抽屉里」，报告静默变「没采到」（红米 K80 实报）。
  var DRAWERS = ['chat-beauty-drawer', 'gc-beauty-drawer'];
  var HOSTS = ['page-chat', 'page-group-chat'];
  var DRAWER_NAME = { 'chat-beauty-drawer': '单聊', 'gc-beauty-drawer': '群聊' };
  function drawerHit(el) {
    if (!el) return '';
    for (var i = 0; i < DRAWERS.length; i++) {
      var d = document.getElementById(DRAWERS[i]);
      if (!d) continue;
      try { if (d.contains(el)) return DRAWERS[i]; } catch (e) {}
    }
    return '';
  }

  // —— 分桶：把写入事件/属性变更/帧按「抽屉里的点击」归段 ——
  function collect() {
    var list = [];
    for (var i = 0; i < _clicks.length && list.length < MAX_OPS; i++) { if (_clicks[i].in) list.push({ t: _clicks[i].t, d: _clicks[i].in, o: newOp(_clicks[i].t) }); }
    var owner = function (t) {
      var best = -1;
      for (var i = 0; i < list.length; i++) { if (t >= list[i].t - 2 && t - list[i].t <= GAP_MS) best = i; }
      return best;
    };
    var other = 0;
    for (var e = 0; e < _ev.length; e++) {
      var k = owner(_ev[e].t); if (k < 0) { other++; continue; }
      var o = list[k].o, kind = _ev[e].k;
      if (kind === 'w') { o.writes++; if (_ev[e].n) o.names[_ev[e].n] = 1; }
      else if (kind === 'n') o.noop++;
      else if (kind === 'dn') o.delNoop++;
      else if (kind === 'cn') o.clsNoop++;
      else if (kind === 'ss') o.swap++;
    }
    for (var f = 0; f < _flips.length; f++) {
      var kk = owner(_flips[f].t); if (kk < 0) { other++; continue; }
      var w = _flips[f].w;
      if (w === 'root') list[kk].o.flipRoot++;
      else if (w === 'page-group-chat') list[kk].o.flipGc++;
      else list[kk].o.flipChat++;
    }
    _other = other;
    for (var j = 0; j < list.length; j++) {
      var t0 = list[j].t, t1 = t0 + TAIL_MS;
      if (j + 1 < list.length && list[j + 1].t < t1) t1 = list[j + 1].t;
      var o = list[j].o, gaps = [], sorted = [], jank = 0;
      for (var m = 0; m < _frames.length; m++) { if (_frames[m].t >= t0 && _frames[m].t <= t1) gaps.push(_frames[m].gap); }
      sorted = gaps.slice().sort(function (a, b) { return a - b; });
      o.frames = gaps.length;
      o.maxGap = sorted.length ? Math.round(sorted[sorted.length - 1]) : 0;
      for (var g = 0; g < gaps.length; g++) { if (gaps[g] > JANK_MS) jank++; }
      o.jank = jank;
    }
    var ops = [];
    for (var q = 0; q < list.length; q++) { var od = done(list[q].o); od.drawer = DRAWER_NAME[list[q].d] || ''; ops.push(od); }
    return ops;
  }
  function newOp(t) {
    return { t0: t, writes: 0, noop: 0, delNoop: 0, clsNoop: 0, swap: 0, flipRoot: 0, flipChat: 0, flipGc: 0, frames: 0, maxGap: 0, jank: 0, names: {} };
  }
  function done(o) { o.changed = Object.keys(o.names).join(' '); delete o.names; return o; }

  // —— 浮条：只讲下一步做什么＋计数，自己不写 :root（不参与采样）——
  function chip() {
    if (_chip) return _chip;
    var d = document.createElement('div');
    d.id = 'fc-chip';
    // #966：贴屏幕顶部，不再贴底。原先 bottom:78px 正好落在「边看边调」抽屉（z 95、最高 40vh）的
    // 覆盖区里——z 82 < 95，用户在抽屉里点档位时这条指引是看不见也点不到的（要看结果得先关抽屉，
    // 等于把人支开）。顶部与底部抽屉物理不相交，z 88 仍在报告框 .modal-mask(90) 之下。
    d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:calc(6px + env(safe-area-inset-top,0px));z-index:88;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:20px;background:rgba(17,17,17,.86);color:#fff;font-size:12px;line-height:1.4;box-shadow:0 4px 14px rgba(0,0,0,.28)';
    var txt = document.createElement('span');
    txt.id = 'fc-chip-txt';
    txt.textContent = '去点 4 下：宽松 → 再点宽松 → 紧凑 → 标准';
    var b1 = document.createElement('button');
    b1.id = 'fc-chip-view';
    b1.type = 'button';
    b1.textContent = '看结果';
    b1.style.cssText = 'border:0;border-radius:12px;padding:4px 10px;background:#ffd43b;color:#111;font-size:12px;flex:none';
    var b2 = document.createElement('button');
    b2.id = 'fc-chip-stop';
    b2.type = 'button';
    b2.textContent = '结束';
    b2.style.cssText = 'border:1px solid rgba(255,255,255,.5);border-radius:12px;padding:4px 10px;background:transparent;color:#fff;font-size:12px;flex:none';
    b1.addEventListener('click', function () { showReport(); });
    b2.addEventListener('click', function () { stop(); });
    d.appendChild(txt); d.appendChild(b1); d.appendChild(b2);
    document.body.appendChild(d);
    _chip = d;
    return d;
  }
  function chipSay(s) {
    if (!_chip) return;
    var t = _chip.querySelector('#fc-chip-txt');
    if (t) t.textContent = s;
  }

  // —— 报告 ——
  function wasteOf(o) { return o.noop + o.delNoop + o.clsNoop + (o.writes ? 0 : o.swap); }
  function opLine(o, i) {
    return '操作 ' + (i + 1) + (o.drawer ? '（' + o.drawer + '抽屉）' : '') + '｜' + (o.writes ? '值真变了（必要写 ' + o.writes + ' 条' + (o.changed ? '：' + o.changed : '') + '）' : '值没变（重复点同一档／切回刚点过的档）')
      + '\n  全站样式翻动 ' + (o.flipRoot + o.flipChat + o.flipGc) + ' 次（:root ' + o.flipRoot + '／聊天页 ' + o.flipChat + '／群聊页 ' + o.flipGc + '）｜白写 ' + wasteOf(o) + ' 条（同值重写 ' + o.noop + '／空删变量 ' + o.delNoop + '／空摘 cs-* 类 ' + o.clsNoop + '／样式表拆建 ' + o.swap + '）'
      + '\n  帧 ' + o.frames + ' 个｜最慢帧 ' + o.maxGap + 'ms｜>' + JANK_MS + 'ms 掉帧 ' + o.jank + ' 帧';
  }
  function buildReport() {
    var ops = collect();
    var lines = ['闪屏自测（聊天美化·边看边调）· ' + appVer(), '设备：' + String(navigator.userAgent || '').slice(0, 100), ''];
    if (!ops.length) {
      // #966：把「没采到」拆开讲——是压根没点，还是点了但不在抽屉里（点错地方）。
      // 红米 K80 实报那句「没有采到抽屉里的点击」原本两种情形同一句话，用户与开发者都无从下手。
      if (!_seen) lines.push('没有采到任何屏幕点击：请点【开始】后回到 聊天设置/群聊设置 → 美化 → 边看边调 点档位（第 2 下重复点同一个档）。');
      else if (!_seenIn) lines.push('没有采到「抽屉里」的点击：这段时间共采到 ' + _seen + ' 次屏幕点击，但都不在 边看边调 的底部抽屉里。请确认点的是「聊天设置/群聊设置 → 美化 → 边看边调」打开的那条底部抽屉里的档位按钮（抽屉里可点的档位＝宽松/标准/紧凑这类胶囊）。');
      else lines.push('没有采到抽屉里的点击：请点【开始】后到 聊天设置/群聊设置 → 美化 → 边看边调 点档位（第 2 下重复点同一个档）。');
    }
    for (var i = 0; i < ops.length; i++) lines.push(opLine(ops[i], i));
    var noopOps = ops.filter(function (o) { return !o.writes; });
    var wasteAll = 0, jankAll = 0, worst = 0, flipAll = 0;
    for (var k = 0; k < noopOps.length; k++) {
      wasteAll += wasteOf(noopOps[k]);
      flipAll += noopOps[k].flipRoot + noopOps[k].flipChat + noopOps[k].flipGc;
      jankAll += noopOps[k].jank;
      if (noopOps[k].maxGap > worst) worst = noopOps[k].maxGap;
    }
    lines.push('');
    if (!noopOps.length) lines.push('结论：没采到「值没变」的那一下——照提示把同一个档点两次（第 2 下就是），再点【看结果】。');
    else if (flipAll === 0 && wasteAll === 0 && jankAll === 0) lines.push('结论：值没变时全站样式翻动 0 次、白写 0 条、不掉帧（最慢帧 ' + worst + 'ms）＝未见闪屏来源（#938 修复在跑）。');
    else if (flipAll === 0 && wasteAll === 0) lines.push('结论：值没变时样式一字没写（翻动 0／白写 0），但那一下掉了 ' + jankAll + ' 帧（最慢帧 ' + worst + 'ms）＝闪的来源不在这里，多见于图片解码、字卡库体积或后台保活；把这份报告发回来。');
    else lines.push('结论：值没变仍然惊动了全站样式（真翻动 ' + flipAll + ' 次、白写 ' + wasteAll + ' 条，那一下掉帧 ' + jankAll + ' 帧、最慢帧 ' + worst + 'ms）＝#938 那型根因仍在。请先确认已更新到最新版（设置 → 关于 看版本与部署时间，顶部有「检测到新版本」就点它）；仍复现就把这份报告发回来。');
    if (_other) lines.push('附：另测到 ' + _other + ' 次与本抽屉无关的全站样式改写（不计入上面结论，仅供参考）。');
    return { text: lines.join('\n'), ops: ops, noopOps: noopOps.length, wasteAll: wasteAll, flipAll: flipAll, jankAll: jankAll, worstGap: worst };
  }
  function showReport() {
    var rep = buildReport();
    chipSay('已记录 ' + rep.ops.length + ' 次点击 · 值没变那一下：翻动 ' + rep.flipAll + '／白写 ' + rep.wasteAll + '／掉帧 ' + rep.jankAll);
    if (!window.openModal) return rep;
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ ts: Date.now(), ver: appVer(), text: rep.text, wasteAll: rep.wasteAll, flipAll: rep.flipAll, jankAll: rep.jankAll })); } catch (e) {}
    var ctl = window.openModal('闪屏自测结果', rep.text, function () {}, {
      noInput: true, textarea: true, textareaRows: 16, big: true,
      staticText: '只在本机采样、不上传；可【复制】发给开发者。看「值没变」那一下的【全站样式翻动／白写】＝0 才算修好。',
      copyBtn: {
        label: '复制',
        fn: function (c) {
          var txt = c && c.text ? c.text() : rep.text;
          var hint = function (s) { if (c && c.hint) c.hint(s); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(txt).then(function () { hint('已复制到剪贴板，直接粘贴发给开发者即可'); }, function () { hint('复制失败，请长按文本手动选中复制'); });
          } else hint('当前内核不支持一键复制，请长按文本手动复制');
        }
      }
    });
    if (ctl && ctl.okText) ctl.okText('知道了');
    return rep;
  }

  function stop() {
    if (!_on) return false;
    _on = false;
    if (_onClick) { try { document.removeEventListener('click', _onClick, true); } catch (e) {} _onClick = null; }
    for (var i = 0; i < _obs.length; i++) { try { _obs[i].disconnect(); } catch (e) {} }
    _obs.length = 0;
    for (var j = 0; j < _styleHooks.length; j++) {
      var h = _styleHooks[j];
      try { h.s.setProperty = h.set; h.s.removeProperty = h.del; } catch (e) {}
    }
    _styleHooks.length = 0;
    if (_origRemove) { try { DOMTokenList.prototype.remove = _origRemove; } catch (e) {} _origRemove = null; }
    if (_chip && _chip.parentNode) _chip.parentNode.removeChild(_chip);
    _chip = null;
    _clicks.length = 0; _ev.length = 0; _flips.length = 0; _frames.length = 0;
    return true;
  }

  function start() {
    if (_on || !window.openModal) return false;
    _on = true; _other = 0; _seen = 0; _seenIn = 0;
    _clicks = []; _ev = []; _flips = []; _frames = [];
    arm();
    chip();
    return true;
  }

  function ask() {
    if (_on) { showReport(); return; }
    var ctl = window.openModal('闪屏自测（聊天美化）', '', function () { start(); }, {
      noInput: true,
      staticText: '点【开始】后去 聊天设置（或 群聊设置）→ 美化 → 边看边调，按屏幕顶部提示点 4 下：\n①「气泡框大小」选 宽松　②再点一次 宽松（值没变＝日常最闪的那一下）　③紧凑　④标准\n点完回来点浮条【看结果】，当场出数字。\n\n机制：只读采样——数一数每次点击让整篇文档的样式重解析了几次、其中几次是「值没变的白写」，并用 rAF 量真实帧间隔。不改你的任何设置、不写业务数据，点【结束】即摘掉全部探针。'
    });
    if (ctl && ctl.okText) ctl.okText('开始');
  }

  function boot() {
    var row = document.getElementById('row-flash-check');
    if (row && !row.__fc) {
      row.__fc = 1;
      row.addEventListener('click', ask);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  window.mochiFlashCheck = {
    start: start,
    stop: stop,
    report: buildReport,
    showReport: showReport,
    running: function () { return _on; },
    ops: function () { return collect(); },
    LAST_KEY: LAST_KEY,
    VAR_NS: VAR_NS
  };
})();
