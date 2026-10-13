import React from 'react';
import { Modal } from 'react-bootstrap';
import { useTranslation } from '@/i18n/useTranslation';
import { useGameStore } from '@/stores/GameStore';
import LeaderPortrait from '@/components/ui/LeaderPortrait';
import { LEADER_PORTRAITS, MOOD_COLORS } from '@/data/LeaderPortraits';
import { attitudeFromScore, type Attitude } from '@/game/engine/DiplomacyTypes';
import { tTechName } from '@/i18n/dataNames';
import { TECHNOLOGIES_DATA } from '@/data/TechnologyData';
import type { AudienceNotice, Civilization } from '../../../../types/game';
import type { TranslationKey } from '@/i18n';
import '../../../styles/audienceModal.css';

interface AudienceModalProps {
  show: boolean;
  notice: AudienceNotice | null;
  gameEngine?: { diplomacyManager?: DiplomacyManagerLike } | null;
  onAccept: () => void;
  onReject: () => void;
  onLeave: () => void;
}

/** The slice of the diplomacy manager the audience screen reads. */
interface DiplomacyManagerLike {
  getAttitudeScore?: (fromCivId: number, towardCivId: number) => number;
}

const techName = (techId: string): string =>
  tTechName(techId, TECHNOLOGIES_DATA.find((tech) => tech.id === techId)?.name ?? techId);

/**
 * The audience screen.
 *
 * When a diplomat is received by a rival — or when a rival's envoy arrives with
 * an offer of its own — the game leaves the map for this: a big pixel portrait
 * of the leader whose face is tuned to how they feel about you, a text field
 * where they speak, and one plain choice at the bottom.
 *
 * There is deliberately no way to pick which technology changes hands. Civ I
 * never let you shop in an audience either: the offer is whatever the other
 * court's personality and research decided it would be, and the only question
 * on the table is whether you take it.
 */
