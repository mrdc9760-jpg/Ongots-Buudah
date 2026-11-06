/*LOGIC_START*/
var N = 10;
// [dr, dc] from the head, plane pointing up. Head first, then wings, body, tail. limit = body wounds that destroy the plane (rule 1).
var TYPES = [
  { name: "Энгийн", limit: 3, cells: [[0, 0], [1, -1], [1, 0], [1, 1], [2, 0], [3, -1], [3, 0], [3, 1]] },
  { name: "Байлдааны", limit: 4, cells: [[0, 0], [1, -2], [1, -1], [1, 0], [1, 1], [1, 2], [2, 0], [3, -1], [3, 0], [3, 1]] },
  { name: "Сонгодог", limit: 5, cells: [[0, 0], [1, -1], [1, 0], [1, 1], [2, 0], [3, -2], [3, -1], [3, 0], [3, 1], [3, 2]] }
];
function rot(v, o) {
  var r = v[0], c = v[1];
  for (var i = 0; i < o; i++) { var nr = c, nc = -r; r = nr; c = nc; }
  return [r, c];
}
function inb(r, c) { return r >= 0 && r < N && c >= 0 && c < N; }
function cellsOf(hr, hc, o, t) {
  return TYPES[t].cells.map(function (v) { var d = rot(v, o); return [hr + d[0], hc + d[1]]; });
}
function grid(v) {
  var g = [];
  for (var r = 0; r < N; r++) g.push(new Array(N).fill(v));
  return g;
}
var PLACEMENTS = [[], [], []];
var ALL_PLACEMENTS = [];
(function () {
  for (var t = 0; t < TYPES.length; t++) {
    for (var o = 0; o < 4; o++) {
      for (var r = 0; r < N; r++) {
        for (var c = 0; c < N; c++) {
          var cells = cellsOf(r, c, o, t);
          if (cells.every(function (p) { return inb(p[0], p[1]); })) {
            var pl = { t: t, cells: cells };
            PLACEMENTS[t].push(pl);
            ALL_PLACEMENTS.push(pl);
          }
        }
      }
    }
  }
})();
// rule 1: a plane falls after TYPES[t].limit body wounds or a head hit; rule 0: only a head hit destroys it
function newSide(rule) { return { rule: rule === 0 ? 0 : 1, owner: grid(-1), shot: grid(0), rev: grid(false), pick: grid(null), planes: [] }; }
function limitOf(side, p) { return side.rule === 0 ? Infinity : TYPES[p.t].limit; }
function addPlane(side, cells, t) {
  var idx = side.planes.length;
  side.planes.push({ cells: cells, t: t, hits: 0, dead: false });
  cells.forEach(function (p) { side.owner[p[0]][p[1]] = idx; });
}
function canPlace(side, cells) {
  return cells.every(function (p) { return inb(p[0], p[1]) && side.owner[p[0]][p[1]] === -1; });
}
function dropAdded(side, base) {
  while (side.planes.length > base) {
    var gone = side.planes.pop();
    gone.cells.forEach(function (p) { side.owner[p[0]][p[1]] = -1; });
  }
}
// Keeps the planes already on the side and adds random ones (random types); restarts the added ones when a pick gets stuck.
function randomFill(side, count) {
  var base = side.planes.length;
  for (var attempt = 0; attempt < 600; attempt++) {
    dropAdded(side, base);
    var tries = 0;
    while (side.planes.length < count && tries < 60) {
      tries++;
      var list = PLACEMENTS[Math.floor(Math.random() * TYPES.length)];
      var pl = list[Math.floor(Math.random() * list.length)];
      if (canPlace(side, pl.cells)) addPlane(side, pl.cells, pl.t);
    }
    if (side.planes.length >= count) return true;
  }
  dropAdded(side, base);
  return false;
}
// hidden ammo rights on cells that hold no plane
function placePickups(side, n) {
  var free = [];
  for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (side.owner[r][c] === -1 && !side.pick[r][c]) free.push([r, c]);
  var kinds = ["s", "d", Math.random() < 0.5 ? "s" : "d"];
  for (var i = 0; i < n && free.length; i++) {
    var cell = free.splice(Math.floor(Math.random() * free.length), 1)[0];
    side.pick[cell[0]][cell[1]] = kinds[i % kinds.length];
  }
}
function kill(side, p) {
  p.dead = true;
  p.cells.forEach(function (c) { side.rev[c[0]][c[1]] = true; });
}
// result types: miss | hit (wound) | head | kill (wound limit reached); null when the cell cannot be shot
function fire(side, r, c) {
  if (side.shot[r][c] !== 0 || side.rev[r][c]) return null;
  var idx = side.owner[r][c];
  if (idx < 0) { side.shot[r][c] = 1; return { t: "miss", gift: side.pick[r][c] || null }; }
  var p = side.planes[idx];
  side.shot[r][c] = 2;
  if (r === p.cells[0][0] && c === p.cells[0][1]) { kill(side, p); return { t: "head", idx: idx }; }
  p.hits++;
  if (p.hits >= limitOf(side, p)) { kill(side, p); return { t: "kill", idx: idx }; }
  return { t: "hit", idx: idx };
}
// ammo: n normal | s stun | d double wound (a hit also wounds one neighbouring body cell of the same plane, never the head)
function fireAmmo(side, r, c, ammo) {
  var res = fire(side, r, c);
  if (!res) return null;
  res.extra = [];
  res.stun = false;
  if (ammo === "d" && res.t === "hit") {
    var p = side.planes[res.idx], cand = [];
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var rr = r + d[0], cc = c + d[1];
      if (inb(rr, cc) && side.owner[rr][cc] === res.idx && side.shot[rr][cc] === 0 && !(rr === p.cells[0][0] && cc === p.cells[0][1])) cand.push([rr, cc]);
    });
    if (cand.length) {
      var q = cand[Math.floor(Math.random() * cand.length)];
      side.shot[q[0]][q[1]] = 2;
      p.hits++;
      res.extra.push(q);
      if (p.hits >= limitOf(side, p)) { kill(side, p); res.t = "kill"; }
    }
  }
  if (ammo === "s" && res.t !== "miss") res.stun = true;
  return res;
}
function alive(side) {
  return side.planes.filter(function (p) { return !p.dead; }).length;
}

