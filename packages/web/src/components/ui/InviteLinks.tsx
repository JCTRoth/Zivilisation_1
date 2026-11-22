import { useId, useState } from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import { joinUrl, type LobbyResult } from '../../lobbyApi';

interface InviteLinksProps {
  result: LobbyResult;
  /** Seats that get a link — the game's human seats. */
  seats: number[];
  /** Section heading; defaults to the room-ready title. */
  title?: string;
  /** One line under the heading. */
  hint?: string;
}

/**
 * The room-ready panel: one signed invitation per seat, copyable one at a
 * time or all at once.
 *
 * Shared by the setup wizard (a room it just created from the player's own
 * settings) and the standalone lobby, so both hand out identical links.
 */
export default function InviteLinks({ result, seats, title, hint }: InviteLinksProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const [copiedSeat, setCopiedSeat] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const linkFor = (seat: number): string =>
    new URL(joinUrl(result, seat), window.location.href).toString();

  const copySeat = async (seat: number): Promise<void> => {
    try {
      await navigator.clipboard.writeText(linkFor(seat));
      setCopiedSeat(seat);
      window.setTimeout(() => setCopiedSeat((current) => (current === seat ? null : current)), 1800);
    } catch {
      // The link itself is right there, selectable — no toast needed.
    }
  };

  const copyAll = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(seats.map((seat) => linkFor(seat)).join('\n'));
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      // Same: every link is on screen already.
    }
  };

  return (
    <section className="gm-section war-lobby__result" aria-labelledby={headingId}>
      <div className="gm-section-title" id={headingId}>{title ?? t('warroom.roomReady')}</div>
      {hint && <p className="war-lobby__result-lede">{hint}</p>}
      <div className="war-lobby__seats">
        {seats.map((seat) => (
          <div key={seat} className="war-lobby__seat">
            <a
              href={joinUrl(result, seat)}
              className="war-lobby__seat-link"
              target="_blank"
              rel="noreferrer"
            >
              <span className="war-lobby__seat-number" aria-hidden="true">
                {seat === 0 ? '♛' : seat + 1}
              </span>
              <span>
                <strong>{t('warroom.joinSeat', { n: seat })}</strong>
                <span className="war-lobby__seat-role">
                  {seat === 0 ? t('warroom.hostSeat') : t('warroom.guestSeat', { n: seat })}
                </span>
              </span>
            </a>
            <button
              type="button"
              className="war-lobby__copy"
              onClick={() => void copySeat(seat)}
            >
              {copiedSeat === seat ? t('warroom.copied') : t('warroom.copy')}
            </button>
          </div>
        ))}
      </div>
      {seats.length > 1 && (
        <button
          type="button"
          className="touch-btn touch-btn--ghost war-lobby__copy-all"
          onClick={() => void copyAll()}
        >
          {copiedAll ? t('warroom.allCopied') : t('warroom.copyAll')}
        </button>
      )}
    </section>
  );
}
