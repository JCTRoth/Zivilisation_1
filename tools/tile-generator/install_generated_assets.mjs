#!/usr/bin/env node
/**
 * install_generated_assets.mjs — install a generated tile-set run into the game.
 *
 * Takes the folder of one generated run (or of one of its iterations), combines
 * the generated `tiles/` and `features/` folders and replaces the default
 * assets the game loads. After `npm run dev` and a browser reload the board
 * shows the new pictures.
 *
 *   node tools/tile-generator/install_generated_assets.mjs <generated-folder>
 *   npm run tiles:install -- <generated-folder>
 *
 * `<generated-folder>` may be either
 *   - a run folder          tile_sets/<label>_<timestamp>/
 *     (its newest iteration is used, or the one chosen with --iteration N), or
 *   - one iteration folder  tile_sets/<label>_<timestamp>/iteration_02/
 *
 * What it does with what it finds:
 *
 *   tiles/*.png      copied to public/assets/tiles/
 *                    the seamless ground tiles (plus their _1/_2 siblings).
 *
 *   features/*_feature*.png
 *                    copied to public/assets/tiles/
 *                    the transparent feature sprites of the FEATURE layer
 *                    (forests, jungle, hills, swamp, mountains).
 *
 *   features/terrain_<terrain>_<resource>.png
 *                    COMBINED with the matching ground tile and written to
 *                    public/assets/tiles/
 *                    These are the pre-rendered resource tiles the game blits
 *                    as a whole tile (`TerrainTextureManager.getTileTexture`),
 *                    so the sprite has to sit ON the terrain — a transparent
 *                    sprite alone would leave the cell empty.
 *
 *   units/*.png      copied to public/assets/units/
 *                    generated unit sprites; the game prefers them over the
 *                    bundled SVG artwork.
 *
 * Options:
 *   --iteration N   use iteration N of a run folder (default: the newest)
 *   --dry-run       list what would be done, change nothing
 *   --no-units      skip the unit sprites
 *   --no-compose    copy the resource tiles as-is instead of combining them
 *   --box 0.85      override the per-resource visible-size fraction
 *   --no-backup     do not keep a copy of the assets being replaced
 *   --restore       put back the backup taken by an earlier install
 *
 * The replaced originals are saved once to `public/assets/_generated_backup/`
 * (unless --no-backup), so `--restore` can undo the install at any time.
 * Combining needs ImageMagick (`magick`) on PATH — the same tool
 * `compose_feature_tiles.mjs` uses; without it the script falls back to
 * copying the resource tiles unchanged and says so.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..', '..');
const APP_TILES = join(ROOT, 'public', 'assets', 'tiles');
const APP_UNITS = join(ROOT, 'public', 'assets', 'units');
const BACKUP_DIR = join(ROOT, 'public', 'assets', '_generated_backup');

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const DRY_RUN = flags.has('--dry-run');
const NO_UNITS = flags.has('--no-units');
const NO_COMPOSE = flags.has('--no-compose');
const NO_BACKUP = flags.has('--no-backup');
const RESTORE = flags.has('--restore');

const valueFlag = (name) => {
  const inline = argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const positional = argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined;
  return inline ?? positional;
};
const numberFlag = (name) => {
  const parsed = Number(valueFlag(name));
  return Number.isFinite(parsed) ? parsed : null;
};

const positional = argv.filter((a, i) => {
  if (a.startsWith('--')) return false;
  // skip the value of a space-separated flag, e.g. `--iteration 2`
  const prev = argv[i - 1];
  return !(prev && prev.startsWith('--') && !prev.includes('='));
});
const inputPath = positional[0];
if (!inputPath) {
  console.error('usage: node tools/tile-generator/install_generated_assets.mjs ' +
                '<generated-folder> [--iteration N] [--dry-run] [--no-units] ' +
                '[--no-compose] [--box 0.85] [--no-backup] [--restore]');
  process.exit(2);
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** List every *.png directly inside a folder (never recursive). */
function pngFiles(dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .filter((f) => !isDir(join(dir, f)))
    .sort();
}


// Target visible footprint by resource kind, not by the dimensions of the
// generated canvas. The source is alpha-trimmed before resizing, so model-added
// transparent margins cannot make one subject look smaller than another.
// Fractions are the maximum visible width or height relative to one game tile.
const RESOURCE_FOOTPRINT = {
  fish: 0.58,
  horses: 0.68,
  seal: 0.60,
  oasis: 0.68,
  game: 0.62,
  gems: 0.56,
  gold: 0.56,
  coal: 0.56,
  oil: 0.56,
};
const DEFAULT_RESOURCE_FOOTPRINT = 0.62;
const BOX_OVERRIDE = numberFlag('--box');

