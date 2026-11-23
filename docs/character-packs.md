# 人物与村民模型

角色选择共 16 个身份：Quaternius 模块化男性素材包全部 11 套；原石匠、学徒、巡林人、船夫、园丁改用 KayKit 模型，保留旧角色键和存档。石匠对应 Barbarian、学徒对应 Mage、巡林人对应 Rogue_Hooded，船夫和园丁共用 Rogue 外形，默认强调色不同。没有把职业名称写成模型中不存在的安全帽、斗笠或围裙。

选择角色后，动作面板支持第一、第三人称，以及待机、走、慢跑、跑、跳、画笔、挥刀、步枪、滑翔、游泳。摄像机手部裁自同一模型，独立骨架；KayKit 使用原握点和短臂适配。其素材本身是简化手形，没有 Quaternius 的独立五指关节。

“查看 KayKit 村民与动作”是独立只读入口，包含五种源模型及八个原版动作；退出后回到尚未确认的玩家外观，不保存村民预览选择。普通村民无武器，守卫保留剑盾、伐木工保留斧头、法师保留法杖。装备是外观，不新增战斗 AI。游泳/滑翔是玩家程序姿态，不是虚构的 KayKit 原版片段。

## 画风与贴图

内置 imagegen 生成 `public/textures/characters/painted-materials-v1.png`，四区分别是亚麻布、旧皮革、皮肤、手绘发丝。生成提示词保存在同目录 README。材质按部位使用不同区域，以静止网格坐标三向投射，随蒙皮变形；镜像平铺和区域内缩避免图集串色。图集提供漫反射明暗细节，底色仍由服装分区和玩家配色决定，不会把所有衣服染成米色。

人物采用柔化的阴影、暖棕轮廓、低饱和布料色，取消黑色人物区域的湿墨高光。皮肤纹理强度低于衣物。该版本是现有模型的手绘材质适配，保留原来的头身比和服装轮廓，未重新雕刻面部或制作布料物理。

## 重建

1. `python tools/build_kaykit_villagers.py artifacts/kaykit/source`
2. Blender 后台运行 `tools/build_kaykit_player_rigs.py`，使用 `--python-exit-code 1`。
3. Quaternius 每个源 GLB 运行 `tools/build_modular_adventurer.py -- source.glb --no-render`。

资源许可及哈希见 `public/models/kaykit/CREDITS.md`、`public/models/quaternius/MODULAR-CREDITS.md` 及各 manifest。验证截图位于 `artifacts/character-pack/`。
