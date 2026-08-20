// Entry point: routing and rendering.

import { REST } from './plan.js';
// Everything about the plan comes through the overlay, never straight from
// plan.js, so his edits are visible on every screen that reads it.
import {
  WEEK, SHOPPING, GOAL_DATE, mealsForDay, targetsForDay,
  effectiveSessions, effectiveSession, effectiveMeals, effectiveTargets,
  mealOverrides, exerciseOverrides, targetOverridden, sessionStructureChanged, anyOverrides,
  setTarget, setMealField, resetMeal, setExerciseField, resetExercise,
  removeExercise, addExercise, moveExercise, resetSession, resetEverything,
} from './overlay.js';
import {
  state, onChange, getDay, patchDay, getSetting, setSetting, patchMeasure,
  getWorkout, setWorkout, lastTimeFor,
  todayKey, dayOfWeek, daysBetween, addDays, formatLong, formatShort,
} from './store.js';
import * as sync from './sync.js';
import * as report from './report.js';
import * as coach from './coach.js';
import * as calendar from './calendar.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

const TABS = ['today', 'calendar', 'meals', 'train', 'log', 'coach', 'settings'];

// Transient screen state. Never persisted.
const ui = { editWeight: false, sessionOverride: null, pendingPatch: null, sessionEditor: null };

// Small stable hash, only used to keep generated exercise ids from colliding.
function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return hash;
}

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

// The async clipboard needs a secure context and a user gesture. Pages is https
// so it normally works, but the old execCommand path stays as a fallback rather
// than leaving him staring at a report he cannot copy.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const box = document.getElementById('reportText');
    if (!box) return false;
    box.focus();
    box.select();
    return document.execCommand('copy');
  } catch {
    return false;
  }
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

// The session's time on the Today card, so he does not have to open the day
// view to know when it is meant to happen.
function todaySessionTime(key, session) {
  const day = getDay(key) || {};
  const minutes = day.sessionMinutes || session.minutes || 50;
  const pinned = fromHHMM(day.sessionStart);
  if (pinned != null) return `${hhmm(pinned)}–${hhmm(pinned + minutes)} · `;
  if (!calendar.isConfigured()) return '';
  const auto = autoSlot(calState.events || [], key, minutes);
  return `${hhmm(auto.start)}–${hhmm(auto.start + minutes)} · `;
}

