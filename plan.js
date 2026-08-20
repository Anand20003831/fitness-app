// The whole plan lives in this file.
// Change a meal, a target, an exercise or a rest time here and the app follows.
// Nothing else needs editing.
//
// This repo is public. Everything in this file comes off the plan. Nothing in
// it came off him: no body weight, no measurements, no age, no name. Those
// live in data.json in the private repo and the app reads them from there.

export const TARGETS = {
  kcal: 2034, protein: 176, fat: 50, carbs: 215,
  saturdayKcal: 2429, saturdayProtein: 184,
};

export const MEALS = [
  {
    id: 'breakfast', name: 'Breakfast', kcal: 591, protein: 43,
    ingredients: [
      '1 slice wholemeal bread',
      '25 g peanut butter, weighed',
      '1 scoop whey (30 g)',
      '250 ml semi-skimmed milk',
      '1 banana',
      '5 g creatine',
    ],
    steps: [
      'Toast the bread. Weigh 25 g of peanut butter onto it, do not eyeball it.',
      'Into the blender: whey, milk, banana, creatine, a handful of ice.',
      'Blend 30 seconds until there are no lumps.',
      'Drink it with the toast.',
    ],
  },
  {
    id: 'lunch', name: 'Lunch, soya chunk curry', kcal: 437, protein: 44,
    ingredients: [
      '75 g dry soya chunks',
      '1 tsp oil',
      '1 onion, 1 tomato, garlic, ginger',
      'Turmeric, chilli, cumin, garam masala, salt',
      '60 g cooked rice',
    ],
    steps: [
      'Pour boiling water over the soya chunks and leave 10 minutes until soft.',
      'Drain, then squeeze each handful hard to get the water out. Skipping this makes them soggy and is the reason people think they dislike soya chunks.',
      'Fry onion in 1 tsp oil until golden. Add garlic and ginger, then tomato and the dry spices. Cook until it looks like paste.',
      'Add the squeezed chunks, a splash of water, simmer 8 minutes.',
      'Portion with 60 g cooked rice into a container.',
      'Batch cook: multiply by five on Sunday, it keeps all week.',
    ],
  },
  {
    id: 'afternoon', name: 'Afternoon bowl', kcal: 268, protein: 45,
    ingredients: ['200 g 0% Greek yoghurt', '1 scoop whey (30 g)', '100 g strawberries'],
    steps: [
      'Stir the whey through the yoghurt until smooth. Add a splash of water if it stiffens up.',
      'Top with strawberries.',
      'No seeds, they are not needed.',
    ],
  },
  {
    id: 'dinner', name: 'Dinner, family food', kcal: 738, protein: 44,
    ingredients: [
      '2 chapati',
      '2 ladles dal (~400 g cooked)',
      'Large salad, 2 tsp dressing',
      '200 g Greek yoghurt as raita, cucumber, cumin, salt',
    ],
    steps: [
      'Two chapati. Not three.',
      'Serve your own plate before extra ghee goes on the roti.',
      'Grate cucumber into the yoghurt with cumin and salt for the raita.',
      'Eat the salad first, it takes the edge off before the carbs.',
    ],
  },
];

