"use strict";
// Voice control: tap the mic, say a command. The caddie answers out loud (works offline);
// listening uses the iPad's own dictation, so the mic only shows when the iPad offers it.

const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canTalk = "speechSynthesis" in window;
  let rec = null, listening = false, expect = null;   // expect: "putt2" after a 2+ putt score
  const talkOn = () => kvGet("u:talk", 1) === 1;

  // ---------- speaking ----------
  function say(t) { if (!canTalk || !talkOn() || !t) return; try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.rate = 1.02; u.lang = "en-US"; speechSynthesis.speak(u); } catch (e) {} }

  // ---------- words -> numbers ("one fifty two" -> 152, "a hundred and twenty" -> 120) ----------
  const UNITS = { zero: 0, oh: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function wordsToNumbers(s) {
    const w = s.split(/\s+/); const out = []; let i = 0;
    const small = (j) => { // up to 99 starting at j: returns [value, used]
      if (TENS[w[j]] !== undefined) { if (UNITS[w[j + 1]] !== undefined && UNITS[w[j + 1]] < 10 && UNITS[w[j + 1]] > 0) return [TENS[w[j]] + UNITS[w[j + 1]], 2]; return [TENS[w[j]], 1]; }
      if (UNITS[w[j]] !== undefined) return [UNITS[w[j]], 1]; return null; };
    while (i < w.length) {
      if ((w[i] === "a" || w[i] === "one") && w[i + 1] === "hundred" || UNITS[w[i]] !== undefined && w[i + 1] === "hundred") { // "a hundred and twenty", "two hundred ten"
        let v = (w[i] === "a" ? 1 : UNITS[w[i]]) * 100, j = i + 2; if (w[j] === "and") j++; const t = small(j); if (t) { v += t[0]; j += t[1]; } out.push(String(v)); i = j; continue; }
      const a = small(i);
      if (a && a[0] > 0 && a[0] < 10 && a[1] === 1) { const b = small(i + 1); if (b && b[0] >= 10 && !/^(iron|irons|wood|putt|putts|yard|yards|feet|foot|ft)$/.test(w[i + 1] || "")) { out.push(String(a[0] * 100 + b[0])); i += 1 + b[1]; continue; } } // "one fifty two"
      if (a && !(UNITS[w[i]] !== undefined && /^(to|too|for|oh)$/.test(w[i]))) { out.push(String(a[0])); i += a[1]; continue; }
      out.push(w[i]); i++; }
    return out.join(" ");
  }
  function clean(t) { return wordsToNumbers(t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9/.\s]/g, " ").replace(/\s+/g, " ").trim()); }

  // ---------- clubs ----------
  function club(t) {
    let c = -1;
    if (/\bmini\b/.test(t)) c = 1; else if (/\bdriver\b/.test(t)) c = 0;
    else if (/\bputter\b|\bputt it\b/.test(t)) c = 13;
    else if (/\b(pitching wedge|pw|p w|pitching)\b/.test(t)) c = 9;
    else if (/\b(50|gap)( degree)?\b.*wedge|\bwedge 50\b|\b50 degree\b/.test(t)) c = 10;
    else if (/\b(54|sand)( degree)?\b.*wedge|\bwedge 54\b|\b54 degree\b/.test(t)) c = 11;
    else if (/\b(58|lob)( degree)?\b.*wedge|\bwedge 58\b|\b58 degree\b/.test(t)) c = 12;
    else { const m = t.match(/\b([3-9])\s*(iron|i)\b/); if (m) c = +m[1] - 1; }
    if (c < 0) return null;
    const sw = /3\/4|three quarter|3 quarter|three quarters|3 quarters/.test(t) ? 1 : /\bhalf\b|1\/2|one half/.test(t) ? 2 : 0;
    return { c, sw };
  }
  const NUDGE = { left: 0, short: 1, back: 1, long: 2, right: 3 };
  const PEN = [[/out of bounds|\bob\b|o b/, 0], [/lost/, 1], [/penalty area|hazard|water|red|yellow/, 2], [/unplayable/, 3], [/no penalty|clear penalty/, 4]];

  // ---------- understand one sentence ----------
  function parse(raw) {
    const t = clean(raw); const num = (re) => { const m = t.match(re); return m ? +m[1] : null; };
    if (!t) return null;
    if (expect === "putt2" && $("#modal").hidden) expect = null;
    if (/how far|distance|yardage|what do i have|to the front|to the back|front and back/.test(t) && !/\d/.test(t)) return { a: "askDist" };
    if (expect === "putt2") { const f = num(/(\d+)/); if (f !== null) return { a: "putt2", ft: f }; if (/skip|dont know|no idea/.test(t)) return { a: "putt2", ft: 0 }; }
    if (/\bundo\b|take (it|that) back/.test(t)) return { a: "undo" };
    if (/\b(done|finished|thats it|good|ok|okay)\b$/.test(t) && !/putt/.test(t)) return { a: "done" };
    if (/holed|in the hole|chipped in|made it|went in/.test(t) && !/putt/.test(t)) return { a: "holed" };
    if (/ball is here|mark (my |the )?ball|im at (my|the) ball|my ball is here/.test(t)) return { a: "mark" };
    if (/\b(hit|hitting|swing)\b|next shot|place (the |my )?(ball|shot)/.test(t) && !club(t)) return { a: "hit" };
    for (const [re, i] of PEN) if (re.test(t) && (/penalty|out of bounds|\bob\b|lost|unplayable|water|hazard/.test(t))) return { a: "pen", i };
    { const m = t.match(/\b(\d)\s*putts?\b|\b(one|two|three|four)\s*putts?\b/); if (m && /putt/.test(t)) return { a: "putts", n: +(m[1] || { one: 1, two: 2, three: 3, four: 4 }[m[2]]) }; }
    for (const k of Object.keys(NUDGE)) { const m = t.match(new RegExp("\\b" + k + "\\b(?:\\s*(\\d+))?")); if (m && !/club|iron|wind|target/.test(t)) return { a: "nudge", k: NUDGE[k], y: m[1] ? +m[1] : 1 }; }
    if (/wind/.test(t)) { if (/calm|no wind|none/.test(t)) return { a: "wind", spd: 0, dir: 0 };
      const dirs = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]; const ab = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
      let dir = -1; const tt = t.replace(/north east/g, "northeast").replace(/north west/g, "northwest").replace(/south east/g, "southeast").replace(/south west/g, "southwest");
      dirs.forEach((d, i) => { if (new RegExp("\\b" + d + "\\b").test(tt)) dir = i; }); if (dir < 0) ab.forEach((d, i) => { if (new RegExp("\\bfrom (the )?" + d + "\\b").test(tt)) dir = i; });
      return { a: "wind", spd: num(/(\d+)/), dir }; }
    if (/\bpin (\d)\b/.test(t)) return { a: "pin", p: num(/\bpin (\d)\b/) };
    if (/next hole|go to next|forward/.test(t)) return { a: "hole", d: 1 };
    if (/previous hole|last hole|back a hole|go back/.test(t)) return { a: "hole", d: -1 };
    { const m = t.match(/\bhole (\d+)\b/); if (m && /go to|hole/.test(t) && +m[1] >= 1 && +m[1] <= 18) return { a: "holeN", r: +m[1] - 1 }; }
    if (/\bshow (the )?green\b|^green$|green view/.test(t)) return { a: "view", v: "green" };
    if (/\bshow (the )?hole\b|^hole$|whole hole|hole view/.test(t)) return { a: "view", v: "hole" };
    if (/zoom/.test(t)) return { a: "view", v: "near" };
    if (/\btarget\b|\baim\b/.test(t)) { const d = num(/(\d+)/); if (d) return { a: "target", d }; }
    if (/laser|lasered|yards?|feet|foot|\bft\b|i have|im at|its/.test(t)) { const d = num(/(\d+)/); if (d) return { a: "laser", d, ft: /feet|foot|\bft\b/.test(t) }; }
    const cl = club(t); if (cl) return { a: "club", ...cl };
    if (/what club|which club|what should i hit|recommend|caddie/.test(t)) return { a: "askClub" };
    if (/how far|distance|yardage|what do i have|front|back of the green/.test(t)) return { a: "askDist" };
    if (/score|how am i|where am i/.test(t)) return { a: "askScore" };
    if (/what can i say|help|commands/.test(t)) return { a: "help" };
    if (/^\d+$/.test(t)) return { a: "laser", d: +t, ft: S && S.lieNow === L_GREEN };
    return null;
  }

  // ---------- do it ----------
  const distLine = () => S.lieNow === L_GREEN ? `${r0(S.toPin * 3)} feet to the hole.` : `${r0(S.toPin)} to the pin${Math.abs(r0(S.plays) - r0(S.toPin)) >= 2 ? `, plays ${r0(S.plays)}` : ""}. Front ${r0(S.dFront)}, back ${r0(S.dBack)}.`;
  const clubLine = () => { const o = S.opts && S.opts[S.sel]; if (!o) return ""; const sp = o.name.replace("3/4", "three quarter").replace("1/2", "half").replace("58w", "58 wedge").replace("54w", "54 wedge").replace("50w", "50 wedge").replace("Mini Dr", "mini driver");
    return o.kind === 6 ? `Putter, ${r0(o.dist * 3)} feet.` : `${sp}, ${[3, 4, 5].includes(o.kind) ? "play to" : "carry"} ${r0([3, 4, 5].includes(o.kind) ? o.plays : o.carry)}.`; };
  function run(cmd, heard) {
    if (!S || S.scr === 0) { say("Start a round first."); return "Start a round first"; }
    const placing = S.placing;
    switch (cmd.a) {
      case "askDist": { const t = distLine(); say(t); return t; }
      case "askClub": { const t = clubLine() + " " + (S.patLine || ""); say(clubLine()); return t; }
      case "askScore": { const t = S.toPar ? `You're ${S.toPar === "E" ? "even" : S.toPar.replace("+", "plus ").replace("-", "minus ")}. Hole ${S.rh + 1}, shot ${S.nextShot}.` : `Hole ${S.rh + 1}, shot ${S.nextShot}.`; say(t); return t; }
      case "help": openVoiceHelp(); return "Here's what you can say";
      case "club": { if (placing) { say("Finish placing your ball first."); return "Finish placing first"; }
        let i = S.opts ? S.opts.findIndex(o => o.club === cmd.c && o.swing === cmd.sw) : -1;
        if (i >= 0) act("ip_opt", i); else act("ip_bag", cmd.c, cmd.sw); const t = clubLine(); say(t); return t; }
      case "target": { const o = S.opts && S.opts[S.sel]; if (!o || placing) return "No club to aim";
        const ux = o.aim[0] - S.ball[0], uy = o.aim[1] - S.ball[1], L = Math.hypot(ux, uy) || 1; const g = cmd.d * (o.dist / (o.plays || o.dist));
        act("ip_aim", S.ball[0] + ux / L * g, S.ball[1] + uy / L * g, 0); const o2 = S.opts[S.sel]; const t = `Target ${r0(o2.plays)}. ${clubLine()}`; say(t); return t; }
      case "hit": { if (placing) { say("Tap where it finished, or say left, right, short or long."); return "Already placing"; }
        if (S.lie === L_GREEN) { say("You're on the green. Say one putt, two putts, or three putts."); return "On the green"; }
        UI.user = { z: 1, dx: 0, dy: 0 }; act("ip_hit"); const t = `Shot ${S.lastNo || S.nextShot}. Where did it finish?`; say(t); return t; }
      case "mark": { if (!(UI.gpsOn && UI.you && UI.you.near)) { say("I don't have your location. Turn on iPad location in the menu."); return "No GPS position"; }
        if (!placing) act("ip_hit"); act("ip_place", UI.you.x, UI.you.y, 1); call("ip_done"); refresh(); UI.view = S.toPin <= 70 ? "green" : "near"; renderAll(); const t = `Ball marked. ${distLine()} ${S.lieName}.`; say(t); return t; }
      case "nudge": { if (!placing || !S.adjusting) { say("Hit a shot first."); return "Not placing a ball"; } call("ip_nudge", cmd.k, cmd.y); refresh(); renderAll(); const t = `${S.lieName}, ${r0(S.toPin)} to the pin.`; say(t); return t; }
      case "done": { if (!placing) return "Nothing to finish"; call("ip_done"); refresh(); UI.user = { z: 1, dx: 0, dy: 0 }; if (!S.placing) UI.view = S.toPin <= 70 ? "green" : "near"; renderAll(); const t = `${distLine()} ${clubLine()}`; say(t); return t; }
      case "undo": { if (!S.nShots) { say("No shots to undo."); return "Nothing to undo"; } act("ip_undo"); say("Undone."); return "Last shot removed"; }
      case "laser": { if (!S.nShots && !S.startSet && !placing) { /* from the tee: still fine */ }
        const done = act("ip_laser", cmd.d, cmd.ft ? 1 : 0); if (done) { UI.user = { z: 1, dx: 0, dy: 0 }; UI.view = S.toPin <= 70 ? "green" : "near"; renderAll(); }
        const t = `${cmd.d} ${cmd.ft ? "feet" : "yards"}, got it. ${clubLine()}`; say(t); return t; }
      case "holed": { act("ip_holed"); afterScore(); const t = `In the hole. ${S.toPar ? "You're " + (S.toPar === "E" ? "even" : S.toPar.replace("+", "plus ").replace("-", "minus ")) : ""}`; say(t); return "Holed"; }
      case "pen": { if (!S.nShots) return "No shot for a penalty"; act("ip_penalty", cmd.i); const t = cmd.i <= 1 ? `Penalty, one stroke. Play shot ${S.nextShot} from the same spot.` : cmd.i <= 3 ? "Penalty, one stroke. Tap where you drop." : "Penalty cleared."; say(t); return t; }
      case "putts": { if (S.lie !== L_GREEN || S.holes[S.rh].score) { say("Say putts once you're on the green."); return "Not on the green"; }
        const ask = act("ip_putts", cmd.n); if (ask) { expect = "putt2"; openPutt2(); say("How long was your second putt?"); return `${cmd.n} putts`; } afterScore(); say(`${cmd.n} putt. Nice.`); return "1 putt"; }
      case "putt2": { expect = null; closeModal(); act("ip_putt2", cmd.ft); afterScore(); const t = S.scr === 14 ? "Round complete." : `Hole ${S.rh + 1}. ${distLine()}`; say(t); return t; }
      case "wind": { const spd = cmd.spd === null ? (S.windSpd || 5) : cmd.spd, dir = cmd.dir < 0 ? S.windDir : cmd.dir; act("ip_wind", spd, dir); const t = spd ? `Wind ${spd} from the ${WIND_DIR[dir].replace("N", "north ").replace("S", "south ").replace("E", "east").replace("W", "west").trim()}.` : "Calm."; say(t); return t; }
      case "pin": { if (cmd.p >= 1 && cmd.p <= 5) { act("ip_pin", cmd.p - 1); const t = `Pin ${cmd.p}. ${distLine()}`; say(t); return t; } return "Pin 1 to 5"; }
      case "hole": { gotoHole(S.rh + cmd.d); const t = `Hole ${S.rh + 1}, par ${S.par}. ${distLine()}`; say(t); return t; }
      case "holeN": { gotoHole(cmd.r); const t = `Hole ${S.rh + 1}, par ${S.par}. ${distLine()}`; say(t); return t; }
      case "view": { UI.view = cmd.v; UI.user = { z: 1, dx: 0, dy: 0 }; renderAll(); return cmd.v === "green" ? "Green" : cmd.v === "near" ? "Zoomed in" : "Whole hole"; }
    }
    return "?";
  }

  // ---------- listening ----------
  function setMic(on) { listening = on; const b = $("#mic"); if (b) b.classList.toggle("on", on); $("#mapnote").textContent = on ? "Listening..." : ""; }
  function listen() {
    if (!SR) return; if (listening) { try { rec.stop(); } catch (e) {} return; }
    try { if (canTalk) speechSynthesis.cancel(); } catch (e) {}
    rec = new SR(); rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 3; rec.continuous = false;
    rec.onresult = (e) => { const alts = [...e.results[0]].map(a => a.transcript); let cmd = null, heard = alts[0];
      for (const a of alts) { cmd = parse(a); if (cmd) { heard = a; break; } }
      if (!cmd) { toast(`"${heard}" - not sure what to do. Say "help" for the list.`, 3500); say("Sorry, say that again?"); return; }
      const what = run(cmd, heard); toast(`"${heard}"  ›  ${what}`, 3500); };
    rec.onerror = (e) => { setMic(false); if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("The iPad blocked the microphone: Settings > Apps > Safari > Microphone, and Settings > Privacy > Speech Recognition", 6000); else if (e.error === "network") toast("Voice needs the iPad's on-device dictation: Settings > General > Keyboard > Enable Dictation", 6000); else if (e.error !== "no-speech" && e.error !== "aborted") toast("Didn't catch that (" + e.error + ")", 2500); };
    rec.onend = () => setMic(false);
    try { rec.start(); setMic(true); } catch (e) { setMic(false); }
  }
  function init() {
    const wrap = $("#mapwrap"); if (!wrap || $("#mic")) return;
    const b = document.createElement("button"); b.id = "mic"; b.className = "mic"; b.setAttribute("aria-label", "Voice command");
    b.innerHTML = `<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-2.08A7 7 0 0 0 19 12h-2z"/></svg>`;
    b.onclick = listen; b.hidden = !SR; wrap.appendChild(b);
  }
  return { init, parse, say, listen, available: () => !!SR, setExpect: (v) => expect = v, talkOn, canTalk };
})();

