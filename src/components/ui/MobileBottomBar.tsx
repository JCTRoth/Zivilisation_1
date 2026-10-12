import React from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { GameMenuName } from './GameMenuSheet';

interface MobileBottomBarProps {
  activeMenu: GameMenuName | null;
  onOpenMenu: (menu: GameMenuName) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  onEndTurn: () => void;
}

interface BarButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  endTurn?: boolean;
  ariaLabel?: string;
}

const BarButton: React.FC<BarButtonProps> = ({
  icon,
  label,
  onClick,
  active = false,
  endTurn = false,
  ariaLabel,
}) => (
  <button
    type="button"
    className={`mobile-bottom-bar__btn ${active ? 'is-active' : ''} ${endTurn ? 'mobile-bottom-bar__btn--endturn' : ''}`}
    onClick={onClick}
    aria-label={ariaLabel ?? label}
  >
    <i className={icon} aria-hidden="true" />
    <span>{label}</span>
  </button>
);

/**
 * Mobile-only primary action bar (thumb zone).
 * Provides one-handed access to menus, the info panel, and End Turn.
 */
const MobileBottomBar: React.FC<MobileBottomBarProps> = ({
  activeMenu,
  onOpenMenu,
  panelOpen,
  onTogglePanel,
  onEndTurn,
}) => {
  const { t } = useTranslation();
  return (
    <nav className="mobile-bottom-bar" aria-label={t('mobile.primaryActions' as TranslationKey)}>
      <BarButton
        icon="bi bi-list"
        label={t('mobile.menu' as TranslationKey)}
        ariaLabel={t('mobile.gameMenu' as TranslationKey)}
        active={activeMenu === 'GAME'}
        onClick={() => onOpenMenu('GAME')}
      />
      <BarButton
        icon="bi bi-globe-americas"
        label={t('mobile.world' as TranslationKey)}
        ariaLabel={t('mobile.worldMenu' as TranslationKey)}
        active={activeMenu === 'WORLD'}
        onClick={() => onOpenMenu('WORLD')}
      />
      <BarButton
        icon="bi bi-info-circle"
        label={t('mobile.info' as TranslationKey)}
        ariaLabel={t('mobile.infoMenu' as TranslationKey)}
        active={activeMenu === 'INFO'}
        onClick={() => onOpenMenu('INFO')}
      />
      <BarButton
        icon="bi bi-layout-sidebar-inset"
        label={t('mobile.panel' as TranslationKey)}
        ariaLabel={t('mobile.togglePanel' as TranslationKey)}
        active={panelOpen}
        onClick={onTogglePanel}
      />
      <BarButton
        icon="bi bi-skip-end-fill"
        label={t('mobile.endTurn' as TranslationKey)}
        endTurn
        onClick={onEndTurn}
      />
    </nav>
  );
};

export default MobileBottomBar;
