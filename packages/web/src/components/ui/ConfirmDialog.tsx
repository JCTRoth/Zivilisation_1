import React, { useEffect, useRef } from 'react';
import { Modal } from 'react-bootstrap';
import { useTranslation } from '@/i18n/useTranslation';
import '../../styles/confirmDialog.css';

interface ConfirmDialogProps {
  show: boolean;
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'success';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Accessible, mobile-friendly confirmation dialog.
 * Replaces native window.confirm() which is inconsistent and
 * untrustworthy on mobile browsers.
 *
 * It keeps its own `role="alertdialog"` wrapper (tests and screen readers find
 * it by that role), but it is dressed in the shared modal shell's classes —
 * hero with artwork slot, eyebrow/title/lede hierarchy, scrolling content and
 * a fixed action bar — so it reads as the same family of audience-with-the-
 * ruler dialogs as everything else.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  show,
  title,
  message,
  detail,
  confirmLabel,
  cancelLabel,
  variant = 'primary',
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Focus the confirm button when opened for keyboard users
  useEffect(() => {
    if (show && confirmRef.current) {
      const timerId = window.setTimeout(() => confirmRef.current?.focus(), 60);
      return () => window.clearTimeout(timerId);
    }
    return undefined;
  }, [show]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onConfirm();
    }
  };

  const variantClass = variant === 'danger' ? 'touch-btn--danger' : variant === 'success' ? 'touch-btn--success' : 'touch-btn--primary';
  const tone = variant === 'danger' ? 'danger' : variant === 'success' ? 'success' : 'info';
  const eyebrow = variant === 'danger' ? t('confirm.eyebrowDanger') : variant === 'success' ? t('confirm.eyebrowSuccess') : t('confirm.eyebrowInfo');
  const icon = variant === 'danger' ? '⚠️' : variant === 'success' ? '✅' : '⚖️';
  const artLabel = variant === 'success' ? t('confirm.artOpenRoad') : t('confirm.artRedAlert');
  const cancelText = cancelLabel ?? t('common.cancel');

  return (
    <Modal
      show={show}
      onHide={onCancel}
      centered
      backdrop="static"
      keyboard={false}
      className="gm"
      dialogClassName="confirm-dialog"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onKeyDown={handleKeyDown}
        className="gm-body confirm-dialog__inner"
        data-tone={tone}
      >
        <button type="button" className="gm-close" onClick={onCancel} aria-label={t('common.close')}>
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>

        <header className="gm-hero">
          <div className="gm-art gm-art--plain">
            <span className="gm-art-glyph" aria-hidden="true">{icon}</span>
            <span className="gm-art-tag">{artLabel}</span>
          </div>
          <div className="gm-heading">
            <div className="gm-eyebrow">{eyebrow}</div>
            <h2 className="gm-title" id="confirm-dialog-title">{title}</h2>
            <p className="gm-lede" id="confirm-dialog-message">{message}</p>
          </div>
        </header>

        {detail && (
          <div className="gm-content">
            <div className="gm-callout confirm-dialog__detail">
              <span className="gm-callout-title">{t('common.bearInMind')}</span>
              {detail}
            </div>
          </div>
        )}

        <footer className="gm-actions">
          <button type="button" className="touch-btn touch-btn--ghost confirm-dialog__btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`touch-btn ${variantClass} confirm-dialog__btn`}
            onClick={onConfirm}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </footer>
      </div>
    </Modal>
  );
};

export default ConfirmDialog;
