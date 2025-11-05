# Civilization I - Browser Clone

A faithful recreation of Sid Meier's Civilization I (1991) built with React, Vite, and HTML5 Canvas.

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
- **Mongols** (Genghis Khan)
- **Romans** (Julius Caesar)
- **Russians** (Joseph Stalin)
- **Zulus** (Shaka)

## 🎯 Victory Conditions

### Conquest Victory
Eliminate all other civilizations by capturing or destroying their cities.

### Space Race Victory
Build the Apollo Program wonder, then construct and launch a spaceship to Alpha Centauri before other civilizations.

### Score Victory
Have the highest civilization score when the game ends in 2100 AD.

## 📜 Core Mechanics

### City Management

**Founding Cities**
- Use Settler units to found new cities on suitable terrain
- City placement affects resources, defense, and growth potential
- Cities cannot be founded adjacent to existing cities

**City Growth**
- Cities grow by accumulating food surplus
- Population size affects production and science output
- Aqueduct required for cities to grow beyond size 10

**Production**
- Cities produce units, buildings, or wonders
- Production rate depends on terrain, population, and improvements
- Granary building reduces food needed for growth by 50%

**Happiness**
- Citizens can be Happy, Content, or Unhappy
- Too many unhappy citizens cause disorder (city produces nothing)
- Temples, Colosseums, and Wonders improve happiness
- Martial law (military units in city) can suppress unhappiness

### Technology Tree

**Research System**
- Choose which technology to research each turn
- Research speed depends on total science output from cities
- Technologies unlock new units, buildings, and wonders
- Libraries increase science production by 50%

**Technology Eras**
1. **Ancient** - Pottery, Bronze Working, The Wheel, Alphabet, Writing
2. **Classical** - Iron Working, Mathematics, Currency, Republic, Monarchy
3. **Medieval** - Feudalism, Chivalry, Theology
4. **Renaissance** - Democracy, Invention, Navigation
5. **Industrial** - Railroad, Steam Engine, Industrialization
6. **Modern** - Rocketry, Computers, Space Flight, Nuclear Fission

### Military Units

**Unit Types**
- **Settler** (0/1/1) - Founds cities, builds improvements
- **Warrior** (1/1/1) - Basic military unit
- **Phalanx** (1/2/1) - Defensive infantry (requires Bronze Working)
- **Legion** (4/2/1) - Roman heavy infantry (requires Iron Working)
- **Horsemen** (2/1/2) - Fast cavalry (requires Horseback Riding)
- **Chariot** (3/1/2) - Ancient mobile unit (requires The Wheel)
- **Catapult** (6/1/1) - Siege weapon (requires Mathematics)
- **Trireme** (1/1/3) - Naval transport (requires Map Making)
- **Pikemen** (1/2/1) - Medieval defensive unit (requires Feudalism)
- **Musketeer** (2/3/1) - Gunpowder unit (requires Gunpowder)

**Combat**
- Combat strength = Base Attack/Defense × Terrain Bonus × Fortification × Veteran Status
- Hills: +100% defense, Mountains: +200% defense
- Fortified units: +50% defense
- Veteran units: +50% combat strength
- Cities with walls: ×3 defense

**Unit Experience**
- Units become Veterans after winning battles
- Barracks make all new units Veterans
- Veterans have +50% combat effectiveness

### Terrain & Improvements

**Terrain Types**
- **Grassland** - 2 food, 0 production, 0 trade
- **Plains** - 1 food, 1 production, 0 trade  
- **Desert** - 0 food, 1 production, 0 trade
- **Tundra** - 1 food, 0 production, 0 trade
- **Forest** - 1 food, 2 production, 0 trade (defense +50%)
- **Hills** - 1 food, 2 production, 0 trade (defense +100%)
- **Mountains** - 0 food, 1 production, 0 trade (defense +200%)
- **Ocean** - 1 food, 0 production, 2 trade

**Terrain Improvements**
- **Road** - Reduces movement cost to 1/3, +1 trade on terrain producing trade
- **Railroad** - Reduces movement to 0, +50% production
- **Irrigation** - +1 food on grassland, plains, desert
- **Mine** - +1 production on hills, mountains
- **Fortress** - +100% defense, heals units

### Wonders of the World

**Ancient Wonders**
- **Pyramids** - Granary effect in every city (cost: 200)
- **Hanging Gardens** - +1 happy citizen in every city (cost: 200)
- **Colossus** - +1 trade in every square (cost: 200)
- **Lighthouse** - Safe sea travel for Triremes (cost: 200)
- **Oracle** - Temple in every city (cost: 300)
- **Great Wall** - Double defense vs barbarians (cost: 300)

**Classical/Medieval Wonders**
- **Great Library** - Free techs discovered by 2 civs (cost: 300)
- **Copernicus' Observatory** - +50% science in city (cost: 300)

**Modern Wonders**
- **Isaac Newton's College** - Doubles science in city (cost: 400)
- **Apollo Program** - Enables spaceship construction (cost: 600)

### Government Types

**Despotism** (Starting)
- High corruption
- Free unit support
- No bonuses

**Monarchy** (requires Monarchy tech)
- Medium corruption
- Low unit costs
- Martial law more effective

**Republic** (requires Republic tech)
- Low corruption
- Medium unit costs
- +1 trade per square with trade
- Senate may prevent war declarations

**Democracy** (requires Democracy tech)
- Minimal corruption
- High unit costs
- +1 trade per square with trade
- Maximum citizen happiness
- Senate strictly controls war

