import { Form } from "react-bootstrap";
import { useGameStore } from "@/stores/GameStore";
import GameModal from "./gamemodals/ModalShell";
import "../../styles/settingsModal.css";

interface SettingsModalProps {
  show: boolean;
  onHide: () => void;
}

function SettingsModal({ show, onHide }: SettingsModalProps) {
  const settings = useGameStore((state) => state.settings);
  const actions = useGameStore((state) => state.actions);

  const handleChange = (key, value) => {
    actions.updateSettings({
      [key]: parseFloat(value),
    });
  };

  const resetDefaults = () => {
    console.log("SettingsModal: Reset to Defaults clicked");
    actions.updateSettings({
      uiScale: 1.0,
      skipEndTurnConfirmation: false,
      autoEndTurn: false,
      autoCamera: true,
      devMode: false,
      enableAnimations: true,
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

  return (
    <GameModal
      show={show}
      onClose={onHide}
      tone="neutral"
      size="lg"
      dialogClassName="settings-modal"
      icon="⚙️"
      artLabel="options"
      eyebrow="Game Menu · Options"
      title="Settings"
      lede="Set the pace and the picture to taste — every switch takes effect the moment you move it, no clerk to ask."
      actions={
        <>
          <button
            type="button"
            className="touch-btn touch-btn--ghost settings-modal__reset"
            onClick={resetDefaults}
          >
            <span aria-hidden="true">🔄</span> Reset to Defaults
          </button>
          <button
            type="button"
            className="touch-btn touch-btn--primary settings-modal__apply"
            onClick={() => {
              console.log("SettingsModal: Apply & Close clicked");
              onHide();
            }}
          >
            <span aria-hidden="true">✓</span> Apply &amp; Close
          </button>
        </>
      }
    >
      <Form className="settings-form">
        {/* Master switches sit on top: they gate whole groups of controls
            below (animations gate the speed sliders). */}
        <section className="gm-section">
          <div className="gm-section-title">Campaign switches</div>
          <div className="settings-toggles">
            {toggle(
              "enableAnimations",
              "Enable animations",
              "enableAnimations",
              settings.enableAnimations,
              "Master switch for movement and combat cinematics.",
            )}
            {toggle(
              "autoCamera",
              "Auto-move camera",
              "autoCamera",
              settings.autoCamera !== false,
              "Sweep the view to whatever needs your eye.",
            )}
            {toggle(
              "autoEndTurn",
              "Auto-end turn",
              "autoEndTurn",
              settings.autoEndTurn,
              "Advance once every unit has moved.",
            )}
            {toggle(
              "skipEndTurnConfirmation",
              "Skip end-turn confirmation",
              "skipEndTurnConfirmation",
              settings.skipEndTurnConfirmation,
              "Take the turn the moment you press it.",
            )}
            {toggle(
              "devMode",
              "Developer mode",
              "devMode",
              settings.devMode,
              "Inspector's tools: the full world table and debug aids.",
            )}
          </div>
        </section>

        <section className="gm-section">
          <div className="gm-section-title">Picture</div>
          <div className="settings-grid settings-grid--single">
            {renderSlider(
              "Overall UI scale",
              settings.uiScale,
              0.5,
              2.0,
              0.1,
              "uiScale",
              "Grows or shrinks every panel, button and label (0.50x to 2.00x).",
              (v) => `${v.toFixed(2)}x`,
              false,
              "🖥️",
            )}
          </div>
        </section>

        <section className="gm-section">
          <div className="gm-section-title">Motion</div>
          <div className="settings-grid">
            {renderSlider(
              "Animation speed",
              settings.animationSpeed,
              0,
              3,
              0.1,
              "animationSpeed",
              "Your units and battles, leftmost is instant.",
              (v) => (v === 0 ? "Instant" : `${v.toFixed(1)}x`),
              !settings.enableAnimations,
              "🎬",
            )}

            {renderSlider(
              "Enemy animation speed",
              settings.enemyAnimationSpeed,
              0,
              3,
              0.1,
              "enemyAnimationSpeed",
              "Rival movement only — independent of your own units.",
              (v) => (v === 0 ? "Instant" : `${v.toFixed(1)}x`),
              !settings.enableAnimations,
              "👣",
            )}

            {renderSlider(
              "Camera glide speed",
              settings.cameraGlideSpeed,
              0,
              3,
              0.1,
              "cameraGlideSpeed",
              "How fast the view sweeps to a new focus, leftmost is instant.",
              (v) => (v === 0 ? "Instant" : `${v.toFixed(1)}x`),
              !settings.enableAnimations,
              "🎥",
            )}
          </div>
          {!settings.enableAnimations && (
            <div className="gm-note">
              Animations are switched off — these speeds take effect once you turn
              them back on.
            </div>
          )}
        </section>
      </Form>
    </GameModal>
  );
}

export default SettingsModal;
