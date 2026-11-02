/**
 * Nomads — the opening visitors. Constants for the whole feature; tuned so
 * the visit lands inside the dead window of turns 4–10 (after the first city,
 * before research unlocks its first choice) and stays a fair deal:
 * the tech price is a real discount on research cost, the hire price is
 * above the units' build cost, and the camp only lingers long enough for the
 * world to race you to it.
 */

/** Earliest round (0-based) the nomads may seek the player. */
export const NOMAD_TRIGGER_ROUND = 4;

/** Fallback trigger: with no city by this round, they visit the settlers. */
export const NOMAD_TRIGGER_FALLBACK_ROUND = 12;

/** The envoy arrives at the court this many rounds after the camp appears. */
export const NOMAD_PARLEY_DELAY_ROUNDS = 2;

/** Camp spawn distance (Chebyshev) from the visited city/units. */
export const NOMAD_SPAWN_MIN_DISTANCE = 9;
export const NOMAD_SPAWN_MAX_DISTANCE = 13;

/** The horde: two spears and a rider — enough to matter, not enough to win. */
export const NOMAD_SPAWN_UNITS = ['warriors', 'warriors', 'scout'] as const;
export const NOMAD_HIRE_COST_FACTOR = 1.1;

/** The tech bargain: half of the raw research cost, clamped. */
export const NOMAD_TECH_PRICE_DIVISOR = 2;
export const NOMAD_TECH_PRICE_MIN = 25;
export const NOMAD_TECH_PRICE_MAX = 100;

/** Fog reveal around the camp when their maps are accepted. */
export const NOMAD_MAP_REVEAL_RADIUS = 10;

/**
 * How long the camp stands after a DEAL (tech/maps taken) — the window in
 * which any civilization, player or AI, may hire the horde. A refusal
 * ("pass in peace") sends them off much sooner.
 */
export const NOMAD_CAMP_LINGER_ROUNDS = 20;
export const NOMAD_PASS_DEPART_ROUNDS = 6;

/** The AI may try to hire from this many rounds after the first parley. */
export const NOMAD_AI_HIRE_MIN_ROUND_GAP = 8;

/** Per-round chance an eligible AI takes the horde, scaled by diplomacy. */
export const NOMAD_AI_HIRE_BASE_CHANCE = 0.1;
export const NOMAD_AI_HIRE_DIPLOMACY_BONUS = 0.04;

/** The parley re-offers when the player stands at the camp after dismissal. */
export const NOMAD_REOFFER_COOLDOWN_ROUNDS = 3;

/** How close (Chebyshev) a player unit must be to re-offer / trigger visit 2. */
export const NOMAD_PROXIMITY_DISTANCE = 2;
