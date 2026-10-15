/* Hubzone Weightlifting e-Dziennik — panel klienta */
(function(){
"use strict";
const { el, S, toast } = HZ;
const app = document.getElementById("app");
const C = { session:null, profile:null, logs:[], loaded:false, tab:"today", authMode:"login", sel:null, drafts:{}, own:null, error:null };

function render(){ const y = window.scrollY; app.replaceChildren(...view()); window.scrollTo(0, y); }
const draftsKey = () => "hz-drafts-" + (C.session ? C.session.user.id : "x");
const ownKey = () => "hz-own-" + (C.session ? C.session.user.id : "x");
const saveDrafts = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => HZ.LS.set(draftsKey(), C.drafts), 400); }; })();

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
      const mr = await HZ.api.myRanking(uid);
      if (mr.data){ C.rankHidden = mr.data.hidden === true; const { updatedAt, ...rest } = mr.data; C.rankKey = JSON.stringify(rest); }
      setTimeout(syncRanking, 0);
    }
    C.error = null;
  } catch(e){ console.error(e); C.error = "Nie udało się wczytać danych. Sprawdź połączenie i odśwież stronę."; }
  C.drafts = HZ.LS.get(draftsKey()) || {}; C.own = HZ.LS.get(ownKey());
  C.loaded = true; render();
}

function view(){
  if (!HZ.ready) return [header(), ...HZ.setupNeeded()];
  if (!C.session) return [header(), el("div", { class:"auth" }, HZ.authView({ mode:C.authMode, allowRegister:true, onMode: m => { C.authMode = m; render(); },
    sub: C.authMode === "register" ? "Kod klubu dostaniesz od trenera na zajęciach." : C.authMode === "login" ? "Twój dziennik treningowy: serie, postępy i podpowiedzi, ile dołożyć." : null }))];
  if (!C.loaded) return [header(), el("div", { class:"empty", text:"Wczytuję Twój dziennik…" })];
  if (C.error) return [header(), el("div", { class:"empty" }, el("p", { text:C.error }), el("button", { onclick(){ C.loaded = false; render(); loadAll(); }, text:"Spróbuj ponownie" }))];
  if (!C.profile) return [header(), joinCard()];
  return [header(), HZ.tabBar([["today","Dzisiejszy trening"],["progress","Postępy"], S.config.rankingEnabled ? ["ranking","Ranking"] : null, S.config.ownEnabled ? ["own","Trening własny"] : null, ["account","Konto"]].filter(Boolean), C.tab, k => { C.tab = k; render(); }), ...body()];
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
        n ? el("span", { class:"small muted", text:`Masz już ${n} ${HZ.plural(n, "zapisany trening", "zapisane treningi", "zapisanych treningów")}` }) : null)));
  return out;
}
/* ---------- ranking ---------- */
async function syncRanking(){
  if (!S.config.rankingEnabled || !C.profile || !C.session) return;
  const row = { name:C.profile.name || "", ...HZ.computeStats(C.logs), hidden: !!C.rankHidden };
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
  return HZ.rankingView(C.rankRows, C.session.user.id, render);
}
function body(){
  if (C.tab === "ranking" && S.config.rankingEnabled) return rankingTab();
  if (C.tab === "progress") return HZ.progressView(C.logs, "Twoje postępy", "me", render);
  if (C.tab === "own" && S.config.ownEnabled) return ownView();
  if (C.tab === "account") return accountView();
  return todayView();
}
function currentId(){ const ws = HZ.sortedWorkouts(); if (C.sel && ws.some(w => w.id === C.sel)) return C.sel; return HZ.defaultWorkoutId(); }

