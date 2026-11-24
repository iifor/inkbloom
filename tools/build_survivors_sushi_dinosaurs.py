"""Build the three Quaternius CC0 packs from the originals in artifacts/quaternius.

blender -b --python-exit-code 1 -P tools/build_survivors_sushi_dinosaurs.py
"""
from pathlib import Path
import sys
import json
import struct

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_pirate_mini_players import character_pigment, keep_skinned, normalize_root_weights
from build_quaternius_player_rigs import build, MODELS
from build_quaternius_residents import pigment, palette
from build_quaternius_space import metacarpal_wrists
from build_wild_creature_packs import export

SOURCE = Path(__file__).resolve().parents[1] / 'artifacts/quaternius'


def player(rig):
    keep_skinned(rig, attachments=('Shoulder',))
    metacarpal_wrists(rig)
    normalize_root_weights()


def dinosaur(path):
    # These rigs animate the armature object as well as its bones. Keep both sets of
    # original transforms (round-tripping through Blender tilts the triceratops upright).
    source = path.read_bytes()
    length = struct.unpack_from('<I', source, 12)[0]
    doc = json.loads(source[20:20 + length])
    data = bytearray(source[28 + length:])
    # Direct nearest-colour matching collapses all three stegosaurus markings into bark.
    # Keep the artist's light/dark material regions distinct in the game's smaller palette.
    colors = {'LightBrown': 'sand', 'Brown': 'brown', 'DarkBrown': 'bark', 'Purple': 'purple',
              'LightYellow': 'yellow', 'LightGreen': 'green', 'Green': 'cedar', 'Black': 'ink',
              'Red': 'red', 'Material': 'sand'}
    slots = {name: index for index, (name, _) in enumerate(palette)}
    for mesh in doc['meshes']:
        for primitive in mesh['primitives']:
            attrs = primitive['attributes']
            count = doc['accessors'][attrs['POSITION']]['count']
            material = doc['materials'][primitive['material']]
            rgb = np.array(material['pbrMetallicRoughness']['baseColorFactor'][:3])
            # The parasaurolophus has a white eye material named Red in the original export.
            key = colors.get(material['name'])
            index = slots[key] if key and rgb.min() < 0.7 else pigment(rgb)
            view = len(doc['bufferViews'])
            doc['bufferViews'].append(dict(buffer=0, byteOffset=len(data), byteLength=count * 4, target=34962))
            attrs['_INKCOLOR'] = len(doc['accessors'])
            doc['accessors'].append(dict(bufferView=view, componentType=5126, count=count, type='SCALAR'))
            data.extend(struct.pack('<f', index) * count)
    for clip in doc['animations']:
        clip['name'] = clip['name'].rsplit('_', 1)[-1]
    doc['buffers'][0]['byteLength'] = len(data)
    header = json.dumps(doc, separators=(',', ':')).encode()
    header += b' ' * (-len(header) % 4)
    out = MODELS.parent / 'wild/dinosaurs' / path.name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(struct.pack('<4sIII4s', b'glTF', 2, 28 + len(header) + len(data), len(header), b'JSON')
                    + header + struct.pack('<I4s', len(data), b'BIN\0') + data)


if __name__ == '__main__':
    for family, pattern, count in [('outbreak', 'Characters_*.gltf', 4), ('sushi', '*.gltf', 8),
                                   ('outbreak', 'Zombie_*.gltf', 4), ('dinosaurs', '*.glb', 6)]:
        paths = sorted((SOURCE / family).glob(pattern))
        if len(paths) != count:
            raise ValueError(f'{family}/{pattern}: expected {count} files, found {len(paths)}')
        for path in paths:
            if family == 'dinosaurs':
                dinosaur(path)
            elif path.stem.startswith('Zombie_'):
                export(path, family, character_pigment)
            else:
                name = path.stem.removeprefix('Characters_')
                build(path, player, MODELS / 'players' / family / (name + '.glb'))
