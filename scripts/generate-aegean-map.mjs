#!/usr/bin/env node
/**
 * Generate the static "Aegean Campaign" scenario map.
 *
 * Usage:
 *   node scripts/generate-aegean-map.mjs [output-id]
 *
 * Unlike `generate-naval-map.mjs` — which scatters round islands so no two
 * civs share ground — this is a *shaped* sea. The land is the real thing: the
 * Aegean rimmed by the Greek mainland, the Anatolian coast, Thrace and Crete,
 * with a dense middle of islands and islets in the channels. It plays like the
 * actual basin:
 *
 *   - one home island per civ, every one of them coastal (rule from
 *     NEW_MAP_GUIDE.adoc: an AI that cannot reach water can never field a
 *     fleet and the whole naval game is dead on arrival);
 *   - a sea channel wide enough for a ferry and too wide for a walker between
 *     every pair of home islands;
 *   - ~24 one-to-three-tile islets in the Dardanelles, the Sporades, the
 *     Cyclades and the Cretan approaches, all ≤ SMALL_ISLAND_MAX_TILES (24)
 *     and each with a landing tile — so `getColonizableIslands` has work to do;
 *   - one "Crown of Naxos": a mountain core with dense resources and a very
 *     thin coast, the prize every sea route is worth fighting over.
 *
 * Output keeps the raw Freeciv characters the game expects (see
 * `src/data/maps/types.ts`): ' ' ocean, a arctic, t tundra, d desert, p
 * plains, g grassland, f forest, j jungle, s swamp, h hills, m mountains.
 * '2' in the specials layer marks a bonus resource (terrain → resource mapping
 * in TERRAIN_RESOURCES: grassland yields none, so resources are only stamped
 * on hills/plains/desert/forest/swamp/mountains).
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/maps');
const MAP_ID = process.argv[2] ?? 'naval-aegean-96x60';

const WIDTH = 96;
const HEIGHT = 60;

/** Deterministic PRNG so the map is byte-identical on every regeneration. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (Math.imul(t ^ (t >>> 7), 61 | t) ^ t) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(0x4ea5eed);

// ── Value noise for ragged shorelines ────────────────────────────────────────
const noiseSeed = mulberry32(0xa7aa15);
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

/** Signed ripple in [-0.55, 0.55]; warps coastlines and terrain bands. */
function ripple(x, y, freq = 0.16) {
  return noise2D(x * freq, y * freq) - 0.5;
}

// ── The geography ────────────────────────────────────────────────────────────
/**
 * Land is the union of shapes. Every shape is one of:
 *
 *  - `{ cx, cy, rx, ry }` — an ellipse (the Greek mainland is a wall, the
 *    Cyclades are ovals, Euboea is a sliver);
 *  - `{ caps: [[x1,y1,x2,y2,r], …] }` — a chain of capsules, i.e. strokes of
 *    width `r`, for long thin island chains such as Crete.
 *
 * A shape is filled when the point's distance to its skeleton, minus its
 * thickness, is inside a noise-warped radius — so the coast stays organic
 * instead of looking like a stencil.
 */
const Y_SCALE = 1.15;

/**
 * Signed "inside" test for an axis-aligned ellipse centred on (cx,cy) with
 * radii rx/ry — the shape of an island on a non-square grid, so a round blob
 * stays round and a mainland is a wall rather than a lens.
 */
function ellipseSDF(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return Math.sqrt(dx * dx + dy * dy) - 1;
}

/** Distance from a point to a segment, in scaled tile units. */
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = (y2 - y1) * Y_SCALE;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - x1) * dx + (py * Y_SCALE - y1 * Y_SCALE) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cy = y1 + (t * dy) / Y_SCALE;
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey * Y_SCALE * Y_SCALE);
}

/**
 * A "part" is one primitive: an ellipse (`{ ellipse: {cx,cy,rx,ry} }`) or a
 * capsule chain (`{ caps: [[x1,y1,x2,y2,r], …] }`) for long thin island chains
 * such as Crete. A FEATURE (a named home island) is one or more parts welded
 * together by design — Hellas is a wall plus the Peloponnese lobe.
 *
 * The bbox is the whole feature plus a margin, so the paint loop can skip
 * shapes that cannot possibly cover a tile.
 */
