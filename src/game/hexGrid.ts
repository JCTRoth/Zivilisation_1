import { CONSTANTS } from '../utils/constants';

/**
 * Hexagonal Grid System for React
 * Handles coordinate conversion, pathfinding, and hex math
 */

export interface HexCoordinate {
    col: number;
    row: number;
}

export interface ScreenPosition {
    x: number;
    y: number;
}

export interface HexDirection {
    col: number;
    row: number;
}

export class HexGrid {
    width: number;
    height: number;
    hexSize: number;
    hexWidth: number;
    hexHeight: number;
    vertDistance: number;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.hexSize = CONSTANTS.HEX_SIZE;
        this.hexWidth = this.hexSize * Math.sqrt(3);
        this.hexHeight = this.hexSize * 2;
        this.vertDistance = this.hexHeight * 0.75;
    }

    // Convert hex coordinates to screen position
    hexToScreen(col: number, row: number): ScreenPosition {
        const x = this.hexWidth * (col + 0.5 * (row & 1));
        const y = this.vertDistance * row;
        return { x, y };
    }

    // Convert screen position to hex coordinates
    screenToHex(screenX: number, screenY: number): HexCoordinate {
        // Adjust for hex grid offset
        const x = screenX / this.hexWidth;
        const y = screenY / this.vertDistance;

        // Convert to cube coordinates
        const q = x - 0.5 * (y & 1);
        const r = y;
        const s = -q - r;

        // Round to nearest integer coordinates
        let rq = Math.round(q);
        let rr = Math.round(r);
        let rs = Math.round(s);

        const qDiff = Math.abs(rq - q);
        const rDiff = Math.abs(rr - r);
        const sDiff = Math.abs(rs - s);

        if (qDiff > rDiff && qDiff > sDiff) {
            rq = -rr - rs;
        } else if (rDiff > sDiff) {
            rr = -rq - rs;
        } else {
            rs = -rq - rr;
        }

        // Convert back to offset coordinates
        const col = Math.floor(rq + (rr - (rr & 1)) / 2);
        const row = Math.floor(rr);

        return { col, row };
    }

    // Get hex vertices for drawing
    getHexVertices(col: number, row: number): ScreenPosition[] {
        const center = this.hexToScreen(col, row);
        const vertices: ScreenPosition[] = [];

        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i - 30);
            const x = center.x + this.hexSize * Math.cos(angle);
            const y = center.y + this.hexSize * Math.sin(angle);
            vertices.push({ x, y });
        }

        return vertices;
    }

    // Check if coordinates are within grid bounds
    isValidHex(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    // Get neighboring hex coordinates
    getNeighbors(col: number, row: number): HexCoordinate[] {
        const neighbors: HexCoordinate[] = [];
        const directions = this.getNeighborDirections(row);

        for (const dir of directions) {
            const neighborCol = col + dir.col;
            const neighborRow = row + dir.row;

            if (this.isValidHex(neighborCol, neighborRow)) {
                neighbors.push({ col: neighborCol, row: neighborRow });
            }
        }

        return neighbors;
    }

    // Get direction vectors for neighbors (depends on row parity)
    getNeighborDirections(row: number): HexDirection[] {
        const isEven = (row & 1) === 0;

        if (isEven) {
            return [
                { col: -1, row: -1 }, { col: 0, row: -1 },
                { col: -1, row: 0 },  { col: 1, row: 0 },
                { col: -1, row: 1 },  { col: 0, row: 1 }
            ];
        } else {
            return [
                { col: 0, row: -1 },  { col: 1, row: -1 },
                { col: -1, row: 0 },  { col: 1, row: 0 },
                { col: 0, row: 1 },   { col: 1, row: 1 }
            ];
        }
    }

    // Calculate distance between two hexes
    hexDistance(col1: number, row1: number, col2: number, row2: number): number {
        // Convert to cube coordinates
        const q1 = col1 - (row1 - (row1 & 1)) / 2;
        const r1 = row1;
        const s1 = -q1 - r1;

        const q2 = col2 - (row2 - (row2 & 1)) / 2;
        const r2 = row2;
        const s2 = -q2 - r2;

        return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(s1 - s2)) / 2;
    }

    // A* pathfinding algorithm for hexes
    findPath(startCol: number, startRow: number, endCol: number, endRow: number, obstacles: Set<string> = new Set()): HexCoordinate[] {
        if (!this.isValidHex(startCol, startRow) || !this.isValidHex(endCol, endRow)) {
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
        fScore.set(startKey, this.hexDistance(startCol, startRow, endCol, endRow));

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
                const path: HexCoordinate[] = [];
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
                fScore.set(neighborKey, tentativeG + this.hexDistance(neighbor.col, neighbor.row, endCol, endRow));
            }
        }

        return []; // No path found
    }

    // Get all hexes within a certain range
    getHexesInRange(centerCol: number, centerRow: number, range: number): HexCoordinate[] {
        const hexes: HexCoordinate[] = [];

        for (let col = Math.max(0, centerCol - range); col <= Math.min(this.width - 1, centerCol + range); col++) {
            for (let row = Math.max(0, centerRow - range); row <= Math.min(this.height - 1, centerRow + range); row++) {
                if (this.hexDistance(centerCol, centerRow, col, row) <= range) {
                    hexes.push({ col, row });
                }
            }
        }

        return hexes;
    }

    // Get hexes in a ring at specific distance
    getHexRing(centerCol: number, centerRow: number, radius: number): HexCoordinate[] {
        if (radius === 0) {
            return [{ col: centerCol, row: centerRow }];
        }

        const hexes: HexCoordinate[] = [];

        for (let col = Math.max(0, centerCol - radius); col <= Math.min(this.width - 1, centerCol + radius); col++) {
            for (let row = Math.max(0, centerRow - radius); row <= Math.min(this.height - 1, centerRow + radius); row++) {
                if (this.hexDistance(centerCol, centerRow, col, row) === radius) {
                    hexes.push({ col, row });
                }
            }
        }

        return hexes;
    }

    // Check if a hex is adjacent to another
    areAdjacent(col1: number, row1: number, col2: number, row2: number): boolean {
        return this.hexDistance(col1, row1, col2, row2) === 1;
    }

    // Get random hex coordinates
    getRandomHex(): HexCoordinate {
        return {
            col: Math.floor(Math.random() * this.width),
            row: Math.floor(Math.random() * this.height)
        };
    }

    // Convert hex key to coordinates
    static keyToHex(key: string): HexCoordinate {
        const [col, row] = key.split(',').map(Number);
        return { col, row };
    }

    // Convert hex coordinates to key
    static hexToKey(col: number, row: number): string {
        return `${col},${row}`;
    }
}

// Utility functions for hex operations
export const HexUtils = {
    // Create hex key from coordinates
    makeKey: (col: number, row: number): string => `${col},${row}`,

    // Parse key to coordinates
    parseKey: (key: string): HexCoordinate => {
        const [col, row] = key.split(',').map(Number);
        return { col, row };
    },

    // Check if two hexes are the same
    isEqual: (hex1: HexCoordinate, hex2: HexCoordinate): boolean => hex1.col === hex2.col && hex1.row === hex2.row,

    // Create a set of hex keys from coordinates array
    coordsToSet: (coords: HexCoordinate[]): Set<string> => new Set(coords.map(coord => HexUtils.makeKey(coord.col, coord.row))),

    // Get hex at offset from another hex
    getHexAt: (hex: HexCoordinate, offsetCol: number, offsetRow: number): HexCoordinate => ({
        col: hex.col + offsetCol,
        row: hex.row + offsetRow
    })
};

export default HexGrid;