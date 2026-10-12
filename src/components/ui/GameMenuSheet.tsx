import React from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';

export type GameMenuName = 'GAME' | 'WORLD' | 'INFO';

interface GameMenuSheetProps {
  activeMenu: GameMenuName | null;
  position: { top: number; left: number };
  onClose: () => void;
  onNewGame: () => void;
  onSaveGame: () => void;
  onLoadGame: () => void;
  onPause: () => void;
  onOpenSettings: () => void;
  onOpenRates: () => void;
  onOpenGovernment: () => void;
  onQuit: () => void;
  onDownloadMap: () => void;
  onDownloadProgression: () => void;
  onDownloadProgressionCompact: () => void;
  onHelp: () => void;
  onDiplomacy: () => void;
  onTechTree: () => void;
  onStatistics: () => void;
  /** Open the dedicated Wonders overview screen (spec B). */
  onWonders: () => void;
}

interface MenuItemProps {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, onClick, danger = false }) => (
  <button
    type="button"
    className={`menu-item ${danger ? 'menu-item--danger' : ''}`}
    onClick={onClick}
  >
    <span className="menu-item__icon" aria-hidden="true">{icon}</span>
    <span>{label}</span>
  </button>
);

/**
 * Game menu (GAME / WORLD / INFO).
 * Renders as a classic anchored dropdown on desktop and as a
 * bottom sheet on mobile (see design-system.css .menu-sheet).
 */
const GameMenuSheet: React.FC<GameMenuSheetProps> = ({
  activeMenu,
  position,
  onClose,
  onNewGame,
  onSaveGame,
  onLoadGame,
  onPause,
  onOpenSettings,
  onOpenRates,
  onOpenGovernment,
  onQuit,
  onDownloadMap,
  onDownloadProgression,
  onDownloadProgressionCompact,
  onHelp,
  onDiplomacy,
  onTechTree,
  onStatistics,
  onWonders,
}) => {
  // Hook must run before any early return — see rules of hooks.
  const { t } = useTranslation();

  if (!activeMenu) {
    return null;
  }

  const menuTitle: Record<GameMenuName, TranslationKey> = {
    GAME: 'menu.game',
    WORLD: 'menu.world',
    INFO: 'menu.info',
  };

  return (
    <>
      {/* Backdrop — closes on tap outside (essential on mobile) */}
      <div className="menu-sheet__backdrop" onClick={onClose} aria-hidden="true" />

      <div
        className="menu-sheet"
        role="menu"
        aria-label={t('menu.ariaLabel', { title: t(menuTitle[activeMenu]) })}
        style={{
          '--menu-top': `${position.top}px`,
          '--menu-left': `${position.left}px`,
        } as React.CSSProperties}
      >
        <div className="menu-sheet__title">{t(menuTitle[activeMenu])}</div>

        {activeMenu === 'GAME' && (
          <>
            <MenuItem icon="🆕" label={t('menu.newGame')} onClick={onNewGame} />
            <MenuItem icon="💾" label={t('menu.saveGame')} onClick={onSaveGame} />
            <MenuItem icon="⏸️" label={t('menu.pause')} onClick={onPause} />
            <MenuItem icon="📁" label={t('menu.loadGame')} onClick={onLoadGame} />
            <MenuItem icon="⚙️" label={t('menu.settings')} onClick={onOpenSettings} />
            <MenuItem icon="🚪" label={t('menu.quit')} onClick={onQuit} danger />
          </>
        )}

        {activeMenu === 'WORLD' && (
          <>
            <MenuItem icon="⚖️" label={t('menu.diplomacy')} onClick={onDiplomacy} />
            <MenuItem icon="📊" label={t('menu.rates')} onClick={onOpenRates} />
            <MenuItem icon="🏛️" label={t('menu.government')} onClick={onOpenGovernment} />
            <MenuItem icon="🧪" label={t('menu.techTree')} onClick={onTechTree} />
            <MenuItem icon="📈" label={t('menu.statistics')} onClick={onStatistics} />
            <MenuItem icon="🏆" label={t('menu.wonders')} onClick={onWonders} />
          </>
        )}

        {activeMenu === 'INFO' && (
          <>
            <MenuItem icon="🗺️" label={t('menu.downloadMap')} onClick={onDownloadMap} />
            <MenuItem icon="📜" label={t('menu.downloadProgression')} onClick={onDownloadProgression} />
            <MenuItem icon="🗜️" label={t('menu.downloadProgressionCompact')} onClick={onDownloadProgressionCompact} />
            <MenuItem icon="❓" label={t('menu.help')} onClick={onHelp} />
          </>
        )}
      </div>
    </>
  );
};

export default GameMenuSheet;
