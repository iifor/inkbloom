// Keyboard and mouse as named actions. Gameplay reads held()/pressed() and look deltas.
// When pointer lock is unavailable (embedded browsers), dragging with a mouse button held
// turns the camera so the game is still drivable.
import { type Action, KEYS, MOUSE } from '@/content/bindings';

export class Input {
  private readonly down = new Set<Action>();
  private readonly prev = new Set<Action>();
  private readonly cur = new Set<Action>();
  private readonly queued = new Set<Action>();
  private lookX = 0;
  private lookY = 0;
  private wheelSteps = 0;
  private dragging = false;
  pointerLocked = false;
  sensitivity = 0.0022;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    signal: AbortSignal,
  ) {
    const on = <K extends keyof WindowEventMap>(
      target: Window | Document | HTMLElement,
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts: AddEventListenerOptions = {},
    ): void => target.addEventListener(type, fn as EventListener, { ...opts, signal });
    const isControl = (t: EventTarget | null): boolean =>
      t instanceof Element && !!t.closest('input, select, textarea, button, [contenteditable]');

    on(window, 'keydown', (e) => {
      if (isControl(e.target)) return;
      const a = KEYS[e.code];
      if (!a) return;
      if (!e.repeat) this.press(a);
      if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code.startsWith('F')) e.preventDefault();
    });
    on(window, 'keyup', (e) => {
      const a = KEYS[e.code];
      if (a) this.down.delete(a);
    });
    on(window, 'blur', () => this.clear());
    on(canvas, 'mousedown', (e) => {
      const a = MOUSE[e.button];
      if (a) this.press(a);
      if (!this.pointerLocked) this.dragging = true;
    });
    on(window, 'mouseup', (e) => {
      const a = MOUSE[e.button];
      if (a) this.down.delete(a);
      this.dragging = false;
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(document, 'mousemove', (e) => {
      if (!this.pointerLocked && !this.dragging) return;
      this.lookX += Math.max(-400, Math.min(400, e.movementX));
      this.lookY += Math.max(-400, Math.min(400, e.movementY));
    });
    on(
      canvas,
      'wheel',
      (e) => {
        this.wheelSteps += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener(
      'pointerlockchange',
      () => {
        this.pointerLocked = document.pointerLockElement === canvas;
        if (!this.pointerLocked) this.clear();
        this.onLockChange?.(this.pointerLocked);
      },
      { signal },
    );
  }

  private press(a: Action): void {
    this.down.add(a);
    this.queued.add(a);
  }

  /** Call once per frame before systems read input. */
  update(): void {
    this.prev.clear();
    for (const a of this.cur) this.prev.add(a);
    this.cur.clear();
    for (const a of this.down) this.cur.add(a);
    // taps shorter than a frame still count as one press
    for (const a of this.queued) this.cur.add(a);
    this.queued.clear();
  }

  held(a: Action): boolean {
    return this.cur.has(a);
  }

  pressed(a: Action): boolean {
    return this.cur.has(a) && !this.prev.has(a);
  }

  /** Accumulated look delta in radians since the last call. */
  takeLook(): { yaw: number; pitch: number } {
    const out = { yaw: -this.lookX * this.sensitivity, pitch: -this.lookY * this.sensitivity };
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  takeWheel(): number {
    const w = this.wheelSteps;
    this.wheelSteps = 0;
    return w;
  }

  /** Inject an action for one frame (debug tooling and tests). */
  tap(a: Action): void {
    this.queued.add(a);
  }

  setHeld(a: Action, on: boolean): void {
    if (on) this.down.add(a);
    else this.down.delete(a);
  }

  async requestLock(): Promise<boolean> {
    try {
      await this.canvas.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  clear(): void {
    this.down.clear();
    this.queued.clear();
    this.dragging = false;
  }
}
