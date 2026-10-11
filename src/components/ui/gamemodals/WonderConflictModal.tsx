import React from 'react';
import { getWonder } from '@/data/WonderData';
import GameModal from './ModalShell';
import '@/styles/wonders.css';

/** The 'conflict' variant of the wonder dialog queue entry. */
interface WonderConflictNotice {
  kind: 'conflict';
  wonderId: string;
  cityId: string;
  cityName: string;
  ownerCityId: string;
  ownerCityName: string;
  ownerCivId: number;
  ownerCivName: string;
  /** Completed group member that won, when this was a group loss. */
  blockedByWonderId?: string;
  blockedByWonderName?: string;
}

interface WonderConflictModalProps {
  show: boolean;
  notice: WonderConflictNotice | null;
  /** Center the map on the idle city and open its city screen. */
  onGoToCity: (cityId: string) => void;
  /** Plain close. */
  onClose: () => void;
}

/**
 * Production conflict popup (spec D): a human city finished a wonder that
 * somebody else completed first. Civ 1 wastes the shields and leaves the city
 * idle — this modal says exactly that, names the winner, and offers
 * "Go to City" / "Close".
 */
const WonderConflictModal: React.FC<WonderConflictModalProps> = ({ show, notice, onGoToCity, onClose }) => {
  if (!notice) return null;
  const wonder = getWonder(notice.wonderId);
  // Group loss (e.g. Tiangong while the ISS exists): name the wonder that
  // actually won instead of claiming the attempted one was completed.
  const won = notice.blockedByWonderId && notice.blockedByWonderId !== notice.wonderId
    ? (getWonder(notice.blockedByWonderId) ?? wonder)
    : wonder;
  const wonName = won?.name ?? 'the wonder';

  return (
    <GameModal
      show={show}
      onClose={onClose}
      tone="danger"
      dialogClassName="wonder-conflict-modal"
      eyebrow="A Wonder Slips Away"
      title={
        <>
          {won?.icon ?? '🏗️'} {wonName} — already completed
        </>
      }
      lede="Another people set the final stone first. Only one of each wonder may ever stand in the world, and this one is not yours."
      icon={won?.icon ?? '🏗️'}
      artLabel="wonder art"
      actions={
        <>
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="touch-btn touch-btn--primary" onClick={() => onGoToCity(notice.cityId)}>
            <i className="bi bi-geo-alt" aria-hidden="true" /> Go to City
          </button>
        </>
      }
    >
      <div className="gm-callout">
        <span className="gm-callout-title">Shields spent, nothing raised</span>
        Production in <strong>{notice.cityName}</strong> has been cancelled and the city sits idle. The shields
        already poured into the work are lost — first completion wins, the original Civ 1 rule.
      </div>

      <section className="gm-section">
        <h3 className="gm-section-title">Who got there first</h3>
        <div className="gm-kv-grid gm-kv-grid--stack">
          <div className="gm-kv">
            Winner <b>{notice.ownerCivName} — {notice.ownerCityName}</b>
          </div>
          <div className="gm-kv">
            Wonder they finished <b>{wonName}</b>
          </div>
          <div className="gm-kv">
            Your idle city <b>{notice.cityName}</b>
          </div>
        </div>
      </section>

      <p className="gm-note">
        <strong>What to do next:</strong> open <strong>{notice.cityName}</strong> and give it new production. The
        shields are gone either way, so the sooner that city works again the smaller the setback.
      </p>
    </GameModal>
  );
};

export default WonderConflictModal;
