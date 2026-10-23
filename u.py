# Hubzone e-Dziennik: ustawienie Firebase z Google Cloud Shell (bez wklejania).
# Uruchom w Cloud Shell:  curl -sL oskarzio.github.io/hubzone-edziennik/u.py | python3
# Robi: 1) włącza wejście jako gość (Anonymous) i ochronę przed sprawdzaniem e-maili,
#       2) wgrywa aktualne reguły bazy (firestore.rules), 3) pokazuje region bazy.
import json, subprocess, sys, urllib.request, urllib.error

P = "hubzone-e-dziennikk"
RULES_URL = "https://oskarzio.github.io/hubzone-edziennik/firestore.rules"

def token():
    try:
        return subprocess.check_output(["gcloud", "auth", "print-access-token"], text=True).strip()
    except Exception:
        sys.exit("Nie udało się pobrać logowania. Jeśli wyskoczyło okno 'Authorize', kliknij Authorize i uruchom komendę jeszcze raz.")

T = token()

def call(method, url, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": "Bearer " + T, "x-goog-user-project": P, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        print("   BŁĄD", e.code, e.read().decode()[:400])
        return None

print("1/3 Włączam wejście jako gość i ochronę e-maili...")
r = call("PATCH", f"https://identitytoolkit.googleapis.com/admin/v2/projects/{P}/config?updateMask=signIn.anonymous.enabled,emailPrivacyConfig.enableImprovedEmailPrivacy",
         {"signIn": {"anonymous": {"enabled": True}}, "emailPrivacyConfig": {"enableImprovedEmailPrivacy": True}})
ok1 = bool(r and r.get("signIn", {}).get("anonymous", {}).get("enabled"))
print("   OK – gość włączony" if ok1 else "   Nie udało się (zrób to ręcznie: Authentication → Sign-in method → Anonymous)")

print("2/3 Wgrywam reguły bazy...")
ok2 = False
try:
    with urllib.request.urlopen(RULES_URL) as f:
        rules = f.read().decode()
except Exception as e:
    rules = ""; print("   Nie mogę pobrać firestore.rules:", e)
if "service cloud.firestore" in rules:
    rs = call("POST", f"https://firebaserules.googleapis.com/v1/projects/{P}/rulesets",
              {"source": {"files": [{"name": "firestore.rules", "content": rules}]}})
    if rs and rs.get("name"):
        rel = f"projects/{P}/releases/cloud.firestore"
        r = call("PATCH", f"https://firebaserules.googleapis.com/v1/{rel}", {"release": {"name": rel, "rulesetName": rs["name"]}})
        ok2 = bool(r and r.get("rulesetName") == rs["name"])
print("   OK – reguły opublikowane" if ok2 else "   Nie udało się (wklej reguły ręcznie: Firestore → Rules → Publish)")

print("3/3 Sprawdzam region bazy...")
r = call("GET", f"https://firestore.googleapis.com/v1/projects/{P}/databases/(default)")
loc = (r or {}).get("locationId", "?")
eu = loc.startswith("eur") or loc.startswith("europe")
print(f"   Region: {loc} –", "Europa, OK" if eu else "UWAGA: to nie jest Europa, napisz do Claude")

print("\nGOTOWE" if ok1 and ok2 else "\nCzęść kroków się nie udała – zrób zrzut ekranu i wyślij go Claude.")
