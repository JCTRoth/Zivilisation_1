/**
 * TerrainTextureManager — Loads and caches AI-generated terrain textures.
 *
 * Two-layer rendering system inspired by Battle for Wesnoth:
 *
 *  Layer 1 — base ground tiles (seamless, flat top-down, 256x256)
 *    Drawn first for every tile. Transitions use smooth color gradients
 *    (no texture bleeding = no blob patterns at corners).
 *
 *  Layer 2 — feature sprites (isometric, transparent bg, 256x384 = 1.5:1)
 *    Drawn in painter's-algorithm row order so lower-row features
 *    appear in front. Each sprite is offset upward by half a tile height
 *    so mountain peaks / tree tops extend a little into the row above.
 */

import { SPECIAL_RESOURCES } from '@/data/TerrainConstants';

const TERRAIN_TEXTURE_FILES: Record<string, string> = {
  OCEAN:     '/assets/tiles/terrain_ocean.png',
  PLAINS:    '/assets/tiles/terrain_plains.png',
  GRASSLAND: '/assets/tiles/terrain_grassland.png',
  FOREST:    '/assets/tiles/terrain_forest.png',
  JUNGLE:    '/assets/tiles/terrain_jungle.png',
  MOUNTAINS: '/assets/tiles/terrain_mountains.png',
  DESERT:    '/assets/tiles/terrain_desert.png',
  SWAMP:     '/assets/tiles/terrain_swamp.png',
  TUNDRA:    '/assets/tiles/terrain_tundra.png',
  ARCTIC:    '/assets/tiles/terrain_arctic.png',
  // River and Lake reuse the ocean water texture; banks come from colour transitions.
  RIVER:     '/assets/tiles/terrain_ocean.png',
  LAKE:      '/assets/tiles/terrain_ocean.png',
  // Hills reuses the grass base texture; the hill feature sprite adds the relief.
  HILLS:     '/assets/tiles/terrain_plains.png',
};

const FEATURE_TEXTURE_FILES: Partial<Record<string, string>> = {
  FOREST:    '/assets/tiles/terrain_forest_feature_1.png',
  JUNGLE:    '/assets/tiles/terrain_jungle_feature.png',
  HILLS:     '/assets/tiles/terrain_hills_feature.png',
  MOUNTAINS: '/assets/tiles/terrain_mountains_feature.png',
  SWAMP:     '/assets/tiles/terrain_swamp_feature.png',
};

/**
 * Build the pre-rendered feature-on-tile texture map from the game's own
 * special-resource rules: every legal resource × terrain pairing maps to the
 * tile `compose_feature_tiles.mjs` writes (`terrain_<terrain>_<resource>.png`).
 * The script bakes artwork or the resource glyph onto the terrain texture, so
 * resources — which never move — are one static picture on the map and the
 * renderer never has to compose them per frame. Variants
 * (`..._horses.png`, `..._horses_2.png`) are probed like feature sprites.
 *
 * Loading is deliberately NOT part of `ready`: the optional artwork must never
 * delay terrain boot; `resourceTilesReady` settles separately and the caller
 * can rebuild the cached base when it does.
 */
function buildResourceTileFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const resource of SPECIAL_RESOURCES) {
    const terrains = (resource.terrains ?? resource.terrain ?? '')
      .split(',')
      .map((terrain) => terrain.trim().toLowerCase())
      .filter(Boolean);
    for (const terrain of terrains) {
      files[`${terrain.toUpperCase()}.${resource.name.toUpperCase()}`] =
        `/assets/tiles/terrain_${terrain}_${resource.name.toLowerCase()}.png`;
    }
  }
  return files;
}

export const RESOURCE_TILE_FILES: Record<string, string> = buildResourceTileFiles();

/** Higher value bleeds color over lower-value terrain at border transitions. */
const TERRAIN_PRIORITY: Record<string, number> = {
  OCEAN:       0,
  RIVER:       0,
  LAKE:        0,
  ARCTIC:      9,
  TUNDRA:      8,
  MOUNTAINS:   7,
  HILLS:       6,
  DESERT:      5,
  SWAMP:       5,
  FOREST:      1,
  JUNGLE:      4,
  PLAINS:      2,
  GRASSLAND:   1,
};

