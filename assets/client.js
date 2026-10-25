/* Hubzone Weightlifting e-Dziennik — panel klienta */
(function(){
"use strict";
const { el, S, toast } = HZ;
const app = document.getElementById("app");
const C = { appr:{}, plan:{}, session:null, profile:null, logs:[], loaded:false, tab:"today", authMode: HZ.inviteCode ? "guest" : "login", sel:null, drafts:{}, own:null, error:null };

function render(){ HZ.swap(app, view()); }
const draftsKey = () => "hz-drafts-" + (C.session ? C.session.user.id : "x");
const ownKey = () => "hz-own-" + (C.session ? C.session.user.id : "x");
const saveDrafts = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => HZ.LS.set(draftsKey(), C.drafts), 400); pushDraft(); }; })();
/* unsent results go to the trainer as a draft (a few seconds after typing) */
const pushDraft = (() => { let t, last = ""; return () => { clearTimeout(t); t = setTimeout(async () => {
  if (!C.session || !C.profile) return; const w = S.workouts.find(x => x.id === currentId()); if (!w || isLocked(w)) return;
  const d = C.drafts[w.id]; if (!d) return; const entries = buildEntries(w, d); if (!entries.length) return;
  const row = { user_id:C.session.user.id, workout_id:w.id, date:w.date, title:w.title || "", fatigue:d.fatigue ?? null, note:(d.note || "").trim().slice(0,1000), entries, ...(painOf(d) ? { pain:painOf(d) } : {}) };
  const key = JSON.stringify(row); if (key === last) return;
  const saved = C.logs.find(l => l.workout_id === w.id);
  if (saved && JSON.stringify(saved.entries) === JSON.stringify(entries) && (saved.fatigue ?? null) === row.fatigue && (saved.note || "") === row.note) return;
  const { error } = await HZ.api.saveDraft({ ...row, saved_at:new Date().toISOString() }); if (!error) last = key; }, 4000); }; })();
const painOf = d => HZ.feat("pain", C.profile) && d && d.painOn && (d.pain || "").trim() ? d.pain.trim().slice(0, 200) : null;
const rirOn = () => HZ.feat("rir", C.profile);
const custom = () => !!(S.config.features && S.config.features.custom);
const tipFor = (w, st, exBase, mode) => HZ.trainerTip(C.plan, C.logs, exBase.id, mode)
  || HZ.suggest(HZ.dropRejected(C.logs, C.appr), exBase.id, mode, custom() ? HZ.progEx(exBase, C.profile.progression) : exBase, w.id, rirOn() ? HZ.targetRir(w, st) : null);
const isLocked = w => !!(S.config.features && S.config.features.requireStart) && !(C.profile && C.profile.is_admin) && w.open !== true;

async function loadAll(){
  const uid = C.session.user.id;
  try {
    if (HZ.registering) await HZ.registering.catch(() => {});
    if (!C.session || C.session.user.id !== uid) return;
    const pr = await HZ.api.profile(uid); if (pr.error) throw pr.error;
    C.profile = pr.data;
    if (C.profile){
      const [lg] = await Promise.all([HZ.api.logsOf(uid), HZ.loadConfig(), HZ.loadWorkouts()]);
      if (lg.error) throw lg.error;
      C.logs = lg.data.sort((a,b) => (a.date||"").localeCompare(b.date||""));
      const pl = await HZ.api.planOf(uid); C.plan = pl.data || {};
      const ap = await HZ.api.approvalsOf(uid); C.appr = Object.fromEntries((ap.data || []).map(a => [a.id, a]));
      HZ.applyHolo(); HZ.rirOn = rirOn();
      if (S.config.rankingEnabled && C.profile.consent && C.profile.consent.ranking) HZ.api.ranking().then(r => { if (!r.error){ C.rankRows = r.data; render(); } });
      const mr = await HZ.api.myRanking(uid);
      if (mr.data){ const { updatedAt, ...rest } = mr.data; C.rankKey = JSON.stringify(rest); } else C.rankKey = "none";
      setTimeout(syncRanking, 0);
    }
    C.error = null;
  } catch(e){ console.error(e); C.error = "Nie udało się wczytać danych. Sprawdź połączenie i odśwież stronę."; }
  C.drafts = HZ.LS.get(draftsKey()) || {}; C.own = HZ.LS.get(ownKey());
  C.loaded = true; render();
}

function view(){
  if (!HZ.ready) return [header(), ...HZ.setupNeeded()];
  if (!C.session && C.authMode === "guest") return [header(), el("div", { class:"auth" }, guestForm()), HZ.footer()];
  if (!C.session) return [header(), el("div", { class:"auth" },
    C.authMode === "login" ? el("div", { class:"card guest-cta" }, el("div", { class:"stack", style:"gap:2px" }, el("h3", { text:"Pierwszy raz na zajęciach?" }),
        el("span", { class:"small muted", text:"Wejdź jako gość: tylko imię, bez e-maila i hasła. Konto założysz później, wyniki zostaną." })),
      el("button", { class:"primary", onclick(){ C.authMode = "guest"; render(); }, text:"Wejdź jako gość" })) : null,
    HZ.authView({ mode:C.authMode, allowRegister:true, onMode: m => { C.authMode = m; render(); },
    sub: C.authMode === "register" ? (HZ.inviteCode ? "Kod klubu jest już wpisany z zaproszenia." : "Kod klubu dostaniesz od trenera na zajęciach.") : C.authMode === "login" ? "Masz już konto? Zaloguj się." : null }))];
  if (!C.loaded) return [header(), el("div", { class:"empty", text:"Wczytuję Twój dziennik…" })];
  if (C.error) return [header(), el("div", { class:"empty" }, el("p", { text:C.error }), el("button", { onclick(){ C.loaded = false; render(); loadAll(); }, text:"Spróbuj ponownie" }))];
  if (!C.profile) return [header(), joinCard()];
  if (!C.profile.is_admin && !HZ.consentOk(C.profile)) return [header(), consentGate(), HZ.footer()];
  return [header(), HZ.tabBar([["today","Dzisiejszy trening"],["progress","Postępy"], S.config.rankingEnabled ? ["ranking","Ranking"] : null, S.config.ownEnabled ? ["own","Trening własny"] : null, ["account","Konto"]].filter(Boolean), C.tab, k => { C.tab = k; render(); }), ...body(), HZ.footer()];
}
function header(){
  const wid = currentId(); const w = S.workouts.find(x => x.id === wid);
  const name = C.profile && C.profile.name; const n = C.logs.length;
  const out = el("header", { class:"top" }, HZ.brand());
  if (C.session && C.loaded && !C.error) return el("div", { class:"stack", style:"gap:12px" }, out,
    el("div", { class:"hello" },
      el("span", { class:"eyebrow", text: w ? HZ.fmtDate(w.date, true) : "e-Dziennik" }),
      el("h1", { text: name ? `Cześć, ${name}` : "Cześć!" }),
      el("div", { class:"row" }, w ? el("span", { class:"badge", text:`Trening #${HZ.workoutNo(w.id)}` }) : null,
        C.profile && C.profile.guest ? el("span", { class:"chip", text:"Gość" }) : null,
        n ? el("span", { class:"small muted", text:`Masz już ${n} ${HZ.plural(n, "zapisany trening", "zapisane treningi", "zapisanych treningów")}` }) : null)));
  return out;
}
function updateState(){
  const wid = currentId(); const w = S.workouts.find(x => x.id === wid); const d = w && C.drafts[w.id]; if (!d) return;
  for (const st of (w.stations || [])){ const n = document.querySelector(`[data-state="${st.id}"]`); if (!n) continue;
    const stt = stationState(w, st, d); n.textContent = stt.text; n.className = "state " + stt.kind;
    const b = n.nextElementSibling; if (b) b.className = stt.kind === "ok" ? "" : "primary"; }
}
window.addEventListener("pagehide", () => { try { if (C.session) HZ.LS.set(draftsKey(), C.drafts); } catch(e){} });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && C.session) HZ.LS.set(draftsKey(), C.drafts); });

