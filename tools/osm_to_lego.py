#!/usr/bin/env python3
"""Convert a raw Overpass JSON dump of Kneesall into a compact file for the LEGO tour.

Coordinates are projected to LEGO studs: x = east, z = south, origin at ORIGIN,
1 stud = METRES_PER_STUD metres.

Usage: python3 tools/osm_to_lego.py data/osm-raw.json data/kneesall.json
Data © OpenStreetMap contributors, ODbL.
"""
import json
import math
import sys

ORIGIN = (53.1708, -0.9486)   # lat, lon (village centre, near the church)
METRES_PER_STUD = 0.7
HALF = 560                    # keep features within +/- this many studs (plus a margin)

AREA_KINDS = {
    ('natural', 'wood'): 'wood', ('landuse', 'forest'): 'wood', ('landuse', 'cemetery'): 'cemetery',
    ('landuse', 'farmyard'): 'farmyard', ('leisure', 'playground'): 'playground',
    ('amenity', 'school'): 'school', ('amenity', 'parking'): 'parking', ('amenity', 'pub'): 'pub',
    ('man_made', 'wastewater_plant'): 'works', ('landuse', 'grass'): 'grass', ('leisure', 'garden'): 'grass',
    ('landuse', 'residential'): None, ('landuse', 'farmland'): 'farmland', ('landuse', 'meadow'): 'meadow',
}
LINE_KINDS = {('barrier', 'hedge'): 'hedge', ('barrier', 'fence'): 'fence', ('barrier', 'wall'): 'wall',
              ('waterway', 'ditch'): 'ditch', ('waterway', 'stream'): 'stream', ('waterway', 'drain'): 'ditch',
              ('power', 'minor_line'): 'poles', ('power', 'line'): 'pylons'}
POI_KEYS = [('highway', 'bus_stop'), ('amenity', 'post_box'), ('amenity', 'bench'), ('amenity', 'cafe'),
            ('place', 'village'), ('natural', 'tree'), ('highway', 'street_lamp'), ('amenity', 'telephone')]


def main(src, dst):
    els = json.load(open(src))['elements']
    nodes = {e['id']: e for e in els if e['type'] == 'node'}
    lat0, lon0 = ORIGIN
    kx = math.cos(math.radians(lat0)) * 111320 / METRES_PER_STUD
    kz = 110540 / METRES_PER_STUD

    def xy(n):
        return [round((n['lon'] - lon0) * kx, 2), round(-(n['lat'] - lat0) * kz, 2)]

    def inside(pts, m=200):
        return any(abs(x) < HALF + m and abs(z) < HALF + m for x, z in pts)

    out = {'attribution': '© OpenStreetMap contributors (ODbL)', 'metresPerStud': METRES_PER_STUD,
           'origin': ORIGIN, 'half': HALF, 'roads': [], 'buildings': [], 'areas': [], 'lines': [], 'pois': []}
    for w in (e for e in els if e['type'] == 'way'):
        t = w.get('tags', {})
        pts = [xy(nodes[i]) for i in w['nodes'] if i in nodes]
        if len(pts) < 2 or not inside(pts):
            continue
        if 'building' in t:
            out['buildings'].append({'id': w['id'], 'pts': pts[:-1] if pts[0] == pts[-1] else pts,
                                     'type': t['building'], 'name': t.get('name', ''),
                                     'levels': t.get('building:levels'), 'amenity': t.get('amenity')})
        elif 'highway' in t:
            # pavements: sidewalk=both/left/right/no (left and right of the way's direction), or the per-side keys
            sw = t.get('sidewalk') or t.get('sidewalk:both')
            if not sw and (t.get('sidewalk:left') or t.get('sidewalk:right')):
                sides = [k for k in ('left', 'right') if t.get('sidewalk:' + k) not in (None, 'no', 'separate')]
                sw = {0: 'no', 2: 'both'}.get(len(sides)) or sides[0]
            out['roads'].append({'id': w['id'], 'type': t['highway'], 'name': t.get('name', ''), 'pts': pts,
                                 'surface': t.get('surface', ''), 'sidewalk': sw or '', 'area': t.get('area') == 'yes'})
        else:
            kind = next((v for (k, val), v in AREA_KINDS.items() if t.get(k) == val), None)
            if kind and pts[0] == pts[-1]:
                out['areas'].append({'kind': kind, 'name': t.get('name', ''), 'pts': pts[:-1]})
                continue
            kind = next((v for (k, val), v in LINE_KINDS.items() if t.get(k) == val), None)
            if kind:
                out['lines'].append({'kind': kind, 'name': t.get('name', ''), 'pts': pts})
    for n in nodes.values():
        t = n.get('tags')
        if not t:
            continue
        for k, v in POI_KEYS:
            if t.get(k) == v:
                p = xy(n)
                if inside([p], 0):
                    out['pois'].append({'kind': v, 'name': t.get('name', ''), 'x': p[0], 'z': p[1]})
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print({k: len(v) for k, v in out.items() if isinstance(v, list)})


if __name__ == '__main__':
    main(*sys.argv[1:3])
