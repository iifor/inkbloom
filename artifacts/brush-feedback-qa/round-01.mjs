const task=await taskSpace('InkBloom brush feedback validation');
const page=task.page('p1');
await page.goto('http://127.0.0.1:5192/artifacts/brush-feedback-qa/page.html',{waitUntil:'domcontentloaded'});
console.log({taskSpaceId:task.spaceId});
await page.waitForFunction(()=>window.qa?.ready,undefined,{timeout:20000});
console.log(await page.snapshot());
console.log(await page.evaluate(()=>({errors:window.qa.errors,frames:window.qa.frames,models:window.qa.renderer.camera.getObjectByName('walking-hands').children.map(c=>c.name)})));
console.log(await page.screenshot({path:'C:/Users/Administrator/Desktop/inkbloom/artifacts/brush-feedback-qa/restore.png'}));