/* ---------- today ---------- */
function draftFor(w){
  if (C.drafts[w.id]) return C.drafts[w.id];
  const existing = C.logs.find(l => l.workout_id === w.id);
  const d = { fatigue: existing ? existing.fatigue ?? null : null, note: existing ? existing.note || "" : "", st:{}, mode:{} };
  for (const st of (w.stations || [])){
    const ex = HZ.exById(st.exId); if (!ex) continue;
    const prev = existing && (existing.entries || []).find(e => e.stationId === st.id);
    d.mode[st.id] = prev ? (prev.type || ex.type) : ex.type;
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
  const d = draftFor(w); const saved = C.logs.find(l => l.workout_id === w.id);
  const pick = el("select", { id:"wsel", "aria-label":"Wybierz trening", onchange(e){ C.sel = e.target.value; render(); } },
    [...ws].reverse().map(x => el("option", { value:x.id, text:`#${HZ.workoutNo(x.id)} · ${HZ.fmtDate(x.date)}${x.title ? " · " + x.title : ""}` })));
  pick.value = w.id;
  const out = [el("div", { class:"row between" },
    el("div", { class:"stack", style:"gap:2px" }, el("h2", { text: w.title || `Trening #${HZ.workoutNo(w.id)}` }),
      el("span", { class:"small muted", text:`${(() => { const st = w.stations || [], m = st.filter(x => HZ.secOf(x) === "main").length, a = st.length - m;
        return [m ? `${m} ${HZ.plural(m, "bój", "boje", "bojów")}` : null, a ? `${a} ${HZ.plural(a, "stacja", "stacje", "stacji")}` : null].filter(Boolean).join(" · "); })()}${saved ? " · wysłano " + new Date(saved.saved_at).toLocaleTimeString("pl-PL", { hour:"2-digit", minute:"2-digit" }) : ""}` })),
    el("div", { style:"max-width:240px;flex:1 1 170px" }, pick))];
  if (w.note) out.push(el("p", { class:"muted", text:w.note }));
  const labels = HZ.stationLabels(HZ.orderStations(w.stations || []));
  for (const sec of HZ.SECTIONS){
    const items = (w.stations || []).filter(st => HZ.secOf(st) === sec.key && HZ.exById(st.exId));
    if (!items.length) continue;
    out.push(el("div", { class:"sechead" }, el("h2", { text:sec.title }), el("span", { class:"eyebrow", text:sec.sub })));
    items.forEach(st => out.push(stationCard(w, st, HZ.exById(st.exId), labels[st.id], d)));
  }
  out.push(el("div", { class:"card" },
    el("div", { class:"stack", style:"gap:2px" }, el("h3", { text:"Zmęczenie po treningu" }), el("span", { class:"small muted", text:"1 = lekko, 10 = nie dam rady nic więcej" })),
    HZ.fatiguePicker(d.fatigue, v => { d.fatigue = v; saveDrafts(); render(); }),
    el("label", { class:"f" }, "Notatka dla trenera (opcjonalnie)", el("textarea", { id:"note-" + w.id, maxlength:"1000", value:d.note, oninput(e){ d.note = e.target.value; saveDrafts(); } })),
    el("button", { class:"primary", onclick(e){ saveWorkout(w, d, e.currentTarget); }, text: saved ? "Zapisz zmiany" : "Wyślij wyniki do trenera" })));
  return out;
}
function freshSets(w, st, ex, mode){
  const mx = { ...ex, type:mode };
  const sg = HZ.suggest(C.logs, ex.id, mode, ex, w.id);
  return HZ.buildSets(mx, HZ.secOf(st) === "main" ? (st.warmup || 0) : 0, st.sets || 3, sg.next ?? null);
}
function stationCard(w, st, exBase, label, d){
  d.mode = d.mode || {};
  const mode = d.mode[st.id] || exBase.type; const ex = { ...exBase, type:mode };
  const sets = d.st[st.id] || (d.st[st.id] = freshSets(w, st, exBase, mode));
  const sg = HZ.suggest(C.logs, ex.id, mode, exBase, w.id);
  const curLoad = (sets.find(s => !s.warmup) || {}).load;
  const isMain = HZ.secOf(st) === "main";
  if (!isMain && sets.some(x => x.warmup)){ const keep = sets.filter(x => !x.warmup); sets.length = 0; sets.push(...keep); }
  const extra = [isMain && st.warmup ? `+ ${st.warmup} ${HZ.plural(st.warmup, "seria wstępna", "serie wstępne", "serii wstępnych")}` : null, st.work ? `praca ${st.work}` : null, st.rest ? `przerwa ${st.rest}` : null, st.note].filter(Boolean);
  return el("section", { class:"card station" + (HZ.secOf(st) === "main" ? " main" : "") },
    el("div", { class:"row between", style:"align-items:flex-start" },
      el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:label }), el("h3", { text:ex.name })),
      el("span", { class:"badge", text:`${st.sets || "?"} × ${st.reps || "?"}` })),
    extra.length ? el("div", { class:"small muted", text: extra.join(" · ") }) : null,
    HZ.modeToggle(mode, m => { d.mode[st.id] = m; d.st[st.id] = freshSets(w, st, exBase, m); saveDrafts(); render(); }),
    HZ.tipBox(sg, load => { HZ.applyLoad(ex, sets, load); saveDrafts(); render(); }, curLoad),
    HZ.setsEditor(ex, sets, `w${w.id}-${st.id}`, structural => { saveDrafts(); if (structural) render(); }, { repsHint:sg.reps, noWarmup:!isMain }));
}
function cleanSets(sets){ return sets.filter(s => s.reps != null).map(s => ({ load: s.load === "" ? null : s.load ?? null, reps:s.reps, rir: s.warmup ? null : (s.rir ?? null), ...(s.warmup ? { warmup:true } : {}) })); }
async function saveWorkout(w, d, btn){
  const entries = [];
  for (const st of (w.stations || [])){ const ex = HZ.exById(st.exId); if (!ex) continue;
    const sets = cleanSets(d.st[st.id] || []);
    if (sets.length) entries.push({ stationId:st.id, exId:ex.id, exName:ex.name, type:(d.mode && d.mode[st.id]) || ex.type, targetSets:st.sets || sets.filter(x => !x.warmup).length, targetReps:st.reps || 0, sets }); }
  if (!entries.length){ toast("Wpisz powtórzenia przynajmniej w jednej serii."); return; }
  btn.disabled = true;
  const row = { user_id:C.session.user.id, workout_id:w.id, date:w.date, title:w.title || "", own:false, fatigue:d.fatigue ?? null, note:(d.note || "").trim().slice(0,1000), entries, saved_at:new Date().toISOString() };
  const { data, error } = await HZ.api.saveWorkoutLog(row);
  btn.disabled = false;
  if (error){ toast(HZ.dbError(error)); return; }
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
    el("button", { onclick(){ const id = addSel.value; if (!id) return; const ex = HZ.exById(id); const sg = HZ.suggest(C.logs, id, ex.type, ex);
      const last = HZ.history(C.logs, id, null, ex.type)[0]; const tr = last ? last.entry.targetReps : 8; const ts = last ? last.entry.targetSets : 3;
      o.items.push({ key:HZ.uuid().slice(0,8), exId:id, mode:ex.type, targetReps:tr, targetSets:ts, sets:HZ.buildSets(ex, 0, ts, sg.next ?? null) });
      persist(true); }, text:"+ Dodaj do treningu" }))];
  o.items.forEach((it, idx) => { const exBase = HZ.exById(it.exId); if (!exBase) return; const mode = it.mode || exBase.type; const ex = { ...exBase, type:mode };
    const sg = HZ.suggest(C.logs, ex.id, mode, exBase); const curLoad = (it.sets.find(s => !s.warmup) || {}).load;
    out.push(el("section", { class:"card station" },
      el("div", { class:"row between" }, el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:"Ćwiczenie" }), el("h3", { text:ex.name })),
        el("button", { class:"ghost", onclick(){ o.items.splice(idx, 1); persist(true); }, text:"Usuń" })),
      el("div", { class:"grid2" },
        el("label", { class:"f" }, "Plan: serie", el("input", { id:`own-ts-${it.key}`, inputmode:"numeric", value:String(it.targetSets), onchange(e){ it.targetSets = Math.max(1, Math.round(HZ.parseNum(e.target.value) || 1)); persist(); } })),
        el("label", { class:"f" }, "Plan: powtórzenia", el("input", { id:`own-tr-${it.key}`, inputmode:"numeric", value:String(it.targetReps), onchange(e){ it.targetReps = Math.max(1, Math.round(HZ.parseNum(e.target.value) || 1)); persist(); } }))),
      HZ.modeToggle(mode, m => { it.mode = m; const nsg = HZ.suggest(C.logs, ex.id, m, exBase); it.sets = HZ.buildSets({ ...exBase, type:m }, it.sets.filter(s => s.warmup).length, Math.max(1, it.sets.filter(s => !s.warmup).length), nsg.next ?? null); persist(true); }),
      HZ.tipBox(sg, load => { HZ.applyLoad(ex, it.sets, load); persist(true); }, curLoad),
      HZ.setsEditor(ex, it.sets, `own-${it.key}`, re => persist(re), { repsHint:sg.reps }))); });
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

