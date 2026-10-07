# World Wonders — Data Format & System Guide

The wonder system is fully **data-driven**: every wonder is one entry in a
single table, and no engine or UI code needs to change to add another wonder.

## Files

| Layer | File | Responsibility |
|---|---|---|
| **Data** | `src/data/WonderData.ts` | The 22 wonder definitions, typed effects, status classification, obsolescence helper |
| **Compatibility bridge** | `src/data/BuildingConstants.ts` (`WONDER_PROPERTIES`) | Adapts the wonder data to the `BuildingProperties` shape older code (AI valuation, victory scoring, sell protection) still reads |
| **Ownership / rules** | `src/game/engine/WonderManager.ts` | Who owns what, world-uniqueness, obsolescence, continent queries, construction gates |
| **Effect engine** | `src/game/engine/WonderEffects.ts` | Computes the actual modifiers (science %, happiness, trade squares, movement, vision, gates…) |
| **UI** | `src/components/ui/gamemodals/WonderCompletedModal.tsx`, `WonderConflictModal.tsx`, `WondersOverview.tsx`, `WonderArtwork.tsx` | Completion screen, production-conflict popup, overview + Civilopedia entry, shared credited artwork |
| **Styles** | `src/styles/wonders.css` | Status colours, artwork + credit lines, overview ledger layout |
| **Docs** | this file | Data format reference |

## The wonder record

```ts
// src/data/WonderData.ts
export interface WonderDefinition {
  id: string;                  // stable snake_case id — lives in city.buildings
  name: string;                // display name
  cost: number;                // fixed shield cost, 200–600
  maintenance: number;         // ALWAYS 0 for wonders
  requiredTechnology: string;  // tech id required to START building it
  obsoleteBy: string | null;   // tech id that kills the effect (null = never)
  era: 'antiquity' | 'middle' | 'industrial';  // FLAVOUR ONLY — no mechanics
  icon: string;                // emoji placeholder icon
  image: string;               // 'assets/wonders/<id>.png' — art added later
  shortEffect: string;         // one-liner (city screen, production list)
  effectText: string;          // full plain-language mechanics (completion screen)
  flavor: string;              // short historical text
  facts: string[];             // "Did you know?" facts for the Civilopedia entry
  effects: WonderEffect[];     // typed effect list consumed by WonderEffects
}
```

### Adding a new wonder

1. Append one object to `WONDERS` in `src/data/WonderData.ts`.
2. Nothing else — production gates, overview screen, completion screen,
   Civilopedia entry, AI scoring, save/load and victory scoring all read the
   table (tests in `tests/wonderData.test.ts` verify the invariants).

## Effect model

Effects are a **typed union** so the engine can switch on `kind` and the
compiler rejects unknown shapes:

| `kind` | Scope options | Meaning |
|---|---|---|
| `tradePerTradeSquare` | `city`, `civilization` | +N trade on every worked tile that already produces trade (Colossus, Statue of Liberty) |
| `sciencePercent` | `city`, `civilization`, `continent` | +X% science for cities in scope (Great Library, SETI, Copernicus, ISS, AI Supercluster) |
| `productionPercent` | `continent` | +X% production (AI Supercluster) |
| `productionFlat` | `continent` (+ optional `requiresNoPowerPlant`) | +N production (Hoover Dam) |
| `happiness` | `city`, `civilization`, `continent` | +N happiness per city in scope (Human Genome Project, Hanging Gardens, Atomium) |
| `unhappyToContent` | `city`, `continent` | Converts up to N unhappy citizens to content (Shakespeare, J.S. Bach) |
| `buildingHappinessMultiplier` | `civilization` | Multiplies one building's happiness (Oracle ×2 Temple, Michelangelo ×1.5 Cathedral) |
| `buildingScienceMultiplier` | `civilization` | Multiplies listed buildings' science (Isaac Newton: Library/University ×2) |
| `navalMovement` | `civilization` | +N movement for the owner's sea units (Lighthouse, Magellan) |
| `visionRange` | `civilization` | +N sight radius for owner units/cities (Silk Road) |
| `governmentAnarchyTurns` | `civilization` | Revolution length in turns (Pyramids: 1 instead of 3) |
| `autoUpgradeUnits` | `civilization` | Obsolete units upgrade automatically (Leonardo — paths in `UNIT_UPGRADE_PATHS`, `src/data/UnitConstants.ts`) |
| `enableSpaceship` | `global` | Opens the Moonshot space race once the ISS exists |
| `enableNuclear` | `global` | Manhattan Project allows nuclear weapons for every civ with the tech |
| `revealAllCities` | `civilization` | Owner sees every city on the map (ISS) |

**Scope resolution** (`WonderEffects.covers`):

- `city` — only the wonder's own city
- `civilization` — every city of the wonder's owner
- `continent` — the owner's cities on the **same landmass as the wonder city**
  (`GameEngine.getLandmassId`)
- `global` — a gate that is ON worldwide once the wonder exists anywhere

## Rules and where they live

