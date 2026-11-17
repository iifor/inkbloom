# 架构

## 分层

依赖只能向下。下层不知道上层存在。

```text
src/
  main.ts          页面入口：读档 / 建档、启动模式、开始遮罩
  shell/           HUD、样式、开发者工具（window.inkbloom）
  modes/           组合根：一个模式 = 一组系统 + 顺序。open-world.ts 是唯一知道所有系统的文件
  systems/         每帧运行的功能模块：player / scenes / wilderness / city / interaction / tools / save / debug
  game/            契约：types.ts（System、GameScene、GameContext…）、events.ts、loop.ts
  engine/          与玩法无关：render（手绘上色、昼夜光影、几何构建）、physics（盒子 + 平滑地面）、input
  world/           纯数据与纯函数：数学、野外生成、城市生成、表面状态、补丁、存档。无 Three.js，Node 可测
  content/         设计数据：调色板、群系、模板、数值、按键、名字。改设计主要改这里
tests/             world/ 和 physics 的单元测试；墨潮、墨怪、战斗的无头模拟（support/headless.ts，vitest）
```

| 层      | 可以依赖                  | 不可以                       |
| ------- | ------------------------- | ---------------------------- |
| content | 无（只引用 content 内部） | 任何代码层                   |
| world   | content                   | three、DOM、engine、systems  |
| engine  | content、three            | world 的玩法概念、systems    |
| game    | 以上全部的类型            | 具体系统实现                 |
| systems | 以上全部                  | 其他系统的实现（只通过 ctx） |
| modes   | 全部                      | —                            |

## 核心约定

**1. 世界是种子的函数。** 地形、群系、树、城市入口、城市骨架都由 `(seed, 坐标/ID)` 算出来，任何顺序生成结果都一样。所以只存档玩家造成的改变，不存生成内容。`world/` 里禁止 `Math.random`，用 `Rng` 或 `hashAt`。

**2. 改存档只走补丁。** `world/patch.ts` 的 `applyPatch` 是唯一写 `WorldState` 的地方；系统调 `ctx.apply(patch)`，成功会广播 `patch:applied`。联机时（`server/`）：客户端本地先生效并把补丁发给世界服务器，服务器把发送者自己的那份存档换进来再跑同一个 `applyPatch` 校验（`world/net/slices.ts`），改到共享世界的补丁再广播给其他人，回复和广播里都带着服务器处理后的值（`world/net/fix.ts`），客户端照着纠正；没有房主。

**3. 颜色是一字节。** 每个表面在城市骨架里有原色；存档只存当前状态：`0` 抽色、`1` 原色、`2+n` 涂鸦第 n 色。渲染器从状态纹理读同一个字节，所以存档、补丁、画面永远一致。

**3a. 改生成器或内容会让旧城重置，而不是错位。** 城市骨架每次从代码和数据重新生成，所以每座城的存档都带一个布局指纹（表面的种类、区块、面积序列的哈希，不含原色）。调了 `tuning.city`、模板或生成算法导致表面列表变化时，这座城的颜色进度会重置并提示玩家；只改原色（调色）不会重置。

**4. 系统之间不 import。** 需要别的系统的能力，通过 `GameContext`（`ctx.player`、`ctx.scenes`、`ctx.interactions`…）或事件（`ctx.events`）。

**5. 数值集中在 `content/tuning.ts`。** 系统里不写魔法数字。

**7. 声音、特效和氛围只是听众。** `AudioSystem`、`EffectsSystem` 和 `AtmosphereSystem`（天空颜色、墨潮把画面褪成黑白）只监听事件，玩法代码从不调用它们；删掉这些系统游戏照样能玩。屏幕上的伤害数字和血条（`shell/combat-overlay.ts`）同理。

**6. 场景可以组合共享的玩法组件。** 城市场景由墨渍、画室、侵蚀、墨潮、墨怪等部件组成；墨怪组（`systems/combat/monsters.ts`）是共享组件，城市现在用，野外以后也用。它通过 `ctx.combat` 注册为可被射击的目标，武器不 import 它。

## 一帧

```text
input.update()
player      读输入 → 移动 → 相机
scenes      当前场景 update：野外流式加载区块、刷新派生颜色
interaction 找最近的可交互物，处理 E
tools       当前工具（笔刷）射线 → 表面 → 补丁
hud         读状态，更新 DOM
save        防抖存档
debug       F3 面板
renderer.render()
```

## 场景

`GameScene` 有自己的 `root`（Three.js 组）和 `physics`。`SceneManager` 负责切换：野外常驻缓存，城市进入时创建、离开时销毁（状态在存档里，不在场景里）。以后的住宅室内是第三种场景。

## 渲染

所有静态网格用 `GeometryBuilder` 合并成每区块 / 每城一个网格，一个材质（`ink-material.ts`）。顶点带 `aColor`（原色）和 `aSurface`（表面编号，`-1` 表示跟随派生颜色）。材质写 G-buffer（R 受光，已乘上太阳阴影；G 颜色码；BA 法线），后处理（`renderer.ts` 排各遍的先后；上色一遍是 `paint-shader.ts` / `paint-pass.ts`，天空和水在 `sky-paint.ts`、`water-paint.ts`，笔触一遍 `brush-pass.ts`，泛光 `glow.ts`，太阳阴影 `sun-shadows.ts`）把它画成手绘动画背景：暖色日光、天空色的冷阴影、按世界坐标的笔触斑驳（草和树叶强，墙面弱，见调色板的 `texture`）、角落的柔和接触阴影、天空和积云、远处的雾，没有描边；最后一遍 FXAA 抗锯齿。饱和度 0 是同一幅画褪成灰色，1 是彩色。

一帧三遍：太阳阴影图（玩家前方 140 米见方，按纹素对齐，草不投影）→ G-buffer → 上色 + FXAA。光照随一天的时间变化（`daylight.ts`：太阳位置、日光 / 阴影 / 天空颜色按时刻插值，夜里出星星、有色街道的窗户亮灯），时刻由 `AtmosphereSystem` 从世界时钟算出，`TUNING.day` 调一天多长。

## 物理

AABB 盒子 + 空间哈希，自动上 0.55 米台阶；野外另有平滑地面（`physics.ground` 高度函数：站立、下坡贴地、坡度上限、射线命中）。碰撞体按组添加删除（每个野外区块一组）。射线按网格 DDA 走，命中的盒子带 `faces` / `decals` 映射到表面编号——笔刷就是这样知道打到了哪面墙。

盒子可以带 `yaw` 绕竖轴转：哈希格和粗测用它转后的 AABB，再在盒子自己的坐标系里精测（身体用分离轴、射线用 slab），身体沿斜墙的法线推出、贴墙滑；`yaw` 为 0 的盒子走原来的轴对齐路径，开销不变；转整数个直角的盒子就是它的 AABB，也走这条路。斜放的东西只有这一种做法：野外遗迹的石头、镇上的房子（连同台阶、篱笆）、桥、河边台阶和竞技场的墙都是带 `yaw` 的盒子，一件一个。可涂的盒子（房子的墙和屋顶）的面和贴花（门）按盒子转之前的样子记，`surfaceAt` 先把命中点和法线转回盒子自己的坐标系再查，所以表面编号和转不转无关。城市道路仍只做直角转弯（表面编号进存档）。
