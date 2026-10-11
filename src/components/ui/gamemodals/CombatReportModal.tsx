import React from 'react';
import GameModal from './ModalShell';
import type { CombatReportNotice } from '../../../../types/game';

interface CombatReportModalProps {
  show: boolean;
  notice: CombatReportNotice | null;
  /** "Germans · Turn 12 · 3960 BC" — shared eyebrow stamp built by the caller. */
  stampLabel: string;
  /** Names of the two civilisations, resolved by the caller. */
  attackerCivName?: string;
  defenderCivName?: string;
  /** Terrain name of the tile the fight ended on. */
  terrainName?: string;
  /** True when the human player won the round (their unit survived). */
  humanWon: boolean;
  onContinue: () => void;
  onCentre: () => void;
}

/**
 * Battle report — shown once a decisive round has destroyed a unit and the
 * human player was on one side of it. Non-lethal rounds stay toasts; AI
 * battles the player is not part of never reach this screen.
 */
const CombatReportModal: React.FC<CombatReportModalProps> = ({
  show,
  notice,
  stampLabel,
  attackerCivName,
  defenderCivName,
  terrainName,
  humanWon,
  onContinue,
  onCentre,
}) => {
  if (!notice) return null;

  const attackerLabel = notice.attackerName || notice.attackerType;
  const defenderLabel = notice.defenderName || notice.defenderType;
  const aDefender = /^aeiouAEIOU/.test(defenderLabel) ? `an ${defenderLabel}` : `a ${defenderLabel}`;
  const title = humanWon
    ? (notice.cityName
      ? `${attackerLabel} storms ${notice.cityName}`
      : `${attackerLabel} destroys ${aDefender}`)
    : (notice.cityName
      ? `${notice.cityName} could not hold`
      : `${/^aeiouAEIOU/.test(attackerLabel) ? 'An' : 'A'} ${attackerLabel} was lost`);

  const lede = humanWon
    ? (notice.cityName
      ? <>Your men broke the line at <strong>{notice.cityName}</strong>. The tile is yours now — if anyone still stands on it.</>
      : <>Your {attackerLabel} closed the distance and finished the fight. The field belongs to you.</>)
    : (notice.cityName
      ? <>The defenders of <strong>{notice.cityName}</strong> held — and your {attackerLabel} paid for the attempt.</>
      : <>Your {defenderLabel} was cut down at ({notice.col}, {notice.row}). The survivors fell back through the smoke.</>);

  return (
    <GameModal
      show={show}
      onClose={onContinue}
      size="lg"
      tone={humanWon ? 'success' : 'danger'}
      icon={humanWon ? '⚔️' : '🛡️'}
      artLabel="the field of battle"
      dialogClassName="combat-report-modal"
      eyebrow={`${humanWon ? 'Victory' : 'Defeat'} · ${stampLabel}`}
      title={title}
      lede={lede}
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onCentre}>
            Centre on Battle
          </button>
          <button
            type="button"
            className={humanWon ? 'touch-btn touch-btn--primary' : 'touch-btn touch-btn--danger'}
            onClick={onContinue}
            autoFocus
          >
            {humanWon ? 'Press On' : 'Rally the Survivors'}
          </button>
        </>
      }
    >
      <div className="gm-stat-grid">
        <div className={`gm-stat${humanWon ? ' gm-stat--accent' : ''}`}>
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">⚔️</span>
            {attackerLabel}
          </span>
          <span className="gm-stat-label">
            {notice.attackerSurvived ? `${notice.attackerHealthAfter} HP left` : 'Destroyed'}
          </span>
        </div>
        <div className={`gm-stat${humanWon ? '' : ' gm-stat--accent'}`}>
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🛡️</span>
            {defenderLabel}
          </span>
          <span className="gm-stat-label">
            {notice.defenderSurvived ? `${notice.defenderHealthAfter} HP left` : 'Destroyed'}
          </span>
        </div>
      </div>

      <div className="gm-section">
        <div className="gm-section-title">The round, by the numbers</div>
        <div className="gm-kv-grid">
          <div className="gm-kv">Attacker: <b>{attackerCivName ?? '—'}</b></div>
          <div className="gm-kv">Defender: <b>{defenderCivName ?? '—'}</b></div>
          <div className="gm-kv">Damage dealt: <b>{notice.attackerDamage} HP</b></div>
          <div className="gm-kv">Damage taken: <b>{notice.defenderDamage} HP</b></div>
        </div>
      </div>

      <div className="gm-section">
        <div className="gm-section-title">Where it happened</div>
        <div className="gm-kv-grid">
          <div className="gm-kv">Tile: <b>({notice.col}, {notice.row})</b></div>
          <div className="gm-kv">Ground: <b>{terrainName ?? 'Unknown'}</b></div>
          {notice.cityName && <div className="gm-kv">City: <b>{notice.cityName}</b></div>}
        </div>
      </div>

      {!humanWon && (
        <div className="gm-note">
          A unit that falls is gone for good. Fortify before you attack next time — a fortified
          defender on favourable ground is a far harder nut to crack.
        </div>
      )}
    </GameModal>
  );
};

export default CombatReportModal;
