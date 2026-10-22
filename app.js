"use strict";
// Cart Caddie for iPad. The caddie itself (club picks, shot patterns, hazards, slopes, your history) is the
// cart's own code compiled to WebAssembly (caddie.wasm); this file is the iPad screen around it.

const $ = (s, el = document) => el.querySelector(s);
const NINES = ["Heritage", "Champ", "Legends"];
const WIND_DIR = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const LIE = ["Tee", "Fairway", "Rough", "Tall grass", "Bunker", "Water", "Green", "Fringe", "Under the trees", "Out of bounds", "Blocked - punch out"];
const L_GREEN = 6;
const SH = { FAIR: 0, TALL: 1, WATER: 2, OB: 3, BUNKER: 4, TREE: 5, NOGO: 6, GREEN: 7 };
const PK_COL = ["#ffffff", "#f2b544", "#f2b544", "#c9883a", "#8a8f8c", "#ffffff", "#f2b544", "#f2b544", "#f2b544", "#f2b544", "#e9dcb0", "#4fc3f7", "#e63946", "#c77dff"];
const PQ_FT = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40];
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r0 = (v) => Math.round(v);

// ---------------- storage: everything the caddie saves lives in IndexedDB on the iPad ----------------
const KV = { map: new Map(), db: null };
function kvOpen() {
  return new Promise((res, rej) => { const q = indexedDB.open("cartcaddie-ipad", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("kv");
    q.onsuccess = () => { KV.db = q.result; const t = KV.db.transaction("kv").objectStore("kv"); const keys = t.getAllKeys(), vals = t.getAll();
      vals.onsuccess = () => { keys.result.forEach((k, i) => KV.map.set(k, vals.result[i])); res(); }; vals.onerror = () => rej(vals.error); };
    q.onerror = () => rej(q.error); });
}
function kvSet(k, v) { KV.map.set(k, v); try { KV.db.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch (e) { console.error(e); } }
function kvDel(k) { KV.map.delete(k); try { KV.db.transaction("kv", "readwrite").objectStore("kv").delete(k); } catch (e) {} }
const kvGet = (k, d) => KV.map.has(k) ? KV.map.get(k) : d;

// ---------------- the caddie (WebAssembly) ----------------
let WX = null;
const td = new TextDecoder();
const mem = () => WX.memory.buffer;
function cstr(p) { const u = new Uint8Array(mem()); let e = p; while (u[e]) e++; return td.decode(u.subarray(p, e)); }
const env = {
  js_load: (k, d) => { const v = KV.map.get("p:" + cstr(k)); return v === undefined ? d : v; },
  js_save: (k, v) => kvSet("p:" + cstr(k), v),
  js_fread: (n, b, m) => { const v = KV.map.get("f:" + cstr(n)); if (!v) return -1; const k = Math.min(m, v.length); new Uint8Array(mem(), b, k).set(v.subarray(0, k)); return k; },
  js_fwrite: (n, b, l) => { kvSet("f:" + cstr(n), new Uint8Array(mem(), b, l).slice()); return l; },
  js_fremove: (n) => kvDel("f:" + cstr(n)),
};
const wasi = { fd_close: () => 0, fd_seek: () => 0, proc_exit: () => 0,
  fd_write: (fd, iov, cnt, nw) => { const v = new DataView(mem()); let t = 0; for (let i = 0; i < cnt; i++) t += v.getUint32(iov + i * 8 + 4, true); v.setUint32(nw, t, true); return 0; } };
const out = (n) => td.decode(new Uint8Array(mem(), WX.ip_buf(), n));
const call = (fn, ...a) => WX[fn](...a);
const json = (fn, ...a) => JSON.parse(out(WX[fn](...a)));
let S = null;   // the caddie's view of the round and the current hole
function refresh() { S = json("ip_state"); }

// ---------------- app state ----------------
const UI = { view: "hole", user: { z: 1, dx: 0, dy: 0 }, lastHole: -1, lastPlacing: 0, showPins: false, placeZoom: 0, gps: null, gpsOn: false, you: null };
function act(fn, ...a) { const r = call(fn, ...a); refresh(); renderAll(); return r; }
let lastTick = performance.now();
setInterval(() => { if (!WX) return; const n = performance.now(); call("ip_tick", Math.max(1, Math.round(n - lastTick))); lastTick = n; }, 250);

// ---------------- map ----------------
const M = { cv: null, ctx: null, w: 0, h: 0, dpr: 1, v: { cx: 0, cy: 0, s: 1 }, paths: {}, heat: {}, arrows: {} };
const hole = () => COURSE.holes[S.hi];
const greenOf = () => { const h = hole(); return h.greens[h.greens.length > 1 ? (S.holes[S.rh].gsel % h.greens.length) : 0]; };
function sizeMap() { const r = M.cv.getBoundingClientRect(); M.dpr = window.devicePixelRatio || 1; M.w = r.width; M.h = r.height; M.cv.width = Math.round(r.width * M.dpr); M.cv.height = Math.round(r.height * M.dpr); }
const toS = (x, y) => [M.w / 2 + (x - M.v.cx) * M.v.s, M.h / 2 - (y - M.v.cy) * M.v.s];
const toW = (px, py) => [M.v.cx + (px - M.w / 2) / M.v.s, M.v.cy - (py - M.h / 2) / M.v.s];
function bboxPts(pts, b) { for (let i = 0; i < pts.length; i += 2) { const x = pts[i] / 10, y = pts[i + 1] / 10; b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); } return b; }
function fitView() {
  const b = [1e9, 1e9, -1e9, -1e9]; const add = (p) => { if (!p) return; b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); };
  const h = hole(), g = greenOf(), aim = S.opts && S.opts[S.sel] ? S.opts[S.sel].aim : null;
  let pad = 18, view = UI.view;
  if (S.placing) view = UI.placeZoom ? "hole" : "place";
  if (view === "green") { bboxPts(g.p, b); add(S.pin); if (aim && Math.hypot(aim[0] - S.pin[0], aim[1] - S.pin[1]) < 40) add(aim); if (S.toPin < 45) add(S.ball); pad = 6; }
  else if (view === "near") { add(S.ball); add(aim || S.pin); pad = 30; }
  else if (view === "place") { add(S.ball); add([S.ball[0] - 45, S.ball[1] - 45]); add([S.ball[0] + 45, S.ball[1] + 45]); pad = 0; }
  else { add(S.teePos); bboxPts(g.p, b); add(S.ball); add(aim); add(S.pin); pad = 14; }
  const top = 70, bot = S.placing ? 20 : 20;   // keep clear of the pills
  const bw = b[2] - b[0] + 2 * pad, bh = b[3] - b[1] + 2 * pad;
  let s = Math.min(M.w / bw, (M.h - top - bot) / bh); if (view === "green") s = Math.min(s, 22);
  let cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2 + (top - bot) / 2 / s;
  s *= UI.user.z; cx += UI.user.dx; cy += UI.user.dy;
  M.v = { cx, cy, s };
}
// rounded outline through the traced points (curves through the midpoints, like the cart's smoothing)
function smoothPath(pts) {
  const p = new Path2D(); const n = pts.length / 2; if (n < 3) return p;
  const X = (i) => pts[(i % n) * 2] / 10, Y = (i) => pts[(i % n) * 2 + 1] / 10;
  p.moveTo((X(n - 1) + X(0)) / 2, (Y(n - 1) + Y(0)) / 2);
  for (let i = 0; i < n; i++) p.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
  p.closePath(); return p;
}
function holePaths(hi) {
  if (M.paths[hi]) return M.paths[hi]; const h = COURSE.holes[hi];
  const P = { shapes: h.shapes.map(s => ({ t: s.t, p: s.t === SH.OB || s.t === SH.NOGO ? rawPath(s.p) : smoothPath(s.p) })), greens: h.greens.map(g => ({ p: smoothPath(g.p), b: g.bunkers.map(smoothPath) })) };
  return (M.paths[hi] = P);
}
function rawPath(pts) { const p = new Path2D(); for (let i = 0; i < pts.length; i += 2) (i ? p.lineTo : p.moveTo).call(p, pts[i] / 10, pts[i + 1] / 10); p.closePath(); return p; }
function pip(pts, x, y) { let c = false; const n = pts.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = pts[2 * i] / 10, yi = pts[2 * i + 1] / 10, xj = pts[2 * j] / 10, yj = pts[2 * j + 1] / 10; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
// slope colours: the yardage book's scale (blue 0-1, green 2-3, orange/red 4-5, purple 6-7+), same as the cart
const HEAT_AT = [0, 1, 1.8, 3.1, 3.6, 4.6, 5.6, 6.6], HEAT_C = [[40, 80, 190], [70, 160, 235], [85, 190, 90], [140, 200, 80], [240, 150, 70], [230, 85, 55], [200, 45, 70], [130, 50, 170]];
function heatRGB(s) { if (s <= HEAT_AT[0]) return HEAT_C[0]; for (let i = 1; i < HEAT_AT.length; i++) if (s < HEAT_AT[i]) { const f = (s - HEAT_AT[i - 1]) / (HEAT_AT[i] - HEAT_AT[i - 1]); return HEAT_C[i - 1].map((c, k) => c * (1 - f) + HEAT_C[i][k] * f); } return HEAT_C[HEAT_C.length - 1]; }
function greenHeat(gi) {
  if (M.heat[gi]) return M.heat[gi]; const g = greenOf(); const b = bboxPts(g.p, [1e9, 1e9, -1e9, -1e9]); const st = 0.5;
  const x0 = b[0] - 1, y0 = b[1] - 1, nx = Math.ceil((b[2] - b[0] + 2) / st) + 1, ny = Math.ceil((b[3] - b[1] + 2) / st) + 1;
  const ptr = call("ip_heat", x0, y0, st, nx, ny); const f = new Float32Array(mem(), ptr, nx * ny * 3).slice();
  const c = document.createElement("canvas"); c.width = nx; c.height = ny; const cx = c.getContext("2d"); const img = cx.createImageData(nx, ny);
  let any = false;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = f[(j * nx + i) * 3]; const o = (j * nx + i) * 4; if (v < 0) continue; any = true; const [r, gg, bb] = heatRGB(v); img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = bb; img.data[o + 3] = 255; }
  cx.putImageData(img, 0, 0);
  // arrows every 2.5 yds
  const as = 2.5, ax0 = Math.floor(b[0] / as) * as, ay0 = Math.floor(b[1] / as) * as, anx = Math.ceil((b[2] - ax0) / as) + 1, any2 = Math.ceil((b[3] - ay0) / as) + 1;
  const ap = call("ip_heat", ax0, ay0, as, anx, any2); const af = new Float32Array(mem(), ap, anx * any2 * 3).slice(); const arrows = [];
  for (let j = 0; j < any2; j++) for (let i = 0; i < anx; i++) { const k = (j * anx + i) * 3, x = ax0 + i * as, y = ay0 + j * as; if (af[k] < 1.05 || !pip(g.p, x, y)) continue; arrows.push([x, y, af[k], af[k + 1], af[k + 2]]); }
  return (M.heat[gi] = { canvas: any ? c : null, x0, y0, w: nx * st, h: ny * st, st, arrows });
}
function drawMap() {
  if (!S || S.scr === 0) return; if (M.cv.clientWidth !== M.w || M.cv.clientHeight !== M.h) sizeMap(); if (!M.w || !M.h) return;
  const ctx = M.ctx, h = hole(), P = holePaths(S.hi), g = greenOf(); fitView();
  ctx.setTransform(M.dpr, 0, 0, M.dpr, 0, 0); ctx.fillStyle = "#23452a"; ctx.fillRect(0, 0, M.w, M.h);
  // yard space: y up
  const s = M.v.s; ctx.save(); ctx.setTransform(M.dpr * s, 0, 0, -M.dpr * s, M.dpr * (M.w / 2 - M.v.cx * s), M.dpr * (M.h / 2 + M.v.cy * s));
  const fill = { [SH.TALL]: "#6e7a3a", [SH.FAIR]: "#4e9a3e", [SH.OB]: "rgba(91,95,92,.55)", [SH.WATER]: "#2f78c4", [SH.BUNKER]: "#e9dcb0", [SH.TREE]: "#163a1c", [SH.NOGO]: null };
  const edge = { [SH.WATER]: "#8fd3ff", [SH.BUNKER]: "#b8a777", [SH.TREE]: "#2e6b33", [SH.OB]: "#ff6b5b", [SH.NOGO]: "#b070f0" };
  ctx.lineJoin = "round";
  for (const t of [SH.TALL, SH.FAIR, SH.OB, SH.WATER, SH.BUNKER, SH.TREE, SH.NOGO]) for (const sh of P.shapes) if (sh.t === t) {
    if (fill[t]) { ctx.fillStyle = fill[t]; ctx.fill(sh.p); }
    if (t === SH.NOGO) { ctx.save(); ctx.clip(sh.p); ctx.strokeStyle = "rgba(176,112,240,.55)"; ctx.lineWidth = 1.2 / s; const bb = [M.v.cx - M.w / s, M.v.cy - M.h / s, M.v.cx + M.w / s, M.v.cy + M.h / s]; ctx.beginPath(); for (let k = bb[0] - (bb[3] - bb[1]); k < bb[2]; k += 8 / s) { ctx.moveTo(k, bb[1]); ctx.lineTo(k + (bb[3] - bb[1]), bb[3]); } ctx.stroke(); ctx.restore(); }
    if (edge[t]) { ctx.strokeStyle = edge[t]; ctx.lineWidth = (t === SH.OB ? 2.5 : 1.3) / s; if (t === SH.OB || t === SH.NOGO) ctx.setLineDash([10 / s, 8 / s]); ctx.stroke(sh.p); ctx.setLineDash([]); } }
  P.greens.forEach((gp, i) => { ctx.fillStyle = "#86d96e"; ctx.fill(gp.p); for (const bp of gp.b) { ctx.fillStyle = "#e9dcb0"; ctx.fill(bp); ctx.strokeStyle = "#b8a777"; ctx.lineWidth = 1.3 / s; ctx.stroke(bp); } });
  for (const t of h.trees) { ctx.beginPath(); ctx.arc(t[0] / 10, t[1] / 10, Math.max(3 / s, t[2] / 10), 0, 7); ctx.fillStyle = "#163a1c"; ctx.fill(); ctx.strokeStyle = "#2e6b33"; ctx.lineWidth = 1.2 / s; ctx.stroke(); }
  // slope heat on the green you're playing to, once it's big enough to read
  const gp = P.greens[h.greens.indexOf(g)] || P.greens[0];
  if (s > 4) { const H = greenHeat(S.gi); if (H.canvas) { ctx.save(); ctx.clip(gp.p); ctx.imageSmoothingEnabled = true; ctx.drawImage(H.canvas, H.x0 - H.st / 2, H.y0 - H.st / 2, H.w, H.h); ctx.restore(); } }
  ctx.strokeStyle = "rgba(220,255,210,.85)"; ctx.lineWidth = 1.6 / s; ctx.stroke(gp.p);
  ctx.restore(); ctx.setTransform(M.dpr, 0, 0, M.dpr, 0, 0);
  // tees
  h.tees.forEach((t, i) => { const on = i === S.tee; const [x, y] = toS(t[0] / 10, t[1] / 10); ctx.fillStyle = on ? "#c8f0b0" : "#6fa35e"; ctx.beginPath(); ctx.roundRect(x - 9, y - 5, 18, 10, 3); ctx.fill(); if (on) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); } });
  // slope arrows (screen space so they stay crisp)
  if (s > 9) { const H = greenHeat(S.gi); ctx.strokeStyle = "rgba(10,10,10,.85)"; ctx.fillStyle = "rgba(10,10,10,.85)"; ctx.lineWidth = 1.6;
    for (const [x, y, sv, dx, dy] of H.arrows) { const [ax, ay] = toS(x, y); const L = Math.min(0.9 + 0.25 * sv, 2) * s * 0.5; const ex = ax + dx * L, ey = ay - dy * L;
      ctx.beginPath(); ctx.moveTo(ax - dx * L, ay + dy * L); ctx.lineTo(ex, ey); ctx.stroke(); ctx.beginPath(); ctx.moveTo(ex + dx * 6, ey - dy * 6); ctx.lineTo(ex - dy * 4.5 - dx * 2, ey - dx * 4.5 + dy * 2); ctx.lineTo(ex + dy * 4.5 - dx * 2, ey + dx * 4.5 + dy * 2); ctx.closePath(); ctx.fill(); } }
  const view = S.placing ? "place" : UI.view;
  // distance lines across the green from your ball (green view, ball off the green)
  if (view === "green" && S.lieNow !== L_GREEN && S.toPin > 8) { ctx.save(); ctx.clip(new Path2D(gp.p), "nonzero"); ctx.restore();
    const steps = []; const gpts = g.p; let dmin = 1e9, dmax = 0; for (let i = 0; i < gpts.length; i += 2) { const d = Math.hypot(gpts[i] / 10 - S.ball[0], gpts[i + 1] / 10 - S.ball[1]); dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    const [bx, by] = toS(S.ball[0], S.ball[1]);
    ctx.save(); ctx.setTransform(M.dpr * s, 0, 0, -M.dpr * s, M.dpr * (M.w / 2 - M.v.cx * s), M.dpr * (M.h / 2 + M.v.cy * s)); ctx.clip(gp.p); ctx.setTransform(M.dpr, 0, 0, M.dpr, 0, 0);
    ctx.strokeStyle = "rgba(255,255,255,.75)"; ctx.lineWidth = 1.6; ctx.setLineDash([3, 5]);
    for (let d = Math.ceil(dmin / 5) * 5; d <= dmax; d += 5) { ctx.beginPath(); ctx.arc(bx, by, d * s, 0, 7); ctx.stroke(); steps.push(d); }
    ctx.restore(); ctx.setLineDash([]);
    const u = [S.pin[0] - S.ball[0], S.pin[1] - S.ball[1]], uL = Math.hypot(u[0], u[1]); u[0] /= uL; u[1] /= uL;
    for (const d of steps) { let best = null; for (let a = -1.2; a <= 1.2; a += 0.6 / d) { const c = Math.cos(a), sn = Math.sin(a); const x = S.ball[0] + (u[0] * c - u[1] * sn) * d, y = S.ball[1] + (u[0] * sn + u[1] * c) * d; if (!pip(gpts, x, y)) continue; const p = toS(x, y); if (!best || p[0] < best[0]) best = p; }
      if (best) tag(String(d), best[0] - 10, best[1], "rgba(8,14,10,.85)", "#fff", "right"); } }
  // distance arcs from the ball (hole view)
  if (view !== "green" && view !== "place") { const u = [S.pin[0] - S.ball[0], S.pin[1] - S.ball[1]], uL = Math.hypot(u[0], u[1]) || 1; u[0] /= uL; u[1] /= uL;
    ctx.strokeStyle = "rgba(220,235,220,.55)"; ctx.lineWidth = 2; ctx.setLineDash([2, 6]);
    for (let d = 100; d <= 300; d += 50) { if (d > S.toPin - 15) break; ctx.beginPath(); for (let a = -0.35; a <= 0.351; a += 0.02) { const c = Math.cos(a), sn = Math.sin(a); const [px, py] = toS(S.ball[0] + (u[0] * c - u[1] * sn) * d, S.ball[1] + (u[0] * sn + u[1] * c) * d); a === -0.35 ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke();
      const [lx, ly] = toS(S.ball[0] + u[0] * d, S.ball[1] + u[1] * d); ctx.setLineDash([]); text(String(d), lx + 6, ly - 10, "rgba(220,235,220,.9)", 15, "left"); ctx.setLineDash([2, 6]); }
    ctx.setLineDash([]); }
  // your shots so far
  for (const sh of S.shots) { const [ax, ay] = toS(sh.from[0], sh.from[1]), [cx, cy] = toS(sh.fin[0], sh.fin[1]);
    if (!sh.drop) { ctx.strokeStyle = sh.pen ? "rgba(255,120,110,.9)" : "rgba(242,245,240,.85)"; ctx.lineWidth = 2.5; ctx.setLineDash([7, 6]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cx, cy); ctx.stroke(); ctx.setLineDash([]); } }
  S.shots.forEach((sh, i) => { if (i === S.shots.length - 1 && !S.placing) return; const [cx, cy] = toS(sh.fin[0], sh.fin[1]); disc(cx - 18, cy - 16, 13, "#111"); ring(cx - 18, cy - 16, 13, sh.pen ? "#ff6b5b" : "#f2b544", 2); text(sh.drop ? "D" : String(sh.no), cx - 18, cy - 16, sh.pen ? "#ff6b5b" : "#f2b544", 16, "center", true); disc(cx, cy, 4, "#d8e0d8"); });
  // hazard numbers on your line
  if (!S.placing && UI.view !== "green" && S.haz) for (const z of S.haz) { if (/^Bl/.test(z.name)) continue; const [x, y] = toS(z.at[0], z.at[1]);
    const t = z.carry - z.reach < 4 ? String(z.reach) : `${z.reach}-${z.carry}`; const bg = z.name[0] === "W" ? "#14406e" : z.name[0] === "B" ? "#5a4a22" : z.name[0] === "O" ? "#7a1e26" : "#4a2a6e";
    tag(t, z.side === "L" ? x - 10 : x + 10, y, bg, "#fff", z.side === "L" ? "right" : "left"); }
  // the shot you're about to hit: line, landing area, the 80-shot pattern, target ring
  const o = S.opts && S.opts[S.sel];
  const [bx, by] = toS(S.ball[0], S.ball[1]), [px, py] = toS(S.pin[0], S.pin[1]);
  if (!S.placing && o && S.lie !== L_GREEN) {
    const [ax, ay] = toS(o.aim[0], o.aim[1]);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.strokeStyle = "rgba(221,238,221,.8)"; ctx.lineWidth = 2; ctx.setLineDash([6, 7]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]);
    if (S.pat && S.dots) for (const [x, y, k] of S.pat) { const [qx, qy] = toS(x, y); if (S.dots === 2) { disc(qx, qy, 5.5, "#000"); disc(qx, qy, 4.2, PK_COL[k]); } else { disc(qx, qy, 3, PK_COL[k]); } }
    const ux = o.aim[0] - S.ball[0], uy = o.aim[1] - S.ball[1]; const rot = Math.atan2(-uy, ux);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.ellipse(ax, ay, Math.max(10, o.sdL * s), Math.max(10, o.sdX * s), rot, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ring(ax, ay, 16, "#fff", 3); disc(ax, ay, 7, "#3ddc84");
    const lx = ax + Math.max(10, o.sdX * s, o.sdL * s) + 14; tag(`${r0(o.dist)} yds`, lx, ay - 14, "rgba(8,14,10,.88)", "#fff", "left", 18);
    if (S.toPin - o.dist > 25) tag(`leaves ${r0(S.leave > 0 ? S.leave : o.left)}`, lx, ay + 16, "rgba(15,42,28,.92)", "#3ddc84", "left", 18);
  } else if (!S.placing && S.lie !== L_GREEN) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px, py); ctx.stroke(); }
  if (S.lie === L_GREEN && !S.placing) { ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.lineWidth = 2; ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px, py); ctx.stroke(); ctx.setLineDash([]); }
  // all 5 pins while choosing today's pin
  if (UI.showPins) S.pins.forEach((p, i) => { const [x, y] = toS(p[0], p[1]); flag(x, y, i === S.pinDay ? "#f2b544" : "#ffffff"); disc(x, y, 12, "#111"); text(String(i + 1), x, y, i === S.pinDay ? "#f2b544" : "#fff", 15, "center", true); });
  else flag(px, py, "#ff6b5b");
  // you (iPad location)
  if (UI.you && UI.you.near) { const [x, y] = toS(UI.you.x, UI.you.y); const acc = UI.gps ? UI.gps.acc * 1.0936 * s : 0; if (acc > 12) { ctx.fillStyle = "rgba(108,198,255,.16)"; ctx.beginPath(); ctx.arc(x, y, acc, 0, 7); ctx.fill(); } disc(x, y, 10, "#fff"); disc(x, y, 7.5, "#2f8cff"); }
  // the ball
  disc(bx, by, 11, "#111"); disc(bx, by, 8, "#fff");
  if (S.placing && S.nShots) { const [x, y] = toS(S.ball[0], S.ball[1]); ring(x, y, 26, "rgba(242,181,68,.9)", 3); }
  windBadge();
}
function disc(x, y, r, c) { const ctx = M.ctx; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
function ring(x, y, r, c, w) { const ctx = M.ctx; ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
function text(t, x, y, c, size, align, bold) { const ctx = M.ctx; ctx.font = `${bold ? 800 : 700} ${size}px -apple-system, system-ui, sans-serif`; ctx.fillStyle = c; ctx.textAlign = align || "left"; ctx.textBaseline = "middle"; ctx.fillText(t, x, y); }
function tag(t, x, y, bg, fg, align, size = 17) { const ctx = M.ctx; ctx.font = `800 ${size}px -apple-system, system-ui, sans-serif`; const w = ctx.measureText(t).width + 14, h = size + 10; let x0 = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  x0 = Math.max(4, Math.min(M.w - w - 4, x0)); const y0 = Math.max(4, Math.min(M.h - h - 4, y - h / 2)); ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 7); ctx.fill(); ctx.fillStyle = fg; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(t, x0 + 7, y0 + h / 2 + 1); }
function flag(x, y, c) { const ctx = M.ctx; ctx.strokeStyle = "#111"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 38); ctx.stroke(); ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(x + 1, y - 38); ctx.lineTo(x + 26, y - 30); ctx.lineTo(x + 1, y - 22); ctx.closePath(); ctx.fill(); disc(x, y, 4, "#fff"); }
function windBadge() {
  if (!S.windSpd || S.placing) return; const ctx = M.ctx; const cx = M.w - 56, cy = 112; disc(cx, cy, 40, "rgba(8,14,10,.85)"); ring(cx, cy, 40, "#4fc3f7", 2.5);
  const d = [S.windTo[0], -S.windTo[1]]; const L = Math.hypot(d[0], d[1]) || 1; d[0] /= L; d[1] /= L;
  ctx.strokeStyle = "#4fc3f7"; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(cx - d[0] * 24, cy - d[1] * 24); ctx.lineTo(cx + d[0] * 18, cy + d[1] * 18); ctx.stroke();
  ctx.fillStyle = "#4fc3f7"; ctx.beginPath(); ctx.moveTo(cx + d[0] * 30, cy + d[1] * 30); ctx.lineTo(cx + d[0] * 14 - d[1] * 11, cy + d[1] * 14 + d[0] * 11); ctx.lineTo(cx + d[0] * 14 + d[1] * 11, cy + d[1] * 14 - d[0] * 11); ctx.closePath(); ctx.fill();
  tag(`${S.windSpd} mph`, cx, cy + 56, "rgba(8,14,10,.85)", "#4fc3f7", "center", 16);
}

