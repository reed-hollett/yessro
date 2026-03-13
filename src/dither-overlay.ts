/**
 * Dither overlay effect.
 * On each clip swap, randomly picks one of four modes:
 *   flat   – standard dither with shape variety
 *   warp   – barrel-distorted dither grid for 3D depth
 *   mask   – dither only through asymmetric polygon cutouts
 *   grid   – tiled grid of the dithered video
 * Color is sampled once per clip and neon-boosted.
 * Shape (tall-rect, cross, circle) is also randomized per swap.
 */

import type { VideoPlayer } from './player';

const SAMPLE_SCALE = 0.12;

/** 8×8 Bayer threshold matrix (normalized 0–1) */
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

type DitherMode = 'flat' | 'warp' | 'mask' | 'grid' | 'sphere';
type ShapeMode = 'tall-rect' | 'cross' | 'circle';
const DITHER_MODES: DitherMode[] = ['flat', 'warp', 'mask', 'grid', 'sphere'];
const SHAPE_MODES: ShapeMode[] = ['tall-rect', 'cross', 'circle'];

export class DitherOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private offscreen: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private player: VideoPlayer;
  private container: HTMLElement;
  private visible = false;
  private rafId = 0;
  private running = false;

  // Current mode & shape (randomized per clip swap)
  private mode: DitherMode = 'flat';
  private shape: ShapeMode = 'tall-rect';

  // Neon mid-tone color (sampled once per clip)
  private midColor = 'rgb(255,50,200)';
  private needsColorSample = true;

  // Warp params
  private warpFocusX = 0.5;
  private warpFocusY = 0.5;
  private warpStrength = 0.5;

  // Mask params (for mask mode — sparser)
  private masks: Path2D[] = [];

  // Knockout clip — always applied so dither never fills the full pane
  private knockoutClip: Path2D | null = null;

  // Grid params
  private gridCols = 2;
  private gridRows = 2;

  // Sphere params
  private sphereCount = 3;

  // Side: dither on left or right (randomized per swap)
  private ditherOnLeft = false;

  constructor(container: HTMLElement, player: VideoPlayer) {
    this.player = player;
    this.container = container;

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dither-overlay';
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
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const hw = Math.floor(cw / 2);

    this.canvas.width = hw * dpr;
    this.canvas.height = ch * dpr;
    this.canvas.style.width = hw + 'px';
    this.canvas.style.height = ch + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.offscreen.width = Math.max(1, Math.floor(hw * SAMPLE_SCALE));
    this.offscreen.height = Math.max(1, Math.floor(ch * SAMPLE_SCALE));
  };

  /** On each clip swap: pick random mode, shape, side, and params */
  shuffle() {
    this.mode = DITHER_MODES[Math.floor(Math.random() * DITHER_MODES.length)];
    this.shape = SHAPE_MODES[Math.floor(Math.random() * SHAPE_MODES.length)];
    this.needsColorSample = true;

    // Randomly swap which side dither is on
    this.ditherOnLeft = Math.random() < 0.5;
    this.container.classList.toggle('dither-left', this.ditherOnLeft);

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const hw = Math.floor(cw / 2);

    // Always generate a knockout clip so there's black mixed in
    this.generateKnockout(hw, ch);

    if (this.mode === 'warp') {
      this.warpFocusX = 0.2 + Math.random() * 0.6;
      this.warpFocusY = 0.2 + Math.random() * 0.6;
      this.warpStrength = 0.4 + Math.random() * 0.8;
    }
    if (this.mode === 'mask') {
      this.generateMasks(hw, ch);
    }
    if (this.mode === 'grid') {
      this.gridCols = 2 + Math.floor(Math.random() * 2); // 2–3
      this.gridRows = 2 + Math.floor(Math.random() * 2); // 2–3
    }
    if (this.mode === 'sphere') {
      this.sphereCount = 2 + Math.floor(Math.random() * 3); // 2–4
    }
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';

    if (this.visible && !this.running) {
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
    this.container.classList.remove('dither-left');
    this.canvas.remove();
  }

  // ─── Color sampling ──────────────────────────────────────────

  private sampleColor(d: Uint8ClampedArray, len: number) {
    let rSum = 0, gSum = 0, bSum = 0;
    const step = 16;
    let count = 0;
    for (let i = 0; i < len; i += 4 * step) {
      rSum += d[i];
      gSum += d[i + 1];
      bSum += d[i + 2];
      count++;
    }
    if (count === 0) return;

    const r = rSum / count / 255;
    const g = gSum / count / 255;
    const b = bSum / count / 255;

    // RGB → HSL
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

    // Complementary hue (opposite side of the wheel) + neon boost
    h = (h + 0.5) % 1;
    const boostedS = 1.0;
    const boostedL = Math.max(0.5, Math.min(0.65, l * 0.8 + 0.35));

    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q2 = boostedL < 0.5
      ? boostedL * (1 + boostedS)
      : boostedL + boostedS - boostedL * boostedS;
    const p2 = 2 * boostedL - q2;

    const mr = Math.round(hue2rgb(p2, q2, h + 1/3) * 255);
    const mg = Math.round(hue2rgb(p2, q2, h) * 255);
    const mb = Math.round(hue2rgb(p2, q2, h - 1/3) * 255);
    this.midColor = `rgb(${mr},${mg},${mb})`;
  }

  // ─── Mask generation ─────────────────────────────────────────

  private generateMasks(hw: number, ch: number) {
    this.masks = [];
    const count = 6 + Math.floor(Math.random() * 6); // 6–11 rectangles
    for (let m = 0; m < count; m++) {
      const path = new Path2D();
      // Varied sizes — some large, some small, mostly covering the canvas
      const w = hw * (0.15 + Math.random() * 0.5);
      const h = ch * (0.1 + Math.random() * 0.45);
      const x = Math.random() * (hw - w * 0.3) - w * 0.15; // allow slight overflow
      const y = Math.random() * (ch - h * 0.3) - h * 0.15;
      path.rect(x, y, w, h);
      this.masks.push(path);
    }
  }

  // ─── Knockout generation (always applied) ──────────────────────

  private generateKnockout(hw: number, ch: number) {
    const clip = new Path2D();
    // 3–6 random rectangles covering ~50–75% of the pane
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const w = hw * (0.25 + Math.random() * 0.55);
      const h = ch * (0.2 + Math.random() * 0.5);
      const x = Math.random() * (hw - w * 0.5) - w * 0.1;
      const y = Math.random() * (ch - h * 0.5) - h * 0.1;
      clip.rect(x, y, w, h);
    }
    this.knockoutClip = clip;
  }

  // ─── Dither computation ──────────────────────────────────────

  /**
   * Returns parallel arrays: cellLevel[i] = 0 (black), 1 (mid), 2 (white)
   * for each cell in the offscreen grid.
   */
  private computeDither(d: Uint8ClampedArray, ow: number, oh: number): Uint8Array {
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
    return levels;
  }

  // ─── Main draw loop ──────────────────────────────────────────

  private draw = () => {
    if (!this.running) return;

    const video = this.player.activeVideo;
    if (video && video.readyState >= 2) {
      const ow = this.offscreen.width;
      const oh = this.offscreen.height;

      // Cover-fit video onto offscreen canvas
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

      // Sample color once per clip
      if (this.needsColorSample) {
        this.sampleColor(d, d.length);
        this.needsColorSample = false;
      }

      const levels = this.computeDither(d, ow, oh);

      const cw = this.container.clientWidth;
      const ch = this.container.clientHeight;
      const hw = Math.floor(cw / 2);

      const ctx = this.ctx;
      ctx.clearRect(0, 0, hw, ch);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, hw, ch);

      switch (this.mode) {
        case 'flat':
          // Knockout clip only on flat mode so it's never a full pane
          ctx.save();
          if (this.knockoutClip) ctx.clip(this.knockoutClip);
          this.drawFlat(ctx, levels, ow, oh, hw, ch);
          ctx.restore();
          break;
        case 'warp':
          this.drawWarp(ctx, levels, ow, oh, hw, ch);
          break;
        case 'mask':
          this.drawMask(ctx, levels, ow, oh, hw, ch);
          break;
        case 'grid':
          this.drawGrid(ctx, levels, ow, oh, hw, ch);
          break;
        case 'sphere':
          this.drawSphere(ctx, levels, ow, oh, hw, ch);
          break;
      }
    }

    this.rafId = requestAnimationFrame(this.draw);
  };

  // ─── Flat mode ───────────────────────────────────────────────

  private drawFlat(
    ctx: CanvasRenderingContext2D,
    levels: Uint8Array, ow: number, oh: number,
    hw: number, ch: number,
  ) {
    const cellW = hw / ow;
    const cellH = ch / oh;
    const midCoords: number[] = [];
    const whiteCoords: number[] = [];

    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const lv = levels[y * ow + x];
        if (lv === 1) midCoords.push(x, y);
        else if (lv === 2) whiteCoords.push(x, y);
      }
    }

    this.drawShapeBatch(ctx, midCoords, this.midColor, cellW, cellH, 0, 0);
    this.drawShapeBatch(ctx, whiteCoords, '#fff', cellW, cellH, 0, 0);
  }

  // ─── Warp mode (barrel distortion for depth) ────────────────

  private drawWarp(
    ctx: CanvasRenderingContext2D,
    levels: Uint8Array, ow: number, oh: number,
    hw: number, ch: number,
  ) {
    const fx = this.warpFocusX;
    const fy = this.warpFocusY;
    const k = this.warpStrength;

    // Draw each cell individually with warped position + size
    for (let lv = 1; lv <= 2; lv++) {
      ctx.fillStyle = lv === 1 ? this.midColor : '#fff';
      ctx.beginPath();

      for (let y = 0; y < oh; y++) {
        for (let x = 0; x < ow; x++) {
          if (levels[y * ow + x] !== lv) continue;

          // Normalized coords centered on focus
          const nx = (x + 0.5) / ow - fx;
          const ny = (y + 0.5) / oh - fy;
          const r2 = nx * nx + ny * ny;
          const scale = 1 + k * r2;

          // Distorted screen position
          const dx = (fx + nx / scale) * hw;
          const dy = (fy + ny / scale) * ch;
          // Distorted cell size (smaller at edges = depth)
          const dw = (hw / ow) / scale;
          const dh = (ch / oh) / scale;

          this.addShape(ctx, dx - dw / 2, dy - dh / 2, dw, dh);
        }
      }
      ctx.fill();
    }
  }

  // ─── Mask mode (asymmetric polygon cutouts) ──────────────────

  private drawMask(
    ctx: CanvasRenderingContext2D,
    levels: Uint8Array, ow: number, oh: number,
    hw: number, ch: number,
  ) {
    // Clip to the union of all mask polygons
    ctx.save();

    // Build a combined clip from all masks
    const combined = new Path2D();
    for (const mask of this.masks) {
      combined.addPath(mask);
    }
    ctx.clip(combined);

    // Draw standard flat dither within the clip
    this.drawFlat(ctx, levels, ow, oh, hw, ch);

    ctx.restore();
  }

  // ─── Grid mode (tiled repetitions) ──────────────────────────

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    levels: Uint8Array, ow: number, oh: number,
    hw: number, ch: number,
  ) {
    const cols = this.gridCols;
    const rows = this.gridRows;
    const tileW = hw / cols;
    const tileH = ch / rows;
    const cellW = tileW / ow;
    const cellH = tileH / oh;

    // Pre-sort coords once
    const midCoords: number[] = [];
    const whiteCoords: number[] = [];
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const lv = levels[y * ow + x];
        if (lv === 1) midCoords.push(x, y);
        else if (lv === 2) whiteCoords.push(x, y);
      }
    }

    // Draw for each tile
    for (let tr = 0; tr < rows; tr++) {
      for (let tc = 0; tc < cols; tc++) {
        const ox = tc * tileW;
        const oy = tr * tileH;
        this.drawShapeBatch(ctx, midCoords, this.midColor, cellW, cellH, ox, oy);
        this.drawShapeBatch(ctx, whiteCoords, '#fff', cellW, cellH, ox, oy);
      }
    }
  }

  // ─── Sphere mode (dither warped over stacked spheres) ───────

  private drawSphere(
    ctx: CanvasRenderingContext2D,
    levels: Uint8Array, ow: number, oh: number,
    hw: number, ch: number,
  ) {
    const count = this.sphereCount;
    const gap = ch * 0.02;
    const totalGap = gap * (count - 1);
    const sphereH = (ch - totalGap) / count;
    const radius = Math.min(hw, sphereH) / 2;

    for (let s = 0; s < count; s++) {
      const cx = hw / 2;
      const cy = s * (sphereH + gap) + sphereH / 2;

      // Each sphere samples a vertical slice of the dither data
      const srcYStart = Math.floor((s / count) * oh);
      const srcYEnd = Math.floor(((s + 1) / count) * oh);

      for (let lv = 1; lv <= 2; lv++) {
        ctx.fillStyle = lv === 1 ? this.midColor : '#fff';
        ctx.beginPath();

        for (let sy = srcYStart; sy < srcYEnd; sy++) {
          for (let sx = 0; sx < ow; sx++) {
            if (levels[sy * ow + sx] !== lv) continue;

            // Normalize to -1..1 within this sphere's source region
            const nx = (sx + 0.5) / ow * 2 - 1;
            const ny = ((sy - srcYStart) + 0.5) / (srcYEnd - srcYStart) * 2 - 1;

            // Discard points outside the unit circle
            const r2 = nx * nx + ny * ny;
            if (r2 > 1) continue;

            // Spherical projection: map flat coords onto sphere surface
            const z = Math.sqrt(1 - r2);
            // Use longitude/latitude for texture mapping
            const lon = Math.atan2(nx, z);
            const lat = Math.asin(ny);

            // Map back to screen coords with sphere distortion
            const px = cx + lon / (Math.PI / 2) * radius;
            const py = cy + lat / (Math.PI / 2) * radius;

            // Cell size shrinks at sphere edges (foreshortening)
            const cellScale = z;
            const cellW = (hw / ow) * cellScale;
            const cellH = (sphereH / (srcYEnd - srcYStart)) * cellScale;

            this.addShape(ctx, px - cellW / 2, py - cellH / 2, cellW, cellH);
          }
        }
        ctx.fill();
      }

      // Subtle sphere rim highlight
      ctx.save();
      ctx.strokeStyle = this.midColor;
      ctx.globalAlpha = 0.15;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ─── Shape drawing helpers ───────────────────────────────────

  /** Add a single shape to the current path (no fill — caller batches) */
  private addShape(
    ctx: CanvasRenderingContext2D,
    px: number, py: number, w: number, h: number,
  ) {
    const shape = this.shape;
    if (shape === 'circle') {
      const rx = w * 0.45;
      const ry = h * 0.45;
      const cx = px + w * 0.5;
      const cy = py + h * 0.5;
      ctx.moveTo(cx + rx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else if (shape === 'cross') {
      const armW = w * 0.28;
      const armH = h * 0.28;
      ctx.rect(px + w * 0.5 - armW, py, armW * 2, h);
      ctx.rect(px, py + h * 0.5 - armH, w, armH * 2);
    } else {
      // tall-rect
      const rw = w * 0.45;
      ctx.rect(px + (w - rw) / 2, py, rw, h);
    }
  }

  /** Draw a batch of cells as shapes at (grid x, y) + offset */
  private drawShapeBatch(
    ctx: CanvasRenderingContext2D,
    coords: number[],
    color: string,
    cellW: number, cellH: number,
    offsetX: number, offsetY: number,
  ) {
    if (coords.length === 0) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < coords.length; i += 2) {
      const px = coords[i] * cellW + offsetX;
      const py = coords[i + 1] * cellH + offsetY;
      this.addShape(ctx, px, py, cellW, cellH);
    }
    ctx.fill();
  }
}
