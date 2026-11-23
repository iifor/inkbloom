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