function resourceFootprint(fileName) {
  if (BOX_OVERRIDE !== null) return BOX_OVERRIDE;
  const kind = fileName.match(
    /_(fish|horses|seal|oasis|game|gems|gold|coal|oil)(?:_\d+)?\.png$/i,
  )?.[1]?.toLowerCase();
  return RESOURCE_FOOTPRINT[kind] ?? DEFAULT_RESOURCE_FOOTPRINT;
}

/**
 * Resolve the argument to one iteration folder: accept an iteration folder
 * itself, or a run folder and take its newest (or the requested) iteration.
 */
function resolveIteration(input) {
  const folder = resolve(input);
  if (!isDir(folder)) {
    console.error(`[-] not a folder: ${folder}`);
    process.exit(2);
  }
  if (isDir(join(folder, 'tiles')) || isDir(join(folder, 'features'))) {
    return folder;
  }
  const iterations = readdirSync(folder)
    .filter((name) => /^iteration_\d+$/.test(name))
    .filter((name) => isDir(join(folder, name)))
    .sort();
  if (iterations.length === 0) {
    console.error(`[-] no tiles/, features/ or iteration_*/ found in ${folder}`);
    process.exit(2);
  }
  const wanted = numberFlag('--iteration');
  const chosen = wanted === null
    ? iterations[iterations.length - 1]
    : iterations.find((name) => name === `iteration_${String(wanted).padStart(2, '0')}`)
      ?? iterations.find((name) => name.endsWith(`_${wanted}`));
  if (!chosen) {
    console.error(`[-] iteration ${wanted} not found in ${folder} ` +
                  `(have: ${iterations.join(', ')})`);
    process.exit(2);
  }
  return join(folder, chosen);
}

/** Back up one file before it is overwritten (the first install wins). */
const added = [];
function backup(dst, label) {
  if (NO_BACKUP || DRY_RUN || !existsSync(dst)) return;
  const backupDir = join(BACKUP_DIR, label);
  mkdirSync(backupDir, { recursive: true });
  cpSync(dst, join(backupDir, dst.split('/').pop()), { force: true });
}

/** Copy one png into place, remembering it when it is brand new. */
function put(src, dst, label) {
  if (!existsSync(dst)) added.push(dst);
  backup(dst, label);
  if (!DRY_RUN) cpSync(src, dst, { force: true });
}

// ── restore ────────────────────────────────────────────────────────────────

