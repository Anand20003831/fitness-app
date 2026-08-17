// Entry point: routing and rendering.

import { SESSIONS, WEEK, REST, GOAL_DATE, mealsForDay, targetsForDay } from './plan.js';
import {
  state, onChange, getDay, patchDay, getSetting, setSetting,
  getWorkout, setWorkout, lastTimeFor,
  todayKey, dayOfWeek, daysBetween, formatLong, formatShort,
} from './store.js';
import * as sync from './sync.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

const TABS = ['today', 'meals', 'train', 'log', 'settings'];

// Transient screen state. Never persisted.
const ui = { editWeight: false, sessionOverride: null };

// ---------------------------------------------------------------- helpers

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function num(n) {
  return Number(n).toLocaleString('en-GB');
}

function dayMonth(key) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(key + 'T12:00:00Z'));
}

function tick(on, action, extra = '') {
  return `<button class="tick" type="button" aria-pressed="${on ? 'true' : 'false'}"
    data-action="${action}" ${extra}><i></i></button>`;
}

function setSyncPill(stateName, text, title) {
  const pill = document.getElementById('syncpill');
  pill.dataset.state = stateName;
  pill.title = title || '';
  document.getElementById('synctext').textContent = text;
}

// ---------------------------------------------------------------- today

function renderToday() {
  const key = todayKey();
  const day = getDay(key) || {};
  const dow = dayOfWeek(key);
  const sessionId = WEEK[dow];
  const session = sessionId ? SESSIONS[sessionId] : null;
  const isSaturday = dow === 6;
  const todaysMeals = mealsForDay(dow);
  const targets = targetsForDay(dow);

  const goalDate = getSetting('goalDate', GOAL_DATE);
  const left = daysBetween(key, goalDate);
  const countdown = left > 0
    ? `<span class="countdown">${left} day${left === 1 ? '' : 's'}</span> to ${dayMonth(goalDate)}`
    : left === 0
      ? `<span class="countdown">last day</span> of the block`
      : `<span class="countdown">${-left} day${left === -1 ? '' : 's'}</span> past ${dayMonth(goalDate)}, still going`;

  const meals = day.meals || {};
  let kcal = 0, protein = 0;
  for (const meal of todaysMeals) {
    if (meals[meal.id]) { kcal += meal.kcal; protein += meal.protein; }
  }

  return `
    <div class="hero">
      <h1>${esc(formatLong(key))}</h1>
      <p class="sub">${countdown}</p>
    </div>

    ${renderStartWeight()}
    ${renderWeigh(day)}

    <div class="card">
      <div class="card-head"><p class="card-title">Today's calendar</p></div>
      <p class="small" style="margin:0">Calendar not connected. Add a Google client ID in Settings if you want your lectures and shifts here.</p>
    </div>

    <div class="card">
      ${session ? `
        <div class="session">
          <div class="grow">
            <p class="card-title" style="margin:0 0 4px">Today's session</p>
            <div class="name">${esc(session.name)}</div>
            <div class="small">${session.exercises.length} exercises</div>
          </div>
          <button class="btn" type="button" data-action="goto" data-href="#train">Start</button>
        </div>
      ` : `
        <div class="session">
          <div class="grow">
            <p class="card-title" style="margin:0 0 4px">Today's session</p>
            <div class="name">Rest day</div>
            <div class="small">Walk-jog only, 35 minutes.</div>
          </div>
        </div>
      `}
    </div>

    <div class="card">
      <div class="totals">
        <div class="total">
          <div class="n">${num(kcal)} <span>/ ${num(targets.kcal)}</span></div>
          <div class="k">kcal</div>
          <div class="bar"><i style="width:${Math.min(100, kcal / targets.kcal * 100)}%"></i></div>
        </div>
        <div class="total">
          <div class="n">${protein} <span>/ ${targets.protein}</span></div>
          <div class="k">g protein</div>
          <div class="bar${protein >= targets.protein ? ' good' : ''}"><i style="width:${Math.min(100, protein / targets.protein * 100)}%"></i></div>
        </div>
      </div>

      ${todaysMeals.map((meal) => {
        const on = !!meals[meal.id];
        return `
          <div class="row${on ? ' done' : ''}">
            ${tick(on, 'toggle-meal', `data-meal="${meal.id}"`)}
            <div class="grow">
              <div class="name">${esc(meal.name)}</div>
              <div class="meta">${meal.kcal} kcal · ${meal.protein} g protein</div>
            </div>
            <button class="chev" type="button" data-action="goto" data-href="#meals/${meal.id}"
              aria-label="Recipe for ${esc(meal.name)}"></button>
          </div>`;
      }).join('')}

      ${isSaturday ? `
        <p class="small" style="margin:12px 0 0">Saturday is the higher day.
        Not a cheat day, just ${num(targets.kcal)} instead of ${num(targetsForDay(1).kcal)}.</p>
      ` : ''}
    </div>

    <div class="card">
      <div class="row">
        ${tick(!!day.walkjog, 'toggle-walkjog')}
        <div class="grow">
          <div class="name">Walk-jog</div>
          <div class="meta">4 minutes walk, 1 minute jog, six or seven times</div>
        </div>
      </div>

      <div class="row" style="gap:10px">
        <div class="grow">
          <label class="lbl" for="bedTime">In bed</label>
          <input type="time" id="bedTime" data-field="bedTime" value="${esc(day.bedTime || '')}">
        </div>
        <div class="grow">
          <label class="lbl" for="wakeTime">Woke</label>
          <input type="time" id="wakeTime" data-field="wakeTime" value="${esc(day.wakeTime || '')}">
        </div>
      </div>

      <div class="row">
        <div class="grow">
          <label class="lbl" for="notes">Note</label>
          <input type="text" id="notes" data-field="notes" value="${esc(day.notes || '')}"
            placeholder="Anything worth telling Claude on Sunday">
        </div>
      </div>
    </div>
  `;
}

