# KayKit Adventurers

Author: Kay Lousberg / KayKit.

- Pack: https://kaylousberg.itch.io/kaykit-adventurers
- Source: https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0
- License: CC0 1.0 Universal, included in the source repository.
- Downloaded 2026-11-23. Source and derived file SHA-256 hashes are recorded in `manifest.json` and `player-manifest.json`.

Five source models are retained: Barbarian, Knight, Mage, Rogue, Rogue_Hooded. Native village models preserve authored skin weights and eight animation clips. The texture atlas is baked to constant-per-triangle InkBloom palette regions. Ordinary villagers are unarmed; Knight retains sword/shield, Barbarian an axe, and Mage a staff.

`tools/build_kaykit_villagers.py` builds native village assets from the official extracted archive. `tools/build_kaykit_player_rigs.py` builds separate `player-*.glb` assets: arms-down rest pose, normalized facing, names and height, palette material regions, and skinned hats/capes. Player equipment comes from the active tool slot, so the source weapons are omitted from these copies. Original meshes and weights are retained; runtime poses use the game's IK rather than native clips.

The generated material-detail atlas is documented separately in `public/textures/characters/README.md`.
