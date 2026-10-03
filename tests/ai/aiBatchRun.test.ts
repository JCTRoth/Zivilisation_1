
import { describe, it, expect } from 'vitest';
import GameEngine from '@/game/engine/GameEngine';
import { BARBARIAN_CIV_ID } from '@/data/VillageConstants';

const ROUNDS = 300;
const CIVS = 4;
const MAP_TYPE = "AI_VS_AI";
const SEEDS = [7,19,33];

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
        // 'DIPLOMACY] Civ' catches every war declaration, whichever system
        // declared it. 'declares war' is the AI military-rush line only, so on
        // its own it cannot show what the diplomacy model is doing.
        // The diplomacy outcomes, which are the point of the model: a system
        // that only reports wars cannot tell restraint from paralysis.
        for (const key of [
          'Invasion —', 'declares war', 'DIPLOMACY] Civ',
          'DIPLOMACY] Peace between', 'DIPLOMACY] Ceasefire between', 'DIPLOMACY] Alliance between',
          'DIPLOMACY] Treaty signed', 'DIPLOMACY] Cancelled', 'refused their last',
          'colony', 'ferry', 'disband', 'Revolt', 'anarchy',
        ]) {
          if (s.includes(key)) logCounts[key] = (logCounts[key] ?? 0) + 1;
        }
      };

      const e = new GameEngine(null);
      (e as unknown as { sleep: () => Promise<void> }).sleep = () => Promise.resolve();
      // Count tile improvements — the long-term lever behind city growth.
      const counters = { improvementsBuilt: 0, improvementTurns: 0 };
      const prevOSC = e.onStateChange;
      e.onStateChange = (type: string, data: unknown, ...rest: unknown[]) => {
        if (type === 'IMPROVEMENT_BUILT') counters.improvementsBuilt++;
        if (type === 'IMPROVEMENT_WORK_STARTED') counters.improvementTurns++;
        return typeof prevOSC === 'function'
          ? (prevOSC as (...a: unknown[]) => unknown)(type, data, ...rest)
          : undefined;
      };
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
        citySnapshots: 0,
        maxCityPop: 0,
        maxCitySpecialists: 0,
        specialistSnapshots: 0,
        improvementsBuilt: 0,
        improvedTilesNearCities: 0,
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
              economy.citySnapshots++;
              if ((city.population ?? 0) > economy.maxCityPop) economy.maxCityPop = city.population ?? 0;
              const spec = (city.specialists ?? []).length;
              economy.specialistSnapshots += spec;
              if (spec > economy.maxCitySpecialists) economy.maxCitySpecialists = spec;
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
      economy.improvementsBuilt = counters.improvementsBuilt;
      // Improvements inside 4 tiles of one of this civ's cities — the ones
      // that actually feed and pay for the city.
      const improveNear = (civId: number) => {
        const cities = e.cities.filter((c: { civilizationId: number }) => c.civilizationId === civId);
        let n = 0;
        for (const t of e.map.tiles) {
          if (!t.improvement) continue;
          if (cities.some((c: { col: number; row: number }) =>
            Math.max(Math.abs(t.col - c.col), Math.abs(t.row - c.row)) <= 4)) n++;
        }
        return n;
      };
      economy.improvedTilesNearCities = active.reduce((sum: number, c: { id: number }) => sum + improveNear(c.id), 0);

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

    require('node:fs').writeFileSync("/tmp/ai-batch-3.json", JSON.stringify(results));
    orig('BATCH_DONE ' + results.length);
    expect(true).toBe(true);
  }, 750000);
});
