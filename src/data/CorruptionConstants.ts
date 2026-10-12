// Corruption constants — the distance curve and how buildings cut into it.
//
// These live in `src/data/` because they are balance numbers: the README's rule
// is that every number the engine reads lives in one place, and this file is
// where the corruption curve is tuned. `CityUtils.calculateCorruption` reads
// them; nothing else does.

/**
 * Distance (Euclidean, tiles from the capital) that adds one full step of
 * corruption. A city 10 tiles out pays the full multiplier.
 */
export const CORRUPTION_DISTANCE_STEP = 10;

/**
 * Ceiling on the distance multiplier.
 *
 * Civ1 scaled corruption with distance without a hard cap; this caps it at 1.5
 * rather than the 2.0 it used to reach, because 2.0 put a 60 % bite on a city
 * five cities away in a straight line — which on a 40×40 map is most of the
 * empire, and no amount of Courthouses made a second city worth founding.
 */
export const MAX_CORRUPTION_DISTANCE_MULTIPLIER = 1.5;

/**
 * Buildings that reduce corruption, read from `BUILDING_PROPERTIES[...]
 * .effects.corruptionReduction`.
 *
 * The declared value is a MULTIPLIER on the corruption rate: 0.5 halves it
 * (marketplace, bank, palace), 0.8 leaves a fifth (courthouse, stock exchange).
 * That reading is the one the engine already implemented for the Courthouse
 * (it halved corruption by hand), so honouring the table keeps that building
 * exactly as strong as it was and makes the other four real instead of inert.
 *
 * The palace is listed through the building table like any other — it is the
 * capital's own building, and a capital has no distance corruption to cut.
 */
export const CORRUPTION_REDUCTION_BUILDINGS: readonly string[] = [
  'courthouse',
  'marketplace',
  'bank',
  'palace',
  'stock_exchange',
];
