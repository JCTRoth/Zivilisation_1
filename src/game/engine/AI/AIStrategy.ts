import type { EnemyLocation } from '../EnemySearcher';
import type { City, Unit } from '../../../../types/game';
import type { PlayerTurnStorage } from '../GameEngine';
import type GameEngine from '../GameEngine';

const DIFFICULTY_THRESHOLD_MODIFIERS: Record<string, number> = {
  CHIEFTAIN: 1.4,
  WARLORD: 1.2,
  PRINCE: 1,
  KING: 0.85,
  EMPEROR: 0.75
};

const ERA_THRESHOLD_BREAKPOINTS: Array<{ year: number; modifier: number }> = [
  { year: -1000, modifier: 0.85 },
  { year: 0, modifier: 0.95 },
  { year: 1000, modifier: 1.05 },
  { year: 1500, modifier: 1.15 },
  { year: 1750, modifier: 1.25 },
  { year: 1850, modifier: 1.35 }
];

export interface EnemyTargetScoreInput {
  location: EnemyLocation;
  distance: number;
  currentRound: number;
  isCurrentlyVisible?: boolean;
  strategicValue?: number;
  distanceWeight?: number;
  staleAfter?: number;
  /** Number of own combat units within 5 tiles of the target */
  nearbyAlliedUnits?: number;
}

export interface EnemyTargetScoreResult {
  score: number;
  priority: 'city' | 'unit';
}

export function scoreEnemyTarget({
  location,
  distance,
  currentRound,
  isCurrentlyVisible = false,
  strategicValue = 0,
  distanceWeight = 2,
  staleAfter = 12,
  nearbyAlliedUnits = 0,
}: EnemyTargetScoreInput): EnemyTargetScoreResult {
  const typeBias = location.type === 'city' ? 60 : 35;
  const recencyAge = Math.max(0, currentRound - (location.lastSeenRound ?? location.discoveredRound));
  const freshnessWindow = Math.max(4, staleAfter);
  const recencyScore = Math.max(0, freshnessWindow - recencyAge) * 2;
  const visibilityBonus = isCurrentlyVisible ? 8 : 0;
  const distancePenalty = distance * distanceWeight;
  // Bonus for targets we can converge on with multiple units
  const convergenceBonus = Math.min(nearbyAlliedUnits * 4, 20);
  const score = typeBias + recencyScore + visibilityBonus + strategicValue + convergenceBonus - distancePenalty;

  return {
    score,
    priority: location.type === 'city' ? 'city' : 'unit'
  };
}

export interface CityThreatSample {
  distance: number;
  strength: number;
  type?: 'unit' | 'city';
  col?: number;
  row?: number;
}

export interface CityThreatInput {
  city: Pick<City, 'id' | 'col' | 'row'>;
  samples: CityThreatSample[];
  garrisonStrength: number;
  defensiveBonus?: number;
  dangerThreshold?: number;
  falloff?: number;
}

export interface CityThreatAssessment {
  cityId: string;
  pressure: number;
  netThreat: number;
  needsDefense: boolean;
  closestSample?: CityThreatSample;
}

export function assessCityThreat({
  city,
  samples,
  garrisonStrength,
  defensiveBonus = 0,
  dangerThreshold = 1,
  falloff = 1.5
}: CityThreatInput): CityThreatAssessment {
  let pressure = 0;
  let closestSample: CityThreatSample | undefined;

  for (const sample of samples) {
    const distanceFactor = (sample.distance + 1) * falloff;
    const typeBias = sample.type === 'city' ? 1.5 : 1;
    pressure += (sample.strength * typeBias) / distanceFactor;

    if (!closestSample || sample.distance < closestSample.distance) {
      closestSample = sample;
    }
  }

  const netThreat = pressure - (garrisonStrength + defensiveBonus);
  const needsDefense = netThreat >= dangerThreshold;

  return {
    cityId: city.id,
    pressure,
    netThreat,
    needsDefense,
    closestSample
  };
}

export function calculateDangerThreshold(currentYear: number, difficulty: string = 'PRINCE'): number {
  const diffKey = difficulty?.toUpperCase?.() ?? 'PRINCE';
  const difficultyModifier = DIFFICULTY_THRESHOLD_MODIFIERS[diffKey] ?? 1;

  const eraModifier = ERA_THRESHOLD_BREAKPOINTS.reduce((modifier, breakpoint) => {
    if (currentYear >= breakpoint.year) {
      return breakpoint.modifier;
    }
    return modifier;
  }, 0.8);

  const threshold = Math.max(0.5, 1 * difficultyModifier * eraModifier);
  return parseFloat(threshold.toFixed(2));
}

export function computeCityGarrisonStrength(gameEngine: GameEngine, city: City, civilizationId: number, radius: number = 2): number {
  if (!gameEngine?.squareGrid) {
    return 0;
  }

  return gameEngine.units
    .filter((unit: Unit) => unit.civilizationId === civilizationId)
    .filter((unit: Unit) => gameEngine.squareGrid!.squareDistance(unit.col, unit.row, city.col, city.row) <= radius)
    .reduce((total: number, unit: Unit) => total + Math.max(1, unit.defense || unit.attack || 1), 0);
}

export function collectCityThreatSamples(
  gameEngine: GameEngine,
  city: City,
  civilizationId: number,
  storage: PlayerTurnStorage,
  roundNumber: number,
  maxDistance: number = 8
): CityThreatSample[] {
  if (!gameEngine?.squareGrid) {
    return [];
  }

  const samples: CityThreatSample[] = [];

  for (const unit of gameEngine.units as Unit[]) {
    if (unit.civilizationId === civilizationId) continue;
    const distance = gameEngine.squareGrid.squareDistance(unit.col, unit.row, city.col, city.row);
    if (distance > maxDistance) continue;
    samples.push({
      distance,
      strength: Math.max(1, unit.attack || 1),
      type: 'unit',
      col: unit.col,
      row: unit.row
    });
  }

  if (storage?.enemyLocations) {
    for (const enemyList of storage.enemyLocations.values()) {
      for (const location of enemyList) {
        const age = roundNumber - (location.lastSeenRound ?? location.discoveredRound);
        if (age > 18) continue;
        const distance = gameEngine.squareGrid.squareDistance(location.col, location.row, city.col, city.row);
        if (distance > maxDistance) continue;
        samples.push({
          distance,
          strength: location.type === 'city' ? 5 : 2,
          type: location.type,
          col: location.col,
          row: location.row
        });
      }
    }
  }

  return samples;
}
