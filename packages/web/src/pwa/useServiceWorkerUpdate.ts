import { useCallback, useEffect, useRef, useState } from 'react';
import { registerServiceWorker } from './registerServiceWorker';

/**
 * Register the service worker and expose the "a new version is ready"
 * state to the UI.
 *
 * The update is never applied automatically: a running game must not be
 * replaced mid-turn, so the player is asked first.
 */
export interface ServiceWorkerUpdateState {
  /** True when a new build is installed and waiting to take over. */
  updateAvailable: boolean;
  /** Activate the waiting worker and reload. */
  applyUpdate: () => void;
  /** Dismiss the notice without applying the update. */
  dismissUpdate: () => void;
}

export function useServiceWorkerUpdate(): ServiceWorkerUpdateState {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const pendingUpdate = useRef<(() => void) | null>(null);

  useEffect(() => {
    registerServiceWorker({
      onUpdate: (apply) => {
        pendingUpdate.current = apply;
        setUpdateAvailable(true);
      },
      onError: (error) => {
        console.warn('[pwa] service worker unavailable:', error);
      },
    });
  }, []);

  const applyUpdate = useCallback(() => {
    pendingUpdate.current?.();
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  return { updateAvailable, applyUpdate, dismissUpdate };
}
