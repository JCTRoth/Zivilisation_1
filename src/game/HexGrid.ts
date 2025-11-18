import { Constants } from '../utils/Constants';

/**
 * Square Grid System for React
 * Handles coordinate conversion, pathfinding, and square math
 */

export interface SquareCoordinate {
    col: number;
    row: number;
}

export interface ScreenPosition {
    x: number;
    y: number;
}

export interface SquareDirection {
    col: number;
    row: number;
}

export class SquareGrid {
    width: number;
    height: number;
    tileSize: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.tileSize = Constants.HEX_SIZE * 2; // Use hex size as base, but make squares larger for similar visual density
    }

    // Convert square coordinates to screen position
    squareToScreen(col: number, row: number): ScreenPosition {
        const x = col * this.tileSize;
        const y = row * this.tileSize;
        return { x, y };
    }

    // Convert screen position to square coordinates
    screenToSquare(screenX: number, screenY: number): SquareCoordinate {
        const col = Math.floor(screenX / this.tileSize);
        const row = Math.floor(screenY / this.tileSize);
        return { col, row };
    }

    // Get square vertices for drawing (4 corners)
    getSquareVertices(col: number, row: number): ScreenPosition[] {
        const center = this.squareToScreen(col, row);
        const halfSize = this.tileSize / 2;

        return [
            { x: center.x - halfSize, y: center.y - halfSize }, // top-left
            { x: center.x + halfSize, y: center.y - halfSize }, // top-right
            { x: center.x + halfSize, y: center.y + halfSize }, // bottom-right
            { x: center.x - halfSize, y: center.y + halfSize }  // bottom-left
        ];
    }

    // Check if coordinates are within grid bounds
    isValidSquare(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    // Get neighboring square coordinates (4-way: up, down, left, right)
    getNeighbors(col: number, row: number): SquareCoordinate[] {
        const neighbors: SquareCoordinate[] = [];
        const directions = this.getNeighborDirections();

        for (const dir of directions) {
            const neighborCol = col + dir.col;
            const neighborRow = row + dir.row;

            if (this.isValidSquare(neighborCol, neighborRow)) {
                neighbors.push({ col: neighborCol, row: neighborRow });
            }
        }

        return neighbors;
    }

    // Get direction vectors for neighbors (4 cardinal directions)
    getNeighborDirections(): SquareDirection[] {
        return [
            { col: 0, row: -1 },  // up
            { col: 1, row: 0 },   // right
            { col: 0, row: 1 },   // down
            { col: -1, row: 0 }   // left
        ];
    }

    // Calculate Manhattan distance between two squares
    squareDistance(col1: number, row1: number, col2: number, row2: number): number {
        return Math.abs(col1 - col2) + Math.abs(row1 - row2);
    }

    // A* pathfinding algorithm for squares
    findPath(startCol: number, startRow: number, endCol: number, endRow: number, obstacles: Set<string> = new Set()): SquareCoordinate[] {
        if (!this.isValidSquare(startCol, startRow) || !this.isValidSquare(endCol, endRow)) {
            return [];
        }

        if (startCol === endCol && startRow === endRow) {
            return [{ col: startCol, row: startRow }];
        }

        const openSet = new Set<string>();
        const closedSet = new Set<string>();
        const gScore = new Map<string, number>();
        const fScore = new Map<string, number>();
        const cameFrom = new Map<string, string>();

        const startKey = `${startCol},${startRow}`;
        const endKey = `${endCol},${endRow}`;

        openSet.add(startKey);
        gScore.set(startKey, 0);
        fScore.set(startKey, this.squareDistance(startCol, startRow, endCol, endRow));

        while (openSet.size > 0) {
            // Find node with lowest fScore
            let current: string | null = null;
            let lowestF = Infinity;

            for (const node of openSet) {
                const f = fScore.get(node) || Infinity;
                if (f < lowestF) {
                    lowestF = f;
                    current = node;
                }
            }

            if (current === endKey) {
                // Reconstruct path
                const path: SquareCoordinate[] = [];
                let curr = current;

                while (curr) {
                    const [col, row] = curr.split(',').map(Number);
                    path.unshift({ col, row });
                    curr = cameFrom.get(curr);
                }

                return path;
            }

            if (!current) break;
            openSet.delete(current);
            closedSet.add(current);

            const [currentCol, currentRow] = current.split(',').map(Number);
            const neighbors = this.getNeighbors(currentCol, currentRow);

            for (const neighbor of neighbors) {
                const neighborKey = `${neighbor.col},${neighbor.row}`;

                if (closedSet.has(neighborKey) || obstacles.has(neighborKey)) {
                    continue;
                }

                const tentativeG = (gScore.get(current) || 0) + 1;

                if (!openSet.has(neighborKey)) {
                    openSet.add(neighborKey);
                }

                if (tentativeG >= (gScore.get(neighborKey) || Infinity)) {
                    continue;
                }

                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeG);
                fScore.set(neighborKey, tentativeG + this.squareDistance(neighbor.col, neighbor.row, endCol, endRow));
            }
        }

        return []; // No path found
    }

    // Get squares in a ring at specific Manhattan distance
    getSquareRing(centerCol: number, centerRow: number, radius: number): SquareCoordinate[] {
        if (radius === 0) {
            return [{ col: centerCol, row: centerRow }];
        }

        const squares: SquareCoordinate[] = [];

        for (let col = Math.max(0, centerCol - radius); col <= Math.min(this.width - 1, centerCol + radius); col++) {
            for (let row = Math.max(0, centerRow - radius); row <= Math.min(this.height - 1, centerRow + radius); row++) {
                if (this.squareDistance(centerCol, centerRow, col, row) === radius) {
                    squares.push({ col, row });
                }
            }
        }

        return squares;
    }

    // Check if a square is adjacent to another (Manhattan distance = 1)
    areAdjacent(col1: number, row1: number, col2: number, row2: number): boolean {
        return this.squareDistance(col1, row1, col2, row2) === 1;
    }

    // Get random square coordinates
    getRandomSquare(): SquareCoordinate {
        return {
            col: Math.floor(Math.random() * this.width),
            row: Math.floor(Math.random() * this.height)
        };
    }

    // Get all squares within a certain Manhattan distance of a center square
    getSquaresInRange(centerCol: number, centerRow: number, range: number): SquareCoordinate[] {
        const squares: SquareCoordinate[] = [];

        for (let col = centerCol - range; col <= centerCol + range; col++) {
            for (let row = centerRow - range; row <= centerRow + range; row++) {
                if (this.isValidSquare(col, row) &&
                    this.squareDistance(centerCol, centerRow, col, row) <= range) {
                    squares.push({ col, row });
                }
            }
        }

        return squares;
    }

    // Convert square key to coordinates
    static keyToSquare(key: string): SquareCoordinate {
        const [col, row] = key.split(',').map(Number);
        return { col, row };
    }

    // Convert square coordinates to key
    static squareToKey(col: number, row: number): string {
        return `${col},${row}`;
    }

    // Check if a screen position is inside a square
    isPointInSquare(screenX: number, screenY: number, squareCol: number, squareRow: number): boolean {
        const vertices = this.getSquareVertices(squareCol, squareRow);
        return this.isPointInPolygon(screenX, screenY, vertices);
    }

    // Check if a point is inside a polygon using ray casting algorithm
    private isPointInPolygon(x: number, y: number, vertices: ScreenPosition[]): boolean {
        let inside = false;
        const n = vertices.length;

        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = vertices[i].x, yi = vertices[i].y;
            const xj = vertices[j].x, yj = vertices[j].y;

            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }

        return inside;
    }

    // Get the square that contains the world position (precise hit detection)
    getSquareAtPosition(worldX: number, worldY: number): SquareCoordinate | null {
        // For squares, we can use the simple conversion since squares don't have complex boundaries
        const square = this.screenToSquare(worldX, worldY);

        if (this.isValidSquare(square.col, square.row)) {
            return square;
        }

        return null;
    }
}

// Utility functions for square operations
export const SquareUtils = {
    // Create square key from coordinates
    makeKey: (col: number, row: number): string => `${col},${row}`,

    // Parse key to coordinates
    parseKey: (key: string): SquareCoordinate => {
        const [col, row] = key.split(',').map(Number);
        return { col, row };
    },

    // Check if two squares are the same
    isEqual: (square1: SquareCoordinate, square2: SquareCoordinate): boolean => square1.col === square2.col && square1.row === square2.row,

    // Create a set of square keys from coordinates array
    coordsToSet: (coords: SquareCoordinate[]): Set<string> => new Set(coords.map(coord => SquareUtils.makeKey(coord.col, coord.row))),

    // Get square at offset from another square
    getSquareAt: (square: SquareCoordinate, offsetCol: number, offsetRow: number): SquareCoordinate => ({
        col: square.col + offsetCol,
        row: square.row + offsetRow
    })
};

export default SquareGrid;