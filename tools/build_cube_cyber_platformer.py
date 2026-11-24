"""Convert the original Cube World, Cyberpunk and Platformer models into gameplay GLBs.

blender -b --python-exit-code 1 -P tools/build_cube_cyber_platformer.py
Inputs and checksums are listed in public/models/cube-cyber-platformer.json.
"""
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_pirate_mini_players import character_pigment, keep_skinned, normalize_root_weights
from build_quaternius_player_rigs import build, MODELS
from build_quaternius_residents import bake_palette, palette
from build_wild_creature_packs import export

CACHE = Path(__file__).resolve().parents[1] / 'artifacts/quaternius'


COLOR_INDEX = {key: i for i, (key, _) in enumerate(palette)}
# Original atlas swatches are per-face constants. Preserve the distinction between
# pupils, hair and dark skin, and the green, red and blue families on the creatures.
CUBE_SWATCHES = {
    '343434': 'ink', '3a3e34': 'ink', '45433b': 'charcoal', '695140': 'skinDeep',
    '583e2a': 'bark', '876e5b': 'skinDeep', 'cfa78b': 'skinWarm', '7e260e': 'brown',
    'b9822a': 'orange', 'cf9f41': 'yellow', '6d8020': 'green', '375a71': 'glass',
    '74861c': 'green', '7d250e': 'red', '44423a': 'charcoal', 'cca425': 'yellow',
    'b143ff': 'purple', '62357d': 'purple', '7d2647': 'red', 'c3ae74': 'sand',
    '966f39': 'brown', '705d40': 'bark', '304d61': 'blue', '9e527d': 'pink',
    'a7a392': 'stone', '408ead': 'sky', '2e2d27': 'ink', '942b11': 'red',
}


def cube_pigment(rgb):
    source = bytes(round(float(c) * 255) for c in rgb).hex()
    key = CUBE_SWATCHES.get(source)
    return COLOR_INDEX[key] if key else character_pigment(rgb)


def bind_block_palms(rig):
    # In the Cube World source the wrist is an unweighted marker near the end of the
    # block. Put the pivot at the base of the palm and transfer the distal arm weights.
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for side in ('L', 'R'):
        elbow = rig.data.edit_bones['LowerArm.' + side]
        wrist = rig.data.edit_bones['Fist.' + side]
        wrist.use_connect = False
        wrist.translate((elbow.head - wrist.head) * 0.30)
    bpy.ops.object.mode_set(mode='OBJECT')
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    for side in ('L', 'R'):
        upper, fore, hand = (mesh.vertex_groups[name + '.' + side] for name in ('UpperArm', 'LowerArm', 'Fist'))
        wrist = rig.matrix_world @ rig.data.bones[hand.name].head_local
        axis = wrist - rig.matrix_world @ rig.data.bones[fore.name].head_local
        blend = axis.length * 0.3
        axis.normalize()
        for vertex in mesh.data.vertices:
            t = min(1, max(0, 0.5 + (mesh.matrix_world @ vertex.co - wrist).dot(axis) / blend))
            if t == 0:
                continue
            weights = [(w.group, w.weight) for w in vertex.groups if w.group in (upper.index, fore.index)]
            for i, weight in weights:
                mesh.vertex_groups[i].add([vertex.index], weight * (1 - t), 'REPLACE')
            if weights:
                hand.add([vertex.index], sum(w for _, w in weights) * t, 'REPLACE')


def fit_player(rig):
    if rig.data.bones.get('Hand.R'):
        # The cyber suit ships with a drawn sword and a socket inside its palm.
        bpy.data.objects.remove(bpy.data.objects['Sword'], do_unlink=True)
        for side in ('L', 'R'):
            rig.data.bones['Hand.' + side].name = 'Fist.' + side
        rig.data.bones['Weapon'].name = 'Weapon.R'
    keep_skinned(rig)
    normalize_root_weights()


def fit_cube(rig):
    keep_skinned(rig, texture_pigment=cube_pigment)
    bind_block_palms(rig)
    normalize_root_weights()


# The cube atlas reuses the same red swatch for one shirt and another model's hair.
CUBE_DYES = {
    'Character_Female_1': ('b9822a', '375a71', '45433b'),
    'Character_Female_2': ('6d8020', '375a71', '7e260e'),
    'Character_Male_1': ('7e260e', '375a71', 'cf9f41'),
    'Character_Male_2': ('297e7b', '3d647e', '583e2a'),
}


def build_resident(path):
    family = path.parent.name
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and (not obj.data.materials or obj.name == 'Sword'):
            bpy.data.objects.remove(obj, do_unlink=True)

    def dye(obj, poly, material, rgb, index):
        if family == 'cube':
            swatches = CUBE_DYES[path.stem]
            key = bytes(round(float(channel) * 255) for channel in rgb).hex()
            return 1 + swatches.index(key) if key in swatches else 0
        if family == 'cyber':
            return {'Accent': 1, 'Accent_Dark': 2}.get(material, 0)
        return int(obj.name == 'Body' and material == 'Main2')

    bake_palette(cube_pigment if family == 'cube' else character_pigment, dye_role=dye)
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    tracks = rig.animation_data.nla_tracks
    rig.animation_data.action = None
    for track in list(tracks): tracks.remove(track)
    names = {'Idle_Neutral' if family == 'cyber' else 'Idle': 'Idle',
             'Walk': 'Walk', 'Wave': 'Wave', 'Punch_Right' if family == 'cyber' else 'Punch': 'Punch'}
    for action in list(bpy.data.actions):
        source = action.name.rsplit('|', 1)[-1]
        if source not in names:
            bpy.data.actions.remove(action)
            continue
        action.name = names[source]
        track = tracks.new()
        track.name = names[source]
        track.strips.new(track.name, 0, action)
    assert set(t.name for t in tracks) == set(names.values())
    target = MODELS / family / (path.stem + '.glb')
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_animation_mode='NLA_TRACKS',
                              export_attributes=True, export_texcoords=False, export_anim_slide_to_zero=True)


if __name__ == '__main__':
    for family, files in [
        ('cube', ['Character_Female_1.gltf', 'Character_Female_2.gltf', 'Character_Male_1.gltf', 'Character_Male_2.gltf']),
        ('cyber', ['Character.glb']),
        ('platformer', ['Character.glb']),
    ]:
        for file in files:
            src = CACHE / family / file
            build_resident(src)
            build(src, fit_cube if family == 'cube' else fit_player, MODELS / 'players' / family / (src.stem + '.glb'))
    for name in ['Demon', 'Giant', 'Goblin', 'Skeleton', 'Skeleton_Armor', 'Wizard', 'Yeti', 'Zombie']:
        # The armoured skeleton omits albedo on its iron plates and skeleton.
        materials = {'Material.002': COLOR_INDEX['stone'], 'Atlas': COLOR_INDEX['sand']} if name == 'Skeleton_Armor' else None
        export(CACHE / 'cube' / (name + '.gltf'), 'cube', cube_pigment, {'Attack': ['Attack']}, materials)
    for name in ['Enemy_2Legs', 'Enemy_Flying', 'Enemy_Large']:
        clips = {'Attack': ['Attack']}
        if name == 'Enemy_Flying':
            clips.update(Flying=['Run'], Walk=[], Death=['Dead'])
        export(CACHE / 'cyber' / (name + '.glb'), 'cyber', clip_overrides=clips)
