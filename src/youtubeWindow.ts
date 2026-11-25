import type { MouseEvent } from 'react';

/**
 * Browser window docked to the right of the screen for native YouTube actions (heart, pin, etc.).
 *
 * Why a window and not an iframe: youtube.com sends `X-Frame-Options: SAMEORIGIN`, so it cannot be embedded.
 * Why it is not reused/closed by the dashboard: youtube.com also sends
 * `Cross-Origin-Opener-Policy: same-origin-allow-popups`, which makes the browser sever the link to the
 * opener and clear the window name. Each click therefore opens a new window at the same docked position;
 * the user closes it after the action. The name below only takes effect if YouTube ever drops that policy.
 */
const WINDOW_NAME = 'serial-youtube';

type ScreenWithOffsets = Screen & { availLeft?: number; availTop?: number };

function features(): string {
  const s = window.screen as ScreenWithOffsets;
  const width = Math.round(Math.min(640, Math.max(420, s.availWidth * 0.36)));
  const left = (s.availLeft ?? 0) + s.availWidth - width;
  return `popup=yes,width=${width},height=${s.availHeight},left=${left},top=${s.availTop ?? 0}`;
}

/** Opens the docked window at `url`. Returns false when the browser blocked the popup. */
export function openYouTubeWindow(url: string): boolean {
  // Open blank first, while the window is still same-origin, so the opener link can be cut explicitly
  // (defense in depth; YouTube's COOP also severs it).
  const win = window.open('', WINDOW_NAME, features());
  if (!win) return false;
  try {
    win.opener = null;
  } catch {
    // Reused window already on youtube.com (cross-origin); nothing to cut.
  }
  win.location.href = url;
  win.focus();
  return true;
}

/**
 * onClick for <a href={youtubeUrl}>: a plain left click opens the docked window; Ctrl/Shift/middle
 * click and blocked popups keep the link's normal behavior (new tab).
 */
export function handleYouTubeLink(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  if (openYouTubeWindow(event.currentTarget.href)) event.preventDefault();
}
