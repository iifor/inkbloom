const task = await taskSpace(12);
const page = task.page('p1');
await page.goto('http://localhost:5190/?server=127.0.0.1:5297');
const other = await task.newPage();
console.log(other.id);
await other.goto('http://127.0.0.1:5190/?server=127.0.0.1:5297');
console.log(await page.snapshot());
console.log(await other.snapshot());
