import { serve } from '../../server/serve';
import { WorldHost } from '../../src/world/net/host';
import { createWorldState } from '../../src/world/state';
import { createWilderness } from '../../src/world/wilderness/generator';
import { defaultLook } from '../../src/content/characters';
import { PROTOCOL, GROUNDED } from '../../src/world/net/protocol';
import WebSocket from 'ws';

const world = createWorldState('friends-qa-only', 11);
const host = new WorldHost(world);
const server = await serve(host, { port: 5196, bind: '127.0.0.1' });
const land = createWilderness(11);
let x = 2000;
while (land.heightAt(x, 0) < 2) x += 10;
const y = land.heightAt(x, 0) + 0.1;
const bot = new WebSocket(`ws://127.0.0.1:${server.port}`);
let ready = false;
bot.on('open', () => bot.send(JSON.stringify({ t: 'hello', v: PROTOCOL,
  token: 'friends-qa-bot-20261123', name: '远方的纸鸢', look: defaultLook('courier') })));
bot.on('message', (raw) => {
  if (JSON.parse(raw.toString()).t === 'welcome') ready = true;
});
const timer = setInterval(() => {
  if (ready) bot.send(JSON.stringify({ t: 'move', p: [x, y, 0], v: [0, 0, 0],
    yaw: 0, pitch: 0, f: GROUNDED, scene: { kind: 'wild' }, town: null }));
}, 100);
console.log(JSON.stringify({ port: server.port, friend: [x, y, 0] }));
process.once('SIGINT', async () => { clearInterval(timer); bot.close(); await server.close(); process.exit(); });
