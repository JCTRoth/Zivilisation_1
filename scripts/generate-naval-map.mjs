#!/usr/bin/env node
/**
 * Generate the static archipelago map used by the "Computer vs Computer ·
 * Naval (Archipelago)" scenario.
 *
 * Usage:
 *   node scripts/generate-naval-map.mjs [output-id]
 *
 * Why a static file: a naval AI game lives or dies on its islands. Procedural
 * generation can hand two civs the same continent (or split one civ's cities
 * across two), and a game where nobody can reach anybody is a 400-round
 * stalemate. A hand-tuned archipelago guarantees:
 *
 *   - every civ starts on its OWN island, so expansion and war need a fleet;
 *   - the islands are big enough to found several cities on;
 *   - the channels are wide enough that a ferry is required, never a swimmer.
 *
 * Output keeps the raw Freeciv characters the game expects (see
 * `src/data/maps/types.ts`): ' ' ocean, a arctic, t tundra, d desert,
 * p plains, g grassland, f forest, j jungle, s swamp, h hills, m mountains.
 * '2' in the specials layer marks a bonus resource.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/maps');
const MAP_ID = process.argv[2] ?? 'naval-archipelago-96x60';

const WIDTH = 96;
const HEIGHT = 60;

/** Deterministic PRNG so the map is byte-identical on every regeneration. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0x5eaf00d);

/**
 * The archipelago: 8 islands, hand-placed centres with a radius, so the
 * layout is deliberate rather than a lucky roll. Each entry becomes one
 * landmass, and each gets a start position on its coast.
 */
const ISLANDS = [
  // col, row, radius — spread over the whole map, no two neighbours touching.
  { col: 12, row: 12, r: 7 },   // north-west
  { col: 48, row: 9, r: 5 },    // north-centre
  { col: 82, row: 14, r: 8 },   // north-east
  { col: 20, row: 30, r: 6 },   // west
  { col: 47, row: 29, r: 8 },   // centre  (the prize)
  { col: 76, row: 31, r: 6 },   // east
  { col: 30, row: 49, r: 7 },   // south-west
  { col: 66, row: 50, r: 7 },   // south-east
];

/** Terrain by distance from an island's centre: coasts are beaches/hills, the interior green. */
function terrainFor(distance, radius, r) {
  const t = distance / radius; // 0 centre … 1 coast
  if (t > 0.94) return ' ';              // water gap between islands
  if (t > 0.84) return r() < 0.5 ? 'd' : 'g'; // sandy/grass coast
  if (t > 0.72) return 'h';              // hills ring
  if (t > 0.60) return r() < 0.18 ? 'f' : 'g';
  if (t > 0.40) return r() < 0.12 ? 'j' : r() < 0.30 ? 'g' : 'p';
  if (t > 0.22) return r() < 0.10 ? 'f' : r() < 0.25 ? 'h' : 'g';
  if (t > 0.10) return r() < 0.20 ? 'm' : r() < 0.45 ? 'h' : 'g';
  return r() < 0.25 ? 'm' : r() < 0.50 ? 'h' : 'g'; // mountainous core
}

/**
 * Polar rows stay OPEN WATER. An ice cap spanning the full width is one
 * enormous landmass, and it would weld the top and bottom of the map into a
 * ring that every island could walk to — which is the opposite of a naval
 * game. (The first draft of this map did exactly that: 10 landmasses instead
 * of 8, the extra two being the polar bands.)
 */
function polarFor(row) {
  return row <= 2 || row >= HEIGHT - 3 ? ' ' : null;
}

