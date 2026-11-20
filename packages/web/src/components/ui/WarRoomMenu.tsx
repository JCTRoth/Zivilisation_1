import { useTranslation } from '../../i18n/useTranslation';
import LanguageSwitcher from './LanguageSwitcher';
import BattleRoomStage from './BattleRoomStage';
import { GameUtils } from '../../utils/GameUtils';
import type { AutosaveMeta } from '../../utils/Autosave';
import '../../styles/gameSetupModal.css';

interface WarRoomMenuProps {
  /** Enter the single-player setup wizard. */
  onNewCampaign: () => void;
  /** Enter the multiplayer lobby (host / join a room). */
  onMultiplayer: () => void;
  /** Resume the campaign in the browser's autosave slot. */
  onContinue: () => void;
  /** Open the local campaign library. */
  onCampaigns: () => void;
  /** Open the shared options dialog over the council. */
  onSettings: () => void;
  /** Open the field manual over the council. */
  onHelp: () => void;
  /** Autosave metadata, or null when there is no campaign to resume. */
  autosave: AutosaveMeta | null;
}

/**
 * The War Council hub — the Battle-Room-styled front menu.
 *
 * Everything the player can do before taking the field lives here: start a
 * single-player campaign, open the multiplayer lobby, resume the campaign in
 * the browser's autosave slot, or open settings and the field manual. Sub
 * screens render inside this same 3D room, so the app reads as one place from
 * the first paint instead of a chain of unrelated dialogs.
 */
export default function WarRoomMenu({
  onNewCampaign,
  onMultiplayer,
  onContinue,
  onCampaigns,
  onSettings,
  onHelp,
  autosave,
}: WarRoomMenuProps) {
  const { t, language, setLanguage } = useTranslation();

  const continueMeta = autosave
    ? [
        autosave.civilizationName,
        t('common.turn', { turn: autosave.turn }),
        GameUtils.formatYear(autosave.year),
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

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
            <h3 className="setup-hero__title">{t('warroom.title')}</h3>
            <p className="setup-hero__lede">{t('warroom.lede')}</p>
            <div className="setup-hero__rule" aria-hidden="true" />
          </header>

          <div className="setup-content">
            <div className="war-menu__grid">
              <button
                type="button"
                className="war-menu__card war-menu__card--primary"
                onClick={onNewCampaign}
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

              <button
                type="button"
                className="war-menu__card"
                onClick={onMultiplayer}
              >
                <span className="war-menu__seal" aria-hidden="true">🌐</span>
                <span className="war-menu__copy">
                  <span className="war-menu__eyebrow">{t('warroom.multiplayerEyebrow')}</span>
                  <strong className="war-menu__title">{t('warroom.multiplayer')}</strong>
                  <span className="war-menu__lede">{t('warroom.multiplayerLede')}</span>
                </span>
                <span className="war-menu__cta">{t('warroom.multiplayerCta')}</span>
              </button>

              <button
                type="button"
                className="war-menu__card war-menu__card--continue"
                onClick={onContinue}
                disabled={!autosave}
              >
                <span className="war-menu__seal" aria-hidden="true">📜</span>
                <span className="war-menu__copy">
                  <span className="war-menu__eyebrow">{t('warroom.continueEyebrow')}</span>
                  <strong className="war-menu__title">{t('warroom.continue')}</strong>
                  <span className="war-menu__lede">
                    {autosave ? t('warroom.continueLede') : t('warroom.continueHint')}
                  </span>
                  {continueMeta && (
                    <span className="war-menu__meta">{continueMeta}</span>
                  )}
                </span>
                <span className="war-menu__cta">
                  {autosave ? t('warroom.continueCta') : t('warroom.continueEmptyCta')}
                </span>
              </button>
            </div>

            <div className="war-menu__utilities">
              <button type="button" className="war-menu__utility" onClick={onCampaigns}>
                <span className="war-menu__utility-icon" aria-hidden="true">🗄️</span>
                <span>
                  <strong>{t('warroom.campaigns')}</strong>
                  <span className="war-menu__utility-hint">{t('warroom.campaignsLede')}</span>
                </span>
              </button>
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
