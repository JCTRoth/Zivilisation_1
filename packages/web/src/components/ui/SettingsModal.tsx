import { Form } from "react-bootstrap";
import { useGameStore } from "@/stores/GameStore";
import { useTranslation } from "@/i18n/useTranslation";
import type { LanguageId } from "@/i18n/languages";
import GameModal from "./gamemodals/ModalShell";
import LanguageSwitcher from "./LanguageSwitcher";
import "../../styles/settingsModal.css";

interface SettingsModalProps {
  show: boolean;
  onHide: () => void;
}

function SettingsModal({ show, onHide }: SettingsModalProps) {
  const settings = useGameStore((state) => state.settings);
  const actions = useGameStore((state) => state.actions);
  // Subscribes this modal to language changes: every label below re-renders
  // the moment the player picks another language in the switcher.
  const { t, languageDefinition } = useTranslation();

  const handleChange = (key, value) => {
    actions.updateSettings({
      [key]: parseFloat(value),
    });
  };

  const handleLanguageChange = (language: LanguageId) => {
    // updateSettings forwards to the i18n runtime, which persists the choice
    // and repaints the whole UI — including this modal — right away.
    actions.updateSettings({ language });
  };

  // Note on "Reset to Defaults": the language is deliberately NOT part of the
  // reset. It is a persistent player preference (like a save file), stored in
  // localStorage, not a tuning knob of the current session.
  const resetDefaults = () => {
    console.log("SettingsModal: Reset to Defaults clicked");
    actions.updateSettings({
      uiScale: 1.0,
      skipEndTurnConfirmation: false,
      skipGameResultScreen: false,
      autoEndTurn: false,
      autoCamera: true,
      devMode: false,
      enableAnimations: true,
      enableSoundEffects: true,
      enableBackgroundMusic: true,
      musicVolume: 0.4,
      animationSpeed: 1,
      enemyAnimationSpeed: 1,
      cameraGlideSpeed: 1,
    });
  };

  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    key: string,
    hint: string,
    format: (v: number) => string,
    disabled = false,
    icon = "",
  ) => (
    <div className="settings-control">
      <div className="settings-control__header">
        <Form.Label className="settings-control__label">
          <span aria-hidden="true">{icon}</span> {label}
        </Form.Label>
        <strong className="settings-control__value">{format(value)}</strong>
      </div>
      <Form.Range
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => handleChange(key, e.target.value)}
        className="settings-control__range"
        disabled={disabled}
      />
      <Form.Text className="settings-control__hint">{hint}</Form.Text>
    </div>
  );

  const toggle = (id: string, label: string, key: string, checked: boolean, hint: string) => (
    <div className="settings-toggle">
      <Form.Check
        type="switch"
        id={id}
        label={label}
        checked={checked}
        onChange={(e) => actions.updateSettings({ [key]: e.target.checked })}
        className="settings-control__toggle"
      />
      <span className="settings-toggle__hint">{hint}</span>
    </div>
  );

  const instant = t('settings.instant');

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="neutral"
      size="lg"
      dialogClassName="settings-modal"
      icon="⚙️"
      artLabel="options"
      eyebrow={t('settings.eyebrow')}
      title={t('settings.title')}
      lede={t('settings.lede')}
      actions={
        <>
          <button
            type="button"
            className="touch-btn touch-btn--ghost settings-modal__reset"
            onClick={resetDefaults}
          >
            <span aria-hidden="true">🔄</span> {t('common.resetDefaults')}
          </button>
          <button
            type="button"
            className="touch-btn touch-btn--primary settings-modal__apply"
            onClick={() => {
              console.log("SettingsModal: Apply & Close clicked");
              onHide();
            }}
          >
            <span aria-hidden="true">✓</span> {t('common.applyClose')}
          </button>
        </>
      }
    >
      <Form className="settings-form">
        {/* The language comes first: it is the one switch that changes every
            other word on this screen (and in the game) instantly. */}
        <section className="gm-section">
          <div className="gm-section-title">{t('settings.sectionLanguage')}</div>
          <LanguageSwitcher value={settings.language as LanguageId} onChange={handleLanguageChange} />
          <div className="gm-note settings-language-note">
            {t('settings.languageCurrent', { name: `${languageDefinition.flag} ${languageDefinition.nativeName}` })}
            {' — '}
            {t('settings.languageHint')}
          </div>
        </section>

        {/* Master switches sit on top: they gate whole groups of controls
            below (animations gate the speed sliders). */}
        <section className="gm-section">
          <div className="gm-section-title">{t('settings.sectionCampaign')}</div>
          <div className="settings-toggles">
            {toggle(
              "enableAnimations",
              t('settings.enableAnimations'),
              "enableAnimations",
              settings.enableAnimations,
              t('settings.enableAnimationsHint'),
            )}
            {toggle(
              "enableSoundEffects",
              t('settings.enableSoundEffects'),
              "enableSoundEffects",
              settings.enableSoundEffects !== false,
              t('settings.enableSoundEffectsHint'),
            )}
            {toggle(
              "autoCamera",
              t('settings.autoCamera'),
              "autoCamera",
              settings.autoCamera !== false,
              t('settings.autoCameraHint'),
            )}
            {toggle(
              "autoEndTurn",
              t('settings.autoEndTurn'),
              "autoEndTurn",
              settings.autoEndTurn,
              t('settings.autoEndTurnHint'),
            )}
            {toggle(
              "skipEndTurnConfirmation",
              t('settings.skipEndTurnConfirmation'),
              "skipEndTurnConfirmation",
              settings.skipEndTurnConfirmation,
              t('settings.skipEndTurnConfirmationHint'),
            )}
            {toggle(
              "skipGameResultScreen",
              t('settings.skipGameResultScreen'),
              "skipGameResultScreen",
              settings.skipGameResultScreen,
              t('settings.skipGameResultScreenHint'),
            )}
            {toggle(
              "devMode",
              t('settings.devMode'),
              "devMode",
              settings.devMode,
              t('settings.devModeHint'),
            )}
          </div>
        </section>

        <section className="gm-section">
          <div className="gm-section-title">{t('settings.sectionMusic')}</div>
          <div className="settings-toggles">
            {toggle(
              "enableBackgroundMusic",
              t('settings.enableBackgroundMusic'),
              "enableBackgroundMusic",
              settings.enableBackgroundMusic !== false,
              t('settings.enableBackgroundMusicHint'),
            )}
          </div>
          <div className="settings-grid settings-grid--single">
            {renderSlider(
              t('settings.musicVolume'),
              typeof settings.musicVolume === 'number' ? settings.musicVolume : 0.4,
              0,
              1,
              0.05,
              "musicVolume",
              t('settings.musicVolumeHint'),
              (v) => `${Math.round(v * 100)}%`,
              settings.enableBackgroundMusic === false,
              "🎵",
            )}
          </div>
          {settings.enableBackgroundMusic === false && (
            <div className="gm-note">{t('settings.musicOffNote')}</div>
          )}
        </section>

        <section className="gm-section">
          <div className="gm-section-title">{t('settings.sectionPicture')}</div>
          <div className="settings-grid settings-grid--single">
            {renderSlider(
              t('settings.uiScale'),
              settings.uiScale,
              0.5,
              2.0,
              0.1,
              "uiScale",
              t('settings.uiScaleHint'),
              (v) => `${v.toFixed(2)}x`,
              false,
              "🖥️",
            )}
          </div>
        </section>

        <section className="gm-section">
          <div className="gm-section-title">{t('settings.sectionMotion')}</div>
          <div className="settings-grid">
            {renderSlider(
              t('settings.animationSpeed'),
              settings.animationSpeed,
              0,
              3,
              0.1,
              "animationSpeed",
              t('settings.animationSpeedHint'),
              (v) => (v === 0 ? instant : `${v.toFixed(1)}x`),
              !settings.enableAnimations,
              "🎬",
            )}

            {renderSlider(
              t('settings.enemyAnimationSpeed'),
              settings.enemyAnimationSpeed,
              0,
              3,
              0.1,
              "enemyAnimationSpeed",
              t('settings.enemyAnimationSpeedHint'),
              (v) => (v === 0 ? instant : `${v.toFixed(1)}x`),
              !settings.enableAnimations,
              "👣",
            )}

            {renderSlider(
              t('settings.cameraGlideSpeed'),
              settings.cameraGlideSpeed,
              0,
              3,
              0.1,
              "cameraGlideSpeed",
              t('settings.cameraGlideSpeedHint'),
              (v) => (v === 0 ? instant : `${v.toFixed(1)}x`),
              !settings.enableAnimations,
              "🎥",
            )}
          </div>
          {!settings.enableAnimations && (
            <div className="gm-note">{t('settings.animationsOffNote')}</div>
          )}
        </section>
      </Form>
    </GameModal>
  );
}

export default SettingsModal;
