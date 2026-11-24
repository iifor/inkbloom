"""Record source and export hashes for the game's locally shipped character packs."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'artifacts/quaternius'
OUT = ROOT / 'public/models/quaternius'
manifest = OUT / 'manifest.json'
prior = {r['file']: r for r in json.loads(manifest.read_text())} if manifest.exists() else {}
rows = []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def record(name, file, url, source):
    # The old men's source cache is optional when its already verified output is unchanged.
    output_hash = digest(OUT / file)
    if source.exists():
        source_hash = digest(source)
    elif file in prior and (prior[file]['outputSha256'], prior[file]['sourceUrl']) == (output_hash, url):
        source_hash = prior[file]['sourceSha256']
    else:
        raise FileNotFoundError(source)
    row = dict(character=name, file=file, sourceUrl=url, sourceSha256=source_hash, outputSha256=output_hash)
    rows.append(row)
    return row


mirror = 'https://raw.githubusercontent.com/trebeljahr/quaternius-showcase/'
version = '06c3e49a14b59148292b503b20685bfdb42311ac/public/glb/'
for name in ['Adventurer','Beach','Casual','Casual2','Farmer','King','Punk','Spacesuit','Suit','Swat','Worker']:
    source = CACHE / ('modular' if name == 'Adventurer' else 'modular-pack') / (name + '.glb')
    record(name, f'modular-{name.lower()}.glb', mirror + f'main/public/glb/modular_men/{name}.glb', source)
for name in ['Adventurer','Casual','Formal','Medieval','Punk','SciFi','Soldier','Suit','Witch','Worker']:
    file = 'modular-witch.glb' if name == 'Witch' else f'modular-women-{name.lower()}.glb'
    record(name, file, mirror + version + f'modular_women/{name}.glb', CACHE/'modular-women'/f'{name}.glb')
for name in ['Frog','Rat','Snake','Snake_angry','Spider','Wasp']:
    file = 'ink-' + name.lower().replace('_','-') + '.glb'
    source = CACHE/'enemies/Wasp.glb' if name == 'Wasp' else OUT/file
    record(name, file, mirror + version + f'easy_enemies_pack/{name}.glb', source)

usd = 'https://raw.githubusercontent.com/chibifire-stages/quaternius-stage/ed5dc51b1e44006c0fc843e6c7b4a840dfb498ab/models/UltimateAnimatedCharacter/'
rpg = 'https://raw.githubusercontent.com/euuuuuuan/cairnfall-public/8ee4cfd789282c59632a9339e61564b7d6c1acfe/assets/vendor/quaternius_rpg/'
fbx = 'https://media.githubusercontent.com/media/nginetechnologies/pack-zoo-character.nplugin/d3e3cebcb73e449cff192eb0bc74d2d443f72da5/Assets/Modular_Toon/Animations/A_Modular_Toon_'
for pack, count in [('animated',52),('rpg',6)]:
    files = sorted((OUT/pack).glob('*.glb'))
    assert len(files) == count, f'Incomplete {pack} pack'
    for file in files:
        name = file.stem
        input_name = f'SK_{name}.usda' if pack == 'animated' else f'{name}.gltf'
        row = record(name, f'{pack}/{file.name}', (usd if pack == 'animated' else rpg) + input_name,
                     CACHE/pack/input_name)
        row['playerFile'] = f'players/{pack}/{file.name}'
        row['playerSha256'] = digest(OUT / row['playerFile'])
        if name == 'BaseCharacter':
            motions = sorted((CACHE/'animated-motions').glob('*.fbx'))
            assert len(motions) == 19
            row['motionSources'] = [dict(clip=p.stem, sourceUrl=fbx+p.name, sourceSha256=digest(p)) for p in motions]
space_url = mirror + '0128ca510d653bb04d6d1e4885bd8890b5050b4f/public/glb/ultimate_space_pack/'
space_files = {f'Astronaut_{name}': f'players/space/{name}.glb' for name in
               ['BarbaraTheBee', 'FernandoTheFlamingo', 'FinnTheFrog', 'RaeTheRedPanda']}
space_files.update({'Enemy_ExtraSmall': 'ink-star-mote.glb', 'Enemy_Small': 'ink-star-orb.glb',
                    'Enemy_Flying': 'ink-star-wing.glb', 'Enemy_Large': 'ink-star-brute.glb'})
for name, output in space_files.items():
    row = record(name, output, space_url + name + '-transformed.glb', CACHE/'space'/f'{name}.glb')
    row.update(pack='Ultimate Space Kit', author='Quaternius', license='CC0-1.0',
               packUrl='https://quaternius.com/packs/ultimatespacekit.html')
manifest.write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')

rows = []
kaykit = ROOT / 'public/models/kaykit'
for output in sorted(kaykit.glob('player-*.glb')):
    source = output.with_name(output.name.removeprefix('player-'))
    rows.append(dict(file=output.name, preparedSource=source.name, sourceSha256=digest(source),
                     outputSha256=digest(output)))
(kaykit/'player-manifest.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
