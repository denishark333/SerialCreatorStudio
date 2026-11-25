import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PlatformIcon } from './PlatformIcon';
import { usePlatform } from './PlatformContext';
import type { Platform } from './api';

const platforms: Platform[] = ['YouTube', 'Twitch', 'Kick'];
const at = (index: number) => platforms[((index % platforms.length) + platforms.length) % platforms.length];
/** Slots rendered around the active one: ±1 visible, ±2 hidden at the edges (where items enter and leave). */
const REACH = 2;

/**
 * Platform carousel in the sidebar: ‹ previous · active (glow in the platform colour) · next ›.
 * The icons sit on an endless track (`position` grows/shrinks without wrapping), so a change slides every icon one
 * step: the leaving one fades out at the edge and the next one comes in from the other side.
 * One click switches; the side icons select their platform directly; ←/→ work while it has focus.
 * Collapsed sidebar: only the active icon, and a click moves to the next platform.
 */
export function PlatformPicker() {
  const { platform, setPlatform, saving, preferenceNotice } = usePlatform();
  const [position, setPosition] = useState(() => platforms.indexOf(platform));
  // The platform can also change elsewhere (saved preference, another tab): move to its nearest slot.
  if (at(position) !== platform) {
    const nearest = [0, 1, -1, 2, -2].map(d => position + d).find(p => at(p) === platform) ?? position;
    setPosition(nearest);
  }
  function go(step: 1 | -1) {
    setPosition(position + step);
    setPlatform(at(position + step));
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      go(e.key === 'ArrowRight' ? 1 : -1);
    }
  }
  const slots = [];
  for (let slot = position - REACH; slot <= position + REACH; slot++) {
    const offset = slot - position,
      item = at(slot),
      visible = Math.abs(offset) <= 1;
    slots.push(
      <button
        key={slot}
        type="button"
        className={'platform-carousel-item' + (offset === 0 ? ' current' : '')}
        style={{ '--offset': offset } as CSSProperties}
        data-offset={offset}
        {...(visible
          ? {
              role: 'radio',
              'aria-checked': offset === 0,
              'aria-label': item,
              title: offset === 0 ? 'Plataforma: ' + item : undefined,
              onClick: () => go(offset === -1 ? -1 : 1),
            }
          : { 'aria-hidden': true, tabIndex: -1 })}
      >
        <PlatformIcon platform={item} size={24} />
      </button>,
    );
  }
  return (
    <div className="platform-picker" data-platform={platform} title={preferenceNotice || undefined}>
      <div className="platform-carousel" role="radiogroup" aria-label="Plataforma" onKeyDown={key}>
        <button
          type="button"
          className="platform-carousel-arrow"
          aria-label="Plataforma anterior"
          onClick={() => go(-1)}
        >
          <ChevronLeft size={15} />
        </button>
        <div className="platform-carousel-track">{slots}</div>
        <button type="button" className="platform-carousel-arrow" aria-label="Próxima plataforma" onClick={() => go(1)}>
          <ChevronRight size={15} />
        </button>
      </div>
      <small className="platform-carousel-name" key={platform} aria-hidden="true">
        {platform}
      </small>
      <span className="sr-only" role="status">
        {saving ? 'Salvando preferência' : ''}
      </span>
    </div>
  );
}
