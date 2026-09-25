/**
 * Regression test for "AI scouts don't explore" (21:09 AI-vs-AI session +
 * live browser repro): scouts were produced but froze forever.
 *
 * Root cause (fixed): a stale AI turn from the PREVIOUS player kept running
 * during the current player's turn — checkAndEndTurnIfNoMoves could re-entrantly
 * advance the phase chain mid-AI-turn, and the stale AI turn's completion
 * advanced the CURRENT player's phases (skipping their unit movement). The
 * turn-overlap guard then stopped every unit, freezing all scouts.
 *
 * Fixes:
 *  - TurnManager.aiTurnInProgress flag: checkAndEndTurnIfNoMoves defers while
 *    an AI turn is running.
 *  - runAIUnitMovementPhase's completion only advances phases if the current
 *    player is still the AI civ whose turn this was (stale resolutions no-op).
 *  - runAITurn re-checks activePlayer after its start delay and aborts if the
 *    turn moved on.
 *
 * This test drives real AI turns and asserts each civ's scout moves while the
 * other civ's scout stays put (no cross-civ unit processing).
 */
import { describe, expect, it, afterEach } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { useSeededRandom } from '../helpers/world';

describe('AI-vs-AI scouts explore', () => {
  let engine: GameEngine | null = null;

  afterEach(() => {
    if (engine) {
      (engine as unknown as { units: unknown[] }).units = [];
      (engine as unknown as { cities: unknown[] }).cities = [];
      (engine as unknown as { civilizations: unknown[] }).civilizations = [];
      engine = null;
    }
  });

  it('each civ moves only its own scout; scouts keep moving turn after turn', async () => {
    engine = new GameEngine(null);
    (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
    // Pause BEFORE initialize so startTurn defers and no AI auto-loop races us.
    (engine as unknown as { isPaused: boolean }).isPaused = true;

    // Pinned world + RNG: this test used to fail at random because the map was
    // generated with Date.now() and every roll differed. A regression gate that
    // is red one run in five is worse than no gate.
    useSeededRandom(7);
    await engine.initialize({
      numberOfCivilizations: 2,
      mapType: 'AI_VS_AI',
      devMode: false,
      startingGold: 100,
      mapSeed: 20260101,
    });
    for (const civ of engine.civilizations) {
      civ.isHuman = false;
      civ.isAI = true;
    }

    // Found each civ's capital from its starting settler and spawn a scout on
    // a passable, unoccupied tile adjacent to the capital.
    const scoutIds: string[] = [];
    for (let civId = 0; civId < engine.civilizations.length; civId++) {
      const settler = engine.units.find((u) => u.type === 'settler' && u.civilizationId === civId);
      if (settler) engine.foundCityWithSettler(settler.id);
      const capital = engine.cities.find((c) => c.civilizationId === civId);
      // Pick a passable neighbor of the capital that is free of units/cities.
      let col = -1, row = -1;
      for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const c = (capital?.col ?? 0) + dc;
        const r = (capital?.row ?? 0) + dr;
        const t = engine.getTileAt(c, r);
        const passable = !t || t.type === 'ocean' || t.type === 'mountains'
          ? false
          : (engine.isTilePassable ? engine.isTilePassable(c, r) : true);
        if (passable && !engine.getUnitAt(c, r) && !engine.getCityAt(c, r)) { col = c; row = r; break; }
      }
      if (col < 0) { col = capital?.col ?? 0; row = (capital?.row ?? 0) + 1; }
      const scout = {
        id: `scout_${civId}_test`,
        type: 'scout',
        civilizationId: civId,
        col,
        row,
        health: 1,
        movesRemaining: 2,
        maxMoves: 2,
        isVeteran: false,
        attack: 0,
        defense: 0,
        icon: 'scout',
        orders: 'none',
        homeCityId: capital?.id ?? '',
        areTurnsDone: false,
        isSkipped: false,
      };
      engine.units.push(scout as never);
      scoutIds.push(scout.id);
    }

    const pos = (id: string) => {
      const u = engine!.units.find((x) => x.id === id);
      return u ? `${u.col},${u.row}` : 'gone';
    };

    // Play three AI turns for each civ. During civ X's turn, civ Y's scout
    // must never move (no cross-civ unit processing), and over the rounds each
    // scout must move at least once.
    const moved = new Set<number>();
    for (let round = 0; round < 3; round++) {
      for (let civId = 0; civId < engine.civilizations.length; civId++) {
        const myBefore = pos(scoutIds[civId]);
        const otherId = scoutIds[(civId + 1) % 2];
        const otherBefore = pos(otherId);
        (engine as unknown as { activePlayer: number }).activePlayer = civId;
        (engine as unknown as { isPaused: boolean }).isPaused = false;
        await engine.aiManager.processAITurn(civId);
        (engine as unknown as { isPaused: boolean }).isPaused = true;
        // Cross-civ movement is the bug — it must NEVER happen.
        expect(pos(otherId), `civ ${civId} turn must not move civ ${(civId + 1) % 2}'s scout`).toBe(otherBefore);
        if (pos(scoutIds[civId]) !== myBefore) moved.add(civId);
      }
    }

    // Every civ's scout must have explored at least once.
    for (let civId = 0; civId < engine.civilizations.length; civId++) {
      expect(moved.has(civId), `civ ${civId} scout should have moved during its own turns`).toBe(true);
    }
  }, 60000);
});
