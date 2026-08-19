// The bridge to Claude. Copy out, paste back. No API key, because a key is a
// spendable credential and this app is served from a public URL.
//
// Out: a plain text summary of the effective plan and recent data.
// In:  a small JSON patch, validated, shown as a plain-English diff, applied
//      only on confirm, and undoable once.

import { state, addDays, formatShort, mondayOf } from './store.js';
import { SESSIONS, MEALS, TARGETS, SATURDAY_MEAL, WEEK } from './plan.js';
import {
  effectiveTargets, effectiveMeals, effectiveSessions, effectiveSession,
  getPatch, savePatch,
} from './overlay.js';
import { getSetting, setSetting } from './store.js';

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------- schema doc

export const SCHEMA_TEXT = `Plan patch format, version ${SCHEMA_VERSION}.
Reply with ONE json block in exactly this shape. Every part is optional:
send only what changes.

{
  "fitness-plan-patch": 1,

  "targets": { "kcal": 2100, "protein": 180, "fat": 55, "carbs": 220,
               "saturdayKcal": 2500, "saturdayProtein": 188 },

  "meals": {
    "breakfast": { "kcal": 620, "protein": 45, "name": "...",
                   "ingredients": ["..."], "steps": ["..."] },
    "lunch":     { "reset": true }
  },

  "sessions": {
    "upperA": {
      "name": "...",
      "exercises": {
        "chest-press": { "sets": 5, "reps": "6-10", "note": "..." },
        "fly":         { "remove": true },
        "cable-fly":   { "add": true, "name": "Cable fly",
                         "sets": 3, "reps": "12-15", "note": "..." },
        "lateral":     { "reset": true }
      },
      "order": ["chest-press", "db-ohp", "pulldown-narrow", "lateral", "tri-ext"]
    }
  }
}

Rules:
- "reset": true removes my edits to that item and returns it to the default.
- "remove": true drops an exercise from that session.
- "add": true creates a new exercise; it needs name, sets, reps and note.
- "order" is the full list of exercise ids for that session, in order.
- Numbers must be numbers, not strings. "reps" is a string like "8-12".
- Meal ids: breakfast, lunch, afternoon, dinner, extras.
- Session ids: upperA, lowerA, shirt, upperB, lowerB.
- Do not send anything not listed above.`;

// ---------------------------------------------------------------- context out

function lastDays(todayKey, count) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(addDays(todayKey, -i));
  return keys;
}

function line(label, value) {
  return `${label}: ${value}`;
}

