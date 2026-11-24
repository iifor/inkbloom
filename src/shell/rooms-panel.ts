import type { RoomInfo } from '@/world/net/protocol';

export type WatchRooms = (
  password: string | null,
  update: (rooms: readonly RoomInfo[]) => void,
  failed: (message: string, needsPassword: boolean) => void,
) => () => void;

export function mountRooms(
  root: HTMLElement,
  watch: WatchRooms,
  join: (code: string, password: string) => void,
): () => void {
  root.innerHTML = `<p role="status"></p><div class="room-list"></div>
    <form hidden><label><span></span><input type="password" maxlength="128" required autocomplete="off"></label>
    <button type="submit" class="primary"></button><button type="button" data-cancel>取消</button></form>
    <button data-retry hidden>重新加载房间列表</button>`;
  const status = root.querySelector('p')!;
  const list = root.querySelector<HTMLElement>('.room-list')!;
  const form = root.querySelector('form')!;
  const input = form.querySelector('input')!;
  const cancel = form.querySelector<HTMLButtonElement>('[data-cancel]')!;
  const retry = root.querySelector<HTMLButtonElement>('[data-retry]')!;
  const rows = new Map<string, HTMLButtonElement>();
  let selected: string | null = null;
  let stop: (() => void) | undefined;

  function askPassword(code: string | null) {
    selected = code;
    form.querySelector('span')!.textContent = code ? `房间 ${code} 的密码` : '服务器密码';
    form.querySelector('button')!.textContent = code ? '加入房间' : '查看房间';
    cancel.hidden = !code;
    input.value = '';
    form.hidden = false;
    input.focus();
  }
  cancel.onclick = () => {
    if (selected) rows.get(selected)?.focus();
    selected = null;
    form.hidden = true;
    input.value = '';
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    if (selected) join(selected, input.value);
    else load(input.value);
  };

  function update(rooms: readonly RoomInfo[]) {
    status.textContent = rooms.length ? '' : '暂无房间，可以创建一个。';
    for (const [code, row] of rows) {
      if (!rooms.some((r) => r.code === code)) {
        row.remove();
        rows.delete(code);
      }
    }
    for (const { code, count, max, locked, paused } of rooms) {
      let row = rows.get(code);
      if (!row) {
        row = document.createElement('button');
        rows.set(code, row);
        list.append(row);
      }
      row.textContent = `房间 ${code} · ${count}/${max} 人 · ${paused ? '暂停加入' : count >= max ? '已满' : locked ? '凭密码加入' : '直接加入'}`;
      row.disabled = !!paused || count >= max;
      row.onclick = () => (locked ? askPassword(code) : join(code, ''));
    }
    if (selected && !rooms.some((r) => r.code === selected && !r.paused && r.count < r.max)) {
      status.textContent = `房间 ${selected} 已满或已关闭`;
      selected = null;
      form.hidden = true;
      input.value = '';
    }
  }
  function failed(message: string, needsPassword: boolean) {
    rows.clear();
    list.replaceChildren();
    selected = null;
    form.hidden = true;
    status.textContent = message;
    retry.hidden = needsPassword;
    if (needsPassword) askPassword(null);
  }
  function load(password: string | null) {
    stop?.();
    form.hidden = true;
    input.value = '';
    retry.hidden = true;
    status.textContent = '正在获取房间列表…';
    try {
      stop = watch(password, update, failed);
    } catch {
      failed('无法连接房间服务', false);
    }
  }
  retry.onclick = () => load(null);
  load(null);
  return () => stop?.();
}
