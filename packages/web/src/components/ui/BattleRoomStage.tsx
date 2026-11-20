import { useEffect, useRef } from 'react';
import '../../styles/gameSetupModal.css';

/**
 * The ambient 3D war room shared by every fullscreen council screen.
 *
 * It is a pure presentation backdrop: sky, receding walls, a tilted map table
 * and three candle orbs. No image assets — only transforms, gradients and
 * light. The pointer gently shifts the room's perspective so the table feels
 * solid; reduced-motion users get a still room.
 *
 * The markup keeps the `setup-screen__*` class names because those are the
 * existing stage contract in gameSetupModal.css (and the e2e suite). Rendering
 * the same stage on the menu, the lobby, the pause screen and the hotseat
 * hand-off is what makes them read as one place rather than separate apps.
 */
export default function BattleRoomStage({ className = '' }: { className?: string }) {
  const worldRef = useRef<HTMLDivElement>(null);

  // Look-around: pointer parallax written to the stage root. Skipped for
  // reduced motion. The listener is passive and removed with the component.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const onMove = (event: PointerEvent) => {
      const el = worldRef.current;
      if (!el) return;
      const nx = event.clientX / window.innerWidth - 0.5;
      const ny = event.clientY / window.innerHeight - 0.5;
      el.style.setProperty('--setup-look-x', `${(nx * 4).toFixed(2)}deg`);
      el.style.setProperty('--setup-look-y', `${(-ny * 2.5).toFixed(2)}deg`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return (
    <div
      className={`setup-screen__world${className ? ` ${className}` : ''}`}
      ref={worldRef}
      aria-hidden="true"
    >
      <div className="setup-screen__sky" />
      <div className="setup-screen__room">
        <div className="setup-screen__wall setup-screen__wall--left" />
        <div className="setup-screen__wall setup-screen__wall--right" />
        <div className="setup-screen__table">
          <span className="setup-screen__table-face" />
          <span className="setup-screen__table-grid setup-screen__table-grid--near" />
          <span className="setup-screen__table-grid setup-screen__table-grid--far" />
          <span className="setup-screen__table-sheen" />
        </div>
        <div className="setup-screen__candles">
          <i className="setup-candle setup-candle--a" />
          <i className="setup-candle setup-candle--b" />
          <i className="setup-candle setup-candle--c" />
        </div>
      </div>
      <div className="setup-screen__horizon" />
      <div className="setup-screen__glow" />
      <div className="setup-screen__veil" />
    </div>
  );
}