export function buildContext(todayKey) {
  const targets = effectiveTargets();
  const meals = effectiveMeals();
  const sessions = effectiveSessions();
  const out = [];

  out.push('CURRENT PLAN AND RECENT DATA');
  out.push('');
  out.push('TARGETS');
  out.push(`  ${targets.kcal} kcal, ${targets.protein} g protein, ${targets.fat} g fat, ${targets.carbs} g carbs`);
  out.push(`  Saturday: ${targets.saturdayKcal} kcal, ${targets.saturdayProtein} g protein`);
  out.push('');

  out.push('MEALS');
  for (const meal of meals) {
    out.push(`  ${meal.id}: ${meal.name}, ${meal.kcal} kcal, ${meal.protein} g protein${meal.saturdayOnly ? ' (Saturday only)' : ''}`);
  }
  out.push('');

  out.push('SESSIONS');
  for (const [id, session] of Object.entries(sessions)) {
    const day = Object.entries(WEEK).find(([, sid]) => sid === id);
    const dayName = day ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][Number(day[0])] : '';
    out.push(`  ${id} (${dayName}): ${session.name}`);
    for (const ex of session.exercises) {
      out.push(`    ${ex.id}: ${ex.name}, ${ex.sets} x ${ex.reps}`);
    }
  }
  out.push('');

  // Weights, last 14 days.
  const weightKeys = lastDays(todayKey, 14);
  const weights = weightKeys
    .map((k) => (state.days[k] && typeof state.days[k].weight === 'number'
      ? `${formatShort(k).slice(0, 6)} ${state.days[k].weight}` : null))
    .filter(Boolean);
  out.push('WEIGHT, last 14 days');
  out.push(weights.length ? `  ${weights.join(' | ')}` : '  none logged');

  const thisWeek = lastDays(todayKey, 7)
    .map((k) => state.days[k] && state.days[k].weight)
    .filter((w) => typeof w === 'number');
  const prevWeek = lastDays(addDays(todayKey, -7), 7)
    .map((k) => state.days[k] && state.days[k].weight)
    .filter((w) => typeof w === 'number');
  const avg = (xs) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  if (avg(thisWeek) !== null) {
    const now = avg(thisWeek);
    const before = avg(prevWeek);
    out.push(`  7-day average ${now.toFixed(2)} kg` +
      (before !== null ? `, previous 7 ${before.toFixed(2)} kg, change ${(now - before > 0 ? '+' : '')}${(now - before).toFixed(2)} kg` : ''));
  }
  out.push('');

  // Waist, last 4 weeks.
  const measureKeys = Object.keys(state.measures).sort().reverse();
  const cutoff = addDays(todayKey, -28);
  const waists = measureKeys
    .filter((k) => k >= cutoff && state.measures[k].waist != null)
    .map((k) => `${formatShort(k).slice(0, 6)} ${state.measures[k].waist} cm`);
  const shoulders = measureKeys
    .filter((k) => k >= cutoff && state.measures[k].shoulders != null)
    .map((k) => `${formatShort(k).slice(0, 6)} ${state.measures[k].shoulders} cm`);
  out.push('MEASUREMENTS, last 4 weeks');
  out.push(`  waist: ${waists.length ? waists.join(' | ') : 'none'}`);
  out.push(`  shoulders: ${shoulders.length ? shoulders.join(' | ') : 'none'}`);
  out.push('');

  // Recent sessions, most recent first, capped so the block stays readable.
  out.push('RECENT SESSIONS');
  const workoutKeys = Object.keys(state.workouts).sort().reverse().slice(0, 8);
  if (!workoutKeys.length) out.push('  none logged');
  for (const key of workoutKeys) {
    const workout = state.workouts[key];
    const session = effectiveSession(workout.sessionId);
    const parts = [];
    for (const [exerciseId, rows] of Object.entries(workout.sets || {})) {
      const done = (rows || []).filter((s) => s && s.done && Number(s.reps) > 0);
      if (!done.length) continue;
      const name = session
        ? (session.exercises.find((e) => e.id === exerciseId) || {}).name || exerciseId
        : exerciseId;
      const kgs = done.map((s) => (s.kg === '' || s.kg == null ? 0 : Number(s.kg)));
      const uniform = kgs.every((k) => k === kgs[0]);
      parts.push(uniform
        ? `${name} ${kgs[0] ? kgs[0] + 'kg' : 'BW'} x ${done.map((s) => s.reps).join(',')}`
        : `${name} ${done.map((s, i) => `${kgs[i] || 'BW'}x${s.reps}`).join(',')}`);
    }
    if (parts.length) {
      out.push(`  ${formatShort(key)} ${session ? session.name : workout.sessionId}`);
      for (const part of parts) out.push(`    ${part}`);
    }
  }
  out.push('');

  // Adherence over the last fortnight.
  const fortnight = lastDays(todayKey, 14);
  let full = 0; let logged = 0; let walks = 0;
  for (const key of fortnight) {
    const day = state.days[key];
    if (!day) continue;
    if (day.walkjog) walks += 1;
    if (!day.meals) continue;
    const dow = new Date(key + 'T12:00:00Z').getUTCDay();
    const required = meals.filter((m) => (dow === 6 ? true : !m.saturdayOnly));
    const ticked = required.filter((m) => day.meals[m.id]).length;
    if (ticked) logged += 1;
    if (ticked === required.length) full += 1;
  }
  const sessionsDone = fortnight.filter((k) => {
    const workout = state.workouts[k];
    return workout && Object.values(workout.sets || {})
      .some((rows) => Array.isArray(rows) && rows.some((s) => s && s.done));
  }).length;

  out.push('ADHERENCE, last 14 days');
  out.push(`  meals fully hit ${full}/14, days with any meal logged ${logged}/14`);
  out.push(`  sessions ${sessionsDone}, walk-jogs ${walks}`);

  const sleepDays = fortnight.map((k) => state.days[k]).filter((d) => d && d.bedTime);
  if (sleepDays.length) {
    const mins = sleepDays.map((d) => {
      const [h, m] = d.bedTime.split(':').map(Number);
      const raw = h * 60 + m;
      return raw < 12 * 60 ? raw + 24 * 60 : raw;
    });
    const mean = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) % (24 * 60);
    out.push(`  average bedtime ${String(Math.floor(mean / 60)).padStart(2, '0')}:${String(mean % 60).padStart(2, '0')} over ${sleepDays.length} nights`);
  }

  return out.join('\n');
}