function renderToday() {
  const key = todayKey();
  const day = getDay(key) || {};
  const dow = dayOfWeek(key);
  const sessionId = WEEK[dow];
  const session = sessionId ? effectiveSession(sessionId) : null;
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

    <div class="card" id="calcard">
      <div class="card-head"><p class="card-title">Today's calendar</p>
        ${calendar.isConnected() ? '<span class="right"><button class="btn quiet small" type="button" data-action="cal-refresh">Refresh</button></span>' : ''}</div>
      <div id="calbody">${renderCalendarBody()}</div>
    </div>

    <div class="card">
      ${session ? `
        <div class="session">
          <div class="grow">
            <p class="card-title" style="margin:0 0 4px">Today's session</p>
            <div class="name">${esc(session.name)}</div>
            <div class="small">${todaySessionTime(key, session)}${session.exercises.length} exercises</div>
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
  if (ui.sessionOverride && effectiveSession(ui.sessionOverride)) return ui.sessionOverride;
  const key = todayKey();
  const stored = getWorkout(key);
  if (stored && effectiveSession(stored.sessionId)) return stored.sessionId;
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
  const session = sessionId ? effectiveSession(sessionId) : null;
  const workout = getWorkout(key);

  const picker = `
    <div class="card">
      <label class="lbl" for="sessionPick">Session</label>
      <select id="sessionPick" data-action="pick-session">
        ${Object.entries(effectiveSessions()).map(([id, s]) =>
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

// ---------------------------------------------------------------- calendar
//
// Rendered synchronously from whatever is already known, then refreshed in the
// background. The Today tab never waits on Google.

let calState = { state: 'idle', events: [], message: '' };

function renderCalendarBody() {
  if (!calendar.isConfigured()) {
    return `<p class="small" style="margin:0">Calendar not connected. Add a Google client ID in
      Settings if you want your lectures and shifts here.</p>`;
  }
  if (!calendar.isConnected() && calState.state !== 'ok') {
    return `<p class="small" style="margin:0 0 12px">Not signed in to Google on this device.</p>
      <button class="btn quiet wide" type="button" data-action="cal-connect">Connect Google Calendar</button>`;
  }
  if (calState.state === 'loading') {
    return `<p class="small" style="margin:0">Checking…</p>`;
  }
  if (calState.state === 'error' || calState.state === 'offline') {
    return `<p class="small" style="margin:0">${esc(calState.message || 'Could not reach Google. Today still works.')}</p>`;
  }
  if (!calState.events.length) {
    return `<p class="small" style="margin:0">Nothing in the diary today.</p>`;
  }
  return calState.events.map((event) => `
    <div class="row">
      <div class="grow">
        <div class="name">${esc(event.summary)}</div>
        <div class="meta">${event.allDay
          ? 'All day'
          : `${esc(calendar.formatTime(event.start))}–${esc(calendar.formatTime(event.end))}`}${
          event.location ? ' · ' + esc(event.location) : ''}</div>
      </div>
    </div>`).join('');
}

// Repaints just the calendar card, so a slow network cannot make the rest of
// Today flicker or lose an input he is typing in.
function paintCalendar() {
  const body = document.getElementById('calbody');
  if (body) body.innerHTML = renderCalendarBody();
}

async function refreshCalendar({ force = false } = {}) {
  if (!calendar.isConfigured() || !calendar.isConnected()) return;
  calState = { ...calState, state: 'loading' };
  paintCalendar();
  const result = await calendar.todayEvents(todayKey(), { force });
  calState = { state: result.state, events: result.events || [], message: result.message || '' };
  paintCalendar();
}

// ---------------------------------------------------------------- meals

function mostRecentSunday(key) {
  const dow = dayOfWeek(key);
  return dow === 0 ? key : addDays(key, -dow);
}

function renderMeals() {
  const key = todayKey();
  const meals = mealsForDay(dayOfWeek(key));
  const open = (location.hash.split('/')[1] || '');
  const day = getDay(key) || {};
  const ticked = day.meals || {};

  const shopping = getSetting('shopping', null) || { weekStart: null, checked: [] };
  const sunday = mostRecentSunday(key);
  // Cleared every Sunday: anything ticked before this week's Sunday is stale.
  const checked = shopping.weekStart === sunday ? shopping.checked : [];

  return `
    <div class="hero">
      <h1>Meals</h1>
      <p class="sub">Same four every day. No decisions.</p>
    </div>

    ${meals.map((meal) => {
      const isOpen = open === meal.id;
      return `
        <div class="card meal${isOpen ? ' open' : ''}" id="meal-${meal.id}">
          <button class="mealhead" type="button" data-action="toggle-meal-open" data-meal="${meal.id}"
            aria-expanded="${isOpen ? 'true' : 'false'}">
            <span class="grow">
              <span class="name">${esc(meal.name)}</span>
              <span class="meta">${meal.kcal} kcal · ${meal.protein} g protein</span>
            </span>
            <span class="caret"></span>
          </button>
          ${isOpen ? `
            <div class="mealbody">
              <p class="card-title">Ingredients</p>
              <ul class="ings">${meal.ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
              <p class="card-title">Method</p>
              <ol class="steps">${meal.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
              <button class="btn ${ticked[meal.id] ? 'quiet' : ''} wide" type="button"
                data-action="toggle-meal" data-meal="${meal.id}">
                ${ticked[meal.id] ? 'Ticked off today' : 'Tick it off'}
              </button>
            </div>` : ''}
        </div>`;
    }).join('')}

    <h2 class="section">Weekly shop</h2>
    <div class="card">
      ${SHOPPING.map(([item, qty], i) => {
        const on = checked.includes(String(i));
        return `
          <div class="row${on ? ' done' : ''}">
            ${tick(on, 'toggle-shopping', `data-item="${i}"`)}
            <div class="grow">
              <div class="name">${esc(item)}</div>
              <div class="meta">${esc(qty)}</div>
            </div>
          </div>`;
      }).join('')}
      <p class="small" style="margin:14px 0 0">Clears itself every Sunday.</p>
    </div>`;
}

// ---------------------------------------------------------------- log

function weightSeries() {
  return Object.keys(state.days)
    .filter((k) => typeof state.days[k].weight === 'number')
    .sort()
    .map((k) => ({ date: k, weight: state.days[k].weight }));
}

function rollingAverage(series, window = 7) {
  return series.map((point, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1);
    return { date: point.date, value: slice.reduce((a, b) => a + b.weight, 0) / slice.length };
  });
}

// Drawn by hand. One line chart does not justify a charting library, and a
// library would be a build step.
function weightChart(series) {
  if (series.length < 2) {
    return `<p class="empty">Two weigh-ins and the chart appears. ${series.length} so far.</p>`;
  }

  const width = 320;
  const height = 170;
  const pad = { top: 12, right: 8, bottom: 22, left: 32 };
  const average = rollingAverage(series);

  const values = series.map((p) => p.weight).concat(average.map((p) => p.value));
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < 1) { min -= 0.5; max += 0.5; }
  const padding = (max - min) * 0.12;
  min -= padding; max += padding;

  const x = (i) => pad.left + (i / (series.length - 1)) * (width - pad.left - pad.right);
  const y = (v) => pad.top + (1 - (v - min) / (max - min)) * (height - pad.top - pad.bottom);

  const dailyPoints = series.map((p, i) => `${x(i).toFixed(1)},${y(p.weight).toFixed(1)}`).join(' ');
  const avgPoints = average.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  const ticks = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1];

  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="Daily weight with the seven day rolling average">
      ${ticks.map((t) => `
        <line x1="${pad.left}" y1="${y(t).toFixed(1)}" x2="${width - pad.right}" y2="${y(t).toFixed(1)}"
          class="grid"/>
        <text x="4" y="${(y(t) + 3.5).toFixed(1)}" class="axis">${t.toFixed(1)}</text>`).join('')}
      <polyline class="daily" points="${dailyPoints}"/>
      ${series.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.weight).toFixed(1)}" r="1.7" class="dot"/>`).join('')}
      <polyline class="avg" points="${avgPoints}"/>
      <text x="${pad.left}" y="${height - 6}" class="axis">${esc(formatShort(series[0].date))}</text>
      <text x="${width - pad.right}" y="${height - 6}" class="axis" text-anchor="end">${esc(formatShort(series[series.length - 1].date))}</text>
    </svg>`;
}

function renderLog() {
  const key = todayKey();
  const series = weightSeries();
  const data = report.gather(key);

  const measureDates = Object.keys(state.measures).sort().reverse();

  return `
    <div class="hero">
      <h1>Log</h1>
      <p class="sub">The rolling average is the one that means anything.</p>
    </div>

    <div class="card">
      <div class="card-head"><p class="card-title">Weight</p>
        <span class="right">${series.length} weigh-in${series.length === 1 ? '' : 's'}</span></div>
      ${weightChart(series)}
      <div class="legend">
        <span><i class="swatch avg"></i>7-day average</span>
        <span><i class="swatch daily"></i>daily</span>
      </div>
    </div>

    <div class="card">
      <div class="totals">
        <div class="total">
          <div class="n">${data.average !== null ? data.average.toFixed(2) : '—'} <span>kg</span></div>
          <div class="k">this week</div>
        </div>
        <div class="total">
          <div class="n">${data.lastAverage !== null ? data.lastAverage.toFixed(2) : '—'} <span>kg</span></div>
          <div class="k">last week</div>
        </div>
        <div class="total">
          <div class="n ${data.average !== null && data.lastAverage !== null ? (data.average - data.lastAverage <= 0 ? 'good' : 'warn') : ''}">
            ${data.average !== null && data.lastAverage !== null
              ? (data.average - data.lastAverage > 0 ? '+' : '') + (data.average - data.lastAverage).toFixed(2)
              : '—'}
          </div>
          <div class="k">change</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><p class="card-title">Measurements</p></div>
      <div class="field-row">
        <div class="grow">
          <label class="lbl" for="waist">Waist, cm</label>
          <input type="number" id="waist" inputmode="decimal" step="0.5" data-measure="waist"
            value="${esc(state.measures[key] && state.measures[key].waist != null ? state.measures[key].waist : '')}">
        </div>
        <div class="grow">
          <label class="lbl" for="shoulders">Shoulders, cm</label>
          <input type="number" id="shoulders" inputmode="decimal" step="0.5" data-measure="shoulders"
            value="${esc(state.measures[key] && state.measures[key].shoulders != null ? state.measures[key].shoulders : '')}">
        </div>
      </div>
      <p class="small" style="margin:10px 0 0">Waist on Sunday, shoulders every two weeks. Saved against today.</p>
      ${measureDates.length ? `
        <div style="margin-top:8px">
          ${measureDates.slice(0, 8).map((d) => {
            const m = state.measures[d];
            const bits = [];
            if (m.waist != null) bits.push(`waist ${m.waist} cm`);
            if (m.shoulders != null) bits.push(`shoulders ${m.shoulders} cm`);
            if (!bits.length) return '';
            return `<div class="row"><div class="grow"><div class="name">${esc(formatShort(d))}</div>
              <div class="meta">${esc(bits.join(' · '))}</div></div></div>`;
          }).join('')}
        </div>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><p class="card-title">Sunday report</p></div>
      <p class="small" style="margin:0 0 12px">Filled in from your log. Sleep, food and notes are a draft,
      edit them before you copy: they are the parts only you know.</p>
      <div class="btn-row">
        <button class="btn" type="button" data-action="build-report">Build the report</button>
        <button class="btn quiet" type="button" data-action="copy-report">Copy it</button>
      </div>
      <div id="copyResult" class="testresult"></div>
      <textarea id="reportText" class="mono" style="margin-top:14px;min-height:340px"
        placeholder="Tap build and it fills itself in."></textarea>
    </div>`;
}

// ---------------------------------------------------------------- calendar tab
//
// A real day view: hours down the side, timed events placed against them, and
// all-day items as a thin strip at the top rather than pretending to occupy a
// time. The point of it is seeing where the session fits between lectures and
// shifts, so today's session appears in that strip too.

const HOUR_PX = 58;
const GUTTER = 46;

let dayView = { date: null, state: 'idle', events: [], message: '' };

function calendarRoute() {
  const parts = (location.hash || '').slice(1).split('/');
  return parts[1] || todayKey();
}

const LDN_HOUR = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Europe/London' });
const LDN_MIN = new Intl.DateTimeFormat('en-GB', { minute: '2-digit', timeZone: 'Europe/London' });
const LDN_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });

