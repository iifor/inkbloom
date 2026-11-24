import './style.css';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Trace = {
  ID: string;
  Parent: string;
  Started: string;
  Mode: string;
  Model: string;
  World: string;
  Trail: string;
  DurationMS: number;
  HTTP: number;
  Status: string;
  Applied: string;
  Input: { options: unknown[]; memory: unknown[] };
  Prompt: string;
  Reply: string;
  Stop: number | null;
  Usage: { prompt_tokens: number; completion_tokens: number } | null;
};
type Overview = {
  Online: number;
  Sample: string;
  Rooms: {
    ID: string;
    Code: string;
    Count: number;
    Max: number;
    Locked: boolean;
    Closed: boolean;
    SaveFailed: boolean;
  }[];
  Worlds: {
    ID: string;
    Kind: string;
    Sequence: number;
    Version: number;
    Players: number;
    Clock: number;
    Seed: number;
  }[];
  Backups: { ID: string; World: string; Digest: string; Sequence: number; Created: string }[];
};
const login = el<HTMLFormElement>('login'),
  detail = el<HTMLDialogElement>('detail');
let csrf = '',
  view = 'world',
  busy = false,
  selected = '',
  generation = 0;
const cursors = [''];
let nextCursor = '';
const operations = new Map<string, string>();
function message(text: string) {
  el('notice').textContent = text;
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function auth(user: string) {
  const active = !!user;
  login.hidden = active;
  document.querySelector('nav')!.hidden = !active;
  document.querySelector<HTMLElement>('.account')!.hidden = !active;
  el('user').textContent = user;
  if (!active) {
    csrf = '';
    generation++;
    detail.close();
    el('world').hidden = true;
    el('trace').hidden = true;
    el('sample').textContent = '';
    el('title').textContent = '管理登录';
  }
}
async function api<T>(path: string, body?: unknown, headers?: (h: Headers) => void): Promise<T> {
  const res = await fetch(
    '/api/admin/v1/' + path,
    body === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify(body),
        },
  );
  if (res.status === 401) {
    auth('');
    throw Error(path === 'login' ? '账号或密码错误' : '请登录管理后台');
  }
  if (!res.ok) throw Error((await res.text()).trim() || '请求失败（' + res.status + '）');
  headers?.(res.headers);
  return res.status === 204 ? (undefined as T) : res.json();
}
function button(label: string, action: () => Promise<void>) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = async () => {
    b.disabled = true;
    busy = true;
    try {
      await action();
    } catch (e) {
      message(errorText(e));
    } finally {
      busy = false;
      b.disabled = false;
    }
  };
  return b;
}
function table(id: string, cols: string[], rows: (string | number | Node)[][], empty: string) {
  const root = el(id);
  root.replaceChildren();
  if (!rows.length) {
    root.className = 'empty';
    root.textContent = empty;
    return;
  }
  root.className = 'tablewrap';
  const t = document.createElement('table');
  root.append(t);
  const head = t.createTHead().insertRow();
  for (const label of cols) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const value of row) {
      const td = tr.insertCell();
      td.append(value instanceof Node ? value : String(value));
    }
  }
}
function date(s: string) {
  return new Date(s).toLocaleString('zh-CN', { hour12: false });
}
async function action(path: string, target: string, closed?: boolean) {
  const key = JSON.stringify([path, target, closed]);
  let id = operations.get(key);
  if (!id) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    id = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
    operations.set(key, id);
  }
  await api(path, { id, target, closed });
  operations.delete(key);
  await refresh();
  message(path === 'backup' ? '备份已保存' : closed ? '已暂停新玩家加入' : '已恢复加入');
}
function overview(d: Overview) {
  el('online').textContent = String(d.Online);
  el('roomsCount').textContent = String(d.Rooms.length);
  el('saveCount').textContent = String(d.Worlds.length);
  table(
    'rooms',
    ['房间', '在线 / 上限', '加入状态', '操作'],
    d.Rooms.map((r) => [
      r.Code || '持久世界 · ' + r.ID,
      r.Count + ' / ' + r.Max,
      r.SaveFailed ? '等待保存' : r.Closed ? '暂停加入' : r.Locked ? '需要密码' : '开放',
      r.Code ? button(r.Closed ? '恢复加入' : '暂停加入', () => action('admission', r.ID, !r.Closed)) : '—',
    ]),
    '当前没有运行中的房间',
  );
  table(
    'saves',
    ['世界', '类型', '种子', '世界时间', '存档版本 / 序号', '玩家存档', '操作'],
    d.Worlds.map((w) => [
      w.ID,
      w.Kind === 'persistent' ? '持久' : '临时',
      w.Seed,
      Math.floor(w.Clock) + ' 秒',
      'v' + w.Version + ' / ' + w.Sequence,
      w.Players,
      w.Kind === 'persistent' ? button('创建备份', () => action('backup', w.ID)) : '—',
    ]),
    '尚未写入联机存档',
  );
  table(
    'backups',
    ['创建时间', '来源世界', '保存序号', '备份编号', 'SHA-256'],
    d.Backups.map((b) => [date(b.Created), b.World, b.Sequence, b.ID, b.Digest]),
    '尚无世界备份',
  );
  el('sample').textContent = '更新于 ' + date(d.Sample);
}
async function show(id: string) {
  const t = await api<Trace>('traces/' + id);
  selected = t.ID;
  const chain = el('chain');
  chain.replaceChildren();
  el('debugStatus').textContent = '';
  function block(title: string, content: unknown) {
    const h = document.createElement('h3');
    h.textContent = title;
    const pre = document.createElement('pre');
    pre.textContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    chain.append(h, pre);
  }
  block(
    '调用',
    t.ID + ' · ' + date(t.Started) + ' · ' + [t.Mode, t.World, t.Trail].filter(Boolean).join(' / '),
  );
  if (t.Parent) chain.append(button('查看原调用', () => show(t.Parent)));
  block('候选站点与亲历见闻', t.Input);
  block('系统提示词', t.Prompt || '未发起模型请求');
  block(
    '模型调用',
    [
      t.Model,
      t.HTTP ? 'HTTP ' + t.HTTP : '未取得 HTTP 状态',
      t.DurationMS + ' ms',
      t.Usage
        ? 'Token（输入 / 输出） ' + t.Usage.prompt_tokens + ' / ' + t.Usage.completion_tokens
        : '未报告 Token 用量',
    ].join(' · '),
  );
  block('模型回复', t.Reply || '无回复内容');
  block(
    '校验与行程',
    [
      t.Status,
      t.Stop != null ? '候选 ' + t.Stop + ' · ' + JSON.stringify(t.Input.options[t.Stop]) : '',
      t.Applied || (t.Mode === '调试' ? '仅调试，无游戏状态写入' : '等待处理'),
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (!detail.open) detail.showModal();
}
async function refresh() {
  const seq = ++generation;
  const v = view;
  try {
    if (v === 'world') {
      const d = await api<Overview>('overview');
      if (seq !== generation) return;
      overview(d);
    } else {
      const mode = el<HTMLSelectElement>('mode').value;
      const query = new URLSearchParams({ mode, before: cursors[cursors.length - 1]! });
      let next = '';
      const d = await api<Trace[]>('traces?' + query, undefined, (h) => {
        next = h.get('X-Next-Cursor') ?? '';
      });
      if (seq !== generation) return;
      nextCursor = next;
      el<HTMLButtonElement>('older').disabled = !next;
      el<HTMLButtonElement>('newer').disabled = cursors.length <= 1;
      table(
        'calls',
        ['时间', '来源 / 旅行者', '模型', '结果', '耗时', '详情'],
        d.map((t) => [
          date(t.Started),
          [t.Mode, t.World, t.Trail].filter(Boolean).join(' / '),
          t.Model,
          t.Status,
          t.DurationMS + ' ms',
          button('查看调用链', () => show(t.ID)),
        ]),
        '暂无符合条件的选站记录',
      );
      el('sample').textContent = '更新于 ' + date(new Date().toISOString());
    }
    message('');
  } catch (e) {
    if (csrf) message('刷新失败，页面保留上次数据。' + errorText(e));
  }
}
function navigate(v: string) {
  view = v;
  el('world').hidden = v !== 'world';
  el('trace').hidden = v !== 'trace';
  el('title').textContent = v === 'world' ? '世界总览' : '模型调用链';
  document.querySelectorAll('nav button').forEach((b) => {
    if ((b as HTMLElement).dataset.view === v) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  void refresh();
}
document
  .querySelectorAll<HTMLButtonElement>('nav button')
  .forEach((b) => (b.onclick = () => navigate(b.dataset.view!)));
el('close').onclick = () => detail.close();
el('mode').onchange = () => {
  cursors.splice(1);
  nextCursor = '';
  void refresh();
};
el('older').onclick = () => {
  if (nextCursor) {
    cursors.push(nextCursor);
    nextCursor = '';
    void refresh();
  }
};
el('newer').onclick = () => {
  if (cursors.length > 1) {
    cursors.pop();
    nextCursor = '';
    void refresh();
  }
};
el<HTMLButtonElement>('replay').onclick = async (e) => {
  const b = e.currentTarget as HTMLButtonElement;
  b.disabled = true;
  el('debugStatus').textContent = '正在请求模型…';
  try {
    const r = await api<{ id: string }>('replay', { target: selected });
    await show(r.id);
    await refresh();
  } catch (e) {
    el('debugStatus').textContent = errorText(e);
  } finally {
    b.disabled = false;
  }
};
el('logout').onclick = async () => {
  try {
    await api('logout', {});
    auth('');
    message('');
  } catch (e) {
    message(errorText(e));
  }
};
login.onsubmit = async (e) => {
  e.preventDefault();
  const data = new FormData(login);
  try {
    const r = await api<{ csrf: string }>('login', Object.fromEntries(data));
    csrf = r.csrf;
    auth(String(data.get('user')));
    login.reset();
    navigate('world');
  } catch (e) {
    message(errorText(e));
  }
};
api<{ csrf: string; user: string }>('session')
  .then((s) => {
    csrf = s.csrf;
    auth(s.user);
    navigate('world');
  })
  .catch((e) => {
    auth('');
    message(errorText(e));
  });
setInterval(() => {
  if (csrf && !busy && !detail.open && !document.hidden) void refresh();
}, 5000);
