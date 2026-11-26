const task = await taskSpace(10);
const page = task.page('p1');
for (const url of ['https://aishasound.com/public-libraries/126-countryside-samples', 'https://aishasound.com/public-libraries/883-rain-thunder-sound-pack', 'https://aishasound.com/audio-license']) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('Library info') || document.body.innerText.includes('License Agreement\n'), undefined, { timeout: 10000 });
  console.log({ url, text: await page.evaluate(() => document.body.innerText.slice(0, 22000)) });
}
