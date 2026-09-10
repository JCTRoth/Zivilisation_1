import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Alert } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { gameLogger } from '@/utils/GameLogger';
import { getGovernment } from '@/data/GovernmentData';
import { CITY_CENTER_COMMERCE } from '@/game/engine/EconomicManager';
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

  // Live preview of what the selected rates would produce. Uses the engine's
  // real tile-based commerce (EconomicManager.calculateCityTrade) per city, and
  // the split is floor-based per city (corruption is applied on the real turn,
  // so the preview is optimistic by that amount).
  const preview = useMemo(() => {
    if (!currentPlayer || !gameEngine) {
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, net: 0, hasCities: false };
    }
    const cities = (gameEngine.cities ?? []).filter(
      (c) => c.civilizationId === currentPlayer.id,
    );
    const econ = (gameEngine as { economicManager?: { calculateCityTrade: (c: unknown) => number } }).economicManager;
    const perCityCommerce = cities.map((c) =>
      econ && typeof econ.calculateCityTrade === 'function'
        ? econ.calculateCityTrade(c)
        : Math.max((c as { yields?: { trade?: number } }).yields?.trade ?? 0, CITY_CENTER_COMMERCE),
    );
    const commerce = perCityCommerce.reduce((t, v) => t + v, 0);
    // Match the engine's upkeep model: each city costs 1 gold and supports one
    // unit free, so total upkeep = max(unitCount, cityCount).
    const unitCount = (gameEngine.units ?? []).filter(
      (u) => u.civilizationId === currentPlayer.id,
    ).length;
    const upkeep = Math.max(unitCount, cities.length);
    const tax = perCityCommerce.reduce((t, v) => t + Math.floor((v * rates.tax) / 100), 0) * 2; // ×2 matches engine TRADE_GOLD_MULTIPLIER
    const rawScience = perCityCommerce.reduce((t, v) => t + Math.floor((v * rates.science) / 100), 0);
    // Apply the same beaker modifiers the engine uses (knownCivs + prerequisites)
    // so the preview shows EFFECTIVE research, not raw output.
    const researchMgr = (gameEngine as { researchManager?: { beakersApplied: (civ: unknown, tech: unknown, base: number) => number } }).researchManager;
    const currentTech = currentPlayer?.currentResearch ?? null;
    const science = researchMgr && typeof researchMgr.beakersApplied === 'function' && currentTech
      ? researchMgr.beakersApplied(currentPlayer, currentTech, rawScience)
      : rawScience;
    const luxury = perCityCommerce.reduce((t, v) => t + Math.floor((v * rates.luxury) / 100), 0);
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
