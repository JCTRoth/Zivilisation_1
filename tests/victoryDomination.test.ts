import { describe, expect, it, beforeEach } from 'vitest';
import { VictoryManager } from '@shared/game/engine/VictoryManager';
import type { Civilization, GameActions } from '@shared/types/game';

/**
 * VICTORY — ONLY WON WHEN ALL ENEMY UNITS ARE DESTROYED
 *
 * Verifies that a game is NOT won by domination (owning every city) while an
 * enemy still has a unit on the map. The game ends only by elimination: a
 * single surviving faction with every rival reduced to zero units AND zero
 * cities. The barbarian faction (id BARBARIAN_CIV_ID = -1) counts as an enemy
 * faction once it holds a city.
 */

interface MockEngine {
  civilizations: Civilization[];
  units: Array<{ civilizationId: number }>;
  cities: Array<{ civilizationId: number; id: string }>;
  isGameOver: boolean;
  isPaused?: boolean;
  currentTurn: number;
  currentYear: number | string;
  onStateChange: ((event: string, data: Record<string, unknown>) => void) | null;
  storeActions: GameActions | null;
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
  // VictoryManager expects the full GameEngine; the mock covers only the
  // surface it reads during evaluateEndOfTurn.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const victory = new VictoryManager(engine as any);
  victory.reset();
  return victory;
}

let engine: MockEngine;
let emitted: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  emitted = [];
  engine = {
    civilizations: [makeCiv(0, 'Germans'), makeCiv(1, 'Americans')],
    units: [
      { civilizationId: 0 },
      { civilizationId: 1 },
    ],
    cities: [
      { civilizationId: 0, id: 'city_0_0' },
      { civilizationId: 0, id: 'city_0_1' },
    ],
    isGameOver: false,
    currentTurn: 10,
    currentYear: '3000 BC',
    onStateChange: (event: string, data: Record<string, unknown>) => emitted.push({ event, data }),
    storeActions: null,
    setPaused: (_paused: boolean) => {},  // no-op for VictoryManager tests
  };
});

describe('VictoryManager — only won when all enemy units are destroyed', () => {
  it('does NOT declare victory while an enemy unit remains, even when one civ owns ALL cities', () => {
    // Default setup: civ 0 owns both cities, but civ 1 still has a unit → the
    // game must NOT end (owning every city is no longer a shortcut).
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(false);
    expect(engine.isGameOver).toBe(false);
    expect(emitted.some((e) => e.event === 'GAME_WON')).toBe(false);
  });

  it('does NOT declare victory while cities are split between civs', () => {
    engine.cities = [
      { civilizationId: 0, id: 'city_0_0' },
      { civilizationId: 1, id: 'city_1_0' },
    ];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(false);
    expect(engine.isGameOver).toBe(false);
    expect(emitted.some((e) => e.event === 'GAME_WON')).toBe(false);
  });

  it('declares elimination victory once every enemy unit AND city is gone', () => {
    // Civ 0 owns the only city and civ 1's last unit is destroyed → only civ 0
    // remains operational → elimination victory.
    engine.cities = [
      { civilizationId: 0, id: 'city_0_0' },
    ];
    engine.units = [
      { civilizationId: 0 },
    ];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(true);
    const won = emitted.find((e) => e.event === 'GAME_WON');
    expect(won?.data.reason).toBe('elimination');
    expect(won?.data.civName).toBe('Germans');
  });

  it('does NOT declare victory while the barbarian faction is still operational', () => {
    // Once barbarians hold a city they are a real faction (id -1). The human
    // must destroy them too before the game is won.
    engine.civilizations = [makeCiv(0, 'Germans', true), makeCiv(-1, 'Barbarians')];
    engine.units = [{ civilizationId: 0 }];
    engine.cities = [
      { civilizationId: 0, id: 'city_0_0' },
      { civilizationId: -1, id: 'city_barb_0' },
    ];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(false);
    expect(engine.isGameOver).toBe(false);
    expect(emitted.some((e) => e.event === 'GAME_WON')).toBe(false);
  });

  it('still triggers elimination when only one civ survives', () => {
    engine.civilizations = [makeCiv(0, 'Germans')];
    engine.units = [{ civilizationId: 0 }];
    engine.cities = [{ civilizationId: 0, id: 'city_0_0' }];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(true);
    const won = emitted.find((e) => e.event === 'GAME_WON');
    expect(won?.data.reason).toBe('elimination');
  });

  it('does not fire when no cities exist yet', () => {
    engine.cities = [];
    const victory = makeManager(engine);
    const ended = victory.evaluateEndOfTurn();

    expect(ended).toBe(false);
    expect(emitted.some((e) => e.event === 'GAME_WON')).toBe(false);
  });

  it('is a one-shot: after the game ends, further evaluations are no-ops', () => {
    engine.civilizations = [makeCiv(0, 'Germans')];
    engine.units = [{ civilizationId: 0 }];
    engine.cities = [{ civilizationId: 0, id: 'city_0_0' }];
    const victory = makeManager(engine);
    expect(victory.evaluateEndOfTurn()).toBe(true);
    // Second call must not re-emit or re-evaluate.
    emitted = [];
    expect(victory.evaluateEndOfTurn()).toBe(true);
    expect(emitted.length).toBe(0);
  });
});
