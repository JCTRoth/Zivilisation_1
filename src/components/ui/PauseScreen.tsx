import React from 'react';
import '../../styles/pauseScreen.css';

interface PauseScreenProps {
  show: boolean;
  onResume: () => void;
  currentTurn?: number;
  currentYear?: string;
  gameOver?: boolean;
}

/**
 * Full-screen pause overlay. Shown while the game is paused (triggered from the
 * GAME menu or Ctrl+P). Blocks interaction with the map while visible and offers
 * a Resume action.
 *
 * This one is a fullscreen overlay rather than a bootstrap dialog, so it is
 * dressed by hand in pauseScreen.css — but in the same language as the shared
 * GameModal shell: artwork slot with a placeholder caption, eyebrow / title /
 * lede hierarchy, a gold accent rule and a fixed action bar.
 */
const PauseScreen: React.FC<PauseScreenProps> = ({
  show,
  onResume,
  currentTurn,
  currentYear,
  gameOver = false,
}) => {
  if (!show) {
    return null;
  }

  const gameOverTitle = 'Game Over';
  const turnLabel =
    currentTurn !== undefined ? `Turn ${currentTurn}${currentYear ? ` · ${currentYear}` : ''}` : null;

  return (
    <div
      className={`pause-screen${gameOver ? ' pause-screen--ended' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={gameOver ? gameOverTitle : 'Game Paused'}
    >
      <div className="pause-screen__panel">
        <header className="pause-screen__hero">
          <div className="pause-screen__art">
            <span className="pause-screen__glyph" aria-hidden="true">
              {gameOver ? '🏆' : '⏸️'}
            </span>
            <span className="pause-screen__art-tag">
              {gameOver ? 'a closed chronicle' : 'the map at rest'}
            </span>
          </div>

          <div className="pause-screen__heading">
            <div className="pause-screen__eyebrow">
              {gameOver ? 'The Chronicle Closes' : 'The World Waits'}
            </div>
            <h2 className="pause-screen__title">{gameOver ? gameOverTitle : 'Game Paused'}</h2>
            <p className="pause-screen__lede">
              {gameOver
                ? "Your people's story runs out here. The board stands exactly as it fell — a monument to the last turn you played."
                : 'Your people, your rivals and every turn in progress are holding still. Return to the map when you are ready to rule again.'}
            </p>
          </div>
        </header>

        {(turnLabel || !gameOver) && (
          <div className="pause-screen__body">
            {turnLabel && <span className="pause-screen__status">{turnLabel}</span>}
            {!gameOver && (
              <p className="pause-screen__hint">Press Ctrl+P or click Resume to continue</p>
            )}
          </div>
        )}

        {!gameOver && (
          <div className="pause-screen__actions">
            <button
              type="button"
              className="touch-btn touch-btn--primary pause-screen__resume"
              onClick={onResume}
              autoFocus
            >
              <span aria-hidden="true">▶</span>
              Resume
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PauseScreen;