// ---------------------------------------------------------------- validation

const TARGET_FIELDS = ['kcal', 'protein', 'fat', 'carbs', 'saturdayKcal', 'saturdayProtein'];
const MEAL_FIELDS = ['name', 'kcal', 'protein', 'ingredients', 'steps'];
const EXERCISE_FIELDS = ['name', 'sets', 'reps', 'note'];

const KNOWN_MEALS = new Set([...MEALS.map((m) => m.id), SATURDAY_MEAL.id]);
const KNOWN_SESSIONS = new Set(Object.keys(SESSIONS));

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Returns { ok, errors, patch } where patch is the incoming document, cleaned.
export function validate(text) {
  const errors = [];
  let doc;

  const trimmed = String(text || '').trim();
  if (!trimmed) return { ok: false, errors: ['Nothing pasted.'] };

  // Tolerate a fenced code block, because that is how it will arrive.
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    doc = JSON.parse(unfenced);
  } catch (err) {
    return { ok: false, errors: [`That is not valid JSON. ${err.message}`] };
  }

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, errors: ['The top level must be a JSON object.'] };
  }
  if (doc['fitness-plan-patch'] !== SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`Missing or wrong "fitness-plan-patch". It must be the number ${SCHEMA_VERSION}. Paste the schema to Claude and ask again.`],
    };
  }

  for (const key of Object.keys(doc)) {
    if (!['fitness-plan-patch', 'targets', 'meals', 'sessions'].includes(key)) {
      errors.push(`Unknown top-level key "${key}". Only targets, meals and sessions are allowed.`);
    }
  }

  if (doc.targets !== undefined) {
    if (typeof doc.targets !== 'object' || Array.isArray(doc.targets)) {
      errors.push('"targets" must be an object.');
    } else {
      for (const [field, value] of Object.entries(doc.targets)) {
        if (!TARGET_FIELDS.includes(field)) errors.push(`Unknown target "${field}".`);
        else if (!positiveNumber(value)) errors.push(`Target "${field}" must be a number, got ${JSON.stringify(value)}.`);
      }
    }
  }

  if (doc.meals !== undefined) {
    if (typeof doc.meals !== 'object' || Array.isArray(doc.meals)) {
      errors.push('"meals" must be an object keyed by meal id.');
    } else {
      for (const [id, change] of Object.entries(doc.meals)) {
        if (!KNOWN_MEALS.has(id)) {
          errors.push(`Unknown meal "${id}". Known meals: ${[...KNOWN_MEALS].join(', ')}.`);
          continue;
        }
        if (typeof change !== 'object' || Array.isArray(change)) {
          errors.push(`Meal "${id}" must be an object.`);
          continue;
        }
        if (change.reset === true) continue;
        for (const [field, value] of Object.entries(change)) {
          if (field === 'reset') continue;
          if (!MEAL_FIELDS.includes(field)) { errors.push(`Meal "${id}": unknown field "${field}".`); continue; }
          if ((field === 'kcal' || field === 'protein') && !positiveNumber(value)) {
            errors.push(`Meal "${id}": "${field}" must be a number.`);
          }
          if (field === 'name' && typeof value !== 'string') errors.push(`Meal "${id}": "name" must be text.`);
          if ((field === 'ingredients' || field === 'steps') && !isStringArray(value)) {
            errors.push(`Meal "${id}": "${field}" must be a list of text lines.`);
          }
        }
      }
    }
  }

  if (doc.sessions !== undefined) {
    if (typeof doc.sessions !== 'object' || Array.isArray(doc.sessions)) {
      errors.push('"sessions" must be an object keyed by session id.');
    } else {
      for (const [sessionId, section] of Object.entries(doc.sessions)) {
        if (!KNOWN_SESSIONS.has(sessionId)) {
          errors.push(`Unknown session "${sessionId}". Known sessions: ${[...KNOWN_SESSIONS].join(', ')}.`);
          continue;
        }
        if (typeof section !== 'object' || Array.isArray(section)) {
          errors.push(`Session "${sessionId}" must be an object.`);
          continue;
        }
        for (const key of Object.keys(section)) {
          if (!['name', 'exercises', 'order', 'reset'].includes(key)) {
            errors.push(`Session "${sessionId}": unknown key "${key}".`);
          }
        }
        if (section.name !== undefined && typeof section.name !== 'string') {
          errors.push(`Session "${sessionId}": "name" must be text.`);
        }
        if (section.order !== undefined && !isStringArray(section.order)) {
          errors.push(`Session "${sessionId}": "order" must be a list of exercise ids.`);
        }
        if (section.exercises !== undefined) {
          if (typeof section.exercises !== 'object' || Array.isArray(section.exercises)) {
            errors.push(`Session "${sessionId}": "exercises" must be an object keyed by exercise id.`);
            continue;
          }
          const known = new Set(effectiveSession(sessionId).exercises.map((e) => e.id));
          for (const [exerciseId, change] of Object.entries(section.exercises)) {
            if (typeof change !== 'object' || Array.isArray(change)) {
              errors.push(`Exercise "${exerciseId}" must be an object.`);
              continue;
            }
            if (change.add === true) {
              for (const field of ['name', 'sets', 'reps', 'note']) {
                if (change[field] === undefined) errors.push(`New exercise "${exerciseId}" is missing "${field}".`);
              }
              if (known.has(exerciseId)) errors.push(`Exercise "${exerciseId}" already exists in ${sessionId}, so it cannot be added.`);
            } else if (change.remove !== true && change.reset !== true && !known.has(exerciseId)) {
              errors.push(`Exercise "${exerciseId}" is not in ${sessionId}. Use "add": true to create it.`);
            }
            for (const [field, value] of Object.entries(change)) {
              if (['add', 'remove', 'reset'].includes(field)) continue;
              if (!EXERCISE_FIELDS.includes(field)) { errors.push(`Exercise "${exerciseId}": unknown field "${field}".`); continue; }
              if (field === 'sets' && !positiveNumber(value)) errors.push(`Exercise "${exerciseId}": "sets" must be a number.`);
              if ((field === 'reps' || field === 'name' || field === 'note') && typeof value !== 'string') {
                errors.push(`Exercise "${exerciseId}": "${field}" must be text.`);
              }
            }
          }
        }
      }
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, errors: [], patch: doc };
}