// Asked for once, on a device that has never seen the private data. It is not
// defaulted anywhere in this repo, because this repo is public and his starting
// weight is his.
function renderStartWeight() {
  if (getSetting('startWeight', null) != null) return '';
  return `
    <div class="card">
      <label class="lbl" for="startWeight">Starting weight</label>
      <div class="field-row">
        <div class="grow">
          <input type="number" id="startWeight" inputmode="decimal" step="0.1" min="30" max="300"
            placeholder="kg, where you began">
        </div>
        <button class="btn" type="button" data-action="save-start-weight">Save</button>
      </div>
      <p class="small" style="margin:10px 0 0">Asked once. It is stored in your private data repo,
      never in the app's code. If you have already set it on another device it will arrive on the next sync.</p>
    </div>`;
}

function renderWeigh(day) {
  const has = day.weight != null && day.weight !== '';
  if (has && !ui.editWeight) {
    return `
      <div class="card tight">
        <div class="row">
          <div class="grow">
            <div class="name">${day.weight} kg</div>
            <div class="meta">This morning's weight</div>
          </div>
          <button class="btn quiet" type="button" data-action="edit-weight">Edit</button>
        </div>
      </div>`;
  }
  return `
    <div class="card">
      <label class="lbl" for="weight">Morning weight</label>
      <div class="field-row">
        <div class="grow">
          <input type="number" id="weight" inputmode="decimal" step="0.1" min="30" max="200"
            value="${esc(day.weight ?? '')}" placeholder="kg, after the toilet, before food">
        </div>
        <button class="btn" type="button" data-action="save-weight">Save</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------- train

// Which session is on screen. Defaults to today's, and he can override it.
function activeSessionId() {
  if (ui.sessionOverride && SESSIONS[ui.sessionOverride]) return ui.sessionOverride;
  const key = todayKey();
  const stored = getWorkout(key);
  if (stored && SESSIONS[stored.sessionId]) return stored.sessionId;
  return WEEK[dayOfWeek(key)];
}

// The plan rests two to three minutes on the first two exercises and sixty to
// ninety on the rest. The shirt session says sixty throughout, so it overrides.
function restSeconds(sessionId, exerciseIndex) {
  if (REST.bySession[sessionId] != null) return REST.bySession[sessionId];
  return exerciseIndex < 2 ? REST.firstTwo : REST.rest;
}

function formatLastTime(entry) {
  const weights = entry.sets.map((s) => (s.kg == null || s.kg === '' ? null : Number(s.kg)));
  const uniform = weights.every((w) => w === weights[0]);
  if (uniform) {
    const label = weights[0] ? `${weights[0]}kg` : 'bodyweight';
    return `${label} × ${entry.sets.map((s) => s.reps).join(', ')}`;
  }
  return entry.sets.map((s, i) => `${weights[i] ? weights[i] + 'kg' : 'BW'}×${s.reps}`).join(', ');
}

function setsFor(workout, exerciseId, prescribed) {
  const stored = (workout && workout.sets && workout.sets[exerciseId]) || [];
  const rows = stored.slice();
  while (rows.length < prescribed) rows.push({ kg: '', reps: '', done: false });
  return rows;
}

function renderTrain() {
  const key = todayKey();
  const sessionId = activeSessionId();
  const session = sessionId ? SESSIONS[sessionId] : null;
  const workout = getWorkout(key);

  const picker = `
    <div class="card">
      <label class="lbl" for="sessionPick">Session</label>
      <select id="sessionPick" data-action="pick-session">
        ${Object.entries(SESSIONS).map(([id, s]) =>
          `<option value="${id}"${id === sessionId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>`;

  if (!session) {
    return `
      <div class="hero">
        <h1>Train</h1>
        <p class="sub">No session scheduled today. Walk-jog day.</p>
      </div>
      <div class="card"><p class="small" style="margin:0">Pick one below if you are training anyway.</p></div>
      ${picker}`;
  }

  return `
    <div class="hero">
      <h1>${esc(session.name)}</h1>
      <p class="sub">${esc(formatLong(key))}</p>
    </div>
    ${picker}
    ${session.exercises.map((ex, index) => {
      const last = lastTimeFor(ex.id, key);
      const rows = setsFor(workout, ex.id, ex.sets);
      return `
        <div class="card ex">
          <h3 class="ex-name">${esc(ex.name)}</h3>

          <div class="lasttime${last ? '' : ' none'}">
            ${last
              ? `<span class="lasttime-label">Last time</span>
                 <span class="lasttime-value">${esc(formatLastTime(last))}</span>
                 <span class="lasttime-date">${esc(formatShort(last.date))}</span>`
              : `<span class="lasttime-label">First time on this one</span>
                 <span class="lasttime-value">no numbers yet</span>`}
          </div>

          <p class="prescribed">${ex.sets} × ${esc(ex.reps)}<span class="dot-sep">·</span>rest ${restSeconds(sessionId, index)}s</p>
          <p class="exnote">${esc(ex.note)}</p>

          <div class="sets">
            ${rows.map((set, i) => `
              <div class="setrow${set.done ? ' done' : ''}">
                <span class="setnum">${i + 1}</span>
                <input class="setinput" type="number" inputmode="decimal" step="0.5" min="0"
                  data-set-field="kg" data-ex="${ex.id}" data-i="${i}"
                  value="${esc(set.kg ?? '')}" placeholder="kg" aria-label="Set ${i + 1} weight in kg">
                <span class="times">×</span>
                <input class="setinput" type="number" inputmode="numeric" pattern="[0-9]*" min="0"
                  data-set-field="reps" data-ex="${ex.id}" data-i="${i}"
                  value="${esc(set.reps ?? '')}" placeholder="reps" aria-label="Set ${i + 1} reps">
                <button class="setdone" type="button" aria-pressed="${set.done ? 'true' : 'false'}"
                  aria-label="Set ${i + 1} done"
                  data-action="set-done" data-ex="${ex.id}" data-i="${i}" data-index="${index}"><i></i></button>
              </div>`).join('')}
          </div>

          <button class="btn quiet wide addset" type="button" data-action="add-set" data-ex="${ex.id}">Add a set</button>
        </div>`;
    }).join('')}`;
}

// ---------------------------------------------------------------- settings

const SYNC_LABELS = {
  off: 'Local', pending: 'Syncing', synced: 'Synced', offline: 'Offline', error: 'Sync error',
};

function renderSettings() {
  const config = sync.getConfig();
  const print = sync.tokenFingerprint();
  const { status, error } = sync.getStatus();

  return `
    <div class="hero"><h1>Settings</h1></div>

    <div class="card">
      <div class="card-head"><p class="card-title">Sync</p>
        <span class="right">${esc(SYNC_LABELS[status] || status)}</span></div>

      <label class="lbl" for="cfgOwner">GitHub username</label>
      <input type="text" id="cfgOwner" data-cfg="owner" value="${esc(config.owner)}"
        autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Anand20003831">

      <label class="lbl" for="cfgRepo" style="margin-top:14px">Private data repo</label>
      <input type="text" id="cfgRepo" data-cfg="repo" value="${esc(config.repo)}"
        autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="fitness-data">

      <label class="lbl" for="cfgToken" style="margin-top:14px">Fine-grained token</label>
      ${print ? `
        <div class="row" style="min-height:52px">
          <div class="grow">
            <div class="name mono">${esc(print.prefix)}…${esc(print.last4)}</div>
            <div class="meta">${print.length} characters, stored on this device only</div>
          </div>
          <button class="btn quiet" type="button" data-action="replace-token">Replace</button>
        </div>
      ` : `
        <input type="password" id="cfgToken" data-cfg="token" value=""
          autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="github_pat_…">
        <p class="small" style="margin:8px 0 0">Contents: Read and write, on ${esc(config.repo)} only.
        Metadata: Read-only is added by GitHub automatically and is meant to be there.</p>
      `}

      <div class="btn-row" style="margin-top:16px">
        <button class="btn" type="button" data-action="test-connection">Test connection</button>
        <button class="btn quiet" type="button" data-action="force-sync">Sync now</button>
      </div>
      <div id="testResult" class="testresult"></div>
      ${error ? `<div class="note" style="margin-top:14px">${esc(error)}</div>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><p class="card-title">Calendar</p></div>
      <label class="lbl" for="cfgGoogle">Google OAuth client ID</label>
      <input type="text" id="cfgGoogle" data-cfg="googleClientId" value="${esc(config.googleClientId)}"
        autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="…apps.googleusercontent.com">
      <p class="small" style="margin:8px 0 0">Optional. The app works fully without it.</p>
    </div>

    <div class="card">
      <div class="card-head"><p class="card-title">Your data</p></div>
      <button class="btn quiet wide" type="button" data-action="export-data">Export data.json</button>
      <p class="small" style="margin:10px 0 0">A copy of everything the app holds, straight from this device.</p>
    </div>`;
}

// ---------------------------------------------------------------- stubs
// Built in the later steps of the build order.

function stub(title, whatItWillDo) {
  return `
    <div class="hero"><h1>${esc(title)}</h1></div>
    <div class="card"><p class="small" style="margin:0">${esc(whatItWillDo)}</p></div>`;
}

const SCREENS = {
  today: renderToday,
  meals: () => stub('Meals', 'Recipes, grams and the shopping list land here in step 6.'),
  train: renderTrain,
  log: () => stub('Log', 'Weight chart, measurements and the Sunday report land here in step 6.'),
  settings: renderSettings,
};

// ---------------------------------------------------------------- routing

function currentTab() {
  const tab = (location.hash || '#today').slice(1).split('/')[0];
  return TABS.includes(tab) ? tab : 'today';
}

function render() {
  const tab = currentTab();
  view.innerHTML = SCREENS[tab]();
  for (const a of tabbar.querySelectorAll('a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = tab === 'today' ? 'Fitness' : 'Fitness · ' + tab[0].toUpperCase() + tab.slice(1);
}

// ---------------------------------------------------------------- set logging

// Reads the two inputs for one set straight off the DOM, so whatever is on
// screen when he taps the tick is what gets stored. No hidden state.
function writeSet(exerciseId, index, patch) {
  const key = todayKey();
  const sessionId = activeSessionId();
  const existing = getWorkout(key);
  const sets = JSON.parse(JSON.stringify((existing && existing.sets) || {}));
  const rows = sets[exerciseId] || (sets[exerciseId] = []);
  while (rows.length <= index) rows.push({ kg: '', reps: '', done: false });
  rows[index] = { ...rows[index], ...patch };
  setWorkout(key, { sessionId, sets });
}

function readSetInputs(exerciseId, index) {
  const scope = `[data-ex="${exerciseId}"][data-i="${index}"]`;
  const kg = document.querySelector(`input${scope}[data-set-field="kg"]`);
  const reps = document.querySelector(`input${scope}[data-set-field="reps"]`);
  return {
    kg: kg && kg.value.trim() === '' ? '' : Number(kg.value),
    reps: reps && reps.value.trim() === '' ? '' : Number(reps.value),
  };
}

// ---------------------------------------------------------------- rest timer
//
// Driven off a wall-clock end time, not a decrementing counter, because Android
// throttles timers in a backgrounded tab. Coming back to the app after locking
// the phone shows the truth rather than a clock that stopped.

const timer = { endsAt: 0, total: 0, tick: null, wakeLock: null, fired: false };
const timerslot = document.getElementById('timerslot');

async function acquireWakeLock() {
  if (!('wakeLock' in navigator) || timer.wakeLock) return;
  try {
    timer.wakeLock = await navigator.wakeLock.request('screen');
    timer.wakeLock.addEventListener('release', () => { timer.wakeLock = null; });
  } catch {
    // Denied or unsupported. The timer still works, the screen just sleeps.
  }
}

function releaseWakeLock() {
  if (timer.wakeLock) { timer.wakeLock.release().catch(() => {}); timer.wakeLock = null; }
}

function startRest(seconds) {
  timer.total = seconds;
  timer.endsAt = Date.now() + seconds * 1000;
  timer.fired = false;
  acquireWakeLock();
  if (!timer.tick) timer.tick = setInterval(paintTimer, 250);
  paintTimer();
}

function stopRest() {
  timer.endsAt = 0;
  if (timer.tick) { clearInterval(timer.tick); timer.tick = null; }
  releaseWakeLock();
  timerslot.innerHTML = '';
}

function paintTimer() {
  if (!timer.endsAt) return;
  const left = Math.max(0, timer.endsAt - Date.now());
  const secs = Math.ceil(left / 1000);

  if (left <= 0) {
    if (!timer.fired) {
      timer.fired = true;
      // Android will not vibrate for a backgrounded page. If the screen is off
      // this is silent, which is why the wake lock above exists.
      if (navigator.vibrate) navigator.vibrate([220, 120, 220]);
    }
    timerslot.innerHTML = `<button class="pill timerpill go" type="button" data-action="stop-rest">Go</button>`;
    releaseWakeLock();
    return;
  }

  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, '0');
  timerslot.innerHTML =
    `<button class="pill timerpill" type="button" data-action="stop-rest">${mm}:${ss}</button>`;
}

// The timer element lives in the header, outside #view, so it needs its own
// listener rather than the delegated one below.
timerslot.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="stop-rest"]')) stopRest();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (timer.endsAt) { acquireWakeLock(); paintTimer(); }
  } else {
    releaseWakeLock();
  }
});

// ---------------------------------------------------------------- events

view.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const key = todayKey();

  switch (el.dataset.action) {
    case 'goto':
      location.hash = el.dataset.href;
      break;

    case 'toggle-meal': {
      const day = getDay(key) || {};
      const on = !(day.meals && day.meals[el.dataset.meal]);
      patchDay(key, { meals: { [el.dataset.meal]: on } });
      render();
      break;
    }

    case 'toggle-walkjog': {
      const day = getDay(key) || {};
      patchDay(key, { walkjog: !day.walkjog });
      render();
      break;
    }

    case 'edit-weight':
      ui.editWeight = true;
      render();
      document.getElementById('weight')?.focus();
      break;

    case 'save-weight':
      saveWeight();
      break;

    case 'set-done': {
      const { ex, i, index } = el.dataset;
      const wasDone = el.getAttribute('aria-pressed') === 'true';
      const values = readSetInputs(ex, Number(i));
      writeSet(ex, Number(i), { ...values, done: !wasDone });
      if (!wasDone) startRest(restSeconds(activeSessionId(), Number(index)));
      render();
      break;
    }

    case 'add-set': {
      const exerciseId = el.dataset.ex;
      const workout = getWorkout(todayKey());
      const rows = (workout && workout.sets && workout.sets[exerciseId]) || [];
      const session = SESSIONS[activeSessionId()];
      const prescribed = session.exercises.find((e) => e.id === exerciseId).sets;
      writeSet(exerciseId, Math.max(rows.length, prescribed), { kg: '', reps: '', done: false });
      render();
      break;
    }

    case 'replace-token':
      sync.setConfig({ token: '' });
      render();
      document.getElementById('cfgToken')?.focus();
      break;

    case 'test-connection': {
      const out = document.getElementById('testResult');
      out.className = 'testresult working';
      out.textContent = 'Checking…';
      el.disabled = true;
      sync.testConnection().then((result) => {
        el.disabled = false;
        out.className = 'testresult ' + (result.ok ? 'ok' : 'bad');
        out.textContent = result.message;
      });
      break;
    }

    case 'force-sync': {
      const out = document.getElementById('testResult');
      out.className = 'testresult working';
      out.textContent = 'Syncing…';
      sync.flushNow().then((result) => {
        out.className = 'testresult ' + (result.ok ? 'ok' : 'bad');
        out.textContent = result.ok
          ? 'Synced.'
          : (result.message || 'Could not sync.');
        if (result.ok) render();
      });
      break;
    }

    case 'export-data': {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data-${todayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }

    case 'save-start-weight': {
      const input = document.getElementById('startWeight');
      const value = Number(input.value.trim());
      if (!Number.isFinite(value) || value <= 0) { input.focus(); return; }
      setSetting('startWeight', value);
      render();
      break;
    }
  }
});

function saveWeight() {
  const input = document.getElementById('weight');
  if (!input) return;
  const raw = input.value.trim();
  const value = raw === '' ? null : Number(raw);
  if (raw !== '' && (!Number.isFinite(value) || value <= 0)) {
    input.focus();
    return;
  }
  patchDay(todayKey(), { weight: value });
  ui.editWeight = false;
  render();
}

// Free-text and time fields commit on change and deliberately do not re-render,
// so the keyboard does not close under him mid-edit.
view.addEventListener('change', (event) => {
  const el = event.target;
  if (el.id === 'weight') { saveWeight(); return; }

  if (el.dataset.action === 'pick-session') {
    ui.sessionOverride = el.value;
    render();
    return;
  }

  if (el.dataset.cfg) {
    const value = el.value.trim();
    sync.setConfig({ [el.dataset.cfg]: value });
    // Re-render only once a token has just been entered, so it collapses to its
    // fingerprint. Re-rendering on every keystroke would fight the keyboard.
    if (el.dataset.cfg === 'token' && value) render();
    return;
  }

  // A set input commits where it stands without re-rendering, so the keyboard
  // stays up while he moves from kg to reps.
  if (el.dataset.setField) {
    const value = el.value.trim() === '' ? '' : Number(el.value);
    writeSet(el.dataset.ex, Number(el.dataset.i), { [el.dataset.setField]: value });
    return;
  }

  const field = el.dataset && el.dataset.field;
  if (!field) return;
  patchDay(todayKey(), { [field]: el.value.trim() });
});

view.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'weight') {
    event.preventDefault();
    saveWeight();
  }
});

window.addEventListener('hashchange', () => {
  ui.editWeight = false;
  render();
});

// The day rolls over while the app sits open overnight.
let openedOn = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== openedOn) {
    openedOn = todayKey();
    render();
  }
});

// The header pill follows sync, and a pull that actually changed something
// repaints the screen underneath him.
sync.onStatus((status, error) => {
  setSyncPill(
    status === 'off' ? 'offline' : status,
    SYNC_LABELS[status] || status,
    error || '',
  );
  if (currentTab() === 'settings') render();
});

let lastPaintedData = null;
onChange(() => {
  const serialised = JSON.stringify(state);
  if (serialised === lastPaintedData) return;
  lastPaintedData = serialised;
  // Never yank the screen out from under a field he is typing in.
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  render();
});

render();
sync.start();

// Kept for the console: `window.fitness.state`.
window.fitness = { state, render, sync };
