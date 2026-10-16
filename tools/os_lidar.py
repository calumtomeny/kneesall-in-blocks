#!/usr/bin/env python3
"""Add Ordnance Survey building outlines and Environment Agency LIDAR to data/kneesall.json.

Inputs
  --os     directory containing SK_Building.shp/.dbf/.shx and SK_ImportantBuilding.* (OS OpenMap Local)
  --dtm    LIDAR Composite DTM 1m GeoTIFF (bare earth)
  --dsm    LIDAR Composite DSM 1m GeoTIFF (first return: roofs, trees)
  --bbox   E0 N0 E1 N1 of the two GeoTIFFs (British National Grid metres)

Outputs (next to the JSON)
  kneesall.json  gains "osBuildings", "trees" and "terrain"/"ndsm" metadata
  terrain.bin    Int16 bare-earth height (cm, relative to the village centre) every 2 studs
  ndsm.bin       Uint8 height above ground (decimetres, capped at 25.5 m) for every stud cell

Contains OS data © Crown copyright and database right; Environment Agency LIDAR © Environment Agency.
Both under the Open Government Licence v3.0.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osgb import wgs84_to_osgb  # noqa: E402
from shapefile import read_polygons  # noqa: E402
from tiff import read_float_tiff  # noqa: E402


def point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def poly_mask(poly, shape, to_px):
    """Boolean mask of raster cells whose centres fall inside poly (poly in raster pixel coords via to_px)."""
    pp = [to_px(*p) for p in poly]
    H, W = shape
    c0 = max(0, int(min(p[0] for p in pp))); c1 = min(W - 1, int(max(p[0] for p in pp)) + 1)
    r0 = max(0, int(min(p[1] for p in pp))); r1 = min(H - 1, int(max(p[1] for p in pp)) + 1)
    m = np.zeros(shape, bool)
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            if point_in_poly(c + 0.5, r + 0.5, pp):
                m[r, c] = True
    return m


def min_area_axis(pts):
    best, ba = 0.0, 1e18
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        if math.hypot(x1 - x0, y1 - y0) < 0.3:
            continue
        a = math.atan2(y1 - y0, x1 - x0); c, s = math.cos(a), math.sin(a)
        u = [x * c + y * s for x, y in pts]; v = [-x * s + y * c for x, y in pts]
        A = (max(u) - min(u)) * (max(v) - min(v))
        if A < ba:
            ba, best = A, a
    c, s = math.cos(best), math.sin(best)
    u = [x * c + y * s for x, y in pts]; v = [-x * s + y * c for x, y in pts]
    if max(v) - min(v) > max(u) - min(u):
        best += math.pi / 2
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json'); ap.add_argument('--os', required=True)
    ap.add_argument('--dtm', required=True); ap.add_argument('--dsm', required=True)
    ap.add_argument('--bbox', nargs=4, type=float, required=True)
    a = ap.parse_args()
    data = json.load(open(a.json))
    lat0, lon0 = data['origin']; mps = data['metresPerStud']; half = data['half']
    kx = math.cos(math.radians(lat0)) * 111320 / mps; kz = 110540 / mps

    # stud <-> British National Grid, as an affine fit (error << 1 stud over the map)
    def stud_to_en(x, z):
        return wgs84_to_osgb(lat0 - z / kz, lon0 + x / kx)
    o = np.array(stud_to_en(0, 0)); ex = np.array(stud_to_en(100, 0)) - o; ez = np.array(stud_to_en(0, 100)) - o
    A = np.array([ex, ez]).T / 100   # [E,N] = o + A @ [x,z]
    Ainv = np.linalg.inv(A)
    def en_to_stud(E, N):
        x, z = Ainv @ (np.array([E, N]) - o); return float(x), float(z)
    err = np.array(stud_to_en(500, -500)) - (o + A @ [500, -500])
    print('affine error at map corner (m):', np.round(err, 3))

    E0, N0, E1, N1 = a.bbox
    dtm = read_float_tiff(a.dtm); dsm = read_float_tiff(a.dsm)
    ndsm = np.clip(dsm - dtm, 0, None)
    to_px = lambda E, N: (E - E0, N1 - N)   # raster col/row (row 0 = north)

    def sample(arr, E, N):
        c, r = E - E0 - 0.5, N1 - N - 0.5
        c0, r0 = int(math.floor(c)), int(math.floor(r)); fc, fr = c - c0, r - r0
        c0 = min(max(c0, 0), arr.shape[1] - 2); r0 = min(max(r0, 0), arr.shape[0] - 2)
        q = arr[r0:r0 + 2, c0:c0 + 2]
        return float(q[0, 0] * (1 - fc) * (1 - fr) + q[0, 1] * fc * (1 - fr) + q[1, 0] * (1 - fc) * fr + q[1, 1] * fc * fr)

    H0 = sample(dtm, *o)
    print('village centre ground height (m AOD):', round(H0, 2))

    # ---------------------------------------------------------------- terrain grid every 2 studs
    step = 2
    n = half * 2 // step + 1
    terr = np.zeros((n, n), np.int16)
    for j in range(n):
        z = -half + j * step
        for i in range(n):
            E, N = o + A @ [-half + i * step, z]
            terr[j, i] = int(round((sample(dtm, E, N) - H0) * 100))
    terr.astype('<i2').tofile(os.path.join(os.path.dirname(a.json), 'terrain.bin'))
    data['terrain'] = {'file': 'terrain.bin', 'n': n, 'step': step, 'min': -half, 'unit': 'cm', 'baseAOD': round(H0, 2)}

    # ---------------------------------------------------------------- buildings with LIDAR heights + roof form
    bbox_en = (E0, N0, E1, N1)
    important = [(attrs, rings[0]) for attrs, rings in read_polygons(os.path.join(a.os, 'SK_ImportantBuilding'), bbox_en)]
    builds = []
    building_mask = np.zeros(dtm.shape, bool)
    for attrs, rings in read_polygons(os.path.join(a.os, 'SK_Building'), bbox_en):
        ring = rings[0]
        if ring[0] == ring[-1]:
            ring = ring[:-1]
        studs = [en_to_stud(E, N) for E, N in ring]
        if not any(abs(x) < half and abs(z) < half for x, z in studs):
            continue
        m = poly_mask(ring, dtm.shape, to_px)
        building_mask |= m
        h = ndsm[m]
        area = len(h)
        b = {'pts': [[round(x, 2), round(z, 2)] for x, z in studs], 'areaM2': area}
        if area >= 4:
            p90, p25 = float(np.percentile(h, 90)), float(np.percentile(h, 25))
            b['h'] = round(p90, 1)
            # roof form: flat if little height range; gable if the ends of the long axis are nearly ridge height
            ang = min_area_axis(ring)
            rr, cc = np.nonzero(m)
            E = E0 + cc + 0.5; N = N1 - rr - 0.5
            u = (E - E.mean()) * math.cos(ang) + (N - N.mean()) * math.sin(ang)
            t = (u - u.min()) / max(1e-6, u.max() - u.min())
            mid, ends = h[(t > 0.3) & (t < 0.7)], h[(t < 0.12) | (t > 0.88)]
            if p90 - p25 < 1.0 or area < 20:
                b['roof'] = 'flat'
            elif len(mid) and len(ends) and np.percentile(ends, 90) > 0.82 * np.percentile(mid, 90):
                b['roof'] = 'gable'
            else:
                b['roof'] = 'hip'
        for ia, iring in important:
            cx = sum(p[0] for p in ring) / len(ring); cy = sum(p[1] for p in ring) / len(ring)
            if point_in_poly(cx, cy, iring):
                b['name'] = ia.get('DISTNAME', ''); b['class'] = ia.get('CLASSIFICA', '')
        builds.append(b)
    data['osBuildings'] = builds
    print('OS buildings:', len(builds), 'roofs:', {k: sum(1 for b in builds if b.get('roof') == k) for k in ('gable', 'hip', 'flat')})

    # ---------------------------------------------------------------- height above ground per stud (vegetation, walls)
    grow = np.zeros_like(building_mask)
    for dr in (-2, -1, 0, 1, 2):
        for dc in (-2, -1, 0, 1, 2):
            grow |= np.roll(np.roll(building_mask, dr, 0), dc, 1)
    veg = np.where(grow, 0, ndsm)
    nd = np.zeros((2 * half, 2 * half), np.uint8)
    for zi in range(2 * half):
        for xi in range(2 * half):
            E, N = o + A @ [xi - half + 0.5, zi - half + 0.5]
            nd[zi, xi] = min(255, int(sample(veg, E, N) * 10))
    nd.tofile(os.path.join(os.path.dirname(a.json), 'ndsm.bin'))
    data['ndsm'] = {'file': 'ndsm.bin', 'n': 2 * half, 'min': -half, 'unit': 'dm'}

    # ---------------------------------------------------------------- individual trees: local maxima of the canopy
    can = np.where(veg > 4.0, veg, 0)
    trees = []
    R = 4
    Hh, Ww = can.shape
    peaks = []
    for r in range(R, Hh - R, 1):
        row = can[r]
        for c in np.nonzero(row > 4.0)[0]:
            if c < R or c >= Ww - R:
                continue
            v = row[c]
            win = can[r - R:r + R + 1, c - R:c + R + 1]
            if v >= win.max():
                peaks.append((v, r, c))
    peaks.sort(reverse=True)
    taken = []
    for v, r, c in peaks:
        if any((r - r2) ** 2 + (c - c2) ** 2 < 36 for r2, c2 in taken):
            continue
        taken.append((r, c))
        x, z = en_to_stud(E0 + c + 0.5, N1 - r - 0.5)
        if abs(x) < half - 3 and abs(z) < half - 3:
            # crown radius: how far the canopy stays above half the tree's height
            rad = 1
            while rad < 8 and r - rad >= 0 and r + rad < Hh and c - rad >= 0 and c + rad < Ww and \
                    np.mean([can[r - rad, c], can[r + rad, c], can[r, c - rad], can[r, c + rad]]) > v * 0.5:
                rad += 1
            trees.append({'x': round(x, 1), 'z': round(z, 1), 'h': round(float(v), 1), 'r': rad})
    data['trees'] = trees
    print('trees:', len(trees))
    data['attribution'] = ('© OpenStreetMap contributors (ODbL); contains OS data © Crown copyright and database right; '
                           'Environment Agency LIDAR © Environment Agency (OGL v3)')
    json.dump(data, open(a.json, 'w'), separators=(',', ':'))


if __name__ == '__main__':
    main()
