"""Blender --background --python tools/build_quaternius_courier.py -- <Standard folder>.

Derives a clothed courier from Quaternius' CC0 Superhero Male and SimpleParted hair.
Keeps the original deform weights; exports a neutral arms-down rest pose for runtime retargeting.
"""
import bpy
import math
import sys
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[sys.argv.index('--') + 1])
OUT = ROOT / 'public/models/quaternius'
ART = ROOT / 'art/models/quaternius'
OUT.mkdir(parents=True, exist_ok=True)
ART.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE / 'Base Characters/Godot - UE/Superhero_Male_FullBody.gltf'))
rig = bpy.data.objects['Armature']
body = bpy.data.objects['SuperHero_Male']
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH' and not obj.vertex_groups:
        bpy.data.objects.remove(obj, do_unlink=True)

COLORS = {
    'skin':(0.96,0.82,0.71,1), 'hair':(0.36,0.22,0.13,1),
    'coat':(0.90,0.82,0.66,1), 'trousers':(0.27,0.31,0.36,1),
    'boots':(0.40,0.26,0.17,1), 'accent':(0.84,0.34,0.33,1),
    'bag':(0.58,0.39,0.25,1), 'eye':(0.08,0.065,0.055,1),
    'paper':(0.97,0.93,0.81,1), 'button':(0.86,0.70,0.35,1),
}
MATS = {}
for name, rgba in COLORS.items():
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Roughness'].default_value = 0.95
    MATS[name] = mat

def paint(obj, slot):
    obj.data.materials.clear()
    obj.data.materials.append(MATS[slot])
    for face in obj.data.polygons:
        face.material_index = 0
        face.use_smooth = True

paint(body, 'skin')
paint(bpy.data.objects['Eyes'], 'eye')
paint(bpy.data.objects['Eyebrows'], 'hair')

before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=str(SOURCE / 'Hairstyles/Origin at 0/glTF (Godot)/Hair_SimpleParted.gltf'))
for obj in list(set(bpy.context.scene.objects) - before):
    if obj.type != 'MESH':
        bpy.data.objects.remove(obj, do_unlink=True)
        continue
    obj.name = 'Courier_Hair'
    # The origin-at-zero pack is already positioned on the original character's head.
    paint(obj, 'hair')
    obj.parent = rig
    group = obj.vertex_groups.new(name='Head')
    group.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    mod = obj.modifiers.new('Deform', 'ARMATURE')
    mod.object = rig

def shell(name, slot, planes, thickness):
    obj = body.copy()
    obj.data = body.data.copy()
    bpy.context.collection.objects.link(obj)
    obj.name = name
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for point, normal in planes:
        bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=0.00001,
                              plane_co=point,plane_no=normal,clear_inner=True,clear_outer=False)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * thickness
    bm.to_mesh(obj.data)
    bm.free()
    paint(obj, slot)
    return obj

shell('Courier_Shirt', 'coat', [((0,0,0.96),(0,0,1)),((0,0,1.55),(0,0,-1)),
                               ((0.59,0,0),(-1,0,0)),((-0.59,0,0),(1,0,0))], 0.028)
shell('Courier_Trousers', 'trousers', [((0,0,0.18),(0,0,1)),((0,0,1.025),(0,0,-1))], 0.022)
# Covered skin is coloured like its garment too, so a moving joint never exposes bare skin.
for name in ['coat','trousers','boots']:
    body.data.materials.append(MATS[name])
for f in body.data.polygons:
    p = sum((body.data.vertices[i].co for i in f.vertices), Vector()) / len(f.vertices)
    f.material_index = 3 if p.z < 0.25 else 2 if p.z < 1.0 else 1 if p.z < 1.50 and abs(p.x) < 0.58 else 0
# Remove covered anatomy (including toes) instead of drawing duplicate surfaces under clothes.
import bmesh
bm = bmesh.new()
bm.from_mesh(body.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.calc_center_median().z < 1.49 and abs(f.calc_center_median().x) < 0.49], context='FACES')
bm.to_mesh(body.data)
bm.free()

def bind(obj, bone, slot):
    paint(obj, slot)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Store all geometry in armature coordinates before adding the modifier.
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    obj.parent = rig
    vg = obj.vertex_groups.new(name=bone)
    vg.add(list(range(len(obj.data.vertices))), 1, 'REPLACE')
    obj.modifiers.new('Deform', 'ARMATURE').object = rig
    return obj

def blob(name, pos, scale, bone, slot):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    return bind(obj, bone, slot)

