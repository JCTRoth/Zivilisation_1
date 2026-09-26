/**
 * Node.js server for the AI Tile Generator tool — switchable backend.
 *
 * Serves the HTML UI and the /api endpoints.
 *
 * BACKEND=local (default): image generation goes directly to the local
 * AUTOMATIC1111-compatible Stable Diffusion server (sd-server from
 * stable-diffusion.cpp) at http://127.0.0.1:8081.
 *
 * BACKEND=fal: image generation uses the fal.ai cloud queue API
 * (https://queue.fal.run/{FAL_MODEL}) and requires FAL_AI_KEY.
 *
 * Background removal always runs locally via Python rembg.
 *
 * Usage: node Zivilisation_1/tools/tile-generator/server.mjs
 * Debug: DEBUG=1 node Zivilisation_1/tools/tile-generator/server.mjs
 *
 * Env overrides:
 *   BACKEND       local|fal               which generator backend to use
 *   FAL_AI_KEY    (required for fal)      fal.ai API key
 *   FAL_MODEL     fal-ai/flux-2/turbo     fal.ai model endpoint
 *   SD_SERVER     http://127.0.0.1:8081   sd-server URL (local backend)
 *   SD_STEPS      4                       Flux.2 klein — fast
 *   SD_CFG        1.0
 *   SD_SAMPLER    euler
 *   PYTHON        python3                 interpreter with `rembg` installed
 *
 * /api/generate accepts optional `steps` (sampling iterations) and `strength`
 * (img2img denoising strength, 0..1). When `imageUrl` is provided the request
 * is routed to img2img (local sd-server /sdapi/v1/img2img, or the fal.ai edit
 * endpoint when BACKEND=fal); otherwise txt2img.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, renameSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = 3456;
const DEBUG = !!process.env.DEBUG;
const BACKEND    = (process.env.BACKEND    || 'local').toLowerCase();
const FAL_KEY    = process.env.FAL_AI_KEY  || '';
const FAL_MODEL  = process.env.FAL_MODEL   || 'fal-ai/flux-2/turbo';
const SD_SERVER  = process.env.SD_SERVER   || 'http://127.0.0.1:8081';
const SD_STEPS   = parseInt(process.env.SD_STEPS  || '4', 10);
const SD_CFG     = parseFloat(process.env.SD_CFG    || '1.0');
const SD_SAMPLER = process.env.SD_SAMPLER || 'euler';
const PYTHON     = process.env.PYTHON     || 'python3';
const OUTPUT_DIR = join(__dirname, '..', '..', 'public', 'assets', 'tiles');
const ARCHIVE_DIR = join(__dirname, '..', '..', 'archive', 'tiles');
// Generated variants live here; copied to OUTPUT_DIR via "Use in Game"
const TEXTURES_DIR = join(__dirname, 'textures');
// Feature-on-tile compositions (terrain + resource SVG), produced by
// compose_feature_tiles.mjs; copied to OUTPUT_DIR via "Use in Game".
const COMPOSED_DIR = join(__dirname, 'tiles');
const COMPOSE_SCRIPT = join(__dirname, 'compose_feature_tiles.mjs');

/** Parse "terrain_grassland_3.png" → { group: "terrain_grassland", n: 3 } */
function parseTextureName(filename) {
  const base = filename.replace(/\.png$/i, '');
  const match = base.match(/^(.+)_(\d+)$/);
  if (!match) return null;
  return { group: match[1], n: parseInt(match[2], 10) };
}

/** Return the next unused variant number for a given group name in TEXTURES_DIR. */
function nextVariantN(groupName) {
  if (!existsSync(TEXTURES_DIR)) return 1;
  const files = readdirSync(TEXTURES_DIR);
  let max = 0;
  for (const f of files) {
    const p = parseTextureName(f);
    if (p && p.group === groupName) max = Math.max(max, p.n);
  }
  return max + 1;
}

/**
 * Return the next in-game variant number for a group, independent of the
 * tile-generator numbering. In-game tiles always start at _1 and count up,
 * so adding the same image twice yields two separate game tiles (_1, _2, …)
 * with no gaps. Legacy base files without a _N suffix (e.g. terrain_x.png)
 * are not counted — they are a separate primary tile.
 */
function nextGameN(groupName) {
  if (!existsSync(OUTPUT_DIR)) return 1;
  const files = readdirSync(OUTPUT_DIR);
  let max = 0;
  for (const f of files) {
    const p = parseTextureName(f);
    if (p && p.group === groupName) max = Math.max(max, p.n);
  }
  return max + 1;
}

/**
 * Compact a group's in-game numbered tiles so they are contiguous from _1.
 * Removing terrain_forest_feature_1 must leave _1,_2,_3 — never a gap like
 * _2,_3,_4. Legacy base files without a _N suffix are never touched. Returns
 * the list of renames performed ({ from, to }).
 */
