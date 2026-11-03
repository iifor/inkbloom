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

在 [src/content/palette.ts](../src/content/palette.ts) 的 `PALETTE` **末尾**追加一项。不要插在中间或重排：存档和几何里存的是下标。`paintable: true` 才会出现在涂鸦笔刷里。`solid: true` 的颜色画成实心的湿墨（不透出纸，受光面有一点反光），目前只有墨潮用的 `ink`。上限 32 色。

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

墨潮的计时存在每座城的存档里（`CitySave.tide`），记的是"还剩多少秒"，只在玩家待在这座城时倒数：刷新页面会接着上次的进度，离开城市墨潮暂停，回来继续（不能靠出城躲墨潮）。墨帘的样子在 [src/systems/city/ink-curtain.ts](../src/systems/city/ink-curtain.ts)：柱子高度、浪头、底部翻滚、滴墨和身后的墨面都在那里调，它只管画面。墨帘不是碰撞体，但笔刷会被它挡住：场景可以实现 `GameScene.brushStop`，返回射线上挡住笔刷的距离

## 调第一座城、通关奖励、笔刷升级

- 第一座城的大小：`tuning.ts` 的 `city.firstCityChunks`；其他城：`city.chunks`。改了会重置那座城的进度（布局变了）
- 通关奖励：`city.completeReward`
- 笔刷档位：[src/content/brush-tiers.ts](../src/content/brush-tiers.ts)，**末尾**追加；`cost` 是从上一档升到这一档的花费
- 目标提示的文字和顺序：[src/world/objectives.ts](../src/world/objectives.ts) 的 `objective()`，有测试

## 给"按 E"的东西加第二个动作

`Interactable` 可以带 `alt: { label, activate }`，玩家按 F 触发，提示显示在主提示下面；`label()` 返回 `null` 时隐藏。画室的"升级笔刷"就是这样做的。

## 加一种墨怪 / 调战斗

- 墨怪种类：[src/content/enemies.ts](../src/content/enemies.ts) 的 `ENEMIES` **末尾**追加（生命、速度、体型、发现距离、掉墨、攻击方式）。攻击方式 `melee`（近身咬）或 `spit`（远程吐墨）决定 AI 走哪一支；要新的行为，在 [src/systems/combat/monsters.ts](../src/systems/combat/monsters.ts) 的 `update` 里按 `attack.kind` 加一支
- 据点规模、墨潮带几只、玩家生命和回血、死亡掉墨比例：`tuning.ts` 的 `combat`
- 墨怪跳跃：`combat.monsterJump`（能跳上的最高台阶，比玩家的跳跃高一点）和 `combat.monsterDrop`（寻路时最多往下跳多高）。撞到台阶时先探测前方有没有能站上去的平台，太高的墙不会跳
- 武器数值在 [src/content/weapons.ts](../src/content/weapons.ts)（见下一节）。攻击都走 `ctx.combat.shoot()` / `strike()` / `blast()`，武器自己不需要知道有哪些墨怪
- 让新的东西能被打：实现 `TargetSource`，用 `ctx.combat.addTargets()` 注册（`MonsterGroup` 就是这样做的）
- 改据点数量或位置只会重置"已打败"标记，不会重置涂色进度
- 野外墨怪多少：`tuning.ts` 的 `combat.wild`（按地面饱和度分档）和 `combat.wildRespawnSeconds`
- 寻路：通用 A* 在 [src/world/nav/path.ts](../src/world/nav/path.ts)，城市 / 野外的可走格子在 [src/world/nav/grids.ts](../src/world/nav/grids.ts)。新场景要让墨怪寻路，给它的 `MonsterGroup` 设一个 `nav`

## 加一种武器

[src/content/weapons.ts](../src/content/weapons.ts) 的 `WEAPONS` **末尾**追加：种类（`gun` 枪 / `melee` 近战 / `launcher` 炮）、伤害、射速、弹匣、范围、技能、解锁条件（开局 / 某个里程碑 / 等级 / 恢复几座城）、外观颜色。持枪模型和技能效果在 [src/systems/tools/weapons.ts](../src/systems/tools/weapons.ts) 按 `key` 加分支（`viewModel` 和 `skill`）。

