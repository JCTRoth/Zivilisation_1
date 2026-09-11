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

export const TERRAIN_TEXTURE_FILES: Record<string, string> = {
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
  // River reuses the ocean water texture; banks come from colour transitions.
  RIVER:     '/assets/tiles/terrain_ocean.png',
  // Hills reuses the grass base texture; the hill feature sprite adds the relief.
  HILLS:     '/assets/tiles/terrain_plains.png',
};

export const FEATURE_TEXTURE_FILES: Partial<Record<string, string>> = {
  FOREST:    '/assets/tiles/terrain_forest_feature_1.png',
  JUNGLE:    '/assets/tiles/terrain_jungle_feature.png',
  HILLS:     '/assets/tiles/terrain_hills_feature.png',
  MOUNTAINS: '/assets/tiles/terrain_mountains_feature.png',
  SWAMP:     '/assets/tiles/terrain_swamp_feature.png',
};

/** Higher value bleeds color over lower-value terrain at border transitions. */
export const TERRAIN_PRIORITY: Record<string, number> = {
  OCEAN:       0,
  RIVER:       0,
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
export const TERRAIN_BLEND_COLOR: Record<string, string> = {
  OCEAN:      'rgba( 30, 80,170,',
  RIVER:      'rgba( 30,100,200,',
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
export const TRANSITION_DISTANCE = 0.15;

/** Max number of numbered variants to probe per type beyond the primary image. */
const MAX_VARIANT_PROBES = 4;

export class TerrainTextureManager {
  /** Arrays hold the primary image at index 0, then any loaded variants. */
  private readonly baseCache    = new Map<string, HTMLImageElement[]>();
  private readonly featureCache = new Map<string, HTMLImageElement[]>();
  /** Reusable offscreen canvas for texture-based transition compositing. */
  private transitionCanvas: HTMLCanvasElement | null = null;
  /** Dedicated offscreen canvas for feature blending (wider than a tile). */
  private featureCanvas: HTMLCanvasElement | null = null;

  readonly ready: Promise<void>;
  private loadedCount = 0;
  private totalCount  = 0;

  constructor(onLoad?: () => void) {
    const baseTypes    = Object.keys(TERRAIN_TEXTURE_FILES);
    const featureTypes = Object.keys(FEATURE_TEXTURE_FILES);
    // Count primary + all variant probes so onLoad fires only after everything settles.
    this.totalCount = (baseTypes.length + featureTypes.length) * (1 + MAX_VARIANT_PROBES);

    let resolve!: () => void;
    this.ready = new Promise(r => { resolve = r; });

    const done = () => {
      this.loadedCount++;
      if (this.loadedCount >= this.totalCount) { resolve(); onLoad?.(); }
    };

    const probeVariants = (baseUrl: string, arr: HTMLImageElement[]) => {
      // Strip any trailing _N so "feature_1.png" and "feature.png" probe the same variants.
      const stem = baseUrl.replace(/(_\d+)?\.png$/, '');
      const explicitN = baseUrl.match(/_(\d+)\.png$/)?.[1];
      const start = explicitN ? parseInt(explicitN, 10) + 1 : 1;
      for (let v = start; v < start + MAX_VARIANT_PROBES; v++) {
        const img = new Image();
        img.onload = () => { arr.push(img); done(); };
        img.onerror = done; // missing variant — still counts toward total
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
    const ready = arr.filter(img => img.complete && img.naturalWidth > 0);
    if (ready.length === 0) return null;
    return this.pickVariant(ready, col, row);
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
  ): void {
    const img = this.getTexture(terrainType, col, row);
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

    // Lazily create / resize the shared offscreen canvas.
    if (!this.transitionCanvas) {
      this.transitionCanvas = document.createElement('canvas');
    }
    const tc = this.transitionCanvas;
    if (tc.width !== tileSize || tc.height !== tileSize) {
      tc.width  = tileSize;
      tc.height = tileSize;
    }
    const tCtx = tc.getContext('2d')!;
    tCtx.clearRect(0, 0, tileSize, tileSize);

    // Draw the neighbor texture positioned so the shared edge shows its texture.
    // For seamless textures we just fill the offscreen canvas with the neighbor
    // texture — the gradient mask determines how far it bleeds inward.
    tCtx.drawImage(img, 0, 0, tileSize, tileSize);

    // Scale blend strength with priority difference; clamp to a reasonable range.
    const edgeAlpha = 1.0;
    const fadeFrac  = Math.min(0.45, TRANSITION_DISTANCE + priorityDiff * 0.03);

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

    // Composite the masked texture onto the main canvas, clipped to this tile.
    ctx.save();
    ctx.beginPath();
    ctx.rect(tileX, tileY, tileSize, tileSize);
    ctx.clip();
    ctx.drawImage(tc, tileX, tileY);
    ctx.restore();
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
    // Collect all 4 tiles that meet at this corner
    const tiles: Array<{ type: string | null; priority: number }> = [];
    
    // For NW corner: current tile is at (row, col), the 4 tiles are:
    // - current (row, col)
    // - north (row-1, col) 
    // - west (row, col-1)
    // - diagonal (row-1, col-1)
    tiles.push({ type: currentType, priority: this.getPriority(currentType) });
    if (northType) tiles.push({ type: northType, priority: this.getPriority(northType) });
    if (westType) tiles.push({ type: westType, priority: this.getPriority(westType) });
    if (diagonalType) tiles.push({ type: diagonalType, priority: this.getPriority(diagonalType) });

    // Find the tile with the highest priority
    let winner = tiles[0];
    for (const tile of tiles) {
      if (tile.priority > winner.priority) {
        winner = tile;
      }
    }

    // If the current tile wins, no transition needed
    if (winner.type === currentType) return;

    // Draw the corner transition with the winning texture
    const img = this.getTexture(winner.type!, tileX, tileY);
    if (!img || !img.complete || img.naturalWidth === 0) return;

    if (!this.transitionCanvas) {
      this.transitionCanvas = document.createElement('canvas');
    }
    const tc = this.transitionCanvas;
    if (tc.width !== tileSize || tc.height !== tileSize) {
      tc.width  = tileSize;
      tc.height = tileSize;
    }
    const tCtx = tc.getContext('2d')!;
    tCtx.clearRect(0, 0, tileSize, tileSize);
    tCtx.drawImage(img, 0, 0, tileSize, tileSize);

    // Radial gradient centered at the corner vertex
    const cx = corner === 'NW' || corner === 'SW' ? 0        : tileSize;
    const cy = corner === 'NW' || corner === 'NE' ? 0        : tileSize;
    
    // Calculate priority difference for gradient strength
    const priorityDiff = winner.priority - this.getPriority(currentType);
    const radius = Math.min(0.45, TRANSITION_DISTANCE + priorityDiff * 0.03) * tileSize;
    const peak   = 1.0;

    tCtx.globalCompositeOperation = 'destination-in';
    const g = tCtx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0,    `rgba(0,0,0,${peak.toFixed(2)})`);
    g.addColorStop(0.45, `rgba(0,0,0,${(peak * 0.25).toFixed(2)})`);
    g.addColorStop(1,    'rgba(0,0,0,0)');
    tCtx.fillStyle = g;
    tCtx.fillRect(0, 0, tileSize, tileSize);
    tCtx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.beginPath();
    ctx.rect(tileX, tileY, tileSize, tileSize);
    ctx.clip();
    ctx.drawImage(tc, tileX, tileY);
    ctx.restore();
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