const rows = [];
const specials = [];
for (let row = 0; row < HEIGHT; row++) {
  let line = '';
  let specLine = '';
  for (let col = 0; col < WIDTH; col++) {
    const polar = polarFor(row);
    if (polar) {
      line += polar;
      specLine += '0';
      continue;
    }
    // Distance to the nearest island centre, with a little noise on the edge
    // so the coastlines are ragged instead of circular.
    let best = Infinity;
    for (const isle of ISLANDS) {
      const dx = col - isle.col;
      const dy = (row - isle.row) * 1.35; // islands are wider than tall
      const wobble = isle.r * 0.16 * Math.sin(Math.atan2(dy, dx) * 3 + isle.col);
      best = Math.min(best, Math.hypot(dx, dy) - wobble);
    }
    const nearest = ISLANDS.reduce((acc, isle) => {
      const d = Math.hypot(col - isle.col, (row - isle.row) * 1.35);
      return d < acc.d ? { isle, d } : acc;
    }, { isle: ISLANDS[0], d: Infinity });
    const terrain = best < nearest.isle.r ? terrainFor(best, nearest.isle.r, rng) : ' ';
    line += terrain;
    // Bonus resources on grass/plains, never on water or mountains.
    specLine += terrain !== ' ' && terrain !== 'm' && rng() < 0.09 ? '2' : '0';
  }
  rows.push(line);
  specials.push(specLine);
}

/** A passable, coastal-ish start tile per island (grass/plains, not ocean/mountains). */
const startPositions = [];
for (const isle of ISLANDS) {
  let spot = null;
  for (let attempt = 0; attempt < 400 && !spot; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = isle.r * (0.35 + rng() * 0.4);
    const col = Math.round(isle.col + Math.cos(angle) * dist);
    const row = Math.round(isle.row + Math.sin(angle) * dist * 0.75);
    if (row < 4 || row >= HEIGHT - 4 || col < 2 || col >= WIDTH - 2) continue;
    const terrain = rows[row][col];
    if (terrain === ' ' || terrain === 'm' || terrain === 'a') continue;
    spot = { col, row };
  }
  if (spot) startPositions.push(spot);
}

// ── Verify the archipelago is actually naval ───────────────────────────────
const land = (col, row) => {
  const ch = rows[row]?.[col] ?? ' ';
  return ch !== ' ';
};

/** Cardinal landmasses, the same notion the engine uses. */
function landmasses() {
  const seen = new Set();
  const out = [];
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      if (!land(col, row) || seen.has(`${col},${row}`)) continue;
      const comp = [];
      const queue = [[col, row]];
      seen.add(`${col},${row}`);
      while (queue.length) {
        const [c, r] = queue.pop();
        comp.push([c, r]);
        for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) continue;
          if (land(nc, nr) && !seen.has(`${nc},${nr}`)) {
            seen.add(`${nc},${nr}`);
            queue.push([nc, nr]);
          }
        }
      }
      out.push(comp);
    }
  }
  return out;
}

const comps = landmasses();
const bigEnough = comps.filter((c) => c.length >= 40);
const errors = [];
if (comps.length !== ISLANDS.length) {
  errors.push(`expected ${ISLANDS.length} landmasses, got ${comps.length} (sizes ${comps.map((c) => c.length).join('/')})`);
}
if (bigEnough.length < 5) {
  errors.push(`only ${bigEnough.length} islands with >= 40 tiles — too small to found cities on`);
}
if (startPositions.length < 4) {
  errors.push(`only ${startPositions.length} usable start positions`);
}

const map = {
  id: MAP_ID,
  name: 'Naval Archipelago',
  source: 'generated by scripts/generate-naval-map.mjs (do not edit by hand)',
  width: WIDTH,
  height: HEIGHT,
  rows,
  specials,
  startPositions,
};

const landTiles = rows.join('').split('').filter((c) => c !== ' ').length;
console.log(`landmasses: ${comps.length} (sizes ${comps.map((c) => c.length).sort((a, b) => b - a).join('/')})`);
console.log(`land tiles: ${landTiles} / ${WIDTH * HEIGHT} (${Math.round((100 * landTiles) / (WIDTH * HEIGHT))}%)`);
console.log(`start positions: ${startPositions.length}`);

if (errors.length > 0) {
  console.error('\nMAP REJECTED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

writeFileSync(resolve(OUT_DIR, `${MAP_ID}.json`), `${JSON.stringify(map, null, 1)}\n`);
console.log(`\nwrote src/data/maps/${MAP_ID}.json`);
