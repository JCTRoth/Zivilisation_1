import GameModal from '../ModalShell';
import type { VillageResult } from '../../../../../types/game';

interface VillageGoldModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Valuable Metals" village outcome — the villagers gift a lump sum of gold
 * (Civ1: 25, 50, or 100).
 */
function VillageGoldModal({ result, onHide }: VillageGoldModalProps) {
  const gold = result.goldAmount ?? 50;
  return (
    <GameModal
      show
      onClose={onHide}
      tone="gold"
      icon="🪙"
      artLabel="a buried hoard"
      eyebrow="A Village Encounter"
      title="Valuable Metals"
      lede="The villagers kneel, bring out chests that have waited a hundred years in the earth, and lay them at your feet. Some of it is yours by right of passage."
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          Accept the Tribute
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🪙</span>+{gold}
          </span>
          <span className="gm-stat-label">Gold for your treasury</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">What the elders said</div>
        <p className="gm-prose mb-0">
          They have no use for it where they are going — and an empire that passes in peace is
          better than one that passes in pieces. Spend it well.
        </p>
      </div>
    </GameModal>
  );
}

export default VillageGoldModal;