function minutesInto(iso, dateKey) {
  const value = new Date(iso);
  const onDate = LDN_DATE.format(value);
  // Something that began yesterday and runs into today clamps to the top edge.
  if (onDate < dateKey) return 0;
  if (onDate > dateKey) return 24 * 60;
  return Number(LDN_HOUR.format(value)) * 60 + Number(LDN_MIN.format(value));
}

function nowMinutes() {
  const now = new Date();
  return Number(LDN_HOUR.format(now)) * 60 + Number(LDN_MIN.format(now));
}

// ---------------------------------------------------------------- scheduling
//
// Where the session goes. Timed events block it; all-day ones do not, because
// "Ikbal off" or a family retreat marks the whole day without occupying an hour
// of it, and refusing to schedule around those would leave nowhere to train.

const SCHED = { earliest: 7 * 60, latest: 21 * 60, step: 15 };

function busyIntervals(events, dateKey) {
  return events
    .filter((e) => !e.allDay && e.start && e.end)
    .map((e) => [minutesInto(e.start, dateKey), minutesInto(e.end, dateKey)])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
}

function clashes(start, minutes, busy) {
  const end = start + minutes;
  return busy.some(([from, to]) => start < to && end > from);
}

// The plan says morning training helps, and never to walk-jog before lifting,
// so this walks forward from the earliest sensible hour and takes the first
// gap that fits rather than hunting for a "best" one.
function autoSlot(events, dateKey, minutes) {
  const busy = busyIntervals(events, dateKey);
  for (let start = SCHED.earliest; start + minutes <= SCHED.latest; start += SCHED.step) {
    if (!clashes(start, minutes, busy)) return { start, fits: true };
  }
  return { start: SCHED.earliest, fits: false };
}

function sessionClashes(start, minutes, events, dateKey) {
  return clashes(start, minutes, busyIntervals(events, dateKey));
}

