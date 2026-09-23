import { useEffect, useState } from 'react';
import { Modal, Alert } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { gameLogger } from '@/utils/GameLogger';
import { getGovernment, GOVERNMENTS } from '@/data/GovernmentData';
import { ANARCHY_TURNS } from '@/game/engine/GovernmentManager';
import GameEngine from '@/game/engine/GameEngine';
import '../../../styles/governmentModal.css';

interface GovernmentModalProps {
  show: boolean;
  onHide: () => void;
  gameEngine?: GameEngine | null;
}

/**
 * Government switching modal (Civ1 style).
 * Shows the current government and capital, lists governments unlocked by the
 * civ's researched technologies, and starts a revolution — ANARCHY_TURNS turns
 * of anarchy (all rates forced to 0) before the new government takes effect.
 */
function GovernmentModal({ show, onHide, gameEngine }: GovernmentModalProps) {
  const actions = useGameStore((state) => state.actions);
  const currentPlayer = useGameStore(
    (state) => state.civilizations[state.gameState.activePlayer] || null,
  );
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
        anarchyTurns: ANARCHY_TURNS,
      });
      onHide();
    }
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="lg"
      fullscreen="lg-down"
      dialogClassName="government-modal"
    >
      <Modal.Header closeButton className="government-modal__header">
        <Modal.Title className="government-modal__title">
          <span aria-hidden="true">⚖️</span> Government — {currentPlayer?.name ?? 'Civilization'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="government-modal__body">
        <div className="government-current">
          <div>
            Current government: <strong>{gov.name}</strong>
          </div>
          {capitalCity && (
            <div>
              Capital: <strong>{capitalCity.name}</strong> 🏛️
            </div>
          )}
          <div className="government-current__desc">{gov.description}</div>
          {!capitalCity && !inRevolution && (
            <div className="government-current__desc">
              No capital — found a city to establish a seat of government.
            </div>
          )}
        </div>

        {inRevolution ? (
          <Alert variant="warning" className="government-revolution-banner">
            🔥 <strong>Revolution in progress!</strong>{' '}
            Anarchy for {revolutionTurns} more turn{revolutionTurns === 1 ? '' : 's'} —
            all Tax/Science/Luxury rates are forced to 0%.
            {pendingGov && <> Adopting <strong>{pendingGov.name}</strong> when it completes.</>}
          </Alert>
        ) : (
          <>
            <div className="government-list-title">
              Choose a government (switching starts a {ANARCHY_TURNS}-turn revolution)
            </div>
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
                      {isCurrent && <span className="government-card__tag">Current</span>}
                      {selected === govId && !isCurrent && <span className="government-card__tag">Selected</span>}
                    </div>
                    <div className="government-card__stats">
                      {g.maxTaxRate < 100 && <span>Tax cap {g.maxTaxRate}%</span>}
                      {g.corruptionRate > 0 && <span>Corruption {Math.round(g.corruptionRate * 100)}%</span>}
                      {g.commercePenalty > 0 && <span>−{Math.round(g.commercePenalty * 100)}% commerce</span>}
                      {g.happinessBonus > 0 && <span>+{g.happinessBonus} happiness</span>}
                      {g.tolerance > 2 && <span>Tolerance {g.tolerance}</span>}
                    </div>
                    <div className="government-card__desc">{g.description}</div>
                  </button>
                );
              })}
            </div>
            <div className="government-hint">
              Note: all governments unlocked by researched technologies appear here.
              {Object.keys(GOVERNMENTS).length > available.length && ' Research more to unlock others.'}
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer className="government-modal__footer">
        <button type="button" className="government-modal__btn" onClick={onHide}>
          Close
        </button>
        {!inRevolution && (
          <button
            type="button"
            className="government-modal__btn government-modal__btn--revolution"
            onClick={handleRevolution}
            disabled={!currentPlayer || !available.includes(selected) || currentPlayer.government === selected}
          >
            🔥 Start Revolution
          </button>
        )}
      </Modal.Footer>
    </Modal>
  );
}

export default GovernmentModal;
