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
4. For **every feature stem** of the fixed roster:

   - five fish (`fish1..5`, img2img from the artwork),
   - two **proud, strong, wild horses** (txt2img: standing tall / galloping
     at full stride - motion is allowed, and the frame may hold **one or a
     small group** of horses; every horse is anatomically correct with
     **all four legs clearly visible**),
   - **one sprite for every game unit** (`unit_<key>.png`, 35 units) - units
     with real artwork (`src/assets/units/*.svg`, wired in
     `UnitIconConfig`) are rendered **img2img from a rasterised copy of
     that artwork**, so the sprite keeps the identity of the picture the
     game actually uses; all other units render **from their fixed
     descriptions** in `UNIT_SPECS` (the game's fallback emoji is only
     recorded in the manifest - it is monochrome and often unrelated, e.g.
     a top hat for the diplomat, a radiation sign for the nuclear missile -
     so emoji shapes are never fed to the model). Naval and air units
     render on a landscape canvas; every mounted unit (chariot, knights,
     cavalry, caravan) carries the same all-four-legs clause as the horses,
   - **every unit is rendered in THREE variants** (`unit_<key>.png`,
     `unit_<key>_2.png`, `unit_<key>_3.png`), each with its own freshly
     resolved prompt, so a run yields 105 unit sprites,
   - every unit showing a person or an animal carries the positively
     phrased clause "*every arm and every leg is drawn complete, clearly
     visible and in a natural easy stance, nothing cropped*" - a moderate
     framing clause, deliberately not a hard anatomy audit (which makes
     FLUX over-correct into doubled/stiff limbs),
   - **three forests, always** (`terrain_forest_feature_1` **mixed**,
     `_2` **coniferous**, `_3` **deciduous**) - a group of individual trees,
     each tree complete with trunk and crown and fully visible inside the
     frame (txt2img),
   - the **jungle**: a group of tall tropical trees, connected by winding
     **lianas** (txt2img),
   - hills + swamp (img2img),
   - **FOUR mountain variants, always rendered** (`terrain_mountains_feature_1..4`):
     several peaks side by side / the **dramatic variant** with a rolled
     crazy extra (erupting lava, glowing crystals, a huge waterfall, a rock
     arch, a ruined watchtower) / twin massive peaks / a long ridge line
     with foothills. Every variant rolls its own atmosphere per iteration
     (sometimes fog, sometimes snow, sometimes low valley mist, sometimes a
     clear face), and **every peak is whole and fully visible** (all
     txt2img),
   - the seven special resources that previously only had glyph icons:
     **seal** (arctic), **gems** (jungle), **gold** (mountains), **coal**
     (hills), **oil** (swamp), **game** (forest), **oasis** (desert) -
     each a feature-only sprite (txt2img),
   - stems prepared from artwork (`fish1..5`, `hills_feature`,
     `swamp_feature`) are **img2img** from the feature-only input flattened
     onto pure black, so they keep the identity of the artwork; every other
     stem is composed purely from the prompt,
   - **all framing rules are phrased positively** ("the whole subject
     complete and fully visible inside the frame", "generous clear margin on
     all four sides", "the entire frame beneath the group stays empty solid
     black") - FLUX.2 ignores negative prompts, so constraints live in the
     positive prompt and the identity anchors,
   - **copies the untouched render into `features/backup/<name>.png`** before
     the background is removed, so the original is never lost,
   - removes the black background to a **transparent alpha channel** (a
     border flood fill that keeps dark parts *inside* the subject — far more
     accurate than a global black key and instant; `rembg` is available via
     `--use-rembg`); enclosed background gaps *between* the trees of a group
     are keyed out as well once they are bigger than 0.2 % of the canvas,
     so the terrain shows through them,
   - post-processes the sprite: stray opaque blobs are dropped and the
     feature is centred in the canvas,
   - writes the exact file names the game and `compose_feature_tiles.mjs`
     expect (`terrain_ocean_fish.png`, `terrain_forest_feature_2.png`,
     `terrain_arctic_seal.png`, ...).

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

# one themed set - the keyword is shot through theme, palette, lighting and
# every resolved slot; feature animals may swap to close themed equivalents
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

# only the unit sprites of all 35 game units (all stems: features + units)
python3 tools/tile-generator/generate_variated_tile_sets.py \
    --iterations 1 --no-terrains --features units
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
| `TERRAINS` / `FEATURES` | all | Comma separated lists. `FEATURES` matches stems by variant base name (`forest_feature` renders forest_feature_1..3 or `mountains_feature` 1..4), the entry `units` renders all 35 unit sprites, and a stem named exactly forces an optional stem on (all stems render always right now). |
| `THEME_KEYWORD` | *(empty)* | Art-direction keyword for the whole run (Halloween, Christmas, "Transylvania and vampires", Easter, ...). |
| `WRITE_BATCH` | *(empty)* | Comma separated keyword list; writing the batch script replaces generating. |
| `BATCH_ITERATIONS` | `1` | Iterations per job inside a generated batch script. |
| `RETRIES` | `3` | Render attempts per image. |
| `BG_LEVEL` | `28` | Background removal level (black point, higher removes more). |
| `BG_SOFTNESS` | `30` | Background removal edge softness (0 = hard edge). |

CLI flags `--iterations`, `--output-root`, `--strength`, `--feature-strength`,
`--steps`, `--cfg`, `--size`, `--feature-size`, `--seed`, `--retries`,
`--bg-level`, `--bg-softness`, `--terrains`, `--features`, `--dry-run`,
`--no-terrains`, `--no-features`, `--use-rembg`, `--keep-servers`,
`--theme-keyword`, `--write-batch` and `--batch-iterations` override
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
            ├── unit_<unit_key>.png       # one sprite per game unit
            ├── unit_<unit_key>_2.png     # ... plus 2 more variants each
            ├── unit_<unit_key>_3.png
            └── backup/                   # the untouched renders
                └── terrain_<terrain>_<resource>.png
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
- Everything the sprite should obey is phrased **positively** in the prompt
  ("every tree complete and fully visible inside the frame", "the entire
  frame beneath the group stays empty solid black"): FLUX.2 has no negative
  prompt support, so negated constraints would only be ignored.
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
  picture.
- Everything else (legion, catapult, cavalry, destroyer, diplomat,
  fisher boat, mech. inf., nuclear, ...) is composed from the fixed,
  hand-written descriptions in `UNIT_SPECS` — identity phrase, kind
  anchors and full slot fallbacks per unit.  Units showing a person or an
  animal add the limb-completeness clause; the catapult, cannon
  and artillery descriptions describe the classic two-wheeled, spoked-
  wheel gun-carriage look.
- The game's fallback emoji is recorded in the manifest only; emoji shapes
  are never fed to the image model.
- The message `SVG artwork could not be rasterised -> text-only` in a log
  means a unit fell back from img2img to its description (missing
  inkscape or unreadable SVG) — the sprite is still produced.
- `unit_*` stems render in the batch order of features first, then units;
  `--features units` renders only units, `--features unit_legion` a single
  one.

## Themed runs (--theme-keyword)

- The keyword (e.g. `Halloween`, `Christmas`, `Transylvania and vampires`)
  is injected into the iteration-global resolution — theme phrase, palette
  and lighting must be clearly shot through with it — and into the theme
  string every prompt carries.
- Feature and unit slot resolution additionally receive a clause that
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
  `egyptian_tomb`, `ligne_claire`, `painted_miniature`) or any freeform
  phrase; a registry name is upgraded to its handcrafted descriptor.
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