function hhmm(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function fromHHMM(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function renderCalendarTab() {
  const key = calendarRoute();
  const isToday = key === todayKey();
  const sessionId = WEEK[dayOfWeek(key)];
  const session = sessionId ? effectiveSession(sessionId) : null;

  if (dayView.date !== key) {
    dayView = { date: key, state: 'idle', events: [], message: '' };
    // Painted first, fetched after. The grid never waits on Google.
    setTimeout(() => loadDay(key), 0);
  }

  return `
    <div class="hero">
      <h1>${esc(formatLong(key))}</h1>
      <p class="sub">${isToday ? 'Today' : 'Not today'}</p>
    </div>

    <div class="daynav">
      <button class="iconbtn" type="button" data-action="day-shift" data-delta="-1" aria-label="Previous day">&lsaquo;</button>
      <button class="btn quiet small grow" type="button" data-action="day-today">Today</button>
      <button class="iconbtn" type="button" data-action="day-shift" data-delta="1" aria-label="Next day">&rsaquo;</button>
      ${calendar.isConnected()
        ? '<button class="iconbtn" type="button" data-action="day-refresh" aria-label="Refresh">&#8635;</button>' : ''}
    </div>

    <div id="dayBody">${renderDayBody(key, session)}</div>`;
}

// Resolves where the session sits today: his explicit choice if he has moved
// it, otherwise the first free gap. Auto placement is recomputed rather than
// stored, so when a lecture moves the session follows it until he pins it.
function sessionSlot(key, session, events) {
  if (!session) return null;
  const day = getDay(key) || {};
  const minutes = day.sessionMinutes || session.minutes || 50;
  const pinned = fromHHMM(day.sessionStart);
  if (pinned != null) {
    return { start: pinned, minutes, pinned: true, clash: sessionClashes(pinned, minutes, events, key) };
  }
  const auto = autoSlot(events, key, minutes);
  return { start: auto.start, minutes, pinned: false, clash: !auto.fits };
}

function renderDayBody(key, session) {
  if (!calendar.isConfigured()) {
    return `<div class="card"><p class="small" style="margin:0">Calendar not connected.
      Add a Google client ID in Settings and the day fills itself in.</p></div>`;
  }
  if (!calendar.isConnected() && dayView.state !== 'ok') {
    return `<div class="card">
      <p class="small" style="margin:0 0 12px">Not signed in to Google on this device.</p>
      <button class="btn quiet wide" type="button" data-action="cal-connect">Connect Google Calendar</button>
    </div>`;
  }

  const { timed, allDay } = calendar.layout(dayView.events);

  // The session is drawn on the grid now, not listed as a chip, so only genuine
  // all-day items sit in the strip.
  const chips = allDay.map((e) => ({ label: e.summary, kind: 'allday' }));
  const slot = sessionSlot(key, session, dayView.events);

  let earliest = 8 * 60;
  let latest = 20 * 60;
  if (slot) {
    earliest = Math.min(earliest, slot.start);
    latest = Math.max(latest, slot.start + slot.minutes);
  }
  for (const event of timed) {
    earliest = Math.min(earliest, minutesInto(event.start, key));
    latest = Math.max(latest, minutesInto(event.end, key));
  }
  const startHour = Math.max(0, Math.floor(earliest / 60) - 1);
  const endHour = Math.min(24, Math.ceil(latest / 60) + 1);
  const hours = [];
  for (let h = startHour; h <= endHour; h += 1) hours.push(h);
  const height = (endHour - startHour) * HOUR_PX;
  const top = (mins) => ((mins - startHour * 60) / 60) * HOUR_PX;

  const now = nowMinutes();
  const showNow = key === todayKey() && now >= startHour * 60 && now <= endHour * 60;

  const chipsHtml = chips.length
    ? `<div class="chips">${chips.map((c) => `<div class="chip ${c.kind}">${esc(c.label)}</div>`).join('')}</div>`
    : '';

  const noticeHtml = dayView.state === 'loading'
    ? '<p class="small" style="margin:0 0 10px">Checking&hellip;</p>'
    : (dayView.state === 'error' || dayView.state === 'offline')
      ? `<p class="small" style="margin:0 0 10px">${esc(dayView.message || 'Could not reach Google.')}</p>`
      : '';

  return `
    ${chipsHtml}
    ${noticeHtml}
    <div class="card daygrid-card">
      <div class="daygrid" data-start-hour="${startHour}" data-hour-px="${HOUR_PX}" data-date="${key}" style="height:${height}px">
        ${hours.map((h) => `
          <div class="hourline" style="top:${top(h * 60)}px"></div>
          <div class="hourlabel" style="top:${top(h * 60) - 7}px">${String(h % 24).padStart(2, '0')}:00</div>
        `).join('')}
        ${slot ? `
          <div class="event session${slot.pinned ? ' pinned' : ''}${slot.clash ? ' clash' : ''}"
            data-session-block="1" data-date="${key}"
            style="top:${top(slot.start)}px;height:${Math.max(30, (slot.minutes / 60) * HOUR_PX - 2)}px;left:${GUTTER}px;right:6px">
            <div class="event-time">${hhmm(slot.start)}&ndash;${hhmm(slot.start + slot.minutes)}${slot.pinned ? '' : ' · auto'}</div>
            <div class="event-title">${esc(session.name)}</div>
            ${slot.clash ? '<div class="event-loc">clashes with something</div>' : ''}
            <span class="draghandle" aria-hidden="true"></span>
          </div>` : ''}
        ${showNow ? `<div class="nowline" style="top:${top(now)}px"><i></i></div>` : ''}
        ${timed.map((event) => {
          const from = minutesInto(event.start, key);
          const to = minutesInto(event.end, key);
          const width = 99 / event.columns;
          return `
            <div class="event" style="top:${top(from)}px;height:${Math.max(22, ((to - from) / 60) * HOUR_PX - 2)}px;left:calc(${GUTTER}px + ${event.column * width}%);width:calc(${width}% - 8px)">
              <div class="event-time">${esc(calendar.formatTime(event.start))}</div>
              <div class="event-title">${esc(event.summary)}</div>
              ${event.location ? `<div class="event-loc">${esc(event.location)}</div>` : ''}
            </div>`;
        }).join('')}
      </div>
    </div>
    ${renderSessionTimeEditor(key, session, slot)}
    ${!timed.length && dayView.state === "ok"
      ? '<p class="small" style="margin:-4px 0 0">Nothing timetabled. The whole day is yours.</p>' : ''}`;
}

// ---------------------------------------------------------------- dragging
//
// Pointer events rather than HTML5 drag and drop, because drag and drop does
// not exist on touch. Snaps to 15 minutes: finer than that is fiddling, and he
// is doing this one-handed.
//
// A press that never really moves is treated as a tap and opens the editor, so
// the same block does both jobs without needing a separate control.

const SNAP = 15;
let dragging = null;

function gridGeometry() {
  const grid = document.querySelector('.daygrid');
  if (!grid) return null;
  return {
    grid,
    startHour: Number(grid.dataset.startHour) || 0,
    hourPx: Number(grid.dataset.hourPx) || 58,
    date: grid.dataset.date,
  };
}

view.addEventListener('pointerdown', (event) => {
  const block = event.target.closest('[data-session-block]');
  if (!block) return;
  const geo = gridGeometry();
  if (!geo) return;

  const day = getDay(geo.date) || {};
  const session = effectiveSession(WEEK[dayOfWeek(geo.date)]);
  if (!session) return;
  const minutes = day.sessionMinutes || session.minutes || 50;

  dragging = {
    block,
    geo,
    minutes,
    startY: event.clientY,
    originTop: block.offsetTop,
    moved: false,
  };
  try { block.setPointerCapture(event.pointerId); } catch { /* synthetic or stale pointer */ }
  block.classList.add('grabbed');
});

view.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const delta = event.clientY - dragging.startY;
  if (Math.abs(delta) > 4) dragging.moved = true;
  if (!dragging.moved) return;
  event.preventDefault();

  const perMinute = dragging.geo.hourPx / 60;
  const rawStart = dragging.geo.startHour * 60 + (dragging.originTop + delta) / perMinute;
  const snapped = Math.round(rawStart / SNAP) * SNAP;
  const clamped = Math.max(0, Math.min(24 * 60 - dragging.minutes, snapped));
  dragging.pending = clamped;

  dragging.block.style.top = `${(clamped - dragging.geo.startHour * 60) * perMinute}px`;
  const label = dragging.block.querySelector('.event-time');
  if (label) label.textContent = `${hhmm(clamped)}–${hhmm(clamped + dragging.minutes)}`;
});

view.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  const { block, geo, moved, pending } = dragging;
  block.classList.remove('grabbed');
  dragging = null;

  if (!moved) { openSessionEditor(geo.date); return; }
  if (pending == null) return;
  patchDay(geo.date, { sessionStart: hhmm(pending) });
  paintDay();
});

