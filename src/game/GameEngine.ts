import { SquareGrid } from './hexGrid';
import { CONSTANTS, TERRAIN_PROPS, UNIT_PROPS } from '../utils/constants';
import { CIVILIZATIONS, TECHNOLOGIES, UNIT_TYPES } from './gameData.js';
import type { GameActions, Unit, City, Civilization } from '../../types/game';

interface GameSettings {
  difficulty: string;
  mapType: string;
  numberOfCivilizations: number;
  playerCivilization: number;
  startingYear: number;
  startingGold: number;
}

interface MapTile {
  terrain: string;
  resource?: string;
  improvement?: string;
  visible: boolean;
  explored: boolean;
  col: number;
  row: number;
  type?: string;
}

interface MapData {
  width: number;
  height: number;
  tiles: MapTile[];
}

/**
 * Main Game Engine for React Civilization Clone
 * Manages all game systems and state
 */
export default class GameEngine {
  storeActions: GameActions | null;
  squareGrid: SquareGrid | null;
  map: MapData | null;
  units: Unit[];
  cities: City[];
  civilizations: Civilization[];
  technologies: any[];
  gameSettings: GameSettings;
  renderer: any;
  isInitialized: boolean;
  currentTurn: number;
  currentYear: number;
  activePlayer: number;
  onStateChange: ((eventType: string, eventData?: any) => void) | null;

  constructor(storeActions: GameActions | null = null) {
    this.storeActions = storeActions;
    this.squareGrid = null;
    this.map = null;
    this.units = [];
    this.cities = [];
    this.civilizations = [];
    this.technologies = [];
    
    // Game settings
    this.gameSettings = {
      difficulty: 'PRINCE',
      mapType: 'EARTH',
      numberOfCivilizations: 4,
      playerCivilization: 0,
      startingYear: -4000, // 4000 BC
      startingGold: 50
    };
    
    // Rendering context
    this.renderer = null;
    
    // Game state
    this.isInitialized = false;
    this.currentTurn = 1;
    this.currentYear = -4000; // 4000 BC
    this.activePlayer = 0;
    
    // Callbacks for React state updates
    this.onStateChange = null;
  }

  // Small helper: sleep for ms milliseconds
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Highlight AI target on renderer if available
  private highlightAITarget(col: number, row: number, color: string = 'rgba(255,0,0,0.4)') {
    if (!this.renderer || !this.renderer.setHighlightedHexes) return;
    // Set a single highlighted hex for a short time
    try {
      this.renderer.setHighlightedHexes([{ col, row }]);
    } catch (e) {
      // ignore
    }
  }

  // Choose a target for AI unit: prefer unexplored nearby tiles, then enemy units, then random neighbor
  private chooseAITarget(unit: any): { col: number; row: number } | null {
    if (!this.map || !this.squareGrid) return null;
    // 1) Nearby unexplored tile
  const unexplored = this.findNearbyUnexplored(unit);
    if (unexplored) return { col: unexplored.col, row: unexplored.row };

    // 2) Nearby enemy unit
  const enemy = this.findNearbyEnemy(unit);
    if (enemy) return { col: enemy.col, row: enemy.row };

    // 3) Random valid neighbor
    const neighbors = this.squareGrid.getNeighbors(unit.col, unit.row);
    for (const n of neighbors) {
      if (!this.squareGrid.isValidSquare(n.col, n.row)) continue;
      const tile = this.getTileAt(n.col, n.row);
      if (!tile) continue;
      if (TERRAIN_PROPS[tile.type]?.passable === false) continue;
      const other = this.getUnitAt(n.col, n.row);
      if (other && other.civilizationId === unit.civilizationId) continue;
      return { col: n.col, row: n.row };
    }

    return null;
  }

  // Find nearby unexplored tile (uses GameEngine's map representation)
  private findNearbyUnexplored(unit: any, searchRadius: number = 8): any {
    if (!this.map || !this.squareGrid) return null;
    const nearbyTiles = this.squareGrid.getSquaresInRange(unit.col, unit.row, searchRadius);
    for (const tilePos of nearbyTiles) {
      const tile = this.getTileAt(tilePos.col, tilePos.row);
      if (tile && !tile.explored) {
        return tilePos;
      }
    }
    return null;
  }

  // Find nearby enemy unit
  private findNearbyEnemy(unit: any, searchRadius: number = 5): any {
    if (!this.squareGrid) return null;
    const nearbyTiles = this.squareGrid.getSquaresInRange(unit.col, unit.row, searchRadius);
    for (const tilePos of nearbyTiles) {
      const enemyUnit = this.getUnitAt(tilePos.col, tilePos.row);
      if (enemyUnit && enemyUnit.civilizationId !== unit.civilizationId) {
        return enemyUnit;
      }
    }
    return null;
  }

