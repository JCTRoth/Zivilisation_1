import { Modal, Button, Form } from "react-bootstrap";
import { useGameStore } from "@/stores/GameStore";
import "../../styles/settingsModal.css";

function SettingsModal({ show, onHide }) {
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
  ) => (
    <div className="settings-control">
      <div className="settings-control__header">
        <Form.Label className="settings-control__label">{label}</Form.Label>
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

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered
      size="lg"
      fullscreen="lg-down"
      dialogClassName="settings-modal"
    >
      <Modal.Header closeButton className="settings-modal__header">
        <Modal.Title className="settings-modal__title">
          <span aria-hidden="true">⚙️</span> Settings
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="settings-modal__body">
        <Form className="settings-form">
          {/* Master switches sit on top: they gate whole groups of controls
              below (animations gate the speed sliders). */}
          <div className="settings-toggles">
            <Form.Check
              type="switch"
              id="enableAnimations"
              label="Enable animations"
              checked={settings.enableAnimations}
              onChange={(e) =>
                actions.updateSettings({ enableAnimations: e.target.checked })
              }
              className="settings-control__toggle"
            />

            <Form.Check
              type="switch"
              id="autoCamera"
              label="Auto-move camera"
              checked={settings.autoCamera !== false}
              onChange={(e) =>
                actions.updateSettings({ autoCamera: e.target.checked })
              }
              className="settings-control__toggle"
            />

            <Form.Check
              type="switch"
              id="autoEndTurn"
              label="Auto-end turn"
              checked={settings.autoEndTurn}
              onChange={(e) =>
                actions.updateSettings({ autoEndTurn: e.target.checked })
              }
              className="settings-control__toggle"
            />

            <Form.Check
              type="switch"
              id="skipEndTurnConfirmation"
              label="Skip end-turn confirmation"
              checked={settings.skipEndTurnConfirmation}
              onChange={(e) =>
                actions.updateSettings({ skipEndTurnConfirmation: e.target.checked })
              }
              className="settings-control__toggle"
            />

            <Form.Check
              type="switch"
              id="devMode"
              label="Developer mode"
              checked={settings.devMode}
              onChange={(e) =>
                actions.updateSettings({ devMode: e.target.checked })
              }
              className="settings-control__toggle"
            />
          </div>

          <div className="settings-grid">
          {renderSlider(
            "Overall UI Scale",
            settings.uiScale,
            0.5,
            2.0,
            0.1,
            "uiScale",
            "Scales all UI elements proportionally (0.5x to 2.0x)",
            (v) => `${v.toFixed(2)}x`,
          )}

          {renderSlider(
            "Animation Speed",
            settings.animationSpeed,
            0,
            3,
            0.1,
            "animationSpeed",
            "How fast units move and combat plays (leftmost = instant)",
            (v) => (v === 0 ? "Instant" : `${v.toFixed(1)}x`),
            !settings.enableAnimations,
          )}

          {renderSlider(
            "Enemy Animation Speed",
            settings.enemyAnimationSpeed,
            0,
            3,
            0.1,
            "enemyAnimationSpeed",
            "How fast enemy (AI) units move, independent of your own units (leftmost = instant)",
            (v) => (v === 0 ? "Instant" : `${v.toFixed(1)}x`),
            !settings.enableAnimations,
          )}

          {renderSlider(
            "Camera Glide Speed",
            settings.cameraGlideSpeed,
            0,
            3,
            0.1,
            "cameraGlideSpeed",
            "How fast the camera pans to a new focus (leftmost = instant)",
            (v) => (v === 0 ? "Instant" : `${v.toFixed(1)}x`),
            !settings.enableAnimations,
          )}
          </div>
        </Form>
      </Modal.Body>
      <Modal.Footer className="settings-modal__footer">
        <Button
          variant="warning"
          onClick={resetDefaults}
          className="touch-btn settings-modal__reset"
        >
          <span aria-hidden="true">🔄</span> Reset to Defaults
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            console.log("SettingsModal: Apply & Close clicked");
            onHide();
          }}
          className="touch-btn touch-btn--primary settings-modal__apply"
        >
          <span aria-hidden="true">✓</span> Apply & Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default SettingsModal;