// ammo stock and turn rules
function newAmmo() { return { s: 0, d: 0, n: 0 }; }
function canUse(a, ammo, free) { return ammo === "n" || !!free || (ammo === "s" ? a.s > 0 : a.d > 0); }
// pays for a shot; returns the bullet types earned from the normal-shot counters (4 -> stun, 6 -> double)
function spend(a, ammo, free) {
  var got = [];
  if (ammo === "n") {
    a.n++;
    if (a.n % 4 === 0) { a.s++; got.push("s"); }
    if (a.n % 6 === 0) { a.d++; got.push("d"); }
  } else if (!free) {
    if (ammo === "s") a.s--; else a.d--;
  }
  return got;
}
function grant(a, type) { if (type === "s") a.s++; else if (type === "d") a.d++; }
function newGame() {
  return { turn: "player", streak: 0, skip: { player: false, bot: false }, free: { player: false, bot: false }, ammo: { player: newAmmo(), bot: newAmmo() } };
}
function other(who) { return who === "player" ? "bot" : "player"; }
function endTurn(g, who, transfer) {
  var opp = other(who);
  g.streak = 0;
  if (g.skip[opp]) { g.skip[opp] = false; g.turn = who; return "skipped"; }
  g.turn = opp;
  if (transfer) g.free[opp] = true;
  return transfer ? "transfer" : "pass";
}
// call once after every shot; returns again | pass | transfer | skipped
function afterShot(g, who, res) {
  g.free[who] = false;
  if (res.stun) g.skip[other(who)] = true;
  if (res.t !== "miss") {
    g.streak++;
    if (g.streak < 3) return "again";
    return endTurn(g, who, true);
  }
  return endTurn(g, who, false);
}

// points: wound 10 (each wounded cell), head 50, kill-by-wounds +30, found ammo 15, three in a row +30, win 100 + 20 per own plane left
var PTS = { wound: 10, head: 50, kill: 30, gift: 15, streak: 30, win: 100, left: 20 };
var BREAKDOWN = [["wound", "Шарх"], ["head", "Толгойд оносон"], ["kill", "Шархаар сөнөсөн"], ["gift", "Сумны эрх олсон"], ["streak", "3 дараалж оносон"], ["win", "Хожсон"], ["left", "Үлдсэн онгоц"]];
function newScore() {
  var s = { pts: 0, n: {}, p: {} };
  BREAKDOWN.forEach(function (b) { s.n[b[0]] = 0; s.p[b[0]] = 0; });
  return s;
}
function addPts(sc, key, count) {
  if (count <= 0) return 0;
  var v = PTS[key] * count;
  sc.n[key] += count; sc.p[key] += v; sc.pts += v;
  return v;
}
// streakAfter = the player's streak counting this shot (0 after a miss); returns the points this shot earned
function scoreShot(sc, res, streakAfter) {
  var gain = 0;
  if (res.t === "miss") { if (res.gift) gain += addPts(sc, "gift", 1); return gain; }
  if (res.t === "head") gain += addPts(sc, "head", 1);
  else {
    gain += addPts(sc, "wound", 1 + (res.extra ? res.extra.length : 0));
    if (res.t === "kill") gain += addPts(sc, "kill", 1);
  }
  if (streakAfter === 3) gain += addPts(sc, "streak", 1);
  return gain;
}
function finishScore(sc, win, planesLeft) {
  if (!win) return 0;
  return addPts(sc, "win", 1) + addPts(sc, "left", planesLeft);
}
var RANKS = [[0, "Шинэ нисгэгч"], [300, "Сөнөөгч нисгэгч"], [900, "Ахлах нисгэгч"], [2000, "Эскадрилийн дарга"], [4000, "Агаарын ноён"]];
function rankOf(total) {
  var i = 0;
  for (var k = 0; k < RANKS.length; k++) if (total >= RANKS[k][0]) i = k;
  var nx = RANKS[i + 1] || null;
  return { i: i, name: RANKS[i][1], from: RANKS[i][0], next: nx ? nx[0] : null, nextName: nx ? nx[1] : null };
}