// map touch: tap to aim (or place your ball), drag the target / ball, pinch to zoom, drag with one finger to pan
const PT = new Map(); let gesture = null; let rafPending = false;
function mapDown(e) { M.cv.setPointerCapture(e.pointerId); PT.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (PT.size === 2) { const [a, b] = [...PT.values()]; gesture = { kind: "pinch", d0: Math.hypot(a[0] - b[0], a[1] - b[1]), z0: UI.user.z, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], c0: [M.v.cx, M.v.cy], dx0: UI.user.dx, dy0: UI.user.dy }; return; }
  if (PT.size > 2) return;
  const x = e.offsetX, y = e.offsetY; let kind = "tap";
  gesture = { kind, x0: x, y0: y, moved: false, t0: performance.now() };
}
function mapMove(e) { if (!PT.has(e.pointerId)) return; PT.set(e.pointerId, [e.offsetX, e.offsetY]); if (!gesture) return;
  if (gesture.kind === "pinch" && PT.size === 2) { const [a, b] = [...PT.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); UI.user.z = Math.max(0.6, Math.min(12, gesture.z0 * d / gesture.d0));
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const s = M.v.s / (M.v.s ? 1 : 1); UI.user.dx = gesture.dx0 - (m[0] - gesture.m0[0]) / (M.v.s || 1); UI.user.dy = gesture.dy0 + (m[1] - gesture.m0[1]) / (M.v.s || 1); schedule(); return; }
  const x = e.offsetX, y = e.offsetY;
  if (!gesture.moved && Math.hypot(x - gesture.x0, y - gesture.y0) > 12) { gesture.moved = true;
    const o = S.opts && S.opts[S.sel];
    if (S.placing) gesture.kind = "ball";
    else if (o && S.lie !== L_GREEN) { const [ax, ay] = toS(o.aim[0], o.aim[1]); gesture.kind = Math.hypot(ax - gesture.x0, ay - gesture.y0) < 80 ? "aim" : "pan"; }
    else gesture.kind = "pan";
    gesture.v0 = { ...M.v }; gesture.dx0 = UI.user.dx; gesture.dy0 = UI.user.dy; }
  if (!gesture.moved) return;
  if (gesture.kind === "pan") { UI.user.dx = gesture.dx0 - (x - gesture.x0) / M.v.s; UI.user.dy = gesture.dy0 + (y - gesture.y0) / M.v.s; schedule(); return; }
  gesture.last = toW(x, y);
  if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; if (!gesture || !gesture.last) return; const [wx, wy] = gesture.last;
      if (gesture.kind === "ball") call("ip_place", wx, wy, 0); else if (gesture.kind === "aim") call("ip_aim", wx, wy, 1); refresh(); drawMap(); }); }
}
function mapUp(e) { PT.delete(e.pointerId); if (!gesture) return;
  if (gesture.kind === "pinch") { if (PT.size === 0) gesture = null; return; }
  const g = gesture; gesture = null; const [wx, wy] = toW(e.offsetX, e.offsetY);
  if (!g.moved) { if (UI.showPins) return; if (S.placing) act("ip_place", wx, wy, 1); else if (S.lie !== L_GREEN && !S.holes[S.rh].score) act("ip_aim", wx, wy, 0); return; }
  if (g.kind === "ball") act("ip_place", wx, wy, 1); else if (g.kind === "aim") act("ip_aim", wx, wy, 0);
}
function schedule() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; drawMap(); }); }

