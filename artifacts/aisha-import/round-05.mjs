const task = await taskSpace(11);
const page = task.page('p1');
await page.goto('https://aishasound.com/public-libraries/126-countryside-samples', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector("loc=role:button[name='Download all (Zip)']", { state: 'visible' });
const pending = page.waitForEvent('download', { timeout: 30000 }).catch(e => ({ error: String(e) }));
await page.click("loc=role:button[name='Download all (Zip)']");
const download = await pending;
if (!download.error) {
  await download.saveAs('C:/Users/Administrator/Desktop/inkbloom/art/audio/aisha/source/countryside-samples.zip');
  console.log({ downloaded: download.suggestedFilename() });
} else console.log(download);
console.log(await page.snapshot());
