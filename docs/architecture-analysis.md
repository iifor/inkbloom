# 涂鸦世界 V2 架构分析

目标：把现有射击原型重组为**模块化的开放世界玩法底座**，后续能加上色、任务、NPC 等内容而不改动核心循环。按新项目设计，不受现有文件边界约束，但标明哪些现有代码可以原样搬过来。

## 1. 现状的结构性问题

| 问题                       | 位置                                                                                                                   | 后果                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 会话接口只存在于约定       | `index.js` 用 `options.explore ? Exploration : Multiplayer` 选会话，存在 `ctx.pvp`；两个类共享 15 个同名方法但没有声明 | 入口帧循环里有 26 处模式分支，加玩法要改入口 |
| 生存模式状态混进通用对象   | `game` 上的 `wave/queue/combo/boss/katanaStreak/focus`                                                                 | 开放世界用不到却要一起 reset、更新 HUD       |
| 开放世界会话是上帝类       | `exploration/session.js` 1814 行：联网、区块流、场景切换、据点、血量复活、手雷、成长、存档、HUD                        | 新内容默认继续堆进去                         |
| 玩家手里只能是"武器"       | `player.js` 持有 `weapons[]`，HUD、触屏、动画都按枪/刀分支                                                             | 上色笔刷没有落点                             |
| 材质颜色是整件物体一个墨色 | `makeInkMaterial` 只有 `uInk`（调色板索引）和 `uFill`                                                                  | 无法表达"墙的一部分被涂了别的颜色"           |
| 交互是门的特判             | `scenes.js` 里 `interact` 直接处理建筑门                                                                               | NPC、宝箱、可涂表面都要再写一遍              |

做得对、应保留的部分：房主裁定、`interact` 包的 `epoch/seq` 去重、原子写盘和带校验和的缓存、`save(makePatch)` 的补丁式存档、AbortSignal 生命周期、资源统一释放、Node 原生回归测试。

## 2. 目标分层

依赖只能向下，下层不知道上层存在。

```text
shell/      React 菜单、DOM HUD、触屏控件            （只收状态变化，不收每帧数据）
modes/      玩法会话：open-world / pvp / survival / training   （实现同一个 Session 接口）
systems/    可插拔的运行时系统：streaming / interaction / combat / paint / progression / sync
world/      世界数据模型与持久化：schema / state / patch / validate   （纯数据，浏览器和 Node 共用）
engine/     渲染、物理、导航、输入、音频、资源        （不含任何玩法概念）
```

### engine/ —— 直接从现有代码搬

`render.js`（InkRenderer、后处理）、`physics.js`、`nav.js`、`input.js` + `touch-input.js`、`audio.js`、`shared/resources.js`。规则：这一层不 import `world/` 以上任何模块，不知道"敌人""武器"是什么。

需要改的只有材质：见第 4 节。

### world/ —— 纯数据，服务端也用

- `schema`：区块布局、建筑、结构、室内（现有 `exploration/schema.js`、`region.js`、`progression.js` 的数据部分）。
- `WorldState`：一个世界的全部可变状态，按区块分桶：据点进度、门的开关、**涂色覆盖层**、未来的任务进度。
- `patch`：所有状态变更都是补丁 `{ chunk, kind, data }`，`WorldState.apply(patch)` 是唯一写入口。服务端 `world-store.update()` 已经是补丁接口，只需把补丁类型做成枚举。
- `validate`：现有的布局校验和 `validateProgress` 原样保留。
- `generation`：噪声与哈希、群系表、台地高度、结构格子、道路生长、街块切分、模板参数抽取。全是纯函数，浏览器和 Node 结果一致，见 [world-generation.md](world-generation.md)。

这一层没有 Three.js，可以在 `node --test` 里跑完整的状态机测试。

### systems/ —— 每个系统一个目录，统一生命周期

```js
export function createSystem(ctx) {
  return { update(dt) {}, dispose() {} };
}
```

