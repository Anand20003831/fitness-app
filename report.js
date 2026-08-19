// The Sunday report.
//
// The output format is not mine to invent: it reproduces what the builder in
// weekly-check-in.html emits, line for line, including its uneven spacing
// (three spaces before "last week", two before the bracketed change). That file
// is what Claude expects to receive, so this matches it rather than improving it.
//
// Everything that can be worked out from his data is filled in. Sleep, food and
// notes are drafted from the log but he edits them before copying, because they
// are the parts only he knows.

import { state, mondayOf, sundayOf, addDays, formatShort } from './store.js';
// The effective plan, not the file. If he has changed a meal or renamed an
// exercise, the report has to talk about what he is actually doing.
import { mealsForDay, exerciseNameFor } from './overlay.js';

const SESSIONS_PER_WEEK = 5;

function weekDays(mondayKey) {
  const days = [];
  for (let i = 0; i < 7; i += 1) days.push(addDays(mondayKey, i));
  return days;
}

function weightsIn(keys) {
  return keys
    .map((k) => state.days[k] && state.days[k].weight)
    .filter((w) => typeof w === 'number' && Number.isFinite(w));
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// "Sun 21 September", matching the placeholder in the check-in form.
function weekEndingLabel(sundayKey) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(new Date(sundayKey + 'T12:00:00Z'));
}

// ---------------------------------------------------------------- sleep

function minutesFromTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function describeSleep(keys) {
  const bedMinutes = [];
  const durations = [];
  for (const key of keys) {
    const day = state.days[key];
    if (!day) continue;
    const bed = minutesFromTime(day.bedTime);
    const wake = minutesFromTime(day.wakeTime);
    if (bed != null) {
      // An 02:30 bedtime is "late last night", not "early this morning". Shift
      // small-hours values past midnight so averaging them means something.
      bedMinutes.push(bed < 12 * 60 ? bed + 24 * 60 : bed);
    }
    if (bed != null && wake != null) {
      let length = wake - bed;
      if (length <= 0) length += 24 * 60;
      durations.push(length);
    }
  }
  if (!bedMinutes.length) return '';

  const avgBed = Math.round(mean(bedMinutes)) % (24 * 60);
  const hh = String(Math.floor(avgBed / 60)).padStart(2, '0');
  const mm = String(avgBed % 60).padStart(2, '0');
  let text = `in bed around ${hh}:${mm}`;
  if (durations.length) {
    const avg = Math.round(mean(durations));
    text += `, about ${Math.floor(avg / 60)}h ${String(avg % 60).padStart(2, '0')}m a night`;
  }
  text += ` (${bedMinutes.length} night${bedMinutes.length === 1 ? '' : 's'} logged)`;
  return text;
}

// ---------------------------------------------------------------- food

function describeFood(keys) {
  let hit = 0;
  let logged = 0;
  for (const key of keys) {
    const day = state.days[key];
    if (!day || !day.meals) continue;
    const required = mealsForDay(new Date(key + 'T12:00:00Z').getUTCDay());
    const ticked = required.filter((meal) => day.meals[meal.id]).length;
    if (ticked > 0) logged += 1;
    if (ticked === required.length) hit += 1;
  }
  if (!logged) return '';
  return `${hit}/7`;
}

// ---------------------------------------------------------------- lifts

function bestSet(sets) {
  let best = null;
  for (const set of sets) {
    if (!set || !set.done) continue;
    const reps = Number(set.reps);
    if (!Number.isFinite(reps) || reps <= 0) continue;
    const kg = set.kg === '' || set.kg == null ? 0 : Number(set.kg);
    if (!best || kg > best.kg || (kg === best.kg && reps > best.reps)) best = { kg, reps };
  }
  return best;
}

const exerciseName = exerciseNameFor;

