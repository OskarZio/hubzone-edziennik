/* Hubzone Weightlifting e-Dziennik — wspólny kod (klient + trener) */
(function(){
"use strict";
const HZ = window.HZ = {};

/* ---------- Firebase ---------- */
const cfg = window.HZ_FIREBASE || {};
HZ.configured = !!(cfg.apiKey && cfg.projectId && !/TWOJ/.test(cfg.apiKey + cfg.projectId));
let db = null, auth = null;
if (HZ.configured && window.firebase){
  firebase.initializeApp(cfg);
  auth = firebase.auth(); db = firebase.firestore();
  db.settings({ ignoreUndefinedProperties:true });
  auth.languageCode = "pl";
}
HZ.ready = !!db;
const wrap = async fn => { try { return { data: await fn(), error:null }; } catch(e){ console.error(e); return { data:null, error:e }; } };
const list = s => s.docs.map(d => ({ id:d.id, ...d.data() }));
const asProfile = (id, d) => d ? { id, name:d.name || "", email:d.email || "", is_admin:d.isAdmin === true, created_at:d.createdAt || null } : null;
HZ.api = {
  /* auth */
  onAuth(cb){ auth.onAuthStateChanged(u => cb(u ? { user:{ id:u.uid, email:u.email } } : null)); },
  signOut: () => auth.signOut(),
  /* profiles */
  profile: uid => wrap(async () => { const s = await db.doc("users/" + uid).get(); return s.exists ? asProfile(uid, s.data()) : null; }),
  createProfile: (uid, { name, email, joinCode }) => wrap(() => db.doc("users/" + uid).set({ name, email, isAdmin:false, joinCode, createdAt:new Date().toISOString() })),
  updateName: (uid, name) => wrap(() => db.doc("users/" + uid).update({ name })),
  users: () => wrap(async () => (await db.collection("users").get()).docs.map(d => asProfile(d.id, d.data()))),
  /* logs */
  logsOf: uid => wrap(async () => list(await db.collection("logs").where("user_id", "==", uid).get())),
  logsForWorkout: wid => wrap(async () => list(await db.collection("logs").where("workout_id", "==", wid).get())),
  allLogs: () => wrap(async () => list(await db.collection("logs").get())),
  saveWorkoutLog: row => wrap(async () => { const id = row.user_id + "_" + row.workout_id; await db.doc("logs/" + id).set(row); return { id, ...row }; }),
  addOwnLog: row => wrap(async () => { const full = { ...row, saved_at:new Date().toISOString() }; const ref = await db.collection("logs").add(full); return { id:ref.id, ...full }; }),
  /* trainer data */
  saveLibrary: lib => wrap(() => db.doc("config/library").set(lib, { merge:true })),
  setOwnEnabled: on => wrap(() => db.doc("config/library").set({ ownEnabled:!!on }, { merge:true })),
  setRankingEnabled: on => wrap(() => db.doc("config/library").set({ rankingEnabled:!!on }, { merge:true })),
  ranking: () => wrap(async () => list(await db.collection("ranking").get())),
  myRanking: uid => wrap(async () => { const s = await db.doc("ranking/" + uid).get(); return s.exists ? s.data() : null; }),
  saveRanking: (uid, row) => wrap(() => db.doc("ranking/" + uid).set(row)),
  getClub: () => wrap(async () => { const s = await db.doc("settings/club").get(); return s.exists ? (s.data().joinCode || null) : null; }),
  setClub: code => wrap(() => db.doc("settings/club").set({ joinCode:code })),
  saveWorkout: row => wrap(async () => { const { id, ...body } = row; await db.doc("workouts/" + id).set(body); return row; }),
  deleteWorkout: id => wrap(() => db.doc("workouts/" + id).delete())
};

/* ---------- DOM helpers ---------- */
const SVGNS = "http://www.w3.org/2000/svg";
function el(tag, props, ...kids){
  const e = document.createElement(tag); let val;
  if (props) for (const [k,v] of Object.entries(props)){
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "value") val = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)){ if (c == null || c === false) continue; e.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  if (val !== undefined) e.value = val;
  return e;
}
function sv(tag, attrs, ...kids){ const e = document.createElementNS(SVGNS, tag); for (const [k,v] of Object.entries(attrs||{})) if (v != null) e.setAttribute(k, v); for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c))); return e; }
HZ.el = el; HZ.sv = sv;
HZ.uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c === "x" ? r : (r&3|8)).toString(16); }));
HZ.clone = o => JSON.parse(JSON.stringify(o));
HZ.todayISO = () => new Date().toLocaleDateString("sv-SE");
HZ.parseNum = v => { if (v === "" || v == null) return null; const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
HZ.fmtKg = n => n == null ? "–" : Number(n).toLocaleString("pl-PL", { maximumFractionDigits:2 });
const DAYS = ["nd","pn","wt","śr","cz","pt","sb"];
HZ.fmtDate = (iso, long) => { if (!iso) return ""; const [y,m,d] = iso.split("-").map(Number); const dt = new Date(y, m-1, d);
  return long ? dt.toLocaleDateString("pl-PL", { weekday:"long", day:"numeric", month:"long" }) : `${DAYS[dt.getDay()]} ${String(d).padStart(2,"0")}.${String(m).padStart(2,"0")}`; };
HZ.LS = { get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } }, set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} } };
let toastTimer;
HZ.toast = msg => { document.querySelectorAll(".toast").forEach(t => t.remove()); const t = el("div", { class:"toast", role:"status", text:msg }); document.body.append(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2800); };
/* workout sections: main lifts first, then accessory stations */
HZ.SECTIONS = [
  { key:"main", title:"Trening główny", sub:"boje", item:"Bój", add:"+ Dodaj bój" },
  { key:"acc", title:"Akcesoria", sub:"stacje", item:"Stacja", add:"+ Dodaj stację" }
];
HZ.secOf = st => st.section === "main" ? "main" : "acc";
HZ.targetRir = (w, st) => { const v = st && st.rir != null && st.rir !== "" ? st.rir : (w && w.rir != null && w.rir !== "" ? w.rir : null); return v == null ? null : Number(v); };
HZ.orderStations = stations => [...stations.filter(s => HZ.secOf(s) === "main"), ...stations.filter(s => HZ.secOf(s) !== "main")];
/* labels: main lifts "Bój 1…"; accessories get letters, supersets share a letter: A1, A2, then B, C1, C2… */
HZ.stationLabels = stations => {
  const out = {}; let n = 0;
  stations.filter(s => HZ.secOf(s) === "main").forEach(s => { out[s.id] = "Bój " + (++n); });
  const acc = stations.filter(s => HZ.secOf(s) !== "main"); const groups = [];
  acc.forEach((s, i) => { if (i > 0 && s.superset) groups[groups.length - 1].push(s); else groups.push([s]); });
  groups.forEach((g, gi) => { const L = String.fromCharCode(65 + (gi % 26));
    g.forEach((s, k) => { out[s.id] = g.length > 1 ? L + (k + 1) : L; }); });
  return out;
};
HZ.supersetInfo = stations => { const lb = HZ.stationLabels(stations), out = {};
  for (const s of stations){ const l = lb[s.id]; if (/^[A-Z]\d$/.test(l)) out[s.id] = stations.filter(x => lb[x.id] && lb[x.id][0] === l[0] && /^[A-Z]\d$/.test(lb[x.id]) && x.id !== s.id).map(x => lb[x.id]); }
  return out; };
