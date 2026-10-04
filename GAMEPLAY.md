# Civilization I - Browser Clone

A faithful recreation of Sid Meier's Civilization I (1991) built with React, Vite, and HTML5 Canvas.

> [!IMPORTANT]
> **This file is a player-facing summary, and it is known to lag behind the code.**
> The authoritative source for every number is
> [`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc) — terrain yields, unit stats,
> costs, the full 45-technology tree, and the economy/combat/research formulas.
>
> Corrections applied to this file: the Huns are named correctly, there are two
> victory conditions rather than three, the unit and terrain tables now match
> `src/data/`, and the mechanics that are **not** implemented (veteran units,
> housing caps, several wonders) are called out as such. Anything still marked
> below as approximate should be checked against `GAME_RULES.adoc` before you
> rely on it.

## 🎮 Game Overview

Build a lasting empire from 4000 BC to 2100 AD through urban development, technological advancement, diplomacy, exploration, and warfare. Compete against 2-7 other civilizations led by famous historical figures.

## 🏛️ Civilizations

Choose from 14 historical civilizations:

- **Americans** (Abraham Lincoln)
- **Aztecs** (Montezuma)
- **Babylonians** (Hammurabi)
- **Chinese** (Mao Tse Tung)
- **Egyptians** (Ramesses II)
- **English** (Elizabeth I)
- **French** (Napoleon Bonaparte)
- **Germans** (Frederick the Great)
- **Greeks** (Alexander the Great)
- **Indians** (Mahatma Gandhi)
- **Huns** (Dschingis Khan)
- **Romans** (Julius Caesar)
- **Russians** (Joseph Stalin)
- **Zulus** (Shaka)

Choosing a civilization currently changes only your colour, leader portrait and
city-name list. There is no per-civ gameplay advantage.

## 🎯 Victory Conditions

There are exactly **two**. Both are checked at the end of every turn.

### Moonshot Victory
Research `Moonshot` (requires Space Flight) and you win immediately — as does
any AI that gets there first. This is the only space-race content in the game;
there is no spaceship to build and no Apollo Program.

### Elimination Victory
Be the last civilization still *operational* — owning at least one unit or one
city. A rival with a single surviving unit keeps the game running; there is no
"capture every city" shortcut.

You lose when your civilization is eliminated, or when an AI wins while you are
still alive.

**There is no score victory.** The Civ I score is calculated every turn and shown
on the scoreboard and in the exported CSV, but it does not end the game. See
[`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc) for the exact score formula.

## 📜 Core Mechanics

### City Management

**Founding Cities**
- Use Settler units to found new cities on suitable terrain
- City placement affects resources, defense, and growth potential
- AI cities keep a 5-tile minimum gap. **You may found cities adjacent to your own.**

**City Growth**
- Cities grow by accumulating food surplus
- The threshold is `(population + 1) × 10`, so size 1 needs 20 food, size 2 needs 30
- Each citizen eats 2 food; each of your settlers eats 1 (2 under Republic/Democracy)
- **There is no housing cap.** An Aqueduct does not gate city size.
- Starvation (food box below zero) costs 1 population, even while the city is in disorder
- At population 0 the city is destroyed

**Production**
- Cities produce units, buildings, or wonders
- Production rate depends on terrain, population, and improvements
- A Granary does not lower the threshold — it keeps **half the food box** on
  growth. Without one, the box empties and the excess is lost.
- A Settler that completes in a size-1 city **destroys that city**, unless the
  difficulty is Chieftain

### City: Production Basics

- Resource: Shields (production points) — used to build units and improvements.
- Rule: Each city can construct one unit or improvement at a time.
- Shield Accumulation: At the end of each turn, the city adds its total production (shields) to the current project's progress.
- Completion: When accumulated shields >= project cost, the unit or improvement is completed and spawned/applied in the city. Any excess shields carry over to the next project.
- Settler shield tax: under **Republic** and **Democracy**, each of your own settlers costs the city 1 shield per turn. Every other government pays nothing.
- Unit Support: Every unit with a home city costs 1 gold per turn in upkeep. If you cannot pay, units are disbanded — non-defenders first, then scouts, then highest maintenance. A Fisher Boat on an active route is never disbanded.


