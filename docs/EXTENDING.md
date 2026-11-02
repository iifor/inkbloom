# 怎么改

按常见需求列出要动的文件。每一步之后跑 `npm run check`。

## 调数值

只改 [src/content/tuning.ts](../src/content/tuning.ts)。比如：

- 涂一个表面要多久：`brush.secondsPerSurface`
- 城市多大：`city.chunks`
- 城市入口多密：`structures.cityGrid`
- 未恢复城市周围多大范围变灰：`drain.innerRadius` / `drain.outerRadius`（城市间距约 900 米，外半径要远小于一半，否则野外永远是灰的）
- 跳多高、跑多快：`player.*`

## 加一种颜色

在 [src/content/palette.ts](../src/content/palette.ts) 的 `PALETTE` **末尾**追加一项。不要插在中间或重排：存档和几何里存的是下标。`paintable: true` 才会出现在涂鸦笔刷里。上限 32 色。

## 加一个群系

1. [src/content/biomes.ts](../src/content/biomes.ts)：`BIOMES` 加一项（地面色、崖面色、树密度…）
2. 同文件 `RULES`：在兜底规则（草原）**之前**加一条 `{ biome, when }`。`when` 拿到的是 `relief / moisture / water / wildness`
3. 如果新群系要新的地形起伏，在 [src/world/wilderness/generator.ts](../src/world/wilderness/generator.ts) 的 `rawHeightAt` 里加一项。改了这里，所有已有世界的地形都会变（种子相同，函数变了）

## 加一种野外颜料点

[src/content/pigment-sources.ts](../src/content/pigment-sources.ts) 的 `PIGMENT_SOURCES` **末尾**追加一项：出现在哪些群系、放在哪（`land` 平地 / `shore` 水边 / `high` 高处）、给哪些颜色、给多少颜料和墨、每区块出现的概率。下标是颜料点 ID 的一部分，所以只能追加。外形在 [src/systems/wilderness/build-source.ts](../src/systems/wilderness/build-source.ts) 按 `key` 加一个分支，不加就用默认外形。

## 调颜料经济

都在 `tuning.ts` 的 `economy`：每个墨渍给多少墨、每街区多少墨渍、几墨换一份通用颜料、颜料点多久长回来。改墨渍数量或位置只会重置城里的墨渍，不会重置涂色进度。

## 调街区状态和墨潮

`tuning.ts` 的 `blocks`：清理中 / 有色 / 繁荣的比例门槛、侵蚀速度。有色门槛同时是画室开门的条件。`tide`：间隔、首次延迟、预警和持续时间、墨帘推进多深（`reach`）、推回速度和花费、守住的门槛、奖励。规则本身在 [src/world/city/blocks.ts](../src/world/city/blocks.ts)（纯函数，有测试），表现和计时在 [src/systems/city/ink-tide.ts](../src/systems/city/ink-tide.ts)、[erosion.ts](../src/systems/city/erosion.ts)。开发时可在控制台用 `inkbloom.tide()` 立刻触发一次墨潮。

## 加一种建筑 / 地标模板

[src/content/templates.ts](../src/content/templates.ts) 的 `BUILDINGS` 或 `LANDMARKS` 加一项。参数都是范围或可选列表；生成器从里面挑。`weight` 越大越常见。

要新的**形状**（不只是参数），改构建器：建筑在 [src/systems/city/build-city.ts](../src/systems/city/build-city.ts)，地标在 [src/systems/wilderness/build-landmark.ts](../src/systems/wilderness/build-landmark.ts)。可涂的面要分配表面编号（见城市生成器里的 `addSurface`）。

## 加一个工具（武器、纸飞机、标记…）

1. 新建 `src/systems/tools/<名字>.ts`，实现 [`Tool`](../src/systems/tools/tool.ts) 接口：`update(dt)` 每帧在手里时运行，`hud()` 返回 HUD 文字
2. 在 [src/modes/open-world.ts](../src/modes/open-world.ts) 的 `new ToolBelt(ctx, [...])` 里加上它。数字键 1–4 自动对应
3. 要新按键就在 [src/content/bindings.ts](../src/content/bindings.ts) 加动作和按键

## 加一个"按 E"的东西（NPC、宝箱、画室门）

在创建它的场景里：

```ts
const release = ctx.interactions.add({
  scene: 'wild', // 或 `city:${cityId}`
  pos: new THREE.Vector3(x, y, z),
  radius: 4,
  label: () => 'E 打开',
  activate: () => {
    /* ... */
  },
});
// 场景销毁时调用 release()
```

## 加一种会存档的改变（新补丁）

1. [src/world/patch.ts](../src/world/patch.ts)：`Patch` 联合类型加一种 `kind`，`applyPatch` 里加一个分支，写清楚什么情况拒绝
2. 如果要存新字段：[src/world/state.ts](../src/world/state.ts) 加字段，`serializeWorld` / `deserializeWorld` 都要处理；旧存档读不到这个字段时给默认值
3. 在 `tests/patch.test.ts` 加测试
4. 想让别的系统知道：监听 `ctx.events.on('patch:applied', ...)`

## 加一个系统

1. 新建 `src/systems/<名字>/<名字>.ts`，实现 `System`（`id`、`update?(dt)`、`dispose?()`），构造函数拿 `ctx`
2. 在 [src/modes/open-world.ts](../src/modes/open-world.ts) 的 `systems` 数组里放到合适的位置（顺序就是每帧执行顺序）
3. 要让别的系统调用它：在 [src/game/types.ts](../src/game/types.ts) 的 `GameContext` 加一个接口字段，在模式里赋值。**不要**让别的系统直接 import 它

## 加一个事件

[src/game/events.ts](../src/game/events.ts) 的 `GameEvents` 加一个键和载荷类型。TypeScript 会检查所有 `emit` 和 `on`。

## 加一种场景（住宅室内、副本）

实现 [`GameScene`](../src/game/types.ts)：自己的 `root`、`physics`、`spawn()`、`update()`、`dispose()`。在 [src/systems/scenes/scene-manager.ts](../src/systems/scenes/scene-manager.ts) 加一个 `enterXxx()`，`SceneApi` 里声明它。`SceneRef`（存档里记录玩家在哪）在 [src/world/state.ts](../src/world/state.ts)。

## 不确定的时候

- 想法还没定：先在 `tuning.ts` 里放一个开关或数值，系统读它；试玩后再决定删哪边
- 改动影响存档：改 `SAVE_VERSION`，在这份文档末尾记一笔
- 改动影响生成：同一种子会生成不同的世界，新开一个 `?world=` 测试

## 开发者工具

开发模式下浏览器控制台有 `window.inkbloom`：`teleport(x, z)`、`look(yaw, pitch)`、`fly()`、`enterNearestCity()`、`exitCity()`、`brush(秒数, 'restore' | 'graffiti')`、`step(帧数)`、`info()`、`tide()`、`save()`。不需要鼠标锁定，适合自动检查。

## 存档版本记录

- v1（2026-11-02）：初版
- v2（2026-11-02）：每座城的状态附带布局指纹（`surfaceFingerprint`）。v1 存档读入时，表面数量一致就沿用，否则该城重置
- v2 补充（2026-11-02）：新增可选字段 `inventory.ink`、`clock`、`harvested`，城市存档新增 `sf`/`st`（墨渍指纹与已吸走标记）。旧 v2 存档读入时取默认值，不需要升版本
