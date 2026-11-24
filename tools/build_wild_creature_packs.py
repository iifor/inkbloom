"""Bake the original monster colours and retain the native clips used by the wilderness AI.

blender -b --python-exit-code 1 -P tools/build_wild_creature_packs.py -- <source root>
Expected directories: cute/glTF, ultimate/{Big,Blob,Flying}/glTF, skeleton/**/Skeleton_*.glb.
"""
from pathlib import Path
import sys
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_quaternius_residents import bake_palette
from build_quaternius_space import atlas_pigment

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'public/models/wild'
CLIPS = {
    'Idle': ['Idle','Flying_Idle'],
    'Flying': ['Fast_Flying','Flying'],
    'Walk': ['Run','Running_A','Walk'],
    'Attack': ['Bite_InPlace','Bite_Front','Headbutt','Punch','1H_Melee_Attack_Slice_Horizontal'],
    'Hit': ['HitReact','HitRecieve','Hit_A'],
    'Death': ['Death','Death_A'],
    'Jump': ['Jump','Jump_Full_Short'],
}

def export(path, family, texture_pigment=atlas_pigment, clip_overrides=None, material_indices=None):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    for obj in list(bpy.context.scene.objects):
        if obj.type == 'MESH' and (not obj.data.materials or obj.parent is None):
            bpy.data.objects.remove(obj, do_unlink=True)
    bake_palette(texture_pigment, material_indices)
    clips = dict(CLIPS)
    if path.stem == 'Skeleton_Mage':
        clips['Attack'] = ['Spellcast_Shoot']
    if path.stem == 'Skeleton_Rogue':
        clips['Attack'] = ['Dualwield_Melee_Attack_Stab']
    # The flying demon ships with a single hover. The renderer adds its attack lunge.
    if family == 'flying' and len(bpy.data.actions) == 1:
        clips.pop('Idle')
        clips['Flying'] = ['Flying_Idle']
    if family == 'outbreak':
        clips['Attack'] = ['Idle_Attack', 'Punch']
    clips.update(clip_overrides or {})
    tracks = rig.animation_data.nla_tracks
    rig.animation_data.action = None
    for track in list(tracks):
        tracks.remove(track)
    sources = {a.name.rsplit('|', 1)[-1]:a for a in bpy.data.actions}
    selected = {}
    for target, choices in clips.items():
        original = next((sources[name] for name in choices if name in sources),None)
        if original: selected[target] = original
    if not ('Idle' in selected or 'Flying' in selected) or not ('Walk' in selected or 'Flying' in selected):
        raise ValueError((path, list(sources)))
    for a in list(bpy.data.actions):
        if a not in selected.values(): bpy.data.actions.remove(a)
    for name, a in selected.items():
        a.name = name
        track = tracks.new()
        track.name = name
        track.strips.new(name,0,a)
    target = DEST/family/(path.stem+'.glb')
    target.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_animation_mode='NLA_TRACKS',
                              export_texcoords=False, export_attributes=True, export_anim_slide_to_zero=True)
    print('CREATURE',family,path.stem,list(selected),flush=True)

if __name__ == '__main__':
    source = Path(sys.argv[sys.argv.index('--')+1])
    packs = {'skeleton':sorted((source/'skeleton').rglob('Skeleton_*.glb')),
             'cute':sorted((source/'cute/glTF').glob('*.gltf'))}
    for name in ['Big','Blob','Flying']:
        packs[name.lower()] = sorted((source/'ultimate'/name/'glTF').glob('*.gltf'))
    if list(map(len,packs.values())) != [4,21,16,17,17]:
        raise ValueError('Incomplete monster source directory')
    for family, paths in packs.items():
        for path in paths: export(path,family)