**Communism** (requires Communism tech)
- Low corruption
- Medium unit costs
- No senate interference
- Effective spy operations

### Diplomacy

**Diplomatic Actions**
- Declare War
- Negotiate Peace
- Sign Alliance
- Trade Technologies
- Establish Embassy
- Demand Tribute
- Exchange Maps

**Diplomatic States**
- **Peace** - No hostilities
- **War** - Active conflict
- **Alliance** - Military cooperation
- **Cease Fire** - Temporary peace

### Barbarians

**Barbarian Mechanics**
- Spawn randomly in unexplored areas
- Frequency increases with difficulty level
- Attack nearby cities and units
- Defeating barbarians provides gold rewards
- Great Wall wonder doubles defense against barbarians

## 🎮 Controls

### Keyboard Shortcuts
- **Arrow Keys** - Scroll map
- **Enter** - End turn
- **B** - Build city (with Settler)
- **F** - Fortify unit
- **S** - Sleep/Sentry unit
- **Space** - Skip unit
- **W** - Wait (keep unit active)
- **I** - Irrigate
- **M** - Mine
- **R** - Build road
- **Ctrl+S** - Quick save
- **F1** - Info Menu (Tech Tree)
- **F2** - City list
- **F3** - Technology tree

### Mouse Controls
- **Left Click** - Select unit/city
- **Right Click** - Context menu
- **Scroll Wheel** - Zoom in/out
- **Click + Drag** - Pan map

## 🏗️ City Buildings

### Production Buildings
- **Barracks** (40) - New land units are Veterans
- **Factory** (200) - +50% production

### Economic Buildings
- **Marketplace** (80) - +50% gold from trade
- **Bank** (120) - +50% gold (requires Marketplace)
- **Stock Exchange** (160) - +50% gold (requires Bank)

### Science Buildings
- **Library** (80) - +50% science
- **University** (160) - +50% science (requires Library)
- **Research Lab** (160) - +50% science (requires University)

### Happiness Buildings
- **Temple** (40) - Makes 1 unhappy citizen content
- **Colosseum** (100) - Makes 3 unhappy citizens content
- **Cathedral** (120) - Makes 3 unhappy citizens content (requires Temple)

### Infrastructure
- **Granary** (60) - Growth requires 50% less food
- **Aqueduct** (120) - Allows growth beyond size 10
- **City Walls** (80) - Triple defense for units
- **Courthouse** (80) - Reduces corruption by 50%

## 📊 Scoring System

**Score Calculation**
- Population (1 point per citizen)
- Land area (1 point per tile)
- Cities (5 points per city)
- Technologies (5 points per tech)
- Wonders (20 points per wonder)
- Future Tech (5 points each)
- Peace years (bonus)
- Pollution (penalty)

## 🎯 Strategy Tips

### Early Game (4000-1000 BC)
1. Build 2-3 Settlers immediately to claim prime locations
2. Research Pottery → Bronze Working → Alphabet
3. Found cities near rivers and resources
4. Build Warriors/Phalanx for defense and exploration
5. Establish contact with other civilizations

### Mid Game (1000 BC - 1000 AD)
1. Build Libraries in all cities for science boost
2. Research Currency → Republic for economic power
3. Construct Wonders like Great Library, Oracle
4. Expand military for territorial control
5. Switch to Republic government

### Late Game (1000-2100 AD)
1. Focus on Democracy for maximum productivity
2. Build Factories and Research Labs
3. Research toward Space Flight for space race
4. Build Apollo Program + spaceship parts
5. Or conquer remaining civilizations

### City Placement
- **Rivers** - +1 trade on river squares
- **Coast** - Access to ocean trade and naval units
- **Resources** - Bonus food/production/trade
- **Defense** - Hills and forests provide defensive bonuses
- **Spacing** - Leave room for city radius (2 tiles) to grow

### Technology Priority
**Science Victory**: Alphabet → Writing → Code of Laws → Literacy → Republic → Democracy → Rocketry → Space Flight

**Military Victory**: Bronze Working → Iron Working → Mathematics → Gunpowder → Metallurgy → Conscription

**Economic Victory**: Pottery → The Wheel → Currency → Trade → Banking → Economics

## 🔧 Development Features

### Current Implementation
- ✅ Hex-based world map with 9 terrain types
- ✅ 14 playable civilizations with historical leaders
- ✅ City founding and basic management
- ✅ Unit movement and combat
- ✅ Technology tree research system
- ✅ Minimap with world overview
- ✅ Context menu for unit orders
- ✅ Terrain examination modal
- ✅ Adjustable UI settings

### In Progress
- 🔄 Complete city production system
- 🔄 Building construction mechanics
- 🔄 Wonder construction
- 🔄 AI civilization behavior
- 🔄 Diplomacy system
- 🔄 Government changes and effects
- 🔄 Victory condition checking

### Planned Features
- 📋 Save/load game system
- 📋 Full tech tree
- 📋 Animated unit combat
- 📋 Sound effects and music
- 📋 Multiplayer support (hot-seat)
- 📋 Advanced AI strategies
- 📋 Random events system
- 📋 Barbarian uprising mechanics

## 🏛️ Historical Accuracy

This clone aims to faithfully recreate the original Civilization I experience while modernizing the interface for contemporary browsers. Game balance, technology costs, and unit statistics mirror the 1991 original where possible.

## 📚 Credits

Original Game: Sid Meier's Civilization (MicroProse, 1991)
Design: Sid Meier & Bruce Shelley
This browser clone: Educational recreation project

---

**Glory to your civilization! May you build an empire to stand the test of time!** 🏛️