// Compares the best set of each exercise this week against the last time it
// appeared before this week. Heavier wins; same weight for more reps counts too,
// because that is how the progression in the plan actually works.
function liftsThatWentUp(keys) {
  const inWeek = new Set(keys);
  const allDates = Object.keys(state.workouts).sort();
  const thisWeek = new Map();

  for (const date of allDates) {
    if (!inWeek.has(date)) continue;
    const sets = state.workouts[date].sets || {};
    for (const [id, rows] of Object.entries(sets)) {
      const best = bestSet(rows);
      if (!best) continue;
      const current = thisWeek.get(id);
      if (!current || best.kg > current.kg || (best.kg === current.kg && best.reps > current.reps)) {
        thisWeek.set(id, best);
      }
    }
  }

  const lines = [];
  for (const [id, best] of thisWeek) {
    let previous = null;
    for (const date of allDates) {
      if (inWeek.has(date) || date > keys[0]) continue;
      const rows = state.workouts[date].sets && state.workouts[date].sets[id];
      if (!Array.isArray(rows)) continue;
      const candidate = bestSet(rows);
      if (candidate) previous = candidate;
    }
    if (!previous) continue;

    // Not indented: the check-in builder trims whatever is typed into the lifts
    // and notes boxes, so unindented content is what it would have produced.
    const label = exerciseName(id);
    if (best.kg > previous.kg) {
      lines.push(`${label} ${previous.kg || 'BW'}kg to ${best.kg}kg`);
    } else if (best.kg === previous.kg && best.reps > previous.reps) {
      const weight = best.kg ? `${best.kg}kg ` : '';
      lines.push(`${label} ${weight}${previous.reps} reps to ${best.reps}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- gather

export function gather(todayKey) {
  const monday = mondayOf(todayKey);
  const sunday = sundayOf(todayKey);
  const keys = weekDays(monday);

  const previousMonday = addDays(monday, -7);
  const previousKeys = weekDays(previousMonday);

  const weights = weightsIn(keys);
  const average = mean(weights);
  const lastAverage = mean(weightsIn(previousKeys));

  const measureIn = (range, field) => {
    let found = null;
    for (const key of range) {
      const measure = state.measures[key];
      if (measure && measure[field] != null) found = measure[field];
    }
    return found;
  };

  const sessions = keys.filter((key) => {
    const workout = state.workouts[key];
    if (!workout || !workout.sets) return false;
    return Object.values(workout.sets).some((rows) => Array.isArray(rows) && rows.some((s) => s && s.done));
  }).length;

  const walkjogs = keys.filter((key) => state.days[key] && state.days[key].walkjog).length;

  const notes = keys
    .map((key) => {
      const note = state.days[key] && state.days[key].notes;
      return note ? `${formatShort(key)}: ${note}` : null;
    })
    .filter(Boolean);

  return {
    weekEnding: weekEndingLabel(sunday),
    weights,
    average,
    lastAverage,
    waist: measureIn(keys, 'waist'),
    lastWaist: measureIn(previousKeys, 'waist'),
    shoulders: measureIn(keys, 'shoulders'),
    sessions,
    walkjogs,
    sleep: describeSleep(keys),
    food: describeFood(keys),
    lifts: liftsThatWentUp(keys),
    notes,
  };
}

// ---------------------------------------------------------------- build
//
// Field for field and space for space, this is weekly-check-in.html's builder.

export function build(data) {
  const lines = [];

  lines.push('WEEK ENDING: ' + (data.weekEnding || 'not given'));
  lines.push('');
  lines.push('Daily weights: ' + (data.weights.length ? data.weights.join(', ') + ' kg' : 'not given'));

  let averageLine = 'Weekly average: ' + (data.average !== null ? data.average.toFixed(2) + ' kg' : 'not given');
  if (data.lastAverage !== null && data.lastAverage !== undefined && !Number.isNaN(data.lastAverage)) {
    averageLine += '   last week: ' + data.lastAverage.toFixed(2) + ' kg';
    if (data.average !== null) {
      const delta = data.average - data.lastAverage;
      averageLine += '  (change: ' + (delta > 0 ? '+' : '') + delta.toFixed(2) + ' kg)';
    }
  }
  lines.push(averageLine);

  lines.push('Waist: ' + (data.waist != null
    ? data.waist + ' cm' + (data.lastWaist != null ? '  (last week: ' + data.lastWaist + ' cm)' : '')
    : 'not measured'));

  if (data.shoulders != null && data.shoulders !== '') {
    lines.push('Shoulders: ' + data.shoulders + ' cm');
  }

  lines.push('');
  lines.push('Sessions done: ' + (data.sessions || data.sessions === 0 ? data.sessions : '?') + ' of ' + SESSIONS_PER_WEEK);
  lines.push('Walk-jogs: ' + (data.walkjogs || data.walkjogs === 0 ? data.walkjogs : '?'));
  lines.push('Sleep: ' + (data.sleep || 'not given'));
  lines.push('Food: ' + (data.food || 'not given'));
  lines.push('');
  lines.push('Lifts that went up:');
  lines.push(data.lifts.length ? data.lifts.join('\n') : '  none noted');
  lines.push('');
  lines.push('Notes:');
  lines.push(data.notes.length ? data.notes.join('\n') : '  nothing to report');

  return lines.join('\n');
}

export function draft(todayKey) {
  return build(gather(todayKey));
}
