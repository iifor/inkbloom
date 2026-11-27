import {measure} from './profile.mjs';
const task=await taskSpace(3),page=task.page('p1');
await page.evaluate(()=>{const api=window.inkbloom;if(api){api.game.dispose();api.ctx.renderer.renderer.forceContextLoss();}});
await page.goto('about:blank');
await page.cdp('HeapProfiler.collectGarbage');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=performance-20261127b-clean-context&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:60000});
await measure(page,'clean-context-fast');
