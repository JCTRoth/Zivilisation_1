// Types for the Game Progression export (INFO menu → Download Game Progression List).
// Kept in types/ per repo convention; consumed by src/utils/GameProgression.ts.
// The export is compact by design so an LLM can analyse it:
//  - progression is delta-encoded (summary.encoding === 'delta')
//  - cities use the slim CompactCity shape
//  - log contains only analysis-relevant, de-duplicated events
import type { CompactCity } from '../src/utils/CitySnapshots';

/** Compact, JSON-safe unit state captured at periodic world snapshots. */
export interface CompactUnit {
  id: string;
  type: string;
  civilizationId: number;
  col: number;
  row: number;
  movesRemaining?: number;
  health?: number;
  hitPoints?: number;
  maxHitPoints?: number;
  attack?: number;
  defense?: number;
  maintenance?: number;
  foodSupport?: number;
  shieldSupport?: number;
  experience?: number;
  veteran?: boolean;
  fortified?: boolean;
  sleeping?: boolean;
  workTarget?: string | null;
  workTurns?: number;
  homeCityId?: string | null;
  noneUnit?: boolean;
}

/** Complete unit/city listing emitted on a configured snapshot turn. */
export interface ProgressionWorldSnapshot {
  units: CompactUnit[];
  cities: CompactCity[];
}

/** Full per-civ state for one round (used as the delta baseline). */
export interface ProgressionCivSnapshot {
  id: number;
  name: string;
  leaderName: string;
  color: string;
  isHuman: boolean;
  alive: boolean;
  /** Victory score (engine's score field). */
  score: number;
  /** Treasury (cumulative gold). */
  gold: number;
  /** Gold income per turn (sum of city tax output). */
  goldPerTurn: number;
  /** Beakers per turn (rate-based science output). */
  science: number;
  /** Commerce per turn. */
  trade: number;
  /** Shields per turn (city yields). */
  production: number;
  /** Food per turn (city yields). */
  food: number;
  taxRate: number;
  scienceRate: number;
  luxuryRate: number;
  government: string;
  cities: number;
  /** Slim per-player city list (one entry per city owned by this civ). */
  cityData: CompactCity[];
  /** Total population across all cities. */
  population: number;
  units: number;
  /** Aggregate military strength (attack + 0.5×defense across units). */
  military: number;
  technologies: number;
  techList: string[];
  /** Id (or name) of the tech currently being researched. */
  currentResearch: string | null;
  researchProgress: number;
  warWith: string[];
  /** Number of world wonders built. */
  wonders: number;
  /** Current AI production/research strategy profile, when available. */
  strategy?: string;
  /** Unit counts by concrete unit type (e.g. { warrior: 2, scout: 1 }). */
  unitComposition?: Record<string, number>;
  personality: Record<string, number>;
  priorities?: Record<string, unknown>;
}

/**
 * Delta-encoded per-round civ entry: fields omitted in a round are carried
 * forward unchanged from the previous round. The per-round scoreboard
 * (score/gold/science/trade/production/food/population/military/wonders) and
 * `cityData` are always emitted.
 */
export interface ProgressionCivDelta {
  id: number;
  name?: string;
  leaderName?: string;
  color?: string;
  isHuman?: boolean;
  alive?: boolean;
  score?: number;
  gold: number;
  goldPerTurn?: number;
  science: number;
  trade?: number;
  production?: number;
  food?: number;
  taxRate?: number;
  scienceRate?: number;
  luxuryRate?: number;
  government?: string;
  cities?: number;
  cityData: CompactCity[];
  population?: number;
  units?: number;
  military?: number;
  technologies?: number;
  techList?: string[];
  currentResearch?: string | null;
  researchProgress?: number;
  warWith?: string[];
  wonders?: number;
  strategy?: string;
  unitComposition?: Record<string, number>;
  personality?: Record<string, number>;
  priorities?: Record<string, unknown>;
}

export interface ProgressionRound {
  round: number;
  year: number;
  yearLabel: string;
  civs: Record<string, ProgressionCivDelta>;
  snapshot?: ProgressionWorldSnapshot;
}

export interface GameProgressionMeta {
  sessionId: string;
  mapType: string;
  difficulty: string;
  numberOfCivilizations: number;
  playerCivilization: number;
  startedAt: string;
  exportedAt: string;
}

export interface GameProgressionSummary {
  roundsRecorded: number;
  civilizations: string[];
  /** 'delta' — civ fields omitted in a round are carried forward. */
  encoding: 'delta';
  eventCounts: Record<string, number>;
}

/** One round's city-building snapshot (every 50 rounds). */
export interface CityBuildingOverview {
  round: number;
  year: number;
  cities: Array<{ civ: string; city: string; population: number; buildings: string[] }>;
}

/** One round's treasury snapshot (every 50 rounds). */
export interface FinanceOverview {
  round: number;
  year: number;
  civilizations: Array<{
    civ: string;
    gold: number;
    goldPerTurn: number;
    science: number;
    trade: number;
    production: number;
    food: number;
    techs: string[];
    /** Research TECH ID — never the Technology object (it prints "[object Object]"). */
    research: string | null;
  }>;
}

export interface GameProgressionPayload {
  meta: GameProgressionMeta;
  summary: GameProgressionSummary;
  progression: ProgressionRound[];
  /** Present on exports written from a live game; absent on older files. */
  cityBuildingOverviews?: CityBuildingOverview[];
  financeOverviews?: FinanceOverview[];
  log: ProgressionLogEntry[];
}

/** A log entry after export-time filtering/slimming (city payloads stripped). */
export interface ProgressionLogEntry {
  ts: string;
  round: number;
  player: number;
  event: string;
  message: string;
  detail: Record<string, unknown>;
}
