import { useEffect, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import { tGovernmentName } from '@/i18n/dataNames';
import { gameLogger } from '@/utils/GameLogger';
import { getGovernment, GOVERNMENTS } from '@/data/GovernmentData';
import { ANARCHY_TURNS } from '@/game/engine/GovernmentManager';
import { GameUtils } from '@/utils/GameUtils';
import GameEngine from '@/game/engine/GameEngine';
import GameModal from './ModalShell';
import '../../../styles/governmentModal.css';

interface GovernmentModalProps {
  show: boolean;
  onHide: () => void;
  gameEngine?: GameEngine | null;
}

/**
 * Government switching modal (Civ1 style).
 * Shows the current government and capital, lists governments unlocked by the
 * civ's researched technologies, and starts a revolution — normally
 * ANARCHY_TURNS turns of anarchy (all rates forced to 0) before the new
 * government takes effect, or just 1 turn with the Pyramids wonder.
 */
function GovernmentModal({ show, onHide, gameEngine }: GovernmentModalProps) {
  const actions = useGameStore((state) => state.actions);
  const currentPlayer = useGameStore(
    (state) => state.civilizations[state.gameState.activePlayer] || null,
  );
  const gameState = useGameStore((state) => state.gameState);
  const [selected, setSelected] = useState<string>('despotism');
  // Subscribes the modal to language changes (government names repaint).
  const { t } = useTranslation();

  const gov = getGovernment(currentPlayer?.government);
  const inRevolution = !!currentPlayer && currentPlayer.government === 'anarchy'
    && (currentPlayer.revolutionTurns ?? 0) > 0;
  const revolutionTurns = currentPlayer?.revolutionTurns ?? 0;
  const pendingGov = currentPlayer?.pendingGovernment
    ? getGovernment(currentPlayer.pendingGovernment)
    : null;

  // Available governments (despotism always; others unlocked by techs).
  const available: string[] = gameEngine && typeof gameEngine.getAvailableGovernments === 'function'
    ? gameEngine.getAvailableGovernments(currentPlayer)
    : ['despotism'];

  // Actual anarchy length for this civ (the Pyramids wonder cuts it to 1).
  const anarchyTurns =
    gameEngine && currentPlayer && typeof gameEngine.governmentManager?.anarchyTurnsFor === 'function'
      ? gameEngine.governmentManager.anarchyTurnsFor(currentPlayer.id)
      : ANARCHY_TURNS;

  // Capital city display.
  const capitalCity = gameEngine && currentPlayer
    ? (gameEngine.cities ?? []).find(
        (c) => c.civilizationId === currentPlayer.id && c.isCapital === true,
      )
    : null;

  // Reset selection when the modal opens or the current government changes.
  useEffect(() => {
    if (show) setSelected(currentPlayer?.government ?? 'despotism');
  }, [show, currentPlayer]);

  const handleRevolution = (): void => {
    if (!currentPlayer || !gameEngine || typeof gameEngine.startRevolution !== 'function') return;
    const ok = gameEngine.startRevolution(currentPlayer.id, selected);
    if (ok) {
      actions.updateCivilizations([...(gameEngine.civilizations ?? [])]);
      gameLogger.record('GOVERNMENT_REVOLUTION', {
        civilizationId: currentPlayer.id,
        government: selected,
        anarchyTurns,
      });
      onHide();
    }
  };

  const eyebrowText = t('gov.eyebrow' as TranslationKey, {
    civ: currentPlayer?.name ?? t('gov.defaultEmpire' as TranslationKey),
    turn: gameState.currentTurn ?? 1,
    year: GameUtils.formatYear(gameState.currentYear ?? -4000),
  });

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="solemn"
      size="lg"
      dialogClassName="government-modal"
      icon="🏛️"
      artLabel={t('gov.artLabel' as TranslationKey)}
      eyebrow={eyebrowText}
      title={t('gov.title' as TranslationKey)}
      lede={t('gov.lede' as TranslationKey)}
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
            {t('gov.close' as TranslationKey)}
          </button>
          {!inRevolution && (
            <button
              type="button"
              className="touch-btn touch-btn--danger"
              onClick={handleRevolution}
              disabled={
                !currentPlayer
                || !available.includes(selected)
                || currentPlayer.government === selected
              }
            >
              {t('gov.startRevolution' as TranslationKey)}
            </button>
          )}
        </>
      }
    >
      <div className="government-modal__body">
        <section className="gm-section">
          <div className="gm-section-title">{t('gov.sectionToday' as TranslationKey)}</div>
          <div className="gm-kv-grid">
            <div className="gm-kv">{t('gov.kvCurrent' as TranslationKey)} <b>{tGovernmentName(currentPlayer?.government ?? '', gov.name)}</b></div>
            <div className="gm-kv">{t('gov.kvCapital' as TranslationKey)} <b>{capitalCity ? capitalCity.name : '—'}</b></div>
          </div>
          <div className="gm-prose">{gov.description}</div>
          {!capitalCity && !inRevolution && (
            <div className="gm-note">
              {t('gov.noCapital' as TranslationKey)}
            </div>
          )}
        </section>

        {inRevolution ? (
          <div className="gm-callout">
            <span className="gm-callout-title">{t('gov.revolutionTitle' as TranslationKey)}</span>
            {t(
              (revolutionTurns === 1 ? 'gov.anarchyOne' : 'gov.anarchyMany') as TranslationKey,
              { turns: revolutionTurns },
            )}
            {pendingGov && (
              <>
                {' '}{t('gov.pendingLead' as TranslationKey)}{' '}
                <strong>{tGovernmentName(currentPlayer?.pendingGovernment ?? '', pendingGov.name)}</strong>.
              </>
            )}
          </div>
        ) : (
          <section className="gm-section">
            <div className="gm-section-title">{t('gov.chooseTitle' as TranslationKey)}</div>
            <div className="government-list">
              {available.map((govId) => {
                const g = getGovernment(govId);
                const isCurrent = currentPlayer?.government === govId;
                return (
                  <button
                    key={govId}
                    type="button"
                    className={`government-card ${selected === govId ? 'government-card--selected' : ''} ${isCurrent ? 'government-card--current' : ''}`}
                    onClick={() => setSelected(govId)}
                    disabled={isCurrent}
                  >
                    <div className="government-card__name">
                      {tGovernmentName(govId, g.name)}
                      {isCurrent && <span className="gm-chip gm-chip--accent">{t('gov.chipCurrent' as TranslationKey)}</span>}
                      {selected === govId && !isCurrent && (
                        <span className="gm-chip gm-chip--accent">{t('gov.chipSelected' as TranslationKey)}</span>
                      )}
                    </div>
                    <div className="government-card__stats">
                      {g.maxTaxRate < 100 && (
                        <span className="gm-chip">{t('gov.chipTaxCap' as TranslationKey, { value: g.maxTaxRate })}</span>
                      )}
                      {g.corruptionRate > 0 && (
                        <span className="gm-chip">{t('gov.chipCorruption' as TranslationKey, { value: Math.round(g.corruptionRate * 100) })}</span>
                      )}
                      {g.commercePenalty > 0 && (
                        <span className="gm-chip">{t('gov.chipCommerce' as TranslationKey, { value: Math.round(g.commercePenalty * 100) })}</span>
                      )}
                      {g.happinessBonus > 0 && (
                        <span className="gm-chip">{t('gov.chipHappiness' as TranslationKey, { value: g.happinessBonus })}</span>
                      )}
                    </div>
                    <div className="government-card__desc">{g.description}</div>
                  </button>
                );
              })}
            </div>
            <div className="gm-note">
              {t('gov.charterNote' as TranslationKey, { turns: anarchyTurns })}
              {Object.keys(GOVERNMENTS).length > available.length
                ? t('gov.charterNoteLocked' as TranslationKey)
                : ''}
            </div>
          </section>
        )}
      </div>
    </GameModal>
  );
}

export default GovernmentModal;
