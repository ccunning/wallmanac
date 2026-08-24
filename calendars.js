// Calendar sources, split out of server.js so they can be exercised without a
// live Google account (or any network at all): `fetchAll` takes the fetcher map
// it dispatches on, so a test can hand it fakes, and the `fixture` type reads a
// local .ics file. See test/calendars.test.js.

const ical = require('node-ical');

// Deliberately starts one month before "now" so the month grid's leading
// overflow days from the previous month have data.
function fetchRange(settings, now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getTime());
  to.setDate(to.getDate() + Math.max(settings.agendaDaysAhead + 1, 45));
  return { from, to };
}

// `deps.fetch` is injectable so the Google mapping below can be tested against
// a canned API payload without an API key.
async function fetchGoogle(cal, from, to, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.calendarId)}/events`
    + `?key=${cal.apiKey}&singleEvents=true&orderBy=startTime`
    + `&timeMin=${from.toISOString()}&timeMax=${to.toISOString()}`;
  const res = await doFetch(url);
  if (!res.ok) throw new Error(`Google Calendar (${cal.name}): HTTP ${res.status}`);
  const data = await res.json();
  return (data.items || []).map((item) => {
    const allDay = !!item.start.date;
    return {
      title: item.summary || '(untitled)',
      start: new Date(item.start.date || item.start.dateTime),
      end: new Date(item.end.date || item.end.dateTime),
      allDay,
      calendarName: cal.name,
      color: cal.color,
    };
  });
}

// node-ical resolves a VALUE=DATE (all-day) property to midnight *in the
// server's timezone*, so the instant it produces lands on the previous day for
// any browser west of the container's zone — the container runs UTC, the wall
// display usually doesn't. Re-anchor all-day events to UTC midnight of the
// calendar date they actually name; the frontend reads them back with the UTC
// getters. Timed events are true instants and are left alone.
function toUtcMidnight(d) {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// Shared by the remote (`ics`) and local (`fixture`) paths — both end up with
// the same parsed structure from node-ical.
function expandVEvents(data, cal, from, to) {
  const events = [];
  for (const key in data) {
    const item = data[key];
    if (item.type !== 'VEVENT') continue;
    const isAllDay = item.datetype === 'date';
    let instances;
    try {
      instances = ical.expandRecurringEvent(item, { from, to });
    } catch (err) {
      continue; // malformed recurrence rule in this feed — skip just this event
    }
    for (const inst of instances) {
      events.push({
        title: inst.summary || item.summary || '(untitled)',
        start: isAllDay ? toUtcMidnight(inst.start) : inst.start,
        end: isAllDay ? toUtcMidnight(inst.end) : inst.end,
        allDay: isAllDay,
        calendarName: cal.name,
        color: cal.color,
      });
    }
  }
  return events;
}

async function fetchIcs(cal, from, to) {
  if (!cal.url) throw new Error(`ICS calendar (${cal.name}) has no url`);
  return expandVEvents(await ical.async.fromURL(cal.url), cal, from, to);
}

// Local .ics file — for demos and for testing the display without wiring up a
// real calendar. `path` is resolved inside the container, so it normally points
// somewhere under the mounted /config directory.
async function fetchFixture(cal, from, to) {
  if (!cal.path) throw new Error(`Fixture calendar (${cal.name}) has no path`);
  let data;
  try {
    data = await ical.async.parseFile(cal.path);
  } catch (err) {
    throw new Error(`Fixture calendar (${cal.name}): ${err.message}`);
  }
  return expandVEvents(data, cal, from, to);
}

const FETCHERS = { google: fetchGoogle, ics: fetchIcs, fixture: fetchFixture };

function resolveFetcher(cal, fetchers) {
  if (fetchers[cal.type]) return fetchers[cal.type];
  // Pre-`type` configs (and typos) that still carry a url keep working as ICS.
  if (cal.url && fetchers.ics) return fetchers.ics;
  return null;
}

// Fetches every calendar in parallel. One failing feed never takes down the
// others — its message lands in `errors` and the rest still render.
async function fetchAll(calendars, { from, to }, fetchers = FETCHERS) {
  const results = await Promise.allSettled(
    calendars.map((cal) => {
      const fetcher = resolveFetcher(cal, fetchers);
      if (!fetcher) return Promise.reject(new Error(`unknown calendar type '${cal.type}'`));
      return fetcher(cal, from, to);
    })
  );

  const events = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') events.push(...r.value);
    else errors.push(`${calendars[i].name}: ${r.reason.message}`);
  });
  return { events, errors };
}

module.exports = { fetchRange, fetchGoogle, fetchIcs, fetchFixture, fetchAll, expandVEvents, toUtcMidnight, FETCHERS };
