/**
 * Game-specific utility functions
 */

import { Constants } from './Constants';

export const GameUtils = {
    /**
     * Generate a unique ID string
     * @returns Unique identifier string
     */
    generateId: (): string => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    /**
     * Create a deep clone of an object
     * @param obj - Object to clone
     * @returns Deep cloned object
     */
    deepClone: <T>(obj: T): T => {
        if (obj === null || typeof obj !== 'object') return obj;
        if (obj instanceof Date) return new Date(obj.getTime()) as T;
        if (Array.isArray(obj)) return obj.map(item => GameUtils.deepClone(item)) as T;
        if (typeof obj === 'object') {
            const clonedObj: any = {};
            Object.keys(obj).forEach(key => {
                clonedObj[key] = GameUtils.deepClone((obj as any)[key]);
            });
            return clonedObj;
        }
        return obj;
    },

    /**
     * Format numbers with thousand separators
     * @param num - Number to format
     * @returns Formatted number string
     */
    formatNumber: (num: number): string => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    /**
     * Convert game year to display format
     * @param year - Game year (negative for BC)
     * @returns Formatted year string
     */
    formatYear: (year: number): string => {
        if (year < 0) {
            return `${Math.abs(year)} BC`;
        } else if (year === 0) {
            return '1 BC';
        } else {
            return `${year} AD`;
        }
    },

    /**
     * Calculate turn number from game year
     * @param year - Game year
     * @returns Turn number
     */
    yearToTurn: (year: number): number => {
        return Math.floor((year - Constants.STARTING_YEAR) / Constants.TURNS_PER_YEAR) + 1;
    },

    /**
     * Calculate game year from turn number
     * @param turn - Turn number
     * @returns Game year
     */
    turnToYear: (turn: number): number => {
        return Constants.STARTING_YEAR + (turn - 1) * Constants.TURNS_PER_YEAR;
    }
};