// Google Calendar, read only, entirely client side.
//
// Google Identity Services with the implicit token flow: no server, no client
// secret, nothing to deploy. The client id is not a secret, it is public by
// design and only works from the origins he registered.
//
// This whole module is optional. Every failure path ends in a quiet message on
// the Today tab, never an error and never a blocked render. The app has to be
// completely usable by someone who never sets this up.

import { local, getSetting } from './store.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

let gisPromise = null;
let tokenClient = null;

export function clientId() {
  return getSetting('googleClientId', '') || '';
}

export function isConfigured() {
  return Boolean(clientId());
}

// Access tokens from the implicit flow last about an hour and there is no
// refresh token, by design. Reconnecting is one tap, so that is fine.
function storedToken() {
  const raw = local('gcalToken');
  if (!raw) return null;
  try {
    const token = JSON.parse(raw);
    if (!token.access_token || !token.expires_at) return null;
    if (Date.now() > token.expires_at - 60000) return null;
    return token;
  } catch {
    return null;
  }
}

function storeToken(response) {
  local('gcalToken', JSON.stringify({
    access_token: response.access_token,
    expires_at: Date.now() + (Number(response.expires_in) || 3600) * 1000,
  }));
}

export function isConnected() {
  return Boolean(storedToken());
}

export function disconnect() {
  local('gcalToken', null);
  local('gcalCache', null);
}

function loadGis() {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Identity Services.'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

// Must be called from a real tap: it opens a popup, and browsers block popups
// that are not a direct result of a user gesture.
export async function connect() {
  if (!isConfigured()) return { ok: false, message: 'Add a Google client ID in Settings first.' };
  try {
    await loadGis();
  } catch {
    return { ok: false, message: 'Could not reach Google. Check your connection.' };
  }

  return new Promise((resolve) => {
    try {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPE,
        callback: (response) => {
          if (response && response.access_token) {
            storeToken(response);
            resolve({ ok: true });
          } else {
            resolve({ ok: false, message: 'Google did not return a token.' });
          }
        },
        error_callback: (err) => {
          const type = err && err.type;
          resolve({
            ok: false,
            message: type === 'popup_closed'
              ? 'Sign-in window was closed.'
              : type === 'popup_failed_to_open'
                ? 'The sign-in popup was blocked. Allow popups for this site and try again.'
                : 'Google refused the sign-in. Check the client ID and that this origin is authorised.',
          });
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    } catch {
      resolve({ ok: false, message: 'Could not start Google sign-in.' });
    }
  });
}

// Events are cached for the day so opening the app repeatedly is not repeatedly
// hitting Google, and so a lost connection still shows this morning's schedule.
function readCache(dateKey) {
  try {
    const cache = JSON.parse(local('gcalCache') || 'null');
    if (cache && cache.date === dateKey) return cache.events;
  } catch {
    // fall through
  }
  return null;
}

function writeCache(dateKey, events) {
  local('gcalCache', JSON.stringify({ date: dateKey, events }));
}

// London day boundaries. Day keys are London dates, so asking Google for a UTC
// day would be an hour out for half the year and quietly drop a late event.
function londonOffset(dateKey) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', timeZoneName: 'longOffset',
    }).formatToParts(new Date(dateKey + 'T12:00:00Z'));
    const name = (parts.find((p) => p.type === 'timeZoneName') || {}).value || '';
    const match = /GMT([+-]\d{2}:\d{2})/.exec(name);
    return match ? match[1] : '+00:00';
  } catch {
    return '+00:00';
  }
}

function tidy(items) {
  return (items || []).map((item) => {
    const start = item.start || {};
    const end = item.end || {};
    const allDay = Boolean(start.date && !start.dateTime);
    return {
      id: item.id,
      summary: item.summary || '(no title)',
      allDay,
      start: allDay ? null : start.dateTime,
      end: allDay ? null : end.dateTime,
      location: item.location || '',
    };
  });
}

export async function todayEvents(dateKey, { force = false } = {}) {
  if (!isConfigured()) return { state: 'unconfigured', events: [] };

  const cached = readCache(dateKey);
  if (cached && !force) return { state: 'ok', events: cached, cached: true };

  const token = storedToken();
  if (!token) {
    return { state: cached ? 'ok' : 'disconnected', events: cached || [] };
  }

  const offset = londonOffset(dateKey);
  const params = new URLSearchParams({
    timeMin: `${dateKey}T00:00:00${offset}`,
    timeMax: `${dateKey}T23:59:59${offset}`,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '20',
    timeZone: 'Europe/London',
  });

  try {
    const response = await fetch(`${API}?${params}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (response.status === 401 || response.status === 403) {
      local('gcalToken', null);
      return { state: cached ? 'ok' : 'disconnected', events: cached || [] };
    }
    if (!response.ok) {
      return { state: cached ? 'ok' : 'error', events: cached || [], message: `Google returned ${response.status}.` };
    }
    const json = await response.json();
    const events = tidy(json.items);
    writeCache(dateKey, events);
    return { state: 'ok', events };
  } catch {
    // Offline is not an error worth shouting about; the cache covers the day.
    return { state: cached ? 'ok' : 'offline', events: cached || [] };
  }
}

export function formatTime(iso) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}
