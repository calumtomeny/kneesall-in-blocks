#!/usr/bin/env python3
"""Print LIDAR values on a 1 m grid rotated to a building, for measuring entries in data/survey.json.

  python3 tools/survey_grid.py E N BEARING U0 U1 W0 W1 [--layer last|first|intensity]

The grid's origin is (E, N) on the British National Grid; u runs along BEARING (degrees clockwise from grid
north) and w at right angles to its left, the same frame survey.json uses. Heights are printed in decimetres
above the ground; '.' is under 1.4 m. The last return sees through leafless trees, so it is the default.
Pick BEARING from a wall of the building (e.g. an edge of its Ordnance Survey outline).
"""
import argparse
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiff import read_float_tiff  # noqa: E402

LIDAR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'lidar')
E0, N1 = 469880, 364760   # top-left of the 1 km LIDAR rasters in data/lidar


def main():
    ap = argparse.ArgumentParser()
    for k in ('E', 'N', 'bearing', 'u0', 'u1', 'w0', 'w1'):
        ap.add_argument(k, type=float)
    ap.add_argument('--layer', default='last', choices=('last', 'first', 'intensity'))
    a = ap.parse_args()
    dtm = read_float_tiff(os.path.join(LIDAR, 'dtm.tif'))
    if a.layer == 'intensity':
        tile, (tE, tN, res) = read_float_tiff(os.path.join(LIDAR, 'intensity_SK7060.tif'), rows=(240, 1241), georef=True)
        grid = np.zeros(dtm.shape)
        grid[:, 120:] = np.nan_to_num(tile[240:1240, :880]) / 10   # intensity / 10, to fit the columns
    else:
        grid = np.nan_to_num(read_float_tiff(os.path.join(LIDAR, 'dsm_last.tif' if a.layer == 'last' else 'dsm.tif')) - dtm)

    def sample(E, N):
        c, r = E - E0 - 0.5, N1 - N - 0.5
        c0, r0 = int(math.floor(c)), int(math.floor(r)); fc, fr = c - c0, r - r0
        q = grid[r0:r0 + 2, c0:c0 + 2]
        return q[0, 0] * (1 - fc) * (1 - fr) + q[0, 1] * fc * (1 - fr) + q[1, 0] * (1 - fc) * fr + q[1, 1] * fc * fr

    b = math.radians(a.bearing)
    ue, we = (math.sin(b), math.cos(b)), (-math.cos(b), math.sin(b))
    us = range(int(a.u0), int(a.u1) + 1)
    print('  w\\u ' + ''.join(f'{u:4d}' for u in us))
    for w in range(int(a.w1), int(a.w0) - 1, -1):
        vals = [sample(a.E + u * ue[0] + w * we[0], a.N + u * ue[1] + w * we[1]) for u in us]
        print(f'{w:5d} ' + ''.join(f'{int(round(v * 10)):4d}' if v > 1.4 else '   .' for v in vals))


if __name__ == '__main__':
    main()
