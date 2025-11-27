/**
 * Color manipulation utility functions
 */

export interface RGBColor {
    r: number;
    g: number;
    b: number;
}

export const ColorUtils = {
    /**
     * Convert RGB values to hex color string
     * @param r - Red component (0-255)
     * @param g - Green component (0-255)
     * @param b - Blue component (0-255)
     * @returns Hex color string
     */
    rgbToHex: (r: number, g: number, b: number): string => {
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    },

    /**
     * Parse hex color string to RGB values
     * @param hex - Hex color string (with or without #)
     * @returns RGB color object or null if invalid
     */
    hexToRgb: (hex: string): RGBColor | null => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : null;
    },

    /**
     * Darken a hex color by a factor
     * @param color - Hex color string
     * @param factor - Darkening factor (0-1)
     * @returns Darkened hex color string
     */
    darken: (color: string, factor: number): string => {
        const rgb = ColorUtils.hexToRgb(color);
        if (!rgb) return color;

        const darkenedR = Math.floor(rgb.r * (1 - factor));
        const darkenedG = Math.floor(rgb.g * (1 - factor));
        const darkenedB = Math.floor(rgb.b * (1 - factor));

        return ColorUtils.rgbToHex(darkenedR, darkenedG, darkenedB);
    },

    /**
     * Lighten a hex color by a factor
     * @param color - Hex color string
     * @param factor - Lightening factor (0-1)
     * @returns Lightened hex color string
     */
    lighten: (color: string, factor: number): string => {
        const rgb = ColorUtils.hexToRgb(color);
        if (!rgb) return color;

        const lightenedR = Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * factor));
        const lightenedG = Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * factor));
        const lightenedB = Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * factor));

        return ColorUtils.rgbToHex(lightenedR, lightenedG, lightenedB);
    }
};