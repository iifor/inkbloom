"""Adapt KayKit geometry to the shared player IK contract; keep native NPC files intact.

blender --background --python-exit-code 1 --python tools/build_kaykit_player_rigs.py
"""
import bpy
import math
import re
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/kaykit'
palette = re.findall(r"key: '([^']+)', name: '[^']+', rgb: \[([^\]]+)\]", (ROOT / 'src/content/palette.ts').read_text(encoding='utf-8'))

for variant in ['barbarian', 'mage', 'rogue', 'rogue-hooded', 'knight']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(OUT / (variant + '.glb')))
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    rig.animation_data_clear()
    for p in rig.pose.bones:
        p.matrix_basis = Matrix.Identity(4)
    # Player weapons come from the active equipment slot; no duplicate source weapons.
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.attributes.get('_INKCOLOR') and not o.name.startswith(('1H_', '2H_', 'Badge_'))]
    for o in list(bpy.context.scene.objects):
        if o.type == 'MESH' and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    down = (rig.matrix_world.inverted().to_3x3() @ Vector((0, 0, -1))).normalized()
    for side in ['l', 'r']:
        for first, second in [('upperarm', 'lowerarm'), ('lowerarm', 'wrist')]:
            p = rig.pose.bones[first + '.' + side]
            tip = rig.pose.bones[second + '.' + side].head
            delta = (tip - p.head).normalized().rotation_difference(down)
            p.matrix = Matrix.Translation(p.head) @ delta.to_matrix().to_4x4() @ Matrix.Translation(-p.head) @ p.matrix
            bpy.context.view_layer.update()
    # Bake lowered arms, maintaining mesh weights and rigidly attached hats/capes.
    attachments = {o: o.parent_bone for o in meshes if o.parent_type == 'BONE'}
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    worlds = {o: o.matrix_world.copy() for o in [rig] + meshes}
    for o, matrix in worlds.items():
        o.data.transform(matrix)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    for o in meshes:
        if o in attachments:
            group = o.vertex_groups.get(attachments[o]) or o.vertex_groups.new(name=attachments[o])
            group.add(list(range(len(o.data.vertices))), 1, 'REPLACE')
        o.parent = rig
        o.parent_type = 'OBJECT'
        o.modifiers.new('Deform', 'ARMATURE').object = rig
    names = {'hips': 'pelvis', 'spine': 'spine_01', 'chest': 'spine_02', 'head': 'Head'}
    for side in ['l', 'r']:
        for old, new in [('upperarm','upperarm'),('lowerarm','lowerarm'),('wrist','hand'),('hand','palm'),('handslot','grip'),('upperleg','thigh'),('lowerleg','calf'),('foot','foot')]:
            names[old + '.' + side] = new + '_' + side
    for old, new in names.items():
        rig.data.bones[old].name = new
    # Authored texture regions become constant-per-face material slots.
    slots = {}
    accents = {'mage': {8, 9}, 'barbarian': {8, 9}, 'knight': {8},
               'rogue': {9}, 'rogue-hooded': {9}}[variant]
    for o in meshes:
        pigments = o.data.attributes['_INKCOLOR']
        swatches = o.data.attributes['_SWATCH']
        o.data.materials.clear()
        local_slots = {}
        for poly in o.data.polygons:
            vertex = poly.vertices[0]
            tile = round(swatches.data[vertex].value)
            pigment, rgb = palette[round(pigments.data[vertex].value)]
            slot = pigment
            if '_Head' in o.name and tile in (1, 2):
                slot = 'hair' if tile == 1 else 'eye'
            elif pigment.startswith('skin'):
                slot = 'skin'
            elif tile in accents:
                slot = 'accent'
            if slot not in local_slots:
                if slot not in slots:
                    mat = bpy.data.materials.new(slot)
                    mat.diffuse_color = (*[float(c) for c in rgb.split(',')], 1)
                    slots[slot] = mat
                local_slots[slot] = len(o.data.materials)
                o.data.materials.append(slots[slot])
            poly.material_index = local_slots[slot]
    # Authored +Z in glTF faces the camera; game actors face -Z.
    transform = Matrix.Rotation(math.pi, 4, 'Z')
    rig.data.transform(transform)
    for o in meshes:
        o.data.transform(transform)
    low = min(v.co.z for o in meshes for v in o.data.vertices)
    high = max(v.co.z for o in meshes for v in o.data.vertices)
    scale = 1.65 / (high - low)
    transform = Matrix.Scale(scale, 4) @ Matrix.Translation((0, 0, -low))
    rig.data.transform(transform)
    for o in meshes:
        o.data.transform(transform)
    rig.name = 'KayKitPlayerRig'
    rig['source'] = 'Kay Lousberg / KayKit Adventurers / CC0-1.0 / ' + variant
    for o in list(bpy.context.scene.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    bpy.context.object.name = 'KayKit' + variant.replace('-', '').title()
    bpy.ops.export_scene.gltf(filepath=str(OUT / ('player-' + variant + '.glb')), export_format='GLB', export_animations=False, export_extras=True, export_yup=True)
    print('KAYKIT_PLAYER_EXPORTED', variant)
