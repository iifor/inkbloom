"""Repair the six NaN skin weights in the CC0 Easy Enemy Wasp export."""
import json
import math
import struct
from pathlib import Path

root = Path(__file__).resolve().parents[1]
binary = bytearray((root/'artifacts/quaternius/enemies/Wasp.glb').read_bytes())
length = struct.unpack_from('<I', binary, 12)[0]
doc = json.loads(binary[20:20+length])
def attribute(primitive, key, fmt):
    a = doc['accessors'][primitive['attributes'][key]]
    v = doc['bufferViews'][a['bufferView']]
    start = 28+length+v.get('byteOffset',0)+a.get('byteOffset',0)
    stride = v.get('byteStride',struct.calcsize(fmt))
    return [(start+i*stride, struct.unpack_from(fmt,binary,start+i*stride)) for i in range(a['count'])]
# A seam may duplicate a vertex across materials. Use the closest healthy vertex
# from the same skinned mesh and copy both its joint indices and weights.
for mesh in doc['meshes']:
    vertices = []
    for p in mesh['primitives']:
        vertices.extend(zip(attribute(p,'POSITION','<3f'), attribute(p,'JOINTS_0','<4H'),
                            attribute(p,'WEIGHTS_0','<4f')))
    valid = [v for v in vertices if all(map(math.isfinite, v[2][1]))]
    for (_, pos), (j_offset, _), (w_offset, weights) in vertices:
        if all(map(math.isfinite, weights)): continue
        _, (_, joints), (_, replacement) = min(valid, key=lambda v: math.dist(pos,v[0][1]))
        struct.pack_into('<4H',binary,j_offset,*joints)
        struct.pack_into('<4f',binary,w_offset,*replacement)
(root/'public/models/quaternius/ink-wasp.glb').write_bytes(binary)
