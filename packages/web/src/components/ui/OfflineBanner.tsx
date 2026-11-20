import React from 'react';
import { useTranslation } from '../../i18n/useTranslation';
import '../../styles/pwa.css';

interface OfflineBannerProps {
  /** True while the browser reports no network connection. */
  offline: boolean;
  /** True while a multiplayer room is waiting for the network. */
  reconnecting?: boolean;
}

/**
 * The offline notice.
 *
 * Single-player keeps working without a server — that is the point of the
 * PWA — so the banner says so instead of pretending something is broken.
 * In a multiplayer room it explains that the game is waiting to reconnect.
 */
const OfflineBanner: React.FC<OfflineBannerProps> = ({ offline, reconnecting }) => {
  const { t } = useTranslation();
  if (!offline && !reconnecting) return null;

  return (
    <div className={`pwa-banner ${offline ? 'pwa-banner--offline' : 'pwa-banner--reconnect'}`} role="status">
      <span className="pwa-banner__icon" aria-hidden="true">
        {offline ? '📴' : '🔄'}
      </span>
      <span className="pwa-banner__text">
        {offline ? t('pwa.offline') : t('pwa.reconnecting')}
        <span className="pwa-banner__detail">{offline ? t('pwa.offlineLede') : t('pwa.reconnectingLede')}</span>
      </span>
    </div>
  );
};

export default OfflineBanner;
