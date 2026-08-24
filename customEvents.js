// Replicates MagicMirror's calendar module `customEvents` behavior, with a
// property-level fall-through extension:
// - keyword: case-insensitive regex tested against the event title.
// - Rules are evaluated top-to-bottom. The first rule that supplies a given
//   property wins *that property*; properties a rule leaves blank fall through
//   to later matching rules. So a high-priority rule can set only a color and
//   let a lower-priority rule contribute the symbol.
// - symbol: any string override (emoji, Font Awesome classes, or short label).
//   Blank/omitted means "no opinion" — keep looking.
// - color: CSS color override. Blank/omitted means "no opinion".
// - transform: { search, replace, yearmatchgroup } regex title rewrite. Only
//   the first matching rule with a usable transform is applied.
//   yearmatchgroup: if set, that capture group is treated as a birth year and
//   swapped for a computed age (relative to the event's own date) instead of
//   being inserted literally — this reproduces MagicMirror's birthday-age trick.
//
// Extensions beyond the original MagicMirror spec (documented, opt-in):
// - calendarName: scope a rule to one calendar only (by its `name` in config.js)
// - hide: true — drop the event entirely instead of just restyling it.
//   hide: false — explicitly keep the event, shielding it from any later
//   matching `hide: true` rule. The first matching rule that states an opinion
//   about `hide` decides.
// - stop: true — stop evaluating rules after this one (MagicMirror's original
//   break-on-first-match behavior, opt-in per rule).

// Blank strings mean "no opinion" so the property falls through to later rules.
function isSet(value) {
  return typeof value === 'string' ? value.trim() !== '' : value != null;
}

function applyTransform(title, transform, eventDate) {
  const { search, replace, yearmatchgroup } = transform;
  let re;
  try {
    re = new RegExp(search);
  } catch (err) {
    return title; // bad regex in config — leave title untouched
  }
  const match = title.match(re);
  if (!match) return title;

  let finalReplace = replace;
  if (yearmatchgroup) {
    const yearStr = match[yearmatchgroup];
    const year = parseInt(yearStr, 10);
    if (!isNaN(year)) {
      const age = eventDate.getFullYear() - year;
      // Replace only the exact group reference (e.g. $2), not $20, $21, etc.
      const groupRef = new RegExp('\\$' + yearmatchgroup + '(?!\\d)', 'g');
      finalReplace = finalReplace.replace(groupRef, String(age));
    }
  }
  return title.replace(re, finalReplace);
}

function applyCustomEvents(event, customEvents) {
  if (!customEvents || customEvents.length === 0) return event;

  let symbolSet = false;
  let colorSet = false;
  let transformed = false;
  let hideDecided = false;

  for (const rule of customEvents) {
    if (rule.calendarName && rule.calendarName !== event.calendarName) continue;

    let re;
    try {
      re = new RegExp(rule.keyword, 'i');
    } catch (err) {
      continue; // bad regex in config — skip this rule
    }
    if (!re.test(event.title)) continue;

    if (!hideDecided && rule.hide !== undefined && rule.hide !== null && rule.hide !== '') {
      hideDecided = true;
      if (rule.hide) return null;
    }
    if (!symbolSet && isSet(rule.symbol)) {
      event.symbol = rule.symbol;
      symbolSet = true;
    }
    if (!colorSet && isSet(rule.color)) {
      event.color = rule.color;
      colorSet = true;
    }
    if (!transformed && rule.transform && isSet(rule.transform.search)) {
      event.title = applyTransform(event.title, rule.transform, event.start);
      transformed = true;
    }

    if (rule.stop) break; // opt-in: MagicMirror's original first-match-wins
  }
  return event;
}

module.exports = { applyCustomEvents, applyTransform };