function makePart(geomOrEllipse) {
  if (geomOrEllipse.ellipse) {
    const { cx, cy, rx, ry } = geomOrEllipse.ellipse;
    return { ellipse: { cx, cy, rx, ry }, wobble: wobbleFor(Math.min(rx, ry)), bbox: bboxOf([geomOrEllipse]) };
  }
  return { caps: geomOrEllipse.map(([x1, y1, x2, y2, r]) => [x1, y1, x2, y2, r]), wobble: wobbleFor(Math.min(...geomOrEllipse.map((c) => c[4]))), bbox: bboxOf([geomOrEllipse]) };
}

function bboxOf(entries) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (a, b, r = 0) => { x0 = Math.min(x0, a - r); x1 = Math.max(x1, a + r); y0 = Math.min(y0, b - r); y1 = Math.max(y1, b + r); };
  for (const e of entries) {
    if (e.ellipse) {
      grow(e.ellipse.cx - e.ellipse.rx, e.ellipse.cy - e.ellipse.ry);
      grow(e.ellipse.cx + e.ellipse.rx, e.ellipse.cy + e.ellipse.ry);
    } else {
      for (const [x1, y1, x2, y2, r] of e) {
        grow(Math.min(x1, x2) - r, Math.min(y1, y2) - r);
        grow(Math.max(x1, x2) + r, Math.max(y1, y2) + r);
      }
    }
  }
  return { x0: x0 - 5, x1: x1 + 5, y0: y0 - 5, y1: y1 + 5 };
}

/** A home island: a named set of parts that are supposed to be one landmass. */
function feature(name, ...parts) {
  return { name, parts: parts.map((p) => (Array.isArray(p) ? makePart(p) : makePart(p))), bbox: bboxOf(parts) };
}

/**
 * The coastline wobble has to be PROPORTIONAL to the shape and MINUTE in the
 * SDF's own units. `-d` runs 0…1 inside a shape, so a wobble of 1.9 makes the
 * shape vanish wherever the noise is positive and balloon wherever it is
 * negative — the first draft came out as fragments instead of islands. A real
 * shoreline wobbles by a fraction of a tile, so the coefficient is a small
 * fraction of the shape's half-width, clamped into a band where thin islands
 * keep their connection and wide ones still get a ragged shore.
 */
function wobbleFor(halfWidth) {
  return Math.max(0.07, Math.min(0.34, halfWidth * 0.045));
}

const ellipseShape = (name, cx, cy, rx, ry) => feature(name, { ellipse: { cx, cy, rx, ry } });
const chainShape = (name, caps) => feature(name, caps);

/** Signed distance to a part's skeleton (negative = inside). */
function partSDF(p, x, y) {
  if (p.ellipse) return ellipseSDF(x, y, p.ellipse.cx, p.ellipse.cy, p.ellipse.rx, p.ellipse.ry);
  let best = Infinity;
  for (const [x1, y1, x2, y2, r] of p.caps) {
    const d = distToSegment(x, y, x1, y1, x2, y2) - r;
    if (d < best) best = d;
  }
  return best;
}

/**
 * HOME ISLANDS — one per civ, each able to found several cities (≥ 110 tiles).
 * Placed so that no two are within a ferry's channel of each other and none is
 * cut off by the map edge.
 */
const FEATURES = [
  // Thrace and the Gallipoli shore — the northern rim, wide and flat.
  ellipseShape('thrace', 50, 6, 20, 4.8),
  // Thessaly, Attica and the Peloponnese — the western wall of the basin, one
  // home island in two lobes.
  // Thessaly, Attica and the Peloponnese — the western wall of the basin, one
  // home island in two lobes. The lobe stops short of Euboea, so the Euripus
  // stays a real channel: two civs sharing a wall is not a naval game.
  feature('hellas', { ellipse: { cx: 9, cy: 24, rx: 5.2, ry: 15 } }, [[13, 31, 20, 42, 3.4]]),
  // Ionia and the Carian coast — the eastern wall. Dry, hilly, mineral-rich.
  ellipseShape('anatolia', 85, 24, 5.6, 11.5),
  // Crete, the basin's longest shore: a chain of strokes with a thin waist.
  chainShape('crete', [[20, 53, 44, 56, 4.2], [44, 56, 60, 53, 4.4], [44, 56, 43, 58, 2.4]]),
  // Euboea, a long thin island with the Euripus strait beside it.
  ellipseShape('euboea', 30, 21, 4.2, 11),
  // The Dodecanese towards the south-east corner: Rhodes, Karpathos, Kos.
  chainShape('dodecanese', [[72, 40, 83, 44, 4.4], [83, 44, 80, 49, 3.2]]),
  // THE PRIZE — the Crown of Naxos: mountain core, dense resources, thin
  // coast, sitting in the middle of every sea route.
  ellipseShape('crown-naxos', 46, 28, 7.2, 7.0),
];

