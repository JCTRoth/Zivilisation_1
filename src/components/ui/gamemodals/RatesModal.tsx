import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Alert } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { gameLogger } from '@/utils/GameLogger';
import { CityUtils } from '@/utils/CityUtils';
import { getGovernment } from '@/data/GovernmentData';
import { CITY_CENTER_COMMERCE, TRADE_GOLD_MULTIPLIER } from '@/game/engine/EconomicManager';
import GameEngine from '@/game/engine/GameEngine';
import '../../../styles/ratesModal.css';

type RateKey = 'tax' | 'science' | 'luxury';

interface RatesModalProps {
  show: boolean;
  onHide: () => void;
  gameEngine?: GameEngine | null;
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

const RATE_KEYS: RateKey[] = ['tax', 'science', 'luxury'];

/**
 * Tax / Science / Luxury rate control (Civ1 style).
 * The three sliders always sum to 100%: moving one redistributes the leftover
 * proportionally over the other two. Applying writes the rates onto the civ via
 * GameEngine.setRates (which also enforces the government's caps).
 */
function RatesModal({ show, onHide, gameEngine }: RatesModalProps) {
  const actions = useGameStore((state) => state.actions);
  const currentPlayer = useGameStore(
    (state) => state.civilizations[state.gameState.activePlayer] || null,
  );

  const [rates, setRates] = useState<Record<RateKey, number>>({
    tax: 50,
    science: 50,
    luxury: 0,
  });

  // Sync local sliders from the current civ whenever the modal opens.
  useEffect(() => {
    if (!show || !currentPlayer) return;
    setRates({
      tax: clamp(currentPlayer.taxRate ?? 50, 0, 100),
      science: clamp(currentPlayer.scienceRate ?? 50, 0, 100),
      luxury: clamp(currentPlayer.luxuryRate ?? 0, 0, 100),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, currentPlayer]);

  /**
   * Move one slider; redistribute the remaining 100% proportionally over the
   * other two so the three rates always sum to exactly 100.
   */
  const applyRate = (which: RateKey, value: number): void => {
    const newVal = clamp(Math.round(value), 0, 100);
    const others = RATE_KEYS.filter((k) => k !== which);
    const [a, b] = others as [RateKey, RateKey];
    const remaining = 100 - newVal;
    const otherTotal = rates[a] + rates[b];
    let newA = 0;
    let newB = 0;
    if (otherTotal > 0) {
      newA = Math.round(remaining * (rates[a] / otherTotal));
      newB = remaining - newA;
    } else {
      newA = Math.round(remaining / 2);
      newB = remaining - newA;
    }
    setRates({ ...rates, [which]: newVal, [a]: newA, [b]: newB });
  };

  const gov = getGovernment(currentPlayer?.government);
  const taxOverCap = currentPlayer ? rates.tax > gov.maxTaxRate : false;
  const sum = rates.tax + rates.science + rates.luxury;

  // Live preview of what the selected rates would produce. Mirrors
  // EconomicManager exactly — real tile-based commerce, government penalty,
  // distance corruption, the rate split, and the engine's upkeep model — so
  // the projected numbers match what the turn actually pays out.
  const preview = useMemo(() => {
    if (!currentPlayer || !gameEngine) {
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, net: 0, hasCities: false };
    }
    const cities = (gameEngine.cities ?? []).filter(
      (c) => c.civilizationId === currentPlayer.id,
    );
    const econ = gameEngine.economicManager;
    const gov = getGovernment(currentPlayer.government);
    // Same pipeline as EconomicManager.cityOutputs: commerce → government
    // commerce penalty → distance-from-capital corruption → rate split.
    // (Skipping corruption made the preview promise more gold/science than
    // the treasury/research pool actually received.)
    const perCityAfterCorruption = cities.map((c) => {
      const rawCommerce = typeof econ?.cityCommerce === 'function'
        ? econ.cityCommerce(c)
        : Math.max(c.yields?.trade ?? 0, CITY_CENTER_COMMERCE);
      const effective = rawCommerce * (1 - gov.commercePenalty);
      const corruption = CityUtils.calculateCorruption(c, currentPlayer, effective);
      return Math.max(0, Math.floor(effective - corruption));
    });
    const commerce = perCityAfterCorruption.reduce((t, v) => t + v, 0);
    const tax = perCityAfterCorruption.reduce(
      (t, v) => t + Math.floor((v * rates.tax) / 100) * TRADE_GOLD_MULTIPLIER, 0);
    const rawScience = perCityAfterCorruption.reduce(
      (t, v) => t + Math.round((v * rates.science) / 100), 0)
      + cities.reduce((t, c) => t + (c.scienceBonus ?? 0), 0);
    // Effective research actually added to the current tech this turn — the
    // beaker modifiers plus the 4-turn minimum / 32-turn maximum caps. (Using
    // raw beakers over-reported: "+19" shown while only 9 points were added.)
    const currentTech = currentPlayer.currentResearch ?? null;
    const researchMgr = gameEngine.researchManager;
    const science = researchMgr && currentTech
      ? researchMgr.perTurnProgress(currentPlayer, currentTech, rawScience)
      : rawScience;
    const luxury = perCityAfterCorruption.reduce(
      (t, v) => t + Math.floor((v * rates.luxury) / 100), 0);
    // Exact upkeep: 1 gold per city + units beyond the one-per-city free
    // support. NONE units (village units without a home city) are free —
    // counting every unit here overstated the drain (-7 shown vs -5 actual).
    const upkeep = typeof econ?.totalUpkeep === 'function'
      ? econ.totalUpkeep(currentPlayer.id)
      : Math.max(
          (gameEngine.units ?? []).filter((u) => u.civilizationId === currentPlayer.id).length,
          cities.length,
        );
    return { commerce, tax, science, luxury, upkeep, net: tax - upkeep, hasCities: cities.length > 0 };
  }, [rates, currentPlayer, gameEngine]);

  const handleApply = (): void => {
    if (currentPlayer && gameEngine && typeof gameEngine.setRates === 'function') {
      gameEngine.setRates(currentPlayer.id, rates.tax, rates.science, rates.luxury);
      actions.updateCivilizations([...(gameEngine.civilizations ?? [])]);
      gameLogger.record('RATES_CHANGED', {
        civilizationId: currentPlayer.id,
        taxRate: rates.tax,
        scienceRate: rates.science,
        luxuryRate: rates.luxury,
      });
    }
    onHide();
  };

  const renderSlider = (key: RateKey, label: string, icon: string, hint: string): React.ReactElement => (
    <div className="rates-control">
      <div className="rates-control__header">
        <Form.Label className="rates-control__label">
          <span aria-hidden="true">{icon}</span> {label}
        </Form.Label>
        <strong className="rates-control__value">{rates[key]}%</strong>
      </div>
      <Form.Range
        min={0}
        max={100}
        step={1}
        value={rates[key]}
        onChange={(e) => applyRate(key, Number(e.target.value))}
        className="rates-control__range"
        aria-label={`${label} rate`}
      />
      <Form.Text className="rates-control__hint">{hint}</Form.Text>
    </div>
  );

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="lg"
      fullscreen="lg-down"
      dialogClassName="rates-modal"
    >
      <Modal.Header closeButton className="rates-modal__header">
        <Modal.Title className="rates-modal__title">
          <span aria-hidden="true">📊</span> Rates — {currentPlayer?.name ?? 'Civilization'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="rates-modal__body">
        <div className="rates-government">
          Government: <strong>{gov.name}</strong>
          {gov.maxTaxRate < 100 && ` · Tax capped at ${gov.maxTaxRate}%`}
          {gov.forcesZeroRates && ' · All rates forced to 0% (anarchy)'}
        </div>

        {renderSlider('tax', 'Tax Rate', '🪙', 'Commerce → treasury gold (unit & city upkeep)')}
        {renderSlider('science', 'Science Rate', '🔬', 'Commerce → research points (tech progress)')}
        {renderSlider('luxury', 'Luxury Rate', '🎭', 'Commerce → happiness (prevents disorder)')}

        {taxOverCap && (
          <Alert variant="warning" className="rates-warning">
            Tax is above the {gov.maxTaxRate}% cap for {gov.name}. It will be reduced when applied.
          </Alert>
        )}

        <div className="rates-summary">
          <span>Tax <strong>{rates.tax}%</strong></span>
          <span>Science <strong>{rates.science}%</strong></span>
          <span>Luxury <strong>{rates.luxury}%</strong></span>
          <span className={sum === 100 ? 'rates-summary__ok' : 'rates-summary__bad'}>
            Total <strong>{sum}%</strong>
          </span>
        </div>

        <div className="rates-preview">
          <div className="rates-preview__title">Projected per turn</div>
          <div className="rates-preview__row">
            <span>Commerce: <strong>{preview.commerce}</strong></span>
            <span>Tax: <strong>+{preview.tax}</strong></span>
            <span>Science: <strong>+{preview.science}</strong></span>
            <span>Luxury: <strong>+{preview.luxury}</strong></span>
          </div>
          <div className="rates-preview__row">
            <span>Upkeep: <strong>−{preview.upkeep}</strong></span>
            <span>Treasury net: <strong className={preview.net < 0 ? 'text-danger' : ''}>{preview.net >= 0 ? '+' : ''}{preview.net}</strong></span>
            <span>Treasury: <strong>{currentPlayer?.resources?.gold ?? 0} 🪙</strong></span>
          </div>
          {!preview.hasCities && (
            <div className="rates-preview__hint">
              No cities yet — found a city with your settler to start generating commerce.
            </div>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer className="rates-modal__footer">
        <button type="button" className="rates-modal__btn" onClick={onHide}>
          Cancel
        </button>
        <button
          type="button"
          className="rates-modal__btn rates-modal__btn--apply"
          onClick={handleApply}
        >
          Apply Rates
        </button>
      </Modal.Footer>
    </Modal>
  );
}

export default RatesModal;
