# 人物与村民模型

玩家可选 133 个角色。选角菜单可以按素材包筛选：动画角色包有 52 个，RPG 角色包有 6 个，太空探险包有 4 个，海盗包有 7 个船员，Kenney 迷你人物包有 20 个，幸存者包有 4 个，寿司店角色包有 8 个，方块世界包有 4 个，赛博朋克包和平台冒险包各有 1 个，原有角色包括 Quaternius 模块化男性包的 11 套、女性包的 10 套和 5 个 KayKit 角色。石匠对应 Barbarian、学徒对应 Mage、巡林人对应 Rogue_Hooded，船夫和园丁共用 Rogue 外形，默认强调色不同。

打开 `?preview=witch` 可直接预览绘色女巫。选择「第一人称 → 画笔」可看她用短手掌握笔，选择「第三人称」可看全身动作。点「确认选择」后即可用她进入游戏。

打开 `?preview=animated/ChefHat` 或 `?preview=rpg/Ranger` 可直接对照高帽厨师和弓手。动画角色包的握点落在各自的拳形手掌内，RPG 角色使用原有握点、拇指和联动指节。两包保留原造型配色，可更换画笔色。

选择角色后，动作面板支持第一、第三人称，以及待机、走、慢跑、跑、跳、画笔、挥刀、步枪、滑翔、游泳。摄像机手部裁自同一模型，独立骨架；KayKit 使用原握点和短臂适配。其素材本身是简化手形，没有 Quaternius 的独立五指关节。

在「选择角色 → 查看村民动作」中，可按素材包筛选 69 个居民造型。KayKit 的 5 个居民支持双视角。Quaternius 的 52 个动画角色共用 19 段动作，6 个 RPG 角色可预览各自的完整原版动作，包括弓手的拉弓、射箭和法师的施法。村民模式用第三人称播放原包动作；在玩家模式，同一造型使用游戏的双视角和玩家动作。方块世界的四位旅人、霓虹行者和跃台兔也会在普通居民中出现，支持待机、行走、招手和出拳。预览村民后可返回自己的玩家外观。

城镇、农庄按居民身份从 12 套衣料配色中取一套，有独立头发区域的角色还会从 6 种发色中取一种。野外旅行者按世界与路线确定配色。同一人读档或从农庄迁回城镇时会保留原来的衣服和发色。素模村民只有皮肤和五官，没有可染区域。

Easy Enemy 包的墨蛙、墨鼠、墨蛇、怒墨蛇、墨蛛、墨蜂会在受侵蚀的野外生成。普通蛇和怒蛇分别使用原版两份网格，墨蜂使用飞行动作。六个造型都走野怪的追击、受击、击败与墨滴奖励流程。

太空探险包的蜜蜂、火烈鸟、青蛙和小熊猫宇航员可在玩家选角中预览并使用。打开 `?preview=space/FinnTheFrog` 可查看芬恩的握笔和跑跳。墨星幼体、墨星浮球和墨星飞翼会在受侵蚀的野外悬浮追击；墨星重兽在地面近战。

海盗包的安妮、巴巴罗萨、亨利、马科、鲨鱼水手、骷髅船员和无头船员都可以选。打开 `?preview=pirate/Captain_Barbarossa` 可查看船长的铁钩和右手画笔。Kenney Mini Characters 2.0 的 20 个可选人物包含 13 个旅人和 7 个主题造型，打开 `?preview=kenney/character-robot` 可查看机器人。每个迷你人物的肘、腕和掌心握点均按原网格拟合。两套玩家都使用游戏的第三人称动作和本人手臂的第一人称模型。

受侵蚀的野外还会生成 75 个造型，包括 KayKit 的 4 个骷髅、Cute Animated Monsters 的 21 个林地怪，以及 Ultimate Monsters 的 16 个大型、17 个团子和 17 个飞行怪。骷髅法师远程攻击，骷髅游荡者突进，飞行怪的命中范围随其悬浮高度抬起。林地树精倒下时收缩，只有悬浮动画的飞空角魔用前倾动作表现冲撞。怪物均按需加载，存档沿用已有怪物类型编号。

在「选择角色」里筛选「幸存者包」或「寿司店角色包」，可以试用莉丝、马特、山姆、肖恩、熊猫寿司师傅和七款兔店员。打开 `?preview=outbreak/Lis` 或 `?preview=sushi/Rabbit_Pink` 可直接试握画笔。手臂沿用角色本身的袖子、手掌和指节。

