/**
 * Service worker registration.
 *
 * Registration is production-only: in `npm run dev` the worker is not even
 * generated, and registering one would shadow the dev server's modules.
 *
 * The worker never calls `skipWaiting()` on its own. A game in progress must
 * not be swapped out from under the player, so the update is offered and the
 * player decides when it happens.
 */

export interface RegisterServiceWorkerOptions {
  /**
   * Called when a new version of the app is waiting. The callback receives
   * the function that activates the update (skip waiting + reload).
   */
  onUpdate?: (applyUpdate: () => void) => void;
  /** Called when the registration itself fails. */
  onError?: (error: unknown) => void;
  /** Path of the generated worker. */
  scriptUrl?: string;
}

/** True when this build may register a service worker. */
function canRegisterServiceWorker(): boolean {
  try {
    return import.meta.env.PROD === true && 'serviceWorker' in navigator;
  } catch {
    return false;
  }
}

export function registerServiceWorker(options: RegisterServiceWorkerOptions = {}): void {
  if (!canRegisterServiceWorker()) return;

  const scriptUrl = options.scriptUrl ?? '/sw.js';

  const watchWorker = (worker: ServiceWorker, registration: ServiceWorkerRegistration) => {
    const stateChanged = () => {
      // `installed` with an existing controller means a NEW version is ready
      // — the first install has no controller and needs no prompt.
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        options.onUpdate?.(() => {
          worker.postMessage({ type: 'SKIP_WAITING' });
          // The new worker takes over on the next navigation; reload so the
          // player gets the new bundle right away.
          window.location.reload();
        });
      }
    };
    worker.addEventListener('statechange', stateChanged);
    void registration;
  };

  const onLoad = () => {
    navigator.serviceWorker
      .register(scriptUrl, { scope: '/' })
      .then((registration) => {
        // An update may already be waiting from a previous visit.
        if (registration.waiting && navigator.serviceWorker.controller) {
          options.onUpdate?.(() => {
            registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
            window.location.reload();
          });
        }
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (installing) watchWorker(installing, registration);
        });
      })
      .catch((error) => {
        console.warn('[pwa] service worker registration failed:', error);
        options.onError?.(error);
      });
  };

  if (document.readyState === 'complete') {
    onLoad();
  } else {
    window.addEventListener('load', onLoad, { once: true });
  }
}
