# AI Production Profiles & Expansion-First AutoProduction

AutoProduction now gives every civilization a distinct, expansion-leaning
identity, and reacts to key game events immediately.

## Per-civ production profile

Each civ gets a **fixed `productionProfile`** (assigned by civ index at game
start — `GameEngine.createCivilizations` → `getCivProductionProfile` in
`src/game/engine/AITypes.ts`). It reuses the existing `StrategyProfile` union:

| Index | Profile | Expansion cadence (settlers kept on hand) |
|---|---|---|
| 0 | `early_expansion` | 1 per 2 cities (up to 6), +1 while tiny |
| 1 | `military_expansion` | 1 per 3 cities (up to 4) |
| 2 | `science_focus` | 1 per 4 cities (up to 3) |
| 3 | `defensive_turtle` | 1 per 5 cities (up to 3) |
| 4 | `wonder_rush` | 1 per 4 cities (up to 3) |
| 5 | `balanced_growth` | 1 per 3 cities (up to 4), +1 while tiny |

The settler corps is a **scaling target** (`ceil(cities / settlersPerCities)`,
clamped) — expansion **never hard-stops**; a big empire still replaces consumed
settlers instead of freezing at a city cap. Profiles only differ in how fast
they expand.

- `AutoProduction.determineProductionItem` reads the civ's profile
  (`AutoProduction.getStrategyForCiv` → `civ.productionProfile`), so each AI
  builds a different mix of settlers/units/buildings — which shapes its
  behavior.
- Research is **seeded** from the same profile (`AIManager.runAITurn` sets
  `aiState.strategyProfile`), so research starts aligned with production.
  (Full production+research coupling is a later step.)

## Expansion-first

- The first AI city now starts a **settler** (`GameEngine.pickInitialAIProduction`),
  so a capital expands instead of building infrastructure (e.g. a hospital).
- The settler branch in AutoProduction allows `population >= 1` and is tuned
  by `EXPANSION_PARAMS` — `defensive_turtle` is no longer excluded from
  settler production (it expands modestly instead of stagnating at 1 city).
- The old `maxCities` hard ceiling was removed: a civ keeps a settler corps
  proportional to its city count, so expansion continues at every empire size.
- The existing economy unit-cap still stops settler/army spam when the civ
  can't afford upkeep.

## Where a settler is spent: founding vs. public works

Production only decides **how many** settlers a civ has. What each one *does*
is decided in `AIManager.runAITurn`, in this order:

1. **No city may overlap an own city** (a hard rule, all profiles). A city works
   a fixed 5x5 area, so two own cities closer than `MIN_CITY_CENTER_DISTANCE`
   starve each other. `SettlementEvaluator.overlapsOwnCityArea` is the single
   place that answers this; `AIManager.canFoundCityHere` asks it on every
   "just found it here instead of wandering" fallback, which the settlement
   search's own rejection does not cover.
2. **Late infrastructure mode** — for `early_expansion` and `military_expansion`
   only (`LATE_INFRA_PROFILES`), and only past `LATE_INFRA_CITY_THRESHOLD`
   (6) cities. The settler first works the fields of the cities the civ already
   owns and is released to settle only once every own city's area is
   `CITY_AREA_IMPROVED_TARGET` (50 %) improved. Afterwards it may found again,
   but the site has to clear the stricter `LATE_SETTLE_SCORE_THRESHOLD`.
3. Otherwise a settler founds a city whenever a valid site exists.
4. Only with no site at all does it fall back to works, then to joining a city,
   then to exploring.

Tunnable constants live in `AIManager.ts` (see
[`AI_OVERVIEW.md` §5](AI_OVERVIEW.md)).

### Irrigation outside the city area

A city whose own area is fully watered can still gain food, because fresh water
spreads one tile at a time: `pickWorksTileForCity` lets a food-short city's
irrigation start up to `OUTSIDE_IRRIGATION_FIELDS` (3) outside its workable
area, on tiles that satisfy the engine's own canal rule
(`GameEngine.canSupplyIrrigation`). Nothing else — no road, no mine — is built
out there, and only when the serving city is actually short of food
(`EconomicManager.cityFoodBalance`).

## Event-reactive production

`AutoProduction.onGameEvent(eventType, data)` is wired into the engine event
tap in `src/hooks/UseGameEngine.ts`:

- `UNIT_PRODUCED` / `BUILDING_COMPLETED` → top up the city's queue immediately.
- `CITY_CAPTURED` / `CITY_DESTROYED` → re-pick production for the affected
  civ(s) so they rebuild or reinforce.
- `WAR_DECLARED` → re-pick production for both sides (fresh threat eval).
- New research: `TurnManager.processCivilizationResearch` re-picks production
  after a tech completes (newly unlocked units/buildings become available).

## Files

- `types/game.ts` — `AIProductionProfile`, `Civilization.productionProfile`,
  `GameEngine.autoProduction`
- `src/game/engine/AITypes.ts` — `CIV_PRODUCTION_PROFILES`, `getCivProductionProfile`
- `src/game/engine/GameEngine.ts` — profile assignment, settler-first initial production
- `src/game/engine/AutoProduction.ts` — `EXPANSION_PARAMS`, profile-driven
  settler cadence, `onGameEvent`
- `src/game/engine/AIManager.ts` — research seeded from profile
- `src/game/engine/TurnManager.ts` — research completion → production re-pick
- `src/hooks/UseGameEngine.ts` — event tap → `onGameEvent`

Tests: `tests/ai/productionProfiles.test.ts` (+ `tests/aiSimulation.test.ts` and
`tests/humanVsAI.test.ts` seed a scout since the AI now expands before scouting).
