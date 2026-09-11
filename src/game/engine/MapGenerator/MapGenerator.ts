/**
 * MapGenerator — Civ1-style procedural map generation.
 *
 * Refactored pipeline:
 *   1. Continents via ocean carving + Manhattan distance field
 *   2. Mountain cluster breaking + corridor guarantee
 *   3. Temperature (latitude-based biome zones)
 *   4. Climate with rain-shadow moisture (W→E prevailing wind)
 *   5. Age erosion (terrain evolution)
 *   6. Rivers via A* pathfinding to large water bodies
 *   7. Polar caps + special resources
 *   8. Flood-fill groups + build-site scoring
 *   9. Passability validation
 */

import { TERRAIN_TYPES } from '@/data/TerrainConstants';
import {
  type GenTile, type InternalTile, type MapGeneratorSettings,
  type MapGroup, type Point,
  GroupKind,
  MOVE_OFFSETS,
  mulberry32,
  rollResource, applyMoisture, baseYield,
  hashNoise, computeManhattanDistanceField, smoothNumericField,
  elevationFromDistance,
  rainShadowMoisture, riverFlowCost,
  RNG,
} from './MapGeneratorHelper';

// Predefined world maps are STATIC data files (src/data/maps/*.json, extracted
// from Freeciv savegames via scripts/extract-freeciv-map.mjs) instead of being
// hardcoded here.
import {
  WORLD_MAP,
  hasSpecialResource,
  terrainIdForChar,
  type StaticMapDefinition,
} from '@/data/maps';

export default class MapGenerator {
  // Parameters
  private readonly seed: number;
  private readonly width: number;
  private readonly height: number;
  private readonly landMass: number;
  private readonly temperature: number;
  private readonly climate: number;
  private readonly age: number;

  // Derived values
  private readonly yMedian: number;

  // Internal map storage (row-major: [row][col])
  private cells: InternalTile[][];
  private groups: MapGroup[] = [];

  constructor(settings: MapGeneratorSettings) {
    this.seed       = settings.seed ?? (Date.now() & 0x7fffffff);
    this.width      = settings.mapWidth;
    this.height     = settings.mapHeight;
    this.landMass     = Math.max(0, Math.min(2, settings.landMass ?? 1));
    this.temperature  = Math.max(0, Math.min(2, settings.temperature ?? 1));
    this.climate      = Math.max(0, Math.min(2, settings.climate ?? 1));
    this.age          = Math.max(0, Math.min(2, settings.age ?? 1));
    this.yMedian = this.height >> 1;

    this.cells = [];
    for (let row = 0; row < this.height; row++) {
      this.cells[row] = [];
      for (let col = 0; col < this.width; col++) {
        this.cells[row][col] = {
          col, row,
          type:    TERRAIN_TYPES.PLAINS,
          terrain: TERRAIN_TYPES.PLAINS,
          resource: null,
          visible: false, explored: false,
          groupId: -1, specialResource: false,
        };
      }
    }
  }

  // ── Coordinate helpers ──────────────────────────────────────────

  private isValid(col: number, row: number): boolean {
    return col >= 0 && col < this.width && row >= 0 && row < this.height;
  }

  private wrapCol(col: number): number {
    if (col < 0) col = Math.abs(col) % this.width;
    if (col >= this.width) col %= this.width;
    return col;
  }

  // ── Public API ───────────────────────────────────────────────────

  generate(): GenTile[] {
    const rng = mulberry32(this.seed);

    // Phase 1: Continent creation + mountain fixes
    this.stage1_Continents(rng);
    this.breakMountainClusters();
    this.ensureMountainCorridors();

    // Phase 3: Temperature + rain-shadow climate
    this.stage2_Temperature(rng);
    this.stage3_Climate(rng);

    // Phase 2: Age erosion
    this.stage4_Age(rng);

    // Phase 5: Pathfinding-based rivers
    this.stage5_Rivers(rng);

    // Polar caps + special resources
    this.stage6_PolarCaps(rng);
    this.stage6a_SpecialResources(rng);

    // Final cleanup: fill any remaining isolated ocean holes on land.
    // These stragglers come from river destinations or edge effects.
    this.fillIsolatedOceanHoles();

    // Groups + scoring + validation
    this.stage7_FloodFillGroups();
    this.stage8_BuildSites();
    this.ensurePassability();

    return this.toTileArray();
  }

