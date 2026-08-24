# Wallmanac — Project Handoff

## What this is
A self-hosted, wall-mounted calendar display (replacement for MagicMirror's
calendar module) with a Node.js/Express backend and a static HTML/JS
frontend, meant to run via Docker on a home network and be displayed
full-screen on a monitor with **no touch/mouse input** (all UI is read-only).

Three data sources feed the display:
1. Calendar events (Google Calendar API or any ICS feed)
2. `customEvents` keyword rules that restyle/rewrite/hide events (ported from
   MagicMirror's calendar module)
3. Google Tasks (read-only to-do list, OAuth2)

## Repo layout
```
wallmanac/
├── server.js          Express app: fetch/cache calendars + tasks, serve API + static frontend
├── config.js           USER-EDITED config: calendars, customEvents rules, settings, googleTasks
├── customEvents.js     Keyword-matching engine (MagicMirror customEvents port)
├── googleTasks.js      OAuth2 flow + token persistence + Tasks API client
├── public/index.html   Frontend: month grid + agenda list + to-do panel (single file, inline CSS/JS)
├── Dockerfile
├── docker-compose.yml  Mounts config.js (ro) and ./data (token persistence)
├── package.json / package-lock.json
└── README.md           User-facing setup instructions
```

## Architecture / data flow
- Backend polls upstream sources on a timer (`settings.refreshMinutes`,
  default 15 min) and keeps everything in memory in two caches: `cache`
  (events) and `todoCache` (tasks). No database.
- Frontend polls `GET /api/events`, `GET /api/todos`, `GET /api/settings`
  every 60s and re-renders. It never talks to Google directly — CORS and
  auth are entirely the backend's problem.
- `GET /auth/google` and `GET /oauth2callback` handle the one-time OAuth
  consent for Google Tasks; the resulting refresh token is written to
  `./data/google-token.json` (gitignored, volume-mounted so it survives
  container restarts/rebuilds).

## Calendar ingestion details
- **Google Calendar**: simple API-key + public-calendar approach (`events.list`
  REST call), no OAuth needed. Multiple calendars supported, each with its
  own display color.
- **ICS feeds**: fetched and parsed with `node-ical`. Recurrence (RRULE),
  exceptions (EXDATE), and per-instance overrides are expanded via
  `node-ical`'s exported `expandRecurringEvent()` helper — this was
  specifically verified to work correctly (see Testing below), including a
  yearly recurring "birthday" event and a weekly recurring event with COUNT.

## customEvents engine (`customEvents.js`)
Ported from MagicMirror's calendar module. Rules are matched against event
titles by regex (`keyword`, case-insensitive), first match wins per event.
Supported rule fields:
- `symbol` — any string (emoji recommended; no FontAwesome dependency, unlike
  the original MagicMirror module)
- `color` — CSS color override
- `transform: { search, replace, yearmatchgroup }` — regex-based title
  rewrite. `yearmatchgroup` is the special MagicMirror birthday trick: that
  capture group is read as a birth year and swapped for a computed age
  (relative to the event's own date) instead of the literal year.
- `calendarName` *(extension beyond original MagicMirror)* — scope a rule to
  one calendar by its configured `name`
- `hide: true` *(extension)* — drop the event entirely

All of the above were unit-tested directly (see Testing below), including
the birthday age math (`"Alex Birthday '1990"` → `"Alex Birthday (36)"` in
2026).

## Google Tasks integration (`googleTasks.js`)
- Standard OAuth2 authorization-code flow, `access_type=offline` +
  `prompt=consent` to force a refresh_token on first consent.
- Scope used: `https://www.googleapis.com/auth/tasks.readonly` (read-only —
  intentional, matches the no-touch display; users check things off from
  their phone's Tasks app instead).
- Access token is refreshed automatically ~60s before expiry using the
  stored refresh token; refresh token itself is never expired by Google
  under normal use.
- Fetches `GET /tasks/v1/lists/{taskListId}/tasks`, filters out
  `status: completed`, sorts tasks with a `due` date first (ascending),
  undated tasks after.
- Disabled by default (`googleTasks.enabled: false` in config.js) so the app
  runs fine with zero Google Tasks setup.

## Frontend (`public/index.html`)
Single file, no build step, no framework. Layout: month grid (left) +
sidebar (right) split into an agenda panel ("Up next", 14-day lookahead by
default) and a to-do panel (hidden entirely if `todosEnabled` is false).
All visual styling (colors, fonts, spacing) lives in one `:root {}` CSS
variable block at the top — this was a specific design goal (the original
ask was "MagicMirror is too hard to restyle").

Design: dark theme for an always-on wall display, Fraunces (serif) for
display type, IBM Plex Sans for body text, IBM Plex Mono for the clock/times
— chosen to read like a wall calendar rather than a generic dashboard.

## Testing performed so far
Everything below was actually run and verified in a sandbox during
development (not just written and assumed correct):
- `node-ical` + `expandRecurringEvent` against a hand-written sample.ics
  covering a one-off event, a COUNT-limited weekly recurrence, and a yearly
  recurring birthday — correct occurrences confirmed.
- `customEvents.js` unit-tested directly: keyword match, color/symbol
  override, `hide`, and the `yearmatchgroup` birthday-age transform all
  produced correct output.
- Full `fetchIcs()` path tested over real HTTP (spun up a local HTTP server
  serving the sample ICS, fetched it exactly as the app would fetch a real
  feed).
- Full Express server (`server.js`) started for real and hit with `curl`:
  `/api/events`, `/api/settings`, static `index.html` all confirmed working,
  including the "no calendars configured" warning path.
- `googleTasks.js` tested against a mocked local HTTP server standing in for
  `oauth2.googleapis.com` and `tasks.googleapis.com`: authorization-code
  exchange, expiry-triggered silent refresh, and the completed-task filter /
  due-date sort were all verified end-to-end, including through the actual
  `/oauth2callback` and `/api/todos` Express routes.
- Frontend JS was extracted and syntax-checked (`node --check`).

## NOT tested (known gaps)
- **Docker build/run itself** — Docker isn't available in the dev sandbox
  used, so `docker compose up --build` has never actually been run. The
  Dockerfile is a standard `node:20-alpine` setup and should work, but this
  is the first thing to verify.
- **Real Google API calls** — all Google Calendar / Google Tasks / OAuth
  testing used mocked local servers standing in for Google's endpoints
  (network egress in the dev sandbox is restricted to package registries).
  The request shapes match Google's documented REST APIs, but a real
  end-to-end run with a real API key / OAuth client has not happened.
- **Frontend visually** — never rendered in an actual browser; only
  logic-tested (data flow, syntax). Worth an actual visual check, especially
  the month-grid overflow/event-chip truncation and the new three-panel
  sidebar layout with the to-do panel.
- **`docker-compose.yml`'s `./data` volume** — the directory-creation logic
  (`fs.mkdirSync(..., { recursive: true })` in `googleTasks.js`) should
  handle first-run fine, but this hasn't been confirmed inside an actual
  container/volume-mount context.

## Config the user still needs to fill in before running
All in `config.js` (has inline setup instructions for each):
- `calendars[]` — currently empty; needs at least one Google Calendar (API
  key + calendar ID) or ICS URL
- `customEvents[]` — currently empty; optional
- `googleTasks` — `enabled: false` by default; needs `clientId`/`clientSecret`
  from a Google Cloud OAuth client if the user wants the to-do panel

## Discussed but NOT implemented
- **Porting the backend to Go.** User asked about difficulty; we researched
  and test-verified that `github.com/apognu/gocal` is a solid one-library
  replacement for `node-ical` (parses ICS + expands RRULE/EXDATE/overrides
  in one call — confirmed against the same sample.ics used for the Node
  version, identical output). Noted one real behavioral difference: gocal
  represents all-day event end times as `23:59:59.999` same-day rather than
  midnight-next-day (node-ical's convention) — would need normalizing if
  ported. User decided to stay on Node for now ("more JS native," not
  speed-constrained). No Go code was written for the app itself — only a
  throwaway test program to verify the library claim.
- **Write access / interactivity** — display is intentionally read-only
  throughout (calendar and to-do list both), matching the "just a monitor
  mounted on a wall" requirement. If that ever changes (e.g. a touchscreen),
  the to-do panel would need checkbox click handlers + a
  `PATCH /tasks/v1/lists/{id}/tasks/{taskId}` call, and the Tasks OAuth
  scope would need to change from `tasks.readonly` to `tasks`.

## Reasonable next steps
1. Get a real Google Cloud project set up (Calendar API key, and optionally
   Tasks OAuth client) and do a real end-to-end run — this is the biggest
   unverified surface area.
2. `docker compose up --build` on the actual target machine and confirm the
   volume mounts (`config.js`, `./data`) behave as expected.
3. Visual pass on `public/index.html` in an actual browser — check
   month-grid density with real event counts, sidebar panel proportions,
   and font loading (Google Fonts CDN — confirm it's reachable from wherever
   this ends up hosted, or vendor the fonts locally if not).
4. Decide if multi-week recurring event edge cases (e.g. `BYMONTHDAY`,
   `BYSETPOS`) matter for the user's real calendars — the RRULE testing so
   far only covered simple `WEEKLY`/`YEARLY` cases.
