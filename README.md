# Hubzone Weightlifting e-Dziennik

Dziennik treningowy dla grupy trenującej na stacjach.

- **Klient** wchodzi na stronę główną, zakłada konto (imię, e-mail, hasło, kod klubu) i od razu widzi swój panel: dzisiejsze stacje, miejsce na ciężar lub gumę, powtórzenia, RIR i zmęczenie (1–10), podpowiedź ile dołożyć, wykresy postępów i trening własny na siłowni.
- **Trener** loguje się pod osobnym adresem `/admin.html`. Ustala ćwiczenia, kolory gum i stacje na każdy piątek, widzi wyniki całej grupy, historię każdego klienta i może pobrać CSV.

Strona działa na GitHub Pages, a konta i dane są w **Firebase** od Google. Darmowy plan Spark wystarcza z dużym zapasem (50 000 odczytów i 20 000 zapisów dziennie) i nie wymaga karty.

---

## Jak to jest zabezpieczone

- Każdy ma własne konto z hasłem (Firebase Authentication).
- Reguły bazy (`firestore.rules`) pilnują, że klient czyta i zapisuje **tylko swoje** wpisy. Bez konta nie widać nic.
- Panel trenera działa tylko dla konta z polem `isAdmin = true`, które ustawiasz ręcznie w konsoli Firebase. Klient nie może sam nadać sobie tej roli.
- Konto w klubie założy tylko osoba znająca **kod klubu**. Kod zmieniasz w panelu trenera.
- Dane w `config.js` są publiczne z założenia (tak działa Firebase w przeglądarce). Ochronę zapewniają reguły.

---

## Uruchomienie krok po kroku (ok. 15 minut)

### 1. Projekt Firebase

1. Wejdź na [console.firebase.google.com](https://console.firebase.google.com), zaloguj się kontem Google i kliknij **Utwórz projekt** (np. `hubzone-edziennik`). Google Analytics możesz wyłączyć.
2. **Authentication → Rozpocznij → Sign-in method → E-mail/hasło → Włącz → Zapisz.**
3. **Firestore Database → Utwórz bazę danych**. Lokalizacja: `eur3 (Europe)` lub `europe-central2 (Warszawa)`. Tryb: **produkcyjny**.
4. W Firestore wejdź w zakładkę **Reguły**, usuń to, co tam jest, wklej całą zawartość pliku `firestore.rules` i kliknij **Opublikuj**.
5. **Ustawienia projektu (koło zębate) → Ogólne → Twoje aplikacje → ikona `</>` (Web)**. Nadaj nazwę, nie zaznaczaj Hostingu, kliknij **Zarejestruj**. Skopiuj obiekt `firebaseConfig`.
6. Otwórz `config.js` i podmień wartości na skopiowane.

### 2. GitHub Pages

1. W repozytorium: **Settings → Pages → Deploy from a branch**, gałąź `main`, folder `/ (root)`, **Save**.
2. Po minucie strona działa pod adresem `https://oskarzio.github.io/hubzone-edziennik/`.
3. W Firebase: **Authentication → Ustawienia → Autoryzowane domeny → Dodaj domenę**: `oskarzio.github.io`.

### 3. Twoje konto trenera

1. Wejdź na stronę główną i załóż konto (jako kod klubu wpisz cokolwiek, np. `HUBZONE`; dopóki nie ustawisz kodu, rejestracja jest otwarta).
2. W Firebase: **Firestore Database → Dane → users →** Twój dokument → pole `isAdmin` → zmień na `true`.
3. Wejdź na `.../admin.html`, zaloguj się i w zakładce **Ćwiczenia i ustawienia** ustaw własny kod klubu. Od tej chwili nikt bez kodu nie założy konta.

### 4. Klienci

Wyślij grupie link do strony głównej i kod klubu. Każdy zakłada konto raz i potem jest zalogowany na telefonie. Link `/admin.html` zostaw dla siebie (bez roli trenera i tak nic tam nie zobaczą).

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
config.js           dane projektu Firebase (uzupełnij)
firestore.rules     reguły bezpieczeństwa bazy (wklej w Firebase)
assets/style.css    wygląd
assets/common.js    wspólny kod: logowanie, baza, progresja, wykresy
assets/client.js    logika panelu klienta
assets/admin.js     logika panelu trenera
```

## Przydatne

- Reset hasła: przycisk „Nie pamiętam hasła” wysyła link od Firebase. Jeśli mail nie dochodzi, sprawdź spam.
- Usunięcie klienta: Firebase → Authentication → Użytkownicy (konto) oraz Firestore → `users` (profil).
- Kopia zapasowa: w panelu trenera **Wyniki → Pobierz CSV**.
