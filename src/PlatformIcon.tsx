import type { Platform } from './api';
const icons: Record<Platform, string> = {
  YouTube: new URL('./assets/platforms/youtube.svg', import.meta.url).href,
  Twitch: new URL('./assets/platforms/twitch.svg', import.meta.url).href,
  Kick: new URL('./assets/platforms/kick.svg', import.meta.url).href,
};
export function PlatformIcon({ platform, size = 18 }: { platform: Platform; size?: number }) {
  return <img className="platform-svg" src={icons[platform]} width={size} height={size} alt="" aria-hidden="true" />;
}
