# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `docker compose up -d --build` — build and run the container (primary supported path).
- `docker compose restart` — pick up edits to `config/config.js` (mounted read-only into the container at `/config/config.js`, no rebuild needed).
- `npm start` — run the server directly (`node server.js`). Note: `server.js` reads config from the hardcoded absolute path `/config/config.js`, so running outside Docker requires that path to exist (symlink or bind mount).
- `npm test` — `node --test test/*.test.js`, covering the `customEvents` rule engine and the `calendars.js` fetchers. `make test` runs the same suite in a `node:24-alpine` container (no local Node needed). No linter or build step is configured.
- `make demo` — runs the display against a generated local fixture calendar on :8081 (`make demo-down` to stop, `make fixture` to only regenerate `demo/demo.ics`). No Google account or network needed. `demo/demo.ics` is generated, not source — it's gitignored, and `make fixture` must pass the host timezone (`HOST_TZ`) because the generator writes UTC instants derived from local wall-clock times.
- `make` — local build/publish pipeline (`build`, `push` for multi-arch Docker Hub pushes, `up`/`down`/`logs`, `release`). `make help` lists everything. Mirrors `.github/workflows/docker-publish.yml`, which is the normal publish path: tests → buildx `linux/amd64,linux/arm64` → Docker Hub, gated on a `DOCKERHUB_TOKEN` secret (absent secret ⇒ build-only, no failure).

## Architecture

Single Node/Express server (`server.js`) that fetches calendar data on an interval and serves a static SPA (`public/index.html` for the wall display, `public/config.html` for the admin UI).

Data flow:
1. On startup and every `settings.refreshMinutes`, `refreshData()` calls `fetchAll()` from `calendars.js`, which fetches every entry in `config.calendars` in parallel. Results are stored raw in the in-memory `cache`.
2. `GET /api/events` maps `cache.rawEvents` through `applyCustomEvents` (customEvents.js) on each request — so config rule edits take effect without waiting for the next refresh cycle.
3. `refreshTodos()` runs on the same interval and populates `todoCache` from Google Tasks (see below).
4. The frontend polls `/api/events`, `/api/todos`, and `/api/settings`.

Config hot-reload: every request that needs config calls `getConfig()`, which busts `require.cache[CONFIG_PATH]` before re-requiring. Restart is only needed for changes to `settings.port` / `refreshMinutes` (used once at boot in `setInterval`) and for calendar list changes (which take effect on the next refresh tick anyway).

### Calendar sources (`calendars.js`)

Every source lives behind the `FETCHERS` registry keyed by `cal.type` — `google` (REST API), `ics` (remote URL via `node-ical`), `fixture` (local `.ics` file via `ical.async.parseFile`). `fetchAll(calendars, range, fetchers = FETCHERS)` takes the registry as an argument, which is the injection point tests use; `fetchGoogle` similarly takes `{ fetch }` so the Google response mapping is testable without an API key. A calendar with no `type` but a `url` still resolves to `ics` for back-compat; anything else becomes a per-feed error string rather than a throw — one bad feed never takes down the rest, matching the old `Promise.allSettled` behavior. `server.js` owns the cache and logging; `calendars.js` is pure fetch-and-map.

`toUtcMidnight` exists because `node-ical` resolves `VALUE=DATE` (all-day) properties to midnight in the *server's* timezone. The container runs UTC, so an untouched all-day event renders a day early for any display behind UTC. All-day events are re-anchored to UTC midnight of the date they name, and `parseEventDate()` in `public/index.html` reads them back with the UTC getters and rebuilds them at local midnight. Timed events are true instants and pass through untouched. `test/calendars.test.js` covers this and the suite is worth running under a few `TZ` values when touching it.

### customEvents rule engine (`customEvents.js`)

Port of the MagicMirror calendar module's `customEvents` (case-insensitive regex on title), but **fall-through is per field, not per rule**: rules are evaluated top-to-bottom and the first rule to supply `symbol` / `color` / `transform` / a `hide` opinion claims *that field only*, so a rule that sets just a color lets a later rule contribute the symbol. Blank and whitespace-only strings count as "no opinion" (`isSet()`), which is what makes the config UI's empty fields fall through. Extensions beyond MagicMirror: `calendarName` (scope rule to one feed), `hide: true` (drop event — returned as `null`, filtered out in the `/api/events` handler), `hide: false` (shield from a later `hide: true`), and `stop: true` (end evaluation at this rule = MagicMirror's original first-match-wins). `yearmatchgroup` in a `transform` treats that capture group as a birth year and substitutes the computed age relative to the event's own date (birthday-age trick). Bad regex in config is swallowed and the rule/transform is skipped rather than crashing the server.

### Google Tasks OAuth (`googleTasks.js`)

Read-only Tasks integration using OAuth device flow via the browser. Tokens persist to `./data/google-token.json` (mounted as a Docker volume so consent survives rebuilds). Refresh happens 60s before expiry. The `refresh_token` is only issued on first consent — code forces `prompt=consent` on the auth URL to guarantee one, and the refresh flow explicitly reuses the stored `refresh_token` since Google doesn't resend it. One-time setup is done by visiting `/auth/google` from a browser on the Docker host.

### Auth for config UI

If `settings.configPassword` is set, `/api/config*` endpoints require a bearer token issued by `POST /api/auth/login` (24h TTL, in-memory `sessions` Map — restarting the server logs everyone out). Password comparison uses `crypto.timingSafeEqual`. `/api/events`, `/api/todos`, `/api/settings` are always public (the wall display is unattended).

### Config file semantics

`config/config.js` is a `module.exports = {...}` file. `POST /api/config` serializes JSON with `JSON.stringify` (so any functions/comments in the file are lost on save via the admin UI); `POST /api/config/upload` writes raw text. Both endpoints back up the previous contents and roll back if the new file fails to `require()`.

### Month-grid sizing (`public/index.html`)

The wall display never scrolls, so the grid must absorb any number of events without changing size. Two things enforce that: the row template is `repeat(rows, minmax(0, 1fr))` (a bare `1fr` is `minmax(auto, 1fr)` and would let a busy day stretch its week and push the rows below off-screen), and `fitDayCell()` runs after the whole grid is in the DOM, dropping chips from the bottom of each `.day-events` box until the content — including the `+N more` line, which costs height itself — fits. A cell that still has to hide events retries in `.compact` mode (single-line clamped titles) and keeps whichever pass shows more. `settings.maxEventsPerDayCell` is only an upper cap now; `0` means "as many as fit". The fit is re-run on `document.fonts.ready` and on a debounced resize, since both change chip metrics.

## Gotchas

- `CONFIG_PATH` is hardcoded to `/config/config.js` — this is a Docker-ism, not the repo's `./config/config.js`. Local `node server.js` without a matching path will fail.
- `fetchRange` deliberately starts one month before "now" so the month grid's leading overflow days from the previous month have data.
- The `data/` directory must be writable by the container user; it holds the Google Tasks refresh token.
- Event titles come from third-party feeds and are interpolated into `innerHTML` in `public/index.html` — they go through `escapeHtml()` there; keep new render paths doing the same.
