import React, { useEffect, useRef, useState } from 'react';
import { WONDER_ARTWORK_CREDITS, type WonderArtworkCredit, type WonderDefinition } from '@/data/WonderData';

interface WonderArtworkProps {
  wonder: WonderDefinition;
  /**
   * Whether the surrounding view is actually on screen. Images are only fetched
   * once this is true — modals keep their markup mounted while hidden, so a
   * plain `<img src>` would download all 22 pictures up front.
   */
  active?: boolean;
  className?: string;
}

type LoadState = 'idle' | 'loaded' | 'failed';

/**
 * The wonder's artwork, with graceful fallback.
 *
 * - Nothing is downloaded until the view is opened AND the frame scrolls into
 *   view (`IntersectionObserver`), so opening the production menu does not pull
 *   down every wonder image.
 * - Every Wikimedia image is credited: CC BY / CC BY-SA require visible
 *   attribution, and we credit public-domain files too so provenance stays
 *   traceable. Artwork supplied by the project owner carries no source link.
 * - A "Read more on Wikipedia" link to the article about the wonder sits above
 *   the credit so players can read more; the author/licence link to the
 *   Wikimedia Commons file page sits below it.
 * - If the file is missing we fall back to the emoji badge, never a broken image.
 */
export const WonderArtwork: React.FC<WonderArtworkProps> = ({ wonder, active = true, className }) => {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);
  const [state, setState] = useState<LoadState>('idle');

  const info = WONDER_ARTWORK_CREDITS[wonder.id];
  const src = `${import.meta.env.BASE_URL}${wonder.image}`;
  const shouldLoad = active && inView && state !== 'failed';

  useEffect(() => {
    const el = holderRef.current;
    if (!el || !active || typeof IntersectionObserver === 'undefined') {
      // No observer support (or view not active yet): fall back to eager loading.
      if (active) setInView(true);
      return;
    }
    if (inView) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, inView]);

  // A different wonder in the same slot must start its own load.
  useEffect(() => {
    setState('idle');
  }, [wonder.id]);

  return (
    <div ref={holderRef} className={`wonder-artwork ${className ?? ''}`}>
      {shouldLoad ? (
        <img
          className="wonder-artwork__img"
          src={src}
          alt={`${wonder.name}`}
          loading="lazy"
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      ) : state === 'failed' ? (
        <div className="wonder-artwork__fallback" role="img" aria-label={`${wonder.name} artwork placeholder`}>
          <span className="wonder-image__icon">{wonder.icon}</span>
        </div>
      ) : (
        <div className="wonder-artwork__placeholder" aria-hidden="true" />
      )}

      {info && <WonderCredit info={info} />}
    </div>
  );
};

function WonderCredit({ info }: { info: WonderArtworkCredit }) {
  // Artwork the project owner supplied has no external source, so there is
  // nothing to attribute — we still offer the background-reading link.
  const hasSource = !!info.sourceUrl || !!info.author;
  return (
    <div className="wonder-artwork__credit">
      {/* The article link is the one players are meant to follow. */}
      <a className="wonder-artwork__readmore" href={info.articleUrl} target="_blank" rel="noreferrer noopener">
        Read more on Wikipedia
      </a>
      {hasSource && (
        <span className="wonder-artwork__credit-text">
          Artwork:{' '}
          <a href={info.sourceUrl} target="_blank" rel="noreferrer noopener" title="Wikimedia Commons file page">
            {info.author}
          </a>
          {info.licenseUrl ? (
            <>
              {' · '}
              <a href={info.licenseUrl} target="_blank" rel="noreferrer noopener">
                {info.license}
              </a>
            </>
          ) : (
            <> · {info.license}</>
          )}
        </span>
      )}
    </div>
  );
}

export default WonderArtwork