#!/usr/bin/env node
/**
 * Extract a static map from a Freeciv 1.x savegame (*.sav) into a JSON data
 * file under `src/data/maps/`.
 *
 * Usage:
 *   node scripts/extract-freeciv-map.mjs <path/to/map.sav> [output-id] [output-dir]
 * (output-dir defaults to src/data/maps)
 *
 * Freeciv stores the map in its `[map]` section:
 *   width=180
 *   height=90
 *   t000="…"   terrain — one character per tile (' ' = ocean, a = arctic, …)
 *   n000="…"   tile "special" flags — '0' = none, anything else = bonus resource
 *   r0sx=7     hand-placed start position #0 (x = column …)
 *   r0sy=19    … y = row
 *
 * The extracted file keeps the RAW Freeciv characters; the game translates
 * them at load time via `FREECIV_TERRAIN_LEGEND` (src/data/maps/types.ts), so
 * the data stays a faithful copy of the source map.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/maps');

/** `"foo"` → `foo` (Freeciv quotes strings). */
function unquote(value) {
  const trimmed = String(value).trim();
  return trimmed.replace(/^"(.*)"$/, '$1');
}

/** `Earth 180x90 v1.4, http://…` → `earth-180x90-v1-4`. */
function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Parse the `[map]` section of a Freeciv savegame. */
function parseFreecivMap(text) {
  const terrainRows = new Map();
  const specialRows = new Map();
  const startX = new Map();
  const startY = new Map();
  let section = null;
  let metastring = '';
  let width = 0;
  let height = 0;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const sectionMatch = line.match(/^\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section === 'game' && line.startsWith('metastring=')) {
      metastring = unquote(line.slice('metastring='.length));
      continue;
    }
    if (section !== 'map') continue;

    if (line.startsWith('width=')) {
      width = Number(line.slice('width='.length));
    } else if (line.startsWith('height=')) {
      height = Number(line.slice('height='.length));
    } else {
      const terrain = line.match(/^t(\d{1,3})="(.*)"$/);
      if (terrain) {
        terrainRows.set(Number(terrain[1]), terrain[2]);
        continue;
      }
      const special = line.match(/^n(\d{1,3})="(.*)"$/);
      if (special) {
        specialRows.set(Number(special[1]), special[2]);
        continue;
      }
      const start = line.match(/^r(\d{1,3})s([xy])=(\d+)$/);
      if (start) {
        (start[2] === 'x' ? startX : startY).set(Number(start[1]), Number(start[3]));
      }
    }
  }

  if (!width || !height) {
    throw new Error(`Could not read map size from the [map] section (width=${width}, height=${height})`);
  }

  const rows = [];
  for (let row = 0; row < height; row++) {
    const line = terrainRows.get(row);
    if (line === undefined) throw new Error(`Missing terrain row t${String(row).padStart(3, '0')}`);
    if (line.length !== width) {
      throw new Error(`Terrain row ${row} has ${line.length} tiles, expected ${width}`);
    }
    rows.push(line);
  }

  // Specials are optional — only include the layer when the save has it.
  const hasSpecials = [...specialRows.keys()].some((row) => row < height);
  const specials = [];
  if (hasSpecials) {
    for (let row = 0; row < height; row++) {
      const line = specialRows.get(row) ?? '0'.repeat(width);
      specials.push(line.padEnd(width, '0').slice(0, width));
    }
  }

  // Hand-placed start positions (r<index>sx/sy) — the map author's balanced
  // spawns, used by the game instead of random land tiles.
  const startPositions = [];
  for (const [index, col] of [...startX.entries()].sort((a, b) => a[0] - b[0])) {
    const row = startY.get(index);
    if (row === undefined) continue;
    if (col >= 0 && col < width && row >= 0 && row < height) {
      startPositions.push({ col, row });
    }
  }

  return {
    metastring,
    width,
    height,
    rows,
    specials: hasSpecials ? specials : undefined,
    startPositions: startPositions.length > 0 ? startPositions : undefined,
  };
}

function main() {
  const [, , inputPath, idArg, outDirArg] = process.argv;
  if (!inputPath) {
    console.error('Usage: node scripts/extract-freeciv-map.mjs <path/to/map.sav> [output-id] [output-dir]');
    process.exit(1);
  }

  const parsed = parseFreecivMap(readFileSync(resolve(inputPath), 'utf8'));
  const [namePart] = parsed.metastring.split(',');
  const name = (namePart || 'Static map').trim();
  const id = idArg || slugify(name);

  const specialCount = parsed.specials
    ? parsed.specials.reduce((total, line) => total + [...line].filter((ch) => ch !== '0').length, 0)
    : 0;
  const landCount = parsed.rows.reduce(
    (total, line) => total + [...line].filter((ch) => ch !== ' ').length,
    0,
  );

  const output = {
    id,
    name,
    source: parsed.metastring || inputPath,
    width: parsed.width,
    height: parsed.height,
    rows: parsed.rows,
    ...(parsed.specials ? { specials: parsed.specials } : {}),
    ...(parsed.startPositions ? { startPositions: parsed.startPositions } : {}),
  };

  const outDir = outDirArg ? resolve(outDirArg) : OUT_DIR;
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${id}.json`);
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);

  const landPercent = ((landCount / (parsed.width * parsed.height)) * 100).toFixed(1);
  console.log(`Extracted ${id}: ${parsed.width}x${parsed.height}, land ${landPercent}%, ${specialCount} special-resource tiles`);
  if (parsed.startPositions) console.log(`Start positions: ${parsed.startPositions.length}`);
  console.log(`Written to ${outPath}`);
}

main();