HZ.TYPE_LABEL = { kg:"ciężar (kg)", band:"guma (asysta)", bw:"masa ciała" };
HZ.plural = (n, one, few, many) => n === 1 ? one : (n%10 >= 2 && n%10 <= 4 && (n%100 < 10 || n%100 >= 20)) ? few : many;

HZ.brand = (sub) => el("div", { class:"brand" }, el("span", { class:"mark", "aria-hidden":"true", text:"HZ" }),
  el("span", { class:"bt" }, el("b", { text:"Hubzone Weightlifting" }), el("span", { text: sub || "e-Dziennik" })));

/* ---------- shared state ---------- */
const S = HZ.S = { config:{ exercises:[], bands:[] }, workouts:[] };
HZ.exById = id => S.config.exercises.find(e => e.id === id);
HZ.bandIdx = id => S.config.bands.findIndex(b => b.id === id);
/* band assistance: a single value (15) or a range (3–5 kg) */
HZ.parseKgRange = t => { const m = String(t || "").replace(/,/g, ".").match(/^\s*(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(\d+(?:\.\d+)?))?\s*(?:kg)?\s*$/i);
  if (!m) return null; const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a; return a > 0 ? [Math.min(a, b), Math.max(a, b)] : null; };
HZ.bandKgText = b => !b || !b.kg ? "" : b.kgMax ? `${HZ.fmtKg(b.kg)}–${HZ.fmtKg(b.kgMax)}` : HZ.fmtKg(b.kg);
HZ.bandKgMid = b => !b || !b.kg ? 0 : b.kgMax ? (Number(b.kg) + Number(b.kgMax)) / 2 : Number(b.kg);
HZ.bandFull = id => { const b = S.config.bands.find(b => b.id === id); return b ? b.name + (b.kg ? ` (~${HZ.bandKgText(b)} kg)` : "") : HZ.bandName(id); };
HZ.bandName = id => { if (id === "none") return "bez gumy"; const b = S.config.bands.find(b => b.id === id); return b ? b.name : "?"; };
HZ.sortedWorkouts = () => [...S.workouts].sort((a,b) => (a.date||"").localeCompare(b.date||""));
HZ.workoutNo = id => HZ.sortedWorkouts().findIndex(w => w.id === id) + 1;
HZ.defaultWorkoutId = () => {
  const ws = HZ.sortedWorkouts(); if (!ws.length) return null;
  const t = HZ.todayISO(); const past = ws.filter(w => w.date <= t);
  const soon = ws.find(w => w.date > t && (new Date(w.date) - new Date(t)) <= 2*864e5);
  return (soon || past[past.length-1] || ws[0]).id;
};
HZ.fmtLoad = (type, load) => { if (type === "band") return load ? HZ.bandName(load) : "–"; if (type === "kg") return load == null ? "–" : HZ.fmtKg(load) + " kg"; return load ? "+" + HZ.fmtKg(load) + " kg" : "masa ciała"; };

/* ---------- data ---------- */
HZ.loadConfig = async () => {
  const s = await db.doc("config/library").get(); const d = s.exists ? s.data() : {};
  S.config = { exercises:(d.exercises || []).map(e => ({ ...e, type: e.type === "band" ? "band" : "kg", inc:Number(e.inc) || 0 })), bands:d.bands || [], ownEnabled:d.ownEnabled === true, rankingEnabled:d.rankingEnabled !== false };
};
HZ.loadWorkouts = async () => { S.workouts = list(await db.collection("workouts").get()); };
HZ.dbError = (e) => {
  const c = (e && e.code) || "";
  if (c === "permission-denied") return "Brak uprawnień do tej operacji.";
  if (c === "unauthenticated") return "Sesja wygasła. Zaloguj się ponownie.";
  if (c === "unavailable" || c === "deadline-exceeded") return "Brak połączenia z internetem. Spróbuj ponownie.";
  if (c === "resource-exhausted") return "Przekroczono dzienny limit bazy. Spróbuj jutro.";
  return "Nie udało się zapisać. Spróbuj ponownie.";
};

/* ---------- progression ---------- */
HZ.history = (logs, exId, excludeWorkoutId, type) => {
  const out = [];
  for (const l of logs){ if (excludeWorkoutId && l.workout_id === excludeWorkoutId) continue;
    for (const e of (l.entries || [])) if (e.exId === exId && (!type || (e.type || "kg") === type)){ const w = HZ.workEntry(e); if (w) out.push({ log:l, entry:w }); } }
  return out.sort((a,b) => (b.log.date||"").localeCompare(a.log.date||"") || (b.log.saved_at||"").localeCompare(a.log.saved_at||""));
};
/* warm-up sets (warmup:true) never count towards progression or charts */
HZ.workEntry = e => { const sets = (e.sets || []).filter(s => !s.warmup); return sets.length ? { ...e, sets } : null; };
HZ.warmSets = e => (e.sets || []).filter(s => s.warmup);
/* warm-up ramp (trainer's scheme):
   W1 = movement practice: empty bar / strongest band, 5–6 reps
   W2 ≈ 60% of working weight, 3–4 reps
   W3 ≈ 80% (70–80%), 1–2 reps   e.g. working 90 kg → 72,5 kg  (75 kg would be 83%) */
