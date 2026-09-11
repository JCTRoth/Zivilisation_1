/**
 * Verifies the research path utilities and tech icons used by the Technology
 * Research feature (tree selection, progress persistence, notifications).
 */
import { describe, it, expect } from 'vitest';
import { findPathToTech, firstUnresearchedInPath, firstResearchableInPath } from '@/utils/ResearchPath';
import { getTechIcon } from '@/data/TechnologyIcons';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';

describe('findPathToTech', () => {
  it('returns a single-node path for a root tech', () => {
    expect(findPathToTech(TECHNOLOGIES_DATA, 'pottery')).toEqual(['pottery']);
    expect(findPathToTech(TECHNOLOGIES_DATA, 'alphabet')).toEqual(['alphabet']);
  });

  it('returns the prerequisite chain for a deep tech', () => {
    expect(findPathToTech(TECHNOLOGIES_DATA, 'literacy')).toEqual(['alphabet', 'writing', 'literacy']);
    expect(findPathToTech(TECHNOLOGIES_DATA, 'the_wheel')).toEqual(['the_wheel']);
  });

  it('reaches late-game techs via their prerequisites', () => {
    const path = findPathToTech(TECHNOLOGIES_DATA, 'space_flight');
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe('space_flight');
    // every consecutive pair must be a prerequisite edge
    for (let i = 1; i < path!.length; i++) {
      const tech = TECHNOLOGIES_DATA.find((t) => t.id === path![i]);
      expect(tech?.prerequisites ?? []).toContain(path![i - 1]);
    }
  });

  it('returns null for an unknown tech', () => {
    expect(findPathToTech(TECHNOLOGIES_DATA, 'not_a_tech')).toBeNull();
    expect(findPathToTech([], 'pottery')).toBeNull();
  });
});

describe('firstUnresearchedInPath', () => {
  it('picks the first available + unresearched tech in the path', () => {
    // Mark alphabet as researched so the path starts at writing. (TECHNOLOGIES_DATA
    // only sets `available` on root techs, so mark the path techs available too.)
    const techs = TECHNOLOGIES_DATA.map((t) => {
      if (t.id === 'alphabet') return { ...t, researched: true, available: true };
      if (t.id === 'writing' || t.id === 'literacy') return { ...t, available: true };
      return { ...t };
    });
    const path = ['alphabet', 'writing', 'literacy'];
    expect(firstUnresearchedInPath(techs, path)).toBe('writing');
  });

  it('returns null when the path is exhausted', () => {
    const techs = TECHNOLOGIES_DATA.map((t) =>
      ['alphabet', 'writing', 'literacy'].includes(t.id) ? { ...t, researched: true } : { ...t },
    );
    expect(firstUnresearchedInPath(techs, ['alphabet', 'writing', 'literacy'])).toBeNull();
    expect(firstUnresearchedInPath(techs, [])).toBeNull();
  });

  it('ignores the shared union flag when the civ\'s own techs are provided', () => {
    // `writing` is marked researched on the SHARED tree (another civ discovered
    // it first) — the player's own list only has `alphabet`, so `writing` must
    // still be picked (regression: techs an AI discovered first were skipped).
    const techs = TECHNOLOGIES_DATA.map((t) =>
      ['alphabet', 'writing'].includes(t.id) ? { ...t, researched: true, available: true } : { ...t },
    );
    expect(firstUnresearchedInPath(techs, ['alphabet', 'writing', 'literacy'])).toBeNull();
    expect(firstUnresearchedInPath(techs, ['alphabet', 'writing', 'literacy'], new Set(['alphabet'])))
      .toBe('writing');
  });
});

describe('firstResearchableInPath', () => {
  it('returns the first tech the civ has not researched with prereqs met', () => {
    const path = ['alphabet', 'writing', 'literacy'];
    expect(firstResearchableInPath(TECHNOLOGIES_DATA, path, new Set())).toBe('alphabet');
    expect(firstResearchableInPath(TECHNOLOGIES_DATA, path, new Set(['alphabet']))).toBe('writing');
    expect(firstResearchableInPath(TECHNOLOGIES_DATA, path, new Set(['alphabet', 'writing']))).toBe('literacy');
    expect(firstResearchableInPath(TECHNOLOGIES_DATA, path, new Set(['alphabet', 'writing', 'literacy']))).toBeNull();
  });

  it('lets the player pick a tech another civ already discovered', () => {
    // A tech the AI discovered first is `researched` on the SHARED tree — the
    // player must still be able to select it (each civ researches
    // independently in Civ1).
    const techs = TECHNOLOGIES_DATA.map((t) =>
      t.id === 'pottery' ? { ...t, researched: true, available: true } : { ...t },
    );
    expect(firstResearchableInPath(techs, ['pottery'], new Set())).toBe('pottery');
  });

  it('skips techs whose prerequisites the civ has not researched', () => {
    // `writing` requires `alphabet`: with an empty tech list the path can only
    // start at the root.
    const path = ['alphabet', 'writing'];
    expect(firstResearchableInPath(TECHNOLOGIES_DATA, path, new Set())).toBe('alphabet');
    // Unknown techs are skipped, not returned.
    expect(firstResearchableInPath(TECHNOLOGIES_DATA, ['not_a_tech'], new Set())).toBeNull();
  });
});

describe('getTechIcon', () => {
  it('returns a fitting icon for known techs and the 🧪 fallback otherwise', () => {
    expect(getTechIcon('pottery')).toBe('🏺');
    expect(getTechIcon('space_flight')).toBe('🚀');
    expect(getTechIcon('not_a_tech')).toBe('🧪');
  });
});
