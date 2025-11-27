/**
 * Hexagonal grid utility functions
 */

import { Constants } from './Constants';

export interface CubeCoordinate {
    x: number;
    y: number;
    z: number;
}

export interface OffsetCoordinate {
    col: number;
    row: number;
}

export interface Point {
    x: number;
    y: number;
}

export const HexUtils = {
    /**
     * Convert offset coordinates to cube coordinates
     * @param col - Column coordinate
     * @param row - Row coordinate
     * @returns Cube coordinates
     */
    offsetToCube: (col: number, row: number): CubeCoordinate => {
        const x = col - (row - (row & 1)) / 2;
        const z = row;
        const y = -x - z;
        return { x, y, z };
    },

    /**
     * Convert cube coordinates to offset coordinates
     * @param x - Cube X coordinate
     * @param y - Cube Y coordinate
     * @param z - Cube Z coordinate
     * @returns Offset coordinates
     */
    cubeToOffset: (x: number, y: number, z: number): OffsetCoordinate => {
        const col = x + (z - (z & 1)) / 2;
        const row = z;
        return { col, row };
    },

    /**
     * Get neighboring hex coordinates in cube coordinates
     * @param x - Center hex X coordinate
     * @param y - Center hex Y coordinate
     * @param z - Center hex Z coordinate
     * @returns Array of neighboring cube coordinates
     */
    getNeighbors: (x: number, y: number, z: number): CubeCoordinate[] => {
        const directions: CubeCoordinate[] = [
            { x: 1, y: -1, z: 0 }, { x: 1, y: 0, z: -1 }, { x: 0, y: 1, z: -1 },
            { x: -1, y: 1, z: 0 }, { x: -1, y: 0, z: 1 }, { x: 0, y: -1, z: 1 }
        ];
        return directions.map(dir => ({
            x: x + dir.x,
            y: y + dir.y,
            z: z + dir.z
        }));
    },

    /**
     * Calculate distance between two hex coordinates
     * @param x1 - First hex X coordinate
     * @param y1 - First hex Y coordinate
     * @param z1 - First hex Z coordinate
     * @param x2 - Second hex X coordinate
     * @param y2 - Second hex Y coordinate
     * @param z2 - Second hex Z coordinate
     * @returns Distance in hex steps
     */
    hexDistance: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number => {
        return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
    },

    /**
     * Convert hex coordinates to pixel position
     * @param col - Column coordinate
     * @param row - Row coordinate
     * @returns Pixel coordinates
     */
    hexToPixel: (col: number, row: number): Point => {
        const x = Constants.HEX_SIZE * Math.sqrt(3) * (col + 0.5 * (row & 1));
        const y = Constants.HEX_SIZE * 1.5 * row;
        return { x, y };
    },

    /**
     * Convert pixel position to hex coordinates
     * @param x - Pixel X coordinate
     * @param y - Pixel Y coordinate
     * @returns Hex coordinates
     */
    pixelToHex: (x: number, y: number): OffsetCoordinate => {
        const q = (x * Math.sqrt(3) / 3 - y / 3) / Constants.HEX_SIZE;
        const r = y * 2 / 3 / Constants.HEX_SIZE;
        return HexUtils.roundHex(q, r);
    },

    /**
     * Round fractional hex coordinates to nearest hex
     * @param q - Fractional Q coordinate
     * @param r - Fractional R coordinate
     * @returns Rounded hex coordinates
     */
    roundHex: (q: number, r: number): OffsetCoordinate => {
        const s = -q - r;
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
        }

        return { col: rq, row: rr };
    }
};