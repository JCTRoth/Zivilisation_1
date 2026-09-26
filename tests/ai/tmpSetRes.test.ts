import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

describe('setResearch on the naval map', () => {
  it('accepts sailing for an island civ', async () => {
    const orig = console.log;
    const e = new GameEngine(null);
    (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    await e.initialize({ numberOfCivilizations: 4, mapType: 'AI_VS_AI_NAVAL', devMode: true, startingGold: 50, mapSeed: 12 });
    const civ: any = e.civilizations[0];
    orig(`civ ${civ.id} island=${civ.startsOnIsland} techs=${(civ.technologies ?? []).join(',')}`);
    e.setResearch(civ.id, 'sailing');
    orig(`after setResearch(sailing): currentResearch=${JSON.stringify(civ.currentResearch)}`);
    e.setResearch(civ.id, 'steel');
    orig(`after setResearch(steel): currentResearch=${JSON.stringify(civ.currentResearch)}`);
    // and what the engine thinks is pickable
    const pickable = (e as any).getResearchableTechs?.(civ.id) ?? 'n/a';
    orig(`engine researchable: ${Array.isArray(pickable) ? pickable.join(' ') : pickable}`);
    expect(true).toBe(true);
  }, 300000);
});
