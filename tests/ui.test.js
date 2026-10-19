/**
 * Headless UI smoke test for the Spider Solitaire page.
 * Uses jsdom (no real layout), so geometry is stubbed.
 */
const path = require('path');
const { JSDOM } = require('jsdom');

const FILE = path.resolve(__dirname, '..', 'index.html');
const errors = [];

function patchBeforeParse(window) {
  const proto = window.HTMLElement.prototype;
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get() { return this.id === 'stage' ? 1200 : 0; }
  });
  Object.defineProperty(proto, 'clientHeight', {
    configurable: true,
    get() { return this.id === 'stage' ? 800 : 0; }
  });
  proto.getBoundingClientRect = function () {
    if (this.id === 'stage') return { left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0 };
    return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };
  // minimal dialog support
  const dialogProto = window.HTMLDialogElement ? window.HTMLDialogElement.prototype : null;
  if (dialogProto) {
    dialogProto.showModal = function () { this.open = true; };
    dialogProto.show = function () { this.open = true; };
    dialogProto.close = function () { this.open = false; };
  }
  window.matchMedia = window.matchMedia || function () {
    return { matches: false, addEventListener() {}, removeEventListener() {} };
  };
}

(async () => {
  const dom = await JSDOM.fromFile(FILE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    url: 'file:///' + FILE.replace(/\\/g, '/'),
    beforeParse: patchBeforeParse
  });

  const win = dom.window;
  win.addEventListener('error', (e) => errors.push('window error: ' + e.message));
  win.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + e.reason));

  await new Promise((resolve) => {
    if (win.document.readyState === 'complete') return resolve();
    win.addEventListener('load', resolve);
    setTimeout(resolve, 4000);
  });
  await new Promise((r) => setTimeout(r, 300));

  const doc = win.document;
  const app = win.__spider;
  const fail = (msg) => { errors.push(msg); };

  const assert = (cond, msg) => { if (!cond) fail('ASSERT FAILED: ' + msg); else console.log('ok  -', msg); };

  assert(!!app, 'app booted and exposed debug hook');
  if (!app) { report(); return; }
  const S = app.state;
  assert(S.game && S.game.tableau.length === 10, 'game created with 10 columns');
  assert(doc.querySelectorAll('.card').length === 104, '104 card elements rendered, got ' + doc.querySelectorAll('.card').length);
  assert(S.game.tableau.every((c) => c.length >= 5), 'every column dealt at least 5 cards');
  assert(doc.getElementById('statProgress').textContent.trim() === '0 / 8', 'progress starts at 0 / 8');
  assert(doc.getElementById('statScore').textContent === '500', 'score starts at 500');

  const fire = (el, type, x, y) => {
    const ev = new win.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: x });
    Object.defineProperty(ev, 'clientY', { value: y });
    Object.defineProperty(ev, 'pointerId', { value: 1 });
    Object.defineProperty(ev, 'button', { value: 0 });
    el.dispatchEvent(ev);
  };

  // helper: screen position of a card id
  const posOf = (id) => S.pos.get(id) || { x: 0, y: 0 };
  const elOf = (id) => doc.querySelector('.card[data-id="' + id + '"]');

  /* --- 1. click-to-select and click-to-move --- */
  const hint = S.game.hint();
  assert(!!hint, 'initial position has at least one legal move');
  if (hint) {
    const srcCards = S.game.tableau[hint.from].slice(hint.start);
    const srcCard = srcCards[srcCards.length - 1];
    const before = S.game.moves;
    const p = posOf(hint.from === undefined ? 0 : hint.from);
    const srcPos = posOf(S.game.tableau[hint.from][hint.start].id);
    fire(elOf(S.game.tableau[hint.from][hint.start].id), 'pointerdown', srcPos.x + 20, srcPos.y + 20);
    fire(elOf(S.game.tableau[hint.from][hint.start].id), 'pointerup', srcPos.x + 20, srcPos.y + 20);
    assert(S.selected && S.selected.col === hint.from, 'click on movable card selects it');
    const targetCards = S.game.tableau[hint.to];
    const dropX = S.geo.colsX[hint.to] + 10;
    const dropY = S.geo.colTop + 10;
    if (targetCards.length) {
      const top = targetCards[targetCards.length - 1];
      const tp = posOf(top.id);
      fire(elOf(top.id), 'pointerdown', tp.x + 15, tp.y + 15);
      fire(elOf(top.id), 'pointerup', tp.x + 15, tp.y + 15);
    } else {
      fire(doc.querySelector('.column[data-col="' + hint.to + '"]'), 'pointerdown', dropX, dropY);
      fire(doc.querySelector('.column[data-col="' + hint.to + '"]'), 'pointerup', dropX, dropY);
    }
    assert(S.game.moves === before + 1, 'click-to-move executed a legal move');
  }

  /* --- 2. drag and drop --- */
  const moveList = () => {
    const out = [];
    for (let f = 0; f < 10; f++) {
      for (let s = 0; s < S.game.tableau[f].length; s++) {
        if (!S.game.movableAt(f, s)) continue;
        for (let t = 0; t < 10; t++) if (S.game.canDrop(f, s, t)) out.push({ f, s, t });
      }
    }
    return out;
  };
  const moves = moveList();
  assert(moves.length > 0, 'legal moves exist for drag test');
  if (moves.length) {
    const m = moves[0];
    const card = S.game.tableau[m.f][m.s];
    const el = elOf(card.id);
    const p = posOf(card.id);
    const before = S.game.moves;
    fire(el, 'pointerdown', p.x + 15, p.y + 15);
    fire(el, 'pointermove', p.x + 40, p.y + 30);
    const targetX = S.geo.colsX[m.t] + S.geo.cw / 2;
    const targetY = S.geo.colTop + 40;
    fire(card && elOf(card.id), 'pointermove', targetX, targetY);
    fire(card && elOf(card.id), 'pointerup', targetX, targetY);
    assert(S.game.moves === before + 1, 'drag & drop executed a legal move');
    assert(S.drag === null, 'drag state cleaned up after drop');
  }

  /* --- 3. deal from stock --- */
  const dealsBefore = S.game.stock.length;
  const stockCard = S.game.stock.length ? S.game.stock[0][0] : null;
  if (stockCard) {
    const sp = posOf(stockCard.id);
    const el = elOf(stockCard.id);
    fire(el, 'pointerdown', sp.x + 10, sp.y + 10);
    fire(el, 'pointerup', sp.x + 10, sp.y + 10);
    assert(S.game.stock.length === dealsBefore - 1, 'clicking the stock deals one row');
  }

  /* --- 4. undo --- */
  const movesNow = S.game.moves;
  doc.getElementById('btnUndo').click();
  assert(S.game.moves === movesNow - 1, 'undo restores previous move count');

  /* --- 5. hint + auto merge + keyboard --- */
  doc.getElementById('btnHint').click();
  assert(doc.querySelectorAll('.hint-src').length + doc.querySelectorAll('.column.hint').length > 0, 'hint highlights something');
  doc.getElementById('btnAuto').click();
  assert(true, 'auto merge ran without throwing');

  /* --- 6. new game via dialog --- */
  doc.getElementById('btnNew').click();
  const diff4 = doc.querySelector('.diff[data-difficulty="4"]');
  diff4.click();
  assert(S.game.difficulty === 4, 'difficulty dialog starts a 4-suit game');
  await new Promise((r) => setTimeout(r, 460));
  assert(doc.querySelectorAll('.card').length === 104, 'new game renders 104 cards, got ' + doc.querySelectorAll('.card').length);
  assert(S.game.moves === 0 && S.game.score === 500, 'new game resets counters');

  /* --- 7. win flow: craft a state one move away from victory --- */
  const Game = win.SpiderGame;
  const state = {
    version: 1,
    difficulty: 1,
    tableau: [[], [], [], [], [], [], [], [], [], []],
    stock: [],
    completedPiles: [],
    moves: 120,
    score: 380,
    won: false
  };
  let id = 5000;
  const mk = (rank, suit, faceUp) => ({ id: ++id, rank, suit, faceUp: faceUp !== false });
  // seven finished piles
  for (let p = 0; p < 7; p++) {
    const pile = [];
    for (let r = 13; r >= 1; r--) pile.push(mk(r, 'S'));
    state.completedPiles.push({ suit: 'S', cards: pile });
  }
  // two columns: King..2 in col 0, Ace in col 1  => one move finishes the game
  const run = [];
  for (let r = 13; r >= 2; r--) run.push(mk(r, 'S'));
  state.tableau[0] = run;
  state.tableau[1] = [mk(1, 'S')];

  const restored = Game.deserialize(JSON.parse(JSON.stringify(state)));
  assert(!!restored, 'crafted win state deserialises');
  S.game = restored;
  app.render();
  const aceEl = elOf(state.tableau[1][0].id);
  const acePos = posOf(state.tableau[1][0].id);
  fire(aceEl, 'pointerdown', acePos.x + 10, acePos.y + 10);
  fire(aceEl, 'pointerup', acePos.x + 10, acePos.y + 10);
  const lastRunCard = state.tableau[0][state.tableau[0].length - 1];
  const runEl = elOf(lastRunCard.id);
  const runPos = posOf(lastRunCard.id);
  fire(runEl, 'pointerdown', runPos.x + 10, runPos.y + 10);
  fire(runEl, 'pointerup', runPos.x + 10, runPos.y + 10);
  assert(S.game.won === true, 'winning move marks the game as won');
  await new Promise((r) => setTimeout(r, 460));
  assert(doc.querySelectorAll('.card:not(.leaving)').length === 104, 'all 104 cards still on screen after win, got ' + doc.querySelectorAll('.card:not(.leaving)').length);
  await new Promise((r) => setTimeout(r, 950));
  assert(doc.getElementById('dlgWin').open === true, 'win dialog opens');

  report();

  function report() {
    console.log('\n--- errors ---');
    if (!errors.length) console.log('none');
    else errors.forEach((e) => console.log(e));
    const failed = errors.length > 0;
    console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS');
    process.exit(failed ? 1 : 0);
  }
})();

