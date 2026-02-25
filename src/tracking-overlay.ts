/**
 * Cavalry-style tracking overlay.
 * Draws white corner-bracket boxes, crosshairs, and coordinate labels
 * over the video. Boxes drift continuously and reshuffle on clip swaps.
 */

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
  // frames until next drift waypoint
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
/** How far a box drifts per waypoint (px) */
const DRIFT_RANGE = 60;
/** Frames between drift waypoints (randomized +-30%) */
const DRIFT_INTERVAL = 90;

export class TrackingOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private boxes: TrackingBox[] = [];
  private crosshairs: Crosshair[] = [];
  private visible = false;
  private rafId = 0;
  private running = false;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'tracking-overlay';
    this.canvas.style.display = 'none';
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = () => {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = window.innerWidth * dpr;
    this.canvas.height = window.innerHeight * dpr;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** Generate initial random positions for all elements */
  init() {
    this.boxes = [];
    this.crosshairs = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (let i = 0; i < BOX_COUNT; i++) {
      const w = 80 + Math.random() * 200;
      const h = 60 + Math.random() * 150;
      const x = Math.random() * (vw - w);
      const y = Math.random() * (vh - h);
      this.boxes.push({
        x, y, w, h,
        tx: x, ty: y, tw: w, th: h,
        label: this.fakeCoord(x, y),
        driftCountdown: this.randDriftInterval(),
      });
    }

    for (let i = 0; i < CROSSHAIR_COUNT; i++) {
      const x = Math.random() * vw;
      const y = Math.random() * vh;
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

  /** Nudge a value by up to +-range, clamped to [0, max] */
  private nudge(val: number, range: number, max: number): number {
    return Math.max(0, Math.min(max, val + (Math.random() - 0.5) * 2 * range));
  }

  /** Call on each beat-cut to reposition elements */
  shuffle() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (const box of this.boxes) {
      box.tw = 80 + Math.random() * 200;
      box.th = 60 + Math.random() * 150;
      box.tx = Math.random() * (vw - box.tw);
      box.ty = Math.random() * (vh - box.th);
      box.label = this.fakeCoord(box.tx, box.ty);
    }

    for (const ch of this.crosshairs) {
      ch.tx = Math.random() * vw;
      ch.ty = Math.random() * vh;
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
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    ctx.clearRect(0, 0, vw, vh);

    // Tick drift — pick new nearby waypoints when countdown expires
    for (const box of this.boxes) {
      box.driftCountdown--;
      if (box.driftCountdown <= 0) {
        box.tx = this.nudge(box.tx, DRIFT_RANGE, vw - box.tw);
        box.ty = this.nudge(box.ty, DRIFT_RANGE, vh - box.th);
        box.label = this.fakeCoord(box.tx, box.ty);
        box.driftCountdown = this.randDriftInterval();
      }
    }
    for (const ch of this.crosshairs) {
      ch.driftCountdown--;
      if (ch.driftCountdown <= 0) {
        ch.tx = this.nudge(ch.tx, DRIFT_RANGE, vw);
        ch.ty = this.nudge(ch.ty, DRIFT_RANGE, vh);
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
