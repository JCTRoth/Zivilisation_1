// Helper Functions and Utilities - Legacy Implementation (Converted to TypeScript)

import { CONSTANTS } from './constants';

// Type definitions
interface Point {
    x: number;
    y: number;
}

interface CubeCoordinate {
    x: number;
    y: number;
    z: number;
}

interface OffsetCoordinate {
    col: number;
    row: number;
}

interface RGBColor {
    r: number;
    g: number;
    b: number;
}

// Math Utilities
export const MathUtils = {
    // Clamp a value between min and max
    clamp: (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value)),

    // Linear interpolation
    lerp: (start: number, end: number, factor: number): number => start + (end - start) * factor,

    // Fade function for noise (smoothstep)
    fade: (t: number): number => t * t * t * (t * (t * 6 - 15) + 10),

    // Distance between two points
    distance: (x1: number, y1: number, x2: number, y2: number): number => Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),

    // Random integer between min and max (inclusive)
    randomInt: (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min,

    // Random element from array
    randomChoice: <T>(array: T[]): T => array[Math.floor(Math.random() * array.length)]
};

// Hex Grid Utilities
export const HexUtils = {
    // Convert offset coordinates to cube coordinates
    offsetToCube: (col: number, row: number): CubeCoordinate => {
        const x = col - (row - (row & 1)) / 2;
        const z = row;
        const y = -x - z;
        return { x, y, z };
    },

    // Convert cube coordinates to offset coordinates
    cubeToOffset: (x: number, y: number, z: number): OffsetCoordinate => {
        const col = x + (z - (z & 1)) / 2;
        const row = z;
        return { col, row };
    },

    // Get hex neighbors in cube coordinates
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

    // Distance between two hex coordinates
    hexDistance: (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number => {
        return (Math.abs(x1 - x2) + Math.abs(y1 - y2) + Math.abs(z1 - z2)) / 2;
    },

    // Convert hex coordinates to pixel position
    hexToPixel: (col: number, row: number): Point => {
        const x = CONSTANTS.HEX_SIZE * Math.sqrt(3) * (col + 0.5 * (row & 1));
        const y = CONSTANTS.HEX_SIZE * 1.5 * row;
        return { x, y };
    },

    // Convert pixel position to hex coordinates
    pixelToHex: (x: number, y: number): OffsetCoordinate => {
        const q = (x * Math.sqrt(3) / 3 - y / 3) / CONSTANTS.HEX_SIZE;
        const r = y * 2 / 3 / CONSTANTS.HEX_SIZE;
        return HexUtils.roundHex(q, r);
    },

    // Round fractional hex coordinates to nearest hex
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

// Array Utilities
export const ArrayUtils = {
    // Create 2D array with default value
    create2D: <T>(width: number, height: number, defaultValue: T = null): T[][] => {
        return Array(height).fill(null).map(() => Array(width).fill(defaultValue));
    },

    // Shuffle array in place
    shuffle: <T>(array: T[]): T[] => {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    // Remove element from array
    remove: <T>(array: T[], element: T): T[] => {
        const index = array.indexOf(element);
        if (index > -1) {
            array.splice(index, 1);
        }
        return array;
    }
};

// Color Utilities
export const ColorUtils = {
    // Convert RGB to hex string
    rgbToHex: (r: number, g: number, b: number): string => {
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    },

    // Parse hex color to RGB
    hexToRgb: (hex: string): RGBColor | null => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    },

    // Darken a color by a factor
    darken: (color: string, factor: number): string => {
        const rgb = ColorUtils.hexToRgb(color);
        if (!rgb) return color;

        const darkenedR = Math.floor(rgb.r * (1 - factor));
        const darkenedG = Math.floor(rgb.g * (1 - factor));
        const darkenedB = Math.floor(rgb.b * (1 - factor));

        return ColorUtils.rgbToHex(darkenedR, darkenedG, darkenedB);
    },

    // Lighten a color by a factor
    lighten: (color: string, factor: number): string => {
        const rgb = ColorUtils.hexToRgb(color);
        if (!rgb) return color;

        const lightenedR = Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * factor));
        const lightenedG = Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * factor));
        const lightenedB = Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * factor));

        return ColorUtils.rgbToHex(lightenedR, lightenedG, lightenedB);
    }
};

// DOM Utilities
export const DomUtils = {
    // Get element by ID with error checking
    getElementById: (id: string): HTMLElement | null => {
        const element = document.getElementById(id);
        if (!element) {
            console.warn(`Element with ID '${id}' not found`);
        }
        return element;
    },

    // Create element with attributes
    createElement: (tag: string, attributes: Record<string, string> = {}, textContent: string = ''): HTMLElement => {
        const element = document.createElement(tag);
        Object.keys(attributes).forEach(key => {
            element.setAttribute(key, attributes[key]);
        });
        if (textContent) {
            element.textContent = textContent;
        }
        return element;
    },

    // Add class with animation
    addClassWithAnimation: (element: HTMLElement, className: string, duration: number = 300): void => {
        element.classList.add(className);
        setTimeout(() => {
            element.classList.add('fade-in');
        }, 10);
    },

    // Remove class with animation
    removeClassWithAnimation: (element: HTMLElement, className: string, duration: number = 300): void => {
        element.classList.add('fade-out');
        setTimeout(() => {
            element.classList.remove(className, 'fade-out');
        }, duration);
    }
};

