/* Hubzone Weightlifting e-Dziennik — wspólny kod (klient + trener) */
(function(){
"use strict";
const HZ = window.HZ = {};

/* ---------- security: refuse to run inside someone else's frame (clickjacking) ---------- */
if (window.top !== window.self){
  document.documentElement.style.display = "none";
  try { window.top.location = window.self.location.href; } catch(e){}
  throw new Error("framed");
}

/* ---------- privacy (RODO) ---------- */
HZ.POLICY_VERSION = "2026-10-20";
HZ.MIN_PASSWORD = 8;
HZ.legal = window.HZ_LEGAL || {};

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
const asProfile = (id, d) => d ? { id, name:d.name || "", email:d.email || "", is_admin:d.isAdmin === true, manual:d.manual === true, guest:d.guest === true, advanced:d.advanced === true, progression: ["fast","slow"].includes(d.progression) ? d.progression : "std", task:(d.task || "").slice(0, 300), bodyweight: Number(d.bodyweight) > 0 ? Number(d.bodyweight) : null, birthYear: Number(d.birthYear) > 1900 ? Number(d.birthYear) : null, sex: d.sex === "K" || d.sex === "M" ? d.sex : null, created_at:d.createdAt || null, consent: d.consent || null } : null;
HZ.consentOk = p => !!(p && p.consent && p.consent.policy === HZ.POLICY_VERSION && p.consent.age16 === true);
HZ.makeConsent = (prev, patch) => ({ policy:HZ.POLICY_VERSION, at:new Date().toISOString(), age16:!!(prev && prev.age16), ranking:!!(prev && prev.ranking), health:!!(prev && prev.health), ...patch });
const delWhere = async (field, val) => { const s = await db.collection("logs").where(field, "==", val).get(); for (const d of s.docs) await d.ref.delete(); return s.size; };
HZ.api = {
  /* auth */
  onAuth(cb){ auth.onAuthStateChanged(u => cb(u ? { user:{ id:u.uid, email:u.email || "", guest:!!u.isAnonymous } } : null)); },
  signOut: () => auth.signOut(),
  /* profiles */
  profile: uid => wrap(async () => { const s = await db.doc("users/" + uid).get(); return s.exists ? asProfile(uid, s.data()) : null; }),
  createProfile: (uid, { name, email, joinCode, consent, guest }) => wrap(() => db.doc("users/" + uid).set({ name, email, isAdmin:false, joinCode, createdAt:new Date().toISOString(), consent, ...(guest ? { guest:true } : {}) })),
  /* guest: quick entry without e-mail (Firebase anonymous sign-in); same uid is kept when the guest later creates an account */
  startGuest: ({ name, joinCode, ranking }) => {
    HZ.registering = (async () => {
      const cred = await auth.signInAnonymously();
      const consent = HZ.makeConsent(null, { age16:true, ranking:!!ranking, health:false });
      const r = await HZ.api.createProfile(cred.user.uid, { name, email:"", joinCode, consent, guest:true });
      if (r.error){ await cred.user.delete().catch(() => auth.signOut());
        const e = new Error("profile"); e.code = r.error.code === "permission-denied" ? "hz/join-code" : r.error.code; throw e; }
    })();
    return HZ.registering.finally(() => { HZ.registering = null; });
  },
  convertGuest: (uid, email, password) => wrap(async () => {
    const u = auth.currentUser; if (!u || u.uid !== uid || !u.isAnonymous) throw { code:"auth/no-current-user" };
    await u.linkWithCredential(firebase.auth.EmailAuthProvider.credential(email, password));
    await u.getIdToken(true);   // new token carries the e-mail, required by the database rules
    await db.doc("users/" + uid).update({ email, guest:false, convertedAt:new Date().toISOString() });
    u.sendEmailVerification().catch(() => {});
  }),
  /* RODO: access / portability (art. 15, 20) and erasure (art. 17) */
  exportMyData: uid => wrap(async () => {
    const [p, l, r] = await Promise.all([db.doc("users/" + uid).get(), db.collection("logs").where("user_id", "==", uid).get(), db.doc("ranking/" + uid).get()]);
    const profile = p.exists ? { ...p.data() } : null; if (profile) delete profile.joinCode;
    return { exportedAt:new Date().toISOString(), app:"Hubzone Weightlifting e-Dziennik", account:{ uid, email: auth.currentUser && auth.currentUser.email },
      profile, trainingLogs:list(l), ranking: r.exists ? r.data() : null };
  }),
  deleteMyAccount: (uid, password) => wrap(async () => {
    const u = auth.currentUser; if (!u || u.uid !== uid) throw { code:"auth/no-current-user" };
    if (!u.isAnonymous) await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, password));
    await delWhere("user_id", uid);
    for (const d of (await db.collection("drafts").where("user_id", "==", uid).get().catch(() => ({ docs:[] }))).docs) await d.ref.delete().catch(() => {});
    await db.doc("ranking/" + uid).delete().catch(() => {});
    await db.doc("users/" + uid).delete();
    await u.delete().catch(e => { if (!u.isAnonymous) throw e; return auth.signOut(); });
  }),
  deleteClientData: uid => wrap(async () => { const n = await delWhere("user_id", uid);
    await db.doc("plans/" + uid).delete().catch(() => {});
    for (const c of ["drafts", "approvals", "technique"]) for (const d of (await db.collection(c).where("user_id", "==", uid).get().catch(() => ({ docs:[] }))).docs) await d.ref.delete().catch(() => {}); await db.doc("ranking/" + uid).delete().catch(() => {}); await db.doc("users/" + uid).delete(); return n; }),
  updateName: (uid, name) => wrap(() => db.doc("users/" + uid).update({ name })),
  updateProfile: (uid, patch) => wrap(() => db.doc("users/" + uid).update(patch)),
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
  setGuestLimit: n => wrap(() => db.doc("config/library").set({ guestLimit:Math.max(0, Math.min(20, Math.round(n) || 0)) }, { merge:true })),
  setRankingEnabled: on => wrap(() => db.doc("config/library").set({ rankingEnabled:!!on }, { merge:true })),
  ranking: () => wrap(async () => list(await db.collection("ranking").get())),
  myRanking: uid => wrap(async () => { const s = await db.doc("ranking/" + uid).get(); return s.exists ? s.data() : null; }),
  saveRanking: (uid, row) => wrap(() => db.doc("ranking/" + uid).set(row)),
  deleteRanking: uid => wrap(() => db.doc("ranking/" + uid).delete()),
  /* clients without an account (no phone): created and filled in by the trainer */
  addManualClient: (name, consent) => wrap(async () => { const id = "m_" + HZ.uuid().replace(/-/g, "").slice(0, 20);
    const doc = { name, email:"", isAdmin:false, manual:true, createdAt:new Date().toISOString(), consent };
    await db.doc("users/" + id).set(doc); return asProfile(id, doc); }),
  renameManualClient: (id, name) => wrap(() => db.doc("users/" + id).update({ name })),
  deleteManualClient: id => wrap(async () => { await delWhere("user_id", id); await db.doc("ranking/" + id).delete().catch(() => {}); await db.doc("users/" + id).delete(); }),
  setFeatures: patch => wrap(() => db.doc("config/library").set({ features:patch }, { merge:true })),
  setAdvanced: (uid, on) => wrap(() => db.doc("users/" + uid).update({ advanced:!!on })),
  updateClient: (uid, patch) => wrap(() => db.doc("users/" + uid).update(patch)),
  setWorkoutOpen: (id, open) => wrap(() => db.doc("workouts/" + id).update(open ? { open:true, openedAt:new Date().toISOString() } : { open:false, closedAt:new Date().toISOString() })),
  /* records approved / rejected by the trainer (client can read own) */
  approvalsOf: uid => wrap(async () => list(await db.collection("approvals").where("user_id", "==", uid).get())),
  allApprovals: () => wrap(async () => list(await db.collection("approvals").get())),
  setApproval: (logId, userId, stationId, val) => wrap(() => db.doc("approvals/" + logId).set({ user_id:userId, items:{ [stationId]:val }, at:new Date().toISOString() }, { merge:true })),
  /* technique notes: trainer only */
  techniqueFor: wid => wrap(async () => list(await db.collection("technique").where("workout_id", "==", wid).get())),
  techniqueOf: uid => wrap(async () => list(await db.collection("technique").where("user_id", "==", uid).get())),
  setTechnique: (logId, userId, wid, stationId, val) => wrap(() => db.doc("technique/" + logId).set({ user_id:userId, workout_id:wid, items:{ [stationId]:val } }, { merge:true })),
  /* unsent drafts, so the trainer sees results even if someone forgot to send */
  saveDraft: row => wrap(() => db.doc("drafts/" + row.user_id + "_" + row.workout_id).set(row)),
  deleteDraft: (uid, wid) => wrap(() => db.doc("drafts/" + uid + "_" + wid).delete()),
  draftsForWorkout: wid => wrap(async () => list(await db.collection("drafts").where("workout_id", "==", wid).get())),
  /* attendance: clients marked absent for a training (trainer only) */
  getAbsent: wid => wrap(async () => { const d = await db.doc("attendance/" + wid).get(); return d.exists ? (d.data().absent || []) : []; }),
  setAbsent: (wid, absent) => wrap(() => db.doc("attendance/" + wid).set({ absent, at:new Date().toISOString() })),
  saveGroups: groups => wrap(() => db.doc("config/library").set({ groups }, { merge:true })),
  /* trainer's plan for the next training: weight and reps per exercise */
  planOf: uid => wrap(async () => { const d = await db.doc("plans/" + uid).get(); return d.exists ? (d.data().items || {}) : {}; }),
  setPlan: (uid, exId, val) => wrap(() => db.doc("plans/" + uid).set({ user_id:uid, items:{ [exId]:val } }, { merge:true })),
  getClub: () => wrap(async () => { const s = await db.doc("settings/club").get(); return s.exists ? (s.data().joinCode || null) : null; }),
  setClub: code => wrap(() => db.doc("settings/club").set({ joinCode:code })),
  saveWorkout: row => wrap(async () => { const { id, ...body } = row; await db.doc("workouts/" + id).set(body); return row; }),
  deleteWorkout: id => wrap(() => db.doc("workouts/" + id).delete())
};

