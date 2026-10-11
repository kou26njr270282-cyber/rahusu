#!/usr/bin/env python3
"""Inline the Kenney 3D models into a single self-contained kart.html.

Usage: python3 kart/build.py   (writes ../kart.html next to this folder)
"""
import base64, json, pathlib

here = pathlib.Path(__file__).resolve().parent
assets = here / 'assets'
PLATFORMER = {'cloud', 'coin', 'flag'}
data = {'models': {}, 'texOf': {}, 'textures': {}}
for f in sorted(assets.glob('*.glb')):
    name = f.stem
    data['models'][name] = base64.b64encode(f.read_bytes()).decode()
    data['texOf'][name] = 'p' if name in PLATFORMER else 'r'
data['textures']['r'] = base64.b64encode((assets / 'colormap-racing.png').read_bytes()).decode()
data['textures']['p'] = base64.b64encode((assets / 'colormap-platformer.png').read_bytes()).decode()
src = (here / 'src.html').read_text()
out = src.replace('/*__ASSETS__*/{}', json.dumps(data, separators=(',', ':')))
assert out != src, 'asset placeholder not found'
(here.parent / 'kart.html').write_text(out)
print('wrote kart.html', len(out) // 1024, 'KB')