/** rgba prefix for each terrain's dominant blend color (no closing paren). */
const TERRAIN_BLEND_COLOR: Record<string, string> = {
  OCEAN:      'rgba( 30, 80,170,',
  RIVER:      'rgba( 30,100,200,',
  LAKE:       'rgba( 60,150,230,',
  ARCTIC:     'rgba(220,235,255,',
  TUNDRA:     'rgba(150,175,210,',
  MOUNTAINS:  'rgba( 80, 80, 80,',
  HILLS:      'rgba(110,150, 80,',
  DESERT:     'rgba(210,155, 60,',
  SWAMP:      'rgba( 60, 55, 25,',
  FOREST:     'rgba( 20,100, 20,',
  JUNGLE:     'rgba( 10, 90, 30,',
  PLAINS:     'rgba(120,190, 80,',
  GRASSLAND:  'rgba( 40,160, 40,',
};

/**
 * How far terrain transitions bleed into the current tile, as a fraction
 * of the tile size (0–0.5).  Tweak this to control edge/corner distance.
 */
const TRANSITION_DISTANCE = 0.15;

/** Max number of numbered variants to probe per type beyond the primary image. */
const MAX_VARIANT_PROBES = 4;

/**
 * Resource tiles probe more variants than terrain textures: the Fisher Boat
 * ships five fish poses (fish1..fish5.png → terrain_ocean_fish(_2.._5).png),
 * and every pose should appear on the map.
 */
const RESOURCE_TILE_MAX_PROBES = 5;

export class TerrainTextureManager {
  /**
   * Cache arrays hold only images that have already decoded: the primary image
   * is pushed from its `onload`, then each loaded variant. Draw code can index
   * them directly — never scan them per call (that allocated and filtered once
   * per tile per frame).
   */
  private readonly baseCache    = new Map<string, HTMLImageElement[]>();
  private readonly featureCache = new Map<string, HTMLImageElement[]>();
  /** Pre-rendered feature-on-tile textures, keyed `TERRAIN.RESOURCE`. */
  private readonly resourceTileCache = new Map<string, HTMLImageElement[]>();
  /**
   * Masked transition tiles, keyed by neighbour texture + edge direction + fade.
   *
   * The gradient mask depends only on the direction, the fade distance and the
   * tile size — never on which texture is being masked. Building one per call
   * meant a gradient, a composite and a clip for every single tile edge, and
   * the whole-map pass on the 96x60 archipelago has 2766 of those (plus 5526
   * radial corner masks) — about 8300 gradient composites and clips, five to
   * ten times over during one map load. Keyed on the resolved image `src` so
   * per-tile texture variants still render exactly as before.
   */
  private readonly maskedEdgeCache = new Map<string, HTMLCanvasElement>();
  private readonly maskedCornerCache = new Map<string, HTMLCanvasElement>();
  /** Keep the caches bounded: tileSize changes with zoom. */
  private static readonly MASK_CACHE_LIMIT = 512;
  /** Dedicated offscreen canvas for feature blending (wider than a tile). */
  private featureCanvas: HTMLCanvasElement | null = null;

  readonly ready: Promise<void>;
  /**
   * Settles when every optional feature-on-tile texture has loaded (or
   * failed). Never rejects and never gates {@link ready} — callers rebuild
   * their cached terrain once it resolves so the composed tiles appear.
   */
  readonly resourceTilesReady: Promise<void>;
  private loadedCount = 0;
  private totalCount  = 0;

