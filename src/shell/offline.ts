import { browserKeyValue } from '@/world/store';

// Only the production build has a complete release manifest.
export function prepareOffline(persistent: boolean): void {
  if (!import.meta.env.PROD) return;
  const panel = document.querySelector<HTMLElement>('#offline')!;
  const label = panel.querySelector('span')!;
  const retry = panel.querySelector('button')!;
  panel.hidden = false;
  const show = (text: string, again = false) => {
    label.textContent = text;
    retry.hidden = !again;
  };
  if (!persistent) {
    show('本机存档不可写，无法准备离线单机', true);
    retry.onclick = () => location.reload();
    return;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    show('离线单机需要支持 Service Worker 的浏览器和 HTTPS 或 localhost 地址');
    return;
  }
  const sw = navigator.serviceWorker;
  const workerURL = new URL('./offline-worker.js', document.baseURI);
  let ready = false;
  const check = () => sw.controller?.postMessage('inkbloom-offline-check');
  sw.addEventListener('controllerchange', check);
  sw.addEventListener('message', (event) => {
    const m = event.data;
    const worker = event.source as ServiceWorker | null;
    if (m?.type !== 'inkbloom-offline' || worker?.scriptURL !== workerURL.href) return;
    if (m.state === 'ready' && worker === sw.controller) {
      if (!browserKeyValue().persistent) {
        ready = false;
        show('本机存档不可写，无法继续保存进度', true);
        return;
      }
      ready = true;
      show('已可离线游玩');
    } else if (m.state === 'progress' && !ready) {
      show('正在缓存离线资源 · ' + Math.floor((100 * m.done) / m.total) + '%');
    } else if (m.state === 'error') {
      if (worker === sw.controller) ready = false;
      show(
        (ready ? '已可离线游玩 · 更新未完成' : '离线资源未就绪') + (m.quota ? '，浏览器空间不足' : ''),
        true,
      );
    }
  });
  async function register(forceUpdate = false) {
    if (!ready) show('正在检查离线资源…');
    check();
    try {
      const reg = await sw.register(workerURL, { updateViaCache: 'none' });
      if (forceUpdate && reg.active && !reg.installing) await reg.update();
      if (reg.waiting && ready) show('已可离线游玩 · 关闭所有游戏标签后启用新版');
      check();
    } catch {
      if (!sw.controller) show('无法准备离线资源，请联网后重试', true);
    }
  }
  retry.onclick = () => void register(true);
  void register();
}
