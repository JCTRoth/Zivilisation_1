import React, { useEffect } from 'react';
import { getWonder } from '@/data/WonderData';
import { useGameStore } from '@/stores/GameStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { TranslationKey } from '@/i18n';
import { GameUtils } from '@/utils/GameUtils';
import { WonderArtwork } from './WonderArtwork';
import GameModal from './ModalShell';
import { localizedWonder } from '@/i18n/wonderLore';
import '@/styles/wonders.css';

/** The 'completed' variant of the wonder dialog queue entry. */
interface WonderCompletedNotice {
  kind: 'completed';
  wonderId: string;
  cityId: string;
  cityName: string;
  civId: number;
  civName: string;
  isHuman: boolean;
}

interface WonderCompletedModalProps {
  show: boolean;
  notice: WonderCompletedNotice | null;
  /** Continue button — dismisses this entry (or shows the next queued one). */
  onContinue: () => void;
}

/**
 * Celebration screen shown when a world wonder is completed — the single most
 * memorable moment of the wonder system, and the reason the wonder's full
 * mechanical effect is spelled out in plain language right here (players
 * forget what a wonder does 200 turns later).
 *
 * The hero carries the wonder's artwork as a badge; the credited plate from
 * `WonderArtwork` (Wikimedia attribution + Wikipedia link, emoji fallback when
 * the file is missing) sits directly under it, so no image ever appears
 * without its source.
 */
const WonderCompletedModal: React.FC<WonderCompletedModalProps> = ({ show, notice, onContinue }) => {
  const wonder = notice ? getWonder(notice.wonderId) : undefined;
  const currentYear = useGameStore((s) => s.gameState.currentYear);
  const { t } = useTranslation();

  // Confetti celebration while the screen is open (same lazy-loaded library
  // as the victory fireworks, so it is only fetched when actually needed).
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const celebrate = async () => {
      try {
        const module = await import('canvas-confetti');
        if (cancelled) return;
        const confetti = module.default;
        const end = Date.now() + 4000;
        const fire = () => {
          if (cancelled || Date.now() > end) return;
          confetti({
            particleCount: 110,
            spread: 85,
            startVelocity: 42,
            origin: { x: Math.random() * 0.6 + 0.2, y: 0.4 },
            colors: ['#ffd75e', '#ffe9a8', '#f7d417', '#ffffff'],
            scalar: 1.1,
          });
          timer = setTimeout(fire, 700 + Math.random() * 500);
        };
        fire();
      } catch {
        // Confetti is decoration — never block the screen if it fails to load.
      }
    };
    celebrate();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [show, notice?.wonderId]);

  if (!notice || !wonder) return null;

  const humanOwns = notice.isHuman;
  const yearLabel = GameUtils.formatYear(currentYear);
  const artSrc = `${import.meta.env.BASE_URL}${wonder.image}`;
  // Documentation ages, the same labels the catalogue uses.
  const eraLabel =
    wonder.era === 'antiquity'
      ? t('wonderDone.eraAntiquity' as TranslationKey)
      : wonder.era === 'middle'
        ? t('wonderDone.eraMiddle' as TranslationKey)
        : wonder.era === 'industrial'
          ? t('wonderDone.eraIndustrial' as TranslationKey)
          : wonder.era;
  const lede = humanOwns
    ? t('wonderDone.ledeOwn' as TranslationKey, { city: notice.cityName })
    : t('wonderDone.ledeRival' as TranslationKey, { civ: notice.civName, city: notice.cityName });

  return (
    <GameModal
      show={show}
      onClose={onContinue}
      tone="gold"
      size="lg"
      dialogClassName="wonder-completed-modal"
      eyebrow={t('wonderDone.eyebrow' as TranslationKey, { year: yearLabel })}
      title={
        <>
          {wonder.icon} {wonder.name}
        </>
      }
      lede={lede}
      artSize="lg"
      artSrc={artSrc}
      artAlt={wonder.name}
      artLabel={t('wonderDone.artLabel' as TranslationKey)}
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--primary" onClick={onContinue} autoFocus>
            {t('wonderDone.continue' as TranslationKey)}
          </button>
        </>
      }
    >
      {/* Artwork (credited; falls back to the emoji badge if the file is missing). */}
      <section className="gm-section">
        <h3 className="gm-section-title">{t('wonderDone.artwork' as TranslationKey)}</h3>
        <WonderArtwork wonder={wonder} active={show} />
      </section>

      <section className="gm-section">
        <h3 className="gm-section-title">{t('wonderDone.atAGlance' as TranslationKey)}</h3>
        <div className="gm-stat-grid">
          <div className="gm-stat gm-stat--accent">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                🛡
              </span>
              {wonder.cost}
            </span>
            <span className="gm-stat-label">{t('wonderDone.shieldsSpent' as TranslationKey)}</span>
          </div>
          <div className="gm-stat">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                📜
              </span>
              {eraLabel}
            </span>
            <span className="gm-stat-label">{t('wonderDone.era' as TranslationKey)}</span>
          </div>
          <div className="gm-stat">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                {wonder.flag}
              </span>
              {wonder.location}
            </span>
            <span className="gm-stat-label">{t('wonderDone.site' as TranslationKey)}</span>
          </div>
          <div className="gm-stat">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                💰
              </span>
              {t('wonderDone.upkeepNone' as TranslationKey)}
            </span>
            <span className="gm-stat-label">{t('wonderDone.upkeep' as TranslationKey)}</span>
          </div>
        </div>
        <p className="gm-note">
          {humanOwns ? (
            <>
              {t('wonderDone.noteOwnPre' as TranslationKey)}
              <strong>{notice.cityName}</strong>
              {t('wonderDone.noteYear' as TranslationKey, { year: yearLabel })}
            </>
          ) : (
            <>
              <strong>{notice.civName}</strong>
              {t('wonderDone.noteRivalMid' as TranslationKey)}
              <strong>{notice.cityName}</strong>
              {t('wonderDone.noteYear' as TranslationKey, { year: yearLabel })}
            </>
          )}
        </p>
      </section>

      <div className="gm-callout">
        <span className="gm-callout-title">{t('wonderDone.effect' as TranslationKey)}</span>
        {localizedWonder(wonder).effectText}
      </div>

      <section className="gm-section">
        <h3 className="gm-section-title">{t('wonderDone.chronicle' as TranslationKey)}</h3>
        <p className="gm-prose">{localizedWonder(wonder).flavor}</p>
      </section>
    </GameModal>
  );
};

export default WonderCompletedModal;
