/** Work weights, not elapsed-time estimates. Only reported, completed work advances the target. */
const TASKS = {
  world: [4, '正在准备世界'],
  textures: [12, '正在加载纹理'],
  character: [6, '正在准备玩家角色'],
  sounds: [8, '正在准备音效'],
  terrain: [32, '正在生成附近地形'],
  landscape: [12, '正在准备远景'],
  grass: [12, '正在铺设草地与花丛'],
  shaders: [8, '正在预热画面效果'],
  frame: [6, '正在准备进入游戏'],
} as const;

export type LoadingTask = keyof typeof TASKS;
export type WorkProgress = (done: number, total: number) => void;

export class LoadingProgress {
  private readonly work = new Map<LoadingTask, { fraction: number; done: number; total: number }>();
  private current: LoadingTask = 'world';
  private lastLabel = '';
  private lastFraction = -1;
  private waiting: readonly LoadingTask[] | undefined;

  constructor(private readonly changed: (fraction: number, label: string) => void) {}

  get ready(): boolean {
    return (Object.keys(TASKS) as LoadingTask[]).every((key) => this.work.get(key)?.fraction === 1);
  }

  focus(key: LoadingTask): void {
    this.waiting = undefined;
    this.current = key;
    this.emit();
  }

  waitingFor(keys: readonly LoadingTask[]): void {
    this.waiting = keys;
    this.emit();
  }

  report(key: LoadingTask, done: number, total = 1): void {
    if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return;
    const fraction = Math.min(1, Math.max(0, done / total));
    if (fraction < (this.work.get(key)?.fraction ?? 0)) return;
    this.work.set(key, { fraction, done: Math.min(total, Math.max(0, done)), total });
    this.emit();
  }

  track(key: LoadingTask): WorkProgress {
    return (done, total) => this.report(key, done, total);
  }

  private emit(): void {
    this.current = this.waiting?.find((key) => this.work.get(key)?.fraction !== 1) ?? this.current;
    const keys = Object.keys(TASKS) as LoadingTask[];
    const fraction =
      keys.reduce((sum, key) => sum + TASKS[key][0] * (this.work.get(key)?.fraction ?? 0), 0) / 100;
    const work = this.work.get(this.current);
    const count = work && work.total > 1 ? ` ${Math.floor(work.done)}/${work.total}` : '…';
    const label = TASKS[this.current][1] + count;
    if (fraction === this.lastFraction && label === this.lastLabel) return;
    this.lastFraction = fraction;
    this.lastLabel = label;
    this.changed(fraction, label);
  }
}

/** Yield to rendering, but keep preparing a hidden tab if animation frames are suspended. */
export function loadingFrame(): Promise<void> {
  return new Promise((resolve) => {
    let frame = 0;
    const done = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 50);
    frame = requestAnimationFrame(done);
  });
}