// ---------------- the side panel ----------------
function toParHTML() { if (!S.toPar) return ""; const c = S.toPar === "E" ? "even" : S.toPar[0] === "+" ? "over" : "under"; return `<span class="${c}">${S.toPar}</span>`; }
function headerHTML() {
  const h = hole(), sc = S.holes[S.rh].score;
  return `<div class="hdr"><div class="hn">${S.rh + 1}</div><div><div class="hsub">${NINES[Math.floor(S.hi / 9)]} ${h.num} &middot; par ${S.par} &middot; ${S.card} yds</div><div class="topar">${toParHTML()}</div></div>
    <div class="shot ${sc ? "done" : ""}">${sc ? "SCORED " + sc : "SHOT " + S.nextShot}</div></div>`;
}
function sideNormal() {
  const o = S.opts && S.opts[S.sel], sc = S.holes[S.rh].score, onG = S.lieNow === L_GREEN;
  let h = headerHTML();
  const pinTxt = onG ? `${r0(S.toPin * 3)}'` : r0(S.toPin);
  h += `<div class="dist"><div><div class="l">FRONT</div><div class="v">${r0(S.dFront)}</div></div>
    <button class="pinbtn" id="bLaser"><div class="l">PIN ${S.pinDay + 1}</div><div class="v">${pinTxt}</div><div class="s ${S.lasered ? "gold" : ""}">${S.lasered ? "lasered" : onG ? "feet - tap to enter" : Math.abs(r0(S.plays) - r0(S.toPin)) >= 2 ? "plays " + r0(S.plays) : "tap to laser"}</div></button>
    <div><div class="l">BACK</div><div class="v">${r0(S.dBack)}</div></div></div>`;
  if (UI.you && UI.you.near && UI.gpsOn) h += `<div class="gpsline">From you (GPS): <b>${r0(UI.you.toPin)} to the pin</b></div>`;
  if (S.pendingDrop) h += `<div class="card pen"><div class="k">PENALTY +1</div><div class="big">${LIE[S.lastLie] || "Drop"}</div><div class="pat">Tap the map where you drop</div></div>`;
  else if (sc) h += `<div class="card"><div class="k">HOLE DONE</div><div class="big">Scored ${sc} &middot; ${S.holes[S.rh].putts} putt${S.holes[S.rh].putts === 1 ? "" : "s"}</div><div class="pat">Tap Edit to change it</div></div>`;
  else if (S.lie === L_GREEN) { const sl = S.slope; let t = "Fairly flat"; if (sl && sl.sev >= 0.6) { t = sl.along > 0.4 ? "Downhill" : sl.along < -0.4 ? "Uphill" : "Sidehill"; t += sl.cross > 0.3 ? ", breaks right" : sl.cross < -0.3 ? ", breaks left" : ""; }
    h += `<div class="card"><div class="k">ON THE GREEN</div><div class="big">${r0(S.toPin * 3)} ft to the hole</div><div class="pat">${t}</div></div>`; }
  else if (o) { const pt = [3, 4, 5].includes(o.kind);
    let right = ""; if (o.custom || o.layup) right = `${r0(o.dist)} to target`; else if (Math.abs(r0(S.plays) - r0(S.toPin)) >= 2) right = `pin plays ${r0(S.plays)}`;
    const wind = S.windSpd ? `Wind ${S.windHead >= 0 ? "into" : "helping"} ${r0(Math.abs(S.windHead))}, ${S.windCross >= 0 ? "L-R" : "R-L"} ${r0(Math.abs(S.windCross))}` : "";
    h += `<div class="card"><div class="k"><span>CADDIE &middot; ${o.custom ? "your target" : esc(LIE[S.lie])}</span><span class="r">${right}</span></div>
      <div class="big">${o.kind === 6 ? `Putter &middot; ${r0(o.dist * 3)} ft` : `${esc(o.name)} &middot; ${pt ? "play to" : "carry"} ${r0(pt ? o.plays : o.carry)}`}</div>
      <div class="pat">${esc(S.patLine || "")}${wind ? `<br>${wind}` : ""}</div></div>`; }
  if (!sc) {
    if (S.lie === L_GREEN) { h += `<div class="putts">${[1, 2, 3, 4].map(n => `<button data-putts="${n}">${n} putt${n > 1 ? "s" : ""} = ${S.strokes + n}</button>`).join("")}</div>`; }
    else if (S.opts) { h += `<div class="chips">${S.opts.slice(0, 5).map((p, i) => `<button class="chip ${i === S.sel ? "on" : ""}" data-opt="${i}"><span class="n">${esc(p.short)}</span><span class="c">${p.kind === 6 ? r0(p.dist * 3) + " ft" : (p.layup ? "lay " : p.swing === 1 ? "3/4 " : p.swing === 2 ? "1/2 " : p.swing === 5 ? "punch " : "") + r0(p.layup ? p.dist : p.carry)}</span></button>`).join("")}<button class="chip bag" id="bBag">BAG</button></div>`; }
  }
  h += `<div class="spacer"></div>`;
  if (!sc && !S.pendingDrop) h += S.lie === L_GREEN ? `<button class="hit ghost" id="bHit">Not on the green? Place ball</button>` : `<button class="hit acc" id="bHit">HIT SHOT ${S.nextShot}</button>`;
  if (S.pendingDrop) h += `<button class="hit gold" id="bDropPlace">Tap the map where you drop</button>`;
  h += `<div class="row r3 nav"><button id="bView">${UI.view === "green" ? "HOLE" : "GREEN"}</button><button id="bZoom">${UI.view === "near" ? "WHOLE" : "ZOOM"}</button><button id="bPin">PIN ${S.pinDay + 1}</button></div>
    <div class="row r4 nav"><button id="bPrev">&lsaquo; ${((S.rh + 17) % 18) + 1}</button><button id="bEdit">${sc ? "EDIT" : "UNDO"}</button><button id="bMenu">MENU</button><button id="bNext">${((S.rh + 1) % 18) + 1} &rsaquo;</button></div>`;
  return h;
}
function sidePlacing() {
  const last = S.nShots - 1; const sn = S.nShots ? S.lastNo : S.nextShot;
  let t1; if (S.adjusting && S.nShots && S.lastDrop) t1 = `Your drop - next is shot ${S.strokes + 1}`; else if (S.adjusting) t1 = S.lasered ? `Shot ${sn}: slide it left / right` : `Where did shot ${sn} finish?`; else t1 = S.pendingDrop ? "Penalty: tap where you drop" : `Where did shot ${S.nextShot} finish?`;
  const t2 = S.nShots || S.startSet ? (S.lieNow === L_GREEN ? `${r0(S.toPin * 3)} ft to the hole - Green` : `${r0(S.toPin)} to pin - ${esc(S.lieName)}`) : "";
  let h = headerHTML();
  h += `<div class="banner"><div class="t">${t1}</div><div class="s">${t2}</div><div class="h">Tap the map, drag the ball, or use the arrows (hold for 5 yds).</div></div>`;
  if (UI.gpsOn && UI.you && UI.you.near) h += `<button class="acc" id="bMark" style="min-height:66px">Ball is here - use my location</button>`;
  h += `<div class="pad">${["&lsaquo; LEFT", "SHORT", "LONG", "RIGHT &rsaquo;"].map((t, i) => `<button data-nudge="${i}" ${!S.adjusting ? "disabled" : ""}>${t}</button>`).join("")}</div>`;
  const canHoled = S.adjusting && S.nShots && !S.pendingDrop && !S.lastDrop;
  h += `<div class="row r2"><button id="bLaser2" ${S.nShots || S.startSet ? "" : "disabled"}>LASER</button><button class="redb" id="bPen" ${S.nShots ? "" : "disabled"}>PENALTY</button></div>`;
  h += `<div class="row r2"><button id="bHoled" class="gold" ${canHoled ? "" : "disabled"}>HOLED IT</button><button id="bPZoom">${UI.placeZoom ? "ZOOM IN" : "WHOLE HOLE"}</button></div>`;
  h += `<div class="spacer"></div><div class="row r2"><button id="bUndo" ${S.nShots ? "" : "disabled"} style="min-height:84px">UNDO</button><button class="acc hit" id="bDone">DONE</button></div>`;
  return h;
}
function renderSide() {
  const side = $("#side"); side.innerHTML = S.placing ? sidePlacing() : sideNormal();
  const on = (id, f) => { const b = $("#" + id, side); if (b) b.onclick = f; };
  on("bLaser", openLaser); on("bLaser2", openLaser); on("bBag", openBag); on("bHit", () => { UI.user = { z: 1, dx: 0, dy: 0 }; act("ip_hit"); });
  on("bDropPlace", () => toast("Tap the map where you dropped"));
  on("bView", () => { UI.view = UI.view === "green" ? "hole" : "green"; UI.user = { z: 1, dx: 0, dy: 0 }; renderAll(); });
  on("bZoom", () => { UI.view = UI.view === "near" ? "hole" : "near"; UI.user = { z: 1, dx: 0, dy: 0 }; renderAll(); });
  on("bPin", openPin); on("bMenu", openMenu); on("bPrev", () => gotoHole(S.rh - 1)); on("bNext", () => gotoHole(S.rh + 1));
  on("bEdit", () => { if (S.holes[S.rh].score) openEdit(S.rh); else if (S.nShots) act("ip_undo"); else toast("No shots on this hole yet"); });
  on("bPen", openPenalty); on("bHoled", () => { act("ip_holed"); afterScore(); }); on("bPZoom", () => { UI.placeZoom ^= 1; renderAll(); });
  on("bUndo", () => act("ip_undo")); on("bDone", () => { call("ip_done"); refresh(); UI.user = { z: 1, dx: 0, dy: 0 }; if (!S.placing) UI.view = S.toPin <= 70 ? "green" : "near"; renderAll(); });
  on("bMark", () => { act("ip_place", UI.you.x, UI.you.y, 1); toast("Ball placed at your location"); });
  side.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => act("ip_opt", +b.dataset.opt));
  side.querySelectorAll("[data-putts]").forEach(b => b.onclick = () => { const n = +b.dataset.putts; const ask = act("ip_putts", n); if (ask) openPutt2(); else afterScore(); });
  side.querySelectorAll("[data-nudge]").forEach(b => { let tmr = null, rep = null; const k = +b.dataset.nudge;
    b.onpointerdown = () => { act("ip_nudge", k, 1); tmr = setTimeout(() => { rep = setInterval(() => act("ip_nudge", k, 5), 260); }, 450); };
    b.onpointerup = b.onpointerleave = b.onpointercancel = () => { clearTimeout(tmr); clearInterval(rep); }; b.onclick = null; });
  $("#maptools").innerHTML = S.placing ? "" : `<button class="pill ${S.dots ? "on" : ""}" id="pDots">${["Dots off", "Dots small", "Dots big"][S.dots]}</button>${hole().greens.length > 1 ? hole().greens.map((g, i) => `<button class="pill ${S.holes[S.rh].gsel % hole().greens.length === i ? "on" : ""}" data-green="${i}">${esc(g.name)}</button>`).join("") : ""}${UI.user.z !== 1 || UI.user.dx || UI.user.dy ? `<button class="pill" id="pReset">Reset view</button>` : ""}`;
  const pd = $("#pDots"); if (pd) pd.onclick = () => act("ip_dots", (S.dots + 1) % 3);
  const pr = $("#pReset"); if (pr) pr.onclick = () => { UI.user = { z: 1, dx: 0, dy: 0 }; renderAll(); };
  document.querySelectorAll("[data-green]").forEach(b => b.onclick = () => { M.heat = {}; act("ip_green", +b.dataset.green); });
  $("#mapnote").textContent = S.placing ? (S.adjusting ? "" : S.pendingDrop ? "Tap where you drop" : "Tap where the ball finished") : "";
}
function gotoHole(r) { UI.view = "hole"; UI.user = { z: 1, dx: 0, dy: 0 }; act("ip_goto", (r + 18) % 18); }
function afterScore() { if (S.allScored || S.scr === 14) { showRoundDone(); return; } UI.view = "hole"; UI.user = { z: 1, dx: 0, dy: 0 }; renderAll(); }
function renderAll() {
  if (!S) return;
  if (S.scr === 0) { show("setup"); renderSetup(); return; }
  if (S.scr === 14 && !UI.reviewing) { showRoundDone(); return; }
  show("play");
  if (S.rh !== UI.lastHole) { UI.lastHole = S.rh; UI.view = "hole"; UI.user = { z: 1, dx: 0, dy: 0 }; }
  if (S.placing !== UI.lastPlacing) { UI.lastPlacing = S.placing; UI.user = { z: 1, dx: 0, dy: 0 }; if (!S.placing) UI.placeZoom = 0; }
  if (S.lieNow === L_GREEN && !S.placing && UI.view === "hole" && !UI.greenAuto) { UI.view = "green"; UI.greenAuto = S.rh; }
  if (UI.greenAuto !== undefined && UI.greenAuto !== S.rh) UI.greenAuto = undefined;
  updateYou(); renderSide(); drawMap(); keepAwake();
}
function show(id) { for (const p of ["play", "setup", "history"]) $("#" + p).hidden = p !== id; $("#boot").hidden = true; }
function toast(t, ms = 2200) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => el.hidden = true, ms); }

