import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import '../../styles/hotseatHandoff.css';

interface HotseatHandoffScreenProps {
  playerName: string;
  leader: string;
  color: string;
  onReady: (dontShowAgain: boolean) => void;
}

/**
 * Hotseat hand-off screen — shown between human turns in hotseat mode.
 *
 * A full-screen opaque overlay that hides the map to prevent screen-peeking.
 * The next player sees their civ name/leader and clicks "I'm Ready" to take
 * the seat. The game resumes via `gameEngine.setPaused(false)`.
 */
export default function HotseatHandoffScreen({
  playerName,
  leader,
  color,
  onReady,
}: HotseatHandoffScreenProps) {
  const { t } = useTranslation();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <div
      className="hotseat-handoff"
      role="dialog"
      aria-modal="true"
      aria-label={t('hotseat.handoff.title')}
    >
      <div className="hotseat-handoff__backdrop" />
      <div className="hotseat-handoff__card">
        <div
          className="hotseat-handoff__banner"
          style={{ backgroundColor: color }}
        />
        <h2 className="hotseat-handoff__title">{t('hotseat.handoff.title')}</h2>
        <p className="hotseat-handoff__pass">{t('hotseat.handoff.passDevice')}</p>
        <div className="hotseat-handoff__player-info">
          <span className="hotseat-handoff__civ-name">{playerName}</span>
          {leader && (
            <span className="hotseat-handoff__leader">— {leader}</span>
          )}
        </div>
        <label className="hotseat-handoff__checkbox">
          <input
            type="checkbox"
            checked={dontShowAgain}
            onChange={(e) => setDontShowAgain(e.target.checked)}
          />
          <span>{t('hotseat.handoff.dontShowAgain')}</span>
        </label>
        <button
          type="button"
          className="hotseat-handoff__ready-btn"
          onClick={() => onReady(dontShowAgain)}
        >
          <span aria-hidden="true">🔴</span> {t('hotseat.handoff.ready')}
        </button>
      </div>
    </div>
  );
}
