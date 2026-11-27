import type { Settings } from '@/world/settings';
import { StartupMusic } from './startup-music';

/** Ease towards completed work only; a single short completion transition owns dismissal. */
export class StartupScreen {
  private shown = 0;
  private target = 0;
  private frame = 0;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private last = 0;
  private closed = false;
  private finishing = false;
  private finishStart = 0;
  private finishFrom = 0;
  private completion: Promise<void> | undefined;
  private resolveFinish: (() => void) | undefined;
  private dismissTimer: ReturnType<typeof setTimeout> | undefined;
  private fadeTimer: ReturnType<typeof setTimeout> | undefined;
  private music: StartupMusic | undefined;
  private readonly progress: HTMLProgressElement;
  private readonly number: HTMLElement;
  private readonly status: HTMLElement;
  private readonly message: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    this.progress = root.querySelector<HTMLProgressElement>('#startup-progress')!;
    this.number = root.querySelector<HTMLElement>('#startup-percent')!;
    this.status = root.querySelector<HTMLElement>('#startup-status')!;
    this.message = root.querySelector<HTMLElement>('#startup-message')!;
  }

  startMusic(settings: Pick<Settings, 'volume' | 'music'>): void {
    const button = this.root.querySelector<HTMLButtonElement>('#startup-sound');
    if (!this.music && !this.root.hidden && button) this.music = new StartupMusic(button, settings);
  }

  update(fraction: number, label: string): void {
    if (this.closed || this.finishing || !Number.isFinite(fraction)) return;
    this.target = Math.max(this.target, Math.min(99, fraction * 100));
    this.root.dataset.target = this.target.toFixed(3);
    if (this.status.textContent !== label) this.status.textContent = label;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.shown = this.target;
      this.paint();
      return;
    }
    this.schedule();
  }

  private paint(): void {
    const percent = this.shown >= 100 ? 100 : Math.floor(this.shown);
    const phase = percent === 100 ? 'ready' : percent >= 45 ? 'colour' : percent >= 15 ? 'brush' : 'ink';
    this.root.style.setProperty('--startup-progress', `${this.shown.toFixed(3)}%`);
    this.root.dataset.phase = phase;
    this.progress.value = this.shown;
    this.number.textContent = `${percent}%`;
    const message = {
      ink: '一滴墨，落在纸上…',
      brush: '画笔醒了，颜色也醒了…',
      colour: '正在为世界添上颜色…',
      ready: '世界已醒来，出发吧',
    }[phase];
    if (this.message.textContent !== message) this.message.textContent = message;
  }

  private schedule(): void {
    if (this.frame || this.tickTimer !== undefined || this.closed) return;
    const tick = (now: number) => {
      cancelAnimationFrame(this.frame);
      clearTimeout(this.tickTimer);
      this.tickTimer = undefined;
      this.tick(now);
    };
    this.frame = requestAnimationFrame(tick);
    // Occluded windows can throttle RAF to 1 Hz even while visibilityState is "visible".
    this.tickTimer = setTimeout(() => tick(performance.now()), 50);
  }

  private tick(now: number): void {
    this.frame = 0;
    if (this.closed) return;
    if (this.finishing) {
      const t = Math.min(1, (now - this.finishStart) / 180);
      this.shown = this.finishFrom + (100 - this.finishFrom) * (1 - (1 - t) ** 3);
      if (t === 1) {
        this.shown = 100;
        this.paint();
        this.root.classList.add('is-leaving');
        this.fadeTimer = setTimeout(() => this.hide(), 180);
        return;
      }
    } else {
      const dt = this.last ? Math.min(64, now - this.last) : 16;
      this.shown += (this.target - this.shown) * (1 - Math.exp(-dt / 110));
      if (this.target - this.shown < 0.02) this.shown = this.target;
    }
    this.last = now;
    this.paint();
    if (this.finishing || this.shown < this.target) this.schedule();
  }

  /** Called only after all required work, the actual player model and the first GPU frame are ready. */
  finish(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.completion) return this.completion;
    this.completion = new Promise((resolve) => {
      this.resolveFinish = resolve;
    });
    this.finishing = true;
    this.finishStart = performance.now();
    this.finishFrom = this.shown;
    this.target = 100;
    this.root.dataset.target = '100';
    this.status.textContent = '加载完成';
    this.music?.stop(360);
    this.root.setAttribute('aria-busy', 'false');
    this.root.inert = true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.shown = 100;
      this.paint();
      this.hide();
    } else {
      this.schedule();
      // Hidden tabs may suspend RAF; they must not hold the game or music indefinitely.
      this.dismissTimer = setTimeout(() => {
        this.shown = 100;
        this.paint();
        this.hide();
      }, 420);
    }
    return this.completion;
  }

  hide(): void {
    this.closed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    this.music?.stop();
    clearTimeout(this.dismissTimer);
    clearTimeout(this.fadeTimer);
    this.root.hidden = true;
    this.root.setAttribute('aria-busy', 'false');
    this.resolveFinish?.();
    this.resolveFinish = undefined;
  }
}
