/**
 * Strobe overlay.
 * Full-screen white flash on every beat cut, fades out quickly.
 */

export class StrobeOverlay {
  private el: HTMLDivElement;
  private enabled = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'strobe-overlay';
    container.appendChild(this.el);
  }

  /** Call on every clip swap — flashes if enabled */
  flash() {
    if (!this.enabled) return;
    this.el.style.opacity = '1';
    // Force reflow so the transition triggers from 1 → 0
    this.el.offsetHeight;
    this.el.style.opacity = '0';
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  destroy() {
    this.el.remove();
  }
}