/** All shapes, including islets, for the land test. */
/**
 * ISLETS — one to four tiles each, every one its own landmass, in the
 * Dardanelles, the Sporades, the Cyclades and the Cretan approaches.
 *
 * `getColonizableIslands` only offers landmasses of ≤ SMALL_ISLAND_MAX_TILES
 * (24) that no civ has settled, so a map of only large islands leaves that
 * whole ferry-a-settler-to-a-rock feature unreachable. But an islet that
 * merely *touches* a home island is not an islet — it is that island's
 * beach, which is how the first draft welded Thrace to the Peloponnese and
 * the Peloponnese to Crete and left three home islands where seven were
 * meant to be. So the clearance is measured in TILES from the painted home
 * coastline, not in the shapes' SDF units: home land grows outwards by up to
 * one tile from the noise, and an islet's own radius can reach two tiles, so
 * a centre needs to sit at least four tiles clear to leave a real channel.
 */
const ISLET_CLEAR_HOME = 4;
const ISLET_CLEAR_ISLET = 3;

/** Curated, authentic Aegean islets — the ones a ferry has to thread. */
const ISLETS = [
  // Thermaic gulf and the northern Dardanelles.
  [17, 9], [21, 4], [25, 11], [28, 5], [31, 2], [36, 5], [33, 10], [27, 15],
  // The Propontis: Bozcaada, Gökçeada and the rocks of the strait.
  [40, 4], [44, 6], [48, 2], [52, 4], [56, 8], [46, 12], [50, 11], [54, 12],
  // Lesbos and its satellite rocks.
  [61, 10], [65, 12], [58, 13], [63, 15],
  // The Sporades, the Aegean's own island arc.
  [31, 17], [35, 19], [31, 24], [36, 26], [31, 30], [37, 31], [32, 36],
  // The Cyclades: Kea, Kythnos, Serifos, Paros, Koufonisia, Schinousa.
  [38, 20], [39, 26], [40, 31], [43, 35], [46, 38], [50, 31], [49, 36],
  [37, 40], [42, 28], [45, 33],
  // The open middle sea: Samothrace, Amorgos, Leros.
  [54, 22], [58, 27], [52, 31], [57, 34], [62, 37], [55, 39], [59, 41],
  // The Icarian/Carian approaches off Anatolia.
  [66, 14], [70, 17], [73, 23], [78, 18], [76, 29], [71, 32], [74, 35],
  [80, 34], [78, 40], [82, 42],
  // The Cretan approaches.
  [68, 51], [72, 53], [66, 56], [60, 56], [54, 57], [48, 57], [40, 57], [32, 56],
  [26, 51], [22, 46], [27, 43], [24, 38],
  // The western approaches off the Peloponnese.
  [16, 44], [13, 49], [17, 54], [21, 54], [9, 54], [7, 47], [12, 39], [15, 35],
  [17, 29], [14, 23], [17, 16], [14, 12],
  // The plain of Tiryns and the last rocks of the Propontis.
  [41, 16], [46, 21],
];

function isletRadius(ix, iy) {
  return 1.25 + noiseGrid[Math.round(ix * 7 + iy * 13) & 255] * 0.7;
}