view.addEventListener('pointercancel', () => {
  if (dragging) dragging.block.classList.remove('grabbed');
  dragging = null;
  paintDay();
});

// ---------------------------------------------------------------- editor

function openSessionEditor(dateKey) {
  ui.sessionEditor = ui.sessionEditor === dateKey ? null : dateKey;
  paintDay();
}

function renderSessionTimeEditor(key, session, slot) {
  if (ui.sessionEditor !== key || !slot) return '';
  return `
    <div class="card sessedit">
      <div class="card-head"><p class="card-title">${esc(session.name)}</p></div>
      <div class="editgrid">
        <div class="field">
          <label class="lbl" for="sessStart">Starts</label>
          <input type="time" id="sessStart" data-sess="start" data-date="${key}" value="${hhmm(slot.start)}">
        </div>
        <div class="field">
          <label class="lbl" for="sessMins">Minutes</label>
          <input type="number" id="sessMins" inputmode="numeric" step="5" min="10" max="240"
            data-sess="minutes" data-date="${key}" value="${slot.minutes}">
        </div>
      </div>
      <div class="btn-row">
        <button class="btn quiet small" type="button" data-action="sess-auto" data-date="${key}">Find a free slot</button>
        ${slot.pinned ? `<button class="btn quiet small" type="button" data-action="sess-clear" data-date="${key}">Back to automatic</button>` : ''}
        <button class="btn quiet small" type="button" data-action="sess-close">Done</button>
      </div>
      <p class="small" style="margin:12px 0 0">Drag the block to move it. All-day things are ignored
      when it places itself, since they take up the day rather than an hour of it.</p>
    </div>`;
}

function paintDay() {
  const body = document.getElementById('dayBody');
  if (!body) return;
  const key = calendarRoute();
  const sessionId = WEEK[dayOfWeek(key)];
  body.innerHTML = renderDayBody(key, sessionId ? effectiveSession(sessionId) : null);
}

async function loadDay(key, options = {}) {
  if (!calendar.isConfigured()) return;
  dayView = { ...dayView, date: key, state: 'loading' };
  paintDay();
  // Deliberately not gated on being signed in. eventsFor falls back to the
  // cache, so a day already looked at still draws after the hour-long token
  // has lapsed, rather than collapsing to a sign-in prompt.
  const result = await calendar.eventsFor(key, { force: Boolean(options.force) });
  if (calendarRoute() !== key) return;
  dayView = { date: key, state: result.state, events: result.events || [], message: result.message || '' };
  paintDay();
  scrollDayIntoView();
}

// Opens somewhere useful rather than at midnight.
function scrollDayIntoView() {
  const grid = document.querySelector('.daygrid');
  if (!grid) return;
  const marker = grid.querySelector('.nowline') || grid.querySelector('.event');
  if (!marker) return;
  const offset = marker.getBoundingClientRect().top + window.scrollY - 150;
  if (offset > 0) window.scrollTo({ top: offset, behavior: 'smooth' });
}

// ---------------------------------------------------------------- coach

function coachRoute() {
  const parts = (location.hash || '#coach').slice(1).split('/');
  return { section: parts[1] || '', id: parts[2] || '' };
}

function editedBadge(count) {
  return count ? `<span class="badge">edited</span>` : '';
}