  constructor(onLoad?: () => void) {
    const baseTypes    = Object.keys(TERRAIN_TEXTURE_FILES);
    const featureTypes = Object.keys(FEATURE_TEXTURE_FILES);
    const resourceTileTypes = Object.keys(RESOURCE_TILE_FILES);
    // Count primary + all variant probes so onLoad fires only after everything settles.
    this.totalCount = (baseTypes.length + featureTypes.length) * (1 + MAX_VARIANT_PROBES);

    let resolve!: () => void;
    this.ready = new Promise(r => { resolve = r; });

    const done = () => {
      this.loadedCount++;
      if (this.loadedCount >= this.totalCount) { resolve(); onLoad?.(); }
    };

    const probeVariants = (
      baseUrl: string,
      arr: HTMLImageElement[],
      settled: () => void = done,
      maxProbes: number = MAX_VARIANT_PROBES,
    ) => {
      // Strip any trailing _N so "feature_1.png" and "feature.png" probe the same variants.
      const stem = baseUrl.replace(/(_\d+)?\.png$/, '');
      const explicitN = baseUrl.match(/_(\d+)\.png$/)?.[1];
      const start = explicitN ? parseInt(explicitN, 10) + 1 : 1;
      for (let v = start; v < start + maxProbes; v++) {
        const img = new Image();
        img.onload = () => { arr.push(img); settled(); };
        img.onerror = settled; // missing variant — still counts toward total
        img.src = `${stem}_${v}.png`;
      }
    };

    for (const type of baseTypes) {
      const arr: HTMLImageElement[] = [];
      this.baseCache.set(type, arr);
      const img = new Image();
      img.onload = () => { arr.push(img); probeVariants(TERRAIN_TEXTURE_FILES[type]!, arr); done(); };
      img.onerror = () => { probeVariants(TERRAIN_TEXTURE_FILES[type]!, arr); done(); };
      img.src = TERRAIN_TEXTURE_FILES[type]!;
    }
    for (const type of featureTypes) {
      const arr: HTMLImageElement[] = [];
      this.featureCache.set(type, arr);
      const img = new Image();
      img.onload = () => { arr.push(img); probeVariants(FEATURE_TEXTURE_FILES[type]!, arr); done(); };
      img.onerror = () => { probeVariants(FEATURE_TEXTURE_FILES[type]!, arr); done(); };
      img.src = FEATURE_TEXTURE_FILES[type]!;
    }

    // Optional resource tiles: their load completion drives resourceTilesReady
    // instead of the terrain ready gate.
    const resourceTilePromises = resourceTileTypes.map((type) => new Promise<void>((resolveTile) => {
      const arr: HTMLImageElement[] = [];
      this.resourceTileCache.set(type, arr);
      let pending = 1 + RESOURCE_TILE_MAX_PROBES;
      const settled = () => { if (--pending === 0) resolveTile(); };
      const img = new Image();
      img.onload = () => { arr.push(img); probeVariants(RESOURCE_TILE_FILES[type]!, arr, settled, RESOURCE_TILE_MAX_PROBES); settled(); };
      img.onerror = () => { probeVariants(RESOURCE_TILE_FILES[type]!, arr, settled, RESOURCE_TILE_MAX_PROBES); settled(); };
      img.src = RESOURCE_TILE_FILES[type]!;
    }));
    this.resourceTilesReady = Promise.all(resourceTilePromises).then(() => undefined);
  }

  /** Stable variant selection based on tile grid position. */
  private pickVariant(arr: HTMLImageElement[], col: number, row: number): HTMLImageElement {
    if (arr.length <= 1) return arr[0];
    const idx = Math.abs(col * 7 + row * 13) % arr.length;
    return arr[idx];
  }

  getTexture(type?: string | null, col = 0, row = 0): HTMLImageElement | null {
    if (!type) return null;
    const arr = this.baseCache.get(type.toUpperCase());
    if (!arr || arr.length === 0) return null;
    return this.pickVariant(arr, col, row);
  }

  getFeatureTexture(type?: string | null, col = 0, row = 0): HTMLImageElement | null {
    if (!type) return null;
    const arr = this.featureCache.get(type.toUpperCase());
    if (!arr || arr.length === 0) return null;
    return this.pickVariant(arr, col, row);
  }

  /** Cache key of a pre-rendered feature-on-tile texture (`TERRAIN.RESOURCE`). */
  private resourceTileKey(terrainType?: string | null, resource?: string | null): string {
    if (!terrainType || !resource) return '';
    return `${terrainType.toUpperCase()}.${resource.toUpperCase()}`;
  }

