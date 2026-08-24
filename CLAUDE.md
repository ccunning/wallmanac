# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `docker compose up -d --build` — build and run the container (primary supported path).
- `docker compose restart` — pick up edits to `config/config.js` (mounted read-only into the container at `/config/config.js`, no rebuild needed).
- `npm start` — run the server directly (`node server.js`). Note: `server.js` reads config from the hardcoded absolute path `/config/config.js`, so running outside Docker requires that path to exist (symlink or bind mount).
- No test suite, linter, or build step is configured.

## Architecture

Single Node/Express server (`server.js`) that fetches calendar data on an interval and serves a static SPA (`public/index.html` for the wall display, `public/config.html` for the admin UI).

Data flow:
1. On startup and every `settings.refreshMinutes`, `refreshData()` fetches each entry in `config.calendars` in parallel (Google Calendar REST API or ICS via `node-ical`, with `expandRecurringEvent` used for ICS recurrence including exceptions). Results are stored raw in the in-memory `cache`.
2. `GET /api/events` maps `cache.rawEvents` through `applyCustomEvents` (customEvents.js) on each request — so config rule edits take effect without waiting for the next refresh cycle.
3. `refreshTodos()` runs on the same interval and populates `todoCache` from Google Tasks (see below).
4. The frontend polls `/api/events`, `/api/todos`, and `/api/settings`.

Config hot-reload: every request that needs config calls `getConfig()`, which busts `require.cache[CONFIG_PATH]` before re-requiring. Restart is only needed for changes to `settings.port` / `refreshMinutes` (used once at boot in `setInterval`) and for calendar list changes (which take effect on the next refresh tick anyway).

### customEvents rule engine (`customEvents.js`)

Reimplements the MagicMirror calendar module's `customEvents` semantics: case-insensitive regex on title, **first matching rule wins** (breaks after apply). Two documented extensions beyond MagicMirror: `calendarName` (scope rule to one feed) and `hide: true` (drop event entirely — returned as `null` and filtered out in the `/api/events` handler). `yearmatchgroup` in a `transform` treats that capture group as a birth year and substitutes the computed age relative to the event's own date (birthday-age trick). Bad regex in config is swallowed and the rule/transform is skipped rather than crashing the server.

### Google Tasks OAuth (`googleTasks.js`)

Read-only Tasks integration using OAuth device flow via the browser. Tokens persist to `./data/google-token.json` (mounted as a Docker volume so consent survives rebuilds). Refresh happens 60s before expiry. The `refresh_token` is only issued on first consent — code forces `prompt=consent` on the auth URL to guarantee one, and the refresh flow explicitly reuses the stored `refresh_token` since Google doesn't resend it. One-time setup is done by visiting `/auth/google` from a browser on the Docker host.

### Auth for config UI

If `settings.configPassword` is set, `/api/config*` endpoints require a bearer token issued by `POST /api/auth/login` (24h TTL, in-memory `sessions` Map — restarting the server logs everyone out). Password comparison uses `crypto.timingSafeEqual`. `/api/events`, `/api/todos`, `/api/settings` are always public (the wall display is unattended).

### Config file semantics

`config/config.js` is a `module.exports = {...}` file. `POST /api/config` serializes JSON with `JSON.stringify` (so any functions/comments in the file are lost on save via the admin UI); `POST /api/config/upload` writes raw text. Both endpoints back up the previous contents and roll back if the new file fails to `require()`.

## Gotchas

- `CONFIG_PATH` is hardcoded to `/config/config.js` — this is a Docker-ism, not the repo's `./config/config.js`. Local `node server.js` without a matching path will fail.
- `fetchRange` deliberately starts one month before "now" so the month grid's leading overflow days from the previous month have data.
- The `data/` directory must be writable by the container user; it holds the Google Tasks refresh token.
