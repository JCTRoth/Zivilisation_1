import React, { useEffect, useState } from 'react';
import { UNIT_PROPERTIES } from '@/data/UnitConstants';
import { formatCombatStat, unitRankBadge, unitStatus } from '@/utils/UnitStatus';
import { useGameStore } from '@/stores/GameStore';
import { GameUtils } from '@/utils/GameUtils';
import { useTranslation } from '@/i18n/useTranslation';
import GameModal from '@/components/ui/gamemodals/ModalShell';
import '@/styles/unitRank.css';
import '@/styles/unitStackModal.css';
import type { City, Unit } from '../../../types/game';

/**
 * Unit stack modal — shown when the player clicks a city or a field holding
 * several of their units. Lists every unit with its status and health and lets
 * the player either
 *   - activate ONE unit (click its row / "Select"), or
 *   - tick 0..N units and confirm a group move: the next map click orders
 *     every selected unit that still has movement points to that destination.
 *
 * Built on the shared modal shell: the hero says *where* this stack stands,
 * the cards below carry the facts, and group move / city details live in the
 * action bar where the thumb already is.
 */
interface UnitStackModalProps {
  show: boolean;
  col: number;
  row: number;
  units: Unit[];
  city?: City | null;
  onSelectUnit: (unitId: string) => void;
  onConfirmGroup: (unitIds: string[]) => void;
  onShowCity?: (cityId: string) => void;
  onClose: () => void;
}

