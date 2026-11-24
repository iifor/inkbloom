"""Build Ultimate Space Kit players and enemies from the eight GLBs in artifacts/quaternius/space.

Run with Blender --background --python-exit-code 1 --python tools/build_quaternius_space.py.
Source URLs and hashes are recorded in public/models/quaternius/manifest.json.
"""
import colorsys
import sys
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_quaternius_player_rigs import build
from build_quaternius_residents import bake_palette, palette

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'artifacts/quaternius/space'
MODELS = ROOT / 'public/models/quaternius'


def atlas_pigment(rgb):
    # Blender exposes these byte-backed PNG pixels as sRGB. Keep the distinctive
    # animal colours separate from the low-chroma metal of the space suits.
    hue, saturation, _ = colorsys.rgb_to_hsv(*rgb)
    neutral = {'ink', 'charcoal', 'rock', 'stone', 'snow'}
    coloured = {'blue', 'red', 'orange', 'yellow', 'green', 'teal', 'sky', 'purple', 'pink', 'brown'}
    candidates = neutral if saturation < 0.14 else coloured
    def distance(entry):
        _, (key, swatch) = entry
        other_hue = colorsys.rgb_to_hsv(*swatch)[0]
        delta = abs(other_hue - hue)
        return sum((swatch - rgb) ** 2) + (0 if key in neutral else 1.6 * min(delta, 1 - delta) ** 2)
    return min((entry for entry in enumerate(palette) if entry[1][0] in candidates), key=distance)[0]


def remove_helpers():
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and (not obj.data.materials or obj.name == 'Pistol'):
            bpy.data.objects.remove(obj, do_unlink=True)


def metacarpal_wrists(rig):
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones = rig.data.edit_bones
    # This rig fans four metacarpals directly out of the forearm, with no wrist joint.
    # Keep the metacarpals rigid with the new wrist and articulate the actual knuckles.
    for side in ['L', 'R']:
        hand = bones.new('Fist.' + side)
        hand.head = bones['Middle1.' + side].head
        middle = bones['Middle1.' + side]
        hand.tail = bones['Middle2.' + side].head if bones.get('Middle2.' + side) else middle.tail
        hand.parent = bones['LowerArm.' + side]
        for digit in ['Index', 'Middle', 'Pinky', 'Thumb']:
            base = bones.get(digit + '1.' + side)
            if base is None:
                continue
            base.use_connect = False
            base.parent = hand
        if side == 'R':
            socket = bones.new('Weapon.R')
            knuckles = [bones[digit + '2.R'].head for digit in ['Index', 'Middle', 'Thumb']]
            socket.head = sum(knuckles, Vector()) / len(knuckles)
            socket.tail = socket.head + (hand.tail - hand.head) * 0.2
            socket.parent = hand
            socket.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for side in ['L', 'R']:
        for digit in ['Index', 'Middle', 'Pinky']:
            for old, new in [(2, 1), (3, 2)]:
                bone = rig.data.bones.get(f'{digit}{old}.{side}')
                if bone:
                    bone.name = f'{digit.lower()}_0{new}_{side.lower()}'


def alien(name, key):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE / (name + '.glb')))
    remove_helpers()
    bake_palette(atlas_pigment)
    mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
    pigments = mesh.data.attributes['_INKCOLOR']
    face_colors = [palette[round(pigments.data[p.loop_start].value)][0] for p in mesh.data.polygons]
    mesh.data.materials.clear()
    for role in ['Ink', 'Marker', 'EyeWhite']:
        mesh.data.materials.append(bpy.data.materials.new(role))
    # Preserve the boundaries of the original atlas while showing the encounter's stolen colours.
    for face, pigment in zip(mesh.data.polygons, face_colors):
        if pigment in ('snow', 'cream', 'skinLight', 'yellow', 'limewash', 'sand', 'stone'):
            face.material_index = 2
        elif pigment in ('green', 'orange', 'pink', 'red', 'purple', 'teal', 'sky', 'blue', 'skinWarm'):
            face.material_index = 1
    mesh.data.attributes.remove(pigments)
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    # Store only the actual gameplay clips, named consistently across floating and ground enemies.
    clips = ({'Idle':'Idle', 'Run':'Run', 'Punch':'Attack', 'Jump':'Jump'} if name == 'Enemy_Large'
             else {'Flying_Idle':'Idle', 'Fast_Flying':'Flying', 'Headbutt':'Attack'})
    clips.update({'Death':'Death', 'HitReact':'Hit'})
    rig.animation_data.action = None
    for track in list(rig.animation_data.nla_tracks):
        rig.animation_data.nla_tracks.remove(track)
    for action in list(bpy.data.actions):
        if action.name not in clips:
            bpy.data.actions.remove(action)
        else:
            action.name = clips[action.name]
            track = rig.animation_data.nla_tracks.new()
            track.name = action.name
            track.strips.new(action.name, 0, action)
            track.mute = True
    for track in rig.animation_data.nla_tracks:
        track.mute = False
    output = MODELS / f'ink-{key}.glb'
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_texcoords=False)
    print('ENEMY_EXPORTED', output.name, flush=True)


def astronaut(rig):
    remove_helpers()
    bake_palette(atlas_pigment)
    metacarpal_wrists(rig)


if __name__ == '__main__':
    for character in ['BarbaraTheBee', 'FernandoTheFlamingo', 'FinnTheFrog', 'RaeTheRedPanda']:
        build(SOURCE / f'Astronaut_{character}.glb', astronaut, MODELS / 'players/space' / (character + '.glb'))
    for name, key in [('ExtraSmall','star-mote'), ('Small','star-orb'), ('Flying','star-wing'), ('Large','star-brute')]:
        alien('Enemy_' + name, key)
