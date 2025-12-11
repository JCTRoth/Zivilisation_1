/**
 * Unit Icon Configuration
 * 
 * This file defines which units use SVG icons instead of the default emoji icons.
 * SVG icons provide higher quality rendering and better visual consistency.
 * 
 * Structure:
 * - unitType: The unit identifier (must match UNIT_TYPES)
 * - svgPath: Path to the SVG file (relative to src/assets/units/)
 * - fallbackEmoji: Optional emoji to use if SVG fails to load (sourced from UnitConstants.ts)
 */

import { UNIT_PROPERTIES } from './UnitConstants';

export interface UnitIconOverride {
  unitType: string;
  svgPath: string;
  fallbackEmoji?: string;
}

/**
 * SVG Icon Overrides
 * 
 * Units listed here will use SVG icons instead of emoji icons.
 * The loader will attempt to load the SVG, and fall back to the emoji
 * defined in UnitConstants.ts if the SVG is not available.
 */
export const UNIT_ICON_OVERRIDES: UnitIconOverride[] = [
  {
    unitType: 'warrior',
    svgPath: 'worrier.svg',
    fallbackEmoji: UNIT_PROPERTIES['warrior']?.icon
  },
  {
    unitType: 'scout',
    svgPath: 'scout.svg',
    fallbackEmoji: UNIT_PROPERTIES['scout']?.icon
  },
  {
    unitType: 'phalanx',
    svgPath: 'phalanx.svg',
    fallbackEmoji: UNIT_PROPERTIES['phalanx']?.icon
  },
  {
    unitType: 'knights',
    svgPath: 'knights.svg',
    fallbackEmoji: UNIT_PROPERTIES['knights']?.icon
  },
  {
    unitType: 'chariot',
    svgPath: 'chariot.svg',
    fallbackEmoji: UNIT_PROPERTIES['chariot']?.icon
  },
  {
    unitType: 'cannon',
    svgPath: 'cannon.svg',
    fallbackEmoji: UNIT_PROPERTIES['cannon']?.icon
  },
  {
    unitType: 'artillery',
    svgPath: 'artillery.svg',
    fallbackEmoji: UNIT_PROPERTIES['artillery']?.icon
  },
  {
    unitType: 'submarine',
    svgPath: 'submarine.svg',
    fallbackEmoji: UNIT_PROPERTIES['submarine']?.icon
  },
  {
    unitType: 'tank',
    svgPath: 'tank.svg',
    fallbackEmoji: UNIT_PROPERTIES['tank']?.icon
  }
  ,
  {
    unitType: 'archer',
    svgPath: 'archer.svg',
    fallbackEmoji: UNIT_PROPERTIES['archer']?.icon
  }
];

/**
 * Get SVG path for a unit type, if it has an override
 */
export function getUnitSvgPath(unitType: string): string | null {
  const override = UNIT_ICON_OVERRIDES.find(o => o.unitType === unitType);
  return override ? override.svgPath : null;
}

/**
 * Check if a unit has an SVG override
 */
export function hasUnitSvgOverride(unitType: string): boolean {
  return UNIT_ICON_OVERRIDES.some(o => o.unitType === unitType);
}

/**
 * Get all unit types that have SVG overrides
 */
export function getUnitsWithSvgOverrides(): string[] {
  return UNIT_ICON_OVERRIDES.map(o => o.unitType);
}
