import React, { useEffect } from 'react';
import GameModal from './ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import { playSfx, type SfxCue } from '@/utils/Sfx';
import type { CityEventNotice } from '../../../../types/game';
import '../../../styles/cityCaptureModal.css';

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
  /** Former owner of a captured city, for the banner that is lowered. */
  fromCivName?: string;
  fromCivColor?: string;
  fromCivIcon?: string;
  /**
   * The conquest march, resolved by the caller from the game year. Played
   * when the dialog OPENS — the fanfare belongs to the news, and the news
   * arrives here, turns after the city actually fell.
   */
  captureCue?: SfxCue | null;
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
  fromCivName,
  fromCivColor,
  fromCivIcon,
  captureCue,
  onContinue,
  onGoToCity,
}) => {
  const { t } = useTranslation();

  // The conquest march sounds when the dialog opens — only for a city the
  // player TOOK (a victory march over your own fall would be the wrong news
  // twice over), and never twice for the same opening.
  useEffect(() => {
    const conquest = show && notice?.kind === 'captured' && notice?.byCivId === playerCivId;
    if (conquest && captureCue) playSfx(captureCue);
  }, [show, notice, captureCue, playerCivId]);

  if (!notice) return null;

  const ours = notice.byCivId === playerCivId || notice.kind === 'founded' || notice.kind === 'joined';
  // Civ names are plural ("the English", "the Aztecs") — read naturally.
  const byCiv = byCivName ? t('cityEvent.byCivNamed', { civ: byCivName }) : t('cityEvent.byCivRival');
  const isRazed = notice.kind === 'razed';
  const isFounded = notice.kind === 'founded';
  const isJoined = notice.kind === 'joined';
  const isCaptured = notice.kind === 'captured';
  /** A city the player TOOK, as opposed to one taken from them. */
  const isConquest = isCaptured && ours;
  /**
   * The banner coming down over a conquered city: the former owner's colour
   * and device, lowered on its pole. Absent when the flag is the player's own
   * (a city that joined or was founded raises a new one instead).
   */
  const showFlag = isCaptured && !!fromCivColor && fromCivName !== undefined
    && notice.fromCivId !== playerCivId;

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

      {/* The enemy banner coming down off the walls. Pure CSS: a pole, a flag
          in the fallen civ's colour, and one slow slide. */}
      {showFlag && (
        <div
          className="city-event-flag"
          role="img"
          aria-label={t('cityEvent.captured.flagLabel', {
            civ: fromCivName ?? '',
            city: notice.cityName,
          })}
        >
          <span className="city-event-flag__pole" aria-hidden="true" />
          <span
            className="city-event-flag__banner"
            style={{ background: fromCivColor }}
            aria-hidden="true"
          >
            <span className="city-event-flag__device">{fromCivIcon ?? ''}</span>
          </span>
          <span className="city-event-flag__caption" aria-hidden="true">
            {fromCivName}
          </span>
        </div>
      )}

      {/* Spoils of war: the libraries are plundered for one technology the
          fallen civ knew and the conqueror did not. */}
      {isConquest && notice.techName && (
        <div className="gm-callout city-event-plunder">
          📜 {t('cityEvent.captured.plunder', { tech: notice.techName })}
        </div>
      )}

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
