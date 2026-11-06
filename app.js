
(function () {
  "use strict";
  var KEY = "ongoc-baylaldaan-v1";
  var DIRS = ["дээш", "баруун", "доош", "зүүн"];
  var LEVELS = ["Хөнгөн", "Хэвийн", "Хүнд"];
  var RULES = ["Шархын тоогоор", "Зөвхөн толгойд"];
  var AMMO_NAME = { n: "Энгийн", s: "Өнжүүлэх", d: "Давхар шарх" };
  var AMMO_BY = { n: "энгийн сумаар", s: "өнжүүлэх сумаар", d: "давхар шархын сумаар" };
  var GIFT_NAME = { s: "өнжүүлэх", d: "давхар шархын" };
  var SVGNS = "http://www.w3.org/2000/svg";
  function $(id) { return document.getElementById(id); }

  var reduce = false;
  try { reduce = matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) {}

  // saved on this device only: record, setup choices, player name/photo, points
  var rec = { wins: 0, losses: 0, count: 3, level: 0, type: 1, rule: 1, name: "", photo: "", total: 0, best: 0 };
  try {
    var o = JSON.parse(localStorage.getItem(KEY));
    if (o && typeof o === "object") {
      rec.wins = Math.max(0, o.wins | 0);
      rec.losses = Math.max(0, o.losses | 0);
      if (o.count >= 1 && o.count <= 5) rec.count = o.count | 0;
      if (o.level >= 0 && o.level <= 2) rec.level = o.level | 0;
      if (o.type >= 0 && o.type <= 2) rec.type = o.type | 0;
      if (o.rule === 0 || o.rule === 1) rec.rule = o.rule;
      if (typeof o.name === "string") rec.name = o.name.slice(0, 16);
      if (typeof o.photo === "string" && o.photo.length < 90000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(o.photo)) rec.photo = o.photo;
      rec.total = Math.max(0, o.total | 0);
      rec.best = Math.max(0, o.best | 0);
    }
  } catch (e) {}
  function saveRec() { try { localStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {} }

  var phase = "setup";           // setup | battle | over
  var placed = [];               // {cells, t} of the planes placed so far
  var ghost = null;              // {r, c} head of the plane being positioned
  var ori = 0;
  var me = null, bot = null, g = null, sc = null, sel = "n", busy = false, shots = 0;
  var botTimer = 0, quitArmed = false, quitTimer = 0, rankBefore = 0;
  var soundOn = false, audio = null;
  var SKEY = "ongoc-online-session";
  var mode = "bot";             // bot | friend
  var net = null;               // set while we are in a friend room: {code, token, seat, view, ...}
  function cnt() { return net && net.view ? net.view.count : rec.count; }
  function rl() { return net && net.view ? net.view.rule : rec.rule; }
  function oppLabel() { return net ? "Нөгөө тоглогч" : "Бот"; }

  // ---------- sound, vibration ----------
  function beep(freq, dur, type, vol, slideTo) {
    if (!soundOn) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      var osc = audio.createOscillator(), gain = audio.createGain(), t0 = audio.currentTime;
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      gain.gain.setValueAtTime(vol || 0.08, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain); gain.connect(audio.destination);
      osc.start(t0); osc.stop(t0 + dur);
    } catch (e) {}
  }
  function buzz(ms) { try { if (soundOn && navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

  // ---------- effects ----------
  function addFx(parent, cls, ms, vars) {
    if (reduce || !parent) return;
    var s = document.createElement("span");
    s.className = "fx " + cls;
    if (vars) for (var k in vars) s.style.setProperty(k, vars[k]);
    parent.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, ms);
  }
  function fxMiss(cell) { addFx(cell, "ripple", 700); }
  function fxGift(cell) { addFx(cell, "gift-pop", 850); }
  function fxHit(cell, big) {
    addFx(cell, big ? "boom big" : "boom", big ? 700 : 550);
    for (var i = 0; i < 8; i++) addFx(cell, "spark", 600, { "--a": (i * 45) + "deg" });
  }
  // slot: "" (upper) | second | third
  function fxFloat(els, text, tone, slot) {
    if (reduce || !els.box) return;
    var s = document.createElement("span");
    s.className = "fx float" + (tone ? " " + tone : "") + (slot ? " " + slot : "");
    s.textContent = text;
    els.box.appendChild(s);
    setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 1250);
  }
  function timedClass(el, cls, ms) {
    if (reduce || !el) return;
    el.classList.remove(cls);
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  function fxKill(els, side, idx) {
    if (reduce) return;
    var cells = side.planes[idx].cells;
    cells.forEach(function (p) { timedClass(els[p[0] * N + p[1]], "dying", 1000); });
    for (var i = 0; i < 5; i++) {
      var p = cells[Math.floor(Math.random() * cells.length)];
      addFx(els[p[0] * N + p[1]], "smoke", 1250);
    }
    timedClass(els.root, "shake", 460);
  }
  function tracer(els, r, c, fromBottom, ammo, cb) {
    var done = false;
    function fin() { if (!done) { done = true; cb(); } }
    if (reduce) { fin(); return; }
    try {
      var box = els.box, cell = els[r * N + c];
      if (!box || !cell || typeof box.animate !== "function") { fin(); return; }
      var t = document.createElement("span");
      t.className = "fx tracer " + ammo;
      t.style.left = (cell.offsetLeft + cell.offsetWidth / 2) + "px";
      var y1 = cell.offsetTop + cell.offsetHeight / 2 - 7;
      var y0 = fromBottom ? box.clientHeight + 12 : -22;
      box.appendChild(t);
      var an = t.animate([{ transform: "translateY(" + y0 + "px)" }, { transform: "translateY(" + y1 + "px)" }], { duration: 260, easing: "ease-in", fill: "forwards" });
      an.onfinish = function () { if (t.parentNode) t.parentNode.removeChild(t); fin(); };
      setTimeout(fin, 450);
    } catch (e) { fin(); }
  }
  // every shot gets its own effect: ripple (miss), gem pop (found ammo), boom + sparks + pen cross (wound), smoke + shake + stamp (destroyed), frost (stun)
  function impact(els, side, r, c, res, gain) {
    var cell = els[r * N + c], label, tone = "", plus = gain > 0 ? " +" + gain : "";
    if (res.t === "miss") {
      fxMiss(cell);
      beep(220, 0.18, "sine", 0.07, 110);
      label = "Алдлаа";
      if (res.gift) {
        fxGift(cell); label = "Сумны эрх!" + plus; tone = "good";
        setTimeout(function () { beep(660, 0.1, "triangle", 0.07); }, 140);
        setTimeout(function () { beep(880, 0.14, "triangle", 0.07); }, 260);
      }
      fxFloat(els, label, tone, "");
      return;
    }
    var big = res.t === "head" || res.t === "kill";
    fxHit(cell, big);
    res.extra.forEach(function (q) { fxHit(els[q[0] * N + q[1]], false); });
    beep(300, 0.22, "sawtooth", 0.08, 90);
    buzz(big ? 90 : 40);
    label = (res.t === "head" ? "Толгой!" : res.extra.length ? "Давхар шарх!" : "Шарх!") + plus;
    fxFloat(els, label, "hot", "");
    var slot = "second";
    if (big) {
      fxKill(els, side, res.idx);
      beep(140, 0.5, "sawtooth", 0.1, 40);
      setTimeout(function () { fxFloat(els, "Сөнөсөн!", "hot", "second"); }, 260);
      slot = "third";
    }
    if (res.stun) {
      timedClass(els.root, "frost", 950);
      setTimeout(function () { fxFloat(els, "Өнжүүлэв", "good", slot); beep(900, 0.25, "triangle", 0.07, 300); }, big ? 620 : 420);
    }
  }

  // ---------- boards ----------
  var boardSeed = 0;
  function div(cls) { var d = document.createElement("div"); if (cls) d.className = cls; return d; }
  function inkLayer(markup) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("class", "ink");
    s.setAttribute("viewBox", "0 0 100 100");
    s.setAttribute("preserveAspectRatio", "none");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = markup;
    return s;
  }
  // the cells are invisible tap buttons; the ruled grid and everything drawn in pen sit in two SVG layers under them
  function buildBoard(root, interactive, onTap, small) {
    root.textContent = "";
    root.className = "board" + (small ? " small" : "");
    var cols = div("cols"), rows = div("rows"), cells = div("cells"), els = [];
    for (var i = 1; i <= N; i++) {
      var a = document.createElement("span"); a.className = "lab"; a.textContent = i; cols.appendChild(a);
      var b = document.createElement("span"); b.className = "lab"; b.textContent = i; rows.appendChild(b);
    }
    cells.appendChild(inkLayer(gridSvg(++boardSeed * 17)));
    els.dyn = inkLayer("");
    cells.appendChild(els.dyn);
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var el;
        if (interactive) {
          el = document.createElement("button");
          el.type = "button";
          el.setAttribute("aria-label", "Багана " + (c + 1) + ", мөр " + (r + 1));
          (function (rr, cc) { el.addEventListener("click", function () { onTap(rr, cc); }); })(r, c);
        } else {
          el = document.createElement("div");
        }
        el.className = "cell";
        cells.appendChild(el);
        els.push(el);
      }
    }
    root.appendChild(div("corner")); root.appendChild(cols); root.appendChild(rows); root.appendChild(cells);
    els.root = root; els.box = cells; els.fresh = null; els.freshDead = null;
    return els;
  }

  function paintSide(els, side, own, canShoot) {
    els.dyn.innerHTML = renderDyn(side, own, els.fresh, els.freshDead);
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var el = els[r * N + c];
        el.classList.remove("gok"); el.classList.remove("gbad");
        if (el.tagName === "BUTTON") el.disabled = !canShoot || side.shot[r][c] !== 0 || side.rev[r][c];
      }
    }
  }

  var setupEls = buildBoard($("setupBoard"), true, onSetupTap, false);
  var enemyEls = buildBoard($("enemyBoard"), true, onEnemyTap, false);
  var ownEls = buildBoard($("ownBoard"), false, null, true);

  // mini preview of the chosen plane and its flying direction
  var miniCells = [];
  (function () {
    var m = $("mini");
    for (var i = 0; i < 49; i++) { var d = document.createElement("i"); m.appendChild(d); miniCells.push(d); }
  })();
  function limText() { return rl() === 1 ? "Устах: " + TYPES[rec.type].limit + " шарх эсвэл толгой" : "Устах: зөвхөн толгойд онохоор"; }
  function paintMini() {
    miniCells.forEach(function (d) { d.className = ""; });
    cellsOf(3, 3, ori, rec.type).forEach(function (p, i) { miniCells[p[0] * 7 + p[1]].className = i === 0 ? "hd" : "on"; });
    $("dirText").textContent = DIRS[ori];
    $("typeText").textContent = TYPES[rec.type].name;
    $("cellText").textContent = TYPES[rec.type].cells.length;
    $("limText").textContent = limText();
  }
  function killRuleText() {
    if (rl() === 0) return "Онгоц зөвхөн толгойд оносон үед сөнөнө. Бусад хэсэгт оносон нь «Шарх» болж тэмдэглэгдэнэ, гэвч онгоц устахгүй.";
    return "Толгойд оносон онгоц шууд сөнөнө. Бусад хэсэгт шарх авбал: " + TYPES.map(function (t) { return t.name + " " + t.limit; }).join(", ") + " шархаар сөнөнө.";
  }

  function makeChips(boxId, labels, getVal, setVal) {
    var box = $(boxId), els = [];
    labels.forEach(function (name, i) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.setAttribute("role", "radio"); b.textContent = name;
      b.addEventListener("click", function () { setVal(i); });
      box.appendChild(b); els.push(b);
    });
    return function paint() {
      els.forEach(function (b, i) { b.setAttribute("aria-checked", i === getVal() ? "true" : "false"); });
    };
  }
  var paintCount = makeChips("chips", [1, 2, 3, 4, 5], function () { return rec.count - 1; }, function (i) {
    rec.count = i + 1;
    if (placed.length > rec.count) placed.length = rec.count;
    ghost = null; saveRec(); refreshSetup("");
  });
  var paintLevels = makeChips("levels", LEVELS, function () { return rec.level; }, function (i) { rec.level = i; saveRec(); paintLevels(); });
  var paintRuleChips = makeChips("rules2", RULES, function () { return rec.rule === 1 ? 0 : 1; }, function (i) { rec.rule = i === 0 ? 1 : 0; saveRec(); refreshSetup(""); });
  var paintTypes = makeChips("types", TYPES.map(function (t) { return t.name; }), function () { return rec.type; }, function (i) { rec.type = i; saveRec(); refreshSetup(""); });

  function sideFromPlaced() {
    var s = newSide(rl());
    placed.forEach(function (pl) { addPlane(s, pl.cells, pl.t); });
    return s;
  }
  function setHint(t) { $("hint").textContent = t; }
  function paintRecord() { $("record").textContent = "Хожил " + rec.wins + " · Хожигдол " + rec.losses; }

  // ---------- player card: name, photo, points, rank ----------
  function letterOf() { return (rec.name.trim().charAt(0) || "Т").toUpperCase(); }
  function showAvatar(img, letterEl) {
    var has = !!rec.photo;
    img.hidden = !has; letterEl.hidden = has;
    if (has) img.src = rec.photo;
    letterEl.textContent = letterOf();
  }
  function paintProfile() {
    showAvatar($("avatarImg"), $("avatarLetter"));
    $("photoDel").hidden = !rec.photo;
    var rk = rankOf(rec.total);
    $("rankName").textContent = rk.name;
    $("totalPts").textContent = rec.total + " оноо";
    var pct = rk.next ? Math.round(((rec.total - rk.from) / (rk.next - rk.from)) * 100) : 100;
    $("rankBar").style.width = Math.max(0, Math.min(100, pct)) + "%";
    $("rankSub").textContent = (rk.next ? "Дараагийн зэрэг «" + rk.nextName + "»: " + (rk.next - rec.total) + " оноо дутуу." : "Хамгийн дээд зэрэгт хүрлээ.") +
      (rec.best ? " Шилдэг тоглолт: " + rec.best + " оноо." : "");
  }
  function pfNote(t) { $("pfNote").textContent = t; }
  $("nameInput").value = rec.name;
  $("nameInput").addEventListener("input", function () {
    rec.name = this.value.slice(0, 16); saveRec(); paintProfile();
  });
  $("photoDel").addEventListener("click", function () {
    rec.photo = ""; saveRec(); paintProfile(); pfNote("Зургийг устгалаа.");
  });
  // the picture is cropped to a square and shrunk to 128px in the page, then kept only in this device's storage
  $("photoFile").addEventListener("change", function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (!/^image\//.test(f.type)) { pfNote("Зөвхөн зураг сонгоно уу."); return; }
    if (f.size > 25 * 1024 * 1024) { pfNote("Зураг хэт том байна. Жижиг зураг сонгоно уу."); return; }
    pfNote("Зургийг боловсруулж байна…");
    var fr = new FileReader();
    fr.onerror = function () { pfNote("Зургийг уншиж чадсангүй."); };
    fr.onload = function () {
      var img = new Image();
      img.onerror = function () { pfNote("Энэ зургийг нээж чадсангүй. Өөр зураг сонгоно уу."); };
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, m = Math.min(w, h);
          var cv = document.createElement("canvas");
          cv.width = 128; cv.height = 128;
          var cx = cv.getContext("2d");
          cx.fillStyle = "#ffffff"; cx.fillRect(0, 0, 128, 128);
          cx.drawImage(img, (w - m) / 2, (h - m) / 2, m, m, 0, 0, 128, 128);
          var url = cv.toDataURL("image/jpeg", 0.82);
          if (!/^data:image\/jpeg;base64,/.test(url) || url.length > 90000) throw new Error("bad image");
          rec.photo = url; saveRec(); paintProfile();
          pfNote("Зураг хадгалагдлаа. Зөвхөн энэ төхөөрөмжид байна.");
        } catch (e) { pfNote("Зургийг боловсруулж чадсангүй."); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(f);
    this.value = "";
  });

  // ---------- setup screen ----------
  function paintSetup() {
    var s = sideFromPlaced();
    paintSide(setupEls, s, true, true);
    var valid = false;
    if (ghost) {
      var cells = cellsOf(ghost.r, ghost.c, ori, rec.type);
      valid = canPlace(s, cells);
      cells.forEach(function (p) {
        if (inb(p[0], p[1])) setupEls[p[0] * N + p[1]].classList.add(valid ? "gok" : "gbad");
      });
    }
    paintCount(); paintLevels(); paintRuleChips(); paintTypes();
    $("killRule").textContent = killRuleText();
    var full = placed.length >= cnt(), lk = locked();
    $("placeBtn").disabled = !ghost || !valid || full || lk;
    $("undoBtn").disabled = placed.length === 0 || lk;
    $("autoBtn").disabled = full || lk;
    $("rotBtn").disabled = lk;
    var st = $("startBtn");
    if (net) {
      st.disabled = lk || placed.length !== cnt();
      st.textContent = lk ? "Бэлэн. Нөгөө тоглогчийг хүлээж байна…" : "Бэлэн (" + placed.length + "/" + cnt() + ")";
    } else {
      st.disabled = placed.length !== cnt();
      st.textContent = "Тулалдаан эхлэх (" + placed.length + "/" + cnt() + ")";
    }
    paintMini();
    paintModes();
    paintMode();
    if (!$("hint").textContent) setHint(hintFor(valid));
  }
  function hintFor(valid) {
    if (locked()) return "Бэлэн боллоо. Нөгөө тоглогчийг хүлээж байна.";
    if (placed.length >= cnt()) return net ? "Бүх онгоц бэлэн. «Бэлэн» дарна уу." : "Бүх онгоц бэлэн. Тулалдаан эхлүүлж болно.";
    if (!ghost) return "Төрлөө сонгоод онгоцны толгойн нүдийг товш. Байрласан онгоцыг товшвол авна.";
    return valid ? "Тохирч байна. «Байрлуулах» дар, эсвэл «Эргүүлэх»-ээр чиглэлийг өөрчил."
                 : "Энд багтахгүй байна. Чиглэлээ эргүүл эсвэл өөр нүд товш.";
  }
  function refreshSetup(msg) { setHint(msg || ""); paintSetup(); }

  function onSetupTap(r, c) {
    if (phase !== "setup" || locked()) return;
    var s = sideFromPlaced(), idx = s.owner[r][c];
    if (idx >= 0) { placed.splice(idx, 1); ghost = null; refreshSetup("Онгоцыг авлаа."); return; }
    ghost = { r: r, c: c };
    refreshSetup("");
  }
  $("rotBtn").addEventListener("click", function () { ori = (ori + 1) % 4; refreshSetup(""); });
  $("placeBtn").addEventListener("click", function () {
    if (locked() || !ghost || placed.length >= cnt()) return;
    var cells = cellsOf(ghost.r, ghost.c, ori, rec.type);
    if (!canPlace(sideFromPlaced(), cells)) return;
    placed.push({ cells: cells, t: rec.type }); ghost = null; refreshSetup("");
  });
  $("undoBtn").addEventListener("click", function () { if (locked()) return; placed.pop(); ghost = null; refreshSetup(""); });
  $("autoBtn").addEventListener("click", function () {
    if (locked()) return;
    var s = sideFromPlaced(), note = "";
    if (!randomFill(s, cnt())) {
      // the planes already placed block a full layout, so start over
      s = newSide(rl());
      randomFill(s, cnt());
      note = "Байрласан онгоцууд саад болсон тул бүгдийг шинээр байрууллаа.";
    }
    placed = s.planes.map(function (p) { return { cells: p.cells, t: p.t }; });
    ghost = null; refreshSetup(note);
  });

  function show(id, on) { $(id).hidden = !on; }

  // ---------- ammo picker ----------
  var ammoEls = [];
  (function () {
    var box = $("ammo");
    ["n", "s", "d"].forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ammo-btn"; b.dataset.a = t; b.setAttribute("role", "radio");
      var ico = document.createElement("span"); ico.className = "ico";
      var n1 = document.createElement("i"); if (t === "s") n1.className = "ring"; ico.appendChild(n1);
      if (t === "d") ico.appendChild(document.createElement("i"));
      var nm = document.createElement("span"); nm.className = "nm"; nm.textContent = AMMO_NAME[t];
      var ct = document.createElement("span"); ct.className = "ct";
      var pg = document.createElement("span"); pg.className = "pg";
      b.appendChild(ico); b.appendChild(nm); b.appendChild(ct); b.appendChild(pg);
      b.ctEl = ct; b.pgEl = pg;
      b.addEventListener("click", function () { if (!b.disabled) { sel = t; paintAmmo(); } });
      box.appendChild(b); ammoEls.push(b);
    });
  })();
  function myTurn() { return phase === "battle" && g && g.turn === "player" && !busy; }
  function paintAmmo() {
    if (!g) return;
    var a = g.ammo.player, free = g.free.player, my = myTurn();
    if (!canUse(a, sel, free)) sel = "n";
    ammoEls.forEach(function (b) {
      var t = b.dataset.a;
      b.disabled = !(my && canUse(a, t, free));
      b.setAttribute("aria-checked", t === sel ? "true" : "false");
      b.classList.toggle("free", !!free && t !== "n");
      b.ctEl.textContent = t === "n" ? "∞" : String(t === "s" ? a.s : a.d);
      b.pgEl.textContent = (free && t !== "n") ? "үнэгүй" : t === "n" ? "буудсан " + a.n : (t === "s" ? (a.n % 4) + "/4 цэнэг" : (a.n % 6) + "/6 цэнэг");
    });
    var ab = g.ammo.bot, notes = [(net ? "Нөгөө тоглогчийн" : "Ботын") + " тусгай сум: өнжүүлэх " + ab.s + ", давхар шарх " + ab.d + "."];
    if (g.skip.bot) notes.push(oppLabel() + " дараагийн ээлжээ алгасна.");
    if (g.skip.player) notes.push("Та дараагийн ээлжээ алгасна.");
    if (free) notes.push("Эхний буудалтад дурын сумыг үнэгүй сонгоно.");
    $("ammoNote").textContent = notes.join(" ");
  }

  // ---------- battle ----------
  function setMsg(t, hot) { var m = $("msg"); m.textContent = t; m.dataset.tone = hot ? "hot" : ""; }
  function setTurn() {
    var t;
    if (phase === "over" || g.turn === "none") t = "Тоглоом дууслаа";
    else if (g.turn === "bot") t = oppLabel() + (net && net.view && net.view.opp && !net.view.opp.connected ? " холбогдоогүй байна…" : " зорьж байна…");
    else t = busy ? "Буудаж байна…" : "Таны ээлж";
    $("turn").textContent = t;
    var mine = phase === "battle" && g.turn === "player";
    if (mine) { $("whoMe").classList.add("on"); $("whoBot").classList.remove("on"); }
    else if (phase === "battle") { $("whoBot").classList.add("on"); $("whoMe").classList.remove("on"); }
  }
  function tagSpan(box, text, cls) {
    var s = document.createElement("span");
    s.className = "tag" + (cls ? " " + cls : "");
    s.textContent = text;
    box.appendChild(s);
  }
  // wounds are written down per plane on your own board; on the enemy board you only see the totals
  function paintTags() {
    var ob = $("ownTags"), eb = $("enemyTags"), wounded = 0;
    ob.textContent = ""; eb.textContent = "";
    me.planes.forEach(function (p) {
      var lim = limitOf(me, p), nm = TYPES[p.t].name;
      if (p.dead) tagSpan(ob, nm + " · Сөнөсөн", "dead");
      else if (p.hits > 0) tagSpan(ob, nm + " · Шарх " + p.hits + (lim === Infinity ? "" : "/" + lim), "hurt");
      else tagSpan(ob, nm + " · Бүтэн", "");
    });
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (bot.shot[r][c] === 2 && !bot.rev[r][c]) wounded++;
    tagSpan(eb, "Шарх: " + wounded, wounded ? "hurt" : "");
    tagSpan(eb, "Сөнөсөн: " + (bot.planes.length - alive(bot)), "");
    tagSpan(eb, "Үлдсэн: " + alive(bot), "");
  }
  function paintBattle() {
    paintSide(enemyEls, bot, false, myTurn());
    paintSide(ownEls, me, true, false);
    $("myLeft").textContent = alive(me) + "/" + me.planes.length;
    $("botLeft").textContent = alive(bot) + "/" + bot.planes.length;
    $("streak").textContent = g.streak + "/3";
    $("vsScore").textContent = sc.pts + " оноо";
    paintTags();
    setTurn();
    paintAmmo();
  }

  $("startBtn").addEventListener("click", function () {
    if (net) { sendPlacement(); return; }
    if (placed.length !== cnt()) return;
    me = newSide(rl());
    placed.forEach(function (pl) { addPlane(me, pl.cells, pl.t); });
    bot = newSide(rl());
    randomFill(bot, cnt());
    placePickups(me, 3); placePickups(bot, 3);
    g = newGame(); sc = newScore();
    rankBefore = rankOf(rec.total).i;
    phase = "battle"; busy = false; shots = 0; sel = "n";
    $("vsName").textContent = rec.name.trim() || "Та";
    showAvatar($("vsImg"), $("vsLetter"));
    $("botLv").textContent = LEVELS[rec.level];
    vsBot();
    $("legend").textContent = "✕ шарх · • алдсан · ◇ сумны эрх. " + (rl() === 1
      ? "Толгой онобол шууд Сөнөсөн; бусад хэсэгт " + TYPES.map(function (t) { return t.name + " " + t.limit; }).join(", ") + " шарх."
      : "Онгоц зөвхөн толгойд онохоор Сөнөсөн болно.");
    setMsg("Дайсны талбайг товшиж буудна. Буудалт бүрийн өмнө сумаа сонго. Онобол дахин буудна.", false);
    show("setup", false); show("battle", true); show("over", false);
    window.scrollTo(0, 0);
    paintBattle();
  });

  function where(r, c) { return "багана " + (c + 1) + ", мөр " + (r + 1); }
  function describe(who, r, c, res, ammo, got, flow) {
    var player = who === "player", s, F = oppLabel(), Fn = net ? "нөгөө тоглогч" : "бот", Fto = net ? "нөгөө тоглогчид" : "ботод";
    s = (player ? "Та " : F + " ") + where(r, c) + " нүдийг " + AMMO_BY[ammo] + " буудлаа: ";
    if (res.t === "miss") s += "алдлаа.";
    else if (res.t === "head") s += player ? "толгойд онов, онгоц шууд Сөнөсөн!" : "толгойд онов, таны онгоц шууд Сөнөсөн.";
    else {
      var w = res.extra.length ? "давхар шарх (хөрш нэг нүд дагаад)" : "шарх";
      s += player ? "онов, " + w + "!" : "таны онгоцонд " + w + " авлаа.";
      if (res.t === "kill") s += player ? " Онгоц Сөнөсөн!" : " Таны онгоц Сөнөсөн.";
    }
    if (res.stun) s += player ? " Өнжүүлэх сум онлоо: " + Fn + " дараагийн ээлжээ алгасна." : " Өнжүүлэх сум онлоо: та дараагийн ээлжээ алгасна.";
    if (res.gift) s += (player ? " Хоосон нүднээс " : " " + F + " хоосон нүднээс ") + GIFT_NAME[res.gift] + " сумны эрх олов.";
    if (got.length) s += " Энгийн сумны тоо хүрч " + got.map(function (t) { return GIFT_NAME[t]; }).join(", ") + " сумны эрх нэмэгдэв.";
    if (flow === "again") s += player ? " Дахин буудна." : " " + F + " дахин буудна.";
    else if (flow === "transfer") s += player ? " 3 дараалж онов, буудах эрх " + Fto + " шилжлээ." : " " + F + " 3 дараалж онов, буудах эрх танд шилжлээ. Эхний буудалтдаа дурын сумыг үнэгүй сонгоно.";
    else if (flow === "skipped") s += player ? " " + F + " ээлжээ алгаслаа, та дахин буудна." : " Та ээлжээ алгаслаа, " + Fn + " дахин буудна.";
    return s;
  }

  function takeShot(who, r, c, ammo) {
    var target = who === "player" ? bot : me, els = who === "player" ? enemyEls : ownEls;
    var free = g.free[who];
    var res = fireAmmo(target, r, c, ammo);
    if (!res) return false;
    var got = spend(g.ammo[who], ammo, free), gain = 0;
    if (res.gift) grant(g.ammo[who], res.gift);
    if (who === "player") {
      shots++;
      gain = scoreShot(sc, res, res.t !== "miss" ? g.streak + 1 : 0);
    }
    busy = true; setTurn(); paintAmmo();
    beep(520, 0.08, "square", 0.04, 200);
    tracer(els, r, c, who === "player", ammo, function () {
      var won = alive(target) === 0;
      var flow = won ? "end" : afterShot(g, who, res);
      busy = false;
      sel = "n";
      // the new marks get their draw-in / stamp animation on this one paint only
      var fr = {};
      fr[r + "," + c] = true;
      res.extra.forEach(function (q) { fr[q[0] + "," + q[1]] = true; });
      els.fresh = fr;
      els.freshDead = null;
      if (res.t === "head" || res.t === "kill") { els.freshDead = {}; els.freshDead[res.idx] = true; }
      paintBattle();
      els.fresh = null; els.freshDead = null;
      impact(els, target, r, c, res, gain);
      setMsg(describe(who, r, c, res, ammo, got, flow), res.t !== "miss" || !!res.gift);
      if (won) { setTimeout(function () { endGame(who === "player"); }, reduce ? 0 : 900); return; }
      if (g.turn === "bot") botTimer = setTimeout(botShot, 750 + Math.random() * 450);
    });
    return true;
  }

  function onEnemyTap(r, c) {
    if (!myTurn()) return;
    if (!canUse(g.ammo.player, sel, g.free.player)) { setMsg("Энэ сумны эрх үлдээгүй байна.", false); return; }
    if (bot.shot[r][c] !== 0 || bot.rev[r][c]) return;
    if (net) { sendShot(r, c); return; }
    takeShot("player", r, c, sel);
  }

  function botShot() {
    if (phase !== "battle" || g.turn !== "bot") return;
    var ammo = botAmmo(g.ammo.bot, g.free.bot, me);
    if (!canUse(g.ammo.bot, ammo, g.free.bot)) ammo = "n";
    var pick = botPick(me, rec.level);
    if (!pick) return;
    takeShot("bot", pick[0], pick[1], ammo);
  }

  function endGame(win) {
    clearTimeout(botTimer);
    phase = "over"; busy = false;
    finishScore(sc, win, win ? alive(me) : 0);
    var newBest = sc.pts > rec.best && sc.pts > 0;
    rec.total += sc.pts;
    if (sc.pts > rec.best) rec.best = sc.pts;
    if (win) rec.wins++;
    else {
      rec.losses++;
      bot.planes.forEach(function (p) { if (!p.dead) p.shown = true; });
    }
    saveRec(); paintRecord(); paintProfile(); paintBattle();
    fillOver(win, win
      ? "Дайсны бүх " + bot.planes.length + " онгоцыг " + shots + " буудлагаар сөнөөлөө."
      : "Таны бүх онгоц сөнөв. Ботын үлдсэн онгоцыг талбай дээр харуулав.", newBest);
  }
  // result card: points per row, total, rank
  function fillOver(win, text, newBest) {
    var t = $("overTitle");
    t.textContent = win ? "Та хожлоо!" : "Хожигдлоо";
    t.className = win ? "" : "lose";
    $("overText").textContent = text;
    var bd = $("bd");
    bd.textContent = "";
    BREAKDOWN.forEach(function (b) {
      var n = sc.n[b[0]];
      if (n <= 0) return;
      var li = document.createElement("li"), a = document.createElement("span"), v = document.createElement("b");
      a.textContent = b[1] + (n > 1 ? " × " + n : "");
      v.textContent = "+" + sc.p[b[0]];
      li.appendChild(a); li.appendChild(v); bd.appendChild(li);
    });
    if (!bd.firstChild) { var e = document.createElement("li"); e.textContent = "Энэ тоглолтод оноо аваагүй."; bd.appendChild(e); }
    $("bdTotal").textContent = String(sc.pts);
    var rk = rankOf(rec.total);
    $("rkText").textContent = (rk.i > rankBefore ? "Шинэ зэрэг: «" + rk.name + "»! " : "Зэрэг: «" + rk.name + "». ") +
      "Нийт " + rec.total + " оноо." + (newBest ? " Шилдэг тоглолт!" : "");
    show("over", true);
    quitArmed = false; clearTimeout(quitTimer);
    $("quitBtn").textContent = net ? "Өрөөнөөс гарах" : "Шинэ тоглоом";
    $("againBtn").focus();
  }

  function toSetup() {
    clearTimeout(botTimer); clearTimeout(quitTimer);
    quitArmed = false;
    $("quitBtn").textContent = "Тулалдаанаас гарах";
    phase = "setup"; placed = []; ghost = null; me = null; bot = null; g = null; sc = null; busy = false;
    show("battle", false); show("over", false); show("setup", true);
    window.scrollTo(0, 0);
    paintProfile();
    refreshSetup("");
  }
  $("againBtn").addEventListener("click", function () { if (net) requestRematch(); else toSetup(); });
  $("viewBtn").addEventListener("click", function () { show("over", false); });

  $("quitBtn").addEventListener("click", function () {
    var b = $("quitBtn");
    if (phase === "over") { exitGame(); return; }
    if (!quitArmed) {
      quitArmed = true;
      b.textContent = "Гарах уу? Оноо тооцогдохгүй";
      quitTimer = setTimeout(function () { quitArmed = false; b.textContent = "Тулалдаанаас гарах"; }, 3000);
      return;
    }
    exitGame();
  });

  $("soundBtn").addEventListener("click", function () {
    soundOn = !soundOn;
    this.textContent = soundOn ? "Дуу, чичиргээ: асаалттай" : "Дуу, чичиргээ: унтраалттай";
    this.setAttribute("aria-pressed", soundOn ? "true" : "false");
    if (soundOn) { beep(660, 0.1, "triangle", 0.07); buzz(30); }
  });


  // ---------- friend rooms (online) ----------
  // The server keeps both layouts and decides every shot. This side only draws the personal view it is sent.
  var paintModes = makeChips("modes", ["Ботын эсрэг", "Найзтай тоглох"], function () { return mode === "friend" ? 1 : 0; }, function (i) {
    if (net) return;
    mode = i === 1 ? "friend" : "bot";
    refreshSetup("");
  });

  function locked() { return !!(net && net.view && net.view.you && net.view.you.ready); }
  function netNote(t) { $("netNote").textContent = t || ""; }
  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, status: r.status, data: d }; },
          function () { return { ok: false, status: r.status, data: { error: "Серверийн хариу буруу байна." } }; });
      })
      .catch(function () { return { ok: false, status: 0, data: { error: "Серверт холбогдож чадсангүй. Сүлжээгээ шалгана уу." } }; });
  }
  function qs() { return "code=" + encodeURIComponent(net.code) + "&token=" + encodeURIComponent(net.token); }

  // which parts of the setup page show: bot game, friend menu, or a room
  function paintMode() {
    var friend = mode === "friend", v = net && net.view, setupPhase = !!(v && v.phase === "setup");
    $("levelRow").hidden = friend;
    $("cfgRows").hidden = !!net;
    $("friendBox").hidden = !(friend && !net);
    $("roomBar").hidden = !net;
    $("placeArea").hidden = friend && !setupPhase;
    paintRoomBar();
  }
  function paintRoomBar() {
    if (!net) return;
    var v = net.view, m;
    $("roomCode").textContent = net.code;
    if (!v) m = "Холбогдож байна…";
    else if (v.phase === "lobby") m = "Нөгөө тоглогчийг хүлээж байна. Кодыг найздаа илгээнэ үү.";
    else if (v.phase === "setup") {
      m = v.opp.name + (v.opp.connected ? "" : " (холбогдоогүй)") + " орлоо. " + v.count + " онгоц, " + (v.rule === 1 ? "шархын тоогоор" : "зөвхөн толгойд") + " устана. " +
        (v.you.ready ? (v.opp.ready ? "Хоёулаа бэлэн." : "Нөгөө тоглогч бэлэн болохыг хүлээж байна…") : "Онгоцоо байрлуулаад «Бэлэн» дар." + (v.opp.ready ? " Нөгөө тоглогч бэлэн." : ""));
    } else m = "";
    $("roomMsg").textContent = m;
  }

  function saveSession() {
    if (!net) return;
    try { localStorage.setItem(SKEY, JSON.stringify({ code: net.code, token: net.token, seat: net.seat, counted: net.counted })); } catch (e) {}
  }
  function startSession(d, counted) {
    net = { code: d.code, token: d.token, seat: d.seat, view: null, rev: -1, shownSeq: -1, oppPhoto: "", oppPv: 0, queue: [], draining: false, es: null, poll: 0, errs: 0, counted: counted === undefined ? -1 : counted, ping: 0, newBest: false };
    mode = "friend";
    saveSession();
    placed = []; ghost = null;
    netNote("");
    refreshSetup("");
    if (d.view) enqueue(d.view);
    connect();
    var n = net;
    n.ping = setInterval(function () { if (net === n) api("/api/ping", { code: n.code, token: n.token }); }, 4 * 60 * 1000);
  }
  function endSession(msg) {
    var n = net;
    if (!n) return;
    if (n.es) n.es.close();
    clearInterval(n.poll); clearInterval(n.ping);
    net = null;
    try { localStorage.removeItem(SKEY); } catch (e) {}
    toSetup();
    netNote(msg || "");
  }
  function leaveRoom() {
    if (!net) return;
    api("/api/leave", { code: net.code, token: net.token });
    endSession("");
  }
  function exitGame() { if (net) leaveRoom(); else toSetup(); }

  // live updates over a server-sent-events stream; if the network blocks it, fall back to asking every 1.5 s
  function connect() {
    var n = net;
    if (!n) return;
    try {
      var es = new EventSource("/api/events?" + qs());
      n.es = es;
      es.addEventListener("state", function (e) {
        if (net !== n) return;
        n.errs = 0;
        try { enqueue(JSON.parse(e.data)); } catch (x) {}
      });
      es.onerror = function () {
        if (net !== n) return;
        n.errs++;
        if (es.readyState === 2 || n.errs >= 3) { es.close(); n.es = null; startPolling(); }
      };
    } catch (e) { startPolling(); }
  }
  function startPolling() {
    var n = net;
    if (!n || n.poll) return;
    n.poll = setInterval(function () {
      if (net !== n) return;
      fetch("/api/state?" + qs()).then(function (r) {
        if (r.status === 404) { endSession("Өрөө олдсонгүй эсвэл хугацаа дууссан."); return null; }
        return r.ok ? r.json() : null;
      }).then(function (v) { if (v && net === n) enqueue(v); }).catch(function () {});
    }, 1500);
  }

  // views arrive from the stream and from the reply to our own request; each revision is handled once, in order
  function enqueue(v) {
    var n = net;
    if (!n || !v || typeof v.rev !== "number" || v.rev <= n.rev) return;
    n.rev = v.rev;
    n.queue.push(v);
    if (!n.draining) drain();
  }
  function drain() {
    var n = net;
    if (!n) return;
    if (!n.queue.length) { n.draining = false; return; }
    n.draining = true;
    var v = n.queue.shift(), skip = n.queue.length >= 2;
    handleView(v, skip, function () { if (net === n) drain(); });
  }

  function applyView(v) {
    me = { rule: v.rule, planes: v.own.planes, shot: v.own.shot, rev: v.own.rev, pick: v.own.pick };
    bot = { rule: v.rule, planes: v.enemy.planes, shot: v.enemy.shot, rev: v.enemy.rev, pick: v.enemy.pick };
    g = {
      turn: v.turn === "you" ? "player" : v.turn === "opp" ? "bot" : "none", streak: v.streak,
      free: { player: v.freeYou, bot: v.freeOpp }, skip: { player: v.skipYou, bot: v.skipOpp }, ammo: { player: v.ammoYou, bot: v.ammoOpp }
    };
    sc = v.score;
    $("botLv").textContent = v.oppScore + " оноо";
  }
  function vsBot() {
    $("oppName").textContent = "Бот";
    $("botSvg").style.display = ""; $("oppImg").hidden = true; $("oppLetter").hidden = true;
  }
  function vsOpp(v) {
    $("oppName").textContent = v.opp.name;
    var has = !!(net && net.oppPhoto);
    $("botSvg").style.display = "none";
    $("oppImg").hidden = !has; $("oppLetter").hidden = has;
    if (has) $("oppImg").src = net.oppPhoto;
    $("oppLetter").textContent = (v.opp.name.charAt(0) || "?").toUpperCase();
  }
  function fetchOppPhoto() {
    var n = net;
    fetch("/api/photo?" + qs()).then(function (r) { return r.json(); }).then(function (d) {
      if (net !== n || !d || typeof d.photo !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(d.photo)) return;
      n.oppPhoto = d.photo;
      if (n.view && n.view.opp && (phase === "battle" || phase === "over")) vsOpp(n.view);
    }).catch(function () {});
  }

  function handleView(v, skip, done) {
    var n = net;
    n.view = v;
    if (v.opp && v.opp.pv && n.oppPv !== v.opp.pv) { n.oppPv = v.opp.pv; fetchOppPhoto(); }
    if (v.closed === "opp" && v.phase !== "over" && !(phase === "over")) { endSession("Нөгөө тоглогч өрөөнөөс гарлаа."); return; }
    if (v.phase === "lobby" || v.phase === "setup" || !v.own) {
      if (phase !== "setup") {
        phase = "setup"; busy = false; placed = []; ghost = null; me = null; bot = null; g = null; sc = null;
        show("battle", false); show("over", false); show("setup", true);
        window.scrollTo(0, 0);
      }
      n.shownSeq = -1;
      refreshSetup("");
      done();
      return;
    }
    if (phase === "setup") {                      // entering the battle (or reloading into one)
      phase = "battle"; busy = false; sel = "n"; shots = 0;
      rankBefore = rankOf(rec.total).i;
      show("setup", false); show("battle", true); show("over", false);
      window.scrollTo(0, 0);
      $("vsName").textContent = rec.name.trim() || "Та";
      showAvatar($("vsImg"), $("vsLetter"));
      vsOpp(v);
      $("legend").textContent = "✕ шарх · • алдсан · ◇ сумны эрх. " + (v.rule === 1
        ? "Толгой онобол шууд Сөнөсөн; бусад хэсэгт " + TYPES.map(function (t) { return t.name + " " + t.limit; }).join(", ") + " шарх."
        : "Онгоц зөвхөн толгойд онохоор Сөнөсөн болно.");
      setMsg(v.last ? "Тулалдаанд буцаж орлоо." : "Тулалдаан эхэллээ. Дайсны талбайг товшиж буудна. Онобол дахин буудна.", false);
      applyView(v);
      n.shownSeq = v.last ? v.last.seq : 0;
      paintBattle();
      if (v.phase === "over") showOver(v);
      done();
      return;
    }
    var L = v.last;
    if (!skip && L && L.seq > n.shownSeq) { n.shownSeq = L.seq; playShot(v, done); return; }
    if (L && L.seq > n.shownSeq) n.shownSeq = L.seq;
    applyView(v);
    paintBattle();
    if (v.phase === "over" && phase !== "over") showOver(v);
    else if (phase === "over") updateAgain();
    done();
  }

  // a shot from either side: tracer first, then the new state with draw-in marks and effects
  function playShot(v, done) {
    var L = v.last, who = L.byYou ? "player" : "bot", els = who === "player" ? enemyEls : ownEls;
    busy = true; setTurn();
    tracer(els, L.r, L.c, who === "player", L.ammo, function () {
      if (!net) return;
      applyView(v);
      busy = false; sel = "n";
      var fr = {};
      fr[L.r + "," + L.c] = true;
      (L.res.extra || []).forEach(function (q) { fr[q[0] + "," + q[1]] = true; });
      els.fresh = fr; els.freshDead = null;
      if (L.res.t === "head" || L.res.t === "kill") { els.freshDead = {}; els.freshDead[L.res.idx] = true; }
      paintBattle();
      els.fresh = null; els.freshDead = null;
      if (L.byYou) shots++;
      impact(els, who === "player" ? bot : me, L.r, L.c, L.res, L.byYou ? L.gain : 0);
      setMsg(describe(who, L.r, L.c, L.res, L.ammo, L.got || [], L.flow), L.res.t !== "miss" || !!L.res.gift);
      if (v.phase === "over") setTimeout(function () { if (net) showOver(v); }, reduce ? 0 : 900);
      setTimeout(done, reduce ? 0 : 350);
    });
  }
  function sendShot(r, c) {
    var n = net;
    busy = true; setTurn(); paintAmmo();
    api("/api/shoot", { code: n.code, token: n.token, r: r, c: c, ammo: sel }).then(function (res) {
      if (net !== n) return;
      if (!res.ok) { busy = false; setMsg(res.data.error || "Буудаж чадсангүй.", false); paintBattle(); return; }
      enqueue(res.data.view);
    });
  }
  function sendPlacement() {
    var n = net;
    if (!n || !n.view || n.view.phase !== "setup" || n.view.you.ready || placed.length !== cnt()) return;
    $("startBtn").disabled = true;
    api("/api/place", { code: n.code, token: n.token, planes: placed.map(function (pl) { return { t: pl.t, cells: pl.cells }; }) }).then(function (r) {
      if (net !== n) return;
      if (!r.ok) { refreshSetup(r.data.error || "Байрлуулж чадсангүй."); return; }
      enqueue(r.data.view);
    });
  }

  function showOver(v) {
    var n = net;
    if (!n) return;
    phase = "over"; busy = false;
    var win = v.winner === "you";
    if (n.counted !== v.gameNo) {
      n.counted = v.gameNo;
      n.newBest = sc.pts > rec.best && sc.pts > 0;
      rec.total += sc.pts;
      if (sc.pts > rec.best) rec.best = sc.pts;
      if (win) rec.wins++; else rec.losses++;
      saveRec(); paintRecord(); paintProfile(); saveSession();
    }
    paintBattle();
    fillOver(win, win ? "Дайсны бүх онгоцыг сөнөөлөө. Нийт оноо: " + v.score.pts + " — нөгөө тоглогч " + v.oppScore + "." : "Таны бүх онгоц сөнөв. Нөгөө тоглогчийн үлдсэн онгоцыг талбай дээр харуулав.", n.newBest);
    updateAgain();
  }
  function updateAgain() {
    var n = net, b = $("againBtn");
    if (!n || !n.view) return;
    var v = n.view;
    b.disabled = false;
    if (v.closed === "opp") { b.disabled = true; b.textContent = "Нөгөө тоглогч гарсан"; }
    else if (v.you.wantsRematch) { b.disabled = true; b.textContent = "Нөгөө тоглогчийн хариуг хүлээж байна…"; }
    else b.textContent = v.opp && v.opp.wantsRematch ? "Дахин тоглох (нөгөө тоглогч хүсэж байна)" : "Дахин тоглох";
  }
  function requestRematch() {
    var n = net;
    if (!n) return;
    api("/api/rematch", { code: n.code, token: n.token }).then(function (r) { if (net === n && r.ok) enqueue(r.data.view); });
  }

  // ---------- room buttons ----------
  $("codeInput").addEventListener("input", function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); });
  $("createBtn").addEventListener("click", function () {
    if (net) return;
    var b = this;
    b.disabled = true; netNote("Өрөө үүсгэж байна…");
    api("/api/create", { name: rec.name.trim(), photo: rec.photo, rule: rec.rule, count: rec.count }).then(function (r) {
      b.disabled = false;
      if (!r.ok) { netNote(r.data.error || "Өрөө үүсгэж чадсангүй."); return; }
      startSession(r.data);
    });
  });
  $("joinBtn").addEventListener("click", function () {
    if (net) return;
    var code = $("codeInput").value;
    if (code.length !== 4) { netNote("4 тэмдэгттэй кодоо оруулна уу."); return; }
    var b = this;
    b.disabled = true; netNote("Өрөөнд орж байна…");
    api("/api/join", { code: code, name: rec.name.trim(), photo: rec.photo }).then(function (r) {
      b.disabled = false;
      if (!r.ok) { netNote(r.data.error || "Өрөөнд орж чадсангүй."); return; }
      startSession(r.data);
    });
  });
  $("leaveBtn").addEventListener("click", leaveRoom);
  $("shareBtn").addEventListener("click", function () {
    if (!net) return;
    var url = location.origin + "/?room=" + net.code, text = "Онгоцны байлдаан: надтай тоглоорой! Өрөөний код " + net.code + ".";
    function note(t) { $("roomNote").textContent = t; }
    if (navigator.share) { navigator.share({ title: "Онгоцны байлдаан", text: text, url: url }).catch(function () {}); return; }
    try { navigator.clipboard.writeText(text + " " + url).then(function () { note("Урилга хуулагдлаа. Найздаа илгээнэ үү."); }, function () { note(url); }); }
    catch (e) { note(url); }
  });

  // after a reload, go back into the room that is still running on the server
  function resumeSession() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(SKEY)); } catch (e) {}
    if (!saved || typeof saved.code !== "string" || typeof saved.token !== "string" || (saved.seat !== "a" && saved.seat !== "b")) return;
    fetch("/api/state?code=" + encodeURIComponent(saved.code) + "&token=" + encodeURIComponent(saved.token)).then(function (r) {
      if (!r.ok) throw new Error("gone");
      return r.json();
    }).then(function (v) {
      if (v.phase === "closed" || net) throw new Error("closed");
      startSession({ code: saved.code, token: saved.token, seat: saved.seat, view: v }, typeof saved.counted === "number" ? saved.counted : -1);
    }).catch(function () { try { localStorage.removeItem(SKEY); } catch (e) {} });
  }

  // ---------- start ----------
  paintRecord();
  paintProfile();
  (function () {
    var q = "";
    try { q = new URLSearchParams(location.search).get("room") || ""; } catch (e) {}
    q = q.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
    if (q) { mode = "friend"; $("codeInput").value = q; }
  })();
  refreshSetup("");
  resumeSession();
})();
