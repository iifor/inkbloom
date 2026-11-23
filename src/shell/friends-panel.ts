import type { FriendStatus } from '@/game/types';

/** Update existing rows so live distance changes do not steal keyboard focus. */
export function mountFriends(
  root: HTMLElement,
  read: () => readonly FriendStatus[],
  track: (id: number) => void,
  visit: (id: number) => void,
): () => void {
  const rows = new Map<number, HTMLElement>();
  const empty = document.createElement('p');
  empty.textContent = '还没有其他伙伴在线。让朋友加入同一服务器即可。';
  root.append(empty);
  const update = (): void => {
    const friends = read();
    empty.hidden = friends.length > 0;
    for (const [id, row] of rows)
      if (!friends.some((p) => p.id === id)) {
        row.remove();
        rows.delete(id);
      }
    for (const friend of friends) {
      let row = rows.get(friend.id);
      if (!row) {
        row = document.createElement('article');
        row.className = 'friend-row';
        row.innerHTML =
          '<b></b><p></p><small></small><div><button data-track></button><button data-visit>传送到身边</button></div>';
        row.querySelector<HTMLButtonElement>('[data-track]')!.onclick = () => {
          track(friend.id);
          update();
        };
        row.querySelector<HTMLButtonElement>('[data-visit]')!.onclick = () => visit(friend.id);
        rows.set(friend.id, row);
        root.append(row);
      }
      row.querySelector('b')!.textContent = friend.name;
      row.querySelector('p')!.textContent = friend.detail;
      row.querySelector('small')!.textContent = friend.reason;
      const locate = row.querySelector<HTMLButtonElement>('[data-track]')!;
      locate.textContent = friend.tracking ? '取消定位' : '定位伙伴';
      locate.disabled = !friend.tracking && !friend.canTrack;
      row.querySelector<HTMLButtonElement>('[data-visit]')!.disabled = !friend.canVisit;
    }
  };
  update();
  const timer = window.setInterval(update, 500);
  return () => window.clearInterval(timer);
}