/** Distance in TILES from a candidate centre to the nearest painted home land. */
const homeLand = FEATURES.some((f) => f.name !== '');
const HOME_LAND_TILES = [];
for (let row = 0; row < HEIGHT; row++) {
  HOME_LAND_TILES.push(new Array(WIDTH).fill(false));
  for (let col = 0; col < WIDTH; col++) {
    if (col < 2 || col >= WIDTH - 2 || row < 3 || row >= HEIGHT - 2) continue;
    for (const f of FEATURES) {
      for (const p of f.parts) {
        const d = partSDF(p, col, row);
        if (d < 0 && -d + ripple(col, row) * p.wobble > 0.15) { HOME_LAND_TILES[row][col] = true; break; }
      }
      if (HOME_LAND_TILES[row][col]) break;
    }
  }
}
const HOME_DISTANCE = [];
for (let row = 0; row < HEIGHT; row++) {
  HOME_DISTANCE.push(new Array(WIDTH).fill(-1));
}
{
  const queue = [];
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      if (HOME_LAND_TILES[row][col]) {
        HOME_DISTANCE[row][col] = 0;
        queue.push([col, row]);
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const [c, r] = queue[head];
    const d = HOME_DISTANCE[r][c] + 1;
    for (const [dc, dr] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) continue;
      if (HOME_DISTANCE[nr][nc] >= 0) continue;
      HOME_DISTANCE[nr][nc] = d;
      queue.push([nc, nr]);
    }
  }
}
void homeLand;

const tooCloseToHome = (cx, cy) => (HOME_DISTANCE[cy][cx] ?? -1) >= 0 && HOME_DISTANCE[cy][cx] < ISLET_CLEAR_HOME;

const tooCloseToIslet = (cx, cy, list) => list.some(([ix, iy]) => Math.abs(cx - ix) + Math.abs(cy - iy) < ISLET_CLEAR_ISLET + 2);

const keptIslets = [];
for (const [ix, iy] of ISLETS) {
  if (ix < 4 || iy < 3 || ix >= WIDTH - 4 || iy >= HEIGHT - 3) continue;
  if (tooCloseToHome(ix, iy)) continue;
  if (tooCloseToIslet(ix, iy, keptIslets)) continue;
  keptIslets.push([ix, iy]);
}

// Not enough islets means getColonizableIslands() returns nothing and the
// ferry-a-settler-to-an-island feature is dead code, so top up from a
// deterministic scan of open water until the islet count is healthy.
const ISLET_TARGET = 30;
if (keptIslets.length < ISLET_TARGET) {
  outer:
  for (let row = 3; row < HEIGHT - 3 && keptIslets.length < ISLET_TARGET; row++) {
    for (let col = 4; col < WIDTH - 4 && keptIslets.length < ISLET_TARGET; col++) {
      if ((HOME_DISTANCE[row][col] ?? -1) < ISLET_CLEAR_HOME) continue;
      if (tooCloseToIslet(col, row, keptIslets)) continue;
      if (keptIslets.some(([ox, oy]) => ox === col && oy === row)) continue;
      keptIslets.push([col, row]);
      continue outer;
    }
  }
}

const ISLET_SHAPES = keptIslets.map(([ix, iy]) => {
  const r = isletRadius(ix, iy);
  return ellipseShape('__islet__', ix, iy, r, r * 1.05);
});

const ALL_SHAPES = [...FEATURES, ...ISLET_SHAPES];

/** Whether the noise-warped shape paints this tile. */
function paints(part, col, row) {
  const d = partSDF(part, col, row);
  if (d > 0) return false;
  return -d + ripple(col, row) * part.wobble > 0.15;
}

/**
 * Whether (col,row) is land. The outer 2 columns and rows 0-2 / 56-59 stay
 * open water, so the sea meets the map edge on every side and no land welds
 * the rim into one ring.
 */
function isLand(col, row) {
  if (row < 3 || row >= HEIGHT - 2) return false;
  if (col < 2 || col >= WIDTH - 2) return false;
  for (const s of ALL_SHAPES) {
    const { x0, x1, y0, y1 } = s.bbox;
    if (col < x0 || col > x1 || row < y0 || row > y1) continue;
    if (s.parts.some((p) => paints(p, col, row))) return true;
  }
  return false;
}

