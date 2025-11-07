import React from 'react';
import { Modal, Button, Tab, Tabs, Card, ListGroup } from 'react-bootstrap';
import TechTreeView from './TechTreeView';
import { useGameStore } from '../../stores/gameStore';
import { CityUtils } from '../../utils/helpers';
import '../../styles/gameModals.css';

const GameModals = ({ gameEngine }) => {
  console.log('[GameModals] Component rendering, gameEngine present:', !!gameEngine);
  const uiState = useGameStore(state => state.uiState);
  const actions = useGameStore(state => state.actions);
  const selectedCityId: string | null = useGameStore(state => state.gameState.selectedCity);
  const cities = useGameStore(state => state.cities);
  const technologies = useGameStore(state => state.technologies);
  const playerResources = useGameStore(state => state.playerResources);
  const currentPlayer = useGameStore(state => state.currentPlayer);

  const selectedCity = cities.find(c => c.id === selectedCityId);

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
  <Tabs defaultActiveKey="tree" className="mb-3">
          {/* Tree tab first for immediate visual overview */}
          <Tab eventKey="tree" title="Tree">
            <div className="tech-tree-container">
              <React.Suspense fallback={<div className="text-white p-3">Loading tree...</div>}>
                <TechTreeView technologies={technologies} width={Math.max(window.innerWidth - 200, 800)} />
              </React.Suspense>
            </div>
          </Tab>
          <Tab eventKey="available" title="Available">
            <div className="tech-tree">
              {Object.entries(groupByEra(technologies.filter(tech => tech.available && !tech.researched))).map(([era, techs]) => (
                <div key={era} className="mb-3">
                  <h6 className="text-white">{era}</h6>
                  {techs.map(tech => {
                    const affordable = (playerResources?.science || 0) >= (tech.cost || 0);
                    const isResearching = currentPlayer?.currentResearch?.id === tech.id;
                    return (
                      <Card key={tech.id} className="tech-node available mb-2">
                        <Card.Body className="d-flex align-items-center justify-content-between">
                          <div>
                            <Card.Title className="h6 mb-1">{tech.name}</Card.Title>
                            <Card.Text className="small mb-0">{tech.description}</Card.Text>
                            <small className="text-muted">Cost: {tech.cost} science</small>
                          </div>
                          <div>
                            {isResearching && <small className="text-warning me-2">Researching...</small>}
                            <Button
                              size="sm"
                              variant={affordable ? 'primary' : 'secondary'}
                              disabled={!affordable || !tech.available || isResearching}
                              onClick={() => handleResearchTechnology(tech.id)}
                            >
                              {affordable ? 'Research' : 'Need Science'}
                            </Button>
                          </div>
                        </Card.Body>
                      </Card>
                    );
                  })}
                </div>
              ))}
            </div>
          </Tab>
          
          <Tab eventKey="researched" title="Researched">
            <div className="tech-tree">
              {technologies.filter(tech => tech.researched).map(tech => (
                <Card key={tech.id} className="tech-node researched mb-2">
                  <Card.Body>
                    <Card.Title className="h6">{tech.name}</Card.Title>
                    <Card.Text className="small">{tech.description}</Card.Text>
                    <small className="text-success">
                      <i className="bi bi-check-circle"></i> Complete
                    </small>
                  </Card.Body>
                </Card>
              ))}
            </div>
          </Tab>
          
          <Tab eventKey="locked" title="Future">
            <div className="tech-tree">
              {Object.entries(groupByEra(technologies.filter(tech => !tech.available && !tech.researched))).map(([era, techs]) => (
                <div key={era} className="mb-3">
                  <h6 className="text-white">{era}</h6>
                  {techs.map(tech => (
                    <Card key={tech.id} className="tech-node locked mb-2">
                      <Card.Body>
                        <Card.Title className="h6">{tech.name}</Card.Title>
                        <Card.Text className="small">{tech.description}</Card.Text>
                        <small className="text-muted">Prerequisites: {tech.prerequisites?.join(', ') || 'None'}</small>
                      </Card.Body>
                    </Card>
                  ))}
                </div>
              ))}
            </div>
          </Tab>
          
        </Tabs>
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

  // City Resources Modal Tab
  const renderCityResources = (city: any, currentPlayer: any) => {
    // Get calculated resource data
    const resources = CityUtils.calculateCityResources(city, currentPlayer);

    return (
      <div className="city-resources-grid">
        {/* Food Section */}
        <div className="resource-section">
          <h6 className="resource-title">
            <i className="bi bi-apple"></i> Food
          </h6>
          <div className="resource-values">
            <div className="resource-line">
              <span className="resource-amount">{resources.food.produced}</span>
              <span className="resource-break">|</span>
              <span className={`resource-surplus ${resources.food.surplus >= 0 ? 'positive' : 'negative'}`}>
                {resources.food.surplus >= 0 ? `+${resources.food.surplus}` : resources.food.surplus}
              </span>
            </div>
            <small className="resource-desc">
              Needs {resources.food.needed} food per turn. {resources.food.surplus >= 0 ? 'Surplus stored for growth.' : 'Shortfall - population may starve.'}
            </small>
          </div>
        </div>

        {/* Production Section */}
        <div className="resource-section">
          <h6 className="resource-title">
            <i className="bi bi-gear"></i> Production
          </h6>
          <div className="resource-values">
            <div className="resource-line">
              <span className="resource-amount">{resources.production.produced}</span>
              <span className="resource-break">|</span>
              <span className="resource-surplus positive">
                +{resources.production.surplus}
              </span>
            </div>
            <small className="resource-desc">
              Available for building units and city improvements.
            </small>
          </div>
        </div>

        {/* Trade Section */}
        <div className="resource-section">
          <h6 className="resource-title">
            <i className="bi bi-arrow-left-right"></i> Trade
          </h6>
          <div className="resource-values">
            <div className="resource-line">
              <span className="resource-amount">{resources.trade.total}</span>
              <span className="resource-break">|</span>
              <span className="resource-corruption negative">
                -{resources.trade.corruption}
              </span>
            </div>
            <small className="resource-desc">
              {resources.trade.afterCorruption} trade after corruption. Distributed as luxuries, taxes, and science.
            </small>
          </div>
        </div>

        {/* Luxuries Section */}
        <div className="resource-section">
          <h6 className="resource-title">
            <i className="bi bi-gem"></i> Luxuries
          </h6>
          <div className="resource-values">
            <div className="resource-line">
              <span className="resource-amount">{resources.luxuries.amount}</span>
              <span className="resource-unit">diamonds</span>
            </div>
            <small className="resource-desc">
              Makes citizens content. Trade rate: {resources.luxuries.rate}%
            </small>
          </div>
        </div>

        {/* Taxes Section */}
        <div className="resource-section">
          <h6 className="resource-title">
            <i className="bi bi-coin"></i> Taxes
          </h6>
          <div className="resource-values">
            <div className="resource-line">
              <span className="resource-amount">{resources.taxes.amount}</span>
              <span className="resource-unit">coins</span>
            </div>
            <small className="resource-desc">
              Added to treasury. Trade rate: {resources.taxes.rate}%
            </small>
          </div>
        </div>

        {/* Science Section */}
        <div className="resource-section">
          <h6 className="resource-title">
            <i className="bi bi-lightbulb"></i> Science
          </h6>
          <div className="resource-values">
            <div className="resource-line">
              <span className="resource-amount">{resources.science.amount}</span>
              <span className="resource-unit">bulbs</span>
            </div>
            <small className="resource-desc">
              Research progress. Trade rate: {resources.science.rate}%
            </small>
          </div>
        </div>

        {/* Corruption Section */}
        <div className="resource-section corruption-section">
          <h6 className="resource-title">
            <i className="bi bi-exclamation-triangle"></i> Corruption
          </h6>
          <div className="resource-values">
            <div className="resource-line">
              <span className="resource-amount corruption-amount">{resources.trade.corruption}</span>
              <span className="resource-unit">trade lost</span>
            </div>
            <small className="resource-desc">
              Lost to corruption. Distance from capital increases corruption.
            </small>
          </div>
        </div>
      </div>
    );
  };

  // City Details Modal (70% height, close button top-right)
  const renderCityDetails = () => {
    return (
      <Modal
        show={uiState.activeDialog === 'city-details'}
        onHide={handleCloseDialog}
        centered
        size="lg"
        dialogClassName="city-details-modal hex-detail-modal"
      >
        <Modal.Header className="bg-dark text-white hex-detail-modal-header">
          <Modal.Title>
            <i className="bi bi-building"></i> {selectedCity?.name || 'City Details'}
          </Modal.Title>
          <Button variant="outline-light" size="sm" onClick={handleCloseDialog} className="hex-detail-close-button">
            <i className="bi bi-x-lg"></i>
          </Button>
        </Modal.Header>
        <Modal.Body className="bg-dark text-white hex-detail-modal-body">
          <Tabs defaultActiveKey="overview" id="city-details-tabs" className="mb-3">
            <Tab eventKey="overview" title="Overview">
              {selectedCity ? (
                <div className="hex-detail-content">
                  <h5 className="hex-detail-city-name">{selectedCity.name}</h5>
                  <p className="hex-detail-city-info"><strong>Population:</strong> {selectedCity.population ?? 1}</p>
                  <p className="hex-detail-city-info"><strong>Location:</strong> ({selectedCity.col}, {selectedCity.row})</p>
                  <div className="mb-3">
                    <strong>Yields</strong>
                    <ul>
                      <li>Food: {selectedCity.yields?.food ?? selectedCity.food ?? 0}</li>
                      <li>Production: {selectedCity.yields?.production ?? selectedCity.production ?? 0}</li>
                      <li>Trade: {selectedCity.yields?.trade ?? 0}</li>
                      <li>Science: {selectedCity.science ?? 0}</li>
                      <li>Gold: {selectedCity.gold ?? 0}</li>
                    </ul>
                  </div>
                  <div>
                    <h6 className="hex-detail-buildings-title">Buildings</h6>
                    {selectedCity.buildings && selectedCity.buildings.length > 0 ? (
                      <ul className="hex-detail-buildings-list">
                        {selectedCity.buildings.map((building: any, i: number) => <li key={i}>{building}</li>)}
                      </ul>
                    ) : <p className="hex-detail-no-buildings">No buildings</p>}
                  </div>
                </div>
              ) : (
                <p className="hex-detail-no-city">No city selected</p>
              )}
            </Tab>
            <Tab eventKey="resources" title="Resources">
              {selectedCity ? (
                <div className="city-resources-content">
                  {renderCityResources(selectedCity, currentPlayer)}
                </div>
              ) : (
                <p className="hex-detail-no-city">No city selected</p>
              )}
            </Tab>
            <Tab eventKey="raw" title="Raw JSON">
              <pre className="hex-detail-debug">
                {JSON.stringify(selectedCity, null, 2)}
              </pre>
            </Tab>
          </Tabs>
        </Modal.Body>
      </Modal>
    );
  };

  return (
    <>
      {renderGameMenu()}
      {renderTechTree()}
      {renderDiplomacy()}
      {renderHelp()}
      {renderCityDetails()}
    </>
  );
};

export default GameModals;