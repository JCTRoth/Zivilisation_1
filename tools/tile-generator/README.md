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

1. Creates a folder named `<label>_<unix-timestamp>` under `tile_sets/`
   (`<label>` is the sanitised theme keyword, else the style keyword, else
   `classic`) so runs are findable by name and never overwritten.
2. Resolves the **global slots** once per iteration — the theme, the shared
   palette and the shared lighting mood. Every tile and sprite of that
   iteration uses them, so the set reads as one coherent art-direction pass.
3. For **every terrain** (`arctic`, `desert`, `forest`, …) it renders
   **three sibling ground tiles** (`TERRAIN_VARIANTS = 3`):

   - `terrain_<terrain>.png`, `terrain_<terrain>_1.png`,
     `terrain_<terrain>_2.png` — the game's `TerrainTextureManager` picks one
     of them per grid cell (stable per tile position), so neighbouring cells
     of the same terrain show different arrangements instead of one image
     stamped over and over,
   - the three share one palette and one light (the iteration globals) and one
     material; they differ only in how the ground pattern is arranged and
     scaled (`TERRAIN_VARIANT_NOTES`),
   - after rendering, `harmonise_terrain_edges` copies the primary tile's
     outer ring onto its siblings through a soft cross-fade, so **any two of
     the three meet on the board without a seam** while each keeps its own
     interior pattern,
   - each tile is resolved from the seven abstract terrain slots with Qwen,
     assembled into the structured prompt (title / style / subject details /
     technical specs) plus the negative prompt, and rendered with `sd-server`
     (FLUX.2 Klein) via `txt2img`, seamless on all four edges,
   - post-processing inpaints any near-black region (the model likes to put a
     diamond or a sprite on black) with the surrounding texture, so the tile is
     a continuous edge-to-edge surface.
4. For **every resource/terrain feature stem** of the fixed roster:

   - five fish (`fish1..5`, img2img from the artwork),
   - two proud wild horses (txt2img),
   - three forests (mixed, coniferous, deciduous), a liana-connected jungle,
     hills, swamp and four mountain variants with separately rolled
     atmosphere,
   - seven special resources: seal, gems, gold, coal, oil, game and oasis,
   - artwork-backed feature stems use img2img; other stems use their prompt,
   - positive silhouette/framing guidance is paired with a FLUX.2 negative
     prompt; output is saved under `features/` with untouched renders in
     `features/backup/`,
   - a border-sampled background color is keyed to transparent alpha, then
     stray blobs are removed and the sprite is centered.

5. For **every selected game unit** (`--units`; all 35 by default):

   - real game SVG artwork is rasterized for img2img when available; all
     remaining units use identity-pinned descriptions from `UNIT_SPECS`,
   - each unit receives three distinct prompt/image variants in `units/`, with
     untouched renders under `units/backup/`,
   - the whole roster shares a serious, hand-drawn strategy-game direction:
     mature anime / graphic-novel linework, controlled cel shading, consistent
     detail density and readable icon silhouettes.

6. **Feature sprites are never composited onto tiles in this script.** Compose
   logic (`compose_feature_tiles.mjs`) is deliberately kept out of the
   generator — this script only produces the clean asset set.

## Background removal

The sprite background color is sampled from the image border, then a flood fill
removes connected pixels close to that color. This handles gray fog, pale sky
and other non-black generated backdrops instead of assuming pure black. Two
knobs control edge quality and removal tolerance:

| Option | Default | Meaning |
|---|---|---|
| `--bg-level` | `28` | Color-distance tolerance (0-255) from the sampled border color. **Higher removes more.** |
| `--bg-softness` | `30` | The width of the **anti-aliasing ramp** 0-255. The ring of pixels around the removed background fades in instead of being cut with a hard, jagged edge. `0` is a hard edge. |

The edge pixels are softly feathered; enclosed background gaps can also be
removed while small enclosed subject details are preserved.

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

Unit prompts use their own shorter FLUX.2-friendly structure and a shared
serious hand-drawn strategy-game art direction, so each vehicle, ship and
historical unit keeps its own identity while the full unit roster looks like
one illustrated set.

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