/* ---------- ranking ---------- */
async function syncRanking(){
  if (!S.config.rankingEnabled || !C.profile || !C.session) return;
  if (C.profile.is_admin){ if (C.rankKey !== "admin"){ C.rankKey = "admin"; await HZ.api.deleteRanking(C.session.user.id); } return; }   // trainers are not ranked
  const c = C.profile.consent || {};
  if (!c.ranking){ if (C.rankKey !== "none"){ C.rankKey = "none"; await HZ.api.deleteRanking(C.session.user.id); if (C.rankRows) loadRanking(); } return; }   // ranking only with consent
  const row = { name:C.profile.name || "", ...HZ.rankFull(C.logs, C.appr, c.health ? C.profile.bodyweight : null), hidden:false };
  const key = JSON.stringify(row); if (key === C.rankKey) return;
  const { error } = await HZ.api.saveRanking(C.session.user.id, { ...row, updatedAt:new Date().toISOString() });
  if (!error){ C.rankKey = key; if (C.rankRows) loadRanking(); }
}
async function loadRanking(){
  const { data, error } = await HZ.api.ranking();
  C.rankRows = error ? [] : data; if (error) toast(HZ.dbError(error)); render();
}
function rankingTab(){
  if (!C.rankRows){ loadRanking(); return [el("div", { class:"empty", text:"Wczytuję ranking…" })]; }
  const prompt = C.profile && C.profile.bodyweight ? null : bwForm("Wpisz swoją masę ciała, żeby pojawić się w rankingu siły względnej. Inni zobaczą tylko procenty.");
  return HZ.rankingView(C.rankRows, C.session.user.id, render, { relPrompt:prompt, message:HZ.myRankMessage(C.rankRows, C.session.user.id) });
}
function body(){
  if (C.tab === "ranking" && S.config.rankingEnabled) return rankingTab();
  if (C.tab === "progress") return C.logs.length ? [HZ.progressLegend(), HZ.personalStats(C.logs, "Twoje statystyki", C.appr), ...HZ.progressView(C.logs, "Twoje postępy", "me", render)] : HZ.progressView(C.logs, "Twoje postępy", "me", render);
  if (C.tab === "own" && S.config.ownEnabled) return ownView();
  if (C.tab === "account") return accountView();
  return todayView();
}
function currentId(){ const ws = HZ.sortedWorkouts(); if (C.sel && ws.some(w => w.id === C.sel)) return C.sel; return HZ.defaultWorkoutId(); }

