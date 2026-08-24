const fs = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, 'data', 'google-token.json');
const AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TASKS_BASE = 'https://tasks.googleapis.com/tasks/v1';
const SCOPE = 'https://www.googleapis.com/auth/tasks.readonly';

let inMemoryTokens = null; // { access_token, refresh_token, expires_at }

function loadTokens() {
  if (inMemoryTokens) return inMemoryTokens;
  try {
    const raw = fs.readFileSync(TOKEN_PATH, 'utf8');
    inMemoryTokens = JSON.parse(raw);
  } catch (err) {
    inMemoryTokens = null; // no token file yet — not authorized
  }
  return inMemoryTokens;
}

function saveTokens(tokens) {
  fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  inMemoryTokens = tokens;
}

function isConnected() {
  const t = loadTokens();
  return !!(t && t.refresh_token);
}

function getAuthUrl(cfg) {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // forces a refresh_token to be issued even on repeat auth
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

async function exchangeCode(code, cfg) {
  const params = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token exchange failed: ${data.error_description || data.error || res.status}`);

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token, // only present on first consent (with prompt=consent)
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function refreshAccessToken(cfg) {
  const current = loadTokens();
  if (!current || !current.refresh_token) throw new Error('Not connected to Google Tasks yet — visit /auth/google');

  const params = new URLSearchParams({
    refresh_token: current.refresh_token,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${data.error_description || data.error || res.status}`);

  const tokens = {
    access_token: data.access_token,
    refresh_token: current.refresh_token, // refresh_token is reused, Google doesn't resend it
    expires_at: Date.now() + data.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

async function getValidAccessToken(cfg) {
  let tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) throw new Error('Not connected to Google Tasks yet — visit /auth/google');
  // Refresh a bit early (60s buffer) rather than right at expiry
  if (!tokens.expires_at || Date.now() > tokens.expires_at - 60000) {
    tokens = await refreshAccessToken(cfg);
  }
  return tokens.access_token;
}

async function fetchTasks(cfg) {
  const accessToken = await getValidAccessToken(cfg);
  const url = `${TASKS_BASE}/lists/${encodeURIComponent(cfg.taskListId)}/tasks`
    + `?showCompleted=false&showHidden=false&maxResults=100`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google Tasks: HTTP ${res.status} ${body}`);
  }
  const data = await res.json();
  return (data.items || [])
    .filter((t) => t.status !== 'completed')
    .map((t) => ({
      id: t.id,
      title: t.title || '(untitled)',
      due: t.due || null, // RFC3339 date, time portion is always midnight per the Tasks API
      notes: t.notes || null,
    }))
    .sort((a, b) => {
      if (a.due && b.due) return new Date(a.due) - new Date(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return 0;
    });
}

module.exports = { getAuthUrl, exchangeCode, fetchTasks, isConnected };
