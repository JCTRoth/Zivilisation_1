import { useTranslation } from '../../i18n/useTranslation';
import LanguageSwitcher from './LanguageSwitcher';
import BattleRoomStage from './BattleRoomStage';
import '../../styles/gameSetupModal.css';

interface WarRoomMenuProps {
  /** Enter the two-step game setup (nation, then table settings / friends). */
  onPlay: () => void;
  /** Open the shared options dialog over the council. */
  onSettings: () => void;
  /** Open the field manual over the council. */
  onHelp: () => void;
}

/**
 * The War Council hub — one door into the game.
 *
 * There is a single central server and no campaign library: choosing how to
 * play happens in setup step two (local table or a table with friends). The
 * hub therefore has exactly one primary action, plus settings and the field
 * manual. The battle-room stage is shared with the wizard and the lobby so
 * the whole pre-game flow still reads as one place.
 */
export default function WarRoomMenu({ onPlay, onSettings, onHelp }: WarRoomMenuProps) {
  const { t, language, setLanguage } = useTranslation();

  return (
    <div
      className="setup-screen war-room-menu"
      role="dialog"
      aria-modal="true"
      aria-label={t('warroom.aria')}
    >
      <BattleRoomStage />

      <div className="setup-screen__frame">
        <header className="setup-nameplate">
          <div className="setup-nameplate__left">
            <h2 className="modal-title">🏛️ Zivilisation 1</h2>
          </div>
          <div className="setup-nameplate__right">
            <LanguageSwitcher value={language} onChange={setLanguage} compact />
            <span className="setup-nameplate__tag">{t('warroom.tag')}</span>
          </div>
        </header>

        <div className="setup-screen__scroll war-menu__scroll">
          <header className="setup-hero war-menu__hero">
            <div className="setup-hero__eyebrow">{t('warroom.eyebrow')}</div>
            <p className="setup-hero__lede">{t('warroom.lede')}</p>
            <div className="setup-hero__rule" aria-hidden="true" />
          </header>

          <div className="setup-content">
            <div className="war-menu__grid war-menu__grid--single">
              <button
                type="button"
                className="war-menu__card war-menu__card--primary"
                onClick={onPlay}
                autoFocus
              >
                <span className="war-menu__seal" aria-hidden="true">⚔️</span>
                <span className="war-menu__copy">
                  <span className="war-menu__eyebrow">{t('warroom.newCampaignEyebrow')}</span>
                  <strong className="war-menu__title">{t('warroom.newCampaign')}</strong>
                  <span className="war-menu__lede">{t('warroom.newCampaignLede')}</span>
                </span>
                <span className="war-menu__cta">{t('warroom.newCampaignCta')}</span>
              </button>
            </div>

            <div className="war-menu__utilities">
              <button type="button" className="war-menu__utility" onClick={onSettings}>
                <span className="war-menu__utility-icon" aria-hidden="true">⚙️</span>
                <span>
                  <strong>{t('warroom.settings')}</strong>
                  <span className="war-menu__utility-hint">{t('warroom.settingsLede')}</span>
                </span>
              </button>
              <button type="button" className="war-menu__utility" onClick={onHelp}>
                <span className="war-menu__utility-icon" aria-hidden="true">📖</span>
                <span>
                  <strong>{t('warroom.help')}</strong>
                  <span className="war-menu__utility-hint">{t('warroom.helpLede')}</span>
                </span>
              </button>
            </div>
          </div>
        </div>

        <footer className="setup-footer war-menu__footer">
          <div className="setup-footer__selected">
            <span className="setup-footer__swatch war-menu__footer-dot" aria-hidden="true" />
            <span className="setup-footer__selected-label">{t('warroom.footerLabel')}</span>
            <span className="setup-footer__selected-value">{t('warroom.footerValue')}</span>
          </div>
          <div className="setup-footer__nav">
            <span className="war-menu__footer-note">{t('warroom.footerHint')}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
