// Unit Icon Loader - Manages loading and caching of unit SVG and emoji icons
// Uses Noto Color Emoji font for consistent emoji rendering

import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { getUnitSvgPath } from '@/data/UnitIconConfig';

const iconCache = new Map<string, HTMLImageElement | string>(); // HTMLImageElement for SVG, string for emoji
const loadingPromises = new Map<string, Promise<HTMLImageElement | string>>();
/**
 * Notified whenever an icon settles, so a React surface that asked before the
 * artwork had arrived can re-render with the picture instead of the emoji.
 * Without this the map (which polls `getUnitIcon` on every frame) got the
 * artwork but every list — the stack modal, the city garrison — kept showing
 * the fallback glyph forever.
 */
const iconListeners = new Set<() => void>();

function notifyIconListeners(): void {
  for (const listener of [...iconListeners]) listener();
}

/** Subscribe to icon arrivals. Returns an unsubscribe function. */
export function subscribeUnitIcons(listener: () => void): () => void {
  iconListeners.add(listener);
  return () => {
    iconListeners.delete(listener);
  };
}

/**
 * Load a unit icon
 * Priority: generated PNG sprite → SVG override (if configured) → Emoji
 *
 * A sprite produced by `tools/tile-generator` and installed with
 * `install_generated_assets.mjs` lives in `public/assets/units/unit_<key>.png`
 * and wins over the bundled SVG artwork. SVG icons are loaded from
 * src/assets/units/ based on UnitIconConfig. Emoji icons use the Noto Color
 * Emoji font for consistent rendering.
 */
async function loadUnitIcon(unitType: string): Promise<HTMLImageElement | string> {
  // Check cache first
  if (iconCache.has(unitType)) {
    return iconCache.get(unitType)!;
  }

  // Check if already loading
  if (loadingPromises.has(unitType)) {
    return loadingPromises.get(unitType)!;
  }

  // Start loading
  const promise = new Promise<HTMLImageElement | string>((resolve, _reject) => {
    // Fall through the layers and settle on the first one that loads.
    const settleOnEmoji = () => {
      const unitData = UNIT_PROPERTIES[unitType];
      const emoji = unitData?.icon || '⚔️';
      iconCache.set(unitType, emoji);
      loadingPromises.delete(unitType);
      notifyIconListeners();
      resolve(emoji);
    };

    const settleOnSvg = () => {
      const svgPath = getUnitSvgPath(unitType);
      if (!svgPath) {
        settleOnEmoji();
        return;
      }
      const svgImg = new Image();
      svgImg.onload = () => {
        iconCache.set(unitType, svgImg);
        loadingPromises.delete(unitType);
        notifyIconListeners();
        resolve(svgImg);
      };
      svgImg.onerror = settleOnEmoji;
      svgImg.src = new URL(`../assets/units/${svgPath}`, import.meta.url).href;
    };

    // A generated sprite only exists when the install script put it there, so
    // a missing file just falls through to the bundled artwork.
    const sprite = new Image();
    sprite.onload = () => {
      iconCache.set(unitType, sprite);
      loadingPromises.delete(unitType);
      notifyIconListeners();
      resolve(sprite);
    };
    sprite.onerror = settleOnSvg;
    sprite.src = `/assets/units/unit_${unitType}.png`;
  });

  loadingPromises.set(unitType, promise);
  return promise;
}

/**
 * Get a unit icon from cache (returns null if not loaded)
 */
export function getUnitIcon(unitType: string): HTMLImageElement | string | null {
  return iconCache.get(unitType) || null;
}

/**
 * Preload all unit icons
 */
export async function preloadAllUnitIcons(): Promise<void> {
  const unitTypes = [
    'warrior', 'scout', 'archer', 'phalanx', 'chariot', 'knights',
    'legion', 'catapult', 'musketeer', 'riflemen', 'cavalry', 'mech_inf', 'cannon', 'artillery', 'tank',
    'sail', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer',
    'cruiser', 'battleship', 'submarine', 'carrier', 'transport',
    'settler', 'diplomat', 'caravan', 'ferry', 'fighter', 'bomber', 'nuclear'
  ];

  await Promise.allSettled(unitTypes.map(type => loadUnitIcon(type)));
}

/**
 * Clear icon cache (useful for hot reload during development)
 */
// clearIconCache removed (unused)
