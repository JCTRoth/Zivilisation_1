# Tile Generator — Variated Tile Sets

This tool generates complete, varied tile sets for the game. Each run produces
a unix-timestamped folder containing, per iteration, a full set of **terrain
tiles** and **feature sprites** (isolated, transparent background), ready to
drop into `public/assets/tiles`.

## The abstract prompt system

Nothing that reaches the image model is written by hand. Every prompt is a
**template full of `#KEYWORD#` slots**, and at run time the local Qwen model
(`llama-server`) resolves every slot with a fresh, concrete English phrase.
That is what makes every run of this script produce a genuinely different
asset set — and it is why the same code yields a new art direction every
single time.

```
# global slots (one call per iteration - shared by the whole set)
THEME_PHRASE     the mood of the set (season, time of day, light quality)
GLOBAL_PALETTE   the shared colour mood
GLOBAL_LIGHTING  the shared lighting mood

# terrain slots (one call per terrain)
SURFACE_FORM     the overall kind of terrain
BASE_MATERIAL    the dominant ground material
TEXTURE_DETAIL   micro texture and small structures
ACCENT_ELEMENT   small scattered decorations on the surface
EDGE_ELEMENT     tiny details toward the tile corners
LIGHTING_NOTE    one short sentence about light and shadow
COLOR_PALETTE    the concrete colour range of the terrain

# feature slots (one call per feature)
FEATURE_KIND     what the feature is
FEATURE_FORM     shape, pose and silhouette
FEATURE_DETAIL   surface detail, markings, texture
FEATURE_PALETTE  the natural colour range of the feature
FEATURE_LIGHTING how the light falls on the feature
FEATURE_RENDERING the rendering treatment (outlines, shading)
```

The terrain template reads like this (only the slots vary, ever):

```
subject ....: "a #SURFACE_FORM#"
details ....: "A continuous surface of #BASE_MATERIAL# with #TEXTURE_DETAIL#,
               #ACCENT_ELEMENT#, and #EDGE_ELEMENT#. #LIGHTING_NOTE# The surface
               is rendered in #COLOR_PALETTE#, unified by a #GLOBAL_PALETTE#
               and #GLOBAL_LIGHTING#."
```

### Keeping the subject recognisable

Free variation would eventually turn a forest into a desert, so every slot
resolution is fenced in by four independent guards:

| Guard | What it prevents |
|---|---|
| `TERRAIN_IDENTITIES` / `FEATURE_SPECS["identity"]` | The model is told what the asset is and must stay that. |
| `TERRAIN_ANCHORS` / `anchors` | `SURFACE_FORM` must contain a word of the terrain (`forest`, `dune`, …). |
| `TERRAIN_PALETTE_ANCHORS` | The colour palette must keep the colour family of the terrain. |
| `TERRAIN_FORBIDDEN` / `FEATURE_FORBIDDEN` | Words that would betray the subject are rejected (`cracks` on water, `school` for a single fish). |

`TERRAIN_IDENTITY_CLAUSE` adds one short fixed sentence per terrain
("Liquid open sea water with moving ripples, unmistakably deep water.") so
the material itself can never be misread.

### Never breaking a run

* the JSON of the model is parsed robustly — code fences, trailing commas,
  broken braces and a per-key regex fallback are all handled,
* a slot that comes back unusable is re-asked individually,
* whatever is still missing falls back to a per-slot default phrase
  (`TERRAIN_FALLBACKS`, `FEATURE_FALLBACKS`, `GLOBAL_FALLBACKS`),
* a phrase that was already used in this run is re-rolled, so no two tiles
  end up with the same description,
* a full prompt that is already in the registry is re-rolled, so no two
  assets of a run share the same prompt,
* an iteration theme that is too similar to an earlier one is re-asked — the
  local model has a strong prior ("golden hour glow over …") and would
  otherwise paint every iteration in the same light.

## What it does

For every run:

1. Creates a unix-timestamped folder under `tile_sets/` so previous runs are
   never overwritten.
2. Resolves the **global slots** once per iteration — the theme, the shared
   palette and the shared lighting mood. Every tile and sprite of that
   iteration uses them, so the set reads as one coherent art-direction pass.
3. For **every terrain** (`arctic`, `desert`, `forest`, …):
   - resolves the seven abstract terrain slots with Qwen,
   - assembles the structured prompt (title / style / subject details /
     technical specs) plus the negative prompt,
   - renders it with `sd-server` (FLUX.2 Klein) via `txt2img`,
   - post-processes the output: any near-black region (the model likes to
     put a diamond or a sprite on black) is inpainted with the surrounding
     texture, so the tile is a continuous edge-to-edge surface,
   - writes `tiles/terrain_<terrain>.png`.
