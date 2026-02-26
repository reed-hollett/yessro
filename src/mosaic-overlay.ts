/**
 * Pixel mosaic overlay.
 * Downsamples the active video to a tiny grid and upscales
 * with no smoothing for hard-edged color blocks.
 * Quarter viewport size at a random position.
 */

import type { VideoPlayer } from './player';

const GRID_COLS = 32;

export class MosaicOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tiny: HTMLCanvasElement;
  private tinyCtx: CanvasRenderingContext2D;
  private player: VideoPlayer;
  private visible = false;
  private rafId = 0;
  private running = false;

  constructor(container: HTMLElement, player: VideoPlayer) {
    this.player = player;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'mosaic-overlay';
    this.canvas.style.display = 'none';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.tiny = document.createElement('canvas');
    this.tinyCtx = this.tiny.getContext('2d')!;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    this.canvas.width = vw * dpr;
    this.canvas.height = vh * dpr;
    this.canvas.style.width = vw + 'px';
    this.canvas.style.height = vh + 'px';

    const rows = Math.round(GRID_COLS * (vh / vw));
    this.tiny.width = GRID_COLS;
    this.tiny.height = rows;
  };

  shuffle() {
    // full-screen — no repositioning needed
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
      const tw = this.tiny.width;
      const th = this.tiny.height;

      // Cover-fit: crop video to match canvas aspect ratio
      const vw = video.videoWidth || tw;
      const vh = video.videoHeight || th;
      const canvasRatio = this.canvas.width / this.canvas.height;
      const videoRatio = vw / vh;
      let sx = 0, sy = 0, sw = vw, sh = vh;
      if (videoRatio > canvasRatio) {
        sw = vh * canvasRatio;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / canvasRatio;
        sy = (vh - sh) / 2;
      }

      this.tinyCtx.drawImage(video, sx, sy, sw, sh, 0, 0, tw, th);

      // Upscale with nearest-neighbor
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.tiny, 0, 0, this.canvas.width, this.canvas.height);
    }

    this.rafId = requestAnimationFrame(this.draw);
  };
}
