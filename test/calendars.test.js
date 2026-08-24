const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { fetchRange, fetchGoogle, fetchFixture, fetchAll } = require('../calendars');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample.ics');
const RANGE = { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-03-31T23:59:59Z') };

// ── fetchRange ────────────────────────────────────────────────────────────
test('fetchRange starts a month early so the grid\'s leading days have data', () => {
  const { from, to } = fetchRange({ agendaDaysAhead: 60 }, new Date('2026-03-14T12:00:00Z'));
  assert.strictEqual(from.getMonth(), 1); // February
  assert.strictEqual(from.getDate(), 1);
  assert.ok(to > new Date('2026-05-12T00:00:00Z'), 'covers the agenda window');
});

test('fetchRange never looks less than 45 days ahead', () => {
  const { from, to } = fetchRange({ agendaDaysAhead: 1 }, new Date('2026-03-14T12:00:00Z'));
  assert.ok((to - from) / 86400000 > 55);
});

// ── fetchAll dispatch, merging, error isolation ───────────────────────────
test('fetchAll dispatches on type and merges every feed', async () => {
  const fake = (cal) => Promise.resolve([{ title: `from ${cal.name}`, calendarName: cal.name }]);
  const { events, errors } = await fetchAll(
    [{ type: 'a', name: 'One' }, { type: 'b', name: 'Two' }],
    RANGE,
    { a: fake, b: fake }
  );
  assert.deepStrictEqual(events.map((e) => e.title), ['from One', 'from Two']);
  assert.deepStrictEqual(errors, []);
});

test('one failing feed does not take down the others', async () => {
  const { events, errors } = await fetchAll(
    [{ type: 'ok', name: 'Good' }, { type: 'bad', name: 'Broken' }],
    RANGE,
    {
      ok: () => Promise.resolve([{ title: 'kept' }]),
      bad: () => Promise.reject(new Error('HTTP 500')),
    }
  );
  assert.deepStrictEqual(events.map((e) => e.title), ['kept']);
  assert.deepStrictEqual(errors, ['Broken: HTTP 500']);
});

test('an unknown calendar type reports an error instead of throwing', async () => {
  const { events, errors } = await fetchAll([{ type: 'nope', name: 'Mystery' }], RANGE, {});
  assert.deepStrictEqual(events, []);
  assert.match(errors[0], /Mystery: unknown calendar type 'nope'/);
});

test('a typed-less calendar with a url still falls back to ics', async () => {
  let called = false;
  const { errors } = await fetchAll([{ name: 'Legacy', url: 'http://x/y.ics' }], RANGE, {
    ics: () => { called = true; return Promise.resolve([]); },
  });
  assert.ok(called, 'ics fetcher should have been used');
  assert.deepStrictEqual(errors, []);
});

// ── fixture (local .ics) fetcher ──────────────────────────────────────────
test('fetchFixture reads a local .ics file', async () => {
  const events = await fetchFixture({ name: 'Test', color: '#123456', path: SAMPLE }, RANGE.from, RANGE.to);
  const meeting = events.find((e) => e.title === 'Sample Meeting');
  assert.ok(meeting, 'timed event parsed');
  assert.strictEqual(meeting.allDay, false);
  assert.strictEqual(meeting.calendarName, 'Test');
  assert.strictEqual(meeting.color, '#123456');
  assert.strictEqual(meeting.start.getFullYear(), 2026);
});

test('fetchFixture flags all-day events', async () => {
  const events = await fetchFixture({ name: 'Test', path: SAMPLE }, RANGE.from, RANGE.to);
  assert.strictEqual(events.find((e) => e.title === 'Sample Holiday').allDay, true);
});

test('fetchFixture expands recurring events across the range', async () => {
  const events = await fetchFixture({ name: 'Test', path: SAMPLE }, RANGE.from, RANGE.to);
  const sync = events.filter((e) => e.title === 'Weekly Sync');
  assert.strictEqual(sync.length, 5, 'five weekly instances fall inside March');
});

test('a missing fixture file is reported, not thrown as a raw ENOENT', async () => {
  const { errors } = await fetchAll(
    [{ type: 'fixture', name: 'Gone', path: '/nope/missing.ics' }],
    RANGE
  );
  assert.match(errors[0], /Gone: Fixture calendar \(Gone\)/);
});

test('a fixture calendar without a path is a clear config error', async () => {
  const { errors } = await fetchAll([{ type: 'fixture', name: 'Empty' }], RANGE);
  assert.match(errors[0], /has no path/);
});

// ── google fetcher, with fetch injected ───────────────────────────────────
const googleResponse = (items) => ({
  ok: true,
  json: async () => ({ items }),
});

test('fetchGoogle maps timed and all-day items without touching the network', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    return googleResponse([
      { summary: 'Timed', start: { dateTime: '2026-03-14T10:00:00Z' }, end: { dateTime: '2026-03-14T11:00:00Z' } },
      { summary: 'All day', start: { date: '2026-03-16' }, end: { date: '2026-03-17' } },
    ]);
  };
  const events = await fetchGoogle(
    { name: 'Work', color: '#abc', calendarId: 'a@b.com', apiKey: 'KEY' },
    RANGE.from, RANGE.to, { fetch: fakeFetch }
  );
  assert.deepStrictEqual(events.map((e) => [e.title, e.allDay]), [['Timed', false], ['All day', true]]);
  assert.match(calls[0], /calendars\/a%40b\.com\/events/, 'calendar id is url-encoded');
  assert.match(calls[0], /singleEvents=true/);
});