/* ---------- account ---------- */
function accountView(){
  const nameIn = el("input", { id:"acc-name", maxlength:"60", value:(C.profile && C.profile.name) || "" });
  return [el("div", { class:"card" }, el("h2", { text:"Twoje konto" }),
      el("p", { class:"small muted", text:C.session.user.email }),
      S.config.rankingEnabled ? el("label", { class:"row", style:"flex-wrap:nowrap;cursor:pointer" },
        el("input", { id:"rank-show", type:"checkbox", style:"width:auto", checked: !C.rankHidden || null, onchange(ev){ C.rankHidden = !ev.target.checked; syncRanking(); toast(C.rankHidden ? "Nie pokazujesz się w rankingu" : "Pokazujesz się w rankingu"); } }),
        el("span", { text:"Pokazuj mnie w rankingu grupy" })) : null,
      el("label", { class:"f" }, "Imię widoczne dla trenera", nameIn),
      el("button", { async onclick(){ const n = nameIn.value.trim(); if (!n){ toast("Wpisz imię."); return; }
        const { error } = await HZ.api.updateName(C.session.user.id, n);
        if (error){ toast(HZ.dbError(error)); return; } C.profile.name = n; syncRanking(); toast("Zapisano imię"); render(); }, text:"Zapisz imię" })),
    el("div", { class:"card" }, el("h3", { text:"Zmień hasło" }), el("p", { class:"small muted", text:"Wyślemy na Twój e-mail link do ustawienia nowego hasła." }),
      el("button", { async onclick(ev){ ev.currentTarget.disabled = true; try { await HZ.resetPassword(C.session.user.email); toast("Wysłano link. Sprawdź skrzynkę."); } catch(e){ toast(HZ.authMsg(e)); } }, text:"Wyślij link do zmiany hasła" })),
    el("div", { class:"row" },
      el("button", { async onclick(){ await HZ.api.signOut(); }, text:"Wyloguj się" }),
      C.profile && C.profile.is_admin ? el("a", { href:"admin.html", class:"small", text:"Panel trenera →" }) : null)];
}

