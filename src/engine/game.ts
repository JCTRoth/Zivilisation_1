// Main Game Engine - Legacy Implementation (Converted to TypeScript)

import { CONSTANTS } from '../utils/constants';
import { GameUtils, EventEmitter } from '../utils/helpers';
import { GameMap } from '../game/map';

// Type definitions
interface GameState {
    gameMap: GameMap | null;
    renderer: any;
    inputManager: any;
    ui: any;
    running: boolean;
    lastFrameTime: number;
    targetFPS: number;
    frameTime: number;
    frameCount: number;
    fpsDisplay: number;
    lastFPSTime: number;
    needsRender: boolean;
}

// Main Game Engine
export class Game extends EventEmitter {
    // Game state
    public gameMap: GameMap | null;
    public renderer: any;
    public inputManager: any;
    public ui: any;

    // Game loop
    public running: boolean;
    public lastFrameTime: number;
    public targetFPS: number;
    public frameTime: number;

    // Performance monitoring
    public frameCount: number;
    public fpsDisplay: number;
    public lastFPSTime: number;

    // Rendering flag
    public needsRender: boolean;

    constructor() {
        super();

        // Game state
        this.gameMap = null;
        this.renderer = null;
        this.inputManager = null;
        this.ui = null;

        // Game loop
        this.running = false;
        this.lastFrameTime = 0;
        this.targetFPS = 60;
        this.frameTime = 1000 / this.targetFPS;

        // Performance monitoring
        this.frameCount = 0;
        this.fpsDisplay = 0;
        this.lastFPSTime = 0;

        // Rendering flag
        this.needsRender = true;
    }

    // Initialize the game
    async initialize(): Promise<void> {
        try {
            console.log('Initializing Civilization game...');

            // Get canvas elements
            const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
            const miniMapCanvas = document.getElementById('miniMapCanvas') as HTMLCanvasElement;

            if (!canvas || !miniMapCanvas) {
                throw new Error('Canvas elements not found');
            }

            // Create game map
            this.gameMap = GameMap.createGame({
                mapWidth: CONSTANTS.MAP_WIDTH,
                mapHeight: CONSTANTS.MAP_HEIGHT,
                civilizations: ['romans', 'babylonians', 'germans', 'egyptians'],
                humanPlayer: 'romans'
            });

            // Initialize renderer
            this.renderer = new (require('./renderer').Renderer)(canvas, miniMapCanvas);
            this.renderer.setGrid(this.gameMap.grid);

            // Initialize input manager
            this.inputManager = new (require('./input').InputManager)(canvas, this.renderer, this.gameMap);
            this.setupInputEvents();

            // Initialize UI
            this.ui = new (require('../ui/interface').UIManager)(this.gameMap);
            this.setupUIEvents();

            // Make UI globally available for onclick handlers
            (window as any).game.ui = this.ui;

            // Setup game events
            this.setupGameEvents();

            // Center camera on human player's first city
            this.centerOnPlayerCapital();

            // Initialize UI display
            this.ui.update();

            console.log('Game initialized successfully!');

            this.emit('initialized');

        } catch (error) {
            console.error('Failed to initialize game:', error);
            this.showError('Failed to initialize game: ' + (error as Error).message);
        }
    }

    // Setup input event handlers
    setupInputEvents(): void {
        // Hex clicking
        this.inputManager.on('hexClicked', (data: any) => {
            this.handleHexClick(data.col, data.row, data.unit, data.city);
        });

        this.inputManager.on('unitClicked', (data: any) => {
            this.ui.selectUnit(data.unit);
            this.updateSelectionHighlight();
        });

        this.inputManager.on('cityClicked', (data: any) => {
            this.ui.selectCity(data.city);
            this.updateSelectionHighlight();
        });

        this.inputManager.on('hexHover', (data: any) => {
            this.handleHexHover(data.col, data.row);
        });

        // Camera events
        this.inputManager.on('cameraMoved', () => {
            this.needsRender = true;
        });

        this.inputManager.on('zoom', () => {
            this.needsRender = true;
        });
    }

    // Setup UI event handlers
    setupUIEvents(): void {
        this.ui.on('unitSelected', (data: any) => {
            this.updateSelectionHighlight();
            this.showPossibleMoves(data.unit);
        });

        this.ui.on('citySelected', (data: any) => {
            this.updateSelectionHighlight();
            this.clearHighlights();
        });

        this.ui.on('selectionCleared', () => {
            this.clearSelectionHighlight();
            this.clearHighlights();
        });

        this.ui.on('centerOnUnit', (data: any) => {
            this.inputManager.centerOn(data.unit.col, data.unit.row);
        });
    }