/* ---------- today ---------- */
const DRAFT_V = 3;   // bump when warm-up rules change: untouched warm-ups in old drafts get recalculated
function draftFor(w){
  const old = C.drafts[w.id];
  if (old && old.v === DRAFT_V) return old;
  if (old){
    for (const st of (w.stations || [])){
      const ex = HZ.exById(st.exId); const sets = old.st && old.st[st.id]; if (!ex || !sets) continue;
      const mode = (old.mode && old.mode[st.id] && old.mode[st.id] !== "bw") ? old.mode[st.id] : ex.type;
      const warm = sets.filter(x => x.warmup), work = sets.find(x => !x.warmup);
      if (warm.length && warm.every(x => x.reps == null)) HZ.warmupLoads({ ...ex, type:mode }, warm.length, work ? (work.load === "" ? null : work.load) : null).forEach((l, k) => { warm[k].load = l; });
    }
    old.v = DRAFT_V; saveDrafts(); return old;
  }
  const existing = C.logs.find(l => l.workout_id === w.id);
  const d = { v:DRAFT_V, fatigue: existing ? existing.fatigue ?? null : null, note: existing ? existing.note || "" : "", painOn: !!(existing && existing.pain), pain:(existing && existing.pain) || "", st:{}, mode:{} };
  for (const st of (w.stations || [])){
    const ex = HZ.exById(st.exId); if (!ex) continue;
    const prev = existing && (existing.entries || []).find(e => e.stationId === st.id);
    const pt = C.plan && C.plan[ex.id] && C.plan[ex.id].type; const planMode = pt && HZ.modesOf(ex).includes(pt) && HZ.trainerTip(C.plan, C.logs, ex.id, pt) ? pt : null;
    d.mode[st.id] = prev && prev.type !== "bw" ? (prev.type || ex.type) : (planMode || ex.type);
    if (prev) d.st[st.id] = prev.sets.map(s => ({ load:s.load ?? null, reps:s.reps ?? null, rir:s.rir ?? null, ...(s.warmup ? { warmup:true } : {}) }));
    else d.st[st.id] = freshSets(w, st, ex, d.mode[st.id]);
  }
  C.drafts[w.id] = d; return d;
}
function todayView(){
  const ws = HZ.sortedWorkouts(); const wid = currentId(); const w = ws.find(x => x.id === wid);
  if (!w) return [el("div", { class:"empty" }, el("h3", { text:"Trener nie dodał jeszcze treningu" }),
    el("p", { class:"small", text:"Gdy pojawi się piątkowy plan, zobaczysz tu stacje i miejsce na swoje serie." }),
    S.config.ownEnabled ? el("button", { onclick(){ C.tab = "own"; render(); }, text:"Zapisz trening własny" }) : null)];
  const saved = C.logs.find(l => l.workout_id === w.id);
  livePoll();
  if (HZ.groupsOn() && !C.sel){ const same = ws.filter(x => x.date === w.date); if (same.length > 1) return groupChooser(same); }
  if (isLocked(w)) return lockedView(ws, w, saved);
  const d = draftFor(w);
  const pick = el("select", { id:"wsel", "aria-label":"Wybierz trening", onchange(e){ C.sel = e.target.value; render(); } },
    [...ws].reverse().map(x => el("option", { value:x.id, text:`${HZ.workoutLabel(x)}` })));
  pick.value = w.id;
  const out = [el("div", { class:"row between" },
    el("div", { class:"stack", style:"gap:2px" }, el("h2", { text: w.title || `Trening #${HZ.workoutNo(w.id)}` }),
      el("span", { class:"small muted", text:`${(() => { const st = w.stations || [], m = st.filter(x => HZ.secOf(x) === "main").length, a = st.length - m;
        return [m ? `${m} ${HZ.plural(m, "bój", "boje", "bojów")}` : null, a ? `${a} ${HZ.plural(a, "stacja", "stacje", "stacji")}` : null].filter(Boolean).join(" · "); })()}${saved ? " · wysłano " + new Date(saved.saved_at).toLocaleTimeString("pl-PL", { hour:"2-digit", minute:"2-digit" }) : ""}` })),
    el("div", { style:"max-width:240px;flex:1 1 170px" }, pick))];
  if (w.note) out.push(el("p", { class:"muted", text:w.note }));
  if (custom() && C.profile.task) out.push(el("div", { class:"notice" }, el("b", { text:"Zadanie od trenera: " }), C.profile.task));
  if (C.profile.guest) out.unshift(guestBanner());
  else { const msg = C.rankRows && HZ.myRankMessage(C.rankRows, C.session.user.id) || HZ.personalMessage(C.logs); if (msg) out.unshift(HZ.motivationBox(msg)); }
  const labels = HZ.stationLabels(HZ.orderStations(w.stations || []));
  const ss = HZ.supersetInfo(HZ.orderStations(w.stations || []));
  for (const sec of HZ.SECTIONS){
    if (sec.key !== "main" && !HZ.feat("acc", C.profile)) continue;   // trainer can hide accessories for clients
    const items = (w.stations || []).filter(st => HZ.secOf(st) === sec.key && HZ.exById(st.exId));
    if (!items.length) continue;
    out.push(el("div", { class:"sechead" }, el("h2", { text:sec.title }), el("span", { class:"eyebrow", text:sec.sub })));
    items.forEach(st => out.push(stationCard(w, st, HZ.exById(st.exId), labels[st.id] + (ss[st.id] ? ` · superseria z ${ss[st.id].join(", ")}` : ""), d, !!ss[st.id])));
  }
  out.push(el("div", { class:"card" },
    el("div", { class:"stack", style:"gap:2px" }, el("h3", { text:"Zmęczenie po treningu" }), el("span", { class:"small muted", text:"1 = lekko, 10 = nie dam rady nic więcej" })),
    HZ.fatiguePicker(d.fatigue, v => { d.fatigue = v; saveDrafts(); render(); }),
    HZ.feat("pain", C.profile) ? painBox(d) : null,
    el("label", { class:"f" }, "Notatka do trenera / feedback (opcjonalnie)", el("textarea", { id:"note-" + w.id, maxlength:"1000", value:d.note, oninput(e){ d.note = e.target.value; saveDrafts(); } })),
    el("button", { class:"primary", onclick(e){ saveWorkout(w, d, e.currentTarget); }, text: saved ? "Zapisz zmiany" : "Wyślij wyniki do trenera" })));
  return out;
}
function freshSets(w, st, ex, mode){
  const mx = { ...ex, type:mode };
  const sg = tipFor(w, st, ex, mode);
  return HZ.buildSets(mx, HZ.secOf(st) === "main" ? (st.warmup || 0) : 0, st.sets || 3, sg.next ?? null);
}
function stationCard(w, st, exBase, label, d, isSuper){
  d.mode = d.mode || {};
  let mode = HZ.modeFor(exBase, d.mode[st.id]);
  if (d.mode[st.id] && d.mode[st.id] !== mode){ d.mode[st.id] = mode; d.st[st.id] = null; }   // trainer turned that mode off
  // trainer's plan uses the other mode (e.g. band -> weight): switch once, while nothing is typed in yet
  const pl = C.plan && C.plan[exBase.id]; d.planSeen = d.planSeen || {};
  if (pl && pl.type && pl.type !== mode && !d.planSeen[st.id] && HZ.modesOf(exBase).includes(pl.type) && HZ.trainerTip(C.plan, C.logs, exBase.id, pl.type)
      && !(d.st[st.id] || []).some(x => x.reps != null)){ mode = pl.type; d.mode[st.id] = mode; d.st[st.id] = null; d.planSeen[st.id] = true; saveDrafts(); }
  const ex = { ...exBase, type:mode };
  const sets = d.st[st.id] || (d.st[st.id] = freshSets(w, st, exBase, mode));
  const tRir = rirOn() ? HZ.targetRir(w, st) : null;
  const sg = tipFor(w, st, exBase, mode);
  reshape(d, st, sets, ex);
  HZ.refreshWarmups(ex, sets);
  const curLoad = (sets.find(s => !s.warmup) || {}).load;
  const isMain = HZ.secOf(st) === "main";
  if (!isMain && sets.some(x => x.warmup)){ const keep = sets.filter(x => !x.warmup); sets.length = 0; sets.push(...keep); }
  const extra = [isMain && st.warmup ? `+ ${st.warmup} ${HZ.plural(st.warmup, "seria wstępna", "serie wstępne", "serii wstępnych")}` : null, st.work ? `praca ${st.work}` : null, st.rest ? `przerwa ${st.rest}` : null, st.note].filter(Boolean);
  return el("section", { class:"card station" + (HZ.secOf(st) === "main" ? " main" : "") + (isSuper ? " super" : "") + (HZ.kindOf(exBase) ? " k-" + HZ.kindOf(exBase) : "") },
    el("div", { class:"row between", style:"align-items:flex-start" },
      el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:label }), el("h3", {}, HZ.kindDot(exBase), HZ.kindOf(exBase) ? " " : null, ex.name)),
      el("div", { class:"row", style:"gap:4px;justify-content:flex-end" }, el("span", { class:"badge", text:`${st.sets || "?"} × ${st.reps || "?"}` }),
        tRir != null ? el("span", { class:"badge rir", title:"Docelowy zapas powtórzeń", text:`RIR ${tRir}` }) : null)),
    extra.length ? el("div", { class:"small muted", text: extra.join(" · ") }) : null,
    HZ.modeToggle(mode, m => { d.mode[st.id] = m; d.st[st.id] = freshSets(w, st, exBase, m); saveDrafts(); render(); }, exBase),
    HZ.tipBox(sg, load => { HZ.applyLoad(ex, sets, load); saveDrafts(); render(); }, curLoad),
    isMain && mode === "kg" && sets.some(s => s.warmup) ? HZ.targetBox(ex, sets, () => { saveDrafts(); render(); }, `w${w.id}-${st.id}`) : null,
    HZ.setsEditor(ex, sets, `w${w.id}-${st.id}`, structural => { saveDrafts(); if (structural) render(); else updateState(); }, { repsHint:sg.reps, noWarmup:!isMain, noRir:!rirOn() }),
    (() => { const stt = stationState(w, st, d); const name = label.split(" · ")[0];
      return el("div", { class:"stsave" }, el("span", { class:"state " + stt.kind, "data-state":st.id, text:stt.text }),
        el("button", { class: stt.kind === "ok" ? "" : "primary", onclick(ev){ saveProgress(w, d, ev.currentTarget, name); }, text: `Zapisz ${isMain ? "bój" : "stację"}` })); })());
}
function cleanSets(sets){ return sets.filter(s => s.reps != null).map(s => ({ load: s.load === "" ? null : s.load ?? null, reps:s.reps, rir: s.warmup ? null : (s.rir ?? null), ...(s.warmup ? { warmup:true } : {}) })); }
/* entries of the whole workout from the draft (stations with at least one set filled in) */
function buildEntries(w, d){
  const entries = [];
  for (const st of (w.stations || [])){ const ex = HZ.exById(st.exId); if (!ex) continue;
    const sets = cleanSets(d.st[st.id] || []);
    if (sets.length) entries.push({ stationId:st.id, exId:ex.id, exName:ex.name, type:(d.mode && d.mode[st.id]) || ex.type, ...(HZ.targetRir(w, st) != null ? { targetRir:HZ.targetRir(w, st) } : {}), targetSets:st.sets || sets.filter(x => !x.warmup).length, targetReps:st.reps || 0, sets }); }
  return entries;
}
function stationState(w, st, d){
  const saved = C.logs.find(l => l.workout_id === w.id);
  const se = saved && (saved.entries || []).find(e => e.stationId === st.id);
  const now = cleanSets(d.st[st.id] || []);
  if (!now.length && !se) return { kind:"none", text:"Nic jeszcze nie wpisano" };
  if (se && JSON.stringify(se.sets) === JSON.stringify(now)) return { kind:"ok", text:"✓ Zapisane" + (saved.saved_at ? ` (${new Date(saved.saved_at).toLocaleTimeString("pl-PL", { hour:"2-digit", minute:"2-digit" })})` : "") };
  return { kind:"dirty", text:"Niezapisane zmiany" };
}
/* save progress after each lift/station: keeps the draft, trainer already sees it */
/* trainer can require an account after N trainings saved as a guest */
function guestBlocked(w){
  const lim = S.config.guestLimit; if (!C.profile.guest || !lim) return false;
  if (C.logs.some(l => l.workout_id === w.id) || C.logs.length < lim) return false;
  toast(`Jako gość możesz zapisać ${lim} ${HZ.plural(lim, "trening", "treningi", "treningów")}. Załóż konto w zakładce Konto – wszystkie wyniki zostaną.`);
  C.tab = "account"; render(); return true;
}
async function saveProgress(w, d, btn, label){
  if (guestBlocked(w)) return;
  const entries = buildEntries(w, d);
  if (!entries.length){ toast("Wpisz powtórzenia przynajmniej w jednej serii."); return; }
  btn.disabled = true;
  const prev = C.logs.find(l => l.workout_id === w.id);
  const row = { user_id:C.session.user.id, workout_id:w.id, date:w.date, title:w.title || "", own:false, fatigue: d.fatigue ?? (prev ? prev.fatigue ?? null : null), note:(d.note || "").trim().slice(0,1000), entries, saved_at:new Date().toISOString(), ...(painOf(d) ? { pain:painOf(d) } : {}) };
  const { data, error } = await HZ.api.saveWorkoutLog(row);
  btn.disabled = false;
  if (error){ toast(error.code === "permission-denied" && isLocked(w) === false && S.config.features.requireStart ? "Trener zakończył już ten trening." : HZ.dbError(error)); return; }
  HZ.api.deleteDraft(C.session.user.id, w.id);
  C.logs = C.logs.filter(l => l.id !== data.id).concat(data); syncRanking(); HZ.LS.set(draftsKey(), C.drafts);
  toast(`Zapisano: ${label}`); render();
}
async function saveWorkout(w, d, btn){
  if (guestBlocked(w)) return;
  const entries = buildEntries(w, d);
  if (!entries.length){ toast("Wpisz powtórzenia przynajmniej w jednej serii."); return; }
  btn.disabled = true;
  const row = { user_id:C.session.user.id, workout_id:w.id, date:w.date, title:w.title || "", own:false, fatigue:d.fatigue ?? null, note:(d.note || "").trim().slice(0,1000), entries, saved_at:new Date().toISOString(), ...(painOf(d) ? { pain:painOf(d) } : {}) };
  const { data, error } = await HZ.api.saveWorkoutLog(row);
  btn.disabled = false;
  if (error){ toast(HZ.dbError(error)); return; }
  HZ.api.deleteDraft(C.session.user.id, w.id);
  C.logs = C.logs.filter(l => l.id !== data.id).concat(data); syncRanking();
  delete C.drafts[w.id]; HZ.LS.set(draftsKey(), C.drafts);
  toast("Wysłano do trenera"); render();
}

