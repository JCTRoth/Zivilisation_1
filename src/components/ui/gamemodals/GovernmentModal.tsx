import { useEffect, useState } from 'react';
import { useGameStore } from '@/stores/GameStore';
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

  const eyebrowText = `${currentPlayer?.name ?? 'Your Empire'} · Turn ${gameState.currentTurn ?? 1} · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`;

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="solemn"
      size="lg"
      dialogClassName="government-modal"
      icon="🏛️"
      artLabel="seat of power"
      eyebrow={eyebrowText}
      title="Government"
      lede="Law, tax and the legions answer to one charter. Choose the one your people will live under — changing it means blood in the streets."
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
            Close
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
              🔥 Start Revolution
            </button>
          )}
        </>
      }
    >
      <div className="government-modal__body">
        <section className="gm-section">
          <div className="gm-section-title">Your government today</div>
          <div className="gm-kv-grid">
            <div className="gm-kv">Current government: <b>{gov.name}</b></div>
            <div className="gm-kv">Capital: <b>{capitalCity ? capitalCity.name : '—'}</b></div>
          </div>
          <div className="gm-prose">{gov.description}</div>
          {!capitalCity && !inRevolution && (
            <div className="gm-note">
              You hold no capital yet — found a city and it becomes the seat of your government.
            </div>
          )}
        </section>

        {inRevolution ? (
          <div className="gm-callout">
            <span className="gm-callout-title">Revolution in progress</span>
            Your people are in anarchy for {revolutionTurns} more turn
            {revolutionTurns === 1 ? '' : 's'} — tax, science and luxury are all
            forced to 0%.
            {pendingGov && (
              <>
                {' '}When the fighting stops you will rule as <strong>{pendingGov.name}</strong>.
              </>
            )}
          </div>
        ) : (
          <section className="gm-section">
            <div className="gm-section-title">Choose your charter</div>
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
                      {g.name}
                      {isCurrent && <span className="gm-chip gm-chip--accent">Current</span>}
                      {selected === govId && !isCurrent && (
                        <span className="gm-chip gm-chip--accent">Selected</span>
                      )}
                    </div>
                    <div className="government-card__stats">
                      {g.maxTaxRate < 100 && (
                        <span className="gm-chip">Tax cap {g.maxTaxRate}%</span>
                      )}
                      {g.corruptionRate > 0 && (
                        <span className="gm-chip">Corruption {Math.round(g.corruptionRate * 100)}%</span>
                      )}
                      {g.commercePenalty > 0 && (
                        <span className="gm-chip">−{Math.round(g.commercePenalty * 100)}% commerce</span>
                      )}
                      {g.happinessBonus > 0 && (
                        <span className="gm-chip">+{g.happinessBonus} happiness</span>
                      )}
                    </div>
                    <div className="government-card__desc">{g.description}</div>
                  </button>
                );
              })}
            </div>
            <div className="gm-note">
              Taking a new charter starts a {anarchyTurns}-turn revolution: rates fall to
              0% and your cities grow restless until the new government is in place.
              {Object.keys(GOVERNMENTS).length > available.length
                ? ' Only governments your scholars have unlocked appear here — keep researching to see the rest.'
                : ''}
            </div>
          </section>
        )}
      </div>
    </GameModal>
  );
}

export default GovernmentModal;
