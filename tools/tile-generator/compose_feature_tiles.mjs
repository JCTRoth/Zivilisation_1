#!/usr/bin/env node
/**
 * compose_feature_tiles.mjs — render every special resource onto terrain tiles.
 *
 * Resources never move, so they belong to the static terrain layer: this script
 * turns each legal resource × terrain pairing (rules read from
 * src/data/TerrainConstants.ts) into one pre-rendered tile picture the renderer
 * can blit — no per-frame glyph or overlay work in the game.
 *
 * Two sources feed a tile:
 *   - artwork in src/assets/resources (PNG pixel art wins over the traced
 *     SVGs; numbered files are variants — fish1..fish5), fitted into 85 % of
 *     the tile and centred, scaled nearest-neighbour so pixel art stays crisp;
 *   - otherwise the resource's glyph from RESOURCE_GLYPHS (TerrainConstants.ts),
 *     rasterised with the bundle's monochrome Noto Emoji font and given a light
 *     outline so it reads on every terrain.
 *
 * Results are written as `terrain_<terrain>_<resource>[_<n>].png` (n ≥ 2 for the
 * extra artwork poses) to the generator's tiles folder, then copied into the
 * app's tile folder (public/assets/tiles) so TerrainTextureManager can pick
 * them up. Units and cities are deliberately NOT composed: they are movable and
 * addable/removable, so the game draws them in its dynamic layer.
 *
 * Run:
 *   node tools/tile-generator/compose_feature_tiles.mjs
 *   node tools/tile-generator/compose_feature_tiles.mjs --dry-run       list only
 *   node tools/tile-generator/compose_feature_tiles.mjs --all-terrains  feature × every tile
 *   node tools/tile-generator/compose_feature_tiles.mjs --only=gold,gems
 *   node tools/tile-generator/compose_feature_tiles.mjs --no-glyphs     artwork only
 *
 * Env overrides:
 *   TILES_DIR     tools/tile-generator/tiles   generator output folder
 *   COPY_DIR      public/assets/tiles          app folder to copy into
 *   FEATURES_DIR  src/assets/resources         folder with the SVG artwork
 *   GLYPH_FONT        src/assets/NotoEmoji-Light.ttf  monochrome fallback font
 *   GLYPH_FONT_FAMILY Noto Color Emoji                colour emoji Pango family
 *   TILE_PX       512                          output tile size in pixels
 *   FEATURE_BOX   0.85                         artwork box as a fraction of the tile
 *   GLYPH_BOX     0.55                         glyph box as a fraction of the tile
 *   SKIP_COPY     1                            don't copy into the app folder
 *   KEEP_TEMP     1                            keep the intermediate PNGs
 *
 * Requires `inkscape` (SVG rasterisation, only when an SVG variant is used) and
 * ImageMagick (`magick`) on PATH.
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
const NO_GLYPHS = CLI.has('--no-glyphs');
const KEEP_TEMP = process.env.KEEP_TEMP === '1';
const ONLY = new Set(
  (process.argv.slice(2).find((arg) => arg.startsWith('--only='))?.slice('--only='.length) ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);
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
const GLYPH_FONT = resolve(process.env.GLYPH_FONT ?? join(ROOT, 'src', 'assets', 'NotoEmoji-Light.ttf'));
const TILE_PX = Number(process.env.TILE_PX ?? 512);
const FEATURE_BOX = Number(process.env.FEATURE_BOX ?? 0.85);
const GLYPH_BOX = Number(process.env.GLYPH_BOX ?? 0.55);
const SKIP_COPY = process.env.SKIP_COPY === '1';

// ── App data ───────────────────────────────────────────────────────────────

/**
 * Read the terrain key → lowercase-name map, the special-resource rules and
 * the resource glyph table from TerrainConstants.ts. The file is parsed
 * instead of imported because the tile generator runs as a plain Node script
 * without the app's TS toolchain.
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

  const glyphsBlock = source.match(/export const RESOURCE_GLYPHS[^=]*=\s*{([\s\S]*?)};/);
  if (!glyphsBlock) throw new Error('RESOURCE_GLYPHS not found in TerrainConstants.ts');
  const glyphs = {};
  for (const [, key, value] of glyphsBlock[1].matchAll(/(\w+):\s*'([^']+)'/g)) {
    glyphs[key.toLowerCase()] = value;
  }
  if (Object.keys(glyphs).length === 0) throw new Error('no resource glyphs parsed from TerrainConstants.ts');

  return { terrainTypes, resources, glyphs };
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

/**
 * Resolve the base tile that actually exists for a terrain. The renderer
 * probes numbered variants (`terrain_forest_1.png`, …) when the primary file
 * is missing, so the composition must use the same file the game will show.
 */