function renumberGroup(groupName) {
  if (!existsSync(OUTPUT_DIR)) return [];
  const files = readdirSync(OUTPUT_DIR);
  const members = [];
  for (const f of files) {
    const p = parseTextureName(f);
    if (p && p.group === groupName) members.push(p.n);
  }
  members.sort((a, b) => a - b);

  // The k-th smallest current number becomes k+1. Processing in ascending
  // order is safe: the target slot is never occupied when it is written.
  const renames = [];
  for (let i = 0; i < members.length; i++) {
    const current = members[i];
    const target = i + 1;
    if (current === target) continue;
    const from = join(OUTPUT_DIR, `${groupName}_${current}.png`);
    const to = join(OUTPUT_DIR, `${groupName}_${target}.png`);
    if (existsSync(from) && !existsSync(to)) {
      renameSync(from, to);
      renames.push({ from: `${groupName}_${current}.png`, to: `${groupName}_${target}.png` });
      console.log(`[renumber] ${groupName}_${current}.png → ${groupName}_${target}.png`);
    }
  }
  return renames;
}

/**
 * Composed feature-on-tile renders (tools/tile-generator/tiles), newest last.
 * `inGame` marks the ones already copied into public/assets/tiles.
 */
function listComposedTiles() {
  if (!existsSync(COMPOSED_DIR)) return [];
  return readdirSync(COMPOSED_DIR)
    .filter((f) => /\.png$/i.test(f))
    .map((f) => {
      const st = statSync(join(COMPOSED_DIR, f));
      return {
        filename: f,
        path: `/api/composed/${encodeURIComponent(f)}`,
        size: st.size,
        mtime: st.mtimeMs,
        inGame: existsSync(join(OUTPUT_DIR, f)),
      };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

function serveFile(res, path, mime) {
  try {
    const data = readFileSync(path);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

/** Return a unique archive path for a filename, appending _2, _3, etc. if needed. */
function uniqueArchivePath(fname) {
  const ext = extname(fname);
  const base = fname.slice(0, -ext.length);

  let candidate = join(ARCHIVE_DIR, fname);
  if (!existsSync(candidate)) return candidate;

  let n = 2;
  while (existsSync(candidate)) {
    candidate = join(ARCHIVE_DIR, `${base}_${n}${ext}`);
    n++;
  }
  return candidate;
}

// ─── Local Stable Diffusion helpers ──────────────────────────────────────────

let _sdUpCache = null;
async function sdServerUp() {
  if (_sdUpCache !== null) return _sdUpCache;
  try {
    const r = await fetch(`${SD_SERVER}/`, { signal: AbortSignal.timeout(3000) });
    _sdUpCache = r.ok;
  } catch { _sdUpCache = false; }
  return _sdUpCache;
}

let _rembgCache = null;
function rembgAvailable() {
  if (_rembgCache !== null) return _rembgCache;
  const r = spawnSync(PYTHON, ['-c', 'import rembg'], { encoding: 'utf8' });
  _rembgCache = r.status === 0;
  return _rembgCache;
}

/**
 * POST to a local SD server endpoint and return the decoded PNG buffer.
 * Retries on transient network errors (the sd-server occasionally closes the
 * socket mid-request, e.g. when it is busy or the request takes too long).
 */
async function sdFetchWithRetry(path, body, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(`${SD_SERVER}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(`SD server HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const data = await r.json();
      if (!data.images?.[0]) throw new Error('No image returned from SD server');
      return Buffer.from(data.images[0], 'base64');
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`[sd] request failed (${err.message}) — retrying ${attempt + 1}/${retries}…`);
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

/** Generate an image via the local SD server (txt2img) and return a PNG buffer. */
function sdTxt2img(prompt, width, height, steps = SD_STEPS) {
  return sdFetchWithRetry('/sdapi/v1/txt2img', {
    prompt,
    width,
    height,
    steps,
    cfg_scale: SD_CFG,
    sampler_name: SD_SAMPLER,
    seed: -1,
  });
}

/** Generate an image via the local SD server (img2img) and return a PNG buffer. */
function sdImg2img(prompt, initDataUri, width, height, steps, denoisingStrength) {
  const strength = Math.max(0, Math.min(1, Number(denoisingStrength) || 0.6));
  return sdFetchWithRetry('/sdapi/v1/img2img', {
    prompt,
    init_images: [initDataUri],
    width,
    height,
    steps,
    cfg_scale: SD_CFG,
    sampler_name: SD_SAMPLER,
    seed: -1,
    denoising_strength: strength,
  });
}

/**
 * Build the fal.ai request body, selecting the image-input field a given
 * model family expects (mirrors the original fal.ai integration):
 *  - Nano Banana / Gemini edit endpoints are prompt+images only.
 *  - Classic `.../image-to-image` endpoints use `image_url` + `strength`.
 *  - Everything else (FLUX.2 edit, FLUX.1 dev, …) uses `image_urls`.
 */
function falBuildBody(prompt, width, height, imageUrl, strength, steps) {
  if (FAL_MODEL.includes('nano-banana') || FAL_MODEL.includes('gemini')) {
    const body = { prompt };
    if (imageUrl) body.image_urls = [imageUrl];
    return body;
  }
  const body = { prompt, image_size: { width, height }, num_inference_steps: steps };
  if (imageUrl) {
    if (FAL_MODEL.includes('/image-to-image')) {
      body.image_url = imageUrl;
      if (strength != null) body.strength = strength;
    } else {
      body.image_urls = [imageUrl];
    }
  }
  return body;
}

/**
 * Generate an image via the fal.ai cloud queue API and return a PNG buffer.
 * Supports txt2img, and img2img/edit when a source data URI is supplied.
 */
async function falGenerate(prompt, width, height, imageUrl = null, strength = null, steps = null) {
  if (!FAL_KEY) throw new Error('BACKEND=fal requires FAL_AI_KEY (export FAL_AI_KEY=...)');
  const numSteps = steps || (FAL_MODEL.includes('schnell') ? 4
    : (FAL_MODEL.includes('flux-2') || FAL_MODEL.includes('flux.2')) ? 8 : 28);
  console.log(`[fal.ai] ${FAL_MODEL} — "${prompt.slice(0, 80)}..." (${width}x${height})${imageUrl ? ' [img2img]' : ''}`);

  async function fetchJSON(url, opts) {
    const resp = await fetch(url, opts);
    const text = await resp.text();
    if (!resp.ok) throw new Error(`fal.ai HTTP ${resp.status}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text); } catch { throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`); }
  }

  const submit = await fetchJSON(`https://queue.fal.run/${FAL_MODEL}`, {
    method: 'POST',
    headers: { 'Authorization': `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(falBuildBody(prompt, width, height, imageUrl, strength, numSteps)),
  });
  const { status_url, response_url } = submit;
  if (!status_url || !response_url) {
    throw new Error(`Missing status_url/response_url in fal.ai response: ${JSON.stringify(submit).slice(0, 200)}`);
  }

  for (let attempt = 1; attempt <= 120; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const status = await fetchJSON(status_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
    if (status.status === 'COMPLETED') {
      const result = await fetchJSON(response_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
      const outUrl = result?.images?.[0]?.url || result?.image?.url;
      if (!outUrl) throw new Error('No image URL in fal.ai result');
      const imgResp = await fetch(outUrl);
      return Buffer.from(await imgResp.arrayBuffer());
    }
    if (status.status === 'FAILED') {
      throw new Error(`fal.ai generation failed: ${JSON.stringify(status).slice(0, 300)}`);
    }
  }
  throw new Error('fal.ai generation timed out (120s)');
}

const REMBG_PY = [
  'from rembg import remove',
  'from PIL import Image',
  'import sys',
  'src, dst = sys.argv[1], sys.argv[2]',
  'Image.MAX_IMAGE_PIXELS = None',
  'img = Image.open(src).convert("RGB")',
  'out = remove(img)',
  'out.save(dst)',
].join('\n');

/** Remove the background of srcPath with local Python rembg and return the PNG buffer. */
function sdRemoveBackground(srcPath) {
  const tmp = `${srcPath}.nobg.png`;
  const r = spawnSync(PYTHON, ['-c', REMBG_PY, srcPath, tmp], {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const tail = (r.stderr || r.stdout || '').trim().split('\n').slice(-3).join('\n');
    throw new Error(`rembg failed (exit ${r.status}): ${tail}`);
  }
  const buf = readFileSync(tmp);
  try { unlinkSync(tmp); } catch { /* ignore */ }
  return buf;
}

/**
 * Resolve a source-image reference into a base64 data URI the SD server accepts.
 * Accepts an existing `data:` URI, a server texture path (`/api/textures/…`,
 * `/api/game-tiles/…`, `/api/tiles/…`), or a bare filename (searched in
 * TEXTURES_DIR then OUTPUT_DIR). Returns null if the file cannot be found.
 */
function resolveSourceToDataUri(ref) {
  if (!ref) return null;
  if (typeof ref === 'string' && ref.startsWith('data:')) return ref;

  const pathOnly = String(ref).split('?')[0];
  let filePath = null;

  if (pathOnly.startsWith('/api/textures/')) {
    const fname = decodeURIComponent(pathOnly.slice('/api/textures/'.length));
    const cand = join(TEXTURES_DIR, fname);
    if (existsSync(cand)) filePath = cand;
  } else if (pathOnly.startsWith('/api/game-tiles/') || pathOnly.startsWith('/api/tiles/')) {
    const prefix = pathOnly.startsWith('/api/game-tiles/') ? '/api/game-tiles/' : '/api/tiles/';
    const fname = decodeURIComponent(pathOnly.slice(prefix.length));
    const cand = join(OUTPUT_DIR, fname);
    if (existsSync(cand)) filePath = cand;
  } else {
    const fname = decodeURIComponent(pathOnly.replace(/^\/+/, ''));
    for (const dir of [TEXTURES_DIR, OUTPUT_DIR]) {
      const cand = join(dir, fname);
      if (existsSync(cand)) { filePath = cand; break; }
    }
  }

  if (!filePath) return null;
  const buf = readFileSync(filePath);
  const mime = (buf[0] === 0xFF && buf[1] === 0xD8) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ─── API: list tiles ─────────────────────────────────────────────────
  if (pathname === '/api/tiles' && req.method === 'GET') {
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    const files = readdirSync(OUTPUT_DIR)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .map((f) => {
        const full = join(OUTPUT_DIR, f);
        const size = statSync(full).size;
        return { name: f, path: `/api/tiles/${f}`, size };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return json(res, files);
  }

  // ─── API: serve tile image ──────────────────────────────────────────
  if (pathname.startsWith('/api/tiles/') && req.method === 'GET') {
    const fname = decodeURIComponent(pathname.slice('/api/tiles/'.length));
    const safe = join(OUTPUT_DIR, fname);
    if (!safe.startsWith(OUTPUT_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    const ext = extname(fname).toLowerCase();
    return serveFile(res, safe, MIME[ext] || 'image/png');
  }

  // ─── API: delete tile ───────────────────────────────────────────────
  if (pathname.startsWith('/api/tiles/') && req.method === 'DELETE') {
    const fname = decodeURIComponent(pathname.slice('/api/tiles/'.length));
    const safe = join(OUTPUT_DIR, fname);
    if (!safe.startsWith(OUTPUT_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    try {
      unlinkSync(safe);
      return json(res, { ok: true });
    } catch {
      return json(res, { ok: false, error: 'Delete failed' }, 500);
    }
  }

  // ─── API: list composed feature-on-tile renders ─────────────────────
  if (pathname === '/api/composed' && req.method === 'GET') {
    return json(res, { tiles: listComposedTiles() });
  }

  // ─── API: run the feature-on-tile composition script ────────────────
  if (pathname === '/api/compose-features' && req.method === 'POST') {
    // The script derives the combinations from the game data (terrain +
    // special-resource rules) and writes tools/tile-generator/tiles. Copying
    // into the game is left to the explicit "Use in Game" action.
    const result = spawnSync('node', [COMPOSE_SCRIPT], {
      cwd: __dirname,
      env: { ...process.env, SKIP_COPY: '1' },
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (result.status !== 0) {
      const details = (result.stderr || result.stdout || 'compose script failed').trim();
      console.error('[compose-features]', details);
      return json(res, { ok: false, error: details, output: result.stdout }, 500);
    }
    console.log('[compose-features] composed', listComposedTiles().length, 'tile(s)');
    return json(res, { ok: true, output: result.stdout, tiles: listComposedTiles() });
  }

  // ─── API: copy composed tile(s) into the game ───────────────────────
  if (pathname === '/api/composed/use-in-game' && req.method === 'POST') {
    const body = await readBody(req);
    let params;
    try { params = JSON.parse(body); } catch { return json(res, { error: 'Invalid JSON' }, 400); }
    const filenames = params.filenames || (params.filename ? [params.filename] : []);
    if (filenames.length === 0) return json(res, { error: 'Missing filename(s)' }, 400);
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

    const results = [];
    for (const filename of filenames) {
      const safeFilename = filename.replace(/[^a-z0-9_.-]/gi, '_');
      const srcPath = join(COMPOSED_DIR, safeFilename);
      const destPath = join(OUTPUT_DIR, safeFilename);
      if (!srcPath.startsWith(COMPOSED_DIR) || !existsSync(srcPath)) {
        results.push({ filename, ok: false, error: `Not found: ${safeFilename}` });
        continue;
      }
      copyFileSync(srcPath, destPath);
      console.log(`[composed] ${safeFilename} → game tiles/`);
      results.push({ filename, ok: true, targetName: safeFilename });
    }
    return json(res, { ok: results.every(r => r.ok), results });
  }

  // ─── API: remove composed tile(s) from the game ─────────────────────
  if (pathname === '/api/composed/remove-from-game' && req.method === 'POST') {
    const body = await readBody(req);
    let params;
    try { params = JSON.parse(body); } catch { return json(res, { error: 'Invalid JSON' }, 400); }
    const filenames = params.filenames || (params.filename ? [params.filename] : []);
    if (filenames.length === 0) return json(res, { error: 'Missing filename(s)' }, 400);

    const results = [];
    for (const filename of filenames) {
      const safeFilename = filename.replace(/[^a-z0-9_.-]/gi, '_');
      const targetPath = join(OUTPUT_DIR, safeFilename);
      if (!targetPath.startsWith(OUTPUT_DIR) || !existsSync(targetPath)) {
        results.push({ filename, ok: false, error: `Not in game: ${safeFilename}` });
        continue;
      }
      unlinkSync(targetPath);
      console.log(`[composed] ${safeFilename} ← game tiles/`);
      results.push({ filename, ok: true, targetName: safeFilename });
    }
    return json(res, { ok: results.every(r => r.ok), results });
  }

  // ─── API: serve composed tile image ─────────────────────────────────
  if (pathname.startsWith('/api/composed/') && req.method === 'GET') {
    const fname = decodeURIComponent(pathname.slice('/api/composed/'.length));
    const safe = join(COMPOSED_DIR, fname);
    if (!safe.startsWith(COMPOSED_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    return serveFile(res, safe, MIME[extname(fname).toLowerCase()] || 'image/png');
  }

  // ─── API: delete composed tile ──────────────────────────────────────
  if (pathname.startsWith('/api/composed/') && req.method === 'DELETE') {
    const fname = decodeURIComponent(pathname.slice('/api/composed/'.length));
    const safe = join(COMPOSED_DIR, fname);
    if (!safe.startsWith(COMPOSED_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    try { unlinkSync(safe); return json(res, { ok: true }); }
    catch { return json(res, { ok: false, error: 'Delete failed' }, 500); }
  }

  // ─── API: generate tile (local Stable Diffusion) ────────────────────
  if (pathname === '/api/generate' && req.method === 'POST') {
    const body = await readBody(req);
    let params;
    try { params = JSON.parse(body); } catch {
      return json(res, { error: 'Invalid JSON' }, 400);
    }

    const { prompt, tileName, width, height, useInGame, imageUrl, steps, strength } = params;
    if (!prompt || !tileName) return json(res, { error: 'Missing prompt or tileName' }, 400);

    const w = width || 512;
    const h = height || 512;
    const sdSteps = (steps != null && Number.isInteger(Number(steps)) && Number(steps) > 0)
      ? Math.min(Number(steps), 200)
      : SD_STEPS;

    try {
      let buffer;
      if (BACKEND === 'fal') {
        const sourceDataUri = imageUrl ? resolveSourceToDataUri(imageUrl) : null;
        if (imageUrl && !sourceDataUri) return json(res, { error: 'Source image not found or unreadable' }, 404);
        buffer = await falGenerate(prompt, w, h, sourceDataUri, strength, sdSteps);
      } else if (imageUrl) {
        const sourceDataUri = resolveSourceToDataUri(imageUrl);
        if (!sourceDataUri) return json(res, { error: 'Source image not found or unreadable' }, 404);
        console.log(`[sd] img2img "${prompt.slice(0, 80)}..." (${w}x${h}, steps=${sdSteps}, strength=${strength ?? 0.6})`);
        buffer = await sdImg2img(prompt, sourceDataUri, w, h, sdSteps, strength);
      } else {
        console.log(`[sd] txt2img "${prompt.slice(0, 80)}..." (${w}x${h}, steps=${sdSteps}, cfg=${SD_CFG}, sampler=${SD_SAMPLER})`);
        buffer = await sdTxt2img(prompt, w, h, sdSteps);
      }

      const safeBase = tileName.replace(/[^a-z0-9_-]/gi, '_');

      if (useInGame) {
        // Batch-script mode: save directly to the game tiles folder (legacy behaviour)
        if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
        if (!existsSync(ARCHIVE_DIR)) mkdirSync(ARCHIVE_DIR, { recursive: true });
        const fname = safeBase + '.png';
        const filePath = join(OUTPUT_DIR, fname);
        if (existsSync(filePath)) {
          const archivePath = uniqueArchivePath(fname);
          renameSync(filePath, archivePath);
          console.log(`[archive] Moved existing "${fname}" → archive/tiles/${archivePath.split('/').pop()}`);
        }
        writeFileSync(filePath, buffer);
        return json(res, { ok: true, name: fname, filename: fname, path: `/api/tiles/${fname}`, size: buffer.length });
      }

      // Interactive mode: save to TEXTURES_DIR with auto-incremented variant n
      if (!existsSync(TEXTURES_DIR)) mkdirSync(TEXTURES_DIR, { recursive: true });
      const n = nextVariantN(safeBase);
      const fname = `${safeBase}_${n}.png`;
      const filePath = join(TEXTURES_DIR, fname);

      writeFileSync(filePath, buffer);
      console.log(`[generate] Saved variant: ${fname} (${buffer.length} bytes)`);

      return json(res, {
        ok: true,
        name: fname,
        filename: fname,
        path: `/api/textures/${encodeURIComponent(fname)}`,
        size: buffer.length,
        n,
      });
    } catch (err) {
      console.error('[server] Generate error:', err);
      return json(res, { error: String(err) }, 500);
    }
  }

  // ─── API: remove background (local Python rembg) ────────────────────
  if (pathname === '/api/remove-bg' && req.method === 'POST') {
    const body = await readBody(req);
    let params;
    try { params = JSON.parse(body); } catch {
      return json(res, { error: 'Invalid JSON' }, 400);
    }

    const { tileName, source } = params;
    if (!tileName) return json(res, { error: 'Missing tileName' }, 400);

    // Sanitize — no path separators allowed
    const fname = tileName.replace(/[^a-z0-9_.-]/gi, '_');

    // Prefer TEXTURES_DIR; fall back to OUTPUT_DIR for legacy usage
    const searchDirs = source === 'game' ? [OUTPUT_DIR] : [TEXTURES_DIR, OUTPUT_DIR];
    let fileDir = null;
    for (const dir of searchDirs) {
      const candidate = join(dir, fname);
      if (candidate.startsWith(dir) && existsSync(candidate)) { fileDir = dir; break; }
    }
    if (!fileDir) return json(res, { error: `File not found: ${fname}` }, 404);
    const filePath = join(fileDir, fname);

    try {
      if (!rembgAvailable()) {
        return json(res, { error: 'Python rembg is not available. Install it: pip install rembg' }, 500);
      }
      console.log(`[bg-remove] Processing "${fname}" via local Python rembg...`);
      const outBuffer = sdRemoveBackground(filePath);

      // Overwrite in place — result is always PNG with alpha channel
      writeFileSync(filePath, outBuffer);
      console.log(`[bg-remove] Saved "${fname}" with background removed (${outBuffer.length} bytes)`);

      return json(res, { ok: true, name: fname, size: outBuffer.length });
    } catch (err) {
      console.error('[bg-remove] Error:', err);
      return json(res, { error: String(err) }, 500);
    }
  }

  // ─── API: list generated texture variants (grouped) ──────────────────
  if (pathname === '/api/textures' && req.method === 'GET') {
    if (!existsSync(TEXTURES_DIR)) mkdirSync(TEXTURES_DIR, { recursive: true });
    const files = readdirSync(TEXTURES_DIR).filter(f => /\.png$/i.test(f));

    const groupMap = new Map();
    for (const f of files) {
      const p = parseTextureName(f);
      if (!p) continue;
      if (!groupMap.has(p.group)) groupMap.set(p.group, []);
      const st = statSync(join(TEXTURES_DIR, f));
      groupMap.get(p.group).push({ filename: f, path: `/api/textures/${encodeURIComponent(f)}`, size: st.size, n: p.n, mtime: st.mtimeMs });
    }

    const groups = [];
    for (const [name, variants] of groupMap) {
      variants.sort((a, b) => a.n - b.n);

      // Check for in-game tiles (both name.png and name_N.png patterns).
      // A tile belongs to this group only if its parsed group matches —
      // never via naive prefix matching, so terrain_forest_feature*.png
      // stays out of the terrain_forest group.
      const inGameTiles = [];
      if (existsSync(OUTPUT_DIR)) {
        const gameFiles = readdirSync(OUTPUT_DIR).filter(f => {
          if (!/\.png$/i.test(f)) return false;
          const parsed = parseTextureName(f);
          if (parsed) return parsed.group === name;
          // No _N suffix → belongs to the group with its own base name
          return f.replace(/\.png$/i, '') === name;
        });
        for (const f of gameFiles) {
          const st = statSync(join(OUTPUT_DIR, f));
          inGameTiles.push({ filename: f, path: `/api/game-tiles/${encodeURIComponent(f)}`, size: st.size, mtime: st.mtimeMs });
        }
      }

      // For backward compatibility, keep inGame as single item or first found
      const inGame = inGameTiles.length > 0 ? inGameTiles[0] : null;
      groups.push({ name, variants, inGame, inGameTiles });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
    return json(res, { groups });
  }

  // ─── API: serve texture variant image ────────────────────────────────
  if (pathname.startsWith('/api/textures/') && req.method === 'GET') {
    const fname = decodeURIComponent(pathname.slice('/api/textures/'.length));
    const safe = join(TEXTURES_DIR, fname);
    if (!safe.startsWith(TEXTURES_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    return serveFile(res, safe, MIME[extname(fname).toLowerCase()] || 'image/png');
  }

  // ─── API: delete texture variant ─────────────────────────────────────
  if (pathname.startsWith('/api/textures/') && req.method === 'DELETE') {
    const fname = decodeURIComponent(pathname.slice('/api/textures/'.length));
    const safe = join(TEXTURES_DIR, fname);
    if (!safe.startsWith(TEXTURES_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    try { unlinkSync(safe); return json(res, { ok: true }); }
    catch { return json(res, { ok: false, error: 'Delete failed' }, 500); }
  }

  // ─── API: use texture variant(s) in game ─────────────────────────────
  if (pathname === '/api/use-in-game' && req.method === 'POST') {
    const body = await readBody(req);
    let params;
    try { params = JSON.parse(body); } catch { return json(res, { error: 'Invalid JSON' }, 400); }

    // Support both single filename and array of filenames
    const filenames = params.filenames || (params.filename ? [params.filename] : []);
    if (filenames.length === 0) return json(res, { error: 'Missing filename(s)' }, 400);

    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

    const results = [];
    for (const filename of filenames) {
      const parsed = parseTextureName(filename.replace(/\.png$/i, ''));
      if (!parsed) {
        results.push({ filename, ok: false, error: 'Filename must end in _<n>.png' });
        continue;
      }

      const safeFilename = filename.replace(/[^a-z0-9_.-]/gi, '_');
      const srcPath = join(TEXTURES_DIR, safeFilename);
      if (!srcPath.startsWith(TEXTURES_DIR)) {
        results.push({ filename, ok: false, error: 'Forbidden' });
        continue;
      }
      if (!existsSync(srcPath)) {
        results.push({ filename, ok: false, error: `Not found: ${safeFilename}` });
        continue;
      }

      // Game-side numbering is independent of the tile-generator numbering.
      // The in-game tile always gets the group's next number starting at _1,
      // so adding the same image twice adds the same image twice to the game
      // (they can be removed manually later) and gaps are avoided.
      const gameN = nextGameN(parsed.group);
      const targetName = `${parsed.group}_${gameN}.png`;
      const destPath = join(OUTPUT_DIR, targetName);
      if (!destPath.startsWith(OUTPUT_DIR)) {
        results.push({ filename, ok: false, error: 'Forbidden' });
        continue;
      }

      copyFileSync(srcPath, destPath);
      console.log(`[use-in-game] ${safeFilename} → game tiles/${targetName} (game #${gameN})`);
      results.push({ filename, ok: true, targetName });
    }

    // Compact affected groups so in-game numbering stays contiguous from _1.
    // Self-heals any pre-existing gap (e.g. _2,_3,_4 after _1 was removed).
    const addedGroups = new Set();
    for (const r of results) {
      if (!r.ok || !r.targetName) continue;
      const p = parseTextureName(r.targetName.replace(/\.png$/i, ''));
      if (p) addedGroups.add(p.group);
    }
    const renames = [];
    for (const group of addedGroups) renames.push(...renumberGroup(group));

    const allOk = results.every(r => r.ok);
    return json(res, { ok: allOk, results, renames });
  }

  // ─── API: remove texture variant(s) from game ────────────────────────
  if (pathname === '/api/remove-from-game' && req.method === 'POST') {
    const body = await readBody(req);
    let params;
    try { params = JSON.parse(body); } catch { return json(res, { error: 'Invalid JSON' }, 400); }

    // Support both single filename and array of filenames
    const filenames = params.filenames || (params.filename ? [params.filename] : []);
    if (filenames.length === 0) return json(res, { error: 'Missing filename(s)' }, 400);

    const results = [];
    const affectedGroups = new Set();
    for (const filename of filenames) {
      const safeFilename = filename.replace(/[^a-z0-9_.-]/gi, '_');
      const parsed = parseTextureName(safeFilename.replace(/\.png$/i, ''));
      if (parsed) affectedGroups.add(parsed.group);
      const targetPath = join(OUTPUT_DIR, safeFilename);
      if (!targetPath.startsWith(OUTPUT_DIR)) {
        results.push({ filename, ok: false, error: 'Forbidden' });
        continue;
      }
      if (!existsSync(targetPath)) {
        results.push({ filename, ok: false, error: `Not in game: ${safeFilename}` });
        continue;
      }
      try {
        unlinkSync(targetPath);
        console.log(`[remove-from-game] ${safeFilename} ← game tiles/`);
        results.push({ filename, ok: true, targetName: safeFilename });
      } catch {
        results.push({ filename, ok: false, error: 'Remove failed' });
      }
    }

    // Re-number remaining tiles of affected groups so they stay contiguous
    // from _1 (removing terrain_forest_feature_1 must leave _1,_2,_3 — never
    // a gap like _2,_3,_4). Renames are returned so clients can reflect them.
    const renames = [];
    for (const group of affectedGroups) renames.push(...renumberGroup(group));

    const allOk = results.every(r => r.ok);
    return json(res, { ok: allOk, results, renames });
  }

  // ─── API: serve current in-game tile ─────────────────────────────────
  if (pathname.startsWith('/api/game-tiles/') && req.method === 'GET') {
    const fname = decodeURIComponent(pathname.slice('/api/game-tiles/'.length));
    const safe = join(OUTPUT_DIR, fname);
    if (!safe.startsWith(OUTPUT_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    return serveFile(res, safe, MIME[extname(fname).toLowerCase()] || 'image/png');
  }

  // ─── API: list models (local sd-server or fal.ai) ───────────────────
  if (pathname === '/api/models' && req.method === 'GET') {
    if (BACKEND === 'fal') {
      if (!FAL_KEY) return json(res, { error: 'FAL_AI_KEY not set (BACKEND=fal)' }, 500);
      try {
        const resp = await fetch('https://api.fal.ai/v1/models?limit=500', {
          headers: { 'Authorization': `Key ${FAL_KEY}` },
        });
        if (!resp.ok) throw new Error(`fal.ai HTTP ${resp.status}`);
        const data = await resp.json();
        const t2i = (data.models || [])
          .filter(m => ['text-to-image', 'image-to-image'].includes(m.metadata?.category))
          .map(m => ({
            id: m.endpoint_id,
            name: (m.metadata?.display_name || m.endpoint_id)
              .replace(/ (Text|Image) To Image?$/, '')
              .replace(/ API$/, '')
              .replace(/ Edit$/, ''),
            category: m.metadata?.category || 'image-to-image',
            isEdit: m.metadata?.category === 'image-to-image',
            description: (m.metadata?.description || '').split('\n')[0].slice(0, 200),
            status: m.metadata?.status || 'unknown',
            pricing: null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const QUICK_SELECT_IDS = [
          'fal-ai/flux-2/turbo', 'fal-ai/flux/schnell', 'fal-ai/flux/dev',
          'fal-ai/fast-sdxl', 'fal-ai/stable-diffusion-v3.5',
          'fal-ai/flux-2/turbo/edit', 'fal-ai/nano-banana-2/edit',
        ];
        const existing = new Set(t2i.map(m => m.id));
        for (const id of QUICK_SELECT_IDS) {
          if (!existing.has(id)) {
            const name = id.replace('fal-ai/', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            t2i.push({
              id, name,
              category: id.includes('/edit') ? 'image-to-image' : 'text-to-image',
              isEdit: id.includes('/edit'),
              description: 'Quick-select model',
              status: 'unknown',
              pricing: null,
            });
          }
        }
        t2i.sort((a, b) => a.name.localeCompare(b.name));
        return json(res, { models: t2i });
      } catch (err) {
        console.error('[models] Error:', err);
        return json(res, { error: String(err) }, 500);
      }
    }
    return json(res, {
      models: [{
        id: 'flux-2-klein-4b',
        name: 'Flux 2 Klein (local)',
        category: 'text-to-image',
        isEdit: false,
        description: 'Local stable-diffusion.cpp sd-server — flux-2-klein-4b-Q4_K_S.gguf (txt2img only)',
        status: 'ready',
        pricing: null,
      }],
    });
  }

  // ─── API: pricing (local = free, fal = online) ──────────────────────
  if (pathname === '/api/pricing' && req.method === 'GET') {
    const idsParam = url.searchParams.get('ids');
    const ids = idsParam ? [...new Set(idsParam.split(',').map(s => s.trim()).filter(Boolean))] : [];
    const prices = {};
    for (const id of ids) {
      prices[id] = BACKEND === 'fal'
        ? { cost: '—', unit: '', type: 'online', note: 'fal.ai (online, paid)' }
        : { cost: 'free', unit: '', type: 'local', note: 'Local Stable Diffusion server' };
    }
    return json(res, { prices });
  }

  // ─── API: estimate generation cost (local = free, fal = online) ─────
  if (pathname === '/api/estimate-cost' && req.method === 'POST') {
    const body = await readBody(req);
    let params;
    try { params = JSON.parse(body); } catch {
      return json(res, { error: 'Invalid JSON' }, 400);
    }
    const w = parseInt(params.width) || 512;
    const h = parseInt(params.height) || 512;
    const megapixels = (w * h) / 1_000_000;
    if (BACKEND === 'fal') {
      return json(res, {
        estimatedCost: null,
        currency: 'USD',
        megapixels: parseFloat(megapixels.toFixed(4)),
        unitQuantity: 1,
        unit: 'online',
      });
    }
    return json(res, {
      estimatedCost: 0,
      currency: 'USD',
      megapixels: parseFloat(megapixels.toFixed(4)),
      unitQuantity: 1,
      unit: 'local',
      local: true,
    });
  }

  // ─── API: debug/diagnostics ──────────────────────────────────────────
  if (pathname === '/api/debug' && req.method === 'GET') {
    return json(res, {
      debug: DEBUG,
      backend: BACKEND,
      falKey: FAL_KEY ? `Present (${FAL_KEY.length} chars)` : 'MISSING',
      falModel: FAL_MODEL,
      sdServer: SD_SERVER,
      sdServerUp: await sdServerUp(),
      python: PYTHON,
      rembg: rembgAvailable(),
      outputDir: OUTPUT_DIR,
      tileCount: existsSync(OUTPUT_DIR)
        ? readdirSync(OUTPUT_DIR).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).length
        : 0,
    });
  }

  // ─── API: test/health check ──────────────────────────────────────────
  if (pathname === '/api/test' && req.method === 'GET') {
    return json(res, {
      ok: true,
      backend: BACKEND,
      falKey: FAL_KEY ? `Present (${FAL_KEY.length} chars)` : 'MISSING',
      sdServer: SD_SERVER,
      sdServerUp: await sdServerUp(),
      outputDir: OUTPUT_DIR,
      outputExists: existsSync(OUTPUT_DIR),
      tileCount: existsSync(OUTPUT_DIR)
        ? readdirSync(OUTPUT_DIR).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).length
        : 0,
    });
  }

  // ─── Static files ───────────────────────────────────────────────────
  // API routes return JSON 404 for debugging; everything else returns text
  if (pathname.startsWith('/api/')) {
    return json(res, { error: 'Not found', path: pathname, method: req.method }, 404);
  }

  // Serve the HTML UI
  if (pathname === '/' || pathname === '/index.html') {
    const index = join(__dirname, 'index.html');
    return serveFile(res, index, MIME['.html']);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n🎨  Tile Generator running at http://localhost:${PORT}`);
  if (BACKEND === 'fal') {
    console.log(`☁️  Backend: fal.ai — ${FAL_MODEL} (${FAL_KEY ? `key ${FAL_KEY.length} chars` : 'FAL_AI_KEY MISSING'})`);
  } else {
    console.log(`🖥️  Backend: local SD — ${SD_SERVER} (${sdServerUp() ? 'online' : 'OFFLINE — start the sd-server first'})`);
    console.log('   Switch backend with: BACKEND=fal FAL_AI_KEY=...');
  }
  console.log(`🧹  Background removal: local Python rembg (${rembgAvailable() ? 'available' : 'MISSING — pip install rembg'})`);
  console.log(`📁  Images saved to: ${OUTPUT_DIR}\n`);
});
