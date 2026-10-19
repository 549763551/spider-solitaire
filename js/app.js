/*!
 * Spider Solitaire — UI, interaction, persistence
 * MIT License
 */
(function () {
  'use strict';

  var Game = window.SpiderGame;
  if (!Game) return;
  var SFX = window.SFX;

  var SUIT_SYMBOL = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  var RED_SUITS = { H: 1, D: 1 };
  var RANKS = Game.RANK_LABELS;
  var COLUMNS = Game.COLUMN_COUNT;
  var STORAGE_KEY = 'spider-solitaire/v1';
  var PREF_KEY = 'spider-solitaire/prefs/v1';

  /* Pip positions as [x%, y%] inside the card face, mirroring a real deck. */
  var PIP_LAYOUT = {
    1: [[50, 50]],
    2: [[50, 18], [50, 82]],
    3: [[50, 18], [50, 50], [50, 82]],
    4: [[28, 18], [72, 18], [28, 82], [72, 82]],
    5: [[28, 18], [72, 18], [50, 50], [28, 82], [72, 82]],
    6: [[28, 18], [72, 18], [28, 50], [72, 50], [28, 82], [72, 82]],
    7: [[28, 18], [72, 18], [50, 30], [28, 50], [72, 50], [28, 82], [72, 82]],
    8: [[28, 18], [72, 18], [50, 30], [28, 50], [72, 50], [50, 70], [28, 82], [72, 82]],
    9: [[28, 18], [72, 18], [28, 40], [72, 40], [50, 50], [28, 60], [72, 60], [28, 82], [72, 82]],
    10: [[28, 18], [72, 18], [50, 30], [28, 40], [72, 40], [28, 60], [72, 60], [50, 70], [28, 82], [72, 82]]
  };

  var dom = {};
  var S = {
    game: null,
    els: new Map(),
    pos: new Map(),
    locate: new Map(),
    selected: null,
    drag: null,
    press: null,
    geo: null,
    hint: null,
    hintTimer: 0,
    elapsed: 0,
    runningSince: 0,
    ticker: 0,
    soundOn: true,
    saveTimer: 0,
    winShown: false,
    toastTimer: 0,
    lastStockClick: 0
  };

  /* ------------------------------------------------------------- helpers -- */

  function $(id) { return document.getElementById(id); }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
  }

  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { dom.toast.classList.remove('show'); }, 2000);
  }

  /* ------------------------------------------------------------ geometry -- */

  function measure() {
    var w = dom.stage.clientWidth;
    var h = dom.stage.clientHeight;
    if (!w || !h) return;

    var gap = Math.max(3, Math.round(w * 0.006));
    var cw = Math.floor((w - gap * (COLUMNS - 1) - 14) / COLUMNS);
    cw = clamp(cw, 22, 130);
    var ch = Math.round(cw * 1.42);
    var maxCh = h / 3.55;
    if (ch > maxCh) {
      ch = Math.max(36, Math.floor(maxCh));
      cw = Math.max(22, Math.round(ch / 1.42));
      ch = Math.round(cw * 1.42);
    }

    var colsW = cw * COLUMNS + gap * (COLUMNS - 1);
    var x0 = Math.max(4, Math.round((w - colsW) / 2));
    var dockH = Math.round(ch + clamp(ch * 0.22, 24, 34));
    var colTop = Math.max(6, Math.round(h * 0.014));
    var dockTop = h - dockH;
    var colH = Math.max(ch, dockTop - colTop - 8);

    var geo = {
      w: w, h: h, cw: cw, ch: ch, gap: gap, x0: x0,
      colsX: [], colTop: colTop, colH: colH,
      dockTop: dockTop, dockH: dockH,
      fuStep: 0, fdStep: 0,
      stockX: x0 + colsW - cw, stockY: dockTop + 8,
      doneX: x0, doneY: dockTop + 8,
      colsW: colsW
    };
    for (var i = 0; i < COLUMNS; i++) geo.colsX.push(x0 + i * (cw + gap));

    var fdBase = ch * 0.155;
    var fuBase = ch * 0.295;
    var need = 0;
    if (S.game) {
      S.game.tableau.forEach(function (column) {
        var down = 0;
        var up = 0;
        column.forEach(function (card) { if (card.faceUp) up += 1; else down += 1; });
        var total = down * fdBase + Math.max(0, up - 1) * fuBase;
        if (total > need) need = total;
      });
    }
    var avail = geo.colH - ch;
    var k = need > 0 && need > avail ? clamp(avail / need, 0.12, 1) : 1;
    geo.fdStep = fdBase * k;
    geo.fuStep = fuBase * k;
    S.geo = geo;

    document.documentElement.style.setProperty('--card-w', cw + 'px');
    document.documentElement.style.setProperty('--card-h', ch + 'px');

    for (var c = 0; c < dom.columns.children.length; c++) {
      var colEl = dom.columns.children[c];
      colEl.style.left = geo.colsX[c] + 'px';
      colEl.style.top = geo.colTop + 'px';
      colEl.style.width = cw + 'px';
      colEl.style.height = geo.colH + 'px';
      colEl.style.setProperty('--chip-h', ch + 'px');
    }
    dom.dock.style.top = geo.dockTop + 'px';
    dom.dock.style.height = geo.dockH + 'px';
  }

  function buildColumns() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < COLUMNS; i++) {
      var el = document.createElement('div');
      el.className = 'column';
      el.dataset.col = String(i);
      frag.appendChild(el);
    }
    dom.columns.appendChild(frag);
  }

  function columnAt(clientX, clientY) {
    var geo = S.geo;
    if (!geo) return -1;
    var rect = dom.stage.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    if (y < geo.colTop - 40 || y > geo.dockTop + 8) return -1;
    for (var i = 0; i < COLUMNS; i++) {
      var left = geo.colsX[i] - geo.gap / 2;
      if (x >= left && x <= left + geo.cw + geo.gap) return i;
    }
    return -1;
  }

  /* ----------------------------------------------------------- rendering -- */

  function faceMarkup(card) {
    var symbol = SUIT_SYMBOL[card.suit];
    if (card.rank >= 11) {
      return '<div class="court">' +
        '<span class="sym">' + symbol + '</span>' +
        '<span class="letter">' + RANKS[card.rank] + '</span>' +
        '<span class="sym flip">' + symbol + '</span>' +
        '</div>';
    }
    var pips = PIP_LAYOUT[card.rank].map(function (point) {
      var rotation = point[1] > 50 ? ' rotate(180deg)' : '';
      return '<i class="pip" style="left:' + point[0] + '%;top:' + point[1] + '%;transform:translate(-50%,-50%)' + rotation + '">' + symbol + '</i>';
    }).join('');
    return '<div class="pips' + (card.rank === 1 ? ' ace' : '') + '">' + pips + '</div>';
  }

  function createCardEl(card) {
    var el = document.createElement('div');
    el.className = 'card' + (card.faceUp ? '' : ' down');
    el.dataset.id = String(card.id);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', RANKS[card.rank] + SUIT_SYMBOL[card.suit]);
    el.innerHTML =
      '<div class="flipper">' +
        '<div class="face front ' + (RED_SUITS[card.suit] ? 'red' : 'black') + '">' +
          '<div class="corner tl"><span class="r">' + RANKS[card.rank] + '</span><span class="s">' + SUIT_SYMBOL[card.suit] + '</span></div>' +
          faceMarkup(card) +
          '<div class="corner br"><span class="r">' + RANKS[card.rank] + '</span><span class="s">' + SUIT_SYMBOL[card.suit] + '</span></div>' +
        '</div>' +
        '<div class="face back"></div>' +
      '</div>';
    el.style.transition = 'none';
    return el;
  }

  function computePositions() {
    var game = S.game;
    var geo = S.geo;
    var items = [];
    var locate = new Map();
    var i, j;

    for (i = 0; i < COLUMNS; i++) {
      var column = game.tableau[i];
      var y = geo.colTop;
      for (j = 0; j < column.length; j++) {
        var card = column[j];
        items.push({ card: card, x: geo.colsX[i], y: y, z: 10 + j });
        locate.set(card.id, { type: 'tableau', col: i, index: j });
        y += card.faceUp ? geo.fuStep : geo.fdStep;
      }
    }

    game.stock.forEach(function (group, gi) {
      var offset = Math.min(gi, 4) * 2;
      group.forEach(function (card) {
        items.push({ card: card, x: geo.stockX + offset, y: geo.stockY + offset, z: 400 - gi });
        locate.set(card.id, { type: 'stock' });
      });
    });

    game.completedPiles.forEach(function (pile, k) {
      pile.cards.forEach(function (card, ci) {
        items.push({
          card: card,
          x: geo.doneX + k * 3,
          y: geo.doneY + k * 1.5,
          z: 300 + k * 20 + (12 - ci)
        });
        locate.set(card.id, { type: 'done' });
      });
    });

    return { items: items, locate: locate };
  }

  function selectionIds() {
    var ids = new Set();
    if (!S.selected) return ids;
    var column = S.game.tableau[S.selected.col];
    for (var i = S.selected.index; i < column.length; i++) ids.add(column[i].id);
    return ids;
  }

  function render() {
    if (!S.game) return;
    measure();
    var result = computePositions();
    S.locate = result.locate;
    S.pos = new Map();
    var keep = new Set();
    var selectedIds = selectionIds();

    result.items.forEach(function (item) {
      var card = item.card;
      keep.add(card.id);
      S.pos.set(card.id, { x: item.x, y: item.y, z: item.z });

      var el = S.els.get(card.id);
      if (!el) {
        el = createCardEl(card);
        dom.cardLayer.appendChild(el);
        S.els.set(card.id, el);
        var isNew = el;
        requestAnimationFrame(function () { isNew.style.transition = ''; });
      }
      el.classList.toggle('down', !card.faceUp);
      el.classList.toggle('sel', selectedIds.has(card.id));
      el.style.zIndex = String(item.z);
      el.style.transform = 'translate3d(' + item.x + 'px,' + item.y + 'px,0)';
    });

    S.els.forEach(function (el, id) {
      if (keep.has(id)) return;
      S.els.delete(id);
      el.style.pointerEvents = 'none';
      el.classList.add('leaving');
      var transform = el.style.transform;
      el.style.transform = transform + ' scale(.86)';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
    });
  }

  function refreshSelection() {
    var ids = selectionIds();
    S.els.forEach(function (el, id) {
      el.classList.toggle('sel', ids.has(id));
    });
  }

  /* ------------------------------------------------------------- actions -- */

  function select(col, index) {
    S.selected = { col: col, index: index };
    refreshSelection();
    if (SFX) SFX.play('pick');
  }

  function clearSelection() {
    if (!S.selected) return;
    S.selected = null;
    refreshSelection();
  }

  function clearHint() {
    if (S.hintTimer) { clearTimeout(S.hintTimer); S.hintTimer = 0; }
    S.hint = null;
    S.els.forEach(function (el) { el.classList.remove('hint-src', 'hint-dst'); });
    for (var i = 0; i < dom.columns.children.length; i++) dom.columns.children[i].classList.remove('hint');
  }

  function clearDropTargets() {
    for (var i = 0; i < dom.columns.children.length; i++) dom.columns.children[i].classList.remove('drop');
  }

  function updateStats() {
    var game = S.game;
    dom.statScore.textContent = String(game.score);
    dom.statMoves.textContent = String(game.moves);
    dom.statTime.textContent = formatTime(elapsedNow());
    dom.statProgress.textContent = game.completed + ' / 8';
    dom.doneLabel.textContent = game.completed ? '已完成 ' + game.completed : '已完成';
    dom.stockLabel.textContent = game.stock.length ? '牌堆 · 剩 ' + game.stock.length + ' 次' : '牌堆已空';
    dom.btnUndo.disabled = !game.history.length;
    dom.btnHint.disabled = game.won;
    dom.btnAuto.disabled = game.won;
  }

  function afterChange() {
    render();
    updateStats();
    queueSave();
    checkWin();
  }

  function commitMove(from, index, to) {
    var game = S.game;
    var willFlip = index > 0 && !game.tableau[from][index - 1].faceUp;
    var completedBefore = game.completed;
    if (!game.move(from, index, to)) return false;

    if (game.completed > completedBefore) {
      if (SFX) SFX.play('complete');
      var pile = game.completedPiles[game.completedPiles.length - 1];
      toast('完成一组 ' + SUIT_SYMBOL[pile.suit] + ' · +' + (100 * (game.completed - completedBefore)) + ' 分');
    } else if (SFX) {
      SFX.play(willFlip ? 'flip' : 'place');
    }

    clearSelection();
    clearHint();
    afterChange();
    return true;
  }

  function doDeal() {
    if (S.game.won) return;
    var result = S.game.deal();
    if (!result.ok) {
      toast(result.reason || '现在不能发牌');
      if (SFX) SFX.play('error');
      return;
    }
    if (SFX) SFX.play('deal');
    clearSelection();
    clearHint();
    afterChange();
  }

  function doUndo() {
    if (!S.game.history.length) {
      toast('没有可撤销的操作');
      if (SFX) SFX.play('error');
      return;
    }
    S.game.undo();
    S.winShown = false;
    clearSelection();
    clearHint();
    if (SFX) SFX.play('undo');
    afterChange();
  }

  function doHint() {
    if (S.game.won) return;
    var hint = S.game.hint();
    if (!hint) {
      toast(S.game.stock.length ? '暂时没有可走的牌，点牌堆发牌' : '没有可走的牌了');
      if (SFX) SFX.play('error');
      return;
    }
    clearSelection();
    clearHint();
    S.hint = hint;

    var column = S.game.tableau[hint.from];
    for (var i = hint.start; i < column.length; i++) {
      var el = S.els.get(column[i].id);
      if (el) el.classList.add('hint-src');
    }
    var target = S.game.tableau[hint.to];
    if (target.length) {
      var topEl = S.els.get(target[target.length - 1].id);
      if (topEl) topEl.classList.add('hint-dst');
    } else {
      dom.columns.children[hint.to].classList.add('hint');
    }

    if (SFX) SFX.play('hint');
    toast('把第 ' + (hint.from + 1) + ' 列的牌移到第 ' + (hint.to + 1) + ' 列');
    S.hintTimer = setTimeout(clearHint, 2800);
  }

  function doAuto() {
    if (S.game.won) return;
    clearSelection();
    clearHint();
    var completedBefore = S.game.completed;
    var applied = S.game.autoMerge();
    if (!applied.length) {
      toast('没有可以自动合并的同花色牌');
      if (SFX) SFX.play('error');
      return;
    }
    if (S.game.completed > completedBefore) {
      if (SFX) SFX.play('complete');
      toast('自动合并 ' + applied.length + ' 次，完成 ' + (S.game.completed - completedBefore) + ' 组');
    } else {
      if (SFX) SFX.play('place');
      toast('自动合并 ' + applied.length + ' 次');
    }
    afterChange();
  }

  function newGame(difficulty) {
    clearSelection();
    clearHint();
    clearTimeout(S.hintTimer);
    S.game = new Game(difficulty);
    S.elapsed = 0;
    S.runningSince = 0;
    S.winShown = false;
    S.selected = null;
    S.drag = null;
    dom.dlgWin.close && dom.dlgWin.open && dom.dlgWin.close();
    render();
    startTimer();
    updateStats();
    queueSave();
    toast(Game.DIFFICULTY_LABELS[difficulty] + ' · 新的一局');
  }

  /* ----------------------------------------------------------------- win -- */

  function checkWin() {
    if (!S.game.won || S.winShown) return;
    S.winShown = true;
    stopTimer();
    updateStats();
    if (SFX) SFX.play('win');

    var game = S.game;
    dom.winSummary.textContent = '你完成了' + Game.DIFFICULTY_LABELS[game.difficulty] + '模式的全部 8 组牌。';
    dom.winStats.innerHTML =
      '<div><dt>时间</dt><dd>' + formatTime(elapsedNow()) + '</dd></div>' +
      '<div><dt>步数</dt><dd>' + game.moves + '</dd></div>' +
      '<div><dt>得分</dt><dd>' + game.score + '</dd></div>' +
      '<div><dt>难度</dt><dd>' + Game.DIFFICULTY_LABELS[game.difficulty] + '</dd></div>';

    spawnConfetti();
    setTimeout(function () {
      if (dom.dlgWin.showModal) dom.dlgWin.showModal();
      else dom.dlgWin.setAttribute('open', '');
    }, 780);
    queueSave();
  }

  function spawnConfetti() {
    var host = dom.confetti;
    host.innerHTML = '';
    var colors = ['#e9cb84', '#f4e3b0', '#c22a3f', '#7fd8ff', '#8ee6b4', '#ffffff'];
    for (var i = 0; i < 70; i++) {
      var bit = document.createElement('i');
      bit.style.left = (Math.random() * 100) + '%';
      bit.style.background = colors[Math.floor(Math.random() * colors.length)];
      bit.style.setProperty('--dur', (1.6 + Math.random() * 1.8).toFixed(2) + 's');
      bit.style.setProperty('--delay', (Math.random() * 0.9).toFixed(2) + 's');
      bit.style.setProperty('--drift', Math.round((Math.random() - 0.5) * 160) + 'px');
      bit.style.setProperty('--spin', Math.round(360 + Math.random() * 720) + 'deg');
      host.appendChild(bit);
    }
  }

  /* ------------------------------------------------------------- pointer -- */

  function pointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (S.game.won) return;
    var el = event.target.closest ? event.target.closest('.card') : null;
    S.press = {
      x: event.clientX,
      y: event.clientY,
      id: el ? Number(el.dataset.id) : null,
      pointerId: event.pointerId,
      moved: false
    };
    if (el) {
      var info = S.locate.get(S.press.id);
      if (info && info.type === 'tableau' && S.game.tableau[info.col][info.index].faceUp) {
        el.style.willChange = 'transform';
      }
    }
  }

  function pointerMove(event) {
    if (!S.press || S.press.pointerId !== event.pointerId) return;

    if (!S.drag) {
      if (S.press.dragFailed) return;
      var dx0 = event.clientX - S.press.x;
      var dy0 = event.clientY - S.press.y;
      if (dx0 * dx0 + dy0 * dy0 < 30) return;
      S.press.moved = true;
      if (!beginDrag(event)) { S.press.dragFailed = true; }
      if (!S.drag) return;
    }

    var drag = S.drag;
    if (!drag) return;
    var dx = event.clientX - drag.origin.x;
    var dy = event.clientY - drag.origin.y;
    drag.ids.forEach(function (id) {
      var el = S.els.get(id);
      var base = drag.base.get(id);
      if (!el || !base) return;
      el.style.transform = 'translate3d(' + (base.x + dx) + 'px,' + (base.y + dy) + 'px,0)';
    });

    var target = columnAt(event.clientX, event.clientY);
    clearDropTargets();
    drag.target = -1;
    if (target >= 0 && S.game.canMove(drag.from, drag.index, target)) {
      drag.target = target;
      dom.columns.children[target].classList.add('drop');
    }
  }

  function beginDrag() {
    var press = S.press;
    if (!press || !press.id) return false;
    var info = S.locate.get(press.id);
    if (!info || info.type !== 'tableau') return false;
    if (!S.game.movableAt(info.col, info.index)) return false;

    var column = S.game.tableau[info.col];
    var group = column.slice(info.index);
    var drag = {
      from: info.col,
      index: info.index,
      ids: group.map(function (card) { return card.id; }),
      origin: { x: press.x, y: press.y },
      base: new Map(),
      target: -1,
      pointerId: press.pointerId
    };

    group.forEach(function (card, i) {
      var el = S.els.get(card.id);
      var p = S.pos.get(card.id);
      if (!el || !p) return;
      drag.base.set(card.id, p);
      el.classList.add('dragging');
      el.style.zIndex = String(9000 + i);
    });
    if (!drag.base.size) return false;

    S.drag = drag;
    clearSelection();
    clearHint();
    clearDropTargets();
    if (SFX) SFX.play('pick');
    return true;
  }

  function pointerUp(event) {
    if (!S.press || S.press.pointerId !== event.pointerId) return;
    var press = S.press;
    S.press = null;

    if (S.drag) {
      var drag = S.drag;
      S.drag = null;
      drag.ids.forEach(function (id) {
        var el = S.els.get(id);
        if (!el) return;
        el.classList.remove('dragging');
        el.style.willChange = '';
      });
      clearDropTargets();

      var target = columnAt(event.clientX, event.clientY);
      if (target >= 0 && S.game.canMove(drag.from, drag.index, target)) {
        commitMove(drag.from, drag.index, target);
      } else {
        if (SFX) SFX.play('error');
        render();
      }
      return;
    }

    if (!press.moved) handleClick(event);
  }

  function handleClick(event) {
    if (S.game.won) return;
    var el = event.target.closest ? event.target.closest('.card') : null;
    var game = S.game;

    if (el) {
      var info = S.locate.get(Number(el.dataset.id));
      if (!info) return;
      if (info.type === 'stock') { doDeal(); return; }
      if (info.type === 'done') { toast('这组牌已经完成了'); return; }

      var col = info.col;
      var index = info.index;
      if (S.selected) {
        if (S.selected.col === col && S.selected.index === index) return;
        if (game.canMove(S.selected.col, S.selected.index, col)) {
          commitMove(S.selected.col, S.selected.index, col);
          return;
        }
      }
      if (!game.tableau[col][index].faceUp) {
        clearSelection();
        toast('暗牌不能移动');
        if (SFX) SFX.play('error');
        return;
      }
      if (game.movableAt(col, index)) {
        select(col, index);
      } else {
        clearSelection();
        toast('只能整体移动同花色连续递减的牌');
        if (SFX) SFX.play('error');
      }
      return;
    }

    var zone = columnAt(event.clientX, event.clientY);
    if (zone >= 0) {
      if (S.selected && game.canMove(S.selected.col, S.selected.index, zone)) {
        commitMove(S.selected.col, S.selected.index, zone);
        return;
      }
      if (S.selected) {
        if (SFX) SFX.play('error');
      }
      clearSelection();
      return;
    }

    clearSelection();
  }

  function doubleClick(event) {
    if (S.game.won) return;
    var el = event.target.closest ? event.target.closest('.card') : null;
    if (!el) return;
    var info = S.locate.get(Number(el.dataset.id));
    if (!info || info.type !== 'tableau') return;
    if (!S.game.movableAt(info.col, info.index)) return;
    var target = S.game.bestTarget(info.col, info.index);
    if (target < 0) {
      toast('没有可以放置的位置');
      if (SFX) SFX.play('error');
      return;
    }
    commitMove(info.col, info.index, target);
  }

  /* ----------------------------------------------------------- timer/save -- */

  function elapsedNow() {
    return S.elapsed + (S.runningSince ? Date.now() - S.runningSince : 0);
  }

  function startTimer() {
    if (!S.runningSince) S.runningSince = Date.now();
    if (!S.ticker) {
      S.ticker = setInterval(function () {
        if (S.game) dom.statTime.textContent = formatTime(elapsedNow());
      }, 1000);
    }
  }

  function stopTimer() {
    if (S.runningSince) {
      S.elapsed += Date.now() - S.runningSince;
      S.runningSince = 0;
    }
  }

  function queueSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(saveNow, 220);
  }

  function saveNow() {
    if (!S.game) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        game: S.game.serialize(),
        elapsed: elapsedNow(),
        savedAt: Date.now()
      }));
    } catch (err) { /* storage may be unavailable */ }
    savePrefs();
  }

  function savePrefs() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({
        sound: S.soundOn,
        difficulty: S.game ? S.game.difficulty : 1
      }));
    } catch (err) { /* ignore */ }
  }

  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREF_KEY);
      if (!raw) return;
      var prefs = JSON.parse(raw);
      if (typeof prefs.sound === 'boolean') S.soundOn = prefs.sound;
      if (prefs.difficulty) S.prefDifficulty = prefs.difficulty;
    } catch (err) { /* ignore */ }
  }

  function restoreGame() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !Game.isValidState(data.game)) return null;
      var game = Game.deserialize(data.game);
      if (!game || game.won) return null;
      S.elapsed = Math.max(0, Math.round(data.elapsed || 0));
      return game;
    } catch (err) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ ui -- */

  function updateSoundButton() {
    dom.btnSound.setAttribute('aria-pressed', S.soundOn ? 'true' : 'false');
    dom.btnSound.textContent = S.soundOn ? '\u266a' : '\u00d7';
    dom.btnSound.title = S.soundOn ? '音效已开启' : '音效已关闭';
    if (SFX) SFX.setEnabled(S.soundOn);
  }

  function openNewDialog() {
    var current = S.game ? S.game.difficulty : 1;
    var buttons = dom.dlgNew.querySelectorAll('.diff');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-current', String(Number(buttons[i].dataset.difficulty) === current));
    }
    if (dom.dlgNew.showModal) dom.dlgNew.showModal();
    else dom.dlgNew.setAttribute('open', '');
  }

  function bind() {
    dom.btnNew.addEventListener('click', openNewDialog);
    dom.btnUndo.addEventListener('click', doUndo);
    dom.btnHint.addEventListener('click', doHint);
    dom.btnAuto.addEventListener('click', doAuto);
    dom.btnRules.addEventListener('click', function () {
      if (dom.dlgRules.showModal) dom.dlgRules.showModal();
      else dom.dlgRules.setAttribute('open', '');
    });
    dom.btnSound.addEventListener('click', function () {
      S.soundOn = !S.soundOn;
      updateSoundButton();
      savePrefs();
      if (S.soundOn && SFX) SFX.play('pick');
    });

    dom.dlgNew.addEventListener('click', function (event) {
      var btn = event.target.closest('.diff');
      if (!btn) return;
      var difficulty = Number(btn.dataset.difficulty);
      dom.dlgNew.close();
      newGame(difficulty);
    });

    dom.btnWinClose.addEventListener('click', function () { dom.dlgWin.close(); });
    dom.btnWinNew.addEventListener('click', function () {
      dom.dlgWin.close();
      openNewDialog();
    });

    dom.stage.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', function () {
      if (S.drag) {
        S.drag.ids.forEach(function (id) {
          var el = S.els.get(id);
          if (el) { el.classList.remove('dragging'); el.style.willChange = ''; }
        });
        S.drag = null;
        clearDropTargets();
        render();
      }
      S.press = null;
    });
    dom.stage.addEventListener('dblclick', doubleClick);
    dom.stage.addEventListener('contextmenu', function (event) { event.preventDefault(); });

    document.addEventListener('keydown', function (event) {
      if (event.target && /input|textarea|select/i.test(event.target.tagName)) return;
      var key = event.key.toLowerCase();
      if (key === 'u' || (key === 'z' && (event.ctrlKey || event.metaKey))) {
        event.preventDefault();
        doUndo();
      } else if (key === 'h') {
        event.preventDefault();
        doHint();
      } else if (key === 'a') {
        doAuto();
      } else if (key === 'n') {
        openNewDialog();
      } else if (key === 'escape') {
        clearSelection();
        clearHint();
      } else if (key === ' ' || key === 'd') {
        event.preventDefault();
        doDeal();
      }
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { render(); }, 120);
    });
    window.addEventListener('orientationchange', function () { setTimeout(render, 220); });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        stopTimer();
        saveNow();
      } else if (!S.game.won) {
        startTimer();
        updateStats();
      }
    });
    window.addEventListener('beforeunload', saveNow);
  }

  function boot() {
    dom.stage = $('stage');
    dom.columns = $('columns');
    dom.dock = $('dock');
    dom.cardLayer = $('cardLayer');
    dom.toast = $('toast');
    dom.statScore = $('statScore');
    dom.statMoves = $('statMoves');
    dom.statTime = $('statTime');
    dom.statProgress = $('statProgress');
    dom.btnNew = $('btnNew');
    dom.btnUndo = $('btnUndo');
    dom.btnHint = $('btnHint');
    dom.btnAuto = $('btnAuto');
    dom.btnRules = $('btnRules');
    dom.btnSound = $('btnSound');
    dom.dlgNew = $('dlgNew');
    dom.dlgWin = $('dlgWin');
    dom.dlgRules = $('dlgRules');
    dom.btnWinClose = $('btnWinClose');
    dom.btnWinNew = $('btnWinNew');
    dom.winSummary = $('winSummary');
    dom.winStats = $('winStats');
    dom.confetti = $('confetti');
    dom.doneLabel = document.querySelector('.done-label');
    dom.stockLabel = document.querySelector('.stock-label');

    loadPrefs();
    buildColumns();
    updateSoundButton();

    var restored = restoreGame();
    S.game = restored || new Game(S.prefDifficulty || 1);
    if (!restored) S.elapsed = 0;

    measure();
    render();
    updateStats();
    startTimer();
    bind();

    if (restored) toast('已恢复上次的进度，继续！');

    /* Debug hook: handy for automated UI tests and for poking at state in DevTools. */
    window.__spider = { state: S, render: render, newGame: newGame };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
