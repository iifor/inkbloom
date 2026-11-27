import type { Loop } from '@/game/loop';
import type { InkRenderer } from '@/engine/render/renderer';

/** Profile at presentation cadence. Hidden panes use a paced 60 Hz simulation, not a
 * throughput loop that can fill the GPU command queue and manufacture long stalls. */
export async function profileLoop(loop: Loop, renderer: InkRenderer, seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Profile duration must be positive');
  const ticking = await new Promise<boolean>((done) => {
    const frame = requestAnimationFrame(() => {
      clearTimeout(timeout);
      done(true);
    });
    const timeout = setTimeout(() => {
      cancelAnimationFrame(frame);
      done(false);
    }, 300);
  });
  const running = loop.isRunning;
  const manual = document.hidden || !ticking || !running;
  const cpu = new Map<string, number>();
  const gpu = new Map<string, number>();
  let frames = 0;
  let calls = 0;
  let triangles = 0;
  if (manual) loop.stop();
  loop.profile = cpu;
  renderer.passTimes = gpu;
  const start = performance.now();
  let last = start;
  let next = start + 1000 / 60;
  try {
    await new Promise<void>((done, reject) => {
      const count = (): void => {
        try {
          const now = performance.now();
          if (manual) {
            // Timers can fire early; never catch up by issuing several frames at once.
            if (now < next) {
              setTimeout(count, next - now);
              return;
            }
            loop.step(Math.min(0.05, (now - last) / 1000));
          }
          last = now;
          next = now + 1000 / 60;
          frames++;
          const info = renderer.renderer.info.render;
          calls += info.calls;
          triangles += info.triangles;
          if (performance.now() - start >= seconds * 1000) done();
          else if (manual) setTimeout(count, Math.max(0, next - performance.now()));
          else requestAnimationFrame(count);
        } catch (error) {
          reject(error);
        }
      };
      if (manual) setTimeout(count, 1000 / 60);
      else requestAnimationFrame(count);
    });
  } finally {
    loop.profile = null;
    renderer.passTimes = null;
    if (manual && running) loop.start();
  }
  return { cpu, gpu, frames, calls, triangles, manual, elapsedMs: performance.now() - start };
}
