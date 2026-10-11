import React, { useEffect } from 'react';
import { getWonder } from '@/data/WonderData';
import { useGameStore } from '@/stores/GameStore';
import { GameUtils } from '@/utils/GameUtils';
import { WonderArtwork } from './WonderArtwork';
import GameModal from './ModalShell';
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

/** Documentation ages, the same labels the catalogue uses. */
const ERA_LABEL: Record<string, string> = {
  antiquity: 'Antiquity',
  middle: 'Middle Ages',
  industrial: 'Industrial & Modern Age',
};

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
  const lede = humanOwns
    ? `Stone by stone your masons have set the last block in ${notice.cityName}. The world holds a wonder of your making now, and the chronicles will keep your people's name long after your dynasty is dust.`
    : `${notice.civName} has set the last block in ${notice.cityName}. A rival owns a wonder of the world — read what it gives them before your scribes fall behind.`;

  return (
    <GameModal
      show={show}
      onClose={onContinue}
      tone="gold"
      size="lg"
      dialogClassName="wonder-completed-modal"
      eyebrow={<>A Wonder of the World · {yearLabel}</>}
      title={
        <>
          {wonder.icon} {wonder.name}
        </>
      }
      lede={lede}
      artSize="lg"
      artSrc={artSrc}
      artAlt={wonder.name}
      artLabel="wonder illustration"
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--primary" onClick={onContinue} autoFocus>
            Continue
          </button>
        </>
      }
    >
      {/* Artwork (credited; falls back to the emoji badge if the file is missing). */}
      <section className="gm-section">
        <h3 className="gm-section-title">Artwork</h3>
        <WonderArtwork wonder={wonder} active={show} />
      </section>

      <section className="gm-section">
        <h3 className="gm-section-title">At a glance</h3>
        <div className="gm-stat-grid">
          <div className="gm-stat gm-stat--accent">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                🛡
              </span>
              {wonder.cost}
            </span>
            <span className="gm-stat-label">Shields spent</span>
          </div>
          <div className="gm-stat">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                📜
              </span>
              {ERA_LABEL[wonder.era] ?? wonder.era}
            </span>
            <span className="gm-stat-label">Era</span>
          </div>
          <div className="gm-stat">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                {wonder.flag}
              </span>
              {wonder.location}
            </span>
            <span className="gm-stat-label">Site</span>
          </div>
          <div className="gm-stat">
            <span className="gm-stat-value">
              <span className="gm-stat-icon" aria-hidden="true">
                💰
              </span>
              None
            </span>
            <span className="gm-stat-label">Upkeep</span>
          </div>
        </div>
        <p className="gm-note">
          {humanOwns ? (
            <>
              Your people raised it in <strong>{notice.cityName}</strong> in {yearLabel}.
            </>
          ) : (
            <>
              <strong>{notice.civName}</strong> raised it in <strong>{notice.cityName}</strong> in {yearLabel}.
            </>
          )}
        </p>
      </section>

      <div className="gm-callout">
        <span className="gm-callout-title">Effect</span>
        {wonder.effectText}
      </div>

      <section className="gm-section">
        <h3 className="gm-section-title">Chronicle</h3>
        <p className="gm-prose">{wonder.flavor}</p>
      </section>
    </GameModal>
  );
};

export default WonderCompletedModal;
