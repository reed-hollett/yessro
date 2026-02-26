/**
 * Zoom crop overlay.
 * Samples a random tight crop of the active video and renders it
 * at quarter viewport size. Picks a new crop region on each swap.
 */

import type { VideoPlayer } from './player';

/** How much of the source frame to crop (0.3 = 30%) */
const CROP_RATIO = 0.3;
const SAMPLE_SCALE = 0.5;

export class ZoomOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private player: VideoPlayer;
  private visible = false;
  private rafId = 0;
  private running = false;
  // Crop origin as fraction of source dimensions
  private cropX = 0;
  private cropY = 0;

  constructor(container: HTMLElement, player: VideoPlayer) {
    this.player = player;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'zoom-overlay';
    this.canvas.style.display = 'none';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const qw = Math.floor(window.innerWidth * SAMPLE_SCALE);
    const qh = Math.floor(window.innerHeight * SAMPLE_SCALE);

    this.canvas.width = qw * dpr;
    this.canvas.height = qh * dpr;
    this.canvas.style.width = qw + 'px';
    this.canvas.style.height = qh + 'px';
  };

  shuffle() {
    // Random canvas position
    const qw = Math.floor(window.innerWidth * SAMPLE_SCALE);
    const qh = Math.floor(window.innerHeight * SAMPLE_SCALE);
    this.canvas.style.left = Math.floor(Math.random() * (window.innerWidth - qw)) + 'px';
    this.canvas.style.top = Math.floor(Math.random() * (window.innerHeight - qh)) + 'px';

    // Crop origin biased toward center (0.3–0.7 range)
    this.cropX = 0.3 + Math.random() * 0.4;
    this.cropY = 0.3 + Math.random() * 0.4;
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
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const canvasRatio = this.canvas.width / this.canvas.height;
      const videoRatio = vw / vh;

      // 1. Cover-fit: find the visible region (matches object-fit:cover)
      let cvX = 0, cvY = 0, cvW = vw, cvH = vh;
      if (videoRatio > canvasRatio) {
        cvW = Math.floor(vh * canvasRatio);
        cvX = Math.floor((vw - cvW) / 2);
      } else {
        cvH = Math.floor(vw / canvasRatio);
        cvY = Math.floor((vh - cvH) / 2);
      }

      // 2. Crop from within the cover-fit region
      const sw = Math.floor(CROP_RATIO * cvW);
      const sh = Math.floor(CROP_RATIO * cvH);
      const sx = cvX + Math.floor(this.cropX * (cvW - sw));
      const sy = cvY + Math.floor(this.cropY * (cvH - sh));

      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
    }

    this.rafId = requestAnimationFrame(this.draw);
  };
}
