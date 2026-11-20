import React from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import '../../styles/pwa.css';

interface UpdateBannerProps {
  /** True when a new build is installed and waiting. */
  available: boolean;
  /** Activate the waiting worker and reload. */
  onApply: () => void;
  /** Hide the notice. */
  onDismiss: () => void;
}

/**
 * "A new version is ready" notice.
 *
 * The update is never applied silently: a running game must not be swapped
 * out from under the player.
 */
const UpdateBanner: React.FC<UpdateBannerProps> = ({ available, onApply, onDismiss }) => {
  const { t } = useTranslation();
  if (!available) return null;

  return (
    <div className="pwa-banner pwa-banner--update" role="status">
      <span className="pwa-banner__icon" aria-hidden="true">
        ✨
      </span>
      <span className="pwa-banner__text">
        {t('pwa.updateAvailable')}
        <span className="pwa-banner__detail">{t('pwa.updateLede')}</span>
      </span>
      <span className="pwa-banner__actions">
        <button type="button" className="pwa-btn pwa-btn--primary" onClick={onApply}>
          {t('pwa.updateApply')}
        </button>
        <button type="button" className="pwa-btn" onClick={onDismiss}>
          {t('pwa.updateLater')}
        </button>
      </span>
    </div>
  );
};

export default UpdateBanner;
