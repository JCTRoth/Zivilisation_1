// Resource Icon Loader — special-resource artwork (Fish, Horses…) drawn as a
// map overlay, the same way unit icons and terrain emoji glyphs are drawn.
//
// The SVGs are bundled by Vite (`new URL(..., import.meta.url)`, the pattern
// UnitIconLoader uses) and decoded once in the background. Terrain rendering
// never waits for them: MapRenderer keeps painting the fallback glyph until
// `getResourceIcon` returns a decoded image, and App preloads them during the
// setup screen so the artwork is usually ready before the first turn.

/**
 * Artwork files per resource key (normalized lowercase name). Several files
 * are variants; the tile position picks one so neighbouring tiles differ.
 */
export const RESOURCE_ICON_URLS: Record<string, readonly string[]> = {
    fish: [new URL('../assets/resources/fish.svg', import.meta.url).href],
    horses: [
        new URL('../assets/resources/horses.svg', import.meta.url).href,
        new URL('../assets/resources/horses_2.svg', import.meta.url).href,
    ],
};

/** Decoded artwork per resource key, indexed by file order (null = failed). */
const iconCache = new Map<string, ReadonlyArray<HTMLImageElement | null>>();
const loadingPromises = new Map<string, Promise<void>>();

/** Normalise a resource name ('Fish', ' HORSES ') to its cache key. */
export function normalizeResourceKey(resource: string | null | undefined): string {
    return typeof resource === 'string' ? resource.trim().toLowerCase() : '';
}

/** Whether any artwork is bundled for this resource. */
export function hasResourceArtwork(resource: string | null | undefined): boolean {
    return (RESOURCE_ICON_URLS[normalizeResourceKey(resource)]?.length ?? 0) > 0;
}

/** How many pictures a resource ships (1 for most, 2 for horses). */
export function getResourceVariantCount(resource: string | null | undefined): number {
    return RESOURCE_ICON_URLS[normalizeResourceKey(resource)]?.length ?? 0;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

/**
 * Start decoding one resource's artwork. Idempotent: concurrent and repeated
 * calls share the same promise. Resolves when every variant has settled
 * (loaded or failed) — it never rejects, so a missing file cannot break boot.
 */
export function preloadResourceIcon(resource: string): Promise<void> {
    const key = normalizeResourceKey(resource);
    const urls = RESOURCE_ICON_URLS[key];
    if (!urls || urls.length === 0) return Promise.resolve();
    const inFlight = loadingPromises.get(key);
    if (inFlight) return inFlight;

    const promise = Promise.all(urls.map((url) => loadImage(url))).then((images) => {
        // Fixed slots keep the variant mapping stable regardless of load order.
        iconCache.set(key, images);
        loadingPromises.delete(key);
    });
    loadingPromises.set(key, promise);
    return promise;
}

/** Start loading the artwork of every resource that has a picture. */
export function preloadResourceIcons(): Promise<void> {
    return Promise.all(Object.keys(RESOURCE_ICON_URLS).map((key) => preloadResourceIcon(key)))
        .then(() => undefined);
}

/**
 * Already decoded artwork for a tile, or null while it is still loading (or
 * when the resource has no picture). Safe to call every frame.
 *
 * @param seed - Stable per-tile number (e.g. `row * mapWidth + col`); the same
 *   tile always gets the same pose while neighbours are spread over variants.
 */
export function getResourceIcon(
    resource: string | null | undefined,
    seed: number,
): HTMLImageElement | null {
    const images = iconCache.get(normalizeResourceKey(resource));
    if (!images || images.length === 0) return null;
    // Same multiplicative hash the old overlay used: consecutive tile indices
    // map to different variants, and a tile never changes pose between frames.
    const hash = (Math.abs(Math.trunc(seed)) * 2654435761) >>> 0;
    const img = images[hash % images.length];
    return img && img.complete && img.naturalWidth > 0 ? img : null;
}