/* ---------- own session ---------- */
function ownView(){
  if (!S.config.exercises.length) return [el("div", { class:"empty", text:"Trener nie dodał jeszcze ćwiczeń. Gdy je doda, zapiszesz tu trening na własną rękę." })];
  if (!C.own) C.own = { date:HZ.todayISO(), fatigue:null, items:[] };
  const o = C.own; const persist = re => { HZ.LS.set(ownKey(), o); if (re) render(); };
  const addSel = el("select", { id:"own-add", "aria-label":"Dodaj ćwiczenie" }, el("option", { value:"", text:"Wybierz ćwiczenie…" }), S.config.exercises.map(e => el("option", { value:e.id, text:e.name })));
  const out = [el("div", { class:"card" },
    el("h2", { text:"Trening własny" }), el("p", { class:"small muted", text:"Na siłowni poza zajęciami. Te wyniki też liczą się do postępów i podpowiedzi." }),
    el("div", { class:"grid2" },
      el("label", { class:"f" }, "Data", el("input", { id:"own-date", type:"date", value:o.date, onchange(e){ o.date = e.target.value; persist(); } })),
      el("label", { class:"f" }, "Ćwiczenie", addSel)),
    el("button", { onclick(){ const id = addSel.value; if (!id) return; const ex = HZ.exById(id); const sg = HZ.suggest(HZ.dropRejected(C.logs, C.appr), id, ex.type, ex);
      const last = HZ.history(C.logs, id, null, ex.type)[0]; const tr = last ? last.entry.targetReps : 8; const ts = last ? last.entry.targetSets : 3;
      o.items.push({ key:HZ.uuid().slice(0,8), exId:id, mode:HZ.modeFor(ex, ex.type), targetReps:tr, targetSets:ts, sets:HZ.buildSets(ex, 0, ts, sg.next ?? null) });
      persist(true); }, text:"+ Dodaj do treningu" }))];
  o.items.forEach((it, idx) => { const exBase = HZ.exById(it.exId); if (!exBase) return; const mode = HZ.modeFor(exBase, it.mode && it.mode !== "bw" ? it.mode : null); const ex = { ...exBase, type:mode };
    const sg = HZ.suggest(HZ.dropRejected(C.logs, C.appr), ex.id, mode, exBase); HZ.refreshWarmups(ex, it.sets); const curLoad = (it.sets.find(s => !s.warmup) || {}).load;
    out.push(el("section", { class:"card station" },
      el("div", { class:"row between" }, el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:"Ćwiczenie" }), el("h3", { text:ex.name })),
        el("button", { class:"ghost", onclick(){ o.items.splice(idx, 1); persist(true); }, text:"Usuń" })),
      el("div", { class:"grid2" },
        el("label", { class:"f" }, "Plan: serie", el("input", { id:`own-ts-${it.key}`, inputmode:"numeric", value:String(it.targetSets), onchange(e){ it.targetSets = Math.max(1, Math.round(HZ.parseNum(e.target.value) || 1)); persist(); } })),
        el("label", { class:"f" }, "Plan: powtórzenia", el("input", { id:`own-tr-${it.key}`, inputmode:"numeric", value:String(it.targetReps), onchange(e){ it.targetReps = Math.max(1, Math.round(HZ.parseNum(e.target.value) || 1)); persist(); } }))),
      HZ.modeToggle(mode, m => { it.mode = m; const nsg = HZ.suggest(HZ.dropRejected(C.logs, C.appr), ex.id, m, exBase); it.sets = HZ.buildSets({ ...exBase, type:m }, it.sets.filter(s => s.warmup).length, Math.max(1, it.sets.filter(s => !s.warmup).length), nsg.next ?? null); persist(true); }, exBase),
      HZ.tipBox(sg, load => { HZ.applyLoad(ex, it.sets, load); persist(true); }, curLoad),
      HZ.setsEditor(ex, it.sets, `own-${it.key}`, re => persist(re), { repsHint:sg.reps, noRir:!rirOn() }))); });
  if (o.items.length) out.push(el("div", { class:"card" }, el("h3", { text:"Zmęczenie po treningu" }), HZ.fatiguePicker(o.fatigue, v => { o.fatigue = v; persist(true); }),
    el("button", { class:"primary", async onclick(ev){
      const entries = o.items.map(it => { const ex = HZ.exById(it.exId); const sets = cleanSets(it.sets);
        return ex && sets.length ? { stationId:null, exId:ex.id, exName:ex.name, type:it.mode || ex.type, targetSets:it.targetSets, targetReps:it.targetReps, sets } : null; }).filter(Boolean);
      if (!entries.length){ toast("Wpisz powtórzenia przynajmniej w jednej serii."); return; }
      const btn = ev.currentTarget; btn.disabled = true;
      const { data, error } = await HZ.api.addOwnLog({ user_id:C.session.user.id, workout_id:null, date:o.date || HZ.todayISO(), own:true, title:"Trening własny", fatigue:o.fatigue ?? null, note:"", entries });
      btn.disabled = false;
      if (error){ toast(HZ.dbError(error)); return; }
      C.logs.push(data); syncRanking(); C.own = null; HZ.LS.set(ownKey(), null); toast("Zapisano trening"); render(); }, text:"Zapisz trening własny" })));
  return out;
}

