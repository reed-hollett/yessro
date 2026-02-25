/**
 * Threshold overlay effect.
 * Samples the active video, applies a hard black/white threshold,
 * renders at quarter viewport size at a random position.
 * Only white pixels are visible — black becomes transparent.
 */

import type { VideoPlayer } from './player';

/** Only pixels brighter than this become visible */
const THRESHOLD = 200;
/** Downscale factor for the internal canvas (performance) */
const SAMPLE_SCALE = 0.5;

export class ThresholdOverlay {
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
    this.canvas.className = 'threshold-overlay';
    this.canvas.style.display = 'none';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Offscreen canvas for pixel manipulation
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

    // Offscreen at reduced resolution for performance
    this.offscreen.width = Math.floor(qw * SAMPLE_SCALE);
    this.offscreen.height = Math.floor(qh * SAMPLE_SCALE);
  };

  /** Randomize position within the viewport */
  shuffle() {
    const qw = Math.floor(window.innerWidth / 2);
    const qh = Math.floor(window.innerHeight / 2);
    const maxX = window.innerWidth - qw;
    const maxY = window.innerHeight - qh;
    this.canvas.style.left = Math.floor(Math.random() * maxX) + 'px';
    this.canvas.style.top = Math.floor(Math.random() * maxY) + 'px';
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
      const ow = this.offscreen.width;
      const oh = this.offscreen.height;

      // Draw video frame with cover-fit to preserve aspect ratio
      const vw = video.videoWidth || ow;
      const vh = video.videoHeight || oh;
      const canvasRatio = ow / oh;
      const videoRatio = vw / vh;
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (videoRatio > canvasRatio) {
        sw = vh * canvasRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / canvasRatio;
        sy = (vh - sh) / 2;
      }
      this.offCtx.drawImage(video, sx, sy, sw, sh, 0, 0, ow, oh);
      const imageData = this.offCtx.getImageData(0, 0, ow, oh);
      const d = imageData.data;

      // Threshold: bright pixels → solid white, dark → transparent
      for (let i = 0; i < d.length; i += 4) {
        const luma = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        if (luma >= THRESHOLD) {
          d[i] = d[i + 1] = d[i + 2] = 255;
          d[i + 3] = 255;
        } else {
          d[i + 3] = 0;
        }
      }

      this.offCtx.putImageData(imageData, 0, 0);

      // Draw upscaled to the display canvas
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.offscreen, 0, 0, this.canvas.width, this.canvas.height);
    }

    this.rafId = requestAnimationFrame(this.draw);
  };
}
