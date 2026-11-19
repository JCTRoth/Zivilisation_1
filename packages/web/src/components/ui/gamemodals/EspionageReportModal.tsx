import React, { useEffect, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { useTranslation } from '@/i18n/useTranslation';
import { playSfx, type SfxCue } from '@/utils/Sfx';
import '../../../styles/gameModalShell.css';
import '../../../styles/espionageModal.css';

/**
 * One line of an espionage report, revealed when its turn comes.
 */
export interface EspionageStage {
  /** Stable key for React and for the reveal timer. */
  key: string;
  icon: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  text: string;
  /** Sound cue played the moment this line appears (optional). */
  cue?: SfxCue;
}

interface EspionageReportModalProps {
  show: boolean;
  title: string;
  /** Eyebrow above the title (e.g. "City report: Carthago"). */
  eyebrow?: string;
  stages: EspionageStage[];
  onClose: () => void;
}

/**
 * The plain text window a diplomat's espionage ends in: a confirmation ("we
 * have the secrets of X"), which updates in place with whatever followed — a
 * blown cover, a declaration of war.
 *
 * Civ I showed exactly this: no choices, no numbers to weigh, just the outcome
 * arriving one beat at a time. Each beat carries its own sound cue, so the
 * fanfare of a successful theft lands a beat before the alarm that follows it.
 */
const EspionageReportModal: React.FC<EspionageReportModalProps> = ({
  show,
  title,
  eyebrow,
  stages,
  onClose,
}) => {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(1);

  // A new report starts with its first line — and the reveal counter must not
  // leak from the previous one.
  useEffect(() => {
    if (show) setRevealed(1);
  }, [show]);

  // Play the cue of the line that just appeared. Deliberately keyed on the
  // count rather than on `show`, so a mid-report beat can sound its own cue.
  useEffect(() => {
    const cue = stages[revealed - 1]?.cue;
    if (show && cue) playSfx(cue);
  }, [show, revealed, stages]);

  if (!show || stages.length === 0) return null;

  const done = revealed >= stages.length;
  const advance = () => {
    if (done) onClose();
    else setRevealed((n) => n + 1);
  };

  return (
    <Modal
      show={show}
      onHide={onClose}
      centered
      backdrop="static"
      keyboard={false}
      className="gm"
      dialogClassName="espionage-modal"
    >
      <div className="gm-body espionage-modal__inner" role="alertdialog" aria-modal="true" aria-labelledby="espionage-modal-title">
        <header className="gm-hero">
          <div className="gm-art gm-art--plain">
            <span className="gm-art-glyph" aria-hidden="true">{stages[0]?.icon ?? '📜'}</span>
          </div>
          <div className="gm-heading">
            {eyebrow && <div className="gm-eyebrow">{eyebrow}</div>}
            <h2 className="gm-title" id="espionage-modal-title">{title}</h2>
          </div>
        </header>

        <div className="gm-content">
          <ul className="espionage-modal__lines">
            {stages.slice(0, revealed).map((stage) => (
              <li
                key={stage.key}
                className="espionage-modal__line"
                data-tone={stage.tone ?? 'info'}
              >
                <span className="espionage-modal__line-icon" aria-hidden="true">{stage.icon}</span>
                <span className="espionage-modal__line-text">{stage.text}</span>
              </li>
            ))}
          </ul>
        </div>

        <footer className="gm-actions">
          <button type="button" className="touch-btn touch-btn--primary" onClick={advance}>
            {t('espionage.close')}
          </button>
        </footer>
      </div>
    </Modal>
  );
};

export default EspionageReportModal;