  // Run an asynchronous AI turn for civilizationId
  async runAITurn(civilizationId: number) {
    // Small delay before AI starts so player can observe
    await this.sleep(250);

    const aiUnits = this.units.filter(u => u.civilizationId === civilizationId && (u.movesRemaining || 0) > 0);

    for (const unit of aiUnits) {
      // While this unit can move, pick targets and attempt actions
      while ((unit.movesRemaining || 0) > 0) {
        const target = this.chooseAITarget(unit);
        if (!target) break;

        // Highlight chosen target
        this.highlightAITarget(target.col, target.row);

        // If target is adjacent, try to move or attack
        const dist = this.squareGrid.squareDistance(unit.col, unit.row, target.col, target.row);
        if (dist === 1) {
          const targetUnit = this.getUnitAt(target.col, target.row);
          if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
            // Attack
            console.log(`[AI] Unit ${unit.id} attacking unit at (${target.col},${target.row})`);
            // Check move cost before attempting attack
            const tt = this.getTileAt(target.col, target.row);
            const attackCost = Math.max(1, TERRAIN_PROPS[tt?.type]?.movement || 1);
            if ((unit.movesRemaining || 0) >= attackCost) {
              this.moveUnit(unit.id, target.col, target.row);
            } else {
              // Not enough movement points to attack, break out for this unit
              break;
            }
          } else {
            // Move into the tile
            const tt = this.getTileAt(target.col, target.row);
            const moveCost = Math.max(1, TERRAIN_PROPS[tt?.type]?.movement || 1);
            if ((unit.movesRemaining || 0) >= moveCost) {
              this.moveUnit(unit.id, target.col, target.row);
            } else {
              break;
            }
          }
        } else {
          // Pathfind towards target and take next step
          const path = this.squareGrid.findPath(unit.col, unit.row, target.col, target.row, new Set());
            if (path.length > 1) {
            const next = path[1];
            // Check move cost for next step
            const tt = this.getTileAt(next.col, next.row);
            const nextCost = Math.max(1, TERRAIN_PROPS[tt?.type]?.movement || 1);
            if ((unit.movesRemaining || 0) < nextCost) {
              // Not enough movement for next step — end this unit's moves
              break;
            }

            // Attempt the move and inspect structured result
            const result = this.moveUnit(unit.id, next.col, next.row);
            if (!result || !result.success) {
              const reason = result?.reason || 'unknown';
              // Treat certain reasons as terminal for this unit for this turn
              const terminalReasons = new Set(['insufficient_moves', 'no_moves_left', 'terrain_impassable', 'invalid_target']);
              if (terminalReasons.has(reason)) {
                // Log once and stop trying further moves for this unit
                console.warn(`[AI] moveUnit terminal failure for ${unit.id} -> (${next.col},${next.row}): ${reason}`);
                break;
              } else {
                // Non-terminal failure (e.g., combat defeat or other transient) - log and break to avoid tight loop
                console.warn(`[AI] moveUnit non-terminal failure for ${unit.id} -> (${next.col},${next.row}): ${reason}`);
                break;
              }
            }
            // If success, continue the while loop (unit.movesRemaining updated)
          } else {
            // Couldn't find path, try moving to any valid neighbor as fallback
            console.warn(`[AI] No path found for unit ${unit.id} to target (${target.col},${target.row})`);
            const neighbors = this.squareGrid.getNeighbors(unit.col, unit.row);
            let moved = false;
            for (const n of neighbors) {
              if (!this.squareGrid.isValidSquare(n.col, n.row)) continue;
              const tile = this.getTileAt(n.col, n.row);
              if (!tile) continue;
              if (TERRAIN_PROPS[tile.type]?.passable === false) continue;
              const other = this.getUnitAt(n.col, n.row);
              if (other && other.civilizationId === unit.civilizationId) continue;
              const r = this.moveUnit(unit.id, n.col, n.row);
              if (r && r.success) { moved = true; break; }
              // If move failed for a terminal reason, stop trying neighbors for this unit
              const reason = r?.reason || 'unknown';
              const terminalReasons = new Set(['insufficient_moves', 'no_moves_left', 'terrain_impassable', 'invalid_target']);
              if (terminalReasons.has(reason)) {
                console.warn(`[AI] Neighbor move terminal failure for ${unit.id} -> (${n.col},${n.row}): ${reason}`);
                break;
              }
            }
            if (!moved) {
              // No valid neighbor found, break to next unit
              break;
            }
          }
        }

        // Wait a little so moves are visible
        await this.sleep(200);
      }
    }

    // Clear highlights and signal turn end for AI
    if (this.renderer && this.renderer.setHighlightedHexes) {
      try { this.renderer.setHighlightedHexes([]); } catch (e) {}
    }

