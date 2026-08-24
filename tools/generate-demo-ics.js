#!/usr/bin/env node
// Writes demo/demo.ics with events anchored to *today*, so the demo stack
// always fills the visible month grid no matter when it's run.
//
//   node tools/generate-demo-ics.js [outfile]
//   make demo            # regenerates and starts the demo stack

const fs = require('fs');
const path = require('path');

const out = process.argv[2] || path.join(__dirname, '..', 'demo', 'demo.ics');
const today = new Date();
today.setHours(0, 0, 0, 0);

const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return d;
};
const dateStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

// Times are written as real UTC instants derived from local wall-clock times.
// Floating times would be wrong here: the server parses them in the container's
// timezone (UTC) while the browser renders in yours, so a 9:15 event would
// arrive on screen hours off. Anchoring to UTC makes it land back on 9:15 in
// the timezone of the machine the fixture was generated on.
const utc = (d) => `${d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
const at = (d, hour, minute) => {
  const x = new Date(d);
  x.setHours(hour, minute, 0, 0);
  return x;
};

let uid = 0;
const lines = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//wallmanac//demo fixture//EN',
  'CALSCALE:GREGORIAN',
];

function timed(offset, hour, minute, summary, durationMin = 60, rrule) {
  const start = at(day(offset), hour, minute);
  const end = new Date(start.getTime() + durationMin * 60000);
  lines.push(
    'BEGIN:VEVENT',
    `UID:demo-${++uid}@wallmanac`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    ...(rrule ? [`RRULE:${rrule}`] : []),
    `SUMMARY:${summary}`,
    'END:VEVENT'
  );
}

function allDay(offset, summary, days = 1) {
  lines.push(
    'BEGIN:VEVENT',
    `UID:demo-${++uid}@wallmanac`,
    `DTSTAMP:${utc(new Date())}`,
    `DTSTART;VALUE=DATE:${dateStamp(day(offset))}`,
    `DTEND;VALUE=DATE:${dateStamp(day(offset + days))}`, // DTEND is exclusive
    `SUMMARY:${summary}`,
    'END:VEVENT'
  );
}

// Today is deliberately overloaded — this is the case that used to overflow
// into the week below, and now collapses into a "+N more" line.
allDay(0, 'Dentist appointment for the whole family');
timed(0, 9, 15, 'Soccer practice');
timed(0, 10, 30, 'Flight to Denver (UA 1234)', 150);
timed(0, 11, 45, 'Parent-teacher conference at Lincoln Elementary');
timed(0, 13, 0, 'Grocery pickup', 30);
timed(0, 15, 30, 'Vet — annual shots');
timed(0, 18, 0, 'Book club: The Overstory', 90);

timed(1, 8, 0, 'Piano lesson', 45);
timed(1, 17, 30, 'Anniversary dinner at that place downtown', 120);

timed(2, 9, 0, 'Sprint planning', 90);
timed(2, 12, 0, 'Lunch with Sam');
timed(2, 16, 0, 'Oil change');
allDay(2, "Dad's Birthday '1962");

timed(4, 19, 0, 'Trivia night', 120);
timed(5, 7, 30, 'Long run');
timed(5, 14, 0, 'Farmers market');

allDay(9, 'Portland trip', 3); // multi-day all-day event

timed(12, 9, 0, 'Flight to Denver (UA 887)', 180);
timed(12, 13, 0, 'Client workshop', 240);
timed(12, 18, 30, 'Team dinner', 90);
timed(12, 20, 30, 'Hotel check-in');
timed(12, 21, 0, 'Call home');

timed(16, 10, 0, 'Car inspection');
timed(16, 15, 0, 'Haircut', 30);

timed(21, 8, 30, 'Dentist — cleaning');
timed(21, 10, 0, 'Standup');
timed(21, 11, 0, 'Budget review', 60);
timed(21, 13, 30, 'School pickup');
timed(21, 16, 0, 'Soccer practice');
timed(21, 19, 0, 'Board game night', 150);

// Recurring events, so the fixture exercises the same RRULE expansion path a
// real ICS feed does — and keeps the grid populated past the hand-placed days.
timed(0, 9, 30, 'Standup', 15, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
timed(3, 20, 0, 'Trash night', 30, 'FREQ=WEEKLY');
timed(6, 11, 0, 'Farmers market', 120, 'FREQ=WEEKLY');

lines.push('END:VCALENDAR', '');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\r\n')); // RFC 5545 wants CRLF
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
console.log(`wrote ${out} (${uid} events, anchored to ${dateStamp(today)} in ${zone})`);
if (!process.env.TZ) {
  console.warn(`note: TZ was not set, so times are anchored to ${zone}. If the display`);
  console.warn('      shows them shifted, re-run with TZ=<your zone> (make demo does this).');
}