    // Setup game event handlers
    setupGameEvents(): void {
        if (!this.gameMap) return;

        this.gameMap.on('civilizationTurnStarted', (data: any) => {
            console.log(`${data.civilization.name}'s turn started`);

            if (data.civilization.isHuman) {
                // Find first active unit for human player
                this.ui.findNextActiveUnit();
            }

            this.needsRender = true;
        });

        this.gameMap.on('newTurn', (data: any) => {
            console.log(`Turn ${data.turn} (${GameUtils.formatYear(data.year)})`);
            this.needsRender = true;
        });

        this.gameMap.on('unitMoved', (data: any) => {
            this.updateSelectionHighlight();
            this.needsRender = true;
        });

        this.gameMap.on('cityAdded', (data: any) => {
            this.needsRender = true;
        });

        this.gameMap.on('civilizationDefeated', (data: any) => {
            console.log(`${data.civilization.name} has been defeated!`);
        });

        this.gameMap.on('gameEnd', (data: any) => {
            this.handleGameEnd(data.winner);
        });
    }

    // Handle hex click
    handleHexClick(col: number, row: number, unit: any, city: any): void {
        if (!this.gameMap) return;

        const selectedUnit = this.ui.selectedUnit;

        if (selectedUnit && selectedUnit.civilization.isHuman) {
            // Try to move selected unit
            if (unit && unit.civilization.id !== selectedUnit.civilization.id) {
                // Attack enemy unit
                if (selectedUnit.canAttack(unit, this.gameMap)) {
                    this.handleCombat(selectedUnit, unit);
                }
            } else {
                // Move to empty tile or friendly tile
                this.handleUnitMovement(selectedUnit, col, row);
            }
        } else if (unit) {
            // Select unit if it belongs to current player
            const activeCiv = this.gameMap.activeCivilization;
            if (unit.civilization.id === activeCiv?.id && activeCiv.isHuman) {
                this.ui.selectUnit(unit);
            }
        } else if (city) {
            // Select city if it belongs to current player
            const activeCiv = this.gameMap.activeCivilization;
            if (city.civilization.id === activeCiv?.id && activeCiv.isHuman) {
                this.ui.selectCity(city);
            }
        }
    }

    // Handle hex hover
    handleHexHover(col: number, row: number): void {
        // Show tile information in status bar
        if (this.gameMap) {
            const tile = this.gameMap.getTile(col, row);
            if (tile) {
                this.ui.updateTileInfo(col, row, tile);
            }
        }
    }

    // Handle unit movement
    handleUnitMovement(unit: any, targetCol: number, targetRow: number): void {
        if (!this.gameMap) return;

        // Check if movement is valid
        const possibleMoves = unit.getPossibleMoves(this.gameMap, this.gameMap.grid);
        const isValidMove = possibleMoves.some((move: any) =>
            move.col === targetCol && move.row === targetRow
        );

        if (isValidMove) {
            // Move unit
            unit.moveTo(targetCol, targetRow, this.gameMap);

            // Clear highlights
            this.clearHighlights();

            // Check for city founding
            if (unit.canSettle) {
                const tile = this.gameMap.getTile(targetCol, targetRow);
                if (tile && this.isGoodSettlementLocation(targetCol, targetRow)) {
                    // Show settle option
                    this.ui.showSettleOption(unit);
                }
            }

            // End unit's turn if no more movement
            if (unit.movement <= 0) {
                this.ui.clearUnitSelection();
            } else {
                // Update possible moves display
                this.showPossibleMoves(unit);
            }
        }
    }

    // Handle combat between units
    handleCombat(attacker: any, defender: any): void {
        if (!this.gameMap) return;

        // Calculate combat results
        const attackerStrength = attacker.getCombatStrength();
        const defenderStrength = defender.getCombatStrength();

        // Simple combat resolution
        const attackerDamage = Math.floor(Math.random() * attackerStrength);
        const defenderDamage = Math.floor(Math.random() * defenderStrength);

        // Apply damage
        defender.hitPoints -= attackerDamage;
        attacker.hitPoints -= defenderDamage;

        // Check for unit death
        if (defender.hitPoints <= 0) {
            this.gameMap.removeUnit(defender.id);
            this.ui.showCombatResult(attacker, defender, true);
        } else if (attacker.hitPoints <= 0) {
            this.gameMap.removeUnit(attacker.id);
            this.ui.showCombatResult(attacker, defender, false);
        } else {
            this.ui.showCombatResult(attacker, defender, null);
        }

        // Clear unit selection and highlights
        this.ui.clearUnitSelection();
        this.clearHighlights();

        this.needsRender = true;
    }

