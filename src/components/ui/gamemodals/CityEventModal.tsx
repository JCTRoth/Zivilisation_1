import React from 'react';
import GameModal from './ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { CityEventNotice } from '../../../../types/game';

interface CityEventModalProps {
  show: boolean;
  notice: CityEventNotice | null;
  /** "Your Empire · Turn 12 · 3960 BC" — shared eyebrow stamp from the caller. */
  stampLabel: string;
  /** Name of the civilisation that took / razed / joined (resolved by the caller). */
  byCivName?: string;
  /** Terrain name of the city tile, resolved by the caller. */
  terrainName?: string;
  /** Id of the human civilisation — used to tell "taken from you" from "taken for you". */
  playerCivId: number;
  onContinue: () => void;
  onGoToCity: () => void;
}

/**
 * City events the human player is part of: a city founded or joined, one
 * captured (by or from the player), or razed to the ground. One component,
 * four voices — the tone, title and lede all follow `notice.kind`.
 */
const CityEventModal: React.FC<CityEventModalProps> = ({
  show,
  notice,
  stampLabel,
  byCivName,
  terrainName,
  playerCivId,
  onContinue,
  onGoToCity,
}) => {
  const { t } = useTranslation();

  if (!notice) return null;

  const ours = notice.byCivId === playerCivId || notice.kind === 'founded' || notice.kind === 'joined';
  // Civ names are plural ("the English", "the Aztecs") — read naturally.
  const byCiv = byCivName ? t('cityEvent.byCivNamed', { civ: byCivName }) : t('cityEvent.byCivRival');
  const isRazed = notice.kind === 'razed';
  const isFounded = notice.kind === 'founded';
  const isJoined = notice.kind === 'joined';

  const eyebrow = isFounded
    ? t('cityEvent.eyebrowFounded', { stamp: stampLabel })
    : isJoined
      ? t('cityEvent.eyebrowJoined', { stamp: stampLabel })
      : isRazed
        ? t('cityEvent.eyebrowRazed', { stamp: stampLabel })
        : t('cityEvent.eyebrowLost', { stamp: stampLabel });
  const title = isFounded
    ? t('cityEvent.title.founded', { city: notice.cityName })
    : isJoined
      ? t('cityEvent.title.joined', { city: notice.cityName })
      : isRazed
        ? t('cityEvent.title.razed', { city: notice.cityName })
        : ours
          ? t('cityEvent.title.yours', { city: notice.cityName })
          : t('cityEvent.title.fallen', { city: notice.cityName });

  const lede = isFounded ? (
    <>
      {t('cityEvent.lede.foundedBefore')}
      <strong>{notice.cityName}</strong>
      {t('cityEvent.lede.foundedAfter')}
    </>
  ) : isJoined ? (
    <>
      {t('cityEvent.lede.joinedBefore')}
      <strong>{notice.cityName}</strong>
      {t('cityEvent.lede.joinedAfter')}
    </>
  ) : isRazed ? (
    <>
      {t('cityEvent.lede.razedBefore')}
      <strong>{notice.cityName}</strong>
      {t('cityEvent.lede.razedAfter')}
    </>
  ) : ours ? (
    <>
      {t('cityEvent.lede.oursBefore')}
      <strong>{notice.cityName}</strong>
      {t('cityEvent.lede.oursAfter')}
    </>
  ) : (
    <>
      <strong>{notice.cityName}</strong>
      {t('cityEvent.lede.lostMid')}
      <strong>{byCiv}</strong>
      {t('cityEvent.lede.lostEnd')}
    </>
  );

  return (
    <GameModal
      show={show}
      onClose={onContinue}
      size="lg"
      tone={ours ? 'success' : 'danger'}
      icon={isFounded ? '🏗️' : isJoined ? '🤝' : isRazed ? '🔥' : '🏚️'}
      artLabel={ours ? t('cityEvent.artOurs') : t('cityEvent.artLost')}
      dialogClassName="city-event-modal"
      eyebrow={eyebrow}
      title={title}
      lede={lede}
      actions={
        <>
          <span className="gm-actions-spacer" />
          <button type="button" className="touch-btn touch-btn--ghost" onClick={onContinue}>
            {ours ? t('cityEvent.continue') : t('cityEvent.steady')}
          </button>
          {(isFounded || isJoined || ours) && (
            <button
              type="button"
              className="touch-btn touch-btn--primary"
              onClick={onGoToCity}
              autoFocus
            >
              {t('cityEvent.openCity')}
            </button>
          )}
        </>
      }
    >
      <div className="gm-stat-grid">
        <div className="gm-stat gm-stat--accent">
          <span className="gm-stat-value">
            <span className="gm-stat-icon" aria-hidden="true">🏘️</span>
            {notice.cityName}
          </span>
          <span className="gm-stat-label">{isRazed ? t('cityEvent.destroyed') : t('cityEvent.city')}</span>
        </div>
        {!isRazed && (
          <>
            <div className="gm-stat">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">👥</span>
                {notice.population}
              </span>
              <span className="gm-stat-label">{t('cityEvent.population')}</span>
            </div>
            <div className="gm-stat">
              <span className="gm-stat-value">
                <span className="gm-stat-icon" aria-hidden="true">🧭</span>
                ({notice.col}, {notice.row})
              </span>
              <span className="gm-stat-label">{terrainName ?? t('cityEvent.itsTile')}</span>
            </div>
          </>
        )}
      </div>

      <div className="gm-section">
        <div className="gm-section-title">
          {ours ? t('cityEvent.next') : t('cityEvent.meaning')}
        </div>
        {isFounded || isJoined || ours ? (
          <ul className="gm-list">
            <li>{t('cityEvent.listOpenCity')}</li>
            <li>{t('cityEvent.listGovernor')}</li>
            <li>{t('cityEvent.listIdle')}</li>
          </ul>
        ) : (
          <ul className="gm-list">
            <li>
              {t('cityEvent.listServeBefore')}
              <strong>{byCiv}</strong>
              {t('cityEvent.listServeAfter')}
            </li>
            <li>{t('cityEvent.listTakeBack')}</li>
            <li>{t('cityEvent.listGarrison')}</li>
          </ul>
        )}
      </div>

      {!ours && !isRazed && (
        <div className="gm-note">
          {t('cityEvent.noteLost')}
        </div>
      )}
      {isRazed && (
        <div className="gm-note">
          {t('cityEvent.noteRazed')}
        </div>
      )}
    </GameModal>
  );
};

export default CityEventModal;
