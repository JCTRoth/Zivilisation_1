/**
 * MapGeneratorHelpers — pure functions used by MapGenerator.
 *
 * Every function in this module is side-effect-free with respect to
 * MapGenerator's instance state (no `this` access).  Functions that
 * mutate their argument objects (e.g. `applyMoisture(cell, ...)`) are
 * still considered pure from the class's perspective: they only touch
 * what is handed to them.
 */

import { TERRAIN_TYPES, TERRAIN_RESOURCES } from '@/data/TerrainConstants';

// ── Shared types ────────────────────────────────────────────────────────

export interface Point { col: number; row: number; }

export interface GenTile {
  col: number;
  row: number;
  type: string;
  terrain: string;
  resource: string | null;
  improvement?: string;
  village?: boolean;
  visible: boolean;
  explored: boolean;
  groupId?: number;
}

export interface InternalTile extends GenTile {
  groupId: number;
  specialResource: boolean;
  resource: string | null;
}

export interface MapGeneratorSettings {
  seed?: number;
  mapWidth: number;
  mapHeight: number;
  landMass?: number;
  temperature?: number;
  climate?: number;
  age?: number;
}

export enum GroupKind { Water, Land, PolarCap }

export interface MapGroup {
  id: number;
  kind: GroupKind;
  size: number;
  buildSites: number;
}

export type RNG = {
  /** Returns a float between 0 (inclusive) and 1 (exclusive) */
  (): number;
  /** Alias for calling the RNG directly */
  next(): number;
  /** Returns an integer between min and max (inclusive) */
  intRange(min: number, max: number): number;
  /** Returns a float between min and max */
  range(min: number, max: number): number;
  /** Picks a random element from an array */
  pick<T>(arr: readonly T[]): T;
  /** Returns true with the given probability (0.0 to 1.0) */
  chance(probability: number): boolean;
};

/**
 * Seeded PRNG (mulberry32) with attached utility methods.
 * 
 * Usage:
 *   const rng = mulberry32(seed);
 *   const v1 = rng();               // 0.4521...
 *   const v2 = rng.intRange(1, 10); // 7
 *   const v3 = rng.pick(arr);       // random array element
 */
export function mulberry32(seed: number): RNG {
  let s = seed | 0;

  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // Attach utility methods to the function object
  rng.next = rng;
  
  rng.intRange = (min: number, max: number): number => {
    return Math.floor(rng() * (max - min + 1)) + min;
  };

  rng.range = (min: number, max: number): number => {
    return rng() * (max - min) + min;
  };

  rng.pick = <T>(arr: readonly T[]): T => {
    return arr[Math.floor(rng() * arr.length)];
  };

  rng.chance = (probability: number): boolean => {
    return rng() < probability;
  };

  return rng as RNG;
}

// ── Movement offsets (Moore neighbourhood + extended rings) ─────────────

export const MOVE_OFFSETS: Point[] = [
  { col: 0, row: 0 },
  { col: 0, row: -1 }, { col: 1, row: -1 },
  { col: 1, row: 0 },  { col: 1, row: 1 },
  { col: 0, row: 1 },  { col: -1, row: 1 },
  { col: -1, row: 0 }, { col: -1, row: -1 },
  // Ring-2
  { col: 0, row: -2 }, { col: 1, row: -2 }, { col: 2, row: -1 },
  { col: 2, row: 0 },  { col: 2, row: 1 },  { col: 1, row: 2 },
  { col: 0, row: 2 },  { col: -1, row: 2 }, { col: -2, row: 1 },
  { col: -2, row: 0 }, { col: -2, row: -1 }, { col: -1, row: -2 },
  // Ring-3 (selected)
  { col: 2, row: 2 },  { col: 2, row: -2 },
  { col: -2, row: -2 }, { col: -2, row: 2 },
  { col: 0, row: -3 }, { col: 1, row: -3 }, { col: 2, row: -3 },
  { col: 3, row: -2 }, { col: 3, row: -1 }, { col: 3, row: 0 },
  { col: 3, row: 1 },  { col: 3, row: 2 },  { col: 2, row: 3 },
  { col: 1, row: 3 },  { col: 0, row: 3 },  { col: -1, row: 3 },
  { col: -2, row: 3 }, { col: -3, row: 2 }, { col: -3, row: 1 },
  { col: -3, row: 0 }, { col: -3, row: -1 }, { col: -3, row: -2 },
  { col: -2, row: -3 }, { col: -1, row: -3 },
  { col: 3, row: 3 },  { col: 3, row: -3 },
  { col: -3, row: 3 }, { col: -3, row: -3 },
];