/** Which named home island a tile belongs to (islets have no name). */
function featureAt(col, row) {
  for (const s of FEATURES) {
    const { x0, x1, y0, y1 } = s.bbox;
    if (col < x0 || col > x1 || row < y0 || row > y1) continue;
    if (s.parts.some((p) => paints(p, col, row))) return s;
  }
  return null;
}

// ── Distance from the shore (drives the biome bands) ─────────────────────────
const DEPTH = [];
for (let row = 0; row < HEIGHT; row++) DEPTH.push(new Array(WIDTH).fill(0));
{
  // Same 8-connected landmass notion the engine uses
  // (GameEngine.computeLandmassIds), so "this island" means the same thing to
  // the map and to the game.
  const seen = new Set();
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      if (!isLand(col, row) || seen.has(row * WIDTH + col)) continue;
      const comp = [];
      const queue = [[col, row]];
      seen.add(row * WIDTH + col);
      while (queue.length) {
        const [c, r] = queue.pop();
        comp.push([c, r]);
        for (const [dc, dr] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) continue;
          const k = nr * WIDTH + nc;
          if (seen.has(k) || !isLand(nc, nr)) continue;
          seen.add(k);
          queue.push([nc, nr]);
        }
      }
      const inComp = new Set(comp.map(([c, r]) => r * WIDTH + c));
      const dist = new Map();
      const queue2 = [];
      for (const [c, r] of comp) {
        const edge = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]].some(([dc, dr]) => !inComp.has((r + dr) * WIDTH + c + dc));
        if (edge) { dist.set(r * WIDTH + c, 0); queue2.push([c, r]); }
      }
      let head = 0;
      while (head < queue2.length) {
        const [c, r] = queue2[head++];
        const cd = dist.get(r * WIDTH + c) ?? 0;
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) continue;
          const k = nr * WIDTH + nc;
          if (!inComp.has(k) || dist.has(k)) continue;
          dist.set(k, cd + 1);
          queue2.push([nc, nr]);
        }
      }
      for (const [c, r] of comp) DEPTH[r][c] = dist.get(r * WIDTH + c) ?? 0;
    }
  }
}

// ── Terrain ──────────────────────────────────────────────────────────────────
/**
 * A Mediterranean dry belt: the further south and east, the harder the ground.
 * The north-west (Hellas, Thrace, Euboea) keeps forest and swamp; Crete, the
 * Dodecanese and the Anatolian interior dry to grass, plains and desert.
 */
function aridity(col, row) {
  const lat = Math.max(0, Math.min(1, (row - 26) / 26)) * 0.55;
  const lon = Math.max(0, Math.min(1, (col - 26) / 66)) * 0.6;
  return Math.max(0, Math.min(1, lat + lon + ripple(col, row, 0.07) * 0.18));
}

/** Terrain character for a land tile. */
function terrainFor(col, row) {
  const d = DEPTH[row][col];
  const feature = featureAt(col, row);
  const arid = aridity(col, row);
  const r = () => rng();

  // The Crown of Naxos: mountain spine, dense resources, very thin coast.
  if (feature?.name === 'crown-naxos') {
    if (d === 1) return r() < 0.8 ? 'g' : 'p';
    if (d <= 3) return r() < 0.42 ? 'm' : r() < 0.82 ? 'h' : 'g';
    if (d <= 5) return r() < 0.62 ? 'm' : r() < 0.87 ? 'h' : 'f';
    return r() < 0.55 ? 'm' : r() < 0.85 ? 'h' : 'f';
  }

  // Islets stay gentle: a settler must always be able to found a city there.
  if (!feature) {
    if (d <= 0) return r() < 0.7 ? 'g' : r() < 0.6 ? 'p' : 'f';
    return r() < 0.5 ? 'g' : r() < 0.35 ? 'p' : r() < 0.25 ? 'h' : 'f';
  }

  // Shore: grass and beach, drier towards the south-east.
  if (d === 0) {
    if (arid > 0.66) return r() < 0.4 ? 'd' : r() < 0.5 ? 'p' : 'g';
    return r() < 0.6 ? 'g' : r() < 0.35 ? 'p' : 'f';
  }

  // Dry interior of Crete, the Dodecanese and Anatolia.
  if (arid > 0.52) {
    if (d <= 2) return r() < 0.32 ? 'd' : r() < 0.45 ? 'p' : 'g';
    if (d <= 4) return r() < 0.28 ? 'd' : r() < 0.45 ? 'h' : 'p';
    return r() < 0.42 ? 'm' : r() < 0.7 ? 'h' : 'p';
  }

  // The wet north-west: forest, swamp, then a hill-and-mountain core.
  if (d <= 2) return r() < 0.45 ? 'g' : r() < 0.32 ? 'p' : r() < 0.2 ? 'f' : 'h';
  if (d <= 4) {
    if (r() < 0.28) return r() < 0.55 ? 's' : 'f';
    return r() < 0.24 ? 'h' : r() < 0.42 ? 'f' : 'g';
  }
  if (d <= 6) return r() < 0.34 ? 'm' : r() < 0.7 ? 'h' : 'f';
  return r() < 0.5 ? 'm' : r() < 0.75 ? 'h' : 'f';
}

