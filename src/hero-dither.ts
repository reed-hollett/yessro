/**
 * Hero dither — renders a full-page warp-dithered still from a random clip
 * behind the play button on the landing page.
 */

import Hls from 'hls.js';
import { config } from './config';

const SAMPLE_SCALE = 0.1;

const BAYER8 = [
   0/64,  48/64,  12/64,  60/64,   3/64,  51/64,  15/64,  63/64,
  32/64,  16/64,  44/64,  28/64,  35/64,  19/64,  47/64,  31/64,
   8/64,  56/64,   4/64,  52/64,  11/64,  59/64,   7/64,  55/64,
  40/64,  24/64,  36/64,  20/64,  43/64,  27/64,  39/64,  23/64,
   2/64,  50/64,  14/64,  62/64,   1/64,  49/64,  13/64,  61/64,
  34/64,  18/64,  46/64,  30/64,  33/64,  17/64,  45/64,  29/64,
  10/64,  58/64,   6/64,  54/64,   9/64,  57/64,   5/64,  53/64,
  42/64,  26/64,  38/64,  22/64,  41/64,  25/64,  37/64,  21/64,
];

type ShapeMode = 'tall-rect' | 'cross' | 'circle';
const SHAPES: ShapeMode[] = ['tall-rect', 'cross', 'circle'];

function sampleComplementaryColor(d: Uint8ClampedArray, len: number): string {
  let rSum = 0, gSum = 0, bSum = 0;
  const step = 16;
  let count = 0;
  for (let i = 0; i < len; i += 4 * step) {
    rSum += d[i]; gSum += d[i + 1]; bSum += d[i + 2]; count++;
  }
  if (count === 0) return 'rgb(255,50,200)';

  const r = rSum / count / 255;
  const g = gSum / count / 255;
  const b = bSum / count / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  if (max !== min) {
    const delta = max - min;
    if (max === r) h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / delta + 2) / 6;
    else h = ((r - g) / delta + 4) / 6;
  }

  h = (h + 0.5) % 1;
  const boostedL = Math.max(0.5, Math.min(0.65, l * 0.8 + 0.35));

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };

  const q2 = boostedL < 0.5 ? boostedL * 2 : boostedL + 1 - boostedL;
  const p2 = 2 * boostedL - q2;

  return `rgb(${Math.round(hue2rgb(p2, q2, h + 1/3) * 255)},${Math.round(hue2rgb(p2, q2, h) * 255)},${Math.round(hue2rgb(p2, q2, h - 1/3) * 255)})`;
}

function addShape(ctx: CanvasRenderingContext2D, shape: ShapeMode, px: number, py: number, w: number, h: number) {
  if (shape === 'circle') {
    const cx = px + w * 0.5, cy = py + h * 0.5;
    ctx.moveTo(cx + w * 0.45, cy);
    ctx.ellipse(cx, cy, w * 0.45, h * 0.45, 0, 0, Math.PI * 2);
  } else if (shape === 'cross') {
    const aw = w * 0.28, ah = h * 0.28;
    ctx.rect(px + w * 0.5 - aw, py, aw * 2, h);
    ctx.rect(px, py + h * 0.5 - ah, w, ah * 2);
  } else {
    const rw = w * 0.45;
    ctx.rect(px + (w - rw) / 2, py, rw, h);
  }
}

