Use specific types: Always define explicit types, interfaces, or generic constraints for all variables, parameters, and return types
Avoid `any`: The `any` type is strictly forbidden. If the type is truly uncertain, use `unknown` combined with type narrowing or type guards instead.
Put interfaces and types in the `types/` folder, and import them from there
Always define function parameter with types and return types
Keep TSX components purely presentational (JSX only)
Move CSS → src/styles, static data → src/data, utility functions → src/utils, tests -> __tests__
Assume npm server is already running at port 3000
You are running on a Ubuntu/Fedora system all command are availablell, install what is missing if needed

...Modal.tsx Classes should never conatine any extended logic. If needed create a class in the /src/game/engine
folder.

## Playwright E2E Test Guidelines

### Fail-fast setup (MANDATORY — never bypass)
The e2e suite is built around a strict fail-fast strategy:
- `e2e/global-setup.ts` pre-checks HTTP connectivity to `http://localhost:3000`.
  If the app is unreachable it throws, and the whole run aborts before any browser launches.
- `e2e/setup/app-setup.spec.ts` is the CORE SETUP spec. It verifies the app responds,
  mounts, and that the landing page renders. It runs first in its own `setup` project,
  and the `chromium` project declares a dependency on it — a failed setup test skips ALL feature tests.
- `maxFailures: 1` is set in `playwright.config.ts` — the run stops after the first failure anywhere.

Never reorder, rename, or disable the setup spec or the setup project, and never commit `test.only`.
New feature tests must NOT re-check connectivity on their own; they rely on the setup gate.

### File & folder organisation
- Keep Playwright specs under `e2e/`. Do not scatter them elsewhere.
- Shared helpers (game startup, turn advancement, dialog dismissal, top-menu/side-panel
  openers) are defined at the top of `e2e/game.spec.ts`. Reuse them — never copy-paste
  helper logic into new specs.
- Core/connectivity checks go in `e2e/setup/app-setup.spec.ts`. Feature tests go in dedicated spec
  files (e.g. `e2e/city.spec.ts`, `e2e/diplomacy.spec.ts`) with one `describe` block per feature area.

### Writing good tests
- Always start games with `startGame(page)` using the smallest map preset (`CLOSEUP_1V1`) for speed.
- Prefer accessible selectors (roles, labels, text) over CSS classes; use `.locator('.class')` only
  when no semantic hook exists.
- Keep tests independent: each test starts a fresh game; never share mutable state between tests.
- Use explicit timeouts on slow async UI (e.g. AI turn processing) and `page.on('pageerror')`
  to fail on uncaught exceptions when relevant.
- After changing a spec, run `npx playwright test e2e/setup` first, then the affected feature spec,
  then the full suite.

## Quick-start / Dev mode

Append `?quickstart` to the local URL (e.g. `http://localhost:3000/?quickstart`) to skip the
setup modal and launch directly into a game with sensible defaults and **developer mode** enabled.

What it does:
- Skips the civilization/difficulty/map setup screen entirely.
- Starts a 2-player NORMAL_SKIRMISH game on Prince difficulty with the Germans civilization.
- Enables **dev mode** — reveals the full map (no fog of war), shows all players on the minimap,
  and allows switching between civilizations for debugging.
- Cleans the `?quickstart` parameter from the URL after reading it (so a refresh doesn't loop).

Use this when you want to get into gameplay as fast as possible during development or when
debugging game-engine logic, AI behaviour, rendering, or UI issues.

## Tile Generator & Terrain Textures

The AI tile generator lives in `tools/tile-generator/` and writes its output directly into
`Zivilisation_1/public/assets/tiles/`. It is a Wesnoth-style **two-layer** system:

- **Layer 1 — base ground tiles**: 256×256, flat top-down, seamless. Named `terrain_<type>.png`.
- **Layer 2 — feature sprites**: 256×384 (1.5:1), transparent background. Named
  `terrain_<type>_feature.png`. Drawn on top of the base tile with the painter's algorithm.

### Running it
```bash
cd tools/tile-generator
npm start                     # UI + API server on http://localhost:3456 (uses the local SD server)
node generate_terrain_v4.mjs  # batch-generate the current terrain set
```
`generate_terrain_v4.mjs` is the current batch script. The generator supports **two backends**,
selected with the `BACKEND` env var (`local` default, or `fal`):

- **`BACKEND=local`** (default): the local Stable Diffusion server
  (`http://127.0.0.1:8081/` — the `sd-server` from stable-diffusion.cpp, Flux.2 klein). No API key.
- **`BACKEND=fal`**: the online fal.ai API (`fal-ai/flux-2/turbo` by default, override with
  `FAL_MODEL`). Requires `FAL_AI_KEY`.

```bash
node generate_terrain_v4.mjs                     # local backend
BACKEND=fal FAL_AI_KEY=... node generate_terrain_v4.mjs   # online backend
```

The same `BACKEND` env var switches the UI server (`npm start` / `npm run dev`) between the local
sd-server and fal.ai. Feature-sprites background removal always runs locally via Python `rembg`
(`pip install rembg`). Older scripts (`generate_terrain.mjs`, `_v2.mjs`, `_v3.mjs`) are kept in
git history; update v4, don't add v5.

### Feature sprite rules (important)
- Aspect ratio is **1.5:1 (256×384)**, NOT 2:1. The lower 256×256 sits on the tile; only the
  top 128px extends over the tile above.
- The feature content must sit in the **lower ~70%** of the image; only a little may cross the
  top edge.
- Trees/forest/jungle/swamp must be seen **from above (top-down canopy)**, not from the side.
  Emphasise circular canopy shapes; trunks should barely be visible.
- Generate raw first (`*_feature_raw`), then remove the background (rembg) and rename to
  `terrain_<type>_feature.png`.

### Terrain special cases
- **River**: no dedicated base texture. River tiles reuse the ocean/water texture; the water-to-land
  banks come from the colour-transition pass in `TerrainTextureManager.ts`.
- **Hills**: no dedicated base texture. Hills reuse the grass texture and place the hill feature
  sprite on top.
- **Grassland**: keep it desaturated / low contrast — not neon green.

### After regenerating assets
Verify visually with dev mode: `http://localhost:3000/?quickstart` (reveals the whole map).
The renderer reads `TERRAIN_TEXTURE_FILES` / `FEATURE_TEXTURE_FILES` in
`src/game/rendering/TerrainTextureManager.ts` — if a texture filename changes, update that map.