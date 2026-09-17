/* ============================================================
   learn.js · 学习站交互（原生 JS，无任何依赖）
   分块：
     0  通用：页面相对路径 / 本机存储
     1  主题切换（localStorage: tinci-learn-theme）
     2  章节勾选（learn:done:<相对路径>）
     3  章末笔记（learn:note:<相对路径>，自动保存）
     4  正文高亮（learn:hl:<相对路径>，文本+上下文锚点重定位）
   首帧主题 class 由页面 head 内联脚本先行设置，本文件只负责交互。
   ============================================================ */
(function () {
  'use strict';

  /* ---------- 0 通用 ---------- */

  // 站根绝对 URL：从本脚本 src 反推（learn.js 固定挂在 <站根>/assets/js/ 下）。
  // 线上项目站 https://shenlang1111.github.io/learn/assets/js/learn.js → 根 …/learn/
  // 本地根预览 http://127.0.0.1:PORT/assets/js/learn.js → 根 …/
  var SCRIPT_SRC = (function () {
    var s = document.currentScript || document.querySelector('script[src*="learn.js"]');
    return (s && s.src) ? s.src : '';
  })();
  // 后缀 query/hash 是【可选】的：旧正则写成 learn\.js[?#].*$，无 query 的脚本 URL
  // （生产环境常态）完全不匹配 → replace 原样返回，SITE_ROOT 错成 …/assets/js/learn.js，
  // 搜索请求变成 learn.jssearch-index.json 404，SITE_ROOT_PATH 也跟着错、剥不掉 /learn/ 前缀。
  var SITE_ROOT = SCRIPT_SRC.replace(/assets\/js\/learn\.js(?:[?#].*)?$/, '');
  var SITE_ROOT_PATH = (function () {
    try { return new URL(SITE_ROOT).pathname; } catch (e) { return '/'; }
  })();

  // 页面相对站根路径（不带前导斜杠），如 catalog/surfactants/basics.html，作为各存储键后缀。
  // 必须剥掉站根 pathname：旧版直接取 location.pathname，线上误把 learn/ 前缀存进
  // localStorage，首页"继续学习"再按相对路径拼接 → /learn/learn/… 双前缀 404，
  // 且首页进度统计键（catalog/…）与章节页勾选键（learn/catalog/…）对不上。
  // 不拼 query/hash：站内跳转只用相对路径与 #锚点，若把 ?v=1 拼进键后缀，会与首页
  // SECTIONS 裸路径口径不一致，导致进度少计（审查 P2-2）。
  function currentRelPath() {
    var p = window.location.pathname;
    if (SITE_ROOT_PATH && SITE_ROOT_PATH !== '/' && p.indexOf(SITE_ROOT_PATH) === 0) {
      p = p.slice(SITE_ROOT_PATH.length);
    }
    return p.replace(/^\/+/, '');
  }
  var PATH = currentRelPath();

  // 修复前线上存储键误带的子站前缀；迁移与读取双保险共用同一常量（不要散落魔法数）
  var LEGACY_PREFIX = 'learn/';

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  // 一次性迁移：修复前线上键里误带的 learn/ 子站前缀（done/note/hl + learn:last）
  function migrateLegacyPaths() {
    try {
      var prefixes = ['learn:done:', 'learn:note:', 'learn:hl:'];
      var olds = [];
      for (var i = 0; i < window.localStorage.length; i++) {
        var k = window.localStorage.key(i);
        if (!k) continue;
        for (var j = 0; j < prefixes.length; j++) {
          if (k.indexOf(prefixes[j] + LEGACY_PREFIX) === 0) { olds.push({ key: k, prefix: prefixes[j] }); break; }
        }
      }
      olds.forEach(function (item) {
        // 精确锚定「存储前缀 + 站根前缀」整段剥离，不用裸 replace('learn/','')：
        // 路径自身若含 learn/ 子串，裸替换首个匹配会剥错位置（审查 P2-1）。
        var oldKey = item.key;
        var newKey = oldKey.replace(item.prefix + LEGACY_PREFIX, item.prefix);
        if (window.localStorage.getItem(newKey) === null) {
          window.localStorage.setItem(newKey, window.localStorage.getItem(oldKey));
        }
        window.localStorage.removeItem(oldKey);
      });
      var raw = window.localStorage.getItem('learn:last');
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o.path === 'string' && o.path.indexOf(LEGACY_PREFIX) === 0) {
          o.path = o.path.slice(LEGACY_PREFIX.length);
          window.localStorage.setItem('learn:last', JSON.stringify(o));
        }
      }
    } catch (e) {}
  }

  /* 对外只读汇总接口：首页 / 扉页按站点根相对路径读取学习状态。
     键口径与本文件其他功能一致：learn:done:<相对路径>、learn:last。 */
  window.LearnSite = {
    path: function () { return PATH; },
    isDone: function (relPath) { return storageGet('learn:done:' + relPath) === '1'; },
    lastVisit: function () {
      var raw = storageGet('learn:last');
      if (!raw) return null;
      try {
        var o = JSON.parse(raw);
        if (o && o.path) {
          if (o.path.indexOf(LEGACY_PREFIX) === 0) o.path = o.path.slice(LEGACY_PREFIX.length); // 双保险：旧值清洗
          return o;
        }
        return null;
      } catch (e) { return null; }
    }
  };

  // 迁移必须在任何读取学习状态的代码之前完成：learn.js 由 learn-core.js 动态注入，
  // 其 __secureReady.then 可能晚于首页内联脚本的 then(boot) 注册，放进 startAll 会与
  // 首页 render 产生竞态（render 先跑读到旧键 → 进度环 0/N）。IIFE 顶层同步迁移后，
  // window.LearnSite 一旦存在即代表迁移完成，首页 boot 等 LearnSite 即可天然保序。
  migrateLegacyPaths();

  // 部署版正文加密时，由 learn-core.js 提供 __secureReady（解密完成后 resolve）；
  // 本地明文站没有该变量，走原 DOMContentLoaded 路径，行为不变。
  function startAll() {
    initTheme();
    initDone();
    initNote();
    initHighlight();
    initVisit();
    initSearch();
  }
  if (window.__secureReady && typeof window.__secureReady.then === 'function') {
    window.__secureReady.then(function () {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startAll);
      } else {
        startAll();
      }
    });
  } else {
    document.addEventListener('DOMContentLoaded', startAll);
  }

  /* ---------- 最近访问（learn:last，只记带学习勾选的章节页） ---------- */

  function initVisit() {
    // 首页与扉页不计入“最近章节”，只记真正的章节页（含勾选框）
    if (!document.getElementById('doneCheck')) return;
    if (!PATH || !/\.html(\?|$)/.test(PATH)) return;
    var title = document.title.replace(/\s*[·•|｜\-—]\s*我的化工学习站\s*$/, '');
    storageSet('learn:last', JSON.stringify({
      path: PATH,
      title: title,
      ts: Date.now()
    }));
  }

  /* ---------- 1 主题切换 ---------- */

  function initTheme() {
    var btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var dark = document.documentElement.classList.toggle('dark');
      storageSet('tinci-learn-theme', dark ? 'dark' : 'light');
    });
  }

  /* ---------- 2 章节勾选 ---------- */

  function initDone() {
    var box = document.getElementById('progressBlock');
    var checkbox = document.getElementById('doneCheck');
    if (!checkbox) return;

    var KEY = 'learn:done:' + PATH;

    function render(done) {
      checkbox.checked = done;
      document.body.classList.toggle('is-done', done);
      if (box) box.classList.toggle('is-done', done);
    }

    render(storageGet(KEY) === '1');

    checkbox.addEventListener('change', function () {
      render(checkbox.checked);
      storageSet(KEY, checkbox.checked ? '1' : '0');
    });
  }

  /* ---------- 3 章末笔记 ---------- */

  function initNote() {
    var area = document.getElementById('noteArea');
    var state = document.getElementById('noteState');
    if (!area) return;

    var KEY = 'learn:note:' + PATH;
    var timer = null;

    function setStatus(text, saving) {
      if (!state) return;
      state.textContent = text;
      state.classList.toggle('saving', !!saving);
    }

    area.value = storageGet(KEY) || '';
    setStatus(area.value ? '已保存到本机' : '写完自动保存到本机', false);

    area.addEventListener('input', function () {
      setStatus('正在保存…', true);
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (storageSet(KEY, area.value)) {
          setStatus('已保存到本机', false);
        } else {
          setStatus('本机存储不可用，未能保存', false);
        }
      }, 400);
    });
  }

  /* ============================================================
     4 正文高亮
     数据结构（每条）：{ text: 选中文字, before: 前文锚点, after: 后文锚点 }
     刷新后用「锚点+文本」在正文纯文本序列中重新定位并包裹；
     锚点长度固定 12 字，定位失败时退化为纯文本匹配。
     ============================================================ */

  function initHighlight() {
    var root = document.querySelector('.article');
    if (!root) return;

    var KEY = 'learn:hl:' + PATH;
    var ANCHOR_LEN = 12;
    var records = loadRecords();

    /* --- 4.1 记录读写 --- */
    function loadRecords() {
      var raw = storageGet(KEY);
      if (!raw) return [];
      try {
        var arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    }
    function saveRecords() { storageSet(KEY, JSON.stringify(records)); }

    /* --- 4.2 正文文本节点索引（全局偏移 = 拼接文本中的位置） --- */
    function collectTextNodes(includeMarks) {
      var items = [];
      var full = '';
      var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
          var p = n.parentNode;
          if (!p) return NodeFilter.FILTER_REJECT;
          var tag = p.nodeName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
            return NodeFilter.FILTER_REJECT;
          }
          if (!includeMarks && p.nodeName === 'MARK') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var n;
      while ((n = walker.nextNode())) {
        items.push({ node: n, start: full.length, end: full.length + n.nodeValue.length });
        full += n.nodeValue;
      }
      return { items: items, text: full };
    }

    function pointAt(map, pos) {
      var items = map.items;
      var lo = 0, hi = items.length - 1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var it = items[mid];
        if (pos < it.start) hi = mid - 1;
        else if (pos >= it.end) lo = mid + 1;
        else return { node: it.node, offset: pos - it.start };
      }
      return null;
    }

    /* 在拼接文本里按「锚点+文本」逐级退化查找，返回 [起, 止) */
    function locate(map, rec) {
      var needles = [
        rec.before + rec.text + rec.after,
        rec.text + rec.after,
        rec.before + rec.text,
        rec.text
      ];
      for (var i = 0; i < needles.length; i++) {
        if (!needles[i]) continue;
        var idx = map.text.indexOf(needles[i]);
        if (idx >= 0) {
          var start = idx + needles[i].indexOf(rec.text);
          return [start, start + rec.text.length];
        }
      }
      return null;
    }

    /* 把全局区间 [gStart, gEnd) 覆盖到的每个文本节点分别包一层 mark */
    function wrapRange(map, gStart, gEnd) {
      map.items.forEach(function (it) {
        if (it.end <= gStart || it.start >= gEnd) return;
        var localStart = Math.max(0, gStart - it.start);
        var localEnd = Math.min(it.node.nodeValue.length, gEnd - it.start);
        if (localEnd <= localStart) return;

        var node = it.node;
        if (localStart > 0) node = node.splitText(localStart);
        var spanLen = localEnd - localStart;
        if (spanLen < node.nodeValue.length) node.splitText(spanLen);

        var mark = document.createElement('mark');
        mark.className = 'learn-hl';
        node.parentNode.insertBefore(mark, node);
        mark.appendChild(node);
      });
    }

    function unwrapMark(markEl) {
      var parent = markEl.parentNode;
      while (markEl.firstChild) parent.insertBefore(markEl.firstChild, markEl);
      parent.removeChild(markEl);
      parent.normalize();
    }

    /* --- 4.3 页面加载：按记录重新包裹 --- */
    function applyAll() {
      records.forEach(function (rec) {
        if (!rec.text) return;
        var map = collectTextNodes(false);
        var pos = locate(map, rec);
        if (pos) wrapRange(map, pos[0], pos[1]);
      });
    }

    /* --- 4.4 浮动工具条 --- */
    var toolbar = document.createElement('div');
    toolbar.className = 'hl-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    toolbar.innerHTML =
      '<button type="button" data-act="add">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4z"/></svg>' +
        '标黄</button>' +
      '<button type="button" data-act="cancel">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>' +
        '取消高亮</button>';
    document.body.appendChild(toolbar);

    var savedRange = null;      // 待标黄的选区
    var cancelTarget = null;    // 待取消的 mark 元素

    function showAt(rect, mode) {
      toolbar.querySelector('[data-act="add"]').style.display = mode === 'add' ? '' : 'none';
      toolbar.querySelector('[data-act="cancel"]').style.display = mode === 'cancel' ? '' : 'none';
      toolbar.classList.add('show');

      // 先布局再量尺寸，避免横向溢出
      var tb = toolbar.getBoundingClientRect();
      var left = rect.left + rect.width / 2 - tb.width / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - tb.width - 8));
      var top = (mode === 'cancel' ? rect.bottom + 8 : rect.top - tb.height - 10);
      if (top < 8) top = rect.bottom + 8;
      toolbar.style.left = left + 'px';
      toolbar.style.top = top + 'px';
    }
    function hideBar() {
      toolbar.classList.remove('show');
      savedRange = null;
      cancelTarget = null;
    }

    // 点工具条时不能丢选区
    toolbar.addEventListener('mousedown', function (e) { e.preventDefault(); });

    toolbar.addEventListener('click', function (e) {
      var act = e.target.closest('button') && e.target.closest('button').getAttribute('data-act');
      if (act === 'add' && savedRange) {
        addHighlight(savedRange);
      } else if (act === 'cancel' && cancelTarget) {
        removeHighlight(cancelTarget);
      }
      hideBar();
    });

    document.addEventListener('mousedown', function (e) {
      if (toolbar.contains(e.target)) return;
      if (e.target.closest && e.target.closest('mark.learn-hl')) return;
      hideBar();
    });
    window.addEventListener('scroll', hideBar, { passive: true });
    window.addEventListener('resize', hideBar);

    /* --- 4.5 选区 → 工具条 --- */
    root.addEventListener('mouseup', function () {
      setTimeout(function () {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
        var range = sel.getRangeAt(0);
        if (!root.contains(range.commonAncestorContainer)) return;

        // 选区落在已有高亮内：直接给「取消」
        var container = range.commonAncestorContainer;
        var inMark = (container.nodeType === 1 ? container : container.parentElement)
          .closest('mark.learn-hl');
        if (inMark && root.contains(inMark)) {
          cancelTarget = inMark;
          showAt(inMark.getBoundingClientRect(), 'cancel');
          return;
        }

        savedRange = range.cloneRange();
        showAt(range.getBoundingClientRect(), 'add');
      }, 0);
    });

    // 点击已有高亮（不拖选时）→ 给「取消」
    root.addEventListener('click', function (e) {
      var markEl = e.target.closest && e.target.closest('mark.learn-hl');
      if (markEl && root.contains(markEl)) {
        cancelTarget = markEl;
        showAt(markEl.getBoundingClientRect(), 'cancel');
      }
    });

    /* --- 4.6 记录的增 / 删 --- */
    function rangeAnchor(range) {
      var map = collectTextNodes(true);
      var startPos = null, endPos = null;

      map.items.forEach(function (it) {
        if (it.node === range.startContainer) startPos = it.start + range.startOffset;
        if (it.node === range.endContainer) endPos = it.start + range.endOffset;
      });
      if (startPos === null || endPos === null) return null;
      return {
        text: range.toString(),
        before: map.text.slice(Math.max(0, startPos - ANCHOR_LEN), startPos),
        after: map.text.slice(endPos, endPos + ANCHOR_LEN)
      };
    }

    function addHighlight(range) {
      var rec = rangeAnchor(range);
      if (!rec || !rec.text.trim()) return;
      records.push(rec);
      saveRecords();
      // 直接包裹当前选区，免去重新查找
      var mark = document.createElement('mark');
      mark.className = 'learn-hl';
      try {
        // 选区在单个文本节点内时可直接包裹
        range.surroundContents(mark);
      } catch (err) {
        // 跨节点选区 surroundContents 会抛错，改用提取包裹
        var frag = range.extractContents();
        mark.appendChild(frag);
        range.insertNode(mark);
      }
    }

    function markAnchor(markEl) {
      var map = collectTextNodes(true);
      var startPos = null, endPos = null;
      map.items.forEach(function (it) {
        if (startPos === null && markEl.contains(it.node)) startPos = it.start;
        if (markEl.contains(it.node)) endPos = it.end;
      });
      if (startPos === null) return null;
      return {
        text: markEl.textContent,
        before: map.text.slice(Math.max(0, startPos - ANCHOR_LEN), startPos),
        after: map.text.slice(endPos, endPos + ANCHOR_LEN)
      };
    }

    function removeHighlight(markEl) {
      var rec = markAnchor(markEl);
      if (rec) {
        // 优先精确匹配（文本+双锚点），找不到再按文本删第一条
        var idx = records.findIndex(function (r) {
          return r.text === rec.text && r.before === rec.before && r.after === rec.after;
        });
        if (idx < 0) idx = records.findIndex(function (r) { return r.text === rec.text; });
        if (idx >= 0) records.splice(idx, 1);
        saveRecords();
      }
      unwrapMark(markEl);
    }

    applyAll();
  }

  /* ============================================================
     5 站内搜索（加密部署站登录后可用）
     索引 search-index.json 为 AES-256-GCM 密文（部署时生成，与正文同密钥），
     登录后 learn-core.js 把密钥写 window.__TINCI_INDEX_KEY，这里拉取解密检索。
     本地明文站无密钥 → 按钮保持禁用（与旧知识库站行为一致）。
     ============================================================ */
  function initSearch() {
    var btn = document.querySelector('.topbar-actions button[aria-label="搜索"]') ||
              document.querySelector('button[aria-label="搜索"]');
    if (!btn) return;
    var key = window.__TINCI_INDEX_KEY;
    if (!key) return; // 未登录/本地明文站：不激活

    btn.classList.remove('is-idle');
    btn.removeAttribute('aria-disabled');
    btn.title = '搜索（Ctrl+K）';

    var HISTORY_KEY = 'tinci-learn-search-history';
    var index = null;
    var indexPromise = null; // 加载去重：加载中连续输入只发一次 fetch

    // 学习向同义词（口语/缩写 → 站内用词）
    var SYNONYMS = {
      '表活': ['表面活性剂'],
      '表面活性剂': ['表活'],
      '卡波姆': ['聚丙烯酸'],
      '增稠': ['粘度', '流变', '屈服值'],
      '悬浮': ['屈服值', '抗沉降', '悬浮剂'],
      '去屑': ['马拉色菌', '吡硫翁锌', 'zpt'],
      '防晒': ['紫外线', 'spf'],
      '硅油': ['聚二甲基硅氧烷', 'pdms'],
      '乳化剂': ['hlb', '乳化'],
      '乳化': ['hlb', '乳化剂'],
      '螯合': ['edta', '金属离子'],
      '调理': ['阳离子', '聚季铵盐', '柔顺'],
      '温和': ['低刺激', '氨基酸']
    };

    var panel = document.createElement('div');
    panel.className = 'search-panel';
    panel.innerHTML =
      '<div class="search-box">' +
        '<span class="search-box-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5 16.7 16.7"/></svg>' +
        '</span>' +
        '<input type="text" class="search-input" placeholder="搜知识点 / 牌号 / 关键词… 如：CMC、卡波姆、HLB" aria-label="站内搜索">' +
      '</div>' +
      '<div class="search-history"></div>' +
      '<div class="search-results"></div>';
    document.body.appendChild(panel);
    var input = panel.querySelector('.search-input');
    var history = panel.querySelector('.search-history');
    var results = panel.querySelector('.search-results');

    function ensureIndex(cb) {
      if (index) { cb(); return; }
      if (!indexPromise) {
        indexPromise = fetch(SITE_ROOT + 'search-index.json', { cache: 'no-store' })
          .then(function (r) {
            if (!r.ok) throw new Error('index ' + r.status);
            return r.text();
          })
          .then(function (b64) {
            var bin = atob(b64.trim());
            var u8 = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            return crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, key, u8.slice(12));
          })
          .then(function (buf) {
            var data = JSON.parse(new TextDecoder().decode(buf));
            index = Array.isArray(data) ? data : data.pages;
            return true;
          })
          .catch(function () {
            indexPromise = null; // 允许下次输入重试
            results.innerHTML = '<div class="search-empty">搜索索引加载失败，请刷新后重试</div>';
            return false; // 失败标记：阻止后续 render 清空这条错误提示（审查 P1-1）
          });
      }
      // 只有加载成功才回调 render；失败时 catch 已写入错误提示，render 首行会清空 innerHTML
      indexPromise.then(function (ok) { if (ok) cb(); });
    }

    function snippet(text, q) {
      if (!text) return '';
      var i = text.toLowerCase().indexOf(q.toLowerCase());
      if (i < 0) return text.slice(0, 40);
      var start = Math.max(0, i - 12);
      return (start > 0 ? '…' : '') + text.slice(start, i + q.length + 18) + '…';
    }

    function getHistory() {
      try {
        var h = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
        return Array.isArray(h) ? h : [];
      } catch (e) { return []; }
    }
    function addHistory(w) {
      w = (w || '').trim();
      if (!w) return;
      var h = getHistory().filter(function (x) { return x !== w; });
      h.unshift(w);
      if (h.length > 10) h = h.slice(0, 10);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch (e) {}
    }
    function showHistory() {
      var h = getHistory();
      history.innerHTML = '';
      if (!h.length) return;
      var label = document.createElement('div');
      label.className = 'search-history-label';
      label.textContent = '搜索历史';
      var clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'search-history-clear';
      clear.textContent = '清空';
      clear.addEventListener('click', function () {
        try { localStorage.removeItem(HISTORY_KEY); } catch (e) {}
        history.innerHTML = '';
      });
      label.appendChild(clear);
      history.appendChild(label);
      h.forEach(function (w) {
        var c = document.createElement('button');
        c.type = 'button';
        c.className = 'search-history-chip';
        c.textContent = w;
        c.addEventListener('click', function () {
          input.value = w;
          ensureIndex(function () { render(w); });
          input.focus();
        });
        history.appendChild(c);
      });
    }

    function partVariants(parts) {
      return parts.map(function (p) {
        var v = [p.toLowerCase()];
        var syn = SYNONYMS[p.toLowerCase()];
        if (syn) syn.forEach(function (s) { if (v.indexOf(s) < 0) v.push(s); });
        return v;
      });
    }
    function matchHay(hay, pv) {
      for (var i = 0; i < pv.length; i++) {
        var ok = false;
        for (var j = 0; j < pv[i].length; j++) {
          if (hay.indexOf(pv[i][j]) >= 0) { ok = true; break; }
        }
        if (!ok) return false;
      }
      return true;
    }
    function scoreOrigin(hay, parts) {
      var s = 0;
      for (var i = 0; i < parts.length; i++) {
        if (hay.indexOf(parts[i].toLowerCase()) >= 0) s += 1;
      }
      return s;
    }

    function render(q) {
      results.innerHTML = '';
      q = (q || '').trim();
      if (!q) { showHistory(); return; }
      if (!index) return;
      var parts = q.split(/\s+/);
      var pv = partVariants(parts);
      var items = [];
      var seen = {};
      for (var i = 0; i < index.length; i++) {
        var p = index[i];
        var tl = (p.title || '').toLowerCase();
        var dl = (p.desc || '').toLowerCase();
        var tx = (p.text || '').toLowerCase();
        if (matchHay(tl, pv)) items.push({ url: p.url, pageTitle: p.title, score: 6 + scoreOrigin(tl, parts) });
        else if (matchHay(dl, pv)) items.push({ url: p.url, pageTitle: p.title, score: 3 + scoreOrigin(dl, parts) });
        else if (matchHay(tx, pv)) items.push({ url: p.url, pageTitle: p.title, score: 1 + scoreOrigin(tx, parts) });
        var secs = p.sections || [];
        for (var j = 0; j < secs.length; j++) {
          var sec = secs[j];
          var st = (sec.title || '').toLowerCase();
          var haySec = (st + ' ' + (sec.text || '')).toLowerCase();
          if (!matchHay(haySec, pv)) continue;
          var score = matchHay(st, pv) ? 5 : 4;
          score += scoreOrigin(haySec, parts);
          if (matchHay(tl, pv)) score += 1;
          items.push({
            url: p.url + '#' + sec.id,
            pageTitle: p.title,
            secTitle: sec.title,
            snippet: snippet(sec.text, q),
            score: score
          });
        }
      }
      items.sort(function (a, b) { return b.score - a.score; });
      var finalItems = [];
      for (var k = 0; k < items.length; k++) {
        if (!seen[items[k].url]) { seen[items[k].url] = true; finalItems.push(items[k]); }
      }
      if (!finalItems.length) {
        results.innerHTML = '<div class="search-empty">没有找到「' + q.replace(/[<>&"]/g, '') + '」相关内容，换个词试试</div>';
        return;
      }
      finalItems.slice(0, 8).forEach(function (h) {
        var a = document.createElement('a');
        a.href = SITE_ROOT + h.url;
        a.className = 'search-item';
        var ti = document.createElement('div');
        ti.className = 'search-item-title';
        ti.textContent = h.secTitle ? h.secTitle : h.pageTitle;
        var sb = document.createElement('div');
        sb.className = 'search-item-sections';
        sb.textContent = h.secTitle
          ? ('在「' + h.pageTitle + '」中' + (h.snippet ? ' · ' + h.snippet : ''))
          : h.pageTitle;
        a.appendChild(ti);
        a.appendChild(sb);
        a.addEventListener('click', function () {
          try { sessionStorage.setItem('tinci-learn-hl', q); } catch (e) {}
          addHistory(q);
        });
        results.appendChild(a);
      });
    }

    // 跳转后命中词短暂高亮（支持多词；排除脚本/导航/已有手动高亮 mark）
    function applyJumpHighlight() {
      var kw = null;
      try { kw = sessionStorage.getItem('tinci-learn-hl'); sessionStorage.removeItem('tinci-learn-hl'); } catch (e) {}
      if (!kw) return;
      var words = kw.trim().split(/\s+/).map(function (s) { return s.toLowerCase(); }).filter(Boolean);
      if (!words.length) return;
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var pending = [];
      var n;
      while ((n = walker.nextNode())) {
        if (!n.nodeValue || !n.nodeValue.trim()) continue;
        var pp = n.parentNode;
        if (pp && pp.closest && pp.closest('script,style,nav,header,footer,textarea,.search-panel,mark')) continue;
        var lower = n.nodeValue.toLowerCase();
        for (var i = 0; i < words.length; i++) {
          if (lower.indexOf(words[i]) >= 0) { pending.push(n); break; }
        }
      }
      pending.forEach(function (node) {
        var text = node.nodeValue;
        var lower = text.toLowerCase();
        var idx = -1, len = 0;
        for (var i = 0; i < words.length; i++) {
          var at = lower.indexOf(words[i]);
          if (at >= 0 && (idx < 0 || at < idx)) { idx = at; len = words[i].length; }
        }
        if (idx < 0) return;
        var mark = document.createElement('mark');
        mark.className = 'search-hl';
        mark.textContent = text.substr(idx, len);
        node.parentNode.insertBefore(document.createTextNode(text.substr(0, idx)), node);
        node.parentNode.insertBefore(mark, node);
        node.parentNode.insertBefore(document.createTextNode(text.substr(idx + len)), node);
        node.parentNode.removeChild(node);
      });
      setTimeout(function () {
        var marks = document.querySelectorAll('mark.search-hl');
        for (var i = 0; i < marks.length; i++) marks[i].classList.add('fade');
      }, 3000);
      // 解密渲染后补滚到小节锚点
      if (location.hash) {
        var el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
        if (el) setTimeout(function () { el.scrollIntoView(); }, 0);
      }
    }
    applyJumpHighlight();

    function openSearch() {
      panel.classList.add('open');
      input.focus();
      ensureIndex(function () { render(input.value); });
    }
    function closeSearch() {
      panel.classList.remove('open');
      input.value = '';
      results.innerHTML = '';
      history.innerHTML = '';
    }

    btn.addEventListener('click', function () {
      if (panel.classList.contains('open')) { closeSearch(); return; }
      openSearch();
    });
    input.addEventListener('input', function () {
      ensureIndex(function () { render(input.value); });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var first = results.querySelector('.search-item');
        addHistory(input.value);
        if (first) location.href = first.getAttribute('href');
      }
    });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== btn && !(btn.contains && btn.contains(e.target))) closeSearch();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openSearch(); }
      if (e.key === 'Escape') closeSearch();
    });
  }
})();
