import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { motionEnabled } from './DataMotion';
const videoUrl = new URL('./assets/previews/login-preview.webm', import.meta.url).href;
const posterUrl = new URL('./assets/previews/login-preview.webp', import.meta.url).href;
/**
 * Animated preview on the login screen. Plays automatically (muted, while visible and the tab is in front),
 * following the app's animation preference like the dashboard; the OS reduced-motion setting is not used.
 * The button pauses/resumes it.
 */
export function LoginPreview() {
  const video = useRef<HTMLVideoElement>(null),
    frame = useRef<HTMLElement>(null);
  const [paused, setPaused] = useState(() => !motionEnabled()),
    [visible, setVisible] = useState(false),
    [foreground, setForeground] = useState(!document.hidden),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    const visibility = () => setForeground(!document.hidden),
      observer = new IntersectionObserver(
        ([entry]) => setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.15),
        { threshold: 0.15 },
      );
    if (frame.current) observer.observe(frame.current);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (visible && foreground && !paused && !failed) {
      element.muted = true;
      void element.play().catch(() => setPaused(true));
    } else element.pause();
  }, [visible, foreground, paused, failed]);
  return (
    <figure
      ref={frame}
      className="login-preview"
      aria-label="Demonstração da Dashboard: Visão geral, Conteúdo, Analytics e Comunidade, com dados fictícios"
    >
      <div className="login-preview-title">
        <span className="preview-window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Seu estúdio em movimento</span>
        <small>PRÉVIA</small>
      </div>
      <div className="login-preview-screen">
        {failed ? (
          <img src={posterUrl} alt="Visão geral ilustrativa da Dashboard" width={960} height={640} />
        ) : (
          <video
            ref={video}
            src={videoUrl}
            poster={posterUrl}
            width={960}
            height={640}
            muted
            loop
            playsInline
            preload="none"
            disablePictureInPicture
            onError={() => setFailed(true)}
            aria-hidden="true"
          />
        )}
        {!failed && (
          <button
            className="preview-playback"
            onClick={() => setPaused(value => !value)}
            aria-label={paused ? 'Reproduzir prévia' : 'Pausar prévia'}
            title={paused ? 'Reproduzir prévia' : 'Pausar prévia'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        )}
      </div>
      <figcaption>
        <span>Conteúdo. Métricas. Comunidade.</span>
        <small>Demonstração com dados fictícios</small>
      </figcaption>
    </figure>
  );
}
