/**
 * DemographicsManager — Civ1-style demographics computations.
 *
 * All metric formulas live here; the UI layer (StatisticsModal) should only
 * read the returned data and render it — zero game-logic in the component.
 */
import { BUILDING_TYPES } from '../../data/BuildingConstants';
import type { Civilization, City } from '../../../types/game';

export const numberValue = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

const hasBuilding = (c: City, building: string): boolean => {
  const b = c.buildings;
  if (!b) return false;
  return b.includes(building);
};

// ── Single-metric helpers (exported for unit tests) ────────────────────────

/** Civ1 triangular population: Size × (Size + 1) / 2 × 10,000 */
export const civ1Population = (size: number): number =>
  Math.round((size * (size + 1)) / 2) * 10_000;

/** Empire-wide "real" population across all of a civ's cities. */
export const realPopulation = (civId: number, cities: City[]): number =>
  cities
    .filter(c => c.civilizationId === civId)
    .reduce((sum, c) => sum + civ1Population(numberValue(c.population)), 0);

/** GNP = Taxes + Luxuries before upkeep (Civ1 definition). */
export const gnp = (civ: Civilization): number => {
  const trade = numberValue(civ.resources?.trade);
  const tax = Math.floor(trade * (numberValue(civ.taxRate ?? 50) / 100)) * 2;
  const luxury = Math.floor(trade * (numberValue(civ.luxuryRate ?? 0) / 100));
  return tax + luxury;
};

/** Mfg. Goods — cumulative raw production (shields) across all cities. */
export const mfgGoods = (civId: number, cities: City[]): number =>
  cities
    .filter(c => c.civilizationId === civId)
    .reduce((sum, c) => sum + numberValue(c.yields?.production ?? c.production), 0);

/** Land Area — explored tiles × scaling factor. */
export const landArea = (explored: boolean[]): number =>
  explored.filter(Boolean).length * 100;

/** Literacy — % of population in cities with Library or University. 0% if tech not researched. */
export const literacy = (civId: number, cities: City[], techs: string[]): number => {
  if (!techs.includes('literacy')) return 0;
  const civCities = cities.filter(c => c.civilizationId === civId);
  const total = civCities.reduce((s, c) => s + numberValue(c.population), 0);
  if (total === 0) return 0;
  const literatePop = civCities
    .filter(c => hasBuilding(c, BUILDING_TYPES.LIBRARY) || hasBuilding(c, BUILDING_TYPES.UNIVERSITY))
    .reduce((s, c) => s + numberValue(c.population), 0);
  return Math.round((literatePop / total) * 100);
};

/** Approval — happy / (happy + unhappy) × 100. */
export const approval = (civId: number, cities: City[]): number => {
  let happy = 0;
  let unhappy = 0;
  for (const c of cities.filter(c => c.civilizationId === civId)) {
    happy += numberValue(c.happiness);
    unhappy += numberValue(c.unhappiness);
  }
  return happy + unhappy === 0 ? 50 : Math.round((happy / (happy + unhappy)) * 100);
};

/** Pollution — industrial output squared / 100 per city. */
export const pollution = (civId: number, cities: City[]): number =>
  cities
    .filter(c => c.civilizationId === civId)
    .reduce((sum, c) => {
      const p = numberValue(c.yields?.production ?? c.production);
      return sum + Math.floor((p * p) / 100);
    }, 0);

/** Disease — base 10% per city, reduced by Aqueducts/Granaries, increased by pollution. */
export const disease = (civId: number, cities: City[]): number => {
  const cc = cities.filter(c => c.civilizationId === civId);
  if (cc.length === 0) return 0;
  let total = 0;
  for (const c of cc) {
    let d = 10;
    if (hasBuilding(c, BUILDING_TYPES.AQUEDUCT)) d -= 5;
    if (hasBuilding(c, BUILDING_TYPES.GRANARY)) d -= 3;
    const p = numberValue(c.yields?.production ?? c.production);
    d += Math.floor((p * p) / 1000);
    total += Math.max(0, d);
  }
  return Math.round(total / cc.length);
};

/** Life Expectancy — base 40 years, boosted by Aqueducts, Granaries, Hospitals. */
export const lifeExpectancy = (civId: number, cities: City[]): number => {
  const cc = cities.filter(c => c.civilizationId === civId);
  if (cc.length === 0) return 40;
  let total = 0;
  for (const c of cc) {
    let le = 40;
    if (hasBuilding(c, BUILDING_TYPES.AQUEDUCT)) le += 3;
    if (hasBuilding(c, BUILDING_TYPES.GRANARY)) le += 1;
    if (hasBuilding(c, BUILDING_TYPES.HOSPITAL)) le += 5;
    total += Math.max(30, Math.min(80, le));
  }
  return Math.round(total / cc.length);
};

/** Family Size — baseline 3.0, boosted by Granaries and food surplus. */
export const familySize = (civId: number, cities: City[]): number => {
  const cc = cities.filter(c => c.civilizationId === civId);
  if (cc.length === 0) return 3.0;
  let total = 0;
  for (const c of cc) {
    let f = 3.0;
    if (hasBuilding(c, BUILDING_TYPES.GRANARY)) f += 0.2;
    const food = numberValue(c.yields?.food ?? c.food);
    if (food - numberValue(c.population) * 2 > 0) f += 0.1;
    total += f;
  }
  return Math.round((total / cc.length) * 10) / 10;
};