// ── Pure geometric helpers ──────────────────────────────────────────────

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

/**
 * Deterministic multi-octave hash noise in [0,1].  Hashing the integer
 * position keeps the noise reproducible across runs (unlike Math.random),
 * which is critical for terrain that must be identical for a given seed.
 */
export function hashNoise(col: number, row: number, salt = 0): number {
  const h =
    (Math.imul(col, 7919) ^
     Math.imul(row, 6271) ^
     Math.imul(salt, 104729)) >>> 0;
  return (h & 0xffffff) / 0xffffff;
}

// ── Terrain property tables ─────────────────────────────────────────────

/** Lower weight = more stubborn terrain (less likely to be smoothed away). */
export function terrainWeight(type: string): number {
  switch (type) {
    case TERRAIN_TYPES.OCEAN:      return 0;
    case TERRAIN_TYPES.RIVER:      return 0;
    case TERRAIN_TYPES.MOUNTAINS:  return 1;
    case TERRAIN_TYPES.ARCTIC:     return 1;
    case TERRAIN_TYPES.HILLS:      return 2;
    case TERRAIN_TYPES.FOREST:     return 3;
    case TERRAIN_TYPES.JUNGLE:     return 3;
    case TERRAIN_TYPES.TUNDRA:     return 3;
    case TERRAIN_TYPES.SWAMP:      return 3;
    case TERRAIN_TYPES.PLAINS:     return 4;
    case TERRAIN_TYPES.GRASSLAND:  return 4;
    case TERRAIN_TYPES.DESERT:     return 5;
    default:                       return 3;
  }
}

/** Civ1-style base yield (food*3 + trade + production) for a terrain type. */
export function baseYield(t: string): number {
  switch (t) {
    case TERRAIN_TYPES.GRASSLAND:  return 3 * 2 + 1 + 1;
    case TERRAIN_TYPES.PLAINS:     return 3 * 1 + 1 + 2;
    case TERRAIN_TYPES.FOREST:     return 3 * 1 + 0 + 4;
    case TERRAIN_TYPES.HILLS:      return 3 * 1 + 0 + 4;
    case TERRAIN_TYPES.MOUNTAINS:  return 3 * 0 + 0 + 2;
    case TERRAIN_TYPES.DESERT:     return 3 * 0 + 0 + 2;
    case TERRAIN_TYPES.TUNDRA:     return 3 * 1 + 0 + 0;
    case TERRAIN_TYPES.ARCTIC:     return 3 * 0 + 0 + 0;
    case TERRAIN_TYPES.JUNGLE:     return 3 * 1 + 0 + 0;
    case TERRAIN_TYPES.SWAMP:      return 3 * 1 + 0 + 0;
    case TERRAIN_TYPES.RIVER:      return 3 * 2 + 1 + 0;
    default:                       return 0;
  }
}

// ── Resource placement ──────────────────────────────────────────────────

/**
 * Civ1 resource placement: each terrain type has one associated resource.
 * Tiles flagged `hasSpecial` always receive one; otherwise ~15% chance.
 */
export function rollResource(terrain: string, hasSpecial: boolean): string | null {
  const name = TERRAIN_RESOURCES[terrain];
  if (!name) return null;
  if (hasSpecial) return name;
  return Math.random() < 0.15 ? name : null;
}

// ── Moisture application ────────────────────────────────────────────────

/**
 * Apply moisture to a tile, converting its terrain type to wetter
 * vegetation based on a continuous 0.0-1.0 moisture value.
 */
