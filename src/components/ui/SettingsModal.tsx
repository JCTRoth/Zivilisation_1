import React from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useGameStore } from '@/stores/GameStore';

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
      civListFontSize: 10
    });
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Modal.Header closeButton style={{ backgroundColor: '#2c3e50', color: 'white' }}>
        <Modal.Title>⚙️ Settings</Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ backgroundColor: '#34495e', color: 'white' }}>
        <Form>
          {/* UI Scale */}
          <Form.Group className="mb-3">
            <Form.Label>
              Overall UI Scale: <strong>{settings.uiScale.toFixed(2)}x</strong>
            </Form.Label>
            <Form.Range
              min="0.5"
              max="2.0"
              step="0.1"
              value={settings.uiScale}
              onChange={(e) => handleChange('uiScale', e.target.value)}
            />
            <Form.Text className="text-light">
              Scales all UI elements proportionally (0.5x to 2.0x)
            </Form.Text>
          </Form.Group>

          {/* Menu Font Size */}
          <Form.Group className="mb-3">
            <Form.Label>
              Top Menu Font Size: <strong>{settings.menuFontSize}px</strong>
            </Form.Label>
            <Form.Range
              min="8"
              max="20"
              step="1"
              value={settings.menuFontSize}
              onChange={(e) => handleChange('menuFontSize', e.target.value)}
            />
            <Form.Text className="text-light">
              Font size for GAME, ORDERS, ADVISORS menu (8px to 20px)
            </Form.Text>
          </Form.Group>

          {/* Sidebar Width */}
          <Form.Group className="mb-3">
            <Form.Label>
              Sidebar Width: <strong>{settings.sidebarWidth}px</strong>
            </Form.Label>
            <Form.Range
              min="100"
              max="300"
              step="10"
              value={settings.sidebarWidth}
              onChange={(e) => handleChange('sidebarWidth', e.target.value)}
            />
            <Form.Text className="text-light">
              Width of left civilization panel (100px to 300px)
            </Form.Text>
          </Form.Group>

          {/* Minimap Height */}
          <Form.Group className="mb-3">
            <Form.Label>
              Minimap Height: <strong>{settings.minimapHeight}px</strong>
            </Form.Label>
            <Form.Range
              min="80"
              max="250"
              step="10"
              value={settings.minimapHeight}
              onChange={(e) => handleChange('minimapHeight', e.target.value)}
            />
            <Form.Text className="text-light">
              Height of minimap display (80px to 250px)
            </Form.Text>
          </Form.Group>

          {/* Civilization List Font Size */}
          <Form.Group className="mb-3">
            <Form.Label>
              Civilization List Font Size: <strong>{settings.civListFontSize}px</strong>
            </Form.Label>
            <Form.Range
              min="8"
              max="16"
              step="1"
              value={settings.civListFontSize}
              onChange={(e) => handleChange('civListFontSize', e.target.value)}
            />
            <Form.Text className="text-light">
              Font size for civilization names in sidebar (8px to 16px)
            </Form.Text>
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer style={{ backgroundColor: '#2c3e50' }}>
        <Button variant="warning" onClick={resetDefaults}>
          🔄 Reset to Defaults
        </Button>
        <Button variant="primary" onClick={() => { console.log('SettingsModal: Apply & Close clicked'); onHide(); }}>
          ✓ Apply & Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export default SettingsModal;
