/**
 * The service-worker generator.
 *
 * The precache manifest decides what an installed PWA can show with the
 * network switched off, and what it must fetch on demand. Both halves are
 * pinned here: the shell must be precached, the 38 MB of game artwork must
 * not be.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// The plugin is plain ESM without type declarations.
import { pwaPlugin } from '../../packages/web/pwa/vite-plugin-pwa.mjs';

let outDir: string;
let publicDir: string;
let templatePath: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), 'civ1-pwa-'));
  publicDir = join(outDir, 'public');
  mkdirSync(join(publicDir, 'icons'), { recursive: true });
  mkdirSync(join(publicDir, 'assets', 'tiles'), { recursive: true });

  writeFileSync(join(publicDir, 'favicon.png'), 'x');
  writeFileSync(join(publicDir, 'icons', 'icon-192.png'), 'x');
  writeFileSync(join(publicDir, 'manifest.webmanifest'), '{}');
  writeFileSync(join(publicDir, 'assets', 'tiles', 'terrain_ocean.png'), 'x');

  templatePath = join(outDir, 'sw.template.js');
  writeFileSync(
    templatePath,
    [
      'const PRECACHE_MANIFEST = __PRECACHE_MANIFEST__;',
      'const BUILD_VERSION = __BUILD_VERSION__;',
      'export default { PRECACHE_MANIFEST, BUILD_VERSION };',
    ].join('\n'),
  );
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

interface BundleEntry {
  [fileName: string]: { fileName: string };
}

function runPlugin(bundle: BundleEntry): { source: string; manifest: string[] } {
  const plugin = pwaPlugin({
    template: templatePath,
    publicDir,
    outputFile: 'sw.js',
  });
  const context = {
    warn: () => undefined,
    info: () => undefined,
  };
  plugin.writeBundle.call(context, { dir: outDir }, bundle);
  const source = readFileSync(join(outDir, 'sw.js'), 'utf8');
  const match = /const PRECACHE_MANIFEST = (\[[\s\S]*?\]);/.exec(source);
  return { source, manifest: match ? JSON.parse(match[1]) : [] };
}

describe('service worker generation', () => {
  it('precaches the document, the code and the fonts', () => {
    const { manifest } = runPlugin({
      'index.html': { fileName: 'index.html' },
      'assets/index-abc12345.js': { fileName: 'assets/index-abc12345.js' },
      'assets/index-abc12345.css': { fileName: 'assets/index-abc12345.css' },
      'assets/NotoEmoji-Light-DzS.ttf': { fileName: 'assets/NotoEmoji-Light-DzS.ttf' },
    });

    expect(manifest).toContain('/index.html');
    expect(manifest).toContain('/assets/index-abc12345.js');
    expect(manifest).toContain('/assets/index-abc12345.css');
    expect(manifest).toContain('/assets/NotoEmoji-Light-DzS.ttf');
  });

  it('does not precache source maps', () => {
    const { manifest } = runPlugin({
      'index.html': { fileName: 'index.html' },
      'assets/index-abc12345.js.map': { fileName: 'assets/index-abc12345.js.map' },
    });
    expect(manifest.some((entry) => entry.endsWith('.map'))).toBe(false);
  });

  it('does not precache the game artwork', () => {
    const { manifest } = runPlugin({
      'index.html': { fileName: 'index.html' },
      'assets/index-abc12345.js': { fileName: 'assets/index-abc12345.js' },
    });
    // The public artwork lives under /assets/tiles and friends and is served
    // from the runtime cache on demand.
    expect(manifest.some((entry) => entry.includes('/assets/tiles/'))).toBe(false);
  });

  it('precaches the small public shell files', () => {
    const { manifest } = runPlugin({ 'index.html': { fileName: 'index.html' } });
    expect(manifest).toContain('/favicon.png');
    expect(manifest).toContain('/icons/icon-192.png');
    expect(manifest).toContain('/manifest.webmanifest');
  });

  it('stamps the worker with a content-derived version', () => {
    const first = runPlugin({ 'index.html': { fileName: 'index.html' } });
    const second = runPlugin({ 'index.html': { fileName: 'index.html' } });
    const versionOf = (source: string) => {
      const match = /const BUILD_VERSION = "([^"]+)"/.exec(source);
      return match ? match[1] : '';
    };
    expect(versionOf(first.source)).toBeTruthy();
    // The same build must produce the same stamp, or the browser would drop
    // the cache on every reload.
    expect(versionOf(first.source)).toBe(versionOf(second.source));

    const third = runPlugin({
      'index.html': { fileName: 'index.html' },
      'assets/index-99999999.js': { fileName: 'assets/index-99999999.js' },
    });
    expect(versionOf(third.source)).not.toBe(versionOf(first.source));
  });

  it('replaces both placeholders', () => {
    const { source } = runPlugin({ 'index.html': { fileName: 'index.html' } });
    expect(source).not.toContain('__PRECACHE_MANIFEST__');
    expect(source).not.toContain('__BUILD_VERSION__');
  });
});
