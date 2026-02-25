/**
 * CRT scan line overlay.
 * Full-screen repeating horizontal lines via CSS gradient.
 * Zero performance cost — pure CSS, no canvas.
 */

export class ScanlinesOverlay {
  private el: HTMLDivElement;
  private visible = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'scanlines-overlay';
    this.el.style.display = 'none';
    container.appendChild(this.el);
  }

  toggle(): boolean {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    return this.visible;
  }

  destroy() {
    this.el.remove();
  }
}