开枪的手感在同一项的 `shot` 里，只管画面，不影响伤害和准度：

- `muzzle`：枪口在持枪模型里的位置，子弹和火光从这里出来；改了 `viewModel` 的枪管长度要跟着改
- `flash`：枪口火光大小（0 不要火光）；`recoil`：每枪后坐的力度（步枪为 1）
- `tracer`：飞出去的弹道，速度（米/秒）、长度、粗细、颜色。命中是瞬间判定的，弹道只是让眼睛跟得上，太慢会出现"数字先跳、子弹后到"
- 画法在 [src/systems/tools/shot-fx.ts](../src/systems/tools/shot-fx.ts)：弹道离枪口 0.35 米才开始画（不会和枪管粘在一起），远处自动加粗保持约 2 像素；打到墙时发 `shot:impact`，特效和声音在各自系统里响应

## 调成长

[src/content/progression.ts](../src/content/progression.ts)：每种行为给多少经验、每级要多少经验、每级自带的成长、每个属性点加多少、哪些里程碑给属性点。

## 调心愿、遗迹、标记、纸飞机

- 心愿：[src/content/requests.ts](../src/content/requests.ts)（数量、换色和要颜料的比例、文案、奖励）
- 遗迹：`tuning.ts` 的 `structures.ruin*`，模板在 `content/templates.ts` 的 `RUINS`
- 墨迹标记：`tuning.ts` 的 `marks`；纸飞机：`player.glideFall` / `glideSpeed`
- 繁荣画室产出：`economy.studioStockSeconds` / `studioStockCap`

## 给某件事加声音或特效

声音和特效只听事件，不被任何玩法代码调用：

1. 在发生的地方发一个事件（事件名和载荷加在 [src/game/events.ts](../src/game/events.ts) 的 `GameEvents`，用 `ctx.events.emit`）
2. 声音：在 [src/systems/audio/audio-system.ts](../src/systems/audio/audio-system.ts) 的构造函数里 `on('事件名', …)`，用 `synth.tone` / `synth.noise` 拼一个音色（`pos` 传位置就有远近和左右）
3. 特效：在 [src/systems/effects/effects.ts](../src/systems/effects/effects.ts) 里 `on('事件名', …)`，用 `this.burst(位置, { 数量, 颜色, 速度, … })`
4. 音乐的调性、速度、密度在 [src/systems/audio/music.ts](../src/systems/audio/music.ts) 顶部
5. 屏幕上的数字、血条、来向箭头：[src/shell/combat-overlay.ts](../src/shell/combat-overlay.ts)。它听 `monster:hit` / `monster:died` / `player:hurt`；新的伤害来源只要照样发这几个事件（带上 `amount`，玩家受伤带上 `from`）就会自动显示。样式在 `style.css` 的 `.combat-overlay`

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
- v2 补充（2026-11-02，首版）：新增 `growth`、`discovered`、`marks`、`nextMark`、`hunted`，`inventory.glider` / `weapons`；城市存档新增 `co`（街区首次有色）、`rf`/`rd`（心愿指纹与完成标记）、`sk`（繁荣画室计时）。都是可选字段
- v2 补充（2026-11-02，战斗）：新增 `drop`（死亡掉落）、`inventory.brushTier`，城市存档新增 `c`（已恢复）、`mf`/`d`（据点指纹与已打败标记）。均为可选字段，旧存档取默认值
- v2 补充（2026-11-02）：新增可选字段 `inventory.ink`、`clock`、`harvested`，城市存档新增 `sf`/`st`（墨渍指纹与已吸走标记）。旧 v2 存档读入时取默认值，不需要升版本
- v2 补充（2026-11-02，墨潮存档）：城市存档新增可选字段 `td`（`n` 距下一次墨潮的秒数，`w` 进行中的墨潮 `[街区, 方向, 距开始秒数, 距结束秒数, 推进米数]`）。旧存档读入时取默认值（首次墨潮延迟、没有进行中的墨潮）
