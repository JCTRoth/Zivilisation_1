import React, { useEffect, useMemo } from 'react';
import type { GameResult } from '../../../types/game';
import '@/styles/gameResultOverlay.css';

type GameResultOverlayProps = {
  result: GameResult | null;
  onClose: () => void;
  onRestart: () => void;
  onQuit: () => void;
};

const VICTORY_AUTO_DISMISS_MS = 60_000;
const CONFETTI_DURATION_MS = 15_000;

const GameResultOverlay: React.FC<GameResultOverlayProps> = ({
  result,
  onClose,
  onRestart,
  onQuit
}) => {
  const isVictory = result?.outcome === 'victory';
  const reasonDescription = useMemo(() => {
    if (!result) {
      return '';
    }
    if (result.outcome === 'victory') {
      if (result.reason === 'moonshot') {
        return 'Your civilization is entering a new golden age with this new technology.';
      }
      return 'The last rival civilization has fallen beneath your banner.';
    }
    return 'Your empire has crumbled. Only stories of your once great cities remain.';
  }, [result]);

  useEffect(() => {
    if (!isVictory) {
      return;
    }

    let isCancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const runConfetti = async () => {
      try {
        const module = await import('canvas-confetti');
        const confetti = module.default;
        const endTime = Date.now() + CONFETTI_DURATION_MS;

        const fire = () => {
          if (isCancelled) {
            return;
          }
          confetti({
            particleCount: 180,
            spread: 100,
            angle: 60,
            origin: { x: Math.random() * 0.6 + 0.2, y: Math.random() * 0.2 + 0.2 },
            colors: ['#ffd700', '#ffffff', '#ff4500', '#87ceeb']
          });

          if (Date.now() < endTime) {
            timer = setTimeout(fire, 700 + Math.random() * 300);
          }
        };

        fire();
      } catch (error) {
        console.warn('[GameResultOverlay] Confetti failed to initialize', error);
      }
    };

    runConfetti();

    return () => {
      isCancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isVictory]);

  useEffect(() => {
    if (!isVictory || !result) {
      return;
    }
    const timeout = setTimeout(() => {
      onClose();
    }, VICTORY_AUTO_DISMISS_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [isVictory, onClose, result]);

  if (!result) {
    return null;
  }

  return (
    <div className={`game-result-overlay ${isVictory ? 'victory' : 'defeat'}`} role="dialog" aria-modal="true">
      <div className="game-result-panel">
        <header className="game-result-header">
          <h1>{isVictory ? 'Victory Achieved!' : 'Defeat'}</h1>
          <p className="game-result-subtitle">{result.civName}</p>
        </header>

        <section className="game-result-body">
          <p>{reasonDescription}</p>
          {isVictory && result.reason === 'moonshot' && (
            <p className="game-result-highlight">The Moonshot project has ignited celebrations across your lands.</p>
          )}
        </section>

        <footer className="game-result-actions">
          {isVictory ? (
            <>
              <button className="gr-btn secondary" onClick={onRestart}>Restart</button>
              <button className="gr-btn" onClick={onClose}>Close</button>
              <button className="gr-btn danger" onClick={onQuit}>Quit</button>
            </>
          ) : (
            <>
              <button className="gr-btn primary" onClick={onRestart}>Restart</button>
              <button className="gr-btn danger" onClick={onQuit}>Quit</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
};

export default GameResultOverlay;