/** Military Service — years of conscription based on government type. */
export const militaryService = (civ: Civilization): number => {
  const gov = String(civ.government ?? 'despotism').toLowerCase();
  return gov === 'republic' || gov === 'democracy' ? 1 : 2;
};

/** Annual Income — gold per capita. */
export const annualIncome = (gold: number, population: number): number =>
  population > 0 ? Math.round((gold * 1_000_000) / population) : 0;

/** Productivity — production per citizen × 100. */
export const productivity = (civId: number, cities: City[]): number => {
  const cc = cities.filter(c => c.civilizationId === civId);
  const totalPop = cc.reduce((s, c) => s + numberValue(c.population), 0);
  if (totalPop === 0) return 0;
  const totalProd = cc.reduce((s, c) => s + numberValue(c.yields?.production ?? c.production), 0);
  return Math.round((totalProd / totalPop) * 100);
};

// ── Rank & ordinal helpers ──────────────────────────────────────────────────

export const ordinal = (n: number): string =>
  n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;

export const rankByValue = (entries: Array<{ id: number; value: number }>): Map<number, number> => {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const ranks = new Map<number, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i].value < sorted[i - 1].value) currentRank = i + 1;
    ranks.set(sorted[i].id, currentRank);
  }
  return ranks;
};

// ── Composite types ─────────────────────────────────────────────────────────

export interface DemographicRow {
  label: string;
  value: number;
  unit: string;
  fmt: 'int' | 'pct' | 'float';
  metric: string;
}

export interface DemographicData {
  civId: number;
  civName: string;
  civColor: string;
  rows: DemographicRow[];
}

export interface DemographicsResult {
  /** Per-civilization demographic rows. */
  all: DemographicData[];
  /** Per-metric rank maps (metric → Map<civId, rank>). */
  ranks: Record<string, Map<number, number>>;
  /** Per-metric 1st-place value and civ name; `allEqual` is true when every civ has the same value. */
  topValues: Record<string, { value: number; civName: string; allEqual: boolean }>;
}

// ── Main computation entry point ────────────────────────────────────────────

/**
 * Compute full demographics for every alive civilization.
 * Called once per render via useMemo; all heavy work is here, not in the UI.
 */
export const computeDemographics = (
  civilizations: Civilization[],
  cities: City[],
  explored: boolean[],
): DemographicsResult => {
  const all: DemographicData[] = civilizations.map(civ => {
    const pop = realPopulation(civ.id, cities);
    const g = gnp(civ);
    const rows: DemographicRow[] = [
      { label: 'Approval Rating', value: approval(civ.id, cities), unit: '%', fmt: 'pct', metric: 'approval' },
      { label: 'Population', value: pop, unit: '', fmt: 'int', metric: 'population' },
      { label: 'GNP', value: g, unit: 'million', fmt: 'int', metric: 'gnp' },
      { label: 'Mfg. Goods', value: mfgGoods(civ.id, cities), unit: 'Mtons', fmt: 'int', metric: 'mfg' },
      { label: 'Land Area', value: landArea(explored), unit: 'sq. miles', fmt: 'int', metric: 'landArea' },
      { label: 'Literacy', value: literacy(civ.id, cities, civ.technologies ?? []), unit: '%', fmt: 'pct', metric: 'literacy' },
      { label: 'Disease', value: disease(civ.id, cities), unit: '%', fmt: 'pct', metric: 'disease' },
      { label: 'Pollution', value: pollution(civ.id, cities), unit: 'tons/yr', fmt: 'int', metric: 'pollution' },
      { label: 'Life Expectancy', value: lifeExpectancy(civ.id, cities), unit: 'years', fmt: 'int', metric: 'lifeExpectancy' },
      { label: 'Family Size', value: familySize(civ.id, cities), unit: 'children', fmt: 'float', metric: 'familySize' },
      { label: 'Mil. Service', value: militaryService(civ), unit: 'years', fmt: 'int', metric: 'milService' },
      { label: 'Annual Income', value: annualIncome(g, pop), unit: 'per capita', fmt: 'int', metric: 'annualIncome' },
      { label: 'Productivity', value: productivity(civ.id, cities), unit: '%', fmt: 'pct', metric: 'productivity' },
    ];
    return { civId: civ.id, civName: civ.name, civColor: civ.color, rows };
  });

  // Compute per-metric ranks
  const metrics = all[0]?.rows.map(r => r.metric) ?? [];
  const ranks: Record<string, Map<number, number>> = {};
  for (const m of metrics) {
    ranks[m] = rankByValue(all.map(d => ({ id: d.civId, value: d.rows.find(r => r.metric === m)?.value ?? 0 })));
  }

  // Compute per-metric 1st-place values
  const topValues: Record<string, { value: number; civName: string; allEqual: boolean }> = {};
  for (const m of metrics) {
    const values = all.map(d => d.rows.find(r => r.metric === m)?.value ?? 0);
    const sorted = all
      .map(d => ({ value: d.rows.find(r => r.metric === m)?.value ?? 0, civName: d.civName }))
      .sort((a, b) => b.value - a.value);
    if (sorted.length > 0) {
      const allEq = values.every(v => v === sorted[0].value);
      topValues[m] = { ...sorted[0], allEqual: allEq };
    }
  }

  return { all, ranks, topValues };
};