**Happiness**
- Citizens are Happy, Content, or Unhappy
- Too many unhappy citizens cause disorder — a disordered city produces **no** tax, science, luxury or commerce
- Your government's *tolerance* is how many can be unhappy before rioting
- Temples, Colosseums, Cathedrals, Mass Transit and some wonders improve happiness
- Martial law (military units in city, or fortified beside it) can suppress unhappiness: 4 in Despotism, 3 in Monarchy and Communism, **1** in Republic and Democracy
- Every city keeps at least **1** garrisoned unit, and **2** while an offensive is under way
- Entertainer specialists give +2 luxury each

### Technology Tree

**Research System**
- Choose which technology to research each turn
- Research speed depends on total science output from cities
- Technologies unlock new units, buildings, and wonders
- Libraries give +1 science and +1 culture; Universities +2 science
- **Cost is not a flat number.** It scales with map size (a bigger map is
  harder), difficulty (Emperor is *easier* than Chieftain), how far ahead you
  are, how many civs you have met, and how many prereqs are missing
- Research is **locked for the first 5 rounds**
- Science produced with nothing selected is banked and spent on your next pick

**The actual tree**
There are **45** technologies, 8 of them available from the start: Pottery,
Bronze Working, Alphabet, The Wheel, Masonry, Sailing, Ceremonial Burial and
Horseback Riding. There is no Feudalism, Chivalry, Invention, Steam Engine,
Rocketry or Nuclear Fission in this codebase.

The full tree with costs, prerequisites and what each one actually unlocks is in
[`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc). The mechanics are in
[`doc/TECHNOLOGY_RESEARCH.md`](doc/TECHNOLOGY_RESEARCH.md).

### Military Units

**33 unit types**, each with **2 hit points**. Stats are `attack / defense /
movement`. The complete table is in
[`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc); a few to know:

- **Settler** (0/1/1) - Founds and joins cities, builds improvements, sight 3
- **Warrior** (1/1/1) - Basic military unit
- **Scout** (0.5/1/2) - Cannot attack. Moves 2, sight 2. Can sneak into an undefended enemy city with a 30% chance
- **Archer** (3/2/1) - Ranged infantry
- **Phalanx** (1/2/1) - Defensive infantry (requires Bronze Working)
- **Legion** (3/1/1) - Roman heavy infantry (requires Iron Working)
- **Knights** (4/2/2) - Fast cavalry (requires Horseback Riding)
- **Cavalry** (5/2/3) - Late cavalry (requires Horseback Riding)
- **Chariot** (4/2/2) - Ancient mobile unit (requires The Wheel)
- **Catapult** (6/1/1) - Siege, **ignores city walls** (requires Mathematics)
- **Riflemen** (3/5/1) - Best defensive gunpowder unit (requires Gunpowder)
- **Musketeer** (3/3/1) - Gunpowder unit (requires Gunpowder)
- **Trireme** (3/2/4) - Early warship (requires Map Making)
- **Battleship** (18/12/4) - Strongest ship (requires Steel)
- **Ferry** (0/0/3) - Carries 3 units
- **Fisher Boat** (0/1/2) - Needs a Harbor building

There is no Horsemen and no Pikemen unit in this codebase. The Chariot is not
a transport, and neither is the Trireme — use a **Ferry**, which costs 30
shields and carries 3 units.

