import { serve } from '../../server/serve';
import { WorldHost } from '../../src/world/net/host';
import { createWorldState } from '../../src/world/state';
const server = await serve(new WorldHost(createWorldState('rest-qa-only', 11)), { port: 5297, bind: '127.0.0.1' });
console.log({ port: server.port });
process.once('SIGINT', async () => { await server.close(); process.exit(); });
