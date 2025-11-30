import { Constants } from './utils/Constants.js';
import type { GameMap } from './game/Map.js';
import type { Unit } from './game/Unit.js';
import type { City } from './game/City.js';
import type { Civilization } from './game/Civilization.js';
import {DomUtils} from "@/utils/DomUtils";
import {GameUtils} from "@/utils/GameUtils";

interface UIElement {
    civilizationName: HTMLElement;
    currentYear: HTMLElement;
    turn: HTMLElement;
    gold: HTMLElement;
    science: HTMLElement;
    endTurnBtn: HTMLElement;
    menuBtn: HTMLElement;
    unitDetails: HTMLElement;
    cityDetails: HTMLElement;
    statusMessage: HTMLElement;
    cityDialog: HTMLElement;
    cityDialogTitle: HTMLElement;
    cityDialogContent: HTMLElement;
}

interface ProductionItem {
    type: 'unit' | 'building';
    unitType?: string;
    buildingType?: string;
}

interface CityInfo {
    id: string;
    name: string;
    position: { col: number; row: number };
    population: number;
    maxPopulation: number;
    food: number;
    production: number;
    trade: number;
    science: number;
    gold: number;
    buildings: string[];
    civilization: string;
}

interface UnitInfo {
    id: string;
    name: string;
    type: string;
    position: { col: number; row: number };
    movement: number;
    maxMovement: number;
    attack: number;
    defense: number;
    experience: number;
    veteran: boolean;
    fortified: boolean;
    workTarget: string | null;
    workTurns: number;
    civilization: string;
}

export class UIManager {
    private gameMap: GameMap;
    private selectedUnit: Unit | null;
    private selectedCity: City | null;
    private hoveredTile: { col: number; row: number } | null;
    private elements: UIElement;

    constructor(gameMap: GameMap) {

        this.gameMap = gameMap;
        this.selectedUnit = null;
        this.selectedCity = null;
        this.hoveredTile = null;

        // UI Elements
        this.elements = {
            // Top bar
            civilizationName: DomUtils.getElementById('civilizationName'),
            currentYear: DomUtils.getElementById('currentYear'),
            turn: DomUtils.getElementById('turn'),
            gold: DomUtils.getElementById('gold'),
            science: DomUtils.getElementById('science'),

            // Controls
            endTurnBtn: DomUtils.getElementById('endTurnBtn'),
            menuBtn: DomUtils.getElementById('menuBtn'),

            // Side panel
            unitDetails: DomUtils.getElementById('unitDetails'),
            cityDetails: DomUtils.getElementById('cityDetails'),

            // Status bar
            statusMessage: DomUtils.getElementById('statusMessage'),

            // Dialogs
            cityDialog: DomUtils.getElementById('cityDialog'),
            cityDialogTitle: DomUtils.getElementById('cityDialogTitle'),
            cityDialogContent: DomUtils.getElementById('cityDialogContent')
        };

        this.setupEventListeners();
        this.setupGameEventListeners();
    }

