"""Record provenance of the locally built character assets."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
rows=[]
for name in ['Adventurer','Beach','Casual','Casual2','Farmer','King','Punk','Spacesuit','Suit','Swat','Worker']:
    source=ROOT/'artifacts/quaternius'/('modular' if name=='Adventurer' else 'modular-pack')/(name+'.glb')
    output=ROOT/'public/models/quaternius'/('modular-'+name.lower()+'.glb')
    rows.append({'character':name,'file':output.name,'sourceUrl':'https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/main/public/glb/modular_men/'+name+'.glb','sourceSha256':digest(source),'outputSha256':digest(output)})
(ROOT/'public/models/quaternius/manifest.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
rows=[]
for output in sorted((ROOT/'public/models/kaykit').glob('player-*.glb')):
    source=output.with_name(output.name.removeprefix('player-'))
    rows.append({'file':output.name,'preparedSource':source.name,'sourceSha256':digest(source),'outputSha256':digest(output)})
(ROOT/'public/models/kaykit/player-manifest.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
