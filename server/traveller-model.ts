import {
  modelOptions,
  validSightings,
  type Sighting,
  type TravelOption,
} from '../src/world/wilderness/traveller-options';

export type ChooseStop = (options: TravelOption[], memory?: Sighting[]) => Promise<number | null>;

export function travellerModel(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
): ChooseStop | undefined {
  const base = env.INKBLOOM_AI_BASE_URL?.replace(/\/+$/, '');
  const model = env.INKBLOOM_AI_MODEL;
  if (!base || !model) return;
  let availableAt = 0;
  let busy = false;
  return async (choices, memory = []) => {
    const options = modelOptions(choices);
    if (!options || !validSightings(memory) || busy || Date.now() < availableAt) return null;
    busy = true;
    availableAt = Date.now() + 5000;
    try {
      const response = await request(base + '/chat/completions', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(env.INKBLOOM_AI_API_KEY ? { Authorization: 'Bearer ' + env.INKBLOOM_AI_API_KEY } : {}),
        },
        body: JSON.stringify({
          model,
          max_tokens: 80,
          messages: [
            {
              role: 'system',
              content:
                '你是一名步行旅行者。选择下一段真实行程，可以向前或折返。根据沿途村落是否安宁、是否在恢复、距离和休息点做决定。适当探索，也要考虑墨染危险。options 是可达站点；metres 是沿路距离，onward 表示继续向前。memory 是你亲身经历的见闻，按最近在前排列，at 是世界时间（秒）。place 是地点编号，可与候选站点匹配。结合去过的村落、当时村况和当前候选，决定探新路或重访。只输出 JSON 对象 {"stop":数字}，从 0 开始编号。',
            },
            {
              role: 'user',
              content: JSON.stringify({
                options,
                memory: memory.map(({ place, kind, at }) => ({ place, kind, at })),
              }),
            },
          ],
        }),
      });
      if (!response.ok) return null;
      const json = await response.json();
      const reply = json.choices?.[0]?.message?.content;
      if (typeof reply !== 'string') return null;
      const index = JSON.parse(reply.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, '')).stop;
      return Number.isInteger(index) && index >= 0 && index < options.length ? index : null;
    } catch {
      return null;
    } finally {
      busy = false;
    }
  };
}
