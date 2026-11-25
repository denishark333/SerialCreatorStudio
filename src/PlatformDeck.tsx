import type { CSSProperties } from 'react';
import type { Platform } from './api';
import { PlatformIcon } from './PlatformIcon';

/**
 * Where a plan happens, as platform icons in a small deck (same idea as the sidebar carousel):
 * one icon alone; two side by side; three with the first in front and the other two tucked in behind it.
 */
export function PlatformDeck({ platforms, size = 16 }: { platforms: Platform[]; size?: number }) {
  const unique = [...new Set(platforms)];
  // Three: the primary platform goes in the middle, in front.
  const order = unique.length === 3 ? [unique[1], unique[0], unique[2]] : unique;
  return (
    <span
      className={'platform-deck count-' + unique.length}
      role="img"
      aria-label={unique.join(', ')}
      style={{ '--deck-size': size + 'px' } as CSSProperties}
    >
      {order.map((platform, i) => (
        <span
          key={platform}
          className={'platform-deck-item' + (unique.length === 3 && i === 1 ? ' front' : '')}
          data-platform={platform}
        >
          <PlatformIcon platform={platform} size={size} />
        </span>
      ))}
    </span>
  );
}
