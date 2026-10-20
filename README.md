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
- `vercel.json`: makes `/family` and `/bwfc` open the app
- `manifest*.webmanifest`: home-screen settings, one per starting link
- `NOTES.md`: what the real data looks like

## Environment variables (Vercel → Settings → Environment Variables)

- `HIGHLIGHTLY_API_KEY`: required
- `HIGHLIGHTLY_FOOTBALL_BASE`: optional (default `https://sports.highlightly.net/football`)
- `LIVE_CACHE_SECONDS`: optional (default 20)

Keep `.overlay[hidden] { display: none; }` in every version of `style.css`.