const UnitStackModal: React.FC<UnitStackModalProps> = ({
  show,
  col,
  row,
  units,
  city,
  onSelectUnit,
  onConfirmGroup,
  onShowCity,
  onClose,
}) => {
  const { t } = useTranslation();
  const [checked, setChecked] = useState<string[]>([]);
  const currentTurn = useGameStore((state) => state.gameState.currentTurn);
  const currentYear = useGameStore((state) => state.gameState.currentYear);

  // Fresh selection whenever the modal opens for a tile.
  useEffect(() => {
    if (show) setChecked([]);
  }, [show, col, row]);

  const movable = units.filter((u) => (u.movesRemaining || 0) > 0 && !u.isDefeated);
  const checkedMovable = checked.filter((id) => movable.some((u) => u.id === id));

  const toggle = (id: string) => {
    setChecked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <GameModal
      show={show}
      onClose={onClose}
      tone="info"
      size="lg"
      dialogClassName="unit-stack-modal"
      icon="⚔️"
      artLabel={t('stack.artLabel')}
      eyebrow={t('stack.eyebrow', {
        turn: currentTurn ?? 1,
        year: GameUtils.formatYear(currentYear ?? -4000),
      })}
      title={city ? t('stack.titleCity', { col, row, city: city.name }) : t('stack.title', { col, row })}
      lede={t('stack.lede')}
      actions={
        <>
          {city && onShowCity && (
            <button
              type="button"
              className="touch-btn touch-btn--ghost"
              onClick={() => {
                onShowCity(city.id);
                onClose();
              }}
            >
              <i className="bi bi-building" aria-hidden="true"></i> {t('stack.cityDetails')}
            </button>
          )}
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onClose}>
            {t('stack.close')}
          </button>
          <button
            type="button"
            className="touch-btn touch-btn--primary"
            disabled={checkedMovable.length === 0}
            title={
              checkedMovable.length === 0
                ? t('stack.moveHintNone')
                : t('stack.moveHintPick')
            }
            onClick={() => onConfirmGroup(checkedMovable)}
          >
            {t('stack.moveSelected', { count: checkedMovable.length })}
          </button>
        </>
      }
    >
      <section className="gm-section">
        <div className="gm-section-title">{t('stack.whoStands')}</div>
        <div className="gm-kv-grid">
          <div className="gm-kv">{t('stack.units')}<b>{units.length}</b></div>
          <div className="gm-kv">{t('stack.ready')}<b>{movable.length}</b></div>
          <div className="gm-kv">{t('stack.ground')}<b>({col}, {row})</b></div>
          <div className="gm-kv">{t('stack.cityLabel')}<b>{city?.name ?? t('stack.openField')}</b></div>
        </div>
        <p className="gm-note">
          {t('stack.note')}
        </p>
      </section>

      <section className="gm-section">
        <div className="gm-section-title">{t('stack.orderOfBattle')}</div>
        <div className="usm-toolbar">
          <button
            type="button"
            className="touch-btn touch-btn--ghost usm-tool"
            disabled={movable.length === 0}
            onClick={() => setChecked(movable.map((u) => u.id))}
          >
            <i className="bi bi-check2-square" aria-hidden="true"></i> {t('stack.allMovable', { count: movable.length })}
          </button>
          <button
            type="button"
            className="touch-btn touch-btn--ghost usm-tool"
            disabled={checked.length === 0}
            onClick={() => setChecked([])}
          >
            <i className="bi bi-x-square" aria-hidden="true"></i> {t('stack.clear')}
          </button>
          <span className="gm-chip usm-count">{t('stack.selected', { count: checkedMovable.length })}</span>
        </div>

        <div className="usm-list">
          {units.map((unit) => {
            const props = UNIT_PROPERTIES[unit.type];
            const status = unitStatus(unit);
            const rankBadge = unitRankBadge(unit);
            const health = Math.max(0, Math.min(100, unit.health ?? 100));
            const hpText = typeof unit.hitPoints === 'number' && typeof unit.maxHitPoints === 'number'
              ? t('stack.hp', { hp: unit.hitPoints, max: unit.maxHitPoints })
              : t('stack.hpPercent', { hp: Math.round(health) });
            const isChecked = checked.includes(unit.id);
            const canMove = (unit.movesRemaining || 0) > 0 && !unit.isDefeated;
            // Effective combat stats: base × rank multiplier, so the numbers
            // here match what CombatSystem actually rolls with.
            const rankMult = rankBadge?.multiplier ?? 1;
            const effAttack = formatCombatStat((props?.attack ?? 0) * rankMult);
            const effDefense = formatCombatStat((props?.defense ?? 0) * rankMult);
            const maxMoves = unit.maxMoves ?? unit.movement;
            const movesText = typeof maxMoves === 'number'
              ? t('stack.moves', { moves: unit.movesRemaining ?? 0, max: maxMoves })
              : t('stack.movesOnly', { moves: unit.movesRemaining ?? 0 });
            const hpBand = health > 60 ? 'high' : health > 30 ? 'mid' : 'low';
            return (
              <div
                key={unit.id}
                className={`usm-row${isChecked ? ' usm-row--checked' : ''}`}
                onClick={() => onSelectUnit(unit.id)}
                title={t('stack.activate')}
              >
                <input
                  type="checkbox"
                  className="usm-check"
                  checked={isChecked}
                  disabled={!canMove}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggle(unit.id)}
                  aria-label={t('stack.selectAria', { type: unit.type })}
                />

                <span className="usm-icon" aria-hidden="true">
                  {unit.icon || props?.icon || '⚔️'}
                </span>

                <div className="usm-main">
                  <div className="usm-line">
                    <strong className="usm-name">{props?.name ?? unit.type}</strong>
                    {rankBadge && (
                      <span className={rankBadge.className} title={rankBadge.title}>
                        {rankBadge.label}
                      </span>
                    )}
                    <span className="gm-chip usm-status" data-variant={status.variant}>
                      {status.label}
                    </span>
                  </div>
                  <div className="usm-line usm-line--meta">
                    <span className="usm-hpbar" aria-hidden="true">
                      <span className={`usm-hpbar-fill usm-hpbar-fill--${hpBand}`} style={{ width: `${health}%` }} />
                    </span>
                    <span className="usm-hp">{hpText}</span>
                    <span className="usm-moves">{movesText}</span>
                    <span
                      className="usm-combat"
                      title={
                        rankBadge
                          ? t('stack.combatTitle', {
                            attack: props?.attack ?? 0,
                            defense: props?.defense ?? 0,
                            multiplier: rankBadge.multiplier,
                          })
                          : undefined
                      }
                    >
                      {t('stack.combatStat', { attack: effAttack, defense: effDefense })}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="touch-btn touch-btn--ghost usm-select"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectUnit(unit.id);
                  }}
                >
                  {t('stack.select')}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </GameModal>
  );
};

export default UnitStackModal;
