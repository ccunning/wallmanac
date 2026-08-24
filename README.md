# Wallmanac

A self-hosted calendar display for a wall-mounted monitor: a month grid plus an
"up next" agenda list, backed by a small Node server that fetches your
calendar(s) and applies MagicMirror-style `customEvents` rules (recolor,
re-symbol, or rewrite event titles by keyword — including automatic birthday
age calculation).

## Run it

First-time setup — copy the example config and edit it:

```bash
cp config/config.example.js config/config.js
```

Then build and start:

```bash
docker compose up -d --build
```

Open `http://<server-ip>:3000` in a browser on the wall monitor and go
fullscreen (F11).

## Configure

Everything you'll want to change lives in **`config/config.js`** (which is
gitignored — your local copy of `config.example.js`):

- `calendars` — one or more Google Calendar or ICS feeds (setup steps are
  commented inline in the file)
- `customEvents` — keyword-based rules to recolor, re-symbol, hide, or rewrite
  event titles (see comments in `config.js` for the birthday-age example)
- `settings` — week start day, 12/24hr clock, agenda window, refresh interval

After editing `config.js`, restart the container to pick up changes:

```bash
docker compose restart
```

(`config.js` is mounted as a volume, so this doesn't require a rebuild.)

Visual formatting (colors, fonts, spacing) lives in a `:root {}` block near
the top of `public/index.html` — no restart needed, just refresh the browser.

## How customEvents works

Modeled on MagicMirror's calendar module. Each rule:

```js
{ keyword: 'Birthday', symbol: '🎂', color: 'Gold',
  transform: { search: "^([^']*) '(\\d{4})$", replace: '$1 ($2)', yearmatchgroup: 2 } }
```

- `keyword` — case-insensitive regex tested against the event title. The
  first matching rule wins (later rules are skipped for that event).
- `symbol` / `color` — override the event's default styling.
- `transform` — rewrites the title with a regex. If `yearmatchgroup` is set,
  that capture group is treated as a birth year and replaced with the
  computed age instead of the literal year.
- `calendarName` *(extension)* — scope a rule to one calendar by name.
- `hide: true` *(extension)* — drop matching events entirely.

## Google Tasks (to-do list)

The sidebar can also show a read-only to-do list pulled from Google Tasks,
refreshed on the same schedule as your calendars.

Google Keep has no usable personal API (it's Workspace-admin-only), so Tasks
is the practical option — and it's what the official Tasks phone app / Gmail
checkbox / Calendar's task list all write to, so you can keep checking things
off from your phone as usual.

Setup (one-time, see full comments in `config.js`):

1. In the same Google Cloud project as your Calendar API key, enable the
   **Google Tasks API** and create an **OAuth client ID** (type: Web
   application) with redirect URI `http://localhost:3000/oauth2callback`
   (match the host:port you'll browse to for setup).
2. Set `googleTasks.enabled = true` and fill in `clientId` / `clientSecret`
   in `config.js`.
3. Start the container, then from a browser **on the machine running
   Docker**, visit `http://localhost:3000/auth/google` and approve access.
   This is a one-time step — the refresh token is saved to `./data/` (mounted
   as a volume) and the wall display itself never touches the auth flow.
4. Restart the container so it picks up the new config, then check
   `http://localhost:3000/api/todos` to confirm it's connected.

This is read-only by design, matching the display's no-touch setup — check
things off from your phone, and they'll disappear from the wall display on
the next refresh.

## Notes

- Google Calendar is the more reliable source for an always-on display; ICS
  feeds work too (recurring events, including exceptions, are expanded
  server-side via `node-ical`).
- The backend re-fetches calendars every `refreshMinutes` (default 15) and
  serves cached results, so the display keeps working even if a calendar
  provider is briefly unreachable.
- The Dockerfile/compose setup wasn't build-tested in this environment (no
  Docker available here), but the server logic itself — fetching, recurrence
  expansion, and every customEvents rule type including the birthday
  transform — was tested directly and works as shown above.

## License

[MIT](LICENSE)