**Combat**
- `winChance = attackerStrength / (attackerStrength + defenderStrength)`
- Attacker strength = `attack × health/100`
- Defender strength = `defense × health/100 × terrain × (×1.5 if fortified or in a friendly city) × (×2 with a Fortress)`
- Terrain defence: forest, river, lake, jungle, swamp ×1.5; hills ×2; mountains ×3
- Fortified units: ×1.5
- **Only the loser takes damage** — 25 HP, or death outright if the attacker outgunned the defender or the defender was already at 25 HP
- Cities with walls: `max(1, population) × 3`
- Catapult, Cannon, Artillery and all air units ignore city walls
- Garrison units die **one per round**; the city only falls once the garrison is empty
- A city at population 1 is razed; otherwise it is captured at population −1
- The attacker takes `min(floor(treasury × 0.2), 100)` in plunder
- Attacking auto-declares war, and the war cascades to the defender's allies

**Unit Experience**
- **Not implemented.** The `isVeteran` field and its UI badge exist, but every
  unit is created with it `false` and the combat formula has no veteran term.
  Do not plan around veterans.

### Terrain & Improvements

**13 terrain types.** Yield is `food / production / trade`.

- **Grassland** - 2/1/0, movement 1, defence ×1
- **Plains** - 1/1/0, movement 1, defence ×1
- **Desert** - 0/1/0, movement 1, defence ×1
- **Tundra** - 1/0/0, movement 1, defence ×1
- **Arctic** - 0/0/0, movement 2, defence ×1
- **Forest** - 1/2/0, movement 2, defence ×1.5
- **Jungle** - 1/0/0, movement 2, defence ×1.5
- **Swamp** - 1/0/0, movement 2, defence ×1.5
- **Hills** - 1/0/0, movement 2, defence ×2
- **Mountains** - 0/1/0, movement **3**, defence ×3
- **Ocean** - 1/0/2, impassable to land units
- **River** - 2/0/1, navigable, fordable if 1 tile wide
- **Lake** - 2/0/1, **impassable to everyone**, ships included

A city centre gets a floor of **2 food / 1 production / 1 trade**, plus +1
trade if the city sits on a river.

**Special resources** add to the terrain yield: Gems and Gold are +4 trade,
Oil is +4 production, an Oasis is +3 food, Coal and Horses are +2 production,
Seal/Fish/Game are +2 food.

**Terrain Improvements**
- **Irrigation** - +1 food; converts forest→plains, jungle→grassland, swamp→grassland. Needs orthogonally adjacent fresh water. 5 worker-turns on open ground, **15** in forest/jungle/swamp
- **Road** - Movement cost ×1/3, and **+1 trade on grassland, plains and desert only** — not "any trade-producing terrain"
- **Railroad** - Movement cost **0.05** (not 0), and +0.5 to **all three** yields. Requires the Railroad technology *and* an existing road
- **Mines** - **+3 production on hills, +1 on mountains** (not +1 for both). Converts grassland and plains to forest
- **Fortress** - Defence ×2. Requires Construction. **It does not heal units.**
- **Pollution** - −1 to all three yields and health. Not built by settlers; cleared by a unit for 2 movement points