def ribbon(name, points, width, bone, slot):
    verts = []
    for x,y,z in points:
        verts.extend([(x-width/2,y,z),(x+width/2,y,z)])
    faces = [(i,i+1,i+3,i+2) for i in range(0,len(verts)-2,2)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj = bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    obj.modifiers.new('Cloth thickness','SOLIDIFY').thickness=0.006
    return bind(obj,bone,slot)

blob('Courier_Beret',(0.025,0.015,1.805),(0.145,0.137,0.045),'Head','accent')
blob('Courier_BeretTip',(0.025,0.015,1.848),(0.018,0.018,0.018),'Head','accent')
blob('Courier_Scarf',(0,0.018,1.53),(0.103,0.091,0.046),'neck_01','accent')
ribbon('Courier_ScarfTail',[(0.055,0.10,1.525),(0.045,0.15,1.40),(0.07,0.18,1.23),(0.03,0.16,1.16)],0.08,'spine_03','accent')
ribbon('Courier_SatchelStrap',[(-0.17,-0.145,1.45),(-0.08,-0.215,1.32),(0.06,-0.215,1.14),(0.21,-0.15,0.99)],0.038,'spine_03','bag')
blob('Courier_Satchel',(0.215,-0.02,0.99),(0.065,0.11,0.12),'pelvis','bag')
blob('Courier_SatchelFlap',(0.215,-0.105,1.025),(0.07,0.03,0.075),'pelvis','boots')
for z in [1.13,1.25,1.38]:
    blob('Courier_Button',(0,-0.208,z),(0.012,0.008,0.012),'spine_03','button')
for side, x in [('l',0.1143),('r',-0.1143)]:
    blob('Courier_Shoe_'+side,(x,-0.025,0.045),(0.083,0.17,0.067),'foot_'+side,'boots')
    blob('Courier_BootTop_'+side,(x,0.07,0.16),(0.075,0.078,0.13),'calf_'+side,'boots')
# Folded paper plane on the back.
ribbon('Courier_FoldedPlane',[(-0.01,0.175,1.46),(0,0.19,1.24),(0.04,0.155,1.18)],0.19,'spine_03','paper')

# Rest pose with arms down. Baking the mesh first keeps original author weights intact.
for side in ['l','r']:
    p = rig.pose.bones['upperarm_'+side]
    delta = (p.tail-p.head).normalized().rotation_difference(Vector((0,0,-1)))
    p.matrix = Matrix.Translation(p.head) @ delta.to_matrix().to_4x4() @ Matrix.Translation(-p.head) @ p.matrix
bpy.context.view_layer.update()
meshes = [o for o in bpy.context.scene.objects if o.type=='MESH']
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    for mod in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
for obj in meshes:
    obj.modifiers.new('Deform','ARMATURE').object=rig

# Face -Z in Three.js. Also soften the superhero breadth for the travelling courier.
transform = Matrix.Rotation(math.pi,4,'Z') @ Matrix.Diagonal((0.93,0.96,0.97,1))
rig.data.transform(transform)
for obj in meshes:
    obj.data.transform(transform)
floor = min(v.co.z for obj in meshes for v in obj.data.vertices)
lift = Matrix.Translation((0,0,-floor))
rig.data.transform(lift)
for obj in meshes:
    obj.data.transform(lift)
rig.name='CourierRig'
rig['source']='Quaternius Universal Base Characters Standard / CC0'
bpy.context.view_layer.update()
# All materials are now palette colours; discard unused source textures before saving.
for image in list(bpy.data.images):
    bpy.data.images.remove(image)
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=False, do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ART/'courier.blend'),compress=True)
# Merge the export by paint slot to keep the real-time draw count small. The .blend remains editable.
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.object.join()
body.name='Courier'
bpy.ops.export_scene.gltf(filepath=str(OUT/'courier.glb'),export_format='GLB',export_animations=False,export_extras=True,export_yup=True)
print('COURIER_EXPORTED',OUT/'courier.glb')

# An inspection render, separate from the editable/exported character.
bpy.ops.object.camera_add(location=(2.5,5.5,2.3))
camera=bpy.context.object
camera.rotation_euler=(Vector((0,0,0.95))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.type='ORTHO'
camera.data.ortho_scale=2.35
bpy.context.scene.camera=camera
bpy.ops.object.light_add(type='AREA',location=(2,3,5))
bpy.context.object.data.energy=450
bpy.context.object.data.shape='DISK'
bpy.context.object.data.size=4
scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=16
scene.world=bpy.data.worlds.new('Preview world')
scene.world.color=(0.65,0.65,0.65)
scene.render.resolution_x=700
scene.render.resolution_y=850
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(ROOT/'artifacts/quaternius/blender-courier.png')
bpy.ops.render.render(write_still=True)
