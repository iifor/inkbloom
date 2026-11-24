// VERSION and FILES are supplied by the release build. The worker is installed
// only after all assets have passed the browser's Subresource Integrity check.
const scope = self.registration.scope;
const prefix = 'inkbloom-release:' + scope + ':';
const name = prefix + VERSION;
const entry = new URL('./', scope).href;
const assets = new Map(FILES.map((file) => [new URL(file.path, scope).href, file]));
const total = FILES.reduce((sum, file) => sum + file.size, 0);
let job;
async function publish(state, extra = {}) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) {
    if (client.url.startsWith(scope)) client.postMessage({ type: 'inkbloom-offline', state, ...extra });
  }
}

async function prepare() {
  const cache = await caches.open(name);
  const present = new Set((await cache.keys()).map((key) => key.url));
  let done = 0;
  const missing = [];
  for (const [url, file] of assets) {
    if (present.has(url)) done += file.size;
    else missing.push([url, file]);
  }
  let last = 0;
  let failed = false;
  async function download() {
    while (!failed && missing.length) {
      const [url, file] = missing.pop();
      try {
        const response = await fetch(url, {
          integrity: file.integrity,
          cache: 'no-store',
          redirect: 'error',
        });
        if (!response.ok) throw new Error('download');
        await cache.put(url, response);
        done += file.size;
        if (Date.now() - last >= 200) {
          last = Date.now();
          await publish('progress', { done, total });
        }
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  if (missing.length) {
    await publish('progress', { done, total });
    const results = await Promise.allSettled(Array.from({ length: 4 }, download));
    const error = results.find((result) => result.status === 'rejected');
    if (error) throw error.reason;
  }
}
function ensure() {
  if (!job)
    job = prepare()
      .catch(async (error) => {
        await publish('error', { quota: error.name === 'QuotaExceededError' });
        throw error;
      })
      .finally(() => {
        job = undefined;
      });
  return job;
}
self.addEventListener('install', (event) => {
  // Waiting workers activate naturally after all old clients close.
  event.waitUntil(ensure());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(prefix) && key !== name) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data !== 'inkbloom-offline-check') return;
  event.waitUntil(
    ensure()
      .then(() => {
        event.source?.postMessage({ type: 'inkbloom-offline', state: 'ready' });
      })
      .catch(() => {}),
  );
});

async function serve(request, key) {
  const cache = await caches.open(name);
  const response = await cache.match(key);
  if (!response) return fetch(request);
  const range = request.headers.get('Range');
  if (!range) return response;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return response;
  const blob = await response.blob();
  const start = match[1] ? Number(match[1]) : Math.max(0, blob.size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1;
  if (start > end)
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + blob.size } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': blob.type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${blob.size}`,
    },
  });
}
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (request.mode === 'navigate') {
    if (url.href === entry || url.href === new URL('index.html', scope).href)
      event.respondWith(serve(request, entry));
  } else if (assets.has(url.href)) {
    event.respondWith(serve(request, url.href));
  }
});