function lines(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function renderCoach() {
  const route = coachRoute();
  if (route.section === 'targets') return renderTargetsEditor();
  if (route.section === 'meal') return renderMealEditor(route.id);
  if (route.section === 'session') return renderSessionEditor(route.id);
  return renderCoachIndex();
}

function renderCoachIndex() {
  const meals = effectiveMeals();
  const sessions = effectiveSessions();
  const targets = effectiveTargets();
  const targetEdits = ['kcal', 'protein', 'fat', 'carbs', 'saturdayKcal', 'saturdayProtein']
    .filter((f) => targetOverridden(f)).length;

  return `
    <div class="hero">
      <h1>Coach</h1>
      <p class="sub">Edit the plan, or take it to Claude and bring changes back.</p>
    </div>

    <div class="card">
      <div class="card-head"><p class="card-title">Talk to Claude</p></div>
      <p class="small" style="margin:0 0 12px">Copies your plan and recent numbers as plain text.
      Paste it into a chat and ask for whatever you want changed.</p>
      <button class="btn wide" type="button" data-action="copy-context">Copy context for Claude</button>
      <div id="contextResult" class="testresult"></div>
    </div>

    <div class="card">
      <div class="card-head"><p class="card-title">Apply changes from Claude</p></div>
      <p class="small" style="margin:0 0 12px">Paste the JSON block Claude sends back. Nothing changes
      until you have seen exactly what it does and confirmed.</p>
      <div class="btn-row" style="margin-bottom:12px">
        <button class="btn quiet small" type="button" data-action="copy-schema">Copy the schema</button>
        ${coach.canUndo() ? `<button class="btn danger small" type="button" data-action="undo-patch">Undo last change</button>` : ''}
      </div>
      <textarea id="patchText" class="mono" placeholder='{ "fitness-plan-patch": 1, ... }'></textarea>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" type="button" data-action="check-patch">Check it</button>
      </div>
      <div id="patchResult" class="testresult"></div>
      <div id="patchDiff"></div>
    </div>

    <h2 class="section">Edit the plan</h2>
    ${anyOverrides() ? `
      <div class="note">You have edits layered over the plan. Anything you have not
      touched still follows the plan file, so improvements to the rest still reach you.</div>` : ''}

    <div class="card tight">
      <div class="row">
        <div class="grow">
          <div class="name">Targets${editedBadge(targetEdits)}</div>
          <div class="meta">${num(targets.kcal)} kcal · ${targets.protein} g protein</div>
        </div>
        <button class="chev" type="button" data-action="goto" data-href="#coach/targets" aria-label="Edit targets"></button>
      </div>
    </div>

    <div class="card tight">
      ${meals.map((meal) => `
        <div class="row">
          <div class="grow">
            <div class="name">${esc(meal.name)}${editedBadge(mealOverrides(meal.id).length)}</div>
            <div class="meta">${meal.kcal} kcal · ${meal.protein} g protein</div>
          </div>
          <button class="chev" type="button" data-action="goto" data-href="#coach/meal/${meal.id}"
            aria-label="Edit ${esc(meal.name)}"></button>
        </div>`).join('')}
    </div>

    <div class="card tight">
      ${Object.entries(sessions).map(([id, session]) => {
        const edits = session.exercises.filter((e) => exerciseOverrides(id, e.id).length).length;
        const changed = sessionStructureChanged(id) || edits > 0;
        return `
          <div class="row">
            <div class="grow">
              <div class="name">${esc(session.name)}${editedBadge(changed ? 1 : 0)}</div>
              <div class="meta">${session.exercises.length} exercises</div>
            </div>
            <button class="chev" type="button" data-action="goto" data-href="#coach/session/${id}"
              aria-label="Edit ${esc(session.name)}"></button>
          </div>`;
      }).join('')}
    </div>

    ${anyOverrides() ? `
      <button class="btn danger wide" type="button" data-action="reset-everything">Reset the whole plan to default</button>
    ` : ''}`;
}

function backLink() {
  return `<button class="btn quiet small" type="button" data-action="goto" data-href="#coach">Back</button>`;
}

function renderTargetsEditor() {
  const targets = effectiveTargets();
  const fields = [
    ['kcal', 'Daily calories'], ['protein', 'Daily protein, g'],
    ['fat', 'Daily fat, g'], ['carbs', 'Daily carbs, g'],
    ['saturdayKcal', 'Saturday calories'], ['saturdayProtein', 'Saturday protein, g'],
  ];
  return `
    <div class="hero"><h1>Targets</h1></div>
    ${backLink()}
    <div class="card" style="margin-top:14px">
      ${fields.map(([field, label]) => `
        <div style="margin-bottom:16px">
          <label class="lbl" for="t-${field}">${label}${editedBadge(targetOverridden(field) ? 1 : 0)}</label>
          <div class="field-row">
            <div class="grow">
              <input type="number" id="t-${field}" inputmode="numeric" data-target="${field}"
                value="${esc(targets[field])}">
            </div>
            ${targetOverridden(field)
              ? `<button class="btn quiet small" type="button" data-action="reset-target" data-value="${field}">Reset</button>`
              : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

function renderMealEditor(id) {
  const meal = effectiveMeals().find((m) => m.id === id);
  if (!meal) return renderCoachIndex();
  const edits = mealOverrides(id);

  return `
    <div class="hero"><h1>${esc(meal.name)}</h1>
      <p class="sub">${edits.length ? `You have changed: ${edits.join(', ')}` : 'Following the plan file'}</p></div>
    ${backLink()}
    <div class="card" style="margin-top:14px">
      <label class="lbl" for="m-name">Name${editedBadge(edits.includes('name') ? 1 : 0)}</label>
      <input type="text" id="m-name" data-meal-field="name" data-id="${id}" value="${esc(meal.name)}">

      <div class="editgrid" style="margin-top:16px">
        <div class="field">
          <label class="lbl" for="m-kcal">kcal${editedBadge(edits.includes('kcal') ? 1 : 0)}</label>
          <input type="number" id="m-kcal" inputmode="numeric" data-meal-field="kcal" data-id="${id}" value="${esc(meal.kcal)}">
        </div>
        <div class="field">
          <label class="lbl" for="m-protein">protein, g${editedBadge(edits.includes('protein') ? 1 : 0)}</label>
          <input type="number" id="m-protein" inputmode="numeric" data-meal-field="protein" data-id="${id}" value="${esc(meal.protein)}">
        </div>
      </div>

      <label class="lbl" style="margin-top:6px" for="m-ings">Ingredients, one per line${editedBadge(edits.includes('ingredients') ? 1 : 0)}</label>
      <textarea id="m-ings" data-meal-field="ingredients" data-id="${id}" style="min-height:140px">${esc(lines(meal.ingredients))}</textarea>

      <label class="lbl" style="margin-top:16px" for="m-steps">Method, one step per line${editedBadge(edits.includes('steps') ? 1 : 0)}</label>
      <textarea id="m-steps" data-meal-field="steps" data-id="${id}" style="min-height:180px">${esc(lines(meal.steps))}</textarea>

      ${edits.length ? `
        <button class="btn danger wide" style="margin-top:18px" type="button"
          data-action="reset-meal" data-id="${id}">Reset this meal to default</button>` : ''}
    </div>`;
}

function renderSessionEditor(sessionId) {
  const session = effectiveSession(sessionId);
  if (!session) return renderCoachIndex();

  return `
    <div class="hero"><h1>${esc(session.name)}</h1>
      <p class="sub">${session.exercises.length} exercises</p></div>
    ${backLink()}
    <div class="card" style="margin-top:14px">
      ${session.exercises.map((ex, index) => {
        const edits = exerciseOverrides(sessionId, ex.id);
        return `
          <div class="exedit">
            <div class="exedit-head">
              <span class="name">${esc(ex.name)}${ex.isCustom ? '<span class="badge">added</span>' : editedBadge(edits.length)}</span>
              <button class="iconbtn" type="button" data-action="move-ex" data-session="${sessionId}"
                data-id="${ex.id}" data-delta="-1" aria-label="Move up"${index === 0 ? ' disabled' : ''}>↑</button>
              <button class="iconbtn" type="button" data-action="move-ex" data-session="${sessionId}"
                data-id="${ex.id}" data-delta="1" aria-label="Move down"${index === session.exercises.length - 1 ? ' disabled' : ''}>↓</button>
              <button class="iconbtn danger" type="button" data-action="remove-ex" data-session="${sessionId}"
                data-id="${ex.id}" aria-label="Remove">✕</button>
            </div>
            <div class="editgrid">
              <div class="field">
                <label class="lbl">sets</label>
                <input type="number" inputmode="numeric" data-ex-field="sets"
                  data-session="${sessionId}" data-id="${ex.id}" value="${esc(ex.sets)}">
              </div>
              <div class="field" style="flex:2">
                <label class="lbl">reps</label>
                <input type="text" data-ex-field="reps"
                  data-session="${sessionId}" data-id="${ex.id}" value="${esc(ex.reps)}">
              </div>
            </div>
            <label class="lbl">note</label>
            <input type="text" data-ex-field="note" data-session="${sessionId}" data-id="${ex.id}"
              value="${esc(ex.note)}">
            ${edits.length && !ex.isCustom ? `
              <button class="btn quiet small" style="margin-top:10px" type="button"
                data-action="reset-ex" data-session="${sessionId}" data-id="${ex.id}">Reset this exercise</button>` : ''}
          </div>`;
      }).join('')}

      <button class="btn quiet wide" style="margin-top:16px" type="button"
        data-action="add-ex" data-session="${sessionId}">Add an exercise</button>

      ${sessionStructureChanged(sessionId) || session.exercises.some((e) => exerciseOverrides(sessionId, e.id).length) ? `
        <button class="btn danger wide" style="margin-top:10px" type="button"
          data-action="reset-session" data-session="${sessionId}">Reset this session to default</button>` : ''}
    </div>`;
}

// ---------------------------------------------------------------- appearance

const THEMES = [['system', 'Follow system'], ['dark', 'Dark'], ['light', 'Light']];
const ACCENTS = [
  ['blue', 'Blue'], ['green', 'Green'], ['amber', 'Amber'],
  ['violet', 'Violet'], ['coral', 'Coral'],
];
const TEXT_SIZES = [['normal', 'Normal'], ['large', 'Large']];

// Lives in settings, so it syncs. Applied by setting attributes the stylesheet
// keys off, which is the same thing the inline script in index.html does before
// first paint.
export function applyAppearance() {
  const root = document.documentElement;
  root.setAttribute('data-theme', getSetting('theme', 'system'));
  root.setAttribute('data-accent', getSetting('accent', 'blue'));
  root.setAttribute('data-textsize', getSetting('textSize', 'normal'));
}

function renderAppearance() {
  const theme = getSetting('theme', 'system');
  const accent = getSetting('accent', 'blue');
  const textSize = getSetting('textSize', 'normal');

  return `
    <div class="card">
      <div class="card-head"><p class="card-title">Appearance</p></div>

      <label class="lbl">Theme</label>
      <div class="choices">
        ${THEMES.map(([id, label]) => `
          <button class="choice" type="button" aria-pressed="${theme === id}"
            data-action="set-theme" data-value="${id}">${label}</button>`).join('')}
      </div>

      <label class="lbl" style="margin-top:18px">Accent</label>
      <div class="swatches">
        ${ACCENTS.map(([id, label]) => `
          <button class="swatchbtn" type="button" aria-pressed="${accent === id}"
            data-action="set-accent" data-value="${id}" aria-label="${label}" title="${label}"
            ><i style="background:var(--sw-${id})"></i></button>`).join('')}
      </div>

      <label class="lbl" style="margin-top:18px">Text size</label>
      <div class="choices">
        ${TEXT_SIZES.map(([id, label]) => `
          <button class="choice" type="button" aria-pressed="${textSize === id}"
            data-action="set-textsize" data-value="${id}">${label}</button>`).join('')}
      </div>

      <p class="small" style="margin:16px 0 0">The strip at the top of the phone stays dark
      whichever theme you pick. Its colour is compiled into the app and cannot follow this
      setting, so it is held dark everywhere rather than matching in the browser and looking
      broken in the app.</p>
    </div>`;
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
      <p class="small" style="margin:8px 0 0">Optional. The app works fully without it.
      The origin to authorise in Google Cloud is
      <code>https://anand20003831.github.io</code> with no path and no trailing slash.</p>
      ${calendar.isConnected() ? `
        <button class="btn quiet wide" style="margin-top:14px" type="button"
          data-action="cal-disconnect">Disconnect Google Calendar</button>` : ''}
    </div>

    ${renderAppearance()}

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
  meals: renderMeals,
  train: renderTrain,
  log: renderLog,
  calendar: renderCalendarTab,
  coach: renderCoach,
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
  // Settings lives in the header now, so the gear carries the current marker
  // when it is open. Seven tabs would have squeezed every target under the
  // width he can hit one-handed.
  const gear = document.querySelector('.gear');
  if (gear) {
    if (tab === 'settings') gear.setAttribute('aria-current', 'page');
    else gear.removeAttribute('aria-current');
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
      const session = effectiveSession(activeSessionId());
      const prescribed = session.exercises.find((e) => e.id === exerciseId).sets;
      writeSet(exerciseId, Math.max(rows.length, prescribed), { kg: '', reps: '', done: false });
      render();
      break;
    }

    case 'toggle-meal-open': {
      const id = el.dataset.meal;
      const open = (location.hash.split('/')[1] || '');
      location.hash = open === id ? '#meals' : `#meals/${id}`;
      break;
    }

    case 'toggle-shopping': {
      const index = String(el.dataset.item);
      const sunday = mostRecentSunday(key);
      const current = getSetting('shopping', null) || { weekStart: null, checked: [] };
      const checked = current.weekStart === sunday ? current.checked.slice() : [];
      const at = checked.indexOf(index);
      if (at === -1) checked.push(index); else checked.splice(at, 1);
      setSetting('shopping', { weekStart: sunday, checked });
      render();
      break;
    }

    case 'build-report':
      document.getElementById('reportText').value = report.draft(key);
      break;

    case 'copy-report': {
      const box = document.getElementById('reportText');
      const out = document.getElementById('copyResult');
      if (!box.value) box.value = report.draft(key);
      copyText(box.value).then((ok) => {
        out.className = 'testresult ' + (ok ? 'ok' : 'bad');
        out.textContent = ok
          ? 'Copied. Paste it to Claude.'
          : 'Could not reach the clipboard. The text is selected, copy it by hand.';
        if (!ok) { box.focus(); box.select(); }
      });
      break;
    }

    case 'sess-auto': {
      const date = el.dataset.date;
      const session = effectiveSession(WEEK[dayOfWeek(date)]);
      const day = getDay(date) || {};
      const minutes = day.sessionMinutes || (session && session.minutes) || 50;
      const auto = autoSlot(dayView.events, date, minutes);
      patchDay(date, { sessionStart: hhmm(auto.start) });
      paintDay();
      break;
    }

    case 'sess-clear':
      patchDay(el.dataset.date, { sessionStart: null });
      paintDay();
      break;

    case 'sess-close':
      ui.sessionEditor = null;
      paintDay();
      break;

    case 'day-shift': {
      const current = calendarRoute();
      location.hash = '#calendar/' + addDays(current, Number(el.dataset.delta));
      break;
    }

    case 'day-today':
      location.hash = '#calendar';
      break;

    case 'day-refresh':
      loadDay(calendarRoute(), { force: true });
      break;

    case 'cal-connect': {
      el.disabled = true;
      calendar.connect().then((result) => {
        if (result.ok) {
          refreshCalendar({ force: true });
          render();
        } else {
          calState = { state: 'error', events: [], message: result.message };
          el.disabled = false;
          paintCalendar();
        }
      });
      break;
    }

    case 'cal-refresh':
      refreshCalendar({ force: true });
      break;

    case 'cal-disconnect':
      calendar.disconnect();
      calState = { state: 'idle', events: [], message: '' };
      render();
      break;

    case 'set-theme':
    case 'set-accent':
    case 'set-textsize': {
      const field = { 'set-theme': 'theme', 'set-accent': 'accent', 'set-textsize': 'textSize' }[el.dataset.action];
      setSetting(field, el.dataset.value);
      applyAppearance();
      render();
      break;
    }

    case 'copy-context': {
      const out = document.getElementById('contextResult');
      const text = coach.buildContext(key);
      copyText(text).then((ok) => {
        out.className = 'testresult ' + (ok ? 'ok' : 'bad');
        out.textContent = ok
          ? `Copied, ${text.length} characters. Paste it into a chat with Claude.`
          : 'Could not reach the clipboard.';
      });
      break;
    }

    case 'copy-schema': {
      const out = document.getElementById('patchResult');
      copyText(coach.SCHEMA_TEXT).then((ok) => {
        out.className = 'testresult ' + (ok ? 'ok' : 'bad');
        out.textContent = ok
          ? 'Schema copied. Paste it to Claude along with the context.'
          : 'Could not reach the clipboard.';
      });
      break;
    }

    case 'check-patch': {
      const out = document.getElementById('patchResult');
      const target = document.getElementById('patchDiff');
      const result = coach.validate(document.getElementById('patchText').value);
      if (!result.ok) {
        out.className = 'testresult bad';
        out.textContent = result.errors.length === 1
          ? result.errors[0]
          : `${result.errors.length} problems with that block:`;
        target.innerHTML = result.errors.length > 1
          ? `<ul class="difflist">${result.errors.map((e) => `<li class="remove">${esc(e)}</li>`).join('')}</ul>`
          : '';
        break;
      }
      const changes = coach.diff(result.patch);
      if (!changes.length) {
        out.className = 'testresult ok';
        out.textContent = 'That block is valid, but nothing in it differs from your current plan.';
        target.innerHTML = '';
        break;
      }
      ui.pendingPatch = result.patch;
      out.className = 'testresult ok';
      out.textContent = `${changes.length} change${changes.length === 1 ? '' : 's'}:`;
      target.innerHTML = `
        <ul class="difflist">
          ${changes.map((c) => `<li class="${c.kind}">${esc(c.text)}</li>`).join('')}
        </ul>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn" type="button" data-action="apply-patch">Apply these changes</button>
          <button class="btn quiet" type="button" data-action="cancel-patch">Cancel</button>
        </div>`;
      break;
    }

    case 'apply-patch':
      if (!ui.pendingPatch) break;
      coach.apply(ui.pendingPatch);
      ui.pendingPatch = null;
      render();
      break;

    case 'cancel-patch':
      ui.pendingPatch = null;
      document.getElementById('patchDiff').innerHTML = '';
      document.getElementById('patchResult').className = 'testresult';
      break;

    case 'undo-patch':
      coach.undo();
      render();
      break;

    case 'reset-target':
      setTarget(el.dataset.value, null);
      render();
      break;

    case 'reset-meal':
      resetMeal(el.dataset.id);
      render();
      break;

    case 'reset-ex':
      resetExercise(el.dataset.session, el.dataset.id);
      render();
      break;

    case 'remove-ex':
      removeExercise(el.dataset.session, el.dataset.id);
      render();
      break;

    case 'move-ex':
      moveExercise(el.dataset.session, el.dataset.id, Number(el.dataset.delta));
      render();
      break;

    case 'add-ex': {
      const name = window.prompt('Name of the new exercise');
      if (!name || !name.trim()) break;
      const id = 'custom-' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        + '-' + Math.abs(hashString(name + Date.now())).toString(36).slice(0, 4);
      addExercise(el.dataset.session, { id, name: name.trim(), sets: 3, reps: '8-12', note: '' });
      render();
      break;
    }

    case 'reset-session':
      resetSession(el.dataset.session);
      render();
      break;

    case 'reset-everything':
      if (window.confirm('Drop every edit you have made and go back to the plan as written?')) {
        resetEverything();
        render();
      }
      break;

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

  // Plan edits commit on change without re-rendering, so the keyboard stays put
  // while he moves between fields.
  if (el.dataset.sess) {
    const date = el.dataset.date;
    if (el.dataset.sess === 'start') {
      const mins = fromHHMM(el.value);
      patchDay(date, { sessionStart: mins == null ? null : hhmm(mins) });
    } else {
      const value = Number(el.value);
      patchDay(date, { sessionMinutes: Number.isFinite(value) && value > 0 ? value : null });
    }
    paintDay();
    return;
  }

  if (el.dataset.target) {
    const value = el.value.trim();
    setTarget(el.dataset.target, value === '' ? null : Number(value));
    return;
  }

  if (el.dataset.mealField) {
    const field = el.dataset.mealField;
    const raw = el.value;
    const value = (field === 'kcal' || field === 'protein')
      ? (raw.trim() === '' ? null : Number(raw))
      : (field === 'ingredients' || field === 'steps')
        ? raw.split('\n').map((s) => s.trim()).filter(Boolean)
        : raw.trim();
    setMealField(el.dataset.id, field, value);
    return;
  }

  if (el.dataset.exField) {
    const field = el.dataset.exField;
    const raw = el.value;
    const value = field === 'sets' ? (raw.trim() === '' ? null : Number(raw)) : raw.trim();
    setExerciseField(el.dataset.session, el.dataset.id, field, value);
    return;
  }

  if (el.dataset.measure) {
    const value = el.value.trim();
    patchMeasure(todayKey(), { [el.dataset.measure]: value === '' ? null : Number(value) });
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
  // Appearance is synced, so a change made on the other device lands here.
  applyAppearance();
  // Never yank the screen out from under a field he is typing in.
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  render();
});

applyAppearance();
render();
sync.start();
refreshCalendar();

// Registered after first paint so it never delays the app opening.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((err) => {
      console.warn('Service worker did not register. The app still works, just not offline.', err);
    });
  });
}

// Kept for the console: `window.fitness.state`.
window.fitness = { state, render, sync };
