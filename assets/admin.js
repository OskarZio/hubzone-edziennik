/* Hubzone Weightlifting e-Dziennik — panel trenera */
(function(){
"use strict";
const { el, S, toast } = HZ;
const app = document.getElementById("app");
const A = { session:null, profile:null, checked:false, authMode:"login", tab:HZ.LS.get("hz-admin-tab") || "workouts",
  clients:[], stats:{}, editW:null, editC:null, confirmDel:null, res:{ wid:null, rows:null, loading:false }, clientId:null, clientLogs:null, joinCode:undefined, error:null };

function render(){ HZ.swap(app, view()); }

/* security: the trainer panel signs out after 30 min without activity */
const IDLE_MS = 30 * 60 * 1000; let idleTimer = null;
function armIdle(){ clearTimeout(idleTimer); if (A.session) idleTimer = setTimeout(async () => { await HZ.api.signOut(); toast("Wylogowano po 30 min bezczynności."); }, IDLE_MS); }
["pointerdown","keydown","scroll","visibilitychange"].forEach(ev => document.addEventListener(ev, armIdle, { passive:true }));

async function loadAll(){
  try {
    const pr = await HZ.api.profile(A.session.user.id);
    if (pr.error && pr.error.code !== "permission-denied") throw pr.error;
    A.profile = pr.data; A.checked = true;
    if (!A.profile || !A.profile.is_admin){ render(); return; }
    await Promise.all([HZ.loadConfig(), HZ.loadWorkouts(), loadClients(), loadSettings()]);
    Promise.all((A.admins || []).map(x => HZ.api.deleteRanking(x.id))).catch(() => {});   // trainers never appear in the ranking
    A.error = null;
  } catch(e){ console.error(e); A.error = "Nie udało się wczytać danych. Sprawdź połączenie i odśwież stronę."; A.checked = true; }
  render();
}
async function loadClients(){
  const [pr, lg, ap] = await Promise.all([HZ.api.users(), HZ.api.allLogs(), HZ.api.allApprovals()]);
  if (pr.error) throw pr.error; if (lg.error) throw lg.error;
  A.appr = Object.fromEntries(((ap && ap.data) || []).map(a => [a.id, a])); HZ.applyHolo();
  A.admins = pr.data.filter(p => p.is_admin);
  A.clients = pr.data.filter(p => !p.is_admin).sort((a,b) => (a.name || "").localeCompare(b.name || "", "pl"));
  A.stats = {}; A.allLogs = lg.data;
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
  if (A.showQr) return [qrScreen()];
  return [header(), warn, HZ.tabBar([["workouts","Treningi"],["results", pendingAll().length ? `Wyniki (${pendingAll().length})` : "Wyniki"],["clients","Klienci"],["ranking","Ranking"],["settings","Ćwiczenia i ustawienia"]], A.tab, k => { A.tab = k; HZ.LS.set("hz-admin-tab", k); render(); }), ...body(), HZ.footer()];
}
function header(){
  return el("header", { class:"top" }, HZ.brand("e-Dziennik · panel trenera"),
    A.session && A.profile && A.profile.is_admin ? el("div", { class:"row" }, el("button", { class:"primary", onclick(){ A.showQr = true; render(); }, text:"Kod QR" }), el("a", { href:"./", class:"small", text:"Widok klienta" }), el("button", { class:"ghost", onclick(){ HZ.api.signOut(); }, text:"Wyloguj" })) : null);
}
function body(){
  if (A.entry) return entryView();
  if (!S.config.exercises.length && A.tab !== "settings") return [setupEmpty()];
  if (A.tab === "settings") return settingsView();
  if (A.tab === "results") return resultsView();
  if (A.tab === "clients") return clientsView();
  if (A.tab === "ranking"){
    if (!A.rankRows){ HZ.api.ranking().then(async r => {
        const rows = r.data || []; const admins = new Set((A.admins || []).map(x => x.id));
        const consent = new Set(A.clients.filter(c => c.consent && c.consent.ranking).map(c => c.id));
        const drop = rows.filter(x => admins.has(x.id) || !consent.has(x.id));   // trainers and people without consent are not ranked
        for (const x of drop) await HZ.api.deleteRanking(x.id);
        // rebuild rows of everyone who agreed (also clients who have not opened the app since their results were entered)
        const keep = rows.filter(x => !drop.includes(x)); const byId = new Map(keep.map(x => [x.id, x]));
        let denied = false;
        for (const c of A.clients.filter(c => consent.has(c.id))){
          const logs = (A.allLogs || []).filter(l => l.user_id === c.id); if (!logs.length) continue;
          const old = byId.get(c.id) || {};
          const row = { name:c.name || "", ...HZ.rankFull(logs, A.appr || {}, c.consent.health ? c.bodyweight : null), hidden: old.hidden === true };
          const { updatedAt, id, ...prev } = old;
          if (JSON.stringify(prev) === JSON.stringify(row)) continue;
          const w = await HZ.api.saveRanking(c.id, { ...row, updatedAt:new Date().toISOString() });
          if (w.error){ denied = true; continue; }
          byId.set(c.id, { id:c.id, ...row });
        }
        if (denied) toast("Części wierszy nie zapisano: wgraj nowe reguły bazy (skrypt u.py albo Firestore → Rules).");
        A.rankRows = [...byId.values()]; if (r.error) toast(HZ.dbError(r.error)); render(); });
      return [el("div", { class:"empty", text:"Wczytuję ranking…" })]; }
    const inRank = new Set(A.rankRows.map(x => x.id));
    const missing = A.clients.filter(c => !inRank.has(c.id)).map(c => {
      const cs = c.consent || {}, n = (A.stats[c.id] || { n:0 }).n;
      const why = !cs.ranking ? (c.manual ? "brak zgody – zaznacz ją w karcie klienta (Klienci → imię)" : "nie włączył/-a rankingu – w aplikacji: Konto → „Pokazuj mnie w rankingu”")
        : !n ? "zgoda jest, ale nie ma jeszcze żadnego treningu" : "zgoda jest – kliknij Odśwież";
      return { c, why }; });
    return [...HZ.rankingView(A.rankRows, null, render, { showHidden:true }),
      missing.length ? el("div", { class:"card" }, el("h3", { text:`Nie ma w rankingu (${missing.length})` }),
        el("p", { class:"small muted", text:"Ranking pokazuje tylko osoby, które się na to zgodziły (RODO). Klient z kontem włącza to sam; za klienta bez konta zaznaczasz zgodę Ty." }),
        el("div", { class:"list" }, missing.map(({ c, why }) => el("div", { class:"row between", style:"flex-wrap:nowrap" },
          el("button", { class:"link", onclick(){ openClient(c.id); }, text:c.name || c.email || "Klient" }), el("span", { class:"small muted", style:"text-align:right", text:why }))))) : null,
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
        el("label", { class:"f", style:"grid-column:1/-1" }, "Sposób wykonania", el("select", { id:`ex-t-${e.id || i}`, value:`${e.modes === "kg" || e.modes === "band" ? e.modes : "both"}:${e.type}`,
          onchange(ev){ const [m, t] = ev.target.value.split(":"); e.modes = m; e.type = t; render(); } },
          el("option", { value:"both:kg", text:"Ciężar lub guma (domyślnie ciężar)" }), el("option", { value:"both:band", text:"Ciężar lub guma (domyślnie guma)" }),
          el("option", { value:"kg:kg", text:"Tylko ciężar (bez gumy, np. przysiad)" }), el("option", { value:"band:band", text:"Tylko guma" }))),
        el("details", { class:"w1", style:"grid-column:1/-1", open: (e.warmStart || (e.warmBand && e.warmBand !== HZ.SCAP) || e.warmLabel || e.warmReps || e.warmKgScap) ? true : null },
          el("summary", { text:"Seria wstępna W1 i ranking (ustalasz sam)" }),
          el("div", { class:"grid2", style:"margin-top:8px" },
            el("label", { class:"f" }, "Ciężar W1 (kg)", el("input", { id:`ex-ws-${e.id || i}`, inputmode:"decimal", value: e.warmStart ? HZ.fmtKg(e.warmStart) : "", placeholder:"np. 20 (gryf)", oninput(ev){ e.warmStart = HZ.parseNum(ev.target.value); } })),
            el("label", { class:"f" }, "Guma W1", el("select", { id:`ex-wb-${e.id || i}`, value: e.warmBand || HZ.SCAP, onchange(ev){ e.warmBand = ev.target.value; } },
              el("option", { value:HZ.SCAP, text:"bez gumy (np. aktywacja)" }), el("option", { value:"auto", text:"najmocniejsza guma" }),
              c.bands.filter(b => b.name.trim()).map(b => el("option", { value:b.id, text:b.name })))),
            el("label", { class:"row small", style:"grid-column:1/-1;flex-wrap:nowrap;cursor:pointer;gap:6px" },
              el("input", { id:`ex-bw-${e.id || i}`, type:"checkbox", style:"width:auto", checked: (e.bwBased ?? e.type === "band") || null, onchange(ev){ e.bwBased = ev.target.checked; } }),
              el("span", { text:"Ćwiczenie z masą ciała (podciąganie, dipy): % masy ciała = masa ciała + dociążenie" })),
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
      if (v.length < 6){ toast("Kod musi mieć co najmniej 6 znaków (np. litery i cyfry), żeby trudno go było zgadnąć."); return; }
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
  const limIn = el("input", { id:"guest-limit", inputmode:"numeric", value:String(S.config.guestLimit || 0), style:"max-width:5rem;text-align:center" });
  const guestCard = el("div", { class:"card" }, el("h2", { text:"Goście" }),
    el("p", { class:"small muted", text:"Nowa osoba może wejść jako gość: tylko imię, bez e-maila. Wyniki zapisują się jak u wszystkich, a po założeniu konta zostają. Możesz wymagać konta po kilku treningach (0 = bez limitu)." }),
    el("div", { class:"row" }, el("span", { class:"small", text:"Gość może zapisać maks.:" }), limIn, el("span", { class:"small", text:"treningów" }),
      el("button", { async onclick(){ const n = Math.max(0, Math.min(20, parseInt(limIn.value, 10) || 0));
        const { error } = await HZ.api.setGuestLimit(n); if (error){ toast(HZ.dbError(error)); return; }
        S.config.guestLimit = n; toast(n ? `Gość musi założyć konto po ${n} ${HZ.plural(n, "treningu", "treningach", "treningach")}` : "Bez limitu dla gości"); render(); }, text:"Zapisz" })));
  return [exCard, bandCard, save, featCard(), codeCard, guestCard, ownCard, rankCard, HZ.themeCard(render)];
}
async function saveLibrary(c){
  const exercises = c.exercises.filter(e => e.name.trim()).map(e => ({ id:e.id || HZ.uuid(), name:e.name.trim().slice(0,80), type: e.modes === "kg" ? "kg" : e.modes === "band" ? "band" : e.type, modes: e.modes === "kg" || e.modes === "band" ? e.modes : "both", incMin:HZ.incRange(e)[0], incMax:HZ.incRange(e)[1], warmStart: Number(e.warmStart) > 0 ? Number(e.warmStart) : null,
    warmBand: e.warmBand || HZ.SCAP, warmKgScap: !!e.warmKgScap, bwBased: e.bwBased ?? e.type === "band", warmLabel:(e.warmLabel || "").trim().slice(0,40), warmReps:(e.warmReps || "").trim().replace(/-/g, "–").slice(0,10) }));
  const bands = c.bands.filter(b => b.name.trim()).map(b => ({ id:b.id || HZ.uuid(), name:b.name.trim().slice(0,40), color:/^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#888888", kg: Number(b.kg) > 0 ? Math.round(Number(b.kg) * 10) / 10 : null, kgMax: Number(b.kgMax) > Number(b.kg) ? Math.round(Number(b.kgMax) * 10) / 10 : null }));
  const { error } = await HZ.api.saveLibrary({ exercises, bands });
  if (error){ toast(HZ.dbError(error)); return false; }
  await HZ.loadConfig(); return true;
}

/* ---------- workouts ---------- */
function workoutsView(){
  if (A.editW) return [workoutEditor()];
  const allWs = HZ.sortedWorkouts().reverse();
  const ws = HZ.groupsOn() && A.group ? allWs.filter(w => (w.group || "") === A.group) : allWs;
  const nextFri = (() => { const d = new Date(); d.setDate(d.getDate() + (5 - d.getDay() + 7) % 7); return d.toLocaleDateString("sv-SE"); })();
  const out = [el("div", { class:"row between" }, el("h2", { text:"Treningi" }), el("button", { class:"primary", onclick(){
    const last = HZ.sortedWorkouts().slice(-1)[0];
    A.editW = { id:null, date:nextFri, title:"", note:"", stations: last ? HZ.clone(last.stations || []).map(s => ({ ...s, id:HZ.uuid() })) : [newStation("main"), newStation("acc")] };
    if (HZ.groupsOn()) A.editW.group = A.group || (last && last.group) || S.config.groups[0].id;
    render(); }, text:"+ Nowy trening" }))];
  if (HZ.groupsOn()) out.push(el("div", { class:"modes", role:"group", "aria-label":"Grupa" },
    [["", "Wszystkie"], ...S.config.groups.map(g => [g.id, g.name])].map(([id, name]) => el("button", { type:"button", "aria-pressed":String((A.group || "") === id), onclick(){ A.group = id; render(); }, text:name }))));
  if (!ws.length) out.push(el("div", { class:"empty", text:"Brak treningów. Dodaj pierwszy piątek, a klienci zobaczą stacje u siebie." }));
  ws.forEach(w => out.push(el("div", { class:"card" },
    el("div", { class:"row between" },
      el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:(HZ.groupsOn() && HZ.groupName(w.group) ? HZ.groupName(w.group) + " · " : "") + `#${HZ.workoutNo(w.id)} · ${HZ.fmtDate(w.date, true)}` + (w.open ? " · trwa" : "") }), el("h3", { text:w.title || "Trening stacyjny" })),
      el("div", { class:"row" }, S.config.features.requireStart ? openBtn(w) : null, el("button", { onclick(){ A.editW = HZ.clone(w); render(); }, text:"Edytuj" }),
        el("button", { class:"ghost", onclick(){ const c = HZ.clone(w); delete c.open; delete c.openedAt; delete c.closedAt;
          A.editW = { ...c, id:null, date:nextFri, stations:(c.stations || []).map(s2 => ({ ...s2, id:HZ.uuid() })) }; render(); window.scrollTo(0, 0); toast("Kopia treningu – ustaw datę i zapisz"); }, text:"Kopiuj" }),
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
    HZ.groupsOn() ? el("label", { class:"f" }, "Grupa / zajęcia", el("select", { id:"we-group", value:w.group || S.config.groups[0].id, onchange(e){ w.group = e.target.value; } },
      S.config.groups.map(g => el("option", { value:g.id, text:g.name })))) : null,
    w.id ? el("p", { class:"small muted", text:"Zmiany zobaczą klienci w ciągu ok. 30 s, także w trakcie treningu. Gdy zmniejszysz liczbę serii, puste serie znikną u nich same; wpisane zostają." }) : null,
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
        const row = { ...(w.group ? { group:w.group } : {}), ...(w.open != null ? { open:w.open } : {}), ...(w.openedAt ? { openedAt:w.openedAt } : {}), ...(w.closedAt ? { closedAt:w.closedAt } : {}), id:w.id || HZ.uuid(), date:w.date, title:(w.title || "").trim(), note:(w.note || "").trim(), rir: w.rir ?? null,
          stations:w.stations.filter(s => s.exId).map(s => ({ id:s.id, section:HZ.secOf(s), superset: HZ.secOf(s) !== "main" && !!s.superset, exId:s.exId, warmup: HZ.secOf(s) === "main" ? (s.warmup || 0) : 0, sets:s.sets || 3, reps:s.reps || 5, rir: s.rir ?? null, work:(s.work||"").trim(), rest:(s.rest||"").trim(), note:(s.note||"").trim() })) };
        ev.currentTarget.disabled = true;
        const { data, error } = await HZ.api.saveWorkout(row);
        if (error){ toast(HZ.dbError(error)); render(); return; }
        S.workouts = S.workouts.filter(x => x.id !== data.id).concat(data); A.editW = null; toast("Zapisano trening. Klienci już go widzą.");
        if (A.backTo){ const b = A.backTo; A.backTo = null; await openClient(b); openEntry(A.clients.find(c => c.id === b), data.id); return; }
        render(); }, text:"Zapisz trening" }),
      el("button", { onclick(){ A.editW = null; if (A.backTo){ const b = A.backTo; A.backTo = null; openClient(b); return; } render(); }, text:"Anuluj" })));
}

/* ---------- results ---------- */
async function loadResults(wid){
  A.res = { wid, rows:null, loading:true }; render();
  const { data, error } = await HZ.api.logsForWorkout(wid);
  if (error){ toast(HZ.dbError(error)); A.res = { wid, rows:[], loading:false }; render(); return; }
  const [dr, tq] = await Promise.all([HZ.api.draftsForWorkout(wid), HZ.api.techniqueFor(wid)]);
  A.res.drafts = new Map(((dr && dr.data) || []).map(x => [x.user_id, x])); A.res.tech = Object.fromEntries(((tq && tq.data) || []).map(x => [x.id, x.items || {}]));
  const byUser = new Map(data.map(l => [l.user_id, l]));
  const rows = A.clients.map(c => ({ client:c, log:byUser.get(c.id) || null }));
  for (const l of data) if (!A.clients.some(c => c.id === l.user_id)) rows.push({ client:{ id:l.user_id, name:"(trener)" }, log:l });
  rows.sort((a,b) => (b.log ? 1 : 0) - (a.log ? 1 : 0) || (a.client.name || "").localeCompare(b.client.name || "", "pl"));
  A.res = { ...A.res, wid, rows, loading:false }; render();
}
function resultsView(){
  const ws = HZ.sortedWorkouts(); if (!ws.length) return [el("div", { class:"empty", text:"Wyniki pojawią się, gdy dodasz trening i klienci zapiszą serie." })];
  const wid = A.res.wid && ws.some(w => w.id === A.res.wid) ? A.res.wid : HZ.defaultWorkoutId();
  if (!A.res.loading && (A.res.wid !== wid || !A.res.rows)) setTimeout(() => loadResults(wid), 0);
  const pick = el("select", { id:"res-w", "aria-label":"Trening", onchange(e){ loadResults(e.target.value); } },
    [...ws].reverse().map(w => el("option", { value:w.id, text:`${HZ.workoutLabel(w)}` })));
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
    el("div", { class:"row" }, S.config.features.requireStart ? openBtn(ws.find(w => w.id === wid)) : null, el("button", { onclick(){ loadResults(wid); }, text:"Odśwież" }), done.length ? el("button", { onclick(){ exportCsv(wid, done); }, text:"Pobierz CSV" }) : null))];
  const q = approvalCard(); if (q) out.unshift(q);
  if (rows && !A.clients.length) out.push(el("div", { class:"empty", text:"Nikt jeszcze nie założył konta. Wyślij klientom link do strony głównej i kod klubu." }));
  if (rows) rows.forEach(({ client, log }) => { const draft = A.res.drafts && A.res.drafts.get(client.id); const newer = draft && (!log || (draft.saved_at || "") > (log.saved_at || "")) ? draft : null;
    out.push(el("div", { class:"card" },
    el("div", { class:"row between" }, el("h3", { text:client.name || client.email || "Klient" }),
      el("div", { class:"row" }, log && log.fatigue != null ? el("span", { class:"chip", text:`Zmęczenie ${log.fatigue}/10` }) : null,
        A.clients.some(c => c.id === client.id) ? el("button", { onclick(){ openEntry(client, wid); }, text: log ? "Edytuj wyniki" : "Wpisz wyniki" }) : null,
        el("button", { class:"ghost", onclick(){ openClient(client.id); }, text:"Historia →" }))),
    client.manual ? el("span", { class:"chip", style:"align-self:flex-start", text:"bez konta · wpisuje trener" }) : null,
    log && log.pain ? el("span", { class:"chip bad", style:"align-self:flex-start;white-space:normal", text:"Ból: " + log.pain }) : null,
    log ? el("div", { class:"list" }, (log.entries || []).map(e => el("div", { class:"stack", style:"gap:4px" },
        el("span", { style:"font-weight:600", text:`${e.exName} · cel ${e.targetSets}×${e.targetReps}` }),
        el("span", { class:"num", style:"font-size:1.05rem", text:HZ.setsText(e) }),
        techPick(log, client, wid, e))))
      : newer ? null : el("span", { class:"muted small", text:"Brak wpisu z tego treningu." }),
    newer ? draftBox(newer, client, wid, !!log) : null,
    log && log.note ? el("p", { class:"small", text:"Notatka / feedback: " + log.note }) : null)); });
  return out;
}
function exportCsv(wid, rows){
  const w = S.workouts.find(x => x.id === wid);
  const lines = [["data","trening","klient","cwiczenie","cel","typ","seria","obciazenie","powtorzenia","RIR","zmeczenie"].join(";")];
  for (const { client, log } of rows) for (const e of (log.entries || [])){ let wi = 0, ri = 0; e.sets.forEach(s => lines.push([log.date, "#" + HZ.workoutNo(wid), client.name, e.exName, `${e.targetSets}x${e.targetReps}`, s.warmup ? "wstepna" : "robocza", s.warmup ? ++wi : ++ri,
    e.type === "band" ? HZ.bandName(s.load) : (s.load == null ? "" : String(s.load).replace(".", ",")), s.reps, s.rir ?? "", log.fatigue ?? ""]
    .map(v => { let t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; }).join(";"))); }   // no spreadsheet formula injection
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
  const sg = HZ.suggest(HZ.dropRejected(logs, A.appr || {}), ex.id, mode, ex, w.id, HZ.targetRir(w, st));
  return HZ.buildSets({ ...ex, type:mode }, HZ.secOf(st) === "main" ? (st.warmup || 0) : 0, st.sets || 3, sg.next ?? null);
}
function entryView(){
  const { client, w, d, logs } = A.entry;
  const order = HZ.orderStations(w.stations || []); const labels = HZ.stationLabels(order);
  const out = [el("div", { class:"card" },
    el("span", { class:"eyebrow", text:`Wpisujesz za: ${client.name}` }),
    el("h2", { text:`Trening #${HZ.workoutNo(w.id)} · ${HZ.fmtDate(w.date)}` }),
    el("p", { class:"small muted", text:"Wpisz ciężar lub gumę i powtórzenia. Puste serie się nie zapiszą." + (client.manual ? "" : " Klient zobaczy ten trening u siebie w historii i postępach.") }))];
  for (const sec of HZ.SECTIONS){
    const items = order.filter(st => HZ.secOf(st) === sec.key && HZ.exById(st.exId)); if (!items.length) continue;
    out.push(el("div", { class:"sechead" }, el("h2", { text:sec.title }), el("span", { class:"eyebrow", text:sec.sub })));
    for (const st of items){
      const exBase = HZ.exById(st.exId), isMain = sec.key === "main";
      const mode = HZ.modeFor(exBase, d.mode[st.id]); if (d.mode[st.id] && d.mode[st.id] !== mode){ d.mode[st.id] = mode; d.st[st.id] = null; }
      const ex = { ...exBase, type:mode };
      const sets = d.st[st.id] || (d.st[st.id] = entrySets(w, st, exBase, mode, logs));
      HZ.refreshWarmups(ex, sets);
      const tRir = HZ.targetRir(w, st); const sg = HZ.suggest(HZ.dropRejected(logs, A.appr || {}), ex.id, mode, exBase, w.id, tRir);
      out.push(el("section", { class:"card station" + (isMain ? " main" : "") },
        el("div", { class:"row between", style:"align-items:flex-start" },
          el("div", { class:"stack", style:"gap:2px" }, el("span", { class:"eyebrow", text:labels[st.id] }), el("h3", { text:ex.name })),
          el("div", { class:"row", style:"gap:4px" }, el("span", { class:"badge", text:`${st.sets || "?"} × ${st.reps || "?"}` }), tRir != null ? el("span", { class:"badge rir", text:`RIR ${tRir}` }) : null)),
        HZ.modeToggle(mode, m => { d.mode[st.id] = m; d.st[st.id] = entrySets(w, st, exBase, m, logs); render(); }, exBase),
        HZ.tipBox(sg, load => { HZ.applyLoad(ex, sets, load); render(); }, (sets.find(s => !s.warmup) || {}).load),
        isMain && mode === "kg" && sets.some(s => s.warmup) ? HZ.targetBox(ex, sets, render, `en-${st.id}`) : null,
        HZ.setsEditor(ex, sets, `en-${st.id}`, structural => { if (structural) render(); }, { repsHint:sg.reps, noWarmup:!isMain, noRir:(S.config.features || {}).rir === "off" })));
    }
  }
  out.push(el("div", { class:"card" }, el("h3", { text:"Zmęczenie po treningu" }),
    HZ.fatiguePicker(d.fatigue, v => { d.fatigue = v; render(); }),
    el("label", { class:"f" }, "Notatka / feedback (opcjonalnie)", el("textarea", { id:"en-note", maxlength:"1000", value:d.note, oninput(e){ d.note = e.target.value; } })),
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
  // results typed in by the trainer are trusted: records from this entry are approved automatically
  for (const pd of HZ.computeStats(all, A.appr || {}).pending.filter(x => x.logId === data.id)){
    const r2 = await HZ.api.setApproval(pd.logId, client.id, pd.stationId, "ok");
    if (!r2.error){ const ap = A.appr[pd.logId] || (A.appr[pd.logId] = { id:pd.logId, user_id:client.id, items:{} }); ap.items = { ...(ap.items || {}), [pd.stationId]:"ok" }; } }
  if (S.config.rankingEnabled !== false) await syncManualRanking(client, all);
  if (A.clientId === client.id) A.clientLogs = all;   // client view shows the new entry right away
  A.entry = null; A.rankRows = null; toast(`Zapisano wyniki: ${client.name}`);
  await loadClients().catch(() => {}); loadResults(w.id);
}

/* ranking row of a client without an account: only with the consent the trainer recorded */
async function syncManualRanking(c, logs){
  const cs = c.consent || {};
  if (!cs.ranking){ await HZ.api.deleteRanking(c.id); return; }
  const rk = await HZ.api.saveRanking(c.id, { name:c.name, ...HZ.rankFull(logs || [], A.appr || {}, cs.health ? c.bodyweight : null), hidden:false, updatedAt:new Date().toISOString() });
  if (rk.error) toast("Ranking się nie zaktualizował: opublikuj nowe reguły w Firebase.");
}
async function setManualConsent(c, patch, extra = {}){
  const consent = HZ.makeConsent(c.consent, { ...patch, by:"trener" });
  const { error } = await HZ.api.updateProfile(c.id, { consent, ...extra });
  if (error){ toast(error.code === "permission-denied" ? "Opublikuj nowe reguły w Firebase (Firestore → Rules)." : HZ.dbError(error)); return false; }
  c.consent = consent; Object.assign(c, extra.bodyweight !== undefined ? { bodyweight:extra.bodyweight } : {});
  const logs = A.clientId === c.id && A.clientLogs ? A.clientLogs : ((await HZ.api.logsOf(c.id)).data || []);
  await syncManualRanking(c, logs); A.rankRows = null; return true;
}

/* ---------- clients ---------- */
async function openClient(id){
  A.tab = "clients"; HZ.LS.set("hz-admin-tab", "clients"); A.clientId = id; A.clientLogs = null; A.clientTech = null; render();
  HZ.api.techniqueOf(id).then(r => { A.clientTech = (r && r.data) || []; render(); });
  HZ.api.planOf(id).then(r => { A.clientPlan = (r && r.data) || {}; render(); });
  const { data, error } = await HZ.api.logsOf(id);
  if (error){ toast(HZ.dbError(error)); A.clientLogs = []; } else A.clientLogs = data;
  render(); window.scrollTo(0, 0);
}
function clientsView(){
  if (A.clientId){
    const c = A.clients.find(x => x.id === A.clientId) || { name:"Klient" };
    const cs = c.consent || {};
    const delBar = el("div", { class:"row" },
      c.manual ? el("span", { class:"chip", text:"bez konta · wyniki wpisujesz Ty" }) : null,
      c.guest ? el("span", { class:"chip", text:"gość · jeszcze bez e-maila" }) : null,
      A.confirmDelClient === c.id
        ? el("span", { class:"stack", style:"gap:6px" }, el("span", { class:"small", text: c.manual ? "Usunąć klienta i wszystkie jego wyniki na stałe?" : "Usunąć profil, wszystkie wyniki i wpis w rankingu tego klienta? Jego konto logowania zostanie (usuniesz je w Firebase → Authentication). Tego nie da się cofnąć." }),
            el("span", { class:"row" },
              el("button", { class:"danger", async onclick(ev){ ev.currentTarget.disabled = true; const { error } = await HZ.api.deleteClientData(c.id); if (error){ toast(HZ.dbError(error)); ev.currentTarget.disabled = false; return; }
                A.clients = A.clients.filter(x => x.id !== c.id); A.clientId = null; A.confirmDelClient = null; A.rankRows = null; toast("Usunięto dane klienta"); render(); }, text:"Usuń na stałe" }),
              el("button", { onclick(){ A.confirmDelClient = null; render(); }, text:"Anuluj" })))
        : el("button", { class:"ghost", onclick(){ A.confirmDelClient = c.id; render(); }, text: c.manual ? "Usuń klienta" : "Usuń dane klienta (RODO)" }));
    const consentBar = el("p", { class:"small muted", text: c.manual
        ? `Zgody (zebrane przez Ciebie): ranking ${cs.ranking ? "tak" : "nie"}, masa ciała ${cs.health ? "tak" : "nie"}.`
        : `Zgody klienta: polityka ${HZ.consentOk(c) ? "zaakceptowana" : "jeszcze nie"}, ranking ${cs.ranking ? "tak" : "nie"}, masa ciała ${cs.health ? "tak" : "nie"}.` });
    const bwIn = el("input", { id:"cl-bw", inputmode:"decimal", placeholder:"kg", value: c.bodyweight ? HZ.fmtKg(c.bodyweight) : "", style:"max-width:6rem;text-align:center" });
    const hcIn = el("input", { id:"cl-health", type:"checkbox", style:"width:auto;margin-top:3px", checked: cs.health || null });
    const rkIn = el("input", { id:"cl-rank", type:"checkbox", style:"width:auto;margin-top:3px", checked: cs.ranking || null,
      async onchange(ev){ if (await setManualConsent(c, { ranking:ev.target.checked })) { toast(ev.target.checked ? "Klient w rankingu" : "Usunięto z rankingu"); render(); } } });
    const bwBar = c.manual ? el("div", { class:"card" }, el("h3", { text:"Zgody i masa ciała" }),
        el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, rkIn, el("span", { text:"Klient zgodził się na udział w rankingu grupy." })),
        el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, hcIn, el("span", { text:"Klient wyraził wyraźną zgodę na przetwarzanie masy ciała (dane o zdrowiu) do rankingu siły względnej." })),
        el("div", { class:"row" }, el("span", { class:"small", text:"Masa ciała:" }), bwIn,
          el("button", { async onclick(){ const v = HZ.parseNum(bwIn.value); if (v != null && (v < 25 || v > 300)){ toast("Wpisz masę ciała w kg."); return; }
            if (v != null && !hcIn.checked){ toast("Zaznacz, że klient zgodził się na przetwarzanie masy ciała."); return; }
            const bw = v == null || !hcIn.checked ? null : Math.round(v * 10) / 10;
            if (await setManualConsent(c, { health: bw != null }, { bodyweight:bw })) { toast(bw != null ? "Zapisano masę ciała" : "Usunięto masę ciała"); render(); } }, text:"Zapisz" })))
      : el("p", { class:"small muted", text: c.bodyweight ? `Masa ciała: ${HZ.fmtKg(c.bodyweight)} kg` : "Masa ciała: nie wpisana (klient wpisuje ją w Konto, za zgodą)" });
    const advBar = c.manual ? null : el("label", { class:"row small", style:"flex-wrap:nowrap;cursor:pointer;gap:8px" },
      el("input", { id:"cl-adv", type:"checkbox", style:"width:auto", checked: c.advanced || null, async onchange(ev){ const on = ev.target.checked; const { error } = await HZ.api.setAdvanced(c.id, on);
        if (error){ ev.target.checked = !on; toast(error.code === "permission-denied" ? "Wgraj nowe reguły bazy (skrypt u.py)." : HZ.dbError(error)); return; } c.advanced = on; toast(on ? "Klient zaawansowany: widzi funkcje „dla zaawansowanych”" : "Zwykły widok klienta"); render(); } }),
      el("span", {}, el("b", { text:"Klient zaawansowany" }), " – widzi funkcje, które w ustawieniach są włączone „dla zaawansowanych” (np. RIR)."));
    return [el("div", { class:"row" }, el("button", { onclick(){ A.clientId = null; render(); }, text:"← Wszyscy klienci" }), el("span", { class:"small muted", text:c.email || "" })), pastCard(c), advBar, planCard(c), S.config.features.custom ? customCard(c) : null, techHistory(c), delBar, consentBar, bwBar,
      ...(A.clientLogs ? [A.clientLogs.length ? HZ.personalStats(A.clientLogs, `Statystyki: ${c.name || "klient"}`, A.appr || {}) : null, ...HZ.progressView(A.clientLogs, c.name || "Klient", "c-" + A.clientId, render)] : [el("div", { class:"empty", text:"Wczytuję historię…" })])];
  }
  const nameIn = el("input", { id:"manual-name", maxlength:"60", placeholder:"Imię (i nazwisko)" });
  const infIn = el("input", { id:"manual-inf", type:"checkbox", style:"width:auto;margin-top:3px" });
  const rkIn = el("input", { id:"manual-rank", type:"checkbox", style:"width:auto;margin-top:3px" });
  const addCard = el("div", { class:"card" }, el("h3", { text:"Dodaj klienta bez konta" }),
    el("p", { class:"small muted", text:"Dla osób bez telefonu. Wyniki wpisujesz za nich w zakładce Wyniki (przycisk „Wpisz wyniki”). Pojawiają się w rankingu i statystykach jak wszyscy." }),
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, infIn,
      el("span", {}, "Klient ma ukończone 16 lat i został poinformowany o przetwarzaniu danych (", HZ.policyLink("polityka prywatności"), "). (wymagane)")),
    el("label", { class:"row small consent", style:"flex-wrap:nowrap;align-items:flex-start;gap:8px;cursor:pointer" }, rkIn,
      el("span", { text:"Klient zgodził się na udział w rankingu grupy. (dobrowolne)" })),
    el("div", { class:"row", style:"flex-wrap:nowrap" }, nameIn,
      el("button", { class:"primary", style:"white-space:nowrap", async onclick(ev){ const n = nameIn.value.trim().slice(0, 60); if (!n){ toast("Wpisz imię."); return; }
        if (!infIn.checked){ toast("Zaznacz, że klient został poinformowany o przetwarzaniu danych."); return; }
        ev.currentTarget.disabled = true; const { data, error } = await HZ.api.addManualClient(n, HZ.makeConsent(null, { age16:true, ranking:rkIn.checked, by:"trener" }));
        if (error){ toast(error.code === "permission-denied" ? "Firebase odrzucił zapis: wklej aktualny plik firestore.rules w Firestore → Rules i kliknij Publish." : HZ.dbError(error)); render(); return; }
        A.clients.push(data); A.clients.sort((a,b) => (a.name || "").localeCompare(b.name || "", "pl")); toast(`Dodano: ${n}`); render(); }, text:"Dodaj" })));
  const stale = A.clients.filter(c => c.guest && guestIdleDays(c) >= 90);
  const cleanCard = stale.length ? el("div", { class:"notice" }, el("span", { class:"small", text:`${stale.length} ${HZ.plural(stale.length, "gość nie trenuje", "gości nie trenuje", "gości nie trenuje")} od ponad 90 dni i nie ${stale.length === 1 ? "założył" : "założyło"} konta. Zgodnie z polityką prywatności usuń ich dane.` }),
    el("button", { class:"danger", async onclick(ev){ ev.currentTarget.disabled = true;
      for (const c of stale){ const { error } = await HZ.api.deleteClientData(c.id); if (error){ toast(HZ.dbError(error)); break; } A.clients = A.clients.filter(x => x.id !== c.id); }
      A.rankRows = null; toast("Usunięto nieaktywnych gości"); render(); }, text:"Usuń ich dane" })) : null;
  if (!A.clients.length) return [inviteCard(), addCard, el("div", { class:"empty" }, el("h3", { text:"Brak klientów" }), el("p", { class:"small", text:"Klienci pojawią się tu po założeniu konta na stronie głównej z kodem klubu albo gdy dodasz ich powyżej." }))];
  return [inviteCard(), cleanCard, addCard, el("div", { class:"card" },
    el("div", { class:"row between" }, el("h2", { text:`Klienci (${A.clients.length})` }), el("button", { async onclick(){ await loadClients(); render(); toast("Odświeżono"); }, text:"Odśwież" })),
    el("div", { class:"tablewrap" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", { text:"Imię" }), el("th", { text:"Treningi" }), el("th", { text:"Ostatni" }), el("th", { text:"Śr. zmęcz." }))),
      el("tbody", {}, A.clients.map(c => { const s = A.stats[c.id] || { n:0 };
        return el("tr", {},
          el("td", {}, el("button", { class:"link", onclick(){ openClient(c.id); }, text:c.name || c.email }), " ", el("button", { class:"ghost small", style:"padding:2px 8px", onclick(){ openClient(c.id); }, text:"+ wyniki" }), c.manual ? el("span", { class:"small muted", text:" · bez konta" }) : null, c.guest ? el("span", { class:"chip", style:"margin-left:6px", text:"gość" }) : null),
          el("td", { text:s.n }), el("td", { text: s.last ? HZ.fmtDate(s.last) : "–" }),
          el("td", { text: s.fn ? (s.fsum / s.fn).toLocaleString("pl-PL", { maximumFractionDigits:1 }) : "–" })); })))))];
}

/* ---------- plan for the next training: trainer's weight & reps, or approve the system's suggestion ---------- */
function planCard(c){
  const logs = A.clientLogs; if (!logs || !logs.length || !A.clientPlan) return null;
  const sorted = [...logs].sort((a,b) => (b.date || "").localeCompare(a.date || ""));
  const mainIds = new Set(S.workouts.flatMap(w => (w.stations || []).filter(st => HZ.secOf(st) === "main").map(st => st.exId)));
  const seen = new Map(); for (const l of sorted) for (const e of (l.entries || [])) if (!seen.has(e.exId) && HZ.exById(e.exId)) seen.set(e.exId, e.type || "kg");
  const items = [...seen.entries()].sort((a,b) => (mainIds.has(b[0]) ? 1 : 0) - (mainIds.has(a[0]) ? 1 : 0));
  const save = async (exId, val) => { const { error } = await HZ.api.setPlan(c.id, exId, val);
    if (error){ toast(error.code === "permission-denied" ? "Wgraj nowe reguły bazy (skrypt u.py)." : HZ.dbError(error)); return; }
    A.clientPlan[exId] = val; toast(val ? "Ustawione na następny trening" : "Usunięto – klient dostanie zwykłą podpowiedź"); render(); };
  return el("div", { class:"card" }, el("h3", { text:"Na następny trening" }),
    el("p", { class:"small muted", text:"Klient zobaczy Twoje zalecenie zamiast podpowiedzi systemu (do czasu, aż zrobi to ćwiczenie). Zatwierdź podpowiedź jednym kliknięciem albo wpisz swoją." }),
    el("div", { class:"list" }, items.map(([exId, type]) => {
      const ex = HZ.exById(exId), base = S.config.features.custom ? HZ.progEx(ex, c.progression) : ex;
      const sg = HZ.suggest(HZ.dropRejected(logs, A.appr || {}), exId, type, base);
      const tip = HZ.trainerTip(A.clientPlan, logs, exId, type);
      const draft = (A.planDraft = A.planDraft || {})[c.id + exId] || (A.planDraft[c.id + exId] = { load: sg.next ?? null, reps: sg.reps || "" });
      return el("div", { class:"stack", style:"gap:6px" },
        el("div", { class:"row between", style:"flex-wrap:nowrap" }, el("b", { text:ex.name }), tip ? el("span", { class:"chip", text:"✓ " + tip.title.replace("Trener zaleca: ", "") }) : null),
        el("span", { class:"small muted", text:"System: " + sg.title }),
        el("div", { class:"row", style:"flex-wrap:nowrap;gap:6px" },
          el("div", { style:"flex:1;min-width:0" }, HZ.loadInput({ ...ex, type }, draft.load, v => { draft.load = v; }, `pl-l-${exId}`)),
          el("input", { id:`pl-r-${exId}`, placeholder:"powt.", maxlength:"10", value:draft.reps, style:"width:5.5rem;text-align:center", oninput(e){ draft.reps = e.target.value; } })),
        el("div", { class:"row" },
          sg.next != null ? el("button", { class:"primary", onclick(){ save(exId, { load:sg.next, reps:sg.reps || "", type, at:new Date().toISOString(), src:"system" }); }, text:"✓ Zatwierdź podpowiedź" }) : null,
          el("button", { onclick(){ if (draft.load == null || draft.load === ""){ toast("Wpisz ciężar albo wybierz gumę."); return; }
            save(exId, { load:draft.load, reps:String(draft.reps || "").trim().replace(/-/g, "–").slice(0, 10), type, at:new Date().toISOString(), src:"trener" }); }, text:"Zapisz moje" }),
          tip ? el("button", { class:"ghost", onclick(){ save(exId, null); }, text:"Usuń" }) : null)); })));
}
/* individual progression + extra task (feature "custom") */
function customCard(c){
  const task = el("textarea", { id:"cl-task", maxlength:"300", value:c.task || "", placeholder:"np. Dodatkowo 3×10 pompek na koniec" });
  const saveU = async patch => { const { error } = await HZ.api.updateClient(c.id, patch);
    if (error){ toast(error.code === "permission-denied" ? "Wgraj nowe reguły bazy (skrypt u.py)." : HZ.dbError(error)); return false; } Object.assign(c, patch); render(); return true; };
  return el("div", { class:"card" }, el("h3", { text:"Indywidualna progresja" }),
    el("label", { class:"f" }, "Tempo progresji", el("select", { id:"cl-prog", value:c.progression || "std", async onchange(e){ if (await saveU({ progression:e.target.value })) toast("Zapisano progresję"); } },
      el("option", { value:"std", text:"Standardowa" }), el("option", { value:"fast", text:"Szybsza – większe skoki ciężaru" }), el("option", { value:"slow", text:"Wolniejsza – tylko najmniejszy skok" }))),
    el("label", { class:"f" }, "Dodatkowe zadanie (klient zobaczy je na treningu)", task),
    el("div", { class:"row" }, el("button", { onclick(){ saveU({ task:task.value.trim().slice(0, 300) }).then(ok => ok && toast("Zapisano zadanie")); }, text:"Zapisz zadanie" }),
      c.task ? el("button", { class:"ghost", onclick(){ saveU({ task:"" }).then(ok => ok && toast("Usunięto zadanie")); }, text:"Usuń" }) : null));
}

/* ---------- client features (simple by default; more for advanced clients) ---------- */
function featCard(){
  const f = S.config.features;
  const save = async patch => { const { error } = await HZ.api.setFeatures(patch); if (error){ toast(HZ.dbError(error)); return; } Object.assign(f, patch); HZ.applyHolo(); toast("Zapisano"); render(); };
  const sel = (key, label, hint) => el("label", { class:"f" }, label,
    el("select", { id:"feat-" + key, value:f[key], onchange(e){ save({ [key]:e.target.value }); } },
      el("option", { value:"off", text:"Wyłączone" }), el("option", { value:"adv", text:"Tylko klienci zaawansowani" }), el("option", { value:"all", text:"Wszyscy klienci" })),
    hint ? el("span", { class:"small muted", style:"font-weight:400", text:hint }) : null);
  const chk = (key, label, hint, onTurnOn) => el("label", { class:"row small", style:"flex-wrap:nowrap;align-items:flex-start;cursor:pointer;gap:8px" },
    el("input", { id:"feat-" + key, type:"checkbox", style:"width:auto;margin-top:3px", checked: f[key] ? true : null, onchange(e){ save({ [key]:e.target.checked, ...(e.target.checked && onTurnOn ? onTurnOn() : {}) }); } }),
    el("span", {}, el("b", { text:label }), hint ? " – " + hint : ""));
  return el("div", { class:"card" }, el("h2", { text:"Funkcje dla klientów" }),
    el("p", { class:"small muted", text:"Domyślnie widok klienta jest prosty. Bardziej zaawansowane rzeczy włączasz wszystkim albo tylko klientom oznaczonym jako zaawansowani (Klienci → imię). Ty w panelu widzisz zawsze wszystko." }),
    el("div", { class:"grid2" },
      sel("rir", "RIR (zapas powtórzeń)", "Bez RIR podpowiedzi opierają się na zrobionych powtórzeniach."),
      sel("acc", "Akcesoria (stacje)", "Wyłączone: klient widzi tylko trening główny. Akcesoria zostają w planie."),
      sel("pain", "„Czy coś bolało?” (beta)", "Po wpisaniu klient dostaje radę: zmniejsz ciężar albo zapytaj trenera.")),
    chk("requireStart", "Wpisywanie dopiero po rozpoczęciu treningu", "w Treningach klikasz „Rozpocznij” na zajęciach i „Zakończ” po nich. Bez tego nikt spoza zajęć nic nie wpisze."),
    chk("approve", "Każdy rekord ciężaru zatwierdzam ja", "bez tego zatwierdzasz tylko podejrzanie duże skoki (więcej niż 2× skok ciężaru albo 10%). Niezatwierdzone nie liczą się do rankingu.", () => ({ approveSince:HZ.todayISO() })),
    chk("holo", "Animacja holograficzna podium", "błyszczące naklejki za 1., 2. i 3. miejsce w rankingu."),
    chk("custom", "Indywidualna progresja i zadania", "w karcie klienta ustawisz szybszą lub wolniejszą progresję i dodatkowe zadanie, które zobaczy na treningu."),
    chk("groups", "Podział na grupy treningów", "np. „Piątek – grupa” i „Wtorek – siłownia”. Klient wybiera zajęcia, Ty filtrujesz treningi po grupie."),
    f.groups ? groupsEditor() : null);
}
function groupsEditor(){
  const g = A.editGroups || (A.editGroups = HZ.clone(S.config.groups || []));
  return el("div", { class:"stack", style:"gap:8px;border-top:1px solid var(--line);padding-top:10px" }, el("h3", { text:"Grupy" }),
    g.length ? null : el("p", { class:"small muted", text:"Dodaj przynajmniej dwie grupy. Istniejące treningi bez grupy przypiszesz w edycji treningu." }),
    g.map((x, i) => el("div", { class:"row", style:"flex-wrap:nowrap" }, el("input", { id:"grp-" + i, maxlength:"40", value:x.name, placeholder:"np. Piątek – grupa", oninput(e){ x.name = e.target.value; } }),
      el("button", { class:"ghost", "aria-label":"Usuń grupę", onclick(){ g.splice(i, 1); render(); }, text:"✕" }))),
    el("div", { class:"row" }, el("button", { onclick(){ g.push({ id:HZ.uuid().slice(0, 8), name:"" }); render(); }, text:"+ Grupa" }),
      el("button", { class:"primary", async onclick(){ const clean = g.filter(x => x.name.trim()).map(x => ({ id:x.id, name:x.name.trim().slice(0, 40) }));
        const { error } = await HZ.api.saveGroups(clean); if (error){ toast(HZ.dbError(error)); return; } S.config.groups = clean; A.editGroups = null; toast("Zapisano grupy"); render(); }, text:"Zapisz grupy" })));
}
function openBtn(w){
  if (!w || (!w.open && w.date < HZ.todayISO())) return null;   // past trainings can't be started
  return w.open ? el("button", { class:"danger", async onclick(ev){ ev.currentTarget.disabled = true; const { error } = await HZ.api.setWorkoutOpen(w.id, false); if (error){ toast(HZ.dbError(error)); return; }
      w.open = false; w.closedAt = new Date().toISOString(); toast("Zakończono – klienci nie mogą już wpisywać"); render(); }, text:"■ Zakończ wpisywanie" })
    : el("button", { class:"primary", async onclick(ev){ ev.currentTarget.disabled = true; const { error } = await HZ.api.setWorkoutOpen(w.id, true); if (error){ toast(HZ.dbError(error)); return; }
      w.open = true; delete w.closedAt; toast("Trening rozpoczęty – klienci mogą wpisywać"); render(); }, text: w.closedAt ? "▶ Otwórz ponownie" : "▶ Rozpocznij trening" });
}
/* records waiting for the trainer: big jumps always, every weight record when approval is on */
function pendingAll(){
  if (!A.allLogs) return [];
  const byUser = {}; for (const l of A.allLogs) (byUser[l.user_id] = byUser[l.user_id] || []).push(l);
  return A.clients.flatMap(c => HZ.computeStats(byUser[c.id] || [], A.appr || {}).pending.map(p => ({ ...p, client:c })));
}
async function decide(p, val){
  const { error } = await HZ.api.setApproval(p.logId, p.client.id, p.stationId, val);
  if (error){ toast(error.code === "permission-denied" ? "Wgraj nowe reguły bazy (skrypt u.py)." : HZ.dbError(error)); return; }
  const a = A.appr[p.logId] || (A.appr[p.logId] = { id:p.logId, user_id:p.client.id, items:{} }); a.items = { ...(a.items || {}), [p.stationId]:val };
  if (S.config.rankingEnabled !== false && p.client.consent && p.client.consent.ranking) await syncManualRanking(p.client, A.allLogs.filter(l => l.user_id === p.client.id));
  A.rankRows = null; toast(val === "ok" ? "Zatwierdzono rekord" : "Odrzucono – nie liczy się do rekordów"); render();
}
function approvalCard(){
  const list = pendingAll(); if (!list.length) return null;
  return el("div", { class:"card", style:"border-color:var(--accent)" }, el("h2", { text:`Rekordy do zatwierdzenia (${list.length})` }),
    el("p", { class:"small muted", text:"Nie liczą się do rekordów i rankingu, dopóki ich nie zatwierdzisz. Odrzucony wynik zostaje w historii klienta." }),
    el("div", { class:"list" }, list.map(p => el("div", { class:"stack", style:"gap:6px" },
      el("div", { class:"row between", style:"flex-wrap:nowrap" }, el("b", { text:`${p.client.name} · ${p.name}` }), el("span", { class:"chip" + (p.reason === "duży skok" ? " warn" : ""), text:p.reason })),
      el("span", { class:"small", text:`${p.from === 0 ? "bez ciężaru" : HZ.fmtKg(p.from) + " kg"} → ${HZ.fmtKg(p.to)} kg × ${p.reps} (${HZ.fmtDate(p.date)}), +${HZ.fmtKg(Math.round((p.to - p.from) * 100) / 100)} kg` }),
      el("div", { class:"row" }, el("button", { class:"primary", onclick(){ decide(p, "ok"); }, text:"✓ Zatwierdź" }), el("button", { class:"ghost", onclick(){ decide(p, "no"); }, text:"✕ Odrzuć" }))))));
}
/* unsent draft: the trainer sees it and can save it as the result */
function draftBox(dr, client, wid, hasLog){
  return el("div", { class:"stack", style:"gap:6px;border:1px dashed var(--line);border-radius:8px;padding:8px" },
    el("span", { class:"chip warn", style:"align-self:flex-start", text:`${hasLog ? "Niewysłane zmiany" : "Nie wysłano"} · wersja robocza z ${new Date(dr.saved_at).toLocaleTimeString("pl-PL", { hour:"2-digit", minute:"2-digit" })}` }),
    el("div", { class:"list" }, (dr.entries || []).map(e => el("div", { class:"stack", style:"gap:2px" }, el("span", { style:"font-weight:600", text:e.exName }), el("span", { class:"num", text:HZ.setsText(e) })))),
    dr.pain ? el("span", { class:"chip bad", style:"align-self:flex-start", text:"Ból: " + dr.pain }) : null,
    el("button", { style:"align-self:flex-start", async onclick(ev){ ev.currentTarget.disabled = true;
      const { pain, ...rest } = dr; const row = { user_id:client.id, workout_id:wid, date:dr.date, title:dr.title || "", own:false, fatigue:dr.fatigue ?? null, note:dr.note || "", entries:dr.entries || [], saved_at:new Date().toISOString(), ...(pain ? { pain } : {}) };
      const { error } = await HZ.api.saveWorkoutLog(row); if (error){ toast(error.code === "permission-denied" ? "Wgraj nowe reguły bazy (skrypt u.py)." : HZ.dbError(error)); ev.currentTarget.disabled = false; return; }
      await HZ.api.deleteDraft(client.id, wid); toast(`Zapisano wynik: ${client.name}`); await loadClients().catch(() => {}); loadResults(wid); }, text:"Zapisz jako wynik" }));
}
/* technique score 1–5 + short note: visible only to the trainer */
function techPick(log, client, wid, e){
  const cur = ((A.res.tech || {})[log.id] || {})[e.stationId] || {};
  const save = async val => { const { error } = await HZ.api.setTechnique(log.id, client.id, wid, e.stationId, val);
    if (error){ toast(error.code === "permission-denied" ? "Wgraj nowe reguły bazy (skrypt u.py)." : HZ.dbError(error)); return; }
    A.res.tech = A.res.tech || {}; A.res.tech[log.id] = { ...(A.res.tech[log.id] || {}), [e.stationId]:val }; render(); };
  const note = el("input", { class:"small", placeholder:"notatka (tylko dla Ciebie)", maxlength:"120", value:cur.note || "", style:"flex:1 1 140px;min-width:0;padding:4px 8px",
    onchange(ev){ save({ score:cur.score ?? null, note:ev.target.value.trim().slice(0,120) }); } });
  return el("div", { class:"techpick" }, el("span", { class:"small muted", text:"Technika:" }),
    [1,2,3,4,5].map(n => el("button", { type:"button", class:"ghost", "aria-pressed":String(cur.score === n), title:["","zła","słaba","ok","dobra","bardzo dobra"][n],
      onclick(){ save({ score: cur.score === n ? null : n, note:cur.note || "" }); }, text:String(n) })), note);
}
function techHistory(c){
  if (!A.clientTech || !A.clientLogs) return null;
  const rows = [];
  for (const t of A.clientTech){ const log = A.clientLogs.find(l => l.id === t.id); if (!log) continue;
    for (const [sid, v] of Object.entries(t.items || {})){ if (v.score == null && !v.note) continue; const e = (log.entries || []).find(x => x.stationId === sid);
      rows.push({ date:log.date, name: e ? e.exName : "Ćwiczenie", ...v }); } }
  if (!rows.length) return null;
  rows.sort((a,b) => b.date.localeCompare(a.date));
  return el("div", { class:"card" }, el("h3", { text:"Ocena techniki (widzisz tylko Ty)" }),
    el("div", { class:"list" }, rows.slice(0, 12).map(r => el("div", { class:"row between", style:"flex-wrap:nowrap" },
      el("span", { style:"min-width:0" }, el("b", { text:r.name }), r.note ? el("span", { class:"small muted", text:" · " + r.note }) : null),
      el("span", { class:"small", style:"white-space:nowrap", text:(r.score != null ? `${r.score}/5 · ` : "") + HZ.fmtDate(r.date) })))));
}

/* ---------- trainer adds earlier trainings (e.g. from before the app) for any client ---------- */
function pastCard(c){
  const done = new Set((A.clientLogs || []).map(l => l.workout_id));
  const ws = HZ.sortedWorkouts().reverse();
  const sel = el("select", { id:"past-w", "aria-label":"Trening" }, ws.map(w => el("option", { value:w.id, text:`${HZ.workoutLabel(w)}${done.has(w.id) ? " ✓ wpisany" : ""}` })));
  const prevFri = (() => { const first = HZ.sortedWorkouts()[0]; const d = first ? new Date(first.date + "T12:00:00") : new Date(); d.setDate(d.getDate() - 7); return d.toLocaleDateString("sv-SE"); })();
  return el("div", { class:"card" }, el("h3", { text:"Wpisz wyniki za klienta" }),
    el("p", { class:"small muted", text:"Np. treningi sprzed aplikacji. Wybierz trening i wpisz serie. Klient zobaczy je u siebie w postępach, rekordach i rankingu." }),
    ws.length ? el("div", { class:"row", style:"flex-wrap:nowrap" }, el("div", { style:"flex:1;min-width:0" }, sel),
      el("button", { class:"primary", style:"white-space:nowrap", onclick(){ openEntry(c, sel.value); }, text:"Wpisz wyniki" })) : null,
    el("button", { class:"ghost", style:"align-self:flex-start", onclick(){
      const last = HZ.sortedWorkouts()[0];
      A.backTo = c.id; A.tab = "workouts"; HZ.LS.set("hz-admin-tab", "workouts");
      A.editW = { id:null, date:prevFri, title:"", note:"", stations: last ? HZ.clone(last.stations || []).map(s => ({ ...s, id:HZ.uuid() })) : [newStation("main"), newStation("acc")] };
      render(); window.scrollTo(0, 0); }, text:"+ Trening z wcześniejszą datą (nie ma go na liście)" }));
}

/* ---------- invite: link + QR ---------- */
function guestIdleDays(c){ const s = A.stats[c.id]; const last = (s && s.last) || (c.created_at || "").slice(0, 10); if (!last) return 0; return Math.floor((Date.now() - new Date(last + "T12:00:00").getTime()) / 864e5); }
function inviteLink(){ return HZ.inviteUrl(A.inviteNoCode ? "" : A.joinCode || ""); }
function inviteCard(){
  const url = inviteLink();
  const qr = window.HZQR ? HZQR.svg(url) : null; if (qr) qr.setAttribute("class", "qr");
  return el("div", { class:"card invite" }, el("h2", { text:"Zaproś na trening" }),
    el("p", { class:"small muted", text: A.inviteNoCode || !A.joinCode ? "Link prowadzi do aplikacji. Nowa osoba wpisze kod klubu sama." : "Osoba, która zeskanuje kod albo kliknie link, od razu wchodzi jako gość: wpisuje tylko imię. Kod klubu jest już w linku." }),
    el("div", { class:"invite-body" }, qr ? el("button", { class:"qrbtn", "aria-label":"Pokaż kod QR na cały ekran", onclick(){ A.showQr = true; render(); } }, qr) : null,
      el("div", { class:"stack", style:"gap:8px;flex:1;min-width:0" },
        el("input", { id:"invite-url", readonly:true, value:url, onfocus(e){ e.target.select(); } }),
        el("div", { class:"row" },
          el("button", { class:"primary", onclick(){ A.showQr = true; render(); }, text:"Pokaż QR na cały ekran" }),
          el("button", { async onclick(){ try { await navigator.clipboard.writeText(url); toast("Skopiowano link"); } catch(e){ const i = document.getElementById("invite-url"); i.select(); toast("Zaznaczono link – skopiuj go"); } }, text:"Kopiuj link" }),
          navigator.share ? el("button", { async onclick(){ try { await navigator.share({ title:"Hubzone Weightlifting e-Dziennik", text:"Zapisuj swoje wyniki z treningu w e-Dzienniku Hubzone:", url }); } catch(e){} }, text:"Udostępnij" }) : null),
        A.joinCode ? el("label", { class:"row small", style:"flex-wrap:nowrap;cursor:pointer" },
          el("input", { id:"invite-nocode", type:"checkbox", style:"width:auto", checked: A.inviteNoCode || null, onchange(e){ A.inviteNoCode = e.target.checked; render(); } }),
          el("span", { text:"Link bez kodu klubu (np. do publicznego posta)" })) : el("p", { class:"small", style:"color:var(--bad)", text:"Ustaw kod klubu w zakładce „Ćwiczenia i ustawienia”, wtedy link wpuści od razu." }))));
}
function qrScreen(){
  const url = inviteLink(); const qr = HZQR.svg(url); qr.setAttribute("class", "qr big");
  return el("div", { class:"qrscreen", onclick(){ A.showQr = false; render(); } },
    el("div", { class:"brand-mini", text:"Hubzone Weightlifting e-Dziennik" }),
    qr,
    el("p", { class:"qrhint", text:"Zeskanuj aparatem telefonu i wpisz swoje imię" }),
    el("p", { class:"small", style:"opacity:.7;word-break:break-all", text:url }),
    el("button", { onclick(){ A.showQr = false; render(); }, text:"Zamknij" }));
}

/* ---------- boot ---------- */
if (!HZ.ready){ render(); return; }
render();
HZ.api.onAuth(session => {
  const was = A.session && A.session.user.id;
  A.session = session; armIdle();
  if (!session){ A.checked = false; A.profile = null; render(); return; }
  if (was !== session.user.id){ A.checked = false; render(); setTimeout(loadAll, 0); }
});
})();