4. For **every feature input picture** in `src/assets/resources`:
   - only **feature-only** inputs are used (e.g. `fish1.png` … `fish5.png`,
     which show just the fish on transparency). The VTracer SVGs
     (`fish.svg`, `horses*.svg`) are full tile scenes *with* backgrounds and
     are therefore **excluded** — features must never have a background,
   - prepares the input: white/alpha key, keep the main subject, fit into
     the 1.5:1 sprite canvas and flatten onto pure black,
   - renders the sprite with `sd-server` via `img2img`, so the sprite keeps
     the identity of the input artwork while the local model re-skins it,
   - **copies the untouched render into `features/backup/<name>.png`** before
     the background is removed, so the original is never lost,
   - removes the black background to a **transparent alpha channel** (a
     border flood fill that keeps dark parts *inside* the subject — far more
     accurate than a global black key and instant; `rembg` is available via
     `--use-rembg`),
   - post-processes the sprite: stray opaque blobs are dropped and the
     feature is centred in the canvas,
   - writes `features/terrain_<terrain>_<resource>.png` — the exact file
     names `TerrainTextureManager` expects.
5. **Features are never composited onto tiles in this script.** Compose logic
   (`compose_feature_tiles.mjs`) is deliberately kept out of the generator —
   this script only produces the clean asset set.

## Background removal

The sprite background is removed with a flood fill that starts at the image
border, so only background that actually touches the border is removed. Two
knobs control how aggressive it is:

| Option | Default | Meaning |
|---|---|---|
| `--bg-level` | `28` | The **black point** 0-255. A pixel counts as background when its brightest channel is below the level *and* its darkest channel is below half the level — the background has to be really black, so a dark but coloured subject (a deep blue fish, a dark green canopy) is never eaten away. **Higher removes more.** |
| `--bg-softness` | `30` | The width of the **anti-aliasing ramp** 0-255. The ring of pixels around the removed background fades in instead of being cut with a hard, jagged edge. `0` is a hard edge. |

With the old fixed threshold the key still cut away 441 (fish) to 1092
(swamp) subject pixels; with the new rule **no** subject pixel is lost any
more, and the edge is soft.

The same `backup` rule applies to the input scan: a folder named `backup` is
never processed, so the untouched originals can be kept next to the results
without ever being used as an input.

## Prompt structure

All prompts follow this structure (example: mountains):

```
Seamless top-down 2D ground texture map of a rough uneven rocky terrain, pure
orthographic bird's-eye view looking straight down at the ground plane, 90% to
100% full-bleed canvas coverage, flat surface pattern, seamlessly tileable on
all four edges, natural varied non-repeating pattern.

Style & Art Direction: Highly detailed semi-realistic digital painting, modern
strategy game illustration, intricate surface details, natural textures,
realistic lighting and soft shading, crisp high resolution, no thick cartoon
outlines. <theme phrase>

Subject Details: A continuous surface of <BASE_MATERIAL> with <TEXTURE_DETAIL>,
<ACCENT_ELEMENT>, and <EDGE_ELEMENT>. <LIGHTING_NOTE> The surface is rendered
in <COLOR_PALETTE>, unified by a <GLOBAL_PALETTE> and <GLOBAL_LIGHTING>.
<identity clause> No peaks, no cliffs, no vertical elements - only the flat
rocky ground layer. Strict top-down bird's-eye view. No horizon, no sky, no
scenery, no buildings, no characters, no animals, no frame and no vignette -
only the flat ground surface, edge to edge.

Technical Specs: Flat map view, strictly top-down overhead perspective, no
tree trunks, no side perspective, no vertical horizon, continuous organic
texture, no repeating grid pattern, even coverage from edge to edge, crisp 8k
digital painting.
```

Negative prompt (terrain):

```
photorealistic, realistic landscape, photography, border frame, ground plane
background, horizon line, sky, ambient occlusion shadows on canvas, cut off
edges, blurry lines, 3D render artifacts, low resolution, empty background,
transparent corners, grid lines, diamond layout, repeating pattern, tiled grid,
isolated subject on black, black background, pitch black, vignette, frame,
picture, poster, text, watermark, characters, buildings, animals
```

Feature prompts use the same structure, but the title line is
`isometric 2D video game resource feature sprite of <subject>, …` and the
Subject Details explicitly state that the sprite shows only the feature on a
completely empty black `#000000` background.