/* ---------- account without profile (e.g. registration interrupted) ---------- */
function joinCard(){
  const nameIn = el("input", { id:"jn-name", maxlength:"60", placeholder:"np. Kasia" });
  const codeIn = el("input", { id:"jn-code", autocomplete:"off", placeholder:"kod od trenera", style:"text-transform:uppercase" });
  return el("div", { class:"card auth" }, el("h2", { text:"Dokończ zakładanie konta" }),
    el("p", { class:"small muted", text:`Zalogowano jako ${C.session.user.email}. Podaj imię i kod klubu od trenera.` }),
    el("label", { class:"f" }, "Imię", nameIn), el("label", { class:"f" }, "Kod klubu", codeIn),
    el("button", { class:"primary", async onclick(ev){ const name = nameIn.value.trim().slice(0,60), code = codeIn.value.trim().toUpperCase();
      if (!name || !code){ toast("Wpisz imię i kod klubu."); return; }
      ev.currentTarget.disabled = true;
      const { error } = await HZ.api.createProfile(C.session.user.id, { name, email:C.session.user.email, joinCode:code });
      if (error){ toast(error.code === "permission-denied" ? "Nieprawidłowy kod klubu." : HZ.dbError(error)); render(); return; }
      C.loaded = false; render(); loadAll(); }, text:"Gotowe" }),
    el("button", { class:"ghost", onclick(){ HZ.api.signOut(); }, text:"Wyloguj się" }));
}

/* ---------- boot ---------- */
if (!HZ.ready){ render(); return; }
render();
HZ.api.onAuth(session => {
  const was = C.session && C.session.user.id;
  C.session = session;
  if (!session){ C.loaded = false; C.profile = null; C.logs = []; C.authMode = C.authMode === "register" ? "register" : "login"; render(); return; }
  if (was !== session.user.id){ C.loaded = false; render(); setTimeout(loadAll, 0); }
});
})();