HZ.WARM_REPS = (i, n) => i === 0 ? "5–6" : (n >= 3 && i === n - 1 ? "1–2" : "3–4");
HZ.warmPct = (i, n) => n === 1 ? 0.5 : i === 0 ? 0.45 : n === 2 ? 0.6 : n === 3 ? [0.45, 0.6, 0.8][i] : 0.5 + 0.3 * (i - 1) / (n - 2);
HZ.warmupLoads = (ex, n, next) => {
  if (!n) return [];
  if (ex.type === "band"){
    const bands = S.config.bands; if (!bands.length) return Array(n).fill("");
    let w = next === "none" ? bands.length : HZ.bandIdx(next); if (w < 0) w = bands.length;
    const top = Math.max(0, w - 1);                       // last warm-up: one band stronger than the working one
    return Array.from({ length:n }, (_, i) => bands[Math.min(bands.length - 1, n === 1 ? 0 : Math.round(top * i / (n - 1)))].id);
  }
  if (ex.type !== "kg") return Array(n).fill(null);
  const step = HZ.incRange(ex)[0], start = Number(ex.warmStart) > 0 ? Number(ex.warmStart) : null;
  const r = v => Math.max(0, Math.round(v / step) * step);
  if (next == null) return Array.from({ length:n }, (_, i) => i === 0 && start ? start : null);
  return Array.from({ length:n }, (_, i) => {
    if (i === 0 && start != null) return Math.min(start, next);
    const v = r(next * HZ.warmPct(i, n));
    return start != null ? Math.min(next, Math.max(start, v)) : v;
  });
};
HZ.workLoad = e => {
  const c = new Map(); for (const s of e.sets){ const k = JSON.stringify(s.load ?? null); c.set(k, (c.get(k)||0) + 1); }
  let best = JSON.stringify(e.sets[e.sets.length-1].load ?? null), n = 0; for (const [k,v] of c) if (v > n){ best = k; n = v; }
  return JSON.parse(best);
};
HZ.judge = e => {
  const tr = e.targetReps || 0, ts = e.targetSets || e.sets.length;
  const done = e.sets.filter(s => s.reps != null);
  const hit = done.length >= ts && done.every(s => s.reps >= tr);
  const rirs = done.map(s => s.rir).filter(r => r != null);
  return { hit, minRir: rirs.length ? Math.min(...rirs) : null };
};
/* jump range per exercise, e.g. 1,25–2,5 kg (trainer sets it) */
HZ.incRange = ex => {
  if (ex == null || typeof ex !== "object"){ const m = Number(ex) > 0 ? Number(ex) : 2.5; return [Math.min(1.25, m), m]; }
  let hi = Number(ex.incMax ?? ex.inc) || 2.5, lo = Number(ex.incMin) || Math.min(1.25, hi);
  if (lo > hi) [lo, hi] = [hi, lo]; return [lo, hi];
};
const repRange = (a, b) => { a = Math.max(1, a); b = Math.max(1, b); return a === b ? String(a) : `${a}–${b}`; };
/* targetRir: trainer's planned RIR for today (optional). Lower than last time's reserve → heavier, higher → hold or lighter. */
HZ.suggest = (logs, exId, type, ex, excludeWorkoutId, targetRir = null) => {
  const { fmtKg, fmtDate, bandName, bandIdx, fmtLoad } = HZ;
  const h = HZ.history(logs, exId, excludeWorkoutId, type);
  const goal = targetRir != null ? ` Cel na dziś: RIR ${targetRir}.` : "";
  if (!h.length) return { kind:"first", title:"Pierwszy raz w tym trybie", text: targetRir != null ? `Dobierz obciążenie tak, żeby na końcu serii zostało ${targetRir} powt. zapasu (RIR ${targetRir}).` : "Dobierz obciążenie, przy którym na końcu serii zostają ci 2–3 powtórzenia zapasu (RIR 2–3).", next:null };
  const { log, entry } = h[0]; const load = HZ.workLoad(entry); const { hit, minRir } = HZ.judge(entry);
  const setTxt = entry.sets.map(s => type === "kg" ? `${fmtKg(s.load)}×${s.reps ?? "–"}` : type === "band" ? `${bandName(s.load)}×${s.reps ?? "–"}` : `${s.reps ?? "–"}`).join(" · ");
  const last = `Ostatnio (${fmtDate(log.date)}): ${setTxt}` + (minRir != null ? `, najniższy RIR ${minRir}` : "");
  const tiredNote = log.fatigue != null && log.fatigue >= 9 ? ` Zmęczenie było wtedy wysokie (${log.fatigue}/10), więc dołóż tylko, jeśli dziś czujesz się lepiej.` : "";
  const [lo, hi] = HZ.incRange(ex);
  const bands = S.config.bands;
  if (hit){
    const T = entry.targetReps || 5;
    let small = minRir == null || minRir <= 1;             // RIR 0–1 (or not given): small jump, expect 3–4 reps
    if (targetRir != null && minRir != null){
      const room = minRir - targetRir;                     // reserve left last time vs. reserve planned today
      if (room <= -2){
        const why2 = `${last}.${goal} Ostatnio zostawało tylko ${minRir}, więc dziś zejdź z ciężaru.`;
        if (type === "kg"){ const nx = Math.max(0, (load || 0) - lo); return { kind:"down", title:`Lżej: −${fmtKg(lo)} kg → ${fmtKg(nx)} kg`, text:why2, next:nx, base:load || 0 }; }
        if (type === "band"){ const i = load === "none" ? bands.length : bandIdx(load); const nx = i > 0 ? bands[i-1].id : load;
          return { kind:"down", title: nx === load ? "Zostań przy tej gumie" : `Mocniejsza guma → ${HZ.bandFull(nx)}`, text:why2, next:nx }; }
        return { kind:"down", title:"Zrób o 1–2 powt. mniej", text:why2, next:load, reps:repRange(T - 2, T - 1) };
      }
      if (room === -1) return { kind:"hold", title:`Zostań przy: ${fmtLoad(type, load)}`, text:`${last}.${goal} Ostatnio zapas był mniejszy, więc dziś nie dokładaj.`, next:load, base: type === "kg" ? (load || 0) : null };
      small = room === 0;                                   // exactly as planned → small jump; more reserve → bigger
    }
    const reps = small ? repRange(T - 2, T - 1) : minRir >= 4 ? String(T) : repRange(T - 1, T);   // RIR 2–3: top of range, 4–5 reps
    const why = minRir == null ? "nie wpisano RIR" : small ? `RIR ${minRir}, mały zapas` : `RIR ${minRir}, jest zapas`;
    if (type === "kg"){
      const base = load || 0, rec = small ? lo : hi;
      const options = (lo === hi ? [lo] : [lo, hi]).map(a => ({ load: base + a, label:`+${fmtKg(a)} → ${fmtKg(base + a)} kg`, rec: a === rec }));
      return { kind:"up", title: lo === hi ? `Dołóż ${fmtKg(lo)} kg` : `Dołóż ${fmtKg(lo)}–${fmtKg(hi)} kg`,
        text:`${last}. Polecam +${fmtKg(rec)} kg (${minRir == null ? "nie wpisano RIR" : small ? "mały zapas" : "był zapas"}). Po przeskoku celuj w ${reps} powt. w serii.` + goal + tiredNote, next: base + rec, options, reps, base };
    }
    if (type === "band"){
      const i = bandIdx(load);
      if (load === "none" || i < 0) return { kind:"up", title:"Bez gumy: dołóż powtórzenie", text:last + ". Spróbuj zrobić o 1 powtórzenie więcej w każdej serii." + tiredNote, next:"none" };
      const nx = i + 1 >= bands.length ? "none" : bands[i + 1].id;
      const options = [{ load:nx, label: nx === "none" ? "Bez gumy" : `Słabsza: ${HZ.bandFull(nx)}`, rec:true }, { load, label:`Zostań: ${HZ.bandFull(load)}`, rec:false }];
      return { kind:"up", title: nx === "none" ? "Spróbuj bez gumy" : `Zmniejsz gumę → ${HZ.bandFull(nx)}`,
        text:`${last}. Po zmianie gumy celuj w ${reps} powt. w serii.` + goal + tiredNote, next:nx, options, reps };
    }
    if (small) return { kind:"hold", title:`Zostań przy: ${fmtLoad(type, load)}`, text:last + ". Serie wyszły, ale blisko upadku. Powtórz" + (goal || " i celuj w RIR 2."), next:load };
    const add = minRir >= 4 ? 2 : 1;
    return { kind:"up", title:`Dołóż ${add} powt. w serii`, text:last + `. Cel: ${T + add} powtórzeń.` + goal + tiredNote, next:load, reps:String(T + add) };
  }
  const prev = h[1];
  const missedTwice = prev && JSON.stringify(HZ.workLoad(prev.entry)) === JSON.stringify(load) && !HZ.judge(prev.entry).hit;
  if (missedTwice){
    if (type === "kg"){ const nx = Math.max(0, (load||0) - hi); return { kind:"down", title:`Zmniejsz o ${fmtKg(hi)} kg → ${fmtKg(nx)} kg`, text:last + ". Drugi raz z rzędu zabrakło powtórzeń." + goal, next:nx, base:load || 0 }; }
    if (type === "band"){ const i = load === "none" ? bands.length : bandIdx(load); const nx = i > 0 ? bands[i-1].id : load;
      return { kind:"down", title: nx === load ? "Zostań przy tej gumie" : `Mocniejsza guma → ${HZ.bandFull(nx)}`, text:last + ". Drugi raz z rzędu zabrakło powtórzeń.", next:nx }; }
  }
  return { kind:"hold", title:`Zostań przy: ${fmtLoad(type, load)}`, text:last + `. Zabrakło powtórzeń do celu ${entry.targetSets || ""}×${entry.targetReps || ""}. Spróbuj domknąć wszystkie serie.` + goal, next:load, base: type === "kg" ? (load || 0) : null };
};

