"""Record the five CC0 packs, their source revisions and the game exports built from them.

python3 tools/five_pack_manifest.py <source root used by build_wild_creature_packs.py>
"""
from hashlib import sha256
import json
from pathlib import Path
import sys
from urllib.parse import quote

source = Path(sys.argv[1])
public = Path(__file__).resolve().parents[1]/'public/models'
raw = 'https://raw.githubusercontent.com/'
quaternius = raw + 'agentkaerf/FreeModels/db3df04d1e4714298a09510b26fb6de6645138a2/'
ultimate = raw + 'Curio2560/cozy-space-game/230d84b4035377c4e98565a3043b8c900c86efb7/assets/monsters/gltf/'
kaykit = raw + 'KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0/15b62b9bad122f72926c10fb14d622c73819fa54/addons/kaykit_character_pack_skeletons/Characters/gltf/'
kenney = 'https://kenney.nl/assets/mini-characters'
packs = []

def pack(name, author, url):
    meta = dict(name=name,author=author,license='CC0-1.0',page=url,models=[])
    packs.append(meta)
    return meta

def add(meta, original, file, url):
    meta['models'].append(dict(source=original.name, sourceUrl=url, sourceSha256=sha256(original.read_bytes()).hexdigest(),
                               file=file, sha256=sha256((public/file).read_bytes()).hexdigest()))

crew = pack('Pirate Kit','Quaternius','https://quaternius.com/packs/piratekit.html')
for p in sorted((source/'pirate/glTF').glob('Characters_*.gltf')):
    name = p.stem.removeprefix('Characters_')
    if name not in ('Tentacle','Shark'):
        add(crew,p,'quaternius/players/pirate/'+name+'.glb',quaternius+quote('Pirate Kit - Nov 2023/glTF/'+p.name))

mini = pack('Mini Characters 2.0','Kenney',kenney)
mini_dir = source/'kenney/Models/GLB format'
mini['texture'] = dict(source='Models/GLB format/Textures/colormap.png',
                       sourceSha256=sha256((mini_dir/'Textures/colormap.png').read_bytes()).hexdigest())
for p in sorted(mini_dir.glob('character-*.glb')):
    add(mini,p,'kenney/players/'+p.name,kenney)

skeletons = pack('Skeletons 1.0','Kay Lousberg','https://kaylousberg.itch.io/kaykit-skeletons')
for p in sorted((source/'skeleton').rglob('Skeleton_*.glb')):
    add(skeletons,p,'wild/skeleton/'+p.name,kaykit+p.name)

cute = pack('Cute Animated Monsters','Quaternius','https://quaternius.com/packs/cutemonsters.html')
for p in sorted((source/'cute/glTF').glob('*.gltf')):
    add(cute,p,'wild/cute/'+p.stem+'.glb',quaternius+quote('Cute Animated Monsters - Aug 2020/glTF/'+p.name))

monsters = pack('Ultimate Monsters','Quaternius','https://quaternius.com/packs/ultimatemonsters.html')
for group in ['Big','Blob','Flying']:
    for p in sorted((source/'ultimate'/group/'glTF').glob('*.gltf')):
        add(monsters,p,'wild/'+group.lower()+'/'+p.stem+'.glb',ultimate+group.lower()+'/'+p.name)

if [len(p['models']) for p in packs] != [7,20,4,21,50]:
    raise ValueError('Source and export folders must contain the complete character and monster sets')
(public/'five-pack-sources.json').write_text(json.dumps(packs,indent=2)+'\n')
