// Replicates MagicMirror's calendar module `customEvents` behavior:
// - keyword: case-insensitive regex tested against the event title. First matching
//   rule wins (matches MagicMirror's own break-on-first-match behavior).
// - symbol: any string override (emoji or short label — see note in README)
// - color: CSS color override
// - transform: { search, replace, yearmatchgroup } regex title rewrite.
//   yearmatchgroup: if set, that capture group is treated as a birth year and
//   swapped for a computed age (relative to the event's own date) instead of
//   being inserted literally — this reproduces MagicMirror's birthday-age trick.
//
// Extensions beyond the original MagicMirror spec (documented, opt-in):
// - calendarName: scope a rule to one calendar only (by its `name` in config.js)
// - hide: true — drop the event entirely instead of just restyling it

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

  for (const rule of customEvents) {
    if (rule.calendarName && rule.calendarName !== event.calendarName) continue;

    let re;
    try {
      re = new RegExp(rule.keyword, 'i');
    } catch (err) {
      continue; // bad regex in config — skip this rule
    }
    if (!re.test(event.title)) continue;

    if (rule.hide) return null;
    if (rule.symbol) event.symbol = rule.symbol;
    if (rule.color) event.color = rule.color;
    if (rule.transform) event.title = applyTransform(event.title, rule.transform, event.start);

    break; // first match wins, same as MagicMirror
  }
  return event;
}

module.exports = { applyCustomEvents, applyTransform };