    private setupEventListeners(): void {
        // End turn button
        this.elements.endTurnBtn.addEventListener('click', () => {
            this.endTurn();
        });

        // Menu button
        this.elements.menuBtn.addEventListener('click', () => {
            this.showMenu();
        });

        // Close dialogs
        document.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).classList.contains('close')) {
                this.closeDialogs();
            }
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboard(e);
        });
    }

    private setupGameEventListeners(): void {
        // Game events - use callback instead of .on()
        this.gameMap.onStateChange = (eventType: string, data: any) => {
            switch (eventType) {
                case 'civilizationTurnStarted':
                    this.updateTopBar(data.civilization);
                    this.updateStatusMessage(`${data.civilization.name}'s turn`);
                    break;
                case 'newTurn':
                    this.updateTurnDisplay(data.turn, data.year);
                    break;
                case 'unitMoved':
                    this.updateUnitInfo(data.unit);
                    break;
                case 'cityAdded':
                    this.updateStatusMessage(`${data.city.name} founded!`);
                    break;
                case 'civilizationDefeated':
                    this.showNotification(`${data.civilization.name} has been defeated!`);
                    break;
                case 'gameEnd':
                    this.showGameEnd(data.winner);
                    break;
            }
        };
    }

    // Update top bar information
    updateTopBar(civilization: Civilization): void {
        if (!civilization) return;

        this.elements.civilizationName.textContent = civilization.name;
        this.elements.gold.textContent = civilization.gold.toString();
        this.elements.science.textContent = civilization.science.toString();
    }

    // Update turn and year display
    updateTurnDisplay(turn: number, year: number): void {
        this.elements.turn.textContent = `Turn ${turn}`;
        this.elements.currentYear.textContent = GameUtils.formatYear(year);
    }

    // Update status message
    updateStatusMessage(message: string): void {
        this.elements.statusMessage.textContent = message;

        // Auto-hide after delay
        setTimeout(() => {
            if (this.elements.statusMessage.textContent === message) {
                this.elements.statusMessage.textContent = '';
            }
        }, 3000);
    }

    // Show notification
    showNotification(message: string, type: string = 'info'): void {
        // Create notification element
        const notification = DomUtils.createElement('div', {
            class: `notification ${type}`
        }, message);

        document.body.appendChild(notification);

        // Animate in
        setTimeout(() => notification.classList.add('fade-in'), 10);

        // Remove after delay
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => document.body.removeChild(notification), 300);
        }, 3000);
    }

    // Handle unit selection
    selectUnit(unit: Unit | null): void {
        // Clear previous selection
        if (this.selectedUnit) {
            this.selectedUnit = null;
        }

        this.selectedUnit = unit;
        this.selectedCity = null;

        if (unit) {
            this.updateUnitInfo(unit);
            this.updateStatusMessage(`Selected: ${unit.name}`);
            if (this.onStateChange) { this.onStateChange('unitSelected', { unit }); }
        } else {
            this.clearUnitInfo();
        }
    }

    // Handle city selection
    selectCity(city: City | null): void {
        // Clear previous selection
        if (this.selectedCity) {
            this.selectedCity = null;
        }

        this.selectedCity = city;
        this.selectedUnit = null;

        if (city) {
            this.updateCityInfo(city);
            this.updateStatusMessage(`Selected: ${city.name}`);
            if (this.onStateChange) { this.onStateChange('citySelected', { city }); }
        } else {
            this.clearCityInfo();
        }
    }

    // Update unit information panel
    updateUnitInfo(unit: Unit): void {
        if (!unit) {
            this.clearUnitInfo();
            return;
        }

        const info: UnitInfo = unit.getInfo();

        this.elements.unitDetails.innerHTML = `
            <h4>${info.name}</h4>
            <div class="unit-stats">
                <div class="stat-row">
                    <span>Movement:</span>
                    <span>${info.movement}/${info.maxMovement}</span>
                </div>
                <div class="stat-row">
                    <span>Attack:</span>
                    <span>${info.attack}</span>
                </div>
                <div class="stat-row">
                    <span>Defense:</span>
                    <span>${info.defense}</span>
                </div>
                ${info.experience > 0 ? `
                <div class="stat-row">
                    <span>Experience:</span>
                    <span>${info.experience}/100</span>
                </div>
                ` : ''}
                ${info.veteran ? '<div class="stat-row"><strong>Veteran</strong></div>' : ''}
                ${info.fortified ? '<div class="stat-row"><strong>Fortified</strong></div>' : ''}
            </div>
            <div class="unit-actions">
                ${this.generateUnitActions(unit)}
            </div>
        `;
    }

    // Generate unit action buttons
    private generateUnitActions(unit: Unit): string {
        let actions = '';

        if (unit.canSettle) {
            actions += '<button class="btn btn-small" onclick="game.ui.settleCity()">Settle</button>';
        }

        if (unit.canWork) {
            actions += '<button class="btn btn-small" onclick="game.ui.showWorkOptions()">Work</button>';
        }

        if (!unit.fortified && !unit.moved) {
            actions += '<button class="btn btn-small" onclick="game.ui.fortifyUnit()">Fortify</button>';
        }

        if (unit.moved) {
            actions += '<button class="btn btn-small" onclick="game.ui.waitUnit()">Wait</button>';
        } else {
            actions += '<button class="btn btn-small" onclick="game.ui.skipUnit()">Skip</button>';
        }

        return actions;
    }

    // Clear unit information
    clearUnitInfo(): void {
        this.elements.unitDetails.innerHTML = '<p>Select a unit to view details</p>';
    }

    // Update city information panel
    updateCityInfo(city: City): void {
        if (!city) {
            this.clearCityInfo();
            return;
        }

        const info: CityInfo = city.getInfo();

        this.elements.cityDetails.innerHTML = `
            <h4>${info.name}</h4>
            <div class="city-stats">
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Population</span>
                        <span class="info-value">${info.population}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Food</span>
                        <span class="info-value">${info.food}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Production</span>
                        <span class="info-value">${info.production}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Trade</span>
                        <span class="info-value">${info.trade}</span>
                    </div>
                </div>

                <div class="city-buildings">
                    <h3>Buildings</h3>
                    ${this.generateBuildingsList(info.buildings)}
                </div>
            </div>

            <div class="city-actions">
                <button class="btn btn-small" onclick="game.ui.openCityDialog()">Manage</button>
            </div>
        `;
    }    // Get production item name

    // Calculate production progress percentage
    private getProductionProgress(cityInfo: CityInfo): number {
        // Stub implementation - production system not yet implemented
        return 0;
    }

    // Get production cost
    private getProductionCost(production: ProductionItem): number {
        if (production.type === 'unit') {
            return Constants.UNIT_PROPS[production.unitType!]?.cost || 0;
        } else if (production.type === 'building') {
            return Constants.BUILDING_PROPS[production.buildingType!]?.cost || 0;
        }
        return 0;
    }

    // Clear city information
    clearCityInfo(): void {
        this.elements.cityDetails.innerHTML = '<p>Select a city to view details</p>';
    }

    // Open city management dialog
    openCityDialog(): void {
        if (!this.selectedCity) return;

        const city = this.selectedCity;
        const info: CityInfo = city.getInfo();

        this.elements.cityDialogTitle.textContent = info.name;
        this.elements.cityDialogContent.innerHTML = this.generateCityDialogContent(info);

        this.elements.cityDialog.classList.remove('hidden');
    }

    // Generate city dialog content
    private generateCityDialogContent(cityInfo: CityInfo): string {
        let content = `
            <div class="city-overview">
                <div class="city-yields">
                    <h3>City Yields</h3>
                    <div class="info-grid">
                        <div class="info-item">
                            <span class="info-label">Food</span>
                            <span class="info-value">${cityInfo.food}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Production</span>
                            <span class="info-value">${cityInfo.production}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Trade</span>
                            <span class="info-value">${cityInfo.trade}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Science</span>
                            <span class="info-value">${cityInfo.science}</span>
                        </div>
                    </div>
                </div>

                <div class="city-production">
                    <h4>Available Productions</h4>
                    ${this.generateAvailableProductions()}
                </div>

                <div class="city-buildings">
                    <h3>Buildings</h3>
                    ${this.generateBuildingsList(cityInfo.buildings)}
                </div>
            </div>
        `;

        return content;
    }

    // Generate production queue display
    private generateProductionQueue(cityInfo: CityInfo): string {
        // Stub implementation - production queue not yet implemented
        return '<div class="production-queue"><p>Production system not yet implemented</p></div>';
    }

    // Generate available productions
    private generateAvailableProductions(): string {
        const activeCiv = this.gameMap.activeCivilization;
        if (!activeCiv) return '';

        let content = '<div class="available-productions">';

        // Units
        content += '<h5>Units</h5>';
        for (const [unitType, props] of Object.entries(Constants.UNIT_PROPS)) {
            if (this.canProduceUnit(unitType, activeCiv)) {
                content += `
                    <div class="production-option" onclick="game.ui.addToQueue('unit', '${unitType}')">
                        <span>${props.name}</span>
                        <span class="cost">${props.cost}</span>
                    </div>
                `;
            }
        }

        // Buildings
        content += '<h5>Buildings</h5>';
        for (const [buildingType, props] of Object.entries(Constants.BUILDING_PROPS)) {
            if (this.canProduceBuilding(buildingType, activeCiv)) {
                content += `
                    <div class="production-option" onclick="game.ui.addToQueue('building', '${buildingType}')">
                        <span>${props.name}</span>
                        <span class="cost">${props.cost}</span>
                    </div>
                `;
            }
        }

        content += '</div>';
        return content;
    }

    // Check if unit can be produced
    private canProduceUnit(unitType: string, civilization: Civilization): boolean {
        // Check technology requirements
        // This would need to be expanded based on tech tree
        return true;
    }

    // Check if building can be produced
    private canProduceBuilding(buildingType: string, civilization: Civilization): boolean {
        // Check if city already has this building
        if (this.selectedCity && this.selectedCity.buildings.has(buildingType)) {
            return false;
        }

        // Check technology requirements
        // This would need to be expanded based on tech tree
        return true;
    }

    // Generate buildings list
    private generateBuildingsList(buildings: string[]): string {
        if (buildings.length === 0) {
            return '<p>No buildings constructed</p>';
        }

        let content = '<div class="buildings-list">';
        for (const buildingType of buildings) {
            const props = Constants.BUILDING_PROPS[buildingType];
            if (props) {
                content += `
                    <div class="building-item">
                        <span>${props.name}</span>
                        <span class="maintenance">-${props.maintenance} gold</span>
                    </div>
                `;
            }
        }
        content += '</div>';

        return content;
    }

    // Close dialogs
    closeDialogs(): void {
        this.elements.cityDialog.classList.add('hidden');
    }

    // Handle keyboard input
    handleKeyboard(event: KeyboardEvent): void {
        // Prevent default for game keys
        const gameKeys = ['Space', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (gameKeys.includes(event.code)) {
            event.preventDefault();
        }

        switch (event.code) {
            case 'Space':
            case 'Enter':
                this.endTurn();
                break;
            case 'Escape':
                this.closeDialogs();
                this.clearSelection();
                break;
            case 'KeyF':
                if (this.selectedUnit && !this.selectedUnit.moved) {
                    this.fortifyUnit();
                }
                break;
            case 'KeyS':
                if (this.selectedUnit && this.selectedUnit.canSettle) {
                    this.settleCity();
                }
                break;
            case 'KeyW':
                if (this.selectedUnit) {
                    this.waitUnit();
                }
                break;
            case 'KeyR':
                if (this.selectedUnit && this.selectedUnit.type === 'settler') {
                    this.buildRailroad();
                }
                break;
        }
    }

    // Unit action methods
    settleCity(): void {
        if (this.selectedUnit && this.selectedUnit.canSettle) {
            const city = this.selectedUnit.settle(this.gameMap);
            if (city) {
                this.selectCity(city);
                this.updateStatusMessage(`${city.name} founded!`);
            } else {
                this.updateStatusMessage('Cannot settle here');
            }
        }
    }

    fortifyUnit(): void {
        if (this.selectedUnit && !this.selectedUnit.moved) {
            this.selectedUnit.fortify();
            this.updateUnitInfo(this.selectedUnit);
            this.updateStatusMessage(`${this.selectedUnit.name} fortified`);
        }
    }

    waitUnit(): void {
        if (this.selectedUnit) {
            this.selectedUnit.endTurn();
            this.findNextActiveUnit();
        }
    }

    buildRailroad(): void {
        if (this.selectedUnit && this.selectedUnit.type === 'settler') {
            if (this.selectedUnit.startWork('railroad', this.gameMap)) {
                this.updateUnitInfo(this.selectedUnit);
                this.updateStatusMessage(`${this.selectedUnit.name} started building railroad`);
            } else {
                this.updateStatusMessage('Cannot build railroad here');
            }
        }
    }

    skipUnit(): void {
        if (this.selectedUnit) {
            this.selectedUnit.movement = 0;
            this.findNextActiveUnit();
        }
    }

    // Find next unit that can act
    findNextActiveUnit(): void {
        const activeCiv = this.gameMap.activeCivilization;
        if (!activeCiv || !activeCiv.isHuman) return;

        const units = this.gameMap.getUnitsByCivilization(activeCiv.id);
        const activeUnits = units.filter(unit =>
            unit.active && unit.movement > 0 && !unit.moved
        );

        if (activeUnits.length > 0) {
            this.selectUnit(activeUnits[0]);
            if (this.onStateChange) { this.onStateChange('centerOnUnit', { unit: activeUnits[0] }); }
        } else {
            this.selectUnit(null);
        }
    }

    // Add item to city production queue
    addToQueue(type: 'unit' | 'building', itemType: string): void {
        if (!this.selectedCity) return;

        // Stub implementation - production queue not yet implemented
        this.showNotification('Production queue not yet implemented');
    }

    // Remove item from production queue
    removeFromQueue(index: number): void {
        if (!this.selectedCity) return;

        // Stub implementation - production queue not yet implemented
        this.showNotification('Production queue not yet implemented');
    }

    // End turn
    endTurn(): void {
        this.gameMap.nextTurn();
        this.clearSelection();

        // If it's still human player's turn, select first active unit
        if (this.gameMap.activeCivilization?.isHuman) {
            this.findNextActiveUnit();
        }
    }

    // Clear all selections
    clearSelection(): void {
        this.selectUnit(null);
        this.selectCity(null);
        // Selection cleared (no need to emit event)
    }

    // Show menu
    showMenu(): void {
        // This would show a game menu with save/load/settings options
        this.showNotification('Menu not yet implemented');
    }

    // Show work options for worker units
    showWorkOptions(): void {
        if (!this.selectedUnit || !this.selectedUnit.canWork) return;

        // This would show available improvements to build
        this.showNotification('Work options not yet implemented');
    }

    // Show game end screen
    showGameEnd(winner: Civilization | null): void {
        const message = winner ?
            `${winner.name} has won the game!` :
            'The game has ended!';

        this.showNotification(message, 'victory');
    }

    // Update all UI elements
    update(): void {
        const activeCiv = this.gameMap.activeCivilization;
        if (activeCiv) {
            this.updateTopBar(activeCiv);
        }

        this.updateTurnDisplay(this.gameMap.currentTurn, this.gameMap.currentYear);

        if (this.selectedUnit) {
            this.updateUnitInfo(this.selectedUnit);
        }

        if (this.selectedCity) {
            this.updateCityInfo(this.selectedCity);
        }
    }
}

// Make UI actions available globally for onclick handlers
declare global {
    interface Window {
        game: {
            ui: UIManager | null;
        };
    }
}

if (!window.game) {
    window.game = { ui: null };
}