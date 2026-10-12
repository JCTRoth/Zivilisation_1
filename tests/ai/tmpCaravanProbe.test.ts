/**
 * Ad-hoc caravan diagnostic (NOT a test — vitest.config.js excludes `tmp*`).
 *   npx vitest run --config vitest.diag.config.ts tests/ai/tmpCaravanProbe.test.ts
 *
 * Follows every AI caravan's life: how many are produced, how far they walk, how
 * many die, how many deliver. Answers "where does the trade-route system leak".
 */
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import GameEngine from '@/game/engine/GameEngine';
import { Pathfinding } from '@/game/engine/Pathfinding';
import { describe, it, expect } from 'vitest';
import { useSeededRandom } from '../helpers/world';

const ROUNDS = Number(process.env.PROBE_ROUNDS ?? 150);
const SEEDS = (process.env.PROBE_SEEDS ?? '7').split(',').map(Number);

describe('caravan probe', () => {
  it('follows the caravans', async () => {
    const out = console.info.bind(console);
    for (const seed of SEEDS) {
      useSeededRandom(seed);
      const log = console.log; const warn = console.warn; const err = console.error;
      console.log = () => {}; console.warn = () => {}; console.error = () => {};
      const engine = new GameEngine(null);
      (engine as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
      await engine.initialize({
        numberOfCivilizations: 4, mapType: 'AI_VS_AI', devMode: true,
        startingGold: 50, mapSeed: seed,
      });
      const active = engine.civilizations.filter((c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID);

      let produced = 0, died = 0, delivered = 0, deathByEnemy = 0;
      const travel = new Map<string, { dist: number; turns: number; lastCol: number; lastRow: number; home: string }>();
      const prevOSC = engine.onStateChange;
      engine.onStateChange = (type: string, data: any, ...rest: unknown[]) => {
        if (type === 'UNIT_PRODUCED' && (data?.unit?.type ?? data?.itemType) === 'caravan') produced++;
        else if (type === 'UNIT_DEFEATED' && data?.unit?.type === 'caravan') {
          died++;
          const u = data.unit;
          if (u.civilizationId !== u.lastAttackedBy) deathByEnemy++;
        } else if (type === 'TRADE_ROUTE_ESTABLISHED') delivered++;
        return typeof prevOSC === 'function' ? (prevOSC as (...a: unknown[]) => unknown)(type, data, ...rest) : undefined;
      };

      let i = 0;
      while (engine.turnManager.getRoundNumber() < ROUNDS && i < ROUNDS * 12 && !engine.isGameOver) {
        i++;
        for (const civ of active) {
          engine.turnManager.startTurn(civ.id);
          engine.activePlayer = civ.id;
          if (civ.isAI) { try { await engine.processAITurn(civ.id); } catch { /* ignore */ } }
          if (engine.turnManager.getPhase() && engine.turnManager.getPhase() !== 'END') {
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
            await engine.turnManager.nextPhase();
          }
        }
        // Sample caravan positions and how much ground they cover per turn.
        for (const u of engine.units) {
          if (u.type !== 'caravan' || u.isDefeated) continue;
          const key = u.id;
          const prev = travel.get(key);
          if (!prev) {
            travel.set(key, { dist: 0, turns: 0, lastCol: u.col, lastRow: u.row, home: String(u.homeCityId ?? '?') });
          } else {
            const step = Math.max(Math.abs(u.col - prev.lastCol), Math.abs(u.row - prev.lastRow));
            if (step > 0) { prev.dist += step; prev.turns += 1; }
            prev.lastCol = u.col; prev.lastRow = u.row;
          }
        }
      }
      console.log = log; console.warn = warn; console.error = err;

      const entries = [...travel.values()];
      const totalDist = entries.reduce((n, e) => n + e.dist, 0);
      const totalMovingTurns = entries.reduce((n, e) => n + e.turns, 0);
      const roadsOnPath = (() => {
        // How much of the world is roaded at all: the caravan's speed depends on it.
        let roaded = 0; let total = 0;
        for (const t of engine.map.tiles) { total++; if (t.improvement === 'road' || t.improvement === 'railroad') roaded++; }
        return { roaded, total };
      })();
      const cost = (t: { improvement?: string | null; type?: string; terrain?: string } | null | undefined): number =>
        Pathfinding.getMovementCost(t as never, 'caravan');

      out(`\n### CARAVAN seed=${seed} rounds=${engine.turnManager.getRoundNumber()}`);
      out(`produced=${produced} delivered=${delivered} died=${died} (killed in combat: ${deathByEnemy})`);
      out(`caravans seen=${entries.length} tilesTravelled=${totalDist} movingTurns=${totalMovingTurns} tilesPerMovingTurn=${(totalDist / Math.max(1, totalMovingTurns)).toFixed(2)}`);
      out(`world: roaded tiles ${roadsOnPath.roaded}/${roadsOnPath.total}`);
      const sample = engine.map.tiles.find((t) => !t.improvement);
      if (sample) out(`movement cost: raw land=${cost(sample)}, roaded≈${cost({ ...sample, improvement: 'road' })}`);
      expect(true).toBe(true);
    }
  }, 1800000);
});
