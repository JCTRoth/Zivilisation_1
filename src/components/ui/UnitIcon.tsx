import React, { useCallback, useSyncExternalStore } from 'react';
import { getUnitIcon, subscribeUnitIcons } from '@/utils/UnitIconLoader';

/**
 * One unit's picture: its SVG artwork when it has any, its emoji otherwise.
 *
 * The map draws unit icons itself (`MapRenderer.drawUnit` polls
 * `getUnitIcon` every frame), but the lists — the stack modal, the city
 * garrison — used to print `UNIT_PROPERTIES[type].icon` directly. That made
 * the same unit look different depending on which screen you were on, and it
 * is how a Frigate with real artwork still showed its fallback glyph in a
 * list. One component, so a unit has one face everywhere.
 *
 * The loader is asynchronous, so the component subscribes to arrivals rather
 * than reading once on mount: a list opened before the artwork had loaded
 * re-renders with the picture the moment it settles.
 */
interface UnitIconProps {
  /** Unit type id, matching `UNIT_PROPERTIES`. */
  unitType: string;
  /** Emoji to show until/unless the artwork arrives. */
  emoji?: string;
  /** CSS size of the box; the artwork is fitted inside it. */
  size?: number;
  /** Extra class for the wrapper. */
  className?: string;
  /** Accessible label; the picture itself is decorative. */
  title?: string;
}

export const UnitIcon: React.FC<UnitIconProps> = ({
  unitType,
  emoji,
  size = 20,
  className,
  title,
}) => {
  const icon = useSyncExternalStore(
    subscribeUnitIcons,
    useCallback(() => getUnitIcon(unitType), [unitType]),
  );
  const glyph = emoji || '⚔️';
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: size,
    height: size,
    flexShrink: 0,
    fontSize: size,
    lineHeight: 1,
  };

  // Artwork present: the picture, fitted inside the box rather than squashed
  // into it, so a 2.5:1 ship keeps its lines.
  if (icon && typeof icon !== 'string' && icon.complete && icon.naturalWidth > 0) {
    return (
      <span className={className} style={style} title={title}>
        <img
          src={icon.src}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            // The artwork is dark ink on transparency; on the dark city/stack
            // panels it needs a little lift to read at 20px.
            filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.35))',
          }}
        />
      </span>
    );
  }

  return (
    <span className={className} style={style} title={title} aria-hidden="true">
      {glyph}
    </span>
  );
};
