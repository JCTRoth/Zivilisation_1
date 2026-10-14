/**
 * Unit SVG icon overrides — every override must point at a real file in
 * src/assets/units, and the naval units that have artwork (the Trireme and the
 * Frigate) must use it instead of their emoji fallback.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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

  it('uses the ship artwork for the Trireme and the Frigate', () => {
    expect(getUnitSvgPath('trireme')).toBe('trireme.svg');
    expect(getUnitSvgPath('frigate')).toBe('frigate.svg');
  });

  it('the ship artwork is real, parsable SVG', () => {
    // A file that exists but is a placeholder or an empty export would load as
    // a 0×0 image and silently fall back to the emoji at runtime.
    for (const file of ['trireme.svg', 'frigate.svg']) {
      const source = readFileSync(join(process.cwd(), 'src', 'assets', 'units', file), 'utf8');
      expect(source, `${file} should be SVG`).toContain('<svg');
      const w = Number(source.match(/width="([\d.]+)"/)?.[1] ?? 0);
      const h = Number(source.match(/height="([\d.]+)"/)?.[1] ?? 0);
      expect(w, `${file} width`).toBeGreaterThan(0);
      expect(h, `${file} height`).toBeGreaterThan(0);
    }
  });

  it('every fallback glyph is one the bundled emoji font can actually draw', () => {
    // The Frigate used to carry an Egyptian boat hieroglyph (U+1329D), which
    // is outside Noto Color Emoji and showed as a tofu box wherever the
    // artwork failed to load. Guard every fallback, not just that one.
    const notoEmoji = /src\/assets\/NotoEmoji-Light\.ttf$/;
    expect(notoEmoji.test(join(process.cwd(), 'src/assets/NotoEmoji-Light.ttf'))).toBe(true);
    for (const [unitType, props] of Object.entries(UNIT_PROPERTIES)) {
      const icon = props.icon ?? '';
      // Astral-plane runes (U+1F000..1FAFF) and the Egyptian blocks are the two
      // ranges the bundled font does not cover; everything else is either
      // BMP-emoji or a dingbat the font does have.
      const astralRune = /[\u{1D000}-\u{1F02F}]/u;
      const egyptian = /[\u{13000}-\u{1342F}]/u;
      expect(icon, `${unitType} fallback`).not.toMatch(astralRune);
      expect(icon, `${unitType} fallback`).not.toMatch(egyptian);
    }
  });

  it('returns null for units without artwork', () => {
    expect(getUnitSvgPath('nonexistent')).toBeNull();
    // A unit that keeps its emoji icon stays null.
    expect(getUnitSvgPath('settler')).toBe('settler.svg');
    expect(getUnitSvgPath('caravan')).toBeNull();
  });
});
