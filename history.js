"use strict";
// Round history on the iPad: the same screens as the Cart Caddie Rounds computer program, reading straight
// from the caddie's saved rounds (dates and notes are kept alongside on the iPad).
const Hist = (() => {
  const L = { TEE: 0, FW: 1, ROUGH: 2, TALL: 3, SAND: 4, WATER: 5, GREEN: 6, FRINGE: 7, TREES: 8, OB: 9, BLOCK: 10 };
  const LIEN = ["Tee", "Fairway", "Rough", "Tall grass", "Bunker", "Water", "Green", "Fringe", "Trees", "Out of bounds", "Blocked"];
  const SWING = ["", "3/4", "1/2", "pitch", "splash", "punch"];
  const F = { DROP: 1, PEN: 2 };
  const H = (i) => COURSE.holes[i];
  const ui = { tab: "rounds", round: null, hole: 0, shot: -1, club: null };
  let ROUNDS = [], BAG = [];
  function pipT(pts, x, y) { let c = false; const n = pts.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = pts[2 * i] / 10, yi = pts[2 * i + 1] / 10, xj = pts[2 * j] / 10, yj = pts[2 * j + 1] / 10; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
  function edgeDist(pts, x, y) { let m = 1e9; const n = pts.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = pts[2 * j] / 10, ay = pts[2 * j + 1] / 10, bx = pts[2 * i] / 10, by = pts[2 * i + 1] / 10; const dx = bx - ax, dy = by - ay, LL = dx * dx + dy * dy; let t = LL > 0 ? ((x - ax) * dx + (y - ay) * dy) / LL : 0; t = Math.max(0, Math.min(1, t)); m = Math.min(m, Math.hypot(x - ax - dx * t, y - ay - dy * t)); } return m; }
  const greenOf = (hi, gs) => { const h = H(hi); return h.greens[h.greens.length > 1 ? gs % h.greens.length : 0]; };
  function lieAt(hi, gs, x, y) { const h = H(hi), g = greenOf(hi, gs); const has = {};
    for (const s of h.shapes) if (pipT(s.p, x, y)) has[s.t] = 1;
    if (has[3]) return L.OB; if (has[2]) return L.WATER; if (pipT(g.p, x, y)) return L.GREEN;
    let sand = has[4]; for (const b of g.bunkers) if (pipT(b, x, y)) sand = 1; if (sand) return L.SAND;
    if (edgeDist(g.p, x, y) < 1.6) return L.FRINGE; if (has[6]) return L.BLOCK; if (has[1]) return L.TALL;
    let tr = has[5]; if (!tr) for (const t of h.trees) if (Math.hypot(x - t[0] / 10, y - t[1] / 10) < t[2] / 10 + 1) { tr = 1; break; }
    if (tr) return L.TREES; if (has[0]) return L.FW; return L.ROUGH; }
  function shotError(s) { const ux = s.aim[0] - s.from[0], uy = s.aim[1] - s.from[1], Ln = Math.hypot(ux, uy); if (Ln < 20) return null; const u = [ux / Ln, uy / Ln], r = [u[1], -u[0]], ex = s.fin[0] - s.exp[0], ey = s.fin[1] - s.exp[1];
    const a = ex * u[0] + ey * u[1], x = ex * r[0] + ey * r[1]; return Math.abs(a) < 70 && Math.abs(x) < 70 ? { a, x } : null; }
  const qualifies = (s) => s.club >= 0 && s.club < 13 && s.swing <= 2 && s.kind <= 2 && !(s.flags & F.DROP) && [L.TEE, L.FW, L.ROUGH, L.FRINGE].includes(s.lie0);
  function parseExport(text) { const lines = text.split(/\r?\n/); let i = lines.findIndex(l => l.startsWith("CCX ")); const rounds = {}, bag = [];
    for (i++; i < lines.length; i++) { const l = lines[i].trim(); if (!l) continue; if (l === "END") break;
      if (l.startsWith("B,")) { const p = l.split(","); bag.push({ i: +p[1], name: p[2], short: p[3], kind: +p[4], carry: [+p[5], +p[6], +p[7]] }); }
      else if (l.startsWith("R ")) { const r = JSON.parse(l.slice(2)); r.shots = []; rounds[r.n] = r; }
      else if (l.startsWith("S,")) { const p = l.split(",").map(Number); const r = rounds[p[1]]; if (!r) continue;
        r.shots.push({ rh: p[2], hole: p[3], idx: p[4], club: p[5], swing: p[6], kind: p[7], lie0: p[8], flags: p[9], pen: p[10], from: [p[11] / 10, p[12] / 10], aim: [p[13] / 10, p[14] / 10], exp: [p[15] / 10, p[16] / 10], fin: [p[17] / 10, p[18] / 10], carry: p[19] / 10 }); } }
    return { rounds: Object.values(rounds), bag }; }
  function loadRounds() { const d = parseExport(out(call("ip_export"))); BAG = d.bag; ROUNDS = d.rounds.filter(r => r.score.some(x => x) || r.shots.length);
    for (const r of ROUNDS) { r.date = kvGet("d:" + r.n, ""); r.notes = kvGet("n:" + r.n, ""); r.id = String(r.n); } return ROUNDS; }
  const holesOf = (r) => r.holes || Array.from({ length: 18 }, (_, i) => ((i < 9 ? r.front : r.back) % 3) * 9 + i % 9);
  function roundStats(r) { const holes = holesOf(r); let tot = 0, par = 0, played = 0, pts = 0, gir = 0, girN = 0, fw = 0, fwN = 0, pen = 0, three = 0, meas = 0;
    for (let h = 0; h < 18; h++) { const hp = H(holes[h]).par; const sh = r.shots.filter(s => s.rh === h).sort((a, b) => a.idx - b.idx); for (const s of sh) { pen += s.pen ? 1 : 0; if (qualifies(s) && shotError(s)) meas++; }
      if (!r.score[h]) continue; played++; tot += r.score[h]; par += hp; pts += r.putts[h]; if (r.putts[h] >= 3) three++; girN++; if (r.score[h] - r.putts[h] <= hp - 2) gir++;
      if (hp >= 4 && sh[0] && !(sh[0].flags & F.DROP)) { fwN++; if (!sh[0].pen && lieAt(holes[h], r.gsel[h] || 0, sh[0].fin[0], sh[0].fin[1]) === L.FW) fw++; } }
    return { tot, par, played, pts, gir, girN, fw, fwN, pen, three, meas, toPar: tot - par }; }
  const fmtPar = (d) => d === 0 ? "E" : (d > 0 ? "+" : "") + d;
  const fmtDate = (iso) => { if (!iso) return "No date"; const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }); };
  const clubName = (c, sw) => c < 0 ? "Drop" : ((BAG[c] && BAG[c].name) || "Club " + c) + (SWING[sw] ? " " + SWING[sw] : "");
  const strokeNo = (shots, i) => { let n = 1; for (let k = 0; k < i; k++) n += (shots[k].flags & F.DROP ? 0 : 1) + (shots[k].pen ? 1 : 0); return n; };
  const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
  const sorted = () => [...ROUNDS].sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.n - a.n);

  function open() { loadRounds(); show("history"); render(); }
  function render() { const el = $("#history");
    el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><h1 style="flex:1">Round history</h1><button class="acc" id="hClose" style="min-width:140px">Close</button></div>
      <div class="tabs">${["rounds", "clubs", "putting", "trends"].map(t => `<button data-tab="${t}" class="${ui.tab === t ? "on" : ""}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div><div id="hBody"></div>`;
    $("#hClose").onclick = () => { if (UI.reviewing) showRoundDone(); else renderAll(); };
    el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { ui.tab = b.dataset.tab; render(); });
    const body = $("#hBody");
    if (!ROUNDS.length) { body.innerHTML = `<p class="note">No rounds yet. They show up here as soon as you start playing.</p>`; return; }
    if (ui.tab === "rounds") rounds(body); else if (ui.tab === "clubs") clubs(body); else if (ui.tab === "putting") putting(body); else trends(body); }

  function rounds(body) { const list = sorted(); if (!ui.round || !ROUNDS.find(r => r.id === ui.round)) ui.round = list[0].id; const r = ROUNDS.find(x => x.id === ui.round); const st = roundStats(r);
    body.innerHTML = `<div class="cols"><div class="rlist">${list.map(x => { const s = roundStats(x); return `<button class="ritem ${x.id === r.id ? "cur" : ""}" data-id="${x.id}"><span class="d">${fmtDate(x.date)}${x.live ? '<span class="tag">NOW</span>' : ""}</span><span class="s">${s.tot || "-"}<small>${s.played ? fmtPar(s.toPar) : ""}${s.played && s.played < 18 ? ` (${s.played})` : ""}</small></span><span class="c">${NINES[x.front]} / ${NINES[x.back]} - tee ${x.tee + 1}</span></button>`; }).join("")}</div><div id="rDet"></div></div>`;
    body.querySelectorAll("[data-id]").forEach(b => b.onclick = () => { ui.round = b.dataset.id; ui.hole = 0; ui.shot = -1; rounds(body); });
    const holes = holesOf(r); const det = $("#rDet");
    const cell = (h) => { const sc = r.score[h]; if (!sc) return ""; const d = sc - H(holes[h]).par; return `<span class="sc ${d <= -2 ? "e2" : d === -1 ? "e1" : d === 1 ? "b1" : d >= 2 ? "b2" : ""}">${sc}</span>`; };
    const sum = (a, b, f) => { let t = 0; for (let h = a; h < b; h++) t += f(h); return t; };
    const row = (lab, f, tots) => `<tr><th>${lab}</th>${[...Array(9)].map((_, h) => `<td>${f(h)}</td>`).join("")}<td class="tot">${tots[0]}</td>${[...Array(9)].map((_, h) => `<td>${f(h + 9)}</td>`).join("")}<td class="tot">${tots[1]}</td><td class="tot">${tots[2]}</td></tr>`;
    const po = sum(0, 9, h => H(holes[h]).par), pi = sum(9, 18, h => H(holes[h]).par), so = sum(0, 9, h => r.score[h]), si = sum(9, 18, h => r.score[h]);
    det.innerHTML = `<div style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap"><span style="font:800 3.4rem var(--display)">${st.tot || "-"}</span><span style="font:800 2rem var(--display)" class="${st.toPar < 0 ? "under" : st.toPar > 0 ? "over" : "even"}">${st.played ? fmtPar(st.toPar) : ""}</span><span class="note">${NINES[r.front]} / ${NINES[r.back]} - tee ${r.tee + 1}</span></div>
      <div style="display:flex;gap:10px;align-items:center;margin:8px 0"><label class="note">Date <input type="date" id="rDate" value="${r.date}"></label></div>
      <textarea id="rNotes" placeholder="Notes: weather, who you played with...">${esc(r.notes)}</textarea>
      <div class="kpis"><div class="kpi"><div class="l">Putts</div><div class="v">${st.pts}</div></div><div class="kpi"><div class="l">Greens</div><div class="v">${st.gir}/${st.girN}</div></div><div class="kpi"><div class="l">Fairways</div><div class="v">${st.fw}/${st.fwN}</div></div><div class="kpi"><div class="l">Penalties</div><div class="v">${st.pen}</div></div><div class="kpi"><div class="l">3-putts</div><div class="v">${st.three}</div></div></div>
      <div style="overflow-x:auto"><table class="scorecard"><tr><th>Hole</th>${[...Array(9)].map((_, h) => `<td class="h tap ${ui.hole === h ? "cur" : ""}" data-h="${h}">${h + 1}</td>`).join("")}<th>Out</th>${[...Array(9)].map((_, h) => `<td class="h tap ${ui.hole === h + 9 ? "cur" : ""}" data-h="${h + 9}">${h + 10}</td>`).join("")}<th>In</th><th>Tot</th></tr>
      ${row("Par", h => H(holes[h]).par, [po, pi, po + pi])}${row("Score", cell, [so || "", si || "", so + si || ""])}${row("Putts", h => r.score[h] ? r.putts[h] : "", ["", "", ""])}</table></div><div id="rHole"></div>`;
    $("#rDate").onchange = (e) => { kvSet("d:" + r.n, e.target.value); r.date = e.target.value; };
    $("#rNotes").onchange = (e) => { kvSet("n:" + r.n, e.target.value); r.notes = e.target.value; };
    det.querySelectorAll("[data-h]").forEach(td => td.onclick = () => { ui.hole = +td.dataset.h; ui.shot = -1; rounds(body); });
    holeView(r); }
  function holeView(r) { const holes = holesOf(r), h = ui.hole, hi = holes[h], hd = H(hi), gs = r.gsel[h] || 0, g = greenOf(hi, gs);
    const shots = r.shots.filter(s => s.rh === h).sort((a, b) => a.idx - b.idx); const pin = r.pins ? r.pins[h] : [(g.front[0] + g.back[0]) / 20, (g.front[1] + g.back[1]) / 20];
    const rows = shots.map((s, i) => { const lie = lieAt(hi, gs, s.fin[0], s.fin[1]); const dist = Math.hypot(s.fin[0] - s.from[0], s.fin[1] - s.from[1]); const left = Math.hypot(pin[0] - s.fin[0], pin[1] - s.fin[1]);
      const e = qualifies(s) ? shotError(s) : null; const miss = e ? `${Math.abs(e.a) < 1 ? "pin-high" : r0(Math.abs(e.a)) + (e.a < 0 ? " short" : " long")}, ${Math.abs(e.x) < 1 ? "on line" : r0(Math.abs(e.x)) + (e.x < 0 ? " left" : " right")}` : ""; const drop = s.flags & F.DROP;
      return `<tr class="click ${ui.shot === i ? "cur" : ""}" data-i="${i}"><td>${drop ? "D" : strokeNo(shots, i)}</td><td>${esc(clubName(s.club, s.swing))}</td><td class="n">${drop ? "" : r0(dist)}</td><td>${LIEN[lie]}${s.pen ? ' <b style="color:var(--red)">+1</b>' : ""}</td><td class="n">${lie === L.GREEN ? r0(left * 3) + " ft" : r0(left)}</td><td>${miss}</td></tr>`; }).join("");
    const pf = (r.puttFt[h] || []).slice(0, r.putts[h]).map((ft, k, a) => ft ? `${ft} ft${k === a.length - 1 ? " (made)" : ""}` : "?").join(", ");
    $("#rHole").innerHTML = `<div class="histhole"><div><h2 style="margin-top:6px">Hole ${h + 1} - ${NINES[Math.floor(hi / 9)]} ${hd.num}</h2>${svg(hi, gs, shots, pin, r.tee)}</div>
      <div><h2 style="margin-top:6px">Shots</h2>${shots.length ? `<table class="list"><tr><th>#</th><th>Club</th><th class="n">Yds</th><th>Finished</th><th class="n">To pin</th><th>vs target</th></tr>${rows}</table>` : `<p class="note">No shots placed on this hole.</p>`}
      ${r.putts[h] ? `<h2>Putts</h2><p>${r.putts[h]} putt${r.putts[h] > 1 ? "s" : ""}${pf ? ": " + pf : ""}</p>` : ""}</div></div>`;
    $("#rHole").querySelectorAll("tr.click").forEach(tr => tr.onclick = () => { ui.shot = ui.shot === +tr.dataset.i ? -1 : +tr.dataset.i; holeView(r); }); }
  function svg(hi, gs, shots, pin, tee) { const h = H(hi), g = greenOf(hi, gs); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; const inc = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
    h.tees.forEach(t => inc(t[0] / 10, t[1] / 10)); for (let i = 0; i < g.p.length; i += 2) inc(g.p[i] / 10, g.p[i + 1] / 10); shots.forEach(s => { inc(s.from[0], s.from[1]); inc(s.fin[0], s.fin[1]); }); inc(pin[0], pin[1]);
    const pad = 22; x0 -= pad; x1 += pad; y0 -= pad; y1 += pad; if (x1 - x0 < (y1 - y0) * 0.55) { const c = (x0 + x1) / 2, w = (y1 - y0) * 0.55; x0 = c - w / 2; x1 = c + w / 2; }
    const W = x1 - x0, Hh = y1 - y0, px = (x) => (x - x0).toFixed(1), py = (y) => (y1 - y).toFixed(1), k = W / 190;
    const poly = (p, fill, stroke) => { let d = ""; for (let i = 0; i < p.length; i += 2) d += (i ? "L" : "M") + px(p[i] / 10) + " " + py(p[i + 1] / 10); return `<path d="${d}Z" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${(W / 300).toFixed(2)}"` : ""}/>`; };
    const col = { 0: "#4e9a3e", 1: "#6e7a3a", 2: "#2f78c4", 3: "rgba(255,255,255,.15)", 4: "#e9dcb0", 5: "#163a1c", 6: "rgba(176,112,240,.3)" };
    let s = ""; for (const t of [1, 0, 3, 2, 4, 5, 6]) for (const sh of h.shapes) if (sh.t === t) s += poly(sh.p, col[t], t === 3 ? "#ff6b5b" : null);
    for (const gg of h.greens) { s += poly(gg.p, "#86d96e", "rgba(255,255,255,.6)"); for (const b of gg.bunkers) s += poly(b, "#e9dcb0"); }
    for (const t of h.trees) s += `<circle cx="${px(t[0] / 10)}" cy="${py(t[1] / 10)}" r="${Math.max(1.5, t[2] / 10)}" fill="#163a1c"/>`;
    s += `<line x1="${px(pin[0])}" y1="${py(pin[1])}" x2="${px(pin[0])}" y2="${py(pin[1] + 9 * k)}" stroke="#111" stroke-width="${0.5 * k}"/><path d="M${px(pin[0])} ${py(pin[1] + 9 * k)} l${5 * k} ${1.6 * k} l${-5 * k} ${1.6 * k}Z" fill="#e53935"/>`;
    shots.forEach((sh, i) => { const on = ui.shot === -1 || ui.shot === i; s += `<line x1="${px(sh.from[0])}" y1="${py(sh.from[1])}" x2="${px(sh.fin[0])}" y2="${py(sh.fin[1])}" stroke="${sh.pen ? "#ff8a80" : "#fff"}" stroke-width="${(ui.shot === i ? 1.2 : .8) * k}" opacity="${on ? 1 : .3}"/>`; if (ui.shot === i && qualifies(sh)) s += `<circle cx="${px(sh.aim[0])}" cy="${py(sh.aim[1])}" r="${3 * k}" fill="none" stroke="#ffd166" stroke-width="${.7 * k}"/>`; });
    shots.forEach((sh, i) => { const on = ui.shot === -1 || ui.shot === i; const n = sh.flags & F.DROP ? "D" : strokeNo(shots, i); s += `<g opacity="${on ? 1 : .35}"><circle cx="${px(sh.fin[0])}" cy="${py(sh.fin[1])}" r="${4.2 * k}" fill="#111" stroke="#ffd166" stroke-width="${.6 * k}"/><text x="${px(sh.fin[0])}" y="${py(sh.fin[1])}" dy="${1.6 * k}" text-anchor="middle" font-size="${4.6 * k}" font-weight="700" fill="#ffd166">${n}</text></g>`; });
    return `<svg viewBox="0 0 ${W.toFixed(1)} ${Hh.toFixed(1)}" style="width:100%;background:#23452a;border-radius:12px;display:block">${s}</svg>`; }

  function clubs(body) { const qs = []; for (const r of ROUNDS) for (const s of r.shots) if (qualifies(s)) { const e = shotError(s); if (e) qs.push({ r, s, e, dist: Math.hypot(s.fin[0] - s.from[0], s.fin[1] - s.from[1]) }); }
    const groups = {}; for (const q of qs) { const k = q.s.club + ":" + q.s.swing; (groups[k] = groups[k] || []).push(q); }
    const keys = Object.keys(groups).sort((a, b) => { const [ca, sa] = a.split(":").map(Number), [cb, sb] = b.split(":").map(Number); return ca - cb || sa - sb; });
    const bag = json("ip_bagState").clubs;
    if (!keys.length) { body.innerHTML = `<p class="note">No measured shots yet: full, 3/4 and 1/2 swings from the tee, fairway, rough or fringe count once you've placed where they finished.</p>`; return; }
    if (!ui.club || !groups[ui.club]) ui.club = keys[0]; const g = groups[ui.club], [c, sw] = ui.club.split(":").map(Number); const offer = bag[c] && bag[c].offer[sw];
    body.innerHTML = `<div class="cols" style="grid-template-columns:minmax(0,1.3fr) minmax(300px,1fr)"><div><table class="list"><tr><th>Club</th><th class="n">Shots</th><th class="n">Bag</th><th class="n">Avg yds</th><th class="n">vs expected</th><th class="n">Spread</th></tr>
      ${keys.map(k => { const gg = groups[k], [cc, ss] = k.split(":").map(Number); const A = gg.map(q => q.e.a), X = gg.map(q => q.e.x); const ma = mean(A); return `<tr class="click ${k === ui.club ? "cur" : ""}" data-k="${k}"><td>${esc(clubName(cc, ss))}</td><td class="n">${gg.length}</td><td class="n">${bag[cc] ? bag[cc].carry[ss] : ""}</td><td class="n">${r0(mean(gg.map(q => q.dist)))}</td><td class="n">${Math.abs(ma) < .5 ? "on" : r0(Math.abs(ma)) + (ma < 0 ? " short" : " long")}</td><td class="n">${gg.length > 1 ? "&plusmn;" + r0(sd(A)) + " / &plusmn;" + r0(sd(X)) : "-"}</td></tr>`; }).join("")}</table>
      <p class="note">"vs expected" is the average miss along the line, short or long of where the caddie expected the ball to finish. "Spread" is long/short then left/right: about two shots in three land inside it.</p></div>
      <div><h2 style="margin-top:0">${esc(clubName(c, sw))}</h2>${scatter(g)}${offer ? `<div class="card" style="margin-top:10px"><div class="k">BAG UPDATE</div><div class="big" style="font-size:1.3rem">Playing ${offer}, your bag says ${bag[c].carry[sw]}</div><div class="row r2" style="margin-top:8px"><button class="acc" id="cUpd">Use ${offer}</button><button id="cKeep">Keep ${bag[c].carry[sw]}</button></div></div>` : ""}</div></div>`;
    body.querySelectorAll("[data-k]").forEach(tr => tr.onclick = () => { ui.club = tr.dataset.k; clubs(body); });
    const u = $("#cUpd"); if (u) u.onclick = () => { call("ip_setCarry", c, sw, offer); refresh(); toast(`${clubName(c, sw)} now ${offer} in your bag`); clubs(body); };
    const kp = $("#cKeep"); if (kp) kp.onclick = () => { call("ip_keepCarry", c, sw); toast(`Keeping ${bag[c].carry[sw]} - it will ask again after 10 more shots`); clubs(body); }; }
  function scatter(g) { const R = Math.max(15, ...g.map(q => Math.max(Math.abs(q.e.a), Math.abs(q.e.x)))) * 1.1, S0 = 360, c = S0 / 2, k = (S0 / 2 - 16) / R;
    let s = `<rect width="${S0}" height="${S0}" rx="12" fill="#18221b"/>`; for (let r = 10; r < R; r += 10) s += `<circle cx="${c}" cy="${c}" r="${r * k}" fill="none" stroke="#33443a"/><text x="${c + 3}" y="${c - r * k - 3}" font-size="11" fill="#a9b8ad">${r}</text>`;
    s += `<line x1="${c}" y1="8" x2="${c}" y2="${S0 - 8}" stroke="#33443a"/><line x1="8" y1="${c}" x2="${S0 - 8}" y2="${c}" stroke="#33443a"/><text x="${c}" y="16" text-anchor="middle" font-size="13" fill="#a9b8ad">long</text><text x="${c}" y="${S0 - 6}" text-anchor="middle" font-size="13" fill="#a9b8ad">short</text><text x="8" y="${c - 6}" font-size="13" fill="#a9b8ad">left</text><text x="${S0 - 8}" y="${c - 6}" text-anchor="end" font-size="13" fill="#a9b8ad">right</text>`;
    const A = g.map(q => q.e.a), X = g.map(q => q.e.x); if (g.length >= 3) s += `<ellipse cx="${c + mean(X) * k}" cy="${c - mean(A) * k}" rx="${Math.max(2, sd(X) * k)}" ry="${Math.max(2, sd(A) * k)}" fill="none" stroke="#f2b544" stroke-width="2.5"/>`;
    for (const q of g) s += `<circle cx="${c + q.e.x * k}" cy="${c - q.e.a * k}" r="5" fill="#3ddc84" stroke="#0e1410"/>`; s += `<circle cx="${c}" cy="${c}" r="3.5" fill="#fff"/>`;
    return `<svg viewBox="0 0 ${S0} ${S0}" style="width:100%;max-width:440px;display:block">${s}</svg>`; }
  function putting(body) { const B = [[0, 3], [3, 6], [6, 10], [10, 15], [15, 25], [25, 40], [40, 999]]; const made = B.map(() => 0), tries = B.map(() => 0); let first = [], three = 0, holes = 0, putts = 0;
    for (const r of ROUNDS) for (let h = 0; h < 18; h++) { if (!r.score[h] || !r.putts[h]) continue; holes++; putts += r.putts[h]; if (r.putts[h] >= 3) three++; const pf = r.puttFt[h] || []; if (pf[0]) first.push(pf[0]);
      for (let k = 0; k < r.putts[h] && k < 4; k++) { const ft = pf[k]; if (!ft) continue; const b = B.findIndex(([a, z]) => ft >= a && ft < z); if (b < 0) continue; tries[b]++; if (k === r.putts[h] - 1) made[b]++; } }
    body.innerHTML = `<div class="kpis"><div class="kpi"><div class="l">Putts / round</div><div class="v">${holes ? (putts / holes * 18).toFixed(1) : "-"}</div></div><div class="kpi"><div class="l">Putts / hole</div><div class="v">${holes ? (putts / holes).toFixed(2) : "-"}</div></div><div class="kpi"><div class="l">3-putts</div><div class="v">${three}</div></div><div class="kpi"><div class="l">Avg first putt</div><div class="v">${first.length ? r0(mean(first)) + " ft" : "-"}</div></div></div>
      <table class="list"><tr><th>Length</th><th class="n">Putts</th><th class="n">Made</th><th class="n">Made %</th><th style="width:40%"></th></tr>${B.map(([a, z], i) => `<tr><td>${z > 900 ? a + "+ ft" : a + "-" + z + " ft"}</td><td class="n">${tries[i]}</td><td class="n">${made[i]}</td><td class="n">${tries[i] ? r0(100 * made[i] / tries[i]) + "%" : ""}</td><td><div style="height:16px;border-radius:5px;background:var(--acc);width:${tries[i] ? 100 * made[i] / tries[i] : 0}%"></div></td></tr>`).join("")}</table>`; }
  function line(title, pts, pct) { const W = 480, Hh = 230, l = 44, r = 26, t = 28, b = 30; if (!pts.length) return ""; let lo = Math.min(...pts.map(p => p.y)), hi = Math.max(...pts.map(p => p.y));
    if (pct) { lo = 0; hi = 100; } else { if (hi - lo < 4) { hi += 2; lo -= 2; } lo = Math.floor(lo); hi = Math.ceil(hi); const st = Math.max(1, Math.ceil((hi - lo) / 4)); hi = lo + st * 4; }
    const X = (i) => l + (pts.length === 1 ? (W - l - r) / 2 : i * (W - l - r) / (pts.length - 1)), Y = (v) => t + (hi - v) * (Hh - t - b) / (hi - lo);
    let s = `<text x="${l}" y="18" font-size="17" font-weight="800" fill="#f4f7f2">${title}</text>`; for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; s += `<line x1="${l}" x2="${W - r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#33443a"/><text x="${l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="13" fill="#a9b8ad">${pct ? r0(v) + "%" : r0(v)}</text>`; }
    s += `<polyline fill="none" stroke="#3ddc84" stroke-width="3" points="${pts.map((p, i) => X(i) + "," + Y(p.y)).join(" ")}"/>`; pts.forEach((p, i) => { s += `<circle cx="${X(i)}" cy="${Y(p.y)}" r="5" fill="#3ddc84"/>`; });
    const st = Math.max(1, Math.ceil(pts.length / 6)); pts.forEach((p, i) => { if (i % st === 0 || i === pts.length - 1) s += `<text x="${X(i)}" y="${Hh - 9}" text-anchor="middle" font-size="13" fill="#a9b8ad">${esc(p.short)}</text>`; });
    return `<div class="chartbox"><svg viewBox="0 0 ${W} ${Hh}" style="width:100%;display:block">${s}</svg></div>`; }
  function trends(body) { const done = sorted().filter(r => roundStats(r).played === 18).reverse(); if (!done.length) { body.innerHTML = `<p class="note">Trends show up once you've finished a full round.</p>`; return; }
    const P = (f) => done.map(r => ({ y: f(roundStats(r)), short: r.date ? r.date.slice(5).replace("-", "/") : "#" + r.n }));
    const tots = done.map(r => roundStats(r).tot);
    body.innerHTML = `<div class="kpis"><div class="kpi"><div class="l">Rounds</div><div class="v">${done.length}</div></div><div class="kpi"><div class="l">Average</div><div class="v">${mean(tots).toFixed(1)}</div></div><div class="kpi"><div class="l">Best</div><div class="v">${Math.min(...tots)}</div></div></div>
      <div class="charts">${line("Score", P(s => s.tot))}${line("Putts", P(s => s.pts))}${line("Greens in regulation", P(s => s.girN ? 100 * s.gir / s.girN : 0), true)}${line("Fairways hit", P(s => s.fwN ? 100 * s.fw / s.fwN : 0), true)}</div>`; }
  return { open, loadRounds, roundStats };
})();
function openHistory() { Hist.open(); }