// ---------------- dialogs ----------------
function ask(title, msg, yes, onYes) { openModal(`<div class="top"><h3>${esc(title)}</h3></div><p>${esc(msg)}</p><div class="row r2"><button data-close class="ghost">Cancel</button><button class="acc" id="askYes">${esc(yes)}</button></div>`, true, (sh) => { $("#askYes", sh).onclick = () => { closeModal(); onYes(); }; }); }
function openModal(html, narrow, bind) { const m = $("#modal"), sh = $("#sheet"); m.style.placeItems = ""; m.style.background = ""; sh.className = "sheet" + (narrow ? " narrow" : ""); sh.innerHTML = html; m.hidden = false; m.onclick = (e) => { if (e.target === m) closeModal(); }; const c = sh.querySelector("[data-close]"); if (c) c.onclick = closeModal; if (bind) bind(sh); }
function closeModal() { $("#modal").hidden = true; $("#sheet").innerHTML = ""; if (UI.showPins) { UI.showPins = false; drawMap(); } }
// laser / pace it off
function openLaser() {
  let buf = "", ft = !!S.laserFt; const was = S.toPin;
  const draw = (sh) => { $(".num", sh).textContent = buf || "---"; $(".num", sh).style.color = buf ? "" : "var(--muted)"; $("#uY", sh).className = ft ? "" : "on"; $("#uF", sh).className = ft ? "on" : ""; $("#lt", sh).textContent = ft ? "Feet to the hole" : "Yards to the pin"; $("#lw", sh).textContent = `Map says ${ft ? r0(was * 3) + " ft" : r0(was) + " yds"}`; };
  openModal(`<div class="top"><h3 id="lt"></h3><button data-close class="ghost">Cancel</button></div><p class="note" id="lw"></p>
    <div class="readout"><div class="num">---</div><div class="unit"><button id="uY">YARDS</button><button id="uF">FEET</button></div></div>
    <div class="keys">${["1", "2", "3", "4", "5", "6", "7", "8", "9", "&lsaquo;", "0", "OK"].map((k, i) => `<button data-k="${i}" class="${i === 11 ? "acc" : ""}">${k}</button>`).join("")}</div>
    <p class="note">Straight number (slope off). Your ball slides along the pin line to match it.</p>`, true, (sh) => {
    draw(sh); $("#uY", sh).onclick = () => { ft = false; draw(sh); }; $("#uF", sh).onclick = () => { ft = true; draw(sh); };
    sh.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { const i = +b.dataset.k;
      if (i === 9) buf = buf.slice(0, -1); else if (i === 11) { const d = parseInt(buf, 10); if (d >= 1 && d <= 700) { closeModal(); const done = act("ip_laser", d, ft ? 1 : 0); if (done) { UI.user = { z: 1, dx: 0, dy: 0 }; UI.view = S.toPin <= 70 ? "green" : "near"; renderAll(); toast(`Shot placed ${d} ${ft ? "ft" : "yds"} from the pin`); } } return; }
      else if (buf.length < 3) buf += String(i === 10 ? 0 : i + 1); draw(sh); }); });
}
function openBag() {
  const B = json("ip_bagState").clubs; const need = S.plays;
  openModal(`<div class="top"><h3>Your bag</h3><button data-close class="ghost">Close</button></div><p class="note">${r0(S.toPin)} to the pin - plays ${r0(S.plays)}. Tap a number to hit that club.</p>
    <table class="bag"><tr><th></th><th>Stock</th><th>3/4</th><th>1/2</th></tr>${B.map((c, ci) => c.kind === 6 ? `<tr><td class="name">${esc(c.name)}</td><td colspan="3"><button data-c="${ci}" data-s="0">Putt to the hole</button></td></tr>` :
      `<tr><td class="name">${esc(c.name)}</td>${[0, 1, 2].map(s => c.carry[s] < 0 ? `<td style="text-align:center;color:var(--muted)">-</td>` : `<td><button data-c="${ci}" data-s="${s}" class="${Math.abs(c.carry[s] - need) < 7 ? "near" : ""}">${c.carry[s]}</button></td>`).join("")}</tr>`).join("")}</table>`, false, (sh) => {
    sh.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { closeModal(); act("ip_bag", +b.dataset.c, +b.dataset.s); }); });
}
function openPenalty() {
  const n = S.lastNo; const T = [["Out of bounds", "+1, hit again from where you played it"], ["Lost ball", "+1, hit again from where you played it"], ["Penalty area (red / yellow)", "+1, then tap where you drop"], ["Unplayable", "+1, then tap where you drop"], ["No penalty", "clears any penalty on this shot"]];
  openModal(`<div class="top"><h3>Shot ${n}: penalty?</h3><button data-close class="ghost">Cancel</button></div><div class="opts">${T.map((t, i) => `<button data-p="${i}" class="${i < 4 ? "pen" : ""}"><span class="t">${t[0]}</span><span class="d">${t[1]}</span></button>`).join("")}</div>`, true, (sh) => {
    sh.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { closeModal(); act("ip_penalty", +b.dataset.p); toast(+b.dataset.p <= 1 ? `+1: you're playing shot ${S.nextShot} from the same spot` : +b.dataset.p <= 3 ? "+1: now tap where you drop" : "Penalty cleared"); }); });
}
function openPutt2() {
  const p = S.holes[S.rh].putts;
  openModal(`<div class="top"><h3>How long was your 2nd putt?</h3></div><p class="note">${p > 2 ? `Putts 3${p > 3 ? " and 4" : ""} count as 1 ft.` : "For your putting stats."}</p>
    <div class="keys" style="grid-template-columns:repeat(5,1fr)">${PQ_FT.map(f => `<button data-f="${f}" style="font-size:1.4rem">${f}${f === 40 ? "+" : ""} ft</button>`).join("")}</div>
    <p><button data-f="0" class="ghost" style="width:100%">Don't know - skip</button></p>`, false, (sh) => {
    sh.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { closeModal(); act("ip_putt2", +b.dataset.f); afterScore(); }); });
}
function pinSheet(p) { const g = greenOf(); const f = [g.front[0] / 10, g.front[1] / 10], b = [g.back[0] / 10, g.back[1] / 10]; let u = [b[0] - f[0], b[1] - f[1]]; const L = Math.hypot(u[0], u[1]) || 1; u = [u[0] / L, u[1] / L]; const r = [u[1], -u[0]];
  const on = (p[0] - f[0]) * u[0] + (p[1] - f[1]) * u[1], lat = (p[0] - f[0]) * r[0] + (p[1] - f[1]) * r[1]; return `${r0(on)} on, ${Math.abs(lat) < 0.5 ? "centre" : r0(Math.abs(lat)) + (lat > 0 ? " right" : " left")}`; }
