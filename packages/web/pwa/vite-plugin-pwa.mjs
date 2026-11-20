/**
 * Vite plugin that generates the service worker for the production build.
 *
 * The service worker needs to know the *hashed* file names of the build in
 * order to precache the app shell. Those names only exist after the bundle
 * has been generated, so the worker is rendered in `writeBundle`, once the
 * final file list is known.
 *
 * Why a small in-repo plugin instead of `vite-plugin-pwa`:
 *
 *  - the precache list is deliberately narrow (the app shell only — not the
 *    38 MB of tiles, music and wonder art), and
 *  - the caching rules are specific to this app: `/config.js` must never be
 *    frozen, and the game server must never be intercepted.
 *
 * The plugin is a no-op in dev mode, so `npm run dev` keeps working exactly
 * as before — no service worker, no cache, no HMR confusion.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, sep } from 'node:path';

/** Public directories that hold the big game assets — never precached. */
const GAME_ASSET_DIRS = [
  'assets/tiles',
  'assets/music',
  'assets/sfx',
  'assets/wonders',
  'assets/story',
  'assets/nomads',
];

/**
 * Build output that belongs to the *app shell* and is precached.
 *
 * The shell is the code and the type: the document, the JavaScript, the
 * stylesheet and the fonts. Everything else — unit icons, leader portraits,
 * tiles, music, wonder art — is fetched on demand and lands in the runtime
 * cache instead, which keeps the install small and fast.
 */
const SHELL_BUILD_EXTENSIONS = ['.js', '.mjs', '.css', '.woff', '.woff2', '.ttf', '.otf', '.eot'];

/** Source maps are debug artefacts; never ship them to the offline cache. */
const NEVER_PRECACHE_EXTENSIONS = ['.map'];

/** Public files larger than this are not precached (defensive). */
const MAX_PRECACHE_FILE_BYTES = 512 * 1024;

/**
 * @param {object} [options]
 * @param {string} [options.template] Path to the service worker template.
 * @param {string} [options.publicDir] Directory with the static public files.
 * @param {string} [options.outputFile] Name of the generated worker.
 */
export function pwaPlugin(options = {}) {
  const templatePath = options.template ?? 'packages/web/pwa/sw.template.js';
  const publicDir = options.publicDir ?? 'public';
  const outputFile = options.outputFile ?? 'sw.js';

  return {
    name: 'civ1-pwa',
    // Build only: the dev server must stay untouched.
    apply: 'build',

    writeBundle(outputOptions, bundle) {
      const template = readFileSync(templatePath, 'utf8');

      // 1. The hashed build output — JS, CSS and fonts. Images (unit icons,
      //    leader portraits) are fetched on demand and land in the runtime
      //    cache, so the install stays small.
      const emitted = Object.keys(bundle)
        .filter((fileName) => fileName !== outputFile)
        .filter((fileName) => !NEVER_PRECACHE_EXTENSIONS.some((ext) => fileName.endsWith(ext)))
        .filter(
          (fileName) =>
            fileName.endsWith('.html') ||
            SHELL_BUILD_EXTENSIONS.some((ext) => fileName.endsWith(ext)),
        )
        .map((fileName) => `/${fileName.split(sep).join(posix.sep)}`);

      // 2. The small static files the shell needs (icons, favicons, the
      //    manifest). The 38 MB of game assets are cached on demand instead.
      const publicFiles = collectShellFiles(publicDir);

      const precache = dedupe([...emitted, ...publicFiles]).sort();

      // A content-derived version stamp: a new build gets a new cache name,
      // so the old caches are dropped when the new worker activates.
      const version = createHash('sha256')
        .update(precache.join('\n'))
        .update(String(outputOptions.dir ?? ''))
        .digest('hex')
        .slice(0, 12);

      const source = template
        .replace('__PRECACHE_MANIFEST__', JSON.stringify(precache, null, 2))
        .replace('__BUILD_VERSION__', JSON.stringify(version));

      const outDir = outputOptions.dir;
      if (!outDir) {
        this.warn('civ1-pwa: no output directory — service worker not written');
        return;
      }
      writeFileSync(join(outDir, outputFile), source, 'utf8');
      this.info?.(`civ1-pwa: ${outputFile} written (${precache.length} precached files, version ${version})`);
    },
  };
}

/**
 * Collect the small public files that belong to the app shell.
 *
 * Everything under a game-asset directory is skipped — those are cached on
 * demand — and anything larger than the size cap is skipped as well.
 */
function collectShellFiles(publicDir) {
  if (!existsSync(publicDir)) return [];
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      const urlPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(absolute, urlPath);
        continue;
      }
      if (GAME_ASSET_DIRS.includes(urlPath)) continue;
      if (urlPath.startsWith('assets/')) continue;
      const size = statSync(absolute).size;
      if (size > MAX_PRECACHE_FILE_BYTES) continue;
      files.push(`/${urlPath}`);
    }
  };
  walk(publicDir, '');
  return files;
}

function dedupe(values) {
  return [...new Set(values)];
}

