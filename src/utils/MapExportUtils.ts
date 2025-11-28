import TERRAIN from '@/data/TerrainConstants';

const { SPECIAL_RESOURCES, TERRAIN_PROPERTIES } = TERRAIN;

interface TerrainProps {
  food?: number;
  production?: number;
  trade?: number;
  description?: string;
}

function findResourceByName(name: string) {
  if (!name) return null;
  const lower = name.toLowerCase();
  return SPECIAL_RESOURCES.find(r => r.name.toLowerCase() === lower) || null;
}

export function enrichMapForExport(originalMap: any) {
  if (!originalMap) return originalMap;
  const mapCopy: any = {
    width: originalMap.width,
    height: originalMap.height,
    tiles: []
  };

  for (let i = 0; i < originalMap.tiles.length; i++) {
    const t = originalMap.tiles[i] || {};
    const row = t.row ?? Math.floor(i / originalMap.width);
    const col = t.col ?? (i % originalMap.width);
    const tileType = t.type || null;

    let resourceName: string | null = null;
    let resourceDef: any = null;
    let invalidResource = false;

    if (t.resource && t.resource !== 'bonus') {
      resourceName = t.resource;
      resourceDef = findResourceByName(resourceName);
      // if resourceDef is null, try case-insensitive terrain match or treat as unknown
      if (!resourceDef) {
        const possible = SPECIAL_RESOURCES.find(r => r.name.toLowerCase() === String(t.resource).toLowerCase());
        if (possible) resourceDef = possible;
      }
      // If we have a resourceDef, ensure it's allowed on this tile type via `terrains` or `terrain` field
      if (resourceDef) {
        const allowedTerrains = resourceDef.terrains ? resourceDef.terrains.split(',').map(s => s.trim()) : [resourceDef.terrain];
        if (!allowedTerrains.includes(tileType)) {
          invalidResource = true;
        }
      }
    } else if (t.resource === 'bonus') {
      // pick a deterministic matching resource for this tile type using `terrains` CSV if present
      const matches = SPECIAL_RESOURCES.filter(r => {
        if (r.terrains) {
          const allowed = r.terrains.split(',').map(s => s.trim());
          return allowed.includes(tileType);
        }
        return r.terrain === tileType;
      });
      if (matches.length > 0) {
        const idx = (row * originalMap.width + col) % matches.length;
        resourceDef = matches[idx];
        resourceName = resourceDef.name;
        } else {
        // fallback: try any resource that can be on any terrain
        if (SPECIAL_RESOURCES.length > 0) {
          const idx = (row * originalMap.width + col) % SPECIAL_RESOURCES.length;
          resourceDef = SPECIAL_RESOURCES[idx];
          resourceName = resourceDef.name;
        }
      }
    }

    const terrainProps = (tileType ? TERRAIN_PROPERTIES[tileType] : {}) as TerrainProps;
    const baseFood = terrainProps.food || 0;
    const baseProduction = terrainProps.production || 0;
    const baseTrade = terrainProps.trade || 0;

    const resFood = resourceDef?.food || 0;
    const resProduction = resourceDef?.production || 0;
    const resTrade = resourceDef?.trade || 0;

    const computedYields = {
      food: baseFood + resFood,
      production: baseProduction + resProduction,
      trade: baseTrade + resTrade
    };

      const outTile: any = {
      col,
      row,
      type: tileType,
      improvement: t.improvement ?? null,
      visible: t.visible ?? false,
      explored: t.explored ?? false,
      hasRoad: t.hasRoad ?? false,
      hasRiver: t.hasRiver ?? false,
      resource: invalidResource ? null : resourceName,
      resourceInfo: invalidResource ? null : (resourceDef ? {
        name: resourceDef.name,
        food: resourceDef.food,
        production: resourceDef.production,
        trade: resourceDef.trade,
        description: resourceDef.description
      } : null),
      invalidResource: invalidResource,
      terrainInfo: {
        description: terrainProps.description || null,
        baseFood: baseFood,
        baseProduction: baseProduction,
        baseTrade: baseTrade
      },
      computedYields
    };

    mapCopy.tiles.push(outTile);
  }

  return mapCopy;
}

export default { enrichMapForExport };
