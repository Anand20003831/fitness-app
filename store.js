// Local state. This layer never touches the network.
// sync.js sits on top of it and pushes the same shape to the private repo.

const LS_KEY = 'fitness.data.v1';
const LS_DIRTY = 'fitness.dirty.v1';

const EMPTY = () => ({ version: 1, days: {}, workouts: {}, measures: {}, settings: {} });

// ---------------------------------------------------------------- dates
// Day keys are local Europe/London calendar dates, never UTC. He logs at 11pm
// and it has to land on that day, not the next one.

const LONDON_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function todayKey(d = new Date()) {
  return LONDON_YMD.format(d);
}

// A key parsed at noon UTC can't drift into the neighbouring day under any
// offset, so weekday and date arithmetic off a key are always safe.
function keyDate(key) {
  return new Date(key + 'T12:00:00Z');
}

export function dayOfWeek(key) {
  return keyDate(key).getUTCDay(); // 0 = Sunday
}

export function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(toKey + 'T00:00:00Z') - Date.parse(fromKey + 'T00:00:00Z')) / 86400000);
}

export function addDays(key, n) {
  const d = keyDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function formatLong(key) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(keyDate(key));
}

export function formatShort(key) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  }).format(keyDate(key));
}

// Weeks run Monday to Sunday, to match "week ending Sunday" in the check-in.
export function mondayOf(key) {
  const dow = dayOfWeek(key);
  return addDays(key, dow === 0 ? -6 : 1 - dow);
}

export function sundayOf(key) {
  return addDays(mondayOf(key), 6);
}

// ---------------------------------------------------------------- change events
//
// Declared before the state below, because seeding the settings on a first run
// writes, and writing notifies these. A const declared further down the file is
// in the temporal dead zone at that point and the whole module throws, which
// breaks the app on exactly one device: a brand new one.

const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

// ---------------------------------------------------------------- state

// Settings are not seeded with defaults here. Anything that is a fact about him
// arrives from data.json in the private repo, or he is asked for it.
export const state = load();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return EMPTY();
    return normalise(JSON.parse(raw));
  } catch (err) {
    console.warn('Local data was unreadable, starting empty.', err);
    return EMPTY();
  }
}

function normalise(obj) {
  const base = EMPTY();
  if (!obj || typeof obj !== 'object') return base;
  base.version = obj.version || 1;
  for (const k of ['days', 'workouts', 'measures', 'settings']) {
    if (obj[k] && typeof obj[k] === 'object') base[k] = obj[k];
  }
  return base;
}

// ---------------------------------------------------------------- sync flags

export function isDirty() {
  return localStorage.getItem(LS_DIRTY) === '1';
}

export function markClean() {
  localStorage.removeItem(LS_DIRTY);
  emit();
}

function persist({ dirty = true } = {}) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    if (dirty) localStorage.setItem(LS_DIRTY, '1');
  } catch (err) {
    console.error('Could not write to localStorage.', err);
  }
  emit();
}

export function saveNow() {
  persist();
}

// ---------------------------------------------------------------- writes
//
// Every write stamps the record with updatedAt and, inside `days`, also stamps
// the individual field in fieldsUpdatedAt. Day records hold several things that
// get edited independently on two devices (weight in the morning on the PC,
// meal ticks on the phone in the evening), so a whole-record last-write-wins
// would throw away the other device's edit. Workouts and measures are written
// as a unit in one sitting on one device, so they stay whole-record.

export function getDay(key) {
  return state.days[key] || null;
}

export function patchDay(key, patch) {
  const now = Date.now();
  const day = state.days[key] || (state.days[key] = {});
  const stamps = day.fieldsUpdatedAt || (day.fieldsUpdatedAt = {});
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'meals') {
      const meals = day.meals || (day.meals = {});
      for (const [mealId, on] of Object.entries(value)) {
        meals[mealId] = on;
        stamps['meals.' + mealId] = now;
      }
    } else {
      // Cleared fields are stored as null rather than removed. A removed field
      // has no value for the merge to compare, so an older copy on the other
      // device would win and resurrect what he just deleted.
      day[field] = (value === '' ? null : value);
      stamps[field] = now;
    }
  }
  day.updatedAt = now;
  persist();
}

export function getWorkout(key) {
  return state.workouts[key] || null;
}

export function setWorkout(key, workout) {
  state.workouts[key] = { ...workout, updatedAt: Date.now() };
  persist();
}

