import React, { useEffect, useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { gameLogger } from '@/utils/GameLogger';
import { sendCommand, isCommandRejection } from '@/utils/session';
import { getGovernment } from '@/data/GovernmentData';
import { GameUtils } from '@/utils/GameUtils';
import GameEngine from '@/game/engine/GameEngine';
import GameModal from './ModalShell';
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
 * proportionally over the other two. Applying sends a SET_RATES command
 * through the session — the engine re-derives the split and enforces the
 * government's caps.
 */
function RatesModal({ show, onHide, gameEngine }: RatesModalProps) {
  const actions = useGameStore((state) => state.actions);
  const currentPlayer = useGameStore(
    (state) => state.civilizations[state.gameState.activePlayer] || null,
  );
  const gameState = useGameStore((state) => state.gameState);
  const cities = useGameStore((state) => state.cities);

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
  const myCities = currentPlayer
    ? cities.filter((c) => c.civilizationId === currentPlayer.id)
    : [];

  // Live preview: delegate to EconomicManager.previewEconomy() — the single
  // source of truth for commerce → corruption → disorder → rate split → upkeep.
  const preview = useMemo(() => {
    if (!currentPlayer || !gameEngine) {
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, net: 0, hasCities: false };
    }
    const econ = gameEngine.economicManager;
    if (!econ) {
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, net: 0, hasCities: false };
    }
    const base = econ.previewEconomy(currentPlayer, rates);
    // Cap science through the research manager (beaker modifiers, 4-turn
    // min / 32-turn max) so the displayed number matches what actually
    // gets added to the current tech.
    const currentTech = currentPlayer.currentResearch ?? null;
    const researchMgr = gameEngine.researchManager;
    const science = researchMgr && currentTech
      ? researchMgr.perTurnProgress(currentPlayer, currentTech, base.science)
      : base.science;
    return { ...base, science };
  }, [rates, currentPlayer, gameEngine]);

  const handleApply = async (): Promise<void> => {
    if (currentPlayer && gameEngine) {
      // The command layer authorises the acting seat; the engine still applies
      // the government's caps when it re-derives the split.
      const result = await sendCommand({
        type: 'SET_RATES',
        tax: rates.tax,
        science: rates.science,
        luxury: rates.luxury,
      });
      if (!isCommandRejection(result)) {
        actions.updateCivilizations([...(gameEngine.civilizations ?? [])]);
        gameLogger.record('RATES_CHANGED', {
          civilizationId: currentPlayer.id,
          taxRate: rates.tax,
          scienceRate: rates.science,
          luxuryRate: rates.luxury,
        });
      } else {
        actions.addNotification({
          type: 'warning',
          message: 'Cannot change rates right now.',
        });
      }
    }
    onHide();
  };

  const renderSlider = (
    key: RateKey,
    label: string,
    icon: string,
    hint: string,
  ): React.ReactElement => (
    <div className="rates-control">
      <div className="rates-control__header">
        <Form.Label className="rates-control__label">
          <span aria-hidden="true">{icon}</span> {label} rate
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

  const statTile = (
    icon: string,
    value: React.ReactNode,
    label: string,
    extraClass = '',
  ): React.ReactElement => (
    <div className={`gm-stat${extraClass ? ` ${extraClass}` : ''}`}>
      <div className="gm-stat-value">
        <span className="gm-stat-icon" aria-hidden="true">{icon}</span>
        {value}
      </div>
      <div className="gm-stat-label">{label}</div>
    </div>
  );

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="gold"
      size="lg"
      dialogClassName="rates-modal"
      icon="🪙"
      artLabel="tax ledger"
      eyebrow={`${currentPlayer?.name ?? 'Your Empire'} · Turn ${gameState.currentTurn ?? 1} · ${GameUtils.formatYear(gameState.currentYear ?? -4000)}`}
      title="Tax, Science & Luxury Rates"
      lede="Every coin your people earn is split three ways. Nudge one slider and the other two share what is left — the three always add up to 100%."
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
            Cancel
          </button>
          <button type="button" className="touch-btn touch-btn--primary" onClick={handleApply}>
            Apply Rates
          </button>
        </>
      }
    >
      <section className="gm-section">
        <div className="gm-section-title">Your government's terms</div>
        <div className="gm-kv-grid">
          <div className="gm-kv">Government: <b>{gov.name}</b></div>
          <div className="gm-kv">Tax cap: <b>{gov.maxTaxRate}%</b></div>
          <div className="gm-kv">Cities: <b>{myCities.length}</b></div>
          <div className="gm-kv">Treasury: <b>{currentPlayer?.resources?.gold ?? 0} 🪙</b></div>
        </div>
        {gov.forcesZeroRates && (
          <div className="gm-callout">
            <span className="gm-callout-title">Under anarchy</span>
            All three rates are pinned at 0% until a new government takes power.
          </div>
        )}
      </section>

      <section className="gm-section">
        <div className="gm-section-title">Set the split</div>
        <div className="rates-controls">
          {renderSlider('tax', 'Tax', '🪙', 'Commerce becomes treasury gold, which pays for your units and cities.')}
          {renderSlider('science', 'Science', '🔬', 'Commerce becomes research, carrying you toward your next advance.')}
          {renderSlider('luxury', 'Luxury', '🎭', 'Commerce buys contentment — the surest cure for a city on the edge of disorder.')}
        </div>
        {taxOverCap && (
          <div className="gm-callout">
            <span className="gm-callout-title">Over the cap</span>
            {gov.name} allows at most {gov.maxTaxRate}% tax. Trim the slider yourself,
            or the engine will cut your {rates.tax}% down to the cap when you apply.
          </div>
        )}
      </section>

      <section className="gm-section">
        <div className="gm-section-title">The tally</div>
        <div className="rates-summary">
          <span>Tax <strong>{rates.tax}%</strong></span>
          <span>Science <strong>{rates.science}%</strong></span>
          <span>Luxury <strong>{rates.luxury}%</strong></span>
          <span className={sum === 100 ? 'rates-summary__ok' : 'rates-summary__bad'}>
            Total <strong>{sum}%</strong>
          </span>
        </div>
        <div className="gm-note">
          Move one slider and the remainder is shared out between the other two,
          so <strong>Total</strong> always settles back on 100%.
        </div>
      </section>

      <section className="gm-section">
        <div className="gm-section-title">Projected per turn</div>
        <div className="gm-stat-grid">
          {statTile('🌊', preview.commerce, 'Commerce', 'gm-stat--accent')}
          {statTile('🪙', `+${preview.tax}`, 'Tax')}
          {statTile('🔬', `+${preview.science}`, 'Science')}
          {statTile('🎭', `+${preview.luxury}`, 'Luxury')}
          {statTile('⚒️', `−${preview.upkeep}`, 'Upkeep')}
          {statTile(
            '📈',
            `${preview.net >= 0 ? '+' : ''}${preview.net}`,
            'Treasury net',
            preview.net < 0 ? 'rates-stat--negative' : '',
          )}
        </div>
        {!preview.hasCities && (
          <div className="gm-note">
            You hold no city yet — found one with your settler and the commerce will start flowing.
          </div>
        )}
      </section>
    </GameModal>
  );
}

export default RatesModal;
