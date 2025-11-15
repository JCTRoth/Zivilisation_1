import React, { useEffect, useState } from 'react';
import { Container } from 'react-bootstrap';

// Components
import LoadingScreen from './components/ui/LoadingScreen';
import GameCanvas from './components/game/GameCanvas';
import TopBar from './components/ui/TopBar';
import SidePanel from './components/ui/SidePanel';
import BottomPanel from './components/ui/BottomPanel';
import GameModals from './components/ui/GameModals';

// Stores
import { useGameStore } from './stores/gameStore';

// Game Engine
import GameEngine from './engine/GameEngine';
import { useGameEngine } from './hooks/useGameEngine';

function App() {
  const gameState = useGameStore(state => state.gameState);
  const actions = useGameStore(state => state.actions);
  const [gameEngine, setGameEngine] = useState(null);
  const [error, setError] = useState(null);

  // Initialize game engine
  useEffect(() => {
    const initializeGame = async () => {
      try {
        console.log('App: Starting initialization...');
        actions.setLoading(true);
        
        // Create game engine instance
        const engine = new GameEngine(actions);
        await engine.initialize();
        
        setGameEngine(engine);
        actions.setLoading(false);
        console.log('App: Initialization complete');
        
      } catch (error) {
        console.error('Failed to initialize game:', error);
        setError(error.message);
        actions.addNotification({
          type: 'error',
          message: 'Failed to initialize game. Please refresh and try again.'
        });
      }
    };

    initializeGame();
  }, [actions]);

  // Connect game engine to React state management
  useGameEngine(gameEngine);

  // Show error state
  if (error) {
    return (
      <div className="d-flex justify-content-center align-items-center vh-100 bg-dark text-white">
        <div className="text-center">
          <h2>Error Loading Game</h2>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => {
            console.log(`[CLICK] Reload page button clicked`);
            window.location.reload();
          }}>
            Reload Page
          </button>
        </div>
      </div>
    );
  }

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (event) => {
      if (!gameEngine || gameState.isLoading) return;

      switch (event.key.toLowerCase()) {
        case 'h':
          actions.showDialog('help');
          break;
        case 'escape':
          actions.hideDialog();
          break;
        case 'enter':
        case ' ':
          if (gameState.gamePhase === 'playing') {
            actions.nextTurn();
            gameEngine.processTurn();
          }
          break;
        case 'm':
          actions.toggleUI('showMinimap');
          break;
        case 't':
          actions.showDialog('tech');
          break;
        case 'd':
          actions.showDialog('diplomacy');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [gameEngine, gameState.isLoading, gameState.gamePhase, actions]);

  // Show loading screen during initialization
  if (gameState.isLoading || !gameEngine) {
    return <LoadingScreen />;
  }

  return (
    <div className="game-container">
      {/* Top Bar with resources and controls */}
      <TopBar gameEngine={gameEngine} />
      
      {/* Main game area */}
      <div className="d-flex flex-grow-1 position-relative">
        {/* Game Canvas */}
        <div className="flex-grow-1 position-relative overflow-hidden">
          <GameCanvas gameEngine={gameEngine} />
          
          {/* Bottom Panel for unit/city details - mobile responsive */}
          <BottomPanel gameEngine={gameEngine} />
        </div>
        
        {/* Side Panel for game info - responsive */}
        <SidePanel gameEngine={gameEngine} />
      </div>
      
      {/* Modal Dialogs */}
      <GameModals gameEngine={gameEngine} />
    </div>
  );
}

export default App;