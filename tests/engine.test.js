/**
 * Engine tests for the Spider Solitaire rules — plain Node, no dependencies.
 * Run with: node tests/engine.test.js
 */
'use strict';

const Game = require('../js/game.js');

let passed = 0;
const failures = [];

function ok(cond, label, extra) {
  if (cond) {
    passed += 1;
    console.log('  ok  ' + label);
  } else {
    failures.push(label + (extra ? ' — ' + extra : ''));
    console.log('  FAIL ' + label + (extra ? ' — ' + extra : ''));
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label, 'expected ' + expected + ', got ' + actual);
}

function seeded(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function layout(game) {
  return game.tableau.map((column) => column.map((card) => card.rank + card.suit).join(' ')).join('|');
}

function totalCards(game) {
  return game.tableau.reduce((sum, column) => sum + column.length, 0) +
    game.stock.reduce((sum, group) => sum + group.length, 0) +
    game.completedPiles.reduce((sum, pile) => sum + pile.cards.length, 0);
}

function allMoves(game) {
  const moves = [];
  for (let from = 0; from < 10; from++) {
    for (let start = 0; start < game.tableau[from].length; start++) {
      if (!game.movableAt(from, start)) continue;
      for (let to = 0; to < 10; to++) {
        if (game.canDrop(from, start, to)) moves.push({ from, start, to });
      }
    }
  }
  return moves;
}

console.log('\nDeck & deal');
{
  [[1, 8], [2, 4], [4, 2]].forEach(([difficulty, copies]) => {
    const game = new Game(difficulty);
    const counts = {};
    game.tableau.concat(game.stock).forEach((group) => group.forEach((card) => {
      counts[card.suit] = (counts[card.suit] || 0) + 1;
    }));
    eq(totalCards(game), 104, difficulty + '-suit pack holds 104 cards');
    eq(Object.keys(counts).length, difficulty, difficulty + '-suit pack uses ' + difficulty + ' suit(s)');
    eq(Math.min.apply(null, Object.keys(counts).map((s) => counts[s])), 13 * copies, difficulty + '-suit pack has ' + (13 * copies) + ' cards per suit');
  });

  const game = new Game(1);
  eq(game.tableau.length, 10, 'ten tableau columns');
  ok(game.tableau.slice(0, 4).every((c) => c.length === 6), 'first four columns hold six cards');
  ok(game.tableau.slice(4).every((c) => c.length === 5), 'remaining six columns hold five cards');
  ok(game.tableau.every((c) => c[c.length - 1].faceUp), 'the bottom card of every column is face up');
  ok(game.tableau.every((c) => c.slice(0, -1).every((card) => !card.faceUp)), 'every other card starts face down');
  eq(game.stock.length, 5, 'stock holds five deals');
  ok(game.stock.every((group) => group.length === 10), 'each deal holds ten cards');
  eq(game.completed, 0, 'no completed runs at the start');
  eq(game.score, 500, 'score starts at 500');
}

console.log('\nDeterministic shuffle');
{
  const a = new Game(4, { rand: seeded(7) });
  const b = new Game(4, { rand: seeded(7) });
  eq(layout(a), layout(b), 'the same seed produces the same deal');
  const c = new Game(4, { rand: seeded(8) });
  ok(layout(a) !== layout(c), 'a different seed produces a different deal');
}

console.log('\nMovability rules');
{
  const game = new Game(1);
  const card = (rank, suit, faceUp) => ({ id: Math.random(), rank, suit, faceUp: faceUp !== false });
  game.tableau[0] = [card(9, 'S'), card(8, 'S'), card(7, 'S')];
  ok(game.movableAt(0, 0), 'a same-suit descending run can be picked up as a whole');
  ok(game.movableAt(0, 1), 'a suffix of that run can be picked up too');
  game.tableau[0] = [card(9, 'S'), card(8, 'H'), card(7, 'S')];
  ok(!game.movableAt(0, 0), 'a mixed-suit run cannot be picked up');
  game.tableau[0] = [card(9, 'S'), card(8, 'S', false)];
  ok(!game.movableAt(0, 0), 'a run containing a face-down card cannot be picked up');

  game.tableau[1] = [card(10, 'H')];
  ok(game.canDrop(0, 0, 1), 'a run may land on any suit one rank higher');
  game.tableau[1] = [card(10, 'H'), card(9, 'S')];
  ok(!game.canDrop(0, 0, 1), 'a lower target refuses the move');
  game.tableau[2] = [];
  ok(game.canDrop(0, 0, 2), 'an empty column accepts any run');
}

console.log('\nMoves, flips and undo');
{
  const game = new Game(1);
  const card = (rank, suit, faceUp) => ({ id: Math.random(), rank, suit, faceUp: faceUp !== false });
  game.tableau[0] = [card(10, 'S', false), card(9, 'S')];
  game.tableau[1] = [card(10, 'H')];
  const before = game.moves;
  ok(game.move(0, 1, 1), 'legal move is executed');
  eq(game.tableau[0].length, 1, 'source column shrinks');
  ok(game.tableau[0][0].faceUp, 'the newly exposed card flips face up');
  eq(game.tableau[1].length, 2, 'target column grows');
  eq(game.moves, before + 1, 'move counter increments');
  eq(game.score, 499, 'score drops by one per move');

  ok(game.undo(), 'undo restores the previous position');
  eq(game.tableau[0].length, 2, 'source column restored');
  ok(!game.tableau[0][0].faceUp, 'flipped card is face down again');
  eq(game.moves, before, 'move counter restored');
  eq(game.score, 500, 'score restored');
  ok(!game.move(0, 0, 1), 'illegal move is rejected');
}

console.log('\nCompleting a run');
{
  const game = new Game(1);
  const run = [];
  for (let rank = 13; rank >= 1; rank--) run.push({ id: Math.random(), rank, suit: 'S', faceUp: true });
  game.tableau[0] = [{ id: Math.random(), rank: 13, suit: 'H', faceUp: false }].concat(run);
  game.resolveCompletions();
  eq(game.completed, 1, 'a K..A same-suit run is collected');
  eq(game.tableau[0].length, 1, 'the thirteen cards leave the column');
  ok(game.tableau[0][0].faceUp, 'the card below the run flips over');
  eq(game.score, 600, 'collecting a run pays 100 points');
  eq(game.completedPiles[0].cards.length, 13, 'the finished run is kept for the end-game display');
  eq(game.completedPiles[0].cards[0].rank, 13, 'the finished run starts with the king');

  const mixed = new Game(1);
  const mixedRun = [];
  for (let rank = 13; rank >= 1; rank--) mixedRun.push({ id: Math.random(), rank, suit: rank === 1 ? 'H' : 'S', faceUp: true });
  mixed.tableau[0] = mixedRun;
  mixed.resolveCompletions();
  eq(mixed.completed, 0, 'a run with a different suit is not collected');
}

console.log('\nDealing from the stock');
{
  const game = new Game(1);
  const before = game.stock.length;
  const scoreBefore = game.score;
  const result = game.deal();
  ok(result.ok, 'dealing succeeds while every column is occupied');
  eq(game.stock.length, before - 1, 'one stock row is consumed');
  eq(game.score, scoreBefore - 1, 'dealing also costs one score point');
  eq(game.tableau.filter((c) => c[c.length - 1].faceUp).length, 10, 'the new cards are face up');
  game.undo();
  eq(game.stock.length, before, 'undo puts the dealt row back');
  eq(game.score, scoreBefore, 'undo restores the score');

  const blocked = new Game(1);
  blocked.tableau[0] = [];
  const blockedResult = blocked.deal();
  ok(!blockedResult.ok, 'dealing is refused while a column is empty');
}

console.log('\nHint, auto-merge and scoring');
{
  const game = new Game(1);
  const hint = game.hint();
  ok(hint === null || (game.movableAt(hint.from, hint.start) && game.canDrop(hint.from, hint.start, hint.to)), 'hint always names a legal move');
  ok(game.bestTarget(-1, 0) === -1, 'no target for a missing source');

  const auto = new Game(2);
  const joinsBefore = auto.countSameSuitAdjacency();
  const applied = auto.autoMerge();
  ok(auto.countSameSuitAdjacency() >= joinsBefore, 'auto merge never destroys same-suit joins');
  ok(applied.length < 300, 'auto merge terminates');
  eq(totalCards(auto), 104, 'auto merge conserves every card');
}

console.log('\nRandom play-out (1,000 moves)');
{
  const game = new Game(4, { rand: seeded(99) });
  const rng = seeded(5);
  let guard = 0;
  while (guard++ < 1000) {
    const moves = allMoves(game);
    if (!moves.length) {
      const dealt = game.deal();
      if (!dealt.ok) break;
      continue;
    }
    const move = moves[Math.floor(rng() * moves.length)];
    if (!game.move(move.from, move.start, move.to)) {
      failures.push('a move reported legal by canDrop/canMove was rejected');
      break;
    }
  }
  ok(guard > 10, 'the play-out ran');
  eq(totalCards(game), 104, 'every card is accounted for after the play-out');
  ok(game.score >= 0, 'score never goes negative');
}

console.log('\nSerialisation');
{
  const game = new Game(2, { rand: seeded(11) });
  game.deal();
  const json = JSON.parse(JSON.stringify(game.serialize()));
  ok(Game.isValidState(json), 'serialised state is valid');
  const clone = Game.deserialize(json);
  ok(!!clone, 'state round-trips through deserialise');
  eq(JSON.stringify(clone.serialize()), JSON.stringify(json), 'round-trip is lossless');
  eq(totalCards(clone), 104, 'the clone holds all 104 cards');
  ok(Game.deserialize({ version: 2 }) === null, 'unknown versions are rejected');
  ok(Game.deserialize({ version: 1, tableau: [] }) === null, 'broken tableaus are rejected');
  ok(!Game.isValidState({ version: 1, tableau: [[], [], [], [], [], [], [], [], [], []], stock: [], completedPiles: [] }), 'state with missing cards is invalid');
}

console.log('\n' + (failures.length ? 'FAILED ' + failures.length + ' / ' + (passed + failures.length) : 'All ' + passed + ' checks passed'));
if (failures.length) {
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
