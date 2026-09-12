import { Modal, Button, Form } from 'react-bootstrap';
import {useGameStore} from "@/stores/GameStore";
import '../../styles/settingsModal.css';

function SettingsModal({ show, onHide }) {
  const settings = useGameStore(state => state.settings);
  const actions = useGameStore(state => state.actions);

  const handleChange = (key, value) => {
    actions.updateSettings({
      [key]: parseFloat(value) || value
    });
  };

  const resetDefaults = () => {
    console.log('SettingsModal: Reset to Defaults clicked');
    actions.updateSettings({
      uiScale: 1.0,
      menuFontSize: 12,
      sidebarWidth: 140,
      minimapHeight: 120,
      civListFontSize: 10,
      enableAnimations: true,
      animationSpeed: 1,
      enemyAnimationSpeed: 1,
      cameraGlideSpeed: 1
    });
  };

  const renderSlider = (label: string, value: number, min: number, max: number, step: number, key: string, hint: string, format: (v: number) => string) => (
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
        <Form>
          {renderSlider(
            'Overall UI Scale',
            settings.uiScale,
            0.5, 2.0, 0.1,
            'uiScale',
            'Scales all UI elements proportionally (0.5x to 2.0x)',
            (v) => `${v.toFixed(2)}x`
          )}

          {renderSlider(
            'Top Menu Font Size',
            settings.menuFontSize,
            8, 20, 1,
            'menuFontSize',
            'Font size for GAME, WORLD, INFO menu (8px to 20px)',
            (v) => `${v}px`
          )}

          {renderSlider(
            'Sidebar Width',
            settings.sidebarWidth,
            100, 300, 10,
            'sidebarWidth',
            'Width of the info panel on desktop (100px to 300px)',
            (v) => `${v}px`
          )}

          {renderSlider(
            'Minimap Height',
            settings.minimapHeight,
            80, 450, 10,
            'minimapHeight',
            'Height of minimap display (80px to 450px)',
            (v) => `${v}px`
          )}

          {renderSlider(
            'Civilization List Font Size',
            settings.civListFontSize,
            8, 16, 1,
            'civListFontSize',
            'Font size for civilization names in the info panel (8px to 16px)',
            (v) => `${v}px`
          )}

          <Form.Check
            type="switch"
            id="enableAnimations"
            label="Enable animations"
            checked={settings.enableAnimations}
            onChange={(e) => actions.updateSettings({ enableAnimations: e.target.checked })}
            className="settings-control__toggle"
          />

          {renderSlider(
            'Animation Speed',
            settings.animationSpeed,
            0, 3, 0.1,
            'animationSpeed',
            'How fast units move and combat plays (leftmost = instant)',
            (v) => (v === 0 ? 'Instant' : `${v.toFixed(1)}x`)
          )}

          {renderSlider(
            'Enemy Animation Speed',
            settings.enemyAnimationSpeed,
            0, 3, 0.1,
            'enemyAnimationSpeed',
            'How fast enemy (AI) units move, independent of your own units (leftmost = instant)',
            (v) => (v === 0 ? 'Instant' : `${v.toFixed(1)}x`)
          )}

          {renderSlider(
            'Camera Glide Speed',
            settings.cameraGlideSpeed,
            0, 3, 0.1,
            'cameraGlideSpeed',
            'How fast the camera pans to a new focus (leftmost = instant)',
            (v) => (v === 0 ? 'Instant' : `${v.toFixed(1)}x`)
          )}
        </Form>
      </Modal.Body>
      <Modal.Footer className="settings-modal__footer">
        <Button variant="warning" onClick={resetDefaults} className="touch-btn settings-modal__reset">
          <span aria-hidden="true">🔄</span> Reset to Defaults
        </Button>
        <Button
          variant="primary"
          onClick={() => { console.log('SettingsModal: Apply & Close clicked'); onHide(); }}
          className="touch-btn touch-btn--primary settings-modal__apply"
        >
          <span aria-hidden="true">✓</span> Apply & Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default SettingsModal;
