import GameModal from '../ModalShell';
import type { VillageResult } from '../../../../../types/game';

interface VillageBarbarianModalProps {
  result: VillageResult;
  onHide: () => void;
}

/**
 * "Barbarian Ambush" village outcome — the hut reveals a hostile barbarian
 * village: 1–3 barbarians spawn in adjacent tiles and attack immediately.
 */
function VillageBarbarianModal({ result, onHide }: VillageBarbarianModalProps) {
  const count = result.barbarianCount ?? 0;
  return (
    <GameModal
      show
      onClose={onHide}
      tone="danger"
      icon="🐎"
      artLabel="dust on the ridge"
      eyebrow="A Village Encounter"
      title="Barbarian Ambush!"
      lede="The hut was a baited trap. The doorways spill riders who were waiting for exactly your kind of curiosity — and they are already at your throats."
      actions={
        <button type="button" className="touch-btn touch-btn--danger" onClick={onHide}>
          To Arms!
        </button>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">⚔️</span>
            {count} {count === 1 ? 'barbarian' : 'barbarians'}
          </span>
          <span className="gm-stat-label">Rising from the huts</span>
        </div>
      </div>
      <div className="gm-callout">
        <span className="gm-callout-title">They strike at once</span>
        The attackers spawn on the tiles around the village and open the fight immediately. Pull
        your unit back to defensible ground if you can — a river, a forest, a hill — and let them
        come to you.
      </div>
    </GameModal>
  );
}

export default VillageBarbarianModal;
