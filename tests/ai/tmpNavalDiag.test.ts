import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { AIResearch } from '@/game/engine/AI/AIResearch';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

describe('naval diag', () => {
  it('inspect the naval snapshot and research picks', async () => {
    const orig = console.log;
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await e.initialize({ numberOfCivilizations: 4, mapType: 'AI_VS_AI_NAVAL', devMode: true, startingGold: 50, mapSeed: 12 });
    const mgr: any = e.aiManager;
    orig(`landmassCount=${e.getLandmassCount()} largest=${e.getLargestLandmassSize()}`);
    for (const civ of e.civilizations.filter((c) => c.id !== BARBARIAN_CIV_ID)) {
      const gs = mgr.buildGameState(civ.id);
      orig(`  civ ${civ.id} ${civ.name}: startsOnIsland=${civ.startsOnIsland} navalRelevance=${gs.navalRelevance} hasWater=${gs.hasWaterAccess} year=${gs.currentYear}`);
      const avail = AIResearch.getAvailableTechnologies(civ as never);
      const scored = avail.map((t) => AIResearch.scoreTechnology(t, { aggression: 5, expansion: 5, diplomacy: 5, science: 5, military: 5, economy: 5 } as never, (civ as any).productionProfile ?? 'balanced_growth', gs as never)).sort((a, b) => b.score - a.score);
      orig(`    top 5: ${scored.slice(0, 5).map((s) => `${s.techId}=${s.score}(${s.reason})`).join(' ')}`);
      orig(`    sailing present in available: ${avail.includes('sailing')}`);
    }
    expect(true).toBe(true);
  }, 300000);
});
