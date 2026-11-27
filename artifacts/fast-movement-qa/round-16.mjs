const task=await taskSpace(21),page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`
window.requestAnimationFrame=fn=>setTimeout(()=>fn(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);
window.__shaderWaits=[];
const original=WebGL2RenderingContext.prototype.getProgramInfoLog;
WebGL2RenderingContext.prototype.getProgramInfoLog=function(program){const t=performance.now();const result=original.call(this,program);const ms=performance.now()-t;if(ms>5)window.__shaderWaits.push({ms,shaders:this.getAttachedShaders(program).map(s=>this.getShaderSource(s))});return result;};
`});
await page.goto('http://127.0.0.1:5190/?world=shader-cold-20261127&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom,undefined,{timeout:60000});
await page.evaluate(async()=>{inkbloom.game.loop.stop();inkbloom.game.ctx.player.position.set(1108,80,171.88);for(let n=0;n<450;n++){inkbloom.step();if(n%5===0)await new Promise(r=>setTimeout(r,0));}window.__shaderWaits=[];});
const {profileRoute}=await import('./profile.mjs');
await profileRoute(page,'shader-short',{x:1108,z:171.88,dx:0,dz:-.9,frames:150});
const shaders=await page.evaluate(()=>window.__shaderWaits);
const fs=await import('node:fs/promises');await fs.writeFile('C:/Users/Administrator/Desktop/inkbloom/artifacts/fast-movement-qa/shader-waits.json',JSON.stringify(shaders,null,2));console.log(shaders.map(s=>({ms:s.ms,defines:s.shaders.map(t=>t.match(/^#define .*$/gm))})));
