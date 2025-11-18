import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Modal, Button, Tab, Tabs, Card, ListGroup } from 'react-bootstrap';
import TechTreeView from './TechTreeView';
import CityModal from './gamemodals/CityModal';
import HexDetailModal from './gamemodals/HexDetailModal';
import { useGameStore } from '../../stores/GameStore';
import { CityUtils } from '../../utils/Helpers';
import { UNIT_PROPS } from '../../utils/Constants';
import { BUILDING_PROPERTIES } from '../../data/BuildingConstants';
import '../../styles/gameModals.css';

const GameModals = ({ gameEngine }) => {
  // console.log('[GameModals] Component rendering, gameEngine present:', !!gameEngine);
  const uiState = useGameStore(state => state.uiState);
  const actions = useGameStore(state => state.actions);
  const gameState = useGameStore(state => state.gameState);
  const selectedCityId: string | null = useGameStore(state => state.gameState.selectedCity);
  const cities = useGameStore(state => state.cities);
  const technologies = useGameStore(state => state.technologies);
  const playerResources = useGameStore(state => state.playerResources);
  const currentPlayer = useGameStore(state => state.civilizations[state.gameState.activePlayer] || null);

  const units = useGameStore(state => state.units);
  const map = gameEngine?.map;

  const selectedCity = cities.find(c => c.id === selectedCityId);

  // Check if the selected city belongs to the current player
  const isPlayerCity = selectedCity && currentPlayer && selectedCity.civilizationId === currentPlayer.id;

  // Always use fresh selectedCity from Zustand

  const capitalizeName = (value?: string | null) => {
    if (!value) return '';
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const getProductionPerTurn = (city: any): number => {
    if (!city) return 0;
    if (typeof city?.yields?.production === 'number') return city.yields.production;
    if (typeof city?.production === 'number') return city.production;
    if (typeof city?.output?.production === 'number') return city.output.production;
    return 0;
  };

  const getProductionProgressValue = (city: any): number => {
  if (!city) return 0;
  // Prefer productionStored for progress
  if (typeof city?.productionStored === 'number') return city.productionStored;
  if (typeof city?.productionProgress === 'number') return city.productionProgress;
  if (typeof city?.shields === 'number') return city.shields;
  return 0;
  };

  const getProductionCost = (item: any): number => {
    if (!item) return 0;
    if (typeof item === 'number') return item;
    if (typeof item === 'string') {
      const unitDef = UNIT_PROPS[item];
      if (unitDef && typeof unitDef.cost === 'number') return unitDef.cost;
      const buildingDef = BUILDING_PROPERTIES[item];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
      return 0;
    }
    if (typeof item.cost === 'number') return item.cost;
    if (item.itemType) {
      const unitDef = UNIT_PROPS[item.itemType];
      if (unitDef && typeof unitDef.cost === 'number') return unitDef.cost;
      const buildingDef = BUILDING_PROPERTIES[item.itemType];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    if (item.type) {
      const buildingDef = BUILDING_PROPERTIES[item.type];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    if (item.name && typeof item.name === 'string') {
      const normalizedName = item.name.toLowerCase().replace(/\s+/g, '_');
      const buildingDef = BUILDING_PROPERTIES[normalizedName];
      if (buildingDef && typeof buildingDef.cost === 'number') return buildingDef.cost;
    }
    return 0;
  };

  const getProductionName = (item: any): string => {
    if (!item) return 'Unknown';
    if (typeof item === 'string') {
      return UNIT_PROPS[item]?.name || BUILDING_PROPERTIES[item]?.name || capitalizeName(item);
    }
    if (item.name) return item.name;
    if (item.itemType) {
      return UNIT_PROPS[item.itemType]?.name || BUILDING_PROPERTIES[item.itemType]?.name || capitalizeName(item.itemType);
    }
    if (item.type) {
      return BUILDING_PROPERTIES[item.type]?.name || capitalizeName(item.type);
    }
    return 'Unknown';
  };

  const handleCloseDialog = () => {
    actions.hideDialog();
  };

  const handleNewGame = () => {
    console.log('[CLICK] New Game button');
    if (gameEngine) {
      gameEngine.newGame();
    }
    handleCloseDialog();
  };

  const handleResearchTechnology = (techId) => {
    console.log(`[CLICK] Research technology: ${techId}`);
    if (gameEngine && currentPlayer) {
      gameEngine.setResearch(currentPlayer.id, techId);
    }
    handleCloseDialog();
  };

  // Helpers: compute prerequisite depth (used to infer era) and group by era
  const getPrerequisiteDepth = (techId: string, visited = new Set()): number => {
    const tech = technologies?.find(t => t.id === techId);
    if (!tech || visited.has(techId)) return 0;
    visited.add(techId);
    if (!tech.prerequisites || tech.prerequisites.length === 0) return 0;
    const depths = tech.prerequisites.map(pr => getPrerequisiteDepth(pr, new Set(visited)));
    return Math.max(...depths) + 1;
  };

  const eraFromDepth = (depth: number) => {
    if (depth === 0) return 'Ancient';
    if (depth === 1) return 'Classical';
    if (depth === 2) return 'Medieval';
    if (depth === 3) return 'Renaissance';
    return 'Industrial';
  };

  const groupByEra = (list) => {
    const groups: Record<string, typeof list> = {};
    (list || []).forEach(tech => {
      const depth = getPrerequisiteDepth(tech.id);
      const era = eraFromDepth(depth);
      if (!groups[era]) groups[era] = [];
      groups[era].push(tech);
    });
    return groups;
  };

  // Game Menu Modal
  const renderGameMenu = () => (
    <Modal show={uiState.activeDialog === 'game-menu'} onHide={handleCloseDialog} centered>
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-gear"></i> Game Menu
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <div className="d-grid gap-2">
          <Button variant="primary" size="lg" onClick={handleNewGame}>
            <i className="bi bi-plus-circle"></i> New Game
          </Button>
          
          <Button variant="info" size="lg" onClick={() => console.log('[CLICK] Save Game button (not implemented)')}>
            <i className="bi bi-download"></i> Save Game
          </Button>
          
          <Button variant="warning" size="lg" onClick={() => console.log('[CLICK] Load Game button (not implemented)')}>
            <i className="bi bi-upload"></i> Load Game
          </Button>
          
          <Button variant="secondary" size="lg" onClick={() => console.log('[CLICK] Settings button (not implemented)')}>
            <i className="bi bi-gear"></i> Settings
          </Button>
          
          <Button 
            variant="outline-light" 
            size="lg"
            onClick={() => {
              console.log('[CLICK] Help button');
              actions.showDialog('help');
            }}
          >
            <i className="bi bi-question-circle"></i> Help
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );

  // Technology Tree Modal
  const renderTechTree = () => (
    <Modal 
      show={uiState.activeDialog === 'tech'} 
      onHide={handleCloseDialog} 
      centered
      fullscreen={true}
      dialogClassName="tech-tree-modal"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-lightbulb"></i> Technology Tree
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white tech-tree-modal-body">
        <div className="tech-tree-container">
          <React.Suspense fallback={<div className="text-white p-3">Loading tree...</div>}>
            <TechTreeView technologies={technologies} width={Math.max(window.innerWidth - 200, 800)} />
          </React.Suspense>
        </div>
      </Modal.Body>
    </Modal>
  );

  // Diplomacy Modal
  const renderDiplomacy = () => (
    <Modal 
      show={uiState.activeDialog === 'diplomacy'} 
      onHide={handleCloseDialog} 
      centered
      size="lg"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-people"></i> Diplomacy
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <p>Diplomacy system coming soon...</p>
        <p>Features will include:</p>
        <ul>
          <li>Trade agreements</li>
          <li>Peace treaties</li>
          <li>Military alliances</li>
          <li>Technology exchanges</li>
          <li>Territorial negotiations</li>
        </ul>
      </Modal.Body>
    </Modal>
  );

  // Help Modal
  const renderHelp = () => (
    <Modal 
      show={uiState.activeDialog === 'help'} 
      onHide={handleCloseDialog} 
      centered
      size="lg"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-question-circle"></i> Help & Controls
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white city-detail-modal-body">
        <Tabs defaultActiveKey="controls" className="mb-3">
          <Tab eventKey="controls" title="Controls">
            <h6>Mouse Controls:</h6>
            <ListGroup variant="flush" className="mb-3">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Left Click:</strong> Select units, cities, or hexes
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Right Click:</strong> Context menu (coming soon)
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Drag:</strong> Pan the camera around the map
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Scroll Wheel:</strong> Zoom in and out
              </ListGroup.Item>
            </ListGroup>

            <h6>Keyboard Shortcuts:</h6>
            <ListGroup variant="flush">
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Space/Enter:</strong> End turn
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>H:</strong> Show this help dialog
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>T:</strong> Open technology tree
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>D:</strong> Open diplomacy
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>M:</strong> Toggle minimap
              </ListGroup.Item>
              <ListGroup.Item className="bg-dark text-white border-secondary">
                <strong>Escape:</strong> Close dialogs
              </ListGroup.Item>
            </ListGroup>
          </Tab>
          
          <Tab eventKey="gameplay" title="Gameplay">
            <h6>Getting Started:</h6>
            <ol>
              <li>Move your settler to a good location near water and resources</li>
              <li>Found your first city by selecting the settler and clicking "Found City"</li>
              <li>Explore with your warrior to find other civilizations and resources</li>
              <li>Build more units and buildings in your cities</li>
              <li>Research technologies to unlock new capabilities</li>
              <li>Expand your civilization and compete with others!</li>
            </ol>

            <h6>Resources:</h6>
            <ul>
              <li><strong>Food:</strong> Grows city population</li>
              <li><strong>Production:</strong> Builds units and structures</li>
              <li><strong>Trade:</strong> Generates gold and science</li>
              <li><strong>Science:</strong> Researches new technologies</li>
              <li><strong>Gold:</strong> Maintains units and buildings</li>
            </ul>
          </Tab>
          
          <Tab eventKey="about" title="About">
            <h5>Civilization Browser</h5>
            <p>A browser-based recreation of the classic Civilization game.</p>
            
            <h6>Built With:</h6>
            <ul>
              <li>React.js with hooks and modern patterns</li>
              <li>Jotai for state management</li>
              <li>Bootstrap for UI components</li>
              <li>HTML5 Canvas for game rendering</li>
              <li>Vite for fast development and building</li>
            </ul>

            <h6>Features:</h6>
            <ul>
              <li>Hexagonal grid map system</li>
              <li>Turn-based gameplay with AI opponents</li>
              <li>City building and management</li>
              <li>Unit movement and combat</li>
              <li>Technology research tree</li>
              <li>Resource management</li>
              <li>Responsive design for desktop and mobile</li>
            </ul>

            <p className="mt-3">
              <small className="text-muted">
                This is a fan-made recreation for educational purposes.
                Original Civilization © MicroProse/Firaxis Games
              </small>
            </p>
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  );

  // City Production Modal
  const handleStartProduction = (unitKey: string) => {
    if (!selectedCity) return;
    const unitDef = UNIT_PROPS[unitKey];
    if (!unitDef) return;

    const item = {
      type: 'unit',
      itemType: unitKey,
      name: unitDef.name,
      cost: unitDef.cost
    };

    if (gameEngine && typeof gameEngine.setCityProduction === 'function') {
      gameEngine.setCityProduction(selectedCity.id, item, false);
      actions.addNotification({ type: 'success', message: `Started production: ${item.name}` });
    }

    // Close dialog after selecting
    actions.hideDialog();
  };

  const handleQueueProduction = (unitKey: string) => {
    if (!selectedCity) {
      console.warn('[GameModals] handleQueueProduction: No city selected');
      return;
    }
    const unitDef = UNIT_PROPS[unitKey];
    if (!unitDef) {
      console.warn('[GameModals] handleQueueProduction: Invalid unit key', unitKey);
      return;
    }

    const item = {
      type: 'unit',
      itemType: unitKey,
      name: unitDef.name,
      cost: unitDef.cost
    };

    console.log('[GameModals] handleQueueProduction: gameEngine object', gameEngine);
    if (gameEngine && typeof gameEngine.getAllCities === 'function') {
      console.log('[GameModals] handleQueueProduction: gameEngine.getAllCities()', gameEngine.getAllCities());
    }

    if (gameEngine) {
      const hasMethod = typeof (gameEngine as any).setCityProduction === 'function';
      console.log('[GameModals] handleQueueProduction: engine method present?', { hasMethod });
      let ok: any = null;
      try {
        if (hasMethod) ok = (gameEngine as any).setCityProduction(selectedCity.id, item, true);
        else console.warn('[GameModals] handleQueueProduction: setCityProduction not available on engine');
      } catch (e) {
        console.error('[GameModals] handleQueueProduction: exception calling setCityProduction', e);
      }

      console.log('[GameModals] handleQueueProduction: setCityProduction returned', ok);

      // Always try to inspect engine city list for debugging
      try {
        if ((gameEngine as any).getAllCities) {
          const allCities = (gameEngine as any).getAllCities();
          console.log('[GameModals] handleQueueProduction: engine.getAllCities()', allCities.map(c => ({ id: c.id, buildQueue: c.buildQueue })));
          actions.updateCities(allCities);
          const updated = allCities.find((c: any) => c.id === selectedCity.id);
          console.log('[GameModals] handleQueueProduction: updated selectedCity from engine', { id: updated?.id, buildQueue: updated?.buildQueue });
        }
      } catch (e) {
        console.error('[GameModals] handleQueueProduction: error reading engine cities', e);
      }

      const success = ok && (ok.success === true || ok === true);
      if (success) {
        actions.addNotification({ type: 'info', message: `Queued production: ${item.name}` });
      } else {
        actions.addNotification({ type: 'warning', message: `Failed to queue: ${item.name}` });
      }
    }

    console.log('[GameModals] handleQueueProduction: After queue', {
      cityId: selectedCity.id,
      buildQueue: selectedCity.buildQueue
    });
  };

  // New: track a single selected production item for the select box
  const [selectedProductionKey, setSelectedProductionKey] = useState<string | null>(null);
  // Track selected index in the queue (for removal)
  const [selectedQueueIndex, setSelectedQueueIndex] = useState<number | null>(null);

  // Helper function to check if a city is coastal (has water tiles adjacent or on its position)
  const checkIfCityIsCoastal = useCallback((city: any, gameEngine: any): boolean => {
    if (!gameEngine || !gameEngine.map || !gameEngine.map.getTile) return false;
    
    const directions = [
      { col: 0, row: 0 }, // city tile itself
      { col: -1, row: -1 }, { col: 0, row: -1 }, { col: 1, row: -1 },
      { col: -1, row: 0 }, { col: 1, row: 0 },
      { col: -1, row: 1 }, { col: 0, row: 1 }, { col: 1, row: 1 }
    ];
    
    for (const dir of directions) {
      const tile = gameEngine.map.getTile(city.col + dir.col, city.row + dir.row);
      if (tile && (tile.terrain === 'ocean' || tile.terrain === 'coast')) {
        return true;
      }
    }
    return false;
  }, []);

  // Build available items list (filtered) using same logic as render list
  const availableProductionKeys = useMemo(() => {
    return Object.keys(UNIT_PROPS).filter((key) => {
      const u = UNIT_PROPS[key];
      const req = (u as any).requires || null;
      if (req && currentPlayer && Array.isArray(currentPlayer.technologies)) {
        // Handle both single requirement and array of requirements
        const requirements = Array.isArray(req) ? req : [req];
        const hasAllRequiredTechs = requirements.every((tech: string) => currentPlayer.technologies.includes(tech));
        if (!hasAllRequiredTechs) return false;
      }

      if (u.naval && selectedCity) {
        // Check if city has harbor or is coastal (tile or adjacent tiles are water)
        const hasHarbor = selectedCity.buildings && selectedCity.buildings.includes('harbor');
        if (!hasHarbor) {
          const isCoastal = checkIfCityIsCoastal(selectedCity, gameEngine);
          if (!isCoastal) return false;
        }
      }

      return true;
    });
  }, [currentPlayer, selectedCity, checkIfCityIsCoastal]);

  // Ensure there is a default selection when modal opens or available list changes
  useEffect(() => {
    if (!selectedProductionKey && availableProductionKeys && availableProductionKeys.length > 0) {
      setSelectedProductionKey(availableProductionKeys[0]);
    }
    // Clear selection if nothing available
    if (availableProductionKeys.length === 0) setSelectedProductionKey(null);
    // Log available production options for debugging
    // console.log('[GameModals] availableProductionKeys', availableProductionKeys);
  }, [availableProductionKeys]);

  // Reset queue selection when the selected city changes
  useEffect(() => {
    setSelectedQueueIndex(null);
    if (selectedCity) console.log('[GameModals] selectedCity changed', { id: selectedCity.id, name: selectedCity.name, buildQueue: selectedCity.buildQueue });
  }, [selectedCityId]);

  const renderCityProduction = () => (
    <Modal
      show={uiState.activeDialog === 'city-production'}
      onHide={handleCloseDialog}
      centered
      size="lg"
      dialogClassName="city-production-modal"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-gear"></i> {selectedCity?.name || 'City Production'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <div className="row">
          <div className="col-md-12 mb-2">
            <p>Select a unit to produce in this city. Production cost is shown in shields.</p>
          </div>
        </div>
        {renderProductionContent()}
      </Modal.Body>
    </Modal>
  );

  // Reusable production list content (used both in modal and city details tab)
  // Render production summary: current production and queued items
  const renderProductionContent = () => {
    if (!selectedCity) {
      return <div>No city selected</div>;
    }

    const productionPerTurn = getProductionPerTurn(selectedCity);
    // Always use productionStored for current production progress
    const productionProgressValue = typeof selectedCity.productionStored === 'number'
      ? selectedCity.productionStored
      : 0;
    const currentProductionItem = selectedCity.currentProduction;
    const currentProductionCost = getProductionCost(currentProductionItem);
    const currentProductionName = getProductionName(currentProductionItem);
    const clampedProgress = currentProductionCost > 0
      ? Math.min(Math.max(productionProgressValue, 0), currentProductionCost)
      : Math.max(productionProgressValue, 0);
    const progressPercent = currentProductionCost > 0
      ? Math.min(100, Math.round((clampedProgress / currentProductionCost) * 100))
      : 0;
    const remainingShields = currentProductionCost > 0
      ? Math.max(0, currentProductionCost - productionProgressValue)
      : 0;
    const turnsRemaining = currentProductionItem && currentProductionCost > 0 && productionPerTurn > 0
      ? Math.max(0, Math.ceil(remainingShields / productionPerTurn))
      : null;
    const formatTurns = (value: number | null) => {
      if (value === null) return '—';
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      return value;
    };
    const hasQueueItems = Array.isArray(selectedCity.buildQueue) && selectedCity.buildQueue.length > 0;

    return (
      <div>
        <div className="mb-3">
          <h6>Current Production</h6>
          {currentProductionItem ? (
            <div className="bg-secondary text-white p-2 rounded">
              <strong>{currentProductionName}</strong>
              <div className="small text-muted">
                {currentProductionCost > 0
                  ? `Progress: ${Math.round(clampedProgress)} / ${currentProductionCost} (${progressPercent}%)`
                  : `Progress: ${Math.round(clampedProgress)} shields`}
              </div>
              <div className="small text-muted">
                Production per turn: {productionPerTurn}
              </div>
              <div className="small text-muted">
                Turns remaining: {formatTurns(turnsRemaining)}
              </div>
            </div>
          ) : (
            <div className="text-muted">No active production</div>
          )}
        </div>

        <div>
          <h6>Queue</h6>
          <div className="d-flex align-items-center mb-1">
              <Button
                variant="outline-light"
                size="sm"
                className="me-1"
                style={{lineHeight: 1, padding: '2px 6px'}}
                disabled={selectedQueueIndex === null || selectedQueueIndex <= 0 || !selectedCity || !Array.isArray(selectedCity.buildQueue) || selectedCity.buildQueue.length < 2}
                onClick={() => {
                  if (selectedQueueIndex === null || selectedQueueIndex <= 0) return;
                  const queue = [...selectedCity.buildQueue];
                  [queue[selectedQueueIndex - 1], queue[selectedQueueIndex]] = [queue[selectedQueueIndex], queue[selectedQueueIndex - 1]];
                  // Update queue in engine and UI
                  if (gameEngine && typeof gameEngine.setCityQueue === 'function') {
                    gameEngine.setCityQueue(selectedCity.id, queue);
                  } else {
                    selectedCity.buildQueue = queue;
                  }
                  actions.updateCities(cities.map(c => c.id === selectedCity.id ? {...c, buildQueue: queue} : c));
                  setSelectedQueueIndex(selectedQueueIndex - 1);
                }}
              >
                ▲
              </Button>
              <Button
                variant="outline-light"
                size="sm"
                style={{lineHeight: 1, padding: '2px 6px'}}
                disabled={selectedQueueIndex === null || selectedQueueIndex === selectedCity.buildQueue.length - 1 || !selectedCity || !Array.isArray(selectedCity.buildQueue) || selectedCity.buildQueue.length < 2}
                onClick={() => {
                  if (selectedQueueIndex === null || selectedQueueIndex === selectedCity.buildQueue.length - 1) return;
                  const queue = [...selectedCity.buildQueue];
                  [queue[selectedQueueIndex + 1], queue[selectedQueueIndex]] = [queue[selectedQueueIndex], queue[selectedQueueIndex + 1]];
                  // Update queue in engine and UI
                  if (gameEngine && typeof gameEngine.setCityQueue === 'function') {
                    gameEngine.setCityQueue(selectedCity.id, queue);
                  } else {
                    selectedCity.buildQueue = queue;
                  }
                  actions.updateCities(cities.map(c => c.id === selectedCity.id ? {...c, buildQueue: queue} : c));
                  setSelectedQueueIndex(selectedQueueIndex + 1);
                }}
              >
                ▼
              </Button>
            </div>
          <div className="queue-box bg-dark border border-secondary rounded p-2" style={{maxHeight: '220px', overflowY: 'auto'}}>
            {hasQueueItems ? (
              selectedCity.buildQueue.map((q: any, i: number) => {
                const queueItemName = getProductionName(q);
                const queueItemCost = getProductionCost(q);
                const queueTurns = productionPerTurn > 0 && queueItemCost > 0
                  ? Math.max(0, Math.ceil(queueItemCost / productionPerTurn))
                  : null;

                return (
                  <div
                    key={i}
                    className={`queue-item p-2 mb-1 rounded ${selectedQueueIndex === i ? 'bg-secondary text-white' : 'text-white'}`}
                    style={{cursor: 'pointer'}}
                    onClick={() => setSelectedQueueIndex(i)}
                  >
                    <div className="d-flex justify-content-between">
                      <div><strong>{queueItemName}</strong></div>
                      <div className="text-white">{queueItemCost > 0 ? `${queueItemCost} shields` : '—'}</div>
                    </div>
                    <div className="small text-white">#{i + 1} in queue</div>
                    <div className="small text-muted">Turns: {formatTurns(queueTurns)}</div>
                  </div>
                );
              })
            ) : (
              <div className="text-white">Queue is empty</div>
            )}
          </div>
          <div className="mt-2 d-flex gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!selectedProductionKey || !gameEngine || !selectedCity}
                onClick={() => {
                  if (!selectedProductionKey) return;
                  // Add to queue (inline)
                  const unitDef = UNIT_PROPS[selectedProductionKey];
                  const item = { type: 'unit', itemType: selectedProductionKey, name: unitDef.name, cost: unitDef.cost };
                  if (gameEngine) {
                    const hasMethod = typeof (gameEngine as any).setCityProduction === 'function';
                    console.log('[GameModals] Inline Add to Queue: engine method?', { hasMethod });
                    let ok: any = null;
                    try {
                      if (hasMethod) ok = (gameEngine as any).setCityProduction(selectedCity.id, item, true);
                    } catch (e) {
                      console.error('[GameModals] Inline Add to Queue: setCityProduction exception', e);
                    }
                    console.log('[GameModals] Inline Add to Queue: setCityProduction returned', ok);
                    if ((gameEngine as any).getAllCities) {
                      const allCities = (gameEngine as any).getAllCities();
                      console.log('[GameModals] Inline Add to Queue: engine.getAllCities()', allCities.map((c: any) => ({ id: c.id, buildQueue: c.buildQueue })));
                      actions.updateCities(allCities);
                      const updated = allCities.find((c: any) => c.id === selectedCity.id);
                      console.log('[GameModals] Inline Add to Queue: updated selectedCity', { id: updated?.id, buildQueue: updated?.buildQueue });
                    }
                    if (ok) {
                      actions.addNotification({ type: 'info', message: `Added to queue: ${item.name}` });
                    } else {
                      actions.addNotification({ type: 'warning', message: `Failed to add to queue: ${item.name}` });
                    }
                  }
                }}
              >
                Add to Queue
              </Button>

              <Button
                size="sm"
                variant="danger"
                disabled={selectedQueueIndex === null || selectedQueueIndex === undefined || !Array.isArray(selectedCity?.buildQueue) || selectedCity.buildQueue.length === 0 || !gameEngine}
                onClick={async () => {
                  if (selectedQueueIndex === null || selectedQueueIndex === undefined) return;
                  if (!gameEngine || typeof gameEngine.removeCityQueueItem !== 'function') return;
                  const res = (gameEngine as any).removeCityQueueItem(selectedCity.id, selectedQueueIndex);
                  if (res && res.success) {
                    actions.addNotification({ type: 'success', message: `Removed from queue: ${res.removed?.name || 'item'}` });
                    // Refresh cities data from engine if available
                    if (gameEngine.getAllCities) actions.updateCities(gameEngine.getAllCities());
                    setSelectedQueueIndex(null);
                  } else {
                    actions.addNotification({ type: 'warning', message: `Failed to remove: ${res?.reason || 'unknown'}` });
                  }
                }}
              >
                Remove
              </Button>
            </div>
        </div>
      </div>
    );
  };

  // City Purchase Modal (Buy Now)
  const handleBuyNow = (unitKey: string) => {
    if (!selectedCity) return;
    const unitDef = UNIT_PROPS[unitKey];
    if (!unitDef) return;

    const item = { type: 'unit', itemType: unitKey, name: unitDef.name, cost: unitDef.cost };
    if (gameEngine && typeof gameEngine.purchaseCityProduction === 'function') {
      const res = gameEngine.purchaseCityProduction(selectedCity.id, item);
      if (res && res.success) {
        actions.addNotification({ type: 'success', message: `Purchased ${item.name}` });
        actions.updateCities(gameEngine.getAllCities());
        actions.updateUnits(gameEngine.getAllUnits());
      } else {
        actions.addNotification({ type: 'warning', message: `Purchase failed: ${res?.reason || 'unknown'}` });
      }
    }

    actions.hideDialog();
  };

  const renderCityPurchase = () => (
    <Modal
      show={uiState.activeDialog === 'city-purchase'}
      onHide={handleCloseDialog}
      centered
      size="lg"
      dialogClassName="city-purchase-modal"
    >
      <Modal.Header closeButton className="bg-dark text-white">
        <Modal.Title>
          <i className="bi bi-cart"></i> Purchase in {selectedCity?.name || 'City'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="bg-dark text-white">
        <div className="mb-2">Your gold: {currentPlayer?.resources?.gold ?? 0}</div>
        {renderPurchaseContent()}
      </Modal.Body>
    </Modal>
  );

  // Reusable purchase list content (used in purchase modal and city details tab)
  const renderPurchaseContent = () => (
    <div>
      <div className="mb-2">Your gold: {currentPlayer?.resources?.gold ?? 0}</div>
      <div className="row">
        {Object.keys(UNIT_PROPS).filter(k => {
          const u = UNIT_PROPS[k];
          const req = (u as any).requires || null;
          if (req && currentPlayer && Array.isArray(currentPlayer.technologies)) {
            if (!currentPlayer.technologies.includes(req)) return false;
          }
          return true;
        }).map(k => {
          const u = UNIT_PROPS[k];
          return (
            <div key={k} className="col-12 col-sm-6 col-md-4 mb-2">
              <Card className="bg-secondary text-white h-100">
                <Card.Body className="d-flex justify-content-between align-items-center">
                  <div>
                    <div className="h6 mb-0">{u.name} <small className="text-muted">({u.type})</small></div>
                    <small className="text-muted">Cost: {u.cost} gold</small>
                  </div>
                  <div>
                    <Button size="sm" variant="success" onClick={() => handleBuyNow(k)} disabled={(currentPlayer?.resources?.gold || 0) < u.cost}>
                      Buy Now
                    </Button>
                  </div>
                </Card.Body>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {renderGameMenu()}
      {renderTechTree()}
      {renderDiplomacy()}
      {renderHelp()}
      <CityModal show={uiState.activeDialog === 'city-details'} onHide={handleCloseDialog} selectedCity={selectedCity} gameEngine={gameEngine} actions={actions} currentPlayer={currentPlayer} isPlayerCity={isPlayerCity} />
      <HexDetailModal show={uiState.activeDialog === 'hex-details'} onHide={handleCloseDialog} selectedHex={gameState.selectedHex} map={map} units={units} cities={cities} />
      {renderCityProduction()}
      {renderCityPurchase()}
    </>
  );
};

export default GameModals;