受侵蚀的野外也会遇到四种僵尸，以及迷惑龙、副栉龙、剑龙、霸王龙、三角龙、迅猛龙。恐龙的命中区域会随头尾方向转动，迅猛龙会突进。枯骨僵尸使用游戏的前倾攻击，恐龙的受击反馈使用闪色和身体侧倾。

方块世界有四款男女旅人外观，方块手掌可随画笔转动。赛博朋克包的霓虹行者使用装甲手套和原掌心握点，平台冒险包的跃台兔使用自己的拳套。打开 `?preview=cyber/Character` 或 `?preview=platformer/Character` 可切换视角试用。受侵蚀的野外会生成八种方块怪和三种机械巡逻怪。方块巫师可以远攻，悬浮巡逻机在离地高度受击。

## 画风与贴图

内置 imagegen 生成 `public/textures/characters/painted-materials-v1.png`，四区分别是亚麻布、旧皮革、皮肤、手绘发丝。生成提示词保存在同目录 README。材质按部位使用不同区域，以静止网格坐标三向投射，随蒙皮变形；镜像平铺和区域内缩避免图集串色。图集提供漫反射明暗细节，底色仍由服装分区和玩家配色决定，不会把所有衣服染成米色。

人物采用柔化的阴影、暖棕轮廓、低饱和布料色，取消黑色人物区域的湿墨高光。皮肤纹理强度低于衣物。该版本是现有模型的手绘材质适配，保留原来的头身比和服装轮廓，未重新雕刻面部或制作布料物理。

## 重建

1. `python tools/build_kaykit_villagers.py artifacts/kaykit/source`
2. Blender 后台运行 `tools/build_kaykit_player_rigs.py`，使用 `--python-exit-code 1`。
3. 在 Blender 中运行 `tools/build_modular_adventurer.py -- source.glb --no-render`。女性包加上 `--women`。
4. 将清单中的动画角色 USDA、动作 FBX、RPG glTF 分别放入 `artifacts/quaternius/animated`、`animated-motions`、`rpg` 子目录。动作文件按清单的 clip 名命名，扩展名为 `.fbx`。在 Blender 中运行 `tools/build_quaternius_residents.py`。
5. 用 Blender 后台运行 `--python-exit-code 1 --python tools/build_quaternius_player_rigs.py`，从上一步的 58 份居民 GLB 生成 `players/animated/` 和 `players/rpg/` 下的玩家模型。
6. 将原版 Wasp.glb 放入 `artifacts/quaternius/enemies/`，运行 `python3 tools/repair_quaternius_wasp.py` 修复六个无效蒙皮权重。其余五个怪物直接使用清单对应的 GLB。
7. 将清单列出的 8 份 Ultimate Space Kit 源 GLB 放入 `artifacts/quaternius/space/`，按原文件名去掉 `-transformed` 后缀。在 Blender 中运行 `tools/build_quaternius_space.py`。
8. 运行 `python3 tools/character_asset_manifest.py` 更新来源与 SHA-256。
9. 将 Pirate Kit 的 glTF、Kenney Mini Characters 2.0 的 GLB（保留相邻的 `Textures`）分别传给 Blender 脚本 `tools/build_pirate_mini_players.py`。用 `tools/build_wild_creature_packs.py` 处理三个怪物包。两份脚本的文件头给出了命令和目录结构。
10. 运行 `python3 tools/five_pack_manifest.py <素材目录>`，更新五个包的作者、许可、来源和成品哈希。逐模型清单见 [five-pack-sources.json](../public/models/five-pack-sources.json)。

11. 按[这三个包的来源清单](../public/models/survivors-sushi-dinosaurs.json)，将原始文件放进 `artifacts/quaternius/{outbreak,sushi,dinosaurs}/` 对应子目录，用 Blender 后台运行 `tools/build_survivors_sushi_dinosaurs.py`。
12. 按[方块世界、赛博朋克和平台冒险来源清单](../public/models/cube-cyber-platformer.json)，将原文件放入 `artifacts/quaternius/{cube,cyber,platformer}/` 对应子目录，用 Blender 后台运行 `tools/build_cube_cyber_platformer.py`。

其余资源许可及哈希见 `public/models/kaykit/CREDITS.md`、`public/models/quaternius/MODULAR-CREDITS.md` 及各 manifest。验证截图位于 `artifacts/character-pack/`。