/* ---------- RODO: consent ---------- */
async function saveConsent(patch, okMsg){
  const consent = HZ.makeConsent(C.profile.consent, patch);
  const update = { consent }; if (patch.health === false) update.bodyweight = null;
  const { error } = await HZ.api.updateProfile(C.session.user.id, update);
  if (error){ toast(error.code === "permission-denied" ? "Nie udało się zapisać: trener musi zaktualizować reguły bazy." : HZ.dbError(error)); return false; }
  C.profile.consent = consent; if (patch.health === false) C.profile.bodyweight = null;
  await syncRanking(); if (okMsg) toast(okMsg); render(); return true;
}
function consentGate(){
  const c = C.profile.consent || {};
  const age = el("input", { id:"cg-age", type:"checkbox", style:"width:auto;margin-top:3px" });
  const rank = el("input", { id:"cg-rank", type:"checkbox", style:"width:auto;margin-top:3px", checked: c.ranking || null });
  return el("div", { class:"card auth" }, el("h2", { text:"Twoje dane i prywatność" }),
    el("p", { class:"small", text:"Zanim zaczniesz: aplikacja przechowuje Twoje imię, e-mail i wyniki treningowe, żeby trener mógł prowadzić Twoje treningi. Szczegóły, Twoje prawa i kontakt do administratora są w polityce prywatności." }),
    el("p", { class:"small" }, HZ.policyLink("Przeczytaj politykę prywatności")),
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, age,
      el("span", { text:"Mam ukończone 16 lat i zapoznałem/-am się z polityką prywatności. (wymagane)" })),
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, rank,
      el("span", { text:"Chcę być widoczny/-a w rankingu grupy (imię i wyniki). (dobrowolne, można zmienić w Konto)" })),
    el("button", { class:"primary", async onclick(ev){ if (!age.checked){ toast("Zaznacz pierwsze pole, żeby korzystać z aplikacji."); return; }
      ev.currentTarget.disabled = true; const ok = await saveConsent({ age16:true, ranking:rank.checked }, "Zapisano. Dziękujemy!"); if (!ok) ev.currentTarget.disabled = false; }, text:"Akceptuję i przechodzę dalej" }),
    logoutButton("ghost"));
}

