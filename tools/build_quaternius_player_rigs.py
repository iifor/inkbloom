"""Build playable versions of the 52 Animated and six RPG residents from the shipped GLBs.

blender --background --python-exit-code 1 --python tools/build_quaternius_player_rigs.py
"""
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

MODELS = Path(__file__).resolve().parents[1] / 'public/models/quaternius'
PLAYER_HEIGHT = 1.65


def repair_unbound_vertices(mesh):
    # The five ninja outfits contain a few seam vertices assigned to the static
    # glTF fallback joint. Match their nearest skinned neighbours in bind space.
    fallback = mesh.vertex_groups.get('neutral_bone')
    if not fallback:
        return
    vertices = mesh.data.vertices
    unbound = [v for v in vertices if any(g.group == fallback.index and g.weight > 0 for g in v.groups)]
    if not unbound:
        return
    tree = KDTree(len(vertices))
    for vertex in vertices:
        if vertex.groups and all(g.group != fallback.index for g in vertex.groups):
            tree.insert(vertex.co, vertex.index)
    tree.balance()
    for vertex in unbound:
        _, nearest, _ = tree.find(vertex.co)
        weights = [(g.group, g.weight) for g in vertices[nearest].groups]
        for group in list(vertex.groups):
            mesh.vertex_groups[group.group].remove([vertex.index])
        for index, weight in weights:
            mesh.vertex_groups[index].add([vertex.index], weight, 'REPLACE')


def lower_arms(rig, separator):
    down = (rig.matrix_world.inverted().to_3x3() @ Vector((0, 0, -1))).normalized()
    for side in ('L', 'R'):
        for parent, child in [('UpperArm', 'LowerArm'), ('LowerArm', 'Fist')]:
            bone = rig.pose.bones[parent + separator + side]
            to_child = rig.pose.bones[child + separator + side].head - bone.head
            rotation = to_child.normalized().rotation_difference(down).to_matrix().to_4x4()
            bone.matrix = Matrix.Translation(bone.head) @ rotation @ Matrix.Translation(-bone.head) @ bone.matrix
            bpy.context.view_layer.update()


def rename_bones(rig, sep):
    # Body drives both the hips and legs. Individual foot controllers are posed by the game.
    names = {'Body': 'pelvis', 'Abdomen': 'spine_01', 'Torso': 'spine_02', 'Neck': 'neck_01'}
    for side in ('L', 'R'):
        for old, new in [('UpperArm', 'upperarm'), ('LowerArm', 'lowerarm'), ('Fist', 'hand'),
                         ('Fist1', 'digits_01'), ('Fist2', 'digits_02'), ('Thumb1', 'thumb_01'),
                         ('Thumb2', 'thumb_02'), ('UpperLeg', 'thigh'), ('LowerLeg', 'calf'), ('Foot', 'foot')]:
            names[old + sep + side] = new + '_' + side.lower()
    for old, new in names.items():
        if old in rig.data.bones:
            rig.data.bones[old].name = new


def add_grip(rig, meshes):
    # Find the volume actually occupied by this outfit's fist, after fitting it to player scale.
    # Flat-shaded faces duplicate vertices, so use bounds rather than averaging their positions.
    points = []
    for mesh in meshes:
        hand = mesh.vertex_groups.get('hand_r')
        if hand is None:
            continue
        for vertex in mesh.data.vertices:
            if any(group.group == hand.index and group.weight > 0.65 for group in vertex.groups):
                points.append(vertex.co)
    socket = rig.data.bones.get('Weapon.R')
    if socket:
        middle = socket.head_local.copy()
    elif points:
        middle = Vector([(min(p[i] for p in points) + max(p[i] for p in points)) / 2 for i in range(3)])
    else:
        raise ValueError('Missing weighted right palm')
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    bones = rig.data.edit_bones
    grip = bones.new('grip_r')
    grip.parent = bones['hand_r']
    # The RPG artist supplied a weapon socket at the knuckles. Parent the player's
    # socket to the wrist so finger flexion cannot pull the brush away from the hand.
    for side in ('l', 'r'):
        thumb = bones.get('thumb_01_' + side)
        if thumb:
            thumb.use_connect = False
            thumb.parent = bones['hand_' + side]
    grip.head = middle
    grip.tail = grip.head + Vector((0, 0, -0.025))
    grip.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')


def build(path, prepare=None, output=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    rig.animation_data_clear()
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    if prepare:
        prepare(rig)
    meshes = []
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        # Bows, daggers and staves in the NPC export are props for its native clips.
        if obj.data.attributes.get('_INKCOLOR') and obj.parent_bone != 'Weapon.R':
            repair_unbound_vertices(obj)
            meshes.append(obj)
        else:
            bpy.data.objects.remove(obj, do_unlink=True)
    sep = '_' if path.parent.name == 'animated' else '.'
    lower_arms(rig, sep)
    attachments = {obj: obj.parent_bone for obj in meshes if obj.parent_type == 'BONE'}
    worlds = {obj: obj.matrix_world.copy() for obj in meshes + [rig]}
    for obj in meshes:
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in meshes + [rig]:
        obj.parent = None
        obj.parent_type = 'OBJECT'
        obj.matrix_world = Matrix.Identity(4)
        obj.data.transform(worlds[obj])
    for obj in meshes:
        if obj in attachments:
            group = obj.vertex_groups.new(name=attachments[obj])
            group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
        obj.parent = rig
        obj.modifiers.new('Player skin', 'ARMATURE').object = rig

    rename_bones(rig, sep)
    low = min(v.co.z for obj in meshes for v in obj.data.vertices)
    high = max(v.co.z for obj in meshes for v in obj.data.vertices)
    fit = Matrix.Scale(PLAYER_HEIGHT / (high - low), 4)
    transform = fit @ Matrix.Translation((0, 0, -low)) @ Matrix.Rotation(math.pi, 4, 'Z')
    for obj in meshes + [rig]:
        obj.data.transform(transform)
    add_grip(rig, meshes)
    rig.name = 'QuaterniusResidentPlayer'
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    mesh = bpy.context.view_layer.objects.active
    mesh.name = path.stem + 'Player'
    # A single primitive keeps the original per-face pigments and only the current player equipment.
    mesh.data.materials.clear()
    mesh.data.materials.append(bpy.data.materials.new('ResidentPigments'))
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    rig.select_set(True)
    output = output or MODELS / 'players' / path.parent.name / path.name
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
                              export_animations=False, export_attributes=True, export_texcoords=False)
    print('PLAYER_EXPORTED', output.relative_to(MODELS.parent), flush=True)


if __name__ == '__main__':
    for collection, count in [('animated', 52), ('rpg', 6)]:
        sources = sorted((MODELS / collection).glob('*.glb'))
        if len(sources) != count:
            raise ValueError(f'{collection}: expected {count} resident files, found {len(sources)}')
        for source in sources:
            build(source)
