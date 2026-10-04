import React from 'react';

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
  if (!activeMenu) {
    return null;
  }

  const menuTitle: Record<GameMenuName, string> = {
    GAME: 'Game',
    WORLD: 'World',
    INFO: 'Info',
  };

  return (
    <>
      {/* Backdrop — closes on tap outside (essential on mobile) */}
      <div className="menu-sheet__backdrop" onClick={onClose} aria-hidden="true" />

      <div
        className="menu-sheet"
        role="menu"
        aria-label={`${menuTitle[activeMenu]} menu`}
        style={{
          '--menu-top': `${position.top}px`,
          '--menu-left': `${position.left}px`,
        } as React.CSSProperties}
      >
        <div className="menu-sheet__title">{menuTitle[activeMenu]}</div>

        {activeMenu === 'GAME' && (
          <>
            <MenuItem icon="🆕" label="New Game" onClick={onNewGame} />
            <MenuItem icon="💾" label="Save Game" onClick={onSaveGame} />
            <MenuItem icon="⏸️" label="Pause" onClick={onPause} />
            <MenuItem icon="📁" label="Load Game" onClick={onLoadGame} />
            <MenuItem icon="⚙️" label="Settings" onClick={onOpenSettings} />
            <MenuItem icon="🚪" label="Quit" onClick={onQuit} danger />
          </>
        )}

        {activeMenu === 'WORLD' && (
          <>
            <MenuItem icon="⚖️" label="Diplomacy" onClick={onDiplomacy} />
            <MenuItem icon="📊" label="Rates" onClick={onOpenRates} />
            <MenuItem icon="🏛️" label="Government" onClick={onOpenGovernment} />
            <MenuItem icon="🧪" label="Tech Tree" onClick={onTechTree} />
            <MenuItem icon="📈" label="Statistics" onClick={onStatistics} />
            <MenuItem icon="🏆" label="Wonders" onClick={onWonders} />
          </>
        )}

        {activeMenu === 'INFO' && (
          <>
            <MenuItem icon="🗺️" label="Download Map" onClick={onDownloadMap} />
            <MenuItem icon="📜" label="Download Game Progression List" onClick={onDownloadProgression} />
            <MenuItem icon="🗜️" label="Download Compact Progression (CSV)" onClick={onDownloadProgressionCompact} />
            <MenuItem icon="❓" label="Help" onClick={onHelp} />
          </>
        )}
      </div>
    </>
  );
};

export default GameMenuSheet;