/* ---------- UI pieces ---------- */
HZ.tabBar = (items, cur, onPick) => el("nav", { class:"tabs", "aria-label":"Sekcje" },
  items.map(([k,label]) => el("button", { type:"button", "aria-pressed":String(cur === k), onclick(){ onPick(k); }, text:label })));
HZ.fatiguePicker = (cur, onPick) => el("div", { class:"fatigue", role:"group", "aria-label":"Zmęczenie od 1 do 10" },
  Array.from({ length:10 }, (_,i) => i+1).map(n => el("button", { type:"button", "aria-pressed":String(cur === n), onclick(){ onPick(cur === n ? null : n); }, text:n })));
HZ.loadInput = (ex, val, onVal, id) => {
  if (ex.type === "band") return el("select", { id, "aria-label":"Guma", value: val || "", onchange(e){ onVal(e.target.value || null); } },
    el("option", { value:"", text:"–" }), S.config.bands.map(b => el("option", { value:b.id, text: b.name + (b.kg ? ` ~${HZ.bandKgText(b)} kg` : "") })), el("option", { value:"none", text:"bez gumy" }));
  return el("input", { id, inputmode:"decimal", placeholder: ex.type === "bw" ? "+kg" : "kg", "aria-label": ex.type === "bw" ? "Dodatkowe obciążenie" : "Ciężar w kg",
    value: val == null ? "" : HZ.fmtKg(val), onchange(e){ onVal(HZ.parseNum(e.target.value)); } });
};
HZ.rirSelect = (val, onVal, id) => el("select", { id, "aria-label":"Zapas powtórzeń (RIR)", value: val == null ? "" : String(val), onchange(e){ onVal(e.target.value === "" ? null : Number(e.target.value)); } },
  el("option", { value:"", text:"–" }), [0,1,2,3,4,5].map(n => el("option", { value:String(n), text: n === 5 ? "5+" : String(n) })));
HZ.setsEditor = (ex, sets, keyPrefix, onChange, opts = {}) => {
  const head = el("div", { class:"set head" }, el("span", { text:"Seria" }), el("span", { text: ex.type === "band" ? "Guma" : ex.type === "bw" ? "Dociąż." : "Ciężar" }), el("span", { text:"Powt." }), el("span", { text:"RIR" }));
  let wn = 0, rn = 0;
  const warmIdx = i => sets.slice(0, i).filter(x => x.warmup).length;
  const rows = sets.map((s, i) => {
    const sw = ex.type === "band" && s.load && s.load !== "none" ? (S.config.bands.find(b => b.id === s.load) || {}).color : null;
    const label = s.warmup ? "W" + (++wn) : String(++rn);
    return el("div", { class:"set" + (s.warmup ? " warm" : "") },
      el("span", { class:"n", title: s.warmup ? "Seria wstępna" : null, text:label }),
      el("div", { class:"row", style:"flex-wrap:nowrap;gap:4px" }, sw ? el("span", { class:"swatch", style:`background:${sw}` }) : null,
        HZ.loadInput(ex, s.load, v => { const old = s.load; s.load = v;
          for (let j = i+1; j < sets.length; j++) if (!!sets[j].warmup === !!s.warmup && (JSON.stringify(sets[j].load) === JSON.stringify(old) || sets[j].load == null || sets[j].load === "")) sets[j].load = v;
          onChange(true); }, `${keyPrefix}-l${i}`)),
      el("input", { id:`${keyPrefix}-r${i}`, inputmode:"numeric", placeholder: s.warmup ? HZ.WARM_REPS(warmIdx(i), sets.filter(x => x.warmup).length) : (opts.repsHint || "–"), "aria-label":"Powtórzenia", value: s.reps == null ? "" : String(s.reps),
        oninput(e){ const n = HZ.parseNum(e.target.value); s.reps = n == null ? null : Math.round(n); onChange(false); } }),
      s.warmup ? el("span", { class:"wlabel", text: ex.type === "band" && warmIdx(i) === 0 ? "aktywacja łopatek" : "wstępna" }) : HZ.rirSelect(s.rir, v => { s.rir = v; onChange(false); }, `${keyPrefix}-i${i}`));
  });
  const nWarm = sets.filter(s => s.warmup).length, nWork = sets.length - nWarm;
  const ctl = el("div", { class:"row" },
    opts.noWarmup ? null : el("button", { type:"button", class:"ghost", onclick(){
      const work = sets.find(s => !s.warmup); const warm = sets.filter(s => s.warmup);
      sets.splice(nWarm, 0, { load:null, reps:null, rir:null, warmup:true });
      if (work && warm.every(s => s.reps == null)){ const loads = HZ.warmupLoads(ex, nWarm + 1, work.load === "" ? null : work.load); sets.filter(s => s.warmup).forEach((s, k) => { s.load = loads[k] ?? s.load; }); }
      else { const lastW = warm[warm.length - 1]; sets[nWarm].load = lastW ? lastW.load : (ex.type === "band" ? "" : null); }
      onChange(true); }, text:"+ wstępna" }),
    nWarm && !opts.noWarmup ? el("button", { type:"button", class:"ghost", onclick(){ sets.splice(nWarm - 1, 1); onChange(true); }, text:"− wstępna" }) : null,
    el("button", { type:"button", class:"ghost", onclick(){ const last = sets.filter(s => !s.warmup).pop(); sets.push({ load: last ? last.load : null, reps:null, rir:null }); onChange(true); }, text:"+ seria" }),
    nWork > 1 ? el("button", { type:"button", class:"ghost", onclick(){ sets.pop(); onChange(true); }, text:"− seria" }) : null);
  return el("div", { class:"sets" }, head, rows, ctl);
};
HZ.tipBox = (sg, onPick, current) => el("div", { class:"tip " + sg.kind }, el("span", { class:"ic", "aria-hidden":"true", text:{ up:"↑", hold:"=", down:"↓", first:"•" }[sg.kind] }),
  el("div", { class:"stack", style:"gap:6px" }, el("div", {}, el("b", { text:sg.title }), el("span", { text:sg.text })),
    onPick && sg.options && sg.options.length > 1 ? el("div", { class:"chips" }, sg.options.map(o => el("button", { type:"button", class:"pick",
      "aria-pressed":String(JSON.stringify(current) === JSON.stringify(o.load)), onclick(){ onPick(o.load); }, text: o.label + (o.rec ? " · polecane" : "") }))) : null,
    onPick && sg.base != null ? customJump(sg, onPick, current) : null));
