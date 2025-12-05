/**
 * Game-specific utility functions
 * 
 * TERMINOLOGY:
 * - Round: A round is finished when all active (alive) players have completed their turns.
 * - Turn: Each player has one turn per round if they are active (not eliminated).
 * - Move: Each unit has available moves (movesRemaining) they can use during their owner's turn.
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
     * Format numbers with a thousand separators
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
     * Calculate the year increment based on current era.
     * Models historical progression with era-dependent increments:
     * - Before 1000 AD: +20 years/round
     * - 1000-1499 AD: +10 years/round
     * - 1500-1749 AD: +5 years/round
     * - 1750-1849 AD: +2 years/round
     * - 1850+ AD: +1 year/round
     * @param currentYear - The current game year
     * @returns The number of years to advance
     */
    getYearIncrement: (currentYear: number): number => {
        if (currentYear < 1000) {
            return 20;
        } else if (currentYear < 1500) {
            return 10;
        } else if (currentYear < 1750) {
            return 5;
        } else if (currentYear < 1850) {
            return 2;
        } else {
            return 1;
        }
    },

    /**
     * Advance the game year by one round, handling era transitions.
     * Skips year 0 (there is no year 0 in history - goes from 1 BC to 1 AD).
     * @param currentYear - The current game year
     * @returns The new game year after advancement
     */
    advanceYear: (currentYear: number): number => {
        const increment = GameUtils.getYearIncrement(currentYear);
        let newYear = currentYear + increment;
        
        // Skip year 0 (1 BC -> 1 AD)
        if (currentYear < 0 && newYear >= 0) {
            newYear = newYear === 0 ? 1 : newYear;
        }
        
        return newYear;
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
     * @deprecated Use advanceYear() for proper era-based progression
     */
    turnToYear: (turn: number): number => {
        return Constants.STARTING_YEAR + (turn - 1) * Constants.TURNS_PER_YEAR;
    }
};