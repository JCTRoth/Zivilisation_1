/**
 * Array manipulation utility functions
 */

export const ArrayUtils = {
    /**
     * Create a 2D array with specified dimensions and default value
     * @param width - Width of the 2D array
     * @param height - Height of the 2D array
     * @param defaultValue - Default value for all elements
     * @returns 2D array filled with default values
     */
    create2D: <T>(width: number, height: number, defaultValue: T = null): T[][] => {
        return Array(height).fill(null).map(() => Array(width).fill(defaultValue));
    },

    /**
     * Shuffle array elements in place using Fisher-Yates algorithm
     * @param array - Array to shuffle
     * @returns The same array with elements shuffled
     */
    shuffle: <T>(array: T[]): T[] => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    /**
     * Remove first occurrence of element from array
     * @param array - Array to modify
     * @param element - Element to remove
     * @returns The modified array
     */
    remove: <T>(array: T[], element: T): T[] => {
        const index = array.indexOf(element);
        if (index > -1) {
            array.splice(index, 1);
        }
        return array;
    }
};