import React from 'react';
import GameModal from './ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
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
  const { t } = useTranslation();

  if (!notice) return null;

  const attackerLabel = notice.attackerName || notice.attackerType;
  const defenderLabel = notice.defenderName || notice.defenderType;
  const aDefender = /^aeiouAEIOU/.test(defenderLabel) ? `an ${defenderLabel}` : `a ${defenderLabel}`;
  const title = humanWon
    ? (notice.cityName
      ? t('combat.title.storms', { unit: attackerLabel, city: notice.cityName })
      : t('combat.title.destroys', { unit: attackerLabel, defender: defenderLabel, defenderWithArticle: aDefender }))
    : (notice.cityName
      ? t('combat.title.cityLost', { city: notice.cityName })
      : t('combat.title.unitLost', {
        unit: attackerLabel,
        unitWithArticle: `${/^aeiouAEIOU/.test(attackerLabel) ? 'An' : 'A'} ${attackerLabel}`,
      }));

  const lede = humanWon
    ? (notice.cityName
      ? <>{t('combat.lede.cityWonBefore')}<strong>{notice.cityName}</strong>{t('combat.lede.cityWonAfter')}</>
      : <>{t('combat.lede.unitWon', { unit: attackerLabel })}</>)
    : (notice.cityName
      ? <>{t('combat.lede.cityLostBefore')}<strong>{notice.cityName}</strong>{t('combat.lede.cityLostAfter', { unit: attackerLabel })}</>
      : <>{t('combat.lede.unitLost', { unit: defenderLabel, col: notice.col, row: notice.row })}</>);

  return (
    <GameModal
      show={show}
      onClose={onContinue}
      size="lg"
      tone={humanWon ? 'success' : 'danger'}
      icon={humanWon ? '⚔️' : '🛡️'}
      artLabel={t('combat.artLabel')}
      dialogClassName="combat-report-modal"
      eyebrow={humanWon ? t('combat.eyebrowVictory', { stamp: stampLabel }) : t('combat.eyebrowDefeat', { stamp: stampLabel })}
      title={title}
      lede={lede}
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onCentre}>
            {t('combat.centre')}
          </button>
          <button
            type="button"
            className={humanWon ? 'touch-btn touch-btn--primary' : 'touch-btn touch-btn--danger'}
            onClick={onContinue}
            autoFocus
          >
            {humanWon ? t('combat.pressOn') : t('combat.rally')}
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
            {notice.attackerSurvived ? t('combat.hpLeft', { hp: notice.attackerHealthAfter }) : t('combat.destroyed')}
          </span>
        </div>
        <div className={`gm-stat${humanWon ? '' : ' gm-stat--accent'}`}>
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🛡️</span>
            {defenderLabel}
          </span>
          <span className="gm-stat-label">
            {notice.defenderSurvived ? t('combat.hpLeft', { hp: notice.defenderHealthAfter }) : t('combat.destroyed')}
          </span>
        </div>
      </div>

      <div className="gm-section">
        <div className="gm-section-title">{t('combat.roundByNumbers')}</div>
        <div className="gm-kv-grid">
          <div className="gm-kv">{t('combat.attacker')}<b>{attackerCivName ?? '—'}</b></div>
          <div className="gm-kv">{t('combat.defender')}<b>{defenderCivName ?? '—'}</b></div>
          <div className="gm-kv">{t('combat.damageDealt')}<b>{t('combat.hpValue', { hp: notice.attackerDamage })}</b></div>
          <div className="gm-kv">{t('combat.damageTaken')}<b>{t('combat.hpValue', { hp: notice.defenderDamage })}</b></div>
        </div>
      </div>

      <div className="gm-section">
        <div className="gm-section-title">{t('combat.whereHappened')}</div>
        <div className="gm-kv-grid">
          <div className="gm-kv">{t('combat.tile')}<b>({notice.col}, {notice.row})</b></div>
          <div className="gm-kv">{t('combat.ground')}<b>{terrainName ?? t('combat.unknown')}</b></div>
          {notice.cityName && <div className="gm-kv">{t('combat.city')}<b>{notice.cityName}</b></div>}
        </div>
      </div>

      {!humanWon && (
        <div className="gm-note">
          {t('combat.note')}
        </div>
      )}
    </GameModal>
  );
};

export default CombatReportModal;
