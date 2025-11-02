import React from 'react';
import { Card, ListGroup, Badge, Button } from 'react-bootstrap';
import { useGameStore } from '../../stores/gameStore';
import MiniMap from './MiniMap';

const SidePanel = ({ gameEngine }) => {
  const currentPlayer = useGameStore(state => state.currentPlayer);
  const playerUnits = useGameStore(state => state.playerUnits);
  const playerCities = useGameStore(state => state.playerCities);
  const uiState = useGameStore(state => state.uiState);
  const actions = useGameStore(state => state.actions);

  if (!currentPlayer) {
    return (
      <div className="game-side-panel">
        <Card bg="dark" text="white" className="m-2">
          <Card.Body>
            <Card.Text>Loading...</Card.Text>
          </Card.Body>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div 
        className={`mobile-menu-backdrop ${!uiState.sidebarCollapsed ? 'show' : ''} d-md-none`}
        onClick={() => {
          console.log('[CLICK] SidePanel mobile backdrop - closing sidebar');
          actions.toggleUI('sidebarCollapsed');
        }}
      />
      
      <div className={`game-side-panel ${!uiState.sidebarCollapsed ? 'show' : ''}`}>
        {/* Mobile close button */}
        <div className="d-md-none p-2 border-bottom border-secondary">
          <Button 
            variant="outline-light" 
            size="sm"
            onClick={() => {
              console.log('[CLICK] SidePanel close button');
              actions.toggleUI('sidebarCollapsed');
            }}
          >
            <i className="bi bi-x-lg"></i> Close
          </Button>
        </div>
        
        {/* Civilization Info */}
        <Card bg="dark" text="white" className="m-2">
        <Card.Header className="d-flex align-items-center">
          <div 
            className="civ-flag me-2"
            style={{ backgroundColor: currentPlayer.color }}
          ></div>
          <strong>{currentPlayer.name}</strong>
        </Card.Header>
        <Card.Body>
          <div className="civilization-info">
            <div>Leader: {currentPlayer.leader}</div>
            <div>Cities: {playerCities.length}</div>
            <div>Units: {playerUnits.length}</div>
            <div>Population: {playerCities.reduce((sum, city) => sum + (city.population || 1), 0)}</div>
          </div>
        </Card.Body>
      </Card>

      {/* Mini Map */}
      {uiState.showMinimap && (
        <Card bg="dark" text="white" className="m-2">
          <Card.Header>
            <i className="bi bi-map"></i> Mini Map
          </Card.Header>
          <Card.Body className="p-2">
            <MiniMap gameEngine={gameEngine} />
          </Card.Body>
        </Card>
      )}

      {/* Cities List */}
      <Card bg="dark" text="white" className="m-2">
        <Card.Header>
          <i className="bi bi-buildings"></i> Cities ({playerCities.length})
        </Card.Header>
        <Card.Body className="p-0" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          <ListGroup variant="flush">
            {playerCities.map(city => (
              <ListGroup.Item 
                key={city.id}
                className="bg-dark text-white border-secondary d-flex justify-content-between align-items-center"
                style={{ cursor: 'pointer' }}
              >
                <div>
                  <strong>{city.name}</strong>
                  <br />
                  <small className="text-muted">
                    Pop: {city.population} | 
                    Food: {city.yields?.food || 0} | 
                    Prod: {city.yields?.production || 0}
                  </small>
                </div>
                {city.isCapital && (
                  <Badge bg="warning" text="dark">
                    <i className="bi bi-star-fill"></i>
                  </Badge>
                )}
              </ListGroup.Item>
            ))}
            {playerCities.length === 0 && (
              <ListGroup.Item className="bg-dark text-muted text-center">
                No cities founded yet
              </ListGroup.Item>
            )}
          </ListGroup>
        </Card.Body>
      </Card>

      {/* Units List */}
      <Card bg="dark" text="white" className="m-2">
        <Card.Header>
          <i className="bi bi-people-fill"></i> Units ({playerUnits.length})
        </Card.Header>
        <Card.Body className="p-0" style={{ maxHeight: '200px', overflowY: 'auto' }}>
          <ListGroup variant="flush">
            {playerUnits.map(unit => (
              <ListGroup.Item 
                key={unit.id}
                className="bg-dark text-white border-secondary d-flex justify-content-between align-items-center"
                style={{ cursor: 'pointer' }}
              >
                <div>
                  <span className="me-2">{unit.icon || '🔸'}</span>
                  <strong>{unit.name}</strong>
                  <br />
                  <small className="text-muted">
                    {unit.col}, {unit.row} | 
                    HP: {unit.health || 100} | 
                    Moves: {unit.movesRemaining || 0}
                  </small>
                </div>
                {unit.isVeteran && (
                  <Badge bg="success">
                    <i className="bi bi-shield-check"></i>
                  </Badge>
                )}
              </ListGroup.Item>
            ))}
            {playerUnits.length === 0 && (
              <ListGroup.Item className="bg-dark text-muted text-center">
                No units available
              </ListGroup.Item>
            )}
          </ListGroup>
        </Card.Body>
      </Card>

      {/* Current Research */}
      {currentPlayer.currentResearch && (
        <Card bg="dark" text="white" className="m-2">
          <Card.Header>
            <i className="bi bi-lightbulb"></i> Research
          </Card.Header>
          <Card.Body>
            <div>
              <strong>{currentPlayer.currentResearch.name}</strong>
            </div>
            <div className="progress mt-2" style={{ height: '10px' }}>
              <div 
                className="progress-bar bg-info" 
                style={{ 
                  width: `${(currentPlayer.researchProgress / currentPlayer.currentResearch.cost) * 100}%` 
                }}
              ></div>
            </div>
            <small className="text-muted">
              {currentPlayer.researchProgress} / {currentPlayer.currentResearch.cost} science
            </small>
          </Card.Body>
        </Card>
      )}

      {/* Quick Stats */}
      <Card bg="dark" text="white" className="m-2">
        <Card.Header>
          <i className="bi bi-graph-up"></i> Statistics
        </Card.Header>
        <Card.Body>
          <div className="row text-center">
            <div className="col-6">
              <div className="h6 mb-0">{currentPlayer.score || 0}</div>
              <small className="text-muted">Score</small>
            </div>
            <div className="col-6">
              <div className="h6 mb-0">{currentPlayer.technologies?.length || 0}</div>
              <small className="text-muted">Techs</small>
            </div>
          </div>
        </Card.Body>
      </Card>
      </div>
    </>
  );
};

export default SidePanel;