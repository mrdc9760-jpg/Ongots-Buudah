"use strict";
// Rooms and the server-side referee. Both players' plane layouts live only here; each player is sent a personal view.
const crypto = require("crypto");
const L = require("./public/logic.js");

const WHO = { a: "player", b: "bot" };   // the shared rules code names its two sides player/bot
const OPP = { a: "b", b: "a" };
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ROOMS = 300;
const rooms = new Map();

class GameError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fail(status, message) { throw new GameError(status, message); }

function cleanName(s) {
  s = typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16) : "";
  return s || "Тоглогч";
}
function cleanPhoto(s) {
  return typeof s === "string" && s.length <= 40000 && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(s) ? s : "";
}
function normCode(c) { return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); }
function newCode() {
  for (let t = 0; t < 80; t++) {
    let c = "";
    for (let i = 0; i < 4; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return fail(503, "Өрөөний код үүсгэж чадсангүй. Дахин оролдоно уу.");
}
function newSeat(name, photo) {
  return { token: crypto.randomBytes(16).toString("hex"), name: cleanName(name), photo: cleanPhoto(photo), ready: false, placed: null };
}
function touch(room) { room.touched = Date.now(); }
function bump(room) { room.rev++; touch(room); }

function createRoom(o) {
  if (rooms.size >= MAX_ROOMS) fail(503, "Сервер завгүй байна. Түр хүлээгээд дахин оролдоно уу.");
  const rule = o.rule === 0 ? 0 : 1;
  const count = Number.isInteger(o.count) && o.count >= 1 && o.count <= 5 ? o.count : 3;
  const room = {
    code: newCode(), rule, count, phase: "lobby", gameNo: 0, rev: 1, seq: 0, touched: Date.now(),
    seats: { a: newSeat(o.name, o.photo), b: null }, sides: null, g: null, scores: null, last: null, winner: null,
    rematch: { a: false, b: false }, leftBy: null, streams: { a: new Set(), b: new Set() }
  };
  rooms.set(room.code, room);
  return { room, seat: "a" };
}
function joinRoom(code, o) {
  const room = rooms.get(normCode(code));
  if (!room || room.phase === "closed") fail(404, "Өрөө олдсонгүй. Кодоо шалгана уу.");
  if (room.seats.b) fail(409, "Өрөө дүүрсэн байна.");
  room.seats.b = newSeat(o.name, o.photo);
  room.phase = "setup";
  bump(room);
  return { room, seat: "b" };
}
function auth(code, token) {
  const room = rooms.get(normCode(code));
  if (room && typeof token === "string" && token.length === 32) {
    for (const s of ["a", "b"]) if (room.seats[s] && room.seats[s].token === token) return { room, seat: s };
  }
  return fail(404, "Өрөө олдсонгүй эсвэл хугацаа дууссан.");
}
function active(room) { if (room.phase === "closed") fail(409, "Өрөө хаагдсан байна."); }

function sameCells(a, b) {
  return a.length === b.length && a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}
// The client sends the planes it placed; the server only accepts shapes that really are a rotated copy of a plane type, inside the board, without overlap.
function place(room, seat, planes) {
  active(room);
  if (room.phase !== "setup") fail(409, "Одоо онгоц байрлуулах үе биш байна.");
  if (!Array.isArray(planes) || planes.length !== room.count) fail(400, "Онгоцны тоо таарахгүй байна.");
  const side = L.newSide(room.rule);
  for (const p of planes) {
    const ok = p && Number.isInteger(p.t) && p.t >= 0 && p.t < L.TYPES.length && Array.isArray(p.cells) &&
      p.cells.length === L.TYPES[p.t].cells.length && p.cells.every((q) => Array.isArray(q) && Number.isInteger(q[0]) && Number.isInteger(q[1]));
    if (!ok) fail(400, "Онгоцны мэдээлэл буруу байна.");
    let cells = null;
    for (let o = 0; o < 4 && !cells; o++) {
      const cand = L.cellsOf(p.cells[0][0], p.cells[0][1], o, p.t);
      if (sameCells(cand, p.cells)) cells = cand;
    }
    if (!cells || !L.canPlace(side, cells)) fail(400, "Онгоцны байрлал буруу байна.");
    L.addPlane(side, cells, p.t);
  }
  room.seats[seat].placed = side;
  room.seats[seat].ready = true;
  if (room.seats.a.ready && room.seats.b && room.seats.b.ready) startBattle(room);
  bump(room);
}
function startBattle(room) {
  room.sides = { a: room.seats.a.placed, b: room.seats.b.placed };
  L.placePickups(room.sides.a, 3);
  L.placePickups(room.sides.b, 3);
  room.g = L.newGame();
  room.g.turn = Math.random() < 0.5 ? "player" : "bot";
  room.scores = { a: L.newScore(), b: L.newScore() };
  room.last = null; room.winner = null;
  room.rematch = { a: false, b: false };
  room.gameNo++;
  room.phase = "battle";
}
function shoot(room, seat, r, c, ammo) {
  active(room);
  if (room.phase !== "battle") fail(409, "Тулалдаан явагдаагүй байна.");
  const W = WHO[seat], g = room.g;
  if (g.turn !== W) fail(409, "Одоо таны ээлж биш байна.");
  if (!Number.isInteger(r) || !Number.isInteger(c) || !L.inb(r, c)) fail(400, "Нүд буруу байна.");
  if (ammo !== "n" && ammo !== "s" && ammo !== "d") fail(400, "Сум буруу байна.");
  const free = g.free[W];
  if (!L.canUse(g.ammo[W], ammo, free)) fail(409, "Энэ сумны эрх үлдээгүй байна.");
  const target = room.sides[OPP[seat]];
  const res = L.fireAmmo(target, r, c, ammo);
  if (!res) fail(409, "Энэ нүд өмнө нь буудагдсан байна.");
  const got = L.spend(g.ammo[W], ammo, free);
  if (res.gift) L.grant(g.ammo[W], res.gift);
  const gain = L.scoreShot(room.scores[seat], res, res.t !== "miss" ? g.streak + 1 : 0);
  const won = L.alive(target) === 0;
  const flow = won ? "end" : L.afterShot(g, W, res);
  room.last = { seq: ++room.seq, by: seat, r, c, res: { t: res.t, idx: res.idx, extra: res.extra, stun: res.stun, gift: res.gift || null }, ammo, got, flow, gain };
  if (won) {
    room.phase = "over"; room.winner = seat;
    L.finishScore(room.scores[seat], true, L.alive(room.sides[seat]));
  }
  bump(room);
}
function rematch(room, seat) {
  active(room);
  if (room.phase !== "over") fail(409, "Тоглолт дуусаагүй байна.");
  room.rematch[seat] = true;
  if (room.rematch.a && room.rematch.b) {
    room.phase = "setup";
    for (const s of ["a", "b"]) { room.seats[s].ready = false; room.seats[s].placed = null; }
    room.sides = null; room.g = null; room.scores = null; room.last = null; room.winner = null;
    room.rematch = { a: false, b: false };
  }
  bump(room);
}
function leave(room, seat) {
  if (room.phase === "closed") return;
  room.leftBy = seat; room.phase = "closed";
  bump(room);
}

function connected(room, seat) { return room.streams[seat].size > 0; }
function maskPick(side) {
  return side.pick.map((row, r) => row.map((v, c) => (side.shot[r][c] === 1 ? v : null)));
}
function ownView(side) {
  return { planes: side.planes.map((p) => ({ t: p.t, cells: p.cells, hits: p.hits, dead: p.dead })), shot: side.shot, rev: side.rev, pick: maskPick(side) };
}
// the opponent's board: only destroyed planes are shown (all of them once the game is lost), live ones are blank placeholders
function enemyView(side, revealAll) {
  return {
    planes: side.planes.map((p) => (p.dead || revealAll ? { t: p.t, cells: p.cells, hits: p.hits, dead: p.dead, shown: !p.dead } : { t: 0, cells: [], hits: 0, dead: false })),
    shot: side.shot, rev: side.rev, pick: maskPick(side)
  };
}
function view(room, me) {
  const opp = OPP[me], W = WHO[me], O = WHO[opp];
  const ms = room.seats[me], os = room.seats[opp];
  const v = {
    rev: room.rev, code: room.code, seat: me, phase: room.phase, rule: room.rule, count: room.count, gameNo: room.gameNo,
    you: { name: ms.name, ready: ms.ready, wantsRematch: room.rematch[me] },
    opp: os ? { name: os.name, ready: os.ready, connected: connected(room, opp), wantsRematch: room.rematch[opp], pv: os.photo ? 1 : 0 } : null,
    closed: room.leftBy ? (room.leftBy === me ? "you" : "opp") : null
  };
  if (room.sides && (room.phase === "battle" || room.phase === "over" || (room.phase === "closed" && room.g))) {
    const g = room.g, over = room.phase === "over";
    v.turn = room.phase === "battle" ? (g.turn === W ? "you" : "opp") : null;
    v.streak = g.streak;
    v.freeYou = g.free[W]; v.freeOpp = g.free[O];
    v.skipYou = g.skip[W]; v.skipOpp = g.skip[O];
    v.ammoYou = g.ammo[W]; v.ammoOpp = g.ammo[O];
    v.score = room.scores[me]; v.oppScore = room.scores[opp].pts;
    v.own = ownView(room.sides[me]);
    v.enemy = enemyView(room.sides[opp], over && room.winner === opp);
    v.last = room.last ? Object.assign({}, room.last, { byYou: room.last.by === me }) : null;
    v.winner = room.winner ? (room.winner === me ? "you" : "opp") : null;
  }
  return v;
}

function send(res, text) { try { res.write(text); return true; } catch (e) { return false; } }
function pushView(room, seat, res) {
  return send(res, "id: " + room.rev + "\nevent: state\ndata: " + JSON.stringify(view(room, seat)) + "\n\n");
}
function broadcast(room) {
  for (const seat of ["a", "b"]) {
    if (!room.seats[seat]) continue;
    for (const res of Array.from(room.streams[seat])) if (!pushView(room, seat, res)) room.streams[seat].delete(res);
  }
}
function heartbeat() {
  for (const room of rooms.values()) for (const seat of ["a", "b"]) for (const res of Array.from(room.streams[seat])) if (!send(res, ": ping\n\n")) room.streams[seat].delete(res);
}
// rooms nobody touched for an hour (30 min while waiting for a friend, 2 min once closed) are dropped
function sweep(now) {
  for (const [code, room] of rooms) {
    const idle = (now || Date.now()) - room.touched;
    const limit = room.phase === "closed" ? 2 * 60e3 : room.phase === "lobby" ? 30 * 60e3 : 60 * 60e3;
    if (idle > limit) {
      for (const seat of ["a", "b"]) for (const res of room.streams[seat]) { try { res.end(); } catch (e) {} }
      rooms.delete(code);
    }
  }
}

module.exports = { rooms, GameError, createRoom, joinRoom, auth, place, shoot, rematch, leave, view, broadcast, pushView, heartbeat, sweep, touch, bump, connected, normCode };