# one set, only some terrains and resource features
python3 tools/tile-generator/generate_variated_tile_sets.py \
    --iterations 1 --terrains forest,ocean --features fish1,horses

# one themed set - the keyword is shot through shared palette and lighting;
# feature animals may swap to close themed equivalents
# (skeleton horse at Halloween, reindeer at Christmas, sea serpent at
# Transylvania, ...).  Terrain identities stay untouched.
python3 tools/tile-generator/generate_variated_tile_sets.py \
    --theme-keyword "Transylvania and vampires" --iterations 1

# writes a bash script that runs one tile-set job after another (one per
# comma separated keyword, '' = a classic run) and exits - start the script
# in the background and check the logs later, no monitoring needed
python3 tools/tile-generator/generate_variated_tile_sets.py \
    --write-batch "Halloween,Transylvania and vampires,Christmas,Easter,,," \
    > batch_check.log
nohup bash "tools/tile-generator/run_batch_<timestamp>.sh" > batch.out 2>&1 &
tail -5 tools/tile-generator/run_logs/<job>.log   # progress of one job

# only selected unit sprites; feature and unit selections are independent
python3 tools/tile-generator/generate_variated_tile_sets.py \
    --iterations 1 --no-terrains --units phalanx,mech_inf,settler

# units in the ORIGINAL game's flat vector icon look (terrain keeps its own
# semi-realistic style) — the FLUX.2 style string above
python3 tools/tile-generator/generate_variated_tile_sets.py \
    --iterations 2 --no-terrains --units all \
    --unit-style-keyword original_game_icons

# every terrain renders THREE sibling ground tiles (terrain_<t>.png,
# terrain_<t>_1.png, terrain_<t>_2.png) so neighbouring cells of the same
# terrain do not repeat one image
```

### Installing a generated run into the game

One command replaces the app's default tiles/features/units with the output of
one generated run, so `npm run dev` + a browser reload shows them on the board:

```bash
# <generated-folder> is either the run folder (tile_sets/<label>_<timestamp>/,
# its newest iteration is used) or one iteration folder directly
npm run tiles:install -- tools/tile-generator/tile_sets/classic_1792865487

