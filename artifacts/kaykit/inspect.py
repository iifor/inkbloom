import bpy,sys
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=sys.argv[-1])
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
print('BONES',[(b.name,tuple(round(v,3) for v in rig.matrix_world@b.head_local)) for b in rig.data.bones])
print('MESHES',[(o.name,[(a.name,a.data_type,a.domain) for a in o.data.attributes]) for o in bpy.context.scene.objects if o.type=='MESH'])
