// GPU time per render pass while profiling (dev tools), measured with the GPU's own timer
// queries, which answer a frame or two late.
import type * as THREE from 'three';

export class PassTimer {
  /** GPU milliseconds per pass, summed over the frames measured (`frames`); null when not
   * profiling. */
  private totals: Map<string, number> | null = null;
  frames = 0;
  private readonly pending: { name: string; query: WebGLQuery }[][] = [];
  private frame: { name: string; query: WebGLQuery }[] | null = null;
  private inFrame = false;
  private current: { name: string; query: WebGLQuery } | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined;

  get times(): Map<string, number> | null {
    return this.totals;
  }

  set times(times: Map<string, number> | null) {
    if (times === this.totals) return;
    this.collect();
    this.dispose();
    this.totals = times;
    if (times) this.frames = 0;
  }

  /** Read only complete frames, once per frame, without waiting for the GPU. */
  private collect(): void {
    const gl = this.gl;
    if (!gl || !this.timer || !this.totals || !this.pending.length) return;
    if (gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
      for (const frame of this.pending) for (const pass of frame) gl.deleteQuery(pass.query);
      this.pending.length = 0;
      return;
    }
    while (this.pending.length) {
      const frame = this.pending[0]!;
      if (!gl.getQueryParameter(frame[frame.length - 1]!.query, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      for (const pass of frame) {
        const ms = (gl.getQueryParameter(pass.query, gl.QUERY_RESULT) as number) / 1e6;
        this.totals.set(pass.name, (this.totals.get(pass.name) ?? 0) + ms);
        gl.deleteQuery(pass.query);
      }
      this.frames++;
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (gl) {
      if (this.current) {
        gl.endQuery(this.timer!.TIME_ELAPSED_EXT);
        gl.deleteQuery(this.current.query);
      }
      if (this.frame) for (const pass of this.frame) gl.deleteQuery(pass.query);
      for (const frame of this.pending) for (const pass of frame) gl.deleteQuery(pass.query);
    }
    this.current = null;
    this.frame = null;
    this.inFrame = false;
    this.pending.length = 0;
    this.totals = null;
  }

  /** End the pass being timed, if any, and start timing `next` (null: the frame is done). */
  pass(renderer: THREE.WebGLRenderer, next: string | null): void {
    if (!this.times) return;
    const gl = (this.gl = renderer.getContext() as WebGL2RenderingContext);
    if (this.timer === undefined) this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const ext = this.timer;
    if (!ext) return;
    if (!this.inFrame) {
      if (!next) return;
      this.collect();
      // A busy GPU must not turn profiling into an unbounded queue of query objects.
      this.frame = this.pending.length < 4 ? [] : null;
      this.inFrame = true;
    }
    if (this.current) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.frame!.push(this.current);
      this.current = null;
    }
    if (next && this.frame) {
      const query = gl.createQuery();
      if (query) {
        gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
        this.current = { name: next, query };
      } else {
        for (const pass of this.frame) gl.deleteQuery(pass.query);
        this.frame = null;
      }
    } else if (!next) {
      if (this.frame?.length) this.pending.push(this.frame);
      this.frame = null;
      this.inFrame = false;
    }
  }
}