  /** Whether a pre-rendered tile is mapped for this terrain + resource pairing. */
  hasResourceTile(terrainType?: string | null, resource?: string | null): boolean {
    return this.resourceTileCache.has(this.resourceTileKey(terrainType, resource));
  }

  /**
   * Draw the pre-rendered feature-on-tile texture for a resource tile and
   * report whether one was available. Used by the static terrain pass to lift
   * the composed picture above the feature-sprite pass (so a resource on a
   * featured terrain stays visible). Returns false when no mapped tile has
   * decoded yet — the caller then draws the resource glyph fallback.
   */
  drawResourceTile(
    ctx: CanvasRenderingContext2D,
    terrainType: string | null | undefined,
    resource: string | null | undefined,
    x: number, y: number, size: number,
    col = 0, row = 0,
  ): boolean {
    const arr = this.resourceTileCache.get(this.resourceTileKey(terrainType, resource));
    if (!arr || arr.length === 0) return false;
    ctx.drawImage(this.pickVariant(arr, col, row), x, y, size, size);
    return true;
  }

  /**
   * Texture for a tile: the pre-rendered resource tile when one exists and has
   * decoded, otherwise the plain terrain base. Variant picking is stable per
   * tile so neighbouring resource tiles can show different poses.
   */
  getTileTexture(
    terrainType?: string | null,
    resource?: string | null,
    col = 0,
    row = 0,
  ): HTMLImageElement | null {
    const arr = this.resourceTileCache.get(this.resourceTileKey(terrainType, resource));
    if (arr && arr.length > 0) return this.pickVariant(arr, col, row);
    return this.getTexture(terrainType, col, row);
  }

  getPriority(type?: string | null): number {
    if (!type) return 0;
    return TERRAIN_PRIORITY[type.toUpperCase()] ?? 0;
  }

  get isReady(): boolean { return this.loadedCount >= this.totalCount; }

  // ── Base tile ────────────────────────────────────────────────────────────