// ---------------------------------------------------------------- diff

function describeValue(value) {
  if (Array.isArray(value)) return `${value.length} line${value.length === 1 ? '' : 's'}`;
  return String(value);
}

// Plain English, comparing against what he currently sees rather than against
// plan.js, because what he sees is what is about to change.
export function diff(doc) {
  const changes = [];
  const targets = effectiveTargets();
  const meals = effectiveMeals();
  const sessions = effectiveSessions();

  const LABELS = {
    kcal: 'Daily calories', protein: 'Daily protein', fat: 'Daily fat',
    carbs: 'Daily carbs', saturdayKcal: 'Saturday calories', saturdayProtein: 'Saturday protein',
  };

  for (const [field, value] of Object.entries(doc.targets || {})) {
    if (targets[field] === value) continue;
    changes.push({ kind: 'change', text: `${LABELS[field]}: ${targets[field]} to ${value}` });
  }

  for (const [id, change] of Object.entries(doc.meals || {})) {
    const meal = meals.find((m) => m.id === id);
    const name = meal ? meal.name : id;
    if (change.reset === true) {
      changes.push({ kind: 'remove', text: `${name}: undo my edits, back to the default` });
      continue;
    }
    for (const [field, value] of Object.entries(change)) {
      if (field === 'reset') continue;
      const before = meal ? meal[field] : undefined;
      if (JSON.stringify(before) === JSON.stringify(value)) continue;
      if (field === 'ingredients' || field === 'steps') {
        changes.push({ kind: 'change', text: `${name}: replace ${field} (${describeValue(before || [])} to ${describeValue(value)})` });
      } else {
        changes.push({ kind: 'change', text: `${name} ${field}: ${describeValue(before)} to ${describeValue(value)}` });
      }
    }
  }

  for (const [sessionId, section] of Object.entries(doc.sessions || {})) {
    const session = sessions[sessionId];
    const sessionName = session ? session.name : sessionId;
    if (section.name !== undefined && section.name !== sessionName) {
      changes.push({ kind: 'change', text: `${sessionName}: rename to "${section.name}"` });
    }
    for (const [exerciseId, change] of Object.entries(section.exercises || {})) {
      const exercise = session ? session.exercises.find((e) => e.id === exerciseId) : null;
      const name = exercise ? exercise.name : (change.name || exerciseId);
      if (change.remove === true) {
        changes.push({ kind: 'remove', text: `${sessionName}: remove ${name}` });
        continue;
      }
      if (change.add === true) {
        changes.push({ kind: 'add', text: `${sessionName}: add ${change.name}, ${change.sets} x ${change.reps}` });
        continue;
      }
      if (change.reset === true) {
        changes.push({ kind: 'remove', text: `${sessionName}: ${name}, undo my edits` });
        continue;
      }
      for (const [field, value] of Object.entries(change)) {
        const before = exercise ? exercise[field] : undefined;
        if (JSON.stringify(before) === JSON.stringify(value)) continue;
        changes.push({ kind: 'change', text: `${sessionName}, ${name} ${field}: ${describeValue(before)} to ${describeValue(value)}` });
      }
    }
    if (Array.isArray(section.order) && session) {
      const current = session.exercises.map((e) => e.id).join(',');
      if (current !== section.order.join(',')) {
        changes.push({ kind: 'change', text: `${sessionName}: reorder the exercises` });
      }
    }
  }

  return changes;
}