// ── Paint ───────────────────────────────────────────────────────────────────
const rows = [];
const specials = [];
for (let row = 0; row < HEIGHT; row++) {
  let line = '';
  let specLine = '';
  for (let col = 0; col < WIDTH; col++) {
    if (!isLand(col, row)) {
      line += ' ';
      specLine += '0';
      continue;
    }
    const ch = terrainFor(col, row);
    line += ch;
    // Resources only where TERRAIN_RESOURCES yields something — grass is a
    // silent no-op, so stamping it would be dead weight. The Crown of Naxos
    // is forced rich below.
    const chance = ch === 'h' ? 0.5 : ch === 'p' ? 0.3 : ch === 'd' ? 0.45 : ch === 'm' ? 0.85 : ch === 'f' ? 0.2 : ch === 's' ? 0.25 : 0;
    specLine += rng() < chance ? '2' : '0';
  }
  rows.push(line);
  specials.push(specLine);
}

// The Crown must be RICH: every hill and mountain on it carries its bonus.
for (let row = 0; row < HEIGHT; row++) {
  for (let col = 0; col < WIDTH; col++) {
    if (featureAt(col, row)?.name !== 'crown-naxos') continue;
    if (rows[row][col] === 'm' || rows[row][col] === 'h') {
      specials[row] = `${specials[row].slice(0, col)}2${specials[row].slice(col + 1)}`;
    }
  }
}

// ── Landmasses (8-connected, the same notion the engine uses) ───────────────
const COLONISABLE_MAX = 24;
const HOME_MIN = 110;

let _regions = null;
function regionCache() {
  if (_regions) return _regions;
  _regions = [];
  const seen = new Set();
  for (let row = 0; row < HEIGHT; row++) {
    for (let col = 0; col < WIDTH; col++) {
      if (!isLand(col, row) || seen.has(row * WIDTH + col)) continue;
      const comp = new Set();
      const queue = [[col, row]];
      seen.add(row * WIDTH + col);
      while (queue.length) {
        const [c, r] = queue.pop();
        comp.add(r * WIDTH + c);
        for (const [dc, dr] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) continue;
          const k = nr * WIDTH + nc;
          if (seen.has(k) || !isLand(nc, nr)) continue;
          seen.add(k);
          queue.push([nc, nr]);
        }
      }
      _regions.push(comp);
    }
  }
  return _regions;
}

/** Index of the landmass at (col,row), or -1 for water. */
function landmassOf(col, row) {
  const comps = regionCache();
  for (let i = 0; i < comps.length; i++) {
    if (comps[i].has(row * WIDTH + col)) return i;
  }
  return -1;
}

// ── Start positions ─────────────────────────────────────────────────────────
const isWater = (col, row) => (rows[row]?.[col] ?? ' ') === ' ';

/** Score a coastal candidate by the quality of its 5x5 neighbourhood. */
function scoreStartTile(col, row) {
  let food = 0, prod = 0, trade = 0, water = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || c >= WIDTH || r < 0 || r >= HEIGHT) continue;
      const ch = rows[r]?.[c] ?? ' ';
      if (ch === ' ') { water++; continue; }
      if (ch === 'g') food += 2;
      else if (ch === 'p') { food += 1; prod += 1; }
      else if (ch === 'f') { food += 1; prod += 2; }
      else if (ch === 's') food += 3;
      else if (ch === 'h') prod += 2;
      else if (ch === 'd') trade += 1;
      if (specials[r][c] === '2') { food += 1; prod += 1; }
    }
  }
  return food * 2 + prod * 2 + trade + water * 3;
}

