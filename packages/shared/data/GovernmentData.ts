/**
 * Government types and their economic modifiers for the Tax/Science/Luxury
 * rate system. Mirrors Civ1: each government caps/penalizes rates, corruption,
 * commerce output and happiness in different ways.
 *
 * NOTE: Revolution/switching UI is out of scope — `civ.government` is set to
 * 'despotism' at game start and `setGovernment()` is provided for future use.
 */

export interface GovernmentProperties {
  name: string;
  /** Maximum allowed taxRate (percent). Democracy caps at 10. */
  maxTaxRate: number;
  /** Base corruption rate applied to distance-from-capital trade loss. */
  corruptionRate: number;
  /** Multiplier on total city commerce (e.g. communism: -25%). */
  commercePenalty: number;
  /** Extra happiness granted to every city of this government. */
  happinessBonus: number;
  /** When true, all three rates are forced to 0 (anarchy). */
  forcesZeroRates: boolean;
  description: string;
}

export const GOVERNMENTS: Record<string, GovernmentProperties> = {
  despotism: {
    name: 'Despotism',
    maxTaxRate: 100,
    corruptionRate: 0.3,
    commercePenalty: 0,
    happinessBonus: 0,
    forcesZeroRates: false,
    description: 'No rate caps; high corruption; no happiness bonus.',
  },
  monarchy: {
    name: 'Monarchy',
    maxTaxRate: 100,
    corruptionRate: 0.25,
    commercePenalty: 0,
    happinessBonus: 1,
    forcesZeroRates: false,
    description: 'Slightly less corruption; small happiness bonus.',
  },
  republic: {
    name: 'Republic',
    maxTaxRate: 100,
    corruptionRate: 0.15,
    commercePenalty: 0,
    happinessBonus: 2,
    forcesZeroRates: false,
    description: 'Low corruption; solid happiness bonus.',
  },
  democracy: {
    name: 'Democracy',
    maxTaxRate: 10,
    corruptionRate: 0.05,
    commercePenalty: 0,
    happinessBonus: 4,
    forcesZeroRates: false,
    description: 'Tax rate capped at 10%; minimal corruption; large happiness bonus.',
  },
  communism: {
    name: 'Communism',
    maxTaxRate: 100,
    corruptionRate: 0.1,
    commercePenalty: 0.25,
    happinessBonus: 1,
    forcesZeroRates: false,
    description: 'Low corruption but -25% city commerce.',
  },
  anarchy: {
    name: 'Anarchy',
    maxTaxRate: 0,
    corruptionRate: 0.3,
    commercePenalty: 0,
    happinessBonus: 0,
    forcesZeroRates: true,
    description: 'All rates forced to 0 until a new government is chosen.',
  },
};

export function getGovernment(id: string | undefined): GovernmentProperties {
  return GOVERNMENTS[id ?? 'despotism'] ?? GOVERNMENTS.despotism;
}
