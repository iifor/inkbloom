import json,struct
from pathlib import Path
path=next(Path('artifacts/kaykit/source').rglob('Knight.glb'))
raw=path.read_bytes();n=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+n]);binary=raw[28+n:]
for image in doc['images']:
    view=doc['bufferViews'][image['bufferView']];offset=view.get('byteOffset',0)
    Path('artifacts/kaykit/source-atlas.png').write_bytes(binary[offset:offset+view['byteLength']])
print(doc['materials'])
from PIL import Image,ImageStat
im=Image.open('public/textures/characters/painted-materials-v1.png')
print('generated',im.size)
for y in range(2):
    for x in range(2):
        p=im.crop((x*im.width//2,y*im.height//2,(x+1)*im.width//2,(y+1)*im.height//2))
        print(x,y,ImageStat.Stat(p).mean)