function resolveBaseTile(terrain, textures) {
  const primary = textures[terrain.toUpperCase()] ?? `/assets/tiles/terrain_${terrain}.png`;
  const candidates = [primary];
  const stem = primary.replace(/\.png$/i, '');
  for (let n = 1; n <= 4; n++) candidates.push(`${stem}_${n}.png`);
  for (const candidate of candidates) {
    const path = join(ROOT, 'public', candidate.replace(/^\//, ''));
    if (existsSync(path)) return path;
  }
  return null;
}

// ── Feature artwork ────────────────────────────────────────────────────────

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Feature artwork for a resource, in variant order. PNG pixel art wins when it
 * exists (`fish.png`, `fish1.png`… or `fish_1.png`…), otherwise the traced
 * SVGs are used (`horses.svg`, `horses_2.svg`…). Each file becomes one tile
 * variant, so the map can show a different pose per tile.
 */
function findFeatureVariants(resource) {
  if (!existsSync(FEATURES_DIR)) return [];
  const files = readdirSync(FEATURES_DIR);
  const collect = (ext) => {
    const found = [];
    if (files.includes(`${resource}.${ext}`)) found.push(`${resource}.${ext}`);
    const numbered = new RegExp(`^${escapeRegExp(resource)}_?(\\d+)\\.${ext}$`);
    files
      .map((file) => [file, numbered.exec(file)])
      .filter(([, match]) => match)
      .sort((a, b) => Number(a[1][1]) - Number(b[1][1]))
      .forEach(([file]) => found.push(file));
    return found;
  };
  const pngs = collect('png');
  return pngs.length > 0 ? pngs : collect('svg');
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

/** Intrinsic width/height from the PNG header (IHDR), without any tool. */
function readPngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`not a PNG: ${path}`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) throw new Error(`cannot determine PNG size of ${path}`);
  return { width, height };
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
 * Render one feature variant into the box and composite it centred on the base
 * tile, matching how the game draws resource artwork (box of the tile,
 * centred, aspect kept).
 *
 * SVGs are rasterised with Inkscape at the exact box size. PNG pixel art is
 * upscaled with a nearest-neighbour filter instead of a smoothing one: the
 * sprite keeps its hard pixel edges on the tile, which reads as more detailed
 * than a blurred upscale (the renderer's own high-quality downscale at draw
 * time antialiases the result). Glyphs pass `smooth` so the vector-like symbol
 * is resampled with Lanczos instead.
 */
function composeTile(basePath, featurePath, outPath, tempDir, label, { smooth = false, boxFraction = FEATURE_BOX } = {}) {
  const isSvg = featurePath.toLowerCase().endsWith('.svg');
  const { width, height } = isSvg ? readSvgSize(featurePath) : readPngSize(featurePath);
  const box = TILE_PX * boxFraction;
  const scale = Math.min(box / width, box / height);
  const featurePx = Math.max(1, Math.round(width * scale));
  const featurePy = Math.max(1, Math.round(height * scale));

  const tempFeature = join(tempDir, `${label}.feature.png`);
  if (isSvg) {
    run('inkscape', [
      '--export-type=png',
      `--export-filename=${tempFeature}`,
      `--export-width=${featurePx}`,
      `--export-height=${featurePy}`,
      featurePath,
    ]);
  } else {
    run('magick', [
      featurePath,
      '-filter', smooth ? 'Lanczos' : 'point',
      '-resize', `${featurePx}x${featurePy}!`,
      tempFeature,
    ]);
  }
  run('magick', [basePath, tempFeature, '-gravity', 'center', '-composite', outPath]);
}

/**
 * Rasterise a resource glyph to a temporary PNG.
 *
 * Emoji are rendered in COLOUR through Pango, which picks the system's colour
 * emoji font (Noto Color Emoji by default, override with GLYPH_FONT_FAMILY) —
 * the same artwork the player sees elsewhere. If the Pango delegate is not
 * available, the bundled monochrome Noto Emoji font is used as a fallback,
 * with a light outline so the symbol stays readable on every terrain colour.
 * Plain ASCII glyphs (fish "F") use the default UI font.
 */
function renderGlyph(glyph, tempDir, label) {
  const isAscii = /^[\x20-\x7E]+$/.test(glyph);
  const escaped = glyph.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Pango sizes are in points scaled by PANGO_SCALE (1024).
  const pangoSize = Math.round(TILE_PX * 1024);
  const family = (process.env.GLYPH_FONT_FAMILY ?? 'Noto Color Emoji').replace(/'/g, '');
  const fontAttr = isAscii ? '' : `font='${family}' `;
  const outPath = join(tempDir, `${label}.glyph.png`);

  try {
    run('magick', [
      '-background', 'none',
      `pango:<span ${fontAttr}size='${pangoSize}'>${escaped}</span>`,
      '-trim', '+repage',
      outPath,
    ]);
    return outPath;
  } catch (error) {
    if (isAscii || !existsSync(GLYPH_FONT)) throw error;
    console.warn(`! colour emoji rendering failed for ${glyph}; falling back to ${GLYPH_FONT} (monochrome)`);
    run('magick', [
      '-background', 'none',
      '-fill', '#141414',
      '-stroke', '#ffffff',
      '-strokewidth', String(Math.max(2, Math.round(TILE_PX * 0.012))),
      '-font', GLYPH_FONT,
      '-pointsize', String(TILE_PX),
      `label:${glyph}`,
      '-trim', '+repage',
      outPath,
    ]);
    return outPath;
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const { resources, glyphs } = readAppData();
  const textures = readTerrainTextures();

  for (const only of ONLY) {
    if (!resources.some((resource) => resource.name.toLowerCase() === only)) {
      console.log(`! --only=${only}: no such special resource — ignored`);
    }
  }
  const selectedResources = ONLY.size > 0
    ? resources.filter((resource) => ONLY.has(resource.name.toLowerCase()))
    : resources;

  const knownIdeas = new Set(resources.map((resource) => resource.name.toLowerCase()));
  for (const file of existsSync(FEATURES_DIR) ? readdirSync(FEATURES_DIR) : []) {
    const match = /^(.+?)\.(svg|png)$/.exec(file);
    if (!match) continue;
    // Strip the variant suffix: horses_2.svg and fish3.png both belong to
    // their base resource.
    const key = match[1].replace(/_\d+$/, '').replace(/\d+$/, '');
    if (!knownIdeas.has(key)) {
      console.log(`! ${file}: artwork has no matching special resource — ignored`);
    }
  }

  const jobs = [];
  for (const resource of selectedResources) {
    const key = resource.name.toLowerCase();
    const variants = findFeatureVariants(key);
    // Resources without artwork are still baked as one picture: their glyph
    // from RESOURCE_GLYPHS is rasterised onto the terrain tile instead.
    const useGlyph = variants.length === 0;
    if (useGlyph && (NO_GLYPHS || !glyphs[key])) {
      console.log(`- ${resource.name}: ${!glyphs[key] ? 'no artwork and no glyph' : 'artwork only (--no-glyphs)'} — skipped`);
      continue;
    }

    const terrains = ALL_TERRAINS ? Object.values(textures).map((url) => url.replace(/^.*terrain_|\.png$/g, '')) : resource.terrains;
    for (const terrain of new Set(terrains)) {
      const basePath = resolveBaseTile(terrain, textures);
      if (!basePath) {
        console.log(`! ${resource.name} on ${terrain}: no base tile for ${terrain} — skipped`);
        continue;
      }
      if (useGlyph) {
        jobs.push({
          resource: resource.name,
          terrain,
          basePath,
          glyph: glyphs[key],
          outName: `terrain_${terrain}_${key}.png`,
        });
      } else {
        variants.forEach((variant, index) => {
          const suffix = index === 0 ? '' : `_${index + 1}`;
          jobs.push({
            resource: resource.name,
            terrain,
            basePath,
            featurePath: join(FEATURES_DIR, variant),
            outName: `terrain_${terrain}_${key}${suffix}.png`,
          });
        });
      }
    }
  }

  if (jobs.length === 0) {
    console.log('Nothing to compose.');
    return;
  }

  console.log(`${jobs.length} tile combination(s) to compose${DRY_RUN ? ' (dry run)' : ''}:`);
  for (const job of jobs) {
    const source = job.glyph
      ? `glyph ${job.glyph}`
      : job.featurePath.replace(`${ROOT}/`, '');
    console.log(`  ${job.outName}  ←  ${job.terrain} + ${job.resource} (${source})`);
  }
  if (DRY_RUN) return;

  if (jobs.some((job) => job.featurePath && job.featurePath.toLowerCase().endsWith('.svg'))) {
    requireTool('inkscape', ['--version'], 'SVG rasterisation');
  }
  requireTool('magick', ['-version'], 'PNG compositing');

  mkdirSync(TILES_DIR, { recursive: true });
  const tempDir = join(SCRIPT_DIR, '.compose-tmp');
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });

  const composed = [];
  try {
    for (const job of jobs) {
      const outPath = join(TILES_DIR, job.outName);
      const label = job.outName.replace(/\.png$/, '');
      const featurePath = job.glyph
        ? renderGlyph(job.glyph, tempDir, label)
        : job.featurePath;
      composeTile(job.basePath, featurePath, outPath, tempDir, label, {
        smooth: !!job.glyph,
        boxFraction: job.glyph ? GLYPH_BOX : FEATURE_BOX,
      });
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
