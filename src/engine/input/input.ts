// Keyboard and mouse as named actions. Gameplay reads held()/pressed() and look deltas.
// When pointer lock is unavailable (embedded browsers), dragging with a mouse button held
// turns the camera so the game is still drivable.
import { type Action, KEYS, MOUSE } from '@/content/bindings';

export class Input {
  private readonly down = new Set<Action>();
  private readonly cur = new Set<Action>();
  /** Presses (keydown, click, tap) since the last frame; this frame's pressed() set. */
  private readonly fresh = new Set<Action>();
  private readonly queued = new Set<Action>();
  private lookX = 0;
  private lookY = 0;
  private wheelSteps = 0;
  private dragging = false;
  private awaitingCanvas = false;
  private releasingLock = false;
  pointerLocked = false;
  sensitivity = 0.0022;
  onLockChange: ((locked: boolean) => void) | null = null;
  onPause: (() => void) | null = null;

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
      if (e.code === 'KeyU' && this.pointerLocked) {
        e.preventDefault();
        this.exitLock();
        return;
      }
      const a = KEYS[e.code];
      if (!a) return;
      if (a === 'pause') {
        if (!e.repeat) this.onPause?.();
        return;
      }
      if (this.awaitingCanvas) return;
      if (!e.repeat) this.press(a);
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow') || e.code.startsWith('F'))
        e.preventDefault();
    });
    on(window, 'keyup', (e) => {
      const a = KEYS[e.code];
      if (a) this.down.delete(a);
    });
    on(window, 'blur', () => {
      this.clear();
      this.exitLock();
    });
    on(canvas, 'mousedown', (e) => {
      if (this.awaitingCanvas) {
        if (e.button === 0) {
          this.awaitingCanvas = false;
          this.canvas.focus();
          void this.requestLock();
        }
        return;
      }
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
        if (this.awaitingCanvas) return;
        this.wheelSteps += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    document.addEventListener(
      'pointerlockchange',
      () => {
        const wasLocked = this.pointerLocked;
        this.pointerLocked = document.pointerLockElement === canvas;
        if (this.pointerLocked) this.awaitingCanvas = false;
        else if (wasLocked) {
          const released = this.releasingLock;
          this.releasingLock = false;
          this.awaitingCanvas = true;
          this.clear();
          // A browser can handle Escape itself and send only pointerlockchange.
          // Check focus after the event so switching windows does not open the menu.
          if (!released)
            setTimeout(() => {
              if (!signal.aborted && this.awaitingCanvas && document.hasFocus() && !document.hidden)
                this.onPause?.();
            }, 0);
        }
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
    this.cur.clear();
    for (const a of this.down) this.cur.add(a);
    // every press event counts once, even a tap shorter than a frame or two taps in a row
    this.fresh.clear();
    for (const a of this.queued) {
      this.fresh.add(a);
      this.cur.add(a);
    }
    this.queued.clear();
  }

  /** Take a press away from later readers this frame (a panel that owns some keys while open). */
  consume(a: Action): boolean {
    const was = this.pressed(a);
    this.fresh.delete(a);
    this.cur.delete(a);
    return was;
  }

  held(a: Action): boolean {
    return this.cur.has(a);
  }

  pressed(a: Action): boolean {
    return this.fresh.has(a);
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
    this.awaitingCanvas = false;
    try {
      await this.canvas.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }

  exitLock(): void {
    if (document.pointerLockElement !== this.canvas) return;
    this.releasingLock = true;
    document.exitPointerLock();
  }

  clear(): void {
    this.down.clear();
    this.cur.clear();
    this.fresh.clear();
    this.queued.clear();
    this.dragging = false;
    this.lookX = this.lookY = this.wheelSteps = 0;
  }
}
