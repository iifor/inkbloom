"""Prepare the official CC0 KayKit Adventurers as village residents.

Preserve geometry, skinning and eight authored animations. Bake the texture
atlas into InkBloom palette indices and discard unused weapon/animation buffers.
Run: python tools/build_kaykit_villagers.py <official extracted pack directory>
"""
import copy
import hashlib
import io
import json
import re
import struct
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public/models/kaykit'
OUT.mkdir(parents=True, exist_ok=True)
palette_text = (ROOT / 'src/content/palette.ts').read_text(encoding='utf-8')
palette = [(name, tuple(float(c) for c in rgb.split(','))) for name, rgb in
           re.findall(r"key: '([^']+)', name: '[^']+', rgb: \[([^\]]+)\]", palette_text)]
assert len(palette) >= 29
allowed = {'blue','red','orange','yellow','green','teal','sky','purple','pink','brown',
           'cream','charcoal','sand','stone','bark','ink','glass'}
color_indices = {name: i for i, (name, _) in enumerate(palette)}
# The source atlas has eight columns of four gradient swatches. Keep each
# authored fabric one pigment and leave light and shadow to the game renderer.
def swatch(image, tile, variant):
    column, row = tile % 8, tile // 8
    rgb = [c / 255 for c in image.getpixel(((2 * column + 1) * image.width // 16,
                                           (2 * row + 1) * image.height // 8))]
    if tile == 0 or (variant == 'Mage' and tile == 23):
        return color_indices['skinLight']
    if tile == 2:
        return color_indices['ink']
    if tile == 1:
        return color_indices[{'Barbarian':'stone','Knight':'sand','Mage':'charcoal'}.get(variant, 'brown')]
    if tile in (8, 9) and variant in ('Mage', 'Rogue', 'Rogue_Hooded', 'Barbarian'):
        return color_indices[{'Mage':'purple','Barbarian':'blue'}.get(variant, 'teal' if tile == 8 else 'green')]
    candidates = {'charcoal','stone','glass','ink','cream'} if max(rgb)-min(rgb) < 0.12 else allowed
    return min((i for i,(name,_) in enumerate(palette) if name in candidates),
               key=lambda i: sum((rgb[k]-palette[i][1][k])**2 for k in range(3)))
manifest = []
equipment = {'Knight': {'1H_Sword', 'Badge_Shield'}, 'Barbarian': {'1H_Axe'}, 'Mage': {'2H_Staff'}}
for path in sorted(Path(sys.argv[1]).rglob('*.glb')):
    if path.stem not in {'Barbarian','Knight','Mage','Rogue','Rogue_Hooded'}:
        continue
    raw = path.read_bytes()
    size = struct.unpack_from('<I', raw, 12)[0]
    doc = json.loads(raw[20:20+size])
    binary = bytearray(raw[28+size:])
    def values(index):
        accessor = doc['accessors'][index]
        view = doc['bufferViews'][accessor['bufferView']]
        assert accessor['componentType'] == 5126
        width = {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}[accessor['type']]
        offset = view.get('byteOffset',0) + accessor.get('byteOffset',0)
        stride = view.get('byteStride', width*4)
        return [struct.unpack_from('<'+'f'*width, binary, offset+i*stride) for i in range(accessor['count'])]
    atlas = {}
    for i, material in enumerate(doc['materials']):
        tex = material.get('pbrMetallicRoughness', {}).get('baseColorTexture')
        if not tex:
            continue
        image = doc['images'][doc['textures'][tex['index']]['source']]
        v = doc['bufferViews'][image['bufferView']]
        atlas[i] = Image.open(io.BytesIO(binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGB')
    meshes = []
    mesh_ids = {}
    for node in doc['nodes']:
        if 'mesh' not in node:
            continue
        # Keep profession equipment; ordinary villagers carry no weapons.
        if ('skin' not in node and not node.get('name','').endswith(('_Cape','_Hat','_Helmet'))
                and node.get('name') not in equipment.get(path.stem, set())):
            del node['mesh']
            continue
        old = node['mesh']
        if old not in mesh_ids:
            mesh_ids[old] = len(meshes)
            meshes.append(copy.deepcopy(doc['meshes'][old]))
        node['mesh'] = mesh_ids[old]
    doc['meshes'] = meshes
    for mesh in meshes:
        for primitive in mesh['primitives']:
            image = atlas[primitive['material']]
            uv = values(primitive['attributes']['TEXCOORD_0'])
            if 'indices' in primitive:
                a = doc['accessors'][primitive['indices']]; view = doc['bufferViews'][a['bufferView']]
                fmt = {5121:'B',5123:'H',5125:'I'}[a['componentType']]
                vertices = list(struct.unpack_from('<'+fmt*a['count'],binary,view.get('byteOffset',0)+a.get('byteOffset',0)))
            else:
                vertices = list(range(len(uv)))
            # Palette indices must be constant across each triangle, otherwise interpolation
            # walks through unrelated colors and produces multicolored contour bands.
            for semantic, old in list(primitive['attributes'].items()):
                a = copy.deepcopy(doc['accessors'][old]); v = doc['bufferViews'][a['bufferView']]
                width = {'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']]
                unit = {5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a['componentType']]*width
                start = v.get('byteOffset',0)+a.get('byteOffset',0); stride=v.get('byteStride',unit)
                data = b''.join(binary[start+i*stride:start+i*stride+unit] for i in vertices)
                while len(binary)%4: binary.append(0)
                a['bufferView']=len(doc['bufferViews']); a['byteOffset']=0; a['count']=len(vertices)
                doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)})
                binary.extend(data)
                primitive['attributes'][semantic]=len(doc['accessors']); doc['accessors'].append(a)
            primitive.pop('indices',None)
            indices = []
            tiles = []
            swatches = [swatch(image, tile, path.stem) for tile in range(32)]
            for n in range(0,len(vertices),3):
                u,v = [sum(uv[vertices[n+j]][axis] for j in range(3))/3 for axis in range(2)]
                tile = max(0, min(7, int(u*8))) + 8*max(0, min(3, int(v*4)))
                indices.extend([swatches[tile]]*3)
                tiles.extend([tile]*3)
            for semantic, samples in [('_INKCOLOR', indices), ('_SWATCH', tiles)]:
                while len(binary)%4: binary.append(0)
                view = len(doc['bufferViews'])
                data = struct.pack('<'+'f'*len(samples), *samples)
                doc['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)})
                binary.extend(data)
                accessor = len(doc['accessors'])
                doc['accessors'].append({'bufferView':view,'componentType':5126,'count':len(samples),'type':'SCALAR'})
                primitive['attributes'][semantic] = accessor
            primitive['attributes'].pop('TEXCOORD_0',None)
            primitive['material'] = 0
    doc['materials'] = [{'name':'InkBloomVillage','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'metallicFactor':0,'roughnessFactor':1}}]
    for field in ['images','textures','samplers']:
        doc.pop(field,None)
    keep_animations = {'Idle','Interact','Cheer','Walking_A','Running_A','Jump_Full_Short','1H_Melee_Attack_Chop','1H_Ranged_Shoot'}
    doc['animations'] = [a for a in doc.get('animations',[]) if a.get('name') in keep_animations]
    assert len(doc['animations']) == len(keep_animations)
    # Retain only referenced accessor and buffer data, not the entire animation pack.
    accessors, accessor_map = [], {}
    def remap(index):
        if index not in accessor_map:
            accessor_map[index] = len(accessors)
            accessors.append(copy.deepcopy(doc['accessors'][index]))
        return accessor_map[index]
    for mesh in meshes:
        for p in mesh['primitives']:
            p['attributes'] = {k:remap(v) for k,v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = remap(p['indices'])
    for skin in doc['skins']: skin['inverseBindMatrices'] = remap(skin['inverseBindMatrices'])
    for animation in doc['animations']:
        for sampler in animation['samplers']:
            sampler['input'], sampler['output'] = remap(sampler['input']), remap(sampler['output'])
    packed = bytearray()
    views, view_map = [], {}
    for accessor in accessors:
        assert 'sparse' not in accessor
        old = accessor['bufferView']
        if old not in view_map:
            v = copy.deepcopy(doc['bufferViews'][old])
            start = v.get('byteOffset',0)
            while len(packed)%4: packed.append(0)
            v['byteOffset'] = len(packed)
            packed.extend(binary[start:start+v['byteLength']])
            view_map[old] = len(views)
            views.append(v)
        accessor['bufferView'] = view_map[old]
    doc['accessors'], doc['bufferViews'] = accessors, views
    doc['buffers'] = [{'byteLength':len(packed)}]
    doc['asset']['extras'] = {'author':'Kay Lousberg / KayKit', 'license':'CC0-1.0', 'sourceCharacter':path.stem}
    encoded = json.dumps(doc,separators=(',',':')).encode()
    encoded += b' '*(-len(encoded)%4)
    packed += b'\x00'*(-len(packed)%4)
    output = struct.pack('<III',0x46546c67,2,28+len(encoded)+len(packed)) + struct.pack('<I4s',len(encoded),b'JSON') + encoded + struct.pack('<I4s',len(packed),b'BIN\x00') + packed
    slug = path.stem.lower().replace('_','-')
    (OUT/(slug+'.glb')).write_bytes(output)
    manifest.append({'character':path.stem,'file':slug+'.glb','equipment':sorted(equipment.get(path.stem,set())),'sourceSha256':hashlib.sha256(raw).hexdigest(),'outputSha256':hashlib.sha256(output).hexdigest(),'animations':[a['name'] for a in doc['animations']]})
    print(slug,len(output))
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
