import type { Settings } from '@/world/settings';

/** Loading music lives outside the world and never holds up its preparation. */
export class StartupMusic {
  private audio: HTMLAudioElement | null = null;
  private wanted = false;
  private stopped = false;
  private attempt = 0;
  private fade: ReturnType<typeof setInterval> | undefined;
  private readonly leave = (): void => this.stop();

  constructor(
    private readonly button: HTMLButtonElement,
    settings: Pick<Settings, 'volume' | 'music'>,
  ) {
    const volume = settings.volume * settings.music * 0.65;
    if (volume <= 0) return;
    const audio = new Audio(`${import.meta.env.BASE_URL}sounds/music/inkbloom-loading.mp3`);
    audio.preload = 'auto';
    audio.loop = true;
    audio.volume = volume;
    audio.onerror = () => this.stop();
    this.audio = audio;
    button.hidden = false;
    button.onclick = () => {
      if (this.wanted) {
        this.wanted = false;
        this.attempt++;
        audio.pause();
        this.label();
      } else void this.play();
    };
    window.addEventListener('pagehide', this.leave);
    void this.play();
  }

  private label(): void {
    this.button.textContent = this.wanted ? '关闭音乐' : '开启音乐';
    this.button.setAttribute('aria-pressed', String(this.wanted));
  }

  private async play(): Promise<void> {
    const audio = this.audio;
    if (!audio || this.stopped) return;
    const attempt = ++this.attempt;
    this.wanted = true;
    this.label();
    try {
      await audio.play();
      // A pending autoplay attempt must not restart music after dismissal or a mute click.
      if (this.stopped || !this.wanted) audio.pause();
    } catch {
      if (this.stopped || attempt !== this.attempt) return;
      this.wanted = false;
      this.label();
    }
  }

  stop(fadeMs = 0): void {
    if (this.stopped) {
      if (!fadeMs) this.release();
      return;
    }
    this.stopped = true;
    this.wanted = false;
    this.attempt++;
    this.button.hidden = true;
    this.button.onclick = null;
    const audio = this.audio;
    if (!audio || audio.paused || fadeMs <= 0) {
      this.release();
      return;
    }
    const started = performance.now();
    const volume = audio.volume;
    this.fade = setInterval(() => {
      const left = Math.max(0, 1 - (performance.now() - started) / fadeMs);
      audio.volume = volume * left;
      if (!left) this.release();
    }, 32);
  }

  private release(): void {
    clearInterval(this.fade);
    window.removeEventListener('pagehide', this.leave);
    const audio = this.audio;
    this.audio = null;
    if (!audio) return;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
}
