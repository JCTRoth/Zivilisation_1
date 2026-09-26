#!/usr/bin/env node
/**
 * compose_feature_tiles.mjs — render special-resource artwork onto terrain tiles.
 *
 * For every resource that ships SVG artwork (src/assets/resources, the cropped
 * files the game overlays) this composes the feature onto each terrain tile the
 * resource can legally appear on (read from src/data/TerrainConstants.ts), using
 * the same base texture the renderer uses (src/game/rendering/
 * TerrainTextureManager.ts) and the same size/anchor the in-game overlay uses:
 * the artwork is fitted into 80 % of the tile and centred.
 *
 * Results are written as `terrain_<terrain>_<resource>[_<n>].png` (n ≥ 2 for the
 * extra poses) to the generator's tiles folder, then copied into the app's tile
 * folder (public/assets/tiles) so TerrainTextureManager can pick them up.
 *
 * Run:
 *   node tools/tile-generator/compose_feature_tiles.mjs
 *   node tools/tile-generator/compose_feature_tiles.mjs --dry-run       list only
 *   node tools/tile-generator/compose_feature_tiles.mjs --all-terrains  feature × every tile
 *
 * Env overrides:
 *   TILES_DIR     tools/tile-generator/tiles   generator output folder
 *   COPY_DIR      public/assets/tiles          app folder to copy into
 *   FEATURES_DIR  src/assets/resources         folder with the SVG artwork
 *   TILE_PX       512                          output tile size in pixels
 *   FEATURE_BOX   0.8                          artwork box as a fraction of the tile
 *   SKIP_COPY     1                            don't copy into the app folder
 *   KEEP_TEMP     1                            keep the intermediate PNGs
 *
 * Requires `inkscape` (SVG rasterisation) and ImageMagick (`magick`) on PATH.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..', '..');

const CLI = new Set(process.argv.slice(2));
const DRY_RUN = CLI.has('--dry-run');
const ALL_TERRAINS = CLI.has('--all-terrains');
const KEEP_TEMP = process.env.KEEP_TEMP === '1';
if (CLI.has('--help') || CLI.has('-h')) {
  const header = readFileSync(fileURLToPath(import.meta.url), 'utf8')
    .replace(/^#![^\n]*\n/, '')
    .split('*/')[0]
    .replace(/^\/\*\*?/, '')
    .replace(/^\s*\*?/gm, '');
  console.log(header.trim());
  process.exit(0);
}

const TILES_DIR = resolve(process.env.TILES_DIR ?? join(SCRIPT_DIR, 'tiles'));
const COPY_DIR = resolve(process.env.COPY_DIR ?? join(ROOT, 'public', 'assets', 'tiles'));
const FEATURES_DIR = resolve(process.env.FEATURES_DIR ?? join(ROOT, 'src', 'assets', 'resources'));
const TILE_PX = Number(process.env.TILE_PX ?? 512);
const FEATURE_BOX = Number(process.env.FEATURE_BOX ?? 0.8);
const SKIP_COPY = process.env.SKIP_COPY === '1';

// ── App data ───────────────────────────────────────────────────────────────

/**
 * Read the terrain key → lowercase-name map and the special-resource rules
 * from TerrainConstants.ts. The file is parsed instead of imported because the
 * tile generator runs as a plain Node script without the app's TS toolchain.
 */
function readAppData() {
  const source = readFileSync(join(ROOT, 'src', 'data', 'TerrainConstants.ts'), 'utf8');

  const typesBlock = source.match(/export const TERRAIN_TYPES\s*=\s*{([\s\S]*?)} as const;/);
  if (!typesBlock) throw new Error('TERRAIN_TYPES not found in TerrainConstants.ts');
  const terrainTypes = {};
  for (const [, key, value] of typesBlock[1].matchAll(/(\w+):\s*'([^']+)'/g)) {
    terrainTypes[key] = value;
  }

  const resourcesBlock = source.match(/export const SPECIAL_RESOURCES[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!resourcesBlock) throw new Error('SPECIAL_RESOURCES not found in TerrainConstants.ts');
  const resources = [];
  for (const [, name, rawTerrains] of resourcesBlock[1].matchAll(/name:\s*'([^']+)'[\s\S]*?terrains:\s*`([^`]+)`/g)) {
    const terrains = rawTerrains
      .replace(/\$\{TERRAIN_TYPES\.(\w+)\}/g, (_, key) => terrainTypes[key] ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (terrains.length > 0) resources.push({ name, terrains });
  }
  if (resources.length === 0) throw new Error('no special resources parsed from TerrainConstants.ts');

  return { terrainTypes, resources };
}

/** Read the app's terrain → base texture mapping so tiles match in-game look. */
function readTerrainTextures() {
  const source = readFileSync(join(ROOT, 'src', 'game', 'rendering', 'TerrainTextureManager.ts'), 'utf8');
  const block = source.match(/export const TERRAIN_TEXTURE_FILES[^=]*=\s*{([\s\S]*?)};/);
  if (!block) throw new Error('TERRAIN_TEXTURE_FILES not found in TerrainTextureManager.ts');
  const textures = {};
  for (const [, key, url] of block[1].matchAll(/(\w+):\s*'([^']+)'/g)) {
    textures[key.toUpperCase()] = url;
  }
  return textures;
}

// ── Feature artwork ────────────────────────────────────────────────────────

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `fish.svg`, then `horses.svg`, `horses_2.svg`, `horses_3.svg`… in order. */
function findFeatureVariants(resource) {
  if (!existsSync(FEATURES_DIR)) return [];
  const files = readdirSync(FEATURES_DIR);
  const variants = [];
  const base = `${resource}.svg`;
  if (files.includes(base)) variants.push(base);
  const variantRe = new RegExp(`^${escapeRegExp(resource)}_(\\d+)\\.svg$`);
  files
    .map((file) => [file, variantRe.exec(file)])
    .filter(([, match]) => match)
    .sort((a, b) => Number(a[1][1]) - Number(b[1][1]))
    .forEach(([file]) => variants.push(file));
  return variants;
}

