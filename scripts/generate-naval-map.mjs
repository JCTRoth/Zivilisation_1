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
  // Six bigger islands, not eight small ones. The first cut used 8 islands of
  // 52-133 tiles and it was unplayable: a civ that starts on a 52-tile rock
  // never gets past one city, never finishes Sailing and never fields a ship,
  // so no naval war could ever start. ~200 tiles each is enough to found a
  // small empire and pay for a ferry.
  { col: 14, row: 13, r: 11 },  // north-west
  { col: 50, row: 11, r: 9 },   // north-centre
  { col: 82, row: 15, r: 11 },  // north-east
  { col: 18, row: 34, r: 10 },  // west
  { col: 48, row: 33, r: 13 },  // centre  (the prize)
  { col: 79, row: 36, r: 10 },  // east
  { col: 33, row: 50, r: 9 },   // south-west
  { col: 65, row: 51, r: 9 },   // south-east
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

/**
 * A start tile per island that is passable AND coastal.
 *
 * Coastal is not a nicety: a civ whose first city cannot see water has
 * `civCanBuildShips() === false`, so it can never research into a fleet, never
 * colonise and never invade. The first cut of this map put 7 of 8 starts
 * inland and the whole naval game was dead on arrival.
 */
const startPositions = [];
const isWater = (col, row) => {
  const ch = rows[row]?.[col] ?? ' ';
  return ch === ' ';
};
for (const isle of ISLANDS) {
  let spot = null;
  let bestInland = null;
  for (let attempt = 0; attempt < 600 && !spot; attempt++) {
    const angle = rng() * Math.PI * 2;
    // Walk outwards so the search naturally finds the shoreline.
    const dist = isle.r * (0.55 + rng() * 0.45);
    const col = Math.round(isle.col + Math.cos(angle) * dist);
    const row = Math.round(isle.row + Math.sin(angle) * dist * 0.75);
    if (row < 4 || row >= HEIGHT - 4 || col < 2 || col >= WIDTH - 2) continue;
    const terrain = rows[row][col];
    if (terrain === ' ' || terrain === 'm' || terrain === 'a') continue;
    const candidate = { col, row };
    const coastal =
      [-1, 0, 1].some((dc) =>
        [-1, 0, 1].some((dr) => {
          if (dc === 0 && dr === 0) return false;
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) return false;
          return isWater(nc, nr);
        }),
      );
    if (coastal) {
      spot = candidate;
    } else if (!bestInland) {
      bestInland = candidate;
    }
  }
  // Fall back to an inland tile only if the island has no coast at all (a bug
  // in the island itself), and let the verification below catch it.
  startPositions.push(spot ?? bestInland);
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
const bigEnough = comps.filter((c) => c.length >= 120);
const errors = [];
if (comps.length !== ISLANDS.length) {
  errors.push(`expected ${ISLANDS.length} landmasses, got ${comps.length} (sizes ${comps.map((c) => c.length).join('/')})`);
}
if (bigEnough.length < 6) {
  errors.push(`only ${bigEnough.length} islands with >= 120 tiles — too small to fund a navy`);
}
if (Math.min(...comps.map((c) => c.length)) < 60) {
  errors.push(`smallest island is only ${Math.min(...comps.map((c) => c.length))} tiles`);
}
if (startPositions.length < 4) {
  errors.push(`only ${startPositions.length} usable start positions`);
}
for (const start of startPositions) {
  const coastal = [-1, 0, 1].some((dc) =>
    [-1, 0, 1].some((dr) => {
      if (dc === 0 && dr === 0) return false;
      const nc = start.col + dc;
      const nr = start.row + dr;
      if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) return false;
      return rows[nr][nc] === ' ';
    }),
  );
  if (!coastal) errors.push(`start ${start.col},${start.row} has no water next to it — that civ could never sail`);
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
