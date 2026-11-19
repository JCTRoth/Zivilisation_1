import React from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import '../../styles/pauseScreen.css';

interface PauseScreenProps {
  show: boolean;
  onResume: () => void;
  currentTurn?: number;
  currentYear?: string;
  gameOver?: boolean;
  /**
   * Shown while `gameOver`: when the end-of-game screen is skipped, this panel
   * IS the game-over screen, and a dead end with no way out is not an option.
   */
  onRestart?: () => void;
  onQuit?: () => void;
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
  onRestart,
  onQuit,
}) => {
  // Hook must run before any early return — see rules of hooks.
  const { t } = useTranslation();

  if (!show) {
    return null;
  }

  const gameOverTitle = t('pause.gameOver');
  const turnLabel =
    currentTurn !== undefined
      ? `${t('common.turn', { turn: currentTurn })}${currentYear ? ` · ${currentYear}` : ''}`
      : null;

  return (
    <div
      className={`pause-screen${gameOver ? ' pause-screen--ended' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={gameOver ? gameOverTitle : t('pause.gamePaused')}
    >
      <div className="pause-screen__panel">
        <header className="pause-screen__hero">
          <div className="pause-screen__art">
            <span className="pause-screen__glyph" aria-hidden="true">
              {gameOver ? '🏆' : '⏸️'}
            </span>
            <span className="pause-screen__art-tag">
              {gameOver ? t('pause.artTagClosed') : t('pause.artTagRest')}
            </span>
          </div>

          <div className="pause-screen__heading">
            <div className="pause-screen__eyebrow">
              {gameOver ? t('pause.chronicleCloses') : t('pause.worldWaits')}
            </div>
            <h2 className="pause-screen__title">{gameOver ? gameOverTitle : t('pause.gamePaused')}</h2>
            <p className="pause-screen__lede">
              {gameOver ? t('pause.ledeGameOver') : t('pause.ledePaused')}
            </p>
          </div>
        </header>

        {(turnLabel || !gameOver) && (
          <div className="pause-screen__body">
            {turnLabel && <span className="pause-screen__status">{turnLabel}</span>}
            {!gameOver && <p className="pause-screen__hint">{t('pause.resumeHint')}</p>}
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
              <span aria-hidden="true">▶</span> {t('pause.resume')}
            </button>
          </div>
        )}

        {/* Game over with the result screen skipped: this panel is the whole
            ending, so it has to offer the two exits the chronicle would have. */}
        {gameOver && (onRestart || onQuit) && (
          <div className="pause-screen__actions">
            {onQuit && (
              <button type="button" className="touch-btn touch-btn--ghost" onClick={onQuit}>
                {t('pause.quitToMenu')}
              </button>
            )}
            {onRestart && (
              <button
                type="button"
                className="touch-btn touch-btn--primary pause-screen__resume"
                onClick={onRestart}
                autoFocus
              >
                <span aria-hidden="true">▶</span> {t('menu.newGame')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PauseScreen;
