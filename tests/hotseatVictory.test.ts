import { describe, expect, it, beforeEach } from 'vitest';
import { VictoryManager } from '@/game/engine/VictoryManager';
import type { Civilization, GameActions } from '@/../types/game';

/**
 * Hotseat Joint Victory — when multiple humans share a device, all surviving
 * human civs win together when the last rival falls.
 */

interface MockEngine {
  civilizations: Civilization[];
  units: Array<{ civilizationId: number }>;
  cities: Array<{ civilizationId: number; id: string }>;
  isGameOver: boolean;
  currentTurn: number;
  currentYear: number | string;
  onStateChange: ((event: string, data: Record<string, unknown>) => void) | null;
  storeActions: GameActions | null;
  gameSettings?: { gameMode?: string; humanPlayerIds?: number[] };
  setPaused?: (paused: boolean) => void;
}

function makeCiv(id: number, name: string, isHuman = false): Civilization {
  return {
    id,
    name,
    color: '#000',
    isAlive: true,
    isHuman,
    isAI: !isHuman,
    leader: name,
    leaderName: name,
    resources: { food: 0, production: 0, trade: 0, science: 0, gold: 0 },
  } as Civilization;
}

function makeManager(engine: MockEngine): VictoryManager {
  const victory = new VictoryManager(engine as any);
  victory.reset();
  return victory;
}

let engine: MockEngine;
let emitted: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  emitted = [];
  engine = {
    civilizations: [makeCiv(0, 'Germans', true), makeCiv(1, 'Americans', true)],
    units: [
      { civilizationId: 0 },
      { civilizationId: 1 },
    ],
    cities: [
      { civilizationId: 0, id: 'city_0_0' },
      { civilizationId: 1, id: 'city_1_0' },
    ],
    isGameOver: false,
    currentTurn: 10,
    currentYear: '3000 BC',
    onStateChange: (event: string, data: Record<string, unknown>) => emitted.push({ event, data }),
    storeActions: null,
    setPaused: (_paused: boolean) => {},
    gameSettings: { gameMode: 'hotseat', humanPlayerIds: [0, 1] },
  };
});

describe('Hotseat Joint Victory', () => {
  it('both human civs win together when all enemies are eliminated', () => {
    // 2 humans + 1 AI enemy. The AI is eliminated, leaving both humans alive.
    // Both humans win jointly.
    engine.civilizations = [
      makeCiv(0, 'Germans', true),
      makeCiv(1, 'Americans', true),
      makeCiv(2, 'Zulus', false),
    ];
    engine.units = [
      { civilizationId: 0 },
      { civilizationId: 1 },
      // civ 2 (AI) has no units — eliminated
    ];
    engine.cities = [
      { civilizationId: 0, id: 'city_0_0' },
      { civilizationId: 1, id: 'city_1_0' },
      // civ 2 (AI) has no cities — eliminated
    ];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(true);
    const won = emitted.find((e) => e.event === 'GAME_WON');
    expect(won).toBeDefined();
    expect(won?.data.reason).toBe('elimination');
    expect(won?.data.civilizationIds).toEqual([0, 1]);
    expect(won?.data.civNames).toEqual(['Germans', 'Americans']);
    expect(won?.data.isHuman).toBe(true);
  });

  it('both human civs win together via moonshot', () => {
    // Civ 0 has moonshot tech. Both humans win via joint moonshot victory.
    engine.civilizations = [
      makeCiv(0, 'Germans', true),
      makeCiv(1, 'Americans', true),
    ];
    engine.civilizations[0].technologies = ['moonshot'];
    engine.civilizations[1].technologies = [];
    engine.units = [
      { civilizationId: 0 },
      { civilizationId: 1 },
    ];
    engine.cities = [
      { civilizationId: 0, id: 'city_0_0' },
      { civilizationId: 1, id: 'city_1_0' },
    ];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(true);
    const won = emitted.find((e) => e.event === 'GAME_WON');
    expect(won).toBeDefined();
    expect(won?.data.reason).toBe('moonshot');
    expect(won?.data.civilizationIds).toEqual([0, 1]);
    expect(won?.data.civNames).toEqual(['Germans', 'Americans']);
  });

  it('single human civ wins alone when the other human is eliminated', () => {
    // Civ 0 and civ 1 are both human, but civ 1's last unit and city are destroyed.
    // Only civ 0 survives and wins alone.
    engine.civilizations = [makeCiv(0, 'Germans', true), makeCiv(1, 'Americans', true)];
    engine.units = [
      { civilizationId: 0 },
    ];
    engine.cities = [
      { civilizationId: 0, id: 'city_0_0' },
    ];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(true);
    const won = emitted.find((e) => e.event === 'GAME_WON');
    expect(won).toBeDefined();
    expect(won?.data.reason).toBe('elimination');
    expect(won?.data.civilizationIds).toBeUndefined();
    expect(won?.data.civNames).toBeUndefined();
    expect(won?.data.civName).toBe('Germans');
    expect(won?.data.civilizationId).toBe(0);
  });
});
