// Entry point: routing and rendering.

import { SESSIONS, WEEK, GOAL_DATE, mealsForDay, targetsForDay } from './plan.js';
import {
  state, getDay, patchDay, getSetting, setSetting,
  todayKey, dayOfWeek, daysBetween, formatLong,
} from './store.js';

const view = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

const TABS = ['today', 'meals', 'train', 'log', 'settings'];

// Transient screen state. Never persisted.
const ui = { editWeight: false };

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

export function setSyncState(stateName, text) {
  const pill = document.getElementById('syncpill');
  pill.dataset.state = stateName;
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
  train: () => stub('Train', 'The set logger and last-time numbers land here in step 4.'),
  log: () => stub('Log', 'Weight chart, measurements and the Sunday report land here in step 6.'),
  settings: () => stub('Settings', 'Token, sync and calendar settings land here in step 5.'),
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

render();

// Kept for the console: `window.fitness.state`.
window.fitness = { state, render };
