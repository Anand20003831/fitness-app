// GitHub contents API. The private repo holds one file, data.json, and this
// module is the only thing in the app that talks to the network on his behalf.
//
// The token is a fine-grained PAT scoped to the data repo alone, with Contents
// set to read and write. It lives in localStorage on each device and is never
// written to a file, never committed and never sent anywhere except api.github.com.

import { snapshot, mergeRemote, isDirty, markClean, local, onChange, getSetting, setSetting } from './store.js';

const API = 'https://api.github.com';
const FILE = 'data.json';
const DEBOUNCE_MS = 5000;

// Known sha of the remote file, needed to write without clobbering.
let sha = null;
let busy = false;
let flushTimer = null;
let lastError = null;
let started = false;

// ---------------------------------------------------------------- config
// Device-local. Deliberately not part of the synced document: the token must
// never travel into data.json, and the other two are per-device anyway.

export function getConfig() {
  return {
    owner: local('owner') || '',
    repo: local('repo') || 'fitness-data',
    token: local('token') || '',
    googleClientId: getSetting('googleClientId', '') || '',
  };
}

// The token and the repo coordinates stay device-local: the token must never
// travel into data.json, and it is entered per device on purpose. The Google
// client id is different. It is not a secret, it is the same on every device,
// and syncing it means he types it once rather than once per device.
export function setConfig(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'googleClientId') setSetting('googleClientId', value === '' ? null : value);
    else local(key, value === '' ? null : value);
  }
  sha = null; // a different repo or token means the old sha means nothing
  if (isConfigured()) syncNow();
  else emit('off');
}

export function isConfigured() {
  const { owner, token } = getConfig();
  return Boolean(owner && token);
}

// Never return the token itself to the UI. Enough to recognise it, no more.
export function tokenFingerprint() {
  const { token } = getConfig();
  if (!token) return null;
  return { prefix: token.slice(0, 11), last4: token.slice(-4), length: token.length };
}

// ---------------------------------------------------------------- status

const statusListeners = new Set();
let status = 'off';

export function onStatus(fn) {
  statusListeners.add(fn);
  fn(status, lastError);
  return () => statusListeners.delete(fn);
}

function emit(next, error = null) {
  status = next;
  lastError = error;
  for (const fn of statusListeners) {
    try { fn(status, lastError); } catch (err) { console.error(err); }
  }
}

export function getStatus() {
  return { status, error: lastError };
}

// ---------------------------------------------------------------- base64
// btoa only handles latin-1, so the JSON goes through UTF-8 both ways.