export function applyMoisture(
  cell: InternalTile,
  moisture: number, // 0.0 (bone dry) to 1.0 (torrential rain)
  latitude: number, // 0.0 at equator, 1.0 at poles
): void {
  // Arid regions (Deserts & Dry Plains)
  if (moisture < 0.3) {
    if (cell.type === TERRAIN_TYPES.GRASSLAND) cell.type = TERRAIN_TYPES.PLAINS;
    if (cell.type === TERRAIN_TYPES.PLAINS && latitude > 0.7) cell.type = TERRAIN_TYPES.TUNDRA;
    return;
  }

  // Semi-arid regions (Plains & Grasslands)
  if (moisture < 0.55) {
    if (cell.type === TERRAIN_TYPES.SWAMP) cell.type = TERRAIN_TYPES.GRASSLAND;
    return;
  }

  // Wet regions (Forests, Jungles, Swamps)
  switch (cell.type) {
    case TERRAIN_TYPES.DESERT:
      if (moisture > 0.7) cell.type = TERRAIN_TYPES.PLAINS;
      break;
    case TERRAIN_TYPES.PLAINS:
      if (moisture > 0.65) cell.type = TERRAIN_TYPES.GRASSLAND;
      break;
    case TERRAIN_TYPES.GRASSLAND:
      // Near equator: Jungle. Near poles: Swamp.
      if (moisture > 0.85) {
        cell.type = latitude < 0.35 ? TERRAIN_TYPES.JUNGLE : TERRAIN_TYPES.SWAMP;
      }
      break;
    case TERRAIN_TYPES.HILLS:
      if (moisture > 0.6) cell.type = TERRAIN_TYPES.FOREST;
      break;
    case TERRAIN_TYPES.SWAMP:
      if (moisture > 0.75) cell.type = TERRAIN_TYPES.FOREST;
      break;
    case TERRAIN_TYPES.MOUNTAINS:
      // Mountains block rain; leave them rocky unless extremely wet
      if (moisture > 0.9) cell.type = TERRAIN_TYPES.FOREST; 
      break;
  }
}

// ── Manhattan distance field (the heart of smooth territory) ───────────

/**
 * Multi-source BFS that computes the EXACT Manhattan distance from every
 * cell to the nearest "target" cell.
 *
 * Why BFS gives the true Manhattan field:
 *   Each 4-directional step contributes exactly +1 to the path length,
 *   and Manhattan distance is the L1 metric — the minimum number of
 *   orthogonal steps between two points.  BFS expands in concentric
 *   L1 "diamonds" around each source, so the first time a cell is
 *   reached it has its minimal Manhattan distance.
 *
 * This is both faster (O(N) vs O(N·W²) for windowed scans) and more
 * accurate than the previous ±4 window scan in stage1_Continents,
 * which clipped distances at 4 and produced jagged plateau boundaries.
 *
 * Column wrapping supports cylindrical maps.
 */
export function computeManhattanDistanceField(
  isTarget: (col: number, row: number) => boolean,
  width: number,
  height: number,
  wrapCol: (c: number) => number,
): number[][] {
  const field: number[][] = new Array(height);
  for (let r = 0; r < height; r++) {
    field[r] = new Array(width).fill(Infinity);
  }

  const queue: Point[] = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if (isTarget(c, r)) {
        field[r][c] = 0;
        queue.push({ col: c, row: r });
      }
    }
  }

  const dirs = [
    { col: 0, row: -1 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
  ];

  let head = 0;
  while (head < queue.length) {
    const { col, row } = queue[head++];
    const d = field[row][col];
    for (const d2 of dirs) {
      const nc = wrapCol(col + d2.col);
      const nr = row + d2.row;
      if (nr < 0 || nr >= height) continue;
      if (field[nr][nc] > d + 1) {
        field[nr][nc] = d + 1;
        queue.push({ col: nc, row: nr });
      }
    }
  }
  return field;
}

/**
 * 3×3 box-blur smoothing of a numeric field with column wrapping.
 * Smoothing the distance field before thresholding eliminates
 * single-tile spikes that produce jagged, unrealistic coastlines
 * and patchwork mountain ranges.
 */
export function smoothNumericField(
  field: number[][],
  width: number,
  height: number,
  wrapCol: (c: number) => number,
  iterations = 1,
): number[][] {
  let current = field;
  for (let iter = 0; iter < iterations; iter++) {
    const next: number[][] = new Array(height);
    for (let r = 0; r < height; r++) {
      next[r] = new Array(width);
      for (let c = 0; c < width; c++) {
        let sum = 0;
        let count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const nr = r + dr;
          if (nr < 0 || nr >= height) continue;
          for (let dc = -1; dc <= 1; dc++) {
            const nc = wrapCol(c + dc);
            sum += current[nr][nc];
            count++;
          }
        }
        next[r][c] = sum / count;
      }
    }
    current = next;
  }
  return current;
}