  generateWaterOnly(): GenTile[] {
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        this.cells[row][col].type = TERRAIN_TYPES.OCEAN;
      }
    }
    this.stage6a_SpecialResources(mulberry32(this.seed + 9999));
    this.stage7_FloodFillGroups();
    return this.toTileArray();
  }

  /**
   * Generate the predefined WORLD map (Earth) from the static map data
   * (`src/data/maps/earth-180x90.json`, extracted from a Freeciv savegame).
   *
   * The source map defines the terrain; rivers are added procedurally (the
   * Freeciv map has none) and its "special" flags become bonus resources.
   * Groups, build sites and passability are computed like any other map.
   */
  generateEarth(): GenTile[] {
    if (!WORLD_MAP) {
      console.warn('[MapGenerator] No static world map registered — falling back to procedural generation');
      return this.generate();
    }

    const rng = mulberry32(this.seed);
    this.loadStaticMap(WORLD_MAP);

    // Add rivers via pathfinding (same as procedural generation)
    this.stage5_Rivers(rng);

    // Fill any isolated ocean holes
    this.fillIsolatedOceanHoles();

    // Compute groups, build sites, and passability
    this.stage7_FloodFillGroups();
    this.stage8_BuildSites();
    this.ensurePassability();

    return this.toTileArray();
  }

  /**
   * Copy a static map into the cell grid: the raw Freeciv characters become
   * this game's terrain ids, and the map's "special" layer flags bonus
   * resources (the equivalent of `stage6a_SpecialResources`). Tiles outside
   * the static map's bounds are filled with ocean so nothing leaks through.
   */
  private loadStaticMap(def: StaticMapDefinition): void {
    for (let row = 0; row < this.height; row++) {
      const line = row < def.height ? (def.rows[row] ?? '') : '';
      const specials = row < def.height ? (def.specials?.[row] ?? '') : '';
      for (let col = 0; col < this.width; col++) {
        const cell = this.cells[row][col];
        const inBounds = row < def.height && col < def.width && line.length > 0;
        const terrain = inBounds ? terrainIdForChar(line[col]) : TERRAIN_TYPES.OCEAN;
        cell.type = terrain;
        cell.terrain = terrain;
        cell.specialResource = inBounds
          && terrain !== TERRAIN_TYPES.OCEAN
          && hasSpecialResource(specials[col]);
      }
    }
  }

  // ── Stage 1 — Continent creation ────────────────────────────────

  private stage1_Continents(rng: () => number): void {
    const totalCells = this.width * this.height;

    for (let col = 0; col < this.width; col++) {
      this.cells[0][col].type = TERRAIN_TYPES.OCEAN;
      this.cells[this.height - 1][col].type = TERRAIN_TYPES.OCEAN;
    }

    // Scale ocean features with map size — large maps need more water
    const mapScale = Math.max(1, Math.floor((this.width * this.height) / (50 * 50)));

    // Horizontal ocean straits — count scales with land mass AND map size
    const numHStraits = Math.max(0, Math.floor((2 - this.landMass) * mapScale * 0.6) + (rng() < 0.3 ? 1 : 0));
    for (let s = 0; s < numHStraits; s++) {
      let baseRow = 3 + Math.floor(rng() * Math.max(1, this.height - 6));
      const bandWidth = 1 + Math.floor(rng() * 2);
      for (let c = 0; c < this.width; c++) {
        // Meander: shift the row ±1 every few columns
        if (c % 3 === 0) baseRow += Math.floor(rng() * 3) - 1;
        baseRow = Math.max(3, Math.min(this.height - 2, baseRow));
        for (let dr = 0; dr < bandWidth; dr++) {
          const r = baseRow + dr;
          if (r >= 3 && r < this.height - 1) this.cells[r][c].type = TERRAIN_TYPES.OCEAN;
        }
      }
    }

    // Vertical ocean straits — count scales with land mass AND map size
    const numVStraits = Math.max(0, Math.floor((2 - this.landMass) * mapScale * 0.5) + (rng() < 0.2 ? 1 : 0));
    for (let s = 0; s < numVStraits; s++) {
      let baseCol = Math.floor(rng() * this.width);
      const bandWidth = 1;
      for (let r = 3; r < this.height - 1; r++) {
        // Meander: shift the column ±1 every few rows
        if (r % 3 === 0) baseCol = this.wrapCol(baseCol + Math.floor(rng() * 3) - 1);
        for (let dc = 0; dc < bandWidth; dc++) {
          const cc = this.wrapCol(baseCol + dc);
          this.cells[r][cc].type = TERRAIN_TYPES.OCEAN;
        }
      }
    }

    // Land mass controls land vs ocean ratio — STRONG effect:
    //   landMass 0: ~8% land (sparse islands in vast ocean)
    //   landMass 1: ~45% land (normal — balanced continents)
    //   landMass 2: ~70% land (pangea — massive connected land)
    const landFraction = 0.08 + this.landMass * 0.31;
    // Sparse islands: many small blobs for scattered archipelago feel
    const blobSize = this.landMass === 0 ? 4 : 4 + this.landMass * 4; // 4 / 8 / 12
    const blobDivisor = this.landMass === 0 ? 60 : 40 + this.landMass * 20;
    const oceanBlobs = Math.floor(totalCells * (1 - landFraction) / blobDivisor) * mapScale;
    for (let b = 0; b < oceanBlobs; b++) {
      let col = Math.floor(rng() * this.width);
      let row = 3 + Math.floor(rng() * Math.max(1, this.height - 6));
      const curBlobSize = blobSize + Math.floor(rng() * blobSize);
      for (let i = 0; i < curBlobSize; i++) {
        if (row >= 3 && row < this.height - 1) {
          this.cells[row][col].type = TERRAIN_TYPES.OCEAN;
        }
        switch (Math.floor(rng() * 4)) {
          case 0: col = this.wrapCol(col - 1); break;
          case 1: col = this.wrapCol(col + 1); break;
          case 2: row++; break;
          case 3: row--; break;
        }
      }
    }

    const centerCol = this.width >> 1;
    const centerRow = this.height >> 1;
    const protectR = Math.max(2, Math.floor(Math.min(this.width, this.height) / 6));
    for (let dr = -protectR; dr <= protectR; dr++) {
      for (let dc = -protectR; dc <= protectR; dc++) {
        const nr = centerRow + dr;
        const nc = this.wrapCol(centerCol + dc);
        if (this.isValid(nc, nr) && this.cells[nr][nc].type === TERRAIN_TYPES.OCEAN) {
          this.cells[nr][nc].type = TERRAIN_TYPES.PLAINS;
        }
      }
    }

    const rawDist = computeManhattanDistanceField(
      (c, r) => this.cells[r][c].type === TERRAIN_TYPES.OCEAN,
      this.width, this.height,
      (c) => this.wrapCol(c),
    );
    const distField = smoothNumericField(
      rawDist, this.width, this.height,
      (c) => this.wrapCol(c), 2,
    );

    for (let r = 1; r < this.height - 1; r++) {
      for (let c = 0; c < this.width; c++) {
        if (this.cells[r][c].type === TERRAIN_TYPES.OCEAN) continue;

        const n1 = hashNoise(c, r, 0);
        const n2 = hashNoise(c >> 1, r >> 1, 1);
        const n3 = hashNoise(c >> 2, r >> 2, 2);
        const n4 = hashNoise(c >> 3, r >> 3, 3);
        const noise = (n1 * 1.0 + n2 * 0.5 + n3 * 0.25 + n4 * 0.125) / 1.875;

        this.cells[r][c].type = elevationFromDistance(distField[r][c], noise);
      }
    }

    this.smoothCoastlines();

    // Pathfinding-based mountain ridges: walk along high-elevation crests
    this.generateMountainRidges(rng, distField);
  }

  // ── Coastline smoothing ──────────────────────────────────────────

  private smoothCoastlines(): void {
    const cardinals = [
      { col: 0, row: -1 }, { col: 1, row: 0 },
      { col: 0, row: 1 },  { col: -1, row: 0 },
    ];

    for (let iter = 0; iter < 2; iter++) {
      const distToWater = computeManhattanDistanceField(
        (c, r) => this.cells[r][c].type === TERRAIN_TYPES.OCEAN,
        this.width, this.height, (c) => this.wrapCol(c),
      );

      for (let r = 1; r < this.height - 1; r++) {
        for (let c = 0; c < this.width; c++) {
          const cell = this.cells[r][c];

          // Fill isolated ocean holes: ocean tiles surrounded by ≥ 3 land tiles.
          // This catches single-tile holes (distToLand=1) that the old dist≥2
          // check missed, plus small 2-3 tile pockets.
          if (cell.type === TERRAIN_TYPES.OCEAN) {
            let landN = 0;
            for (const d of cardinals) {
              const nr = r + d.row;
              if (nr < 0 || nr >= this.height) continue;
              if (this.cells[nr][this.wrapCol(c + d.col)].type !== TERRAIN_TYPES.OCEAN) landN++;
            }
            if (landN >= 3) cell.type = TERRAIN_TYPES.PLAINS;
            continue;
          }

          if (cell.type !== TERRAIN_TYPES.OCEAN && distToWater[r][c] === 1) {
            let waterN = 0;
            for (const d of cardinals) {
              const nr = r + d.row;
              if (nr < 0 || nr >= this.height) continue;
              if (this.cells[nr][this.wrapCol(c + d.col)].type === TERRAIN_TYPES.OCEAN) waterN++;
            }
            if (waterN >= 3) cell.type = TERRAIN_TYPES.OCEAN;
          }
        }
      }
    }
  }

  // ── Pathfinding-based mountain ridges ──────────────────────────

  /**
   * Generate mountain ranges using pathfinding along high-elevation
   * crests. Instead of random blobs, mountains form connected ridges
   * that follow the natural terrain contours — like real mountain chains.
   *
   * Algorithm:
   *   1. Identify "ridge-worthy" tiles (high elevation, not ocean/river)
   *   2. Pick random seed points from these tiles
   *   3. Walk from each seed along the highest-elevation neighbor,
   *      preferring to stay on high ground and avoiding sharp turns
   *   4. Mark walked tiles as mountains
   */
  private generateMountainRidges(rng: () => number, distField: number[][]): void {
    // Find tiles with high enough elevation for mountains
    // (eff 7.0+ is just below the mountain threshold of 9.0)
    const ridgeCandidates: Point[] = [];
    for (let r = 1; r < this.height - 1; r++) {
      for (let c = 0; c < this.width; c++) {
        const t = this.cells[r][c].type;
        if (t === TERRAIN_TYPES.OCEAN || t === TERRAIN_TYPES.RIVER) continue;
        // Use the distance field + noise to estimate elevation
        const n1 = hashNoise(c, r, 0);
        const n2 = hashNoise(c >> 1, r >> 1, 1);
        const n3 = hashNoise(c >> 2, r >> 2, 2);
        const n4 = hashNoise(c >> 3, r >> 3, 3);
        const noise = (n1 * 1.0 + n2 * 0.5 + n3 * 0.25 + n4 * 0.125) / 1.875;
        const eff = distField[r][c] + (noise - 0.5) * 4;
        if (eff >= 6.5) { // High enough for mountain ridges
          ridgeCandidates.push({ col: c, row: r });
        }
      }
    }
    if (ridgeCandidates.length === 0) return;

    // Number of ridge systems scales with map size
    const numRidges = Math.floor(ridgeCandidates.length / 80) + 2;
    const ridgeDirs = [
      { col: -1, row: 0 }, { col: 1, row: 0 },
      { col: 0, row: -1 }, { col: 0, row: 1 },
      { col: -1, row: -1 }, { col: 1, row: -1 },
      { col: -1, row: 1 }, { col: 1, row: 1 },
    ];

    for (let ri = 0; ri < numRidges; ri++) {
      // Pick a random seed from high-elevation candidates
      const seed = ridgeCandidates[Math.floor(rng() * ridgeCandidates.length)];

      // Walk the ridge: greedy pathfinding along high ground
      let curCol = seed.col;
      let curRow = seed.row;
      let prevDirIdx = Math.floor(rng() * 4); // random initial direction
      const ridgeLen = 8 + Math.floor(rng() * 12); // 8-19 tiles per ridge

      for (let step = 0; step < ridgeLen; step++) {
        if (!this.isValid(curCol, curRow)) break;
        const cell = this.cells[curRow][curCol];
        if (cell.type === TERRAIN_TYPES.OCEAN || cell.type === TERRAIN_TYPES.RIVER) break;

        // Place mountain (or keep existing mountain/hill)
        if (cell.type !== TERRAIN_TYPES.MOUNTAINS) {
          cell.type = TERRAIN_TYPES.HILLS; // base: hills
        }

        // Find best next step: prefer high elevation + similar direction
        let bestDir = prevDirIdx;
        let bestScore = -Infinity;
        for (let di = 0; di < 8; di++) {
          const d = ridgeDirs[di];
          const nc = this.wrapCol(curCol + d.col);
          const nr = curRow + d.row;
          if (!this.isValid(nc, nr)) continue;
          const nt = this.cells[nr][nc].type;
          if (nt === TERRAIN_TYPES.OCEAN || nt === TERRAIN_TYPES.RIVER) continue;

          // Elevation score: prefer high ground
          const n = distField[nr][nc];
          const elevScore = n * 2;

          // Direction continuity: prefer straight or gentle curves
          const dirDiff = Math.abs(di - prevDirIdx);
          const turnCost = dirDiff <= 1 ? 0 : dirDiff <= 2 ? -1 : -3;

          // Avoid revisiting mountains we already placed
          const existingPenalty = nt === TERRAIN_TYPES.MOUNTAINS ? -2 : 0;

          const score = elevScore + turnCost + existingPenalty + rng() * 2;
          if (score > bestScore) {
            bestScore = score;
            bestDir = di;
          }
        }

        // Move to best neighbor
        const d = ridgeDirs[bestDir];
        curCol = this.wrapCol(curCol + d.col);
        curRow += d.row;
        prevDirIdx = bestDir;
      }

      // Upgrade the center tiles of the ridge to mountains
      // (hills on edges, mountains in core)
      let cx = seed.col, cy = seed.row;
      let pd = Math.floor(rng() * 4);
      for (let step = 0; step < ridgeLen; step++) {
        if (!this.isValid(cx, cy)) break;
        const cell = this.cells[cy][cx];
        if (cell.type === TERRAIN_TYPES.HILLS) {
          cell.type = TERRAIN_TYPES.MOUNTAINS;
        }
        const d = ridgeDirs[pd];
        cx = this.wrapCol(cx + d.col);
        cy += d.row;
        // Occasionally change direction for natural curves
        if (rng() < 0.3) pd = (pd + (rng() < 0.5 ? 1 : 7)) % 8;
      }
    }
  }

  // ── Phase 1: Mountain cluster breaking ───────────────────────────

  private breakMountainClusters(): void {
    const visited: boolean[][] = [];
    for (let r = 0; r < this.height; r++) {
      visited[r] = new Array(this.width).fill(false);
    }

    const dirs = [
      { col: 0, row: -1 }, { col: 1, row: -1 }, { col: 1, row: 0 }, { col: 1, row: 1 },
      { col: 0, row: 1 },  { col: -1, row: 1 }, { col: -1, row: 0 }, { col: -1, row: -1 },
    ];

    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (visited[r][c] || this.cells[r][c].type !== TERRAIN_TYPES.MOUNTAINS) continue;

        const component: Point[] = [];
        const queue: Point[] = [{ col: c, row: r }];
        visited[r][c] = true;

        while (queue.length > 0) {
          const pos = queue.shift()!;
          component.push(pos);
          for (const d of dirs) {
            const nc = this.wrapCol(pos.col + d.col);
            const nr = pos.row + d.row;
            if (!this.isValid(nc, nr) || visited[nr][nc]) continue;
            if (this.cells[nr][nc].type !== TERRAIN_TYPES.MOUNTAINS) continue;
            visited[nr][nc] = true;
            queue.push({ col: nc, row: nr });
          }
        }

        if (component.length > 8) {
          // Gentle cleanup: only break very large clusters left over from
          // the ridge generation. Convert edge tiles to hills.
          const fraction = component.length > 15 ? 0.5 : 0.3;
          const convertCount = Math.floor(component.length * fraction);
          // Convert from edges (most non-mountain neighbors)
          const scored = component.map(p => {
            let nCount = 0;
            for (const dd of dirs) {
              const nc2 = this.wrapCol(p.col + dd.col);
              const nr2 = p.row + dd.row;
              if (this.isValid(nc2, nr2) && this.cells[nr2][nc2].type !== TERRAIN_TYPES.MOUNTAINS) nCount++;
            }
            return { ...p, nCount };
          });
          scored.sort((a, b) => b.nCount - a.nCount);
          for (let i = 0; i < convertCount && i < scored.length; i++) {
            this.cells[scored[i].row][scored[i].col].type = TERRAIN_TYPES.HILLS;
          }
        }
      }
    }

    this.capMountainPercentage(0.04);
  }

  private capMountainPercentage(maxFraction: number): void {
    for (let iter = 0; iter < 20; iter++) {
      let landCount = 0;
      let mountainCount = 0;
      for (let r = 0; r < this.height; r++) {
        for (let c = 0; c < this.width; c++) {
          const t = this.cells[r][c].type;
          if (t === TERRAIN_TYPES.OCEAN) continue;
          landCount++;
          if (t === TERRAIN_TYPES.MOUNTAINS) mountainCount++;
        }
      }
      if (mountainCount <= landCount * maxFraction) break;

      const candidates: { col: number; row: number; hillNeighbors: number }[] = [];
      for (let r = 0; r < this.height; r++) {
        for (let c = 0; c < this.width; c++) {
          if (this.cells[r][c].type !== TERRAIN_TYPES.MOUNTAINS) continue;
          let hillN = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = this.wrapCol(c + dc);
              if (this.isValid(nc, nr) && this.cells[nr][nc].type === TERRAIN_TYPES.HILLS) hillN++;
            }
          }
          candidates.push({ col: c, row: r, hillNeighbors: hillN });
        }
      }

      candidates.sort((a, b) => b.hillNeighbors - a.hillNeighbors);

      const excess = mountainCount - Math.floor(landCount * maxFraction);
      for (let i = 0; i < excess && i < candidates.length; i++) {
        const { col, row } = candidates[i];
        this.cells[row][col].type = TERRAIN_TYPES.HILLS;
      }
    }
  }

  // ── Phase 4: Mountain corridor guarantee ──────────────────────────

  private ensureMountainCorridors(): void {
    for (let r = 2; r < this.height - 2; r++) {
      let mountainRun = 0;
      for (let c = 0; c < this.width; c++) {
        if (this.cells[r][c].type === TERRAIN_TYPES.MOUNTAINS) {
          mountainRun++;
        } else {
          if (mountainRun >= 6) {
            const mid = c - Math.floor(mountainRun / 2);
            for (let i = -1; i <= 1; i++) {
              const nc = this.wrapCol(mid + i);
              if (this.isValid(nc, r) && this.cells[r][nc].type === TERRAIN_TYPES.MOUNTAINS) {
                this.cells[r][nc].type = TERRAIN_TYPES.HILLS;
              }
            }
          }
          mountainRun = 0;
        }
      }
    }

    for (let c = 2; c < this.width - 2; c++) {
      let mountainRun = 0;
      for (let r = 0; r < this.height; r++) {
        if (this.cells[r][c].type === TERRAIN_TYPES.MOUNTAINS) {
          mountainRun++;
        } else {
          if (mountainRun >= 6) {
            const mid = r - Math.floor(mountainRun / 2);
            for (let i = -1; i <= 1; i++) {
              const nr = mid + i;
              if (this.isValid(c, nr) && this.cells[nr][c].type === TERRAIN_TYPES.MOUNTAINS) {
                this.cells[nr][c].type = TERRAIN_TYPES.HILLS;
              }
            }
          }
          mountainRun = 0;
        }
      }
    }
  }

  // ── Stage 2 — Temperature ───────────────────────────────────────

  private stage2_Temperature(rng: () => number): void {
    const yMedian = this.yMedian + Math.floor((this.width * this.height) / 500 / 2);

    // Temperature setting shifts ALL biome boundaries:
    //   0 (Ice Age): tundra/arctic dominates, almost no desert
    //   1 (Normal): balanced distribution
    //   2 (Greenhouse): desert expands, tundra retreats to poles
    // Temperature shifts biome boundaries STRONGLY:
    //   0 (Ice Age): -0.50 → arctic/tundra dominates, tiny desert band
    //   1 (Normal): 0.00 → balanced distribution
    //   2 (Greenhouse): +0.50 → desert expands, tundra retreats to poles
    const tempShift = (this.temperature - 0.8) * 0.50;

    // Adaptive thresholds: temperature setting moves biome boundaries
    const desertThreshold = 0.85 - tempShift * 0.20;
    const plainsThreshold = 0.55 - tempShift * 0.15;
    const grassThreshold  = 0.35 - tempShift * 0.10;
    const tundraThreshold = 0.18 + tempShift * 0.05;

    // Desert probability: scales with temperature
    const desertProb = 0.05 + this.temperature * 0.20; // 5% / 25% / 45%

    for (let row = 0; row < this.height; row++) {
      const latDist = Math.abs(row - yMedian) / (yMedian || 1);
      const latFactor = Math.max(0, 1.0 - Math.pow(latDist, 1.3));

      for (let col = 0; col < this.width; col++) {
        const tile = this.cells[row][col];
        if (tile.type !== TERRAIN_TYPES.PLAINS) continue;

        // Lock ONLY the outermost rows to arctic — max 2 rows total.
        // Row 0 and height-1 are arctic. Row 1 and height-2 go through
        // normal temperature processing (may become tundra/plains).
        if (row === 0 || row === this.height - 1) {
          tile.type = TERRAIN_TYPES.ARCTIC;
          continue;
        }

        // Multi-octave noise to break up uniform temperature bands
        const macroNoise  = hashNoise(col >> 2, row >> 2, 101);
        const detailNoise = hashNoise(col, row, 202);
        const microNoise  = hashNoise(col * 3, row * 3, 303);
        const tempNoise   = (macroNoise * 0.5 + detailNoise * 0.3 + microNoise * 0.2 - 0.5) * 0.55;

        let temp = latFactor + tempNoise + tempShift;
        temp = Math.max(0, Math.min(1, temp));

        if (temp > desertThreshold) {
          if (rng() < desertProb) {
            tile.type = TERRAIN_TYPES.DESERT;
          }
        } else if (temp > plainsThreshold) {
          tile.type = TERRAIN_TYPES.PLAINS;
        } else if (temp > grassThreshold) {
          tile.type = TERRAIN_TYPES.GRASSLAND;
        } else if (temp > tundraThreshold) {
          // Tundra: probabilistic mix with plains for natural transition.
          // Closer to poles (lower latFactor) = more tundra; toward equator = more plains.
          const tundraProb = Math.max(0.2, 1.0 - latFactor * 1.5);
          tile.type = rng() < tundraProb ? TERRAIN_TYPES.TUNDRA : TERRAIN_TYPES.PLAINS;
        } else {
          tile.type = TERRAIN_TYPES.ARCTIC;
        }
      }
    }

    // Adaptive desert cap: cold maps get less desert, hot maps get more
    const desertCap = 0.02 + this.temperature * 0.03; // 2% / 5% / 8%
    this.capDesertPercentage(desertCap);
  }

  /**
   * Cap total desert tiles as a percentage of land.
   * Converts excess desert to plains (closest biome).
   */
  private capDesertPercentage(maxFraction: number): void {
    for (let iter = 0; iter < 10; iter++) {
      let landCount = 0;
      let desertCount = 0;
      for (let r = 0; r < this.height; r++) {
        for (let c = 0; c < this.width; c++) {
          const t = this.cells[r][c].type;
          if (t === TERRAIN_TYPES.OCEAN) continue;
          landCount++;
          if (t === TERRAIN_TYPES.DESERT) desertCount++;
        }
      }
      if (desertCount <= landCount * maxFraction) break;

      // Convert excess desert tiles to plains, preferring those with
      // non-desert neighbors (creates more natural edges)
      const candidates: { col: number; row: number; nonDesertN: number }[] = [];
      for (let r = 0; r < this.height; r++) {
        for (let c = 0; c < this.width; c++) {
          if (this.cells[r][c].type !== TERRAIN_TYPES.DESERT) continue;
          let nCount = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = this.wrapCol(c + dc);
              if (this.isValid(nc, nr) && this.cells[nr][nc].type !== TERRAIN_TYPES.DESERT) nCount++;
            }
          }
          candidates.push({ col: c, row: r, nonDesertN: nCount });
        }
      }

      // Convert tiles with most non-desert neighbors first (natural edges)
      candidates.sort((a, b) => b.nonDesertN - a.nonDesertN);

      const excess = desertCount - Math.floor(landCount * maxFraction);
      for (let i = 0; i < excess && i < candidates.length; i++) {
        const { col, row } = candidates[i];
        this.cells[row][col].type = TERRAIN_TYPES.PLAINS;
      }
    }
  }

  // ── Stage 3 — Climate (rain-shadow moisture) ─────────────────────

  private stage3_Climate(_rng: RNG): void {
    const rainShadow = rainShadowMoisture(
      this.cells, this.width, this.height,
      (c) => this.wrapCol(c),
    );

    // Climate modulates the rain shadow effect STRONGLY:
    //   arid (0): mountains block 50% more → sharp dry shadows
    //   normal (1): no change
    //   tropical (2): mountains block 50% less → moisture penetrates deep
    const shadowMod = 1.0 + (this.climate - 1) * 0.35;  // 0.65 / 1.0 / 1.35
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        rainShadow[r][c] = Math.max(0, Math.min(1, rainShadow[r][c] * shadowMod));
      }
    }

    const rawDist = computeManhattanDistanceField(
      (c, r) => this.cells[r][c].type === TERRAIN_TYPES.OCEAN,
      this.width, this.height,
      (c) => this.wrapCol(c),
    );
    const distField = smoothNumericField(
      rawDist, this.width, this.height,
      (c) => this.wrapCol(c), 2,
    );
    let maxDist = 0;
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (this.cells[r][c].type !== TERRAIN_TYPES.OCEAN) {
          maxDist = Math.max(maxDist, distField[r][c]);
        }
      }
    }
    const safeMaxDist = Math.max(1, maxDist);

    // Climate setting STRONGLY affects moisture:
    //   0 (Arid): very dry → desert/plains dominate, minimal forest
    //   1 (Normal): balanced → mixed vegetation
    //   2 (Tropical): very wet → forest/jungle dominate, minimal desert
    const baseMoisture = 0.08 + this.climate * 0.22;      // 0.08 / 0.30 / 0.52
    const climateBoost = (this.climate - 1) * 0.45;        // -0.45 / 0 / +0.45

    for (let r = 0; r < this.height; r++) {
      const latNorm = Math.abs(r - this.yMedian) / (this.yMedian || 1);
      const latitudeFactor = 1.0 - (latNorm * 0.8);

      for (let c = 0; c < this.width; c++) {
        const cell = this.cells[r][c];
        if (cell.type === TERRAIN_TYPES.OCEAN || cell.type === TERRAIN_TYPES.RIVER) continue;

        const distFactor = 1.0 - (distField[r][c] / safeMaxDist);

        const n1 = hashNoise(c, r, 777);
        const n2 = hashNoise(c >> 1, r >> 1, 888);
        const noise = ((n1 * 0.6) + (n2 * 0.4) - 0.5) * 0.5;

        let moisture =
          rainShadow[r][c] * 0.40 +
          distFactor * 0.15 +
          latitudeFactor * 0.15 +
          baseMoisture +
          climateBoost +
          noise;

        moisture = Math.max(0, Math.min(1, moisture));

        applyMoisture(cell, moisture, latNorm);
      }
    }
  }

  // ── Stage 4 — Age erosion ───────────────────────────────────────

  private stage4_Age(rng: () => number): void {
    const totalCells = this.width * this.height;
    const passes = Math.floor(totalCells / 8) + Math.floor((totalCells / 8) * this.age * 0.3);
    let col = 0, row = 0;
    for (let i = 0; i < passes; i++) {
      if (i & 1) {
        const off = MOVE_OFFSETS[1 + Math.floor(rng() * 8)];
        col += off.col; row += off.row;
      } else {
        col = Math.floor(rng() * this.width);
        row = Math.floor(rng() * this.height);
      }
      if (!this.isValid(col, row)) continue;
      const cell = this.cells[row][col];
      const roll = rng();
      switch (cell.type) {
        case TERRAIN_TYPES.FOREST:    if (roll < 0.3) cell.type = TERRAIN_TYPES.JUNGLE; break;
        case TERRAIN_TYPES.SWAMP:     cell.type = TERRAIN_TYPES.GRASSLAND; break;
        case TERRAIN_TYPES.RIVER:     break;
        case TERRAIN_TYPES.PLAINS:
        case TERRAIN_TYPES.TUNDRA:    if (roll < 0.15) cell.type = TERRAIN_TYPES.HILLS; break;
        case TERRAIN_TYPES.GRASSLAND: if (roll < 0.4) cell.type = TERRAIN_TYPES.FOREST; break;
        case TERRAIN_TYPES.JUNGLE:    if (roll < 0.3) cell.type = TERRAIN_TYPES.SWAMP; break;
        case TERRAIN_TYPES.HILLS:     if (roll < 0.1) cell.type = TERRAIN_TYPES.MOUNTAINS; break;
        case TERRAIN_TYPES.ARCTIC:    if (roll < 0.03) cell.type = TERRAIN_TYPES.MOUNTAINS; break;
        case TERRAIN_TYPES.MOUNTAINS:
          if (this.isValid(col - 1, row - 1) && this.isValid(col + 1, row + 1) &&
              this.cells[row - 1][col - 1].type === TERRAIN_TYPES.OCEAN &&
              this.cells[row + 1][col - 1].type === TERRAIN_TYPES.OCEAN &&
              this.cells[row - 1][col + 1].type === TERRAIN_TYPES.OCEAN &&
              this.cells[row + 1][col + 1].type === TERRAIN_TYPES.OCEAN) {
            cell.type = TERRAIN_TYPES.OCEAN;
          }
          break;
        case TERRAIN_TYPES.DESERT:    cell.type = TERRAIN_TYPES.PLAINS; break;
      }
    }
  }

  // ── Stage 5 — Rivers (pathfinding-based) ─────────────────────────

  private stage5_Rivers(rng: () => number): void {
    const maxRivers = ((this.landMass + this.climate) * 2) + 6;
    const largeWaterTiles = this.findLargeWaterBodies();
    if (largeWaterTiles.size === 0) return;

    const hillTiles: Point[] = [];
    for (let r = 2; r < this.height - 2; r++) {
      for (let c = 0; c < this.width; c++) {
        const t = this.cells[r][c].type;
        if (t === TERRAIN_TYPES.HILLS || t === TERRAIN_TYPES.MOUNTAINS) {
          hillTiles.push({ col: c, row: r });
        }
      }
    }
    if (hillTiles.length === 0) return;

    for (let i = hillTiles.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [hillTiles[i], hillTiles[j]] = [hillTiles[j], hillTiles[i]];
    }

    let placed = 0;
    for (let attempt = 0; attempt < hillTiles.length && placed < maxRivers; attempt++) {
      const source = hillTiles[attempt];

      let nearestWater: Point | null = null;
      let nearestDist = Infinity;
      for (const wt of largeWaterTiles) {
        const dist = Math.abs(source.col - wt.col) + Math.abs(source.row - wt.row);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestWater = wt;
        }
      }
      if (!nearestWater || nearestDist < 5) continue;

      const path = this.findRiverPath(source, nearestWater);
      if (!path || path.length < 5) continue;

      for (const p of path) {
        if (this.cells[p.row][p.col].type !== TERRAIN_TYPES.OCEAN &&
            this.cells[p.row][p.col].type !== TERRAIN_TYPES.RIVER) {
          this.cells[p.row][p.col].type = TERRAIN_TYPES.RIVER;
        }
      }

      for (let k = 1; k < 22; k++) {
        const off = MOVE_OFFSETS[k];
        const nc = this.wrapCol(source.col + off.col);
        const nr = source.row + off.row;
        if (this.isValid(nc, nr) && this.cells[nr][nc].type === TERRAIN_TYPES.FOREST) {
          this.cells[nr][nc].type = TERRAIN_TYPES.JUNGLE;
        }
      }

      placed++;
    }
  }

  private findLargeWaterBodies(): Set<Point> {
    const visited: boolean[][] = [];
    for (let r = 0; r < this.height; r++) {
      visited[r] = new Array(this.width).fill(false);
    }

    const largeWaterTiles = new Set<Point>();
    const cardinals = [
      { col: 0, row: -1 }, { col: 1, row: 0 },
      { col: 0, row: 1 },  { col: -1, row: 0 },
    ];

    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (visited[r][c] || this.cells[r][c].type !== TERRAIN_TYPES.OCEAN) continue;

        const component: Point[] = [];
        const queue: Point[] = [{ col: c, row: r }];
        visited[r][c] = true;

        while (queue.length > 0) {
          const pos = queue.shift()!;
          component.push(pos);
          for (const d of cardinals) {
            const nc = this.wrapCol(pos.col + d.col);
            const nr = pos.row + d.row;
            if (!this.isValid(nc, nr) || visited[nr][nc]) continue;
            if (this.cells[nr][nc].type !== TERRAIN_TYPES.OCEAN) continue;
            visited[nr][nc] = true;
            queue.push({ col: nc, row: nr });
          }
        }

        // A "large" water body: ≥ 12 tiles (roughly 4×3). We use tile count
        // instead of bounding box because column wrapping makes bbox width
        // unreliable (e.g. cols 78,79,0,1 on width-80 map → bboxW=80).
        if (component.length >= 12) {
          for (const p of component) largeWaterTiles.add(p);
        }
      }
    }

    return largeWaterTiles;
  }

  private findRiverPath(source: Point, dest: Point): Point[] | null {
    // Tracks direction to penalize sharp turns — rivers meander naturally
    interface RiverNode {
      col: number;
      row: number;
      g: number;
      h: number;
      f: number;
      parent: RiverNode | null;
      prevDir: number; // index into neighbors array (-1 for start)
    }

    const openSet: RiverNode[] = [];
    const closedSet = new Set<string>();

    const h = Math.abs(source.col - dest.col) + Math.abs(source.row - dest.row);
    const startNode: RiverNode = { col: source.col, row: source.row, g: 0, h, f: h, parent: null, prevDir: -1 };
    openSet.push(startNode);

    const nodeMap = new Map<string, RiverNode>();
    nodeMap.set(`${source.col},${source.row}`, startNode);

    while (openSet.length > 0) {
      openSet.sort((a, b) => a.f - b.f);
      const current = openSet.shift()!;
      const currentKey = `${current.col},${current.row}`;

      if (current.col === dest.col && current.row === dest.row) {
        const path: Point[] = [];
        let node: RiverNode | null = current;
        while (node) {
          path.unshift({ col: node.col, row: node.row });
          node = node.parent;
        }
        return path;
      }

      closedSet.add(currentKey);

      // Cardinal ONLY — rivers must not use diagonals (creates gaps)
      const neighbors = [
        { col: current.col - 1, row: current.row },  // West
        { col: current.col + 1, row: current.row },  // East
        { col: current.col, row: current.row - 1 },  // North
        { col: current.col, row: current.row + 1 },  // South
      ];

      for (let ni = 0; ni < neighbors.length; ni++) {
        const neighbor = neighbors[ni];
        // Rivers must NOT wrap around map edges — stay within bounds
        const nc = neighbor.col;
        const nr = neighbor.row;
        if (nc < 0 || nc >= this.width || nr < 0 || nr >= this.height) continue;

        const neighborKey = `${nc},${nr}`;
        if (closedSet.has(neighborKey)) continue;

        const terrain = this.cells[nr][nc].type;
        let cost = riverFlowCost(terrain);

        // Turn penalty: rivers meander smoothly, avoiding sharp zigzags.
        // Same direction = 0, 45° turn = 0.3, 90° turn = 0.8, 135°+ = 1.5
        if (current.prevDir >= 0) {
          const angleDiff = Math.abs(ni - current.prevDir);
          if (angleDiff === 1 || angleDiff === 3) cost += 0.8;      // 90° — one cardinal turn
          else if (angleDiff === 2) cost += 2.0;                     // 180° — reversal (avoid)
        }

        const g = current.g + cost;
        const h2 = Math.abs(nc - dest.col) + Math.abs(nr - dest.row);
        const f = g + h2;

        let neighborNode = nodeMap.get(neighborKey);
        if (!neighborNode) {
          neighborNode = { col: nc, row: nr, g, h: h2, f, parent: current, prevDir: ni };
          nodeMap.set(neighborKey, neighborNode);
          openSet.push(neighborNode);
        } else if (g < neighborNode.g) {
          neighborNode.g = g;
          neighborNode.f = f;
          neighborNode.parent = current;
          neighborNode.prevDir = ni;
        }
      }
    }

    return null;
  }

  // ── Stage 6 — Polar caps ────────────────────────────────────────

  private stage6_PolarCaps(_rng: () => number): void {
    // Arctic: ONLY the outermost row — max 1 row of pure ice.
    // Row 1 and height-2 go through temperature processing and may become
    // tundra or plains depending on the threshold — giving a natural
    // transition instead of a solid arctic band.
    for (let col = 0; col < this.width; col++) {
      this.cells[0][col].type = TERRAIN_TYPES.ARCTIC;
      this.cells[this.height - 1][col].type = TERRAIN_TYPES.ARCTIC;
    }
    // Light tundra scatter on row 1 and height-2 for natural transition
    for (let col = 0; col < this.width; col++) {
      if (this.cells[1][col].type === TERRAIN_TYPES.PLAINS) {
        const n = hashNoise(col, 1, 555);
        if (n < 0.25) this.cells[1][col].type = TERRAIN_TYPES.TUNDRA;
      }
      if (this.cells[this.height - 2][col].type === TERRAIN_TYPES.PLAINS) {
        const n = hashNoise(col, this.height - 2, 666);
        if (n < 0.25) this.cells[this.height - 2][col].type = TERRAIN_TYPES.TUNDRA;
      }
    }
  }

  // ── Stage 6a — Special resources ────────────────────────────────

  private stage6a_SpecialResources(rng: () => number): void {
    const totalCells = this.width * this.height;
    const count = Math.floor(totalCells / 18);
    for (let i = 0; i < count; i++) {
      const col = Math.floor(rng() * this.width);
      const row = 4 + Math.floor(rng() * Math.max(1, this.height - 8));
      this.cells[row][col].specialResource = true;
    }
  }

  // ── Stage 7 — Flood-fill groups ─────────────────────────────────

  private stage7_FloodFillGroups(): void {
    for (let r = 0; r < this.height; r++)
      for (let c = 0; c < this.width; c++)
        this.cells[r][c].groupId = -1;
    this.groups = [];
    let nextId = 0;
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (this.cells[r][c].groupId !== -1) continue;
        const kind = this.cellGroupKind(c, r);
        const group: MapGroup = { id: nextId, kind, size: 0, buildSites: 0 };
        this.groups.push(group);
        this.bfsFill(c, r, nextId, kind);
        nextId++;
      }
    }
  }

  private cellGroupKind(col: number, row: number): GroupKind {
    return this.cells[row][col].type === TERRAIN_TYPES.OCEAN ? GroupKind.Water : GroupKind.Land;
  }

  private bfsFill(startCol: number, startRow: number, groupId: number, kind: GroupKind): void {
    const queue: Point[] = [{ col: startCol, row: startRow }];
    this.cells[startRow][startCol].groupId = groupId;
    const group = this.groups.find(g => g.id === groupId)!;
    group.size = 0;
    const dirs: Point[] = [
      { col: 0, row: -1 }, { col: 1, row: 0 },
      { col: 0, row: 1 },  { col: -1, row: 0 },
    ];
    if (kind === GroupKind.Land) {
      dirs.push(
        { col: 1, row: -1 }, { col: 1, row: 1 },
        { col: -1, row: 1 }, { col: -1, row: -1 },
      );
    }
    while (queue.length > 0) {
      const { col, row } = queue.shift()!;
      group.size++;
      for (const d of dirs) {
        const nc = this.wrapCol(col + d.col);
        const nr = row + d.row;
        if (!this.isValid(nc, nr)) continue;
        const neighbour = this.cells[nr][nc];
        if (neighbour.groupId !== -1) continue;
        if (this.cellGroupKind(nc, nr) !== kind) continue;
        neighbour.groupId = groupId;
        queue.push({ col: nc, row: nr });
      }
    }
  }

  // ── Stage 8 — Build-site scoring ────────────────────────────────

  private stage8_BuildSites(): void {
    const coeff = new Map<string, number>();
    const coeffSpecial = new Map<string, number>();
    for (const t of Object.values(TERRAIN_TYPES)) {
      const base = baseYield(t);
      coeff.set(t, base);
      coeffSpecial.set(t, base + 4);
    }

    for (let row = 2; row < this.height - 2; row++) {
      for (let col = 0; col < this.width; col++) {
        const cell = this.cells[row][col];
        const t = cell.type;
        if (t !== TERRAIN_TYPES.GRASSLAND && t !== TERRAIN_TYPES.PLAINS && t !== TERRAIN_TYPES.RIVER) continue;

        let total = 0;
        for (let k = 0; k < 21; k++) {
          const off = MOVE_OFFSETS[k] ?? { col: 0, row: 0 };
          const nc = this.wrapCol(col + off.col);
          const nr = row + off.row;
          if (!this.isValid(nc, nr)) continue;
          const nType = this.cells[nr][nc].type;
          const table = this.cells[nr][nc].specialResource ? coeffSpecial : coeff;
          let cellWorth = table.get(nType) ?? 0;
          if ((nType === TERRAIN_TYPES.GRASSLAND || nType === TERRAIN_TYPES.RIVER) &&
              ((nc * 7 + nr * 11) & 2) === 0) cellWorth += 2;
          if (k < 9) cellWorth *= 2;
          if (k === 0) cellWorth *= 2;
          total += cellWorth;
        }
        if (t !== TERRAIN_TYPES.PLAINS && ((col * 7 + row * 11) & 2) !== 0) total -= 16;
        const score = Math.min(Math.max(Math.floor((total - 120) / 8), 1), 15);
        (cell as unknown as Record<string, unknown>)['buildSite'] = Math.floor(score / 2) + 8;
        if (cell.groupId >= 0 && cell.groupId < this.groups.length) {
          this.groups[cell.groupId].buildSites++;
        }
      }
    }
  }

  // ── Phase 4: Passability validation ─────────────────────────────

  private ensurePassability(): void {
    const centerCol = this.width >> 1;
    const centerRow = this.height >> 1;

    let totalLand = 0;
    for (let r = 0; r < this.height; r++) {
      for (let c = 0; c < this.width; c++) {
        if (this.cells[r][c].type !== TERRAIN_TYPES.OCEAN) totalLand++;
      }
    }
    if (totalLand === 0) return;

    const visited: boolean[][] = [];
    for (let r = 0; r < this.height; r++) {
      visited[r] = new Array(this.width).fill(false);
    }

    const queue: Point[] = [];
    if (this.cells[centerRow][centerCol].type !== TERRAIN_TYPES.OCEAN) {
      queue.push({ col: centerCol, row: centerRow });
      visited[centerRow][centerCol] = true;
    } else {
      for (let dist = 1; dist < Math.max(this.width, this.height); dist++) {
        for (let dr = -dist; dr <= dist; dr++) {
          for (let dc = -dist; dc <= dist; dc++) {
            const nr = centerRow + dr;
            const nc = this.wrapCol(centerCol + dc);
            if (this.isValid(nc, nr) && !visited[nr][nc] && this.cells[nr][nc].type !== TERRAIN_TYPES.OCEAN) {
              queue.push({ col: nc, row: nr });
              visited[nr][nc] = true;
              break;
            }
          }
          if (queue.length > 0) break;
        }
        if (queue.length > 0) break;
      }
    }

    const cardinals = [
      { col: 0, row: -1 }, { col: 1, row: 0 },
      { col: 0, row: 1 },  { col: -1, row: 0 },
    ];
    const diags = [
      { col: 1, row: -1 }, { col: 1, row: 1 },
      { col: -1, row: 1 }, { col: -1, row: -1 },
    ];

    let reachable = 0;
    while (queue.length > 0) {
      const pos = queue.shift()!;
      reachable++;
      const t = this.cells[pos.row][pos.col].type;
      const cost = t === TERRAIN_TYPES.MOUNTAINS ? 3 : t === TERRAIN_TYPES.HILLS ? 2 : 1;
      if (cost >= 3) continue;

      for (const d of [...cardinals, ...diags]) {
        const nc = this.wrapCol(pos.col + d.col);
        const nr = pos.row + d.row;
        if (!this.isValid(nc, nr) || visited[nr][nc]) continue;
        const nt = this.cells[nr][nc].type;
        if (nt === TERRAIN_TYPES.OCEAN) continue;
        visited[nr][nc] = true;
        queue.push({ col: nc, row: nr });
      }
    }

    if (reachable < totalLand * 0.6) {
      const barriers: Point[] = [];
      for (let r = 0; r < this.height; r++) {
        for (let c = 0; c < this.width; c++) {
          if (this.cells[r][c].type !== TERRAIN_TYPES.MOUNTAINS) continue;
          if (!visited[r][c]) continue;
          for (const d of [...cardinals, ...diags]) {
            const nc = this.wrapCol(c + d.col);
            const nr = r + d.row;
            if (this.isValid(nc, nr) && !visited[nr][nc] &&
                this.cells[nr][nc].type !== TERRAIN_TYPES.OCEAN) {
              barriers.push({ col: c, row: r });
              break;
            }
          }
        }
      }

      const toConvert = Math.min(barriers.length, 10);
      for (let i = 0; i < toConvert; i++) {
        const idx = Math.floor(Math.random() * barriers.length);
        const p = barriers.splice(idx, 1)[0];
        this.cells[p.row][p.col].type = TERRAIN_TYPES.HILLS;
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────

  private toTileArray(): GenTile[] {
    const tiles: GenTile[] = [];
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const src = this.cells[row][col];
        tiles.push({
          col: src.col, row: src.row,
          type: src.type, terrain: src.type,
          resource: rollResource(src.type, src.specialResource),
          visible: false, explored: false,
          groupId: src.groupId,
        });
      }
    }
    return tiles;
  }

  // ── Final cleanup ───────────────────────────────────────────────

  /**
   * Fill isolated ocean tiles that are surrounded by land on all 4 cardinal
   * sides. These are stragglers from river paths or edge effects that the
   * coastline smoothing pass missed.
   */
  private fillIsolatedOceanHoles(): void {
    const cardinals = [
      { col: 0, row: -1 }, { col: 1, row: 0 },
      { col: 0, row: 1 },  { col: -1, row: 0 },
    ];
    for (let r = 1; r < this.height - 1; r++) {
      for (let c = 0; c < this.width; c++) {
        if (this.cells[r][c].type !== TERRAIN_TYPES.OCEAN) continue;
        let landCount = 0;
        for (const d of cardinals) {
          const nr = r + d.row;
          const nc = this.wrapCol(c + d.col);
          if (this.isValid(nc, nr) && this.cells[nr][nc].type !== TERRAIN_TYPES.OCEAN) {
            landCount++;
          }
        }
        if (landCount >= 3) {
          this.cells[r][c].type = TERRAIN_TYPES.PLAINS;
        }
      }
    }
  }

  // ── Public accessors ────────────────────────────────────────────

  getGroup(col: number, row: number): MapGroup | null {
    if (!this.isValid(col, row)) return null;
    const gid = this.cells[row][col].groupId;
    return this.groups.find(g => g.id === gid) ?? null;
  }
  getContinents(): MapGroup[] {
    return this.groups.filter(g => g.kind === GroupKind.Land).sort((a, b) => a.size - b.size);
  }
  getOceans(): MapGroup[] {
    return this.groups.filter(g => g.kind === GroupKind.Water);
  }
}
