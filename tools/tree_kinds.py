#!/usr/bin/env python3
"""Tell evergreen trees and hedges from deciduous ones in data/kneesall.json, from how far the laser gets into each crown.

  python3 tools/tree_kinds.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --dsm-last dsm_last.tif --bbox E0 N0 E1 N1

The LIDAR was flown with the leaves off, so the last return of each pulse goes down through a deciduous crown to
the branches and the ground, while a yew, holly or conifer stops it near the top. Each tree's "ev" is the share of
its crown (where the first return is over half the tree's height) whose last return stays above three quarters of
the first: about 0 for oaks, ashes and limes, over a half for evergreens.

The same test on the low growth (1-4.5 m) gives the evergreen hedges and shrubs (privet, laurel, box, conifer
screens, clipped yews), which stay green through the winter: "evergreen" in the JSON, runs [z, x0, x1] of model
studs (x0..x1 inclusive) where most of the low growth round the metre of LIDAR under them has a last return above
0.7 of the first. Walls and fences answer the test the same way, but where they matter they are surveyed by hand
and drawn over the hedge.

Environment Agency LIDAR © Environment Agency, Open Government Licence v3.0.
"""
import argparse
import json
import os
import sys

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiff import read_float_tiff  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json')
    ap.add_argument('--dtm', required=True)
    ap.add_argument('--dsm', required=True)
    ap.add_argument('--dsm-last', required=True)
    ap.add_argument('--bbox', type=float, nargs=4, required=True)
    a = ap.parse_args()
    data = json.load(open(a.json))
    dtm = read_float_tiff(a.dtm)
    first = np.nan_to_num(read_float_tiff(a.dsm) - dtm)
    last = np.nan_to_num(read_float_tiff(a.dsm_last) - dtm)
    E0, N1 = a.bbox[0], a.bbox[3]
    (oE, oN), A = data['bng']['o'], data['bng']['A']
    for t in data['trees']:
        E = oE + A[0][0] * t['x'] + A[0][1] * t['z']
        N = oN + A[1][0] * t['x'] + A[1][1] * t['z']
        c, r, rad = int(E - E0), int(N1 - N), max(1, int(t['r']))
        ys, xs = np.mgrid[-rad:rad + 1, -rad:rad + 1]
        disc = ys ** 2 + xs ** 2 <= rad * rad
        f = first[r - rad:r + rad + 1, c - rad:c + rad + 1][disc]
        lst = last[r - rad:r + rad + 1, c - rad:c + rad + 1][disc]
        crown = f > 0.5 * t['h']
        t['ev'] = round(float(np.mean(lst[crown] > 0.75 * f[crown])), 2) if crown.any() else 0.0

    # evergreen low growth, sampled at the centre of every stud
    half, (oE, oN), A = data['half'], data['bng']['o'], data['bng']['A']
    # (by majority over each metre and its eight neighbours, so a hedge is called one thing along its length)
    low = (first >= 1.0) & (first <= 4.5)
    k = np.ones((3, 3))
    hard = low & (ndimage.convolve((low & (last > 0.7 * first)).astype(float), k, mode='constant') >
                  ndimage.convolve((low & (last <= 0.7 * first)).astype(float), k, mode='constant'))
    runs = []
    xs = np.arange(-half, half) + 0.5
    for z in range(-half, half):
        E = oE + A[0][0] * xs + A[0][1] * (z + 0.5); N = oN + A[1][0] * xs + A[1][1] * (z + 0.5)
        c, r = np.floor(E - E0).astype(int), np.floor(N1 - N).astype(int)
        inside = (c >= 0) & (c < hard.shape[1]) & (r >= 0) & (r < hard.shape[0])
        m = np.zeros(xs.size, bool); m[inside] = hard[r[inside], c[inside]]
        x = 0
        while x < m.size:
            if m[x]:
                x1 = x
                while x1 + 1 < m.size and m[x1 + 1]: x1 += 1
                runs.append([z, x - half, x1 - half]); x = x1 + 1
            else: x += 1
    data['evergreen'] = runs
    json.dump(data, open(a.json, 'w'), separators=(',', ':'))
    ev = np.array([t['ev'] for t in data['trees']])
    print(f"{len(ev)} trees, {int((ev > 0.5).sum())} evergreen; {sum(r[2] - r[1] + 1 for r in runs)} studs of evergreen low growth")


if __name__ == '__main__':
    main()