npm run tiles:install -- <generated-folder> --iteration 2   # a specific one
npm run tiles:install -- <generated-folder> --dry-run       # list only
npm run tiles:install -- <generated-folder> --restore       # undo the install
```

What it does: it combines the generated `tiles/` and `features/` folders into
`public/assets/tiles/` and the generated `units/` sprites into
`public/assets/units/`, replacing the shipped assets:

- ground tiles (`terrain_<terrain>.png`, `_1`, `_2`) are copied as they are;
- the transparent **feature sprites** (`terrain_*_feature*.png` — forests,
  jungle, hills, swamp, mountains) are copied as they are, because the game
  draws that layer on top of the ground;
- the **resource tiles** (`terrain_<terrain>_<resource>.png` — fish, horses,
  game, seal, gems, gold, coal, oil, oasis) are **combined with their ground
  tile** first (the sprite is fitted into 85 % of the tile and centred, the
  geometry `compose_feature_tiles.mjs` uses). That is required:
  `TerrainTextureManager.getTileTexture` blits that file as the *whole* tile,
  so a bare transparent sprite would leave the cell empty. ImageMagick
  (`magick`) is used for the step — the same tool `compose_feature_tiles.mjs`
  needs; without it the files are copied unchanged and the script says so
  (`--no-compose` forces that behaviour);
- generated unit sprites take priority over the bundled SVG artwork, so they
  appear on the map immediately.

Every replaced original is kept once in `public/assets/_generated_backup/`
(git-ignored) and `--restore` puts it back — files the install added are
removed again, leaving the working tree exactly as it was.

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
| `TERRAINS` / `FEATURES` / `UNITS` | all | Comma-separated selections. `FEATURES` matches feature stems by variant base name (`forest_feature` renders forest_feature_1..3); `UNITS` accepts game keys (`phalanx`) or stems (`unit_phalanx`). With no selection both categories are generated. |
| `THEME_KEYWORD` | *(empty)* | Art-direction keyword for the whole run (Halloween, Christmas, "Transylvania and vampires", Easter, ...). |
| `STYLE_KEYWORD` | *(empty)* | One art style for every asset (`american_comic`, `manga`, …, `original_game_icons`, or any freeform phrase). |
| `UNIT_STYLE_KEYWORD` | *(empty)* | One art style for the **unit sprites only**; `original_game_icons` = the flat vector game-icon look. |
| `WRITE_BATCH` | *(empty)* | Comma separated keyword list; writing the batch script replaces generating. |
| `BATCH_ITERATIONS` | `1` | Iterations per job inside a generated batch script. |
| `RETRIES` | `3` | Render attempts per image. |
| `BG_LEVEL` | `28` | Border-color distance tolerance (higher removes more). |
| `BG_SOFTNESS` | `30` | Background removal edge softness (0 = hard edge). |

CLI flags `--iterations`, `--output-root`, `--strength`, `--feature-strength`,
`--steps`, `--cfg`, `--size`, `--feature-size`, `--seed`, `--retries`,
`--bg-level`, `--bg-softness`, `--terrains`, `--features`, `--units`, `--dry-run`,
`--no-terrains`, `--no-features`, `--no-units`, `--use-rembg`, `--keep-servers`,
`--theme-keyword`, `--style-keyword`, `--unit-style-keyword`, `--write-batch`
and `--batch-iterations` override the environment.

## Output layout

```
tile_sets/
└── <label>_<unix_timestamp>/
    ├── run.json                          # summary of the whole run
    └── iteration_01/
        ├── theme.txt                     # art-direction theme phrase
        ├── manifest.json                 # prompts, keywords, outputs
        ├── keywords_global.json          # the resolved global slots
        ├── prompt_<terrain>.txt          # terrain variant 1 prompt + negative
        ├── keywords_<terrain>.json       # terrain variant 1 slots
        ├── prompt_<terrain>_1.txt        # ... variant 2
        ├── prompt_<terrain>_2.txt        # ... variant 3
        ├── prompt_feature_<name>.txt     # full structured feature prompt + negative
        ├── keywords_feature_<name>.json  # the resolved feature slots
        ├── prompt_unit_<name>.txt        # full structured unit prompt + negative
        ├── keywords_unit_<name>.json     # the resolved unit slots
        ├── tiles/                        # all terrain tiles
        │   ├── terrain_<terrain>.png     # ground variant 1
        │   ├── terrain_<terrain>_1.png   # ground variant 2
        │   └── terrain_<terrain>_2.png   # ground variant 3
        ├── features/                     # resource/terrain feature sprites (alpha!)
        │   ├── terrain_<terrain>_<resource>.png
        │   └── backup/                   # untouched feature renders
        └── units/                        # game unit sprites (alpha!)
            ├── unit_<unit_key>.png       # one sprite per game unit
            ├── unit_<unit_key>_2.png     # ... plus 2 more variants each
            ├── unit_<unit_key>_3.png
            └── backup/                   # untouched unit renders