| Rule | Implementation |
|---|---|
| Buildable once in the whole game | `TurnManager.addBuildingToCity` claims or rejects; `ProductionManager.canBuildItem` refuses to start completed wonders (`wonder_already_completed`) |
| Multiple simultaneous builders allowed | Gates only check COMPLETED wonders — races are legal |
| Loser's shields wasted, city idle | `TurnManager.completeProduction` → conflict branch: production cancelled, progress zeroed, queue kept, `WONDER_PRODUCTION_CONFLICT` emitted |
| Gold purchase conflict | Refund of the purchase price in `processTurnEvents` |
| No maintenance | `maintenance: 0` in every record; derived `WONDER_PROPERTIES` mirrors it |
| Cannot be sold | `GameEngine.sellBuilding` rejects anything in `WONDER_PROPERTIES` |
| Capture transfers ownership | Wonder lives in `city.buildings`; `destroyBuildingsOnCapture` exempts `WONDER_PROPERTIES` entries |
| Obsolescence (any civ, live) | `WonderManager.isObsolete` reads all civs' `technologies` on demand — no cached flags, no events |
| Obsolete wonders can't be started | `canBuildItem` → `wonder_obsolete`; AI gets `obsoleteWonders` in its game state |
| Effects stop when obsolete | Every effect query goes through `activeWondersOf` / `isWonderObsolete` |
| Score bonus | `VictoryManager.calculateScore` counts `WONDER_PROPERTIES` entries (20 points each) |
| Save/load | No extra state: wonders persist inside `city.buildings` (and `city.wonders`) |

### Events

| Event | Emitted when | Consumed by |
|---|---|---|
| `WONDER_COMPLETED` | A city claims a wonder | `EngineEventRouter` → celebration dialog queue (suppressed in AI-vs-AI runs), store refresh, game log |
| `WONDER_PRODUCTION_CONFLICT` | A human city finished a wonder somebody else already completed | `EngineEventRouter` → conflict dialog queue (human cities only) |
| `BUILDING_COMPLETED` | Also emitted for wonders | AI auto-production queue upkeep, snapshots, logs |

Both dialogs are **queued** (`wonderDialogQueue` in the store), so wonders
finished in the same turn appear one after another.

## UI map (spec → screen)

| Spec feature | Where |
|---|---|
| A. Wonder completion screen | `WonderCompletedModal` — confetti, reserved artwork area, effect text, flavour, Continue; opened via `uiState.activeDialog === 'wonder-completed'` |
| B. Wonders overview | World → Statistics → **Wonders** tab, and World menu → **Wonders** (`WondersOverview` + `WonderEntryModal`); statuses: 🟩 owned / 🟦 building / 🟨 contested / 🟥 rival / ⬜ locked |
| C. City screen | Buildings tab → Wonders section (icon, name, one-line effect, obsolete tag) |
| D. Production conflict modal | `WonderConflictModal` — required message + **Go to City** / **Close** |
| E. Production menu + side panel | Production selection modal → **Wonders** tab: status column, availability, click-to-select detail panel (effect, cost, tech, obsolescence, flavour) |
| Civilopedia | `WonderEntryModal`: mechanics, history, "Did you know?" facts |

### Artwork

Every screen renders real artwork through the shared `WonderArtwork` component,
which reads `wonder.image` (`assets/wonders/<file>`) from `public/assets/wonders/`
and falls back to a styled placeholder with the wonder's emoji if a file is ever
missing. Each Wikimedia image carries a visible credit line (author + licence +
link to the file page) because most of them are CC BY / CC BY-SA; images supplied
by the project owner show only the "Read more on Wikipedia" link.

Fourteen of the 22 images come from Wikimedia Commons and are public domain or
freely licensed; the other eight (Colossus, Great Library, Hanging Gardens,
Lighthouse, Oracle, Magellan's Expedition, Shakespeare's Theatre, Leonardo's
Workshop) are the project owner's own artwork and have no external source.
Provenance for each file is listed in
`public/assets/wonders/CREDITS.txt` and mirrored in the `WONDER_ARTWORK_CREDITS`
table in `src/data/WonderData.ts`. When adding or replacing an image, update all
three places (`WONDERS[].image`, the credits table, `CREDITS.txt`); for own
artwork, drop the `sourceUrl` / `author` / `license` fields instead of inventing
them.

## Obsolete-by design decisions

- The three ages are **documentation only** (`era` field, overview grouping).
- The Moonshot tech is gated behind the ISS ("enables spaceship"): this game
  has no spaceship parts, so the space race (Moonshot victory) is the space
  victory the ISS unlocks.
- Nuclear weapons: the Manhattan Project is a **global** gate — any civ's
  completion lets every civ that researched Nuclear Power build nukes.
- Leonardo's upgrade paths are plain data (`UNIT_UPGRADE_PATHS`) and only
  convert combat units whose replacement tech the owner already has.

## Tests

| File | Covers |
|---|---|
| `tests/wonderData.test.ts` | Data invariants, tech existence, status colours, bridge integrity |
| `tests/wonderConstruction.test.ts` | Completion, race/conflict, idle city, gates, refund, sell block, save persistence |
| `tests/wonderCapture.test.ts` | Wonder survives capture, ownership + effects transfer |
| `tests/wonderObsolescence.test.ts` | Live obsolescence by ANY civ, effects off, wonder kept, start blocked |
| `tests/wonderEffects.test.ts` | Every effect kind incl. scopes, stacking, global gates, Leonardo, naval movement reset, anarchy |
| `tests/wonderUI.test.ts` | Status classification from store data; dialog queue behaviour through the real event router |
| `tests/martialLaw.test.ts` | Wonder happiness integration with the happiness total |