function openPin() {
  UI.showPins = true; UI.view = "green"; UI.user = { z: 1, dx: 0, dy: 0 }; renderAll();
  openModal(`<div class="top"><h3>Today's pin</h3><button data-close class="acc">Done</button></div><p class="note">The number you pick is used on every hole. The map shows all five on this green.</p>
    <div class="opts">${S.pins.map((p, i) => `<button data-pin="${i}" class="${i === S.pinDay ? "on" : ""}"><span class="t">Pin ${i + 1}</span><span class="d" style="${i === S.pinDay ? "color:inherit" : ""}">${pinSheet(p)}</span></button>`).join("")}</div>`, true, (sh) => {
    sh.querySelectorAll("[data-pin]").forEach(b => b.onclick = () => { act("ip_pin", +b.dataset.pin); sh.querySelectorAll("[data-pin]").forEach(x => x.className = +x.dataset.pin === S.pinDay ? "on" : ""); }); });
  $("#modal").style.placeItems = "center end"; $("#modal").style.background = "rgba(0,0,0,.12)";
}
function scorecardHTML(cur) {
  const half = (a) => { let p = 0, s = 0; for (let r = a; r < a + 9; r++) { p += S.holes[r].par; s += S.holes[r].score; } return [p, s]; };
  const [po, so] = half(0), [pi, si] = half(9);
  const cell = (r) => { const h = S.holes[r]; if (!h.score) return ""; const d = h.score - h.par; return `<span class="sc ${d <= -2 ? "e2" : d === -1 ? "e1" : d === 1 ? "b1" : d >= 2 ? "b2" : ""}">${h.score}</span>`; };
  const row = (lab, f, a, b) => `<tr><th>${lab}</th>${[...Array(9)].map((_, i) => f(i)).join("")}<td class="tot">${a}</td>${[...Array(9)].map((_, i) => f(i + 9)).join("")}<td class="tot">${b}</td><td class="tot">${typeof a === "number" && typeof b === "number" ? a + b : ""}</td></tr>`;
  return `<table class="scorecard"><tr><th>Hole</th>${[...Array(9)].map((_, i) => `<td class="h tap ${i === cur ? "cur" : ""}" data-h="${i}">${i + 1}</td>`).join("")}<th>Out</th>${[...Array(9)].map((_, i) => `<td class="h tap ${i + 9 === cur ? "cur" : ""}" data-h="${i + 9}">${i + 10}</td>`).join("")}<th>In</th><th>Tot</th></tr>
    ${row("Par", (r) => `<td>${S.holes[r].par}</td>`, po, pi)}${row("Score", (r) => `<td class="tap" data-h="${r}">${cell(r)}</td>`, so || "", si || "")}${row("Putts", (r) => `<td>${S.holes[r].score ? S.holes[r].putts : ""}</td>`, "", "")}</table>`;
}
function openMenu() {
  openModal(`<div class="top"><h3>Menu</h3><button data-close class="acc">Close</button></div>
    <h2 class="note" style="margin:6px 0">Scorecard - tap a hole to edit it</h2>${scorecardHTML(S.rh)}
    <h2 class="note" style="margin:14px 0 6px">Wind for the round (blowing from)</h2>
    <div class="stepper"><button id="wMinus">-</button><div id="wTxt"></div><button id="wPlus">+</button></div>
    <div class="compass" style="margin-top:8px">${WIND_DIR.map((d, i) => `<button data-w="${i}">${d}</button>`).join("")}</div>
    <h2 class="note" style="margin:14px 0 6px">Tee</h2><div class="seg">${[0, 1, 2, 3, 4].map(t => `<button data-tee="${t}" class="${t === S.tee ? "on" : ""}">${t + 1}</button>`).join("")}</div>
    <h2 class="note" style="margin:14px 0 6px">Location</h2><div class="seg"><button id="mGps" class="${UI.gpsOn ? "on" : ""}">${UI.gpsOn ? "Using iPad location" : "Use iPad location"}</button></div>
    <p class="note" id="gpsInfo"></p>
    <div class="menu-grid" style="margin-top:14px"><button id="mHist">Round history</button><button id="mNew">New round</button>${S.allScored ? `<button id="mDone" class="acc">Round summary</button>` : ""}<button id="mBackup">Backup &amp; export</button></div>`, false, (sh) => {
    const wt = () => { $("#wTxt", sh).textContent = S.windSpd ? `${S.windSpd} mph from ${WIND_DIR[S.windDir]}` : "Calm"; sh.querySelectorAll("[data-w]").forEach(b => b.className = S.windSpd && +b.dataset.w === S.windDir ? "on" : ""); };
    wt(); $("#wMinus", sh).onclick = () => { act("ip_wind", S.windSpd - 1, S.windDir); wt(); }; $("#wPlus", sh).onclick = () => { act("ip_wind", S.windSpd + 1, S.windDir); wt(); };
    sh.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { act("ip_wind", S.windSpd || 5, +b.dataset.w); wt(); });
    sh.querySelectorAll("[data-tee]").forEach(b => b.onclick = () => { act("ip_tee", +b.dataset.tee); sh.querySelectorAll("[data-tee]").forEach(x => x.className = +x.dataset.tee === S.tee ? "on" : ""); });
    sh.querySelectorAll("[data-h]").forEach(b => b.onclick = () => openEdit(+b.dataset.h));
    $("#mGps", sh).onclick = () => { setGps(!UI.gpsOn); closeModal(); };
    $("#gpsInfo", sh).textContent = gpsInfo();
    $("#mHist", sh).onclick = () => { closeModal(); openHistory(); };
    $("#mNew", sh).onclick = () => { const go = () => { closeModal(); act("ip_newRound"); }; if (S.hasData && !S.allScored) ask("Start a new round?", "The round you're playing is saved in your history as it is.", "New round", go); else go(); };
    const md = $("#mDone", sh); if (md) md.onclick = () => { closeModal(); showRoundDone(); };
    $("#mBackup", sh).onclick = () => { closeModal(); openBackup(); }; });
}
function openEdit(r) {
  let armed = false;
  const draw = (sh) => { const h = S.holes[r]; const sv = h.score ? h.score : "--";
    sh.innerHTML = `<div class="top"><h3>Edit hole ${r + 1}</h3><button data-close class="acc">Done</button></div><p class="note">${NINES[Math.floor(h.hi / 9)]} ${COURSE.holes[h.hi].num} - par ${h.par}</p>
      <div class="stepper" style="grid-template-columns:140px 72px 1fr 72px"><div style="text-align:left">Score</div><button id="sM">-</button><div style="font-size:2.4rem">${sv}</div><button id="sP">+</button></div>
      <div class="stepper" style="grid-template-columns:140px 72px 1fr 72px;margin-top:8px"><div style="text-align:left">Putts</div><button id="pM">-</button><div style="font-size:2.4rem">${h.putts}</div><button id="pP">+</button></div>
      ${h.score && h.score - h.putts !== h.strokes ? `<p class="note" style="color:var(--gold)">Shots on the map add up to ${h.strokes} before putting.</p>` : ""}
      <p class="note">${h.shots} shot${h.shots === 1 ? "" : "s"} placed on the map.</p>
      <div class="row r2"><button id="eChange">Change shots on the map</button><button id="eClear" class="redb">${armed ? "Tap again to clear" : "Clear hole"}</button></div>
      <div class="row r2" style="margin-top:8px"><button id="ePrev">&lsaquo; Hole ${((r + 17) % 18) + 1}</button><button id="eNext">Hole ${((r + 1) % 18) + 1} &rsaquo;</button></div>`;
    sh.querySelector("[data-close]").onclick = () => { closeModal(); if (UI.reviewing) showRoundDone(); };
    $("#sM", sh).onclick = () => { act("ip_editScore", r, -1); draw(sh); }; $("#sP", sh).onclick = () => { act("ip_editScore", r, 1); draw(sh); };
    $("#pM", sh).onclick = () => { act("ip_editPutts", r, -1); draw(sh); }; $("#pP", sh).onclick = () => { act("ip_editPutts", r, 1); draw(sh); };
    $("#eChange", sh).onclick = () => { closeModal(); UI.reviewing = false; act("ip_reopen", r); toast("Hole reopened: use UNDO / HIT SHOT, then enter putts again"); };
    $("#eClear", sh).onclick = () => { if (!armed) { armed = true; draw(sh); return; } act("ip_clearHole", r); armed = false; draw(sh); };
    $("#ePrev", sh).onclick = () => { r = (r + 17) % 18; armed = false; draw(sh); }; $("#eNext", sh).onclick = () => { r = (r + 1) % 18; armed = false; draw(sh); }; };
  openModal("", true, draw);
}

