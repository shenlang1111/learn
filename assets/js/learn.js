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

  // 相对路径：如 catalog/surfactants/basics.html，作为各存储键的后缀
  var PATH = window.location.pathname.replace(/^\/+/, '') + window.location.search;

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
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
        return (o && o.path) ? o : null;
      } catch (e) { return null; }
    }
  };

  // 部署版正文加密时，由 learn-core.js 提供 __secureReady（解密完成后 resolve）；
  // 本地明文站没有该变量，走原 DOMContentLoaded 路径，行为不变。
  function startAll() {
    initTheme();
    initDone();
    initNote();
    initHighlight();
    initVisit();
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
})();
