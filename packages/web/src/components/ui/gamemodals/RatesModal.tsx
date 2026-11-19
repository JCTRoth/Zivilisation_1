import React, { useEffect, useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';
import { gameLogger } from '@/utils/GameLogger';
import { sendCommand, isCommandRejection } from '@/utils/session';
import { getGovernment } from '@/data/GovernmentData';
import { GameUtils } from '@/utils/GameUtils';
import GameEngine from '@/game/engine/GameEngine';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
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
  const { t } = useTranslation();
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
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, debtService: 0, net: 0, hasCities: false };
    }
    const econ = gameEngine.economicManager;
    if (!econ) {
      return { commerce: 0, tax: 0, science: 0, luxury: 0, upkeep: 0, debtService: 0, net: 0, hasCities: false };
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
          message: t('rates.cannotChange' as TranslationKey),
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
          <span aria-hidden="true">{icon}</span> {t('rates.rateLabel' as TranslationKey, { label })}
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
        aria-label={t('rates.rateLabel' as TranslationKey, { label })}
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
      artLabel={t('rates.artLabel' as TranslationKey)}
      eyebrow={t('rates.eyebrow' as TranslationKey, {
        civ: currentPlayer?.name ?? t('rates.defaultEmpire' as TranslationKey),
        turn: gameState.currentTurn ?? 1,
        year: GameUtils.formatYear(gameState.currentYear ?? -4000),
      })}
      title={t('rates.title' as TranslationKey)}
      lede={t('rates.lede' as TranslationKey)}
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onHide}>
            {t('rates.cancel' as TranslationKey)}
          </button>
          <button type="button" className="touch-btn touch-btn--primary" onClick={handleApply}>
            {t('rates.apply' as TranslationKey)}
          </button>
        </>
      }
    >
      <section className="gm-section">
        <div className="gm-section-title">{t('rates.govTerms' as TranslationKey)}</div>
        <div className="gm-kv-grid">
          <div className="gm-kv">{t('rates.kvGovernment' as TranslationKey)} <b>{gov.name}</b></div>
          <div className="gm-kv">{t('rates.kvTaxCap' as TranslationKey)} <b>{gov.maxTaxRate}%</b></div>
          <div className="gm-kv">{t('rates.kvCities' as TranslationKey)} <b>{myCities.length}</b></div>
          <div className="gm-kv">{t('rates.kvTreasury' as TranslationKey)} <b>{currentPlayer?.resources?.gold ?? 0} 🪙</b></div>
        </div>
        {gov.forcesZeroRates && (
          <div className="gm-callout">
            <span className="gm-callout-title">{t('rates.anarchyTitle' as TranslationKey)}</span>
            {t('rates.anarchyBody' as TranslationKey)}
          </div>
        )}
      </section>

      <section className="gm-section">
        <div className="gm-section-title">{t('rates.setSplit' as TranslationKey)}</div>
        <div className="rates-controls">
          {renderSlider('tax', t('rates.label.tax' as TranslationKey), '🪙', t('rates.hint.tax' as TranslationKey))}
          {renderSlider('science', t('rates.label.science' as TranslationKey), '🔬', t('rates.hint.science' as TranslationKey))}
          {renderSlider('luxury', t('rates.label.luxury' as TranslationKey), '🎭', t('rates.hint.luxury' as TranslationKey))}
        </div>
        {taxOverCap && (
          <div className="gm-callout">
            <span className="gm-callout-title">{t('rates.overCapTitle' as TranslationKey)}</span>
            {t('rates.overCapBody' as TranslationKey, {
              gov: gov.name,
              cap: gov.maxTaxRate,
              tax: rates.tax,
            })}
          </div>
        )}
      </section>

      <section className="gm-section">
        <div className="gm-section-title">{t('rates.tally' as TranslationKey)}</div>
        <div className="rates-summary">
          <span>{t('rates.label.tax' as TranslationKey)} <strong>{rates.tax}%</strong></span>
          <span>{t('rates.label.science' as TranslationKey)} <strong>{rates.science}%</strong></span>
          <span>{t('rates.label.luxury' as TranslationKey)} <strong>{rates.luxury}%</strong></span>
          <span className={sum === 100 ? 'rates-summary__ok' : 'rates-summary__bad'}>
            {t('rates.summaryTotal' as TranslationKey)} <strong>{sum}%</strong>
          </span>
        </div>
        <div className="gm-note">
          {t('rates.noteSplitPre' as TranslationKey)}
          <strong>{t('rates.summaryTotal' as TranslationKey)}</strong>
          {t('rates.noteSplitPost' as TranslationKey)}
        </div>
      </section>

      <section className="gm-section">
        <div className="gm-section-title">{t('rates.projected' as TranslationKey)}</div>
        <div className="gm-stat-grid">
          {statTile('🌊', preview.commerce, t('rates.stat.commerce' as TranslationKey), 'gm-stat--accent')}
          {statTile('🪙', `+${preview.tax}`, t('rates.label.tax' as TranslationKey))}
          {statTile('🔬', `+${preview.science}`, t('rates.label.science' as TranslationKey))}
          {statTile('🎭', `+${preview.luxury}`, t('rates.label.luxury' as TranslationKey))}
          {statTile('⚒️', `−${preview.upkeep}`, t('rates.stat.upkeep' as TranslationKey))}
          {preview.debtService > 0 && statTile(
            '🏦',
            `−${preview.debtService}`,
            t('rates.stat.debt' as TranslationKey),
          )}
          {statTile(
            '📈',
            `${preview.net >= 0 ? '+' : ''}${preview.net}`,
            t('rates.stat.net' as TranslationKey),
            preview.net < 0 ? 'rates-stat--negative' : '',
          )}
        </div>
        {!preview.hasCities && (
          <div className="gm-note">
            {t('rates.noCities' as TranslationKey)}
          </div>
        )}
      </section>
    </GameModal>
  );
}

export default RatesModal;