/* participant's own jump, e.g. +0,5 or +5 kg */
function customJump(sg, onPick, current){
  const isCustom = typeof current === "number" && current !== sg.next && current !== sg.base && !(sg.options || []).some(o => o.load === current);
  const inp = el("input", { type:"text", inputmode:"decimal", "aria-label":"Własny skok w kg", placeholder:"np. 0,5",
    value: isCustom && current > sg.base ? HZ.fmtKg(Math.round((current - sg.base) * 100) / 100) : "", style:"width:5rem;text-align:center;padding:6px 8px" });
  const go = () => { const v = HZ.parseNum(inp.value); if (v == null || v < 0 || v > 50){ HZ.toast("Wpisz skok od 0 do 50 kg, np. 0,5."); return; } onPick(Math.round((sg.base + v) * 100) / 100); };
  inp.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); go(); } });
  return el("div", { class:"row small", style:"gap:6px" }, el("span", { text:"Własny skok: +" }), inp, el("span", { text:"kg" }),
    el("button", { type:"button", class:"pick", "aria-pressed":String(isCustom), onclick: go, text: isCustom ? `→ ${HZ.fmtKg(current)} kg` : "Ustaw" }));
}
/* participant picks how they do the exercise: weight, band or bodyweight */
HZ.MODE_LABEL = { kg:"Ciężar", band:"Guma", bw:"Masa ciała" };
HZ.modeToggle = (cur, onPick) => el("div", { class:"modes", role:"group", "aria-label":"Sposób wykonania" },
  ["kg","band"].filter(m => m !== "band" || S.config.bands.length).map(m => el("button", { type:"button", "aria-pressed":String(cur === m), onclick(){ if (cur !== m) onPick(m); }, text:HZ.MODE_LABEL[m] })));
/* working sets reset to a new load (warm-ups without reps follow for kg) */
HZ.applyLoad = (ex, sets, load) => {
  for (const s of sets) if (!s.warmup) s.load = load;
  const warm = sets.filter(s => s.warmup);
  if ((ex.type === "kg" || ex.type === "band") && warm.every(s => s.reps == null)) HZ.warmupLoads(ex, warm.length, load).forEach((l, k) => { warm[k].load = l; });
};
HZ.buildSets = (ex, nWarm, nWork, next) => [
  ...HZ.warmupLoads(ex, nWarm, next).map(load => ({ load, reps:null, rir:null, warmup:true })),
  ...Array.from({ length:nWork }, () => ({ load: ex.type === "band" ? (next || "") : (next ?? null), reps:null, rir:null })) ];
HZ.setText = (e, s) => (e.type === "band" ? HZ.bandName(s.load) : e.type === "kg" ? HZ.fmtKg(s.load) : (s.load ? "+" + HZ.fmtKg(s.load) : "MC")) + "×" + s.reps;
HZ.setsText = (e, withRir = true) => {
  const warm = HZ.warmSets(e), work = (e.sets || []).filter(s => !s.warmup);
  const w = warm.length ? "wstępne: " + warm.map(s => HZ.setText(e, s)).join(", ") + " | " : "";
  return w + work.map(s => HZ.setText(e, s) + (withRir && s.rir != null ? ` R${s.rir}` : "")).join(" · ");
};

