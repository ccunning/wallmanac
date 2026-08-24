const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { applyCustomEvents } = require('./customEvents');
const { fetchRange, fetchAll } = require('./calendars');
const googleTasks = require('./googleTasks');

const app = express();

const CONFIG_PATH = '/config/config.js';

function getConfig() {
  delete require.cache[CONFIG_PATH];
  return require(CONFIG_PATH);
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const sessions = new Map(); // token -> expiresAt (ms)

function getConfigPassword() {
  const { settings } = getConfig();
  const pw = settings && settings.configPassword;
  return typeof pw === 'string' && pw.length > 0 ? pw : null;
}

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidToken(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function requireAuth(req, res, next) {
  const pw = getConfigPassword();
  if (!pw) return next(); // auth disabled
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  if (isValidToken(token)) return next();
  res.status(401).json({ error: 'Authentication required' });
}

let cache = { rawEvents: [], errors: [], lastUpdated: null };
let todoCache = { todos: [], connected: false, error: null, lastUpdated: null };

async function refreshData() {
  const { settings, calendars } = getConfig();
  const { events, errors } = await fetchAll(calendars, fetchRange(settings));
  errors.forEach((message) => console.error(`[wallmanac] fetch failed for ${message}`));
  cache = { rawEvents: events, errors, lastUpdated: new Date().toISOString() };
  console.log(`[wallmanac] refreshed: ${events.length} events, ${errors.length} errors`);
}

async function refreshTodos() {
  const { googleTasks: tasksConfig } = getConfig();
  if (!tasksConfig || !tasksConfig.enabled) {
    todoCache = { todos: [], connected: false, error: null, lastUpdated: new Date().toISOString() };
    return;
  }
  if (!googleTasks.isConnected()) {
    todoCache = { todos: [], connected: false, error: 'Not connected — visit /auth/google to authorize', lastUpdated: new Date().toISOString() };
    return;
  }
  try {
    const todos = await googleTasks.fetchTasks(tasksConfig);
    todoCache = { todos, connected: true, error: null, lastUpdated: new Date().toISOString() };
  } catch (err) {
    console.error('[wallmanac] Google Tasks fetch failed:', err.message);
    todoCache = { ...todoCache, connected: true, error: err.message, lastUpdated: new Date().toISOString() };
  }
}

app.get('/api/auth/status', (req, res) => {
  const pw = getConfigPassword();
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  res.json({ authRequired: !!pw, authenticated: !pw || isValidToken(token) });
});

app.post('/api/auth/login', express.json({ limit: '4kb' }), (req, res) => {
  const pw = getConfigPassword();
  if (!pw) return res.json({ ok: true, token: null, authRequired: false });
  const supplied = (req.body && req.body.password) || '';
  if (!safeEqual(supplied, pw)) return res.status(401).json({ error: 'Incorrect password' });
  const token = issueToken();
  res.json({ ok: true, token, expiresIn: SESSION_TTL_MS });
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

app.get('/api/config', requireAuth, (req, res) => {
  try { res.json(getConfig()); }
  catch(err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/config', requireAuth, express.json({ limit: '1mb' }), (req, res) => {
  const backup = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;
  try {
    fs.writeFileSync(CONFIG_PATH, 'module.exports = ' + JSON.stringify(req.body, null, 2) + ';\n');
    delete require.cache[CONFIG_PATH];
    require(CONFIG_PATH);
    res.json({ ok: true });
  } catch(err) {
    if (backup) { try { fs.writeFileSync(CONFIG_PATH, backup); } catch(_) {} }
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/config/download', requireAuth, (req, res) => {
  res.download(CONFIG_PATH, 'config.js');
});

app.post('/api/config/upload', requireAuth, express.text({ limit: '1mb', type: 'text/plain' }), (req, res) => {
  const backup = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf8') : null;
  try {
    fs.writeFileSync(CONFIG_PATH, req.body);
    delete require.cache[CONFIG_PATH];
    require(CONFIG_PATH);
    res.json({ ok: true });
  } catch(err) {
    if (backup) { try { fs.writeFileSync(CONFIG_PATH, backup); } catch(_) {} }
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/events', (req, res) => {
  const { customEvents } = getConfig();
  const events = cache.rawEvents
    .map((ev) => applyCustomEvents(ev, customEvents))
    .filter((ev) => ev !== null);
  res.json({ events, errors: cache.errors, lastUpdated: cache.lastUpdated });
});

app.get('/api/todos', (req, res) => {
  res.json(todoCache);
});

app.get('/api/settings', (req, res) => {
  const { settings, googleTasks: tasksConfig } = getConfig();
  res.json({ ...settings, todosEnabled: !!(tasksConfig && tasksConfig.enabled), todoTitle: tasksConfig && tasksConfig.title });
});

// One-time setup: visit this from a browser on the machine running Docker.
app.get('/auth/google', (req, res) => {
  const { googleTasks: tasksConfig } = getConfig();
  if (!tasksConfig || !tasksConfig.enabled) {
    return res.status(400).send('Google Tasks is not enabled in config.js (set googleTasks.enabled = true).');
  }
  res.redirect(googleTasks.getAuthUrl(tasksConfig));
});

app.get('/oauth2callback', async (req, res) => {
  const { googleTasks: tasksConfig } = getConfig();
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google returned an error: ${error}`);
  if (!code) return res.status(400).send('No authorization code received.');
  try {
    await googleTasks.exchangeCode(code, tasksConfig);
    await refreshTodos();
    res.send('Connected to Google Tasks. You can close this tab — the wall display will pick up your to-do list on its next refresh.');
  } catch (err) {
    res.status(500).send(`Failed to connect: ${err.message}`);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const { settings: initialSettings, calendars: initialCalendars } = getConfig();
const port = initialSettings.port || 3000;
app.listen(port, () => {
  console.log(`[wallmanac] listening on port ${port}`);
  if (initialCalendars.length === 0) {
    console.warn('[wallmanac] no calendars configured — edit config.js');
  }
  refreshData();
  refreshTodos();
  setInterval(refreshData, initialSettings.refreshMinutes * 60 * 1000);
  setInterval(refreshTodos, initialSettings.refreshMinutes * 60 * 1000);
});
