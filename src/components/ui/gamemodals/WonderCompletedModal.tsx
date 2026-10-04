import React, { useEffect } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { getWonder } from '@/data/WonderData';
import '@/styles/wonders.css';

/** The 'completed' variant of the wonder dialog queue entry. */
interface WonderCompletedNotice {
  kind: 'completed';
  wonderId: string;
  cityId: string;
  cityName: string;
  civId: number;
  civName: string;
  isHuman: boolean;
}

interface WonderCompletedModalProps {
  show: boolean;
  notice: WonderCompletedNotice | null;
  /** Continue button — dismisses this entry (or shows the next queued one). */
  onContinue: () => void;
}

/**
 * Full-screen celebratory screen shown when a world wonder is completed —
 * the single most memorable moment of the wonder system, and the reason the
 * wonder's full mechanical effect is spelled out in plain language right
 * here (players forget what a wonder does 200 turns later).
 *
 * The artwork area is a fixed-ratio placeholder: drop the real image into
 * `public/assets/wonders/<id>.png` and it renders here without code changes.
 */
const WonderCompletedModal: React.FC<WonderCompletedModalProps> = ({ show, notice, onContinue }) => {
  const wonder = notice ? getWonder(notice.wonderId) : undefined;

  // Confetti celebration while the screen is open (same lazy-loaded library
  // as the victory fireworks, so it is only fetched when actually needed).
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const celebrate = async () => {
      try {
        const module = await import('canvas-confetti');
        if (cancelled) return;
        const confetti = module.default;
        const end = Date.now() + 4000;
        const fire = () => {
          if (cancelled || Date.now() > end) return;
          confetti({
            particleCount: 110,
            spread: 85,
            startVelocity: 42,
            origin: { x: Math.random() * 0.6 + 0.2, y: 0.4 },
            colors: ['#ffd75e', '#ffe9a8', '#f7d417', '#ffffff'],
            scalar: 1.1,
          });
          timer = setTimeout(fire, 700 + Math.random() * 500);
        };
        fire();
      } catch {
        // Confetti is decoration — never block the screen if it fails to load.
      }
    };
    celebrate();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [show, notice?.wonderId]);

  if (!notice || !wonder) return null;

  const humanOwns = notice.isHuman;
  const subtitle = humanOwns
    ? `Your civilization raised it in ${notice.cityName}.`
    : `${notice.civName} completed it in ${notice.cityName}.`;

  return (
    <Modal
      show={show}
      onHide={onContinue}
      centered
      size="lg"
      backdrop="static"
      keyboard={false}
      dialogClassName="wonder-completed-modal"
      aria-labelledby="wonder-completed-title"
    >
      <Modal.Body className="wonder-completed-body">
        <div className="wonder-completed-eyebrow">
          {humanOwns ? 'A Wonder of the World is complete' : 'A Wonder of the World has risen'}
        </div>
        <h1 className="wonder-completed-title" id="wonder-completed-title">
          {wonder.icon} {wonder.name}
        </h1>
        <div className="wonder-completed-sub">{subtitle}</div>

        {/* Reserved artwork area — filled automatically once the image exists. */}
        <div className="wonder-image" role="img" aria-label={`${wonder.name} artwork placeholder`}>
          <span className="wonder-image__icon">{wonder.icon}</span>
          <span className="wonder-image__caption">artwork: {wonder.image}</span>
        </div>

        <div className="wonder-effect-box">
          <strong>Effect:</strong> {wonder.effectText}
        </div>
        <p className="wonder-flavor">{wonder.flavor}</p>

        <Button variant="warning" className="btn-wonder-continue" onClick={onContinue} autoFocus>
          Continue
        </Button>
      </Modal.Body>
    </Modal>
  );
};

export default WonderCompletedModal;
