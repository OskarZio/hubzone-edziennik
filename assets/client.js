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
    const [pr, lg] = await Promise.all([
      HZ.sb.from("profiles").select("*").eq("id", uid).single(),
      HZ.sb.from("logs").select("*").eq("user_id", uid).order("date"),
      HZ.loadConfig(), HZ.loadWorkouts()
    ]);
    if (pr.error) throw pr.error; if (lg.error) throw lg.error;
    C.profile = pr.data; C.logs = lg.data; C.error = null;
  } catch(e){ console.error(e); C.error = "Nie udało się wczytać danych. Sprawdź połączenie i odśwież stronę."; }
  C.drafts = HZ.LS.get(draftsKey()) || {}; C.own = HZ.LS.get(ownKey());
  C.loaded = true; render();
}

function view(){
  if (!HZ.sb) return [header(), ...HZ.setupNeeded()];
  if (C.authMode === "recovery") return [header(), el("div", { class:"auth" }, HZ.authView({ mode:"recovery", onMode: m => { C.authMode = "login"; if (C.session){ C.loaded = false; render(); loadAll(); } else render(); } }))];
  if (!C.session) return [header(), el("div", { class:"auth" }, HZ.authView({ mode:C.authMode, allowRegister:true, onMode: m => { C.authMode = m; render(); },
    sub: C.authMode === "register" ? "Kod klubu dostaniesz od trenera na zajęciach." : C.authMode === "login" ? "Twój dziennik treningowy: serie, postępy i podpowiedzi, ile dołożyć." : null }))];
  if (!C.loaded) return [header(), el("div", { class:"empty", text:"Wczytuję Twój dziennik…" })];
  if (C.error) return [header(), el("div", { class:"empty" }, el("p", { text:C.error }), el("button", { onclick(){ C.loaded = false; render(); loadAll(); }, text:"Spróbuj ponownie" }))];
  return [header(), HZ.tabBar([["today","Dzisiejszy trening"],["progress","Postępy"],["own","Trening własny"],["account","Konto"]], C.tab, k => { C.tab = k; render(); }), ...body()];
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
function body(){
  if (C.tab === "progress") return HZ.progressView(C.logs, "Twoje postępy", "me", render);
  if (C.tab === "own") return ownView();
  if (C.tab === "account") return accountView();
  return todayView();
}
function currentId(){ const ws = HZ.sortedWorkouts(); if (C.sel && ws.some(w => w.id === C.sel)) return C.sel; return HZ.defaultWorkoutId(); }

/* ---------- today ---------- */
function draftFor(w){
  if (C.drafts[w.id]) return C.drafts[w.id];
  const existing = C.logs.find(l => l.workout_id === w.id);
  const d = { fatigue: existing ? existing.fatigue ?? null : null, note: existing ? existing.note || "" : "", st:{} };
  for (const st of (w.stations || [])){
    const ex = HZ.exById(st.exId); if (!ex) continue;
    const prev = existing && (existing.entries || []).find(e => e.stationId === st.id);
    if (prev) d.st[st.id] = prev.sets.map(s => ({ load:s.load ?? null, reps:s.reps ?? null, rir:s.rir ?? null }));
    else { const sg = HZ.suggest(C.logs, ex.id, ex.type, ex.inc, w.id); const ld = sg.next ?? null;
      d.st[st.id] = Array.from({ length: st.sets || 3 }, () => ({ load: ex.type === "band" ? (ld || "") : ld, reps:null, rir:null })); }
  }
  C.drafts[w.id] = d; return d;
}
function todayView(){
  const ws = HZ.sortedWorkouts(); const wid = currentId(); const w = ws.find(x => x.id === wid);
  if (!w) return [el("div", { class:"empty" }, el("h3", { text:"Trener nie dodał jeszcze treningu" }),
    el("p", { class:"small", text:"Gdy pojawi się piątkowy plan, zobaczysz tu stacje i miejsce na swoje serie. W międzyczasie możesz zapisać trening własny." }),
    el("button", { onclick(){ C.tab = "own"; render(); }, text:"Zapisz trening własny" }))];
  const d = draftFor(w); const saved = C.logs.find(l => l.workout_id === w.id);
  const pick = el("select", { id:"wsel", "aria-label":"Wybierz trening", onchange(e){ C.sel = e.target.value; render(); } },
    [...ws].reverse().map(x => el("option", { value:x.id, text:`#${HZ.workoutNo(x.id)} · ${HZ.fmtDate(x.date)}${x.title ? " · " + x.title : ""}` })));
  pick.value = w.id;
  const out = [el("div", { class:"row between" },
    el("div", { class:"stack", style:"gap:2px" }, el("h2", { text: w.title || `Trening #${HZ.workoutNo(w.id)}` }),
      el("span", { class:"small muted", text:`${(w.stations || []).length} ${HZ.plural((w.stations||[]).length, "stacja", "stacje", "stacji")}${saved ? " · wysłano " + new Date(saved.saved_at).toLocaleTimeString("pl-PL", { hour:"2-digit", minute:"2-digit" }) : ""}` })),
    el("div", { style:"max-width:240px;flex:1 1 170px" }, pick))];
  if (w.note) out.push(el("p", { class:"muted", text:w.note }));
  (w.stations || []).forEach((st, i) => { const ex = HZ.exById(st.exId); if (ex) out.push(stationCard(w, st, ex, i, d)); });
  out.push(el("div", { class:"card" },
    el("div", { class:"stack", style:"gap:2px" }, el("h3", { text:"Zmęczenie po treningu" }), el("span", { class:"small muted", text:"1 = lekko, 10 = nie dam rady nic więcej" })),
    HZ.fatiguePicker(d.fatigue, v => { d.fatigue = v; saveDrafts(); render(); }),
    el("label", { class:"f" }, "Notatka dla trenera (opcjonalnie)", el("textarea", { id:"note-" + w.id, maxlength:"1000", value:d.note, oninput(e){ d.note = e.target.value; saveDrafts(); } })),
    el("button", { class:"primary", onclick(e){ saveWorkout(w, d, e.currentTarget); }, text: saved ? "Zapisz zmiany" : "Wyślij wyniki do trenera" })));
  return out;
}
function stationCard(w, st, ex, i, d){
  const sets = d.st[st.id] || (d.st[st.id] = Array.from({ length: st.sets || 3 }, () => ({ load:null, reps:null, rir:null })));
  const sg = HZ.suggest(C.logs, ex.id, ex.type, ex.inc, w.id);
  const extra = [st.work ? `praca ${st.work}` : null, st.rest ? `przerwa ${st.rest}` : null, st.note].filter(Boolean);
  return el("section", { class:"card station" },
    el("div", { class:"row between", style:"align-items:flex-start" },
      el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:`Stacja ${i+1} · ${HZ.TYPE_LABEL[ex.type]}` }), el("h3", { text:ex.name })),
      el("span", { class:"badge", text:`${st.sets || "?"} × ${st.reps || "?"}` })),
    extra.length ? el("div", { class:"small muted", text: extra.join(" · ") }) : null,
    HZ.tipBox(sg),
    HZ.setsEditor(ex, sets, `w${w.id}-${st.id}`, structural => { saveDrafts(); if (structural) render(); }));
}
function cleanSets(sets){ return sets.filter(s => s.reps != null).map(s => ({ load: s.load === "" ? null : s.load ?? null, reps:s.reps, rir:s.rir ?? null })); }
async function saveWorkout(w, d, btn){
  const entries = [];
  for (const st of (w.stations || [])){ const ex = HZ.exById(st.exId); if (!ex) continue;
    const sets = cleanSets(d.st[st.id] || []);
    if (sets.length) entries.push({ stationId:st.id, exId:ex.id, exName:ex.name, type:ex.type, targetSets:st.sets || sets.length, targetReps:st.reps || 0, sets }); }
  if (!entries.length){ toast("Wpisz powtórzenia przynajmniej w jednej serii."); return; }
  btn.disabled = true;
  const row = { user_id:C.session.user.id, workout_id:w.id, date:w.date, title:w.title || "", own:false, fatigue:d.fatigue ?? null, note:(d.note || "").trim().slice(0,1000), entries, saved_at:new Date().toISOString() };
  const { data, error } = await HZ.sb.from("logs").upsert(row, { onConflict:"user_id,workout_id" }).select().single();
  btn.disabled = false;
  if (error){ toast(HZ.dbError(error)); return; }
  C.logs = C.logs.filter(l => l.id !== data.id).concat(data);
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
    el("button", { onclick(){ const id = addSel.value; if (!id) return; const ex = HZ.exById(id); const sg = HZ.suggest(C.logs, id, ex.type, ex.inc);
      const last = HZ.history(C.logs, id)[0]; const tr = last ? last.entry.targetReps : 8; const ts = last ? last.entry.targetSets : 3;
      o.items.push({ key:HZ.uuid().slice(0,8), exId:id, targetReps:tr, targetSets:ts, sets:Array.from({ length:ts }, () => ({ load: ex.type === "band" ? (sg.next || "") : (sg.next ?? null), reps:null, rir:null })) });
      persist(true); }, text:"+ Dodaj do treningu" }))];
  o.items.forEach((it, idx) => { const ex = HZ.exById(it.exId); if (!ex) return; const sg = HZ.suggest(C.logs, ex.id, ex.type, ex.inc);
    out.push(el("section", { class:"card station" },
      el("div", { class:"row between" }, el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:HZ.TYPE_LABEL[ex.type] }), el("h3", { text:ex.name })),
        el("button", { class:"ghost", onclick(){ o.items.splice(idx, 1); persist(true); }, text:"Usuń" })),
      el("div", { class:"grid2" },
        el("label", { class:"f" }, "Plan: serie", el("input", { id:`own-ts-${it.key}`, inputmode:"numeric", value:String(it.targetSets), onchange(e){ it.targetSets = Math.max(1, Math.round(HZ.parseNum(e.target.value) || 1)); persist(); } })),
        el("label", { class:"f" }, "Plan: powtórzenia", el("input", { id:`own-tr-${it.key}`, inputmode:"numeric", value:String(it.targetReps), onchange(e){ it.targetReps = Math.max(1, Math.round(HZ.parseNum(e.target.value) || 1)); persist(); } }))),
      HZ.tipBox(sg), HZ.setsEditor(ex, it.sets, `own-${it.key}`, re => persist(re)))); });
  if (o.items.length) out.push(el("div", { class:"card" }, el("h3", { text:"Zmęczenie po treningu" }), HZ.fatiguePicker(o.fatigue, v => { o.fatigue = v; persist(true); }),
    el("button", { class:"primary", async onclick(ev){
      const entries = o.items.map(it => { const ex = HZ.exById(it.exId); const sets = cleanSets(it.sets);
        return ex && sets.length ? { stationId:null, exId:ex.id, exName:ex.name, type:ex.type, targetSets:it.targetSets, targetReps:it.targetReps, sets } : null; }).filter(Boolean);
      if (!entries.length){ toast("Wpisz powtórzenia przynajmniej w jednej serii."); return; }
      const btn = ev.currentTarget; btn.disabled = true;
      const { data, error } = await HZ.sb.from("logs").insert({ user_id:C.session.user.id, workout_id:null, date:o.date || HZ.todayISO(), own:true, title:"Trening własny", fatigue:o.fatigue ?? null, note:"", entries }).select().single();
      btn.disabled = false;
      if (error){ toast(HZ.dbError(error)); return; }
      C.logs.push(data); C.own = null; HZ.LS.set(ownKey(), null); toast("Zapisano trening"); render(); }, text:"Zapisz trening własny" })));
  return out;
}

