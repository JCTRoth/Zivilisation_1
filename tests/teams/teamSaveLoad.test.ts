import { describe, expect, it } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

// Minimal localStorage for the node test environment (same pattern as
// tests/saveLoad.test.ts).
const memory = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
  clear: () => memory.clear(),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
} as Storage;

async function newTeamGame(): Promise<GameEngine> {
  const engine = new GameEngine(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (engine as any).sleep = () => Promise.resolve();
  await engine.initialize({
    numberOfCivilizations: 3,
    mapType: 'NORMAL_SKIRMISH',
    mapWidth: 30,
    mapHeight: 20,
    devMode: false,
    startingGold: 100,
    fixedAlliances: true,
    teamAssignments: [0, 0, 1],
  });
  return engine;
}

describe('fixed alliances save/load', () => {
  it('writes version 5 and restores teams from game settings', async () => {
    const engine = await newTeamGame();
    expect(engine.teamManager.enabled).toBe(true);
    expect(engine.civilizations.map((civ) => civ.teamId)).toEqual([0, 0, 1]);
    expect(engine.diplomacyManager.getStatus(0, 1)).toBe('alliance');

    const json = engine.getSaveJSON();
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json!);
    expect(parsed.version).toBe(5);
    expect(parsed.gameSettings.fixedAlliances).toBe(true);
    expect(parsed.gameSettings.teamAssignments).toEqual([0, 0, 1]);
    localStorage.setItem('civ1_savegame', json!);

    const loaded = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loaded as any).sleep = () => Promise.resolve();
    expect(await loaded.loadGame()).toBe(true);

    expect(loaded.teamManager.enabled).toBe(true);
    expect(loaded.teamManager.getTeamMembers(0)).toEqual([0, 1]);
    expect(loaded.civilizations.map((civ) => civ.teamId)).toEqual([0, 0, 1]);
    expect(loaded.diplomacyManager.getStatus(0, 1)).toBe('alliance');
    expect(loaded.diplomacyManager.hasEmbassy(0, 1)).toBe(true);
  });

  it('repairs a stale teammate war on load', async () => {
    const engine = await newTeamGame();
    const json = engine.getSaveJSON()!;
    const parsed = JSON.parse(json);
    const stale = parsed.diplomacyRelations.find(
      (rel: { civA: number; civB: number }) => rel.civA === 0 && rel.civB === 1,
    );
    stale.status = 'war';
    localStorage.setItem('civ1_savegame', JSON.stringify(parsed));

    const loaded = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loaded as any).sleep = () => Promise.resolve();
    expect(await loaded.loadGame()).toBe(true);
    expect(loaded.diplomacyManager.getStatus(0, 1)).toBe('alliance');
    expect(loaded.diplomacyManager.isAtWar(0, 1)).toBe(false);
  });

  it('loads a v4 save as a free-for-all', async () => {
    const engine = await newTeamGame();
    const parsed = JSON.parse(engine.getSaveJSON()!);
    parsed.version = 4;
    delete parsed.gameSettings.fixedAlliances;
    delete parsed.gameSettings.teamAssignments;
    for (const civ of parsed.civilizations) delete civ.teamId;
    // A v4 save never had the forced teammate alliance, so make the stored
    // relation look like an ordinary pre-team game.
    const relation = parsed.diplomacyRelations.find(
      (rel: { civA: number; civB: number }) => rel.civA === 0 && rel.civB === 1,
    );
    relation.status = 'peace';
    relation.activeTreaties = [];
    localStorage.setItem('civ1_savegame', JSON.stringify(parsed));

    const loaded = new GameEngine(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loaded as any).sleep = () => Promise.resolve();
    expect(await loaded.loadGame()).toBe(true);

    expect(loaded.teamManager.enabled).toBe(false);
    expect(loaded.civilizations.every((civ) => civ.teamId === undefined)).toBe(true);
    // No team invariants are applied, so the ordinary diplomacy state stands.
    expect(loaded.diplomacyManager.getStatus(0, 1)).toBe('peace');
  });
});
