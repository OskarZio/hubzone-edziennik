# Hubzone Weightlifting e-Dziennik

Dziennik treningowy dla grupy trenującej na stacjach.

- **Klient** wchodzi na stronę główną, zakłada konto (imię, e-mail, hasło, kod klubu) i od razu widzi swój panel: dzisiejsze stacje, miejsce na ciężar lub gumę, powtórzenia, RIR i zmęczenie (1–10), podpowiedź ile dołożyć, wykresy postępów i trening własny na siłowni.
- **Trener** loguje się pod osobnym adresem `/admin.html`. Ustala ćwiczenia, kolory gum i stacje na każdy piątek, widzi wyniki całej grupy, historię każdego klienta i może pobrać CSV.

Strona działa na GitHub Pages (za darmo), dane są w Supabase (darmowy plan wystarczy).

---

## Jak to jest zabezpieczone

- Każdy ma własne konto z hasłem (logowanie Supabase Auth).
- Reguły w bazie (Row Level Security) pilnują, że klient czyta i zapisuje **tylko swoje** wpisy. Nawet ktoś, kto zna adres bazy, bez konta nie zobaczy nic.
- Panel trenera działa tylko dla konta oznaczonego w bazie jako trener (`is_admin`). Zwykłe konto po zalogowaniu na `/admin.html` dostaje komunikat o braku uprawnień i nie widzi żadnych danych.
- Konto założy tylko osoba znająca **kod klubu**. Kod zmieniasz w panelu trenera.
- Klucz `anon` w `config.js` jest publiczny z założenia (tak działa Supabase). Nigdy nie wklejaj tam klucza `service_role`.

---

## Uruchomienie krok po kroku (ok. 15 minut)

### 1. Supabase

1. Załóż konto na [supabase.com](https://supabase.com) i kliknij **New project**. Region: najlepiej **Central EU (Frankfurt)**. Zapisz hasło do bazy w bezpiecznym miejscu.
2. Gdy projekt się utworzy, wejdź w **SQL Editor → New query**, wklej całą zawartość pliku `supabase/schema.sql` i kliknij **Run**.
3. Wejdź w **Project Settings → API** i skopiuj:
   - **Project URL** (np. `https://abcd1234.supabase.co`)
   - klucz **anon public**
4. Otwórz plik `config.js` i podmień `TWOJ-PROJEKT` i `TWOJ_ANON_KEY` na skopiowane wartości.

### 2. GitHub

1. Załóż konto na [github.com](https://github.com) i utwórz nowe repozytorium, np. `hubzone-edziennik` (może być publiczne; dane są w Supabase, nie w repo).
2. Wgraj do niego wszystkie pliki z tego folderu (**Add file → Upload files**, przeciągnij całą zawartość, łącznie z folderami `assets` i `supabase` oraz plikiem `.nojekyll`).
3. Wejdź w **Settings → Pages**, w **Source** wybierz **Deploy from a branch**, gałąź `main`, folder `/ (root)`, **Save**.
4. Po minucie strona będzie pod adresem w stylu `https://TWOJA-NAZWA.github.io/hubzone-edziennik/`.

### 3. Połącz Supabase ze stroną

W Supabase: **Authentication → URL Configuration**:
- **Site URL**: adres strony z GitHub Pages, np. `https://TWOJA-NAZWA.github.io/hubzone-edziennik/`
- **Redirect URLs**: dodaj ten sam adres oraz `https://TWOJA-NAZWA.github.io/hubzone-edziennik/admin.html`

Dzięki temu linki z maili (potwierdzenie konta, reset hasła) wracają na Twoją stronę.

### 4. Twoje konto trenera

1. Wejdź na stronę główną i załóż konto. Kod klubu na start to **HUBZONE**.
2. Potwierdź e-mail (link w skrzynce).
3. W Supabase w **SQL Editor** uruchom (z Twoim e-mailem):
   ```sql
   update public.profiles set is_admin = true where email = 'twoj@email.pl';
   ```
4. Wejdź na `.../admin.html` i zaloguj się. W zakładce **Ćwiczenia i ustawienia** od razu zmień kod klubu na własny.

### 5. Klienci

Wyślij grupie:
- link do strony głównej (`https://TWOJA-NAZWA.github.io/hubzone-edziennik/`)
- aktualny kod klubu

Każdy zakłada konto raz i potem jest zalogowany na telefonie. Link `/admin.html` zostaw dla siebie (i tak bez roli trenera nic tam nie zobaczą).

---

## Jak działa podpowiedź progresji

Na podstawie ostatniego zapisu danego ćwiczenia:

| Ostatni wynik | Podpowiedź |
|---|---|
| Wszystkie serie zrobione, najniższy RIR ≥ 2 | Dołóż skok ciężaru (ustawiasz 0,5–5 kg na ćwiczenie) / słabsza guma / +1 powtórzenie |
| Wszystkie serie zrobione, RIR ≥ 4 | Podwójny skok / guma o dwie słabsza / +2 powtórzenia |
| Wszystkie serie zrobione, RIR 0–1 | Zostań przy tym obciążeniu |
| Zabrakło powtórzeń | Zostań i domknij serie |
| Zabrakło powtórzeń 2× z rzędu na tym samym ciężarze | Zmniejsz o skok / mocniejsza guma |
| Zmęczenie 9–10 przy podpowiedzi „dołóż” | Dopisek, żeby dołożyć tylko przy lepszym samopoczuciu |

Gumy ustawiasz w kolejności od **najmocniejszej asysty do najsłabszej**; po ostatniej jest „bez gumy”.

## Struktura plików

```
index.html          panel klienta
admin.html          panel trenera
config.js           adres i klucz Supabase (uzupełnij)
assets/style.css    wygląd
assets/common.js    wspólny kod: logowanie, progresja, wykresy
assets/client.js    logika panelu klienta
assets/admin.js     logika panelu trenera
supabase/schema.sql tabele i reguły bezpieczeństwa
```

## Przydatne

- **Darmowy Supabase usypia projekt po tygodniu bez ruchu.** Przy cotygodniowych treningach to nie problem; jeśli zrobisz przerwę, wejdź w panel Supabase i kliknij „Restore”.
- **Maile z Supabase** na darmowym planie mają limit kilku na godzinę. Jeśli zakłada się cała grupa naraz, możesz w **Authentication → Providers → Email** wyłączyć „Confirm email” na czas zapisów.
- Kopia zapasowa: w panelu trenera **Wyniki → Pobierz CSV**, albo w Supabase **Table Editor → logs → Export**.
