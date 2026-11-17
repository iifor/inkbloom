// GPU time per render pass while profiling (dev tools), measured with the GPU's own timer
// queries, which answer a frame or two late.
import type * as THREE from 'three';

export class PassTimer {
  /** GPU milliseconds per pass, summed over the frames measured (`frames`); null when not
   * profiling. */
  times: Map<string, number> | null = null;
  frames = 0;
  private readonly pending: { name: string; query: WebGLQuery; last: boolean }[] = [];
  private current: { name: string; query: WebGLQuery } | null = null;
  private timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null | undefined;

  /** End the pass being timed, if any, and start timing `next` (null: the frame is done). */
  pass(renderer: THREE.WebGLRenderer, next: string | null): void {
    if (!this.times) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (this.timer === undefined) this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const ext = this.timer;
    if (!ext) return;
    if (this.current) {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this.pending.push({ ...this.current, last: next === null });
      this.current = null;
    }
    if (next) {
      const query = gl.createQuery()!;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      this.current = { name: next, query };
    }
    // collect what the GPU has answered
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length && gl.getQueryParameter(this.pending[0]!.query, gl.QUERY_RESULT_AVAILABLE)) {
      const done = this.pending.shift()!;
      if (!disjoint) {
        const ms = (gl.getQueryParameter(done.query, gl.QUERY_RESULT) as number) / 1e6;
        this.times.set(done.name, (this.times.get(done.name) ?? 0) + ms);
        if (done.last) this.frames++;
      }
      gl.deleteQuery(done.query);
    }
  }
}
