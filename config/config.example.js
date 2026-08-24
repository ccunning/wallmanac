// Copy this file to `config/config.js` and fill in your own values.
// The container reads /config/config.js at runtime; edits are picked up
// on the next request (see README for restart-vs-reload details).

module.exports = {
  // One or more calendar feeds. Each entry is either a Google Calendar
  // (type: 'google' with a public API key + calendarId) or an ICS URL
  // (type: 'ics' with a url — private ICS URLs work too, and are the
  // easiest way to display a personal Google Calendar without an API key).
  calendars: [
    // {
    //   type: 'google',
    //   name: 'Family',
    //   color: '#5B7DB1',
    //   apiKey: 'YOUR_GOOGLE_API_KEY',
    //   calendarId: 'family-calendar-id@group.calendar.google.com',
    // },
    // {
    //   type: 'ics',
    //   name: 'Home',
    //   color: '#5B7DB1',
    //   url: 'https://example.com/path/to/calendar.ics',
    // },
  ],

  // Keyword-based rules to restyle, hide, or rewrite events (MagicMirror
  // customEvents port — see README for the full rule reference).
  customEvents: [
    // { keyword: 'Birthday', color: 'Gold', symbol: 'fa-solid fa-cake-candles' },
    // { keyword: 'Doctor',   color: '#5FA8A0', symbol: 'fa-solid fa-stethoscope' },
  ],

  settings: {
    weekStartsOn: 0,               // 0 = Sunday, 1 = Monday
    use24HourClock: false,
    agendaDaysAhead: 60,
    refreshMinutes: 5,             // upstream calendar re-fetch interval
    maxEventsPerDayCell: 2,
    maxEventsPerWeekStripCell: 3,
    weekStripHeight: '120px',
    port: 3000,
    // Set a password to require login for the settings UI. Leave empty ('')
    // to leave the settings UI open (fine for a private LAN display).
    configPassword: '',
    theme: {
      ink:        '#12181B',
      panel:      '#1B2327',
      panelLine:  '#2A3439',
      text:       '#EDEAE2',
      textDim:    '#8C979B',
      todayRing:  '#5FA8A0',
    },
  },

  // Optional: read-only Google Tasks integration for the sidebar to-do list.
  // See README for the one-time OAuth setup.
  googleTasks: {
    enabled: false,
    clientId:     'YOUR_CLIENT_ID.apps.googleusercontent.com',
    clientSecret: 'YOUR_CLIENT_SECRET',
    redirectUri:  'http://localhost:3000/oauth2callback',
    taskListId:   '@default',
    title:        'To-do',
  },
};
