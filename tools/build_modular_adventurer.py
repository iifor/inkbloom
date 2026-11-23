"""Normalize Quaternius Ultimate Modular Men's Adventurer for InkBloom.

Usage: blender --background --python tools/build_modular_adventurer.py -- source.glb
Preserves the authored silhouette, clothing geometry, weights and shading.
"""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
ARGS = sys.argv[sys.argv.index('--') + 1:]
SOURCE = Path(ARGS[0])
VARIANT = SOURCE.stem
SLUG = VARIANT.lower()
OUT = ROOT / 'public/models/quaternius'
ART = ROOT / 'art/models/quaternius'
OUT.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name != 'Icosphere']
if VARIANT == 'Punk':
    # Some trouser cuffs have a stray weight on the stationary control root.
    # Let their existing leg weights carry the full deformation when moving.
    for mesh in meshes:
        root_group = mesh.vertex_groups.get('Root')
        if root_group is None:
            continue
        for vertex in mesh.data.vertices:
            if not any(g.group == root_group.index and g.weight > 0 for g in vertex.groups):
                continue
            limbs = [(g.group, g.weight) for g in vertex.groups
                     if g.group != root_group.index and g.weight > 0]
            total = sum(weight for _, weight in limbs)
            if not total:
                raise ValueError(f'Cannot repair root-only vertex {mesh.name}:{vertex.index}')
            root_group.remove([vertex.index])
            for group, weight in limbs:
                mesh.vertex_groups[group].add([vertex.index], weight / total, 'REPLACE')
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH' and o not in meshes:
        bpy.data.objects.remove(o, do_unlink=True)

# glTF joint tails are synthetic. Use the next joint's position to straighten each limb.
down = (rig.matrix_world.inverted().to_3x3() @ Vector((0, 0, -1))).normalized()
for side in ['L', 'R']:
    for first, second in [('UpperArm', 'LowerArm'), ('LowerArm', 'Hand')]:
        p = rig.pose.bones[first + '.' + side]
        tip = rig.pose.bones[second + '.' + side].head
        delta = (tip - p.head).normalized().rotation_difference(down)
        p.matrix = Matrix.Translation(p.head) @ delta.to_matrix().to_4x4() @ Matrix.Translation(-p.head) @ p.matrix
        bpy.context.view_layer.update()

# Bake the imported bind transforms and lowered arms, then make world space the rig space.
for o in meshes:
    bpy.context.view_layer.objects.active = o
    for mod in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
worlds = {o: o.matrix_world.copy() for o in [rig] + meshes}
for o, world in worlds.items():
    o.data.transform(world)
    o.parent = None
    o.matrix_world = Matrix.Identity(4)
for o in meshes:
    o.parent = rig
    o.modifiers.new('Deform', 'ARMATURE').object = rig
for o in list(bpy.context.scene.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o, do_unlink=True)

# The runtime contract uses normalized names; Blender updates vertex groups when bones rename.
names = {'Hips':'pelvis', 'Abdomen':'spine_01', 'Torso':'spine_02', 'Chest':'spine_03', 'Neck':'neck_01'}
for side in ['L', 'R']:
    for old, new in [('UpperArm','upperarm'),('LowerArm','lowerarm'),('Hand','hand'),
                     ('UpperLeg','thigh'),('LowerLeg','calf'),('Foot','foot')]:
        names[old + '.' + side] = new + '_' + side.lower()
    for finger in ['Index','Middle','Ring','Pinky','Thumb']:
        for segment in range(2, 5):
            names[f'{finger}{segment}.{side}'] = f'{finger.lower()}_0{segment-1}_{side.lower()}'
for old, new in names.items():
    if old in rig.data.bones:
        rig.data.bones[old].name = new

slots = {'Green':'accent','LightGreen':'coat','Skin':'skin','Black':'boots','Grey':'bootTrim',
         'Eyebrows':'hair','Eye':'eye','Hair':'hair','Brown2':'trousers','Brown':'bag','Gold':'button'}
colors = {'accent':(0.2,0.55,0.54,1),'coat':(0.9,0.82,0.66,1),'skin':(0.96,0.82,0.71,1),
          'boots':(0.4,0.3,0.22,1),'bootTrim':(0.34,0.35,0.39,1),'hair':(0.58,0.39,0.25,1),
          'eye':(0.06,0.06,0.09,1),'trousers':(0.34,0.35,0.39,1),'bag':(0.58,0.39,0.25,1),'button':(0.96,0.84,0.43,1)}
