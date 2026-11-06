/*DRAW_START*/
// Deterministic "hand" for the pen strokes: the same cell always wobbles the same way, so repaints never jitter.
function hs(a, b, c) { var x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); }
function jt(a, b, c, amp) { return (hs(a, b, c) - 0.5) * 2 * amp; }
function f1(v) { return String(Math.round(v * 100) / 100); }
// one pen stroke: slight overshoot at both ends and a bowed middle (board units: 0..100)
function penLine(x1, y1, x2, y2, s, amp) {
  var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / len, uy = dy / len;
  var o1 = hs(s, 1, 2) * amp * 1.6, o2 = hs(s, 3, 4) * amp * 1.6;
  var ax = x1 - ux * o1 + jt(s, 5, 6, amp * 0.5), ay = y1 - uy * o1 + jt(s, 7, 8, amp * 0.5);
  var bx = x2 + ux * o2 + jt(s, 9, 10, amp * 0.5), by = y2 + uy * o2 + jt(s, 11, 12, amp * 0.5);
  var bow = jt(s, 13, 14, amp);
  var mx = (x1 + x2) / 2 - uy * bow, my = (y1 + y2) / 2 + ux * bow;
  return "M" + f1(ax) + " " + f1(ay) + "Q" + f1(mx) + " " + f1(my) + " " + f1(bx) + " " + f1(by);
}
function ring(cx, cy, r, s) {
  var n = 10, pts = [], i;
  for (i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2 + jt(s, i, 1, 0.12), rr = r * (1 + jt(s, i, 2, 0.08));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  var mid = function (p, q) { return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
  var st = mid(pts[n - 1], pts[0]), d = "M" + f1(st[0]) + " " + f1(st[1]);
  for (i = 0; i < n; i++) {
    var e = mid(pts[i], pts[(i + 1) % n]);
    d += "Q" + f1(pts[i][0]) + " " + f1(pts[i][1]) + " " + f1(e[0]) + " " + f1(e[1]);
  }
  return d + "Z";
}
// outline of a plane: corner points [x, y] (cell units) of the clockwise boundary loop, collinear points removed
function loopCorners(cells) {
  var set = {}, edges = {}, first = null;
  cells.forEach(function (p) { set[p[0] + "," + p[1]] = 1; });
  function add(x1, y1, x2, y2) {
    var e = { a: [x1, y1], b: [x2, y2] };
    edges[x1 + "," + y1] = e;
    if (!first) first = e;
  }
  cells.forEach(function (p) {
    var r = p[0], c = p[1];
    if (!set[(r - 1) + "," + c]) add(c, r, c + 1, r);
    if (!set[r + "," + (c + 1)]) add(c + 1, r, c + 1, r + 1);
    if (!set[(r + 1) + "," + c]) add(c + 1, r + 1, c, r + 1);
    if (!set[r + "," + (c - 1)]) add(c, r + 1, c, r);
  });
  var pts = [], e = first, guard = 0;
  do { pts.push(e.a); e = edges[e.b[0] + "," + e.b[1]]; guard++; } while (e && e !== first && guard < 300);
  var out = [];
  for (var i = 0; i < pts.length; i++) {
    var pr = pts[(i + pts.length - 1) % pts.length], cu = pts[i], nx = pts[(i + 1) % pts.length];
    if ((cu[0] - pr[0]) * (nx[1] - cu[1]) - (cu[1] - pr[1]) * (nx[0] - cu[0]) !== 0) out.push(cu);
  }
  return out;
}
// pencil hatching: diagonal strokes on global lines x+y=const, so they run on across neighbouring cells
function hatch(cells, seed) {
  var d = "", step = 3.4;
  cells.forEach(function (cell, ci) {
    var x0 = cell[1] * 10, y0 = cell[0] * 10, s0 = x0 + y0;
    var k0 = Math.ceil((s0 + 1) / step), k1 = Math.floor((s0 + 19) / step);
    for (var k = k0; k <= k1; k++) {
      var K = k * step - s0, ax, ay, bx, by;
      if (K <= 10) { ax = 0; ay = K; bx = K; by = 0; } else { ax = K - 10; ay = 10; bx = 10; by = K - 10; }
      if (Math.abs(bx - ax) < 1.2) continue;
      d += "M" + f1(x0 + ax + jt(seed, ci, k, 0.12)) + " " + f1(y0 + ay + jt(seed + 1, ci, k, 0.12)) +
           "L" + f1(x0 + bx + jt(seed + 2, ci, k, 0.12)) + " " + f1(y0 + by + jt(seed + 3, ci, k, 0.12));
    }
  });
  return d;
}
function planeSvg(p, idx, fresh) {
  var loop = loopCorners(p.cells), d = "", i;
  for (i = 0; i < loop.length; i++) {
    var a = loop[i], b = loop[(i + 1) % loop.length];
    d += penLine(a[0] * 10, a[1] * 10, b[0] * 10, b[1] * 10, idx * 41 + i * 7 + 3, 0.5);
  }
  var hr = p.cells[0], hx = hr[1] * 10, hy = hr[0] * 10;
  var out = '<g class="pl' + (p.dead ? " dead" : "") + '">';
  out += '<rect class="hf" x="' + hx + '" y="' + hy + '" width="10" height="10"/>';
  out += '<path class="hatch" d="' + hatch(p.cells, idx * 3 + 1) + '"/>';
  out += '<path class="edge" d="' + d + '"/>';
  out += '<path class="ring" d="' + ring(hx + 5, hy + 5, 2.9, idx * 5 + 1) + '"/>';
  out += '<circle class="hd" cx="' + (hx + 5) + '" cy="' + (hy + 5) + '" r="0.9"/>';
  if (p.dead) {
    var minr = 99, maxr = -1, minc = 99, maxc = -1, sx = 0, sy = 0;
    p.cells.forEach(function (q) {
      if (q[0] < minr) minr = q[0]; if (q[0] > maxr) maxr = q[0];
      if (q[1] < minc) minc = q[1]; if (q[1] > maxc) maxc = q[1];
      sx += q[1]; sy += q[0];
    });
    var cx = Math.max(11, Math.min(89, (sx / p.cells.length) * 10 + 5)), cy = (sy / p.cells.length) * 10 + 5;
    out += '<path class="slash" d="' + penLine(minc * 10 + 1.5, minr * 10 + 1.5, (maxc + 1) * 10 - 1.5, (maxr + 1) * 10 - 1.5, idx * 9 + 4, 0.7) + '"/>';
    out += '<g class="stampg' + (fresh ? " fresh" : "") + '"><g transform="rotate(-13 ' + f1(cx) + " " + f1(cy) + ')">' +
      '<rect class="stampbox" x="' + f1(cx - 10) + '" y="' + f1(cy - 3.8) + '" width="20" height="7.6" rx="0.9"/>' +
      '<text class="stamp" x="' + f1(cx) + '" y="' + f1(cy + 1.7) + '" text-anchor="middle">Сөнөсөн</text></g></g>';
  }
  return out + "</g>";
}
// red hand-drawn cross = wound
function crossSvg(r, c, fresh) {
  var x = c * 10, y = r * 10, s = r * 31 + c * 17 + 5;
  var d = penLine(x + 2.4, y + 2.3, x + 7.6, y + 7.7, s, 0.55) + penLine(x + 7.7, y + 2.4, x + 2.3, y + 7.6, s + 3, 0.55);
  return '<path class="x' + (fresh ? " fresh" : "") + '" pathLength="1" d="' + d + '"/>';
}
// ink dot = miss; green diamond = found ammo right
function missSvg(r, c, gift) {
  var cx = c * 10 + 5 + jt(r, c, 1, 0.5), cy = r * 10 + 5 + jt(r, c, 2, 0.5), s = r * 13 + c * 7;
  if (!gift) return '<circle class="mk" cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(1.3 + hs(r, c, 3) * 0.4) + '"/>';
  var k = 3.2;
  var d = penLine(cx, cy - k, cx + k, cy, s, 0.3) + penLine(cx + k, cy, cx, cy + k, s + 1, 0.3) + penLine(cx, cy + k, cx - k, cy, s + 2, 0.3) + penLine(cx - k, cy, cx, cy - k, s + 3, 0.3);
  return '<path class="gem" d="' + d + '"/><circle class="gemd" cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="1"/>';
}
// everything that changes during play: planes (own board: all; enemy board: destroyed ones, or all of them once p.shown is set after a loss), then the marks on top
function renderDyn(side, own, fresh, freshDead) {
  var out = "";
  side.planes.forEach(function (p, idx) { if (own || p.dead || p.shown) out += planeSvg(p, idx, !!(freshDead && freshDead[idx])); });
  for (var r = 0; r < N; r++) {
    for (var c = 0; c < N; c++) {
      var s = side.shot[r][c];
      if (s === 1) out += missSvg(r, c, !!side.pick[r][c]);
      else if (s === 2) out += crossSvg(r, c, !!(fresh && fresh[r + "," + c]));
    }
  }
  return out;
}
// the ruled square grid and the frame, drawn once per board
function gridSvg(seed) {
  var inner = "", box = "", i;
  for (i = 1; i < N; i++) inner += penLine(i * 10, 0, i * 10, 100, seed * 7 + i, 0.3) + penLine(0, i * 10, 100, i * 10, seed * 7 + 30 + i, 0.3);
  box += penLine(0, 0, 100, 0, seed + 1, 0.6) + penLine(100, 0, 100, 100, seed + 2, 0.6) + penLine(100, 100, 0, 100, seed + 3, 0.6) + penLine(0, 100, 0, 0, seed + 4, 0.6);
  box += penLine(0, 0, 100, 0, seed + 11, 0.45) + penLine(100, 0, 100, 100, seed + 12, 0.45) + penLine(100, 100, 0, 100, seed + 13, 0.45) + penLine(0, 100, 0, 0, seed + 14, 0.45);
  return '<path class="gl" d="' + inner + '"/><path class="gb" d="' + box + '"/>';
}
/*DRAW_END*/