/* ---------- progress & chart ---------- */
const progSel = {};
HZ.progressView = (logs, title, key, rerender) => {
  const { fmtDate, fmtKg, bandName, bandIdx, exById } = HZ;
  const sorted = [...logs].sort((a,b) => (a.date||"").localeCompare(b.date||""));
  if (!sorted.length) return [el("div", { class:"empty" }, el("h3", { text:"Tu pojawią się postępy" }), el("p", { class:"small", text:"Po pierwszym zapisanym treningu zobaczysz wykres dla każdego ćwiczenia i średnie zmęczenie." }))];
  const all = sorted.flatMap(l => l.entries || []);
  const keyOf = e => e.exId + "|" + (e.type || "kg");
  const exIds = [...new Set(all.map(keyOf))];
  const typesOf = id => new Set(all.filter(e => e.exId === id).map(e => e.type || "kg"));
  const nameOf = k => { const [id, t] = k.split("|"); const n = (exById(id) || {}).name || (all.find(e => e.exId === id) || {}).exName || "Ćwiczenie";
    return typesOf(id).size > 1 ? `${n} (${HZ.MODE_LABEL[t].toLowerCase()})` : n; };
  const fat = sorted.filter(l => l.fatigue != null);
  const avgF = fat.length ? fat.reduce((a,l) => a + l.fatigue, 0) / fat.length : null;
  if (!exIds.includes(progSel[key])) progSel[key] = exIds[0];
  const cur = progSel[key];
  const [curId, curType] = cur.split("|");
  const ex = { ...(exById(curId) || { id:curId }), type:curType };
  const out = [el("div", { class:"card" }, el("h2", { text:title }),
    el("div", { class:"grid3" },
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Treningi" }), el("span", { class:"v", text:sorted.length })),
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Z grupą" }), el("span", { class:"v", text:sorted.filter(l => !l.own).length })),
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Śr. zmęczenie" }), el("span", { class:"v", text: avgF == null ? "–" : avgF.toLocaleString("pl-PL", { maximumFractionDigits:1 }) }))))];
  const pts = [];
  for (const l of sorted) for (const e0 of (l.entries || [])) if (keyOf(e0) === cur){
    const e = HZ.workEntry(e0); if (!e) continue;
    const load = HZ.workLoad(e); let y, lbl;
    if (ex.type === "kg"){ y = Math.max(...e.sets.map(s => s.load || 0)); lbl = `${fmtKg(y)} kg · ${e.sets.map(s => s.reps).join("/")}`; }
    else if (ex.type === "band"){ const i = load === "none" ? S.config.bands.length : bandIdx(load); if (i < 0) continue; y = i; lbl = `${bandName(load)} · ${e.sets.map(s => s.reps).join("/")}`; }
    else { y = e.sets.reduce((a,s) => a + (s.reps||0), 0); lbl = `${y} powt. łącznie`; }
    pts.push({ x:l.date, y, label:`${fmtDate(l.date)}: ${lbl}`, fatigue:l.fatigue });
  }
  const sel = el("select", { id:"prog-" + key, "aria-label":"Ćwiczenie", onchange(e){ progSel[key] = e.target.value; rerender(); } }, exIds.map(id => el("option", { value:id, text:nameOf(id) })));
  sel.value = cur;
  const ticks = ex.type === "band" ? [...S.config.bands.map((b,i) => ({ v:i, t:b.name })), { v:S.config.bands.length, t:"bez gumy" }] : null;
  const yLabel = ex.type === "kg" ? "Największy ciężar w treningu (kg)" : ex.type === "band" ? "Guma (wyżej = mniejsza asysta)" : "Powtórzenia łącznie";
  const rows = [...sorted].reverse().flatMap(l => (l.entries || []).filter(e => keyOf(e) === cur).map(e => el("tr", {},
    el("td", { text: fmtDate(l.date) + (l.own ? " (własny)" : "") }),
    el("td", { text: HZ.setsText(e, false) }),
    el("td", { text: e.sets.filter(s => !s.warmup).map(s => s.rir ?? "–").join("/") }),
    el("td", { text: l.fatigue ?? "–" }))));
  out.push(el("div", { class:"card" },
    el("div", { class:"row between" }, el("h3", { text:"Wykres postępu" }), el("div", { style:"flex:1 1 180px;max-width:260px" }, sel)),
    el("span", { class:"small muted", text:yLabel }),
    pts.length ? HZ.lineChart(pts, { ticks, fmt: ex.type === "kg" ? v => fmtKg(v) : v => String(Math.round(v)) }) : el("p", { class:"muted", text:"Brak danych." }),
    el("div", { class:"tablewrap" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text:"Data" }), el("th", { text:"Serie" }), el("th", { text:"RIR" }), el("th", { text:"Zmęcz." }))),
      el("tbody", {}, rows)))));
  return out;
};
function niceStep(raw){ const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
HZ.lineChart = (pts, { ticks, fmt }) => {
  const W = 360, H = 190, L = ticks ? 74 : 40, R = 14, T = 14, B = 26;
  const ys = pts.map(p => p.y); let lo = Math.min(...ys), hi = Math.max(...ys);
  if (ticks){ lo = 0; hi = Math.max(1, ticks.length - 1); } else { const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.1); lo = Math.max(0, lo - pad); hi = hi + pad; }
  if (hi === lo) hi = lo + 1;
  const x = i => pts.length === 1 ? (L + (W - R)) / 2 : L + i * (W - L - R) / (pts.length - 1);
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const tickVals = ticks || (() => { const step = niceStep((hi - lo) / 4); const o = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) o.push({ v, t:fmt(v) }); return o; })();
  const font = { "font-size":11, fill:"var(--muted)", "font-family":"IBM Plex Sans, system-ui, sans-serif" };
  const svg = sv("svg", { class:"chart", viewBox:`0 0 ${W} ${H}`, role:"img", "aria-label":"Wykres postępu" },
    tickVals.map(t => sv("g", {}, sv("line", { x1:L, x2:W-R, y1:y(t.v), y2:y(t.v), stroke:"var(--line)", "stroke-width":1 }), sv("text", { x:L-6, y:y(t.v)+4, "text-anchor":"end", ...font }, t.t))),
    pts.length > 1 ? sv("path", { d:`M${x(0)},${H-B} ` + pts.map((p,i) => `L${x(i)},${y(p.y)}`).join(" ") + ` L${x(pts.length-1)},${H-B} Z`, fill:"var(--accent)", "fill-opacity":0.1, stroke:"none" }) : null,
    pts.length > 1 ? sv("path", { d:pts.map((p,i) => `${i ? "L" : "M"}${x(i)},${y(p.y)}`).join(" "), fill:"none", stroke:"var(--accent)", "stroke-width":2, "stroke-linejoin":"round" }) : null,
    pts.map((p,i) => sv("circle", { cx:x(i), cy:y(p.y), r: i === pts.length-1 ? 5 : 3.5, fill: i === pts.length-1 ? "var(--accent)" : "var(--surface)", stroke:"var(--accent)", "stroke-width":2 })),
    sv("text", { x:L, y:H-6, ...font }, HZ.fmtDate(pts[0].x)),
    pts.length > 1 ? sv("text", { x:W-R, y:H-6, "text-anchor":"end", ...font }, HZ.fmtDate(pts[pts.length-1].x)) : null);
  const tt = el("div", { class:"tt", hidden:true });
  const box = el("div", { class:"chartbox" }, svg, tt);
  const move = ev => { const r = svg.getBoundingClientRect(); const sx = (ev.clientX - r.left) * W / r.width; let bi = 0, bd = 1e9;
    pts.forEach((p,i) => { const dd = Math.abs(x(i) - sx); if (dd < bd){ bd = dd; bi = i; } });
    const p = pts[bi]; tt.textContent = p.label + (p.fatigue != null ? ` · zmęcz. ${p.fatigue}/10` : ""); tt.hidden = false;
    tt.style.left = (x(bi) * r.width / W) + "px"; tt.style.top = (y(p.y) * r.height / H) + "px"; };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerdown", move); svg.addEventListener("pointerleave", () => { tt.hidden = true; });
  return box;
};

/* ---------- stats & ranking ----------
   Two separate boards:
   - general (points): rewards showing up — 10 per group workout, +5 for each Friday that continues a streak. Weights don't matter.
   - strength: 5 per personal record + average % progress of top working weight. */
