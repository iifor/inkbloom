const task = await taskSpace(11);
const page = task.page('p1');
const pending = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
await page.click('@20');
const download = await pending;
if (download) {
  await download.saveAs('C:/Users/Administrator/Desktop/inkbloom/art/audio/aisha/source/countryside-samples.zip');
  console.log({ downloaded: download.suggestedFilename() });
}
console.log(await page.snapshot({ scope: 'full_page' }));
