import { Constants } from '@/utils/Constants';
import { TILE_SIZE, getTerrainInfo, TERRAIN_TYPES } from '@/data/TerrainData';
import { IMPROVEMENT_PROPERTIES, IMPROVEMENT_TYPES, ImprovementDisplayConfig } from '@/data/TileImprovementConstants';
import { UNIT_TYPES } from '@/data/GameData';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import type { MapState, CameraState, Unit, City, GameState, Civilization } from '../../../types/game';

export type TerrainRenderGrid = Array<Array<TerrainTileRenderInfo | null>>;

export interface TerrainTileRenderInfo {
  type: string;
  resource?: string | null;
  improvement?: string | Record<string, unknown> | null;
  visible?: boolean;
  explored?: boolean;
  hasRoad?: boolean;
  hasRiver?: boolean;
}

export interface TerrainLayerParams {
  offscreenCanvas: HTMLCanvasElement;
  map: MapState;
  terrainGrid: TerrainRenderGrid;
}

export interface UnitPathStep {
  col: number;
  row: number;
}

export interface RenderFrameParams {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
  map: MapState;
  terrainGrid: TerrainRenderGrid | null;
  camera: CameraState;
  selectedHex: { col: number; row: number } | null;
  gameState: GameState;
  units: Unit[];
  cities: City[];
  civilizations: Civilization[];
  unitPaths: Map<string, UnitPathStep[]>;
  currentTime: number;
  offscreenCanvas?: HTMLCanvasElement | null;
  squareToScreen: (col: number, row: number) => { x: number; y: number };
  cameraZoom: number;
}

export interface RenderMinimapParams {
  ctx: CanvasRenderingContext2D;
  map: MapState;
  cssWidth: number;
  cssHeight: number;
  camera: CameraState;
  units: Unit[];
  cities: City[];
  civilizations: Civilization[];
}

interface DrawTerrainSymbolOptions {
  drawBase?: boolean;
  drawRivers?: boolean;
}

export class MapRenderer {
  private readonly tileSize: number;

  constructor(tileSize: number = TILE_SIZE) {
    this.tileSize = tileSize;
  }

  static generateFallbackTerrain(width: number, height: number): TerrainRenderGrid {
    const generated: TerrainRenderGrid = [];
    for (let row = 0; row < height; row++) {
      generated[row] = [];
      for (let col = 0; col < width; col++) {
        let terrainType: string = Constants.TERRAIN.GRASSLAND;

        if (row === 0 || row === height - 1 || col === 0 || col === width - 1) {
          terrainType = Constants.TERRAIN.OCEAN;
        } else {
          const rand = Math.random();
          if (rand < 0.05) terrainType = Constants.TERRAIN.MOUNTAINS;
          else if (rand < 0.2) terrainType = Constants.TERRAIN.HILLS;
          else if (rand < 0.3) terrainType = Constants.TERRAIN.FOREST;
          else if (rand < 0.4) terrainType = Constants.TERRAIN.DESERT;
          else if (rand < 0.5) terrainType = Constants.TERRAIN.PLAINS;
          else if (rand < 0.6) terrainType = Constants.TERRAIN.TUNDRA;
          else terrainType = Constants.TERRAIN.GRASSLAND;
        }

        generated[row][col] = {
          type: terrainType,
          resource: Math.random() < 0.1 ? 'bonus' : null,
          improvement: null,
          visible: false,
          explored: false,
          hasRoad: false,
          hasRiver: false
        };
      }
    }
    return generated;
  }

