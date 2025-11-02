import React, { useEffect, useState } from 'react';
import { useGameStore } from './stores/gameStore';
import GameEngine from './game/GameEngine';
import Civ1GameCanvas from './components/game/Civ1GameCanvas';
import HexDetailModal from './components/ui/HexDetailModal';
import SettingsModal from './components/ui/SettingsModal';
import GameSetupModal from './components/ui/GameSetupModal';
import EndTurnConfirmModal from './components/ui/EndTurnConfirmModal';
import { useGameEngine } from './hooks/useGameEngine';

function Civ1App() {
  const gameState = useGameStore(state => state.gameState);
  const actions = useGameStore(state => state.actions);
  const settings = useGameStore(state => state.settings);
  const camera = useGameStore(state => state.camera);
  const setCamera = useGameStore(state => state.actions.updateCamera);
  const [gameEngine, setGameEngine] = useState(null);
  const [error, setError] = useState(null);
  const [selectedCity, setSelectedCity] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [showHexDetail, setShowHexDetail] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGameSetup, setShowGameSetup] = useState(true);
  const [showEndTurnConfirm, setShowEndTurnConfirm] = useState(false);
  const [isEndTurnAutomatic, setIsEndTurnAutomatic] = useState(false);
  const [detailHex, setDetailHex] = useState(null);
  const [terrainData, setTerrainData] = useState(null);
  const menuRefs = React.useRef({});

  // Connect game engine to React state management
  useGameEngine(gameEngine);

  // Handle game start with chosen settings
  const handleGameStart = async (gameSettings) => {
    try {
      console.log('Starting new game with settings:', gameSettings);
      setShowGameSetup(false);

      const engine = new GameEngine(actions);
      await engine.initialize(gameSettings);

      // Mark the game as started once engine state is ready in the store
      actions.startGame();
      actions.updateGameState({
        mapGenerated: true,
        currentTurn: engine.currentTurn,
        currentYear: engine.currentYear
      });

      setGameEngine(engine);

      // Get player's starting settler position
      const playerSettler = engine.units.find(
        (u) => u.civilizationId === 0 && u.type === 'settlers'
      );

      console.log('Game started with units:', engine.units);
      console.log('Player settler at:', playerSettler);

      // Center camera on player's starting settler with a small delay to ensure rendering is ready
      if (playerSettler) {
        setTimeout(() => {
          const HEX_WIDTH = 32 * Math.sqrt(3);
          const VERT_DISTANCE = 64 * 0.75;
          const zoom = 2.0;
          
          // Calculate world position of the settler
          const startX = playerSettler.col * HEX_WIDTH + (playerSettler.row % 2) * (HEX_WIDTH / 2);
          const startY = playerSettler.row * VERT_DISTANCE;
          
          // Camera offset needs to account for zoom - we want the settler at screen center
          const newCamera = {
            x: startX - (window.innerWidth / 2) / zoom,
            y: startY - (window.innerHeight / 2) / zoom,
            zoom: zoom,
            minZoom: 0.5,
            maxZoom: 3.0
          };
          
          console.log('Camera centered on player settler at hex:', playerSettler.col, playerSettler.row);
          console.log('Settler world position:', { startX, startY });
          console.log('Camera position:', newCamera);
          
          setCamera(newCamera);
        }, 100);
      }
      
    } catch (error) {
      console.error('Game start error:', error);
      setError(error.message);
    }
  };

  // Initialize game engine
  useEffect(() => {
    // Game initialization now happens in handleGameStart after setup modal
    // No auto-initialization

    // Listen for end turn confirmation requests
    const handleShowEndTurnConfirmation = () => {
      console.log('[Civ1App] Received showEndTurnConfirmation event - automatic trigger');
      setIsEndTurnAutomatic(true);
      setShowEndTurnConfirm(true);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('showEndTurnConfirmation', handleShowEndTurnConfirmation);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('showEndTurnConfirmation', handleShowEndTurnConfirmation);
      }
    };
  }, []);

  // Handle menu actions
  const handleMenuClick = (menu, event) => {
    console.log(`[CLICK] Menu click: ${menu}`);
    if (activeMenu === menu) {
      setActiveMenu(null);
    } else {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom,
        left: rect.left
      });
      setActiveMenu(menu);
    }
  };

  // Handle hex examination (called from canvas)
  const handleExamineHex = (hex, terrain) => {
    setDetailHex(hex);
    setTerrainData(terrain);
    setShowHexDetail(true);
  };

  // Handle new game
  const handleNewGame = () => {
    console.log(`[CLICK] New game button clicked`);
    const confirmed = window.confirm(
      '🏛️ Start a New Game?\n\n' +
      'Are you sure you want to end the current game and start over?\n\n' +
      'All progress will be lost.'
    );
    
    if (confirmed) {
      console.log(`[CLICK] New game confirmed - reloading page`);
      // Reload the page to start fresh
      window.location.reload();
    } else {
      console.log(`[CLICK] New game cancelled`);
    }
  };

  // Handle end turn request - show modal
  const handleEndTurnRequest = () => {
    console.log('[Civ1App] End turn requested manually - showing confirmation modal');
    setIsEndTurnAutomatic(false);
    setShowEndTurnConfirm(true);
  };

  // Handle end turn confirmation
  const handleEndTurnConfirm = () => {
    console.log('[Civ1App] End turn confirmed');
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);
    actions.nextTurn();
    if (gameEngine) {
      gameEngine.processTurn();
    }
  };

  // Handle end turn cancellation
  const handleEndTurnCancel = () => {
    console.log('[Civ1App] End turn cancelled');
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);
  };

  if (error) {
    return (
      <div className="vh-100 bg-danger text-white d-flex align-items-center justify-content-center">
        <div className="text-center">
          <h1>🚨 Game Error</h1>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  // Show game setup modal before game engine is created
  if (!gameEngine && showGameSetup) {
    return (
      <div className="vh-100 bg-dark text-white d-flex align-items-center justify-content-center">
        <GameSetupModal
          show={showGameSetup}
          onStart={handleGameStart}
        />
      </div>
    );
  }

  // Show loading only during actual initialization
  if (!gameEngine && !showGameSetup) {
    return (
      <div className="vh-100 bg-primary text-white d-flex align-items-center justify-content-center">
        <div className="text-center">
          <div className="spinner-border mb-3"></div>
          <h2>🏛️ Loading Civilization...</h2>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="vh-100 d-flex flex-column bg-dark text-white" 
      style={{ 
        fontFamily: 'monospace',
        fontSize: `${settings.uiScale}rem`
      }}
    >
      {/* Top Menu Bar */}
      <div 
        className="border-bottom border-light d-flex" 
        style={{ 
          height: `${48 * settings.uiScale}px`,
          background: '#1a1a1a',
          boxShadow: 'none'
        }}
      >
        {/* Menu items */}
        <div className="d-flex flex-grow-1 h-100 justify-content-center align-items-center">
          {['GAME', 'ORDERS', 'ADVISORS', 'WORLD', 'CIVILOPEDIA'].map((item) => (
            <button
              key={item}
              ref={(el) => menuRefs.current[item] = el}
              className={`btn px-4 text-white border-0 rounded-0 position-relative d-flex align-items-center justify-content-center ${
                activeMenu === item ? '' : ''
              }`}
              style={{ 
                fontSize: `${settings.menuFontSize * 1.4}px`,
                height: '100%',
                fontWeight: 'bold',
                letterSpacing: '1px',
                background: activeMenu === item 
                  ? '#333333'
                  : 'transparent',
                textShadow: 'none',
                transition: 'all 0.2s ease',
                transform: 'none',
                borderLeft: 'none',
                borderRight: 'none'
              }}
              onMouseEnter={(e) => {
                if (activeMenu !== item) {
                  (e.target as HTMLElement).style.background = '#2a2a2a';
                  (e.target as HTMLElement).style.transform = 'none';
                }
              }}
              onMouseLeave={(e) => {
                if (activeMenu !== item) {
                  (e.target as HTMLElement).style.background = 'transparent';
                  (e.target as HTMLElement).style.transform = 'none';
                }
              }}
              onClick={(e) => handleMenuClick(item, e)}
            >
              {item}
              {activeMenu === item && (
                <div 
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: '3px',
                    background: '#ffffff',
                    boxShadow: 'none'
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Right side - Turn info and End Turn button */}
        <div className="d-flex align-items-center ms-auto pe-3">
          <div className="text-white me-3" style={{ fontSize: `${settings.menuFontSize * 1.2}px` }}>
            <span className="me-2">Turn {gameState.currentTurn}</span>
            <span className="text-muted">|</span>
            <span className="ms-2">{gameState.currentYear || 4000} BC</span>
          </div>
          <button
            className="btn btn-success"
            style={{
              fontSize: `${settings.menuFontSize * 1.1}px`,
              padding: '8px 16px',
              fontWeight: 'bold'
            }}
            onClick={handleEndTurnRequest}
          >
            <i className="bi bi-skip-end-fill me-1"></i>
            End Turn
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex-grow-1 d-flex">
        {/* Left Sidebar with CSS Grid */}
        <div 
          className="text-dark border-end border-dark"
          style={{ 
            width: `${settings.sidebarWidth * 2}px`,
            display: 'grid',
            gridTemplateRows: `${settings.minimapHeight * 2}px 1fr`,
            gridTemplateColumns: '1fr',
            height: '100%',
            backgroundColor: '#A9A9A9'
          }}
        >
          {/* Minimap */}
          <div 
            className="border-bottom border-dark bg-dark"
            style={{ 
              gridRow: '1',
              overflow: 'hidden',
              height: `${settings.minimapHeight * 2}px`
            }}
          >
            <Civ1GameCanvas minimap={true} onExamineHex={handleExamineHex} gameEngine={gameEngine} />
          </div>

          {/* Civilizations List */}
          <div 
            className="p-2" 
            style={{ 
              backgroundColor: '#A9A9A9',
              gridRow: '2',
              overflowY: 'auto'
            }}
          >
            <div style={{ fontSize: `${settings.civListFontSize * 2}px`, fontFamily: 'monospace', lineHeight: '1.5' }}>
              {[
                { name: 'Americans', color: '#4169E1' },
                { name: 'German Settlers', color: '#8B4513' },
                { name: 'Romans', color: '#DC143C' },
                { name: 'Newest', color: '#228B22' },
                { name: 'Bretons', color: '#FFD700' },
                { name: '(Player)', color: '#000000' }
              ].map((civ, idx) => (
                <div 
                  key={idx}
                  className="py-1"
                  style={{ 
                    cursor: 'pointer',
                    color: civ.color,
                    fontWeight: civ.name === '(Player)' ? 'bold' : 'normal'
                  }}
                  onClick={() => {
                    console.log('Civ1App: Civilization selected:', civ.name);
                    console.log(`[CLICK] Selected civilization: ${civ.name}`);
                    setSelectedCity(civ.name);
                  }}
                >
                  {civ.name}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Map Area */}
        <div className="flex-grow-1 position-relative bg-dark">
          <Civ1GameCanvas 
            onExamineHex={handleExamineHex} 
            gameEngine={gameEngine}
          />
        </div>
      </div>

      {/* Dropdown Menus */}
      {activeMenu && (
        <div 
          className="position-fixed border border-light"
          style={{ 
            top: `${menuPosition.top}px`, 
            left: `${menuPosition.left}px`,
            zIndex: 1000,
            minWidth: '220px',
            background: 'linear-gradient(180deg, #2d3748 0%, #1a202c 100%)',
            boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
            borderRadius: '0 0 8px 8px',
            overflow: 'hidden'
          }}
        >
          {activeMenu === 'GAME' && (
            <div>
              <button 
                className="btn btn-dark text-start w-100 border-0"
                style={{
                  fontSize: `${settings.menuFontSize * 1.1}px`,
                  padding: '12px 16px',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  borderBottom: '1px solid rgba(255,255,255,0.1)'
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = 'linear-gradient(90deg, #3182ce 0%, #2c5aa0 100%)';
                  (e.target as HTMLElement).style.paddingLeft = '24px';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = 'transparent';
                  (e.target as HTMLElement).style.paddingLeft = '16px';
                }}
                onClick={handleNewGame}
              >
                🆕 New Game
              </button>
              <button 
                className="btn btn-dark text-start w-100 border-0"
                style={{
                  fontSize: `${settings.menuFontSize * 1.1}px`,
                  padding: '12px 16px',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  borderBottom: '1px solid rgba(255,255,255,0.1)'
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = 'linear-gradient(90deg, #3182ce 0%, #2c5aa0 100%)';
                  (e.target as HTMLElement).style.paddingLeft = '24px';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = 'transparent';
                  (e.target as HTMLElement).style.paddingLeft = '16px';
                }}
                onClick={() => console.log('Civ1App: Save Game clicked')}
              >
                💾 Save Game
              </button>
              <button 
                className="btn btn-dark text-start w-100 border-0"
                style={{
                  fontSize: `${settings.menuFontSize * 1.1}px`,
                  padding: '12px 16px',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  borderBottom: '1px solid rgba(255,255,255,0.1)'
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = 'linear-gradient(90deg, #3182ce 0%, #2c5aa0 100%)';
                  (e.target as HTMLElement).style.paddingLeft = '24px';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = 'transparent';
                  (e.target as HTMLElement).style.paddingLeft = '16px';
                }}
                onClick={() => console.log('Civ1App: Load Game clicked')}
              >
                📁 Load Game
              </button>
              <button 
                className="btn btn-dark text-start w-100 border-0"
                style={{
                  fontSize: `${settings.menuFontSize * 1.1}px`,
                  padding: '12px 16px',
                  fontWeight: '600',
                  transition: 'all 0.2s ease',
                  borderBottom: '1px solid rgba(255,255,255,0.1)'
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = 'linear-gradient(90deg, #3182ce 0%, #2c5aa0 100%)';
                  (e.target as HTMLElement).style.paddingLeft = '24px';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = 'transparent';
                  (e.target as HTMLElement).style.paddingLeft = '16px';
                }}
                onClick={() => {
                  console.log('Civ1App: Settings button clicked');
                  setShowSettings(true);
                  setActiveMenu(null);
                }}
              >
                ⚙️ Settings
              </button>
              <button 
                className="btn btn-dark text-start w-100 border-0"
                style={{
                  fontSize: `${settings.menuFontSize * 1.1}px`,
                  padding: '12px 16px',
                  fontWeight: '600',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.background = 'linear-gradient(90deg, #e53e3e 0%, #c53030 100%)';
                  (e.target as HTMLElement).style.paddingLeft = '24px';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.background = 'transparent';
                  (e.target as HTMLElement).style.paddingLeft = '16px';
                }}
                onClick={() => console.log('Civ1App: Quit clicked')}
              >
                🚪 Quit
              </button>
            </div>
          )}
          {activeMenu === 'ORDERS' && (
            <div>
              {['🏰 Build City', '🛣️ Build Road', '🌾 Irrigate', '🗿 Mine', '🏹 Fortify'].map((item, idx, arr) => (
                <button 
                  key={item}
                  className="btn btn-dark text-start w-100 border-0"
                  style={{
                    fontSize: `${settings.menuFontSize * 1.1}px`,
                    padding: '12px 16px',
                    fontWeight: '600',
                    transition: 'all 0.2s ease',
                    borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = 'linear-gradient(90deg, #38a169 0%, #2f855a 100%)';
                    (e.target as HTMLElement).style.paddingLeft = '24px';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'transparent';
                    (e.target as HTMLElement).style.paddingLeft = '16px';
                  }}
                  onClick={() => {
                    console.log(`Civ1App: ORDERS - ${item} clicked`);
                    
                    // Handle different ORDERS menu actions
                    if (item === '🏰 Build City') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit && selectedUnit.type === 'settlers') {
                          console.log(`Civ1App: Founding city with settler ${selectedUnit.id}`);
                          gameEngine.foundCityWithSettler(selectedUnit.id);
                        } else {
                          console.log('Civ1App: No settler selected for city founding');
                        }
                      } else {
                        console.log('Civ1App: No unit selected for city founding');
                      }
                    } else if (item === '🛣️ Build Road') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Building road with unit ${selectedUnit.id}`);
                          gameEngine.buildImprovement(selectedUnit.id, 'road');
                        } else {
                          console.log('Civ1App: No unit found for road building');
                        }
                      } else {
                        console.log('Civ1App: No unit selected for road building');
                      }
                    } else if (item === '🌾 Irrigate') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Irrigating with unit ${selectedUnit.id}`);
                          gameEngine.buildImprovement(selectedUnit.id, 'irrigation');
                        } else {
                          console.log('Civ1App: No unit found for irrigation');
                        }
                      } else {
                        console.log('Civ1App: No unit selected for irrigation');
                      }
                    } else if (item === '🗿 Mine') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Mining with unit ${selectedUnit.id}`);
                          gameEngine.buildImprovement(selectedUnit.id, 'mine');
                        } else {
                          console.log('Civ1App: No unit found for mining');
                        }
                      } else {
                        console.log('Civ1App: No unit selected for mining');
                      }
                    } else if (item === '🏹 Fortify') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Fortifying unit ${selectedUnit.id}`);
                          gameEngine.unitFortify(selectedUnit.id);
                        } else {
                          console.log('Civ1App: No unit found for fortification');
                        }
                      } else {
                        console.log('Civ1App: No unit selected for fortification');
                      }
                    }
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
          {activeMenu === 'ADVISORS' && (
            <div>
              {['👑 Foreign Minister', '💰 Trade Advisor', '🧪 Science Advisor', '⚔️ Military Advisor'].map((item, idx, arr) => (
                <button 
                  key={item}
                  className="btn btn-dark text-start w-100 border-0"
                  style={{
                    fontSize: `${settings.menuFontSize * 1.1}px`,
                    padding: '12px 16px',
                    fontWeight: '600',
                    transition: 'all 0.2s ease',
                    borderBottom: idx < arr.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none'
                  }}
                  onMouseEnter={(e) => {
                    (e.target as HTMLElement).style.background = 'linear-gradient(90deg, #9f7aea 0%, #805ad5 100%)';
                    (e.target as HTMLElement).style.paddingLeft = '24px';
                  }}
                  onMouseLeave={(e) => {
                    (e.target as HTMLElement).style.background = 'transparent';
                    (e.target as HTMLElement).style.paddingLeft = '16px';
                  }}
                  onClick={() => console.log(`Civ1App: ADVISORS - ${item} clicked`)}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hex Detail Modal */}
      <HexDetailModal
        show={showHexDetail}
        onHide={() => setShowHexDetail(false)}
        hex={detailHex}
        terrain={terrainData}
        adjacentTiles={[]}
      />

      {/* Settings Modal */}
      <SettingsModal
        show={showSettings}
        onHide={() => setShowSettings(false)}
      />

      {/* End Turn Confirmation Modal */}
      <EndTurnConfirmModal
        show={showEndTurnConfirm}
        onConfirm={handleEndTurnConfirm}
        onCancel={handleEndTurnCancel}
        currentTurn={gameState.currentTurn}
        currentYear={gameState.currentYear || 4000}
        isAutomatic={isEndTurnAutomatic}
      />
    </div>
  );
}

export default Civ1App;