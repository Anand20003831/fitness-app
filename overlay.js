// The effective plan: plan.js with his edits layered on top at read time.
//
// The whole design rests on one rule. The patch stores ONLY the fields he has
// actually changed, keyed by id. Everything he has not touched is read live
// from plan.js, so improving a coaching note or fixing a calorie figure
// upstream reaches him, while an exercise he has rewritten keeps his version.
// Nothing is ever copied wholesale into the patch, because a copy is a freeze.
//
// Shape, all parts optional:
//
//   settings.planPatch = {
//     targets: { kcal: 2100 },
//     meals:    { items: { breakfast: { kcal: 620 } },
//                 order: [...], removed: [...], added: [ {id, name, ...} ] },
//     sessions: { upperA: { name: "...",
//                 items: { 'chest-press': { sets: 5 } },
//                 order: [...], removed: [...], added: [ {id, name, ...} ] } },
//   }

import {
  TARGETS, MEALS, SESSIONS, SATURDAY_MEAL, WEEK, SHOPPING, GOAL_DATE,
} from './plan.js';
import { getSetting, setSetting } from './store.js';

export { WEEK, SHOPPING, GOAL_DATE };

const MEAL_FIELDS = ['name', 'kcal', 'protein', 'ingredients', 'steps'];
const EXERCISE_FIELDS = ['name', 'sets', 'reps', 'note'];

// Saturday's extras are just another meal that happens to be Saturday only,
// which means they are editable by the same code as the other four.
const BASE_MEALS = [...MEALS, { ...SATURDAY_MEAL, saturdayOnly: true }];

export function getPatch() {
  const patch = getSetting('planPatch', null);
  return patch && typeof patch === 'object' ? patch : {};
}

export function savePatch(patch) {
  const empty = !patch || Object.keys(patch).length === 0;
  setSetting('planPatch', empty ? null : patch);
}

// ---------------------------------------------------------------- reading

export function effectiveTargets() {
  return { ...TARGETS, ...(getPatch().targets || {}) };
}

function overlayItem(base, override, allowed) {
  if (!override) return base;
  const out = { ...base };
  for (const field of allowed) {
    if (Object.prototype.hasOwnProperty.call(override, field)) out[field] = override[field];
  }
  return out;
}

function assemble(baseList, section, allowed) {
  const removed = new Set(section.removed || []);
  const items = section.items || {};

  const kept = baseList
    .filter((entry) => !removed.has(entry.id))
    .map((entry) => overlayItem(entry, items[entry.id], allowed));

  const added = (section.added || [])
    .filter((entry) => entry && entry.id && !removed.has(entry.id))
    .map((entry) => ({ ...entry, isCustom: true }));

  const all = [...kept, ...added];
  if (!Array.isArray(section.order) || !section.order.length) return all;

  // Ordered ids first, then anything the order does not mention. That last part
  // is what lets a newly added upstream exercise still show up rather than
  // being silently dropped because an old order array never heard of it.
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const ordered = section.order.map((id) => byId.get(id)).filter(Boolean);
  const seen = new Set(ordered.map((entry) => entry.id));
  return [...ordered, ...all.filter((entry) => !seen.has(entry.id))];
}

export function effectiveMeals() {
  return assemble(BASE_MEALS, getPatch().meals || {}, MEAL_FIELDS);
}

export function mealsForDay(dayOfWeek) {
  return effectiveMeals().filter((meal) => (dayOfWeek === 6 ? true : !meal.saturdayOnly));
}

export function targetsForDay(dayOfWeek) {
  const targets = effectiveTargets();
  return dayOfWeek === 6
    ? { kcal: targets.saturdayKcal, protein: targets.saturdayProtein }
    : { kcal: targets.kcal, protein: targets.protein };
}

export function effectiveSessions() {
  const patch = getPatch().sessions || {};
  const out = {};
  for (const [id, session] of Object.entries(SESSIONS)) {
    const section = patch[id] || {};
    out[id] = {
      ...session,
      name: section.name != null ? section.name : session.name,
      exercises: assemble(session.exercises, section, EXERCISE_FIELDS),
    };
  }
  return out;
}

export function effectiveSession(id) {
  return effectiveSessions()[id] || null;
}

// Used by the report and anywhere else that needs a name from an id.
export function exerciseNameFor(id) {
  for (const session of Object.values(effectiveSessions())) {
    const found = session.exercises.find((e) => e.id === id);
    if (found) return found.name;
  }
  return id;
}

// ---------------------------------------------------------------- markers

export function targetOverridden(field) {
  const targets = getPatch().targets;
  return Boolean(targets && Object.prototype.hasOwnProperty.call(targets, field));
}

export function mealOverrides(id) {
  const items = (getPatch().meals || {}).items || {};
  return items[id] ? Object.keys(items[id]) : [];
}

export function exerciseOverrides(sessionId, exerciseId) {
  const section = (getPatch().sessions || {})[sessionId] || {};
  const items = section.items || {};
  return items[exerciseId] ? Object.keys(items[exerciseId]) : [];
}

export function sessionStructureChanged(sessionId) {
  const section = (getPatch().sessions || {})[sessionId] || {};
  return Boolean(
    (section.order && section.order.length) ||
    (section.removed && section.removed.length) ||
    (section.added && section.added.length) ||
    section.name != null,
  );
}

