import type { Stream, Synth } from '@/engine/audio/synth';

const FADE = 4;
const LOAD_TIMEOUT = 15;
const RETRY_DELAY = 60;

interface Voice {
  url: string;
  stream: Stream;
  started: number;
}

/** Two streaming voices overlap at a mood change or file boundary; the synth covers failures. */
export class MusicBed {
  private current: Voice | null = null;
  private pending: Voice | null = null;
  private readonly retryAt = new Map<string, number>();

  constructor(private readonly synth: Synth) {}

  update(url: string, level: number): boolean {
    const now = this.synth.now;
    if (this.pending && this.pending.url !== url) {
      this.pending.stream.stop(0);
      this.pending = null;
    }
    if (this.current?.stream.over) {
      if (this.current.stream.remaining > 0) this.retryAt.set(this.current.url, now + RETRY_DELAY);
      this.current.stream.stop(0);
      this.current = null;
    }
    if (this.pending && (this.pending.stream.over || now - this.pending.started > LOAD_TIMEOUT)) {
      this.retryAt.set(this.pending.url, now + RETRY_DELAY);
      this.pending.stream.stop(0);
      this.pending = null;
    }
    // Do not keep a previous mood playing indefinitely when its replacement cannot load.
    if (this.current && this.current.url !== url && (this.retryAt.get(url) ?? 0) > now) {
      this.current.stream.stop(FADE);
      this.current = null;
    }
    const replace = !this.current || this.current.url !== url || this.current.stream.remaining <= FADE + 1;
    if (!this.pending && replace && now >= (this.retryAt.get(url) ?? 0)) {
      this.pending = {
        url,
        started: now,
        stream: this.synth.stream(import.meta.env.BASE_URL + url, {
          loop: false,
          gain: 0.55,
          bus: 'music',
        }),
      };
    }
    if (this.pending?.stream.playing) {
      this.current?.stream.stop(FADE);
      this.current = this.pending;
      this.pending = null;
    }
    this.current?.stream.set(level, FADE);
    return this.current?.stream.playing ?? false;
  }

  dispose(): void {
    this.current?.stream.stop(0);
    this.pending?.stream.stop(0);
    this.current = this.pending = null;
  }
}
