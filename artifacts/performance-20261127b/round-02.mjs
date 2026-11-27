import {measure} from './profile.mjs';
const task=await taskSpace(3),page=task.page('p1');
await measure(page,'before-fast');
