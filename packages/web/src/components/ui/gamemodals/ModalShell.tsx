import React from 'react';
import { Modal } from 'react-bootstrap';
import { useTranslation } from '@/i18n/useTranslation';
import '../../../styles/gameModalShell.css';

/**
 * Colour ramp for a modal. The tone drives the hero tint, the eyebrow, the
 * card accents and the callouts, so a danger notice *reads* dangerous before
 * the player has parsed a word.
 */
type ModalTone = 'info' | 'danger' | 'success' | 'gold' | 'solemn' | 'neutral';

interface GameModalProps {
  show: boolean;
  /** Close (Esc / backdrop / ✕). */
  onClose: () => void;
  title: React.ReactNode;
  /** Small caps line above the title: "Your Empire · Turn 12", "Village", … */
  eyebrow?: React.ReactNode;
  /** One or two sentences of voice-of-the-game copy under the title. */
  lede?: React.ReactNode;
  tone?: ModalTone;
  /** Glyph shown big in the artwork slot. */
  icon?: React.ReactNode;
  /** Caption under the placeholder — names the picture that belongs there. */
  artLabel?: string;
  /** Real picture (wonder art, leader portrait, …). Falls back to placeholder. */
  artSrc?: string;
  artAlt?: string;
  artSize?: 'md' | 'lg';
  /**
   * `side` = picture in a slot beside the heading (default).
   * `cover` = full-bleed picture *as* the hero, heading laid over it — for
   * modals whose whole point is the image (wonder entries, leader portraits).
   */
  artLayout?: 'side' | 'cover';
  /**
   * Caption laid over the bottom of a cover hero. Use it for artwork
   * attribution — CC BY licences require the credit to stay visible, and the
   * bottom of the hero is where it reads as a photo credit rather than as UI.
   */
  artCredit?: React.ReactNode;
  /**
   * Opens the artwork large (a zoom viewer). Passing it turns the cover hero
   * into a button with a "view larger" hint; without it the hero is inert.
   */
  onArtClick?: () => void;
  /** Hide the ✕ (for one-button notices where only the action matters). */
  hideClose?: boolean;
  size?: 'sm' | 'lg' | 'xl';
  className?: string;
  dialogClassName?: string;
  children?: React.ReactNode;
  /** Action bar — use `.touch-btn` variants so it matches the rest of the game. */
  actions?: React.ReactNode;
  /** Disable the transition when another modal must take over immediately. */
  animation?: boolean;
}

/**
 * The shared shell every in-game dialog is built on:
 * hero (artwork + eyebrow + title + lede) → scrolling content → action bar.
 *
 * The artwork slot renders a striped placeholder with a caption by default, so
 * modals that will one day carry a picture already have a sized, styled hole
 * for it (pass `artSrc` to fill it). With `artLayout="cover"` the picture
 * becomes the hero itself instead of a slot inside it.
 */
const GameModal: React.FC<GameModalProps> = ({
  show,
  onClose,
  title,
  eyebrow,
  lede,
  tone = 'info',
  icon,
  artLabel,
  artSrc,
  artAlt,
  artSize = 'md',
  artLayout = 'side',
  artCredit,
  onArtClick,
  hideClose = false,
  size,
  className,
  dialogClassName,
  children,
  actions,
  animation = true,
}) => {
  // Every modal shares this shell, so its close button label follows the
  // language like everything else.
  const { t } = useTranslation();
  return (
    <Modal
      show={show}
      onHide={onClose}
      centered
      animation={animation}
      size={size}
      className={`gm ${className ?? ''}`.trim()}
      dialogClassName={dialogClassName}
      contentClassName="gm-modal"
    >
      <Modal.Body className="gm-body" data-tone={tone}>
        {!hideClose && (
          <button type="button" className="gm-close" onClick={onClose} aria-label={t('common.close')}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        )}

      {artLayout === 'cover' ? (
        <>
          {/* The picture, and nothing else: the heading moves to its own band
              below so the artwork gets the full width and height of the card
              and reads as a poster rather than a background. */}
          <header className="gm-hero gm-hero--cover">
            {artSrc ? (
              onArtClick ? (
                <button
                  type="button"
                  className="gm-hero-poster"
                  onClick={onArtClick}
                  aria-label={`View ${artAlt ?? 'artwork'} larger`}
                >
                  <img className="gm-hero-img" src={artSrc} alt={artAlt ?? ''} />
                  <span className="gm-hero-zoom" aria-hidden="true">
                    ⤢ View larger
                  </span>
                </button>
              ) : (
                <img className="gm-hero-img" src={artSrc} alt={artAlt ?? ''} />
              )
            ) : (
              <div className="gm-hero-fallback" aria-hidden="true">
                <span className="gm-hero-glyph">{icon ?? '⚔️'}</span>
              </div>
            )}
            {/* Only the bottom is darkened — enough for the credit to be legible
                on any artwork, without veiling the picture itself. */}
            <span className="gm-hero-scrim" aria-hidden="true" />
            {artCredit && <div className="gm-hero-credit">{artCredit}</div>}
          </header>

          <div className="gm-heading-band">
            {eyebrow && <div className="gm-eyebrow">{eyebrow}</div>}
            <h2 className="gm-title">{title}</h2>
            {lede && <p className="gm-lede">{lede}</p>}
          </div>
        </>
      ) : (
        <header className="gm-hero">
          <div
            className={`gm-art${artSize === 'lg' ? ' gm-art--lg' : ''}${artSrc ? '' : ' gm-art--plain'}`}
          >
            {artSrc ? (
              <img src={artSrc} alt={artAlt ?? ''} />
            ) : (
              <span className="gm-art-glyph" aria-hidden="true">
                {icon ?? '⚔️'}
              </span>
            )}
            {artLabel && <span className="gm-art-tag">{artLabel}</span>}
          </div>

          <div className="gm-heading">
            {eyebrow && <div className="gm-eyebrow">{eyebrow}</div>}
            <h2 className="gm-title">{title}</h2>
            {lede && <p className="gm-lede">{lede}</p>}
          </div>
        </header>
      )}

      {children != null && children !== false && (
        <div className="gm-content">{children}</div>
      )}

      {actions && <footer className="gm-actions">{actions}</footer>}
    </Modal.Body>
  </Modal>
  );
};

export default GameModal;
