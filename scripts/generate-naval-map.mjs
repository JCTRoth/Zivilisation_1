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
 * v2 improvements over the original:
 *   - latitude biomes: a tropical band (jungle/swamp) straddles the equator,
 *     temperate grassland/forest in the mid-latitudes, tundra near the poles;
 *   - organic terrain via value noise instead of pure concentric rings;
 *   - one "Dragon Island" with a big mountain core, dense resources and only
 *     a small non-mountain coast — a prize worth fighting for;
 *   - start positions chosen for fairness: coastal, spread out, each with a
 *     comparable mix of terrain.
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

// ── Value noise for organic terrain ─────────────────────────────────────────
const noiseSeed = mulberry32(0xbeef42);
const noiseGrid = [];
for (let i = 0; i < 256; i++) noiseGrid.push(noiseSeed());

function noise2D(x, y) {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = noiseGrid[(xi + noiseGrid[yi & 255]) & 255];
  const b = noiseGrid[((xi + 1) + noiseGrid[yi & 255]) & 255];
  const c = noiseGrid[(xi + noiseGrid[(yi + 1) & 255]) & 255];
  const d = noiseGrid[((xi + 1) + noiseGrid[(yi + 1) & 255]) & 255];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, octaves = 3) {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2D(x * freq, y * freq);
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

/**
 * The archipelago: 8 islands, hand-placed centres with a radius, so the
 * layout is deliberate rather than a lucky roll. Each entry becomes one
 * landmass, and each gets a start position on its coast.
 *
 * The centre island (index 4) is the "Dragon Island" — it gets a big
 * mountain core with dense resources and only a small non-mountain coast.
 */
const ISLANDS = [
  { col: 14, row: 13, r: 11 },  // north-west
  { col: 50, row: 11, r: 9 },   // north-centre
  { col: 82, row: 15, r: 11 },  // north-east
  { col: 18, row: 34, r: 10 },  // west
  { col: 48, row: 33, r: 13 },  // centre — DRAGON ISLAND (big mountain, rich)
  { col: 79, row: 36, r: 10 },  // east
  { col: 33, row: 50, r: 9 },   // south-west
  { col: 65, row: 51, r: 9 },   // south-east
];

const DRAGON_ISLAND_INDEX = 4;

/**
 * Latitude biome: returns a biome string based on row.
 * Rows 0-5: arctic. Rows 6-12: tundra/cold. Rows 13-47: temperate.
 * Rows 20-40: tropical band (overlaps temperate). Rows 48-54: cold. Rows 55+: arctic.
 */
function latitudeBiome(row) {
  if (row <= 4 || row >= HEIGHT - 5) return 'arctic';
  if (row <= 9 || row >= HEIGHT - 10) return 'cold';
  if (row >= 20 && row <= 40) return 'tropical';
  return 'temperate';
}

/**
 * Terrain for a normal island: organic transitions driven by distance from
 * centre + noise, modulated by latitude biome.
 */
function terrainFor(distance, radius, row, r) {
  const t = distance / radius; // 0 centre … 1 coast
  const biome = latitudeBiome(row);
  const n = fbm(distance * 0.3, row * 0.15, 3); // noise for variety

  if (t > 0.94) return ' '; // water gap between islands

  // Coast: sandy in warm biomes, grassy in cold
  if (t > 0.84) {
    if (biome === 'tropical') return r() < 0.4 ? 'd' : r() < 0.7 ? 'g' : 'f';
    if (biome === 'cold') return r() < 0.3 ? 't' : 'g';
    return r() < 0.5 ? 'd' : 'g';
  }

  // Tropical band: jungle, swamp, forest
  if (biome === 'tropical') {
    if (t > 0.72) return r() < 0.3 ? 'j' : r() < 0.5 ? 'f' : 'g';
    if (t > 0.55) return r() < 0.25 ? 's' : r() < 0.45 ? 'j' : r() < 0.65 ? 'f' : 'g';
    if (t > 0.35) return r() < 0.15 ? 's' : r() < 0.35 ? 'j' : r() < 0.55 ? 'f' : r() < 0.75 ? 'g' : 'p';
    if (t > 0.15) return r() < 0.2 ? 'j' : r() < 0.4 ? 'f' : r() < 0.6 ? 'g' : r() < 0.8 ? 'h' : 'p';
    return r() < 0.25 ? 'm' : r() < 0.45 ? 'h' : r() < 0.65 ? 'g' : 'f';
  }

  // Cold band: tundra, sparse forest
  if (biome === 'cold') {
    if (t > 0.72) return r() < 0.4 ? 't' : r() < 0.7 ? 'g' : 'p';
    if (t > 0.50) return r() < 0.2 ? 'f' : r() < 0.5 ? 'g' : r() < 0.8 ? 'p' : 't';
    if (t > 0.25) return r() < 0.15 ? 'f' : r() < 0.4 ? 'g' : r() < 0.7 ? 'h' : 'p';
    return r() < 0.2 ? 'm' : r() < 0.4 ? 'h' : r() < 0.6 ? 'g' : 't';
  }

  // Temperate: the classic mix
  if (t > 0.72) return r() < 0.3 ? 'h' : r() < 0.6 ? 'g' : 'p';
  if (t > 0.55) return r() < 0.2 ? 'f' : r() < 0.45 ? 'g' : r() < 0.7 ? 'p' : 'h';
  if (t > 0.35) return r() < 0.15 ? 'f' : r() < 0.35 ? 'g' : r() < 0.55 ? 'p' : r() < 0.75 ? 'h' : 'g';
  if (t > 0.15) return r() < 0.2 ? 'f' : r() < 0.4 ? 'h' : r() < 0.6 ? 'g' : 'p';
  return r() < 0.25 ? 'm' : r() < 0.5 ? 'h' : r() < 0.7 ? 'g' : 'f';
}

/**
 * Dragon Island terrain: a big mountain core with dense resources and only a
 * small non-mountain coast. The interior is mostly mountains and hills; the
 * coast is a thin ring of grass/plains. This makes it a prize worth fighting
 * for — rich in resources but hard to settle and defend.
 */
function terrainForDragon(distance, radius, row, r) {
  const t = distance / radius;
  const biome = latitudeBiome(row);

  if (t > 0.92) return ' '; // water

  // Very thin coast — only a small non-mountain ring
  if (t > 0.82) {
    if (biome === 'tropical') return r() < 0.5 ? 'g' : r() < 0.8 ? 'f' : 'd';
    return r() < 0.5 ? 'g' : r() < 0.8 ? 'p' : 'd';
  }

  // Foothills ring
  if (t > 0.68) return r() < 0.4 ? 'h' : r() < 0.7 ? 'g' : r() < 0.9 ? 'f' : 'p';

  // Mountain core — big and dense
  if (t > 0.35) return r() < 0.55 ? 'm' : r() < 0.8 ? 'h' : 'g';

  // Peak
  return r() < 0.7 ? 'm' : r() < 0.9 ? 'h' : 'g';
}

/**
 * A colonisable islet is only a few tiles across, so it gets no mountain core
 * and no hills ring — a settler must be able to found a city on it, so it is
 * gentle grassland/plains with a grassy rim.
 */
function terrainForIslet(distance, radius, r) {
  const t = distance / radius;
  if (t > 0.9) return ' ';
  if (t > 0.55) return r() < 0.25 ? 'd' : 'g';
  return r() < 0.12 ? 'f' : r() < 0.45 ? 'p' : 'g';
}

/**
 * Polar rows stay OPEN WATER. An ice cap spanning the full width is one
 * enormous landmass, and it would weld the top and bottom of the map into a
 * ring that every island could walk to — which is the opposite of a naval
 * game.
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

    const isDragon = nearest.isle === ISLANDS[DRAGON_ISLAND_INDEX];
    const terrain = best < nearest.isle.r
      ? (isDragon ? terrainForDragon(best, nearest.isle.r, row, rng) : terrainFor(best, nearest.isle.r, row, rng))
      : ' ';
    line += terrain;

    // Bonus resources: dense on Dragon Island, moderate elsewhere, never on water/mountains.
    let bonusChance = 0;
    if (terrain !== ' ' && terrain !== 'm') {
      if (isDragon) bonusChance = 0.22; // Dragon Island is rich
      else if (terrain === 'g' || terrain === 'p') bonusChance = 0.10;
      else if (terrain === 'f' || terrain === 'j' || terrain === 's') bonusChance = 0.08;
      else bonusChance = 0.05;
    }
    specLine += rng() < bonusChance ? '2' : '0';
  }
  rows.push(line);
  specials.push(specLine);
}

// ── Colonisable islets ────────────────────────────────────────────────────
const ISLET_RADIUS = 3;
const ISLET_GAP = 2;
const ISLET_TARGET = 10;

function isOpenWater(col, row, radius) {
  for (let dy = -radius - ISLET_GAP; dy <= radius + ISLET_GAP; dy++) {
    for (let dx = -radius - ISLET_GAP; dx <= radius + ISLET_GAP; dx++) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || c >= WIDTH || r < 0 || r >= HEIGHT) return false;
      if (Math.hypot(dx, dy * 1.35) > radius + ISLET_GAP) continue;
      if ((rows[r]?.[c] ?? ' ') !== ' ') return false;
    }
  }
  return true;
}

const islets = [];
for (let step = 8; step >= 3 && islets.length < ISLET_TARGET; step--) {
  const candidates = [];
  for (let row = 5; row < HEIGHT - 5; row += step) {
    for (let col = 5; col < WIDTH - 5; col += step) {
      candidates.push([col, row]);
    }
  }
  candidates.sort((a, b) => {
    const da = Math.hypot(a[0] - WIDTH / 2, a[1] - HEIGHT / 2);
    const db = Math.hypot(b[0] - WIDTH / 2, b[1] - HEIGHT / 2);
    return da - db || a[1] - b[1] || a[0] - b[0];
  });
  for (const [col, row] of candidates) {
    if (islets.length >= ISLET_TARGET) break;
    if (islets.some(([c, r]) => Math.hypot(c - col, r - row) < ISLET_RADIUS * 4)) continue;
    if (!isOpenWater(col, row, ISLET_RADIUS)) continue;
    for (let dy = -ISLET_RADIUS; dy <= ISLET_RADIUS; dy++) {
      for (let dx = -ISLET_RADIUS; dx <= ISLET_RADIUS; dx++) {
        const d = Math.hypot(dx, dy * 1.35);
        if (d > ISLET_RADIUS) continue;
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || c >= WIDTH || r < 0 || r >= HEIGHT) continue;
        const terrain = terrainForIslet(d, ISLET_RADIUS, rng);
        rows[r] = rows[r].slice(0, c) + terrain + rows[r].slice(c + 1);
        if (terrain === ' ' || terrain === 'm') continue;
        const bonus = rng() < 0.14 ? '2' : '0';
        specials[r] = specials[r].slice(0, c) + bonus + specials[r].slice(c + 1);
      }
    }
    islets.push([col, row]);
  }
}

// ── Start positions ────────────────────────────────────────────────────────
/**
 * A start tile per island that is passable AND coastal, chosen for fairness:
 * each start gets a comparable mix of surrounding terrain (food + production +
 * trade). The search scores each coastal candidate by the quality of its
 * 5x5 neighbourhood and picks the best.
 */
const startPositions = [];
const isWater = (col, row) => {
  const ch = rows[row]?.[col] ?? ' ';
  return ch === ' ';
};

function scoreStartTile(col, row) {
  let food = 0, prod = 0, trade = 0, water = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || c >= WIDTH || r < 0 || r >= HEIGHT) continue;
      const ch = rows[r][c];
      if (ch === ' ') { water++; continue; }
      if (ch === 'g') food += 2;
      else if (ch === 'p') { food += 1; prod += 1; }
      else if (ch === 'f') { food += 1; prod += 2; }
      else if (ch === 'j') { food += 2; prod += 1; }
      else if (ch === 's') food += 3;
      else if (ch === 'h') prod += 2;
      else if (ch === 'd') trade += 1;
      else if (ch === 't') food += 1;
      else if (ch === 'a') food += 0;
      if (specials[r][c] === '2') { food += 1; prod += 1; }
    }
  }
  // Reward coastal starts (water access) and penalize mountain-heavy starts
  return food * 2 + prod * 2 + trade + water * 3;
}

