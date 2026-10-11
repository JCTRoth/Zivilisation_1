import GameModal from '../ModalShell';
import type { VillageResult } from '../../../../../types/game';

interface VillageTechModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Scroll of Ancient Wisdom" village outcome — an instant free technology.
 */
function VillageTechModal({ result, onHide }: VillageTechModalProps) {
  const techName = result.techName ?? result.techId ?? 'a new technology';
  return (
    <GameModal
      show
      onClose={onHide}
      tone="solemn"
      icon="📜"
      artLabel="the scroll chamber"
      eyebrow="A Village Encounter"
      title="Scroll of Ancient Wisdom"
      lede="In a hut of reed and mud lies a language your own scholars cannot read. The elders hand it over without a word — knowledge asks no price here."
      actions={
        <button type="button" className="touch-btn touch-btn--primary" onClick={onHide}>
          Take the Scroll
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🔬</span>
            {techName}
          </span>
          <span className="gm-stat-label">Known at once, for free</span>
        </div>
      </div>
      <div className="gm-section">
        <div className="gm-section-title">What your scholars make of it</div>
        <p className="gm-prose mb-0">
          Your academy had not finished writing the question, and the answer has already arrived.
          Every year of research this saves is a year your rivals do not have.
        </p>
      </div>
    </GameModal>
  );
}

export default VillageTechModal;
