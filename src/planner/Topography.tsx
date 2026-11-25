import { useEffect, useRef } from 'react';
import { motionEnabled } from '../DataMotion';

/**
 * Animated topographic contour lines on a canvas (no mouse interaction): a slowly drifting noise field drawn as
 * iso-lines with marching squares. Follows the app's own animation preference (static frame when it is off),
 * pauses while off screen or in a hidden tab, and caps the work at ~30 frames per second.
 */
export function Topography({
  color,
  levels = 12,
  speed = 1,
  scale = 1,
  className = '',
}: {
  color: string;
  levels?: number;
  speed?: number;
  scale?: number;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current,
      ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const noise = valueNoise3(Math.floor(Math.random() * 1e9));
    const cell = 7; // CSS px per grid cell
    let width = 0,
      height = 0,
      frame = 0,
      last = 0,
      visible = true,
      t = Math.random() * 100;

    function resize() {
      const box = el!.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 2);
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      el!.width = Math.round(width * dpr);
      el!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw() {
      const cols = Math.ceil(width / cell) + 1,
        rows = Math.ceil(height / cell) + 1,
        f = 0.012 / scale,
        field = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          // Rotated sampling hides the lattice of the value noise (no horizontal/vertical bias in the lines).
          const px = x * cell * f,
            py = y * cell * f,
            nx = px * 0.8 - py * 0.6,
            ny = px * 0.6 + py * 0.8;
          // Two octaves: broad hills plus a little detail.
          field[y * cols + x] =
            noise(nx, ny, t) * 0.7 +
            noise(ny * 1.9 + 3, nx * 1.9 - 5, t * 1.2 + 7) * 0.22 +
            noise(nx * 4.3, ny * 4.3, t * 1.5) * 0.08;
        }
      ctx!.clearRect(0, 0, width, height);
      ctx!.strokeStyle = color;
      ctx!.lineWidth = 1;
      for (let level = 1; level < levels; level++) {
        const iso = level / levels;
        ctx!.globalAlpha = 0.25 + 0.55 * (level / levels);
        ctx!.beginPath();
        for (let y = 0; y < rows - 1; y++)
          for (let x = 0; x < cols - 1; x++) {
            const a = field[y * cols + x],
              b = field[y * cols + x + 1],
              c = field[(y + 1) * cols + x + 1],
              d = field[(y + 1) * cols + x];
            const code = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (d > iso ? 1 : 0);
            if (code === 0 || code === 15) continue;
            const px = x * cell,
              py = y * cell,
              lerp = (p: number, q: number) => (iso - p) / (q - p || 1e-6),
              top: [number, number] = [px + lerp(a, b) * cell, py],
              right: [number, number] = [px + cell, py + lerp(b, c) * cell],
              bottom: [number, number] = [px + lerp(d, c) * cell, py + cell],
              left: [number, number] = [px, py + lerp(a, d) * cell];
            const segment = (p: [number, number], q: [number, number]) => {
              ctx!.moveTo(p[0], p[1]);
              ctx!.lineTo(q[0], q[1]);
            };
            switch (code) {
              case 1:
              case 14:
                segment(left, bottom);
                break;
              case 2:
              case 13:
                segment(bottom, right);
                break;
              case 3:
              case 12:
                segment(left, right);
                break;
              case 4:
              case 11:
                segment(top, right);
                break;
              case 5:
                segment(left, top);
                segment(bottom, right);
                break;
              case 6:
              case 9:
                segment(top, bottom);
                break;
              case 7:
              case 8:
                segment(left, top);
                break;
              case 10:
                segment(left, bottom);
                segment(top, right);
                break;
            }
          }
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
    }
    function loop(now: number) {
      frame = requestAnimationFrame(loop);
      if (!visible || document.hidden || now - last < 33) return;
      t += ((now - (last || now)) / 1000) * 0.06 * speed;
      last = now;
      draw();
    }
    resize();
    draw();
    const animate = () => {
      cancelAnimationFrame(frame);
      last = 0;
      if (motionEnabled()) frame = requestAnimationFrame(loop);
    };
    animate();
    const resized = new ResizeObserver(() => {
      resize();
      draw();
    });
    resized.observe(el);
    const seen = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
    seen.observe(el);
    addEventListener('serial-motion-change', animate);
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      seen.disconnect();
      removeEventListener('serial-motion-change', animate);
    };
  }, [color, levels, speed, scale]);
  return <canvas ref={canvas} className={'topography ' + className} aria-hidden="true" />;
}

/** Smooth 3D value noise in 0..1 (hash on a lattice + quintic interpolation). */
function valueNoise3(seed: number) {
  const hash = (x: number, y: number, z: number) => {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const fade = (v: number) => v * v * v * (v * (v * 6 - 15) + 10);
  const mix = (a: number, b: number, v: number) => a + (b - a) * v;
  return (x: number, y: number, z: number) => {
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      z0 = Math.floor(z),
      u = fade(x - x0),
      v = fade(y - y0),
      w = fade(z - z0);
    const corner = (dx: number, dy: number, dz: number) => hash(x0 + dx, y0 + dy, z0 + dz);
    return mix(
      mix(mix(corner(0, 0, 0), corner(1, 0, 0), u), mix(corner(0, 1, 0), corner(1, 1, 0), u), v),
      mix(mix(corner(0, 0, 1), corner(1, 0, 1), u), mix(corner(0, 1, 1), corner(1, 1, 1), u), v),
      w,
    );
  };
}
