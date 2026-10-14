/**
 * Strategic branches: the named postures (endgame arm, total war, island
 * spread, steady routine) and what each one is allowed to spend.
 */
import { describe, it, expect } from 'vitest';
import {
  selectStrategyBranch,
  branchRushesAttackers,
  branchWantsSiege,
  branchBuildsNukes,
  type StrategyBranchInput,
} from '@/game/engine/AI/AIStrategyBranches';

const base: StrategyBranchInput = {
  atWar: false,
  year: 1000,
  fissionKnown: false,
  manhattanBuilt: false,
  nukeStock: 0,
  enemyCities: 0,
  hasOffensivePlan: false,
  walledTargetKnown: false,
  seaWorld: false,
  islandsOpen: 0,
  ownCities: 3,
};

describe('branch selection', () => {
  it('runs steady routine in an ordinary peacetime game', () => {
    expect(selectStrategyBranch(base).id).toBe('steady');
  });

  it('arms the endgame once fission lands in a late war', () => {
    const branch = selectStrategyBranch({
      ...base, atWar: true, year: 1950, fissionKnown: true, manhattanBuilt: true, enemyCities: 4,
    });
    expect(branch.id).toBe('nuclear_endgame');
    expect(branch.reasons).toContain('manhattan-online');
  });

  it('races Manhattan with fission short of the wonder', () => {
    const branch = selectStrategyBranch({
      ...base, atWar: true, year: 1600, fissionKnown: true, manhattanBuilt: false, enemyCities: 2,
    });
    expect(branch.id).toBe('nuclear_endgame');
    expect(branch.reasons).toContain('racing-manhattan');
  });

  it('does not arm with nobody left to strike', () => {
    expect(selectStrategyBranch({
      ...base, year: 2000, fissionKnown: true, manhattanBuilt: true, enemyCities: 0,
    }).id).not.toBe('nuclear_endgame');
  });

  it('fights total war for a committed offensive, walls noted', () => {
    const branch = selectStrategyBranch({
      ...base, atWar: true, enemyCities: 3, hasOffensivePlan: true, walledTargetKnown: true,
    });
    expect(branch.id).toBe('total_war');
    expect(branch.reasons).toContain('walls-to-crack');
  });

  it('spreads across open islands in a sea world at peace', () => {
    const branch = selectStrategyBranch({ ...base, seaWorld: true, islandsOpen: 3 });
    expect(branch.id).toBe('island_spread');
  });

  it('prioritizes the arm over the war and the war over colonies', () => {
    const both = selectStrategyBranch({
      ...base, atWar: true, year: 1950, fissionKnown: true, manhattanBuilt: true,
      enemyCities: 4, hasOffensivePlan: true, seaWorld: true, islandsOpen: 3,
    });
    expect(both.id).toBe('nuclear_endgame');
    const war = selectStrategyBranch({
      ...base, atWar: true, enemyCities: 2, hasOffensivePlan: true, seaWorld: true, islandsOpen: 3,
    });
    expect(war.id).toBe('total_war');
  });
});

describe('branch effects', () => {
  it('only war branches rush attackers with gold', () => {
    expect(branchRushesAttackers('total_war')).toBe(true);
    expect(branchRushesAttackers('nuclear_endgame')).toBe(true);
    expect(branchRushesAttackers('island_spread')).toBe(false);
    expect(branchRushesAttackers('steady')).toBe(false);
  });

  it('only total war builds siege trains', () => {
    expect(branchWantsSiege('total_war')).toBe(true);
    expect(branchWantsSiege('nuclear_endgame')).toBe(false);
  });

  it('only the endgame builds nukes', () => {
    expect(branchBuildsNukes('nuclear_endgame')).toBe(true);
    expect(branchBuildsNukes('total_war')).toBe(false);
    expect(branchBuildsNukes('steady')).toBe(false);
  });
});
