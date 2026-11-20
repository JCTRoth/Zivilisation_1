import { useSyncExternalStore } from 'react';

/**
 * Online/offline state.
 *
 * `navigator.onLine` only tells us whether the device has a network
 * interface — it does not tell us whether the *server* is reachable. It is
 * still the right signal for "should the UI warn the player?", because that
 * is exactly the question the player is asking.
 */

function subscribe(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine !== false;
}

/** Server snapshot — used to detect a change between renders. */
function getServerSnapshot(): boolean {
  return true;
}

/** True while the browser believes it has a network connection. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
