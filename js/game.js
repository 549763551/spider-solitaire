/*!
 * Spider Solitaire — rules engine
 * Pure functions + a tiny state machine, no DOM access.
 * MIT License
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SpiderGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SUITS = {
    S: { key: 'S', symbol: '\u2660', color: 'black' },
    H: { key: 'H', symbol: '\u2665', color: 'red' },
    D: { key: 'D', symbol: '\u2666', color: 'red' },
    C: { key: 'C', symbol: '\u2663', color: 'black' }
  };

  var RANK_LABELS = [null, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var COLUMN_COUNT = 10;
  var RUN_LENGTH = 13;
  var SUITS_BY_DIFFICULTY = { 1: ['S'], 2: ['S', 'H'], 4: ['S', 'H', 'D', 'C'] };
  var DIFFICULTY_LABELS = { 1: '单花色', 2: '双花色', 4: '四花色' };

  var nextId = 0;

  function makeCard(rank, suit) {
    nextId += 1;
    return { id: nextId, rank: rank, suit: suit, faceUp: false };
  }

  function cloneCard(card) {
    return { id: card.id, rank: card.rank, suit: card.suit, faceUp: card.faceUp };
  }

  function cloneCards(cards) {
    return cards.map(cloneCard);
  }

  function shuffle(list, rand) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  /** Fisher-Yates shuffle of the 104 card pack for a difficulty. */
  function buildDeck(difficulty, rand) {
    var suits = SUITS_BY_DIFFICULTY[difficulty] || SUITS_BY_DIFFICULTY[1];
    var repeats = 8 / suits.length;
    var deck = [];
    for (var r = 0; r < repeats; r++) {
      for (var s = 0; s < suits.length; s++) {
        for (var rank = 1; rank <= RUN_LENGTH; rank++) deck.push(makeCard(rank, suits[s]));
      }
    }
    return shuffle(deck, rand || Math.random);
  }

  function SpiderGame(difficulty, options) {
    this.rand = (options && options.rand) || Math.random;
    this.newGame(difficulty || 1);
  }

  SpiderGame.SUITS = SUITS;
  SpiderGame.RANK_LABELS = RANK_LABELS;
  SpiderGame.COLUMN_COUNT = COLUMN_COUNT;
  SpiderGame.DIFFICULTY_LABELS = DIFFICULTY_LABELS;
  SpiderGame.SUITS_BY_DIFFICULTY = SUITS_BY_DIFFICULTY;
  SpiderGame.buildDeck = buildDeck;

  SpiderGame.prototype.newGame = function (difficulty) {
    this.difficulty = SUITS_BY_DIFFICULTY[difficulty] ? difficulty : 1;
    var deck = buildDeck(this.difficulty, this.rand);

    this.tableau = [];
    var index = 0;
    for (var c = 0; c < COLUMN_COUNT; c++) {
      var size = c < 4 ? 6 : 5;
      var column = deck.slice(index, index + size);
      index += size;
      column[column.length - 1].faceUp = true;
      this.tableau.push(column);
    }

    this.stock = [];
    while (index < deck.length) {
      this.stock.push(deck.slice(index, index + COLUMN_COUNT));
      index += COLUMN_COUNT;
    }

    this.completedPiles = [];
    this.moves = 0;
    this.score = 500;
    this.won = false;
    this.history = [];
  };

  Object.defineProperty(SpiderGame.prototype, 'completed', {
    get: function () { return this.completedPiles.length; }
  });

  Object.defineProperty(SpiderGame.prototype, 'dealsLeft', {
    get: function () { return this.stock.length; }
  });

  SpiderGame.prototype.capture = function () {
    return {
      tableau: this.tableau.map(cloneCards),
      stock: this.stock.map(cloneCards),
      completedPiles: this.completedPiles.map(function (pile) {
        return { suit: pile.suit, cards: cloneCards(pile.cards) };
      }),
      moves: this.moves,
      score: this.score,
      won: this.won
    };
  };

  SpiderGame.prototype.pushHistory = function () {
    this.history.push(this.capture());
    if (this.history.length > 300) this.history.shift();
  };

  SpiderGame.prototype.undo = function () {
    if (!this.history.length) return false;
    var snap = this.history.pop();
    this.tableau = snap.tableau;
    this.stock = snap.stock;
    this.completedPiles = snap.completedPiles;
    this.moves = snap.moves;
    this.score = snap.score;
    this.won = snap.won;
    return true;
  };

  /** Cards from `start` to the end of the column form a movable same-suit run. */
  SpiderGame.prototype.movableAt = function (col, start) {
    var column = this.tableau[col];
    if (!column || start < 0 || start >= column.length) return false;
    if (!column[start].faceUp) return false;
    for (var i = start; i < column.length - 1; i++) {
      var a = column[i];
      var b = column[i + 1];
      if (!b.faceUp) return false;
      if (a.rank !== b.rank + 1 || a.suit !== b.suit) return false;
    }
    return true;
  };

  /** Rank/empty-column legality of dropping the run onto column `to`. */
  SpiderGame.prototype.canDrop = function (from, start, to) {
    if (to === from || to < 0 || to >= COLUMN_COUNT) return false;
    var column = this.tableau[from];
    if (!column || start < 0 || start >= column.length) return false;
    var target = this.tableau[to];
    if (!target) return false;
    if (!target.length) return true;
    var top = target[target.length - 1];
    return !!top.faceUp && top.rank === column[start].rank + 1;
  };

  SpiderGame.prototype.canMove = function (from, start, to) {
    return this.movableAt(from, start) && this.canDrop(from, start, to);
  };

  SpiderGame.prototype.move = function (from, start, to) {
    if (!this.canMove(from, start, to)) return false;
    this.pushHistory();
    var column = this.tableau[from];
    var moving = column.splice(start, column.length - start);
    this.tableau[to] = this.tableau[to].concat(moving);
    this.flipTop(from);
    this.moves += 1;
    this.score = Math.max(0, this.score - 1);
    this.resolveCompletions();
    return true;
  };

  SpiderGame.prototype.deal = function () {
    if (!this.stock.length) return { ok: false, reason: '牌堆已空' };
    var loose = this.tableau.filter(function (column) {
      return column.length === 0;
    }).length;
    if (loose > 0) return { ok: false, reason: '有空列时不能发牌' };

    this.pushHistory();
    var group = this.stock.shift();
    for (var i = 0; i < group.length; i++) {
      group[i].faceUp = true;
      this.tableau[i].push(group[i]);
    }
    this.moves += 1;
    this.score = Math.max(0, this.score - 1);
    this.resolveCompletions();
    return { ok: true };
  };

  SpiderGame.prototype.flipTop = function (col) {
    var column = this.tableau[col];
    if (!column.length) return false;
    var top = column[column.length - 1];
    if (!top.faceUp) { top.faceUp = true; return true; }
    return false;
  };

  /** Remove every K..A same-suit run sitting at the bottom of a column. */
  SpiderGame.prototype.resolveCompletions = function () {
    var changed = true;
    while (changed) {
      changed = false;
      for (var c = 0; c < COLUMN_COUNT; c++) {
        var column = this.tableau[c];
        if (column.length < RUN_LENGTH) continue;
        var tail = column.slice(column.length - RUN_LENGTH);
        if (!tail[0].faceUp) continue;
        var ok = true;
        for (var k = 0; k < RUN_LENGTH; k++) {
          if (tail[k].rank !== RUN_LENGTH - k || tail[k].suit !== tail[0].suit || !tail[k].faceUp) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        column.length = column.length - RUN_LENGTH;
        this.completedPiles.push({ suit: tail[0].suit, cards: tail });
        this.score += 100;
        this.flipTop(c);
        changed = true;
      }
    }
    if (this.completedPiles.length >= 8) this.won = true;
  };

  SpiderGame.prototype.hasMoves = function () {
    for (var f = 0; f < COLUMN_COUNT; f++) {
      var column = this.tableau[f];
      for (var s = 0; s < column.length; s++) {
        if (!this.movableAt(f, s)) continue;
        for (var t = 0; t < COLUMN_COUNT; t++) {
          if (this.canDrop(f, s, t)) return true;
        }
      }
    }
    return false;
  };

  SpiderGame.prototype.bestTarget = function (from, start) {
    var card = this.tableau[from] && this.tableau[from][start];
    if (!card) return -1;
    var best = -1;
    var bestScore = -Infinity;
    for (var t = 0; t < COLUMN_COUNT; t++) {
      if (!this.canDrop(from, start, t)) continue;
      var target = this.tableau[t];
      var score = 0;
      if (!target.length) {
        score = 1;
      } else {
        var top = target[target.length - 1];
        score = top.suit === card.suit ? 50 : 10;
        if (start > 0 && !this.tableau[from][start - 1].faceUp) score += 15;
      }
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  };

  SpiderGame.prototype.evaluate = function (from, start, to) {
    var column = this.tableau[from];
    var card = column[start];
    var target = this.tableau[to];
    var score = 0;

    if (target.length) {
      var top = target[target.length - 1];
      score += top.suit === card.suit ? 45 : 10;
    } else {
      score -= 12;
    }
    if (start > 0 && !column[start - 1].faceUp) score += 60;
    if (start === 0 && target.length) score += 25;
    score += (column.length - start) * 0.5;

    // A move that assembles a full K..A run is always worth showing first.
    if (target.length + (column.length - start) >= RUN_LENGTH) {
      var merged = target.concat(column.slice(start));
      if (merged.length >= RUN_LENGTH) {
        var tail = merged.slice(merged.length - RUN_LENGTH);
        var complete = true;
        for (var k = 0; k < RUN_LENGTH; k++) {
          if (tail[k].rank !== RUN_LENGTH - k || tail[k].suit !== tail[0].suit) { complete = false; break; }
        }
        if (complete) score += 500;
      }
    }
    return score;
  };

  SpiderGame.prototype.hint = function () {
    var best = null;
    var bestScore = -Infinity;
    for (var f = 0; f < COLUMN_COUNT; f++) {
      var column = this.tableau[f];
      for (var s = 0; s < column.length; s++) {
        if (!this.movableAt(f, s)) continue;
        for (var t = 0; t < COLUMN_COUNT; t++) {
          if (!this.canDrop(f, s, t)) continue;
          var value = this.evaluate(f, s, t);
          if (value > bestScore) {
            bestScore = value;
            best = { from: f, start: s, to: t, score: value };
          }
        }
      }
    }
    return best;
  };

  /**
   * Repeat safe same-suit merges. Each pass moves the longest available run onto
   * a same-suit neighbour, which strictly increases the number of same-suit joins,
   * so the loop cannot run forever.
   */
  SpiderGame.prototype.autoMerge = function (limit) {
    var max = limit || 200;
    var applied = [];
    for (var round = 0; round < max; round++) {
      var before = this.countSameSuitAdjacency();
      var completedBefore = this.completedPiles.length;
      var pick = null;
      for (var f = 0; f < COLUMN_COUNT && !pick; f++) {
        var column = this.tableau[f];
        for (var s = 0; s < column.length; s++) {
          if (!this.movableAt(f, s)) continue;
          for (var t = 0; t < COLUMN_COUNT; t++) {
            if (!this.canDrop(f, s, t)) continue;
            var target = this.tableau[t];
            if (!target.length) continue;
            if (target[target.length - 1].suit !== column[s].suit) continue;
            pick = { from: f, start: s, to: t };
            break;
          }
          if (pick) break;
        }
      }
      if (!pick) break;
      if (!this.move(pick.from, pick.start, pick.to)) break;
      applied.push(pick);
      var joined = this.countSameSuitAdjacency() > before;
      var cleared = this.completedPiles.length > completedBefore;
      if (!joined && !cleared) break;
    }
    return applied;
  };

  SpiderGame.prototype.countSameSuitAdjacency = function () {
    var total = 0;
    for (var c = 0; c < COLUMN_COUNT; c++) {
      var column = this.tableau[c];
      for (var i = 0; i < column.length - 1; i++) {
        if (column[i].suit === column[i + 1].suit && column[i].rank === column[i + 1].rank + 1) total += 1;
      }
    }
    return total;
  };

  SpiderGame.prototype.serialize = function () {
    return {
      version: 1,
      difficulty: this.difficulty,
      tableau: this.tableau.map(cloneCards),
      stock: this.stock.map(cloneCards),
      completedPiles: this.completedPiles.map(function (pile) {
        return { suit: pile.suit, cards: cloneCards(pile.cards) };
      }),
      moves: this.moves,
      score: this.score,
      won: this.won
    };
  };

  SpiderGame.deserialize = function (data) {
    if (!data || data.version !== 1) return null;
    if (!Array.isArray(data.tableau) || data.tableau.length !== COLUMN_COUNT) return null;

    var game = Object.create(SpiderGame.prototype);
    game.rand = Math.random;
    game.difficulty = SUITS_BY_DIFFICULTY[data.difficulty] ? data.difficulty : 1;
    game.tableau = data.tableau.map(cloneCards);
    game.stock = (data.stock || []).map(cloneCards);
    game.completedPiles = (data.completedPiles || []).map(function (pile) {
      return { suit: pile.suit, cards: cloneCards(pile.cards || []) };
    });
    game.moves = data.moves | 0;
    game.score = data.score | 0;
    game.won = !!data.won;
    game.history = [];

    var maxId = 0;
    var scan = function (card) { if (card.id > maxId) maxId = card.id; };
    game.tableau.forEach(function (c) { c.forEach(scan); });
    game.stock.forEach(function (c) { c.forEach(scan); });
    game.completedPiles.forEach(function (p) { p.cards.forEach(scan); });
    nextId = Math.max(nextId, maxId);
    return game;
  };

  SpiderGame.isValidState = function (data) {
    if (!data || data.version !== 1 || !Array.isArray(data.tableau)) return false;
    var total = 0;
    data.tableau.forEach(function (column) { total += column.length; });
    (data.stock || []).forEach(function (group) { total += group.length; });
    (data.completedPiles || []).forEach(function (pile) { total += (pile.cards || []).length; });
    return total === 104;
  };

  return SpiderGame;
});