  drawTile(
    ctx: CanvasRenderingContext2D,
    terrainType: string,
    x: number, y: number, size: number,
    fallbackColor: string,
    topLeft = false,
    col = 0, row = 0,
    resource: string | null = null,
  ): void {
    const img = this.getTileTexture(terrainType, resource, col, row);
    const px  = topLeft ? x : x - size / 2;
    const py  = topLeft ? y : y - size / 2;
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, px, py, size, size);
    } else {
      ctx.fillStyle = fallbackColor;
      ctx.fillRect(px, py, size, size);
    }
  }

  // ── Texture-based edge transitions (Wesnoth-style) ──────────────────────
  //
  // Draws a strip of the actual neighbor terrain texture at the shared edge,
  // masked with a gradient that fades from ~75 % at the seam to 0 % at ~40 %
  // into the current tile.  Uses a cached offscreen canvas for compositing.
  //
  // The neighbor texture is drawn at its natural position relative to the
  // current tile so only the "bleeding" portion shows through the mask.

  drawTextureTransition(
    ctx: CanvasRenderingContext2D,
    neighborType: string,
    tileX: number, tileY: number, tileSize: number,
    direction: 'N' | 'E' | 'S' | 'W',
    priorityDiff = 1,
    col = 0, row = 0,
  ): void {
    const img = this.getTexture(neighborType, col, row);
    if (!img || !img.complete || img.naturalWidth === 0) {
      this.drawColorTransition(ctx, neighborType, tileX, tileY, tileSize, direction);
      return;
    }

    // Scale blend strength with priority difference; clamp to a reasonable range.
    const edgeAlpha = 1.0;
    const fadeFrac  = Math.min(0.45, TRANSITION_DISTANCE + priorityDiff * 0.03);

    const masked = this.cachedMasked(
      this.maskedEdgeCache,
      `${img.src}|${direction}|${fadeFrac.toFixed(3)}|${tileSize}`,
      tileSize,
      (tCtx) => this.maskEdge(tCtx, img, tileSize, direction, edgeAlpha, fadeFrac),
    );

    // The masked canvas is exactly one tile and already transparent where the
    // mask fades, so it needs neither a clip nor a composite — one blit.
    ctx.drawImage(masked, tileX, tileY);
  }

  /** Builds (once) the neighbour texture faded out from the shared edge. */
  private maskEdge(
    tCtx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    tileSize: number,
    direction: 'N' | 'E' | 'S' | 'W',
    edgeAlpha: number,
    fadeFrac: number,
  ): void {
    tCtx.clearRect(0, 0, tileSize, tileSize);
    tCtx.drawImage(img, 0, 0, tileSize, tileSize);

    // Mask with a gradient: opaque at the shared edge, transparent at fadeFrac.
    tCtx.globalCompositeOperation = 'destination-in';
    let g: CanvasGradient;
    const fadeY = tileSize * fadeFrac;
    switch (direction) {
      case 'N': g = tCtx.createLinearGradient(0, 0,        0, tileSize);  break;
      case 'S': g = tCtx.createLinearGradient(0, tileSize, 0, 0);          break;
      case 'E': g = tCtx.createLinearGradient(tileSize, 0, 0, 0);          break;
      case 'W': g = tCtx.createLinearGradient(0, 0, tileSize, 0);          break;
    }
    g.addColorStop(0,                       `rgba(0,0,0,${edgeAlpha.toFixed(2)})`);
    g.addColorStop(fadeY * 0.35 / tileSize, `rgba(0,0,0,${(edgeAlpha * 0.4).toFixed(2)})`);
    g.addColorStop(fadeFrac,                'rgba(0,0,0,0)');
    g.addColorStop(1,                       'rgba(0,0,0,0)');
    tCtx.fillStyle = g;
    tCtx.fillRect(0, 0, tileSize, tileSize);
    tCtx.globalCompositeOperation = 'source-over';
  }

  /**
   * Returns a cached masked tile for `key`, building it with `build` on a miss.
   * Clearing the cache wholesale is fine: it only costs one rebuild per entry.
   */
  private cachedMasked(
    cache: Map<string, HTMLCanvasElement>,
    key: string,
    size: number,
    build: (tCtx: CanvasRenderingContext2D) => void,
  ): HTMLCanvasElement {
    const hit = cache.get(key);
    if (hit) return hit;

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const tCtx = canvas.getContext('2d');
    if (!tCtx) return canvas;
    build(tCtx);

    if (cache.size >= TerrainTextureManager.MASK_CACHE_LIMIT) cache.clear();
    cache.set(key, canvas);
    return canvas;
  }


  /**
   * Draw corner transition considering all 4 tiles that meet at this corner.
   * 
   * @param ctx - Canvas context
   * @param tileX - X position of the current tile
   * @param tileY - Y position of the current tile
   * @param tileSize - Size of the tile
   * @param corner - Which corner we're drawing
   * @param currentType - Terrain type of the current tile
   * @param northType - Terrain type of the north neighbor (row-1)
   * @param westType - Terrain type of the west neighbor (col-1)
   * @param diagonalType - Terrain type of the diagonal neighbor
   */
  drawCornerTransition4(
    ctx: CanvasRenderingContext2D,
    tileX: number, tileY: number, tileSize: number,
    corner: 'NW' | 'NE' | 'SW' | 'SE',
    currentType: string,
    northType: string | null,
    westType: string | null,
    diagonalType: string | null,
  ): void {
    // Pick the highest-priority tile of the four meeting here. Done without
    // building an array: this runs four times for every tile on the map
    // (23036 calls on the 96x60 archipelago) and almost always finds that the
    // current tile already wins, in which case nothing is drawn.
    const currentPriority = this.getPriority(currentType);
    let winnerType: string | null = null;
    let winnerPriority = currentPriority;
    for (const candidate of [northType, westType, diagonalType]) {
      if (!candidate) continue;
      const p = this.getPriority(candidate);
      if (p > winnerPriority) {
        winnerPriority = p;
        winnerType = candidate;
      }
    }

    // If the current tile wins, no transition needed
    if (winnerType === null) return;

    // Draw the corner transition with the winning texture
    const img = this.getTexture(winnerType, tileX, tileY);
    if (!img || !img.complete || img.naturalWidth === 0) return;

    // Radius shrinks the mask the further the neighbour outranks this tile.
    const priorityDiff = winnerPriority - currentPriority;
    const radius = Math.min(0.45, TRANSITION_DISTANCE + priorityDiff * 0.03) * tileSize;

    const masked = this.cachedMasked(
      this.maskedCornerCache,
      `${img.src}|${corner}|${radius.toFixed(2)}|${tileSize}`,
      tileSize,
      (tCtx) => this.maskCorner(tCtx, img, tileSize, corner, radius),
    );

    // One blit: the mask already handles the falloff, so no clip is needed.
    ctx.drawImage(masked, tileX, tileY);
  }

  /** Builds (once) the winner texture faded out radially from the corner. */
  private maskCorner(
    tCtx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    tileSize: number,
    corner: 'NW' | 'NE' | 'SW' | 'SE',
    radius: number,
  ): void {
    tCtx.clearRect(0, 0, tileSize, tileSize);
    tCtx.drawImage(img, 0, 0, tileSize, tileSize);

    // Radial gradient centered at the corner vertex
    const cx = corner === 'NW' || corner === 'SW' ? 0        : tileSize;
    const cy = corner === 'NW' || corner === 'NE' ? 0        : tileSize;
    const peak = 1.0;

    tCtx.globalCompositeOperation = 'destination-in';
    const g = tCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0,    `rgba(0,0,0,${peak.toFixed(2)})`);
    g.addColorStop(0.45, `rgba(0,0,0,${(peak * 0.25).toFixed(2)})`);
    g.addColorStop(1,    'rgba(0,0,0,0)');
    tCtx.fillStyle = g;
    tCtx.fillRect(0, 0, tileSize, tileSize);
    tCtx.globalCompositeOperation = 'source-over';
  }

  // ── Color-based edge transitions (fallback) ──────────────────────────────
  //
  // Draws a solid-color gradient from the shared edge inward.
  // Used when textures are not yet loaded.

  drawColorTransition(
    ctx: CanvasRenderingContext2D,
    neighborType: string,
    tileX: number, tileY: number, tileSize: number,
    direction: 'N' | 'E' | 'S' | 'W',
    blendFraction = 0.32,
    maxAlpha       = 0.60,
  ): void {
    const colorBase = TERRAIN_BLEND_COLOR[neighborType.toUpperCase()];
    if (!colorBase) return;

    const half = tileSize / 2;
    ctx.save();
    ctx.beginPath();
    switch (direction) {
      case 'N': ctx.rect(tileX,        tileY,        tileSize, half); break;
      case 'S': ctx.rect(tileX,        tileY + half, tileSize, half); break;
      case 'E': ctx.rect(tileX + half, tileY,        half,     tileSize); break;
      case 'W': ctx.rect(tileX,        tileY,        half,     tileSize); break;
    }
    ctx.clip();

    let g: CanvasGradient;
    switch (direction) {
      case 'N': g = ctx.createLinearGradient(0, tileY,           0, tileY + tileSize);  break;
      case 'S': g = ctx.createLinearGradient(0, tileY + tileSize,0, tileY);             break;
      case 'E': g = ctx.createLinearGradient(tileX + tileSize, 0, tileX, 0);            break;
      case 'W': g = ctx.createLinearGradient(tileX,            0, tileX + tileSize, 0); break;
    }
    // Ease-out falloff: strong at the shared edge, then a soft mid stop so the
    // blend fades smoothly instead of ending in a visible painted band.
    const mid = Math.max(0.02, blendFraction * 0.5);
    g.addColorStop(0,             `${colorBase}${maxAlpha})`);
    g.addColorStop(mid,           `${colorBase}${(maxAlpha * 0.45).toFixed(3)})`);
    g.addColorStop(blendFraction, 'rgba(0,0,0,0)');
    g.addColorStop(1,             'rgba(0,0,0,0)');

    ctx.fillStyle = g;
    ctx.fillRect(tileX, tileY, tileSize, tileSize);
    ctx.restore();
  }

  // ── Feature sprite (painter's algorithm, upward offset + side bleed) ──────
  //
  // Sprite is 1.5:1 (width : 1.5*width). The lower width×width portion sits on
  // the tile; the top half-tile extends above.
  //
  // To soften hard tile-boundary edges the sprite is drawn at 1.5× tile width
  // (25% bleed into each side neighbor).  A horizontal gradient mask fades the
  // bleed zones to transparent, so adjacent same-type features blend together
  // and isolated features have soft edges — identical in spirit to the base
  // terrain edge transitions.

  drawFeature(
    ctx: CanvasRenderingContext2D,
    terrainType: string,
    tileX: number, tileY: number, tileSize: number,
    col = 0, row = 0,
  ): void {
    const img = this.getFeatureTexture(terrainType, col, row);
    if (!img) return;

    const overhang  = tileSize * 0.5;
    const sideBleed = tileSize * 0.05;
    const drawW     = tileSize + sideBleed * 2;
    const drawH     = tileSize * 1.5;
    const drawX     = tileX - sideBleed;
    const drawY     = tileY - overhang;

    if (!this.featureCanvas) {
      this.featureCanvas = document.createElement('canvas');
    }
    const fc = this.featureCanvas;
    const needW = Math.ceil(drawW);
    const needH = Math.ceil(drawH);
    if (fc.width < needW || fc.height < needH) {
      fc.width  = needW;
      fc.height = needH;
    }
    const fCtx = fc.getContext('2d')!;
    fCtx.clearRect(0, 0, needW, needH);
    fCtx.drawImage(img, 0, 0, drawW, drawH);

    // Fade the bleed zones to transparent so adjacent features blend
    // into each other rather than cutting off at the tile boundary.
    fCtx.globalCompositeOperation = 'destination-in';
    const fadeStop = (sideBleed * 1.5) / drawW;
    const g = fCtx.createLinearGradient(0, 0, drawW, 0);
    g.addColorStop(0,            'rgba(0,0,0,0)');
    g.addColorStop(fadeStop,     'rgba(0,0,0,1)');
    g.addColorStop(1 - fadeStop, 'rgba(0,0,0,1)');
    g.addColorStop(1,            'rgba(0,0,0,0)');
    fCtx.fillStyle = g;
    fCtx.fillRect(0, 0, drawW, drawH);
    fCtx.globalCompositeOperation = 'source-over';

    ctx.drawImage(fc, 0, 0, drawW, drawH, drawX, drawY, drawW, drawH);
  }

  /**
   * Edge-aware river rendering: instead of a "~" glyph per tile, draw water
   * arms from the tile centre to the edges shared with neighbouring river
   * tiles, so the watercourse flows continuously across the map. Each arm is
   * stroked three times — dark bank, water, light highlight.
   *
   * `connectN/E/S/W` say which cardinal neighbours also carry a river; a tile
   * with no connections (should not happen) degenerates to a small pond.
   */
  drawRiver(
    ctx: CanvasRenderingContext2D,
    _terrainType: string | null | undefined,
    x: number,
    y: number,
    tileSize: number,
    connectN = false,
    connectE = false,
    connectS = false,
    connectW = false,
  ): void {
    const half = tileSize / 2;
    const cx = x + half;
    const cy = y + half;

    const waterWidth = Math.max(2, tileSize * 0.16);
    const bankWidth = waterWidth + Math.max(2, tileSize * 0.06);

    const edges: Array<[number, number]> = [];
    if (connectN) edges.push([cx, y]);
    if (connectE) edges.push([x + tileSize, cy]);
    if (connectS) edges.push([cx, y + tileSize]);
    if (connectW) edges.push([x, cy]);
    if (edges.length === 0) edges.push([cx, cy + waterWidth * 0.5]); // isolated pond

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const strokeArms = (width: number, color: string): void => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (const [ex, ey] of edges) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
    };

    strokeArms(bankWidth, 'rgba(20, 60, 110, 0.55)');            // banks
    strokeArms(waterWidth, 'rgba(55, 135, 225, 0.9)');           // water
    strokeArms(Math.max(1, waterWidth * 0.4), 'rgba(150, 210, 255, 0.5)'); // highlight
    ctx.restore();
  }
}