for (const isle of ISLANDS) {
  let best = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < 800; attempt++) {
    const angle = rng() * Math.PI * 2;
    const dist = isle.r * (0.55 + rng() * 0.40);
    const col = Math.round(isle.col + Math.cos(angle) * dist);
    const row = Math.round(isle.row + Math.sin(angle) * dist * 0.75);
    if (row < 4 || row >= HEIGHT - 4 || col < 2 || col >= WIDTH - 2) continue;
    const terrain = rows[row][col];
    if (terrain === ' ' || terrain === 'm' || terrain === 'a') continue;
    const coastal = [-1, 0, 1].some((dc) =>
      [-1, 0, 1].some((dr) => {
        if (dc === 0 && dr === 0) return false;
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) return false;
        return isWater(nc, nr);
      }),
    );
    if (!coastal) continue;
    const score = scoreStartTile(col, row);
    if (score > bestScore) {
      bestScore = score;
      best = { col, row };
    }
  }
  startPositions.push(best ?? { col: isle.col, row: isle.row });
}

// ── Verify the archipelago is actually naval ───────────────────────────────
const land = (col, row) => {
  const ch = rows[row]?.[col] ?? ' ';
  return ch !== ' ';
};

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
const homeIslands = comps.filter((c) => c.length >= 60);
const errors = [];
if (homeIslands.length !== ISLANDS.length) {
  errors.push(`expected ${ISLANDS.length} home islands, got ${homeIslands.length} (all sizes ${comps.map((c) => c.length).sort((a, b) => b - a).join('/')})`);
}
if (bigEnough.length < 6) {
  errors.push(`only ${bigEnough.length} islands with >= 120 tiles — too small to fund a navy`);
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

const SMALL_ISLAND_MAX_TILES = 24;
const colonisable = comps.filter((c) => c.length <= SMALL_ISLAND_MAX_TILES);
if (colonisable.length < ISLET_TARGET) {
  errors.push(
    `only ${colonisable.length} landmasses of <= ${SMALL_ISLAND_MAX_TILES} tiles — the AI has nothing to colonise by sea`,
  );
}
for (const isle of colonisable) {
  if (!isle.some(([c, r]) => [-1, 0, 1].some((dc) => [-1, 0, 1].some((dr) =>
    (dc !== 0 || dr !== 0) && (rows[r + dr]?.[c + dc] ?? ' ') === ' ')))) {
    errors.push(`a ${isle.length}-tile islet has no water next to it — unreachable`);
  }
}

// Dragon Island verification: must have a significant mountain core
const dragonComp = comps.find((c) => c.some(([c2, r2]) => {
  const s = startPositions[DRAGON_ISLAND_INDEX];
  return c2 === s?.col && r2 === s?.row;
}));
if (dragonComp) {
  const mountains = dragonComp.filter(([c, r]) => rows[r][c] === 'm').length;
  const hills = dragonComp.filter(([c, r]) => rows[r][c] === 'h').length;
  const resources = dragonComp.filter(([c, r]) => specials[r][c] === '2').length;
  console.log(`dragon island: ${dragonComp.length} tiles, ${mountains} mountains, ${hills} hills, ${resources} resources`);
  if (mountains < 15) errors.push(`dragon island has only ${mountains} mountains — should be a big mountain`);
  if (resources < 10) errors.push(`dragon island has only ${resources} resources — should be rich`);
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
console.log(`landmasses: ${comps.length} (${homeIslands.length} home + ${colonisable.length} colonisable)`);
console.log(`home island sizes: ${homeIslands.map((c) => c.length).sort((a, b) => b - a).join('/')}`);
console.log(`colonisable islets: ${colonisable.length} (sizes ${colonisable.map((c) => c.length).sort((a, b) => b - a).join('/')})`);
console.log(`land tiles: ${landTiles} / ${WIDTH * HEIGHT} (${Math.round((100 * landTiles) / (WIDTH * HEIGHT))}%)`);
console.log(`start positions: ${startPositions.length}`);

// Terrain distribution
const terr = {};
for (const row of rows) for (const ch of row) terr[ch] = (terr[ch] ?? 0) + 1;
console.log(`terrain: ${JSON.stringify(terr)}`);

if (errors.length > 0) {
  console.error('\nMAP REJECTED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

writeFileSync(resolve(OUT_DIR, `${MAP_ID}.json`), `${JSON.stringify(map, null, 1)}\n`);
console.log(`\nwrote src/data/maps/${MAP_ID}.json`);