```

In every per-iteration `manifest.json` the unit entries also record the
game data they were built from: `unit` (display name), `game_icon` (the
fallback emoji shown in the game) and `game_artwork` (the SVG file used as
the img2img source) plus `source` (`game svg artwork (img2img)` or
`fixed text description`).

## Feature rules

- Feature sprites show **only the feature** (e.g. a single fish, a tree
  group) — never a scene, never a terrain background.
- Feature sprites have **transparent backgrounds**.
- Feature input pictures must themselves show only the feature. Full-tile
  scenes (like the VTracer SVGs) are rejected as inputs.
- Stems in `FEATURE_TEXT_ONLY_STEMS` (horses, the three forests, jungle,
  all four mountain variants) always render from the prompt alone, so the
  composition (proud wild pose, tree group, peak range) comes from the
  generator, not from the old artwork.
- The output names are the ones the game expects
  (`terrain_ocean_fish.png`, `terrain_forest_feature_1.png`, …).
- Important sprite shape and framing constraints are phrased **positively**;
  the generator also passes a negative prompt to FLUX.2 for unwanted content.
- The per-iteration rolls (one atmosphere per mountain variant, the crazy
  extra of the dramatic mountain variant) are logged under `rolls` in the
  per-iteration `manifest.json`.

## Unit rules

- **Three variants per unit and iteration** (`unit_<key>.png`,
  `unit_<key>_2.png`, `unit_<key>_3.png`, `UNIT_VARIANTS = 3`), each with
  its own freshly resolved prompt and manifest record under
  `variants` in the per-iteration manifest; variant 1 also carries the
  classic top-level `output`/`backup` fields.
- One sprite per game unit, named `unit_<game unit key>.png`
  (`unit_warrior.png`, `unit_battleship.png`, ...) — 35 units, parsed from
  `src/data/UnitConstants.ts`.
- If the game ships artwork (`src/assets/units/*.svg`, referenced by
  `UnitIconConfig`), that artwork is rasterised with inkscape and used as
  the img2img input, so the sprite keeps the identity of the real game
  picture. For those units the `UNIT_SPECS` description is written to match
  the **actual source artwork**, not an idealised textbook design — e.g. the
  Trireme artwork is an ancient Mediterranean galley with **one** low bank of
  long parallel oars, a large **furled lateen sail** on a long diagonal
  yardarm, a rectangular masthead banner and a stern steering oar. Asking
  FLUX.2 for three stacked banks of oars on that canvas produces warped oar
  layers and hull artifacts, so the spec pins what the image already shows.
- Everything else (legion, catapult, cavalry, destroyer, diplomat,
  fisher boat, mech. inf., nuclear, ...) is composed from the fixed,
  hand-written descriptions in `UNIT_SPECS` — identity phrase, kind
  anchors and full slot fallbacks per unit. Single-figure units add a
  positively phrased limb-completeness clause; groups and crews use
  composition-specific instructions instead. The catapult, cannon
  and artillery descriptions describe the classic two-wheeled, spoked-
  wheel gun-carriage look.
- The game's fallback emoji is recorded in the manifest only; emoji shapes
  are never fed to the image model.
- Units share a serious hand-drawn graphic-novel / mature-anime strategy-game
  illustration direction by default: consistent ink contours, controlled cel
  shading, grounded colors and clean silhouettes at icon size. Explicit
  `--style-keyword` overrides the default while keeping the treatment coherent.
- The message `SVG artwork could not be rasterised -> text-only` in a log
  means a unit fell back from img2img to its description (missing
  inkscape or unreadable SVG) — the sprite is still produced.
- Units are selected independently with `--units`: e.g. `--units phalanx` or
  `--units unit_phalanx,mech_inf`. `--features` selects only feature sprites;
  the legacy `--features units` spelling remains accepted.

## Themed runs (--theme-keyword)

- The keyword (e.g. `Halloween`, `Christmas`, `Transylvania and vampires`)
  is injected into the iteration-global resolution — theme phrase, palette
  and lighting must be clearly shot through with it — and into the theme
  string every prompt carries.
- Feature slot resolution additionally receives a clause that
  allows swapping a featured **animal** for a close themed equivalent (a
  ghost/skeleton horse at Halloween, a reindeer at Christmas, a sea serpent
  at Transylvania) while keeping it recognisable: the per-spec anchor
  lists contain the equivalent nouns (`nightmare`, `reindeer`, `shark`, ...).
- Terrain identity anchors are untouched: a Halloween forest is still a
  forest, an Easter desert still a desert.
- Themed runs are logged under `theme_keyword` in `run.json` and the
  keyword is part of every theme.

## Art-style runs (--style-keyword)

- A style is **not** a theme: it changes only HOW every asset is rendered
  (technique, linework, shading, medium), never any subject identity.
- `--style-keyword <name|phrase>` accepts one of the registry names
  (`STYLE_KEYS` in the script — `american_comic`, `manga`, `pixel_art`,
  `papercraft`, `watercolor_storybook`, `stained_glass`, `byzantine_mosaic`,
  `greek_pottery`, `norse_woodcarving`, `illuminated_manuscript`,
  `constructivist_poster`, `art_deco_poster`, `linocut_print`,
  `tarot_engraving`, `vintage_box_art`, `anime_cel`, `naive_folk_art`,
  `egyptian_tomb`, `ligne_claire`, `painted_miniature`,
  `original_game_icons`) or any freeform phrase; a registry name is upgraded
  to its handcrafted descriptor.
- `--unit-style-keyword <name|phrase>` (env `UNIT_STYLE_KEYWORD`) applies a
  style **to the game unit sprites only** — terrain and resource features keep
  `--style-keyword`. Use `--unit-style-keyword original_game_icons` to render
  units in the original game's flat vector icon look:

  ```
  2D flat vector strategy game asset style, clean graphic game icon art
  direction. Uniform bold black outlines on elements combined with crisp
  lineless vector shapes. Flat solid color blocks, hard-edged geometric
  cel-shading, absolute absence of gradients or textures. Matte finish with
  simple pill-shaped white specular highlights on polished surfaces.
  High-contrast bold silhouettes, centered framing, isolated on a uniform
  flat solid pure black background.
  ```

  That is what unites the clean lineless game icons (musketeer) and the
  outlined ones (cannon, archer) into one look: solid opaque colours, one
  hard-edged shadow step down per surface, pill-shaped white speculars
  instead of glows, no gradients or texture, hybrid bold outlines on
  simplified geometric forms. The framing (isometric 3/4, centred, isolated
  on pure black) stays with the prompt; the style string carries only the
  technique.
- Injection is deterministic: the descriptor lands in the `Style & Art
  Direction` line of every terrain and feature/unit prompt (even purely
  fallback-generated ones) and replaces the FEATURE_RENDERING slot.
- `--write-batch <names> --batch-style-mode` writes a style tour; with
  `--batch-terrains` / `--batch-features` you pin one fixed selection
  across all jobs. The descriptor is recorded as `STYLE_PHRASE` in
  `keywords_global.json` and in the iteration manifest globals.

## Illustration-style tile generator (new script)

`generate_illustration_styles.py` is a second, focused tile-set generator:
it produces seamless **terrain tiles in one of the ten classic illustration
styles** — Line Art, Flat Vector Illustration, Isometric Illustration,
Watercolor Illustration, Ink Wash / Sumi-e, Pixel Art, Low Poly, Comic Book
/ Graphic Novel Style, Art Nouveau, Paper Cut / Collage Illustration.

- It reuses the whole abstract slot engine of
  `generate_variated_tile_sets.py` (the `#KEYWORD#` templates, the identity
  guards, the fallbacks, the prompt registry) and only swaps the art direction
  (the `Style & Art Direction` prompt line) for the selected style descriptor.
  Subject identities are never re-rolled — a forest is still a forest, just
  drawn as line art now.
- `--style <key|phrase>` accepts one of the ten illustration keys
  (`line_art`, `flat_vector`, `isometric`, `watercolor`, `ink_wash`, `pixel_art`,
  `low_poly`, `comic_book`, `art_nouveau`, `paper_cut`), a comma separated list
  or any freeform style phrase (e.g. `--style "flat vector"`).
- Per style and iteration it resolves the global slots, builds and renders all
  terrain tiles, writes `theme.txt`, `keywords_*.json`, `prompt_*.txt`,
  `manifest.json` and `tiles/terrain_<terrain>.png` into
  `tile_sets/<style>_<timestamp>_<iteration>/iteration_<nn>/`.

```bash
# one style, one tile set
python3 tools/tile-generator/generate_illustration_styles.py --style line_art

# one style, hand-picked terrains
python3 tools/tile-generator/generate_illustration_styles.py \
    --style watercolor --iterations 1 --terrains forest,ocean

# all ten styles
python3 tools/tile-generator/generate_illustration_styles.py --style all \
    --iterations 2
```

- `--write-batch` writes a bash script that runs one illustration-style job
  per style key (with `--iterations` and `--terrains` forwarded), so a whole
  style tour can run unattended in the background.

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
