import React, { useEffect, useState, useCallback } from 'react';
import { useGameStore } from './stores/GameStore';
import GameEngine from '@/game/engine/GameEngine';
import GameCanvas from './components/game/GameCanvas';
import HexDetailModal from './components/ui/HexDetailModal';
import SettingsModal from './components/ui/SettingsModal';
import GameSetupModal from './components/ui/GameSetupModal';
import EndTurnConfirmModal from './components/ui/EndTurnConfirmModal';
import GameModals from './components/ui/GameModals';
import { useGameEngine } from './hooks/UseGameEngine';
import SidePanel from './components/ui/SidePanel';
import miniMap from "@/components/ui/MiniMap";

function App() {
  const gameState = useGameStore(state => state.gameState);
  const actions = useGameStore(state => state.actions);
  const settings = useGameStore(state => state.settings);
  const camera = useGameStore(state => state.camera);
  const setCamera = useGameStore(state => state.actions.updateCamera);
  const [gameEngine, setGameEngine] = useState(null);
  const [error, setError] = useState(null);
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

      // Focus camera on player's starting unit using the store action so the same
      // centering logic is used everywhere (keeps canvas and minimap in sync).
      if (playerSettler) {
        // This will select/focus the next unit for the active player and update camera
        actions.focusOnNextUnit();
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
      console.log('[App] Received showEndTurnConfirmation event - automatic trigger');
      setIsEndTurnAutomatic(true);
      if (settings.skipEndTurnConfirmation) {
        console.log('[App] Skipping end turn confirmation due to user preference');
        handleEndTurnConfirm();
      } else {
        setShowEndTurnConfirm(true);
      }
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

  // Handle end turn confirmation
  const handleEndTurnConfirm = () => {
    console.log('[App] End turn confirmed');
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);
    actions.nextTurn();
    if (gameEngine) {
      gameEngine.processTurn();
    }
  };

  // Handle end turn request - show modal
  const handleEndTurnRequest = useCallback(() => {
    console.log('[App] End turn requested manually - showing confirmation modal');
    setIsEndTurnAutomatic(false);
    if (settings.skipEndTurnConfirmation) {
      console.log('[App] Skipping end turn confirmation due to user preference');
      handleEndTurnConfirm();
    } else {
      setShowEndTurnConfirm(true);
    }
  }, [settings.skipEndTurnConfirmation]);

  // Handle end turn cancellation
  const handleEndTurnCancel = () => {
    console.log('[App] End turn cancelled');
    setShowEndTurnConfirm(false);
    setIsEndTurnAutomatic(false);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle shortcuts if user is typing in an input field
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.target.contentEditable === 'true') {
        return;
      }

      const { key, shiftKey, ctrlKey, altKey } = event;

      // Prevent default browser behavior for our shortcuts
      const shouldPreventDefault = [
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Enter', ' ', 's', 'f', 'r', 'c', 'd', 'a', 'w', 'g', 'b', 'i', 'm', 'p',
        't', 'Escape', 'F1', 'F2', 'F3', 'F4', 'F11', 'h'
      ].includes(key) ||
      (ctrlKey && ['1','2','3','4','5','6','7','8','9','s','l','z'].includes(key)) ||
      (key === '+' || key === '-');

      if (shouldPreventDefault) {
        event.preventDefault();
      }

      // Navigation shortcuts
      if (!ctrlKey && !altKey) {
        switch (key) {
          case 'ArrowUp':
            if (shiftKey) {
              // Shift + Arrow: Scroll map
              setCamera({ y: camera.y - 50 });
            } else {
              // Arrow Keys: Move cursor
              if (gameEngine && gameEngine.moveCursor) {
                gameEngine.moveCursor(0, -1);
              }
            }
            break;
          case 'ArrowDown':
            if (shiftKey) {
              setCamera({ y: camera.y + 50 });
            } else {
              if (gameEngine && gameEngine.moveCursor) {
                gameEngine.moveCursor(0, 1);
              }
            }
            break;
          case 'ArrowLeft':
            if (shiftKey) {
              setCamera({ x: camera.x - 50 });
            } else {
              if (gameEngine && gameEngine.moveCursor) {
                gameEngine.moveCursor(-1, 0);
              }
            }
            break;
          case 'ArrowRight':
            if (shiftKey) {
              setCamera({ x: camera.x + 50 });
            } else {
              if (gameEngine && gameEngine.moveCursor) {
                gameEngine.moveCursor(1, 0);
              }
            }
            break;
          case '+':
          case '=':
            // Zoom in
            setCamera({ zoom: Math.min(camera.zoom * 1.2, 3.0) });
            break;
          case '-':
            // Zoom out
            setCamera({ zoom: Math.max(camera.zoom / 1.2, 0.5) });
            break;
        }
      }

      // Action shortcuts
      if (!ctrlKey && !altKey && !shiftKey) {
        switch (key) {
          case 'Enter':
            // End turn
            handleEndTurnRequest();
            break;
          case ' ':
            // Cycle through units in a tile
            if (gameEngine && gameEngine.cycleUnitsInTile) {
              gameEngine.cycleUnitsInTile();
            }
            break;
          case 's':
          case 'S':
            // Skip current unit's turn
            if (gameEngine && gameEngine.skipUnitTurn) {
              gameEngine.skipUnitTurn();
            }
            break;
          case 'f':
          case 'F':
            // Fortify selected unit
            if (gameEngine && gameEngine.fortifyUnit) {
              gameEngine.fortifyUnit();
            }
            break;
          case 'r':
          case 'R':
            // Rush production in a city
            if (gameEngine && gameEngine.rushCityProduction) {
              gameEngine.rushCityProduction();
            }
            break;
          case 'c':
          case 'C':
            // Center map on selected city
            if (gameEngine && gameEngine.centerOnCity) {
              gameEngine.centerOnCity();
            }
            break;
          case 'd':
          case 'D':
            // Disband selected unit
            if (gameEngine && gameEngine.disbandUnit) {
              gameEngine.disbandUnit();
            }
            break;
          case 'a':
          case 'A':
            // Automate worker
            if (gameEngine && gameEngine.automateWorker) {
              gameEngine.automateWorker();
            }
            break;
          case 'w':
          case 'W':
            // Wait (unit stays in place)
            if (gameEngine && gameEngine.waitUnit) {
              gameEngine.waitUnit();
            }
            break;
          case 'g':
          case 'G':
            // Move unit to specific location (enter goto mode)
            if (gameEngine && gameEngine.enterGotoMode) {
              gameEngine.enterGotoMode();
            }
            break;
          case 'b':
          case 'B':
            // Build road
            if (gameEngine && gameEngine.buildRoad) {
              gameEngine.buildRoad();
            }
            break;
          case 'i':
          case 'I':
            // Irrigate
            if (gameEngine && gameEngine.irrigage) {
              gameEngine.irrigage();
            }
            break;
          case 'm':
          case 'M':
            // Mine
            if (gameEngine && gameEngine.mine) {
              gameEngine.mine();
            }
            break;
          case 'p':
          case 'P':
            // Clean pollution
            if (gameEngine && gameEngine.cleanPollution) {
              gameEngine.cleanPollution();
            }
            break;
          case 't':
          case 'T':
            // Open tax/science/luxury slider
            setShowSettings(true);
            break;
          case 'Escape':
            // Cancel action or close menus
            setActiveMenu(null);
            setShowHexDetail(false);
            setShowSettings(false);
            // Add more modal closures as needed
            break;
          case 'F1':
            // Open Civilopedia
            if (gameEngine && gameEngine.openCivilopedia) {
              gameEngine.openCivilopedia();
            }
            break;
          case 'F2':
            // Open city report
            if (gameEngine && gameEngine.openCityReport) {
              gameEngine.openCityReport();
            }
            break;
          case 'F3':
            // Open unit report
            if (gameEngine && gameEngine.openUnitReport) {
              gameEngine.openUnitReport();
            }
            break;
          case 'F4':
            // Open diplomacy report
            if (gameEngine && gameEngine.openDiplomacyReport) {
              gameEngine.openDiplomacyReport();
            }
            break;
          case 'F11':
            // Toggle fullscreen
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              document.documentElement.requestFullscreen();
            }
            break;
          case 'h':
          case 'H':
            // Highlight happy/unhappy cities
            if (gameEngine && gameEngine.highlightCities) {
              gameEngine.highlightCities();
            }
            break;
        }
      }

      // Ctrl shortcuts
      if (ctrlKey && !altKey && !shiftKey) {
        switch (key) {
          case '1':
          case '2':
          case '3':
          case '4':
          case '5':
          case '6':
          case '7':
          case '8':
          case '9':
            // Select specific city
            const cityIndex = parseInt(key) - 1;
            if (gameEngine && gameEngine.selectCityByIndex) {
              gameEngine.selectCityByIndex(cityIndex);
            }
            break;
          case 's':
            // Save game
            if (gameEngine && gameEngine.saveGame) {
              gameEngine.saveGame();
            }
            break;
          case 'l':
            // Load game
            if (gameEngine && gameEngine.loadGame) {
              gameEngine.loadGame();
            }
            break;
          case 'z':
            // Undo last action
            if (gameEngine && gameEngine.undoLastAction) {
              gameEngine.undoLastAction();
            }
            break;
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [gameEngine, camera, setCamera, handleEndTurnRequest, activeMenu, showHexDetail, showSettings]);

  if (error) {
    return (
      <div id="gameContainer" className="vh-100 d-flex align-items-center justify-content-center text-white">
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
      <div id="gameContainer" className="vh-100 d-flex align-items-center justify-content-center text-white">
        <GameSetupModal
          show={showGameSetup}
          onStart={handleGameStart}
        />
      </div>
    );
  }

  // Show loading only during actual initialization
  const isInitializing = !gameEngine && !showGameSetup;

  if (isInitializing) {
    return (
      <div id="gameContainer" className="vh-100 d-flex align-items-center justify-content-center text-white">
        <div className="text-center">
          <div className="spinner-border mb-3"></div>
          <h2>🏛️ Loading Civilization...</h2>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="game-container vh-100 d-flex flex-column text-white" 
      style={{ 
        fontFamily: 'monospace',
        fontSize: `${settings.uiScale}rem`
      }}
    >
      {/* Top Menu Bar */}
      <div 
        className="game-top-bar border-bottom border-light d-flex" 
        style={{ 
          height: `${48 * settings.uiScale}px`,
          boxShadow: 'none'
        }}
      >
        {/* Menu items */}
        <div className="d-flex flex-grow-1 h-100 justify-content-center align-items-center">
          {['GAME', 'ORDERS', 'ADVISORS', 'WORLD', 'INFO'].map((item) => (
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
  <div className="game-area flex-grow-1 d-flex">
  {/* Left Sidebar - use centralized SidePanel component */}
  <div className="game-side-panel" style={{ width: `${settings.sidebarWidth * 2}px` }}>
          <SidePanel gameEngine={gameEngine} />
        </div>

  {/* Main Map Area */}
  <div className="game-canvas flex-grow-1 position-relative">
          <GameCanvas
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
                onClick={() => console.log('App: Save Game clicked')}
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
                onClick={() => console.log('App: Load Game clicked')}
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
                  console.log('App: Settings button clicked');
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
                onClick={() => console.log('App: Quit clicked')}
              >
                🚪 Quit
              </button>
            </div>
          )}
          {activeMenu === 'INFO' && (
            <div>
              <button 
                className="btn btn-dark text-start w-100 border-0"
                style={{
                  fontSize: `${settings.menuFontSize * 1.1}px`,
                  padding: '12px 16px',
                  fontWeight: '600',
                  transition: 'all 0.2s ease'
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
                  console.log('App: Tech Tree clicked');
                  actions.showDialog('tech');
                  setActiveMenu(null);
                }}
              >
                🌳 Tech Tree
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
                          console.log('App: No settler selected for city founding');
                        }
                      } else {
                        console.log('App: No unit selected for city founding');
                      }
                    } else if (item === '🛣️ Build Road') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Building road with unit ${selectedUnit.id}`);
                          gameEngine.buildImprovement(selectedUnit.id, 'road');
                        } else {
                          console.log('App: No unit found for road building');
                        }
                      } else {
                        console.log('App: No unit selected for road building');
                      }
                    } else if (item === '🌾 Irrigate') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Irrigating with unit ${selectedUnit.id}`);
                          gameEngine.buildImprovement(selectedUnit.id, 'irrigation');
                        } else {
                          console.log('App: No unit found for irrigation');
                        }
                      } else {
                        console.log('App: No unit selected for irrigation');
                      }
                    } else if (item === '🗿 Mine') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Mining with unit ${selectedUnit.id}`);
                          gameEngine.buildImprovement(selectedUnit.id, 'mine');
                        } else {
                          console.log('App: No unit found for mining');
                        }
                      } else {
                        console.log('App: No unit selected for mining');
                      }
                    } else if (item === '🏹 Fortify') {
                      const selectedUnitId = gameState.selectedUnit;
                      if (selectedUnitId && gameEngine) {
                        const selectedUnit = gameEngine.units.find(u => u.id === selectedUnitId);
                        if (selectedUnit) {
                          console.log(`Civ1App: Fortifying unit ${selectedUnit.id}`);
                          gameEngine.unitFortify(selectedUnit.id);
                        } else {
                          console.log('App: No unit found for fortification');
                        }
                      } else {
                        console.log('App: No unit selected for fortification');
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

      {/* Game Modals */}
      <GameModals gameEngine={gameEngine} />
    </div>
  );
}

export default App;

