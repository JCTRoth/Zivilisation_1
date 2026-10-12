import React, { useCallback, useMemo, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { useTranslation } from '@/i18n/useTranslation';
import { tTechName } from '@/i18n/dataNames';
import { getTechIcon } from '@/data/TechnologyIcons';
import type { Technology } from '../../../types/game';
import GameEngine from '@/game/engine/GameEngine';

interface ResearchIndicatorProps {
  gameEngine?: GameEngine | null;
}

interface ResearchStatus {
  currentTech: Technology | null;
  currentProgress: number;
  effectiveCost: number | null;
  nextInPath: Technology | null;
  allResearched: boolean;
  turns: number | null;
}

/**
 * Compact, always-visible research indicator shown in the top bar (next to the
 * End Turn button). It shows the currently researched tech + progress on one
 * line; hovering reveals a small preview panel with the progress bar, ETA and
 * a shortcut to open the Technology Tree. Clicking anywhere opens the tree.
 */
const ResearchIndicator: React.FC<ResearchIndicatorProps> = ({ gameEngine }) => {
  const actions = useGameStore((s) => s.actions);
  const civ = useGameStore((s) => s.civilizations[s.gameState.activePlayer] || null);
  const technologies = useGameStore((s) => s.technologies);
  const researchPath = useGameStore((s) => s.researchPath);
  // Subscribes the indicator to language changes; tech names below resolve
  // through tTechName and follow the active language.
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; right: number } | null>(null);

  const status = useMemo<ResearchStatus>(() => {
    const civObj = civ ?? null;
    const techs = technologies && technologies.length > 0 ? technologies : [];
    const allResearched = techs.length > 0 && techs.every((tech) => tech.researched);

    const current = civObj?.currentResearch ?? null;
    const currentId = current
      ? (typeof current === 'object' ? (current as { id?: string }).id : current)
      : null;
    const currentTech = currentId ? (techs.find((tech) => tech.id === currentId) ?? null) : null;
    const currentProgress = civObj?.researchProgress ?? 0;

    let effectiveCost: number | null = null;
    if (currentTech && gameEngine?.researchManager) {
      const engineCiv = gameEngine.civilizations?.[civObj?.id ?? 0] ?? null;
      if (engineCiv) {
        effectiveCost = gameEngine.researchManager.effectiveTechCost(engineCiv, currentTech);
      }
    }

    // Gate on the player's OWN techs — the shared tree's `researched` flag is
    // the union across all civs (coloring only) and would otherwise hide a
    // path tech an AI discovered first.
    const civTechIds = new Set<string>((civObj?.technologies ?? []).map(String));
    const nextInPathId = researchPath.find((id) => {
      const found = techs.find((candidate) => candidate.id === id);
      return !!found && found.available !== false && !civTechIds.has(String(id));
    }) ?? null;
    const nextInPath = nextInPathId ? (techs.find((tech) => tech.id === nextInPathId) ?? null) : null;

    // Live per-turn science at the current rates, used for the ETA estimate.
    let turns: number | null = null;
    if (currentTech && gameEngine?.researchManager) {
      const engineCiv = gameEngine.civilizations?.[civObj?.id ?? 0] ?? null;
      if (engineCiv) {
        const econ = gameEngine.economicManager as
          | { cityOutputs?: (city: unknown, c: unknown) => { science: number } }
          | undefined;
        const cities = (gameEngine.cities ?? []).filter((c) => c.civilizationId === engineCiv.id);
        const perTurnScience = cities.reduce((sum: number, c) => {
          if (econ && typeof econ.cityOutputs === 'function') {
            return sum + econ.cityOutputs(c, engineCiv).science;
          }
          return sum + ((c as { science?: number }).science ?? 0);
        }, 0);
        const est = gameEngine.researchManager.estimatedTurns(engineCiv, currentTech, perTurnScience);
        turns = est > 0 ? est : null;
      }
    }

    return { currentTech, currentProgress, effectiveCost, nextInPath, allResearched, turns };
  }, [civ, technologies, researchPath, gameEngine]);

  const { currentTech, currentProgress, effectiveCost, nextInPath, allResearched, turns } = status;

  const cost = effectiveCost ?? currentTech?.cost ?? 0;
  const progressPct = cost > 0 ? Math.min(100, (currentProgress / cost) * 100) : 0;

  const openTechTree = useCallback(() => {
    actions.showDialog('tech');
    setOpen(false);
  }, [actions]);

  const handleEnter = (e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.top, right: rect.right });
    setOpen(true);
  };

  const handleLeave = () => setOpen(false);

  // ── Compact label ─────────────────────────────────────────────────────
  let label: React.ReactNode;
  let hasResearch = false;
  if (allResearched) {
    label = <>🏆 {t('research.complete')}</>;
  } else if (currentTech) {
    hasResearch = true;
    label = (
      <>
        <i className="bi bi-flask" aria-hidden="true" />
        <span className="research-indicator-name">{tTechName(currentTech.id, currentTech.name)}</span>
        <span className="research-indicator-count">
          {currentProgress}/{cost}
        </span>
      </>
    );
  } else if (nextInPath) {
    label = (
      <>
        <i className="bi bi-flask" aria-hidden="true" />
        <span className="research-indicator-name">
          {t('research.researching', { tech: tTechName(nextInPath.id, nextInPath.name) })}
        </span>
      </>
    );
  } else if (gameEngine && typeof gameEngine.isResearchUnlocked === 'function' && !gameEngine.isResearchUnlocked()) {
    // Opening rounds: research has not started yet by design, so don't nag the
    // player with a "No research" warning.
    label = (
      <>
        <i className="bi bi-flask" aria-hidden="true" />
        <span className="research-indicator-name">{t('research.startsSoon')}</span>
      </>
    );
  } else {
    label = (
      <>
        <i className="bi bi-flask" aria-hidden="true" />
        <span className="research-indicator-name">{t('research.none')}</span>
      </>
    );
  }

  // Position the fixed preview panel just below the chip, keeping it inside the
  // viewport (the preview is wider than the compact chip).
  const previewStyle: React.CSSProperties | undefined = anchor
    ? {
        position: 'fixed',
        top: Math.max(6, Math.min(anchor.top + 48, Math.max(6, window.innerHeight - 250))),
        left: Math.max(6, Math.min(anchor.right - 280, window.innerWidth - 286)),
        width: 280,
        zIndex: 900,
      }
    : undefined;

  return (
    <div className="research-indicator-wrap" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      <button type="button" className="research-indicator" onClick={openTechTree} aria-haspopup="true" aria-expanded={open}>
        <span className="research-indicator-chip">{label}</span>
        {hasResearch && (
          <span className="research-indicator-minibar">
            <span className="research-indicator-minibar-fill" style={{ width: `${progressPct}%` }} />
          </span>
        )}
      </button>

      {open && anchor && (
        <div
          className="research-indicator-preview"
          style={previewStyle}
          onClick={(e) => e.stopPropagation()}
          role="tooltip"
        >
          <div className="research-indicator-preview-title">🔬 {t('research.title')}</div>

          {currentTech ? (
            <>
              <div className="research-indicator-preview-line">
                {getTechIcon(currentTech.id)} {tTechName(currentTech.id, currentTech.name)}
                <span className="research-indicator-preview-count">
                  {currentProgress}/{cost}
                </span>
              </div>
              <div className="research-indicator-preview-bar">
                <div className="research-indicator-preview-bar-fill" style={{ width: `${progressPct}%` }} />
              </div>
              {turns != null && (
                <div className="research-indicator-preview-eta">
                  {turns === 1 ? t('research.etaOne') : t('research.etaMany', { turns })}
                </div>
              )}
            </>
          ) : nextInPath ? (
            <div className="research-indicator-preview-line">
              {t('research.nextLabel')} {getTechIcon(nextInPath.id)} {tTechName(nextInPath.id, nextInPath.name)}
            </div>
          ) : allResearched ? (
            <div className="research-indicator-preview-line">{t('research.allResearched')}</div>
          ) : (
            <div className="research-indicator-preview-line">{t('research.noneSelected')}</div>
          )}

        </div>
      )}
    </div>
  );
};

export default ResearchIndicator;
