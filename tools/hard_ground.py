#!/usr/bin/env python3
"""Drives, yards and car parks from the LIDAR: tarmac and gravel round the houses, into data/kneesall.json "hard".

  python3 tools/hard_ground.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --dsm-last dsm_last.tif \
      --intensity intensity_SK7060.tif --bbox 469880 363760 470880 364760

The laser returns weakly from tarmac (it is dark in the near infrared the laser uses), moderately from gravel and
strongly from grass. So ground-level metres (no height above the terrain in either return) that return weakly, off
the roads and outside the buildings, are hard standing: grown from clearly dark seeds (intensity < 30) into the
moderately dark ground round them (< 42), kept where a patch reaches a road or a building and lies mostly close to
one (a drive or a yard, not a worn patch of paddock), and called tarmac or gravel by the patch's median intensity
(below 27: tarmac). Checked against aerial photographs: the school's playground and car park, the cafe's car park,
the gravel yard off School Lane and drives along Ossington Road all come out. The LIDAR was flown in 2022.

Writes "hard": {"tarmac": [[z, x0, x1], ...], "gravel": [...]} as runs of model studs (x0..x1 inclusive) per row z.
"""
import argparse, json, math, os, sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiff import read_float_tiff

MAIN = ('primary', 'secondary', 'tertiary', 'residential', 'unclassified')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json'); ap.add_argument('--dtm', required=True); ap.add_argument('--dsm', required=True)
    ap.add_argument('--dsm-last', required=True); ap.add_argument('--intensity', required=True)
    ap.add_argument('--bbox', nargs=4, type=float, required=True)
    a = ap.parse_args()
    d = json.load(open(a.json))
    E0, N0, E1, N1 = a.bbox
    dtm = read_float_tiff(a.dtm)
    ground = (read_float_tiff(a.dsm) - dtm < 0.3) & (read_float_tiff(a.dsm_last) - dtm < 0.3)
    H, W = dtm.shape
    # the intensity tile is a larger grid square: decode only the rows over the model
    probe = read_float_tiff(a.intensity, rows=(0, 1), georef=True)[1]
    r0 = int((probe[1] - N1) / probe[2]); r1 = int((probe[1] - N0) / probe[2]) + 1
    tile, (tE, tN, res) = read_float_tiff(a.intensity, rows=(max(0, r0), r1), georef=True)
    inten = np.full(dtm.shape, np.nan, np.float32)
    rr, cc = np.mgrid[0:H, 0:W]
    tr = ((tN - (N1 - rr - 0.5)) / res).astype(int); tc = (((E0 + cc + 0.5) - tE) / res).astype(int)
    ok = (tr >= 0) & (tr < tile.shape[0]) & (tc >= 0) & (tc < tile.shape[1])
    inten[ok] = tile[tr[ok], tc[ok]]

    # model studs <-> raster pixels
    o, A = d['bng']['o'], d['bng']['A']
    def rc(x, z):
        E = o[0] + A[0][0] * x + A[0][1] * z; N = o[1] + A[1][0] * x + A[1][1] * z
        return (E - E0, N1 - N)
    def lines(roads, width):
        im = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(im)
        for r in roads: dr.line([rc(*p) for p in r['pts']], fill=255, width=width)
        return np.array(im) > 0
    roads = lines([r for r in d['roads'] if r['type'] in MAIN], 13) | lines([r for r in d['roads'] if r['type'] == 'service'], 5)
    bm = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(bm)
    for b in d['osBuildings']: dr.polygon([rc(*p) for p in b['pts']], fill=255)
    bmask = np.array(bm) > 0
    dist_b = ndimage.distance_transform_edt(~bmask); dist_r = ndimage.distance_transform_edt(~roads)

    ok = ground & ~np.isnan(inten) & ~bmask & ~roads & (dist_b < 40)
    strong = ok & (inten < 30)
    weak = ndimage.binary_closing(ok & (inten < 42), iterations=1) & ok
    lab, n = ndimage.label(weak)
    idx = np.arange(1, n + 1)
    nstrong = ndimage.sum(strong, lab, idx); size = ndimage.sum(weak, lab, idx)
    med = np.array(ndimage.median(np.where(weak, inten, np.nan), lab, idx))
    near = np.minimum(dist_r, dist_b)
    good = ((nstrong >= 6) & (size >= 10) & (nstrong / np.maximum(size, 1) >= 0.25)
            & (np.array(ndimage.minimum(near, lab, idx)) <= 2.5) & (np.array(ndimage.median(near, lab, idx)) <= 9))
    kind = np.zeros(n + 1, np.uint8)
    kind[idx[good]] = np.where(med[good] < 27, 1, 2)
    cls = kind[lab]

    # sample at every stud
    half = d['half']
    out = {'tarmac': [], 'gravel': []}
    for z in range(-half, half):
        xs = np.arange(-half, half) + 0.5
        cols, rows = rc(xs, z + 0.5)
        ci, ri = np.floor(cols).astype(int), np.floor(rows).astype(int)
        inside = (ci >= 0) & (ci < W) & (ri >= 0) & (ri < H)
        k = np.zeros(xs.size, np.uint8); k[inside] = cls[ri[inside], ci[inside]]
        for code, name in ((1, 'tarmac'), (2, 'gravel')):
            m = k == code; x = 0
            while x < m.size:
                if m[x]:
                    x1 = x
                    while x1 + 1 < m.size and m[x1 + 1]: x1 += 1
                    out[name].append([z, x - half, x1 - half]); x = x1 + 1
                else: x += 1
    d['hard'] = out
    json.dump(d, open(a.json, 'w'), separators=(',', ':'))
    print(a.json, int(good.sum()), 'patches;', {k: sum(r[2] - r[1] + 1 for r in v) for k, v in out.items()}, 'studs')


if __name__ == '__main__':
    main()