/* ---------- theme (per device): light / dark / auto + accent colour ---------- */
HZ.ACCENTS = {
  orange:{ name:"Pomarańczowy", light:["#D9480F","#FBE3D6","#FFFFFF"], dark:["#FF7A45","#3A2016","#1A0D06"] },
  red:   { name:"Czerwony",     light:["#C92A3A","#F9DDE0","#FFFFFF"], dark:["#FF6B7A","#3A1A1F","#1A0608"] },
  blue:  { name:"Niebieski",    light:["#1C64C8","#DCE9FB","#FFFFFF"], dark:["#5CA3FF","#16263F","#06101E"] },
  teal:  { name:"Turkusowy",    light:["#0B7F7A","#D3F0EE","#FFFFFF"], dark:["#3CCFC6","#123130","#04191A"] },
  green: { name:"Zielony",      light:["#2F8A2F","#DDF2DB","#FFFFFF"], dark:["#6ACB5F","#1A3319","#081A07"] },
  purple:{ name:"Fioletowy",    light:["#7340C9","#ECE2FA","#FFFFFF"], dark:["#B08CFF","#2A1F40","#120A22"] },
  pink:  { name:"Różowy",       light:["#C2256F","#F9DDEA","#FFFFFF"], dark:["#FF6FAE","#3A1828","#1E0812"] },
  gold:  { name:"Złoty",        light:["#A86A00","#F7EAD0","#FFFFFF"], dark:["#F2B33D","#3A2B10","#1C1302"] }
};
HZ.getTheme = () => { let t = null; try { t = JSON.parse(localStorage.getItem("hz-theme")); } catch(e){} return { mode:(t && t.mode) || "auto", accent:(t && HZ.ACCENTS[t.accent] ? t.accent : "orange") }; };
HZ.applyTheme = () => {
  const t = HZ.getTheme(), root = document.documentElement;
  if (t.mode === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", t.mode);
  const dark = t.mode === "dark" || (t.mode === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  const [acc, soft, ink] = HZ.ACCENTS[t.accent][dark ? "dark" : "light"];
  root.style.setProperty("--accent", acc); root.style.setProperty("--accent-soft", soft); root.style.setProperty("--accent-ink", ink);
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute("content", dark ? "#0F1418" : "#14202A");
};
HZ.setTheme = patch => { const t = { ...HZ.getTheme(), ...patch }; try { localStorage.setItem("hz-theme", JSON.stringify(t)); } catch(e){} HZ.applyTheme(); };
try { HZ.applyTheme(); if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", HZ.applyTheme); } catch(e){}

/* ---------- install as an app (Android: install button, iPhone: Share → Add to Home Screen) ---------- */
HZ.install = { prompt:null, listeners:[] };
try { if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {}); } catch(e){}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); HZ.install.prompt = e; HZ.install.listeners.forEach(f => f()); });
window.addEventListener("appinstalled", () => { HZ.install.prompt = null; HZ.install.done = true; HZ.install.listeners.forEach(f => f()); });
HZ.APK_URL = "https://github.com/OskarZio/hubzone-edziennik/releases/download/android/hubzone.apk";
HZ.isStandalone = () => { try { return /HubzoneApp/.test(navigator.userAgent) || matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch(e){ return false; } };
HZ.platform = () => { const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(ua) ? "android" : "desktop"; };
HZ.installCard = (rerender, { compact = false, title = "Aplikacja na telefonie", onClose = null } = {}) => {
  if (HZ.isStandalone() || HZ.install.done) return null;
  if (rerender && !HZ.install.hooked){ HZ.install.hooked = true; HZ.install.listeners.push(rerender); }
  const pf = HZ.platform(), pr = HZ.install.prompt;
  const steps = pf === "ios"
    ? el("ol", { class:"small", style:"margin:0;padding-left:1.2em;display:grid;gap:4px" },
        el("li", {}, "Stuknij ", el("b", { text:"Udostępnij" }), " (kwadrat ze strzałką ⬆︎) na dole Safari."),
        el("li", {}, "Przewiń i wybierz ", el("b", { text:"„Do ekranu początkowego”" }), "."),
        el("li", {}, "Stuknij ", el("b", { text:"„Dodaj”" }), " – ikona Hubzone pojawi się na pulpicie."))
    : pf === "android"
      ? el("p", { class:"small", style:"margin:0" }, "Otwórz menu przeglądarki ", el("b", { text:"⋮" }), " i wybierz ", el("b", { text:"„Zainstaluj aplikację”" }), " albo ", el("b", { text:"„Dodaj do ekranu głównego”" }), ".")
      : el("p", { class:"small", style:"margin:0", text:"Na telefonie otwórz tę stronę i dodaj ją do ekranu głównego. Na komputerze w Chrome lub Edge kliknij ikonę instalacji w pasku adresu." });
  return el("div", { class:"card install" + (compact ? " compact" : "") },
    el("div", { class:"row between", style:"flex-wrap:nowrap;align-items:flex-start" },
      el("div", { class:"row", style:"flex-wrap:nowrap;gap:10px" }, el("img", { src:"assets/icons/icon-192.png", alt:"", width:"40", height:"40", style:"border-radius:10px;flex:none" }),
        el("div", { class:"stack", style:"gap:2px" }, el("b", { text:title }), el("span", { class:"small muted", text:"Ikona na pulpicie, pełny ekran, szybkie wejście na treningu." }))),
      onClose ? el("button", { class:"ghost", "aria-label":"Zamknij", onclick: onClose, text:"✕" }) : null),
    pf === "android" ? el("a", { class:"btn" + (pr ? "" : " primary"), href:HZ.APK_URL, rel:"noopener", text:"⬇️ Pobierz plik APK (Android)" }) : null,
    pf === "android" ? el("span", { class:"small muted", text:"Po pobraniu otwórz plik i zezwól na instalację z tej przeglądarki. Możesz też dodać stronę do ekranu głównego:" }) : null,
    pr ? el("button", { class:"primary", async onclick(){ pr.prompt(); try { const r = await pr.userChoice; if (r && r.outcome === "accepted") HZ.toast("Instaluję aplikację…"); } catch(e){} HZ.install.prompt = null; if (rerender) rerender(); }, text:"📲 Pobierz aplikację" })
      : steps,
    pf === "ios" ? el("span", { class:"small muted", text:"Na iPhonie działa w Safari (oraz w Chrome od iOS 16.4)." }) : null);
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

/* re-render keeping scroll and the field the user just tapped */
HZ.swap = (app, nodes) => {
  const y = window.scrollY, a = document.activeElement, id = a && a.id, sel = a && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd] : null;
  app.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); window.scrollTo(0, y);
  if (id){ const n = document.getElementById(id); if (n && n !== a){ n.focus({ preventScroll:true }); if (sel && typeof n.setSelectionRange === "function") try { n.setSelectionRange(sel[0], sel[1]); } catch(e){} } }
};
/* appearance card: theme + accent */
HZ.themeCard = rerender => {
  const t = HZ.getTheme();
  return el("div", { class:"card" }, el("h3", { text:"Wygląd" }),
    el("div", { class:"stack", style:"gap:6px" }, el("span", { class:"eyebrow", text:"Motyw" }),
      el("div", { class:"modes", role:"group", "aria-label":"Motyw" },
        [["auto","Jak w telefonie"],["light","Jasny"],["dark","Ciemny"]].map(([k, label]) => el("button", { type:"button", "aria-pressed":String(t.mode === k), onclick(){ HZ.setTheme({ mode:k }); rerender(); }, text:label })))),
    el("div", { class:"stack", style:"gap:6px" }, el("span", { class:"eyebrow", text:"Kolor akcentu" }),
      el("div", { class:"swatches", role:"group", "aria-label":"Kolor akcentu" },
        Object.entries(HZ.ACCENTS).map(([k, a]) => el("button", { type:"button", title:a.name, "aria-label":a.name, "aria-pressed":String(t.accent === k),
          style:`background:${a.light[0]}`, onclick(){ HZ.setTheme({ accent:k }); rerender(); } }))),
      el("span", { class:"small muted", text:`Wybrany: ${HZ.ACCENTS[t.accent].name}. Ustawienie zapisuje się na tym urządzeniu.` })));
};
HZ.brand = (sub) => el("div", { class:"brand" }, el("img", { class:"mark logo", src:"assets/icons/icon-192.png", alt:"", width:"44", height:"44" }),
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
HZ.bandName = id => { if (id === HZ.SCAP) return "aktywacja łopatek"; if (id === "none") return "bez gumy"; const b = S.config.bands.find(b => b.id === id); return b ? b.name : "?"; };
HZ.sortedWorkouts = () => [...S.workouts].sort((a,b) => (a.date||"").localeCompare(b.date||""));
/* optional groups of trainings (e.g. Friday group, Tuesday gym) – numbering runs inside a group */
HZ.groupsOn = () => !!(S.config && S.config.features && S.config.features.groups) && (S.config.groups || []).length > 0;
HZ.groupName = gid => ((S.config.groups || []).find(g => g.id === gid) || {}).name || "";
HZ.workoutNo = id => { const w = S.workouts.find(x => x.id === id); if (!w) return 0;
  const same = HZ.groupsOn() ? HZ.sortedWorkouts().filter(x => (x.group || "") === (w.group || "")) : HZ.sortedWorkouts(); return same.findIndex(x => x.id === id) + 1; };
HZ.workoutLabel = w => (HZ.groupsOn() && HZ.groupName(w.group) ? HZ.groupName(w.group) + " · " : "") + `#${HZ.workoutNo(w.id)} · ${HZ.fmtDate(w.date)}${w.title ? " · " + w.title : ""}`;
HZ.defaultWorkoutId = () => {
  const ws = HZ.sortedWorkouts(); if (!ws.length) return null;
  const t = HZ.todayISO(); const past = ws.filter(w => w.date <= t);
  const soon = ws.find(w => w.date > t && (new Date(w.date) - new Date(t)) <= 2*864e5);
  return (soon || past[past.length-1] || ws[0]).id;
};
HZ.fmtLoad = (type, load) => { if (type === "band") return load ? HZ.bandName(load) : "–"; if (type === "kg") return load == null ? "–" : load === 0 ? "bez ciężaru" : HZ.fmtKg(load) + " kg"; return load ? "+" + HZ.fmtKg(load) + " kg" : "masa ciała"; };

/* ---------- data ---------- */
HZ.loadConfig = async () => {
  const s = await db.doc("config/library").get(); const d = s.exists ? s.data() : {};
  S.config = { exercises:(d.exercises || []).map(e => ({ ...e, type: e.type === "band" ? "band" : "kg", inc:Number(e.inc) || 0 })), bands:d.bands || [], ownEnabled:d.ownEnabled === true, rankingEnabled:d.rankingEnabled !== false,
    features:{ rir:"off", acc:"all", pain:"off", approve:false, approveSince:null, requireStart:false, holo:true, groups:false, custom:false, ...(d.features || {}) }, groups:d.groups || [], guestLimit: Number(d.guestLimit) > 0 ? Number(d.guestLimit) : 0 };
};
/* client features: "off" | "adv" (only clients marked as advanced) | "all"; the trainer's client view shows exactly what clients see */
HZ.feat = (name, profile) => { const v = ((S.config && S.config.features) || {})[name];
  return v === "all" || v === true || (v === "adv" && !!(profile && profile.advanced)); };
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
HZ.WARM_REPS = (i, n, type, ex) => i === 0 ? ((ex && ex.warmReps) || (type === "band" ? "6–8" : "5–6")) : (n >= 3 && i === n - 1 ? "1–2" : "3–4");
HZ.SCAP = "scap";   // band mode, 1st warm-up: scapular activation on the bar, no band
HZ.warmPct = (i, n) => n === 1 ? 0.5 : i === 0 ? 0.45 : n === 2 ? 0.6 : n === 3 ? [0.45, 0.6, 0.8][i] : 0.5 + 0.3 * (i - 1) / (n - 2);
HZ.warmupLoads = (ex, n, next) => {
  if (!n) return [];
  if (ex.type === "band"){
    const bands = S.config.bands; if (!bands.length) return Array(n).fill("");
    let w = next === "none" ? bands.length : HZ.bandIdx(next); if (w < 0) w = bands.length;
    const top = Math.max(0, w - 1);
    const ramp = (m, from = 0) => { const hi = Math.max(from, top);
      return Array.from({ length:m }, (_, i) => bands[Math.min(bands.length - 1, m === 1 ? hi : Math.round(from + (hi - from) * i / (m - 1)))].id); };
    // W1 set by the trainer per exercise: "scap" (no band, e.g. scapular activation), a specific band, or "auto" (ramp from the strongest)
    const w1 = ex.warmBand === "auto" ? null : (ex.warmBand && bands.some(b => b.id === ex.warmBand) ? ex.warmBand : HZ.SCAP);
    if (w1 === null) return ramp(n);
    if (w1 === HZ.SCAP) return [w1, ...ramp(n - 1)];
    const k = HZ.bandIdx(w1); return [w1, ...ramp(n - 1, Math.min(k + 1, Math.max(k, top)))];
  }
  if (ex.type !== "kg") return Array(n).fill(null);
  /* W1 without load: the trainer's text shows in the weight column */
  if (ex.warmKgScap || (ex.warmLabel && !(Number(ex.warmStart) > 0))){ const rest = HZ.warmupLoads({ ...ex, warmKgScap:false, warmStart:null, warmLabel:"" }, n, next); rest[0] = HZ.SCAP; return rest; }
  const step = HZ.incRange(ex)[0], start = Number(ex.warmStart) > 0 ? Number(ex.warmStart) : null;
  const ws = next != null && next >= 40 ? Math.max(step, 2.5) : step;   // heavier lifts: whole plate pairs
  const r = v => Math.max(0, Math.round(v / ws) * ws);
  /* warm-up on bands before a weighted bodyweight exercise (e.g. pull-ups): strong band → lighter band → body weight → ~50% */
  if (ex.warmBandKg && S.config.bands.length){
    const bands = S.config.bands, tail = [];
    if (next != null && next > 0){ if (n >= 3) tail.unshift(r(next * 0.5)); if (n >= 2) tail.unshift(0); }
    const m = n - tail.length;
    const ramp = Array.from({ length:m }, (_, i) => bands[Math.min(bands.length - 1, m === 1 ? 0 : Math.round(i * (bands.length - 1) / m))].id);
    return [...ramp, ...tail];
  }
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
  if (!h.length) return { kind:"first", title:"Pierwszy raz w tym trybie", text: targetRir != null ? `Dobierz obciążenie tak, żeby na końcu serii zostało ${targetRir} powt. zapasu (RIR ${targetRir}).` : (HZ.rirOn === false ? "Dobierz obciążenie, z którym zrobisz wszystkie serie i zostaną ci jeszcze 2–3 powtórzenia w zapasie." : "Dobierz obciążenie, przy którym na końcu serii zostają ci 2–3 powtórzenia zapasu (RIR 2–3)."), next:null };
  const { log, entry } = h[0]; const load = HZ.workLoad(entry); const { hit, minRir } = HZ.judge(entry);
  if (log.pain) return { kind:"down", title:"Ostatnio coś bolało", text:`Po treningu ${fmtDate(log.date)} zgłoszono: „${log.pain}”. Zmniejsz ciężar albo zapytaj trenera, zanim dołożysz.`, next:load, base: type === "kg" ? (load || 0) : null };
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
    const reps = String(Math.max(1, T - 2));   // double progression: after the jump go 2 reps down, then +1 rep each session up to the target
    const why = minRir == null ? "nie wpisano RIR" : small ? `RIR ${minRir}, mały zapas` : `RIR ${minRir}, jest zapas`;
    if (type === "kg"){
      const base = load || 0, rec = small ? lo : hi;
      const options = (lo === hi ? [lo] : [lo, hi]).map(a => ({ load: base + a, label:`+${fmtKg(a)} → ${fmtKg(base + a)} kg`, rec: a === rec }));
      return { kind:"up", title: lo === hi ? `Dołóż ${fmtKg(lo)} kg` : `Dołóż ${fmtKg(lo)}–${fmtKg(hi)} kg`,
        text:`${last}. Polecam +${fmtKg(rec)} kg (${minRir == null ? (HZ.rirOn === false ? "wszystkie powtórzenia zrobione" : "nie wpisano RIR") : small ? "mały zapas" : "był zapas"}). Cel ${T} powt. zrobiony, więc po dołożeniu zejdź do ${reps} powt. i co trening dokładaj po 1, aż znów dojdziesz do ${T}.` + goal + tiredNote, next: base + rec, options, reps, base };
    }
    if (type === "band"){
      const i = bandIdx(load);
      if (load === "none" || i < 0) return { kind:"up", title:"Bez gumy: dołóż powtórzenie", text:last + ". Spróbuj zrobić o 1 powtórzenie więcej w każdej serii." + tiredNote, next:"none" };
      const nx = i + 1 >= bands.length ? "none" : bands[i + 1].id;
      const options = [{ load:nx, label: nx === "none" ? "Bez gumy" : `Słabsza: ${HZ.bandFull(nx)}`, rec:true }, { load, label:`Zostań: ${HZ.bandFull(load)}`, rec:false }];
      return { kind:"up", title: nx === "none" ? "Spróbuj bez gumy" : `Zmniejsz gumę → ${HZ.bandFull(nx)}`,
        text:`${last}. Cel ${T} powt. zrobiony: na słabszej gumie zejdź do ${reps} powt. i co trening dokładaj po 1, aż znów dojdziesz do ${T}.` + goal + tiredNote, next:nx, options, reps };
    }
    if (small) return { kind:"hold", title:`Zostań przy: ${fmtLoad(type, load)}`, text:last + ". Serie wyszły, ale blisko upadku. Powtórz" + (goal || " i celuj w RIR 2."), next:load };
    const add = minRir >= 4 ? 2 : 1;
    return { kind:"up", title:`Dołóż ${add} powt. w serii`, text:last + `. Cel: ${T + add} powtórzeń.` + goal + tiredNote, next:load, reps:String(T + add) };
  }
  const prev = h[1];
  const total = e => e.sets.reduce((a, x) => a + (x.reps || 0), 0);
  // stalled twice at the same load (no more reps than last time) -> go lighter; otherwise keep climbing reps
  const missedTwice = prev && JSON.stringify(HZ.workLoad(prev.entry)) === JSON.stringify(load) && !HZ.judge(prev.entry).hit && total(entry) <= total(prev.entry);
  if (missedTwice){
    if (type === "kg"){ const nx = Math.max(0, (load||0) - hi); return { kind:"down", title:`Zmniejsz o ${fmtKg(hi)} kg → ${fmtKg(nx)} kg`, text:last + ". Dwa treningi z rzędu bez poprawy na tym ciężarze." + goal, next:nx, base:load || 0 }; }
    if (type === "band"){ const i = load === "none" ? bands.length : bandIdx(load); const nx = i > 0 ? bands[i-1].id : load;
      return { kind:"down", title: nx === load ? "Zostań przy tej gumie" : `Mocniejsza guma → ${HZ.bandFull(nx)}`, text:last + ". Dwa treningi z rzędu bez poprawy na tym ciężarze.", next:nx }; }
  }
  const T2 = entry.targetReps || 5, low = Math.min(...entry.sets.map(x => x.reps || 0));
  return { kind:"hold", title:`Zostań przy: ${fmtLoad(type, load)} i dołóż powtórzenie`, text:last + `. Cel to ${T2} powt. w każdej serii – dziś spróbuj o 1 więcej (${Math.min(T2, low + 1)}).` + goal, next:load, reps:String(Math.min(T2, low + 1)), base: type === "kg" ? (load || 0) : null };
};

