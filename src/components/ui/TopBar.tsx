import React from 'react';
import type { GameMenuName } from './GameMenuSheet';
import type GameEngine from '@/game/engine/GameEngine';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import { useGameStore } from '@/stores/GameStore';
import ResearchIndicator from './ResearchIndicator';

interface TopBarProps {
  activeMenu: GameMenuName | null;
  onMenuClick: (menu: GameMenuName, e: React.MouseEvent<HTMLButtonElement>) => void;
  currentTurn: number;
  currentYear: string;
  onEndTurn: () => void;
  endTurnDisabled?: boolean;
  topBarRef?: React.Ref<HTMLDivElement>;
  gameEngine?: GameEngine | null;
}

const MENU_ITEMS: GameMenuName[] = ['GAME', 'WORLD', 'INFO'];

const MENU_LABELS: Record<GameMenuName, TranslationKey> = {
  GAME: 'menu.game',
  WORLD: 'menu.world',
  INFO: 'menu.info',
};

/**
 * Top navigation bar. Compact on phones (scrollable, 44px targets),
 * full-size on desktop.
 */
const TopBar: React.FC<TopBarProps> = ({
  activeMenu,
  onMenuClick,
  currentTurn,
  currentYear,
  onEndTurn,
  endTurnDisabled = false,
  topBarRef,
  gameEngine,
}) => {
  const { t } = useTranslation();
  const devMode = useGameStore((s) => !!s.settings?.devMode);
  const zoom = useGameStore((s) => s.camera?.zoom ?? 1);
  const activePlayer = useGameStore((s) => s.gameState?.activePlayer ?? 0);
  const civilizations = useGameStore((s) => s.civilizations);
  const activeCiv = civilizations?.[activePlayer];
  const isHotseat = (civilizations?.filter((c) => c.isHuman)?.length ?? 0) > 1;

  return (
    <div ref={topBarRef} className="game-top-bar" role="banner">
      <div className="d-flex align-items-center gap-1 topbar-menus">
        {MENU_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className={`topbar-menu-btn ${activeMenu === item ? 'is-active' : ''}`}
            aria-haspopup="menu"
            aria-expanded={activeMenu === item}
            onClick={(e) => onMenuClick(item, e)}
          >
            {/* toUpperCase in the DOM (not CSS) keeps the accessible name
                "GAME"/"WORLD"/"INFO" the e2e locators filter on. */}
            {t(MENU_LABELS[item]).toUpperCase()}
          </button>
        ))}
      </div>

      <div className="topbar-center">
        {isHotseat && activeCiv && (
          <div
            className="topbar-player-badge fw-bold"
            style={{ color: activeCiv.color, marginRight: '8px', fontSize: '0.9rem' }}
          >
            {activeCiv.name}
          </div>
        )}
        <div className="d-flex align-items-center gap-2 topbar-turn">
          <span>
            {t('common.turn', { turn: '' })} <strong>{currentTurn}</strong>
          </span>
          <span className="text-muted-ui" aria-hidden="true">•</span>
          <span>{currentYear}</span>
          {devMode && (
            <span className="fw-bold text-warning" aria-live="polite">
              • Zoom {zoom.toFixed(2)}×
            </span>
          )}
        </div>
        <ResearchIndicator gameEngine={gameEngine} />
      </div>

      {/* End Turn button — upper right, always available in hotseat mode */}
      <button
        type="button"
        className="touch-btn touch-btn--success topbar-endturn"
        onClick={onEndTurn}
        disabled={endTurnDisabled}
        aria-label={t('topbar.endTurn')}
        style={{ marginLeft: '8px' }}
      >
        <i className="bi bi-skip-end-fill" aria-hidden="true"></i>
        <span className="d-none d-lg-inline" aria-hidden="true">{t('topbar.endTurn')}</span>
      </button>
    </div>
  );
};

export default TopBar;