| 系统          | 职责                                                                                             | 来源                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `streaming`   | 区块请求、加载、重定基、可见性裁剪、远景剪影                                                     | `chunks.js` + `session.js` 的 `load/frontier/rebase`                       |
| `wilderness`  | 野外区块的噪声生成：群系、台地、结构、细节（纯函数，在 `world/` 里实现，这里只负责调用和建几何） | 新增                                                                       |
| `city`        | 城市副本的创建、落盘、进出；道路生长和街块切分在 `world/` 里                                     | 新增，复用 `scenes` 的切换机制                                             |
| `scenes`      | 野外 / 城市 / 室内切换、传送确认                                                                 | `scenes.js`、`interiors.js`                                                |
| `interaction` | 可交互物注册表：靠近提示、E 键、房主裁定                                                         | 从 `scenes.interact` 泛化                                                  |
| `combat`      | 玩家身体、敌人 AI、弹道、伤害结算                                                                | `player.js`、`enemies/`、`weapons/`、`online/combat.js`                    |
| `tools`       | 玩家手持物：武器（技能挂在武器上）、笔刷、纸飞机、墨迹标记                                       | 从 `player.weapons` + `abilities.js` 抽出                                  |
| `templates`   | 带参数的建筑 / 地标 / 遗迹模板，内置库与玩家库                                                   | 新增                                                                       |
| `paint`       | 笔刷命中 → 补丁 → 材质更新                                                                       | 新增                                                                       |
| `progression` | 经验、属性点、任务事件                                                                           | `progression.js` + `session.progression()`                                 |
| `sync`        | 房主/访客连接、快照、补丁广播                                                                    | `transport.js`、`network.js`、`session.js` 的 `host/join/receive/snapshot` |

系统之间不互相 import，通过两条通道协作：

1. **`ctx`**：只读依赖（scene、world、input、hud、player 引用）。保留现有做法。
2. **`ctx.events`**：会话级事件，命名固定（`enemy:killed`、`chunk:loaded`、`patch:applied`、`interact`）。不是全局总线，随会话创建和销毁。现有文档拒绝"事件总线"，这里保留其核心理由（不要全局、不要动态注册器），但会话内的事件通道是让 `paint`、`progression` 不去 import `combat` 的最小代价。

### modes/ —— 玩法只是系统的组合

```js
export class Session {
  constructor(ctx, host)   // host: show / resume / exit / settings / prefs
  async open()             // 进入该玩法的首个界面
  ready()                  // 开始一局
  update(dt)               // 每帧，自己决定调哪些 system
  hud()                    // 每帧 HUD 刷新
  pausable()               // 是否允许冻结模拟
  report(message)          // 错误/提示上屏
  leave()  dispose()
}
```

`open-world` 组合 `streaming + wilderness + city + scenes + interaction + combat + tools + paint + progression + sync`；`survival` 组合 `combat + waves + focus + pickups`；`pvp` 组合 `combat + sync + match`。入口 `mountShooter` 只做：建 engine、建 ctx、`new Mode(ctx)`、跑帧循环、处理暂停和释放。它不再出现 `game.mode` 判断。

现在 `game` 对象里的生存专属字段挪进 `survival` 模式；通用的只剩 `state / time / hitstop`。

### shell/ —— 不变

`App.jsx`、`ui/*.jsx`、`hud.js` 的边界已经正确，保留"React 只收菜单状态"的规则。HUD 加一个通用的 `slots` 概念（现在只认武器槽），让笔刷和武器用同一排槽位。

## 3. 关键数据流

**房主权威 + 补丁同步**（所有可持久化的世界变化走同一条路）：

```text
本地输入 ─► system 产生意图 ─► 访客: packets.post('intent') ─► 房主校验 ─► WorldState.apply(patch)
                                 房主: 直接校验 ───────────────┘            │
                                                                   ├─► 广播 patch 给访客
                                                                   ├─► server.update(patch) 落盘
                                                                   └─► events.emit('patch:applied') → 渲染层更新
```

据点击杀、开门、涂色、任务完成，都是不同 `kind` 的补丁。晚加入的访客收一次 `WorldState` 快照即可对齐，不需要为每种内容各写一套同步。

**区块生命周期**：`streaming` 请求 → 服务端生成/读缓存并校验 → 客户端 `buildChunk` 出几何 → `WorldState` 把该区块的覆盖层（含涂色）套回几何 → 开放通行。卸载时几何释放，状态保留在 `WorldState` 和磁盘。

## 4. 上色功能的架构落点

上色涉及四层，每层各有一个明确改动，互不越界：

