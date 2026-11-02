# 重彩 Inkbloom

世界本来是彩色的。墨潮把颜色抽走，留下黑白线稿；玩家把颜色还回来，或者按自己的想法重新涂。

浏览器第一人称游戏，PC 键鼠。无限野外 + 永久城市副本，纸面墨线画风。

## 运行

需要 Node.js 20.15+ 和支持 WebGL 2 的桌面浏览器。

```sh
npm install
npm run dev
```

打开 <http://127.0.0.1:5190>。地址参数：`?world=<存档名>` 选存档槽，`?seed=<整数>` 指定新世界种子。存档在浏览器 localStorage。

```sh
npm run check   # 类型检查 + 测试 + 格式检查 + 生产构建
npm test        # 只跑测试
```

## 操作

WASD 移动 · 空格 跳（可二段跳）· Shift 冲刺 · E 交互
左键按住 还色 · 右键 切换修复 / 涂鸦 · Q/R 或滚轮 换色
F2 自由飞行 · F3 调试面板 · Esc 暂停

## 当前进度：第一个纵向切片

- 野外：4 个群系的台地地形、树、河，按区块流式加载；颜色随附近城市进度派生
- 城市入口：每 7×7 区块一座地标塔，第一座在出生点可见处
- 城市副本：直角生长的道路、街块、模板建筑、城墙城门；全部从种子确定性生成
- 笔刷：修复（原色、通用颜料）与涂鸦（选色、彩色颜料），按表面计
- 存档：每表面一字节状态 + 补丁式写入，退出重进保留

还没有：敌人与战斗、墨潮、颜料采集与画室、AI 风格、居民诉求、纸飞机。见 [docs/roadmap.md](docs/roadmap.md)。

## 文档

- [docs/architecture.md](docs/architecture.md) —— 代码分层与数据流，先读这个
- [docs/EXTENDING.md](docs/EXTENDING.md) —— 改数值、加颜色、加群系、加工具……的具体步骤
- [docs/game-design.md](docs/game-design.md) —— 玩法设计
- [docs/world-generation.md](docs/world-generation.md) —— 世界生成算法
- [docs/roadmap.md](docs/roadmap.md) —— 下一步
