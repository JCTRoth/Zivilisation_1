// Unit Icon Loader - Manages loading and caching of unit SVG and emoji icons
// Uses Noto Color Emoji font for consistent emoji rendering

import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { getUnitSvgPath, hasUnitSvgOverride } from '@/data/UnitIconConfig';

const iconCache = new Map<string, HTMLImageElement | string>(); // HTMLImageElement for SVG, string for emoji
const loadingPromises = new Map<string, Promise<HTMLImageElement | string>>();

/**
 * Load a unit icon
 * Priority: SVG override (if configured) → Emoji (from UnitConstants)
 * 
 * SVG icons are loaded from src/assets/units/ based on UnitIconConfig
 * Emoji icons use Noto Color Emoji font for consistent rendering
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
    // Check if this unit has an SVG override
    const svgPath = getUnitSvgPath(unitType);
    
    if (svgPath) {
      // Try loading SVG
      const svgImg = new Image();
      
      svgImg.onload = () => {
        iconCache.set(unitType, svgImg);
        loadingPromises.delete(unitType);
        resolve(svgImg);
      };
      
      svgImg.onerror = () => {
        // SVG failed, fall back to emoji from unit data
        const unitData = UNIT_PROPERTIES[unitType];
        const emoji = unitData?.icon || '⚔️';
        iconCache.set(unitType, emoji);
        loadingPromises.delete(unitType);
        resolve(emoji);
      };
      
      // Try loading SVG
      svgImg.src = new URL(`../assets/units/${svgPath}`, import.meta.url).href;
    } else {
      // No SVG override, use emoji from unit data
      const unitData = UNIT_PROPERTIES[unitType];
      const emoji = unitData?.icon || '⚔️';
      iconCache.set(unitType, emoji);
      loadingPromises.delete(unitType);
      resolve(emoji);
    }
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
export function clearIconCache(): void {
  iconCache.clear();
  loadingPromises.clear();
}