The feature negative prompt bans every *competing* backdrop (scenery, terrain,
water, horizon, a white or gradient background) but deliberately not the word
"background" itself — the sprite must sit on a **black** background.

## Prerequisites

- Python 3 with `Pillow`, `numpy` and (optionally) `opencv-python`
- `rembg` — only needed for `--use-rembg` (optional)
- Local AI servers (the script starts both automatically if they are not
  already running):
  - `sd-server` (FLUX.2 Klein) — binary at
    `/home/jonas/Schreibtisch/Image_to_Image/GPZ/New/stable-diffusion.cpp/build/bin/sd-server`
  - `llama-server` (Qwen3-4B) — binary at
    `/home/jonas/git/Local_AI/source/llama.cpp/build/bin/llama-server`

## Usage

```bash
cd /home/jonas/git/Zivilisation_1

# 10 varied tile sets (default)
python3 tools/tile-generator/generate_variated_tile_sets.py --iterations 10

# only resolve the prompts with the local model, render nothing
python3 tools/tile-generator/generate_variated_tile_sets.py --dry-run

# one set, only some terrains and features
python3 tools/tile-generator/generate_variated_tile_sets.py \
    --iterations 1 --terrains forest,ocean --features fish1,horses
```

### Environment overrides

| Variable | Default | Meaning |
|---|---|---|
| `ITERATIONS` | `10` | Number of tile sets to generate. |
| `OUTPUT_ROOT` | `tools/tile-generator/tile_sets` | Base output directory. |
| `STRENGTH` | `0.6` | Generic img2img denoising strength. |
| `FEATURE_STRENGTH` | `0.7` | img2img denoising strength for feature sprites. |
| `STEPS` | `4` | Sampling steps. |
| `CFG` | `1.0` | Classifier-free guidance scale. |
| `SIZE` | `512` | Terrain output size in pixels. |
| `FEATURE_SIZE` | `256` | Feature sprite width (height is 1.5×). |
| `SEED` | `-1` | Base seed for reproducible runs (-1 = random). |
| `TERRAINS` / `FEATURES` | all | Comma separated allow lists. |
| `RETRIES` | `3` | Render attempts per image. |
| `BG_LEVEL` | `28` | Background removal level (black point, higher removes more). |
| `BG_SOFTNESS` | `30` | Background removal edge softness (0 = hard edge). |

CLI flags `--iterations`, `--output-root`, `--strength`, `--feature-strength`,
`--steps`, `--cfg`, `--size`, `--feature-size`, `--seed`, `--retries`,
`--bg-level`, `--bg-softness`, `--terrains`, `--features`, `--dry-run`,
`--no-terrains`, `--no-features`, `--use-rembg` and `--keep-servers` override
the environment.

## Output layout

```
tile_sets/
└── <unix_timestamp>/
    ├── run.json                          # summary of the whole run
    └── iteration_01/
        ├── theme.txt                     # art-direction theme phrase
        ├── manifest.json                 # prompts, keywords, outputs
        ├── keywords_global.json          # the resolved global slots
        ├── prompt_<terrain>.txt          # full structured prompt + negative
        ├── keywords_<terrain>.json       # the resolved terrain slots
        ├── prompt_feature_<name>.txt     # full structured prompt + negative
        ├── keywords_feature_<name>.json  # the resolved feature slots
        ├── tiles/                        # all terrain tiles
        │   └── terrain_<terrain>.png
        └── features/                     # all feature sprites (alpha!)
            ├── terrain_<terrain>_<resource>.png
            └── backup/                   # the untouched renders
                └── terrain_<terrain>_<resource>.png
```

## Feature rules

- Feature sprites show **only the feature** (e.g. a single fish) — never a
  scene, never a terrain background.
- Feature sprites have **transparent backgrounds**.
- Feature input pictures must themselves show only the feature. Full-tile
  scenes (like the VTracer SVGs) are rejected as inputs.
- The output names are the ones the game expects
  (`terrain_ocean_fish.png`, `terrain_forest_feature_1.png`, …).

## Troubleshooting

- **sd-server crashes mid-run** — the script restarts it automatically and
  retries up to `--retries` times per image, falling back to the original
  tile/input on failure.
- **Empty Qwen prompts** — the script prepends `/no_think` and falls back to
  `reasoning_content` if `content` is empty; broken JSON is repaired, and
  unusable slots fall back to their default phrase.
- **Feature sprite still has a background** — raise the key threshold in
  `key_out_black()` or use `--use-rembg`.
- **No output folder** — check `/tmp/sd_server_variate.log` and
  `/tmp/llama_server_variate.log`.