/* ---------- account ---------- */
function bwForm(hint){
  const inp = el("input", { id:"acc-bw", inputmode:"decimal", placeholder:"np. 78,5", value: C.profile && C.profile.bodyweight ? HZ.fmtKg(C.profile.bodyweight) : "", style:"max-width:7rem;text-align:center" });
  const hasHealth = !!(C.profile.consent && C.profile.consent.health);
  const hc = el("input", { id:"acc-health", type:"checkbox", style:"width:auto;margin-top:3px", checked: hasHealth || null });
  return el("div", { class:"stack", style:"gap:6px" }, hint ? el("p", { class:"small", text:hint }) : null,
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, hc,
      el("span", { text:"Wyrażam wyraźną zgodę na przetwarzanie mojej masy ciała (dane dotyczące zdrowia, art. 9 RODO) wyłącznie w celu obliczenia siły względnej w rankingu. Zgodę mogę wycofać w każdej chwili." })),
    el("div", { class:"row", style:"flex-wrap:nowrap" }, el("label", { class:"f", style:"flex:1" }, "Masa ciała (kg)", inp),
      el("button", { style:"align-self:flex-end", async onclick(ev){ const v = HZ.parseNum(inp.value);
        if (v != null && (v < 25 || v > 300)){ toast("Wpisz masę ciała w kg, np. 78,5."); return; }
        if (v != null && !hc.checked){ toast("Zaznacz zgodę na przetwarzanie masy ciała, żeby ją zapisać."); return; }
        ev.currentTarget.disabled = true;
        const consent = HZ.makeConsent(C.profile.consent, { health: v != null });
        const { error } = await HZ.api.updateProfile(C.session.user.id, { bodyweight: v == null ? null : Math.round(v * 10) / 10, consent });
        if (!error) C.profile.consent = consent;
        ev.currentTarget.disabled = false;
        if (error){ toast(error.code === "permission-denied" ? "Nie udało się zapisać: trener musi zaktualizować reguły bazy." : HZ.dbError(error)); return; }
        C.profile.bodyweight = v == null ? null : Math.round(v * 10) / 10; syncRanking(); toast(v == null ? "Usunięto masę ciała" : "Zapisano masę ciała"); render(); }, text:"Zapisz" })));
}
function accountView(){
  const nameIn = el("input", { id:"acc-name", maxlength:"60", value:(C.profile && C.profile.name) || "" });
  return [C.profile.guest ? convertCard() : null, el("div", { class:"card" }, el("h2", { text:"Twoje konto" }),
      el("p", { class:"small muted", text: C.profile.guest ? "Konto gościa (bez e-maila)" : C.session.user.email }),
      S.config.rankingEnabled ? el("label", { class:"row", style:"flex-wrap:nowrap;cursor:pointer" },
        el("input", { id:"rank-show", type:"checkbox", style:"width:auto", checked: (C.profile.consent && C.profile.consent.ranking) || null,
          onchange(ev){ const on = ev.target.checked; saveConsent({ ranking:on }, on ? "Pokazujesz się w rankingu" : "Usunięto Cię z rankingu"); } }),
        el("span", { text:"Pokazuj mnie w rankingu grupy (imię i wyniki)" })) : null,
      el("label", { class:"f" }, "Imię widoczne dla trenera", nameIn),
      el("button", { async onclick(){ const n = nameIn.value.trim(); if (!n){ toast("Wpisz imię."); return; }
        const { error } = await HZ.api.updateName(C.session.user.id, n);
        if (error){ toast(HZ.dbError(error)); return; } C.profile.name = n; syncRanking(); toast("Zapisano imię"); render(); }, text:"Zapisz imię" })),
    el("div", { class:"card" }, el("h3", { text:"Masa ciała (opcjonalnie)" }),
      bwForm("Służy tylko do rankingu siły względnej (% masy ciała). Widzisz ją Ty i trener, inni tylko procenty."),
      C.profile.consent && C.profile.consent.health ? el("button", { class:"ghost", style:"align-self:flex-start", onclick(){ saveConsent({ health:false }, "Usunięto masę ciała i wycofano zgodę"); }, text:"Wycofaj zgodę i usuń masę ciała" }) : null),
    HZ.themeCard(render),
    privacyCard(),
    C.profile.guest ? null : el("div", { class:"card" }, el("h3", { text:"Zmień hasło" }), el("p", { class:"small muted", text:"Wyślemy na Twój e-mail link do ustawienia nowego hasła." }),
      el("button", { async onclick(ev){ ev.currentTarget.disabled = true; try { await HZ.resetPassword(C.session.user.email); toast("Wysłano link. Sprawdź skrzynkę."); } catch(e){ toast(HZ.authMsg(e)); } }, text:"Wyślij link do zmiany hasła" })),
    el("div", { class:"row" },
      logoutButton(),
      C.profile && C.profile.is_admin ? el("a", { href:"admin.html", class:"small", text:"Panel trenera →" }) : null)];
}

/* RODO: download my data (art. 15, 20) and delete my account (art. 17) */
function privacyCard(){
  const guest = C.profile.guest;
  const passIn = guest ? null : el("input", { id:"del-pass", type:"password", autocomplete:"current-password", placeholder:"Twoje hasło" });
  return el("div", { class:"card" }, el("h3", { text:"Twoje dane (RODO)" }),
    el("p", { class:"small muted" }, "Zgody udzielone: ", (C.profile.consent && C.profile.consent.at) ? new Date(C.profile.consent.at).toLocaleString("pl-PL") : "–", ". ", HZ.policyLink()),
    el("button", { async onclick(ev){ ev.currentTarget.disabled = true; const { data, error } = await HZ.api.exportMyData(C.session.user.id); ev.currentTarget.disabled = false;
      if (error){ toast(HZ.dbError(error)); return; }
      const a = el("a", { href:URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type:"application/json" })), download:`moje-dane-hubzone-${HZ.todayISO()}.json` });
      document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); toast("Pobrano Twoje dane"); }, text:"Pobierz moje dane (JSON)" }),
    C.confirmDelete ? el("div", { class:"stack", style:"gap:8px;border:1px solid var(--bad);border-radius:8px;padding:10px" },
        el("p", { class:"small", text:"Usuniemy na stałe Twoje konto, profil, wszystkie wyniki treningowe i wpis w rankingu. Tego nie da się cofnąć." + (guest ? "" : " Wpisz hasło, żeby potwierdzić.") }),
        passIn,
        el("div", { class:"row" },
          el("button", { class:"danger", async onclick(ev){ if (passIn && !passIn.value){ toast("Wpisz hasło."); return; } ev.currentTarget.disabled = true;
            const { error } = await HZ.api.deleteMyAccount(C.session.user.id, passIn ? passIn.value : "");
            if (error){ ev.currentTarget.disabled = false; toast(HZ.authMsg(error) || HZ.dbError(error)); return; }
            try { localStorage.removeItem(draftsKey()); localStorage.removeItem(ownKey()); localStorage.removeItem("hz-email"); } catch(e){}
            C.confirmDelete = false; toast("Konto i dane zostały usunięte."); }, text:"Usuń konto na stałe" }),
          el("button", { onclick(){ C.confirmDelete = false; render(); }, text:"Anuluj" })))
      : el("button", { class:"ghost danger", style:"align-self:flex-start", onclick(){ C.confirmDelete = true; render(); }, text:"Usuń konto i wszystkie dane" }));
}

/* ---------- account without profile (e.g. registration interrupted) ---------- */
function joinCard(){
  const nameIn = el("input", { id:"jn-name", maxlength:"60", placeholder:"np. Kasia" });
  const codeIn = el("input", { id:"jn-code", autocomplete:"off", placeholder:"kod od trenera", style:"text-transform:uppercase", value:HZ.inviteCode });
  return el("div", { class:"card auth" }, el("h2", { text:"Dokończ zakładanie konta" }),
    el("p", { class:"small muted", text:`Zalogowano jako ${C.session.user.email}. Podaj imię i kod klubu od trenera.` }),
    el("label", { class:"f" }, "Imię", nameIn), el("label", { class:"f" }, "Kod klubu", codeIn),
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, el("input", { id:"jn-age", type:"checkbox", style:"width:auto;margin-top:3px" }),
      el("span", {}, "Mam ukończone 16 lat i zapoznałem/-am się z ", HZ.policyLink("polityką prywatności"), ". (wymagane)")),
    el("button", { class:"primary", async onclick(ev){ const name = nameIn.value.trim().slice(0,60), code = codeIn.value.trim().toUpperCase();
      if (!name || !code){ toast("Wpisz imię i kod klubu."); return; }
      if (!document.getElementById("jn-age").checked){ toast("Zaznacz zgodę (16+ i polityka prywatności)."); return; }
      ev.currentTarget.disabled = true;
      const { error } = await HZ.api.createProfile(C.session.user.id, { name, email:C.session.user.email, joinCode:code, consent:HZ.makeConsent(null, { age16:true }) });
      if (error){ toast(error.code === "permission-denied" ? "Nieprawidłowy kod klubu." : HZ.dbError(error)); render(); return; }
      C.loaded = false; render(); loadAll(); }, text:"Gotowe" }),
    logoutButton("ghost"));
}

