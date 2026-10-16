#!/usr/bin/env python3
"""Crops in the fields around Kneesall from the Rural Payments Agency's Crop Map of England (CROME).

  python3 tools/crome.py data/kneesall.json [--year 2024] [--raw data/crome-raw.json]

Fetches the CROME hexagons over the model (about 0.4 ha each, classified from Sentinel-1 radar) from the
Environment Agency's OGC API - Features service, or reads --raw if that file exists (and writes it after a fetch),
and stores each hexagon's centre in studs with its land-use code and classification probability as "crome" in the
JSON. js/osm.js gives each hedge-bounded field the crop most of its hexagons show (single hexagons are often wrong).

CROME © Rural Payments Agency copyright and/or database right 2024, Open Government Licence v3.0.
"""
import argparse
import json
import math
import os
import urllib.request

API = 'https://environment.data.gov.uk/spatialdata/crop-map-of-england-{y}/ogc/features/v1/collections/Crop_Map_of_England_{y}_Nottinghamshire/items'
MARGIN = 60   # studs beyond the model's edge


def fetch(year, bbox):
    url = API.format(y=year) + '?f=json&limit=1000&bbox=' + ','.join(f'{v:.6f}' for v in bbox)
    feats = []
    while url:
        with urllib.request.urlopen(url, timeout=120) as r:
            page = json.load(r)
        feats += page['features']
        url = next((l['href'] for l in page.get('links', []) if l.get('rel') == 'next'), None)
    return {'type': 'FeatureCollection', 'year': year, 'features': feats}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json'); ap.add_argument('--year', type=int, default=2024)
    ap.add_argument('--raw', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'crome-raw.json'))
    a = ap.parse_args()
    data = json.load(open(a.json))
    lat0, lon0 = data['origin']; mps = data['metresPerStud']; half = data['half'] + MARGIN
    kx = math.cos(math.radians(lat0)) * 111320 / mps; kz = 110540 / mps
    if os.path.exists(a.raw):
        raw = json.load(open(a.raw))
    else:
        raw = fetch(a.year, (lon0 - half / kx, lat0 - half / kz, lon0 + half / kx, lat0 + half / kz))
        json.dump(raw, open(a.raw, 'w'), separators=(',', ':'))
    hexes = []
    for f in raw['features']:
        ring = f['geometry']['coordinates'][0][:-1]
        lon = sum(p[0] for p in ring) / len(ring); lat = sum(p[1] for p in ring) / len(ring)
        p = f['properties']
        hexes.append([round((lon - lon0) * kx, 1), round(-(lat - lat0) * kz, 1), p['lucode'], round(p.get('prob') or 0, 3)])
    data['crome'] = {'year': raw.get('year', a.year), 'hex': hexes}
    json.dump(data, open(a.json, 'w'), separators=(',', ':'))
    counts = {}
    for h in hexes:
        counts[h[2]] = counts.get(h[2], 0) + 1
    print(len(hexes), 'hexagons:', dict(sorted(counts.items(), key=lambda kv: -kv[1])))


if __name__ == '__main__':
    main()
