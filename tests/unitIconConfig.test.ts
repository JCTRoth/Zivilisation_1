/**
 * Unit SVG icon overrides — every override must point at a real file in
 * src/assets/units, and the naval Trireme must use its own artwork instead of
 * the emoji fallback (the file sat unused in the folder).
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { getUnitSvgPath } from '@/data/UnitIconConfig';

describe('unit SVG icon overrides', () => {
  it('resolves every override to a file that exists', () => {
    const overridden: string[] = [];
    for (const unitType of Object.keys(UNIT_PROPERTIES)) {
      const svgPath = getUnitSvgPath(unitType);
      if (!svgPath) continue;
      overridden.push(unitType);
      expect(
        existsSync(join(process.cwd(), 'src', 'assets', 'units', svgPath)),
        `${unitType} → ${svgPath}`,
      ).toBe(true);
    }
    expect(overridden.length).toBeGreaterThan(0);
  });

  it('uses the trireme artwork for the Trireme', () => {
    expect(getUnitSvgPath('trireme')).toBe('trireme.svg');
  });

  it('returns null for units without artwork', () => {
    expect(getUnitSvgPath('nonexistent')).toBeNull();
    // A unit that keeps its emoji icon stays null.
    expect(getUnitSvgPath('settler')).toBe('settler.svg');
    expect(getUnitSvgPath('caravan')).toBeNull();
  });
});
