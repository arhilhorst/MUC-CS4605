/* Trial sequences.
 *
 * The two angle sets are taken verbatim from Dobbelstein et al. (2016),
 * Study 1: participants were "first exposed to the different areas
 * following a defined sequence of angular directions (0, 30, 90, 150,
 * 180, -150, -90, -30) 2-3 times in a row until the participant stated
 * to be familiar", then "had to recognize area and angle of a second
 * set of angular directions one time each (0, 40, -40, 70, -70, 100,
 * -100, 140, -140, 180)". The sequence of the test trials was
 * counterbalanced; we shuffle from a seed derived from the participant
 * ID so the order is randomised but reproducible and logged. */

export const TRAINING_ANGLES = [0, 30, 90, 150, 180, -150, -90, -30];
export const TEST_ANGLES     = [0, 40, -40, 70, -70, 100, -100, 140, -140, 180];

/* One angle well inside each of the six sectors — a six-trial smoke
 * test for checking the band is mapped correctly before a session. */
export const SWEEP_ANGLES = [0, 60, 120, 180, -120, -60];

/* Sector boundaries plus/minus 5 degrees. Not in the paper; a pilot
 * diagnostic for where participants actually switch their judgement. */
export const BOUNDARY_ANGLES = [
  -35, -25, 25, 35, 85, 95, -85, -95, 145, 155, -145, -155,
];

export const SEQUENCES = {
  training: {
    label: 'Training — 8 angles, feedback shown',
    angles: TRAINING_ANGLES,
    defaultReps: 2,
    feedback: true,
    note: 'Repeat until the participant says they have the concept. The paper used 2–3 passes.',
  },
  test: {
    label: 'Test — 10 angles, no feedback',
    angles: TEST_ANGLES,
    defaultReps: 3,
    feedback: false,
    note: 'The replication block. The original ran 1 rep; the proposal commits to 3.',
  },
  sweep: {
    label: 'Sector sweep — 6 trials, smoke test',
    angles: SWEEP_ANGLES,
    defaultReps: 1,
    feedback: true,
    note: 'One angle per sector. Run this before every session to confirm the mapping.',
  },
  boundary: {
    label: 'Boundary probe — 12 angles, pilot only',
    angles: BOUNDARY_ANGLES,
    defaultReps: 1,
    feedback: false,
    note: 'Pilot diagnostic, not part of the replication. Analyse separately.',
  },
  custom: {
    label: 'Custom list',
    angles: [],
    defaultReps: 1,
    feedback: false,
    note: 'Comma-separated degrees in [-180, 180]. Logged as its own sequence type.',
  },
};

/* ---- reproducible shuffle ----------------------------------------- */

export function seedFrom(str) {
  let h = 2166136261;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}

function shuffled(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function parseCustom(text) {
  return String(text).split(/[,\s]+/)
    .map(s => parseFloat(s))
    .filter(n => Number.isFinite(n) && n >= -180 && n <= 180)
    .map(n => Math.round(n));
}

/* Each repetition is independently shuffled, so an angle never lands in
 * the same slot twice, and no angle repeats back-to-back across the
 * boundary between repetitions. */
export function buildSequence({ type, reps, seed, customText }) {
  const spec = SEQUENCES[type];
  if (!spec) throw new Error('unknown sequence: ' + type);
  const base = type === 'custom' ? parseCustom(customText) : spec.angles;
  if (!base.length) return [];

  const rand = rng(seed);
  const out = [];
  for (let r = 1; r <= Math.max(1, reps); r++) {
    let block = shuffled(base, rand);
    if (out.length && block[0] === out[out.length - 1].angle && block.length > 1) {
      [block[0], block[1]] = [block[1], block[0]];
    }
    block.forEach(angle => out.push({ angle, rep: r }));
  }
  return out;
}