/**
 * Map a (smoothed) Manhattan distance-to-water value plus multi-octave
 * noise onto a terrain type, producing gradual elevation bands:
 *
 *   dist 1–2  → Plains        (coastal flats)
 *   dist 3–4  → Grassland     (lowland meadows)
 *   dist 5–6  → Hills          (rolling uplands)
 *   dist 7+   → Mountains     (continental spine)
 *
 * The noise term lets the band edges wander organically instead of
 * forming perfectly concentric rings around every coastline.
 */
export function elevationFromDistance(dist: number, noise: number): string {
  if (dist <= 0) return TERRAIN_TYPES.OCEAN;
  // Multi-octave noise shifts the effective distance by up to ±2.0.
  // Higher thresholds produce fewer mountains (3-5% of land typical).
  const eff = dist + (noise - 0.5) * 4;
  if (eff >= 9.0) return TERRAIN_TYPES.MOUNTAINS;
  if (eff >= 6.0) return TERRAIN_TYPES.HILLS;
  if (eff >= 3.0) return TERRAIN_TYPES.GRASSLAND;
  return TERRAIN_TYPES.PLAINS;
}

// ── Rain-shadow moisture simulation ──────────────────────────────

/**
 * Compute per-tile moisture using a directional rain-shadow model.
 * Prevailing wind blows W→E. Mountain/hill tiles block moisture,
 * creating dry leeward (eastern) slopes and wet windward (western) slopes.
 *
 * @param cells     2D row-major tile array
 * @param width     Map width
 * @param height    Map height
 * @param wrapCol   Column wrapping function
 * @returns         2D moisture field [row][col], values in [0, 1]
 */
export function rainShadowMoisture(
  cells: { type: string }[][],
  width: number,
  height: number,
  _wrapCol: (c: number) => number,
): number[][] {
  const moisture: number[][] = [];
  for (let r = 0; r < height; r++) {
    moisture[r] = new Array(width).fill(0);
  }

  for (let r = 0; r < height; r++) {
    // Each row starts with full moisture from the western ocean edge
    let counter = 1.0;

    // Left-to-right scan: wind carries moisture eastward
    for (let c = 0; c < width; c++) {
      const tile = cells[r][c];
      const terrain = tile.type;

      if (terrain === TERRAIN_TYPES.OCEAN || terrain === TERRAIN_TYPES.RIVER) {
        // Water resets moisture to maximum
        counter = 1.0;
      } else if (terrain === TERRAIN_TYPES.MOUNTAINS) {
        // Mountains reduce moisture — rain shadow effect (block ~40%)
        counter *= 0.60;
      } else if (terrain === TERRAIN_TYPES.HILLS) {
        // Hills slightly reduce moisture (block ~20%)
        counter *= 0.80;
      } else {
        // Land terrain: gradual moisture decay as wind crosses terrain
        counter *= 0.94;
      }

      counter = Math.max(0, Math.min(1, counter));
      moisture[r][c] = counter;
    }
  }

  return moisture;
}

// ── River pathfinding costs ──────────────────────────────────────

/**
 * Movement cost for river pathfinding (not unit movement).
 * Rivers naturally flow downhill through low-cost terrain,
 * avoiding mountains and following valleys.
 */
export function riverFlowCost(terrain: string): number {
  switch (terrain) {
    case TERRAIN_TYPES.OCEAN:     return 0.0;  // Free entry — goal tile
    case TERRAIN_TYPES.RIVER:     return 0.0;  // Free — already a river
    case TERRAIN_TYPES.PLAINS:    return 1.0;  // Easy downhill flow
    case TERRAIN_TYPES.GRASSLAND: return 1.0;  // Easy downhill flow
    case TERRAIN_TYPES.DESERT:    return 1.0;  // Easy flow (dry terrain)
    case TERRAIN_TYPES.TUNDRA:    return 1.0;  // Easy flow
    case TERRAIN_TYPES.HILLS:     return 1.5;  // Slightly harder but natural
    case TERRAIN_TYPES.FOREST:    return 2.0;  // Vegetation slows water
    case TERRAIN_TYPES.JUNGLE:    return 2.0;  // Dense vegetation
    case TERRAIN_TYPES.SWAMP:     return 2.0;  // Already wet, hard to carve
    case TERRAIN_TYPES.MOUNTAINS: return 5.0;  // Rivers avoid but can trickle through gaps
    case TERRAIN_TYPES.ARCTIC:    return 3.0;  // Frozen terrain
    default:                      return 1.0;
  }
}