/* trainer edits the plan live: number of sets follows the new plan (empty sets only, typed ones stay) */
function reshape(d, st, sets, ex){
  d.shape = d.shape || {}; const key = `${HZ.secOf(st) === "main" ? (st.warmup || 0) : 0}|${st.sets || 3}`;
  if (!d.shape[st.id]){ d.shape[st.id] = key; return; } if (d.shape[st.id] === key) return;
  const [wn, sn] = key.split("|").map(Number);
  let work = sets.filter(x => !x.warmup);
  while (work.length > Math.max(1, sn) && work[work.length - 1].reps == null){ sets.splice(sets.lastIndexOf(work[work.length - 1]), 1); work = sets.filter(x => !x.warmup); }
  while (work.length < sn){ const last = work[work.length - 1]; sets.push({ load: last ? last.load : null, reps:null, rir:null }); work = sets.filter(x => !x.warmup); }
  let warm = sets.filter(x => x.warmup);
  while (warm.length > wn && warm[warm.length - 1].reps == null){ sets.splice(sets.indexOf(warm[warm.length - 1]), 1); warm = sets.filter(x => x.warmup); }
  if (warm.length < wn){ const add = wn - warm.length; for (let i = 0; i < add; i++) sets.splice(warm.length, 0, { load:null, reps:null, rir:null, warmup:true }); HZ.refreshWarmups(ex, sets); }
  d.shape[st.id] = key; saveDrafts();
}
let liveTimer = null, liveKey = "";
function livePoll(){
  if (liveTimer) return;
  liveTimer = setInterval(async () => { if (document.visibilityState !== "visible" || C.tab !== "today" || !C.session) return;
    const before = JSON.stringify(S.workouts); await HZ.loadWorkouts().catch(() => {}); const after = JSON.stringify(S.workouts);
    if (before !== after){ const w = S.workouts.find(x => x.id === currentId()); if (w && !isLocked(w)) toast("Trener zaktualizował trening"); render(); } }, 30000);
}
function groupChooser(same){
  return [el("div", { class:"card" }, el("h2", { text:"Na który trening przyszedłeś/-aś?" }),
    el("p", { class:"small muted", text:`${HZ.fmtDate(same[0].date, true)} – wybierz swoje zajęcia.` }),
    el("div", { class:"stack", style:"gap:8px" }, same.map(x => el("button", { class:"primary", onclick(){ C.sel = x.id; render(); }, text: (HZ.groupName(x.group) || "Trening") + (x.title ? " · " + x.title : "") }))))];
}

/* ---------- training not started by the trainer yet (or already finished) ---------- */
let lockPoll = null;
function lockedView(ws, w, saved){
  clearInterval(lockPoll);
  if (!w.closedAt) lockPoll = setInterval(async () => { if (document.visibilityState !== "visible" || C.tab !== "today") return;
    await HZ.loadWorkouts().catch(() => {}); const nw = S.workouts.find(x => x.id === w.id); if (nw && nw.open){ clearInterval(lockPoll); toast("Trening się zaczął – wpisuj serie!"); render(); } }, 15000);
  const pick = el("select", { id:"wsel", "aria-label":"Wybierz trening", onchange(e){ C.sel = e.target.value; render(); } },
    [...ws].reverse().map(x => el("option", { value:x.id, text:`${HZ.workoutLabel(x)}` })));
  pick.value = w.id;
  const names = HZ.orderStations(w.stations || []).filter(st => HZ.secOf(st) === "main" || HZ.feat("acc", C.profile)).map(st => (HZ.exById(st.exId) || {}).name).filter(Boolean);
  return [el("div", { class:"row between" }, el("h2", { text: w.title || `Trening #${HZ.workoutNo(w.id)}` }), el("div", { style:"max-width:240px;flex:1 1 170px" }, pick)),
    el("div", { class:"card locked" }, el("h3", { text: w.closedAt ? "Trening zakończony" : "Trening jeszcze się nie zaczął" }),
      el("p", { class:"small muted", text: w.closedAt ? "Trener zamknął wpisywanie wyników z tego treningu." : "Trener otworzy wpisywanie na zajęciach. Strona sama to wykryje, możesz też odświeżyć." }),
      names.length ? el("p", { class:"small", text:"W planie: " + names.join(", ") }) : null,
      w.closedAt ? null : el("button", { async onclick(ev){ ev.currentTarget.disabled = true; await HZ.loadWorkouts().catch(() => {}); render(); }, text:"Odśwież" })),
    saved ? el("div", { class:"card" }, el("h3", { text:"Twoje wyniki" }), el("div", { class:"list" }, (saved.entries || []).map(e => el("div", { class:"stack", style:"gap:2px" },
      el("b", { text:e.exName }), el("span", { class:"num", text:HZ.setsText(e, rirOn()) }))))) : null];
}
/* "did something hurt?" (beta, trainer switches it on) */
function painBox(d){
  return el("div", { class:"stack", style:"gap:8px" },
    el("div", { class:"row between" }, el("span", { style:"font-weight:600", text:"Czy coś bolało?" }), el("span", { class:"chip", text:"beta" })),
    el("div", { class:"modes", role:"group", "aria-label":"Czy coś bolało" },
      el("button", { type:"button", "aria-pressed":String(!d.painOn), onclick(){ d.painOn = false; saveDrafts(); render(); }, text:"Nie" }),
      el("button", { type:"button", "aria-pressed":String(!!d.painOn), onclick(){ d.painOn = true; saveDrafts(); render(); }, text:"Tak" })),
    d.painOn ? el("div", { class:"pain stack", style:"gap:8px" },
      el("label", { class:"f" }, "Co i kiedy bolało? (np. kolano przy przysiadzie)", el("textarea", { id:"pain-txt", maxlength:"200", value:d.pain || "", oninput(e){ d.pain = e.target.value; saveDrafts(); } })),
      el("p", { class:"small", style:"margin:0" }, el("b", { text:"Rekomendacja: " }), "zmniejsz ciężar w tym ćwiczeniu albo zapytaj trenera o zalecenie. Jeśli ból jest ostry lub nie mija – przerwij ćwiczenie i powiedz trenerowi."),
      el("p", { class:"small muted", style:"margin:0", text:"Tę informację widzi tylko trener. To dane o zdrowiu – zapisujemy je tylko wtedy, gdy sam/-a je wpiszesz." })) : null);
}