/** Intrinsic width/height of an SVG (attributes first, then viewBox). */
function readSvgSize(path) {
  const head = readFileSync(path, 'utf8').slice(0, 4000);
  const width = head.match(/\bwidth="([\d.]+)(?:px)?"/);
  const height = head.match(/\bheight="([\d.]+)(?:px)?"/);
  if (width && height && Number(width[1]) > 0 && Number(height[1]) > 0) {
    return { width: Number(width[1]), height: Number(height[1]) };
  }
  const viewBox = head.match(/viewBox="([\d.\s-]+)"/);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] };
    }
  }
  throw new Error(`cannot determine SVG size of ${path}`);
}

// ── Rendering ──────────────────────────────────────────────────────────────

function requireTool(command, args, hint) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`\`${command}\` is required but not available on PATH (${hint})`);
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout || '(no output)'}`);
  }
}

/**
 * Rasterise the feature SVG at the overlay box size and composite it centred
 * on the base tile. Uses Inkscape for the SVG and ImageMagick for the blend,
 * matching how the game draws the overlay (80 % box, centred, aspect kept).
 */
function composeTile(basePath, featurePath, outPath, tempDir, label) {
  const { width, height } = readSvgSize(featurePath);
  const box = TILE_PX * FEATURE_BOX;
  const scale = Math.min(box / width, box / height);
  const featurePx = Math.max(1, Math.round(width * scale));
  const featurePy = Math.max(1, Math.round(height * scale));

  const tempFeature = join(tempDir, `${label}.feature.png`);
  run('inkscape', [
    '--export-type=png',
    `--export-filename=${tempFeature}`,
    `--export-width=${featurePx}`,
    `--export-height=${featurePy}`,
    featurePath,
  ]);
  run('magick', [basePath, tempFeature, '-gravity', 'center', '-composite', outPath]);
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const { resources } = readAppData();
  const textures = readTerrainTextures();

  const featureResources = resources
    .map((resource) => ({ ...resource, variants: findFeatureVariants(resource.name.toLowerCase()) }))
    .filter((resource) => {
      if (resource.variants.length > 0) return true;
      console.log(`- ${resource.name}: no artwork in ${FEATURES_DIR} — skipped`);
      return false;
    });

  const knownIdeas = new Set(resources.map((resource) => resource.name.toLowerCase()));
  for (const file of existsSync(FEATURES_DIR) ? readdirSync(FEATURES_DIR) : []) {
    if (!file.endsWith('.svg')) continue;
    const key = file.replace(/\.svg$/, '').replace(/_\d+$/, '');
    if (!knownIdeas.has(key)) {
      console.log(`! ${file}: artwork has no matching special resource — ignored`);
    }
  }

  const jobs = [];
  for (const resource of featureResources) {
    const terrains = ALL_TERRAINS ? Object.values(textures).map((url) => url.replace(/^.*terrain_|\.png$/g, '')) : resource.terrains;
    for (const terrain of new Set(terrains)) {
      const baseUrl = textures[terrain.toUpperCase()] ?? `/assets/tiles/terrain_${terrain}.png`;
      const basePath = join(ROOT, 'public', baseUrl.replace(/^\//, ''));
      if (!existsSync(basePath)) {
        console.log(`! ${resource.name} on ${terrain}: no base tile at public${baseUrl} — skipped`);
        continue;
      }
      resource.variants.forEach((variant, index) => {
        const suffix = index === 0 ? '' : `_${index + 1}`;
        jobs.push({
          resource: resource.name,
          terrain,
          basePath,
          featurePath: join(FEATURES_DIR, variant),
          outName: `terrain_${terrain}_${resource.name.toLowerCase()}${suffix}.png`,
        });
      });
    }
  }

  if (jobs.length === 0) {
    console.log('Nothing to compose.');
    return;
  }

  console.log(`${jobs.length} tile combination(s) to compose${DRY_RUN ? ' (dry run)' : ''}:`);
  for (const job of jobs) {
    console.log(`  ${job.outName}  ←  ${job.terrain} + ${job.resource} (${job.featurePath.replace(`${ROOT}/`, '')})`);
  }
  if (DRY_RUN) return;

  requireTool('inkscape', ['--version'], 'SVG rasterisation');
  requireTool('magick', ['-version'], 'PNG compositing');

  mkdirSync(TILES_DIR, { recursive: true });
  const tempDir = join(SCRIPT_DIR, '.compose-tmp');
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const composed = [];
  try {
    for (const job of jobs) {
      const outPath = join(TILES_DIR, job.outName);
      composeTile(job.basePath, job.featurePath, outPath, tempDir, job.outName.replace(/\.png$/, ''));
      composed.push(outPath);
      console.log(`✓ ${outPath.replace(`${ROOT}/`, '')}`);
    }
  } finally {
    if (!KEEP_TEMP) rmSync(tempDir, { recursive: true, force: true });
  }

  if (SKIP_COPY) {
    console.log(`Composed ${composed.length} tile(s); copy skipped (SKIP_COPY=1).`);
    return;
  }
  mkdirSync(COPY_DIR, { recursive: true });
  for (const file of composed) copyFileSync(file, join(COPY_DIR, file.split('/').pop()));
  console.log(`Composed ${composed.length} tile(s) and copied them to ${COPY_DIR.replace(`${ROOT}/`, '')}.`);
}

try {
  main();
} catch (error) {
  console.error(`compose_feature_tiles: ${error.message}`);
  process.exit(1);
}