export function anyOverrides() {
  const patch = getPatch();
  if (patch.targets && Object.keys(patch.targets).length) return true;
  const meals = patch.meals || {};
  if ((meals.items && Object.keys(meals.items).length) || meals.order || meals.removed || meals.added) return true;
  for (const section of Object.values(patch.sessions || {})) {
    if (section.name != null) return true;
    if (section.items && Object.keys(section.items).length) return true;
    if (section.order || section.removed || section.added) return true;
  }
  return false;
}

// ---------------------------------------------------------------- writing
//
// Every writer prunes itself back to nothing when the last override goes, so an
// untouched plan leaves no trace in data.json and cannot drift out of step with
// plan.js later.

function prune(patch) {
  if (patch.targets && !Object.keys(patch.targets).length) delete patch.targets;

  if (patch.meals) {
    const meals = patch.meals;
    if (meals.items && !Object.keys(meals.items).length) delete meals.items;
    for (const key of ['order', 'removed', 'added']) {
      if (Array.isArray(meals[key]) && !meals[key].length) delete meals[key];
    }
    if (!Object.keys(meals).length) delete patch.meals;
  }

  if (patch.sessions) {
    for (const [id, section] of Object.entries(patch.sessions)) {
      if (section.items && !Object.keys(section.items).length) delete section.items;
      for (const key of ['order', 'removed', 'added']) {
        if (Array.isArray(section[key]) && !section[key].length) delete section[key];
      }
      if (section.name == null) delete section.name;
      if (!Object.keys(section).length) delete patch.sessions[id];
    }
    if (!Object.keys(patch.sessions).length) delete patch.sessions;
  }
  return patch;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function setTarget(field, value) {
  const patch = clone(getPatch());
  const targets = patch.targets || (patch.targets = {});
  if (value == null || value === '' || value === TARGETS[field]) delete targets[field];
  else targets[field] = value;
  savePatch(prune(patch));
}

export function setMealField(id, field, value) {
  const patch = clone(getPatch());
  const meals = patch.meals || (patch.meals = {});
  const items = meals.items || (meals.items = {});
  const base = BASE_MEALS.find((m) => m.id === id);
  const item = items[id] || (items[id] = {});

  // Writing a value identical to plan.js is not an override, it is a no-op.
  // Storing it anyway would freeze that field against future upstream changes.
  const same = base && JSON.stringify(base[field]) === JSON.stringify(value);
  if (value == null || same) delete item[field];
  else item[field] = value;

  if (!Object.keys(item).length) delete items[id];
  savePatch(prune(patch));
}

export function resetMeal(id) {
  const patch = clone(getPatch());
  const items = (patch.meals || {}).items || {};
  delete items[id];
  savePatch(prune(patch));
}

export function setExerciseField(sessionId, exerciseId, field, value) {
  const patch = clone(getPatch());
  const sessions = patch.sessions || (patch.sessions = {});
  const section = sessions[sessionId] || (sessions[sessionId] = {});
  const items = section.items || (section.items = {});
  const base = (SESSIONS[sessionId] ? SESSIONS[sessionId].exercises : []).find((e) => e.id === exerciseId);
  const item = items[exerciseId] || (items[exerciseId] = {});

  const same = base && JSON.stringify(base[field]) === JSON.stringify(value);
  if (value == null || same) delete item[field];
  else item[field] = value;

  if (!Object.keys(item).length) delete items[exerciseId];
  savePatch(prune(patch));
}

export function resetExercise(sessionId, exerciseId) {
  const patch = clone(getPatch());
  const section = (patch.sessions || {})[sessionId] || {};
  if (section.items) delete section.items[exerciseId];
  if (Array.isArray(section.removed)) section.removed = section.removed.filter((id) => id !== exerciseId);
  savePatch(prune(patch));
}

export function removeExercise(sessionId, exerciseId) {
  const patch = clone(getPatch());
  const sessions = patch.sessions || (patch.sessions = {});
  const section = sessions[sessionId] || (sessions[sessionId] = {});
  const custom = (section.added || []).some((e) => e.id === exerciseId);
  if (custom) {
    section.added = section.added.filter((e) => e.id !== exerciseId);
  } else {
    const removed = new Set(section.removed || []);
    removed.add(exerciseId);
    section.removed = [...removed];
  }
  if (Array.isArray(section.order)) section.order = section.order.filter((id) => id !== exerciseId);
  savePatch(prune(patch));
}

export function addExercise(sessionId, exercise) {
  const patch = clone(getPatch());
  const sessions = patch.sessions || (patch.sessions = {});
  const section = sessions[sessionId] || (sessions[sessionId] = {});
  const added = section.added || (section.added = []);
  added.push(exercise);
  if (Array.isArray(section.order)) section.order.push(exercise.id);
  savePatch(prune(patch));
}

export function moveExercise(sessionId, exerciseId, delta) {
  const patch = clone(getPatch());
  const sessions = patch.sessions || (patch.sessions = {});
  const section = sessions[sessionId] || (sessions[sessionId] = {});
  const current = effectiveSession(sessionId).exercises.map((e) => e.id);
  const at = current.indexOf(exerciseId);
  const to = at + delta;
  if (at === -1 || to < 0 || to >= current.length) return;
  current.splice(to, 0, current.splice(at, 1)[0]);
  section.order = current;
  savePatch(prune(patch));
}

export function resetSession(sessionId) {
  const patch = clone(getPatch());
  if (patch.sessions) delete patch.sessions[sessionId];
  savePatch(prune(patch));
}

export function resetEverything() {
  savePatch({});
}