function encode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decode(base64) {
  const binary = atob(String(base64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------- errors
//
// Every failure gets a sentence he can act on. A fine-grained token that is not
// scoped to the repo returns 404 rather than 403, which reads as "missing" but
// is really "not allowed", so that case says both.

function describe(response) {
  const status = response.status;
  if (status === 401) {
    return {
      kind: 'auth',
      message: 'Token expired or revoked, add a new one in Settings.',
    };
  }
  if (status === 403) {
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      return { kind: 'ratelimit', message: 'GitHub rate limit reached. It will sync again shortly.' };
    }
    return {
      kind: 'permission',
      message: 'GitHub refused the token. Check Contents is set to Read and write.',
    };
  }
  if (status === 404) {
    return {
      kind: 'missing',
      message: 'Repo or data.json not found, or the token is not scoped to this repo.',
    };
  }
  if (status === 409 || status === 422) {
    return {
      kind: 'conflict',
      message: 'The other device wrote at the same moment. Nothing is lost, it will try again shortly.',
    };
  }
  return { kind: 'http', message: `GitHub returned ${status}. It will try again shortly.` };
}

function request(path, options = {}) {
  const { token } = getConfig();
  return fetch(`${API}/${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
}

function contentsPath() {
  const { owner, repo } = getConfig();
  return `repos/${owner}/${repo}/contents/${FILE}`;
}

// ---------------------------------------------------------------- test
//
// Hits the contents endpoint for data.json specifically. A repo-list endpoint
// would pass on Metadata alone and tell him nothing about whether the one
// permission that matters actually works.

export async function testConnection() {
  const { owner, repo, token } = getConfig();
  if (!owner) return { ok: false, message: 'Add your GitHub username first.' };
  if (!token) return { ok: false, message: 'Add the token first.' };

  try {
    const response = await request(contentsPath());
    if (response.ok) {
      const json = await response.json();
      return {
        ok: true,
        message: `Connected. Read ${FILE} from ${owner}/${repo}, ${json.size} bytes.`,
      };
    }
    if (response.status === 404) {
      // Distinguish "no such file" from "no access to the repo": a token that
      // cannot see the repo cannot see its root either.
      const rootResponse = await request(`repos/${owner}/${repo}/contents/`);
      if (rootResponse.ok) {
        return {
          ok: true,
          message: `Connected to ${owner}/${repo}. No ${FILE} yet, the first sync will create it.`,
        };
      }
      return { ok: false, message: describe(rootResponse).message };
    }
    return { ok: false, message: describe(response).message };
  } catch {
    return { ok: false, message: 'Could not reach GitHub. Check your connection.' };
  }
}

// Writing needs Contents: write, which a read test cannot prove on its own.
// This is only run from the Settings button, never automatically.
export async function testWrite() {
  const result = await pull();
  if (!result.ok && result.kind !== 'empty') return { ok: false, message: result.message };
  const pushed = await pushNow();
  return pushed.ok
    ? { ok: true, message: 'Write confirmed. Contents is set to Read and write.' }
    : { ok: false, message: pushed.message };
}

// ---------------------------------------------------------------- pull

export async function pull() {
  if (!isConfigured()) return { ok: false, kind: 'unconfigured', message: 'Not configured.' };
  try {
    const response = await request(contentsPath());
    if (response.status === 404) {
      sha = null;
      return { ok: true, kind: 'empty', changed: false };
    }
    if (!response.ok) {
      const detail = describe(response);
      return { ok: false, ...detail };
    }
    const json = await response.json();
    sha = json.sha;
    let remote;
    try {
      remote = JSON.parse(decode(json.content));
    } catch {
      return { ok: false, kind: 'corrupt', message: 'data.json in the repo is not valid JSON.' };
    }
    const changed = mergeRemote(remote);
    return { ok: true, changed };
  } catch {
    return { ok: false, kind: 'offline', message: 'Offline.' };
  }
}

// ---------------------------------------------------------------- push

async function put(body) {
  return request(contentsPath(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function pushNow({ retried = false } = {}) {
  if (!isConfigured()) return { ok: false, kind: 'unconfigured', message: 'Not configured.' };
  const payload = {
    message: `sync from ${navigator.platform || 'device'}`,
    content: encode(JSON.stringify(snapshot(), null, 1)),
  };
  if (sha) payload.sha = sha;

  try {
    let response = await put(payload);

    // Someone else wrote since the last read. Re-read, re-merge, retry once.
    if ((response.status === 409 || response.status === 422) && !retried) {
      const pulled = await pull();
      if (!pulled.ok && pulled.kind !== 'empty') return pulled;
      return pushNow({ retried: true });
    }

    if (!response.ok) return { ok: false, ...describe(response) };

    const json = await response.json();
    sha = json.content && json.content.sha;
    markClean();
    return { ok: true };
  } catch {
    return { ok: false, kind: 'offline', message: 'Offline.' };
  }
}

// ---------------------------------------------------------------- orchestration

// Failures that fix themselves given time, versus failures that need him to go
// and do something. Only the first kind is worth retrying on a timer.
const RECOVERABLE = new Set(['conflict', 'ratelimit', 'http', 'offline']);
let retryTimer = null;
let retryDelay = 0;

function scheduleRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryDelay = retryDelay ? Math.min(retryDelay * 2, 5 * 60 * 1000) : 30 * 1000;
  retryTimer = setTimeout(() => { retryTimer = null; syncNow(); }, retryDelay);
}

function clearRetry() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  retryDelay = 0;
}

function fail(result) {
  emit(result.kind === 'offline' ? 'offline' : 'error', result.message);
  // Without this, a transient failure leaves his sets sitting unsynced until he
  // happens to edit something else. Nothing is lost, but nothing arrives either.
  if (RECOVERABLE.has(result.kind) && isDirty()) scheduleRetry();
  return result;
}

export async function syncNow() {
  if (!isConfigured()) { emit('off'); return { ok: false, kind: 'unconfigured' }; }
  if (busy) return { ok: false, kind: 'busy' };
  if (!navigator.onLine) { emit('offline'); return fail({ kind: 'offline', message: 'Offline.' }); }

  busy = true;
  emit('pending');
  try {
    const pulled = await pull();
    if (!pulled.ok && pulled.kind !== 'empty') return fail(pulled);
    if (isDirty()) {
      const pushed = await pushNow();
      if (!pushed.ok) return fail(pushed);
    }
    clearRetry();
    emit('synced');
    return { ok: true };
  } finally {
    busy = false;
  }
}

// He taps through ten sets in two minutes. That is one write, not ten.
function scheduleFlush() {
  if (!isConfigured()) return;
  if (flushTimer) clearTimeout(flushTimer);
  emit('pending');
  flushTimer = setTimeout(() => { flushTimer = null; syncNow(); }, DEBOUNCE_MS);
}

export function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  return syncNow();
}

export function start() {
  if (started) return;
  started = true;

  onChange(() => { if (isDirty()) scheduleFlush(); });

  // Leaving the app is the last safe moment to write.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && isDirty()) flushNow();
  });

  window.addEventListener('online', () => { if (isConfigured()) syncNow(); });
  window.addEventListener('offline', () => emit('offline'));

  if (!isConfigured()) { emit('off'); return; }
  if (!navigator.onLine) { emit('offline'); return; }
  syncNow();
}
