/* Hubzone Weightlifting e-Dziennik — panel trenera */
(function(){
"use strict";
const { el, S, toast } = HZ;
const app = document.getElementById("app");
const A = { session:null, profile:null, checked:false, authMode:"login", tab:HZ.LS.get("hz-admin-tab") || "workouts",
  clients:[], stats:{}, editW:null, editC:null, confirmDel:null, res:{ wid:null, rows:null, loading:false }, clientId:null, clientLogs:null, joinCode:undefined, error:null };

function render(){ HZ.swap(app, view()); }

async function loadAll(){
  try {
    const pr = await HZ.api.profile(A.session.user.id);
    if (pr.error && pr.error.code !== "permission-denied") throw pr.error;
    A.profile = pr.data; A.checked = true;
    if (!A.profile || !A.profile.is_admin){ render(); return; }
    await Promise.all([HZ.loadConfig(), HZ.loadWorkouts(), loadClients(), loadSettings()]);
    A.error = null;
  } catch(e){ console.error(e); A.error = "Nie udało się wczytać danych. Sprawdź połączenie i odśwież stronę."; A.checked = true; }
  render();
}
async function loadClients(){
  const [pr, lg] = await Promise.all([HZ.api.users(), HZ.api.allLogs()]);
  if (pr.error) throw pr.error; if (lg.error) throw lg.error;
  A.clients = pr.data.filter(p => !p.is_admin).sort((a,b) => (a.name || "").localeCompare(b.name || "", "pl"));
  A.stats = {};
  for (const l of lg.data){ const s = A.stats[l.user_id] || (A.stats[l.user_id] = { n:0, last:null, fsum:0, fn:0 });
    s.n++; if (!s.last || l.date > s.last) s.last = l.date; if (l.fatigue != null){ s.fsum += l.fatigue; s.fn++; } }
}
async function loadSettings(){ const r = await HZ.api.getClub(); if (r.error) throw r.error; A.joinCode = r.data; }

function view(){
  if (!HZ.ready) return [header(), ...HZ.setupNeeded()];
  if (!A.session) return [header(), el("div", { class:"auth" }, HZ.authView({ mode:A.authMode, allowRegister:false, onMode: m => { A.authMode = m; render(); },
    title: A.authMode === "login" ? "Panel trenera" : null, sub: A.authMode === "login" ? "Dostęp tylko dla kont z rolą trenera." : null }))];
  if (!A.checked) return [header(), el("div", { class:"empty", text:"Sprawdzam uprawnienia…" })];
  if (A.error) return [header(), el("div", { class:"empty" }, el("p", { text:A.error }), el("button", { onclick(){ A.checked = false; render(); loadAll(); }, text:"Spróbuj ponownie" }))];
  if (!A.profile || !A.profile.is_admin) return [header(), el("div", { class:"card auth" }, el("h2", { text:"Brak uprawnień trenera" }),
    el("p", { class:"muted", text:`Konto ${A.session.user.email} nie ma roli trenera. Zaloguj się kontem trenera albo nadaj tę rolę w Firebase (instrukcja w README).` }),
    el("div", { class:"row" }, el("button", { onclick(){ HZ.api.signOut(); }, text:"Wyloguj się" }), el("a", { href:"./", class:"small", text:"Przejdź do panelu klienta" })))];
  const warn = !A.joinCode ? el("div", { class:"notice" }, "Kod klubu nie jest ustawiony, więc konto może założyć każdy, kto zna link. ",
    el("button", { class:"link", onclick(){ A.tab = "settings"; HZ.LS.set("hz-admin-tab", "settings"); render(); }, text:"Ustaw kod" })) : null;
  return [header(), warn, HZ.tabBar([["workouts","Treningi"],["results","Wyniki"],["clients","Klienci"],["ranking","Ranking"],["settings","Ćwiczenia i ustawienia"]], A.tab, k => { A.tab = k; HZ.LS.set("hz-admin-tab", k); render(); }), ...body()];
}
function header(){
  return el("header", { class:"top" }, HZ.brand("e-Dziennik · panel trenera"),
    A.session && A.profile && A.profile.is_admin ? el("div", { class:"row" }, el("a", { href:"./", class:"small", text:"Widok klienta" }), el("button", { class:"ghost", onclick(){ HZ.api.signOut(); }, text:"Wyloguj" })) : null);
}
function body(){
  if (A.entry) return entryView();
  if (!S.config.exercises.length && A.tab !== "settings") return [setupEmpty()];
  if (A.tab === "settings") return settingsView();
  if (A.tab === "results") return resultsView();
  if (A.tab === "clients") return clientsView();
  if (A.tab === "ranking"){
    if (!A.rankRows){ HZ.api.ranking().then(r => { A.rankRows = r.data || []; if (r.error) toast(HZ.dbError(r.error)); render(); }); return [el("div", { class:"empty", text:"Wczytuję ranking…" })]; }
    return [...HZ.rankingView(A.rankRows, null, render, { showHidden:true }),
      el("div", { class:"row" }, el("button", { onclick(){ A.rankRows = null; render(); }, text:"Odśwież" }),
        el("span", { class:"small muted", text: S.config.rankingEnabled ? "Klienci widzą ranking. Osoby ukryte widzisz tylko Ty." : "Ranking jest wyłączony dla klientów (Ćwiczenia i ustawienia)." }))];
  }
  return workoutsView();
}

/* ---------- first run ---------- */
function setupEmpty(){
  return el("div", { class:"empty" }, el("h3", { text:"Zacznij od listy ćwiczeń i gum" }),
    el("p", { class:"small", text:"Dodaj ćwiczenia ze stacji i kolory gum w kolejności od najmocniejszej. Możesz też wczytać przykładowy zestaw i go poprawić." }),
    el("div", { class:"row", style:"justify-content:center" },
      el("button", { class:"primary", onclick(){ A.tab = "settings"; render(); }, text:"Dodaj ćwiczenia" }),
      el("button", { async onclick(ev){ ev.currentTarget.disabled = true;
        const bands = [["Czarna","#222222"],["Fioletowa","#7048E8"],["Zielona","#2F9E44"],["Czerwona","#E03131"],["Żółta","#FAB005"]].map(([name,color]) => ({ id:HZ.uuid(), name, color }));
        const exercises = [["Przysiad ze sztangą","kg",1.25,2.5,20],["Wyciskanie hantli","kg",1,2,null],["Martwy ciąg rumuński","kg",1.25,2.5,20],["Podciąganie","band",1.25,2.5,null],["Pompki","kg",1.25,2.5,null]].map(([name,type,incMin,incMax,warmStart]) => ({ id:HZ.uuid(), name, type, incMin, incMax, warmStart }));
        const { error } = await HZ.api.saveLibrary({ exercises, bands });
        if (error){ toast(HZ.dbError(error)); render(); return; }
        await HZ.loadConfig(); toast("Wczytano przykład. Popraw go w zakładce Ćwiczenia i ustawienia."); render(); }, text:"Wczytaj przykład" })));
}

/* ---------- settings: exercises, bands, join code ---------- */
function settingsView(){
  if (!A.editC) A.editC = HZ.clone(S.config);
  const c = A.editC;
  const exCard = el("div", { class:"card" }, el("h2", { text:"Ćwiczenia" }),
    el("p", { class:"small muted", text:"Klient sam wybiera na stacji: ciężar albo guma. Tu ustawiasz sposób domyślny, zakres skoku ciężaru (np. 1,25–2,5 kg) i serię wstępną W1 (ciężar, gumę albo ćwiczenie bez gumy, nazwę i powtórzenia). Kolejne serie wstępne aplikacja podnosi sama: 2. ok. 60% ciężaru roboczego na 3–4 powt., 3. ok. 80% na 1–2 powt." }),
    el("div", { class:"list" }, c.exercises.map((e, i) => el("div", { class:"stack" },
      el("div", { class:"row", style:"flex-wrap:nowrap" },
        el("input", { id:`ex-n-${e.id || i}`, maxlength:"80", value:e.name, "aria-label":"Nazwa ćwiczenia", placeholder:"Nazwa ćwiczenia", oninput(ev){ e.name = ev.target.value; } }),
        el("button", { class:"ghost", "aria-label":"W górę", disabled:i === 0, onclick(){ [c.exercises[i-1], c.exercises[i]] = [c.exercises[i], c.exercises[i-1]]; render(); }, text:"↑" }),
        el("button", { class:"ghost", "aria-label":"Usuń ćwiczenie", onclick(){ c.exercises.splice(i, 1); render(); }, text:"✕" })),
      el("div", { class:"grid2" },
        el("label", { class:"f" }, "Domyślny sposób", el("select", { id:`ex-t-${e.id || i}`, value:e.type, onchange(ev){ e.type = ev.target.value; render(); } }, Object.entries(HZ.TYPE_LABEL).filter(([k]) => k !== "bw").map(([k,v]) => el("option", { value:k, text:v })))),
        el("details", { class:"w1", style:"grid-column:1/-1", open: (e.warmStart || (e.warmBand && e.warmBand !== HZ.SCAP) || e.warmLabel || e.warmReps || e.warmKgScap) ? true : null },
          el("summary", { text:"Seria wstępna W1 (ustalasz sam)" }),
          el("div", { class:"grid2", style:"margin-top:8px" },
            el("label", { class:"f" }, "Ciężar W1 (kg)", el("input", { id:`ex-ws-${e.id || i}`, inputmode:"decimal", value: e.warmStart ? HZ.fmtKg(e.warmStart) : "", placeholder:"np. 20 (gryf)", oninput(ev){ e.warmStart = HZ.parseNum(ev.target.value); } })),
            el("label", { class:"f" }, "Guma W1", el("select", { id:`ex-wb-${e.id || i}`, value: e.warmBand || HZ.SCAP, onchange(ev){ e.warmBand = ev.target.value; } },
              el("option", { value:HZ.SCAP, text:"bez gumy (np. aktywacja)" }), el("option", { value:"auto", text:"najmocniejsza guma" }),
              c.bands.filter(b => b.name.trim()).map(b => el("option", { value:b.id, text:b.name })))),
            el("label", { class:"row small", style:"grid-column:1/-1;flex-wrap:nowrap;cursor:pointer;gap:6px" },
              el("input", { id:`ex-wk-${e.id || i}`, type:"checkbox", style:"width:auto", checked: e.warmKgScap || null, onchange(ev){ e.warmKgScap = ev.target.checked; } }),
              el("span", { text:"Przy ciężarze W1 też bez obciążenia (np. dipy: aktywacja łopatek)" })),
            el("label", { class:"f" }, "Tekst W1 (zamiast ciężaru / gumy)", el("input", { id:`ex-wl-${e.id || i}`, maxlength:"40", value:e.warmLabel || "", placeholder:"np. podciąganie bez ciężaru", oninput(ev){ e.warmLabel = ev.target.value; } })),
            el("label", { class:"f" }, "Powtórzenia W1", el("input", { id:`ex-wr-${e.id || i}`, maxlength:"10", value:e.warmReps || "", placeholder:"np. 6–8", oninput(ev){ e.warmReps = ev.target.value; } })))),
        el("label", { class:"f" }, "Skok ciężaru (kg)", el("div", { class:"row", style:"flex-wrap:nowrap;gap:4px" },
          el("select", { id:`ex-lo-${e.id || i}`, "aria-label":"Skok od", value:String(HZ.incRange(e)[0]), onchange(ev){ e.incMin = Number(ev.target.value); } }, [0.25,0.5,1,1.25,2,2.5,5,10].map(v => el("option", { value:String(v), text:HZ.fmtKg(v) }))),
          el("span", { text:"–" }),
          el("select", { id:`ex-hi-${e.id || i}`, "aria-label":"Skok do", value:String(HZ.incRange(e)[1]), onchange(ev){ e.incMax = Number(ev.target.value); } }, [0.25,0.5,1,1.25,2,2.5,5,10].map(v => el("option", { value:String(v), text:HZ.fmtKg(v) }))))))))),
    el("button", { onclick(){ c.exercises.push({ id:HZ.uuid(), name:"", type:"kg", incMin:1.25, incMax:2.5 }); render(); }, text:"+ Dodaj ćwiczenie" }));
  const bandCard = el("div", { class:"card" }, el("h2", { text:"Gumy" }),
    el("p", { class:"small muted", text:"Ułóż od najmocniejszej (największa pomoc) do najsłabszej. W polu kg wpisz, ile mniej więcej odciąża guma: jedną liczbę (15) albo zakres (3-5). Klient zobaczy to przy wyborze gumy, a podpowiedź przesuwa go w dół listy." }),
    el("div", { class:"list" }, c.bands.map((b, i) => el("div", { class:"row", style:"flex-wrap:nowrap" },
      el("input", { id:`b-c-${b.id || i}`, type:"color", value:b.color || "#888888", "aria-label":"Kolor gumy", style:"width:46px;padding:2px;flex:none", oninput(ev){ b.color = ev.target.value; } }),
      el("input", { id:`b-n-${b.id || i}`, maxlength:"40", value:b.name, "aria-label":"Nazwa gumy", placeholder:"np. Zielona", oninput(ev){ b.name = ev.target.value; } }),
      el("input", { id:`b-kg-${b.id || i}`, inputmode:"text", value: HZ.bandKgText(b), "aria-label":"Pomoc gumy w kg, np. 15 albo 3-5", placeholder:"kg", style:"width:4.2rem;flex:none;text-align:center;padding-inline:4px",
        oninput(ev){ const r = HZ.parseKgRange(ev.target.value); b.kg = r ? r[0] : null; b.kgMax = r && r[1] !== r[0] ? r[1] : null; } }),
      el("button", { class:"ghost", "aria-label":"W górę", disabled:i === 0, onclick(){ [c.bands[i-1], c.bands[i]] = [c.bands[i], c.bands[i-1]]; render(); }, text:"↑" }),
      el("button", { class:"ghost", "aria-label":"W dół", disabled:i === c.bands.length - 1, onclick(){ [c.bands[i+1], c.bands[i]] = [c.bands[i], c.bands[i+1]]; render(); }, text:"↓" }),
      el("button", { class:"ghost", "aria-label":"Usuń gumę", onclick(){ c.bands.splice(i, 1); render(); }, text:"✕" })))),
    el("div", { class:"row" },
      el("button", { onclick(){ c.bands.push({ id:HZ.uuid(), name:"", color:"#888888", kg:null }); render(); }, text:"+ Dodaj gumę" }),
      c.bands.some(b => b.kg) ? el("button", { class:"ghost", onclick(){ c.bands.sort((a,b) => HZ.bandKgMid(b) - HZ.bandKgMid(a)); render(); }, text:"Ułóż według kg pomocy" }) : null));
  const save = el("div", { class:"row" },
    el("button", { class:"primary", async onclick(ev){ ev.currentTarget.disabled = true; const ok = await saveLibrary(c); if (ok){ A.editC = null; toast("Zapisano ćwiczenia i gumy"); } render(); }, text:"Zapisz ćwiczenia i gumy" }),
    el("button", { onclick(){ A.editC = null; render(); }, text:"Cofnij zmiany" }));
  const codeIn = el("input", { id:"join-code", maxlength:"40", value:A.joinCode || "", placeholder:"np. HUBZONE2026", style:"text-transform:uppercase" });
  const codeCard = el("div", { class:"card" }, el("h2", { text:"Kod klubu" }),
    el("p", { class:"small muted", text:"Nowy klient wpisuje ten kod przy zakładaniu konta. Dzięki temu konta nie założy nikt spoza grupy. Zmień kod, jeśli wycieknie; istniejących kont to nie dotyczy." }),
    el("label", { class:"f" }, "Aktualny kod", codeIn),
    el("button", { async onclick(){ const v = codeIn.value.trim().toUpperCase();
      if (v.length < 3){ toast("Kod musi mieć co najmniej 3 znaki."); return; }
      const { error } = await HZ.api.setClub(v);
      if (error){ toast(HZ.dbError(error)); return; } A.joinCode = v; toast("Zapisano kod klubu"); render(); }, text:"Zapisz kod" }));
  const ownCard = el("div", { class:"card" }, el("h2", { text:"Trening własny" }),
    el("p", { class:"small muted", text:"Zakładka, w której klienci zapisują treningi zrobione poza zajęciami. Te wyniki liczą się do ich postępów i podpowiedzi." }),
    el("label", { class:"row", style:"flex-wrap:nowrap;cursor:pointer" },
      el("input", { id:"own-enabled", type:"checkbox", style:"width:auto", checked: S.config.ownEnabled || null, async onchange(ev){
        const on = ev.target.checked; ev.target.disabled = true;
        const { error } = await HZ.api.setOwnEnabled(on);
        if (error){ toast(HZ.dbError(error)); ev.target.checked = !on; ev.target.disabled = false; return; }
        S.config.ownEnabled = on; if (A.editC) A.editC.ownEnabled = on; toast(on ? "Trening własny włączony dla klientów" : "Trening własny wyłączony"); render(); } }),
      el("span", { text:"Pokaż klientom zakładkę „Trening własny”" })));
  const rankCard = el("div", { class:"card" }, el("h2", { text:"Ranking" }),
    el("p", { class:"small muted", text:"Tabela grupy: punkty za obecność i rekordy, seria piątków z rzędu, progres i tonaż. Każdy klient może się ukryć w ustawieniach konta." }),
    el("label", { class:"row", style:"flex-wrap:nowrap;cursor:pointer" },
      el("input", { id:"rank-enabled", type:"checkbox", style:"width:auto", checked: S.config.rankingEnabled || null, async onchange(ev){
        const on = ev.target.checked; ev.target.disabled = true;
        const { error } = await HZ.api.setRankingEnabled(on);
        if (error){ toast(HZ.dbError(error)); ev.target.checked = !on; ev.target.disabled = false; return; }
        S.config.rankingEnabled = on; toast(on ? "Ranking włączony" : "Ranking wyłączony"); render(); } }),
      el("span", { text:"Pokaż klientom ranking i tabelę ogólną" })));
  return [exCard, bandCard, save, codeCard, ownCard, rankCard];
}
async function saveLibrary(c){
  const exercises = c.exercises.filter(e => e.name.trim()).map(e => ({ id:e.id || HZ.uuid(), name:e.name.trim().slice(0,80), type:e.type, incMin:HZ.incRange(e)[0], incMax:HZ.incRange(e)[1], warmStart: Number(e.warmStart) > 0 ? Number(e.warmStart) : null,
    warmBand: e.warmBand || HZ.SCAP, warmKgScap: !!e.warmKgScap, warmLabel:(e.warmLabel || "").trim().slice(0,40), warmReps:(e.warmReps || "").trim().replace(/-/g, "–").slice(0,10) }));
  const bands = c.bands.filter(b => b.name.trim()).map(b => ({ id:b.id || HZ.uuid(), name:b.name.trim().slice(0,40), color:/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#888888", kg: Number(b.kg) > 0 ? Math.round(Number(b.kg) * 10) / 10 : null, kgMax: Number(b.kgMax) > Number(b.kg) ? Math.round(Number(b.kgMax) * 10) / 10 : null }));
  const { error } = await HZ.api.saveLibrary({ exercises, bands });
  if (error){ toast(HZ.dbError(error)); return false; }
  await HZ.loadConfig(); return true;
}

/* ---------- workouts ---------- */
function workoutsView(){
  if (A.editW) return [workoutEditor()];
  const ws = HZ.sortedWorkouts().reverse();
  const nextFri = (() => { const d = new Date(); d.setDate(d.getDate() + (5 - d.getDay() + 7) % 7); return d.toLocaleDateString("sv-SE"); })();
  const out = [el("div", { class:"row between" }, el("h2", { text:"Treningi" }), el("button", { class:"primary", onclick(){
    const last = HZ.sortedWorkouts().slice(-1)[0];
    A.editW = { id:null, date:nextFri, title:"", note:"", stations: last ? HZ.clone(last.stations || []).map(s => ({ ...s, id:HZ.uuid() })) : [newStation("main"), newStation("acc")] };
    render(); }, text:"+ Nowy trening" }))];
  if (!ws.length) out.push(el("div", { class:"empty", text:"Brak treningów. Dodaj pierwszy piątek, a klienci zobaczą stacje u siebie." }));
  ws.forEach(w => out.push(el("div", { class:"card" },
    el("div", { class:"row between" },
      el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:`#${HZ.workoutNo(w.id)} · ${HZ.fmtDate(w.date, true)}` }), el("h3", { text:w.title || "Trening stacyjny" })),
      el("div", { class:"row" }, el("button", { onclick(){ A.editW = HZ.clone(w); render(); }, text:"Edytuj" }),
        el("button", { onclick(){ A.tab = "results"; A.res = { wid:w.id, rows:null, loading:false }; HZ.LS.set("hz-admin-tab", "results"); render(); }, text:"Wyniki" }))),
    el("div", { class:"chips" }, HZ.orderStations(w.stations || []).map(s => { const ex = HZ.exById(s.exId); const lb = HZ.stationLabels(HZ.orderStations(w.stations || []))[s.id]; return el("span", { class:"chip" + (HZ.secOf(s) === "main" ? " main" : ""), text:`${lb}. ${ex ? ex.name : "?"} ${s.warmup ? s.warmup + "W + " : ""}${s.sets}×${s.reps}` }); })),
    A.confirmDel === w.id
      ? el("div", { class:"row" }, el("span", { class:"small", text:"Usunąć trening? Wpisy klientów zostaną w ich historii." }),
          el("button", { class:"danger", async onclick(){ const { error } = await HZ.api.deleteWorkout(w.id); if (error){ toast(HZ.dbError(error)); return; }
            S.workouts = S.workouts.filter(x => x.id !== w.id); A.confirmDel = null; toast("Usunięto"); render(); }, text:"Usuń" }),
          el("button", { onclick(){ A.confirmDel = null; render(); }, text:"Anuluj" }))
      : el("button", { class:"ghost", style:"align-self:flex-start", onclick(){ A.confirmDel = w.id; render(); }, text:"Usuń trening" }))));
  return out;
}
const newStation = (section = "acc") => ({ id:HZ.uuid(), section, exId:(S.config.exercises[0] || {}).id, warmup: section === "main" ? 2 : 0, sets:3, reps: section === "main" ? 5 : 10, work:"", rest:"", note:"" });
function workoutEditor(){
  const w = A.editW;
  return el("div", { class:"card" },
    el("h2", { text: w.id ? "Edytuj trening" : "Nowy trening" }),
    el("div", { class:"grid2" },
      el("label", { class:"f" }, "Data", el("input", { id:"we-date", type:"date", value:w.date, onchange(e){ w.date = e.target.value; } })),
      el("label", { class:"f" }, "Nazwa (opcjonalnie)", el("input", { id:"we-title", maxlength:"80", value:w.title || "", placeholder:"np. Siła – dół", oninput(e){ w.title = e.target.value; } }))),
    el("label", { class:"f" }, "Docelowy RIR na ten trening",
      el("select", { id:"we-rir", value: w.rir != null ? String(w.rir) : "", onchange(e){ w.rir = e.target.value === "" ? null : Number(e.target.value); render(); } },
        el("option", { value:"", text:"bez celu (podpowiedź wg ostatniego RIR)" }), [0,1,2,3,4].map(n => el("option", { value:String(n), text:`RIR ${n}` + (n === 0 ? " (do upadku)" : "") })))),
    el("label", { class:"f" }, "Wskazówki dla grupy", el("textarea", { id:"we-note", maxlength:"1000", value:w.note || "", placeholder:"np. Rotacja co 8 min, każdy zaczyna od innej stacji", oninput(e){ w.note = e.target.value; } })),
    HZ.SECTIONS.map(sec => { const items = w.stations.filter(s => HZ.secOf(s) === sec.key);
      return el("section", { class:"stack sec-edit" },
        el("div", { class:"sechead" }, el("h3", { text:sec.title }), el("span", { class:"eyebrow", text:sec.sub })),
        items.length ? null : el("p", { class:"small muted", text: sec.key === "main" ? "Brak bojów. Dodaj np. przysiad, wyciskanie i martwy ciąg." : "Brak stacji akcesoryjnych." }),
        el("div", { class:"list" }, items.map((s, j) => { const gi = w.stations.indexOf(s);
          const swap = other => { const go = w.stations.indexOf(other); [w.stations[gi], w.stations[go]] = [w.stations[go], w.stations[gi]]; render(); };
          return el("div", { class:"stack" },
          el("div", { class:"row", style:"flex-wrap:nowrap" }, el("span", { class:"num", style:"font-size:1.3rem;font-weight:700;min-width:1.8rem;flex:none", text: sec.key === "main" ? j+1 : HZ.stationLabels(HZ.orderStations(w.stations))[s.id] }),
            el("select", { id:`st-ex-${s.id}`, "aria-label":"Ćwiczenie", value:s.exId || "", onchange(e){ s.exId = e.target.value; } }, S.config.exercises.map(e => el("option", { value:e.id, text:e.name }))),
            el("button", { class:"ghost", "aria-label":"W górę", disabled:j === 0, onclick(){ swap(items[j-1]); }, text:"↑" }),
            el("button", { class:"ghost", "aria-label":"W dół", disabled:j === items.length - 1, onclick(){ swap(items[j+1]); }, text:"↓" }),
            el("button", { class:"ghost", "aria-label":"Usuń", onclick(){ w.stations.splice(gi, 1); render(); }, text:"✕" })),
          el("div", { class:"grid3" },
            sec.key !== "main" ? null : el("label", { class:"f" }, "Serie wstępne", el("input", { id:`st-wu-${s.id}`, inputmode:"numeric", placeholder:"0", value: s.warmup ? String(s.warmup) : "", oninput(e){ s.warmup = Math.min(6, Math.max(0, Math.round(HZ.parseNum(e.target.value) || 0))); } })),
            el("label", { class:"f" }, "Serie robocze", el("input", { id:`st-s-${s.id}`, inputmode:"numeric", value:String(s.sets || ""), oninput(e){ s.sets = Math.round(HZ.parseNum(e.target.value) || 0); } })),
            el("label", { class:"f" }, "Powtórzenia", el("input", { id:`st-r-${s.id}`, inputmode:"numeric", value:String(s.reps || ""), oninput(e){ s.reps = Math.round(HZ.parseNum(e.target.value) || 0); } })),
            el("label", { class:"f" }, "RIR", el("select", { id:`st-rir-${s.id}`, value: s.rir != null ? String(s.rir) : "", onchange(e){ s.rir = e.target.value === "" ? null : Number(e.target.value); } },
              el("option", { value:"", text: w.rir != null ? `jak trening (${w.rir})` : "–" }), [0,1,2,3,4].map(n => el("option", { value:String(n), text:String(n) })))),
            el("label", { class:"f" }, sec.key === "main" ? "Czas" : "Czas na stacji", el("input", { id:`st-w-${s.id}`, maxlength:"30", value:s.work || "", placeholder:"np. 8 min", oninput(e){ s.work = e.target.value; } })),
            el("label", { class:"f" }, "Przerwa", el("input", { id:`st-p-${s.id}`, maxlength:"30", value:s.rest || "", placeholder: sec.key === "main" ? "np. 3 min" : "np. 90 s", oninput(e){ s.rest = e.target.value; } }))),
          el("div", { class:"row", style:"flex-wrap:nowrap" },
            el("input", { id:`st-n-${s.id}`, maxlength:"200", value:s.note || "", placeholder:"Uwaga techniczna (opcjonalnie)", "aria-label":"Uwaga", oninput(e){ s.note = e.target.value; } }),
            el("button", { class:"ghost small", style:"white-space:nowrap", onclick(){ s.section = sec.key === "main" ? "acc" : "main"; render(); }, text: sec.key === "main" ? "→ akcesoria" : "→ trening główny" })),
          sec.key !== "main" && j > 0 ? el("label", { class:"row small", style:"flex-wrap:nowrap;cursor:pointer;gap:6px" },
            el("input", { id:`st-ss-${s.id}`, type:"checkbox", style:"width:auto", checked: s.superset || null, onchange(e){ s.superset = e.target.checked; render(); } }),
            el("span", { text:"Superseria z poprzednim ćwiczeniem (A1, A2…)" })) : null); })),
        el("button", { onclick(){ w.stations.push(newStation(sec.key)); render(); }, text:sec.add })); }),
    el("div", { class:"row" },
      el("button", { class:"primary", async onclick(ev){
        if (!w.date){ toast("Wybierz datę."); return; } if (!w.stations.length){ toast("Dodaj przynajmniej jeden bój albo stację."); return; }
        const row = { id:w.id || HZ.uuid(), date:w.date, title:(w.title || "").trim(), note:(w.note || "").trim(), rir: w.rir ?? null,
          stations:w.stations.filter(s => s.exId).map(s => ({ id:s.id, section:HZ.secOf(s), superset: HZ.secOf(s) !== "main" && !!s.superset, exId:s.exId, warmup: HZ.secOf(s) === "main" ? (s.warmup || 0) : 0, sets:s.sets || 3, reps:s.reps || 5, rir: s.rir ?? null, work:(s.work||"").trim(), rest:(s.rest||"").trim(), note:(s.note||"").trim() })) };
        ev.currentTarget.disabled = true;
        const { data, error } = await HZ.api.saveWorkout(row);
        if (error){ toast(HZ.dbError(error)); render(); return; }
        S.workouts = S.workouts.filter(x => x.id !== data.id).concat(data); A.editW = null; toast("Zapisano trening. Klienci już go widzą."); render(); }, text:"Zapisz trening" }),
      el("button", { onclick(){ A.editW = null; render(); }, text:"Anuluj" })));
}

/* ---------- results ---------- */
async function loadResults(wid){
  A.res = { wid, rows:null, loading:true }; render();
  const { data, error } = await HZ.api.logsForWorkout(wid);
  if (error){ toast(HZ.dbError(error)); A.res = { wid, rows:[], loading:false }; render(); return; }
  const byUser = new Map(data.map(l => [l.user_id, l]));
  const rows = A.clients.map(c => ({ client:c, log:byUser.get(c.id) || null }));
  for (const l of data) if (!A.clients.some(c => c.id === l.user_id)) rows.push({ client:{ id:l.user_id, name:"(trener)" }, log:l });
  rows.sort((a,b) => (b.log ? 1 : 0) - (a.log ? 1 : 0) || (a.client.name || "").localeCompare(b.client.name || "", "pl"));
  A.res = { wid, rows, loading:false }; render();
}
function resultsView(){
  const ws = HZ.sortedWorkouts(); if (!ws.length) return [el("div", { class:"empty", text:"Wyniki pojawią się, gdy dodasz trening i klienci zapiszą serie." })];
  const wid = A.res.wid && ws.some(w => w.id === A.res.wid) ? A.res.wid : HZ.defaultWorkoutId();
  if (!A.res.loading && (A.res.wid !== wid || !A.res.rows)) setTimeout(() => loadResults(wid), 0);
  const pick = el("select", { id:"res-w", "aria-label":"Trening", onchange(e){ loadResults(e.target.value); } },
    [...ws].reverse().map(w => el("option", { value:w.id, text:`#${HZ.workoutNo(w.id)} · ${HZ.fmtDate(w.date)}${w.title ? " · " + w.title : ""}` })));
  pick.value = wid;
  const rows = A.res.wid === wid ? A.res.rows : null; const done = rows ? rows.filter(r => r.log) : [];
  const avg = (() => { const f = done.map(r => r.log.fatigue).filter(v => v != null); return f.length ? (f.reduce((a,b) => a+b, 0) / f.length).toLocaleString("pl-PL", { maximumFractionDigits:1 }) : "–"; })();
  const out = [el("div", { class:"card" },
    el("div", { class:"row between" }, el("h2", { text:"Wyniki grupy" }), el("div", { style:"flex:1 1 200px;max-width:280px" }, pick)),
    rows ? el("div", { class:"grid3" },
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Wpisało się" }), el("span", { class:"v", text:`${done.length}/${A.clients.length}` })),
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Śr. zmęczenie" }), el("span", { class:"v", text:avg })),
      el("div", { class:"stat" }, el("span", { class:"eyebrow", text:"Stacje" }), el("span", { class:"v", text:((ws.find(w => w.id === wid) || {}).stations || []).length })))
      : el("p", { class:"muted", text:"Wczytuję wpisy…" }),
    el("div", { class:"row" }, el("button", { onclick(){ loadResults(wid); }, text:"Odśwież" }), done.length ? el("button", { onclick(){ exportCsv(wid, done); }, text:"Pobierz CSV" }) : null))];
  if (rows && !A.clients.length) out.push(el("div", { class:"empty", text:"Nikt jeszcze nie założył konta. Wyślij klientom link do strony głównej i kod klubu." }));
  if (rows) rows.forEach(({ client, log }) => out.push(el("div", { class:"card" },
    el("div", { class:"row between" }, el("h3", { text:client.name || client.email || "Klient" }),
      el("div", { class:"row" }, log && log.fatigue != null ? el("span", { class:"chip", text:`Zmęczenie ${log.fatigue}/10` }) : null,
        client.manual ? el("button", { onclick(){ openEntry(client, wid); }, text: log ? "Edytuj wyniki" : "Wpisz wyniki" }) : null,
        el("button", { class:"ghost", onclick(){ openClient(client.id); }, text:"Historia →" }))),
    client.manual ? el("span", { class:"chip", style:"align-self:flex-start", text:"bez konta · wpisuje trener" }) : null,
    log ? el("div", { class:"list" }, (log.entries || []).map(e => el("div", { class:"stack", style:"gap:2px" },
        el("span", { style:"font-weight:600", text:`${e.exName} · cel ${e.targetSets}×${e.targetReps}` }),
        el("span", { class:"num", style:"font-size:1.05rem", text:HZ.setsText(e) }))))
      : el("span", { class:"muted small", text:"Brak wpisu z tego treningu." }),
    log && log.note ? el("p", { class:"small", text:"Notatka: " + log.note }) : null)));
  return out;
}
function exportCsv(wid, rows){
  const w = S.workouts.find(x => x.id === wid);
  const lines = [["data","trening","klient","cwiczenie","cel","typ","seria","obciazenie","powtorzenia","RIR","zmeczenie"].join(";")];
  for (const { client, log } of rows) for (const e of (log.entries || [])){ let wi = 0, ri = 0; e.sets.forEach(s => lines.push([log.date, "#" + HZ.workoutNo(wid), client.name, e.exName, `${e.targetSets}x${e.targetReps}`, s.warmup ? "wstepna" : "robocza", s.warmup ? ++wi : ++ri,
    e.type === "band" ? HZ.bandName(s.load) : (s.load == null ? "" : String(s.load).replace(".", ",")), s.reps, s.rir ?? "", log.fatigue ?? ""]
    .map(v => `"${String(v).replace(/"/g, '""')}"`).join(";"))); }
  const blob = new Blob(["﻿" + lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const a = el("a", { href:URL.createObjectURL(blob), download:`hubzone-wyniki-${w ? w.date : "trening"}.csv` });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ---------- trainer enters results for a client without an account ---------- */
async function openEntry(client, wid){
  const w = S.workouts.find(x => x.id === wid); if (!w) return;
  const r = await HZ.api.logsOf(client.id); if (r.error){ toast(HZ.dbError(r.error)); return; }
  const logs = r.data || []; const existing = logs.find(l => l.workout_id === wid);
  const d = { fatigue: existing ? existing.fatigue ?? null : null, note: existing ? existing.note || "" : "", st:{}, mode:{} };
  for (const st of (w.stations || [])){
    const ex = HZ.exById(st.exId); if (!ex) continue;
    const prev = existing && (existing.entries || []).find(e => e.stationId === st.id);
    const mode = prev && prev.type !== "bw" ? (prev.type || ex.type) : ex.type; d.mode[st.id] = mode;
    d.st[st.id] = prev ? prev.sets.map(s => ({ load:s.load ?? null, reps:s.reps ?? null, rir:s.rir ?? null, ...(s.warmup ? { warmup:true, manual:true } : {}) }))
      : entrySets(w, st, ex, mode, logs);
  }
  A.entry = { client, w, d, logs }; render(); window.scrollTo(0, 0);
}
function entrySets(w, st, ex, mode, logs){
  const sg = HZ.suggest(logs, ex.id, mode, ex, w.id, HZ.targetRir(w, st));
  return HZ.buildSets({ ...ex, type:mode }, HZ.secOf(st) === "main" ? (st.warmup || 0) : 0, st.sets || 3, sg.next ?? null);
}
function entryView(){
  const { client, w, d, logs } = A.entry;
  const order = HZ.orderStations(w.stations || []); const labels = HZ.stationLabels(order);
  const out = [el("div", { class:"card" },
    el("span", { class:"eyebrow", text:`Wpisujesz za: ${client.name}` }),
    el("h2", { text:`Trening #${HZ.workoutNo(w.id)} · ${HZ.fmtDate(w.date)}` }),
    el("p", { class:"small muted", text:"Wpisz ciężar lub gumę i powtórzenia. Puste serie się nie zapiszą." }))];
  for (const sec of HZ.SECTIONS){
    const items = order.filter(st => HZ.secOf(st) === sec.key && HZ.exById(st.exId)); if (!items.length) continue;
    out.push(el("div", { class:"sechead" }, el("h2", { text:sec.title }), el("span", { class:"eyebrow", text:sec.sub })));
    for (const st of items){
      const exBase = HZ.exById(st.exId), mode = d.mode[st.id] || exBase.type, ex = { ...exBase, type:mode }, isMain = sec.key === "main";
      const sets = d.st[st.id] || (d.st[st.id] = entrySets(w, st, exBase, mode, logs));
      HZ.refreshWarmups(ex, sets);
      const tRir = HZ.targetRir(w, st); const sg = HZ.suggest(logs, ex.id, mode, exBase, w.id, tRir);
      out.push(el("section", { class:"card station" + (isMain ? " main" : "") },
        el("div", { class:"row between", style:"align-items:flex-start" },
          el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:labels[st.id] }), el("h3", { text:ex.name })),
          el("div", { class:"row", style:"gap:4px" }, el("span", { class:"badge", text:`${st.sets || "?"} × ${st.reps || "?"}` }), tRir != null ? el("span", { class:"badge rir", text:`RIR ${tRir}` }) : null)),
        HZ.modeToggle(mode, m => { d.mode[st.id] = m; d.st[st.id] = entrySets(w, st, exBase, m, logs); render(); }),
        HZ.tipBox(sg, load => { HZ.applyLoad(ex, sets, load); render(); }, (sets.find(s => !s.warmup) || {}).load),
        HZ.setsEditor(ex, sets, `en-${st.id}`, structural => { if (structural) render(); }, { repsHint:sg.reps, noWarmup:!isMain })));
    }
  }
  out.push(el("div", { class:"card" }, el("h3", { text:"Zmęczenie po treningu" }),
    HZ.fatiguePicker(d.fatigue, v => { d.fatigue = v; render(); }),
    el("label", { class:"f" }, "Notatka (opcjonalnie)", el("textarea", { id:"en-note", maxlength:"1000", value:d.note, oninput(e){ d.note = e.target.value; } })),
    el("div", { class:"row" },
      el("button", { class:"primary", onclick(ev){ saveEntry(ev.currentTarget); }, text:"Zapisz wyniki" }),
      el("button", { onclick(){ A.entry = null; render(); }, text:"Anuluj" }))));
  return out;
}
async function saveEntry(btn){
  const { client, w, d, logs } = A.entry; const entries = [];
  for (const st of (w.stations || [])){ const ex = HZ.exById(st.exId); if (!ex) continue;
    const sets = (d.st[st.id] || []).filter(s => s.reps != null).map(s => ({ load: s.load === "" ? null : s.load ?? null, reps:s.reps, rir: s.warmup ? null : (s.rir ?? null), ...(s.warmup ? { warmup:true } : {}) }));
    const tRir = HZ.targetRir(w, st);
    if (sets.length) entries.push({ stationId:st.id, exId:ex.id, exName:ex.name, type:d.mode[st.id] || ex.type, ...(tRir != null ? { targetRir:tRir } : {}),
      targetSets:st.sets || sets.filter(x => !x.warmup).length, targetReps:st.reps || 0, sets }); }
  if (!entries.length){ toast("Wpisz powtórzenia przynajmniej w jednej serii."); return; }
  btn.disabled = true;
  const row = { user_id:client.id, workout_id:w.id, date:w.date, title:w.title || "", own:false, fatigue:d.fatigue ?? null, note:(d.note || "").trim().slice(0,1000), entries, saved_at:new Date().toISOString() };
  const { data, error } = await HZ.api.saveWorkoutLog(row);
  if (error){ toast(HZ.dbError(error)); btn.disabled = false; return; }
  const all = logs.filter(l => l.id !== data.id).concat(data);
  if (S.config.rankingEnabled !== false){
    const rk = await HZ.api.saveRanking(client.id, { name:client.name, ...HZ.rankRow(HZ.computeStats(all)), hidden:false, updatedAt:new Date().toISOString() });
    if (rk.error) toast("Wyniki zapisane, ale ranking się nie zaktualizował: opublikuj nowe reguły w Firebase.");
  }
  A.entry = null; A.rankRows = null; toast(`Zapisano wyniki: ${client.name}`);
  await loadClients().catch(() => {}); loadResults(w.id);
}

/* ---------- clients ---------- */
async function openClient(id){
  A.tab = "clients"; HZ.LS.set("hz-admin-tab", "clients"); A.clientId = id; A.clientLogs = null; render();
  const { data, error } = await HZ.api.logsOf(id);
  if (error){ toast(HZ.dbError(error)); A.clientLogs = []; } else A.clientLogs = data;
  render(); window.scrollTo(0, 0);
}
function clientsView(){
  if (A.clientId){
    const c = A.clients.find(x => x.id === A.clientId) || { name:"Klient" };
    const manualBar = c.manual ? el("div", { class:"row" },
      el("span", { class:"chip", text:"bez konta · wyniki wpisujesz Ty" }),
      A.confirmDelClient === c.id
        ? el("span", { class:"row" }, el("span", { class:"small", text:"Usunąć klienta z listy i rankingu?" }),
            el("button", { class:"danger", async onclick(){ const { error } = await HZ.api.deleteManualClient(c.id); if (error){ toast(HZ.dbError(error)); return; }
              A.clients = A.clients.filter(x => x.id !== c.id); A.clientId = null; A.confirmDelClient = null; A.rankRows = null; toast("Usunięto"); render(); }, text:"Usuń" }),
            el("button", { onclick(){ A.confirmDelClient = null; render(); }, text:"Anuluj" }))
        : el("button", { class:"ghost", onclick(){ A.confirmDelClient = c.id; render(); }, text:"Usuń klienta" })) : null;
    return [el("div", { class:"row" }, el("button", { onclick(){ A.clientId = null; render(); }, text:"← Wszyscy klienci" }), el("span", { class:"small muted", text:c.email || "" })), manualBar,
      ...(A.clientLogs ? [A.clientLogs.length ? HZ.personalStats(A.clientLogs, `Statystyki: ${c.name || "klient"}`) : null, ...HZ.progressView(A.clientLogs, c.name || "Klient", "c-" + A.clientId, render)] : [el("div", { class:"empty", text:"Wczytuję historię…" })])];
  }
  const nameIn = el("input", { id:"manual-name", maxlength:"60", placeholder:"Imię (i nazwisko)" });
  const addCard = el("div", { class:"card" }, el("h3", { text:"Dodaj klienta bez konta" }),
    el("p", { class:"small muted", text:"Dla osób bez telefonu. Wyniki wpisujesz za nich w zakładce Wyniki (przycisk „Wpisz wyniki”). Pojawiają się w rankingu i statystykach jak wszyscy." }),
    el("div", { class:"row", style:"flex-wrap:nowrap" }, nameIn,
      el("button", { class:"primary", style:"white-space:nowrap", async onclick(ev){ const n = nameIn.value.trim().slice(0, 60); if (!n){ toast("Wpisz imię."); return; }
        ev.currentTarget.disabled = true; const { data, error } = await HZ.api.addManualClient(n);
        if (error){ toast(error.code === "permission-denied" ? "Firebase odrzucił zapis: wklej aktualny plik firestore.rules w Firestore → Rules i kliknij Publish." : HZ.dbError(error)); render(); return; }
        A.clients.push(data); A.clients.sort((a,b) => (a.name || "").localeCompare(b.name || "", "pl")); toast(`Dodano: ${n}`); render(); }, text:"Dodaj" })));
  if (!A.clients.length) return [addCard, el("div", { class:"empty" }, el("h3", { text:"Brak klientów" }), el("p", { class:"small", text:"Klienci pojawią się tu po założeniu konta na stronie głównej z kodem klubu albo gdy dodasz ich powyżej." }))];
  return [addCard, el("div", { class:"card" },
    el("div", { class:"row between" }, el("h2", { text:`Klienci (${A.clients.length})` }), el("button", { async onclick(){ await loadClients(); render(); toast("Odświeżono"); }, text:"Odśwież" })),
    el("div", { class:"tablewrap" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text:"Imię" }), el("th", { text:"Treningi" }), el("th", { text:"Ostatni" }), el("th", { text:"Śr. zmęcz." }))),
      el("tbody", {}, A.clients.map(c => { const s = A.stats[c.id] || { n:0 };
        return el("tr", {},
          el("td", {}, el("button", { class:"link", onclick(){ openClient(c.id); }, text:c.name || c.email }), c.manual ? el("span", { class:"small muted", text:" · bez konta" }) : null),
          el("td", { text:s.n }), el("td", { text: s.last ? HZ.fmtDate(s.last) : "–" }),
          el("td", { text: s.fn ? (s.fsum / s.fn).toLocaleString("pl-PL", { maximumFractionDigits:1 }) : "–" })); })))))];
}

/* ---------- boot ---------- */
if (!HZ.ready){ render(); return; }
render();
HZ.api.onAuth(session => {
  const was = A.session && A.session.user.id;
  A.session = session;
  if (!session){ A.checked = false; A.profile = null; render(); return; }
  if (was !== session.user.id){ A.checked = false; render(); setTimeout(loadAll, 0); }
});
})();