/* ---------- guest ---------- */
function guestForm(){
  const nameIn = el("input", { id:"gs-name", autocomplete:"given-name", maxlength:"60", placeholder:"np. Kasia" });
  const codeIn = el("input", { id:"gs-code", autocomplete:"off", placeholder:"kod od trenera", style:"text-transform:uppercase", value:HZ.inviteCode });
  const age = el("input", { id:"gs-age", type:"checkbox", style:"width:auto;margin-top:3px" });
  const rank = el("input", { id:"gs-rank", type:"checkbox", style:"width:auto;margin-top:3px" });
  const msg = el("p", { class:"small", role:"alert", style:"color:var(--bad)" });
  const btn = el("button", { type:"submit", class:"primary", text:"Wchodzę" });
  const form = el("form", { class:"card", novalidate:true },
    el("div", { class:"stack", style:"gap:4px" }, el("h2", { text:"Witaj na treningu!" }),
      el("p", { class:"small muted", text:"Wpisz imię i zapisuj swoje serie. Bez e-maila i hasła. Po kilku treningach możesz założyć konto, a wszystkie wyniki zostaną." })),
    el("label", { class:"f" }, "Imię", nameIn),
    HZ.inviteCode ? el("p", { class:"small muted", text:"✓ Kod klubu z zaproszenia" }) : el("label", { class:"f" }, "Kod klubu", codeIn),
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, age,
      el("span", {}, "Mam ukończone 16 lat i zapoznałem/-am się z ", HZ.policyLink("polityką prywatności"), ". (wymagane)")),
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, rank,
      el("span", { text:"Chcę być widoczny/-a w rankingu grupy. (dobrowolne)" })),
    el("p", { class:"small muted", text:"Wyniki gościa są przypisane do tego telefonu i przeglądarki. Nie czyść danych przeglądarki, zanim założysz konto." }),
    msg, btn,
    el("div", { class:"row between small" },
      el("button", { type:"button", class:"link", onclick(){ C.authMode = "login"; render(); }, text:"Mam konto – zaloguj" }),
      el("button", { type:"button", class:"link", onclick(){ C.authMode = "register"; render(); }, text:"Załóż pełne konto" })));
  form.addEventListener("submit", async ev => { ev.preventDefault(); msg.textContent = "";
    const name = nameIn.value.trim().slice(0, 60), code = (codeIn.value || HZ.inviteCode).trim().toUpperCase();
    if (!name){ msg.textContent = "Wpisz imię."; return; }
    if (!code){ msg.textContent = "Wpisz kod klubu od trenera."; return; }
    if (!age.checked){ msg.textContent = "Zaznacz, że masz ukończone 16 lat i znasz politykę prywatności."; return; }
    btn.disabled = true;
    try { await HZ.api.startGuest({ name, joinCode:code, ranking:rank.checked }); }
    catch(e){ msg.textContent = HZ.authMsg(e); btn.disabled = false; } });
  return form;
}
function guestBanner(){
  const n = C.logs.length, lim = S.config.guestLimit;
  const text = n === 0 ? "Jesteś tu jako gość. Wpisuj serie normalnie, trener je widzi."
    : `Masz ${n} ${HZ.plural(n, "trening", "treningi", "treningów")} zapisane jako gość. Załóż konto, żeby ich nie stracić i logować się na każdym telefonie.`;
  return el("div", { class: n >= 2 ? "notice" : "card guest-cta" }, el("span", { class:"small", text: text + (lim ? ` Limit dla gości: ${lim}.` : "") }),
    n ? el("button", { class: n >= 2 ? "primary" : "", onclick(){ C.tab = "account"; render(); window.scrollTo(0, 0); }, text:"Załóż konto" }) : null);
}
function convertCard(){
  const emailIn = el("input", { id:"cv-email", type:"email", autocomplete:"email" });
  const passIn = el("input", { id:"cv-pass", type:"password", autocomplete:"new-password", minlength:String(HZ.MIN_PASSWORD) });
  const msg = el("p", { class:"small", role:"alert", style:"color:var(--bad)" });
  const btn = el("button", { class:"primary", text:"Załóż konto i zachowaj wyniki" });
  btn.addEventListener("click", async () => { msg.textContent = "";
    const email = emailIn.value.trim().toLowerCase(), pass = passIn.value;
    if (!/^\S+@\S+\.\S+$/.test(email)){ msg.textContent = "Wpisz poprawny adres e-mail."; return; }
    const pp = HZ.passwordProblem(pass, email); if (pp){ msg.textContent = pp; return; }
    btn.disabled = true;
    const { error } = await HZ.api.convertGuest(C.session.user.id, email, pass);
    btn.disabled = false;
    if (error){ msg.textContent = error.code === "auth/email-already-in-use" ? "Ten e-mail ma już konto. Użyj innego adresu albo poproś trenera o pomoc." : (HZ.authMsg(error) || HZ.dbError(error)); return; }
    C.session.user.email = email; C.session.user.guest = false; C.profile.email = email; C.profile.guest = false;
    HZ.LS.set("hz-email", email); toast("Gotowe! Masz konto, wszystkie wyniki zostały."); render(); });
  return el("div", { class:"card", style:"border-color:var(--accent)" }, el("h2", { text:"Załóż konto" }),
    el("p", { class:"small", text:`Twoje ${C.logs.length} ${HZ.plural(C.logs.length, "trening", "treningi", "treningów")} i rekordy zostaną. Potem zalogujesz się e-mailem na dowolnym telefonie.` }),
    el("label", { class:"f" }, "E-mail", emailIn), el("label", { class:"f" }, `Hasło (min. ${HZ.MIN_PASSWORD} znaków, litera i cyfra)`, passIn), msg, btn);
}
/* guests lose access after signing out, so ask first */
function logoutButton(cls){
  if (C.profile && C.profile.guest && C.confirmOut) return el("div", { class:"stack", style:"gap:6px" },
    el("p", { class:"small", style:"color:var(--bad)", text:"Jako gość po wylogowaniu nie wrócisz do swoich wyników. Najpierw załóż konto." }),
    el("div", { class:"row" }, el("button", { class:"danger", onclick(){ HZ.api.signOut(); }, text:"Wyloguj mimo to" }), el("button", { onclick(){ C.confirmOut = false; render(); }, text:"Anuluj" })));
  return el("button", { class:cls || null, onclick(){ if (C.profile && C.profile.guest){ C.confirmOut = true; render(); return; } HZ.api.signOut(); }, text:"Wyloguj się" });
}

/* ---------- boot ---------- */
if (!HZ.ready){ render(); return; }
render();
HZ.api.onAuth(session => {
  const was = C.session && C.session.user.id;
  C.session = session;
  if (!session){ C.loaded = false; C.profile = null; C.logs = []; C.confirmOut = false; C.authMode = ["register", "guest"].includes(C.authMode) ? C.authMode : "login"; render(); return; }
  if (was !== session.user.id){ C.loaded = false; render(); setTimeout(loadAll, 0); }
});
})();
