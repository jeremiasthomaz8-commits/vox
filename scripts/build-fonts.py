"""Build bundled Sora assets; needs fonttools[woff] only at build time."""
import json
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parent.parent
source = root / 'public/fonts/Sora-Variable.ttf'
font = TTFont(source)
assert font['name'].getDebugName(1) == 'Sora'
font.flavor = 'woff2'
font.save(root / 'public/fonts/Sora-Variable.woff2')

regular = instantiateVariableFont(TTFont(source), {'wght': 400}, inplace=False)
target = root / 'server/assets/fonts'
target.mkdir(parents=True, exist_ok=True)
regular.save(target / 'Sora-Regular.ttf')
units = regular['head'].unitsPerEm
scale = lambda number: round(number * 1000 / units)
cmap = regular.getBestCmap()
widths = []
for code in range(32, 256):
    character = bytes([code]).decode('cp1252', errors='replace')
    glyph = cmap.get(ord(character), '.notdef')
    widths.append(scale(regular['hmtx'][glyph][0]))
head, os2 = regular['head'], regular['OS/2']
metrics = {
    'name': 'Sora-Regular', 'firstChar': 32, 'lastChar': 255,
    'widths': widths,
    'bbox': [scale(n) for n in [head.xMin, head.yMin, head.xMax, head.yMax]],
    'ascent': scale(os2.sTypoAscender), 'descent': scale(os2.sTypoDescender),
    'capHeight': scale(os2.sCapHeight),
}
(target / 'Sora-Regular.metrics.json').write_text(json.dumps(metrics), encoding='utf-8')
print('Sora: WOFF2 variável para a interface e TrueType regular para PDF gerados.')