/* legend: how the weight tip works */
HZ.progressLegend = (open) => el("details", { class:"card legend", open: open ? true : null }, el("summary", { text:"Jak działa podpowiedź ciężaru?" }),
  el("ol", { class:"small" },
    el("li", { text:"Robisz zalecane serie, np. 3 × 10." }),
    el("li", { text:"Gdy we wszystkich seriach dojdziesz do celu (np. 10), dokładasz ciężar i schodzisz o 2 powtórzenia (np. 8)." }),
    el("li", { text:"Co trening dokładasz po 1 powtórzeniu (8 → 9 → 10), aż znów zrobisz cel. Wtedy znowu dokładasz ciężar." }),
    el("li", { text:"Dwa razy z rzędu bez poprawy na tym samym ciężarze – zejdź z ciężaru (albo mocniejsza guma)." }),
    el("li", { text:"Guma: słabsza guma = postęp, „bez gumy” to cel." }),
    el("li", {}, "Kolor ćwiczenia: ", el("span", { class:"kdot heavy" }), " zielony = ciężkie ćwiczenie, małe skoki; ", el("span", { class:"kdot light" }), " czerwony = większe skoki."),
    el("li", { text:"★ Trener może ustawić inny plan, np. dołożyć i dalej robić 10 powtórzeń – wtedy obowiązuje jego zalecenie." })));
/* exercise colour: green = heavy (small jumps), red = bigger jumps */
HZ.kindOf = ex => ex && (ex.kind === "heavy" || ex.kind === "light") ? ex.kind : "";
HZ.kindDot = ex => HZ.kindOf(ex) ? el("span", { class:"kdot " + HZ.kindOf(ex), title: HZ.kindOf(ex) === "heavy" ? "Ciężkie ćwiczenie – małe skoki" : "Większe skoki ciężaru" }) : null;

/* ---------- UI pieces ---------- */
HZ.tabBar = (items, cur, onPick) => el("nav", { class:"tabs", "aria-label":"Sekcje" },
  items.map(([k,label]) => el("button", { type:"button", "aria-pressed":String(cur === k), onclick(){ onPick(k); }, text:label })));
HZ.fatiguePicker = (cur, onPick) => el("div", { class:"fatigue", role:"group", "aria-label":"Zmęczenie od 1 do 10" },
  Array.from({ length:10 }, (_,i) => i+1).map(n => el("button", { type:"button", "aria-pressed":String(cur === n), onclick(){ onPick(cur === n ? null : n); }, text:n })));
HZ.loadInput = (ex, val, onVal, id) => {
  if (ex.type === "band") return el("select", { id, "aria-label":"Guma", value: val || "", onchange(e){ onVal(e.target.value || null); } },
    el("option", { value:"", text:"–" }), S.config.bands.map(b => el("option", { value:b.id, text: b.name + (b.kg ? ` ~${HZ.bandKgText(b)} kg` : "") })), el("option", { value:"none", text:"bez gumy" }));
  /* kg: 0 = without weight (e.g. dips / pull-ups with body weight only) */
  if (ex.type === "kg" && val === 0) return el("button", { type:"button", id, class:"nokg", title:"Stuknij, żeby wpisać ciężar", onclick(){ onVal(null); }, text:"bez ciężaru" });
  const inp = el("input", { id, inputmode:"decimal", placeholder: ex.type === "bw" ? "+kg" : "kg", "aria-label": ex.type === "bw" ? "Dodatkowe obciążenie" : "Ciężar w kg",
    value: val == null ? "" : HZ.fmtKg(val), onchange(e){ onVal(HZ.parseNum(e.target.value)); } });
  if (ex.type !== "kg") return inp;
  return el("div", { class:"kgwrap" }, inp, el("button", { type:"button", class:"nokg-btn", "aria-label":"Bez ciężaru", title:"Bez ciężaru (0 kg)", onclick(){ onVal(0); }, text:"bez" }));
};
/* RIR as a row of tap targets 0–5 (tap again to clear) */
HZ.rirPicker = (val, onVal, id) => {
  const wrap = el("div", { class:"rirpick", role:"group", "aria-label":"Zapas powtórzeń (RIR)", id });
  wrap.append(el("span", { class:"rl", text:"RIR" }));
  [0,1,2,3,4,5].forEach(n => wrap.append(el("button", { type:"button", "aria-pressed":String(val === n), title: n === 0 ? "0 = do upadku" : `${n} powt. zapasu`,
    onclick(ev){ const on = ev.currentTarget.getAttribute("aria-pressed") === "true"; wrap.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "false"));
      if (!on) ev.currentTarget.setAttribute("aria-pressed", "true"); onVal(on ? null : n); }, text: n === 5 ? "5+" : String(n) })));
  return wrap;
};
HZ.rirSelect = (val, onVal, id) => el("select", { id, "aria-label":"Zapas powtórzeń (RIR)", value: val == null ? "" : String(val), onchange(e){ onVal(e.target.value === "" ? null : Number(e.target.value)); } },
  el("option", { value:"", text:"–" }), [0,1,2,3,4,5].map(n => el("option", { value:String(n), text: n === 5 ? "5+" : String(n) })));
