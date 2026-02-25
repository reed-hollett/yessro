/**
 * Timecode burn-in overlay.
 * Shows running HH:MM:SS:FF in a monospace font, top-left corner,
 * synced to audio playback time. Production dailies aesthetic.
 */

const FPS = 30;

export class TimecodeOverlay {
  private el: HTMLDivElement;
  private audioCtx: AudioContext;
  private startTime: number;
  private visible = false;
  private rafId = 0;
  private running = false;

  constructor(container: HTMLElement, audioCtx: AudioContext, startTime: number) {
    this.audioCtx = audioCtx;
    this.startTime = startTime;

    this.el = document.createElement('div');
    this.el.className = 'timecode-overlay';
    this.el.style.display = 'none';
    this.el.textContent = '00:00:00:00';
    container.appendChild(this.el);
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';

    if (this.visible && !this.running) {
      this.running = true;
      this.tick();
    } else if (!this.visible) {
      this.running = false;
      cancelAnimationFrame(this.rafId);
    }

    return this.visible;
  }

  destroy() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.el.remove();
  }

  private tick = () => {
    if (!this.running) return;

    const elapsed = Math.max(0, this.audioCtx.currentTime - this.startTime);
    const totalFrames = Math.floor(elapsed * FPS);
    const ff = totalFrames % FPS;
    const totalSec = Math.floor(elapsed);
    const ss = totalSec % 60;
    const mm = Math.floor(totalSec / 60) % 60;
    const hh = Math.floor(totalSec / 3600);

    this.el.textContent =
      pad(hh) + ':' + pad(mm) + ':' + pad(ss) + ':' + pad(ff);

    this.rafId = requestAnimationFrame(this.tick);
  };
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}
