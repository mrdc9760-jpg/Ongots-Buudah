"use strict";
// Plane battle: friend rooms. No packages needed: only Node's built-in modules.
const http = require("http");
const fs = require("fs");
const path = require("path");
const G = require("./game.js");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, "public");
const FILES = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/logic.js": ["logic.js", "text/javascript; charset=utf-8"],
  "/draw.js": ["draw.js", "text/javascript; charset=utf-8"]
};
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": CSP };

// tiny per-address limits so nobody can flood the room list or guess codes
const hits = new Map();
function limited(ip, key, max, windowMs) {
  if (process.env.NO_RATE_LIMIT === "1") return false;
  const now = Date.now(), k = key + "|" + ip;
  let e = hits.get(k);
  if (!e || now - e.t > windowMs) { e = { t: now, n: 0 }; hits.set(k, e); }
  return ++e.n > max;
}
function clientIp(req) {
  const f = req.headers["x-forwarded-for"];
  return (typeof f === "string" && f.split(",")[0].trim()) || req.socket.remoteAddress || "?";
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, HEADERS));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new G.GameError(413, "Хэт том хүсэлт.")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(new G.GameError(400, "Хүсэлт буруу байна.")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  const f = FILES[pathname];
  if (!f) { res.writeHead(404, HEADERS); res.end("Not found"); return; }
  fs.readFile(path.join(PUBLIC, f[0]), (err, data) => {
    if (err) { res.writeHead(500, HEADERS); res.end("Error"); return; }
    res.writeHead(200, Object.assign({ "Content-Type": f[1], "Cache-Control": "no-cache" }, HEADERS));
    res.end(data);
  });
}

function sse(req, res, q) {
  const { room, seat } = G.auth(q.get("code"), q.get("token"));
  res.writeHead(200, Object.assign({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" }, HEADERS));
  res.write("retry: 2000\n\n");
  room.streams[seat].add(res);
  G.touch(room);
  G.pushView(room, seat, res);
  G.broadcast(room);                       // the opponent sees you are connected
  req.on("close", () => {
    room.streams[seat].delete(res);
    if (G.rooms.get(room.code) === room) G.broadcast(room);
  });
}

async function api(req, res, pathname, q) {
  const ip = clientIp(req);
  if (req.method === "GET") {
    if (pathname === "/api/events") return sse(req, res, q);
    if (pathname === "/api/state") { const a = G.auth(q.get("code"), q.get("token")); G.touch(a.room); return json(res, 200, G.view(a.room, a.seat)); }
    if (pathname === "/api/photo") {
      const a = G.auth(q.get("code"), q.get("token"));
      const o = a.room.seats[a.seat === "a" ? "b" : "a"];
      return json(res, 200, { photo: o ? o.photo : "" });
    }
    return json(res, 404, { error: "Олдсонгүй." });
  }
  if (req.method !== "POST") return json(res, 405, { error: "Боломжгүй хүсэлт." });
  const b = await readBody(req);
  switch (pathname) {
    case "/api/create": {
      if (limited(ip, "create", 20, 10 * 60e3)) throw new G.GameError(429, "Хэт олон өрөө үүсгэлээ. Түр хүлээнэ үү.");
      const { room, seat } = G.createRoom(b);
      return json(res, 200, { code: room.code, token: room.seats[seat].token, seat, view: G.view(room, seat) });
    }
    case "/api/join": {
      if (limited(ip, "join", 40, 10 * 60e3)) throw new G.GameError(429, "Хэт олон оролдлоо. Түр хүлээнэ үү.");
      const { room, seat } = G.joinRoom(b.code, b);
      G.broadcast(room);
      return json(res, 200, { code: room.code, token: room.seats[seat].token, seat, view: G.view(room, seat) });
    }
  }
  const { room, seat } = G.auth(b.code, b.token);
  switch (pathname) {
    case "/api/ping": G.touch(room); return json(res, 200, { ok: true });
    case "/api/place": G.place(room, seat, b.planes); break;
    case "/api/shoot": G.shoot(room, seat, b.r, b.c, b.ammo); break;
    case "/api/rematch": G.rematch(room, seat); break;
    case "/api/leave": G.leave(room, seat); break;
    default: return json(res, 404, { error: "Олдсонгүй." });
  }
  G.broadcast(room);
  return json(res, 200, { ok: true, view: G.view(room, seat) });
}

const server = http.createServer((req, res) => {
  let u;
  try { u = new URL(req.url, "http://x"); } catch (e) { res.writeHead(400); res.end(); return; }
  if (u.pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); return; }
  if (u.pathname === "/favicon.ico") { res.writeHead(204); res.end(); return; }
  if (u.pathname.startsWith("/api/")) {
    api(req, res, u.pathname, u.searchParams).catch((e) => {
      if (res.headersSent) { try { res.end(); } catch (x) {} return; }
      if (e instanceof G.GameError) return json(res, e.status, { error: e.message });
      console.error("error", e);
      json(res, 500, { error: "Серверийн алдаа." });
    });
    return;
  }
  serveStatic(req, res, u.pathname);
});

setInterval(G.heartbeat, 15000).unref();
setInterval(() => {
  G.sweep();
  const now = Date.now();
  for (const [k, e] of hits) if (now - e.t > 10 * 60e3) hits.delete(k);
}, 60000).unref();

if (require.main === module) {
  server.listen(PORT, "0.0.0.0", () => console.log("Онгоцны байлдаан: http://localhost:" + PORT));
  process.on("SIGTERM", () => { console.log("SIGTERM"); server.close(); process.exit(0); });
}
module.exports = { server };
