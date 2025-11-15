import React, { useEffect, useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import GameEngine from '../engine/GameEngine.js';

const MinimalApp = () => {
  console.log('MinimalApp rendering...');
  const gameState = useGameStore(state => state.gameState);
  const actions = useGameStore(state => state.actions);
  const [initStatus, setInitStatus] = useState('Testing GameEngine import...');
  
  useEffect(() => {
    console.log('MinimalApp useEffect running...');
    try {
      console.log('Trying to create GameEngine...');
      const gameEngine = new GameEngine(actions);
      console.log('GameEngine created successfully:', gameEngine);
      setInitStatus('GameEngine created successfully!');
    } catch (error) {
      console.error('Error creating GameEngine:', error);
      setInitStatus(`GameEngine Error: ${error.message}`);
    }
  }, []);
  
  console.log('Game State:', gameState);
  
  return (
    <div className="container-fluid vh-100 bg-primary">
      <div className="row h-100">
        <div className="col-12 text-white p-4">
          <h1>🏛️ Minimal Civilization Browser</h1>
          
          <div className="mb-3">
            <h3>🔧 Debug Information</h3>
            <p><strong>Init Status:</strong> {initStatus}</p>
            <p><strong>Loading:</strong> {gameState?.isLoading ? 'Yes' : 'No'}</p>
            <p><strong>Game Phase:</strong> {gameState?.gamePhase || 'undefined'}</p>
          </div>
          
          <div className="mb-3">
            <h3>🎮 Jotai State Test</h3>
            <p><strong>gameState type:</strong> {typeof gameState}</p>
            <p><strong>gameState keys:</strong> {gameState ? Object.keys(gameState).join(', ') : 'null'}</p>
          </div>
          
          <div className="mb-3">
            <h3>📊 Raw State</h3>
            <details className="bg-dark p-2 rounded">
              <summary className="btn btn-sm btn-light">Show JSON</summary>
              <pre className="text-light mt-2" style={{fontSize: '0.8rem'}}>
                {JSON.stringify({gameState}, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MinimalApp;