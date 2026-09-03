const test = require('node:test');
const assert = require('node:assert');
const { applyCustomEvents, applyTransform } = require('../customEvents');

// Fixed date so the birthday-age assertions don't drift with the calendar.
const EVENT_DATE = new Date('2026-03-14T10:00:00Z');
const ev = (title, extra = {}) => ({
  title,
  start: EVENT_DATE,
  end: new Date('2026-03-14T11:00:00Z'),
  allDay: false,
  calendarName: 'Family',
  color: '#5B7DB1',
  ...extra,
});

test('a rule that only sets a color lets a later rule supply the symbol', () => {
  const r = applyCustomEvents(ev('Flight to Denver'), [
    { keyword: 'Denver', color: 'blue' },
    { keyword: 'Flight', symbol: 'fa-solid fa-plane' },
  ]);
  assert.strictEqual(r.color, 'blue');
  assert.strictEqual(r.symbol, 'fa-solid fa-plane');
});

test('blank and whitespace-only fields fall through too', () => {
  const r = applyCustomEvents(ev('Flight to Denver'), [
    { keyword: 'Denver', color: 'blue', symbol: '   ' },
    { keyword: 'Flight', symbol: 'fa-solid fa-plane', color: 'red' },
  ]);
  assert.strictEqual(r.color, 'blue');
  assert.strictEqual(r.symbol, 'fa-solid fa-plane');
});

test('the first rule to set a field wins that field', () => {
  const r = applyCustomEvents(ev('Flight to Denver'), [
    { keyword: 'Flight', symbol: 'A', color: 'green' },
    { keyword: 'Denver', symbol: 'B', color: 'blue' },
  ]);
  assert.strictEqual(r.symbol, 'A');
  assert.strictEqual(r.color, 'green');
});

test('stop: true restores MagicMirror first-match-wins behavior', () => {
  const r = applyCustomEvents(ev('Flight to Denver'), [
    { keyword: 'Denver', color: 'blue', stop: true },
    { keyword: 'Flight', symbol: 'fa-solid fa-plane' },
  ]);
  assert.strictEqual(r.color, 'blue');
  assert.strictEqual(r.symbol, undefined);
});

test('hide: true drops the event', () => {
  assert.strictEqual(applyCustomEvents(ev('Standup'), [{ keyword: 'Standup', hide: true }]), null);
});

test('a later hide rule still hides an already-styled event', () => {
  const r = applyCustomEvents(ev('Team Standup'), [
    { keyword: 'Team', color: 'blue' },
    { keyword: 'Standup', hide: true },
  ]);
  assert.strictEqual(r, null);
});

test('hide: false shields an event from a later hide rule', () => {
  const r = applyCustomEvents(ev('Team Standup'), [
    { keyword: 'Team', color: 'blue', hide: false },
    { keyword: 'Standup', hide: true },
  ]);
  assert.ok(r);
  assert.strictEqual(r.color, 'blue');
});

test('calendarName scopes a rule to one feed', () => {
  const r = applyCustomEvents(ev('Flight'), [
    { keyword: 'Flight', color: 'blue', calendarName: 'Work' },
    { keyword: 'Flight', color: 'green', calendarName: 'Family' },
  ]);
  assert.strictEqual(r.color, 'green');
});

test('birthday transform computes an age and still falls through for the symbol', () => {
  const r = applyCustomEvents(ev("Jane's Birthday '1990"), [
    { keyword: 'Birthday', color: 'Gold', transform: { search: "^(.*) '(\\d{4})$", replace: '$1 ($2)', yearmatchgroup: 2 } },
    { keyword: 'Jane', symbol: 'fa-solid fa-cake-candles' },
  ]);
  assert.strictEqual(r.title, "Jane's Birthday (36)");
  assert.strictEqual(r.color, 'Gold');
  assert.strictEqual(r.symbol, 'fa-solid fa-cake-candles');
});