| 层            | 改动                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| engine/render | 墨水材质增加一个顶点属性 `aSurface`（表面编号）和一张每区块的"表面 → 状态"查找纹理；片元着色器用 `aSurface` 查状态：0 画成黑白线稿，1 用几何自带的原色，2+n 用调色板第 n 色。调色板从 `colors.js` 的常量变成可扩展的数据纹理。同一次改动顺带支持 `InstancedMesh` |
| world         | 原色随骨架存，不变；状态层每区块一个字节数组（0 抽色 / 1 原色 / 2+n 涂鸦）。三种补丁：`drain`、`restore`、`paint`；服务端按区块一个 `state/<n>.json`                                                                                                             |
| systems/paint | 笔刷射线命中 → 读几何的 `aSurface` → 按模式生成 `restore` 或 `paint` 补丁；墨潮和侵蚀生成 `drain`；收到任何补丁 → 更新该区块的查找纹理                                                                                                                           |
| systems/tools | `Brush` 与 `Gun/Katana` 实现同一个 `Tool` 接口（`equip / fire / update / hudSlot`），玩家只持有 `tools[]`                                                                                                                                                        |

粒度**按表面**（一面墙、一扇门、一块屋顶各一个编号），由区块构建器在生成几何时分配编号，稳定可复现。状态层只有每表面一个字节，网络同步和存档都是补丁。以后要自由笔触，再把查找纹理换成每区块一张可写的画布纹理，`paint` 系统之外的层不用动。

有色率直接从状态层数出来（非 0 的表面数），`progression` 订阅 `patch:applied` 即可计分，不需要第二套记录。

## 5. 现有代码去向

| 现有                                                                                        | 去向                                                        | 处理                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `render.js` `physics.js` `nav.js` `input.js` `touch-input.js` `audio.js` `effects.js`       | `engine/`                                                   | 搬，材质加表面属性                      |
| `exploration/schema.js` `region.js` `progression.js`（数据部分） `online/protocol.js`       | `world/`                                                    | 搬                                      |
| `server/*`                                                                                  | 不动                                                        | 补丁类型加 `paint`，存储按 kind 分文件  |
| `exploration/chunks.js` `structures.js` `roadside.js` `interior-geometry.js`                | `systems/streaming/build/`                                  | 搬，构建时写 `aSurface`                 |
| `exploration/scenes.js` `interiors.js`                                                      | `systems/scenes` + `systems/interaction`                    | 拆：门变成第一个可交互物                |
| `exploration/session.js`                                                                    | `modes/open-world` + `systems/sync` + `systems/progression` | 重写编排层，搬具体函数                  |
| `online/multiplayer.js` `match.js` `room.js` `transport.js` `remote-player.js` `network.js` | `modes/pvp` + `systems/sync`                                | 连接与快照抽到 `sync`，比赛规则留在模式 |
| `player.js` `weapons/*` `enemies/*` `online/combat.js`                                      | `systems/combat` + `systems/tools`                          | 搬；武器数组改成工具数组                |
| `systems/waves.js` `focus.js` `pickups.js`                                                  | `modes/survival`                                            | 搬                                      |
| `index.js`                                                                                  | `mountShooter` 瘦身                                         | 重写，约 150 行                         |
| `ui/*` `hud.js` `preferences.js`                                                            | `shell/`                                                    | 搬，HUD 槽位泛化                        |
| `tests/*`                                                                                   | 保留并按新路径修 import                                     | 是重构的安全网                          |

## 6. 需要先定的决策

1. ~~上色粒度~~：已定按表面，修复 / 涂鸦两种模式，见 [game-design-v2.md](game-design-v2.md) 第 5 节。
2. **上色是装饰还是玩法**：影响是否要在 `progression` 里订阅涂色事件，以及是否需要阵营概念。
3. **语言**：新项目可以直接上 TypeScript。`world/` 的补丁和协议最受益；`engine/` 的着色器和 Three.js 调用收益小。折中是 `world/` 和 `systems/` 用 TS，`engine/` 先保留 JS。
4. **手机**：V2 是否承诺触屏。影响 `tools` 接口要不要从第一天就带触屏布局。

## 7. 落地顺序（确定方案后）

1. 建新目录骨架，`engine/` 和 `world/` 原样搬入，测试跑通。
2. 写 `Session` 接口和瘦身后的 `mountShooter`；先用 `survival` 模式验证骨架（它最简单）。
3. 把 `session.js` 按第 2 节拆进 `systems/` 和 `modes/open-world`，功能不变，测试通过。
4. `tools` 接口 + HUD 槽位泛化。
5. 材质 `aSurface` + `WorldState` paint 覆盖层 + `paint` 系统，先单机，再接补丁同步。

前三步不加功能，只换结构；第四步起才是上色。