  renderTerrainLayer(params: TerrainLayerParams): void {
    const { offscreenCanvas, map, terrainGrid } = params;
    if (!offscreenCanvas || !terrainGrid) return;

    const ctx = offscreenCanvas.getContext('2d');
    if (!ctx) return;

    const mapWidth = map.width * this.tileSize;
    const mapHeight = map.height * this.tileSize;

    if (offscreenCanvas.width !== mapWidth || offscreenCanvas.height !== mapHeight) {
      offscreenCanvas.width = mapWidth;
      offscreenCanvas.height = mapHeight;
    }

    ctx.clearRect(0, 0, mapWidth, mapHeight);

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tile = terrainGrid[row]?.[col];
        if (!tile) continue;

        const x = col * this.tileSize;
        const y = row * this.tileSize;

        if (!tile.explored) {
          this.drawSquare(ctx, x, y, this.tileSize, '#000000', '#000000', true);
          continue;
        }

        const terrainInfo = this.resolveTerrain(tile.type);
        this.drawSquare(ctx, x, y, this.tileSize, terrainInfo.color, '#333', true);
        this.drawTerrainSymbol(ctx, x + this.tileSize / 2, y + this.tileSize / 2, tile, { drawBase: true, drawRivers: true });

        if (!tile.visible) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(x, y, this.tileSize, this.tileSize);
        }
      }
    }
  }

  renderFrame(params: RenderFrameParams): void {
    const {
      ctx,
      canvas,
      map,
      terrainGrid,
      camera,
      selectedHex,
      gameState,
      units,
      cities,
      civilizations,
      unitPaths,
      currentTime,
      offscreenCanvas,
      squareToScreen,
      cameraZoom
    } = params;

    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!terrainGrid) {
      return;
    }

    const hasOffscreen = Boolean(offscreenCanvas);

    const startCol = Math.max(0, Math.floor(camera.x / this.tileSize) - 2);
    const endCol = Math.min(map.width, Math.ceil((camera.x + canvas.width / camera.zoom) / this.tileSize) + 2);
    const startRow = Math.max(0, Math.floor(camera.y / this.tileSize) - 2);
    const endRow = Math.min(map.height, Math.ceil((camera.y + canvas.height / camera.zoom) / this.tileSize) + 2);

    if (hasOffscreen && offscreenCanvas) {
      const srcX = camera.x;
      const srcY = camera.y;
      const srcWidth = canvas.width / camera.zoom;
      const srcHeight = canvas.height / camera.zoom;
      ctx.drawImage(offscreenCanvas, srcX, srcY, srcWidth, srcHeight, 0, 0, canvas.width, canvas.height);
    } else {
      for (let row = startRow; row < endRow; row++) {
        for (let col = startCol; col < endCol; col++) {
          const { x, y } = squareToScreen(col, row);
          if (x < -this.tileSize * 2 || x > canvas.width + this.tileSize * 2 || y < -this.tileSize * 2 || y > canvas.height + this.tileSize * 2) {
            continue;
          }

          const tile = terrainGrid[row]?.[col];
          if (!tile) continue;

          if (!tile.explored) {
            this.drawSquare(ctx, x, y, this.tileSize * camera.zoom, '#000000', '#000000');
            continue;
          }

          const terrainInfo = this.resolveTerrain(tile.type);
          const isSelected = selectedHex?.col === col && selectedHex?.row === row;
          this.drawSquare(ctx, x, y, this.tileSize * camera.zoom, terrainInfo.color, isSelected ? '#FF0000' : '#333');

          if (camera.zoom > 0.5) {
            this.drawTerrainSymbol(ctx, x, y, tile, { drawBase: true, drawRivers: true });
          }

          if (!tile.visible) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            const half = (this.tileSize * camera.zoom) / 2;
            ctx.fillRect(x - half, y - half, this.tileSize * camera.zoom, this.tileSize * camera.zoom);
          }
        }
      }
    }

    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const { x, y } = squareToScreen(col, row);
        if (x < -this.tileSize * 2 || x > canvas.width + this.tileSize * 2 || y < -this.tileSize * 2 || y > canvas.height + this.tileSize * 2) {
          continue;
        }

        const tile = terrainGrid[row]?.[col];
        if (!tile || !tile.explored) continue;

        if (hasOffscreen) {
          const tileIndex = row * map.width + col;
          const authoritativeTile: any = map.tiles?.[tileIndex];
          const overlayTile: TerrainTileRenderInfo = {
            ...tile,
            improvement: authoritativeTile?.improvement ?? tile.improvement,
            hasRoad: authoritativeTile?.hasRoad ?? tile.hasRoad ?? false,
            hasRiver: authoritativeTile?.hasRiver ?? tile.hasRiver ?? false
          };
          if (camera.zoom > 0.5) {
            this.drawTerrainSymbol(ctx, x, y, overlayTile, { drawBase: false, drawRivers: false });
          }
        }

        const tileIndex = row * map.width + col;
        const isVisible = map.visibility?.[tileIndex] ?? tile.visible ?? false;

        if (isVisible) {
          const city = cities.find(c => c.col === col && c.row === row);
          if (city) {
            this.drawCity(ctx, x, y, city, cameraZoom, civilizations);
          }

          const unit = units.find(u => u.col === col && u.row === row);
          if (unit) {
            const isActivePlayersUnit = unit.civilizationId === gameState.activePlayer;
            const hasMoves = (unit.movesRemaining || 0) > 0;
            let alpha = 1;
            if (isActivePlayersUnit && hasMoves) {
              const period = 2000;
              const t = (currentTime % period) / period;
              const sine = Math.sin(t * Math.PI * 2);
              alpha = 0.675 + 0.325 * (sine + 1) / 2;
            }
            this.drawUnit(ctx, x, y, unit, alpha, cameraZoom, civilizations);
          }
        }

        const selectedUnitId = gameState.selectedUnit;
        const unitAtTile = units.find(u => u.col === col && u.row === row);
        if (selectedUnitId && unitAtTile && unitAtTile.id === selectedUnitId) {
          ctx.strokeStyle = '#FF0000';
          ctx.lineWidth = 3;
          const half = (this.tileSize * camera.zoom) / 2;
          ctx.strokeRect(x - half, y - half, this.tileSize * camera.zoom, this.tileSize * camera.zoom);
        }

        if (camera.zoom > 1.5) {
          ctx.fillStyle = '#000';
          ctx.font = '8px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`${col},${row}`, x, y + this.tileSize);
        }
      }
    }

    unitPaths.forEach((path, unitId) => {
      this.drawUnitPath(ctx, unitId, path, units, gameState, squareToScreen);
    });
  }

  renderMinimap(params: RenderMinimapParams): void {
    const { ctx, map, cssWidth, cssHeight, camera, units, cities, civilizations } = params;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const tileWidth = cssWidth / map.width;
    const tileHeight = cssHeight / map.height;

    const hasRevealed = Array.isArray(map.revealed) && map.revealed.length === map.tiles.length;
    const hasVisibility = Array.isArray(map.visibility) && map.visibility.length === map.tiles.length;
    const anyRevealed = hasRevealed ? map.revealed.some(Boolean) : false;

    for (let row = 0; row < map.height; row++) {
      for (let col = 0; col < map.width; col++) {
        const tileIndex = row * map.width + col;
        const tile: any = map.tiles?.[tileIndex];
        if (!tile) continue;

        const terrainProps = this.resolveTerrain(tile.type);
        ctx.fillStyle = terrainProps.color;
        ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);

        if (hasRevealed && anyRevealed) {
          const explored = map.revealed?.[tileIndex] ?? true;
          const visible = map.visibility?.[tileIndex] ?? true;
          if (!explored) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);
          } else if (!visible) {
            ctx.fillStyle = 'rgba(9, 13, 20, 0.25)';
            ctx.fillRect(col * tileWidth, row * tileHeight, tileWidth + 1, tileHeight + 1);
          }
        }
      }
    }

    for (const city of cities) {
      const tileIndex = city.row * map.width + city.col;
      const isVisible = map.visibility ? map.visibility[tileIndex] : false;
      if (!isVisible) continue;

      const x = city.col * tileWidth;
      const y = city.row * tileHeight;
      ctx.fillStyle = city.civilizationId === 0 ? '#FFD700' : '#FF6347';
      ctx.fillRect(x, y, tileWidth * 2, tileHeight * 2);
    }

    for (const unit of units) {
      const tileIndex = unit.row * map.width + unit.col;
      const isVisible = map.visibility ? map.visibility[tileIndex] : false;
      const unitTypeKey = unit.type ? String(unit.type).toUpperCase() : '';
      const unitType = UNIT_TYPES[unitTypeKey];
      const hasSight = unitType?.sightRange > 0;
      if (!isVisible && !hasSight) continue;

      const x = unit.col * tileWidth;
      const y = unit.row * tileHeight;
      const civ = civilizations.find(c => c.id === unit.civilizationId);
      ctx.fillStyle = civ?.color || '#FF0000';
      ctx.fillRect(x, y, Math.max(1, tileWidth / 2), Math.max(1, tileHeight / 2));
    }

    const tileSize = Constants.HEX_SIZE || 32;
    const cssPerTileX = cssWidth / map.width;
    const cssPerTileY = cssHeight / map.height;
    const cameraTileX = camera.x / tileSize;
    const cameraTileY = camera.y / tileSize;
    const viewportTilesW = (window.innerWidth / camera.zoom) / tileSize;
    const viewportTilesH = (window.innerHeight / camera.zoom) / tileSize;
    const viewportX = cameraTileX * cssPerTileX;
    const viewportY = cameraTileY * cssPerTileY;
    const viewportW = viewportTilesW * cssPerTileX;
    const viewportH = viewportTilesH * cssPerTileY;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.max(0, viewportX),
      Math.max(0, viewportY),
      Math.min(cssWidth - viewportX, viewportW),
      Math.min(cssHeight - viewportY, viewportH)
    );
  }

  private drawSquare(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    size: number,
    fillColor: string,
    strokeColor: string,
    isWorldCoordinates: boolean = false
  ): void {
    const half = size / 2;
    const x = isWorldCoordinates ? centerX : centerX - half;
    const y = isWorldCoordinates ? centerY : centerY - half;
    const width = size;
    const height = size;

    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawTerrainSymbol(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    terrain: TerrainTileRenderInfo,
    options: DrawTerrainSymbolOptions
  ): void {
    const { drawBase = true, drawRivers = true } = options;
    const terrainInfo = getTerrainInfo(terrain.type);
    if (!terrainInfo) return;
    if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return;
    const char = terrainInfo.char ?? '';

    if (drawBase && typeof char === 'string' && char.length > 0) {
      ctx.fillStyle = '#000';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      try {
        ctx.fillText(char, centerX, centerY - 8);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol fillText failed', err);
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (drawRivers && terrain.hasRiver) {
      try {
        ctx.font = '16px monospace';
        ctx.fillStyle = '#0066FF';
        ctx.fillText('~', centerX + 8, centerY + 8);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol river fillText failed', err);
      }
    }

    const drawDisplayGlyph = (display?: ImprovementDisplayConfig | null): boolean => {
      if (!display || !display.glyph) return false;
      try {
        ctx.font = display.font ?? 'bold 14px monospace';
        ctx.fillStyle = display.color ?? '#8B4513';
        const dx = display.offsetX ?? 0;
        const dy = display.offsetY ?? 12;
        ctx.fillText(display.glyph, centerX + dx, centerY + dy);
        return true;
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol improvement glyph failed', err);
        return false;
      }
    };

    const drawLabelForImprovement = (key: string, display?: ImprovementDisplayConfig | null) => {
      if (display?.skipLabel) return;
      const impDef = IMPROVEMENT_PROPERTIES[key];
      const baseLabel = display?.label || impDef?.name?.[0] || key[0]?.toUpperCase();
      if (!baseLabel) return;
      try {
        ctx.font = display?.font ?? 'bold 12px monospace';
        ctx.fillStyle = display?.color ?? '#ff0000ff';
        const dx = display?.offsetX ?? 10;
        const dy = display?.offsetY ?? -10;
        ctx.fillText(baseLabel, centerX + dx, centerY + dy);
      } catch (err) {
        console.warn('[MapRenderer] drawTerrainSymbol improvement label failed', err);
      }
    };

    const roadDisplay = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.ROAD]?.display;
    const railroadDisplay = IMPROVEMENT_PROPERTIES[IMPROVEMENT_TYPES.RAILROAD]?.display;
    let roadDrawn = false;

    if (terrain.hasRoad && roadDisplay) {
      roadDrawn = drawDisplayGlyph(roadDisplay);
    }

    const improvementKey = terrain.improvement ? String(terrain.improvement) : null;
    if (improvementKey) {
      const improvementDef = IMPROVEMENT_PROPERTIES[improvementKey];
      const display = improvementDef?.display;

      if (improvementKey === IMPROVEMENT_TYPES.ROAD) {
        if (!roadDrawn) {
          roadDrawn = drawDisplayGlyph(display || roadDisplay);
        }
      } else if (improvementKey === IMPROVEMENT_TYPES.RAILROAD) {
        drawDisplayGlyph(display || railroadDisplay);
      } else {
        const glyphDrawn = drawDisplayGlyph(display);
        if (!glyphDrawn) {
          drawLabelForImprovement(improvementKey, display);
        } else if (!display?.skipLabel) {
          drawLabelForImprovement(improvementKey, display);
        }
      }
    }
  }

  private drawCity(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    city: City,
    cameraZoom: number,
    civilizations: Civilization[]
  ): void {
    const civ = civilizations.find(c => c.id === city.civilizationId);
    const civColor = civ?.color || (city.civilizationId === 0 ? '#FFD700' : '#FF6347');
    ctx.fillStyle = civColor;
    const size = 42 * cameraZoom;
    ctx.fillRect(centerX - size / 2, centerY - size / 2, size, size);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.strokeRect(centerX - size / 2, centerY - size / 2, size, size);

    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.max(12, 24 * cameraZoom)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏛️', centerX, centerY);

    ctx.font = `${Math.max(8, 10 * cameraZoom)}px monospace`;
    ctx.fillStyle = '#000';
    ctx.fillText(city.name, centerX, centerY + 24 * cameraZoom);
  }

  private drawUnit(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    unit: Unit,
    alpha: number,
    cameraZoom: number,
    civilizations: Civilization[]
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;

    const zoomFactor = typeof cameraZoom === 'number' ? Math.min(Math.max(cameraZoom, 0.5), 1.5) : 1;
    const radius = Math.round(20 * zoomFactor);

    const civIndex = unit.civilizationId ?? (unit as any).owner;
    const civ = civilizations.find(c => c.id === civIndex);
    const civColor = civ?.color || (civIndex === 0 ? '#4169E1' : '#DC143C');

    const innerRadius = Math.max(8, Math.round(radius * 0.95));
    ctx.beginPath();
    ctx.fillStyle = civColor;
    ctx.arc(centerX, centerY, innerRadius, 0, 2 * Math.PI);
    ctx.fill();

    const iconColor = this.isLightColor(civColor) ? '#111' : '#FFF';
    ctx.fillStyle = iconColor;

    const unitTypeId = unit.type ? String(unit.type) : null;
    let gameTypeDef: any = null;
    if (unitTypeId && UNIT_TYPES && typeof UNIT_TYPES === 'object') {
      try {
        gameTypeDef = Object.values(UNIT_TYPES).find((t: any) => t && String(t.id).toLowerCase() === String(unitTypeId).toLowerCase()) || null;
      } catch (e) {
        gameTypeDef = null;
      }
    }
    const typeDef = unitTypeId ? (UNIT_PROPERTIES[String(unitTypeId).toLowerCase()] || null) : null;
    const icon = unit.icon || gameTypeDef?.icon || typeDef?.icon || (typeDef?.name ? typeDef.name[0] : (unit.type ? String(unit.type)[0].toUpperCase() : 'U')) || '⚔️';
    const fontSize = Math.max(10, Math.round(innerRadius * 1.1));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try {
      ctx.fillText(icon, centerX, centerY);
    } catch (err) {
      const fallback = (unit.type && unit.type[0]?.toUpperCase()) || 'U';
      ctx.fillText(fallback, centerX, centerY);
    }

    if ((unit as any).isSleeping) {
      const sleepIcon = '💤';
      const sleepFontSize = Math.max(8, Math.round(innerRadius * 0.7));
      ctx.font = `${sleepFontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = iconColor;
      ctx.fillText(sleepIcon, centerX, centerY + 22);
    }

    ctx.restore();
  }

  private drawUnitPath(
    ctx: CanvasRenderingContext2D,
    unitId: string,
    path: UnitPathStep[] | undefined,
    units: Unit[],
    gameState: GameState,
    squareToScreen: (col: number, row: number) => { x: number; y: number }
  ): void {
    if (!path || path.length < 2) return;
    const unit = units.find(u => u.id === unitId);
    if (!unit) return;
    if (gameState.selectedUnit !== unitId) return;

    ctx.save();
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    path.forEach((pos, index) => {
      const { x, y } = squareToScreen(pos.col, pos.row);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    if (path.length >= 2) {
      const last = path[path.length - 1];
      const secondLast = path[path.length - 2];
      const { x: x1, y: y1 } = squareToScreen(secondLast.col, secondLast.row);
      const { x: x2, y: y2 } = squareToScreen(last.col, last.row);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const arrowLen = 10;
        const arrowAngle = Math.PI / 6;
        const angle = Math.atan2(dy, dx);
        const leftAngle = angle - arrowAngle;
        const rightAngle = angle + arrowAngle;
        const leftX = x2 - arrowLen * Math.cos(leftAngle);
        const leftY = y2 - arrowLen * Math.sin(leftAngle);
        const rightX = x2 - arrowLen * Math.cos(rightAngle);
        const rightY = y2 - arrowLen * Math.sin(rightAngle);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(leftX, leftY);
        ctx.moveTo(x2, y2);
        ctx.lineTo(rightX, rightY);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private resolveTerrain(type: string): { color: string } {
    const upper = type?.toUpperCase();
    return TERRAIN_TYPES[type] || TERRAIN_TYPES[upper] || TERRAIN_TYPES.GRASSLAND;
  }

  private isLightColor(hexColor: string): boolean {
    if (!hexColor) return false;
    const normalized = hexColor.replace('#', '');
    const bigint = parseInt(normalized.length === 3 ? normalized.split('').map(c => c + c).join('') : normalized, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6;
  }
}