export async function initHeroDither(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const vw = canvas.clientWidth;
  const vh = canvas.clientHeight;

  // Bail if canvas has no dimensions yet
  if (vw === 0 || vh === 0) return;

  canvas.width = vw * dpr;
  canvas.height = vh * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Fetch clip manifest
  let clips: string[];
  try {
    const res = await fetch(config.manifestPath);
    clips = await res.json();
  } catch { return; }
  if (clips.length === 0) return;

  // Try up to 3 clips in case one fails to load
  let frame: HTMLVideoElement | null = null;
  for (let attempt = 0; attempt < 3 && !frame; attempt++) {
    const clipUrl = clips[Math.floor(Math.random() * clips.length)];
    const url = clipUrl.startsWith('http') ? clipUrl : `/clips/${clipUrl}`;
    frame = await loadFrame(url);
  }
  if (!frame) return;

  // Sample to offscreen
  const ow = Math.max(1, Math.floor(vw * SAMPLE_SCALE));
  const oh = Math.max(1, Math.floor(vh * SAMPLE_SCALE));
  const offscreen = document.createElement('canvas');
  offscreen.width = ow;
  offscreen.height = oh;
  const offCtx = offscreen.getContext('2d', { willReadFrequently: true })!;

  // Cover-fit
  const fw = frame.videoWidth || ow;
  const fh = frame.videoHeight || oh;
  const canvasRatio = ow / oh;
  const videoRatio = fw / fh;
  let sx = 0, sy = 0, sw = fw, sh = fh;
  if (videoRatio > canvasRatio) { sw = fh * canvasRatio; sx = (fw - sw) / 2; }
  else { sh = fw / canvasRatio; sy = (fh - sh) / 2; }
  offCtx.drawImage(frame, sx, sy, sw, sh, 0, 0, ow, oh);

  const imageData = offCtx.getImageData(0, 0, ow, oh);
  const d = imageData.data;

  // Get color and shape
  const midColor = sampleComplementaryColor(d, d.length);
  const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];

  // Compute dither levels
  const levels = new Uint8Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const i = (y * ow + x) * 4;
      const luma = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
      const bayer = BAYER8[(y & 7) * 8 + (x & 7)];
      const dithered = luma * 2 + (bayer - 0.5);
      levels[y * ow + x] = Math.max(0, Math.min(2, Math.round(dithered)));
    }
  }

  // Draw warp dither
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, vw, vh);

  const fx = 0.3 + Math.random() * 0.4;
  const fy = 0.3 + Math.random() * 0.4;
  const k = 0.5 + Math.random() * 0.6;

  for (let lv = 1; lv <= 2; lv++) {
    ctx.fillStyle = lv === 1 ? midColor : '#fff';
    ctx.beginPath();

    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        if (levels[y * ow + x] !== lv) continue;

        const nx = (x + 0.5) / ow - fx;
        const ny = (y + 0.5) / oh - fy;
        const r2 = nx * nx + ny * ny;
        const scale = 1 + k * r2;

        const dx = (fx + nx / scale) * vw;
        const dy = (fy + ny / scale) * vh;
        const dw = (vw / ow) / scale;
        const dh = (vh / oh) / scale;

        addShape(ctx, shape, dx - dw / 2, dy - dh / 2, dw, dh);
      }
    }
    ctx.fill();
  }

  // Clean up video
  frame.src = '';
  frame.load();
}

function loadFrame(url: string): Promise<HTMLVideoElement | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';

    const timeout = setTimeout(() => resolve(null), 6000);

    const onReady = () => {
      clearTimeout(timeout);
      // Seek to a random point for variety
      if (video.duration > 2) {
        video.currentTime = Math.random() * (video.duration - 1);
        video.addEventListener('seeked', () => resolve(video), { once: true });
      } else {
        resolve(video);
      }
    };

    if (url.endsWith('.m3u8') && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, maxBufferLength: 5 });
      hls.loadSource(url);
      hls.attachMedia(video);
      // Wait for actual frame data, not just manifest
      video.addEventListener('loadeddata', () => onReady(), { once: true });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) { clearTimeout(timeout); hls.destroy(); resolve(null); }
      });
    } else if (url.endsWith('.m3u8') && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener('loadeddata', () => onReady(), { once: true });
      video.addEventListener('error', () => { clearTimeout(timeout); resolve(null); }, { once: true });
    } else {
      video.src = url;
      video.addEventListener('loadedmetadata', () => onReady(), { once: true });
      video.addEventListener('error', () => { clearTimeout(timeout); resolve(null); }, { once: true });
    }
  });
}
