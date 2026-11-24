"""Build the two CC0 Quaternius resident packs with Blender 5 in background mode.

Inputs in artifacts/quaternius: animated/SK_*.usda, animated-motions/*.fbx,
rpg/*.gltf. The 52 matching skeletons share clips stored in BaseCharacter.
"""
from pathlib import Path
import re
import sys
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'artifacts/quaternius'
OUT = ROOT / 'public/models/quaternius'
palette = [(key, np.array([float(v) for v in rgb.split(',')]))
           for key, rgb in re.findall(r"key: '([^']+)', name: '[^']+', rgb: \[([^\]]+)\]",
                                      (ROOT / 'src/content/palette.ts').read_text())]
allowed = [i for i, (key, _) in enumerate(palette)
           if key not in {'grass', 'forest', 'water', 'leaf', 'canopy', 'cedar', 'sprout', 'clayTile', 'slateTile'}]


def pigment(rgb):
    srgb = np.where(rgb <= .0031308, 12.92 * rgb, 1.055 * np.maximum(rgb, 0)**(1/2.4) - .055)
    return min(allowed, key=lambda i: np.sum((palette[i][1] - srgb)**2))


# _INKDYE values are shared with resident-dyes.ts: fixed, cloth, trim, hair.
def animated_dye(obj, poly, material, rgb, index):
    if material in {'Hair', 'Moustache'}: return 3
    if material in {'Shirt', 'Clothes', 'Jacket', 'Main', 'Red'}: return 1
    if material in {'Pants', 'Vest', 'Top', 'Scarf', 'Band', 'DarkClothes'}: return 2
    return 0


def rpg_dye(obj, poly, material, rgb, index):
    # The RPG pack shares an atlas between the body, face and held equipment.
    # Restrict the mask to the cloak and trouser faces bound to the thighs.
    if obj.name == 'Cloak':
        return 1 if palette[index][0] in {'brown', 'green', 'rock'} else 0
    if not obj.vertex_groups or palette[index][0] not in {'rock', 'glass', 'charcoal', 'blue', 'purple', 'stone', 'brown'}:
        return 0
    for vertex_id in poly.vertices:
        groups = obj.data.vertices[vertex_id].groups
        if not groups or not obj.vertex_groups[max(groups, key=lambda g: g.weight).group].name.startswith('UpperLeg'):
            return 0
    return 2 if palette[index][0] == 'charcoal' else 1


def bake_palette(texture_pigment=pigment, material_indices=None, dye_role=None):
    """Sample each original material/texture at the face centre, preserving flat colour boundaries."""
    flat = bpy.data.materials.new('VillagePigment')
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        layers = []
        for mat in mesh.materials:
            if material_indices and mat.name in material_indices:
                layers.append((None, material_indices[mat.name]))
                continue
            nodes = mat.node_tree.nodes
            image = next((n.image for n in nodes if n.type == 'TEX_IMAGE' and n.image), None)
            bsdf = next((n for n in nodes if n.type == 'BSDF_PRINCIPLED'), None)
            rgb = np.array(bsdf.inputs['Base Color'].default_value[:3] if bsdf else mat.diffuse_color[:3])
            if image:
                w, h = image.size
                pixels = np.zeros(w*h*4, dtype=np.float32)
                image.pixels.foreach_get(pixels)
                layers.append((pixels.reshape(h,w,4), None))
            else:
                layers.append((None, pigment(rgb)))
        attr = mesh.attributes.new('_INKCOLOR', 'FLOAT', 'CORNER')
        indices = np.zeros(len(mesh.loops), dtype=np.float32)
        cache = {}
        roles = np.zeros(len(mesh.loops), dtype=np.float32) if dye_role else None
        for poly in mesh.polygons:
            texture, idx = layers[poly.material_index]
            rgb = None
            if texture is not None:
                uv = sum((mesh.uv_layers.active.data[i].uv for i in poly.loop_indices), Vector((0.,0.))) / len(poly.loop_indices)
                h,w,_ = texture.shape
                rgb = texture[int((uv.y % 1)*h), int((uv.x % 1)*w), :3]
                key = tuple(rgb)
                if key not in cache: cache[key] = texture_pigment(rgb)
                idx = cache[key]
            corners = slice(poly.loop_start, poly.loop_start + poly.loop_total)
            indices[corners] = idx
            if dye_role:
                roles[corners] = dye_role(obj, poly, mesh.materials[poly.material_index].name, rgb, idx)
        attr.data.foreach_set('value', indices)
        if dye_role and roles.any():
            mesh.attributes.new('_INKDYE', 'FLOAT', 'CORNER').data.foreach_set('value', roles)
        mesh.materials.clear()
        mesh.materials.append(flat)
        for poly in mesh.polygons: poly.material_index = 0