// ---------------- start a round ----------------
const SET = { front: 0, back: 1, tee: 2, start: 0, pin: 0 };
function renderSetup() {
  const el = $("#setup"); if (!renderSetup.init) { SET.front = S.front; SET.back = S.back; SET.tee = S.tee; SET.start = S.start; SET.pin = S.pinDay; renderSetup.init = true; }
  const yds = (t) => { let y = 0, p = 0; for (let r = 0; r < 18; r++) { const h = COURSE.holes[(r < 9 ? SET.front : SET.back) * 9 + r % 9]; y += h.card[t]; p += h.par; } return [y, p]; };
  const [y, par] = yds(SET.tee);
  el.innerHTML = `<h1>Start a round</h1><p class="note">Shangri-La - ${NINES[SET.front]} / ${NINES[SET.back]} - par ${par} - ${y} yds</p>
    <div class="setupgrid"><div>
      <h2>Front nine</h2><div class="seg">${NINES.map((n, i) => `<button data-f="${i}" class="${SET.front === i ? "on" : ""}">${n}</button>`).join("")}</div>
      <h2>Back nine</h2><div class="seg">${NINES.map((n, i) => `<button data-b="${i}" class="${SET.back === i ? "on" : ""}">${n}</button>`).join("")}</div>
      <h2>Start on</h2><div class="seg"><button data-s="0" class="${SET.start === 0 ? "on" : ""}">Hole 1</button><button data-s="9" class="${SET.start === 9 ? "on" : ""}">Hole 10</button></div>
    </div><div>
      <h2>Tee</h2><div class="seg">${[0, 1, 2, 3, 4].map(t => `<button data-t="${t}" class="${SET.tee === t ? "on" : ""}">${t + 1}<small>${yds(t)[0]}</small></button>`).join("")}</div>
      <h2>Pin (same on every hole)</h2><div class="seg">${[0, 1, 2, 3, 4].map(p => `<button data-p="${p}" class="${SET.pin === p ? "on" : ""}">${p + 1}</button>`).join("")}</div>
      <h2>Wind (blowing from)</h2><div class="stepper"><button id="wMinus">-</button><div>${S.windSpd ? `${S.windSpd} mph from ${WIND_DIR[S.windDir]}` : "Calm"}</div><button id="wPlus">+</button></div>
      <div class="compass" style="margin-top:8px">${WIND_DIR.map((d, i) => `<button data-w="${i}" class="${S.windSpd && S.windDir === i ? "on" : ""}">${d}</button>`).join("")}</div>
    </div></div>
    <div class="startbar"><button class="ghost" id="sHist" style="min-height:88px">Round history</button>${S.hasData && !S.allScored ? `<button id="sResume" style="min-height:88px">Back to my round</button>` : ""}<button class="acc go" id="sGo">START</button></div>`;
  el.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { const i = +b.dataset.f; if (SET.back === i) SET.back = SET.front; SET.front = i; renderSetup(); });
  el.querySelectorAll("[data-b]").forEach(b => b.onclick = () => { const i = +b.dataset.b; if (SET.front === i) SET.front = SET.back; SET.back = i; renderSetup(); });
  el.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { SET.start = +b.dataset.s; renderSetup(); });
  el.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { SET.tee = +b.dataset.t; renderSetup(); });
  el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { SET.pin = +b.dataset.p; renderSetup(); });
  el.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { call("ip_wind", S.windSpd || 5, +b.dataset.w); refresh(); renderSetup(); });
  $("#wMinus", el).onclick = () => { call("ip_wind", S.windSpd - 1, S.windDir); refresh(); renderSetup(); }; $("#wPlus", el).onclick = () => { call("ip_wind", S.windSpd + 1, S.windDir); refresh(); renderSetup(); };
  $("#sHist", el).onclick = openHistory;
  const rs = $("#sResume", el); if (rs) rs.onclick = () => { call("ip_goto", S.rh); refresh(); renderAll(); };
  $("#sGo", el).onclick = () => { const go = () => { call("ip_setup", SET.front, SET.back, SET.tee, SET.start, SET.pin); call("ip_start"); refresh(); kvSet("d:" + S.roundNo, todayISO()); renderSetup.init = false; UI.lastHole = -1; renderAll(); };
    if (S.hasData && !S.allScored) ask("Start a new round?", "The round you were playing is saved in your history as it is.", "Start", go); else go(); };
}
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

