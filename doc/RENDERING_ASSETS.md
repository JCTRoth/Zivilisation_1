# Rendering & Tile Assets

How the map is drawn, where every asset comes from and what to do when you add
or update artwork. Read this before touching anything under
`public/assets/tiles`, `src/assets/resources` or the tile generator.

## 1. The two content layers

The renderer (`src/game/rendering/MapRenderer.ts`) has exactly two layers,
matching how the game treats its objects:

| Layer | Content | Lifetime | Drawn by |
| --- | --- | --- | --- |
| **Static terrain** | terrain base textures, forest/jungle/hills/mountains/swamp feature sprites, special resources (composed picture or glyph), villages, roads/improvements | Built once into an offscreen map-sized canvas; rebuilt only when tile state changes | `renderTerrainBase()` (+ `renderFogOverlay()`), cached in `GameCanvas` (`terrainBaseCanvasRef`, `groundCacheCanvasRef`) |
| **Dynamic** | units (SVG or emoji), cities (emoji), selection/hover/range/path overlays, combat clouds and damage numbers | Every render frame | `drawDynamicContent()`, `renderPulsingUnits()` |

Rules of thumb:

* If it never moves and is bound to one tile → **static layer** (fix it with the
  generator or as a texture, never draw it per frame).
* If it can move, appear or disappear → **dynamic layer** (unit/city icons).
* Units and cities are deliberately **not** pre-rendered; the generator only
  produces tile pictures for resources.

Fog of war is a cheap overlay on top of the cached static layer
(`renderFogOverlay`), so exploration only invalidates the cache, never the
source assets.

## 2. Asset folders

| Path | What lives there |
| --- | --- |
| `public/assets/tiles/` | Game-ready tiles: `terrain_<terrain>.png` base textures, `terrain_<terrain>_feature[_N].png` feature sprites, `terrain_<terrain>_<resource>[_N].png` composed resource pictures |
| `src/assets/resources/` | Source artwork for special resources (SVG or PNG, variants allowed) — input of the compose script |
| `src/assets/units/` | Unit SVG icons (dynamic layer) |
| `src/assets/NotoEmoji-Light.ttf` | Monochrome fallback font for glyph rendering in the browser and in the generator |
| `tools/tile-generator/` | Generator UI/server + `compose_feature_tiles.mjs` (feature-on-tile pictures) + `generate_terrain_v4.mjs` (AI base/feature textures) |

`TerrainTextureManager.RESOURCE_TILE_FILES` is derived automatically from
`SPECIAL_RESOURCES` in `src/data/TerrainConstants.ts` — you never edit that map
by hand.

## 3. Adding a new feature image (resource artwork)

Example: give the **Gold** resource hand-drawn artwork.

1. **Drop the artwork** into `src/assets/resources/`, named after the resource
   (lowercase, matching `SPECIAL_RESOURCES[].name`):
   * `gold.svg` or `gold.png` (PNG pixel art wins over SVG),
   * extra poses: `gold_2.svg`, `gold3.png`, … (numbered files become
     variants; up to 5 are probed at load time).
2. **Compose it onto the tiles** the resource can legally appear on (read from
   `SPECIAL_RESOURCES[].terrains`):

   ```bash
   node tools/tile-generator/compose_feature_tiles.mjs            # all resources
   node tools/tile-generator/compose_feature_tiles.mjs --only=gold # just this one
   node tools/tile-generator/compose_feature_tiles.mjs --dry-run   # list outputs
   ```

   Or use the tile-generator gallery: `node server.mjs` →
   “🧩 Render Features on Tiles”.
3. The script writes `terrain_<terrain>_<resource>[_N].png` into
   `tools/tile-generator/tiles/` and copies it to `public/assets/tiles/`
   (skip the copy with `SKIP_COPY=1`, e.g. from the gallery UI).
