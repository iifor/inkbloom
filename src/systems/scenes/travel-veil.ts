/** A short paper-coloured dissolve. The opaque frame hides the destination being stood up. */
export class TravelVeil {
  private el: HTMLDivElement | null = null;
  show(amount: number): void {
    if (typeof document === 'undefined') return;
    if (!this.el && amount > 0) {
      this.el = document.createElement('div');
      this.el.setAttribute('aria-hidden', 'true');
      this.el.dataset.travelVeil = '';
      this.el.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:80;background:radial-gradient(ellipse at center,#fff9e7,#dae7df);opacity:0';
      document.body.append(this.el);
    }
    if (this.el) this.el.style.opacity = String(Math.max(0, Math.min(1, amount)));
  }
  dispose(): void {
    this.el?.remove();
    this.el = null;
  }
}
