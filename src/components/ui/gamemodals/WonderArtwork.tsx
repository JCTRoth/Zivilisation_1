import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { WONDER_ARTWORK_CREDITS, type WonderArtworkCredit, type WonderDefinition } from '@/data/WonderData';

interface WonderArtworkProps {
  wonder: WonderDefinition;
  /**
   * Whether the surrounding view is actually on screen. Images are only fetched
   * once this is true — modals keep their markup mounted while hidden, so a
   * plain `<img src>` would download all 23 pictures up front.
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

      {info && <WonderCreditBlock info={info} />}
    </div>
  );
};

/**
 * The credit block on its own, for surfaces that render the picture themselves
 * (the wonder entry modal lays the artwork out as a full-bleed hero and puts
 * this at its bottom — CC BY requires the attribution to stay visible).
 */
export const WonderCreditBlock: React.FC<{
  info: WonderArtworkCredit;
  /** `hero` renders for a dark photo background instead of a light card. */
  variant?: 'card' | 'hero';
}> = ({ info, variant = 'card' }) => {
  const { t } = useTranslation();
  return (
    <div className={`wonder-artwork__credit${variant === 'hero' ? ' wonder-artwork__credit--hero' : ''}`}>
      {/* The article link is the one players are meant to follow. */}
      <a className="wonder-artwork__readmore" href={info.articleUrl} target="_blank" rel="noreferrer noopener">
        {t('art.readMore')}
      </a>
      {info.galleryUrl && (
        <a className="wonder-artwork__readmore" href={info.galleryUrl} target="_blank" rel="noreferrer noopener" title={t('art.galleryTitle')}>
          {' '}{t('art.officialGallery')}
        </a>
      )}
      {hasSource(info) && (
        <span className="wonder-artwork__credit-text">
          {t('art.artwork')}{' '}
          <a href={info.sourceUrl} target="_blank" rel="noreferrer noopener" title={t('art.commonsTitle')}>
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
};

function hasSource(info: WonderArtworkCredit): boolean {
  // Artwork the project owner supplied has no external source, so there is
  // nothing to attribute — we still offer the background-reading link.
  return !!info.sourceUrl || !!info.author;
}

/** Credit block for one wonder, used where the picture itself is elsewhere. */
export const WonderCreditFor: React.FC<{ wonder: WonderDefinition; variant?: 'card' | 'hero' }> = ({
  wonder,
  variant,
}) => {
  const info = WONDER_ARTWORK_CREDITS[wonder.id];
  if (!info) return null;
  return <WonderCreditBlock info={info} variant={variant} />;
};
