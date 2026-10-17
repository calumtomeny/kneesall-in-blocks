#!/usr/bin/env python3
"""Convert a raw Overpass JSON dump of Kneesall into a compact file for the Kneesall in Blocks tour.

Coordinates are projected to studs: x = east, z = south, origin at ORIGIN,
1 stud = METRES_PER_STUD metres.

Usage: python3 tools/osm_to_blocks.py data/osm-raw.json data/kneesall.json
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


def projection():
    """OSM node -> [x, z] studs from ORIGIN, and a test for points near the baseplate"""
    lat0, lon0 = ORIGIN
    kx = math.cos(math.radians(lat0)) * 111320 / METRES_PER_STUD
    kz = 110540 / METRES_PER_STUD

    def xy(n):
        return [round((n['lon'] - lon0) * kx, 2), round(-(n['lat'] - lat0) * kz, 2)]

    def inside(pts, m=200):
        return any(abs(x) < HALF + m and abs(z) < HALF + m for x, z in pts)
    return xy, inside


def main(src, dst):
    els = json.load(open(src))['elements']
    nodes = {e['id']: e for e in els if e['type'] == 'node'}
    xy, inside = projection()
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
                                 'surface': t.get('surface', ''), 'sidewalk': sw or '', 'area': t.get('area') == 'yes',
                                 'designation': t.get('designation', '')})
        else:
            kind = next((v for (k, val), v in AREA_KINDS.items() if t.get(k) == val), None)
            if kind and pts[0] == pts[-1]:
                out['areas'].append({'kind': kind, 'name': t.get('name', ''), 'pts': pts[:-1]})
                continue
            kind = next((v for (k, val), v in LINE_KINDS.items() if t.get(k) == val), None)
            if kind:
                out['lines'].append({'kind': kind, 'name': t.get('name', ''), 'pts': pts})
    out['pois'] = pois(els, nodes, xy, inside)
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print({k: len(v) for k, v in out.items() if isinstance(v, list)})


def pois(els, nodes, xy, inside):
    """Points of interest, and the gates on roads and paths, each with the direction of the way it closes."""
    out = []
    ways = [e for e in els if e['type'] == 'way' and ('highway' in e.get('tags', {}))]
    # the raw download can list a node twice, once without its tags, so read the tagged copies
    tagged = {e['id']: e for e in els if e['type'] == 'node' and e.get('tags')}
    for n in tagged.values():
        t = n['tags']
        p = xy(n)
        if not inside([p], 0):
            continue
        for k, v in POI_KEYS:
            if t.get(k) == v:
                out.append({'kind': v, 'name': t.get('name', ''), 'x': p[0], 'z': p[1]})
        if t.get('barrier') in ('gate', 'kissing_gate', 'stile'):
            w = next((w for w in ways if n['id'] in w['nodes']), None)
            if not w:
                continue
            i = w['nodes'].index(n['id'])
            a, b = nodes[w['nodes'][max(0, i - 1)]], nodes[w['nodes'][min(len(w['nodes']) - 1, i + 1)]]
            (ax, az), (bx, bz) = xy(a), xy(b)
            L = math.hypot(bx - ax, bz - az) or 1
            g = {'kind': t['barrier'], 'id': n['id'], 'way': w['id'], 'x': p[0], 'z': p[1], 'dir': [round((bx - ax) / L, 3), round((bz - az) / L, 3)]}
            if 'maxheight' in t:
                g['maxheight'] = float(t['maxheight'])
            out.append(g)
    return out


if __name__ == '__main__':
    if '--refresh' in sys.argv:
        # refresh the points of interest, gates and rights of way in an existing data file, leaving the layers the
        # LIDAR and OS steps added alone
        src, dst = [a for a in sys.argv[1:] if not a.startswith('--')]
        els = json.load(open(src))['elements']
        nodes = {e['id']: e for e in els if e['type'] == 'node'}
        data = json.load(open(dst))
        data['pois'] = pois(els, nodes, *projection())
        des = {e['id']: e.get('tags', {}).get('designation', '') for e in els if e['type'] == 'way'}
        for r in data['roads']:
            r['designation'] = des.get(r['id'], '')
        json.dump(data, open(dst, 'w'), separators=(',', ':'))
        print(len(data['pois']), 'points of interest,', sum(1 for r in data['roads'] if r['designation']), 'rights of way')
    else:
        main(*sys.argv[1:3])
