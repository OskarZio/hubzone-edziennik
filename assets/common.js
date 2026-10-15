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
  saveLibrary: lib => wrap(() => db.doc("config/library").set(lib)),
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
HZ.TYPE_LABEL = { kg:"ciężar (kg)", band:"guma (asysta)", bw:"masa ciała" };
HZ.plural = (n, one, few, many) => n === 1 ? one : (n%10 >= 2 && n%10 <= 4 && (n%100 < 10 || n%100 >= 20)) ? few : many;

HZ.brand = (sub) => el("div", { class:"brand" }, el("span", { class:"mark", "aria-hidden":"true", text:"HZ" }),
  el("span", { class:"bt" }, el("b", { text:"Hubzone Weightlifting" }), el("span", { text: sub || "e-Dziennik" })));

/* ---------- shared state ---------- */
const S = HZ.S = { config:{ exercises:[], bands:[] }, workouts:[] };
HZ.exById = id => S.config.exercises.find(e => e.id === id);
HZ.bandIdx = id => S.config.bands.findIndex(b => b.id === id);
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
  S.config = { exercises:(d.exercises || []).map(e => ({ ...e, inc:Number(e.inc) || 0 })), bands:d.bands || [] };
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
HZ.history = (logs, exId, excludeWorkoutId) => {
  const out = [];
  for (const l of logs){ if (excludeWorkoutId && l.workout_id === excludeWorkoutId) continue;
    for (const e of (l.entries || [])) if (e.exId === exId && e.sets && e.sets.length) out.push({ log:l, entry:e }); }
  return out.sort((a,b) => (b.log.date||"").localeCompare(a.log.date||"") || (b.log.saved_at||"").localeCompare(a.log.saved_at||""));
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
HZ.suggest = (logs, exId, type, inc, excludeWorkoutId) => {
  const { fmtKg, fmtDate, bandName, bandIdx, fmtLoad } = HZ;
  const h = HZ.history(logs, exId, excludeWorkoutId);
  if (!h.length) return { kind:"first", title:"Pierwszy raz", text:"Dobierz obciążenie, przy którym na końcu serii zostają ci 2–3 powtórzenia zapasu (RIR 2–3).", next:null };
  const { log, entry } = h[0]; const load = HZ.workLoad(entry); const { hit, minRir } = HZ.judge(entry);
  const setTxt = entry.sets.map(s => type === "kg" ? `${fmtKg(s.load)}×${s.reps ?? "–"}` : type === "band" ? `${bandName(s.load)}×${s.reps ?? "–"}` : `${s.reps ?? "–"}`).join(" · ");
  const last = `Ostatnio (${fmtDate(log.date)}): ${setTxt}` + (minRir != null ? `, najniższy RIR ${minRir}` : "");
  const tiredNote = log.fatigue != null && log.fatigue >= 9 ? ` Zmęczenie było wtedy wysokie (${log.fatigue}/10), więc dołóż tylko, jeśli dziś czujesz się lepiej.` : "";
  const step = Number(inc) > 0 ? Number(inc) : 2.5;
  const bands = S.config.bands;
  if (hit && minRir != null && minRir >= 2){
    const big = minRir >= 4;
    if (type === "kg"){ const add = big ? step*2 : step; return { kind:"up", title:`Dołóż ${fmtKg(add)} kg → ${fmtKg((load||0) + add)} kg`, text:last + "." + tiredNote, next:(load||0) + add }; }
    if (type === "band"){
      const i = bandIdx(load);
      if (load === "none" || i < 0) return { kind:"up", title:"Bez gumy: dołóż powtórzenie", text:last + ". Spróbuj zrobić o 1 powtórzenie więcej w każdej serii." + tiredNote, next:"none" };
      const ni = Math.min(bands.length, i + (big ? 2 : 1)); const nx = ni >= bands.length ? "none" : bands[ni].id;
      return { kind:"up", title: nx === "none" ? "Spróbuj bez gumy" : `Zmniejsz gumę → ${bandName(nx)}`, text:last + "." + tiredNote, next:nx };
    }
    return { kind:"up", title:`Dołóż ${big ? 2 : 1} powt. w serii`, text:last + `. Cel: ${(entry.targetReps||0) + (big ? 2 : 1)} powtórzeń.` + tiredNote, next:load };
  }
  if (hit) return { kind:"hold", title:`Zostań przy: ${fmtLoad(type, load)}`, text:last + ". Serie wyszły, ale blisko upadku. Powtórz obciążenie i celuj w RIR 2.", next:load };
  const prev = h[1];
  const missedTwice = prev && JSON.stringify(HZ.workLoad(prev.entry)) === JSON.stringify(load) && !HZ.judge(prev.entry).hit;
  if (missedTwice){
    if (type === "kg"){ const nx = Math.max(0, (load||0) - step); return { kind:"down", title:`Zmniejsz o ${fmtKg(step)} kg → ${fmtKg(nx)} kg`, text:last + ". Drugi raz z rzędu zabrakło powtórzeń.", next:nx }; }
    if (type === "band"){ const i = load === "none" ? bands.length : bandIdx(load); const nx = i > 0 ? bands[i-1].id : load;
      return { kind:"down", title: nx === load ? "Zostań przy tej gumie" : `Mocniejsza guma → ${bandName(nx)}`, text:last + ". Drugi raz z rzędu zabrakło powtórzeń.", next:nx }; }
  }
  return { kind:"hold", title:`Zostań przy: ${fmtLoad(type, load)}`, text:last + `. Zabrakło powtórzeń do celu ${entry.targetSets || ""}×${entry.targetReps || ""}. Spróbuj domknąć wszystkie serie.`, next:load };
};

/* ---------- UI pieces ---------- */
HZ.tabBar = (items, cur, onPick) => el("nav", { class:"tabs", "aria-label":"Sekcje" },
  items.map(([k,label]) => el("button", { type:"button", "aria-pressed":String(cur === k), onclick(){ onPick(k); }, text:label })));
HZ.fatiguePicker = (cur, onPick) => el("div", { class:"fatigue", role:"group", "aria-label":"Zmęczenie od 1 do 10" },
  Array.from({ length:10 }, (_,i) => i+1).map(n => el("button", { type:"button", "aria-pressed":String(cur === n), onclick(){ onPick(cur === n ? null : n); }, text:n })));
HZ.loadInput = (ex, val, onVal, id) => {
  if (ex.type === "band") return el("select", { id, "aria-label":"Guma", value: val || "", onchange(e){ onVal(e.target.value || null); } },
    el("option", { value:"", text:"–" }), S.config.bands.map(b => el("option", { value:b.id, text:b.name })), el("option", { value:"none", text:"bez gumy" }));
  return el("input", { id, inputmode:"decimal", placeholder: ex.type === "bw" ? "+kg" : "kg", "aria-label": ex.type === "bw" ? "Dodatkowe obciążenie" : "Ciężar w kg",
    value: val == null ? "" : HZ.fmtKg(val), onchange(e){ onVal(HZ.parseNum(e.target.value)); } });
};
HZ.rirSelect = (val, onVal, id) => el("select", { id, "aria-label":"Zapas powtórzeń (RIR)", value: val == null ? "" : String(val), onchange(e){ onVal(e.target.value === "" ? null : Number(e.target.value)); } },
  el("option", { value:"", text:"–" }), [0,1,2,3,4,5].map(n => el("option", { value:String(n), text: n === 5 ? "5+" : String(n) })));
HZ.setsEditor = (ex, sets, keyPrefix, onChange) => {
  const head = el("div", { class:"set head" }, el("span", { text:"Seria" }), el("span", { text: ex.type === "band" ? "Guma" : ex.type === "bw" ? "Dociąż." : "Ciężar" }), el("span", { text:"Powt." }), el("span", { text:"RIR" }));
  const rows = sets.map((s, i) => {
    const sw = ex.type === "band" && s.load && s.load !== "none" ? (S.config.bands.find(b => b.id === s.load) || {}).color : null;
    return el("div", { class:"set" },
      el("span", { class:"n", text:i+1 }),
      el("div", { class:"row", style:"flex-wrap:nowrap;gap:4px" }, sw ? el("span", { class:"swatch", style:`background:${sw}` }) : null,
        HZ.loadInput(ex, s.load, v => { const old = s.load; s.load = v;
          for (let j = i+1; j < sets.length; j++) if (JSON.stringify(sets[j].load) === JSON.stringify(old) || sets[j].load == null || sets[j].load === "") sets[j].load = v;
          onChange(true); }, `${keyPrefix}-l${i}`)),
      el("input", { id:`${keyPrefix}-r${i}`, inputmode:"numeric", placeholder:"–", "aria-label":"Powtórzenia", value: s.reps == null ? "" : String(s.reps),
        oninput(e){ const n = HZ.parseNum(e.target.value); s.reps = n == null ? null : Math.round(n); onChange(false); } }),
      HZ.rirSelect(s.rir, v => { s.rir = v; onChange(false); }, `${keyPrefix}-i${i}`));
  });
  const ctl = el("div", { class:"row" },
    el("button", { type:"button", class:"ghost", onclick(){ const last = sets[sets.length-1]; sets.push({ load: last ? last.load : null, reps:null, rir:null }); onChange(true); }, text:"+ seria" }),
    sets.length > 1 ? el("button", { type:"button", class:"ghost", onclick(){ sets.pop(); onChange(true); }, text:"− seria" }) : null);
  return el("div", { class:"sets" }, head, rows, ctl);
};
HZ.tipBox = sg => el("div", { class:"tip " + sg.kind }, el("span", { class:"ic", "aria-hidden":"true", text:{ up:"↑", hold:"=", down:"↓", first:"•" }[sg.kind] }),
  el("div", { style:"min-width:0" }, el("b", { text:sg.title }), el("span", { text:sg.text })));
HZ.setsText = e => e.sets.map(s => (e.type === "band" ? HZ.bandName(s.load) : e.type === "kg" ? HZ.fmtKg(s.load) : (s.load ? "+" + HZ.fmtKg(s.load) : "MC")) + "×" + s.reps + (s.rir != null ? ` R${s.rir}` : "")).join(" · ");

/* ---------- progress & chart ---------- */
const progSel = {};
HZ.progressView = (logs, title, key, rerender) => {
  const { fmtDate, fmtKg, bandName, bandIdx, exById } = HZ;
  const sorted = [...logs].sort((a,b) => (a.date||"").localeCompare(b.date||""));
  if (!sorted.length) return [el("div", { class:"empty" }, el("h3", { text:"Tu pojawią się postępy" }), el("p", { class:"small", text:"Po pierwszym zapisanym treningu zobaczysz wykres dla każdego ćwiczenia i średnie zmęczenie." }))];
  const all = sorted.flatMap(l => l.entries || []);
  const exIds = [...new Set(all.map(e => e.exId))];
  const nameOf = id => (exById(id) || {}).name || (all.find(e => e.exId === id) || {}).exName || "Ćwiczenie";
  const fat = sorted.filter(l => l.fatigue != null);
  const avgF = fat.length ? fat.reduce((a,l) => a + l.fatigue, 0) / fat.length : null;
  if (!exIds.includes(progSel[key])) progSel[key] = exIds[0];
  const cur = progSel[key];
  const ex = exById(cur) || { id:cur, name:nameOf(cur), type:(all.find(e => e.exId === cur) || {}).type || "kg" };
  const out = [el("div", { class:"card" }, el("h2", { text:title }),
    el("div", { class:"grid3" },
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Treningi" }), el("span", { class:"v", text:sorted.length })),
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Z grupą" }), el("span", { class:"v", text:sorted.filter(l => !l.own).length })),
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Śr. zmęczenie" }), el("span", { class:"v", text: avgF == null ? "–" : avgF.toLocaleString("pl-PL", { maximumFractionDigits:1 }) }))))];
  const pts = [];
  for (const l of sorted) for (const e of (l.entries || [])) if (e.exId === cur){
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
  const rows = [...sorted].reverse().flatMap(l => (l.entries || []).filter(e => e.exId === cur).map(e => el("tr", {},
    el("td", { text: fmtDate(l.date) + (l.own ? " (własny)" : "") }),
    el("td", { text: HZ.setsText(e).replace(/ R\d/g, "") }),
    el("td", { text: e.sets.map(s => s.rir ?? "–").join("/") }),
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
