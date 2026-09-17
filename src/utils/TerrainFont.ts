/**
 * Registers the monochrome Noto Emoji font used for terrain symbols and exposes
 * the family string for canvas rendering.
 */
import notoEmojiUrl from '../assets/NotoEmoji-Light.ttf';

/** Font stack for terrain symbols (monochrome emoji first, then fallbacks). */
export const TERRAIN_FONT_FAMILY =
  '"Noto Emoji Light", "Noto Color Emoji", "Segoe UI Emoji", "Apple Color Emoji", monospace';

/**
 * Some TS DOM libs type `document.fonts` without the `add` member — keep a
 * minimal local shape so registration still type-checks.
 */
interface FontFaceSetLike {
  add(font: FontFace): unknown;
}

let registered = false;

/**
 * Load and register the Noto Emoji Light font so canvas text can render terrain
 * glyphs with it. No-op outside the browser or once already registered.
 * Resolves after the face loads (or fails silently so the map still renders).
 */
export function ensureTerrainFont(): Promise<void> {
  if (registered || typeof document === 'undefined' || !('fonts' in document)) {
    return Promise.resolve();
  }
  registered = true;
  try {
    const face = new FontFace('Noto Emoji Light', `url(${notoEmojiUrl})`);
    (document.fonts as unknown as FontFaceSetLike).add(face);
    return face
      .load()
      .then(() => undefined)
      .catch((error: unknown) => {
        console.warn('[TerrainFont] Failed to load Noto Emoji Light', error);
      });
  } catch (error) {
    console.warn('[TerrainFont] Font registration failed', error);
    return Promise.resolve();
  }
}