Worker-turns vary by terrain, from 2 to 15. The full matrix is in
[`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc).

### Wonders of the World

**10 wonders**, all with 0 upkeep. There is **no Colossus, no Great Library, no
Copernicus' Observatory, no Isaac Newton's College and no Apollo Program** in
this codebase.

- **Lighthouse** (200, Map Making) - +1 trade
- **Great Wall** (300, Masonry) - +1 global defence, +2 culture
- **Hanging Gardens** (300, Ceremonial Burial) - +1 global happiness, +2 culture
- **Oracle** (300, Philosophy) - +2 science, +2 culture
- **Pyramids** (300, Masonry) - +3 culture
- **Magellan's Voyage** (400, Navigation) - +2 naval movement, exploration
- **Michelangelo's Chapel** (400, Monotheism) - +3 culture
- **Newton's University** (400, University) - +3 science
- **United Nations** (600, Democracy) - diplomacy, +2 culture
- **Women's Suffrage** (600, Democracy) - +2 happiness, +2 culture

[CAUTION]
====
A wonder's *effects* are declared in `BuildingConstants.ts` but only some are
read by the engine. The culture, global-defence and naval-movement terms in
particular are currently data, not behaviour. Check
`src/data/BuildingConstants.ts` before relying on one.
====

### Government Types

Tolerance is how many citizens can be unhappy before the city disorders.

| Government | Max tax | Tolerance | Corruption | Happiness | Extra |
|---|---|---|---|---|---|
| Despotism (start) | 100 | 2 | 0.30 | 0 | Martial law 4 |
| Monarchy | 100 | 3 | 0.25 | +1 | Martial law 3 |
| Republic | 100 | 4 | 0.15 | +2 | Settlers cost 1 shield, martial law 1 |
| Democracy | **10** | 5 | 0.05 | +4 | Settlers cost 1 shield, martial law 1 |
| Communism | 100 | 3 | 0.10 | +1 | −25% commerce, martial law 3 |

- Changing government triggers a **revolution**: 3 turns of **Anarchy**, during
  which all your tax/science/luxury rates are forced to 0.
- A **Courthouse** halves corruption regardless of government.
- Your capital is never corrupt. Corruption grows with distance from it.
- There is no senate, no "prevent war declaration", no espionage, and no
  per-government unit cost. Do not plan around those.
- The AI only revolts when a candidate beats its current government by a
  clear margin, and it deliberately penalises Republic/Democracy for an
  expansionist empire.

Full detail in [`doc/GOVERNMENT.md`](doc/GOVERNMENT.md).

### Diplomacy

**Diplomatic Actions**
- Declare War
- Negotiate Peace (with counter-offers)
- Sign Alliance
- Sign, cancel and inspect Treaties: trade, open borders, mutual defence, non-aggression, embargo, technology exchange
- Demand Tribute
- Bribe a unit out of another civilization
- Exchange maps (send a Diplomat)

**Diplomatic States**
- **Peace** - No hostilities
- **War** - Active conflict; cascades to the defender's allies
- **Alliance** - Military cooperation
- **Ceasefire** - Temporary peace; breaking one costs 30 reputation

Attitude is a score built from the other civ's `diplomacy` and `aggression`
personality, the current status, active treaties, the military strength ratio
and border friction. Breaking a peace is −30, breaking an alliance −50, a
surprise attack −20. Reputation recovers 1 per turn.

Full detail in [`doc/DIPLOMACY_SYSTEM.md`](doc/DIPLOMACY_SYSTEM.md).

### Barbarians

**Barbarian Mechanics**
- They are a **phantom horde** that acts once per round, before anyone else
- They are spawned by **Barbarian Ambush** villages, and by any city they capture
- They become a real, targetable civilization **the moment they hold a city** —
  and only then can they be a loss condition
- They assault a city when they have at least 2 units and 1.5× its estimated defence
- A captured barbarian city has all its buildings sold and pumps out raiders
- They are always hostile and have no diplomacy
- There is no gold reward for defeating them

See [`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc) § Barbarians.

## 🎮 Controls

### Keyboard Shortcuts
- **Arrow Keys** - Move the selected unit, or pan with nothing selected
- **Shift + Arrows** - Pan the camera
- **Space** - Cycle through units stacked on the tile
- **Enter** - End turn
- **F** - Fortify unit
- **S** - Skip unit
- **W** - Wait (keep unit active)
- **G** - GoTo (click a destination, walks over several turns); with a city
  selected, opens the government dialog
- **B** - Build road
- **I** - Irrigate
- **M** - Build mines
- **P** - Clean pollution
- **R** - Rush production in the selected city
- **C** - Centre camera on the selected unit
- **T** - Tax / science / luxury rate sliders
- **D** / **F4** - Diplomatic relations
- **Esc** - Cancel, close a dialog, or clear the selection
- **+** / **-** - Zoom
- **Ctrl+1…9** - Select the 1st–9th city
- **Ctrl+S** / **Ctrl+L** - Save / Load
- **Ctrl+P** - Pause / resume
- **F1** - Help
- **F2** - Technology tree
- **F3** - Settings
- **F11** - Fullscreen

