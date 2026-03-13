/**
 * Cavalry-style tracking overlay.
 * Draws white corner-bracket boxes, crosshairs, and coordinate labels
 * over the video half only. Boxes drift toward high-contrast regions
 * in the video and stop when paused/ended.
 */

import type { VideoPlayer } from './player';

interface TrackingBox {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tx: number;
  ty: number;
  tw: number;
  th: number;
  driftCountdown: number;
}

interface Crosshair {
  x: number;
  y: number;
  tx: number;
  ty: number;
  size: number;
  driftCountdown: number;
}

const BOX_COUNT = 5;
const CROSSHAIR_COUNT = 3;
const BRACKET_LEN = 14;
const LINE_WIDTH = 1.5;
const LERP_SPEED = 0.08;
const COLOR = 'rgba(255, 255, 255, 0.85)';
const LABEL_COLOR = 'rgba(255, 255, 255, 0.5)';
const DRIFT_RANGE = 60;
const DRIFT_INTERVAL = 90;

/** Grid size for brightness sampling */
const SAMPLE_COLS = 8;
const SAMPLE_ROWS = 6;

export class TrackingOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private player: VideoPlayer;
  private sampleCanvas: HTMLCanvasElement;
  private sampleCtx: CanvasRenderingContext2D;
  private boxes: TrackingBox[] = [];
  private crosshairs: Crosshair[] = [];
  private visible = false;
  private rafId = 0;
  private running = false;

  constructor(container: HTMLElement, player: VideoPlayer) {
    this.container = container;
    this.player = player;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tracking-overlay';
    this.canvas.style.display = 'none';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;

    // Small offscreen canvas for sampling video brightness
    this.sampleCanvas = document.createElement('canvas');
    this.sampleCanvas.width = SAMPLE_COLS;
    this.sampleCanvas.height = SAMPLE_ROWS;
    this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })!;

    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** Half the container width (the video pane) */
  private get halfW() { return Math.floor(this.container.clientWidth / 2); }
  private get vh() { return this.container.clientHeight; }

  private resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = this.halfW;
    const h = this.vh;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** Generate initial random positions within the video half */
  init() {
    this.boxes = [];
    this.crosshairs = [];
    const w = this.halfW;
    const h = this.vh;

    for (let i = 0; i < BOX_COUNT; i++) {
      const bw = 80 + Math.random() * 200;
      const bh = 60 + Math.random() * 150;
      const x = Math.random() * (w - bw);
      const y = Math.random() * (h - bh);
      this.boxes.push({
        x, y, w: bw, h: bh,
        tx: x, ty: y, tw: bw, th: bh,
        label: this.fakeCoord(x, y),
        driftCountdown: this.randDriftInterval(),
      });
    }

    for (let i = 0; i < CROSSHAIR_COUNT; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      this.crosshairs.push({
        x, y, tx: x, ty: y,
        size: 8 + Math.random() * 12,
        driftCountdown: this.randDriftInterval(),
      });
    }
  }

  private fakeCoord(x: number, y: number): string {
    return `${x.toFixed(1)}, ${y.toFixed(1)}`;
  }

  private randDriftInterval(): number {
    return Math.floor(DRIFT_INTERVAL * (0.7 + Math.random() * 0.6));
  }

  private nudge(val: number, range: number, max: number): number {
    return Math.max(0, Math.min(max, val + (Math.random() - 0.5) * 2 * range));
  }

  /**
   * Sample the video into a grid and return cells sorted by brightness variance
   * (high-contrast areas). Returns array of {x, y} in overlay coordinates.
   */
  private sampleVideoHotspots(): { x: number; y: number }[] {
    const video = this.player.activeVideo;
    if (!video || video.readyState < 2) return [];

    const w = this.halfW;
    const h = this.vh;

    // Draw video cover-fit into the small sample canvas
    const vw = video.videoWidth || SAMPLE_COLS;
    const vhh = video.videoHeight || SAMPLE_ROWS;
    const canvasRatio = SAMPLE_COLS / SAMPLE_ROWS;
    const videoRatio = vw / vhh;
    let sx = 0, sy = 0, sw = vw, sh = vhh;
    if (videoRatio > canvasRatio) {
      sw = vhh * canvasRatio;
      sx = (vw - sw) / 2;
    } else {
      sh = vw / canvasRatio;
      sy = (vhh - sh) / 2;
    }
    this.sampleCtx.drawImage(video, sx, sy, sw, sh, 0, 0, SAMPLE_COLS, SAMPLE_ROWS);
    const data = this.sampleCtx.getImageData(0, 0, SAMPLE_COLS, SAMPLE_ROWS).data;

    // Compute brightness per cell
    const cells: { x: number; y: number; luma: number }[] = [];
    for (let r = 0; r < SAMPLE_ROWS; r++) {
      for (let c = 0; c < SAMPLE_COLS; c++) {
        const i = (r * SAMPLE_COLS + c) * 4;
        const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        cells.push({
          x: ((c + 0.5) / SAMPLE_COLS) * w,
          y: ((r + 0.5) / SAMPLE_ROWS) * h,
          luma,
        });
      }
    }

    // Compute mean luma
    const meanLuma = cells.reduce((s, c) => s + c.luma, 0) / cells.length;

    // Sort by deviation from mean (high contrast = interesting)
    cells.sort((a, b) => Math.abs(b.luma - meanLuma) - Math.abs(a.luma - meanLuma));

    return cells.map(c => ({ x: c.x, y: c.y }));
  }

  /** Call on each beat-cut to reposition elements */
  shuffle() {
    const w = this.halfW;
    const h = this.vh;

    // Try to place boxes near high-contrast video regions
    const hotspots = this.sampleVideoHotspots();

    for (let i = 0; i < this.boxes.length; i++) {
      const box = this.boxes[i];
      box.tw = 80 + Math.random() * 200;
      box.th = 60 + Math.random() * 150;

      if (hotspots.length > 0) {
        // Pick from top hotspots with some jitter
        const spot = hotspots[i % hotspots.length];
        box.tx = Math.max(0, Math.min(w - box.tw, spot.x - box.tw / 2 + (Math.random() - 0.5) * 40));
        box.ty = Math.max(0, Math.min(h - box.th, spot.y - box.th / 2 + (Math.random() - 0.5) * 40));
      } else {
        box.tx = Math.random() * (w - box.tw);
        box.ty = Math.random() * (h - box.th);
      }
      box.label = this.fakeCoord(box.tx, box.ty);
    }

    for (let i = 0; i < this.crosshairs.length; i++) {
      const ch = this.crosshairs[i];
      if (hotspots.length > i) {
        const spot = hotspots[i];
        ch.tx = Math.max(0, Math.min(w, spot.x + (Math.random() - 0.5) * 30));
        ch.ty = Math.max(0, Math.min(h, spot.y + (Math.random() - 0.5) * 30));
      } else {
        ch.tx = Math.random() * w;
        ch.ty = Math.random() * h;
      }
    }
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';

    if (this.visible && !this.running) {
      this.init();
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

    const ctx = this.ctx;
    const w = this.halfW;
    const h = this.vh;
    ctx.clearRect(0, 0, w, h);

    // Check if video is actually playing — freeze drift if paused/ended
    const video = this.player.activeVideo;
    const videoPlaying = video && !video.paused && !video.ended && video.readyState >= 2;

    if (videoPlaying) {
      // Tick drift using video content hotspots
      const hotspots = this.sampleVideoHotspots();

      for (const box of this.boxes) {
        box.driftCountdown--;
        if (box.driftCountdown <= 0) {
          if (hotspots.length > 0) {
            // Drift toward a random hotspot with jitter
            const spot = hotspots[Math.floor(Math.random() * Math.min(hotspots.length, 12))];
            box.tx = Math.max(0, Math.min(w - box.tw, spot.x - box.tw / 2 + (Math.random() - 0.5) * DRIFT_RANGE));
            box.ty = Math.max(0, Math.min(h - box.th, spot.y - box.th / 2 + (Math.random() - 0.5) * DRIFT_RANGE));
          } else {
            box.tx = this.nudge(box.tx, DRIFT_RANGE, w - box.tw);
            box.ty = this.nudge(box.ty, DRIFT_RANGE, h - box.th);
          }
          box.label = this.fakeCoord(box.tx, box.ty);
          box.driftCountdown = this.randDriftInterval();
        }
      }
      for (const ch of this.crosshairs) {
        ch.driftCountdown--;
        if (ch.driftCountdown <= 0) {
          if (hotspots.length > 0) {
            const spot = hotspots[Math.floor(Math.random() * Math.min(hotspots.length, 8))];
            ch.tx = Math.max(0, Math.min(w, spot.x + (Math.random() - 0.5) * DRIFT_RANGE));
            ch.ty = Math.max(0, Math.min(h, spot.y + (Math.random() - 0.5) * DRIFT_RANGE));
          } else {
            ch.tx = this.nudge(ch.tx, DRIFT_RANGE, w);
            ch.ty = this.nudge(ch.ty, DRIFT_RANGE, h);
          }
          ch.driftCountdown = this.randDriftInterval();
        }
      }

      // Lerp toward targets
      for (const box of this.boxes) {
        box.x += (box.tx - box.x) * LERP_SPEED;
        box.y += (box.ty - box.y) * LERP_SPEED;
        box.w += (box.tw - box.w) * LERP_SPEED;
        box.h += (box.th - box.h) * LERP_SPEED;
      }
      for (const ch of this.crosshairs) {
        ch.x += (ch.tx - ch.x) * LERP_SPEED;
        ch.y += (ch.ty - ch.y) * LERP_SPEED;
      }
    }
    // When paused: no drift, no lerp — boxes freeze in place

    // Draw boxes (corner brackets)
    ctx.strokeStyle = COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'square';

    for (const box of this.boxes) {
      this.drawBrackets(ctx, box.x, box.y, box.w, box.h);
    }

    // Draw crosshairs
    for (const ch of this.crosshairs) {
      this.drawCrosshair(ctx, ch.x, ch.y, ch.size);
    }

    // Draw labels
    ctx.font = '10px "SF Mono", "Fira Code", monospace';
    ctx.fillStyle = LABEL_COLOR;
    for (const box of this.boxes) {
      ctx.fillText(box.label, box.x, box.y - 5);
    }

    this.rafId = requestAnimationFrame(this.draw);
  };

  private drawBrackets(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
  ) {
    const b = BRACKET_LEN;

    ctx.beginPath();

    // Top-left
    ctx.moveTo(x, y + b);
    ctx.lineTo(x, y);
    ctx.lineTo(x + b, y);

    // Top-right
    ctx.moveTo(x + w - b, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + b);

    // Bottom-right
    ctx.moveTo(x + w, y + h - b);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - b, y + h);

    // Bottom-left
    ctx.moveTo(x + b, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + h - b);

    ctx.stroke();
  }

  private drawCrosshair(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, size: number,
  ) {
    ctx.beginPath();
    ctx.moveTo(cx - size, cy);
    ctx.lineTo(cx + size, cy);
    ctx.moveTo(cx, cy - size);
    ctx.lineTo(cx, cy + size);
    ctx.stroke();

    // Small center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = COLOR;
    ctx.fill();
  }
}
