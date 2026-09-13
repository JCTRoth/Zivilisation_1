import { describe, it, expect, beforeEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';

/**
 * A city with nothing in production but something it could still build must
 * keep the turn open: auto-end would silently waste its shields. The engine
 * reports these cities so the UI can point the player at them.
 *
 * Cities with Auto Production ON are exempt — their queue is managed for them,
 * so an empty queue there is not the player's decision to make.
 */
describe('Idle city keeps the turn open', () => {
  let engine: GameEngine;
  let emitted: { type: string; data?: Record<string, unknown> }[];

  beforeEach(async () => {
    engine = new GameEngine(null);
    (engine as any).sleep = () => Promise.resolve();
    emitted = [];
    engine.onStateChange = (type: string, data?: Record<string, unknown>) => {
      emitted.push({ type, data });
    };

    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'MANY_CITIES',
      devMode: false,
      startingGold: 100,
    });
  });

  /** Leave the player with no movable units so only the city gate decides. */
  const clearMovableHumanUnits = () => {
    (engine as any).units = (engine as any).units.filter((u: any) => u.civilizationId !== 0);
    (engine as any).unitTurnQueue?.clearQueue?.(0);
  };

  const humanCities = () => engine.cities.filter((c: any) => c.civilizationId === 0);

  it('reports a manually managed city that has nothing in production', () => {
    const city = humanCities()[0];
    expect(city).toBeTruthy();
    (city as any).autoProduction = false;
    (city as any).currentProduction = null;
    (city as any).buildQueue = [];

    const awaiting = engine.getCitiesAwaitingProduction(0);
    expect(awaiting.map((c) => c.id)).toContain(city.id);
  });

  it('never reports cities with Auto Production on, or ones already producing', () => {
    const city = humanCities()[0];
    (city as any).currentProduction = null;
    (city as any).buildQueue = [];

    (city as any).autoProduction = true;
    expect(engine.getCitiesAwaitingProduction(0)).toEqual([]);

    (city as any).autoProduction = false;
    (city as any).currentProduction = { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 };
    expect(engine.getCitiesAwaitingProduction(0)).toEqual([]);

    (city as any).currentProduction = null;
    (city as any).buildQueue = [{ type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 }];
    expect(engine.getCitiesAwaitingProduction(0)).toEqual([]);
  });

  it('does not auto-end and emits CITY_PRODUCTION_IDLE for an idle city', () => {
    clearMovableHumanUnits();
    const city = humanCities()[0];
    (city as any).autoProduction = false;
    (city as any).currentProduction = null;
    (city as any).buildQueue = [];

    (engine as any).checkAndEndTurnIfNoMoves('test-idle-city');

    expect(emitted.map((e) => e.type)).not.toContain('CHECK_AUTO_END_TURN');
    const idleEvent = emitted.find((e) => e.type === 'CITY_PRODUCTION_IDLE');
    expect(idleEvent).toBeTruthy();
    expect(idleEvent!.data?.cityIds).toContain(city.id);
  });

  it('auto-ends when the human city is already producing', () => {
    clearMovableHumanUnits();
    for (const city of humanCities()) {
      (city as any).autoProduction = false;
      (city as any).currentProduction = { type: 'unit', itemType: 'warrior', name: 'Warrior', cost: 10 };
      (city as any).buildQueue = [];
    }

    (engine as any).checkAndEndTurnIfNoMoves('test-producing');

    expect(emitted.map((e) => e.type)).toContain('CHECK_AUTO_END_TURN');
    expect(emitted.map((e) => e.type)).not.toContain('CITY_PRODUCTION_IDLE');
  });
});