test('only the first usable transform applies', () => {
  const r = applyCustomEvents(ev('Meeting with Bob'), [
    { keyword: 'Meeting', transform: { search: 'Meeting', replace: 'Mtg' } },
    { keyword: 'Bob', transform: { search: 'Bob', replace: 'Robert' } },
  ]);
  assert.strictEqual(r.title, 'Mtg with Bob');
});

test('an empty transform.search does not consume the transform slot', () => {
  const r = applyCustomEvents(ev('Meeting with Bob'), [
    { keyword: 'Meeting', transform: { search: '', replace: 'x' } },
    { keyword: 'Bob', transform: { search: 'Bob', replace: 'Robert' } },
  ]);
  assert.strictEqual(r.title, 'Meeting with Robert');
});

test('a bad regex skips its rule instead of crashing', () => {
  const r = applyCustomEvents(ev('Flight'), [
    { keyword: '([', color: 'blue' },
    { keyword: 'Flight', color: 'green' },
  ]);
  assert.strictEqual(r.color, 'green');
});

test('no rules leaves the event untouched', () => {
  assert.strictEqual(applyCustomEvents(ev('X'), []).color, '#5B7DB1');
  assert.strictEqual(applyCustomEvents(ev('X'), null).color, '#5B7DB1');
});

test('the age substitution does not swallow $20 as if it were $2', () => {
  // $2 becomes the age; $20 is left for String.replace, which reads it as
  // "group 2 followed by a literal 0" — i.e. the raw year, not the age.
  const out = applyTransform("Jane '1990", { search: "^(.*) '(\\d{4})$", replace: '$1 $2 $20', yearmatchgroup: 2 }, EVENT_DATE);
  assert.strictEqual(out, 'Jane 36 19900');
});

// ── emoji symbols ─────────────────────────────────────────────────────────
// Emoji are a first-class alternative to Font Awesome classes in `symbol`,
// so they have to survive the rule engine byte-for-byte.
test('an emoji symbol is passed through unchanged', () => {
  const r = applyCustomEvents(ev('Jane\'s Birthday'), [{ keyword: 'Birthday', symbol: '🎂', color: 'Gold' }]);
  assert.strictEqual(r.symbol, '🎂');
  assert.strictEqual(r.color, 'Gold');
});

test('multi-codepoint emoji are not mangled by the rule engine', () => {
  for (const emoji of ['👨‍👩‍👧‍👦', '👍🏽', '🇺🇸', '❤️']) {
    const r = applyCustomEvents(ev('Family Dinner'), [{ keyword: 'Family', symbol: emoji }]);
    assert.strictEqual(r.symbol, emoji);
  }
});

test('an emoji symbol counts as "set" and stops the symbol fall-through', () => {
  const r = applyCustomEvents(ev('Flight to Denver'), [
    { keyword: 'Denver', symbol: '✈️' },
    { keyword: 'Flight', symbol: 'fa-solid fa-plane' },
  ]);
  assert.strictEqual(r.symbol, '✈️');
});

test('emoji and Font Awesome rules mix: a blank emoji slot still falls through', () => {
  const r = applyCustomEvents(ev('Soccer practice'), [
    { keyword: 'Soccer', color: '#C97064', symbol: '' },
    { keyword: 'practice', symbol: '⚽' },
  ]);
  assert.strictEqual(r.color, '#C97064');
  assert.strictEqual(r.symbol, '⚽');
});

test('an emoji symbol survives a transform on the same event', () => {
  const r = applyCustomEvents(ev("Jane's Birthday '1990"), [
    { keyword: 'Birthday', symbol: '🎂', transform: { search: "^(.*) '(\\d{4})$", replace: '$1 ($2)', yearmatchgroup: 2 } },
  ]);
  assert.strictEqual(r.title, "Jane's Birthday (36)");
  assert.strictEqual(r.symbol, '🎂');
});