const AudienceModal: React.FC<AudienceModalProps> = ({
  show,
  notice,
  gameEngine,
  onAccept,
  onReject,
  onLeave,
}) => {
  const { t } = useTranslation();
  const civilizations = useGameStore((state) => state.civilizations);
  const playerId = useGameStore((state) => state.currentPlayer?.id ?? 0);

  if (!notice) return null;

  const civ: Civilization | undefined = civilizations[notice.civId];
  const leaderName = civ?.leader ?? '';
  const portraitConfig = LEADER_PORTRAITS[leaderName] ?? null;

  // The engine's opinion of us is what the face is tuned to — the same number
  // the attitude meter on the negotiation screen draws. Read in their
  // direction: how THEY feel about YOU.
  const dm = gameEngine?.diplomacyManager as DiplomacyManagerLike | undefined;
  const attitudeScore = dm?.getAttitudeScore?.(notice.civId, playerId) ?? 0;
  const attitude: Attitude = attitudeFromScore(attitudeScore);
  const moodColors = MOOD_COLORS[attitude] ?? MOOD_COLORS.neutral;

  const isTechExchange = notice.action === 'offer_tech_exchange';

  // A proposal's own term, in the player's language. The engine composes its
  // message in English, so anything that is not a tech swap is rebuilt from the
  // localized offer labels the negotiation screen already uses.
  const OFFER_LABELS: Record<string, string> = {
    propose_peace: t('gm.diplo.offer.peace' as TranslationKey),
    propose_ceasefire: t('gm.diplo.offer.ceasefire' as TranslationKey),
    propose_alliance: t('gm.diplo.offer.alliance' as TranslationKey),
    demand_tribute: t('gm.diplo.offer.tribute' as TranslationKey),
    offer_open_borders: t('gm.diplo.offer.openBorders' as TranslationKey),
    propose_trade_agreement: t('gm.diplo.offer.tradeAgreement' as TranslationKey),
    propose_mutual_defense: t('gm.diplo.offer.mutualDefense' as TranslationKey),
    propose_non_aggression: t('gm.diplo.offer.nonAggressionPact' as TranslationKey),
    propose_embargo: t('gm.diplo.offer.embargo' as TranslationKey),
    offer_tech_exchange: t('gm.diplo.offer.techExchange' as TranslationKey),
  };

  // The line the leader speaks. A tech exchange is rebuilt from the terms so
  // the sentence is the player's language rather than the engine's English; any
  // other proposal keeps the sentence its own court composed.
  //
  // `techOffered` is what THEY hand over (what the player receives) and
  // `techRequested` is what they want back — see DiplomacyManager.pickTechSwap.
  const termLabel = OFFER_LABELS[notice.action ?? ''] ?? '';
  const message = notice.mode === 'greeting'
    ? t('audience.noOffer' as TranslationKey, { leader: leaderName || t('gm.unknown' as TranslationKey) })
    : isTechExchange && notice.techOffered && notice.techRequested
      ? t('audience.offer.techExchange' as TranslationKey, {
        given: techName(notice.techOffered),
        wanted: techName(notice.techRequested),
      })
      : notice.goldAmount
        ? t('audience.offer.gold' as TranslationKey, { gold: notice.goldAmount })
        : termLabel
          ? `${t('gm.diplo.incoming.pre' as TranslationKey, { civ: civ?.name ?? t('gm.unknown' as TranslationKey) })} ${termLabel}`
          : notice.message ?? '';

  const acceptLabel = isTechExchange
    ? t('audience.acceptKnowledge' as TranslationKey)
    : t('audience.accept' as TranslationKey);

  return (
    <Modal
      show={show}
      onHide={onLeave}
      centered
      backdrop="static"
      keyboard={false}
      className="gm audience-modal"
      dialogClassName="audience-modal__dialog"
    >
      <div
        className="gm-body audience-modal__body"
        data-attitude={attitude}
        role="dialog"
        aria-modal="true"
        aria-labelledby="audience-modal-title"
      >
        {/* The face across the room. Big, pixel, and lit by their temper. */}
        <div className="audience-modal__stage">
          <div className="audience-modal__portrait" style={{ borderColor: moodColors.border }}>
            {portraitConfig ? (
              <LeaderPortrait
                config={portraitConfig}
                mood={attitude}
                size={190}
                leaderName={leaderName}
                expressive
              />
            ) : (
              <div className="audience-modal__portrait-placeholder" style={{ color: civ?.color || '#fff' }}>
                <span aria-hidden="true">{civ?.icon || '👤'}</span>
              </div>
            )}
          </div>
          <div className="audience-modal__ident">
            <div className="audience-modal__leader" id="audience-modal-title">
              {leaderName || t('gm.unknown' as TranslationKey)}
            </div>
            <div className="audience-modal__civ">
              {portraitConfig?.title
                || t('gm.diplo.leaderTitle' as TranslationKey, { civ: civ?.name ?? t('gm.unknown' as TranslationKey) })}
            </div>
            <span className="audience-modal__mood" style={{ color: moodColors.border, borderColor: moodColors.border }}>
              {t(`gm.diplo.attitude.${attitude}` as TranslationKey)}
            </span>
          </div>
        </div>

        {/* The speech field. Green when they are putting something on the
            table, grey for a formal audience with nothing to decide. */}
        <div className="audience-modal__speech" data-mode={notice.mode}>
          <div className="audience-modal__speaker">
            {leaderName || civ?.name || t('gm.unknown' as TranslationKey)}
            {' '}
            {t('audience.speakerTitle' as TranslationKey)}
          </div>
          <p className="audience-modal__text">{message}</p>
          {notice.mode === 'offer' && (
            <p className="audience-modal__hint">{t('audience.termsLocked' as TranslationKey)}</p>
          )}
        </div>

        <footer className="audience-modal__choices">
          {notice.mode === 'offer' ? (
            <>
              <button type="button" className="audience-choice audience-choice--accept" onClick={onAccept}>
                {acceptLabel}
              </button>
              <button type="button" className="audience-choice audience-choice--reject" onClick={onReject}>
                {t('audience.reject' as TranslationKey)}
              </button>
            </>
          ) : (
            <button type="button" className="audience-choice audience-choice--leave" onClick={onLeave}>
              {t('audience.leave' as TranslationKey)}
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
};

export default AudienceModal;