test('fetchGoogle falls back to (untitled)', async () => {
  const events = await fetchGoogle({ name: 'Work' }, RANGE.from, RANGE.to, {
    fetch: async () => googleResponse([{ start: { date: '2026-03-16' }, end: { date: '2026-03-17' } }]),
  });
  assert.strictEqual(events[0].title, '(untitled)');
});

test('fetchGoogle turns a non-OK response into a named error', async () => {
  await assert.rejects(
    fetchGoogle({ name: 'Work' }, RANGE.from, RANGE.to, { fetch: async () => ({ ok: false, status: 403 }) }),
    /Google Calendar \(Work\): HTTP 403/
  );
});

test('an empty calendar list is not an error', async () => {
  assert.deepStrictEqual(await fetchAll([], RANGE), { events: [], errors: [] });
});

// ── all-day events are calendar dates, not instants ───────────────────────
// Regression: node-ical resolves VALUE=DATE to midnight in the *server's*
// timezone, so an untouched all-day event renders a day early for any viewer
// behind the container's zone. These must hold whatever TZ the suite runs in.
test('an all-day event is anchored to UTC midnight of the date it names', async () => {
  const events = await fetchFixture({ name: 'Test', path: SAMPLE }, RANGE.from, RANGE.to);
  const holiday = events.find((e) => e.title === 'Sample Holiday');
  assert.strictEqual(holiday.start.toISOString(), '2026-03-16T00:00:00.000Z');
  assert.strictEqual(holiday.end.toISOString(), '2026-03-17T00:00:00.000Z');
});

test('timed events keep their exact instant', async () => {
  const events = await fetchFixture({ name: 'Test', path: SAMPLE }, RANGE.from, RANGE.to);
  const meeting = events.find((e) => e.title === 'Sample Meeting');
  // 10:00 floating in the fixture == 10:00 in whatever zone the server runs in.
  assert.strictEqual(meeting.start.getHours(), 10);
});

test('the google all-day mapping is already UTC-midnight anchored', async () => {
  const events = await fetchGoogle({ name: 'Work' }, RANGE.from, RANGE.to, {
    fetch: async () => googleResponse([{ summary: 'Holiday', start: { date: '2026-03-16' }, end: { date: '2026-03-17' } }]),
  });
  assert.strictEqual(events[0].start.toISOString(), '2026-03-16T00:00:00.000Z');
});
