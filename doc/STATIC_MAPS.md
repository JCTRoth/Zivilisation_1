# Static Maps

Hand-crafted maps that ship with the game instead of being procedurally
generated. They live in `src/data/maps/` and are the base for the in-game
**world map** ("Earth" map type).

## Folder layout

| File | Purpose |
| --- | --- |
| `src/data/maps/types.ts` | `StaticMapDefinition`, the Freeciv terrain legend (`FREECIV_TERRAIN_LEGEND`), helpers (`terrainIdForChar`, `hasSpecialResource`, `validateStaticMap`) |
| `src/data/maps/index.ts` | `STATIC_MAPS` registry, `WORLD_MAP_ID`, `WORLD_MAP` |
| `src/data/maps/earth-180x90.json` | Extracted Earth world map (180×90, 39.9 % land, 342 bonus resources, 30 start positions) |
| `scripts/extract-freeciv-map.mjs` | Extractor: Freeciv savegame → map data file |

## Extracting a map from a Freeciv savegame

```bash
node scripts/extract-freeciv-map.mjs <path/to/map.sav> [output-id]
# e.g. → src/data/maps/earth-180x90.json
```

The script reads the `[map]` section of a Freeciv 1.x `.sav`:

| Save key | Meaning |
| --- | --- |
| `width` / `height` | Map size |
| `t000="…"` … | Terrain, one character per tile |
| `n000="…"` … | Tile "specials" — `0` = none, anything else = bonus resource |
| `r0sx` / `r0sy` … | Hand-placed start positions (balanced spawns) |

Terrain legend: `' '` ocean, `a` arctic, `t` tundra, `d` desert, `p` plains,
`g` grassland, `f` forest, `j` jungle, `s` swamp, `h` hills, `m` mountains.

Data files keep the **raw** Freeciv characters, so they stay a faithful copy of
the source map; the game translates them at load time via
`FREECIV_TERRAIN_LEGEND`.

## How the map is used

1. `GameEngine` sets the map size for a map type (the `EARTH` type uses
   `180×90`, matching the static map).
2. `MapGenerator.generateEarth()` loads `WORLD_MAP` through `loadStaticMap`
   (characters → terrain, specials → bonus resources). Rivers are added
   procedurally because the source map has none; flood-fill groups, build sites
   and passability run like on any other map.
3. `GameEngine.createCivilizations()` prefers the map's hand-placed
   `startPositions` for the `EARTH` type (skipping ocean/mountain/too-close
   candidates) and falls back to the random land search.
4. The setup screen shows "Earth · 180×90 real-world geography".

## Adding more maps

1. Extract the map: `node scripts/extract-freeciv-map.mjs ~/maps/mymap.sav my-map`.
2. Register it in `src/data/maps/index.ts` (`STATIC_MAPS`).
3. To make it playable, add a map type that sizes the engine to the map and
   calls the loader (see `EARTH` in `GameEngine` / `MapGenerator`).

## Tests

`tests/staticMaps.test.ts` covers data integrity (size/legend/rows), the source
fingerprints of the world map (land and resource counts), the character →
terrain mapping, the special-flag → bonus-resource conversion, the full
generation pipeline and the start positions.