// ---------------------------------------------------------------- apply

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function apply(doc) {
  const before = clone(getPatch());
  const patch = clone(getPatch());

  if (doc.targets) {
    const targets = patch.targets || (patch.targets = {});
    for (const [field, value] of Object.entries(doc.targets)) targets[field] = value;
  }

  if (doc.meals) {
    const meals = patch.meals || (patch.meals = {});
    const items = meals.items || (meals.items = {});
    for (const [id, change] of Object.entries(doc.meals)) {
      if (change.reset === true) { delete items[id]; continue; }
      const item = items[id] || (items[id] = {});
      for (const [field, value] of Object.entries(change)) {
        if (field === 'reset') continue;
        item[field] = value;
      }
    }
  }

  if (doc.sessions) {
    const sessions = patch.sessions || (patch.sessions = {});
    for (const [sessionId, section] of Object.entries(doc.sessions)) {
      const target = sessions[sessionId] || (sessions[sessionId] = {});
      if (section.name !== undefined) target.name = section.name;

      for (const [exerciseId, change] of Object.entries(section.exercises || {})) {
        if (change.remove === true) {
          const added = target.added || [];
          if (added.some((e) => e.id === exerciseId)) {
            target.added = added.filter((e) => e.id !== exerciseId);
          } else {
            const removed = new Set(target.removed || []);
            removed.add(exerciseId);
            target.removed = [...removed];
          }
          if (Array.isArray(target.order)) target.order = target.order.filter((id) => id !== exerciseId);
          continue;
        }
        if (change.add === true) {
          const added = target.added || (target.added = []);
          added.push({
            id: exerciseId, name: change.name, sets: change.sets,
            reps: change.reps, note: change.note || '',
          });
          if (Array.isArray(target.order)) target.order.push(exerciseId);
          continue;
        }
        if (change.reset === true) {
          if (target.items) delete target.items[exerciseId];
          if (Array.isArray(target.removed)) target.removed = target.removed.filter((id) => id !== exerciseId);
          continue;
        }
        const items = target.items || (target.items = {});
        const item = items[exerciseId] || (items[exerciseId] = {});
        for (const [field, value] of Object.entries(change)) item[field] = value;
      }

      if (Array.isArray(section.order)) target.order = section.order;
    }
  }

  setSetting('planPatchUndo', before);
  savePatch(patch);
}

export function canUndo() {
  return getSetting('planPatchUndo', null) !== null;
}

export function undo() {
  const previous = getSetting('planPatchUndo', null);
  if (previous === null) return false;
  savePatch(previous);
  setSetting('planPatchUndo', null);
  return true;
}
