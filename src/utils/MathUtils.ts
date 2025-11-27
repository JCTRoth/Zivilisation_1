/**
 * Mathematical utility functions
 */

export const MathUtils = {
    /**
     * Clamp a value between min and max
     * @param value - The value to clamp
     * @param min - Minimum value
     * @param max - Maximum value
     * @returns The clamped value
     */
    clamp: (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value)),

    /**
     * Linear interpolation between two values
     * @param start - Starting value
     * @param end - Ending value
     * @param factor - Interpolation factor (0-1)
     * @returns Interpolated value
     */
    lerp: (start: number, end: number, factor: number): number => start + (end - start) * factor,

    /**
     * Fade function for noise (smoothstep)
     * @param t - Input value
     * @returns Smoothed value
     */
    fade: (t: number): number => t * t * t * (t * (t * 6 - 15) + 10),

    /**
     * Calculate distance between two points
     * @param x1 - First point X coordinate
     * @param y1 - First point Y coordinate
     * @param x2 - Second point X coordinate
     * @param y2 - Second point Y coordinate
     * @returns Distance between points
     */
    distance: (x1: number, y1: number, x2: number, y2: number): number => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),

    /**
     * Generate random integer between min and max (inclusive)
     * @param min - Minimum value
     * @param max - Maximum value
     * @returns Random integer
     */
    randomInt: (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min,

    /**
     * Select random element from array
     * @param array - Array to choose from
     * @returns Random element from array
     */
    randomChoice: <T>(array: T[]): T => array[Math.floor(Math.random() * array.length)]
};