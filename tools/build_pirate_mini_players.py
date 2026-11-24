"""Build the Pirate Kit crew and Kenney Mini Characters 2.0 from their original glTF directories.

blender -b --python-exit-code 1 -P tools/build_pirate_mini_players.py -- <pirate glTF dir> <Kenney GLB dir>
"""
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_quaternius_player_rigs import build, MODELS
from build_quaternius_residents import bake_palette, allowed, palette
from build_quaternius_space import metacarpal_wrists


def character_pigment(rgb):
    return min(allowed, key=lambda i: sum((palette[i][1] - rgb) ** 2))


def keep_skinned(rig, attachments=(), texture_pigment=character_pigment):
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and obj.name not in attachments and not any(m.type == 'ARMATURE' and m.object == rig for m in obj.modifiers):
            bpy.data.objects.remove(obj, do_unlink=True)
    # These byte atlases contain skin, pale bone, hair and dark leather as well as paint.
    bake_palette(texture_pigment)


def pirate(rig):
    keep_skinned(rig)
    parrot = bpy.data.objects.get('Ernest')
    if parrot:
        # In the source pose Ernest perches on a horizontal forearm. The player's
        # walking arms hang vertically. Move his perch to the outside of the left shoulder.
        points = [parrot.matrix_world @ v.co for v in parrot.data.vertices]
        low = min(p.z for p in points)
        perch = [p for p in points if p.z < low + .025]
        feet = sum(perch, Vector()) / len(perch)
        shoulder = rig.matrix_world @ rig.data.bones['UpperArm.L'].head_local
        anchor = shoulder + Vector((.065, .085, .095))
        inverse = parrot.matrix_world.inverted()
        for v, point in zip(parrot.data.vertices, points):
            v.co = inverse @ (anchor + .69 * (point - feet))
        parrot.vertex_groups.clear()
        parrot.vertex_groups.new(name='Torso').add(list(range(len(points))), 1, 'REPLACE')
    metacarpal_wrists(rig)
    normalize_root_weights()


def normalize_root_weights():
    # The artist mixed stationary root weights into the calf/boot seams. Renormalise
    # those vertices over their actual leg bones so they follow a player far from spawn.
    for mesh in (o for o in bpy.context.scene.objects if o.type == 'MESH'):
        root = mesh.vertex_groups.get('Root')
        if not root:
            continue
        for v in mesh.data.vertices:
            if not any(g.group == root.index and g.weight > 0 for g in v.groups):
                continue
            moving = [(g.group,g.weight) for g in v.groups if g.group != root.index and g.weight > 0]
            total = sum(w for _,w in moving)
            root.remove([v.index])
            if not total:
                raise ValueError(f'{mesh.name}: stationary vertex {v.index}')
            for index, weight in moving:
                mesh.vertex_groups[index].add([v.index], weight/total, 'REPLACE')


def kenney(rig):
    keep_skinned(rig)
    body = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and
                any(g.name == 'arm-right' and any(w.group == g.index and w.weight > 0
                    for v in o.data.vertices for w in v.groups) for g in o.vertex_groups))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones = rig.data.edit_bones
    def joint(name, point, parent):
        bone = bones.new(name)
        bone.head = rig.matrix_world.inverted() @ point
        bone.tail = bone.head + Vector((0, 0, .025))
        bone.parent = parent
        return bone
    # Separate hips from the stationary scene root so the legs follow locomotion.
    hips = joint('Body', rig.matrix_world @ bones['torso'].head, bones['root'])
    bones['torso'].parent = hips
    bones['torso'].name = 'Abdomen'
    bones['head'].name = 'Head'
    segments = []
    for side, old, sign in [('L', 'left', 1), ('R', 'right', -1)]:
        for limb, first, second, end in [('arm','UpperArm','LowerArm','Fist'),('leg','UpperLeg','LowerLeg','Foot')]:
            name = limb+'-'+old
            bone = bones[name]
            start = rig.matrix_world @ bone.head
            axis = Vector((sign,0,0)) if limb == 'arm' else Vector((0,0,-1))
            group = body.vertex_groups[name]
            length = max((body.matrix_world @ v.co-start).dot(axis) for v in body.data.vertices
                         if any(g.group == group.index and g.weight > .5 for g in v.groups))
            elbow, wrist = (.43, .71) if limb == 'arm' else (.43,.70)
            bone.name = first+'.'+side
            if limb == 'leg':
                bone.parent = hips
            fore = joint(second+'.'+side, start+axis*length*elbow, bone)
            joint(end+'.'+side, start+axis*length*wrist, fore)
            segments.append((bone.name,fore.name,end+'.'+side,start,axis,length,elbow,wrist))
    bpy.ops.object.mode_set(mode='OBJECT')
    # Split the source rigid weights with a narrow blend at each new articulation.
    for first, second, end, start, axis, length, elbow, wrist in segments:
        upper = body.vertex_groups[first]
        fore = body.vertex_groups.new(name=second)
        hand = body.vertex_groups.new(name=end)
        for v in body.data.vertices:
            weight = next((g.weight for g in v.groups if g.group == upper.index),0)
            if not weight:
                continue
            t = (body.matrix_world @ v.co-start).dot(axis)/length
            blend = lambda joint: max(0,min(1,(t-joint)/.14+.5))
            a,b = blend(elbow),blend(wrist)
            for group, fraction in [(upper,1-a),(fore,a-b),(hand,b)]:
                group.add([v.index],weight*fraction,'REPLACE')


if __name__ == '__main__':
    pirate_dir, mini_dir = map(Path, sys.argv[sys.argv.index('--')+1:])
    for f in sorted(pirate_dir.glob('Characters_*.gltf')):
        name = f.stem.removeprefix('Characters_')
        if name not in ('Shark', 'Tentacle'):  # standalone sea creatures
            build(f, pirate, MODELS/'players/pirate'/f'{name}.glb')
    for f in sorted(mini_dir.glob('character-*.glb')):
        build(f, kenney, MODELS.parent/'kenney/players'/f.name)
