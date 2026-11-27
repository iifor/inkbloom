/** The opening frame must reach the GPU before the loading screen can go away. */
export async function waitForGpuFrame(
  gl: WebGL2RenderingContext,
  yieldFrame: () => Promise<void>,
): Promise<void> {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) throw new Error('首帧渲染未能完成，请重新加载');
  gl.flush();
  const deadline = performance.now() + 15000;
  try {
    for (;;) {
      const state = gl.clientWaitSync(fence, 0, 0);
      if (state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED) return;
      if (state === gl.WAIT_FAILED || gl.isContextLost()) throw new Error('显卡连接中断，请重新加载');
      if (performance.now() > deadline) throw new Error('首帧渲染超时，请重新加载');
      await yieldFrame();
    }
  } finally {
    gl.deleteSync(fence);
  }
}