HZ.POINTS = { workout:10, streak:5, pr:5 };
HZ.computeStats = (logs) => {
  const sorted = [...logs].sort((a,b) => (a.date||"").localeCompare(b.date||"") || (a.saved_at||"").localeCompare(b.saved_at||""));
  const attended = new Set(logs.filter(l => l.workout_id && !l.own).map(l => l.workout_id));
  const today = HZ.todayISO(); const past = HZ.sortedWorkouts().filter(w => w.date <= today);
  // attendance, streaks, general points
  let run = 0, longest = 0, bonus = 0, prevAttended = false, firstIdx = -1;
  past.forEach((w, i) => {
    const here = attended.has(w.id);
    if (here){ if (firstIdx < 0) firstIdx = i; if (prevAttended) bonus += HZ.POINTS.streak; run++; longest = Math.max(longest, run); }
    else if (w.date !== today) run = 0;
    prevAttended = here || (w.date === today && prevAttended);
  });
  let streak = 0;
  for (let i = past.length - 1; i >= 0; i--){ if (attended.has(past[i].id)) streak++; else if (past[i].date === today) continue; else break; }
  const pastAttended = past.filter(w => attended.has(w.id)).length;
  const possible = firstIdx < 0 ? 0 : past.length - firstIdx - (past.length && past[past.length-1].date === today && !attended.has(past[past.length-1].id) ? 1 : 0);
  const attendancePct = possible > 0 ? Math.round(pastAttended / possible * 100) : null;
  // records & progress (working sets only)
  const best = {}, span = {}, records = {}; let prs = 0, volume = 0;
  for (const l of sorted) for (const e0 of (l.entries || [])){
    const e = HZ.workEntry(e0); if (!e) continue;
    const t = e.type || "kg", k = e.exId + "|" + t; let v, label;
    if (t === "kg"){ v = Math.max(...e.sets.map(s => Number(s.load) || 0)); const top = e.sets.filter(s => (Number(s.load) || 0) === v);
      label = `${HZ.fmtKg(v)} kg × ${Math.max(...top.map(s => s.reps || 0))}`; volume += e.sets.reduce((a,s) => a + (Number(s.load) || 0) * (s.reps || 0), 0); }
    else if (t === "band"){ const ld = HZ.workLoad(e); v = ld === "none" ? S.config.bands.length : HZ.bandIdx(ld); if (v < 0) continue; label = (ld === "none" ? "bez gumy" : HZ.bandFull(ld)) + ` × ${Math.max(...e.sets.map(s => s.reps || 0))}`; }
    else { v = e.sets.reduce((a,s) => a + (s.reps || 0), 0); label = `${v} powt. łącznie`; }
    if (k in best){ if (v > best[k]){ prs++; best[k] = v; records[k] = { exId:e.exId, type:t, name:e.exName, label, date:l.date }; } }
    else { best[k] = v; records[k] = { exId:e.exId, type:t, name:e.exName, label, date:l.date }; }
    if (t === "kg" && v > 0) span[k] = span[k] ? { first:span[k].first, last:v, n:span[k].n + 1 } : { first:v, last:v, n:1 };
  }
  const pct = Object.values(span).filter(x => x.n > 1).map(x => (x.last - x.first) / x.first * 100);
  const progress = pct.length ? Math.round(pct.reduce((a,b) => a + b, 0) / pct.length) : null;
  return {
    workouts:attended.size, streak, longest, prs, progress, volume: Math.round(volume),
    points: attended.size * HZ.POINTS.workout + bonus,
    strength: prs * HZ.POINTS.pr + Math.max(0, progress || 0),
    attendancePct, records: Object.values(records)
  };
};
HZ.rankRow = st => { const { records, attendancePct, ...row } = st; return row; };   // what goes to the shared ranking

const fmtVol = v => v >= 1000 ? (v / 1000).toLocaleString("pl-PL", { maximumFractionDigits:1 }) + " t" : v + " kg";
const RANK_COLS = [
  ["points", "Pkt ogólne", r => r.points ?? 0],
  ["strength", "Pkt siłowe", r => r.strength ?? 0],
  ["workouts", "Treningi", r => r.workouts ?? 0],
  ["streak", "Seria", r => r.streak ?? 0],
  ["prs", "Rekordy", r => r.prs ?? 0],
  ["progress", "Progres", r => r.progress == null ? "–" : (r.progress > 0 ? "+" : "") + r.progress + "%"],
  ["volume", "Tonaż", r => fmtVol(r.volume || 0)]
];
const BOARDS = [
  { key:"points", label:"Ranking ogólny", unit:"pkt", desc:`Za regularność, nie za ciężar: ${HZ.POINTS.workout} pkt za każdy trening z grupą i +${HZ.POINTS.streak} pkt za każdy kolejny piątek z rzędu.` },
  { key:"strength", label:"Ranking siłowy", unit:"pkt", desc:`Za siłę: ${HZ.POINTS.pr} pkt za każdy rekord osobisty + średni progres największego ciężaru w %. Każdy porównywany jest sam ze sobą, więc liczy się postęp, nie masa ciała.` }
];
let rankSort = "points";
HZ.rankingView = (rows, meId, rerender, opts = {}) => {
  const vis = rows.filter(r => !r.hidden || opts.showHidden);
  if (!vis.length) return [el("div", { class:"empty" }, el("h3", { text:"Ranking jest jeszcze pusty" }), el("p", { class:"small", text:"Pojawi się, gdy uczestnicy zapiszą pierwsze treningi." }))];
  const val = r => r[rankSort] == null ? -Infinity : r[rankSort];
  const sorted = [...vis].sort((a,b) => val(b) - val(a) || ((b.points||0) - (a.points||0)) || (a.name || "").localeCompare(b.name || "", "pl"));
  let place = 0, prev;
  const placed = sorted.map((r, i) => { if (val(r) !== prev){ place = i + 1; prev = val(r); } return { r, place }; });
  const col = RANK_COLS.find(c => c[0] === rankSort);
  const board = BOARDS.find(b => b.key === rankSort);
  const podium = el("div", { class:"podium" }, placed.slice(0, 3).map(({ r, place }) => el("div", { class:"pod p" + place + (r.id === meId ? " me" : "") },
    el("span", { class:"pl", text: place + "." }), el("b", { text:r.name || "Uczestnik" }), el("span", { class:"pv", text: col[2](r) + (board ? " pkt" : "") }))));
  const me = placed.find(x => x.r.id === meId);
  return [el("div", { class:"card" },
      el("div", { class:"modes big", role:"group", "aria-label":"Rodzaj rankingu" },
        BOARDS.map(b => el("button", { type:"button", "aria-pressed":String(rankSort === b.key), onclick(){ rankSort = b.key; rerender(); }, text:b.label }))),
      el("p", { class:"small muted", text: board ? board.desc : `Posortowano według: ${col[1]}. Kliknij nagłówek tabeli, aby zmienić.` }),
      podium,
      me ? el("p", { class:"small", text:`Twoje miejsce: ${me.place} z ${placed.length}` }) : null),
    el("div", { class:"card" }, el("h3", { text:"Tabela ogólna" }),
      el("div", { class:"tablewrap" }, el("table", { class:"rank" },
        el("thead", {}, el("tr", {}, el("th", { text:"#" }), el("th", { text:"Imię" }),
          RANK_COLS.map(([k, label]) => el("th", { class: k === rankSort ? "on" : null }, el("button", { type:"button", class:"thsort", onclick(){ rankSort = k; rerender(); }, text: label + (k === rankSort ? " ↓" : "") }))))),
        el("tbody", {}, placed.map(({ r, place }) => el("tr", { class: r.id === meId ? "me" : null },
          el("td", { text:place }), el("td", { text:(r.name || "Uczestnik") + (r.hidden ? " (ukryty)" : "") }),
          RANK_COLS.map(([k,, f]) => el("td", { class: k === rankSort ? "on" : null, text:f(r) }))))))),
      el("p", { class:"small muted", text:"Seria: piątki z rzędu. Rekord: wynik lepszy od wszystkich poprzednich w danym ćwiczeniu i sposobie wykonania. Progres: średni wzrost największego ciężaru od pierwszego treningu. Tonaż: ciężar × powtórzenia w seriach roboczych." }))];
};