// The most recent completed sets for an exercise, ignoring today. Exercise ids
// repeat across sessions on purpose, so lateral raises on leg day still show
// what he did on chest day. This is the number he is trying to beat.
export function lastTimeFor(exerciseId, excludeKey) {
  const keys = Object.keys(state.workouts).filter((k) => k !== excludeKey).sort().reverse();
  for (const key of keys) {
    const sets = state.workouts[key] && state.workouts[key].sets && state.workouts[key].sets[exerciseId];
    if (!Array.isArray(sets)) continue;
    const done = sets.filter((s) => s && s.done && Number(s.reps) > 0);
    if (done.length) return { date: key, sets: done };
  }
  return null;
}

export function patchMeasure(key, patch) {
  const rec = state.measures[key] || (state.measures[key] = {});
  Object.assign(rec, patch);
  rec.updatedAt = Date.now();
  persist();
}

export function getSetting(key, fallback = null) {
  const v = state.settings[key];
  return v === undefined ? fallback : v;
}

export function setSetting(key, value) {
  const now = Date.now();
  const stamps = state.settings.fieldsUpdatedAt || (state.settings.fieldsUpdatedAt = {});
  state.settings[key] = value;
  stamps[key] = now;
  state.settings.updatedAt = now;
  persist();
}

// Device-local, never synced and never in either repo.
export function local(key, value) {
  const k = 'fitness.local.' + key;
  if (value === undefined) return localStorage.getItem(k);
  if (value === null) { localStorage.removeItem(k); return null; }
  localStorage.setItem(k, value);
  return value;
}

// ---------------------------------------------------------------- merge
//
// Used by sync.js. Pure, so it is testable and safe to reason about.

function stampFor(record, path) {
  const stamps = record && record.fieldsUpdatedAt;
  if (stamps && stamps[path] != null) return stamps[path];
  return (record && record.updatedAt) || 0;
}

function fieldPaths(record) {
  const out = [];
  if (!record) return out;
  for (const k of Object.keys(record)) {
    if (k === 'updatedAt' || k === 'fieldsUpdatedAt') continue;
    if (k === 'meals' && record.meals && typeof record.meals === 'object') {
      for (const m of Object.keys(record.meals)) out.push('meals.' + m);
    } else {
      out.push(k);
    }
  }
  return out;
}

function readPath(record, path) {
  if (!record) return undefined;
  if (path.startsWith('meals.')) return record.meals ? record.meals[path.slice(6)] : undefined;
  return record[path];
}

function writePath(record, path, value) {
  if (path.startsWith('meals.')) {
    (record.meals || (record.meals = {}))[path.slice(6)] = value;
  } else {
    record[path] = value;
  }
}

// Field-level merge for records whose fields are edited independently.
function mergeByField(mine, theirs) {
  if (!theirs) return { record: mine, changed: false };
  if (!mine) return { record: theirs, changed: true };
  const out = { updatedAt: Math.max(mine.updatedAt || 0, theirs.updatedAt || 0), fieldsUpdatedAt: {} };
  const paths = new Set([...fieldPaths(mine), ...fieldPaths(theirs)]);
  let changed = false;
  for (const path of paths) {
    const tMine = readPath(mine, path) === undefined ? -1 : stampFor(mine, path);
    const tTheirs = readPath(theirs, path) === undefined ? -1 : stampFor(theirs, path);
    const winner = tTheirs > tMine ? theirs : mine;
    const value = readPath(winner, path);
    if (value === undefined) continue;
    writePath(out, path, value);
    out.fieldsUpdatedAt[path] = Math.max(tMine, tTheirs, 0);
    if (winner === theirs && readPath(mine, path) !== value) changed = true;
  }
  return { record: out, changed };
}

// Whole-record last-write-wins.
function mergeByRecord(mine, theirs) {
  if (!theirs) return { record: mine, changed: false };
  if (!mine) return { record: theirs, changed: true };
  if ((theirs.updatedAt || 0) > (mine.updatedAt || 0)) return { record: theirs, changed: true };
  return { record: mine, changed: false };
}

const MERGERS = {
  days: mergeByField,
  settings: mergeByField,
  workouts: mergeByRecord,
  measures: mergeByRecord,
};

// Merges a remote snapshot into local state in place.
// Returns true if anything local actually changed, so sync can tell the UI.
export function mergeRemote(remote) {
  const incoming = normalise(remote);
  let changed = false;

  for (const section of ['days', 'workouts', 'measures']) {
    const merger = MERGERS[section];
    const keys = new Set([...Object.keys(state[section]), ...Object.keys(incoming[section])]);
    for (const key of keys) {
      const result = merger(state[section][key], incoming[section][key]);
      if (result.changed) changed = true;
      if (result.record) state[section][key] = result.record;
    }
  }

  const settings = mergeByField(state.settings, incoming.settings);
  if (settings.changed) changed = true;
  if (settings.record) state.settings = settings.record;

  if (changed) persist({ dirty: false });
  return changed;
}

export function snapshot() {
  return JSON.parse(JSON.stringify(state));
}