if (RESTORE) {
  let restored = 0;
  for (const [label, to] of [['tiles', APP_TILES], ['features', APP_TILES],
                             ['units', APP_UNITS]]) {
    for (const file of pngFiles(join(BACKUP_DIR, label))) {
      if (!DRY_RUN) {
        mkdirSync(to, { recursive: true });
        cpSync(join(BACKUP_DIR, label, file), join(to, file), { force: true });
      }
      console.log(`    restored ${file} -> ${to}`);
      restored++;
    }
  }
  // Files the install added (nothing to restore) are simply removed again.
  const manifest = join(BACKUP_DIR, 'added.json');
  if (existsSync(manifest)) {
    for (const file of JSON.parse(readFileSync(manifest, 'utf8'))) {
      if (!DRY_RUN) rmSync(file, { force: true });
      console.log(`    removed  ${file}`);
      restored++;
    }
    if (!DRY_RUN) rmSync(manifest, { force: true });
  }
  console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}touched ${restored} file(s).`);
  process.exit(0);
}

// ── install ────────────────────────────────────────────────────────────────

const iteration = resolveIteration(inputPath);
const tilesDir = join(iteration, 'tiles');
const featuresDir = join(iteration, 'features');
const unitsDir = join(iteration, 'units');

console.log(`[*] installing ${iteration}`);
if (DRY_RUN) console.log('    (dry run — nothing is written)');

mkdirSync(APP_TILES, { recursive: true });

// 1. ground tiles
const ground = pngFiles(tilesDir);
for (const file of ground) put(join(tilesDir, file), join(APP_TILES, file), 'tiles');
console.log(`    ground    ${String(ground.length).padStart(3)} tile(s)   -> ${APP_TILES}`);

// 2. ground-tile lookup for the composition (generated siblings first)
const groundByName = new Map(ground.map((f) => [f, join(tilesDir, f)]));
function findBaseTile(terrainStem) {
  for (const name of [`${terrainStem}.png`, `${terrainStem}_1.png`, `${terrainStem}_2.png`]) {
    if (groundByName.has(name)) return groundByName.get(name);
  }
  for (const name of [`${terrainStem}.png`, `${terrainStem}_1.png`]) {
    const fallback = join(APP_TILES, name);
    if (existsSync(fallback)) return fallback;
  }
  return null;
}

/**
 * `terrain_<terrain>_<rest>.png` -> the terrain stem `terrain_<terrain>`.
 * The longest matching stem wins, so `terrain_forest_feature_1.png` belongs to
 * `terrain_forest` and not to a hypothetical `terrain_forest_feature`.
 */
function terrainStemFor(fileName, stems) {
  return stems
    .filter((stem) => fileName.startsWith(`${stem}_`))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}

// 3. feature sprites and resource tiles
const featureFiles = pngFiles(featuresDir);
const groundStems = [...new Set(ground.map((f) => f.replace(/(_\d+)?\.png$/, '')))];
const sprites = [];
const resources = [];
for (const file of featureFiles) {
  // The feature layer is transparent sprite art; everything else is a
  // pre-rendered resource tile that has to be combined with the ground tile.
  const isSprite = /_feature(_\d+)?\.png$/i.test(file);
  (isSprite ? sprites : resources).push(file);
}

for (const file of sprites) put(join(featuresDir, file), join(APP_TILES, file), 'features');
console.log(`    feature   ${String(sprites.length).padStart(3)} sprite(s) -> ${APP_TILES}`);

let magickOk = true;
if (!NO_COMPOSE && resources.length > 0) {
  const probe = spawnSync('magick', ['-version'], { encoding: 'utf8' });
  magickOk = !probe.error && probe.status === 0;
  if (!magickOk) {
    console.log('    [!] `magick` (ImageMagick) not found — installing the '
      + 'resource tiles unchanged instead of combining them');
  }
}

let combined = 0;
for (const file of resources) {
  const stem = terrainStemFor(file, groundStems) ?? terrainStemFor(
    file, [...new Set(pngFiles(APP_TILES).map((f) => f.replace(/(_\d+)?\.png$/, '')))],
  );
  const base = stem ? findBaseTile(stem) : null;
  const dst = join(APP_TILES, file);

  if (NO_COMPOSE || !magickOk || !base) {
    if (!base && !NO_COMPOSE && magickOk) {
      console.log(`    [!] no ground tile for ${file} — copying it unchanged`);
    }
    put(join(featuresDir, file), dst, 'features');
    continue;
  }

  // Fit the visible subject (not its padded source canvas) into a per-kind
  // footprint, preserve its aspect ratio, and center it over the terrain.
  const src = join(featuresDir, file);
  const box = Math.max(1, Math.round(512 * resourceFootprint(file)));

  if (!existsSync(dst)) added.push(dst);
  backup(dst, 'features');
  if (DRY_RUN) { combined++; continue; }

  const tmp = join(BACKUP_DIR, '_tmp', file);
  mkdirSync(dirname(tmp), { recursive: true });
  const resized = spawnSync('magick', [
    src, '-fuzz', '1%', '-trim', '+repage', '-filter', 'Lanczos',
    '-resize', `${box}x${box}`, tmp,
  ], { encoding: 'utf8' });
  const merged = spawnSync('magick', [
    base, tmp, '-gravity', 'center', '-composite', dst,
  ], { encoding: 'utf8' });
  rmSync(tmp, { force: true });
  if (resized.status !== 0 || merged.status !== 0) {
    console.log(`    [!] could not combine ${file}: ${merged.stderr || resized.stderr}`);
    cpSync(src, dst, { force: true });
    continue;
  }
  combined++;
}
if (resources.length > 0) {
  console.log(`    resource  ${String(resources.length).padStart(3)} tile(s)   -> ${APP_TILES}`
    + (NO_COMPOSE || !magickOk ? '  (copied)' : `  (${combined} combined with the ground)`));
}

// 4. unit sprites
const units = NO_UNITS ? [] : pngFiles(unitsDir);
if (!NO_UNITS) {
  for (const file of units) put(join(unitsDir, file), join(APP_UNITS, file), 'units');
}
console.log(`    unit      ${String(units.length).padStart(3)} sprite(s) -> ${APP_UNITS}`);

if (!DRY_RUN && added.length > 0) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  writeFileSync(join(BACKUP_DIR, 'added.json'),
                JSON.stringify(added, null, 2) + '\n');
}
if (!NO_BACKUP && !DRY_RUN && existsSync(BACKUP_DIR)) {
  console.log(`    backup of the replaced assets: ${BACKUP_DIR}`);
}

const total = ground.length + sprites.length + resources.length + units.length;
console.log(`\n[ok] ${total} image(s) installed. Start (or reload) the game to see them:`);
console.log('       npm run dev');
if (!NO_UNITS) {
  console.log('     Unit sprites are read from /assets/units/unit_<key>.png and take');
  console.log('     priority over the bundled SVG artwork.');
}
