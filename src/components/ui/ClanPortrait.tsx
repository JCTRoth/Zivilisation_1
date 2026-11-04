import React, { useState } from 'react';

/**
 * The nomad faction portrait — one image slot for the three peoples the
 * tribe can be (Bedouin / Mongol / Sámi; see
 * `src/game/engine/nomad/FACTIONS_README.md` for who they are and for the
 * generation prompts).
 *
 * Three layers, tried in order until one loads:
 *
 *  1. **The generated portrait** — `/assets/nomads/<clan>.png`, 512×640.
 *     Drop the file in and it shows; no code change.
 *  2. **The built-in poster** — `/assets/nomads/<clan>.svg`, a hand-drawn
 *     scene of that people's own world, shipped with the game so the
 *     audience screen has real art from the first run instead of a bare
 *     emoji.
 *  3. **The faction emoji** — the last resort (also used when `clanId` is
 *     unknown).
 *
 * The PNG is the intended final art: it simply wins by being first, so the
 * two layers are swappable at any time without touching the dialogs.
 */
export interface ClanPortraitProps {
  /** The faction id (`bedouin` / `mongol` / `sami`); null → emoji only. */
  clanId: string | null;
  /** The generated portrait path, when the faction has one. */
  image?: string | null;
  /** Emoji fallback. */
  icon?: string;
  /** Accessible name — the faction's translated name. */
  alt: string;
  className?: string;
}

export const ClanPortrait: React.FC<ClanPortraitProps> = ({
  clanId,
  image,
  icon,
  alt,
  className,
}) => {
  const [attempt, setAttempt] = useState(0);

  const candidates = [
    image ?? null,
    clanId ? `/assets/nomads/${clanId}.svg` : null,
  ].filter((src): src is string => typeof src === 'string' && src.length > 0);

  const src = candidates[attempt];

  if (!src) {
    return (
      <span className={className} role="img" aria-label={alt}>
        {icon ?? '🐎'}
      </span>
    );
  }

  // The vector poster must not inherit `image-rendering: pixelated` (that
  // setting exists for the pixel-art PNGs it stands in for).
  const isVector = src.endsWith('.svg');
  const classes = [className, isVector && className ? `${className}--vector` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <img
      // A new key per attempt guarantees the browser re-tries the next src
      // instead of caching the failed one.
      key={src}
      className={classes || undefined}
      src={src}
      alt={alt}
      onError={() => setAttempt((current) => current + 1)}
    />
  );
};

export default ClanPortrait;