function freeCells(side) {
  var f = [];
  for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (side.shot[r][c] === 0 && !side.rev[r][c]) f.push([r, c]);
  return f;
}
// level 0: random shots that follow up next to a wound; 1: smart but sometimes careless; 2: always smart
function botPick(side, level) {
  var free = freeCells(side);
  if (!free.length) return null;
  var rand = function () { return free[Math.floor(Math.random() * free.length)]; };
  if (level >= 2) return botPickAI(side);
  if (level === 1) return Math.random() < 0.55 ? rand() : botPickAI(side);
  if (Math.random() < 0.55) {
    var near = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        if (side.shot[r][c] !== 2 || side.rev[r][c]) continue;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var rr = r + d[0], cc = c + d[1];
          if (inb(rr, cc) && side.shot[rr][cc] === 0 && !side.rev[rr][cc]) near.push([rr, cc]);
        });
      }
    }
    if (near.length) return near[Math.floor(Math.random() * near.length)];
  }
  return rand();
}
// The bot only reads shot/rev (what the shooter can see) and the public rule, never the owner grid. Types are unknown, so every shape counts.
function botPickAI(side) {
  var score = grid(0);
  ALL_PLACEMENTS.forEach(function (pl) {
    var cells = pl.cells, h = cells[0];
    if (side.shot[h[0]][h[1]] !== 0) return;
    var k = 0;
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i][0], c = cells[i][1];
      if (side.shot[r][c] === 1 || side.rev[r][c]) return;
      if (side.shot[r][c] === 2) k++;
    }
    if (side.rule !== 0 && k >= TYPES[pl.t].limit) return;
    var w = k === 0 ? 1 : Math.pow(8, Math.min(k, 5));
    for (var j = 0; j < cells.length; j++) {
      var rr = cells[j][0], cc = cells[j][1];
      if (side.shot[rr][cc] === 0) score[rr][cc] += w;
    }
  });
  var best = -1, pick = null, free = [];
  for (var r2 = 0; r2 < N; r2++) {
    for (var c2 = 0; c2 < N; c2++) {
      if (side.shot[r2][c2] !== 0 || side.rev[r2][c2]) continue;
      free.push([r2, c2]);
      var s = score[r2][c2];
      if (s > 0) {
        s += Math.random() * 0.5;
        if (s > best) { best = s; pick = [r2, c2]; }
      }
    }
  }
  if (!pick && free.length) pick = free[Math.floor(Math.random() * free.length)];
  return pick;
}
// the bot spends special bullets while it is chasing a wounded plane
function botAmmo(a, free, side) {
  var hunting = false;
  for (var r = 0; r < N && !hunting; r++) for (var c = 0; c < N; c++) if (side.shot[r][c] === 2 && !side.rev[r][c]) { hunting = true; break; }
  var canD = free || a.d > 0, canS = free || a.s > 0;
  if (hunting) { if (canD) return "d"; if (canS) return "s"; return "n"; }
  if (canS && Math.random() < 0.35) return "s";
  return "n";
}
/*LOGIC_END*/

if (typeof module !== "undefined" && module.exports) {
  module.exports = { N: N, TYPES: TYPES, inb: inb, cellsOf: cellsOf, newSide: newSide, limitOf: limitOf, addPlane: addPlane, canPlace: canPlace,
    placePickups: placePickups, fireAmmo: fireAmmo, alive: alive, canUse: canUse, spend: spend, grant: grant, newGame: newGame, afterShot: afterShot,
    newScore: newScore, scoreShot: scoreShot, finishScore: finishScore, randomFill: randomFill, BREAKDOWN: BREAKDOWN, PTS: PTS, rankOf: rankOf };
}
