# Ultimate Modular Men — all eleven outfits

Author: **Quaternius**.

Pack: **Ultimate Modular Men Pack** (February 2022): Adventurer, Beach, Casual, Casual2, Farmer, King, Punk, Spacesuit, Suit, Swat, Worker.

The remaining ten source files were retrieved from the same public mirror on 2026-11-23. `manifest.json` records every source URL and source/export SHA-256. Each outfit retains its original geometry, clothing and weights, with normalized rest bones and InkBloom palette slots. The generated material-detail atlas is shared with KayKit characters; see `public/textures/characters/README.md`.

- Author's pack page: https://quaternius.com/packs/ultimatemodularcharacters.html
- Author's original folder: https://drive.google.com/drive/folders/1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX
- Pack license: **CC0 1.0 Universal**, as listed on the pack page.
- License deed: https://creativecommons.org/publicdomain/zero/1.0/

Retrieved on 2026-11-19 from this public mirror after the author's Google Drive download reported its quota exceeded:

https://github.com/trebeljahr/quaternius-showcase/blob/main/public/glb/modular_men/Adventurer.glb

Mirror attribution and per-pack license record:

https://github.com/trebeljahr/quaternius-showcase/blob/main/LICENSES.md

Source Git blob: `14456cd24345ad437840365396b60e82af653507`.

Source file SHA-256: `2CB27A7729954CD463B9E9DD8B3B7E64919F3A41F0613A2075AD910BB14CE324`.

Adaptation: preserved original geometry, proportions, clothing, normals and skin weights; baked imported bind transforms into an arms-down rest pose; normalized facing and floor; renamed bones and mapped material slots to InkBloom's palette; joined the export for ten material primitives. Rebuilt by `tools/build_modular_adventurer.py`.

The runtime uses InkBloom's procedural poses, not the original pack's animation clips. The mirror's MIT license applies to its showcase code, not these character assets.

## Additional Quaternius packs

Quaternius lists the four packs below under CC0 1.0. The local manifest records each model's source URL and SHA-256 alongside the shipped file's SHA-256.

- The 10 outfits from the [Ultimate Modular Women Pack](https://quaternius.com/packs/ultimatemodularwomen.html) use the playable rig, hand-painted materials and a brush grip fitted to the knuckles. The game retains Witch's original character key.
- The [Easy Enemy Pack](https://quaternius.com/packs/easyenemy.html) contains five species. The game uses six files including the angry snake variant. Materials map to ink and stolen colours. The Wasp export repairs six invalid source skin weights.
- The 52 [Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html) residents retain their original geometry and share 19 motion clips in BaseCharacter.glb. The build aligns the two FBX coordinate conventions with the USD skeleton and bakes the authored material regions into local pigments.
- The six [RPG Character Pack](https://quaternius.com/packs/rpgcharacters.html) residents retain their native clips and equipment. The game samples the original textures into its palette.

The build inputs for the animated residents come from the [Quaternius Stage model mirror](https://github.com/chibifire-stages/quaternius-stage) and the [pack-zoo animation mirror](https://github.com/nginetechnologies/pack-zoo-character.nplugin). The RPG inputs come from the [Cairnfall asset mirror](https://github.com/euuuuuuan/cairnfall-public). All three revisions are pinned in the manifest.

The 58 models in `players/animated/` and `players/rpg/` are playable adaptations of the corresponding resident exports. The Blender build normalizes their skeletons and fits each to player height, preserves the outfit pigments, and fits a brush socket to each fist or RPG weapon grip. The camera uses the same skinned sleeves and hands as the full-body player. Player motion and held tools come from InkBloom. Each resident manifest entry includes the playable file and its SHA-256.

## Ultimate Space Kit

Quaternius released the [Ultimate Space Kit](https://quaternius.com/packs/ultimatespacekit.html) under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). InkBloom ships Barbara the Bee, Fernando the Flamingo, Finn the Frog and Rae the Red Panda as playable astronauts, plus ExtraSmall, Small, Flying and Large as wilderness enemies. Source GLBs come from the [pinned Quaternius Showcase mirror](https://github.com/trebeljahr/quaternius-showcase/tree/0128ca510d653bb04d6d1e4885bd8890b5050b4f/public/glb/ultimate_space_pack). The manifest lists the source and shipped SHA-256 for each model.

The player exports preserve the suits, bake their atlas into the game's palette and fit wrists and brush sockets to the four-finger gloves. The enemy exports preserve their movement, attack, hit and death clips and map the original atlas regions to ink and stolen colours. Rebuild them with `tools/build_quaternius_space.py`.