HZ.setsEditor = (ex, sets, keyPrefix, onChange, opts = {}) => {
  const head = el("div", { class:"set head" }, el("span", { text:"#" }), el("span", { text: ex.type === "band" ? "Guma" : ex.type === "bw" ? "Dociąż." : "Ciężar" }), el("span", { text:"Powt." }));
  let wn = 0, rn = 0;
  const warmIdx = i => sets.slice(0, i).filter(x => x.warmup).length;
  const rows = sets.map((s, i) => {
    const isBandLoad = typeof s.load === "string" && s.load && s.load !== "none" && s.load !== HZ.SCAP;
    const sw = isBandLoad ? (S.config.bands.find(b => b.id === s.load) || {}).color : null;
    const onLoad = v => { const old = s.load; s.load = v; if (s.warmup) s.manual = true;
      for (let j = i+1; j < sets.length; j++) if (!!sets[j].warmup === !!s.warmup && (JSON.stringify(sets[j].load) === JSON.stringify(old) || sets[j].load == null || sets[j].load === "")) sets[j].load = v;
      setTimeout(() => onChange(true), 0); };
    /* warm-ups of a weight exercise can be done on a band (mix: band → body weight → weight) */
    const mixable = s.warmup && ex.type === "kg" && S.config.bands.length;
    const onBand = mixable && typeof s.load === "string" && s.load !== HZ.SCAP;
    const label = s.warmup ? "W" + (++wn) : String(++rn);
    return el("div", { class:"set" + (s.warmup ? " warm" : "") },
      el("span", { class:"n", title: s.warmup ? "Seria wstępna" : null, text:label }),
      el("div", { class:"row", style:"flex-wrap:nowrap;gap:4px" }, sw ? el("span", { class:"swatch", style:`background:${sw}` }) : null,
        s.warmup && s.load === HZ.SCAP ? el("span", { class:"scap", text: ex.warmLabel || "Aktywacja łopatek" })
          : mixable ? el("div", { class:"kgwrap" }, HZ.loadInput(onBand ? { ...ex, type:"band" } : ex, s.load, onLoad, `${keyPrefix}-l${i}`),
              el("button", { type:"button", class:"nokg-btn", title: onBand ? "Zmień na ciężar" : "Zmień na gumę", onclick(){ s.load = onBand ? null : S.config.bands[0].id; s.manual = true; onChange(true); }, text: onBand ? "kg" : "guma" }))
          : HZ.loadInput(ex, s.load, onLoad, `${keyPrefix}-l${i}`)),
      el("input", { id:`${keyPrefix}-r${i}`, inputmode:"numeric", placeholder: s.warmup ? HZ.WARM_REPS(warmIdx(i), sets.filter(x => x.warmup).length, ex.type, ex) : (opts.repsHint || "–"), "aria-label":"Powtórzenia", value: s.reps == null ? "" : String(s.reps),
        oninput(e){ const n = HZ.parseNum(e.target.value); s.reps = n == null ? null : Math.round(n); onChange(false); } }),
      s.warmup ? (warmIdx(i) === 0 && ex.warmLabel && s.load !== HZ.SCAP ? el("span", { class:"wnote", text:ex.warmLabel }) : null) : (opts.noRir ? null : HZ.rirPicker(s.rir, v => { s.rir = v; onChange(false); }, `${keyPrefix}-i${i}`)));
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
  const body = []; rows.forEach((r, i) => {
    if (nWarm && i === 0) body.push(el("div", { class:"setsec warm", text:"Rozgrzewka – serie wstępne (W1, W2…)" }));
    if (nWarm && i === nWarm) body.push(el("div", { class:"setsec", text:"Serie robocze – te się liczą" }));
    body.push(r); });
  return el("div", { class:"sets" + (opts.noRir ? " norir" : "") }, head, body, ctl);
};
HZ.tipBox = (sg, onPick, current) => el("div", { class:"tip " + sg.kind }, el("span", { class:"ic", "aria-hidden":"true", text:{ up:"↑", hold:"=", down:"↓", first:"•", plan:"★" }[sg.kind] }),
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
/* which ways the trainer allows for an exercise: modes "kg" (weight only), "band" (band only), anything else = both */
HZ.modesOf = ex => { const all = ex && ex.modes === "kg" ? ["kg"] : ex && ex.modes === "band" ? ["band"] : ["kg","band"];
  const ok = all.filter(m => m !== "band" || S.config.bands.length); return ok.length ? ok : ["kg"]; };
HZ.modeFor = (exBase, wanted) => { const ok = HZ.modesOf(exBase); return ok.includes(wanted) ? wanted : ok.includes(exBase.type) ? exBase.type : ok[0]; };
HZ.modeToggle = (cur, onPick, exBase) => { const ok = exBase ? HZ.modesOf(exBase) : ["kg","band"].filter(m => m !== "band" || S.config.bands.length);
  if (ok.length < 2) return null;
  return el("div", { class:"modes", role:"group", "aria-label":"Sposób wykonania" },
  ok.map(m => el("button", { type:"button", "aria-pressed":String(cur === m), onclick(){ if (cur !== m) onPick(m); }, text:HZ.MODE_LABEL[m] }))); };
/* "target weight" for the working sets: warm-ups are calculated from it (W2 ≈60%, W3 ≈80%; W1 set by the trainer) */
HZ.targetBox = (ex, sets, onSet, idp) => {
  const work = sets.find(s => !s.warmup); const cur = work && typeof work.load === "number" ? work.load : null;
  const inp = el("input", { id:idp + "-target", inputmode:"decimal", placeholder:"np. 80", value: cur != null ? HZ.fmtKg(cur) : "", style:"max-width:6.5rem;text-align:center" });
  const go = () => { const v = HZ.parseNum(inp.value); if (v == null || v < 0 || v > 500){ HZ.toast("Wpisz ciężar serii roboczych w kg, np. 80."); return; }
    const before = JSON.stringify(sets);
    for (const s of sets){ if (!s.warmup) s.load = v; else if (s.reps == null) s.manual = false; }
    HZ.refreshWarmups(ex, sets); if (JSON.stringify(sets) !== before) setTimeout(onSet, 0); };
  inp.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); go(); } });
  inp.addEventListener("change", go);
  return el("div", { class:"target" }, el("label", { class:"f", for:idp + "-target", text:"Ciężar serii roboczych (kg)" }),
    el("div", { class:"row", style:"flex-wrap:nowrap;gap:6px" }, inp, el("button", { type:"button", class: cur == null ? "primary" : "", onclick: go, text:"Oblicz serie wstępne" })),
    el("span", { class:"small muted", text: cur == null ? "Nie wiesz, ile na rozgrzewkę? Wpisz ciężar, którym robisz serie, a wyliczymy W2 ≈60% i W3 ≈80%." : "W2 ≈60%, W3 ≈80% ciężaru roboczego, zaokrąglone do talerzy." })); };
/* working sets reset to a new load (warm-ups without reps follow for kg) */
HZ.applyLoad = (ex, sets, load) => {
  for (const s of sets) if (!s.warmup) s.load = load;
  const warm = sets.filter(s => s.warmup);
  if ((ex.type === "kg" || ex.type === "band") && warm.every(s => s.reps == null)) HZ.warmupLoads(ex, warm.length, load).forEach((l, k) => { warm[k].load = l; });
};
/* untouched warm-ups (no manual load change, no reps yet) always follow the current settings */
HZ.refreshWarmups = (ex, sets) => {
  const warm = sets.filter(x => x.warmup); if (!warm.length) return;
  const work = sets.find(x => !x.warmup); const next = work ? (work.load === "" ? null : work.load) : null;
  const loads = HZ.warmupLoads(ex, warm.length, next);
  warm.forEach((x, k) => { if (!x.manual && x.reps == null) x.load = loads[k] ?? x.load; });
};
HZ.buildSets = (ex, nWarm, nWork, next) => [
  ...HZ.warmupLoads(ex, nWarm, next).map(load => ({ load, reps:null, rir:null, warmup:true })),
  ...Array.from({ length:nWork }, () => ({ load: ex.type === "band" ? (next || "") : (next ?? null), reps:null, rir:null })) ];
HZ.setText = (e, s) => s.load === HZ.SCAP ? "aktywacja×" + s.reps : (e.type === "band" || (typeof s.load === "string" && s.load !== "none") ? HZ.bandName(s.load) : e.type === "kg" ? (s.load === 0 ? "bez ciężaru" : HZ.fmtKg(s.load)) : (s.load ? "+" + HZ.fmtKg(s.load) : "MC")) + "×" + s.reps;
HZ.setsText = (e, withRir = true) => {
  const warm = HZ.warmSets(e), work = (e.sets || []).filter(s => !s.warmup);
  const w = warm.length ? "wstępne: " + warm.map(s => HZ.setText(e, s)).join(", ") + " | " : "";
  return w + work.map(s => HZ.setText(e, s) + (withRir && s.rir != null ? ` R${s.rir}` : "")).join(" · ");
};

