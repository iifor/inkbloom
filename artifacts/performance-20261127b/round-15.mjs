import {measure} from './profile.mjs';
const task=await taskSpace(3),page=task.page('p1');
await page.cdp('Page.addScriptToEvaluateOnNewDocument',{source:`window.requestAnimationFrame=cb=>setTimeout(()=>cb(performance.now()),16);window.cancelAnimationFrame=id=>clearTimeout(id);`});
await page.goto('http://127.0.0.1:5192/?world=performance-20261127b-byte-skin&seed=4242');
await page.waitForFunction(()=>!!window.inkbloom?.ctx,undefined,{timeout:60000});
await measure(page,'byte-skin-fast');
