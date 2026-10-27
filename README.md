# Bandstem

Samen stemmen op de nummers uit de gedeelde Spotify-playlist van de band.

- **Site:** https://jonasdreesen.github.io/bandstem/
- **Spotify koppelen (alleen beheerder):** https://jonasdreesen.github.io/bandstem/connect.html

Bandleden loggen in met de **bandcode** en kiezen hun naam. Per nummer: ★ Super / Ja / Misschien / Nee, moeilijkheid voor hun eigen instrument en een opmerking. Onder **Resultaten** ziet iedereen de ranglijst.

- **Superlike:** iedereen heeft er 3, voor nummers waar je echt fan van bent (+3 punten).
- **We spelen:** zet bij Resultaten een nummer op de lijst met "＋ We spelen dit". In de tab **We spelen** staan alle nummers die jullie aan het instuderen zijn, elk met een eigen commentaarlijst. Iedereen kan reageren en zijn eigen opmerkingen wissen.
- **Documenten:** in de tab We spelen kan iedereen bestanden toevoegen (partituren, tabs, foto's, opnames; max. 25 MB per bestand), bij een nummer of algemeen bij "Banddocumenten". Iedereen kan ze openen; alleen wie een document toevoegde kan het wissen.
- **Toonaard:** per nummer op de lijst geef je aan of jullie het in de originele toonaard spelen of in een andere (met velden "Origineel" en "Wij spelen in").
- **Als app:** op gsm verschijnt een melding om Bandstem op het beginscherm te zetten (iPhone: Safari › Deel › Zet op beginscherm; Android: Installeren). Let op: op iPhone moet je in de app één keer opnieuw inloggen met de bandcode.
- **Coach:** kies bij het aanmelden "Coach" als instrument. Een coach stemt mee en geeft advies per nummer, maar geeft geen moeilijkheid. Coach-advies staat bovenaan bij de opmerkingen.

## Hoe het werkt

| Onderdeel | Wat het doet |
|---|---|
| `index.html`, `js/app.js` | De website (GitHub Pages) |
| `connect.html` | Eenmalig inloggen bij Spotify + eerste keer nummers ophalen |
| `supabase/setup.sql` | Database: tabellen, beveiliging, bandcode |
| `supabase/update-3-documenten-toonaard.sql` | Update voor documenten en toonaard |
| `supabase/update-2-we-spelen.sql` | Update voor de tab "We spelen" met commentaren |
| `supabase/update-1-superlike-coach.sql` | Update voor wie setup.sql al vóór de superlike/coach-functie had uitgevoerd |
| `scripts/sync.mjs` + `.github/workflows/sync.yml` | Haalt elk half uur nieuwe nummers op uit de playlist |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installeerbaar als app op gsm (icoon, beginscherm) |
| `config.json` | Openbare instellingen (Supabase-adres, publishable key, Spotify Client ID) |

Alleen de beheerder koppelt Spotify. Bandleden hebben geen Spotify-toestemming nodig. Sinds februari 2026 laat Spotify maar 5 gebruikers per zelfgemaakte app toe, en de eigenaar van de app moet Premium hebben.

## Eenmalige opzet

### 1. Supabase
1. Maak een **nieuw project** op [supabase.com/dashboard](https://supabase.com/dashboard) (gebruik geen project dat al voor iets anders dient).
2. **SQL Editor › New query**: plak `supabase/setup.sql`. Pas onderaan `KIES-EEN-BANDCODE` en `KIES-EEN-ADMINCODE` aan en klik **Run**.
3. **Authentication › Sign In / Providers**: zet **Allow anonymous sign-ins** aan en klik **Save**.
4. **Project Settings › API Keys**: noteer de **Project URL**, de **publishable key** (`sb_publishable_…`) en de **secret key** (`sb_secret_…`).

### 2. Spotify
1. Ga naar [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) › **Create app**.
2. Naam: `Bandstem`. Redirect URI: `https://jonasdreesen.github.io/bandstem/connect.html` (exact zo). Vink **Web API** aan, accepteer de voorwaarden en klik **Save**.
3. Noteer de **Client ID**.

### 3. Invullen
- `config.json`: vul `supabaseUrl`, `supabasePublishableKey` en `spotifyClientId` in.
- GitHub › **Settings › Secrets and variables › Actions › New repository secret**: naam `SUPABASE_SECRET_KEY`, waarde = de secret key. Deze sleutel nooit in een bestand zetten.

### 4. Koppelen
Open `connect.html`, vul de admin-code en de playlistlink in en log in bij Spotify. De nummers verschijnen meteen.

## Beheer

- **Bandcode wijzigen:** Supabase › Table Editor › `band_settings` › `band_code` aanpassen.
- **Iemand verwijderen:** Table Editor › `band_members` › rij verwijderen (de stemmen gaan mee).
- **Meteen bijwerken:** GitHub › Actions › Spotify-sync › Run workflow.
- **Koppeling verlopen?** De site toont een melding. Open `connect.html` en koppel opnieuw.
- GitHub zet geplande taken stil na 60 dagen zonder activiteit in de repo. Zet ze dan terug aan via **Actions › Spotify-sync › Enable workflow**.
- Nummers die uit de playlist verdwijnen, worden verborgen. Hun stemmen blijven bewaard.