const HOME_FEATURES = ['thrace', 'hellas', 'anatolia', 'crete', 'euboea', 'dodecanese', 'crown-naxos'];
const startPositions = [];

/** A random point inside a feature's parts, biased towards their centres. */
function sampleInShape(f) {
  const part = f.parts[Math.floor(rng() * f.parts.length)];
  if (part.ellipse) {
    const { cx, cy, rx, ry } = part.ellipse;
    const angle = rng() * Math.PI * 2;
    const t = Math.sqrt(rng());
    return [Math.round(cx + Math.cos(angle) * rx * t), Math.round(cy + Math.sin(angle) * ry * t)];
  }
  const cap = part.caps[Math.floor(rng() * part.caps.length)];
  const t = rng();
  const jitter = Math.max(2, cap[4] * 0.4);
  return [Math.round(cap[0] + (cap[2] - cap[0]) * t + (rng() - 0.5) * jitter), Math.round(cap[1] + (cap[3] - cap[1]) * t + (rng() - 0.5) * jitter)];
}

for (const name of HOME_FEATURES) {
  const feature = FEATURES.find((f) => f.name === name);
  let best = null;
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < 2500; attempt++) {
    const [cx, cy] = sampleInShape(feature);
    if (cx < 2 || cy < 2 || cx >= WIDTH - 2 || cy >= HEIGHT - 2) continue;
    if (isWater(cx, cy) || rows[cy][cx] === 'm') continue;
    const coastal = [-1, 0, 1].some((dc) =>
      [-1, 0, 1].some((dr) => {
        if (dc === 0 && dr === 0) return false;
        const nc = cx + dc;
        const nr = cy + dr;
        if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) return false;
        return isWater(nc, nr);
      }),
    );
    if (!coastal) continue;
    // One civ per island: a start must not sit on a landmass another civ
    // already chose.
    const comp = landmassOf(cx, cy);
    if (comp >= 0 && startPositions.some((s) => landmassOf(s.col, s.row) === comp)) continue;
    const score = scoreStartTile(cx, cy);
    if (score > bestScore) {
      bestScore = score;
      best = { col: cx, row: cy };
    }
  }
  if (best) startPositions.push(best);
}

// ── Verify the basin is actually a naval map ────────────────────────────────
const comps = regionCache();
const startComps = startPositions.map((s) => landmassOf(s.col, s.row));
const homeIslands = startComps.map((i) => comps[i]).filter(Boolean);
const colonisable = comps.filter((c) => c.size <= COLONISABLE_MAX);
const errors = [];

