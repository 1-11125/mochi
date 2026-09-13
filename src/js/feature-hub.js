// ===== 功能：功能大全（设置 → 功能大全，#305）=====
// 需求（用户 2026-09-11）：设置里新增一个和【回音机】【功能大全】一样的功能——
// 全应用功能的可搜索索引页，点条目直达对应功能。灵感来源：回音机。
// #305b 重构（用户 2026-09-13 反馈「打开后一页 84 行太杂」）：默认「全部分组平铺」改为
// 「热门直达 + 7 分类宫格首页 → 点分类进该组列表」，顶部 tag 在列表态可互相切换/回首页；
// 搜索保持全局跨组（命中行按组显示），清空搜索回到进入前的视图。
// 跳转机制：go 数组里的选择器按顺序逐个 .click()——各功能的打开逻辑都绑定在既有入口元素上
//（桌面图标 .app[data-app=…] / 设置行 #row-* / 聊天更多面板按钮 #more-* / 字卡库列表项 #li-*），
// 且均为同步 handler、首个元素的处理函数都会切页，链式点击即完整复现用户的操作路径，
// 本文件不重复实现任何打开逻辑（功能入口变了跟着改 go 数组即可）。
// where：没有可靠直达入口的功能，点击弹位置提示，不乱跳。
// 纯本地、无网络请求；唯一写入键 xy-home-v2:fhub-freq（常用功能点击计数，LS+IDB 双写，
// 全局键不区分联系人——目录索引与跳转目标都是全局的）。
(function () {
  // ---- 目录数据：g 组名 / n 名称 / d 一句话 / k 搜索关键词（含别名） / go 入口选择器链 / where 位置提示 ----
  const HUB = [
    { g: '聊天传讯', items: [
      { n: '聊天', d: '和 TA 的主聊天：字卡回复、图文、引用、撤回补发', k: '聊天 消息 字卡', go: ['.app[data-app="chat"]'] },
      { n: '群聊', d: '所有桌面成员聚在一个窗口聊天（需先在设置开启群聊模式）', k: '群聊 多人', go: ['.app[data-app="group-chat"]'] },
      { n: '聊天设置', d: '聊天壁纸、气泡样式颜色、字体大小行距', k: '壁纸 气泡 字体 美化', go: ['.app[data-app="chat"]', '#chat-settings-btn'] },
      { n: '回复设置', d: 'TA 的回复速度/条数/各类行为概率，全部可调', k: '概率 参数 速度 条数 主动', go: ['#row-general'] },
      { n: '联系人 / 多桌面', d: '新建/改名/删除/切换联系人，数据互相独立', k: '联系人 桌面 切换', go: ['#row-contacts'] },
      { n: '搜索聊天记录', d: '按关键词/日期搜聊天记录并跳转', k: '搜索 查找 记录', go: ['.app[data-app="chat"]', '#more-search'] },
      { n: '批量发送', d: '一次编排多条消息（表情/图片/文字）按顺序发送', k: '批量 连发', go: ['.app[data-app="chat"]', '#chat-batch-btn'] },
      { n: '语音消息', d: '录音最长 60 秒，试听后发语音', k: '语音 录音 麦克风', go: ['.app[data-app="chat"]', '#chat-mic-btn'] },
      { n: '表情包管理', d: '我的表情包分组/上传/批量删除（聊天表情面板）', k: '表情包 表情 管理 上传 分组 斗图', go: ['.app[data-app="chat"]', '#chat-emoji-btn'] },
      { n: '批量提问问卷', d: '你批量出题，TA 限时作答交卷', k: '问卷 提问 批量 出题 考试 答题', go: ['.tab[data-page="page-chatcard"]', '#li-ta-ask', '#ta-ask-survey-open'] },
      { n: '拍一拍', d: '拍 TA 一下，TA 也会拍回来', k: '拍一拍 互动', go: ['.app[data-app="chat"]', '#more-poke'] },
      { n: '引用回复', d: '引用某条消息回复，可带表情包+文字', k: '引用 回复', where: '聊天里长按任意消息' },
      { n: '通话', d: '拨打/接听电话，可设自定义铃声与背景；跨桌面来电（默认关闭，设置里手动开启）接听会自动跳到对方桌面（通话与记录归属对方桌面，刻意设计）', k: '电话 通话 打电话 跨桌面来电 来电记录', go: ['.app[data-app="chat"]', '#more-call'] },
      { n: '邀请 TA', d: '发邀请字卡（预设+自定义，可重复发送）', k: '邀请 约会', go: ['.app[data-app="chat"]', '#more-invite'] },
      { n: '问问 TA / TA 的提问', d: '让 TA 现在问你一次（提问/选择题/好奇/吐槽），或向 TA 发问', k: '提问 问问 问题 选择题 好奇 吐槽 现在', go: ['.app[data-app="chat"]', '#more-ask'] },
      { n: '收藏', d: '我的收藏 / TA 的收藏 分页浏览与批量管理', k: '收藏 星标', go: ['.app[data-app="note"]'] },
      { n: '收藏设置', d: 'TA 自动收藏消息/字卡/信件/动态的概率与统计', k: '收藏 设置 概率 自动收藏', go: ['.app[data-app="note"]', '#fav-settings-btn'] },
      { n: '词典拼字', d: '语录字卡按概率拼成单气泡/逐条连发，两形态可开关', k: '拼字 词典 语录 连发', go: ['#row-general'] },
      { n: '梦角自由造句', d: 'TA 按概率截词重造句，语料来源与权重可调', k: '造句 自由造句 梦角 截词', go: ['#row-general'] }
    ] },
    { g: '字卡库', items: [
      { n: '字卡库', d: '全部字卡的统一入口：公用/专属/预设/情绪/回应…', k: '字卡库 词库', go: ['.tab[data-page="page-chatcard"]'] },
      { n: '词典字卡', d: '独立词典大分类：TA 说话的词库来源管理', k: '词典 词库 大分类', go: ['.tab[data-page="page-chatcard"]', '#li-dict-cards'] },
      { n: '公用 / 专属自定义字卡', d: '自建字卡：公用全桌面共享，专属仅当前 TA', k: '自定义 公用 专属', go: ['.tab[data-page="page-chatcard"]', '#li-custom-cards'] },
      { n: '系统预设字卡', d: '内置词库逐句开关，含词典语录分类', k: '预设 内置 词典 语录', go: ['.tab[data-page="page-chatcard"]', '#li-default-cards'] },
      { n: '聊天情绪字卡', d: '情绪/心意/交流意图词库，按心情匹配', k: '情绪 心意 交流意图', go: ['.tab[data-page="page-chatcard"]', '#li-mood-cards'] },
      { n: '聊天回应字卡', d: '游戏胜负平局等场景的回应词库', k: '回应 游戏 胜利 失败', go: ['.tab[data-page="page-chatcard"]', '#li-reply-cards'] },
      { n: '语录字卡', d: '今日情话等语录内容管理', k: '语录 情话', go: ['.tab[data-page="page-chatcard"]', '#li-quote-cards'] },
      { n: '其他互动功能字卡', d: '摸鱼/吃饭/经期/喝水/花园等功能触发字卡', k: '互动 功能字卡 摸鱼 经期 喝水', go: ['.tab[data-page="page-chatcard"]', '#li-fun-cards'] },
      { n: 'TA 的提问字卡', d: '询问/小问题/好奇/吐槽/邀请 题库自定义', k: '提问 题库 询问 好奇 吐槽', go: ['.tab[data-page="page-chatcard"]', '#li-ta-ask'] },
      { n: 'TA 的心情字卡', d: 'TA 聊天中主动分享心情/状态的概率与词库', k: '心情 状态 主动分享', go: ['.tab[data-page="page-chatcard"]', '#li-ta-mood'] },
      { n: 'TA 的选择题字卡', d: 'TA 出选择题考你/让你选的题库自定义', k: '选择题 提问 选择', go: ['.tab[data-page="page-chatcard"]', '#li-ta-choose'] },
      { n: 'TA 的好奇字卡', d: 'TA 好奇问你问题的题库自定义', k: '好奇 提问 问题', go: ['.tab[data-page="page-chatcard"]', '#li-ta-curious'] },
      { n: 'TA 的吐槽字卡', d: 'TA 吐槽/调侃内容的题库自定义', k: '吐槽 调侃', go: ['.tab[data-page="page-chatcard"]', '#li-ta-roast'] },
      { n: 'TA 的邀请字卡', d: 'TA 主动发来的猜拳/游戏/贴贴邀请题库', k: '邀请 猜拳 游戏 贴贴', go: ['.tab[data-page="page-chatcard"]', '#li-ta-invite'] },
      { n: '字卡库完整导出', d: '仅导出全部字卡库内容（区别于整包备份）', k: '字卡库 导出 完整 备份', go: ['.tab[data-page="page-chatcard"]', '#li-cc-full-export'] },
      { n: '字卡库完整导入', d: '从字卡库导出文件恢复全部字卡', k: '字卡库 导入 完整 恢复', go: ['.tab[data-page="page-chatcard"]', '#li-cc-full-import'] },
      { n: '查岗互动字卡', d: '温柔关心式查岗问题卡内容自定义', k: '查岗 定位', go: ['.tab[data-page="page-chatcard"]', '#li-ta-checkin'] },
      { n: '寻踪日常字卡', d: 'TA 的日常/在哪里/在做什么/想对你说 内容', k: '寻踪 日常 位置', go: ['.tab[data-page="page-chatcard"]', '#li-loc-cards'] },
      { n: '桌面查岗字卡', d: '联系人跨桌面查岗的系统预设字卡管理', k: '桌面查岗 跨桌面', go: ['.tab[data-page="page-chatcard"]', '#li-deskcheck'] },
      { n: '贴贴邀请字卡', d: '贴贴/抱抱/牵手等邀请的内容词库', k: '贴贴 抱抱 牵手', go: ['.tab[data-page="page-chatcard"]', '#li-checkin-cards'] }
    ] },
    { g: '互动与心意', items: [
      { n: '红包', d: '双向红包：预设档/随机/自定义金额、留言与封面', k: '红包 转账 钱', go: ['.app[data-app="chat"]', '#more-rp'] },
      { n: '心意币 · 心意市集', d: '220+ 件商品分 12 类，送礼给 TA（桌面有独立图标）', k: '市集 商店 礼物 购买 心意币', go: ['.app[data-app="market"]'] },
      { n: '心意柜', d: '收到/送出的礼物册与统计（桌面有独立图标）', k: '礼物柜 收藏 礼物', go: ['.app[data-app="giftbox"]'] },
      { n: '头像互动', d: '换头像邀请、头像池、定时自动换头像', k: '头像 换头像', go: ['.app[data-app="chat"]', '#more-avatar'] },
      { n: '漂流瓶', d: '两个世界之间的海：捡瓶子/放瓶子', k: '漂流瓶 海 瓶子', go: ['.app[data-app="chat"]', '#more-drift'] },
      { n: '帮我决定', d: '是/否或自定义选项随机决定，结果可发聊天', k: '决定 选择 纠结', go: ['.app[data-app="chat"]', '#more-decide'] },
      { n: '多人决定', d: '成员名单各自随机出结果，逐行发送', k: '多人 决定 抽签', go: ['.app[data-app="chat"]', '#more-gdecide'] },
      { n: '占卜', d: '塔罗 78 张 / 雷诺曼 40 张，三种牌阵', k: '占卜 塔罗 雷诺曼 运势', go: ['.app[data-app="divination"]'] },
      { n: '寻踪 · TA 的日常', d: 'TA 在哪里/在做什么/想对你说 + 位置感知', k: '寻踪 日常 定位 在哪', go: ['.app[data-app="chat"]', '#chat-partner-av'] },
      { n: '同频', d: 'TA 此刻状态字卡 + 敲三下暗号', k: '同频 暗号 此刻 状态', go: ['.app[data-app="tongpin"]'] },
      { n: '伸手', d: '摸摸身边，三种触感 + 悄悄话', k: '伸手 摸摸 触感', go: ['.app[data-app="shenshou"]'] },
      { n: '此间', d: '每位梦角的世界时间与在场状态', k: '此间 梦角 时辰 在场', go: ['.app[data-app="cjian"]'] },
      { n: '房间（双人小屋）', d: '21 种家具互动、舒适度升级、按 TA 分屋', k: '房间 小屋 家具', go: ['.app[data-app="room"]'] },
      { n: '音乐', d: '本地/链接上传、歌单、一起听歌、播放队列', k: '音乐 歌曲 播放 歌单', go: ['.app[data-app="music"]'] },
      { n: '信箱', d: '和 TA 写信/回信，支持图文信件', k: '信箱 写信 信件 邮件', go: ['.app[data-app="mail"]'] },
      { n: '朋友圈', d: '发动态/点赞评论/TA 也会发', k: '朋友圈 动态 点评 转发', go: ['.app[data-app="feed"]'] }
    ] },
    { g: '小游戏', items: [
      { n: '猜拳', d: '和 TA 猜拳，累计战绩', k: '猜拳 石头剪刀布 游戏', go: ['.app[data-app="chat"]', '#more-rps'] },
      { n: 'Pong', d: '双人弹球对战，四档难度', k: 'pong 弹球 游戏', go: ['.app[data-app="chat"]', '#more-pong'] },
      { n: '贪吃蛇', d: '双人同场抢食，速度/穿墙可设', k: '贪吃蛇 蛇 游戏', go: ['.app[data-app="chat"]', '#more-snake'] },
      { n: '打砖块', d: '双人合作清砖，COMBO 连击', k: '打砖块 砖块 游戏', go: ['.app[data-app="chat"]', '#more-brick'] },
      { n: '钓鱼', d: '抛竿收竿 + 14 种收集物图鉴', k: '钓鱼 鱼 图鉴', go: ['.app[data-app="chat"]', '#more-fish'] },
      { n: '四子棋', d: '和 TA 对弈四子棋，战绩记录', k: '四子棋 棋 游戏', go: ['.app[data-app="chat"]', '#more-c4'] },
      { n: '合作扫雷', d: '轮流挖格共用 3 颗❤，藏彩蛋', k: '扫雷 游戏', go: ['.app[data-app="chat"]', '#more-ms'] },
      { n: '记忆翻牌', d: '合作找配对记默契分', k: '记忆 翻牌 配对 游戏', go: ['.app[data-app="chat"]', '#more-memory'] },
      { n: '五子棋', d: '11×11 迷你盘三档难度，TA 会堵你的成五点', k: '五子棋 棋 游戏', go: ['.app[data-app="chat"]', '#more-gomoku'] },
      { n: '连连看', d: '合作消除同款图案，连线不超两个弯', k: '连连看 游戏', go: ['.app[data-app="chat"]', '#more-linkup'] },
      { n: '消消乐', d: '轮流交换凑三连，连锁连消冲目标分', k: '消消乐 三消 游戏', go: ['.app[data-app="chat"]', '#more-match3'] },
      { n: '心意币拍卖会', d: '与 TA 轮番举牌，落槌价真实扣款', k: '拍卖 拍卖会 心意币', go: ['.app[data-app="chat"]', '#more-auction'] },
      { n: '游乐室', d: '小游戏战绩、徽章、摆件图鉴一览', k: '游乐室 战绩 徽章 摆件 图鉴', go: ['.app[data-app="home"]', '#home-arcade-entry'] }
    ] },
    { g: '手机桌面与工具', items: [
      { n: '桌面装修模式', d: '编辑布局/添加卡片/换图标/拖拽跨页', k: '装修 编辑 布局 图标 桌面', go: ['#row-custom-icon'] },
      { n: '外观与主题', d: '主题色/壁纸预设/字号圆角/组件样式/深色模式', k: '美化 外观 主题 壁纸 颜色 深色 暗色', go: ['#row-appearance'] },
      { n: '备忘录', d: '待办置顶/截止日期，TA 会追问和催办', k: '备忘录 待办 todo', go: ['.app[data-app="memo"]'] },
      { n: '喝水', d: '今日杯数进度环，TA 定时催喝水', k: '喝水 杯数', go: ['.app[data-app="water"]'] },
      { n: '吃什么', d: '随机抽菜/转盘，问 TA 征求意见', k: '吃什么 吃饭 菜 转盘', go: ['.app[data-app="eat"]'] },
      { n: '存钱罐', d: '存取+小心愿目标，TA 当监督人', k: '存钱罐 攒钱 心愿', go: ['.app[data-app="piggy"]'] },
      { n: '番茄钟', d: '专注/小憩/长休计时，陪伴模式', k: '番茄钟 专注 计时', go: ['.app[data-app="pomo"]'] },
      { n: '花园', d: '种花杂交/花束工坊/成就年报，TA 代管', k: '花园 种花 花', go: ['.app[data-app="garden"]'] }
    ] },
    { g: '记录与统计', items: [
      { n: '主页', d: '多 tab 统计：换头像/通话/摸鱼/TA 的关心/心意币', k: '主页 情侣空间 统计', go: ['.app[data-app="home"]'] },
      { n: '聊天统计', d: '相处记录/聊天记录/情绪表达多维统计', k: '统计 聊天统计 数据', go: ['.app[data-app="stats"]'] },
      { n: '提问记录', d: 'TA 的询问/小问题/好奇/吐槽/我的邀请历史', k: '提问记录 历史 记录', go: ['.app[data-app="interact"]'] },
      { n: '查岗打卡', d: 'TA 的查岗打卡与位置记录', k: '查岗 打卡 定位', go: ['.app[data-app="checkin"]'] },
      { n: '日历', d: 'TA 的每日留言、情话、我的备忘与心情', k: '日历 留言 签到', go: ['.app[data-app="calendar"]'] },
      { n: '纪念', d: '纪念日/倒数日与相伴天数', k: '纪念 倒计时 周年', go: ['.app[data-app="memory"]'] },
      { n: '经期记录', d: '经期/排卵期预测、症状体温情绪记录、TA 的关心', k: '经期 生理期 排卵 月经', go: ['.app[data-app="period"]'] },
      { n: '记账', d: '收支分类/预算/图表/流水搜索', k: '记账 收支 预算 账本', go: ['.app[data-app="accounting"]'] },
      { n: '梦角档案', d: '认识 TA：九个分区 + 发现卡片 + 共同记录', k: '梦角档案 档案 认识', go: ['.app[data-app="memo-arc"]'] },
      { n: '我的档案', d: '写给 TA 的自我说明与 IF 世界设定', k: '我的档案 自我 if 世界', go: ['.app[data-app="my-arc"]'] },
      { n: '心情日记', d: '每天记心情，月度曲线对照、TA 的关心', k: '心情日记 心情 情绪 日记', go: ['.app[data-app="calendar"]'] }
    ] },
    { g: '系统与设置', items: [
      { n: '音效设置', d: '来电铃声/消息音效本地上传', k: '音效 铃声 声音 提示音', go: ['#row-sfx-settings'] },
      { n: '通话设置', d: '来电/接听/挂断等触发概率与通话背景', k: '通话设置 电话 概率', go: ['#row-call-settings'] },
      { n: '数据导出', d: '导出全部数据为备份文件（请定期备份）', k: '导出 备份 数据', go: ['#row-export'] },
      { n: '数据导入', d: '从备份文件恢复，含预览与进度', k: '导入 恢复 数据', go: ['#row-import'] },
      { n: '查看存储占用', d: '按功能看本地存储占用，可清诊断记录', k: '存储 占用 空间 清理', go: ['#row-storage-view'] },
      { n: '卡顿自检 · 一键优化', d: '字卡库数据过大卡顿时，扫描分级并一键预热修复', k: '卡顿 优化 性能 流畅 预热', go: ['#row-perf-optimize'] },
      { n: '清除本地数据', d: '清空本机应用数据（重置前请先导出备份）', k: '清除 重置 清空 恢复出厂', go: ['#row-reset'] },
      { n: '后台保活与通知', d: '切后台保持连接与通知提醒（设置页底部开关）', k: '后台 保活 通知 推送', where: '设置页底部「后台保活 / 后台通知」开关' },
      { n: '应用锁', d: '数字密码锁，防别人偷看聊天记录', k: '应用锁 密码 隐私 锁', where: '设置页「应用锁」分组' },
      { n: '设备兼容诊断', d: '一键复制本机环境信息发给开发者排查', k: '诊断 兼容 环境 报障', go: ['#row-diagnostics'] },
      { n: '屏幕适配诊断', d: '顶部空白/底部裁切/缩放异常一键定位', k: '屏幕 适配 诊断 顶部空白 裁切', go: ['#row-screen-diag'] },
      { n: '功能诊断', d: '逐个测试全部功能是否正常（约15秒）', k: '功能诊断 自检 测试', go: ['#row-func-diag'] },
      { n: '功能介绍与许可', d: '原创声明、二传二改许可、灵感来源', k: '介绍 许可 关于 版权', go: ['#row-about'] }
    ] }
  ];

  // ---- 分类图标（描边风格与设置页一致；stroke=currentColor + .fhub-cat-ico 色走 var(--ink)，深色自动跟随） ----
  const CAT_ICO = [
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 10-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="8" width="19" height="10" rx="5"/><path d="M7.5 10.5v4M5.5 12.5h4"/><circle cx="15.5" cy="12" r=".9"/><circle cx="18" cy="14" r=".9"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 8.5V21h14V8.5"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>'
  ];
  // ---- 首页「常用」直达：取使用频次前 4（数据来自 fhub-freq，无数据整行隐藏） ----

  // ---- 样式（自包含注入，不动 base.css；配色走全局变量 --ink/--muted，深色模式自动跟随） ----
  const hubStyle = document.createElement('style');
  hubStyle.textContent =
    '.fhub-tabs{display:flex;gap:8px;overflow-x:auto;padding:2px 14px 8px;-webkit-overflow-scrolling:touch;scrollbar-width:none}.fhub-tabs::-webkit-scrollbar{display:none}' +
    '.fhub-tag{flex:0 0 auto;padding:6px 13px;border-radius:20px;font-size:12px;color:var(--muted,#666);background:rgba(0,0,0,.055);white-space:nowrap;cursor:pointer;transition:background .15s,color .15s;-webkit-tap-highlight-color:transparent}.fhub-tag:active{transform:scale(.97)}.fhub-tag.on{color:#fff;background:#111}' +
    '.fhub-hot{display:flex;gap:8px;align-items:center;padding:10px 2px 0}.fhub-hot-label{flex:0 0 auto;font-size:12px;color:var(--muted,#999)}' +
    '.fhub-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 0 4px}' +
    '.fhub-cat{position:relative;padding:12px;border-radius:16px;cursor:pointer;-webkit-tap-highlight-color:transparent}.fhub-cat:active{transform:scale(.97)}' +
    '.fhub-cat-ico{width:36px;height:36px;border-radius:10px;background:rgba(0,0,0,.055);display:flex;align-items:center;justify-content:center;margin-bottom:9px}' +
    '.fhub-cat-ico svg{width:20px;height:20px;stroke:var(--ink,#111)}' +
    '.fhub-cat-name{font-size:14px;font-weight:600;line-height:1.3;padding-right:30px}' +
    '.fhub-cat-n{position:absolute;top:10px;right:10px;font-size:11px;color:var(--muted,#999);background:rgba(0,0,0,.05);border-radius:10px;padding:2px 8px;font-weight:600}' +
    '[data-theme="dark"] .fhub-tag{background:rgba(255,255,255,.09)}' +
    '[data-theme="dark"] .fhub-tag.on{background:var(--ink,#eee);color:var(--card-bg,#1e1e1e)}' +
    '[data-theme="dark"] .fhub-cat-ico{background:rgba(255,255,255,.09)}' +
    '[data-theme="dark"] .fhub-cat-n{background:rgba(255,255,255,.09)}';
  document.head.appendChild(hubStyle);

  // ---- 渲染 ----
  const body = document.getElementById('fhub-body');
  const page = document.getElementById('page-featurehub');
  if (!body || !page) return;
  const tags = document.getElementById('fhub-tags');
  const input = document.getElementById('fhub-search');
  const empty = document.getElementById('fhub-empty');
  const ARROW = '<div class="arrow"><svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></div>';

  function entryRow(it) {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = '<div class="txt">' + it.n + '<span class="sub">' + it.d + '</span></div>' + ARROW;
    row.addEventListener('click', () => jump(it));
    return row;
  }
  function groupBlock(grp) {
    const wrap = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'gs-title';
    title.textContent = grp.g;
    const card = document.createElement('div');
    card.className = 'set-group glass';
    grp.items.forEach(it => card.appendChild(entryRow(it)));
    wrap.appendChild(title);
    wrap.appendChild(card);
    wrap.style.display = 'none';
    return wrap;
  }

  // ---- 首页「常用」行：按点击频次自动置顶；无使用数据时整行不显示 ----
  const FREQ_KEY = 'xy-home-v2:fhub-freq';
  const HOT_N = 4;
  const home = document.createElement('div');
  const hot = document.createElement('div');
  hot.className = 'fhub-hot';
  home.appendChild(hot);
  const byName = {};
  HUB.forEach(grp => grp.items.forEach(it => { if (!byName[it.n]) byName[it.n] = it; }));
  let freq = {};
  function renderHot() {
    const names = Object.keys(freq).filter(n => byName[n] && freq[n] > 0)
      .sort((a, b) => freq[b] - freq[a]).slice(0, HOT_N);
    hot.style.display = names.length ? '' : 'none';
    hot.innerHTML = names.length ? '<span class="fhub-hot-label">常用</span>' : '';
    names.forEach(nm => {
      const it = byName[nm];
      const c = document.createElement('div');
      c.className = 'fhub-tag';
      c.textContent = it.n;
      c.addEventListener('click', () => jump(it));
      hot.appendChild(c);
    });
  }
  function loadFreq() {
    try { freq = JSON.parse(localStorage.getItem(FREQ_KEY)) || {}; } catch (e) { freq = {}; }
    renderHot();
    // IDB 为准（idb.js 启动回填会用 IDB 刷 LS；idbGet 挂起时静默，用 LS 初值即可）
    if (typeof window.idbGet === 'function') {
      try { window.idbGet(FREQ_KEY).then(v => { if (v && typeof v === 'object' && Object.keys(v).length) { freq = v; renderHot(); } }).catch(() => {}); } catch (e) {}
    }
  }
  function bumpFreq(it) {
    freq[it.n] = (freq[it.n] || 0) + 1;
    try { localStorage.setItem(FREQ_KEY, JSON.stringify(freq)); } catch (e) { /* 存储满不影响跳转 */ }
    if (typeof window.idbSet === 'function') { try { window.idbSet(FREQ_KEY, freq).catch(() => {}); } catch (e) {} }
    renderHot();
  }
  renderHot();
  loadFreq();
  const grid = document.createElement('div');
  grid.className = 'fhub-grid';
  HUB.forEach((grp, gi) => {
    const tile = document.createElement('div');
    tile.className = 'fhub-cat glass';
    tile.innerHTML = '<div class="fhub-cat-n">' + grp.items.length + '</div>' +
      '<div class="fhub-cat-ico">' + (CAT_ICO[gi] || '') + '</div>' +
      '<div class="fhub-cat-name">' + grp.g + '</div>';
    tile.addEventListener('click', () => { if (input) input.value = ''; view = gi; update(); });
    grid.appendChild(tile);
  });
  home.appendChild(grid);
  body.appendChild(home);

  // 分组列表：默认全部隐藏，由 update() 按当前视图显隐
  const groups = [];
  HUB.forEach(grp => groups.push(groupBlock(grp)));
  groups.forEach(el => body.appendChild(el));

  // ---- 视图状态：'home'=分类宫格首页；数字=某分类列表；搜索时全局跨组忽略视图 ----
  let view = 'home';

  // ---- 顶部 tag：首页 + 各分类（列表态显示，用于快速切换/回首页） ----
  if (tags) {
    [['首页', 'home']].concat(HUB.map((g, i) => [g.g, i])).forEach((pair) => {
      const d = document.createElement('div');
      d.className = 'fhub-tag';
      d.textContent = pair[0];
      d.addEventListener('click', () => { if (input) input.value = ''; view = pair[1]; update(); });
      tags.appendChild(d);
    });
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); }
  function cardRows(gi) {
    const card = groups[gi] ? groups[gi].querySelector('.set-group') : null;
    return card ? Array.prototype.slice.call(card.children) : [];
  }

  // ---- 唯一显隐出口：搜索态全局跨组只显命中行；非搜索态按视图显首页或单组 ----
  function update() {
    if (empty) empty.hidden = true;
    const q = input ? norm(input.value) : '';
    if (q) {
      if (home) home.style.display = 'none';
      if (tags) tags.style.display = 'none';
      let hits = 0;
      HUB.forEach((grp, gi) => {
        let gHit = 0;
        const rows = cardRows(gi);
        grp.items.forEach((it, ii) => {
          const hay = norm(it.n + it.d + (it.k || '') + (it.g || ''));
          const show = hay.indexOf(q) >= 0;
          const el = rows[ii];
          if (el) el.style.display = show ? '' : 'none';
          if (show) { gHit++; hits++; }
        });
        if (groups[gi]) groups[gi].style.display = gHit ? '' : 'none';
      });
      if (empty) empty.hidden = hits > 0;
      return;
    }
    // 清空搜索 → 复位所有行显隐，再按当前视图显首页或单组
    Array.prototype.forEach.call(body.querySelectorAll('.set-row'), r => { r.style.display = ''; });
    if (home) home.style.display = view === 'home' ? '' : 'none';
    if (tags) {
      tags.style.display = view === 'home' ? 'none' : '';
      Array.prototype.forEach.call(tags.children, (t, i) => t.classList.toggle('on', i - 1 === view));
    }
    groups.forEach((el, i) => { el.style.display = i === view ? '' : 'none'; });
  }

  // ---- 搜索 ----
  if (input) input.addEventListener('input', update);

  // ---- 跳转：链式点击既有入口；一个都没点中 = 入口丢失，弹位置提示不再静默 ----
  function toast(msg) {
    let t = document.getElementById('cc-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cc-toast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'cc-toast'; void t.offsetWidth; t.className = 'cc-toast show';
    clearTimeout(t._timer); t._timer = setTimeout(() => { t.className = 'cc-toast'; }, 2400);
  }
  function jump(it) {
    if (it.go && it.go.length) {
      try {
        let clicked = 0;
        it.go.forEach(sel => {
          const el = document.querySelector(sel);
          if (el && typeof el.click === 'function') { el.click(); clicked++; }
        });
        if (clicked) { bumpFreq(it); return; }
      } catch (e) { /* 落到位置提示 */ }
      toast('「' + it.n + '」的位置：' + (it.where || it.g) + '（入口暂不可达，如有需要请在对应页面寻找）');
      return;
    }
    toast('「' + it.n + '」的位置：' + (it.where || it.g));
  }

  // ---- 返回设置页（与 row-about/about-back 同一导航模式） ----
  const back = document.getElementById('fhub-back');
  if (back) {
    back.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
      const setPage = document.getElementById('page-setting');
      if (setPage) setPage.hidden = false;
    });
  }

  // ---- 设置页入口行：每次进入复位到宫格首页并清空搜索 ----
  const row = document.getElementById('row-featurehub');
  if (row) {
    row.addEventListener('click', () => {
      document.querySelectorAll('.page').forEach(p => { p.hidden = true; });
      page.hidden = false;
      if (input) input.value = '';
      view = 'home';
      update();
    });
  }

  update();
})();