def import_motion(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(path))
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    scale = 2 if 'Root' in rig.pose.bones else 1
    scene = bpy.context.scene
    start, end = map(round, rig.animation_data.action.frame_range)
    samples = []
    for frame in sorted(set(range(start, end+1, 2)) | {end}):
        scene.frame_set(frame)
        sample = {}
        for bone in rig.pose.bones:
            loc, rot, _ = (rig.matrix_world @ bone.matrix).decompose()
            # The Root and Bone export families use different units.
            sample[bone.name.replace('.', '_')] = Matrix.LocRotScale(loc*scale, rot, None)
        samples.append((frame-start+1, sample))
    return samples


def shared_actions(rig, motions):
    # The USD rest pose is the artist's relaxed pose. Transfer world-space movement
    # relative to the same frame of Idle, accounting for FBX/USD bone axis differences.
    idle_reference = motions['Idle'][0][1]
    bind = {p.name: rig.matrix_world @ p.matrix.copy() for p in rig.pose.bones}
    rig.animation_data_create()
    for name, samples in motions.items():
        if 'Bone' in samples[0][1]:
            # These FBXs use the same world axes and units as the target USD.
            offsets = {n: Matrix.Identity(4) for n in samples[0][1] if n in bind and n != 'Bone'}
        else:
            offsets = {n: mat.inverted() @ bind[n] for n,mat in idle_reference.items() if n in bind}
        action = bpy.data.actions.new(name)
        rig.animation_data.action = action
        previous = {}
        for frame, sample in samples:
            desired = {n: rig.matrix_world.inverted() @ sample[n] @ offset for n,offset in offsets.items()}
            for bone in rig.pose.bones:
                if bone.name not in desired: continue
                parent = bone.parent
                parent_pose = desired.get(parent.name, rig.matrix_world.inverted() @ bind[parent.name])
                relative = parent.bone.matrix_local
                basis = bone.bone.matrix_local.inverted() @ relative @ parent_pose.inverted() @ desired[bone.name]
                loc, rot, scale = basis.decompose()
                if bone.name in previous: rot.make_compatible(previous[bone.name])
                previous[bone.name] = rot.copy()
                bone.location, bone.rotation_quaternion, bone.scale = loc,rot,scale
                for prop in ('location','rotation_quaternion','scale'):
                    bone.keyframe_insert(prop,frame=frame,group=bone.name)
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name,1,action)
        track.mute = True
        rig.animation_data.action = None
    for track in rig.animation_data.nla_tracks: track.mute = False


def export(path, pack, motions):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    animated = pack == 'animated'
    if animated: bpy.ops.wm.usd_import(filepath=str(path))
    else: bpy.ops.import_scene.gltf(filepath=str(path))
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and not obj.data.materials:
            if obj.name != 'Icosphere': raise ValueError(f'Unexpected unpainted mesh {obj.name}')
            bpy.data.objects.remove(obj, do_unlink=True)
    name = path.stem.removeprefix('SK_')
    bake_palette(dye_role=animated_dye if animated else rpg_dye)
    shared = animated and name == 'BaseCharacter'
    if shared:
        rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
        shared_actions(rig, motions)
    out = OUT / pack / (name + '.glb')
    out.parent.mkdir(exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', export_attributes=True,
                              export_texcoords=False, export_materials='EXPORT',
                              export_animations=shared or not animated,
                              export_animation_mode='NLA_TRACKS' if shared else 'ACTIONS',
                              export_frame_step=2, export_force_sampling=True)
    print('EXPORTED',pack,name,flush=True)


if __name__ == '__main__':
    motions = {p.stem: import_motion(p) for p in sorted((CACHE/'animated-motions').glob('*.fbx'))}
    for pack, pattern in [('animated','*.usda'),('rpg','*.gltf')]:
        if '--rpg-only' not in sys.argv or pack == 'rpg':
            for path in sorted((CACHE / pack).glob(pattern)):
                if '--shared-only' not in sys.argv or path.stem == 'SK_BaseCharacter': export(path, pack, motions)