4. **Check the result**: open `public/assets/tiles/terrain_mountains_gold.png`.
   Artwork is fitted into 85 % of the tile (`FEATURE_BOX`) and centred on the
   plain terrain base texture. If the base tile only exists as a numbered
   variant (e.g. `terrain_forest_1.png`), the script finds it automatically.
5. **Test and reload**:

   ```bash
   npx vitest run tests/resourceTiles.test.ts
   npm run dev   # hard-reload the browser (Ctrl+Shift+R) to bypass the disk cache
   ```

Notes:

* The composed picture is drawn **above** the feature sprite pass, so a
  resource on a featured terrain (gems in jungle, gold in mountains, …) stays
  visible.
* `TerrainTextureManager` picks one variant per tile with a stable hash
  (`pickVariant`), so neighbouring resource tiles can show different poses.
* If a composed tile is missing, the renderer falls back to the resource glyph
  from `RESOURCE_GLYPHS` — still static, but a picture is preferred.

## 4. Glyph-only resources (colour emoji)

Resources without artwork are baked from their emoji in `RESOURCE_GLYPHS`
(`src/data/TerrainConstants.ts`):

* The generator renders the emoji **in colour** through Pango
  (`GLYPH_FONT_FAMILY`, default `Noto Color Emoji`). If the Pango delegate is
  unavailable it falls back to the bundled monochrome
  `src/assets/NotoEmoji-Light.ttf` (override with `GLYPH_FONT`) with a light
  outline, and prints a warning.
* Size: `GLYPH_BOX` (default `0.55`) of the tile, centred. `FEATURE_BOX`
  applies to artwork only.
* Plain-ASCII glyphs (fish `F`) use the default UI font.
* Re-run the compose script after changing `RESOURCE_GLYPHS`.

## 5. Updating a tile image

### Base or feature texture

1. Replace/add the PNG in `public/assets/tiles/`:
   * base: `terrain_<terrain>.png` (or numbered variants `_1`, `_2`, …),
   * feature sprite: `terrain_<terrain>_feature[_N].png`.
2. Keep the expected geometry:
   * base textures are square and drawn to the tile rect; **256×256** is the
     norm and the minimum for sharp rendering at maximum zoom,
   * feature sprites are **1.5:1** (e.g. 256×384): the lower square sits on
     the tile, the top half extends into the row above.
3. Textures are loaded once per page load. After replacing a file, hard-reload
   the browser (`Ctrl+Shift+R`); Vite serves `public/` directly.
4. The `ready` / `resourceTilesReady` promises of `TerrainTextureManager` fire
   the cache invalidation (`terrainTypesHashRef`, `terrainRebuildNeededRef` in
   `GameCanvas`), so no code change is needed for a file swap.

### Composed resource tile

Never hand-edit `terrain_<terrain>_<resource>[_N].png` — the compose script
overwrites it. Change the source (artwork or `RESOURCE_GLYPHS` / tile base) and
re-run the script instead.

### When does the static layer rebuild?

`GameCanvas.hashTerrainTypes()` hashes terrain type, exploration, resource,
improvement/road, river and village flags. Any change there rebuilds the base
exactly once; visibility changes only re-composite the fog overlay. The
viewport ground cache is keyed by camera + viewport + `terrainVersionRef`.

## 6. Adding a new special resource

1. Add an entry to `SPECIAL_RESOURCES` in `src/data/TerrainConstants.ts`
   (`name`, `terrain`, `terrains`, yields, description).
2. Add its glyph to `RESOURCE_GLYPHS` (same file) — the compose script parses
   both.
3. (Optional) drop artwork into `src/assets/resources/` as in section 3.
4. Add it to `TERRAIN_RESOURCES` if it should spawn on generated maps.
5. Run the compose script; `RESOURCE_TILE_FILES` and map spawns pick it up
   automatically.
6. Update `tests/resourceTiles.test.ts` if the legal pairings change.

## 7. Adding a new terrain type

1. `TERRAIN_TYPES` / `TERRAIN_PROPERTIES` in `src/data/TerrainConstants.ts`
   and the render info in `src/data/TerrainData.ts`.
