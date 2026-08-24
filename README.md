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

Or run the published image without building anything — point `image:` in
`docker-compose.yml` at `ccunning/wallmanac:latest` (multi-arch: amd64 and
arm64, so a Raspberry Pi works), or:

```bash
docker run -d --name wallmanac -p 8080:3000 \
  -v "$PWD/config":/config -v "$PWD/data":/app/data \
  ccunning/wallmanac:latest
```

Open `http://<server-ip>:3000` in a browser on the wall monitor and go
fullscreen (F11).

## Configure

Everything you'll want to change lives in **`config/config.js`** (which is
gitignored — your local copy of `config.example.js`):

- `calendars` — one or more Google Calendar (`type: 'google'`), ICS
  (`type: 'ics'`), or local-file (`type: 'fixture'`) feeds (setup steps are
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

- `keyword` — case-insensitive regex tested against the event title.
- `symbol` / `color` — override the event's default styling.
- `transform` — rewrites the title with a regex. If `yearmatchgroup` is set,
  that capture group is treated as a birth year and replaced with the
  computed age instead of the literal year.
- `calendarName` *(extension)* — scope a rule to one calendar by name.
- `hide: true` *(extension)* — drop matching events entirely. `hide: false`
  explicitly keeps an event, shielding it from a later `hide: true` rule.
- `stop: true` *(extension)* — stop evaluating rules after this one.

### Field-level fall-through

Rules are tested top-to-bottom, and **the first rule to fill in a given field
wins that field** — a field a rule leaves out (or leaves blank) falls through
to later matching rules. So a broad rule can set a color while a narrower one
contributes the symbol:

```js
customEvents: [
  { keyword: 'Denver', color: '#5B7DB1' },            // colors anything Denver
  { keyword: 'Flight', symbol: 'fa-solid fa-plane' }, // and this still adds the plane
]
```

`transform` and `hide` work the same way: the first matching rule that states
an opinion decides, and later ones don't override it.

This differs from MagicMirror, where the first matching rule ends evaluation
outright. Add `stop: true` to a rule to get that behavior back — worth doing if
you relied on a specific rule shielding an event from a broad `hide` rule
further down the list.

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

## Try it without a calendar account

The `fixture` calendar type reads a local `.ics` file, so you can run the whole
display — grid, agenda, styling rules — with no Google account, no API key, and
no network:

```bash
make demo          # generates demo/demo.ics for today, then starts on :8081
make demo-logs     # follow it
make demo-down     # stop it
```

`tools/generate-demo-ics.js` writes a fixture anchored to *today* (including a
deliberately overloaded day, a multi-day trip, and weekly recurring events), so
the grid is always full whenever you run it. `demo/config.js` is a working
example of the rules — including the color/symbol fall-through.

Point any calendar at a local file the same way:

```js
{ type: 'fixture', name: 'Test', color: '#5B7DB1', path: '/config/demo.ics' }
```

### Testing calendar code

`calendars.js` holds every calendar source behind a fetcher registry keyed by
`type`, and `fetchAll` takes that registry as an argument — so tests inject
fakes instead of reaching the network:

```js
const { events, errors } = await fetchAll(
  [{ type: 'fake', name: 'Test' }],
  { from, to },
  { fake: () => Promise.resolve([{ title: 'Injected', start: new Date() }]) }
);
```

`fetchGoogle` likewise takes its `fetch` as an injectable dependency
(`fetchGoogle(cal, from, to, { fetch: fakeFetch })`), so the Google response
mapping is covered without an API key. See `test/calendars.test.js`.

## Build and publish

Images are built and pushed by GitHub Actions
(`.github/workflows/docker-publish.yml`), which is free for public repos. It
runs the unit tests, then builds `linux/amd64` + `linux/arm64` and pushes to
Docker Hub on every push to `master` (`:latest`, `:master`, `:sha-xxxxxxx`) and
on `v*` tags (`:1.2.3`, `:1.2`). Pull requests build without pushing.

One-time setup on the GitHub repo (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `DOCKERHUB_TOKEN` | a Docker Hub **access token** (Account Settings → Personal access tokens) |
| Variable *(optional)* | `DOCKERHUB_USERNAME` | Docker Hub user, if it differs from the GitHub owner |
| Variable *(optional)* | `DOCKERHUB_IMAGE` | full image name, if it isn't `<owner>/wallmanac` |

Without `DOCKERHUB_TOKEN` the workflow still builds and tests — it just skips
the push and logs a warning.

To publish from your own machine instead, the `Makefile` runs the same steps:

```bash
make test            # unit tests, in a throwaway node container
make build           # single-arch image for this machine
make login           # docker login (use an access token)
make push            # multi-arch build + push :latest and :<package.json version>
make help            # everything else — up / down / logs / restart / release
```

Override the target repo inline: `make push DOCKERHUB_USER=me TAG=beta`.

## Notes

- Google Calendar is the more reliable source for an always-on display; ICS
  feeds work too (recurring events, including exceptions, are expanded
  server-side via `node-ical`).
- The backend re-fetches calendars every `refreshMinutes` (default 15) and
  serves cached results, so the display keeps working even if a calendar
  provider is briefly unreachable.
- Day cells are a fixed size (the display never scrolls), so the month grid
  fits as many events per day as physically fit, switches to single-line chips
  when a day is busy, and summarises the rest as "+N more". `maxEventsPerDayCell`
  is an optional hard cap on top of that; `0` means "whatever fits".
- All-day events are anchored to UTC midnight of the date they name, because
  `node-ical` resolves `VALUE=DATE` to midnight in the *server's* timezone —
  which would otherwise render them a day early on any display behind the
  container's zone (the container runs UTC).
- `npm test` runs the rule-engine and calendar-source tests
  (`node --test test/*.test.js`). No local Node? `make test` runs them in a
  container.

## License

[MIT](LICENSE)
