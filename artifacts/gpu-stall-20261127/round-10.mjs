const task=await taskSpace(4),page=task.page('p1');
const {flightCheck}=await import('./flight-check.mjs');
await flightCheck(page,{name:'verified60-gpu-duration',fixedBuffer:true,queries:true});
console.log(await page.evaluate(()=>{const a=Object.values(flightCheckResult.gpuByFrame).sort((a,b)=>a-b);return {gpuFrames:a.length,gpuP50:a[Math.floor(a.length*.5)],gpuP95:a[Math.floor(a.length*.95)],gpuP99:a[Math.floor(a.length*.99)],gpuMax:a.at(-1),gpuOver50:a.filter(v=>v>50).length,programs:flightCheckResult.programs.map(p=>({frame:p.frame,headers:p.shaders.map(s=>s.split('\n').filter(l=>/^#define/.test(l)).slice(0,25))}))};}));
const canvas=await page.evaluate(()=>{inkbloom.ctx.renderer.render();return inkbloom.ctx.renderer.renderer.domElement.toDataURL('image/png');});
await (await import('node:fs/promises')).writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/gpu-stall-20261127/flight-final.png',Buffer.from(canvas.split(',')[1],'base64'));
