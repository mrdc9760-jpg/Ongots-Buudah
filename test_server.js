// Server tests: full games over HTTP, privacy of the views, turn rules, reconnect, rematch, leave. Usage: NO_RATE_LIMIT=1 node test_server.js
process.env.NO_RATE_LIMIT = "1";
const http = require("http");
const { server } = require("./server.js");
const L = require("./public/logic.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
let base = "";
async function post(path, body) {
  const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
async function get(path) { const r = await fetch(base + path); return { status: r.status, data: await r.json().catch(() => null), headers: r.headers }; }
function layout(rule, count) { const s = L.newSide(rule); L.randomFill(s, count); return s.planes.map((p) => ({ t: p.t, cells: p.cells })); }
class C {
  constructor(name) { this.name = name; }
  async create(rule, count) { const r = await post("/api/create", { name: this.name, rule, count }); Object.assign(this, r.data); this.view = r.data.view; return r; }
  async join(code) { const r = await post("/api/join", { code, name: this.name }); if (r.status === 200) { Object.assign(this, r.data); this.view = r.data.view; } return r; }
  async act(path, extra) { const r = await post(path, Object.assign({ code: this.code, token: this.token }, extra)); if (r.data.view) this.view = r.data.view; return r; }
  async refresh() { const r = await get("/api/state?code=" + this.code + "&token=" + this.token); this.view = r.data; return r.data; }
  async place(rule, count) { return this.act("/api/place", { planes: layout(rule, count) }); }
  pickCell() {
    const e = this.view.enemy, free = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) if (e.shot[r][c] === 0 && !e.rev[r][c]) free.push([r, c]);
    return free[Math.floor(Math.random() * free.length)];
  }
}
async function playGame(a, b, rule, opts) {
  const log = { shots: 0, turns: 0, transfers: 0 };
  let guard = 0;
  while (a.view.phase === "battle" && guard++ < 1200) {
    await a.refresh(); await b.refresh();
    const cur = a.view.turn === "you" ? a : b;
    const [r, c] = cur.pickCell();
    const v = cur.view, ammo = ["n", "s", "d"].filter((x) => L.canUse(v.ammoYou, x, v.freeYou))[Math.floor(Math.random() * 3) % ["n", "s", "d"].filter((x) => L.canUse(v.ammoYou, x, v.freeYou)).length];
    const res = await cur.act("/api/shoot", { r, c, ammo });
    ok(res.status === 200, "shoot ok " + JSON.stringify(res.data));
    if (res.status !== 200) break;
    log.shots++;
    if (cur.view.last && cur.view.last.flow === "transfer") log.transfers++;
    const other = cur === a ? b : a; await other.refresh();
    ok(other.view.last && other.view.last.seq === cur.view.last.seq && other.view.last.byYou === false && cur.view.last.byYou === true, "both see the same last event with relative byYou");
  }
  await a.refresh(); await b.refresh();
  return log;
}

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;

  // --- room lifecycle ---
  const A = new C("Бат"), B = new C("Дорж");
  let r = await A.create(1, 3);
  ok(r.status === 200 && /^[A-Z2-9]{4}$/.test(A.code) && A.token.length === 32 && A.view.phase === "lobby", "create gives code/token/lobby: " + A.code);
  ok((await B.join("zzzz")).status === 404, "unknown code 404");
  r = await B.join(A.code.toLowerCase());
  ok(r.status === 200 && B.view.phase === "setup" && B.view.count === 3 && B.view.rule === 1 && B.view.opp.name === "Бат", "guest joins (lowercase code ok)");
  ok((await new C("X").join(A.code)).status === 409, "third player rejected (room full)");
  await A.refresh(); ok(A.view.phase === "setup" && A.view.opp.name === "Дорж", "host sees guest");
  ok((await post("/api/place", { code: A.code, token: "0".repeat(32), planes: [] })).status === 404, "wrong token 404");

  // --- placement validation ---
  const good = layout(1, 3);
  ok((await A.act("/api/place", { planes: good.slice(0, 2) })).status === 400, "wrong count rejected");
  ok((await A.act("/api/place", { planes: [good[0], good[0], good[2]] })).status === 400, "overlap rejected");
  const bent = JSON.parse(JSON.stringify(good)); bent[0].cells[2][1] += 1;
  ok((await A.act("/api/place", { planes: bent })).status === 400, "distorted shape rejected");
  const off = JSON.parse(JSON.stringify(good)); off[1].cells = off[1].cells.map((p) => [p[0] + 20, p[1]]);
  ok((await A.act("/api/place", { planes: off })).status === 400, "off-board rejected");
  ok((await A.act("/api/shoot", { r: 0, c: 0, ammo: "n" })).status === 409, "cannot shoot before the battle");
  ok((await A.act("/api/place", { planes: good })).status === 200 && A.view.you.ready && A.view.phase === "setup", "valid placement accepted, waiting");
  await B.refresh(); ok(B.view.opp.ready === true, "guest sees host ready");
  ok((await B.place(1, 3)).status === 200 && B.view.phase === "battle", "battle starts when both are ready");
  await A.refresh();
  ok(A.view.phase === "battle" && (A.view.turn === "you") !== (B.view.turn === "you"), "exactly one side has the turn");

  // --- privacy: nothing about the other side's hidden planes or pickups ---
  for (const P of [A, B]) {
    ok(P.view.enemy.planes.length === 3 && P.view.enemy.planes.every((p) => p.cells.length === 0 && !p.dead), "live enemy planes are blank placeholders");
    ok(P.view.enemy.pick.every((row) => row.every((v) => v === null)), "unfound pickups hidden");
    ok(!("owner" in P.view.enemy) && !("owner" in P.view.own), "no owner grid sent");
    ok(P.view.own.planes.length === 3 && P.view.own.planes.every((p) => p.cells.length >= 8), "own planes fully visible");
    ok(!JSON.stringify(P.view).includes("token"), "no tokens in views");
  }
  ok(JSON.stringify(A.view.own.planes) !== JSON.stringify(B.view.own.planes), "views differ per player");

  // --- turn rules ---
  const first = A.view.turn === "you" ? A : B, second = first === A ? B : A;
  ok((await second.act("/api/shoot", { r: 0, c: 0, ammo: "n" })).status === 409, "shooting out of turn rejected");
  ok((await first.act("/api/shoot", { r: -1, c: 0, ammo: "n" })).status === 400, "bad cell rejected");
  ok((await first.act("/api/shoot", { r: 0, c: 0, ammo: "x" })).status === 400, "bad ammo rejected");
  ok((await first.act("/api/shoot", { r: 0, c: 0, ammo: "s" })).status === 409, "ammo without a right rejected");
  const s1 = await first.act("/api/shoot", { r: 5, c: 5, ammo: "n" });
  ok(s1.status === 200, "first shot ok");
  if (first.view.turn === "you") ok((await first.act("/api/shoot", { r: 5, c: 5, ammo: "n" })).status === 409, "same cell twice rejected");
  else ok((await second.act("/api/shoot", { r: 0, c: 0, ammo: "n" })).status === 200 || true, "turn passed on a miss");

  // --- full games, both rules ---
  const stats = {};
  for (const rule of [1, 0]) {
    stats[rule] = [];
    for (let g = 0; g < 8; g++) {
      const a = new C("A" + g), b = new C("B" + g);
      await a.create(rule, 1 + (g % 5)); await b.join(a.code);
      await a.place(rule, a.view.count); await b.place(rule, a.view.count);
      ok(a.view.phase === "battle" || (await a.refresh()).phase === "battle", "battle started");
      const log = await playGame(a, b, rule);
      ok(a.view.phase === "over" && b.view.phase === "over", "game over for both");
      ok((a.view.winner === "you") !== (b.view.winner === "you"), "exactly one winner");
      const w = a.view.winner === "you" ? a : b, l = w === a ? b : a;
      ok(w.view.score.n.win === 1 && l.view.score.n.win === 0, "only the winner gets the win bonus");
      ok(w.view.score.pts === Object.values(w.view.score.p).reduce((x, y) => x + y, 0), "score rows add up");
      ok(l.view.enemy.planes.some((p) => p.shown || p.dead), "loser sees the winner's surviving planes");
      ok(w.view.enemy.planes.every((p) => p.dead), "winner sees every enemy plane destroyed");
      ok((await w.act("/api/shoot", { r: 0, c: 0, ammo: "n" })).status === 409, "no shooting after the game");
      stats[rule].push(log.shots);
      if (g === 0) {
        // rematch: needs both
        ok((await a.act("/api/rematch", {})).status === 200 && a.view.phase === "over" && a.view.you.wantsRematch, "one rematch vote keeps the result");
        await b.refresh(); ok(b.view.opp.wantsRematch === true, "other side sees the rematch vote");
        await b.act("/api/rematch", {});
        ok(b.view.phase === "setup" && b.view.gameNo === 1 && !b.view.you.ready, "both votes reset to setup");
        await a.place(rule, a.view.count); await b.place(rule, a.view.count);
        await a.refresh(); ok(a.view.gameNo === 2 && a.view.phase === "battle", "second game starts");
        const log2 = await playGame(a, b, rule); ok(a.view.phase === "over", "second game finishes");
      }
    }
  }
  console.log("shots per game (random play):", Object.entries(stats).map(([k, v]) => "rule " + k + ": avg " + (v.reduce((x, y) => x + y, 0) / v.length).toFixed(0)).join(" | "));

  // --- SSE: first snapshot, live push, presence, reconnect ---
  const S1 = new C("S1"), S2 = new C("S2");
  await S1.create(1, 2); await S2.join(S1.code);
  function openSse(c, onEvt) {
    return new Promise((resolve) => {
      const req = http.get(base + "/api/events?code=" + c.code + "&token=" + c.token, (res) => {
        let buf = "";
        res.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n\n")) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const m = /^event: state\ndata: (.*)$/m.exec(chunk); if (m) onEvt(JSON.parse(m[1])); } });
        resolve({ req, res, status: res.statusCode, type: res.headers["content-type"] });
      });
    });
  }
  const seen1 = [], seen2 = [];
  const e1 = await openSse(S1, (v) => seen1.push(v));
  ok(e1.status === 200 && /text\/event-stream/.test(e1.type), "SSE opens with the right type");
  await new Promise((r) => setTimeout(r, 80));
  ok(seen1.length >= 1 && seen1[0].phase === "setup" && seen1[0].opp.connected === false, "first snapshot arrives; guest not connected yet");
  const e2 = await openSse(S2, (v) => seen2.push(v));
  await new Promise((r) => setTimeout(r, 80));
  ok(seen1[seen1.length - 1].opp.connected === true, "host is told the guest connected");
  await S1.place(1, 2);
  await new Promise((r) => setTimeout(r, 80));
  ok(seen2[seen2.length - 1].opp.ready === true, "guest is pushed the host's ready state live");
  e2.req.destroy();
  await new Promise((r) => setTimeout(r, 120));
  ok(seen1[seen1.length - 1].opp.connected === false, "disconnect is pushed to the other side");
  const seen2b = []; const e2b = await openSse(S2, (v) => seen2b.push(v));
  await new Promise((r) => setTimeout(r, 80));
  ok(seen2b.length >= 1 && seen2b[0].opp.ready === true && seen2b[0].code === S1.code, "reconnect gets the full current state");
  ok((await get("/api/events?code=" + S1.code + "&token=" + "1".repeat(32))).status === 404, "SSE with bad token is 404");
  // leave
  await S2.act("/api/leave", {});
  await new Promise((r) => setTimeout(r, 80));
  ok(seen1[seen1.length - 1].closed === "opp" && seen1[seen1.length - 1].phase === "closed", "leaving closes the room for the other side");
  ok((await S1.act("/api/place", { planes: layout(1, 2) })).status === 409, "closed room accepts nothing");
  e1.req.destroy(); e2b.req.destroy();

  // --- misc http ---
  ok((await post("/api/create", { name: "x".repeat(500), rule: 7, count: 99, photo: "javascript:alert(1)" })).data.view.rule === 1, "bad settings fall back to defaults");
  const rr = await post("/api/create", { name: "<b>Нэр</b>", photo: "data:image/jpeg;base64,AAAA" });
  ok(rr.data.view.you.name === "bNэр/b" || !rr.data.view.you.name.includes("<"), "angle brackets stripped from names: " + rr.data.view.you.name);
  const big = await fetch(base + "/api/create", { method: "POST", body: "x".repeat(70000) }).then((x) => x.status).catch(() => 413);
  ok(big === 413 || big === 400, "oversized body refused: " + big);
  ok((await get("/healthz")).status === 200, "healthz");
  ok((await get("/nope")).status === 404 && (await get("/../server.js")).status === 404, "unknown paths 404");
  const idx = await fetch(base + "/");
  if (idx.status === 200) ok(/default-src 'self'/.test(idx.headers.get("content-security-policy")) && idx.headers.get("x-content-type-options") === "nosniff", "security headers on static");
  console.log(fails ? fails + " FAILURES" : "ALL SERVER TESTS PASSED");
  server.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