// ---------------- round complete ----------------
function showRoundDone() {
  UI.reviewing = true; show("history"); const el = $("#history");
  const R = Hist.loadRounds(); const live = R.find(r => r.live) || R[R.length - 1]; const st = live ? Hist.roundStats(live) : null;
  const tot = S.holes.reduce((a, h) => a + h.score, 0), par = S.holes.reduce((a, h) => a + h.par, 0), d = tot - par;
  const B = json("ip_bagState").clubs; const offers = []; B.forEach((c, ci) => [0, 1, 2].forEach(s => { if (c.offer[s]) offers.push(`${esc(c.name)}${s ? [" ", " 3/4", " 1/2"][s] : ""}: your bag says ${c.carry[s]}, playing ${c.offer[s]}`); }));
  el.innerHTML = `<h1>Round complete</h1><p class="note">${NINES[S.front]} / ${NINES[S.back]} - tee ${S.tee + 1}</p>
    <div style="display:flex;gap:18px;align-items:baseline"><span style="font:800 4.5rem var(--display)">${tot}</span><span style="font:800 2.6rem var(--display)" class="${d < 0 ? "under" : d > 0 ? "over" : "even"}">${d === 0 ? "E" : (d > 0 ? "+" : "") + d}</span><span class="note">par ${par}</span></div>
    ${st ? `<div class="kpis"><div class="kpi"><div class="l">Putts</div><div class="v">${st.pts}</div></div><div class="kpi"><div class="l">Greens</div><div class="v">${st.gir}/${st.girN}</div></div><div class="kpi"><div class="l">Fairways</div><div class="v">${st.fw}/${st.fwN}</div></div><div class="kpi"><div class="l">Penalties</div><div class="v">${st.pen}</div></div><div class="kpi"><div class="l">3-putts</div><div class="v">${st.three}</div></div></div>` : ""}
    <h2>Scorecard - tap a hole to fix it</h2>${scorecardHTML(-1)}
    <div class="card" style="margin-top:16px"><div class="k">WHAT THE CADDIE LEARNED</div><div class="big" style="font-size:1.4rem">${st ? st.meas : 0} shots measured this round</div><div class="pat">${offers.length ? offers.slice(0, 4).join("<br>") + "<br>Update them in Round history &rsaquo; Clubs." : "No bag changes to suggest yet."}</div></div>
    <div class="startbar"><button class="ghost" id="rBack" style="min-height:88px">Back to the map</button><button id="rHist" style="min-height:88px">Round history</button><button class="acc go" id="rFin">FINISH ROUND</button></div>`;
  el.querySelectorAll("[data-h]").forEach(b => b.onclick = () => openEdit(+b.dataset.h));
  $("#rBack", el).onclick = () => { UI.reviewing = false; call("ip_goto", S.rh); refresh(); renderAll(); UI.reviewing = false; };
  $("#rHist", el).onclick = openHistory;
  $("#rFin", el).onclick = () => { UI.reviewing = false; call("ip_finish"); refresh(); renderSetup.init = false; renderAll(); toast("Round saved in your history"); };
}

