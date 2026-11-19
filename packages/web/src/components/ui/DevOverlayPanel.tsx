import React, { useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import type { DevOverlayFlags } from '../../../types/game';
import '../../styles/devOverlayPanel.css';

interface DevOverlayOption {
  key: keyof DevOverlayFlags;
  icon: string;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
}

const OPTIONS: DevOverlayOption[] = [
  {
    key: 'forgeOfWar',
    icon: '🔥',
    labelKey: 'dev.overlays.forgeOfWar',
    hintKey: 'dev.overlays.forgeOfWarHint',
  },
  {
    key: 'aiTargets',
    icon: '🎯',
    labelKey: 'dev.overlays.aiTargets',
    hintKey: 'dev.overlays.aiTargetsHint',
  },
  {
    key: 'cityRadii',
    icon: '🏘️',
    labelKey: 'dev.overlays.cityRadii',
    hintKey: 'dev.overlays.cityRadiiHint',
  },
  {
    key: 'sightRadius',
    icon: '🔦',
    labelKey: 'dev.overlays.sightRadius',
    hintKey: 'dev.overlays.sightRadiusHint',
  },
];

/** Every switch off — also the shape a settings object without them falls back to. */
const ALL_OFF: DevOverlayFlags = {
  forgeOfWar: false,
  aiTargets: false,
  cityRadii: false,
  sightRadius: false,
};

/**
 * Floating overlay panel, rendered only while developer mode is on (App hides
 * it otherwise). Each box switches one map overlay in `MapRenderer`:
 *
 *  - Forge of War … the barbarian horde's assault/scouting plan + read-out.
 *    A player selector under that box filters the horde through one human
 *    player's fog of war — or, for an AI civilization, shows its committed
 *    offensive or current army-group movement (its forge of war).
 *  - AI target … the tiles the AI picked as objectives this round
 *  - City radii … every city's work radius, not just the selected one
 *  - Sight radius … the tiles each unit reveals
 *
 * The switches live in `settings.devOverlays` (and the selected viewer in
 * `settings.devViewPlayerId`), which is where `GameCanvas` reads them from —
 * the panel itself draws nothing.
 */
const DevOverlayPanel: React.FC = () => {
  const { t } = useTranslation();
  const devMode = useGameStore((state) => !!state.settings?.devMode);
  const overlays = useGameStore((state) => state.settings?.devOverlays);
  const devViewPlayerId = useGameStore(
    (state) => state.settings?.devViewPlayerId ?? null,
  );
  const civilizations = useGameStore((state) => state.civilizations);
  const updateSettings = useGameStore((state) => state.actions.updateSettings);
  const [collapsed, setCollapsed] = useState(false);

  if (!devMode) return null;

  const flags: DevOverlayFlags = overlays ?? ALL_OFF;

  // The Forge of War can be looked at through one player's eyes. Only living
  // civilizations are offered; a stale/unknown id falls back to the AI truth.
  const viewableCivs = civilizations.filter((civ) => civ.isAlive !== false);
  const selectedViewId =
    devViewPlayerId !== null && viewableCivs.some((civ) => civ.id === devViewPlayerId)
      ? String(devViewPlayerId)
      : '';

  const toggle = (key: keyof DevOverlayFlags) => {
    updateSettings({ devOverlays: { ...flags, [key]: !flags[key] } });
  };

  return (
    <div className="dev-overlay-panel" role="group" aria-label={t('dev.overlays.title')}>
      <button
        type="button"
        className="dev-overlay-panel__header"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span>🛠 {t('dev.overlays.title')}</span>
        <span className="dev-overlay-panel__chevron" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {!collapsed && (
        <div className="dev-overlay-panel__body">
          {OPTIONS.map((option) => (
            <label
              key={option.key}
              className="dev-overlay-panel__row"
              title={t(option.hintKey)}
            >
              <input
                type="checkbox"
                checked={flags[option.key]}
                onChange={() => toggle(option.key)}
              />
              <span className="dev-overlay-panel__icon" aria-hidden="true">
                {option.icon}
              </span>
              <span>{t(option.labelKey)}</span>
            </label>
          ))}
          {flags.forgeOfWar && (
            <div className="dev-overlay-panel__view">
              <label className="dev-overlay-panel__view-label" htmlFor="dev-forge-view-player">
                <span aria-hidden="true">👁</span> {t('dev.overlays.viewAs')}
              </label>
              <select
                id="dev-forge-view-player"
                className="dev-overlay-panel__select"
                value={selectedViewId}
                onChange={(event) =>
                  updateSettings({
                    devViewPlayerId:
                      event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">{t('dev.overlays.viewAll')}</option>
                {viewableCivs.map((civ) => (
                  <option key={civ.id} value={civ.id}>
                    {civ.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DevOverlayPanel;