/* ---------- progress & chart ---------- */
const progSel = {}, progMetric = {};
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
  { const lc = HZ.liftsCard(sorted); if (lc) out.push(lc); }
  const byReps = progMetric[key] === "reps" || (ex.type !== "kg" && ex.type !== "band");
  const pts = [];
  for (const l of sorted) for (const e0 of (l.entries || [])) if (keyOf(e0) === cur){
    const e = HZ.workEntry(e0); if (!e) continue;
    const load = HZ.workLoad(e); let y, lbl;
    const repsTxt = e.sets.map(s => s.reps).join("/");
    if (byReps){ y = e.sets.reduce((a,s) => a + (s.reps || 0), 0); lbl = `${y} powt. (${repsTxt})` + (ex.type === "kg" ? ` · ${fmtKg(Math.max(...e.sets.map(s => s.load || 0)))} kg` : ex.type === "band" ? ` · ${bandName(load)}` : ""); }
    else if (ex.type === "kg"){ y = Math.max(...e.sets.map(s => s.load || 0)); lbl = `${fmtKg(y)} kg · ${e.sets.map(s => s.reps).join("/")}`; }
    else if (ex.type === "band"){ const i = load === "none" ? S.config.bands.length : bandIdx(load); if (i < 0) continue; y = i; lbl = `${bandName(load)} · ${e.sets.map(s => s.reps).join("/")}`; }
    else { y = e.sets.reduce((a,s) => a + (s.reps||0), 0); lbl = `${y} powt. łącznie`; }
    pts.push({ x:l.date, y, label:`${fmtDate(l.date)}: ${lbl}`, fatigue:l.fatigue });
  }
  const sel = el("select", { id:"prog-" + key, "aria-label":"Ćwiczenie", onchange(e){ progSel[key] = e.target.value; rerender(); } }, exIds.map(id => el("option", { value:id, text:nameOf(id) })));
  sel.value = cur;
  const ticks = ex.type === "band" && !byReps ? [...S.config.bands.map((b,i) => ({ v:i, t:b.name })), { v:S.config.bands.length, t:"bez gumy" }] : null;
  const yLabel = byReps ? "Powtórzenia łącznie w seriach roboczych" : ex.type === "kg" ? "Największy ciężar w treningu (kg)" : ex.type === "band" ? "Guma (wyżej = mniejsza asysta)" : "Powtórzenia łącznie";
  const rows = [...sorted].reverse().flatMap(l => (l.entries || []).filter(e => keyOf(e) === cur).map(e => el("tr", {},
    el("td", { text: fmtDate(l.date) + (l.own ? " (własny)" : "") }),
    el("td", { text: HZ.setsText(e, false) }),
    el("td", { text: e.sets.filter(s => !s.warmup).map(s => s.rir ?? "–").join("/") }),
    el("td", { text: l.fatigue ?? "–" }))));
  out.push(el("div", { class:"card" },
    el("div", { class:"row between" }, el("h3", { text:"Wykres postępu" }), el("div", { style:"flex:1 1 180px;max-width:260px" }, sel)),
    ex.type === "kg" || ex.type === "band" ? el("div", { class:"modes", role:"group", "aria-label":"Co pokazać na wykresie" },
      [["load", ex.type === "kg" ? "Ciężar" : "Guma"], ["reps", "Powtórzenia"]].map(([m, t]) => el("button", { type:"button", "aria-pressed":String((byReps ? "reps" : "load") === m),
        onclick(){ progMetric[key] = m; rerender(); }, text:t }))) : null,
    el("span", { class:"small muted", text:yLabel }),
    compareRow(pts, byReps ? { type:"reps" } : ex),
    pts.length ? HZ.lineChart(pts, { ticks, fmt: ex.type === "kg" && !byReps ? v => fmtKg(v) : v => String(Math.round(v)) }) : el("p", { class:"muted", text:"Brak danych." }),
    el("div", { class:"tablewrap" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text:"Data" }), el("th", { text:"Serie" }), el("th", { text:"RIR" }), el("th", { text:"Zmęcz." }))),
      el("tbody", {}, rows)))));
  return out;
};
/* last vs previous vs first workout, for the selected exercise */
function compareRow(pts, ex){
  if (pts.length < 2) return pts.length ? el("p", { class:"small muted", text:"Po kolejnym treningu zobaczysz tu porównanie z poprzednim." }) : null;
  const last = pts[pts.length - 1], prev = pts[pts.length - 2], first = pts[0];
  const sign = v => (v > 0 ? "+" : v < 0 ? "−" : "±") ;
  const fmt = (a, b) => {
    const d = a.y - b.y;
    if (ex.type === "reps") return `${sign(d)}${Math.abs(d)} powt.` + (b.y > 0 && d ? ` (${sign(d)}${Math.round(Math.abs(d) / b.y * 100)}%)` : "");
    if (ex.type === "kg") return `${sign(d)}${HZ.fmtKg(Math.abs(d))} kg` + (b.y > 0 && d ? ` (${sign(d)}${Math.round(Math.abs(d) / b.y * 100)}%)` : "");
    return d === 0 ? "ta sama guma" : `${Math.abs(d)} ${d > 0 ? "słabsz" : "mocniejsz"}${Math.abs(d) === 1 ? "a guma" : "e gumy"}`;
  };
  const cls = d => d > 0 ? "up" : d < 0 ? "down" : "";
  const tile = (label, a, b) => el("div", { class:"stat cmp " + cls(a.y - b.y) }, el("span", { class:"eyebrow", text:label }), el("span", { class:"v", style:"font-size:1.3rem", text:fmt(a, b) }), el("span", { class:"small muted", text:`${HZ.fmtDate(b.x)} → ${HZ.fmtDate(a.x)}` }));
  return el("div", { class:"grid2" }, tile("Vs poprzedni trening", last, prev), tile("Od pierwszego treningu", last, first));
}
function niceStep(raw){ const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
HZ.lineChart = (pts, { ticks, fmt }) => {
  const W = 360, H = 190, L = ticks ? 74 : 40, R = 14, T = 14, B = 26;
  const ys = pts.map(p => p.y); let lo = Math.min(...ys), hi = Math.max(...ys);
  if (ticks){ lo = 0; hi = Math.max(1, ticks.length - 1); } else { const pad = (hi - lo) * 0.15 || Math.max(1, hi * 0.1); lo = Math.max(0, lo - pad); hi = hi + pad; }
  if (hi === lo) hi = lo + 1;
  const x = i => pts.length === 1 ? (L + (W - R)) / 2 : L + i * (W - L - R) / (pts.length - 1);
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const tickVals = ticks || (() => { const step = niceStep((hi - lo) / 4); const o = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) o.push({ v, t:fmt(v) }); return o; })();
  const font = { "font-size":11, fill:"var(--muted)", "font-family":"system-ui, sans-serif" };
  const svg = sv("svg", { class:"chart", viewBox:`0 0 ${W} ${H}`, role:"img", "aria-label":"Wykres postępu" },
    tickVals.map(t => sv("g", {}, sv("line", { x1:L, x2:W-R, y1:y(t.v), y2:y(t.v), stroke:"var(--line)", "stroke-width":1 }), sv("text", { x:L-6, y:y(t.v)+4, "text-anchor":"end", ...font }, t.t))),
    pts.length > 1 ? sv("path", { d:`M${x(0)},${H-B} ` + pts.map((p,i) => `L${x(i)},${y(p.y)}`).join(" ") + ` L${x(pts.length-1)},${H-B} Z`, fill:"var(--accent)", "fill-opacity":0.1, stroke:"none" }) : null,
    pts.length > 1 ? sv("path", { d:pts.map((p,i) => `${i ? "L" : "M"}${x(i)},${y(p.y)}`).join(" "), fill:"none", stroke:"var(--accent)", "stroke-width":2, "stroke-linejoin":"round" }) : null,
    !ticks && pts.length <= 10 ? pts.map((p,i) => sv("text", { x:x(i), y:y(p.y) - 9, "text-anchor": i === 0 && pts.length > 1 ? "start" : i === pts.length - 1 && pts.length > 1 ? "end" : "middle", "font-size":11, "font-weight":600, fill:"var(--ink)", "font-family":"system-ui, sans-serif" }, fmt(p.y))) : null,
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
/* Postęp points (balanced, so steady work counts even without a record every week):
   weight record 5 (only credible or trainer-approved), rep record at the best weight 2, training with the plan done 3, + progress % (max 30) */
HZ.PTS = { pr:5, repPr:2, plan:3, progressCap:30 };
/* a weight record is credible when the jump over the previous best is small; bigger jumps wait for the trainer */
HZ.recordLimit = (ex, prev) => Math.max(2 * HZ.incRange(ex || {})[1], prev * 0.1);
HZ.apprOpts = () => { const f = (S.config && S.config.features) || {}; return { approveSince: f.approve ? (f.approveSince || "0000") : null }; };
HZ.computeStats = (logs, appr = {}, opts = {}) => {
  const from = opts.from || null, inRange = d => !from || (d || "") >= from;
  const sorted = [...logs].sort((a,b) => (a.date||"").localeCompare(b.date||"") || (a.saved_at||"").localeCompare(b.saved_at||""));
  const attendedAll = new Set(logs.filter(l => l.workout_id && !l.own).map(l => l.workout_id));
  const attended = new Set(logs.filter(l => l.workout_id && !l.own && inRange(l.date)).map(l => l.workout_id));
  const today = HZ.todayISO(); const pastAll = HZ.sortedWorkouts().filter(w => w.date <= today); const past = pastAll.filter(w => inRange(w.date));
  // general points: attendance + streak bonus (inside the period)
  let bonus = 0, prevAttended = false, firstIdx = -1;
  past.forEach((w, i) => { const here = attended.has(w.id); if (here){ if (firstIdx < 0) firstIdx = i; if (prevAttended) bonus += HZ.POINTS.streak; }
    prevAttended = here || (w.date === today && prevAttended); });
  let run = 0, longest = 0;
  pastAll.forEach(w => { if (attendedAll.has(w.id)){ run++; longest = Math.max(longest, run); } else if (w.date !== today) run = 0; });
  let streak = 0;
  for (let i = pastAll.length - 1; i >= 0; i--){ if (attendedAll.has(pastAll[i].id)) streak++; else if (pastAll[i].date === today) continue; else break; }
  const pastAttended = past.filter(w => attended.has(w.id)).length;
  const possible = firstIdx < 0 ? 0 : past.length - firstIdx - (past.length && past[past.length-1].date === today && !attended.has(past[past.length-1].id) ? 1 : 0);
  const attendancePct = possible > 0 ? Math.round(pastAttended / possible * 100) : null;
  // records (working sets only); a weight record counts when credible or approved
  const best = {}, bestReps = {}, first = {}, records = {}, bests = {}, pending = [];
  let prs = 0, repPrs = 0, volume = 0, strength = 0;
  const since = opts.approveSince !== undefined ? opts.approveSince : HZ.apprOpts().approveSince;
  for (const l of sorted){
    const here = inRange(l.date); let hits = 0, planned = 0;
    for (const e0 of (l.entries || [])){
      const e = HZ.workEntry(e0); if (!e) continue;
      const done = e.sets.filter(x => (x.reps || 0) > 0); if (!done.length) continue;
      planned++; if (HZ.judge(e).hit) hits++;
      const t = e.type || "kg", k = e.exId + "|" + t; let v, reps, label;
      if (t === "kg"){ v = Math.max(...done.map(x => Number(x.load) || 0)); reps = Math.max(...done.filter(x => (Number(x.load) || 0) === v).map(x => x.reps || 0));
        label = (v === 0 ? "bez ciężaru" : `${HZ.fmtKg(v)} kg`) + ` × ${reps}`; if (here) volume += done.reduce((a,x) => a + (Number(x.load) || 0) * (x.reps || 0), 0); }
      else if (t === "band"){ const ld = HZ.workLoad(e); v = ld === "none" ? S.config.bands.length : HZ.bandIdx(ld); if (v < 0) continue; reps = Math.max(...done.map(x => x.reps || 0)); label = (ld === "none" ? "bez gumy" : HZ.bandFull(ld)) + ` × ${reps}`; }
      else { v = done.reduce((a,x) => a + (x.reps || 0), 0); reps = 0; label = `${v} powt. łącznie`; }
      const rec = { exId:e.exId, type:t, name:e.exName, label, date:l.date };
      if (!(k in best)){ best[k] = v; bestReps[k] = reps; first[k] = v; records[k] = rec; }
      else if (v > best[k]){
        const a = ((appr[l.id] || {}).items || {})[e.stationId];
        const needs = t === "kg" && a !== "ok" && (a === "no" || (since && (l.date || "") >= since) || v - best[k] > HZ.recordLimit(HZ.exById(e.exId), best[k]));
        if (needs){ if (a !== "no") pending.push({ logId:l.id, stationId:e.stationId, exId:e.exId, name:e.exName, date:l.date, from:best[k], to:v, reps,
            reason: v - best[k] > HZ.recordLimit(HZ.exById(e.exId), best[k]) ? "duży skok" : "do zatwierdzenia" }); continue; }
        prs++; best[k] = v; bestReps[k] = reps; records[k] = rec; if (here) strength += HZ.PTS.pr;
      }
      else if (v === best[k] && reps > bestReps[k] && t !== "bw"){ bestReps[k] = reps; repPrs++; records[k] = rec; if (here) strength += HZ.PTS.repPr; }
      // body-weight exercises (pull-ups, dips) count from 0 kg = body weight only
      if (t === "kg" && (best[k] > 0 || (best[k] === 0 && HZ.isBwExercise(HZ.exById(e.exId))))) bests[e.exId] = Math.max(bests[e.exId] || 0, best[k]);
    }
    if (here && !l.own && planned && hits / planned >= 0.8) strength += HZ.PTS.plan;
  }
  // band-assisted body-weight exercises: lightest band reached = least help in kg (for % of body weight)
  const assist = {};
  for (const k of Object.keys(best).filter(x => x.endsWith("|band"))){ const id = k.split("|")[0]; if (!HZ.isBwExercise(HZ.exById(id))) continue;
    const bs = S.config.bands, i = best[k]; assist[id] = i >= bs.length ? 0 : Math.round(HZ.bandKgMid(bs[i]) * 10) / 10; }
  const pct = Object.keys(first).filter(k => k.endsWith("|kg") && first[k] > 0 && best[k] !== first[k]).map(k => (best[k] - first[k]) / first[k] * 100);
  const nKg = Object.keys(first).filter(k => k.endsWith("|kg") && first[k] > 0).length;
  const progress = nKg && pct.length ? Math.round(pct.reduce((a,b) => a + b, 0) / nKg) : (nKg ? 0 : null);
  if (!from) strength += Math.max(0, Math.min(HZ.PTS.progressCap, progress || 0));
  return {
    workouts:attended.size, streak, longest, prs, repPrs, progress, volume: Math.round(volume),
    points: attended.size * HZ.POINTS.workout + bonus, strength,
    attendancePct, records: Object.values(records), bests, assist, pending
  };
};
/* entries the trainer rejected don't drive the next suggestion */
HZ.dropRejected = (logs, appr = {}) => logs.map(l => { const it = (appr[l.id] || {}).items; if (!it) return l;
  const entries = (l.entries || []).filter(e => it[e.stationId] !== "no"); return entries.length === (l.entries || []).length ? l : { ...l, entries }; });
/* active trainer plan for an exercise (set after the client's last session with it) -> shown instead of the system tip */
HZ.trainerTip = (plan, logs, exId, mode) => {
  const it = plan && plan[exId]; if (!it || it.load == null || (it.type || "kg") !== mode) return null;
  const last = logs.filter(l => (l.entries || []).some(e => e.exId === exId)).map(l => l.saved_at || l.date || "").sort().pop() || "";
  if (last > (it.at || "")) return null;
  const what = HZ.fmtLoad(mode, it.load) + (it.reps ? ` × ${it.reps}` : "");
  return { kind:"plan", title:`Trener zaleca: ${what}`, text: it.src === "system" ? "Trener zatwierdził podpowiedź na ten trening." : "Ciężar i powtórzenia ustalone przez trenera na ten trening.",
    next:it.load, reps:it.reps || null, base:null };
};
/* individual progression set by the trainer (feature "custom"): faster = bigger jumps, slower = smallest jump only */
HZ.progEx = (ex, prog) => { if (!ex || !prog || prog === "std") return ex; const [lo, hi] = HZ.incRange(ex);
  return prog === "fast" ? { ...ex, incMin:hi, incMax:hi * 2 } : { ...ex, incMin:lo, incMax:lo }; };
HZ.monthKey = () => HZ.todayISO().slice(0, 7);
HZ.monthName = k => { const [y, m] = (k || HZ.monthKey()).split("-"); return ["styczeń","luty","marzec","kwiecień","maj","czerwiec","lipiec","sierpień","wrzesień","październik","listopad","grudzień"][Number(m) - 1] + " " + y; };
/* full ranking row: all-time + this month */
HZ.rankFull = (logs, appr, bw, birthYear, sex) => {
  const all = HZ.computeStats(logs, appr), k = HZ.monthKey(), m = HZ.computeStats(logs, appr, { from:k + "-01" });
  const row = HZ.rankRow(all, bw), af = HZ.ageFactor(HZ.ageOf(birthYear)), coef = HZ.glCoef(bw, sex);
  // points with multiplier: lifted load (body weight included for pull-ups/dips) × GL(sex, body weight) × age; body weight itself is never stored here
  let sc;
  if (coef){ sc = {}; const mainIds = new Set(S.workouts.flatMap(w => (w.stations || []).filter(st => HZ.secOf(st) === "main").map(st => st.exId))); let sum = 0, n = 0;
    for (const [id, pct] of Object.entries(row.rel || {})){ const eff = pct * bw / 100; sc[id] = Math.round(eff * coef * af * 10); if (mainIds.has(id)){ sum += eff; n++; } }
    if (n) sc.main = Math.round(sum * coef * af * 10); }
  return { ...row, af, ...(sc ? { sc } : {}), m:{ k, points:m.points, strength:m.strength, workouts:m.workouts, prs:m.prs } };
};
/* relative strength: best working weight as % of body weight; bodyweight exercises (pull-ups, dips) count body + added load */
HZ.isBwExercise = ex => ex ? (ex.bwBased ?? ex.type === "band") : false;
/* age multiplier (simplified, like masters weightlifting): up to 35 → ×1.00, 36–50 → +1%/year, over 50 → +1.5%/year (max ×1.70) */
HZ.ageOf = by => by ? new Date().getFullYear() - by : null;
HZ.ageFactor = age => { if (!(age > 35)) return 1; const f = age <= 50 ? 1 + (age - 35) * 0.01 : 1.15 + (age - 50) * 0.015; return Math.round(Math.min(1.7, f) * 1000) / 1000; };
/* sex + body weight: IPF GL coefficient (powerlifting "Goodlift" points, classic) – lets women and men of any weight compete in one table */
HZ.GL = { M:[1199.72839, 1025.18162, 0.00921], K:[610.32796, 1045.59282, 0.03048] };
HZ.glCoef = (bw, sex) => { const c = HZ.GL[sex]; if (!c || !(bw > 0)) return null; return 100 / (c[0] - c[1] * Math.exp(-c[2] * bw)); };
HZ.relStrength = (bests, bw, assist = {}) => { const out = {}; if (!(bw > 0)) return out;
  for (const [id, kg] of Object.entries(bests || {})){ const ex = HZ.exById(id); out[id] = Math.round((HZ.isBwExercise(ex) ? bw + kg : kg) / bw * 100); }
  // pull-ups / dips with a band: body weight minus the band's help (only if never done without/with added weight)
  for (const [id, a] of Object.entries(assist || {})) if (out[id] == null) out[id] = Math.max(1, Math.round((bw - a) / bw * 100));
  return out; };
/* what goes to the shared ranking: body weight itself never leaves the profile, only the percentages */
HZ.rankRow = (st, bw) => { const { records, attendancePct, bests, assist, pending, repPrs, ...row } = st; return { ...row, bests: bests || {}, rel: HZ.relStrength(bests, bw, assist) }; };

const fmtVol = v => v >= 1000 ? (v / 1000).toLocaleString("pl-PL", { maximumFractionDigits:1 }) + " t" : v + " kg";
const RANK_COLS = [
  ["points", "Punkty", r => r.points ?? 0],
  ["strength", "Pkt siłowe", r => r.strength ?? 0],
  ["workouts", "Treningi", r => r.workouts ?? 0],
  ["streak", "Seria", r => r.streak ?? 0],
  ["prs", "Rekordy", r => r.prs ?? 0],
  ["progress", "Progres", r => r.progress == null ? "–" : (r.progress > 0 ? "+" : "") + r.progress + "%"],
  ["volume", "Tonaż", r => fmtVol(r.volume || 0)]
];
const BOARDS = [
  { key:"points", label:"Regularność", desc:`Za regularność, nie za ciężar: ${HZ.POINTS.workout} pkt za każdy trening z grupą i +${HZ.POINTS.streak} pkt za każdy kolejny piątek z rzędu.` },
  { key:"rel", label:"Siła", desc:"Punkty siły = podniesiony ciężar × współczynnik masy ciała i płci (IPF GL, jak w trójboju) × mnożnik wieku. Przy podciąganiu i dipach liczy się masa ciała + dociążenie (na gumie: minus pomoc gumy). Dzięki temu lżejsi, cięższi, kobiety, mężczyźni i starsi rywalizują na równych zasadach. „Razem” to suma z bojów głównych, więc wygrywa najbardziej wszechstronny. Wagę, wiek i płeć widzi tylko zawodnik i trener." },
  { key:"strength", label:"Postęp", desc:`Każdy porównywany sam ze sobą: ${HZ.PTS.plan} pkt za trening z wykonanym planem, ${HZ.PTS.repPr} pkt za rekord powtórzeń, ${HZ.PTS.pr} pkt za rekord ciężaru (tylko wiarygodny skok albo zatwierdzony przez trenera) + progres w % (maks. ${HZ.PTS.progressCap}).` }
];
let rankSort = "points", relEx = null, rankPeriod = "month";
const MONTH_KEYS = ["points", "strength", "workouts", "prs"];
/* motivating line for the participant (monthly general board) */
HZ.myRankMessage = (rows, meId) => {
  const k = HZ.monthKey(), pts = r => r.m && r.m.k === k ? (r.m.points || 0) : 0;
  const vis = rows.filter(r => !r.hidden); const me = vis.find(r => r.id === meId); if (!me) return null;
  const my = pts(me), mon = HZ.monthName(k).split(" ")[0];
  if (!my) return { kind:"start", text:`Nowy miesiąc, nowa tabela! Pierwszy trening w ${mon === "luty" ? "lutym" : "tym miesiącu"} to od razu ${HZ.POINTS.workout} pkt.` };
  const higher = [...new Set(vis.map(pts).filter(v => v > my))].sort((a,b) => a - b);
  const place = 1 + vis.filter(r => pts(r) > my).length, tied = vis.filter(r => r.id !== meId && pts(r) === my).length;
  if (place === 1) return { kind:"p1", text: tied ? `🏆 Dzielisz 1. miejsce w tym miesiącu! Jeden trening więcej i jesteś sam/-a na szczycie.` : `🏆 Jesteś nr 1 w tym miesiącu! Tak trzymaj – reszta goni.` };
  const gap = higher[0] - my;
  if (place <= 3) return { kind:"p" + place, text:`${place === 2 ? "🥈" : "🥉"} Jesteś na podium – ${place}. miejsce! Do miejsca wyżej brakuje Ci ${gap} pkt${gap <= HZ.POINTS.workout ? " – to jeden trening" : ""}.` };
  const podium = [...new Set(vis.map(pts))].sort((a,b) => b - a)[2]; const toPod = podium != null ? podium - my : gap;
  return { kind:"go", text:`💪 ${place}. miejsce w tym miesiącu. Do podium brakuje Ci ${toPod} pkt – każdy trening to ${HZ.POINTS.workout} pkt, a seria z rzędu daje bonus.` };
};
HZ.personalMessage = logs => {
  const st = HZ.computeStats(logs); if (!logs.length) return null;
  if (st.streak >= 3) return { kind:"go", text:`🔥 ${st.streak} treningi z rzędu – tak trzymaj!` };
  if (st.prs + st.repPrs > 0 && st.progress > 0) return { kind:"go", text:`💪 Od startu średnio +${st.progress}% w Twoich ćwiczeniach. Dobra robota!` };
  return { kind:"go", text: logs.length === 1 ? "👏 Dobry start! Każdy kolejny trening widać w Postępach." : `👏 Masz już ${logs.length} treningów. Regularność robi robotę!` };
};
HZ.motivationBox = msg => msg ? el("div", { class:"motiv " + msg.kind }, el("span", { text:msg.text })) : null;
/* gold / silver / bronze sticker; holographic shine is pure CSS (.holo) and can be switched off by the trainer */
HZ.medal = (place, small) => el("span", { class:`medal m${place}${small ? " sm" : ""}`, title:["","Złoto","Srebro","Brąz"][place], text:String(place) });
HZ.applyHolo = () => document.documentElement.classList.toggle("no-holo", !(S.config && S.config.features && S.config.features.holo !== false));
HZ.rankingView = (rows, meId, rerender, opts = {}) => {
  const vis = rows.filter(r => !r.hidden || opts.showHidden);
  if (!vis.length) return [el("div", { class:"empty" }, el("h3", { text:"Ranking jest jeszcze pusty" }), el("p", { class:"small", text:"Pojawi się, gdy uczestnicy zapiszą pierwsze treningi." }))];
  // exercises available for relative strength
  const relIds = [...new Set(vis.flatMap(r => [...Object.keys(r.rel || {}), ...Object.keys(r.bests || {})]))].filter(id => HZ.exById(id))
    .sort((a,b) => vis.filter(r => r.rel && r.rel[b] != null).length - vis.filter(r => r.rel && r.rel[a] != null).length);
  // main lifts = exercises the trainer puts in the "Trening główny" section
  const mainIds = new Set(S.workouts.flatMap(w => (w.stations || []).filter(st => HZ.secOf(st) === "main").map(st => st.exId)));
  const relAvg = r => { const v = Object.entries(r.rel || {}).filter(([id]) => mainIds.has(id)).map(([, p]) => p); return v.length ? Math.round(v.reduce((a,b) => a + b, 0) / v.length) : null; };
  if (relEx !== "main" && !relIds.includes(relEx) && !mainIds.has(relEx)) relEx = mainIds.size ? "main" : (relIds[0] || null);
  const relOf = r => relEx === "main" ? relAvg(r) : (r.rel && r.rel[relEx] != null ? r.rel[relEx] : null);
  const kgOf = r => { const b = r.bests || {};
    if (relEx === "main"){ const v = [...mainIds].map(id => b[id]).filter(x => x > 0); return v.length ? Math.round(v.reduce((a,c) => a + c, 0) * 100) / 100 : null; }
    return b[relEx] > 0 ? b[relEx] : null; };
  // pull-ups / dips: shown as body weight + extra (127% → "MC +27%"), sorting stays on the full %
  const bwEx = relEx !== "main" && HZ.isBwExercise(HZ.exById(relEx));
  const relTxt = v => v == null ? "–" : bwEx ? (v >= 100 ? `MC +${v - 100}%` : `MC −${100 - v}%`) : v + "%";
  const relCol = ["rel", bwEx ? "MC + dociąż." : "% MC", r => relTxt(relOf(r))];
  const kgCol = ["kg", relEx === "main" ? "Suma kg" : "Ciężar", r => kgOf(r) != null ? HZ.fmtKg(kgOf(r)) + " kg" : "–"];
  const strengthView = rankSort === "rel" || rankSort === "kg" || rankSort === "adj";
  const adjOf = r => r.sc ? (relEx === "main" ? r.sc.main : r.sc[relEx]) ?? null : null;
  const adjCol = ["adj", "Punkty siły", r => adjOf(r) != null ? HZ.fmtKg(adjOf(r)) + " pkt" : "–"];
  const monthMode = rankPeriod === "month" && !strengthView, mk = HZ.monthKey();
  const field = (r, k) => monthMode && MONTH_KEYS.includes(k) ? (r.m && r.m.k === mk ? (r.m[k] || 0) : 0) : r[k];
  const baseCols = monthMode ? RANK_COLS.filter(c => MONTH_KEYS.includes(c[0])).map(([k, l]) => [k, l, r => field(r, k) ?? 0]) : RANK_COLS;
  const cols = strengthView ? [adjCol, relCol, kgCol] : baseCols;
  const val = r => rankSort === "rel" ? (relOf(r) ?? -Infinity) : rankSort === "adj" ? (adjOf(r) ?? -Infinity) : rankSort === "kg" ? (kgOf(r) ?? -Infinity) : (field(r, rankSort) == null ? -Infinity : field(r, rankSort));
  const sorted = [...vis].sort((a,b) => val(b) - val(a) || ((field(b, "points")||0) - (field(a, "points")||0)) || (a.name || "").localeCompare(b.name || "", "pl"));
  let place = 0, prev;
  const placed = sorted.map((r, i) => { if (val(r) !== prev){ place = i + 1; prev = val(r); } return { r, place: val(r) === -Infinity ? "–" : place }; });
  if (!cols.some(c => c[0] === rankSort)) rankSort = "points";
  const col = cols.find(c => c[0] === rankSort) || cols[0];
  const board = BOARDS.find(b => b.key === (rankSort === "kg" || rankSort === "adj" ? "rel" : rankSort));
  const podiumRows = placed.filter(x => x.place !== "–").slice(0, 3);
  const podium = podiumRows.length ? el("div", { class:"podium" }, podiumRows.map(({ r, place }) => el("div", { class:"pod p" + place + (r.id === meId ? " me" : "") },
    HZ.medal(place), el("b", { text:r.name || "Uczestnik" }), el("span", { class:"pv" }, el("span", { text: col[2](r) + (board && board.key !== "rel" ? " pkt" : "") }),
      el("span", { class:"pv2", text: rankSort === "kg" && relOf(r) != null ? relTxt(relOf(r)) : rankSort === "rel" && kgOf(r) != null ? HZ.fmtKg(kgOf(r)) + " kg" : rankSort === "adj" && relOf(r) != null ? relTxt(relOf(r)) : "\u00a0" })))))
    : el("p", { class:"small muted", text: rankSort === "rel" ? "Nikt jeszcze nie ma wyniku w tym ćwiczeniu z wpisaną masą ciała." : "Brak wyników." });
  const me = placed.find(x => x.r.id === meId);
  // one strength ranking with tabs: Razem + each main lift (e.g. Przysiad, Podciąganie, Dip)
  const tabIds = mainIds.size ? [...mainIds].filter(id => HZ.exById(id)) : relIds;
  const exSel = strengthView && (tabIds.length || mainIds.size) ? el("div", { class:"modes ex-tabs", role:"group", "aria-label":"Ćwiczenie" },
    [...(mainIds.size ? [["main", "Razem"]] : []), ...tabIds.map(id => [id, HZ.exById(id).name])].map(([id, t]) => el("button", { type:"button", "data-ex":id, "aria-pressed":String(relEx === id),
      onclick(){ relEx = id; rerender(); }, text:t }))) : null;
  return [opts.message ? HZ.motivationBox(opts.message) : null, el("div", { class:"card" },
      strengthView ? null : el("div", { class:"modes", role:"group", "aria-label":"Okres" },
        [["month", "📅 Miesięczny"], ["all", "♾️ Ogólny"]].map(([k, t]) => el("button", { type:"button", "aria-pressed":String(rankPeriod === k), onclick(){ rankPeriod = k; rerender(); }, text:t }))),
      el("div", { class:"modes big", role:"group", "aria-label":"Rodzaj rankingu" },
        BOARDS.map(b => el("button", { type:"button", "aria-pressed":String(rankSort === b.key || (b.key === "rel" && (rankSort === "kg" || rankSort === "adj"))), onclick(){ rankSort = b.key === "rel" ? "adj" : b.key; rerender(); }, text:b.label }))),
      el("p", { class:"small muted", text: board ? board.desc + (rankSort === "kg" ? " Teraz posortowane po samym ciężarze." : "") : `Posortowano według: ${col[1]}. Kliknij nagłówek tabeli, aby zmienić.` }),
      opts.relPrompt && strengthView ? opts.relPrompt : null,
      strengthView && relEx === "main" ? el("p", { class:"small muted", text:"Razem = suma punktów z: " + [...mainIds].map(id => (HZ.exById(id) || {}).name).filter(Boolean).join(" + ") + ". Kto nie robił któregoś boju, dostaje za niego 0." }) : null,
      exSel, podium,
      me && me.place !== "–" ? el("p", { class:"small", text:`Twoje miejsce: ${me.place} z ${placed.filter(x => x.place !== "–").length}` }) : null),
    el("div", { class:"card" }, el("h3", { text: strengthView ? "Tabela" : monthMode ? `Tabela – ${HZ.monthName(mk)}` : "Tabela – cały czas" }),
      el("div", { class:"tablewrap" }, el("table", { class:"rank" },
        el("thead", {}, el("tr", {}, el("th", { text:"#" }), el("th", { text:"Imię" }),
          cols.map(([k, label]) => el("th", { class: k === rankSort ? "on" : null }, el("button", { type:"button", class:"thsort", onclick(){ rankSort = k; rerender(); }, text: label + (k === rankSort ? " ↓" : "") }))))),
        el("tbody", {}, placed.map(({ r, place }) => el("tr", { class: r.id === meId ? "me" : null },
          el("td", {}, typeof place === "number" && place <= 3 ? HZ.medal(place, true) : String(place)), el("td", { text:(r.name || "Uczestnik") + (r.hidden ? " (ukryty)" : "") }),
          cols.map(([k,, f]) => el("td", { class: k === rankSort ? "on" : null, text:f(r) }))))))),
      strengthView ? el("p", { class:"small muted", text:"Punkty siły: ciężar × współczynnik masy ciała i płci (IPF GL) × wiek – wymagają wpisanej wagi i płci (Konto). % MC: ciężar jako procent masy ciała; przy podciąganiu i dipach „MC +X%” = masa ciała + X% dociążenia. Ciężar: najlepszy ciężar roboczy (Razem: suma). Kliknij nagłówek kolumny, żeby zmienić sortowanie." }) :
el("p", { class:"small muted", text:"Seria: piątki z rzędu. Rekord: wynik lepszy od wszystkich poprzednich w danym ćwiczeniu i sposobie wykonania. Progres: średni wzrost największego ciężaru od pierwszego treningu. Tonaż: ciężar × powtórzenia w seriach roboczych. % MC: ciężar jako procent masy ciała. Ciężar / Suma kg: największy ciężar roboczy (suma z bojów głównych)." }))];
};

/* individual stats card (client: Postępy; trainer: client history) */
/* "Boje": how much more someone lifts now than at the start (top working weight per exercise) */
HZ.liftsCard = (logs, title = "Ile więcej podnosisz") => {
  const sorted = [...logs].sort((a,b) => (a.date||"").localeCompare(b.date||""));
  const mainIds = new Set(S.workouts.flatMap(w => (w.stations || []).filter(st => HZ.secOf(st) === "main").map(st => st.exId)));
  const rows = new Map();
  for (const l of sorted) for (const e0 of (l.entries || [])){
    const e = HZ.workEntry(e0); if (!e || (e.type || "kg") !== "kg") continue;
    const done = e.sets.filter(x => (x.reps || 0) > 0); if (!done.length) continue;
    const v = Math.max(...done.map(x => Number(x.load) || 0)); const reps = Math.max(...done.filter(x => (Number(x.load) || 0) === v).map(x => x.reps || 0));
    const r = rows.get(e.exId) || { exId:e.exId, name:(HZ.exById(e.exId) || {}).name || e.exName || "Ćwiczenie", n:0 };
    if (!r.first){ r.first = v; r.firstReps = reps; r.firstDate = l.date; }
    if (r.best == null || v > r.best || (v === r.best && reps > r.bestReps)){ r.best = v; r.bestReps = reps; r.bestDate = l.date; }
    r.last = v; r.n++; rows.set(e.exId, r);
  }
  const all = [...rows.values()];
  if (!all.length) return null;
  const main = all.filter(r => mainIds.has(r.exId)), acc = all.filter(r => !mainIds.has(r.exId));
  const line = r => { const d = Math.round((r.best - r.first) * 100) / 100, pct = r.first > 0 ? Math.round(d / r.first * 100) : null;
    const bw = HZ.isBwExercise(HZ.exById(r.exId));
    const kg = v => bw ? (v > 0 ? "+" + HZ.fmtKg(v) : "0") + " kg" : HZ.fmtKg(v) + " kg";
    return el("div", { class:"lift" },
      el("div", { class:"stack", style:"gap:2px;min-width:0" }, el("b", { text:r.name }),
        el("span", { class:"small muted", text: r.n > 1 ? `start ${kg(r.first)} × ${r.firstReps} (${HZ.fmtDate(r.firstDate)}) → rekord ${kg(r.best)} × ${r.bestReps} (${HZ.fmtDate(r.bestDate)})` : `pierwszy wynik: ${kg(r.best)} × ${r.bestReps}` })),
      el("span", { class:"gain" + (d > 0 ? " up" : ""), text: r.n < 2 ? "start" : d > 0 ? `+${HZ.fmtKg(d)} kg` + (pct != null && !bw ? ` · +${pct}%` : "") : "bez zmian" })); };
  return el("div", { class:"card" }, el("h2", { text:title }),
    el("p", { class:"small muted", text:"Najcięższa seria robocza: pierwszy zapisany trening w porównaniu z najlepszym." }),
    main.length ? el("div", { class:"stack", style:"gap:6px" }, el("h3", { text:"Boje" }), el("div", { class:"list" }, main.map(line))) : null,
    acc.length ? el("details", { open: main.length ? null : true }, el("summary", { text:`Akcesoria (${acc.length})` }), el("div", { class:"list", style:"margin-top:6px" }, acc.map(line))) : null);
};
HZ.personalStats = (logs, title, appr = {}) => {
  const st = HZ.computeStats(logs, appr);
  const tile = (label, value, sub) => el("div", { class:"stat" }, el("span", { class:"eyebrow", text:label }), el("span", { class:"v", text:value }), sub ? el("span", { class:"small muted", text:sub }) : null);
  const recs = [...st.records].sort((a,b) => (a.name || "").localeCompare(b.name || "", "pl"));
  return el("div", { class:"card" },
    el("h2", { text:title }),
    el("div", { class:"grid3" },
      tile("Treningi z grupą", st.workouts, st.attendancePct == null ? null : `${st.attendancePct}% obecności`),
      tile("Seria", st.streak, `najdłuższa: ${st.longest}`),
      tile("Rekordy", st.prs, (st.repPrs ? `+${st.repPrs} w powt. · ` : "") + (st.progress == null ? "" : `progres ${st.progress > 0 ? "+" : ""}${st.progress}%`) || null),
      tile("Pkt ogólne", st.points),
      tile("Pkt siłowe", st.strength),
      tile("Tonaż", fmtVol(st.volume))),
    st.pending.length ? el("div", { class:"notice small" }, el("b", { text:"Czeka na zatwierdzenie trenera: " }),
      st.pending.map(x => `${x.name} ${x.to === 0 ? "bez ciężaru" : HZ.fmtKg(x.to) + " kg"} × ${x.reps} (${HZ.fmtDate(x.date)})`).join(", "), ". Po zatwierdzeniu wejdzie do rekordów i rankingu.") : null,
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
  if (c === "auth/weak-password" || c === "auth/password-does-not-meet-requirements") return `Hasło jest za słabe: min. ${HZ.MIN_PASSWORD} znaków, litera i cyfra.`;
  if (c === "auth/requires-recent-login") return "Ze względów bezpieczeństwa zaloguj się ponownie i powtórz operację.";
  if (c === "auth/invalid-email") return "Wpisz poprawny adres e-mail.";
  if (c === "auth/too-many-requests") return "Za dużo prób. Odczekaj chwilę i spróbuj ponownie.";
  if (c === "auth/network-request-failed") return "Brak połączenia z internetem.";
  if (c === "auth/operation-not-allowed") return "Logowanie e-mailem nie jest włączone w Firebase (Authentication → Sign-in method).";
  if (c === "auth/admin-restricted-operation") return "Wejście jako gość nie jest jeszcze włączone. Trener musi włączyć „Anonymous” w Firebase → Authentication → Sign-in method.";
  if (c === "auth/credential-already-in-use" || c === "auth/provider-already-linked") return "Ten e-mail ma już konto. Użyj innego adresu albo poproś trenera o pomoc.";
  if (c === "hz/join-code") return "Nieprawidłowy kod klubu. Zapytaj trenera o aktualny kod.";
  return "Coś poszło nie tak. Spróbuj ponownie.";
}
HZ.authMsg = authMsg;
/* password policy for new passwords */
const COMMON = ["password","haslo","hasło","qwerty","12345678","123456789","1234567890","11111111","zaq12wsx","polska","iloveyou","admin123","password1","qwerty123","abc12345","hubzone","trening1"];
HZ.passwordProblem = (pass, email) => {
  if (pass.length < HZ.MIN_PASSWORD) return `Hasło musi mieć co najmniej ${HZ.MIN_PASSWORD} znaków.`;
  if (!/[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(pass) || !/\d/.test(pass)) return "Hasło musi zawierać literę i cyfrę.";
  const low = pass.toLowerCase(); const local = (email || "").split("@")[0].toLowerCase();
  if (COMMON.some(w => low.includes(w)) || (local.length >= 4 && low.includes(local))) return "To hasło jest zbyt łatwe do odgadnięcia. Wybierz inne.";
  return null;
};
/* invite link: index.html?kod=XXXX prefills the club code (kept for this tab only, removed from the address bar) */
HZ.inviteCode = (() => { try {
  const u = new URL(location.href), k = (u.searchParams.get("kod") || "").trim().toUpperCase().replace(/[^A-Z0-9ĄĆĘŁŃÓŚŹŻ_-]/g, "").slice(0, 40);
  if (k){ sessionStorage.setItem("hz-kod", k); u.searchParams.delete("kod"); history.replaceState(null, "", u.pathname + u.search + u.hash); }
  return sessionStorage.getItem("hz-kod") || "";
} catch(e){ return ""; } })();
HZ.inviteUrl = code => { const u = new URL("./", location.href); if (code) u.searchParams.set("kod", code); return u.href; };
HZ.policyUrl = "polityka-prywatnosci.html";
HZ.policyLink = (text = "Polityka prywatności") => el("a", { href:HZ.policyUrl, target:"_blank", rel:"noopener", text });
HZ.footer = () => el("footer", { class:"foot small muted" }, HZ.policyLink(), el("span", { text:" · Hubzone Weightlifting e-Dziennik" }));
HZ.registering = null;
/* mode: "login" | "register" | "forgot"; allowRegister=false on admin page */
HZ.authView = ({ mode, allowRegister, onMode, title, sub }) => {
  const msg = el("p", { class:"small", role:"alert", style:"color:var(--bad)" });
  const info = el("p", { class:"notice", hidden:true });
  const form = el("form", { class:"card", novalidate:true });
  const heading = { login:"Zaloguj się", register:"Załóż konto", forgot:"Nie pamiętasz hasła?" }[mode];
  form.append(el("div", { class:"stack", style:"gap:4px" }, el("h2", { text: title || heading }), sub ? el("p", { class:"small muted", text:sub }) : null));
  const emailIn = el("input", { id:"au-email", type:"email", autocomplete:"email", required:true, value:HZ.LS.get("hz-email") || "" });
  const passIn = el("input", { id:"au-pass", type:"password", autocomplete: mode === "login" ? "current-password" : "new-password", minlength: mode === "register" ? String(HZ.MIN_PASSWORD) : "6", required:true });
  const ageIn = el("input", { id:"au-age", type:"checkbox", style:"width:auto;margin-top:3px" });
  const rankIn = el("input", { id:"au-rank", type:"checkbox", style:"width:auto;margin-top:3px" });
  const nameIn = el("input", { id:"au-name", autocomplete:"given-name", maxlength:"60", placeholder:"np. Kasia" });
  const codeIn = el("input", { id:"au-code", autocomplete:"off", placeholder:"kod od trenera", style:"text-transform:uppercase", value:HZ.inviteCode });
  if (mode === "register") form.append(el("label", { class:"f" }, "Imię", nameIn));
  form.append(el("label", { class:"f" }, "E-mail", emailIn));
  if (mode !== "forgot") form.append(el("label", { class:"f" }, mode === "register" ? `Hasło (min. ${HZ.MIN_PASSWORD} znaków, litera i cyfra)` : "Hasło", passIn));
  if (mode === "register"){
    form.append(el("label", { class:"f" }, "Kod klubu", codeIn),
      el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, ageIn,
        el("span", {}, "Mam ukończone 16 lat i zapoznałem/-am się z ", HZ.policyLink("polityką prywatności"), ". (wymagane)")),
      el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, rankIn,
        el("span", { text:"Chcę być widoczny/-a w rankingu grupy (imię i wyniki). Mogę to zmienić w każdej chwili w zakładce Konto. (dobrowolne)" })));
  }
  const submit = el("button", { type:"submit", class:"primary", text:{ login:"Zaloguj", register:"Załóż konto", forgot:"Wyślij link" }[mode] });
  form.append(msg, info, submit);
  const links = el("div", { class:"row between small" });
  if (mode === "login"){ if (allowRegister) links.append(el("button", { type:"button", class:"link", onclick(){ onMode("register"); }, text:"Nie masz konta? Załóż je" }));
    links.append(el("button", { type:"button", class:"link", onclick(){ onMode("forgot"); }, text:"Nie pamiętam hasła" })); }
  else links.append(el("button", { type:"button", class:"link", onclick(){ onMode("login"); }, text:"Wróć do logowania" }));
  form.append(links); if (mode !== "register") form.append(el("p", { class:"small muted" }, HZ.policyLink()));
  form.addEventListener("submit", async ev => {
    ev.preventDefault(); msg.textContent = ""; info.hidden = true;
    const email = emailIn.value.trim().toLowerCase(), pass = passIn.value;
    if (!/^\S+@\S+\.\S+$/.test(email)){ msg.textContent = "Wpisz poprawny adres e-mail."; return; }
    if (mode === "login" && !pass){ msg.textContent = "Wpisz hasło."; return; }
    if (mode === "register"){ const pp = HZ.passwordProblem(pass, email); if (pp){ msg.textContent = pp; return; } }
    if (mode === "register" && !ageIn.checked){ msg.textContent = "Zaznacz, że masz ukończone 16 lat i znasz politykę prywatności."; return; }
    if (mode === "register" && !nameIn.value.trim()){ msg.textContent = "Wpisz imię."; return; }
    if (mode === "register" && !codeIn.value.trim()){ msg.textContent = "Wpisz kod klubu."; return; }
    HZ.LS.set("hz-email", email); submit.disabled = true;
    try {
      if (mode === "login") await auth.signInWithEmailAndPassword(email, pass);
      if (mode === "register"){
        const name = nameIn.value.trim().slice(0, 60), joinCode = codeIn.value.trim().toUpperCase();
        HZ.registering = (async () => {
          const cred = await auth.createUserWithEmailAndPassword(email, pass);
          const consent = HZ.makeConsent(null, { age16:true, ranking:rankIn.checked, health:false });
          const r = await HZ.api.createProfile(cred.user.uid, { name, email, joinCode, consent });
          if (!r.error) cred.user.sendEmailVerification().catch(() => {});
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