    // Check if turn should end automatically after AI moves
    this.checkAndEndTurnIfNoMoves();

    // After AI finished its units, auto-advance to next player
    this.onStateChange && this.onStateChange('AI_FINISHED', { civilizationId });
  }

  /**
   * Initialize the game engine with settings
   */
  async initialize(settings = {}) {
    console.log('Initializing game engine...');
    
    // Merge custom settings
    this.gameSettings = { ...this.gameSettings, ...settings };
    
    // Validate playerCivilization index
    if (this.gameSettings.playerCivilization < 0 || 
        this.gameSettings.playerCivilization >= CIVILIZATIONS.length) {
      console.error('Invalid playerCivilization index:', this.gameSettings.playerCivilization);
      this.gameSettings.playerCivilization = 0; // Default to first civilization
    }
    
    // Create hex grid system
    this.squareGrid = new SquareGrid(CONSTANTS.MAP_WIDTH, CONSTANTS.MAP_HEIGHT);
    
    // Generate initial game state
    await this.generateWorld();
    await this.createCivilizations();
    await this.initializeTechnologies();

    // Push freshly generated state into the store if available before computing visibility
    if (this.storeActions) {
      this.storeActions.updateMap(this.map);
      this.storeActions.updateUnits(this.units);
      this.storeActions.updateCities(this.cities);
      this.storeActions.updateCivilizations(this.civilizations);
      this.storeActions.updateTechnologies(this.technologies);
    }

    // Initialize fog of war visibility
    this.updateVisibility();
    
    this.isInitialized = true;
    console.log('Game engine initialized successfully');
    console.log(`Starting year: ${this.formatYear(this.currentYear)}`);
    console.log(`Player civilization: ${this.civilizations[0].name}`);
  }

  /**
   * Generate the game world with terrain
   */
  async generateWorld() {
    const tiles = [];
    
    // Simple terrain generation - can be enhanced with noise functions
    for (let row = 0; row < CONSTANTS.MAP_HEIGHT; row++) {
      for (let col = 0; col < CONSTANTS.MAP_WIDTH; col++) {
        let terrainType: string = CONSTANTS.TERRAIN.GRASSLAND;
        
        // Ocean around edges
        if (row === 0 || row === CONSTANTS.MAP_HEIGHT - 1 || 
            col === 0 || col === CONSTANTS.MAP_WIDTH - 1) {
          terrainType = CONSTANTS.TERRAIN.OCEAN;
        }
        // Random terrain generation
        else {
          const rand = Math.random();
          if (rand < 0.1) terrainType = CONSTANTS.TERRAIN.MOUNTAINS;
          else if (rand < 0.2) terrainType = CONSTANTS.TERRAIN.HILLS;
          else if (rand < 0.3) terrainType = CONSTANTS.TERRAIN.FOREST;
          else if (rand < 0.4) terrainType = CONSTANTS.TERRAIN.DESERT;
          else if (rand < 0.5) terrainType = CONSTANTS.TERRAIN.PLAINS;
          else if (rand < 0.6) terrainType = CONSTANTS.TERRAIN.TUNDRA;
          else terrainType = CONSTANTS.TERRAIN.GRASSLAND;
        }
        
        tiles.push({
          col,
          row,
          type: terrainType,
          resource: Math.random() < 0.1 ? 'bonus' : null,
          improvement: null,
          visible: false,
          explored: false
        });
      }
    }
    
    this.map = {
      width: CONSTANTS.MAP_WIDTH,
      height: CONSTANTS.MAP_HEIGHT,
      tiles
    };
    
    console.log('World generated with', tiles.length, 'tiles');
  }

  /**
   * Create civilizations and place starting units
   */
  async createCivilizations() {
    const numCivs = Math.min(this.gameSettings.numberOfCivilizations, CIVILIZATIONS.length);
    const selectedCivs = [];
    
    // Always include player's chosen civilization first
    selectedCivs.push(CIVILIZATIONS[this.gameSettings.playerCivilization]);
    
    // Add other random civilizations
    const availableCivs = CIVILIZATIONS.filter((_, idx) => idx !== this.gameSettings.playerCivilization);
    for (let i = 1; i < numCivs; i++) {
      const randomIdx = Math.floor(Math.random() * availableCivs.length);
      selectedCivs.push(availableCivs.splice(randomIdx, 1)[0]);
    }

    this.civilizations = [];
    this.units = [];
    this.cities = [];

    for (let i = 0; i < selectedCivs.length; i++) {
      const civData = selectedCivs[i];
      
      const civ = {
        id: i,
        name: civData.name,
        leader: civData.leader,
        color: civData.color,
        cityNames: [...civData.cityNames],
        nextCityNameIndex: 0,
        isAlive: true,
        isHuman: i === 0, // First civ is human player
        resources: {
          food: 0,
          production: 0,
          trade: 0,
          science: 0,
          gold: this.gameSettings.startingGold // 50 gold starting treasury
        },
        // Starting technologies (Civ1 style)
        technologies: ['irrigation', 'mining', 'roads'],
        currentResearch: null,
        researchProgress: 0,
        scienceRate: 50, // 50% of trade goes to science initially
        taxRate: 0,
        luxuryRate: 50,
        government: 'despotism',
        score: 0
      };

      // Find starting position
      let startPos = null;
      let attempts = 0;
      while (!startPos && attempts < 100) {
        const col = Math.floor(Math.random() * (CONSTANTS.MAP_WIDTH - 20)) + 10;
        const row = Math.floor(Math.random() * (CONSTANTS.MAP_HEIGHT - 20)) + 10;
        
        const tile = this.getTileAt(col, row);
        if (tile && tile.type !== CONSTANTS.TERRAIN.OCEAN && 
            tile.type !== CONSTANTS.TERRAIN.MOUNTAINS) {
          // Check if position is far enough from other civs
          let validPosition = true;
          for (const otherCiv of this.civilizations) {
            const otherUnits = this.units.filter(u => u.civilizationId === otherCiv.id);
            for (const unit of otherUnits) {
              if (this.squareGrid.squareDistance(col, row, unit.col, unit.row) < 12) {
                validPosition = false;
                break;
              }
            }
          }
          
          if (validPosition) {
            startPos = { col, row };
          }
        }
        attempts++;
      }

      if (startPos) {
        // Create single starting settler unit (Civ1 style)
        const settlerId = `settler_${i}_0`;
        
        const settler = {
          id: settlerId,
          civilizationId: i,
          type: 'settlers',
          name: 'Settlers',
          col: startPos.col,
          row: startPos.row,
          health: 100,
          movesRemaining: 1,
          maxMoves: 1,
          isVeteran: false,
          attack: 0,
          defense: 1,
          icon: '👷',
          orders: null // 'fortify', 'sentry', 'goto', etc.
        };

        this.units.push(settler);

        // Log initial unit placement
        console.log(`[INITIAL PLACEMENT] ${settler.type} (${settlerId}) for ${civ.name} placed at (${startPos.col},${startPos.row})`);
        
        // Note: Starting area reveal is now handled in useGameEngine hook after map sync
        // this.revealArea(startPos.col, startPos.row, 2);
      }

      this.civilizations.push(civ);
    }

    console.log('Created', this.civilizations.length, 'civilizations');
    console.log('Player civilization:', this.civilizations[0].name, 'led by', this.civilizations[0].leader);
    console.log('Starting with 1 Settler unit and', this.gameSettings.startingGold, 'gold');
    console.log('Initial technologies: Irrigation, Mining, Roads');
  }

  /**
   * Reveal map tiles around a position
   */
  revealArea(centerCol, centerRow, radius) {
    if (this.storeActions) {
      this.storeActions.revealArea(centerCol, centerRow, radius);
    }
  }

  /**
   * Update fog of war visibility for all tiles
   * Delegates to store actions for centralized visibility management
   */
  updateVisibility() {
    if (this.storeActions) {
      this.storeActions.updateVisibility();
    }
  }

  /**
   * Set visibility (but not explored) for an area
   */
  setVisibilityArea(centerCol, centerRow, radius) {
    if (!this.map) return;
    
    for (let row = centerRow - radius; row <= centerRow + radius; row++) {
      for (let col = centerCol - radius; col <= centerCol + radius; col++) {
        const tile = this.getTileAt(col, row);
        if (tile && this.squareGrid.squareDistance(centerCol, centerRow, col, row) <= radius) {
          tile.visible = true;
          // Also mark as explored when first seen
          if (!tile.explored) {
            tile.explored = true;
          }
        }
      }
    }
  }

  /**
   * Initialize technology tree
   */
  async initializeTechnologies() {
    // Starting technologies are already set in createCivilizations
    // This can be expanded to include the full tech tree
    console.log('Technology tree initialized');
  }

  /**
   * Format year for display (4000 BC, 1000 AD, etc.)
   */
  formatYear(year) {
    if (year < 0) {
      return `${Math.abs(year)} BC`;
    } else if (year > 0) {
      return `${year} AD`;
    } else {
      return '1 BC'; // Year 0 doesn't exist historically
    }
  }

  /**
   * Get next city name for a civilization
   */
  getNextCityName(civilizationId) {
    const civ = this.civilizations[civilizationId];
    if (!civ) return 'City';
    
    const name = civ.cityNames[civ.nextCityNameIndex] || `${civ.name} City ${civ.nextCityNameIndex + 1}`;
    civ.nextCityNameIndex++;
    return name;
  }

  /**
   * Found a new city
   */
  foundCity(col, row, civilizationId, customName = null) {
    const civ = this.civilizations[civilizationId];
    if (!civ) return null;

    const cityId = `city_${civilizationId}_${this.cities.length}`;
    const cityName = customName || this.getNextCityName(civilizationId);

    const city = {
      id: cityId,
      name: cityName,
      civilizationId: civilizationId,
      col: col,
      row: row,
      population: 1,
      production: 0,
      food: 0,
      gold: 0,
      science: 0,
      foodStored: 0,
      foodRequired: 20, // Food needed for next population
      shields: 0, // Production shields
      currentProduction: 'settlers', // Start building a settler
      productionQueue: [],
      buildings: [],
      wonders: [],
      workingTiles: [], // Tiles being worked by citizens
      isCapital: this.cities.filter(c => c.civilizationId === civilizationId).length === 0,
      happiness: {
        happy: 0,
        content: 1,
        unhappy: 0
      },
      // Resource output per turn
      output: {
        food: 0,
        production: 0,
        trade: 0,
        science: 0,
        gold: 0
      }
    };

    this.cities.push(city);
    
    // Remove settler unit that founded the city
    const settlerIdx = this.units.findIndex(u => 
      u.col === col && u.row === row && u.civilizationId === civilizationId && u.type === 'settlers'
    );
    if (settlerIdx !== -1) {
      this.units.splice(settlerIdx, 1);
    }

    console.log(`${civ.name} founded ${cityName} at (${col}, ${row})`);
    return city;
  }
  async createTechnologies() {
    this.technologies = [
      {
        id: 'pottery',
        name: 'Pottery',
        description: 'Allows granary construction',
        cost: 20,
        prerequisites: [],
        available: true,
        researched: false
      },
      {
        id: 'bronze_working',
        name: 'Bronze Working',
        description: 'Enables bronze weapons and tools',
        cost: 30,
        prerequisites: [],
        available: true,
        researched: false
      },
      {
        id: 'alphabet',
        name: 'Alphabet',
        description: 'Enables library construction',
        cost: 40,
        prerequisites: [],
        available: true,
        researched: false
      },
      {
        id: 'iron_working',
        name: 'Iron Working',
        description: 'Enables iron weapons',
        cost: 50,
        prerequisites: ['bronze_working'],
        available: false,
        researched: false
      }
    ];
  }

  /**
   * Convert screen coordinates to hex coordinates
   */
  screenToHex(screenX, screenY) {
    return this.squareGrid.getSquareAtPosition(screenX, screenY);
  }

  /**
   * Check if hex coordinates are valid
   */
  isValidHex(col, row) {
    return this.squareGrid.isValidSquare(col, row);
  }

  /**
   * Get tile at coordinates
   */
  getTileAt(col, row) {
    if (!this.squareGrid.isValidSquare(col, row)) return null;
    const index = row * this.map.width + col;
    return this.map.tiles[index] || null;
  }

  /**
   * Get unit at coordinates
   */
  getUnitAt(col, row) {
    return this.units.find(unit => unit.col === col && unit.row === row) || null;
  }

  /**
   * Get city at coordinates
   */
  getCityAt(col, row) {
    return this.cities.find(city => city.col === col && city.row === row) || null;
  }

  /**
   * Get all units
   */
  getAllUnits() {
    return [...this.units];
  }

  /**
   * Get all cities
   */
  getAllCities() {
    return [...this.cities];
  }

  /**
   * Move unit to new position
   */
  moveUnit(unitId, targetCol, targetRow) {
    const unit = this.units.find(u => u.id === unitId);
    if (!unit) return { success: false, reason: 'unit_not_found' };
    if (!this.squareGrid.isValidSquare(targetCol, targetRow)) return { success: false, reason: 'invalid_target' };

    // Check if unit has moves remaining
    if ((unit.movesRemaining || 0) <= 0) return { success: false, reason: 'no_moves_left' };

    // Check if target tile is passable
    const targetTile = this.getTileAt(targetCol, targetRow);
    if (!targetTile) return { success: false, reason: 'invalid_target' };
    if (TERRAIN_PROPS[targetTile.type]?.passable === false) return { success: false, reason: 'terrain_impassable' };

    // Check if there's another unit at target (combat or stacking rules)
    const targetUnit = this.getUnitAt(targetCol, targetRow);
    if (targetUnit && targetUnit.civilizationId !== unit.civilizationId) {
      // Combat logic here
      const combatResult = this.combatUnit(unit, targetUnit);
      // combatUnit returns boolean success currently; normalize
      const success = !!combatResult;
      return { success, reason: success ? 'combat_victory' : 'combat_defeat' };
    }

    // Move the unit
    const distance = this.squareGrid.squareDistance(unit.col, unit.row, targetCol, targetRow);
    const moveCost = Math.max(1, TERRAIN_PROPS[targetTile.type]?.movement || 1);

    // Require that unit has enough remaining moves to cover the distance * cost
    if ((unit.movesRemaining || 0) >= distance * moveCost) {
      const fromCol = unit.col;
      const fromRow = unit.row;

      unit.col = targetCol;
      unit.row = targetRow;
      unit.movesRemaining = (unit.movesRemaining || 0) - distance * moveCost;

      // Log movement
      console.log(`[MOVEMENT] ${unit.type} (${unit.id}) moved from (${fromCol},${fromRow}) to (${targetCol},${targetRow}), distance: ${distance}, moves remaining: ${unit.movesRemaining}`);

      // Trigger state update
      if (this.onStateChange) {
        this.onStateChange('UNIT_MOVED', { unit, targetCol, targetRow });
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves();

      return { success: true };
    }

    return { success: false, reason: 'insufficient_moves' };
  }

  /**
   * Combat between units
   */
  combatUnit(attacker, defender) {
    const attackerStrength = attacker.attack * (attacker.health / 100);
    const defenderStrength = defender.defense * (defender.health / 100);
    
    const attackerWins = Math.random() * (attackerStrength + defenderStrength) < attackerStrength;
    
    if (attackerWins) {
      // Attacker wins - move to defender's position
      const fromCol = attacker.col;
      const fromRow = attacker.row;

      attacker.col = defender.col;
      attacker.row = defender.row;
      attacker.movesRemaining = 0;

      // Log combat movement
      console.log(`[COMBAT MOVEMENT] ${attacker.type} (${attacker.id}) defeated ${defender.type} (${defender.id}) and moved from (${fromCol},${fromRow}) to (${defender.col},${defender.row})`);

      // Remove defeated unit
      this.units = this.units.filter(u => u.id !== defender.id);
      
      if (this.onStateChange) {
        this.onStateChange('COMBAT_VICTORY', { attacker, defender });
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves();
      
      return true;
    } else {
      // Defender wins - attacker is damaged or destroyed
      attacker.health -= 25;
      attacker.movesRemaining = 0;
      
      if (attacker.health <= 0) {
        this.units = this.units.filter(u => u.id !== attacker.id);
      }
      
      if (this.onStateChange) {
        this.onStateChange('COMBAT_DEFEAT', { attacker, defender });
      }

      // Check if turn should end automatically
      this.checkAndEndTurnIfNoMoves();
      
      return false;
    }
  }

  /**
   * Found a city with settler
   */
  foundCityWithSettler(settlerId) {
    const settler = this.units.find(u => u.id === settlerId);
    if (!settler || settler.type !== 'settlers') return false;

    // Check if location is valid for city
    const tile = this.getTileAt(settler.col, settler.row);
    if (!tile || tile.type === CONSTANTS.TERRAIN.OCEAN) return false;

    // Check if too close to another city
    for (const city of this.cities) {
      if (this.squareGrid.squareDistance(settler.col, settler.row, city.col, city.row) < 3) {
        return false;
      }
    }

    // Generate city name
    const civId = settler.civilizationId;
    const civ = this.civilizations[civId];
    const cityNumber = this.cities.filter(c => c.civilizationId === civId).length + 1;
    const cityName = `${civ.name} City ${cityNumber}`;

    // Create new city
    const city = {
      id: `city_${civId}_${this.cities.length}`,
      name: cityName,
      civilizationId: civId,
      col: settler.col,
      row: settler.row,
      population: 1,
      production: 0,
      food: 0,
      gold: 0,
      science: 0,
      isCapital: this.cities.filter(c => c.civilizationId === civId).length === 0,
      buildings: [],
      yields: { food: 2, production: 1, trade: 0 },
      foodStored: 0,
      foodNeeded: 20,
      productionStored: 0,
      currentProduction: null
    };

    this.cities.push(city);
    
    // Consume the settler's movement (founding a city costs one turn)
    settler.movesRemaining = 0;
    
    // Remove settler
    this.units = this.units.filter(u => u.id !== settlerId);

    // Log settler removal (effectively a movement off the map)
    console.log(`[SETTLER REMOVAL] ${settler.type} (${settlerId}) founded city "${cityName}" at (${settler.col},${settler.row}) and was removed from the map`);
    
    if (this.onStateChange) {
      this.onStateChange('CITY_FOUNDED', { city, settler });
    }

    // Check if turn should end automatically after founding city
    this.checkAndEndTurnIfNoMoves();

    return true;
  }

  /**
   * Check if current player has any units with moves remaining, and end turn if not
   */
  checkAndEndTurnIfNoMoves() {
    const currentCiv = this.civilizations[this.activePlayer];
    if (!currentCiv) return; // Apply to both human and AI players

    const hasMovesLeft = this.units.some(u => u.civilizationId === this.activePlayer && (u.movesRemaining || 0) > 0);
    if (!hasMovesLeft) {
      console.log('[TURN] All units moved for player', this.activePlayer, currentCiv.isHuman ? '(human)' : '(AI)');
      
      if (currentCiv.isHuman) {
        // For human players, ask for confirmation instead of auto-ending
        console.log('[TURN] Human player has no moves left - asking for confirmation');
        if (this.onStateChange) {
          this.onStateChange('TURN_END_CONFIRMATION_NEEDED', { civilizationId: this.activePlayer });
        }
      } else {
        // For AI players, auto-end the turn
        console.log('[TURN] AI player has no moves left - auto-ending turn');
        if (this.onStateChange) {
          this.onStateChange('AUTO_END_TURN', { civilizationId: this.activePlayer });
        }
      }
    }
  }

  /**
   * Process end of turn
   */
  processTurn() {
    // Advance to next player
    this.activePlayer = (this.activePlayer + 1) % this.civilizations.length;
    const currentCiv = this.civilizations[this.activePlayer];
    if (!currentCiv) return;

    // Reset unit moves for the new active player
    this.units
      .filter(u => u.civilizationId === this.activePlayer)
      .forEach(unit => {
        const unitProps = UNIT_PROPS[unit.type];
        unit.movesRemaining = unitProps ? unitProps.movement : 1;
      });

    // Process cities for the active player
    this.cities
      .filter(c => c.civilizationId === this.activePlayer)
      .forEach(city => {
        // Add food for growth
        city.foodStored += city.yields.food;
        if (city.foodStored >= city.foodNeeded) {
          city.population++;
          city.foodStored = 0;
          city.foodNeeded = city.population * 20;
        }

        // Add production
        if (city.currentProduction) {
          city.productionStored += city.yields.production;
          if (city.productionStored >= city.currentProduction.cost) {
            // Complete production
            city.productionStored = 0;
            // Handle completed unit/building (left simple for now)
          }
        }
      });

    // Add resources to civilization (if civilization object follows the same structure)
    try {
      if (currentCiv.resources) {
        currentCiv.resources.science += this.calculateCivScience(currentCiv.id);
        currentCiv.resources.gold += this.calculateCivGold(currentCiv.id);
      }
    } catch (e) {
      // Defensive: some civ objects are plain and may not have resources structured as expected
    }

    // Process research if fields exist
    try {
      if (currentCiv.currentResearch && currentCiv.resources && currentCiv.resources.science > 0) {
        currentCiv.researchProgress = (currentCiv.researchProgress || 0) + currentCiv.resources.science;
        const techCost = typeof currentCiv.currentResearch === 'object' && currentCiv.currentResearch.cost ? currentCiv.currentResearch.cost : (TECHNOLOGIES?.[currentCiv.currentResearch]?.cost || 0);
        if (currentCiv.researchProgress >= techCost && techCost > 0) {
          // Mark research complete (best-effort)
          if (Array.isArray(currentCiv.technologies)) {
            currentCiv.technologies.push(currentCiv.currentResearch.id || currentCiv.currentResearch);
          }
          currentCiv.researchProgress = 0;
          currentCiv.currentResearch = null;
          this.updateTechnologyAvailability();
        }
      }
    } catch (e) {
      // ignore
    }

    // If this civilization is an AI, run its turn asynchronously so UI can update between moves
    if (!currentCiv.isHuman) {
      // fire-and-forget AI routine
      this.runAITurn(this.activePlayer).catch(err => console.error('AI turn error', err));
    }

    if (this.onStateChange) {
      this.onStateChange('TURN_PROCESSED', { civilizationId: this.activePlayer });
    }
  }

  /**
   * Calculate civilization's science output
   */
  calculateCivScience(civId) {
    const cities = this.cities.filter(c => c.civilizationId === civId);
    return cities.reduce((total, city) => total + (city.yields.trade * 0.5), 0);
  }

  /**
   * Calculate civilization's gold output  
   */
  calculateCivGold(civId) {
    const cities = this.cities.filter(c => c.civilizationId === civId);
    return cities.reduce((total, city) => total + (city.yields.trade * 0.5), 0);
  }

  /**
   * Update technology availability based on prerequisites
   */
  updateTechnologyAvailability() {
    const currentCiv = this.civilizations[this.activePlayer];
    if (!currentCiv) return;

    this.technologies.forEach(tech => {
      if (!tech.researched && !tech.available) {
        const hasPrereqs = tech.prerequisites.every(prereq => 
          currentCiv.technologies.includes(prereq)
        );
        if (hasPrereqs) {
          tech.available = true;
        }
      }
    });
  }

  /**
   * Set current research for civilization
   */
  setResearch(civId, techId) {
    const civ = this.civilizations[civId];
    const tech = this.technologies.find(t => t.id === techId);
    
    if (civ && tech && tech.available && !tech.researched) {
      civ.currentResearch = tech;
      civ.researchProgress = 0;
    }
  }

  /**
   * Start a new game
   */
  async newGame() {
    console.log('Starting new game...');
    
    // Reset all state
    this.units = [];
    this.cities = [];
    this.civilizations = [];
    this.technologies = [];
    this.currentTurn = 1;
    this.activePlayer = 0;
    
    // Regenerate world
    await this.generateWorld();
    await this.createCivilizations();
    await this.createTechnologies();
    
    if (this.onStateChange) {
      this.onStateChange('NEW_GAME', {
        map: this.map,
        units: this.units,
        cities: this.cities,
        civilizations: this.civilizations,
        technologies: this.technologies
      });
    }
    
    console.log('New game started!');
  }

  /**
   * Render the game world
   */
  render(ctx, camera) {
    if (!this.isInitialized || !this.map) return;

    // Calculate visible tiles
    const startCol = Math.max(0, Math.floor(camera.x / CONSTANTS.HEX_WIDTH) - 2);
    const endCol = Math.min(this.map.width, Math.ceil((camera.x + ctx.canvas.width / camera.zoom) / CONSTANTS.HEX_WIDTH) + 2);
    const startRow = Math.max(0, Math.floor(camera.y / CONSTANTS.HEX_HEIGHT) - 2);
    const endRow = Math.min(this.map.height, Math.ceil((camera.y + ctx.canvas.height / camera.zoom) / CONSTANTS.HEX_HEIGHT) + 2);

    // Render terrain tiles
    for (let row = startRow; row < endRow; row++) {
      for (let col = startCol; col < endCol; col++) {
        const tile = this.getTileAt(col, row);
        if (tile) {
          this.renderTile(ctx, tile, col, row);
        }
      }
    }

    // Render cities
    for (const city of this.cities) {
      if (city.col >= startCol && city.col < endCol && city.row >= startRow && city.row < endRow) {
        this.renderCity(ctx, city);
      }
    }

    // Render units
    for (const unit of this.units) {
      if (unit.col >= startCol && unit.col < endCol && unit.row >= startRow && unit.row < endRow) {
        this.renderUnit(ctx, unit);
      }
    }
  }

  /**
   * Render a terrain tile
   */
  renderTile(ctx, tile, col, row) {
    const vertices = this.squareGrid.getSquareVertices(col, row);
    const terrainProps = TERRAIN_PROPS[tile.type];
    
    // Fill tile
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
    
    ctx.fillStyle = terrainProps ? terrainProps.color : '#666666';
    ctx.fill();
    
    // Draw border
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * Render a city
   */
  renderCity(ctx, city) {
    const center = this.squareGrid.squareToScreen(city.col, city.row);
    const civ = this.civilizations[city.civilizationId];
    
    // Draw city circle
    ctx.beginPath();
    ctx.arc(center.x, center.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = civ ? civ.color : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw city name
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(city.name, center.x, center.y - 20);
  }

  /**
   * Render a unit
   */
  renderUnit(ctx, unit) {
    const center = this.squareGrid.squareToScreen(unit.col, unit.row);
    const civ = this.civilizations[unit.civilizationId];
  const unitProps = UNIT_PROPS[unit.type];
  const unitTypeDef = UNIT_TYPES[unit.type?.toUpperCase()] || null;
    
    // Draw unit background
    ctx.beginPath();
    ctx.arc(center.x, center.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = civ ? civ.color : '#888888';
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw unit icon/text
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(unitTypeDef?.icon || unitProps?.icon || '?', center.x, center.y + 3);
  }

  /**
   * Unit actions
   */
  unitSleep(unitId) {
    const unit = this.units.find(u => u.id === unitId);
    if (unit) {
      unit.movesRemaining = 0;
    }
  }

  unitFortify(unitId) {
    const unit = this.units.find(u => u.id === unitId);
    if (unit) {
      unit.isFortified = true;
      unit.movesRemaining = 0;
    }
  }

  skipUnit(unitId) {
    const unit = this.units.find(u => u.id === unitId);
    if (unit) {
      unit.movesRemaining = 0;
    }
  }

  buildImprovement(unitId, improvementType) {
    const unit = this.units.find(u => u.id === unitId);
    if (unit) {
      const tile = this.getTileAt(unit.col, unit.row);
      if (tile) {
        tile.improvement = improvementType;
        unit.movesRemaining = 0;
      }
    }
  }
}