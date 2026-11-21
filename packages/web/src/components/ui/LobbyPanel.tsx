import { useState } from 'react';
import { DIFFICULTY_LEVELS } from '@shared/data/GameData';
import { useTranslation } from '../../i18n/useTranslation';
import { createRoomWithSeats, joinUrl, type LobbyResult } from '../../lobbyApi';
import BattleRoomStage from './BattleRoomStage';
import LanguageSwitcher from './LanguageSwitcher';
import '../../styles/gameSetupModal.css';

interface LobbyPanelProps {
  defaultServer?: string;
  /** Return to the War Council hub. */
  onBack?: () => void;
  /**
   * Contribute only the table — host form, seat links, explanation — with no
   * room chrome of its own. The setup wizard renders the lobby this way so
   * "Play online" happens inside step two instead of opening another page.
   */
  inline?: boolean;
}

/**
 * Multiplayer lobby, rendered as a table inside the War Council room.
 *
 * A host chooses the size and difficulty of the campaign, creates an
 * authoritative server room, and receives one signed join link per seat.
 * Joining a link boots the normal remote client exactly as before; this screen
 * only replaces the bare Bootstrap card that used to be the lobby's whole
 * presentation.
 *
 * Two shapes: the standalone room (`?lobby=…`, `setupView`) with its own
 * nameplate, hero and footer, and `inline` inside the setup wizard's step two.
 */