export const SESSIONS = {
  upperA: { name: 'Upper A, chest and shoulders', minutes: 55, exercises: [
    { id: 'chest-press', name: 'Chest press machine', sets: 4, reps: '8-12', note: 'Handles at mid-chest. Do not lock out.' },
    { id: 'db-ohp', name: 'Seated dumbbell shoulder press', sets: 4, reps: '8-12', note: 'Elbows slightly in front, not flared wide.' },
    { id: 'pulldown-narrow', name: 'Lat pulldown, shoulder-width', sets: 4, reps: '8-12', note: 'To the collarbone, never behind the neck.' },
    { id: 'fly', name: 'Chest fly machine', sets: 3, reps: '12-15', note: 'Fixed elbow bend, squeeze at the front.' },
    { id: 'lateral', name: 'Dumbbell lateral raise', sets: 4, reps: '12-20', note: 'Light. Lead with elbows, stop at shoulder height.' },
    { id: 'tri-ext', name: 'Overhead triceps extension', sets: 3, reps: '10-12', note: 'One dumbbell, both hands, slow down.' },
  ]},
  lowerA: { name: 'Lower A', minutes: 50, exercises: [
    { id: 'goblet', name: 'Goblet squat', sets: 4, reps: '8-10', note: 'Sit between your feet, chest tall.' },
    { id: 'rdl', name: 'Dumbbell Romanian deadlift', sets: 3, reps: '10-12', note: 'Hips back, soft knees, stop when hamstrings scream.' },
    { id: 'bulgarian', name: 'Bulgarian split squat', sets: 3, reps: '8-10 each', note: 'Rear foot on the bench.' },
    { id: 'leg-ext', name: 'Leg extension', sets: 3, reps: '12-15', note: 'One second pause at the top.' },
    { id: 'lateral', name: 'Dumbbell lateral raise', sets: 3, reps: '15-20', note: 'Yes, on leg day. Delts recover fast.' },
    { id: 'plank', name: 'Plank', sets: 3, reps: '40s', note: 'Glutes squeezed, hips level.' },
  ]},
  shirt: { name: 'The shirt session', minutes: 35, exercises: [
    { id: 'lateral', name: 'Dumbbell lateral raise', sets: 4, reps: '12-20', note: 'Fresh for once. Rest 60s throughout this session.' },
    { id: 'pulldown-wide', name: 'Lat pulldown, wide grip', sets: 4, reps: '10-12', note: 'Width. Makes the waist look smaller without changing it.' },
    { id: 'cs-row', name: 'Chest-supported dumbbell row', sets: 4, reps: '10-12', note: 'Face down on an incline bench.' },
    { id: 'rear-delt', name: 'Rear delt fly', sets: 3, reps: '15-20', note: 'Bent over, light.' },
    { id: 'db-curl', name: 'Dumbbell curl', sets: 3, reps: '10-12', note: 'Elbows pinned. No swinging.' },
    { id: 'skull', name: 'Skullcrusher', sets: 3, reps: '12-15', note: 'To the forehead, not the chin.' },
  ]},
  upperB: { name: 'Upper B, back and arms', minutes: 55, exercises: [
    { id: 'pulldown-wide', name: 'Lat pulldown, wide grip', sets: 4, reps: '8-12', note: 'Heavier than Wednesday.' },
    { id: 'incline-press', name: 'Incline dumbbell press', sets: 4, reps: '8-12', note: 'Bench at 30 degrees, no higher.' },
    { id: 'db-row', name: 'One-arm dumbbell row', sets: 4, reps: '10-12 each', note: 'Pull to the hip, not the armpit.' },
    { id: 'lateral', name: 'Dumbbell lateral raise', sets: 4, reps: '12-20', note: 'Nineteen sets a week is deliberate.' },
    { id: 'pullover', name: 'Dumbbell pullover', sets: 3, reps: '12-15', note: 'Across the bench, big stretch on the lats.' },
    { id: 'hammer', name: 'Hammer curl', sets: 3, reps: '10-12', note: 'Palms facing each other.' },
  ]},
  lowerB: { name: 'Lower B', minutes: 50, exercises: [
    { id: 'rdl', name: 'Dumbbell Romanian deadlift', sets: 4, reps: '8-10', note: 'Heavier than Tuesday.' },
    { id: 'rev-lunge', name: 'Dumbbell reverse lunge', sets: 3, reps: '10 each', note: 'Step backwards. Kinder on the knees.' },
    { id: 'leg-ext', name: 'Leg extension', sets: 3, reps: '15-20', note: 'Chase the burn.' },
    { id: 'hip-thrust', name: 'Dumbbell hip thrust', sets: 3, reps: '12-15', note: 'Upper back on the bench, drive through heels.' },
    { id: 'lateral', name: 'Dumbbell lateral raise', sets: 3, reps: '15-20', note: 'Last one of the week.' },
    { id: 'leg-raise', name: 'Hanging or lying leg raise', sets: 3, reps: '10-12', note: 'Control the way down.' },
  ]},
};

// 0 = Sunday
export const WEEK = { 1: 'upperA', 2: 'lowerA', 3: 'shirt', 4: 'upperB', 5: 'lowerB', 6: null, 0: null };

export const SHOPPING = [
  ['Semi-skimmed milk', '2 litres'],
  ['0% Greek yoghurt', '2.8 kg in big tubs, never pots'],
  ['Dry soya chunks', '525 g'],
  ['Bananas', '7-8'],
  ['Strawberries', '700 g, frozen is fine'],
  ['Wholemeal bread', '1 loaf'],
  ['Peanut butter', '1 jar per 3 weeks'],
  ['Rice', '150 g dry'],
  ['Salad veg, onion, tomato, cucumber', 'lots'],
  ['Whey protein', '14 scoops'],
  ['Creatine monohydrate', '35 g'],
];

// Saturday is a higher day: TARGETS.saturdayKcal and saturdayProtein instead
// of the weekday pair. The extras are a real fifth meal with real figures, so
// the day adds up the same way every other day does.
// 2034 + 395 = 2429 kcal. 176 + 8 = 184 g protein.
export const SATURDAY_MEAL = {
  id: 'extras', name: 'Saturday extras', kcal: 395, protein: 8,
  ingredients: [
    '150 g cooked rice, 195 kcal, 3 g protein',
    '1 slice wholemeal bread, 95 kcal, 4 g protein',
    '1 banana, 105 kcal, 1 g protein',
  ],
  steps: [
    'The extra rice goes in the lunch box.',
    'The extra slice of bread goes with breakfast.',
    'The banana whenever it suits.',
    'Not a cheat day and not a write-off, just a higher day. Six days hard and one easier beats seven days of grinding.',
  ],
};

// Saturday is day 6.
export function mealsForDay(dayOfWeek) {
  return dayOfWeek === 6 ? [...MEALS, SATURDAY_MEAL] : MEALS;
}

export function targetsForDay(dayOfWeek) {
  return dayOfWeek === 6
    ? { kcal: TARGETS.saturdayKcal, protein: TARGETS.saturdayProtein }
    : { kcal: TARGETS.kcal, protein: TARGETS.protein };
}

// Rest timer, seconds. The plan says two to three minutes on the first two
// exercises of a session and sixty to ninety on the rest. The shirt session
// says sixty throughout, so it overrides.
export const REST = {
  firstTwo: 150,
  rest: 75,
  bySession: { shirt: 60 },
};

// The end of the block. This is a date off the plan, not a fact about him.
// startWeight deliberately has no default here. It is seeded into data.json in
// the private repo, and if it is missing the app asks for it rather than
// carrying his weight around in a public file.
export const GOAL_DATE = '2026-09-25';
