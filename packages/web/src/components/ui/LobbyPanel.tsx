import { useState } from 'react';
import { DIFFICULTY_LEVELS } from '@shared/data/GameData';
import { useTranslation } from '../../i18n/useTranslation';
import { createRoomWithSeats, defaultGameServer, type LobbyResult } from '../../lobbyApi';
import BattleRoomStage from './BattleRoomStage';
import InviteLinks from './InviteLinks';
import LanguageSwitcher from './LanguageSwitcher';
import '../../styles/gameSetupModal.css';

interface LobbyPanelProps {
  defaultServer?: string;
  /** Return to the setup wizard — the screen the player came from. */
  onBack?: () => void;
}

/**
 * The multiplayer room, rendered full screen (`?lobby=…`): the host chooses
 * the size and difficulty of the campaign, creates an authoritative server
 * room, and receives one signed join link per seat. Joining a link boots the
 * normal remote client exactly as before.
 *
 * The setup wizard has its own path now — *Start a new game → online* creates
 * the room from the settings already on screen — so this screen is the
 * landing for a join link or the `?lobby=` shortcut, not a step of the wizard.
 */
export default function LobbyPanel({ defaultServer, onBack }: LobbyPanelProps) {
  const { t, language, setLanguage } = useTranslation();
  // The game server is discovered from runtime config — a player never has to
  // know a URL or a port.
  const server = defaultServer ?? defaultGameServer();
  const [seats, setSeats] = useState(2);
  const [difficulty, setDifficulty] = useState('PRINCE');
  const [result, setResult] = useState<LobbyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  /**
   * The table itself: host form, the seat links once a room exists, and the
   * three-step explanation. The page chrome around it (stage, nameplate,
   * hero, footer) is what makes this the standalone room.
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
        <InviteLinks
          result={result}
          seats={Array.from({ length: seats }, (_, seat) => seat)}
          hint={t('warroom.roomReadyHint')}
        />
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