export default function LobbyPanel({ defaultServer, onBack, inline = false }: LobbyPanelProps) {
  const { t, language, setLanguage } = useTranslation();
  // The game server is discovered from runtime config — a player never has to
  // know a URL or a port. It stays visible in the advanced disclosure below
  // for operators and debugging.
  const server = defaultServer
    ?? globalThis.window?.__CIV1_CONFIG__?.gameServer
    ?? import.meta.env.VITE_GAME_SERVER
    ?? 'http://localhost:8787';
  const [seats, setSeats] = useState(2);
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [result, setResult] = useState<LobbyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedSeat, setCopiedSeat] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  /** Hide API codes and stack fragments; show players a next step instead. */
  const describeError = (cause: unknown): string => {
    const raw = String(cause);
    if (/ROOM_CREATE_FAILED|SEAT_MINT_FAILED/.test(raw)) return t('warroom.errorCreate');
    if (/Failed to fetch|NetworkError|ECONNREFUSED|Load failed/i.test(raw)) return t('warroom.errorConnect');
    return t('warroom.errorUnknown');
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await createRoomWithSeats(
        server,
        {
          seed: undefined,
          numberOfCivilizations: Math.max(2, seats),
          difficulty,
        },
        Array.from({ length: seats }, (_, i) => i),
      ));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const copyJoinUrl = async (seat: number) => {
    if (!result) return;
    const url = joinUrl(result, seat);
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.href).toString());
      setCopiedSeat(seat);
      window.setTimeout(() => setCopiedSeat((current) => (current === seat ? null : current)), 1800);
    } catch {
      setError(t('warroom.copyFailed'));
    }
  };

  const copyAllInvites = async () => {
    if (!result) return;
    const links = Array.from({ length: seats }, (_, seat) =>
      new URL(joinUrl(result, seat), window.location.href).toString());
    try {
      await navigator.clipboard.writeText(links.join('\n'));
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1800);
    } catch {
      setError(t('warroom.copyFailed'));
    }
  };

  /**
   * The table itself: host form, the seat links once a room exists, and the
   * three-step explanation. This is the part that has to work both as the
   * standalone room (page chrome around it) and inline inside the setup
   * wizard, where it replaces the local-only settings of step two.
   */
  const sections = (
    <>
      <section className="gm-section war-lobby__host" aria-labelledby="war-lobby-host-title">
        <div className="gm-section-title" id="war-lobby-host-title">
          {t('warroom.hostSection')}
        </div>
        <div className="war-lobby__form">
          <label className="setup-setting">
            <span className="setup-setting__label">
              {t('warroom.seats')} <span className="setup-setting__value">{seats}</span>
            </span>
            <input
              type="range"
              min={2}
              max={7}
              className="setup-setting__control"
              value={seats}
              onChange={(e) => setSeats(Math.max(2, Math.min(7, Number(e.target.value))))}
              disabled={busy}
            />
            <span className="setup-setting__hint">{t('warroom.seatsHint')}</span>
          </label>

          <label className="setup-setting">
            <span className="setup-setting__label">{t('warroom.difficulty')}</span>
            <select
              className="setup-setting__control war-lobby__input"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              disabled={busy}
            >
              {Object.entries(DIFFICULTY_LEVELS).map(([id, data]) => (
                <option key={id} value={id}>{data.name}</option>
              ))}
            </select>
            <span className="setup-setting__hint">{t('warroom.difficultyHint')}</span>
          </label>
        </div>

        <div className="war-lobby__actions">
          <button
            type="button"
            className="touch-btn touch-btn--primary war-lobby__create"
            onClick={() => void create()}
            disabled={busy}
          >
            <span aria-hidden="true">⚔️</span>{' '}
            {busy ? t('warroom.creating') : t('warroom.createRoom')}
          </button>
        </div>

        {error && <div className="war-lobby__error" role="alert">{error}</div>}
      </section>

      {result && (
        <section className="gm-section war-lobby__result" aria-labelledby="war-lobby-result-title">
          <div className="gm-section-title" id="war-lobby-result-title">
            {t('warroom.roomReady')}
          </div>
          <p className="war-lobby__result-lede">{t('warroom.roomReadyHint')}</p>
          <div className="war-lobby__seats">
            {Array.from({ length: seats }, (_, seat) => (
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
                  onClick={() => void copyJoinUrl(seat)}
                >
                  {copiedSeat === seat ? t('warroom.copied') : t('warroom.copy')}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="touch-btn touch-btn--ghost war-lobby__copy-all"
            onClick={() => void copyAllInvites()}
          >
            {copiedAll ? t('warroom.allCopied') : t('warroom.copyAll')}
          </button>
        </section>
      )}

      <section className="gm-section war-lobby__guide" aria-labelledby="war-lobby-guide-title">
        <div className="gm-section-title" id="war-lobby-guide-title">
          {t('warroom.howItWorks')}
        </div>
        <ol className="war-lobby__steps">
          <li>{t('warroom.stepHost')}</li>
          <li>{t('warroom.stepShare')}</li>
          <li>{t('warroom.stepOrders')}</li>
        </ol>
      </section>
    </>
  );

  // Inside the setup wizard the room is a step of its own flow, not a page
  // swap: the wizard keeps its own nameplate, hero and command bar, so only
  // the table is contributed here (as siblings of the wizard's own
  // `.setup-content` children, hence no wrapper div).
  if (inline) return sections;

  return (
    <div
      className="setup-screen war-room-lobby"
      role="dialog"
      aria-modal="true"
      aria-label={t('warroom.lobbyAria')}
    >
      <BattleRoomStage />

      <div className="setup-screen__frame">
        <header className="setup-nameplate">
          <div className="setup-nameplate__left">
            {onBack && (
              <button
                type="button"
                className="setup-nameplate__back"
                onClick={onBack}
                aria-label={t('warroom.backToCouncil')}
              >
                <span aria-hidden="true">←</span> {t('warroom.council')}
              </button>
            )}
            <h2 className="modal-title">🏛️ Zivilisation 1</h2>
          </div>
          <div className="setup-nameplate__right">
            <LanguageSwitcher value={language} onChange={setLanguage} compact />
            <span className="setup-nameplate__tag">{t('warroom.tag')}</span>
          </div>
        </header>

        <div className="setup-screen__scroll war-lobby__scroll">
          <header className="setup-hero war-lobby__hero">
            <div className="setup-hero__eyebrow">{t('warroom.lobbyEyebrow')}</div>
            <h3 className="setup-hero__title">{t('warroom.lobbyTitle')}</h3>
            <p className="setup-hero__lede">{t('warroom.lobbyLede')}</p>
            <div className="setup-hero__rule" aria-hidden="true" />
          </header>

          {sections}
        </div>

        <footer className="setup-footer war-lobby__footer">
          <div className="setup-footer__selected">
            <span className="setup-footer__swatch war-menu__footer-dot" aria-hidden="true" />
            <span className="setup-footer__selected-label">{t('warroom.footerLabel')}</span>
            <span className="setup-footer__selected-value">{t('warroom.multiplayer')}</span>
          </div>
          <div className="setup-footer__nav">
            {onBack && (
              <button
                type="button"
                className="touch-btn touch-btn--ghost setup-footer__button"
                onClick={onBack}
              >
                {t('warroom.backToCouncil')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
