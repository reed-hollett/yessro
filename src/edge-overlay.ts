/**
 * Sobel edge-detection overlay.
 * Samples the active video, runs a Sobel filter, renders white edges
 * on a transparent background at quarter viewport size.
 */

import type { VideoPlayer } from './player';

const EDGE_THRESHOLD = 60;
const SAMPLE_SCALE = 0.4;

export class EdgeOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private player: VideoPlayer;
  private visible = false;
  private rafId = 0;
  private running = false;

  constructor(container: HTMLElement, player: VideoPlayer) {
    this.player = player;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'edge-overlay';
    this.canvas.style.display = 'none';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.offscreen = document.createElement('canvas');
    this.offCtx = this.offscreen.getContext('2d', { willReadFrequently: true })!;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const qw = Math.floor(window.innerWidth / 2);
    const qh = Math.floor(window.innerHeight / 2);

    this.canvas.width = qw * dpr;
    this.canvas.height = qh * dpr;
    this.canvas.style.width = qw + 'px';
    this.canvas.style.height = qh + 'px';

    this.offscreen.width = Math.floor(qw * SAMPLE_SCALE);
    this.offscreen.height = Math.floor(qh * SAMPLE_SCALE);
  };

  shuffle() {
    const qw = Math.floor(window.innerWidth / 2);
    const qh = Math.floor(window.innerHeight / 2);
    this.canvas.style.left = Math.floor(Math.random() * (window.innerWidth - qw)) + 'px';
    this.canvas.style.top = Math.floor(Math.random() * (window.innerHeight - qh)) + 'px';
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';

    if (this.visible && !this.running) {
      this.shuffle();
      this.running = true;
      this.draw();
    } else if (!this.visible) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    }

    return this.visible;
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  private draw = () => {
    if (!this.running) return;

    const video = this.player.activeVideo;
    if (video && video.readyState >= 2) {
      const w = this.offscreen.width;
      const h = this.offscreen.height;

      // Cover-fit the video into the offscreen canvas
      const vw = video.videoWidth || w;
      const vh = video.videoHeight || h;
      const canvasRatio = w / h;
      const videoRatio = vw / vh;
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (videoRatio > canvasRatio) {
        sw = vh * canvasRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / canvasRatio;
        sy = (vh - sh) / 2;
      }
      this.offCtx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);

      const src = this.offCtx.getImageData(0, 0, w, h);
      const sd = src.data;
      const out = this.offCtx.createImageData(w, h);
      const od = out.data;

      // Convert to grayscale luminance buffer
      const gray = new Uint8Array(w * h);
      for (let i = 0; i < gray.length; i++) {
        const j = i * 4;
        gray[i] = (sd[j] * 77 + sd[j + 1] * 150 + sd[j + 2] * 29) >> 8;
      }

      // Sobel
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const tl = gray[i - w - 1], tc = gray[i - w], tr = gray[i - w + 1];
          const ml = gray[i - 1],                        mr = gray[i + 1];
          const bl = gray[i + w - 1], bc = gray[i + w], br = gray[i + w + 1];

          const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
          const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
          const mag = Math.sqrt(gx * gx + gy * gy);

          const pi = i * 4;
          if (mag > EDGE_THRESHOLD) {
            const v = Math.min(255, Math.floor(mag));
            od[pi] = od[pi + 1] = od[pi + 2] = v;
            od[pi + 3] = v;
          } else {
            od[pi + 3] = 0;
          }
        }
      }

      this.offCtx.putImageData(out, 0, 0);

      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.offscreen, 0, 0, this.canvas.width, this.canvas.height);
    }

    this.rafId = requestAnimationFrame(this.draw);
  };
}