// ---------------- backup & export ----------------
function b64(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function openBackup() {
  openModal(`<div class="top"><h3>Backup &amp; export</h3><button data-close class="acc">Close</button></div>
    <p class="note">Everything (rounds, shots, bag, pins, settings) is stored on this iPad. Save a backup to Files or iCloud Drive now and then - "Save to Files" in the share sheet.</p>
    <div class="opts"><button id="bkSave"><span class="t">Save a backup</span><span class="d">cart-caddie-backup-${todayISO()}.json</span></button>
      <button id="bkRestore"><span class="t">Restore from a backup</span><span class="d">Replaces what's on this iPad</span></button>
      <button id="bkExport"><span class="t">Send rounds to the computer program</span><span class="d">A text file Cart Caddie Rounds can import (Import file)</span></button></div>
    <input type="file" id="bkFile" accept=".json,application/json" hidden>`, true, (sh) => {
    $("#bkSave", sh).onclick = () => { const o = {}; for (const [k, v] of KV.map) o[k] = v instanceof Uint8Array ? { b64: b64(v) } : v; shareFile(`cart-caddie-backup-${todayISO()}.json`, JSON.stringify({ app: "cart-caddie-ipad", v: 1, saved: new Date().toISOString(), kv: o }), "application/json"); };
    $("#bkExport", sh).onclick = () => shareFile(`cart-caddie-export-${todayISO()}.txt`, out(call("ip_export")), "text/plain");
    $("#bkRestore", sh).onclick = () => $("#bkFile", sh).click();
    $("#bkFile", sh).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (d.app !== "cart-caddie-ipad") throw new Error("That isn't a Cart Caddie iPad backup.");
        ask("Replace everything on this iPad?", "Your rounds, bag and settings here are replaced by the backup.", "Restore", () => { for (const k of [...KV.map.keys()]) kvDel(k); for (const [k, v] of Object.entries(d.kv)) kvSet(k, v && v.b64 !== undefined ? unb64(v.b64) : v); setTimeout(() => location.reload(), 600); });
      } catch (err) { toast(err.message, 4000); } }; });
}

// ---------------- GPS (iPad location; a Bluetooth GPS works too once paired) ----------------
let gpsWatch = null;
function setGps(on) { UI.gpsOn = on; kvSet("u:gps", on ? 1 : 0); if (gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; } UI.gps = null; UI.you = null;
  if (on) { if (!navigator.geolocation) { toast("This browser has no location"); return; }
    gpsWatch = navigator.geolocation.watchPosition((p) => { UI.gps = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() }; call("ip_gps", UI.gps.lat, UI.gps.lon, UI.gps.acc); if (S && S.scr !== 0) { updateYou(); renderSide(); drawMap(); } },
      (err) => { toast(err.code === 1 ? "Location is off for this app: Settings > Privacy > Location Services" : "No location yet"); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }); }
  if (S && S.scr !== 0) renderAll(); }
function updateYou() { if (!UI.gpsOn || !UI.gps || !S || S.scr === 0) { UI.you = null; return; } const r = JSON.parse(out(call("ip_ll2hole", UI.gps.lat, UI.gps.lon)));
  UI.you = { x: r[0], y: r[1], near: r[2] < 700, toPin: Math.hypot(S.pin[0] - r[0], S.pin[1] - r[1]) }; }
function gpsInfo() { if (!UI.gpsOn) return "Shows where you are on the map, your distance to the pin, and lets you place your ball where you're standing. A Wi-Fi iPad needs a Bluetooth GPS receiver for this."; if (!UI.gps) return "Waiting for a location..."; return `About +/- ${r0(UI.gps.acc * 1.0936)} yds${UI.you && !UI.you.near ? " - you're not on this hole" : ""}`; }

// keep the screen on during a round
let wake = null; async function keepAwake() { if (wake || !("wakeLock" in navigator) || document.hidden) return; try { wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => wake = null); } catch (e) {} }
document.addEventListener("visibilitychange", () => { if (!document.hidden) keepAwake(); });

// ---------------- start ----------------
async function boot() {
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await kvOpen();
    $("#bootmsg").textContent = "Opening your shot history...";
    const bytes = await (await fetch("caddie.wasm")).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, { env, wasi_snapshot_preview1: wasi });
    WX = instance.exports; WX._initialize(); call("ip_init"); refresh();
    M.cv = $("#map"); M.ctx = M.cv.getContext("2d"); sizeMap();
    M.cv.addEventListener("pointerdown", mapDown); M.cv.addEventListener("pointermove", mapMove); M.cv.addEventListener("pointerup", mapUp); M.cv.addEventListener("pointercancel", (e) => { PT.delete(e.pointerId); gesture = null; });
    window.addEventListener("resize", () => { sizeMap(); if (S && S.scr !== 0) drawMap(); });
    if (kvGet("u:gps", 0)) setGps(true);
    renderAll();
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js").catch(() => {});
  } catch (e) { $("#bootmsg").textContent = "Couldn't start: " + e.message; console.error(e); }
}
boot();