/* ---------- account ---------- */
function accountView(){
  const nameIn = el("input", { id:"acc-name", maxlength:"60", value:(C.profile && C.profile.name) || "" });
  const passIn = el("input", { id:"acc-pass", type:"password", autocomplete:"new-password", minlength:"6" });
  return [el("div", { class:"card" }, el("h2", { text:"Twoje konto" }),
      el("p", { class:"small muted", text:C.session.user.email }),
      el("label", { class:"f" }, "Imię widoczne dla trenera", nameIn),
      el("button", { async onclick(){ const n = nameIn.value.trim(); if (!n){ toast("Wpisz imię."); return; }
        const { error } = await HZ.sb.from("profiles").update({ name:n }).eq("id", C.session.user.id);
        if (error){ toast(HZ.dbError(error)); return; } C.profile.name = n; toast("Zapisano imię"); render(); }, text:"Zapisz imię" })),
    el("div", { class:"card" }, el("h3", { text:"Zmień hasło" }), el("label", { class:"f" }, "Nowe hasło (min. 6 znaków)", passIn),
      el("button", { async onclick(){ if (passIn.value.length < 6){ toast("Hasło musi mieć co najmniej 6 znaków."); return; }
        const { error } = await HZ.sb.auth.updateUser({ password:passIn.value }); if (error){ toast(HZ.authMsg(error)); return; } passIn.value = ""; toast("Hasło zmienione"); }, text:"Zmień hasło" })),
    el("div", { class:"row" },
      el("button", { async onclick(){ await HZ.sb.auth.signOut(); }, text:"Wyloguj się" }),
      C.profile && C.profile.is_admin ? el("a", { href:"admin.html", class:"small", text:"Panel trenera →" }) : null)];
}

/* ---------- boot ---------- */
if (!HZ.sb){ render(); return; }
render();
HZ.sb.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY"){ C.authMode = "recovery"; C.session = session; render(); return; }
  const was = C.session && C.session.user.id;
  C.session = session;
  if (!session){ C.loaded = false; C.profile = null; C.logs = []; C.authMode = C.authMode === "recovery" ? "recovery" : "login"; render(); return; }
  if (C.authMode === "recovery") { render(); return; }
  if (was !== session.user.id){ C.loaded = false; render(); setTimeout(loadAll, 0); }
});
})();