# Each remaining outfit preserves its authored material regions. Palette names also
# serve as stable paint slots; skin, hair and accent remain player-editable.
if VARIANT != 'Adventurer':
    slots = {'Skin':'skin', 'Skin_Darker':'skin', 'Eyebrows':'hair', 'Hair':'hair',
             'Hair_White':'hair', 'Moustache':'hair', 'Eye':'eye', 'Black':'ink',
             'White':'cream', 'LightBrown':'sand', 'Brown':'brown', 'Brown2':'bark',
             'DarkBrown':'bark', 'Beige':'limewash', 'LightBlue':'blue', 'Blue':'blue',
             'Red':'red', 'Red_Dark':'red', 'Purple':'purple', 'Earrings':'yellow',
             'Gold':'yellow', 'Metal':'stone', 'Metal_Dark':'charcoal', 'Grey':'charcoal',
             'Suit':'charcoal', 'Tie':'accent', 'Swat_Black':'ink', 'Swat':'accent',
             'Visor':'glass', 'Worker_Yellow':'yellow', 'Worker_Vest':'accent',
             'SciFi_Light':'cream', 'SciFi_MainDark':'charcoal', 'SciFi_Main':'teal',
             'SciFi_Light_Accent':'accent'}
    accent = {'Beach':'Red_Dark', 'Casual':'Purple', 'Casual2':'Red_Dark',
              'Farmer':'LightBlue', 'King':'Blue', 'Punk':'Red_Dark'}.get(VARIANT)
    if accent:
        slots[accent] = 'accent'
    if VARIANT == 'Punk':
        slots['Red'] = 'hair'
    colors.update({'ink':(.06,.06,.09,1), 'cream':(.97,.93,.81,1), 'sand':(.86,.78,.6,1),
                   'brown':(.58,.39,.25,1), 'bark':(.4,.3,.22,1), 'limewash':(.9,.82,.66,1),
                   'blue':(.27,.43,.74,1), 'red':(.84,.34,.33,1), 'purple':(.56,.44,.71,1),
                   'yellow':(.96,.84,.43,1), 'stone':(.77,.75,.71,1),
                   'charcoal':(.34,.35,.39,1), 'glass':(.33,.46,.56,1), 'teal':(.2,.55,.54,1)})
materials = {}
used_slots = {slots[mat.name.split('.')[0]] for o in meshes for mat in o.data.materials}
for name, rgba in colors.items():
    if name not in used_slots:
        continue
    mat = bpy.data.materials.new('InkBloom_' + name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = 0.95
    materials[name] = mat
for o in meshes:
    for i, mat in enumerate(list(o.data.materials)):
        o.data.materials[i] = materials[slots[mat.name.split('.')[0]]]

# Original looks toward Blender -Y. Turn to +Y, which exports as the game's -Z.
transform = Matrix.Rotation(math.pi, 4, 'Z')
rig.data.transform(transform)
for o in meshes:
    o.data.transform(transform)
floor = min(v.co.z for o in meshes for v in o.data.vertices)
lift = Matrix.Translation((0, 0, -floor))
rig.data.transform(lift)
for o in meshes:
    o.data.transform(lift)
rig.name = 'Modular' + VARIANT + 'Rig'
rig['source'] = 'Quaternius Ultimate Modular Men Pack / ' + VARIANT + ' / CC0-1.0'
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=False, do_recursive=True)
for name, mat in materials.items():
    mat.name = name
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(ART / ('modular-' + SLUG + '.blend')), compress=True)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
bpy.context.object.name = 'Modular' + VARIANT
bpy.ops.export_scene.gltf(filepath=str(OUT / ('modular-' + SLUG + '.glb')), export_format='GLB',
                          export_animations=False, export_extras=True, export_yup=True)

if '--no-render' in ARGS:
    print('MODULAR_EXPORTED', VARIANT)
    sys.exit(0)

# Separate visual inspection: never add studio lights or cameras to the exported asset.
bpy.ops.object.camera_add(location=(2.1, 5.5, 2.1))
camera = bpy.context.object
camera.rotation_euler = (Vector((0,0,0.95))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 2.3
scene = bpy.context.scene
scene.camera = camera
bpy.ops.object.light_add(type='AREA', location=(2,3,5))
bpy.context.object.data.energy = 450
bpy.context.object.data.size = 4
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.world = bpy.data.worlds.new('Inspection')
scene.world.color = (0.65,0.65,0.65)
scene.render.resolution_x = 700
scene.render.resolution_y = 850
scene.render.resolution_percentage = 100
scene.render.filepath = str(ROOT / 'artifacts/quaternius/modular/adventurer-inspection.png')
bpy.ops.render.render(write_still=True)
print('MODULAR_ADVENTURER_EXPORTED')
