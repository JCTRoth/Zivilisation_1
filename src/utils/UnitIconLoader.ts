// Unit Icon Loader - Manages loading and caching of unit PNG and SVG icons

import { UNIT_PROPERTIES } from '@/data/UnitConstants';

const iconCache = new Map<string, HTMLImageElement | string>(); // HTMLImageElement for images, string for emoji
const loadingPromises = new Map<string, Promise<HTMLImageElement | string>>();

/**
 * Load a unit icon - tries PNG first, then SVG, falls back to emoji from unit data
 */
export async function loadUnitIcon(unitType: string): Promise<HTMLImageElement | string> {
  // Check cache first
  if (iconCache.has(unitType)) {
    return iconCache.get(unitType)!;
  }

  // Check if already loading
  if (loadingPromises.has(unitType)) {
    return loadingPromises.get(unitType)!;
  }

  // Start loading
  const promise = new Promise<HTMLImageElement | string>((resolve, reject) => {
    // Try PNG first
    const pngImg = new Image();
    
    pngImg.onload = () => {
      iconCache.set(unitType, pngImg);
      loadingPromises.delete(unitType);
      resolve(pngImg);
    };
    
    pngImg.onerror = () => {
      // PNG failed, try SVG
      const svgImg = new Image();
      
      svgImg.onload = () => {
        iconCache.set(unitType, svgImg);
        loadingPromises.delete(unitType);
        resolve(svgImg);
      };
      
      svgImg.onerror = () => {
        // SVG also failed, fall back to emoji from unit data
        const unitData = UNIT_PROPERTIES[unitType];
        const emoji = unitData?.icon || '⚔️';
        iconCache.set(unitType, emoji);
        loadingPromises.delete(unitType);
        resolve(emoji);
      };
      
      // Try loading SVG
      import(`../assets/units/${unitType}.svg`)
        .then(module => {
          svgImg.src = module.default;
        })
        .catch(() => {
          // SVG import failed, trigger onerror
          svgImg.onerror?.(new Event('error'));
        });
    };
    
    // Try loading PNG first
    pngImg.src = `/src/assets/units/${unitType}.png`;
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
    'warrior', 'scout', 'militia', 'archer', 'phalanx', 'chariot',
    'legion', 'catapult', 'musketeer', 'cavalry', 'cannon', 'artillery', 'tank',
    'galley', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer',
    'cruiser', 'battleship', 'submarine',
    'settler', 'worker', 'diplomat', 'caravan', 'ferry'
  ];

  await Promise.allSettled(unitTypes.map(type => loadUnitIcon(type)));
}

/**
 * Clear icon cache (useful for hot reload during development)
 */
export function clearIconCache(): void {
  iconCache.clear();
  loadingPromises.clear();
}