### Mouse Controls
- **Left Click** - Select unit/city
- **Right Click** - Context menu
- **Scroll Wheel** - Zoom in/out
- **Click + Drag** - Pan map

## 🏗️ City Buildings

23 buildings and 10 wonders. Effects are **flat**, not percentages. The full
table is in [`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc).

**Military**
- **Barracks** (40, Bronze Working) - The `veteranUnits` effect is declared but **not implemented**

**Production**
- **Factory** (200, Industrialization) - +2 production, +2 pollution
- **Power Plant** (160, Electricity) - +1 production, +2 pollution
- **Hydro Plant** (240, Electronics) - +1 production, −2 pollution (requires Factory)
- **Nuclear Plant** (160, Nuclear Power) - +2 production, +3 pollution (requires Factory)

**Economic**
- **Marketplace** (80, Currency) - +1 trade, halves corruption
- **Bank** (120, Banking) - +2 trade, halves corruption (requires Marketplace)
- **Stock Exchange** (160, Banking) - +3 trade, 80% corruption reduction (requires Bank)
- **Mass Transit** (160, Mass Production) - +2 happiness, −1 pollution

**Science**
- **Library** (80, Writing) - +1 science
- **University** (160, University) - +2 science (requires Library)
- There is **no Research Lab** in this codebase

**Happiness**
- **Temple** (40, Ceremonial Burial) - +1 happiness
- **Colosseum** (100, Construction) - +2 happiness
- **Cathedral** (160, Monotheism) - +3 happiness (requires Temple)
- **SDI Defense** (200, Space Flight) - missile defence

**Infrastructure**
- **Granary** (60, Pottery) - keeps half the food box on growth. It does **not**
  lower the growth threshold.
- **Aqueduct** (120, Construction) - +2 health, +1 growth bonus. There is **no
  size-10 cap** for it to lift.
- **City Walls** (120, Masonry) - ×3 city defence (requires Masonry)
- **Courthouse** (80, Code of Laws) - halves corruption, +1 happiness
- **Hospital** (120, Engineering) - +2 health, +1 happiness
- **Harbor** (30, Masonry) - required for any ship or a Fisher Boat
- **Recycling Center** (200, Mass Production) - −3 pollution, +1 production
- **Palace** (80) - marks your capital; 0 upkeep
- **Courthouse** (80) - Reduces corruption by 50%

## 📊 Scoring System

Recomputed every turn end. It is a scoreboard, **not** a win condition.

- Population (1 point per citizen)
- Land area (1 point per unique workable tile in your cities' radii)
- Cities (1 point each, plus 5 more)
- Technologies (5 points per tech)
- Wonders (20 points per wonder)
- Peace (1 point per 5 consecutive rounds at peace, reset by a war)
- Pollution (penalty from your own buildings)

There is no Future Tech term.

## 🎯 Strategy Tips

### Early Game (4000-1000 BC)
1. Settle immediately — a settler costs 0 upkeep but eats food, and 1 shield a turn under Republic/Democracy
2. Found on a **river**: the centre gets 2/1/1 plus a trade bonus, and a 1-wide river stays fordable
3. Put early worker-turns into irrigation or a road
4. Research Pottery (Granary) or Bronze Working (Phalanx)
5. Keep gold above zero — a negative treasury disbands your army

### Mid Game (1000 BC - 1000 AD)
1. Libraries everywhere: +1 science each
2. Currency → Trade → Banking; Trade unlocks Caravans, whose trade routes pay **both** gold and science
3. Courthouses halve corruption, which bites as soon as your cities drift from the capital
4. Monarchy, then Republic — but Republic taxes each settler a shield, so not while expanding
5. Oracle, Pyramids and Great Wall are 300-shock wonders from the Masonry/Ceremonial Burial era

### Late Game (1000-2100 AD)
1. The settler shield tax makes Democracy bad for a wide empire — prefer Monarchy or Communism
2. Factories (+2 production) and Power Plants, but watch pollution
3. **To win by technology**: Combustion → Flight → Computers → Space Flight → Moonshot. So can an AI, and they will not wait for you
4. Or eliminate everyone — and remember one surviving enemy unit keeps the game alive

### City Placement
- **Rivers** - the city centre gets +1 trade
- **Coast** - required for any ship, or a Fisher Boat with a Harbor
- **Resources** - Gems and Gold are +4 trade, Oil is +4 production, an Oasis is +3 food
- **Defense** - mountains ×3, hills ×2, forest ×1.5, a Fortress ×2 on top
- **Spacing** - you may build adjacent, but overlapping radii mean competing for the same 20 tiles

### Technology Priority
**Moonshot (the only technology win)**: The Wheel → Mathematics → Philosophy →
Astronomy → Navigation → Banking → Industrialization → Science Theory →
Electricity → Combustion → Flight → Computers → Space Flight → Moonshot

**Conquest**: Bronze Working → Mathematics → Metallurgy → Gunpowder, then
Iron Working → Metallurgy → Steel

**Expansion**: Pottery → Writing → Literacy → Philosophy → Monotheism → Theology
→ Democracy, with Currency → Trade for trade routes

**Naval**: Sailing → Map Making → Navigation, plus Masonry early for the Harbor

There is no Conscription, Rocketry, Steam Engine, Invention, Chivalry, Feudalism
or Economics in this codebase.

## 🔧 Development Features

### Implemented
- ✅ **8-way square** world map with **13** terrain types, 14 map types
- ✅ 14 playable civilizations with historical leaders and portraits
- ✅ City founding, joining, capture, razing, governors, specialists
- ✅ 33 units across land, sea, air and civilian, with stacking and GoTo
- ✅ Combat with terrain, fortification, city walls, siege and air units
- ✅ 45-technology research tree with map-size and difficulty cost scaling
- ✅ Six governments, revolutions, anarchy, capital management
- ✅ Full diplomacy: war, peace, ceasefires, alliances, treaties, bribes
- ✅ Trade routes, naval warfare, ferries, Fisher Boats
- ✅ Barbarian hordes, villages, tile improvements
- ✅ Fog of war, scout memory, save/load
- ✅ Full AI: 6 profiles, strategy, research, government, diplomacy, army groups, naval doctrine, city governor
- ✅ Unattended AI-vs-AI scenarios and headless batch runners

### Known Gaps
- ❌ **Veteran units** — badge and data field exist, the combat bonus does not
- ❌ **Score victory** — only Moonshot and elimination end a game
- ❌ **Housing cap** — an Aqueduct does not gate city size
- ❌ **Sound** — there is no audio layer
- ❌ Several building and wonder effects are declared in data but not read by the engine

### Planned
- 📋 Per-civ doctrines (design proposal in `doc/leader-doctrines.adoc`)
- 📋 Sound effects and music
- 📋 Multiplayer support (hot-seat)
- 📋 More static maps

## 🏛️ Historical Accuracy

This clone aims to faithfully recreate the original Civilization I experience
while modernizing the interface for contemporary browsers. It is a *recreation in
spirit*, not a rules-accurate port: several unit stats, the technology tree and
the wonder list diverge from the 1991 original, and some mechanics Civ I had
(veterans, housing caps, score victory) are absent. Where the code and the
1991 original disagree, the code wins — see
[`doc/GAME_RULES.adoc`](doc/GAME_RULES.adoc).

## 📚 Credits

Original Game: Sid Meier's Civilization (MicroProse, 1991)
Design: Sid Meier & Bruce Shelley
This browser clone: Educational recreation project

---

**Glory to your civilization! May you build an empire to stand the test of time!** 🏛️
