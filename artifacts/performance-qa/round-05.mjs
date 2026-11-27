const task=await taskSpace(20);
const {runRoute}=await import('./route.mjs');
await runRoute(task.page('p1'),'before');