2. `TerrainTextureManager.ts`: `TERRAIN_TEXTURE_FILES`, optionally
   `FEATURE_TEXTURE_FILES`, plus `TERRAIN_PRIORITY` and `TERRAIN_BLEND_COLOR`
   for the Wesnoth-style edge transitions.
3. Put the base PNG (and feature sprite) into `public/assets/tiles/`.
4. Add a preset/prompt to `tools/tile-generator/src/presets.ts` and
   `generate_terrain_v4.mjs` if the AI generator should produce it.
5. Re-run the compose script so existing resources that may appear on the new
   terrain get a picture.

## 8. Units and cities (dynamic — do not pre-render)

* Units: SVG icon in `src/assets/units/` + an entry in
  `src/data/UnitIconConfig.ts`; the emoji fallback comes from
  `UNIT_PROPERTIES[type].icon` in `src/data/UnitConstants.ts`
  (`UnitIconLoader` loads and caches both).
* Cities: drawn by `MapRenderer.drawCity()` — a civ-coloured square with the
  🏛️ emoji, name, specialists, walls, population and HP. They can be added and
  removed at runtime, so they must stay in the dynamic layer.
* Do **not** bake unit or city artwork onto terrain tiles.

## 9. Zoom & image quality

Canvas rendering works in CSS pixels (the backing store is not multiplied by
`devicePixelRatio`; only the minimap applies DPR). Quality therefore depends on
the texture source resolution and which terrain path is active:

| Camera zoom | Terrain source | Why |
| --- | --- | --- |
| `< 2` (`MapRenderer.DIRECT_TERRAIN_ZOOM`) | offscreen base at 2× native (64 px/tile) | at most 1:1 on screen, one cheap blit |
| `>= 2` (game max is 2.5) | direct per-tile draw from the source textures | avoids upscaling the 2× base; only a few tiles are visible, so per-tile transitions/features are affordable |

To stay sharp at maximum zoom, source assets should be **at least 256×256**
(base/features; composed tiles are 512×512 by default via `TILE_PX`). The
direct path can stay sharp up to roughly 8× zoom.

If you change the tile path logic:

* keep `DIRECT_TERRAIN_ZOOM` in sync with the offscreen `resolutionScale` in
  `renderTerrainBase` (currently 2),
* remember the ground cache key includes `camera.zoom`, so crossing the
  threshold rebuilds the viewport cache automatically,
* `drawTerrainTiles()` and `renderTerrainBase()` must stay visually identical —
  they share `drawStaticTileSymbols()` for exactly that reason.

## 10. Cheat sheet

```bash
# Compose / refresh every resource-on-tile picture (artwork + colour emoji)
node tools/tile-generator/compose_feature_tiles.mjs

# Useful flags / env
node tools/tile-generator/compose_feature_tiles.mjs --dry-run
node tools/tile-generator/compose_feature_tiles.mjs --only=gold,gems
node tools/tile-generator/compose_feature_tiles.mjs --no-glyphs
TILE_PX=512 FEATURE_BOX=0.85 GLYPH_BOX=0.55 SKIP_COPY=1 node tools/tile-generator/compose_feature_tiles.mjs

# Generate new AI base/feature textures
BACKEND=local node tools/tile-generator/generate_terrain_v4.mjs

# Verify
npm run lint && npm run type-check && npx vitest run tests/resourceTiles.test.ts
```

Checklist for a new/updated picture:

- [ ] Source artwork added under `src/assets/resources/` (or glyph updated in
      `RESOURCE_GLYPHS`).
- [ ] Pairings come from `SPECIAL_RESOURCES` — no hardcoded tile list edited.
- [ ] `compose_feature_tiles.mjs` run (no `!`/skip warnings).
- [ ] Output present in `public/assets/tiles/`, visually checked on the tile.
- [ ] `tests/resourceTiles.test.ts` passes.
- [ ] Game hard-reloaded and the tile checked at default and maximum zoom.
