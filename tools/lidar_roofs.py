#!/usr/bin/env python3
"""Sample the Environment Agency LIDAR surface over every building, one value per stud.

Run after os_lidar.py (it needs the "osBuildings" outlines that script adds to the JSON):

  python3 tools/lidar_roofs.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --bbox E0 N0 E1 N1 \
      [--dsm-last dsm_last.tif] [--intensity intensity_tile.tif]

Writes roofs.bin next to the JSON: Uint8 roof height above ground (decimetres) for each stud cell within
a stud of a building outline, 0 elsewhere. js/buildings.js turns it into per-stud walls and roof slopes, so
extensions, lean-tos, gable ends and hips come from the measured surface rather than a guessed roof form.

With --dsm-last (Last Return DSM), studs where the first return is well above the last (leaves and branches
over a roof) use the last return instead, so overhanging trees don't become walls.
With --intensity (a National LIDAR Programme intensity tile), each building gains "roofI", the median laser
return strength off its roof: slate and dark tiles return weakly, clay pantiles strongly, which sets the
roof colour. Every building also gains "roofPitch" (median slope of the roof surface, rise per metre).
The stud <-> British National Grid transform is saved as "bng" so data/survey.json can use grid coordinates.

Environment Agency LIDAR © Environment Agency, Open Government Licence v3.0.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from osgb import wgs84_to_osgb  # noqa: E402
from tiff import read_float_tiff  # noqa: E402


def fill_poly(mask, poly):
    """Set cells of mask (rows = y, cols = x) whose centres fall inside poly [(x, y), ...]."""
    H, W = mask.shape
    ys = [p[1] for p in poly]
    for r in range(max(0, int(min(ys))), min(H, int(max(ys)) + 2)):
        yc = r + 0.5; xs = []
        for i in range(len(poly)):
            (x0, y0), (x1, y1) = poly[i], poly[i - 1]
            if (y0 > yc) != (y1 > yc):
                xs.append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
        xs.sort()
        for a, b in zip(xs[::2], xs[1::2]):
            c0, c1 = max(0, math.ceil(a - 0.5)), min(W - 1, math.floor(b - 0.5))
            if c1 >= c0:
                mask[r, c0:c1 + 1] = True


def dilate(m, n=1):
    out = m.copy()
    for _ in range(n):
        g = out.copy()
        g[1:] |= out[:-1]; g[:-1] |= out[1:]; g[:, 1:] |= out[:, :-1]; g[:, :-1] |= out[:, 1:]
        out = g
    return out


def erode(m):
    g = m.copy()
    g[1:] &= m[:-1]; g[:-1] &= m[1:]; g[:, 1:] &= m[:, :-1]; g[:, :-1] &= m[:, 1:]
    g[0] = g[-1] = False; g[:, 0] = g[:, -1] = False
    return g


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json'); ap.add_argument('--dtm', required=True); ap.add_argument('--dsm', required=True)
    ap.add_argument('--dsm-last'); ap.add_argument('--intensity')
    ap.add_argument('--bbox', nargs=4, type=float, required=True)
    a = ap.parse_args()
    data = json.load(open(a.json))
    lat0, lon0 = data['origin']; mps = data['metresPerStud']; half = data['half']
    kx = math.cos(math.radians(lat0)) * 111320 / mps; kz = 110540 / mps

    def stud_to_en(x, z):
        return wgs84_to_osgb(lat0 - z / kz, lon0 + x / kx)
    o = np.array(stud_to_en(0, 0)); A = np.array([np.array(stud_to_en(100, 0)) - o, np.array(stud_to_en(0, 100)) - o]).T / 100

    E0, N0, E1, N1 = a.bbox
    dtm = read_float_tiff(a.dtm)
    ndsm = np.clip(read_float_tiff(a.dsm) - dtm, 0, None)
    clear = np.ones(ndsm.shape, bool)   # no vegetation between the first and last return
    if a.dsm_last:
        ndl = np.clip(read_float_tiff(a.dsm_last) - dtm, 0, None)
        veg = (ndsm - ndl > 0.6) & (ndl > 1.2)
        clear = ndsm - ndl < 0.4
        ndsm = np.where(veg, ndl, ndsm)

    # 1 m raster cells that belong to a building (outline grown by one metre to catch the eaves overhang)
    rmask = np.zeros(ndsm.shape, bool)
    smask = np.zeros((2 * half, 2 * half), bool)
    gy, gx = np.gradient(np.nan_to_num(ndsm))
    slope = np.hypot(gx, gy)
    inten = None
    if a.intensity:
        # the intensity tile is a larger grid square: decode only the rows over the model
        probe = read_float_tiff(a.intensity, rows=(0, 1), georef=True)[1]
        r0 = int((probe[1] - N1) / probe[2]); r1 = int((probe[1] - N0) / probe[2]) + 1
        tile, (tE, tN, res) = read_float_tiff(a.intensity, rows=(max(0, r0), r1), georef=True)
        inten = np.full(ndsm.shape, np.nan, np.float32)
        rr, cc = np.mgrid[0:ndsm.shape[0], 0:ndsm.shape[1]]
        tr = ((tN - (N1 - rr - 0.5)) / res).astype(int); tc = (((E0 + cc + 0.5) - tE) / res).astype(int)
        ok = (tr >= 0) & (tr < tile.shape[0]) & (tc >= 0) & (tc < tile.shape[1])
        inten[ok] = tile[tr[ok], tc[ok]]
    for b in data['osBuildings']:
        pts = np.array(b['pts'])
        en = (o[:, None] + A @ pts.T).T
        bm = np.zeros(ndsm.shape, bool)
        fill_poly(bm, [(E - E0, N1 - N) for E, N in en])
        rmask |= bm
        fill_poly(smask, [(x + half, z + half) for x, z in pts])
        # roof statistics away from the eaves and off anything leafy
        roof = erode(bm) & clear & (ndsm > 2)
        if roof.sum() < 4:
            roof = bm & (ndsm > 2)
        if roof.sum() >= 4:
            b['roofPitch'] = round(float(np.median(slope[roof])), 2)
            if inten is not None and np.isfinite(inten[roof]).sum() >= 4:
                b['roofI'] = round(float(np.nanmedian(inten[roof])), 1)
    rmask = dilate(rmask, 1)
    smask = dilate(smask, 1)

    # bilinear sample that only mixes in building pixels, so walls aren't dragged down by the ground beside them
    val = np.where(rmask, ndsm, 0.0); wt = rmask.astype(float)
    zi, xi = np.nonzero(smask)
    x = xi - half + 0.5; z = zi - half + 0.5
    E = o[0] + A[0, 0] * x + A[0, 1] * z; N = o[1] + A[1, 0] * x + A[1, 1] * z
    c = E - E0 - 0.5; r = N1 - N - 0.5
    c0 = np.clip(np.floor(c).astype(int), 0, ndsm.shape[1] - 2); r0 = np.clip(np.floor(r).astype(int), 0, ndsm.shape[0] - 2)
    fc = np.clip(c - c0, 0, 1); fr = np.clip(r - r0, 0, 1)
    num = np.zeros(len(x)); den = np.zeros(len(x))
    for dr, dc, w in ((0, 0, (1 - fr) * (1 - fc)), (0, 1, (1 - fr) * fc), (1, 0, fr * (1 - fc)), (1, 1, fr * fc)):
        num += val[r0 + dr, c0 + dc] * w; den += wt[r0 + dr, c0 + dc] * w
    h = np.where(den > 0.05, num / np.maximum(den, 1e-9), 0)

    out = np.zeros((2 * half, 2 * half), np.uint8)
    out[zi, xi] = np.clip(np.round(h * 10), 0, 255).astype(np.uint8)
    out.tofile(os.path.join(os.path.dirname(a.json), 'roofs.bin'))
    data['roofs'] = {'file': 'roofs.bin', 'n': 2 * half, 'min': -half, 'unit': 'dm'}
    data['bng'] = {'o': [round(float(v), 3) for v in o], 'A': [[round(float(v), 6) for v in row] for row in A]}
    json.dump(data, open(a.json, 'w'), separators=(',', ':'))
    print('roof cells:', int(smask.sum()), 'max height (m):', round(float(h.max()), 1),
          'buildings with intensity:', sum(1 for b in data['osBuildings'] if 'roofI' in b))


if __name__ == '__main__':
    main()
