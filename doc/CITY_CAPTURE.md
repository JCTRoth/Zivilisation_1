# City Capture & Destruction

Civ I–style: military units that step onto an enemy city tile capture (or, at
size 1, raze) the city. Both the **human** and the **AI** use the same engine
path (`GameEngine.moveUnit` → `resolveCityCombat`).

## Mechanics (`GameEngine.resolveCityCombat`)

- **Attacker strength** = `attack × (health / 100)` (civilians with attack 0 have
  zero strength — they cannot take a city).
- **City defense** = population, **tripled** by `city_walls` — but air units
  (fighters/bombers) and siege artillery (cannon/artillery, the Howitzer
  stand-ins) **ignore the walls entirely**.
- Win roll: `Math.random() * (attack + defense) < attack`.
- **Win vs pop > 1** → city captured, then the full Civ I aftermath runs:
  1. **Population −1** and `civilizationId` switches to the attacker.
  2. **Building destruction** — city walls NEVER survive a capture; one more
     random non-palace, non-wonder building is destroyed per population lost.
     Wonders and the Palace survive (a captured capital still loses its Palace
     and `GovernmentManager.ensureCapital` designates a replacement).
  3. **Gold plundering** — 20% of the defender's treasury (capped at 100) is
     transferred to the capturer.
  4. **Garrison destroyed** — every unit of the old owner standing on the city
     tile is wiped out.
  5. **Production reset** — `currentProduction`, `buildQueue`, and stored
     progress are cleared.
  6. **Unrest** — the city gets `capturedTurns = 5`; captured citizens count as
     extra unhappy until the penalty fades, so fresh captures tend toward
     disorder unless garrisoned/managed.
  - The attacker unit is consumed and `CITY_CAPTURED` fires.
- **Win vs pop == 1** → city is **razed** (removed), garrison destroyed, attacker
  consumed, `CITY_DESTROYED` event (capital handling as above).
- **Loss** → attacker takes 25 damage (may be defeated), city keeps its owner —
  but an **unwalled** city has a 50% chance to lose a citizen to the failed
  attack; city walls fully shield the population.
- **Instant capture after clearing the garrison** — in `combatUnit`, when the
  last defender on an enemy city tile falls, the city is captured immediately
  (a garrisoned city can no longer be left permanently untouchable).
- Civilian unit types (`settler`, `worker`, `caravan`, `diplomat`, `scout`) are
  blocked from attacking cities (`civilian_cannot_attack_city`).
- Attacking a city auto-declares war if the two civs are not already at war.

## AI behaviour

The AI already targeted cities reactively (its 5-tile enemy scan includes cities
and `moveUnit` handles the capture), but two gaps made it dormant in real games:

1. **No AI personality on engine civs** — engine civs are plain objects and never
   got a `personality`, so `DiplomacyManager.processAIDiplomacy` always fell back
   to an all-5 profile → the AI could **never declare war on its own**.
   - Fix: `AITypes.getCivPersonality(profile)` maps each production profile to a
     deterministic personality; `GameEngine.createCivilizations` now assigns it
     (e.g. `military_expansion` → aggression 8, `defensive_turtle` → aggression 2).
2. **War-for-conquest declaration** — `processAIDiplomacy` now lets
   military-leaning civs attack a weaker neighbour without needing
   aggression ≥ 7 + hostile attitude:
   - `military_expansion`: declares war at ≥ 1.6× military strength
   - `balanced_growth`: declares war at ≥ 2.0×
   - other profiles stay peaceful until provoked (classic aggression ≥ 7 + hostile
     path is retained).

Once at war, the AI captures cities via the existing pipeline: scout-discovered
enemy cities feed `enemyLocations` → `updateOffensivePlan` assigns combat units →
they march onto the city tile → `resolveCityCombat`.

## Events

- `CITY_ATTACKED` / `CITY_CAPTURED` / `CITY_DESTROYED` — consumed by
  `AutoProduction` (re-picks production for the affected civs), `GameLogger`,
  `GameProgression` and `CitySnapshots`.

## Tests

- `tests/cityCapture.test.ts` — capture, raze, capital re-establishment,
  civilian block, weak-attacker loss, walls tripling defense, air units ignoring
  walls, building destruction on capture, gold plundering, garrison destruction,
  production reset + unrest flag, instant capture after clearing the garrison,
  failed-attack population loss vs wall protection, wall obsolescence, and the
  happiness unrest penalty — plus an end-to-end AI test where the AI declares
  war on its own and captures the city in one turn.
- `tests/ai/DiplomacyManager.test.ts` — "AI war for conquest" (military_expansion
  declares war when strong; defensive_turtle does not).
- `tests/ai/productionProfiles.test.ts` — personalities match production profiles.