/* individual stats card (client: Postępy; trainer: client history) */
HZ.personalStats = (logs, title) => {
  const st = HZ.computeStats(logs);
  const tile = (label, value, sub) => el("div", { class:"stat" }, el("span", { class:"eyebrow", text:label }), el("span", { class:"v", text:value }), sub ? el("span", { class:"small muted", text:sub }) : null);
  const recs = [...st.records].sort((a,b) => (a.name || "").localeCompare(b.name || "", "pl"));
  return el("div", { class:"card" },
    el("h2", { text:title }),
    el("div", { class:"grid3" },
      tile("Treningi z grupą", st.workouts, st.attendancePct == null ? null : `${st.attendancePct}% obecności`),
      tile("Seria", st.streak, `najdłuższa: ${st.longest}`),
      tile("Rekordy", st.prs, st.progress == null ? null : `progres ${st.progress > 0 ? "+" : ""}${st.progress}%`),
      tile("Pkt ogólne", st.points),
      tile("Pkt siłowe", st.strength),
      tile("Tonaż", fmtVol(st.volume))),
    recs.length ? el("div", { class:"stack", style:"gap:4px" }, el("h3", { text:"Rekordy osobiste" }),
      el("div", { class:"list" }, recs.map(r => el("div", { class:"row between", style:"flex-wrap:nowrap" },
        el("span", { style:"min-width:0", text: r.name + (st.records.filter(x => x.exId === r.exId).length > 1 ? ` (${HZ.MODE_LABEL[r.type].toLowerCase()})` : "") }),
        el("span", { class:"num", style:"font-size:1.1rem;font-weight:600;white-space:nowrap", text:r.label }),
        el("span", { class:"small muted", style:"white-space:nowrap", text:HZ.fmtDate(r.date) }))))) : null);
};

/* ---------- auth screens ---------- */
function authMsg(err){
  const c = (err && err.code) || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "Nieprawidłowy e-mail lub hasło.";
  if (c === "auth/email-already-in-use") return "To konto już istnieje. Zaloguj się.";
  if (c === "auth/weak-password") return "Hasło musi mieć co najmniej 6 znaków.";
  if (c === "auth/invalid-email") return "Wpisz poprawny adres e-mail.";
  if (c === "auth/too-many-requests") return "Za dużo prób. Odczekaj chwilę i spróbuj ponownie.";
  if (c === "auth/network-request-failed") return "Brak połączenia z internetem.";
  if (c === "auth/operation-not-allowed") return "Logowanie e-mailem nie jest włączone w Firebase (Authentication → Sign-in method).";
  if (c === "hz/join-code") return "Nieprawidłowy kod klubu. Zapytaj trenera o aktualny kod.";
  return "Coś poszło nie tak. Spróbuj ponownie.";
}
HZ.authMsg = authMsg;
HZ.registering = null;
/* mode: "login" | "register" | "forgot"; allowRegister=false on admin page */
HZ.authView = ({ mode, allowRegister, onMode, title, sub }) => {
  const msg = el("p", { class:"small", role:"alert", style:"color:var(--bad)" });
  const info = el("p", { class:"notice", hidden:true });
  const form = el("form", { class:"card", novalidate:true });
  const heading = { login:"Zaloguj się", register:"Załóż konto", forgot:"Nie pamiętasz hasła?" }[mode];
  form.append(el("div", { class:"stack", style:"gap:4px" }, el("h2", { text: title || heading }), sub ? el("p", { class:"small muted", text:sub }) : null));
  const emailIn = el("input", { id:"au-email", type:"email", autocomplete:"email", required:true, value:HZ.LS.get("hz-email") || "" });
  const passIn = el("input", { id:"au-pass", type:"password", autocomplete: mode === "login" ? "current-password" : "new-password", minlength:"6", required:true });
  const nameIn = el("input", { id:"au-name", autocomplete:"given-name", maxlength:"60", placeholder:"np. Kasia" });
  const codeIn = el("input", { id:"au-code", autocomplete:"off", placeholder:"kod od trenera", style:"text-transform:uppercase" });
  if (mode === "register") form.append(el("label", { class:"f" }, "Imię", nameIn));
  form.append(el("label", { class:"f" }, "E-mail", emailIn));
  if (mode !== "forgot") form.append(el("label", { class:"f" }, "Hasło (min. 6 znaków)", passIn));
  if (mode === "register") form.append(el("label", { class:"f" }, "Kod klubu", codeIn));
  const submit = el("button", { type:"submit", class:"primary", text:{ login:"Zaloguj", register:"Załóż konto", forgot:"Wyślij link" }[mode] });
  form.append(msg, info, submit);
  const links = el("div", { class:"row between small" });
  if (mode === "login"){ if (allowRegister) links.append(el("button", { type:"button", class:"link", onclick(){ onMode("register"); }, text:"Nie masz konta? Załóż je" }));
    links.append(el("button", { type:"button", class:"link", onclick(){ onMode("forgot"); }, text:"Nie pamiętam hasła" })); }
  else links.append(el("button", { type:"button", class:"link", onclick(){ onMode("login"); }, text:"Wróć do logowania" }));
  form.append(links);
  form.addEventListener("submit", async ev => {
    ev.preventDefault(); msg.textContent = ""; info.hidden = true;
    const email = emailIn.value.trim().toLowerCase(), pass = passIn.value;
    if (!/^\S+@\S+\.\S+$/.test(email)){ msg.textContent = "Wpisz poprawny adres e-mail."; return; }
    if (mode !== "forgot" && pass.length < 6){ msg.textContent = "Hasło musi mieć co najmniej 6 znaków."; return; }
    if (mode === "register" && !nameIn.value.trim()){ msg.textContent = "Wpisz imię."; return; }
    if (mode === "register" && !codeIn.value.trim()){ msg.textContent = "Wpisz kod klubu."; return; }
    HZ.LS.set("hz-email", email); submit.disabled = true;
    try {
      if (mode === "login") await auth.signInWithEmailAndPassword(email, pass);
      if (mode === "register"){
        const name = nameIn.value.trim().slice(0, 60), joinCode = codeIn.value.trim().toUpperCase();
        HZ.registering = (async () => {
          const cred = await auth.createUserWithEmailAndPassword(email, pass);
          const r = await HZ.api.createProfile(cred.user.uid, { name, email, joinCode });
          if (r.error){
            await cred.user.delete().catch(() => auth.signOut());
            const e = new Error("profile"); e.code = r.error.code === "permission-denied" ? "hz/join-code" : r.error.code; throw e;
          }
        })();
        try { await HZ.registering; } finally { HZ.registering = null; }
      }
      if (mode === "forgot"){ await auth.sendPasswordResetEmail(email);
        info.textContent = "Jeśli konto istnieje, wysłaliśmy link do zmiany hasła. Sprawdź skrzynkę (także spam)."; info.hidden = false; }
    } catch(e){ msg.textContent = authMsg(e); if (mode === "register") HZ.toast(authMsg(e)); }
    submit.disabled = false;
  });
  return form;
};
HZ.resetPassword = email => auth.sendPasswordResetEmail(email);

HZ.setupNeeded = () => [el("div", { class:"card" }, el("h2", { text:"Aplikacja nie jest jeszcze podłączona" }),
  el("p", { text:"Uzupełnij dane projektu Firebase w pliku config.js. Instrukcja jest w README." }))];
})();