// Game State Utilities
export const GameUtils = {
    // Generate unique ID
    generateId: (): string => {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },

    // Deep clone object
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

    // Format numbers with separators
    formatNumber: (num: number): string => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    },

    // Convert game year to display format
    formatYear: (year: number): string => {
        if (year < 0) {
            return `${Math.abs(year)} BC`;
        } else if (year === 0) {
            return '1 BC';
        } else {
            return `${year} AD`;
        }
    },

    // Calculate turns between years
    yearToTurn: (year: number): number => {
        return Math.floor((year - CONSTANTS.STARTING_YEAR) / CONSTANTS.TURNS_PER_YEAR) + 1;
    },

    // Calculate year from turn number
    turnToYear: (turn: number): number => {
        return CONSTANTS.STARTING_YEAR + (turn - 1) * CONSTANTS.TURNS_PER_YEAR;
    }
};

// Event System
export class EventEmitter {
    private events: Record<string, Function[]>;

    constructor() {
        this.events = {};
    }

    on(event: string, callback: Function): void {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    off(event: string, callback: Function): void {
        if (!this.events[event]) return;
        this.events[event] = this.events[event].filter(cb => cb !== callback);
    }

    emit(event: string, ...args: any[]): void {
        if (!this.events[event]) return;
        this.events[event].forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                console.error(`Error in event listener for '${event}':`, error);
            }
        });
    }

    once(event: string, callback: Function): void {
        const onceCallback = (...args: any[]) => {
            callback(...args);
            this.off(event, onceCallback);
        };
        this.on(event, onceCallback);
    }
}

// Performance monitoring
export const Performance = {
    startTime: 0,

    start: (label: string): void => {
        Performance.startTime = performance.now();
        console.time(label);
    },

    end: (label: string): number => {
        const endTime = performance.now();
        const duration = endTime - Performance.startTime;
        console.timeEnd(label);
        return duration;
    },

    measure: <T>(fn: () => T, label: string = 'Operation'): T => {
        Performance.start(label);
        const result = fn();
        Performance.end(label);
        return result;
    }
};

// City Utilities
export const CityUtils = {
    // Calculate corruption based on distance from capital and government
    calculateCorruption: (city: any, currentPlayer: any, totalTrade: number): number => {
        if (!currentPlayer || !city) return 0;

        // Find the capital city
        const capital = currentPlayer.capital;
        if (!capital) return 0;

        // If this is the capital, no corruption
        if (city.id === capital.id) return 0;

        // Calculate distance from capital
        const distance = Math.sqrt(
            Math.pow(city.col - capital.col, 2) +
            Math.pow(city.row - capital.row, 2)
        );

        // Base corruption rate depends on government type
        // For now, assume despotism (high corruption)
        let baseCorruptionRate = 0.3; // 30% base corruption for despotism

        // Distance increases corruption
        const distanceMultiplier = Math.min(distance / 10, 2); // Max 2x at distance 10+
        const corruptionRate = baseCorruptionRate * distanceMultiplier;

        // Apply building reductions (Courthouse reduces corruption)
        let finalCorruptionRate = corruptionRate;
        if (city.buildings?.includes('courthouse')) {
            finalCorruptionRate *= 0.5; // Courthouse reduces corruption by 50%
        }

        return Math.floor(totalTrade * finalCorruptionRate);
    },

    // Calculate city resource data
    calculateCityResources: (city: any, currentPlayer: any) => {
        // Calculate food surplus/shortfall
        const foodNeeded = (city.population ?? 1) * 2;
        const foodProduced = city.yields?.food ?? city.food ?? 0;
        const foodSurplus = foodProduced - foodNeeded;

        // Calculate production surplus/shortfall (simplified - assuming no unit maintenance for now)
        const productionProduced = city.yields?.production ?? city.production ?? 0;
        const productionSurplus = productionProduced; // Simplified - no maintenance cost calculation yet

        // Calculate trade and its distribution
        const totalTrade = city.yields?.trade ?? city.trade ?? 0;

        // For now, use simple 50/50/0 split (can be enhanced with actual trade rates later)
        const luxuryRate = 50; // percentage
        const taxRate = 0;     // percentage
        const scienceRate = 50; // percentage

        // Calculate corruption based on distance from capital and government
        const corruption = CityUtils.calculateCorruption(city, currentPlayer, totalTrade);
        const tradeAfterCorruption = totalTrade - corruption;

        // Distribute trade after corruption
        const actualLuxuries = Math.floor(tradeAfterCorruption * (luxuryRate / 100));
        const actualTaxes = Math.floor(tradeAfterCorruption * (taxRate / 100));
        const actualScience = Math.floor(tradeAfterCorruption * (scienceRate / 100));

        return {
            food: {
                produced: foodProduced,
                needed: foodNeeded,
                surplus: foodSurplus
            },
            production: {
                produced: productionProduced,
                surplus: productionSurplus
            },
            trade: {
                total: totalTrade,
                afterCorruption: tradeAfterCorruption,
                corruption: corruption
            },
            luxuries: {
                amount: actualLuxuries,
                rate: luxuryRate
            },
            taxes: {
                amount: actualTaxes,
                rate: taxRate
            },
            science: {
                amount: actualScience,
                rate: scienceRate
            }
        };
    }
};