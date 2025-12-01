// Unit Icon Loader - Manages loading and caching of unit SVG icons

const iconCache = new Map<string, HTMLImageElement>();
const loadingPromises = new Map<string, Promise<HTMLImageElement>>();

/**
 * Load a unit icon SVG as an image
 */
export async function loadUnitIcon(unitType: string): Promise<HTMLImageElement> {
  // Check cache first
  if (iconCache.has(unitType)) {
    return iconCache.get(unitType)!;
  }

  // Check if already loading
  if (loadingPromises.has(unitType)) {
    return loadingPromises.get(unitType)!;
  }

  // Start loading
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => {
      iconCache.set(unitType, img);
      loadingPromises.delete(unitType);
      resolve(img);
    };
    
    img.onerror = () => {
      loadingPromises.delete(unitType);
      reject(new Error(`Failed to load icon for ${unitType}`));
    };
    
    // Dynamically import the SVG
    import(`../assets/units/${unitType}.svg`)
      .then(module => {
        img.src = module.default;
      })
      .catch(err => {
        console.warn(`Icon not found for ${unitType}, using fallback`);
        reject(err);
      });
  });

  loadingPromises.set(unitType, promise);
  return promise;
}

/**
 * Get a unit icon from cache (returns null if not loaded)
 */
export function getUnitIcon(unitType: string): HTMLImageElement | null {
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
