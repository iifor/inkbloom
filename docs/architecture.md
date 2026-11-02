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
  engine/          与玩法无关：render（墨线渲染、几何构建）、physics（AABB）、input
  world/           纯数据与纯函数：数学、野外生成、城市生成、表面状态、补丁、存档。无 Three.js，Node 可测
  content/         设计数据：调色板、群系、模板、数值、按键、名字。改设计主要改这里
tests/             world/ 和 physics 的单元测试（vitest）
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

**2. 改存档只走补丁。** `world/patch.ts` 的 `applyPatch` 是唯一写 `WorldState` 的地方；系统调 `ctx.apply(patch)`，成功会广播 `patch:applied`。以后联机：访客发补丁、房主校验后广播，同一套。

**3. 颜色是一字节。** 每个表面在城市骨架里有原色；存档只存当前状态：`0` 抽色、`1` 原色、`2+n` 涂鸦第 n 色。渲染器从状态纹理读同一个字节，所以存档、补丁、画面永远一致。

**3a. 改生成器或内容会让旧城重置，而不是错位。** 城市骨架每次从代码和数据重新生成，所以每座城的存档都带一个布局指纹（表面的种类、区块、面积序列的哈希，不含原色）。调了 `tuning.city`、模板或生成算法导致表面列表变化时，这座城的颜色进度会重置并提示玩家；只改原色（调色）不会重置。

**4. 系统之间不 import。** 需要别的系统的能力，通过 `GameContext`（`ctx.player`、`ctx.scenes`、`ctx.interactions`…）或事件（`ctx.events`）。

**5. 数值集中在 `content/tuning.ts`。** 系统里不写魔法数字。

**7. 声音和特效只是听众。** `AudioSystem` 和 `EffectsSystem` 只监听事件，玩法代码从不调用它们；删掉这两个系统游戏照样能玩。屏幕上的伤害数字和血条（`shell/combat-overlay.ts`）同理。

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

所有静态网格用 `GeometryBuilder` 合并成每区块 / 每城一个网格，一个材质（`ink-material.ts`）。顶点带 `aColor`（原色）和 `aSurface`（表面编号，`-1` 表示跟随派生颜色）。材质写 G-buffer，后处理（`renderer.ts`）画纸、墨线、排线和水彩。饱和度 0 是石墨线稿，1 是彩色。

## 物理

纯 AABB 盒子 + 空间哈希，自动上 0.55 米台阶。碰撞体按组添加删除（每个野外区块一组）。射线按网格 DDA 走，命中的盒子带 `faces` / `decals` 映射到表面编号——笔刷就是这样知道打到了哪面墙。

因为只有轴对齐盒子：地形是台地；城市道路只做直角转弯。需要斜向建筑时要先加旋转碰撞体。