    // Check if location is good for settlement
    isGoodSettlementLocation(col: number, row: number): boolean {
        if (!this.gameMap) return false;

        const tile = this.gameMap.getTile(col, row);
        if (!tile || tile.terrain === CONSTANTS.TERRAIN.OCEAN) return false;

        // Check minimum distance from other cities
        const cities = this.gameMap.getCities();
        const minDistance = 3;

        for (const city of cities) {
            if (this.gameMap.grid.hexDistance(col, row, city.col, city.row) < minDistance) {
                return false;
            }
        }

        return true;
    }

    // Center camera on player's capital
    centerOnPlayerCapital(): void {
        if (!this.gameMap) return;

        const humanPlayer = this.gameMap.getAllCivilizations().find(civ => civ.isHuman);
        if (humanPlayer && humanPlayer.capital) {
            this.inputManager.centerOn(humanPlayer.capital.col, humanPlayer.capital.row);
        }
    }

    // Update selection highlight
    updateSelectionHighlight(): void {
        if (this.ui.selectedUnit) {
            this.renderer.setSelectionHighlight(this.ui.selectedUnit.col, this.ui.selectedUnit.row);
        } else if (this.ui.selectedCity) {
            this.renderer.setSelectionHighlight(this.ui.selectedCity.col, this.ui.selectedCity.row);
        } else {
            this.clearSelectionHighlight();
        }
    }

    // Clear selection highlight
    clearSelectionHighlight(): void {
        this.renderer.clearSelectionHighlight();
    }

    // Show possible moves for unit
    showPossibleMoves(unit: any): void {
        if (!this.gameMap) return;

        const possibleMoves = unit.getPossibleMoves(this.gameMap, this.gameMap.grid);
        this.renderer.setMoveHighlights(possibleMoves);
    }

    // Clear all highlights
    clearHighlights(): void {
        this.renderer.clearMoveHighlights();
        this.renderer.clearAttackHighlights();
    }

    // Handle game end
    handleGameEnd(winner: any): void {
        if (winner) {
            this.showMessage(`${winner.name} has won the game!`);
        } else {
            this.showMessage('The game has ended in a draw.');
        }

        this.running = false;
    }

    // Show message to user
    showMessage(message: string): void {
        console.log(message);
        // In a real implementation, this would show a modal or notification
        alert(message);
    }

    // Show error to user
    showError(message: string): void {
        console.error(message);
        alert('Error: ' + message);
    }

    // Start the game loop
    start(): void {
        if (this.running) return;

        this.running = true;
        this.lastFrameTime = performance.now();
        this.lastFPSTime = this.lastFrameTime;

        console.log('Game started');
        this.gameLoop();
    }

    // Stop the game loop
    stop(): void {
        this.running = false;
        console.log('Game stopped');
    }

    // Main game loop
    gameLoop(): void {
        if (!this.running) return;

        const currentTime = performance.now();
        const deltaTime = currentTime - this.lastFrameTime;

        // Update FPS counter
        this.frameCount++;
        if (currentTime - this.lastFPSTime >= 1000) {
            this.fpsDisplay = Math.round((this.frameCount * 1000) / (currentTime - this.lastFPSTime));
            this.frameCount = 0;
            this.lastFPSTime = currentTime;
        }

        // Cap frame rate
        if (deltaTime >= this.frameTime) {
            this.update(deltaTime);
            this.render();

            this.lastFrameTime = currentTime;
        }

        // Continue loop
        requestAnimationFrame(() => this.gameLoop());
    }

    // Update game state
    update(deltaTime: number): void {
        // Update input manager
        this.inputManager.update(deltaTime);

        // Update UI
        this.ui.update();
    }

    // Render the game
    render(): void {
        if (this.needsRender) {
            this.renderer.render(this.gameMap);
            this.needsRender = false;
        }

        // Always render UI
        this.ui.render();
    }

    // Get game state for debugging
    getGameState(): GameState {
        return {
            gameMap: this.gameMap,
            renderer: this.renderer,
            inputManager: this.inputManager,
            ui: this.ui,
            running: this.running,
            lastFrameTime: this.lastFrameTime,
            targetFPS: this.targetFPS,
            frameTime: this.frameTime,
            frameCount: this.frameCount,
            fpsDisplay: this.fpsDisplay,
            lastFPSTime: this.lastFPSTime,
            needsRender: this.needsRender
        };
    }
}