# Football Tracker

One simple football app for everyone (replacing football-app, football-company and bwfc-app).
Plain HTML, CSS and JS with no build step, hosted on Vercel. Data from Highlightly (All Sports)
through a serverless proxy, so the API key never reaches the browser.

## Starting links

| Link | First visit |
|---|---|
| `/` | Asks the visitor to choose their teams |
| `/family` | Arsenal, Chelsea, Bolton and Leeds, with no choosing needed |
| `/bwfc` | Bolton, locked (cannot be removed); other teams can be added |

Each person's choice is then saved on their own device (separately for each link).
Presets and locked teams are set in `config.js`.

## Files

- `index.html`, `app.js`, `config.js`, `style.css`: the app
- `explorer.html`: raw data explorer for checking real API responses
- `api/football.js`: proxy at `/api/football?path=/...`, with an allow-list and shared caching
- `api/stats.js`: reads a team's season stats from the shared Firebase database (`/api/stats?teamId=…`)
- `api/cron/populate.js`: the nightly stats job (23:00 UTC), saving to Firebase with a service account
- `api/_teams.js`: the clubs whose stats are recorded (shared by the two above)
- `firestore.rules`: the Firebase security rules to publish (public read of stats, no public writes)
- `vercel.json`: makes `/family` and `/bwfc` open the app
- `manifest*.webmanifest`: home-screen settings, one per starting link
- `NOTES.md`: what the real data looks like

## Environment variables (Vercel → Settings → Environment Variables)

- `HIGHLIGHTLY_API_KEY`: required
- `HIGHLIGHTLY_FOOTBALL_BASE`: optional (default `https://sports.highlightly.net/football`)
- `LIVE_CACHE_SECONDS`: optional (default 20)
- `FIREBASE_API_KEY`: the Firebase web API key (same value as `NEXT_PUBLIC_FIREBASE_API_KEY` in the old apps)
- `FIREBASE_PROJECT_ID`: optional (default `football-tracker-c9dae`)
- `FIREBASE_SERVICE_ACCOUNT`: the whole JSON key file of a Firebase service account (for the nightly job)
- `CRON_SECRET`: a long random string; Vercel sends it when running the nightly job

Keep `.overlay[hidden] { display: none; }` in every version of `style.css`.