for (let i = 0; i < startComps.length; i++) {
  if (startComps[i] < 0) errors.push(`start ${i} is not on land`);
  for (let j = i + 1; j < startComps.length; j++) {
    if (startComps[i] >= 0 && startComps[i] === startComps[j]) {
      errors.push(`starts ${i} and ${j} share one landmass — a naval map needs one civ per island`);
    }
  }
}
for (const [i, comp] of homeIslands.entries()) {
  if (comp.size < HOME_MIN) {
    errors.push(`home island for start ${i} has ${comp.size} tiles — under the ${HOME_MIN}-tile empire threshold`);
  }
}
if (colonisable.length < 20) {
  errors.push(`only ${colonisable.length} landmasses of <= ${COLONISABLE_MAX} tiles — the AI has nothing to colonise by sea`);
}
for (const comp of colonisable) {
  const tiles = [...comp].map((k) => [k % WIDTH, Math.floor(k / WIDTH)]);
  const hasLanding = tiles.some(([c, r]) =>
    [-1, 0, 1].some((dc) => [-1, 0, 1].some((dr) => (dc !== 0 || dr !== 0) && (rows[r + dr]?.[c + dc] ?? ' ') === ' ')),
  );
  if (!hasLanding) errors.push('an islet has no water next to it — unreachable');
  if (tiles.some(([c, r]) => rows[r][c] === 'm')) errors.push('an islet contains mountains — a settler cannot found a city on it');
}
for (const [i, s] of startPositions.entries()) {
  const coastal = [-1, 0, 1].some((dc) =>
    [-1, 0, 1].some((dr) => {
      if (dc === 0 && dr === 0) return false;
      const nc = s.col + dc;
      const nr = s.row + dr;
      if (nc < 0 || nr < 0 || nc >= WIDTH || nr >= HEIGHT) return false;
      return rows[nr][nc] === ' ';
    }),
  );
  if (!coastal) errors.push(`start ${i} (${s.col},${s.row}) has no water next to it — that civ could never sail`);
  if (rows[s.row][s.col] === 'm' || rows[s.row][s.col] === ' ') {
    errors.push(`start ${i} (${s.col},${s.row}) is not colonisable land`);
  }
}
// A start's island must be a plausible capital: at least 12 dry tiles within
// 3 rings of it, so the AI's first city has somewhere to grow.
for (const [i, s] of startPositions.entries()) {
  let room = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const c = s.col + dx;
      const r = s.row + dy;
      if (c < 0 || r < 0 || c >= WIDTH || r >= HEIGHT) continue;
      if ((rows[r][c] ?? ' ') !== ' ' && rows[r][c] !== 'm') room++;
    }
  }
  if (room < 14) errors.push(`start ${i} at ${s.col},${s.row} has only ${room} buildable tiles nearby`);
}

const landTiles = rows.join('').split('').filter((c) => c !== ' ').length;
const ratio = landTiles / (WIDTH * HEIGHT);
if (ratio < 0.24 || ratio > 0.5) {
  errors.push(`land ratio ${Math.round(ratio * 100)}% — a naval map wants 24-50%`);
}

if (process.env.DUMP_ROWS) {
  for (let row = 0; row < HEIGHT; row++) console.log(`${String(row).padStart(2, '0')} ${rows[row]}${startPositions.some((s) => s.row === row) ? `  starts: ${startPositions.filter((s) => s.row === row).map((s) => s.col).join(',')}` : ''}`);
}

if (process.env.DUMP_FEATURES) {
  for (const f of FEATURES) {
    const centre = [Math.round(f.bbox.x0 + (f.bbox.x1 - f.bbox.x0) / 2), Math.round(f.bbox.y0 + (f.bbox.y1 - f.bbox.y0) / 2)];
    const idx = landmassOf(...centre);
    console.log(`feature ${f.name}: centre ${centre.join(',')} landmass ${idx}, size ${idx >= 0 ? comps[idx].size : 'n/a'}`);
  }
  console.log(`islets kept: ${keptIslets.length} -> ${JSON.stringify(keptIslets)}`);
}

const map = {
  id: MAP_ID,
  name: 'Aegean Campaign',
  source: 'generated by scripts/generate-aegean-map.mjs (do not edit by hand)',
  width: WIDTH,
  height: HEIGHT,
  rows,
  specials,
  startPositions,
};

console.log(`landmasses: ${comps.length} (${homeIslands.length} home + ${colonisable.length} islets)`);
console.log(`home island sizes: ${homeIslands.map((c) => c.size).sort((a, b) => b - a).join('/')}`);
console.log(`colonisable islets: ${colonisable.length} (sizes ${[...colonisable].map((c) => c.size).sort((a, b) => b - a).join('/')})`);
console.log(`land tiles: ${landTiles} / ${WIDTH * HEIGHT} (${Math.round(ratio * 100)}%)`);
console.log(`start positions: ${startPositions.length} -> ${JSON.stringify(startPositions.map((s) => [s.col, s.row]))}`);

const terr = {};
for (const row of rows) for (const ch of row) terr[ch] = (terr[ch] ?? 0) + 1;
console.log(`terrain: ${JSON.stringify(terr)}`);
console.log(`resources: ${specials.join('').split('').filter((c) => c === '2').length}`);

if (errors.length > 0) {
  console.error('\nMAP REJECTED:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

writeFileSync(resolve(OUT_DIR, `${MAP_ID}.json`), `${JSON.stringify(map, null, 1)}\n`);
console.log(`\nwrote src/data/maps/${MAP_ID}.json`);
