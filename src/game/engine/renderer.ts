import { Constants } from '@/utils/Constants';
import type { SquareGrid } from '../HexGrid.js';
import type { GameMap } from '../Map.js';
import type { Unit } from '../Unit.js';
import type { City } from '../City.js';
import {MathUtils} from "@/utils/MathUtils";

interface Camera {
    x: number;
    y: number;
    zoom: number;
}

interface SelectedHex {
    col: number;
    row: number;
}

interface HighlightedHex {
    col: number;
    row: number;
}

interface VisibleArea {
    startCol: number;
    endCol: number;
    startRow: number;
    endRow: number;
}

interface WorldPosition {
    x: number;
    y: number;
}

interface ScreenPosition {
    x: number;
    y: number;
}

interface Vertex {
    x: number;
    y: number;
}

class Renderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private miniMapCanvas: HTMLCanvasElement;
    private miniMapCtx: CanvasRenderingContext2D;
    private camera: Camera;
    private grid: SquareGrid | null;
    private selectedHex: SelectedHex | null;
    private highlightedHexes: HighlightedHex[];

    constructor(canvas: HTMLCanvasElement, miniMapCanvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.miniMapCanvas = miniMapCanvas;
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.grid = null;
        this.selectedHex = null;
        this.highlightedHexes = [];

        this.setupCanvas();
    }

    private setupCanvas(): void {
        const ctx = this.canvas.getContext('2d');
        const miniCtx = this.miniMapCanvas.getContext('2d');

        if (!ctx || !miniCtx) {
            throw new Error('Failed to get canvas contexts');
        }

        this.ctx = ctx;
        this.miniMapCtx = miniCtx;

        // Set canvas size
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;
        this.miniMapCanvas.width = this.miniMapCanvas.clientWidth;
        this.miniMapCanvas.height = this.miniMapCanvas.clientHeight;

        // Enable image smoothing for better graphics
        this.ctx.imageSmoothingEnabled = true;
        this.miniMapCtx.imageSmoothingEnabled = false; // Pixelated for mini-map
    }

    setGrid(grid: SquareGrid): void {
        this.grid = grid;
    }

    render(gameMap: GameMap, units: Unit[], cities: City[]): void {
        if (!this.grid) return;

        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Calculate visible area
        const visibleArea = this.calculateVisibleArea();

        // Render in order: terrain, grid, cities, units, selection, highlights
        this.renderTerrain(gameMap, visibleArea);
        this.renderGridLines(visibleArea);
        this.renderCities(cities, visibleArea);
        this.renderUnits(units, visibleArea);
        this.renderSelection();
        this.renderHighlights();

        // Render mini-map
        this.renderMiniMap(gameMap, units, cities);
    }

    private calculateVisibleArea(): VisibleArea {
        if (!this.grid) {
            return { startCol: 0, endCol: 0, startRow: 0, endRow: 0 };
        }

        const margin = 2; // Extra hexes to render outside viewport

        // Convert screen corners to world coordinates
        const topLeft = this.screenToWorld({ x: 0, y: 0 });
        const bottomRight = this.screenToWorld({ x: this.canvas.width, y: this.canvas.height });

        // Convert world coordinates to hex coordinates
        const topLeftHex = this.grid.screenToSquare(topLeft.x, topLeft.y);
        const bottomRightHex = this.grid.screenToSquare(bottomRight.x, bottomRight.y);

        return {
            startCol: Math.max(0, Math.floor(topLeftHex.col) - margin),
            endCol: Math.min(this.grid.width - 1, Math.ceil(bottomRightHex.col) + margin),
            startRow: Math.max(0, Math.floor(topLeftHex.row) - margin),
            endRow: Math.min(this.grid.height - 1, Math.ceil(bottomRightHex.row) + margin)
        };
    }

    private renderTerrain(gameMap: GameMap, visibleArea: VisibleArea): void {
        for (let row = visibleArea.startRow; row <= visibleArea.endRow; row++) {
            for (let col = visibleArea.startCol; col <= visibleArea.endCol; col++) {
                if (!this.grid!.isValidSquare(col, row)) continue;

                const tile = gameMap.getTile(col, row);
                if (!tile) continue;

                this.drawHex(col, row, tile.terrain);
            }
        }
    }

    private renderGridLines(visibleArea: VisibleArea): void {
        this.ctx.strokeStyle = 'rgba(100, 100, 100, 0.3)';
        this.ctx.lineWidth = 1;

        for (let row = visibleArea.startRow; row <= visibleArea.endRow; row++) {
            for (let col = visibleArea.startCol; col <= visibleArea.endCol; col++) {
                if (!this.grid!.isValidSquare(col, row)) continue;

                this.drawHexOutline(col, row);
            }
        }
    }

    private renderCities(cities: City[], visibleArea: VisibleArea): void {
        if (!cities) return;

        cities.forEach(city => {
            if (this.isHexVisible(city.col, city.row, visibleArea)) {
                this.drawCity(city);
            }
        });
    }

    private renderUnits(units: Unit[], visibleArea: VisibleArea): void {
        if (!units) return;

        units.forEach(unit => {
            if (this.isHexVisible(unit.col, unit.row, visibleArea)) {
                this.drawUnit(unit);
            }
        });
    }

    private renderSelection(): void {
        if (this.selectedHex) {
            this.ctx.strokeStyle = Constants.COLORS.SELECTED;
            this.ctx.lineWidth = 3;
            this.drawHexOutline(this.selectedHex.col, this.selectedHex.row);
        }
    }

    private renderHighlights(): void {
        if (this.highlightedHexes.length > 0) {
            this.ctx.fillStyle = 'rgba(255, 255, 128, 0.3)';

            this.highlightedHexes.forEach(hex => {
                this.drawHexOutline(hex.col, hex.row);
            });
        }
    }

    private drawHex(col: number, row: number, terrainType: string): void {
        const terrainProps = Constants.TERRAIN_PROPS[terrainType];
        if (!terrainProps) return;

        this.ctx.fillStyle = terrainProps.color;
        this.drawHexOutline(col, row);

        // Add texture or pattern based on terrain type
        this.addTerrainTexture(col, row, terrainType);
    }

    /**
     * Draw the outline of a hex at the given column and row.
     * @param col
     * @param row
     * @private
     */
    private drawHexOutline(col: number, row: number): void {
        const vertices = this.getTransformedVertices(col, row);

        this.ctx.beginPath();
        this.ctx.moveTo(vertices[0].x, vertices[0].y);

        for (let i = 1; i < vertices.length; i++) {
            this.ctx.lineTo(vertices[i].x, vertices[i].y);
        }

        this.ctx.closePath();
        this.ctx.stroke();
    }

    /**
     * Get the transformed vertices of a hex at the given column and row.
     * @param col
     * @param row
     * @private
     */
    private getTransformedVertices(col: number, row: number): Vertex[] {
        const vertices = this.grid!.getSquareVertices(col, row);
        return vertices.map(vertex => ({
            x: (vertex.x + this.camera.x) * this.camera.zoom,
            y: (vertex.y + this.camera.y) * this.camera.zoom
        }));
    }

    /**
     * Add texture or pattern to a terrain type at the given column and row.
     * @param col
     * @param row
     * @param terrainType
     * @private
     */
    private addTerrainTexture(col: number, row: number, terrainType: string): void {
        const center = this.worldToScreen(this.grid!.squareToScreen(col, row));
        const size = this.grid!.tileSize * this.camera.zoom * 0.5;

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';

        switch (terrainType) {
            case Constants.TERRAIN.FOREST:
                // Draw simple trees
                for (let i = 0; i < 3; i++) {
                    const angle = (i / 3) * Math.PI * 2;
                    const x = center.x + Math.cos(angle) * size * 0.3;
                    const y = center.y + Math.sin(angle) * size * 0.3;

                    this.ctx.beginPath();
                    this.ctx.arc(x, y, size * 0.2, 0, Math.PI * 2);
                    this.ctx.fill();
                }
                break;

            case Constants.TERRAIN.HILLS:
                // Draw hill bumps
                this.ctx.beginPath();
                this.ctx.arc(center.x - size * 0.2, center.y, size * 0.3, 0, Math.PI, true);
                this.ctx.arc(center.x + size * 0.2, center.y, size * 0.3, 0, Math.PI, true);
                this.ctx.fill();
                break;

            case Constants.TERRAIN.MOUNTAINS:
                // Draw mountain peaks
                this.ctx.beginPath();
                this.ctx.moveTo(center.x - size * 0.3, center.y + size * 0.2);
                this.ctx.lineTo(center.x, center.y - size * 0.3);
                this.ctx.lineTo(center.x + size * 0.3, center.y + size * 0.2);
                this.ctx.fill();
                break;
        }
    }

    private drawUnit(unit: Unit): void {
        const center = this.worldToScreen(this.grid!.squareToScreen(unit.col, unit.row));
        const size = this.grid!.tileSize * this.camera.zoom * 0.6;

        // Unit background
        this.ctx.fillStyle = unit.civilization.color;
        this.ctx.beginPath();
        this.ctx.arc(center.x, center.y, size, 0, Math.PI * 2);
        this.ctx.fill();

        // Unit border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;
        this.ctx.stroke();

        // Unit type indicator (simple shape for now)
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `${size * 0.8}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';

        const unitChar = this.getUnitCharacter(unit.type);
        this.ctx.fillText(unitChar, center.x, center.y);

    }

    private getUnitCharacter(unitType: string): string {
        const chars: Record<string, string> = {
            [Constants.UNIT_TYPES.SETTLER]: 'S',
            [Constants.UNIT_TYPES.MILITIA]: 'M',
            [Constants.UNIT_TYPES.PHALANX]: 'P',
            [Constants.UNIT_TYPES.LEGION]: 'L',
            [Constants.UNIT_TYPES.CATAPULT]: 'C',
            [Constants.UNIT_TYPES.TRIREME]: 'T',
            [Constants.UNIT_TYPES.CAVALRY]: 'H',
            [Constants.UNIT_TYPES.CHARIOT]: 'R'
        };
        return chars[unitType] || '?';
    }

    private drawCity(city: City): void {
        const center = this.worldToScreen(this.grid!.squareToScreen(city.col, city.row));
        const size = this.grid!.tileSize * this.camera.zoom * 0.8;

        // City background
        this.ctx.fillStyle = city.civilization.color;
        this.ctx.fillRect(center.x - size, center.y - size, size * 2, size * 2);

        // City border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(center.x - size, center.y - size, size * 2, size * 2);

        // City name
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `${size * 0.3}px Arial`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(city.name, center.x, center.y + size + 15);

        // Population indicator
        this.ctx.fillText(`Pop: ${city.population}`, center.x, center.y);
    }

    private drawHealthBar(x: number, y: number, width: number, healthPercent: number): void {
        const height = 4;

        // Background
        this.ctx.fillStyle = '#444';
        this.ctx.fillRect(x - width/2, y, width, height);

        // Health
        this.ctx.fillStyle = healthPercent > 0.5 ? '#0f0' :
                           healthPercent > 0.25 ? '#ff0' : '#f00';
        this.ctx.fillRect(x - width/2, y, width * healthPercent, height);

        // Border
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(x - width/2, y, width, height);
    }

    private isHexVisible(col: number, row: number, visibleArea: VisibleArea): boolean {
        return col >= visibleArea.startCol && col <= visibleArea.endCol &&
               row >= visibleArea.startRow && row <= visibleArea.endRow;
    }

    private worldToScreen(worldPos: WorldPosition): ScreenPosition {
        return {
            x: (worldPos.x + this.camera.x) * this.camera.zoom,
            y: (worldPos.y + this.camera.y) * this.camera.zoom
        };
    }

    private screenToWorld(screenPos: ScreenPosition): WorldPosition {
        return {
            x: screenPos.x / this.camera.zoom - this.camera.x,
            y: screenPos.y / this.camera.zoom - this.camera.y
        };
    }

    setCamera(x: number, y: number, zoom: number): void {
        this.camera.x = x;
        this.camera.y = y;
        this.camera.zoom = MathUtils.clamp(zoom, 0.5, 3.0);
    }

    moveCamera(deltaX: number, deltaY: number): void {
        this.camera.x += deltaX;
        this.camera.y += deltaY;
    }

    zoomCamera(delta: number, centerX: number, centerY: number): void {
        const oldZoom = this.camera.zoom;
        const newZoom = MathUtils.clamp(oldZoom + delta, 0.5, 3.0);

        if (newZoom !== oldZoom) {
            // Zoom towards the center point
            const worldCenter = this.screenToWorld({ x: centerX, y: centerY });
            this.camera.zoom = newZoom;
            const newWorldCenter = this.screenToWorld({ x: centerX, y: centerY });

            this.camera.x += newWorldCenter.x - worldCenter.x;
            this.camera.y += newWorldCenter.y - worldCenter.y;
        }
    }

    setSelectedHex(col: number | null, row: number | null): void {
        this.selectedHex = (col !== null && row !== null) ? { col, row } : null;
    }

    setHighlightedHexes(hexes: HighlightedHex[]): void {
        this.highlightedHexes = hexes || [];
    }

    private renderMiniMap(gameMap: GameMap, units: Unit[], cities: City[]): void {
        const miniCtx = this.miniMapCtx;
        const miniWidth = this.miniMapCanvas.width;
        const miniHeight = this.miniMapCanvas.height;

        // Clear mini-map
        miniCtx.clearRect(0, 0, miniWidth, miniHeight);
        miniCtx.fillStyle = '#1a1a1a';
        miniCtx.fillRect(0, 0, miniWidth, miniHeight);

        if (!gameMap) return;

        // Scale factors
        const scaleX = miniWidth / this.grid!.width;
        const scaleY = miniHeight / this.grid!.height;

        // Draw terrain
        for (let row = 0; row < this.grid!.height; row++) {
            for (let col = 0; col < this.grid!.width; col++) {
                const tile = gameMap.getTile(col, row);
                if (!tile) continue;

                const terrainProps = Constants.TERRAIN_PROPS[tile.terrain];
                miniCtx.fillStyle = terrainProps.color;
                miniCtx.fillRect(col * scaleX, row * scaleY, scaleX, scaleY);
            }
        }

        // Draw cities
        if (cities) {
            miniCtx.fillStyle = '#fff';
            cities.forEach(city => {
                miniCtx.fillRect(
                    city.col * scaleX - 1,
                    city.row * scaleY - 1,
                    3, 3
                );
            });
        }

        // Draw viewport indicator
        miniCtx.strokeStyle = '#ff0';
        miniCtx.lineWidth = 1;

    // Camera.x/y represent the world coordinate at the left/top of the screen
    // Convert those world pixel coordinates to minimap CSS pixels by
    // converting to tile indices (divide by tileSize) then multiply by scale.
    const viewX = (this.camera.x / this.grid!.tileSize) * scaleX;
    const viewY = (this.camera.y / this.grid!.tileSize) * scaleY;
        const viewW = (this.canvas.width / (this.grid!.tileSize * this.camera.zoom)) * scaleX;
        const viewH = (this.canvas.height / (this.grid!.tileSize * this.camera.zoom)) * scaleY;

        miniCtx.strokeRect(viewX, viewY, viewW, viewH);
    }
}

export default Renderer