function openVoiceHelp() {
  const rows = [["Distances", "how far / what's my distance"], ["The caddie's club", "what club"], ["Pick a club", "seven iron, three quarter nine iron, 54 wedge, mini driver"], ["Move the target", "target 140"],
    ["Laser", "152 yards, laser 148, 18 feet"], ["Hit a shot", "hit"], ["Place the ball", "left 5, right, short 3, long, done, ball is here (GPS)"], ["Fix it", "undo, out of bounds, lost ball, penalty area, unplayable"],
    ["Green", "two putts (then: six feet), holed it"], ["Holes", "next hole, previous hole, hole 7, show the green, whole hole, zoom"], ["Round", "pin 3, wind 10 from the northwest, calm, what's my score"]];
  openModal(`<div class="top"><h3>What you can say</h3><button data-close class="acc">Close</button></div><p class="note">Tap the mic on the map, then speak.</p>
    <table class="list">${rows.map(r => `<tr><td style="font-weight:800;white-space:nowrap">${r[0]}</td><td>"${r[1]}"</td></tr>`).join("")}</table>
    <div class="row r2" style="margin-top:12px"><button id="vTalk" class="${Voice.talkOn() ? "on" : ""}">${Voice.talkOn() ? "Caddie talks: On" : "Caddie talks: Off"}</button><button id="vTest">Test the voice</button></div>`, false, (sh) => {
    $("#vTalk", sh).onclick = () => { kvSet("u:talk", Voice.talkOn() ? 0 : 1); openVoiceHelp(); };
    $("#vTest", sh).onclick = () => Voice.say(S && S.scr !== 0 ? `Hole ${S.rh + 1}. ${r0(S.toPin)} to the pin.` : "Cart Caddie is ready."); });
}
document.addEventListener("DOMContentLoaded", () => Voice.init()); Voice.init();
