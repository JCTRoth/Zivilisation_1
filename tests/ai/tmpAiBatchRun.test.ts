/**
 * NOTE (recovery): the working-tree copy of this file disappeared during a
 * session on 2026-10-04. This content was restored from VS Code local history
 * (snapshot of 2026-09-26, originally `tmpAiBatch.test.ts`) — if your editor
 * buffer holds newer edits, re-save them over this file.
 */
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';
import GameEngine from '@/game/engine/GameEngine';
import { describe, it, expect } from 'vitest';


const ROUNDS = 200;
const CIVS = 4;
const MAP_TYPE = "AI_VS_AI_NAVAL";
const SEEDS = [7,19,33,51,64,88];

interface CivSnapshot {
  id: number;
  name: string;
  alive: boolean;
  cities: number;
  pop: number;
  units: number;
  military: number;
  techs: number;
  gold: number;
  tax: number;
  science: number;
  luxury: number;
  ferries: number;
  ships: number;
  profile: string;
}

describe('ai batch', () => {
  it('plays the batch', async () => {
    const orig = console.log;
    const results: unknown[] = [];

    for (const seed of SEEDS) {
      const logCounts: Record<string, number> = {};
      console.log = (...a: unknown[]) => {
        const s = String(a[0] ?? '');
        // Only the interesting AI lines; the engine is far too chatty to keep.
        for (const key of ['Invasion —', 'declares war', 'colony', 'ferry', 'disband', 'Revolt', 'anarchy']) {
          if (s.includes(key)) logCounts[key] = (logCounts[key] ?? 0) + 1;
        }
      };

      const e = new GameEngine(null);
      (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
      await e.initialize({
        numberOfCivilizations: CIVS,
        mapType: MAP_TYPE,
        devMode: true,
        startingGold: 50,
        mapSeed: seed,
      });
      const active = e.civilizations.filter((c) => c.isAlive !== false && c.id !== BARBARIAN_CIV_ID);

      const timeline: Array<{ round: number; civs: CivSnapshot[]; totalGold: number; bankrupt: number }> = [];
      let economy = {
        bankruptCivTurns: 0,
        totalDisbands: 0,
        rateFlips: 0,
        negativeGoldRounds: 0,
        buildings: {} as Record<string, number>,
        unitProductions: 0,
        cityProductions: 0,
        disorderRounds: 0,
        minGold: Infinity,
      };
      const lastRates = new Map<number, string>();

      let i = 0;
      while (e.turnManager.getRoundNumber() < ROUNDS && i < ROUNDS * 12 && !e.isGameOver) {
        i++;
        for (const civ of active) {
          e.turnManager.startTurn(civ.id);
          e.activePlayer = civ.id;
          if (civ.isAI) {
            try { await e.processAITurn(civ.id); } catch { /* state shows the damage */ }
          }
          if (e.turnManager.getPhase() && e.turnManager.getPhase() !== 'END') {
            await e.turnManager.nextPhase();
            await e.turnManager.nextPhase();
            await e.turnManager.nextPhase();
          }
        }

        const round = e.turnManager.getRoundNumber();
        if (round % 5 === 0) {
          const civs: CivSnapshot[] = active.map((c) => {
            const cities = e.cities.filter((x) => x.civilizationId === c.id);
            const units = e.units.filter((u) => u.civilizationId === c.id && !u.isDefeated);
            const gold = c.resources?.gold ?? 0;
            if (gold < 0) economy.bankruptCivTurns++;
            if (gold < economy.minGold) economy.minGold = gold;
            const rateKey = String(c.taxRate) + '/' + String(c.scienceRate) + '/' + String(c.luxuryRate);
            if (lastRates.has(c.id) && lastRates.get(c.id) !== rateKey) economy.rateFlips++;
            lastRates.set(c.id, rateKey);
            for (const city of cities) {
              if (city.currentProduction?.itemType) {
                if (city.currentProduction.type === 'unit') economy.unitProductions++;
                else economy.cityProductions++;
              }
              for (const b of city.buildings ?? []) {
                economy.buildings[b] = (economy.buildings[b] ?? 0) + 1;
              }
              if (city.disorder) economy.disorderRounds++;
            }
            return {
              id: c.id,
              name: c.name,
              alive: c.isAlive !== false,
              cities: cities.length,
              pop: cities.reduce((n, x) => n + (x.population ?? 0), 0),
              units: units.length,
              military: units.reduce((n, u) => n + (u.attack ?? 0) + (u.defense ?? 0) * 0.5, 0),
              techs: (c.technologies ?? []).length,
              gold,
              tax: c.taxRate ?? 0,
              science: c.scienceRate ?? 0,
              luxury: c.luxuryRate ?? 0,
              profile: String(c.productionProfile ?? ''),
              ferries: units.filter((u) => u.type === 'ferry').length,
              ships: units.filter((u) => (u as { type?: string }).type !== undefined && ['sail', 'galley', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer', 'cruiser', 'battleship'].includes(u.type as string)).length,
            };
          });
          const totalGold = civs.reduce((n, c) => n + c.gold, 0);
          if (totalGold < 0) economy.negativeGoldRounds++;
          timeline.push({
            round,
            civs,
            totalGold,
            bankrupt: civs.filter((c) => c.gold < 0).length,
          });
        }
      }
      console.log = orig;
      if (economy.minGold === Infinity) economy.minGold = 0;

      const final = active.map((c) => {
        const cities = e.cities.filter((x) => x.civilizationId === c.id);
        const units = e.units.filter((u) => u.civilizationId === c.id && !u.isDefeated);
        return {
          id: c.id,
          name: c.name,
          alive: c.isAlive !== false,
          cities: cities.length,
          pop: cities.reduce((n, x) => n + (x.population ?? 0), 0),
          units: units.length,
          military: units.reduce((n, u) => n + (u.attack ?? 0) + (u.defense ?? 0) * 0.5, 0),
          techs: (c.technologies ?? []).length,
          gold: c.resources?.gold ?? 0,
          profile: String(c.productionProfile ?? ''),
          ferries: units.filter((u) => u.type === 'ferry').length,
          ships: units.filter((u) => ['sail', 'galley', 'trireme', 'caravel', 'frigate', 'ironclad', 'destroyer', 'cruiser', 'battleship'].includes(u.type as string)).length,
        };
      });

      results.push({
        seed,
        rounds: e.turnManager.getRoundNumber(),
        gameOver: e.isGameOver === true,
        civs: final,
        economy,
        logCounts,
        timeline,
      });
    }

    require('node:fs').writeFileSync("/tmp/naval-batch.json", JSON.stringify(results));
    orig('BATCH_DONE ' + results.length);
    expect(true).toBe(true);
  }, 1500000);
});
