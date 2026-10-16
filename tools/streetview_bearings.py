#!/usr/bin/env python3
"""Which buildings a Street View panorama can see, and in which direction, for recording survey.json details.

  python3 tools/streetview_bearings.py roads          -> every building with its nearest public road and the point on it
  python3 tools/streetview_bearings.py at N [N...]    -> a point inside each building, for a survey.json detail's "at"
  python3 tools/streetview_bearings.py LAT LON        -> buildings within 70 m of a panorama at LAT, LON: bearing from
                                                         north, angular span, distance, and the compass directions
                                                         of the fitted walls the camera sees (candidates for "front")

Building numbers are indexes into "osBuildings" in data/kneesall.json (the same numbers as fit_buildings.py --qa).
A Street View still at yaw Y and field of view F covers bearings Y - F/2 .. Y + F/2, left to right.
"""
import json
import math
import os
import sys

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'kneesall.json')
PUBLIC = ('primary', 'secondary', 'tertiary', 'unclassified', 'residential')


def main():
    d = json.load(open(DATA))
    lat0, lon0 = d['origin']; mps = d['metresPerStud']
    kx = math.cos(math.radians(lat0)) * 111320 / mps; kz = 110540 / mps
    to_ll = lambda x, z: (lat0 - z / kz, lon0 + x / kx)
    builds = [(i, sum(p[0] for p in b['pts']) / len(b['pts']), sum(p[1] for p in b['pts']) / len(b['pts']), b['pts'])
              for i, b in enumerate(d['osBuildings'])]
    if sys.argv[1] == 'at':
        # a point inside each building (the middle of its largest fitted part), for a survey.json detail's "at"
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from osgb import osgb_to_wgs84
        o, A = d['bng']['o'], d['bng']['A']
        for a in sys.argv[2:]:
            b = d['osBuildings'][int(a)]; f = b.get('fit')
            if f:
                p = max(f['parts'], key=lambda p: (p['u'][1] - p['u'][0]) * (p['w'][1] - p['w'][0]))
                u, w = sum(p['u']) / 2, sum(p['w']) / 2; fr = f['frame']; br = math.radians(fr['bearing'])
                E = fr['E'] + u * math.sin(br) - w * math.cos(br); N = fr['N'] + u * math.cos(br) + w * math.sin(br)
            else:
                x = sum(q[0] for q in b['pts']) / len(b['pts']); z = sum(q[1] for q in b['pts']) / len(b['pts'])
                E = o[0] + A[0][0] * x + A[0][1] * z; N = o[1] + A[1][0] * x + A[1][1] * z
            la, lo = osgb_to_wgs84(E, N)
            print(f'b{a}: [{la:.6f}, {lo:.6f}]')
        return
    if sys.argv[1] == 'roads':
        roads = [r for r in d['roads'] if r['type'] in PUBLIC]
        rows = []
        for i, cx, cz, _ in builds:
            best = None
            for r in roads:
                for a, b in zip(r['pts'], r['pts'][1:]):
                    dx, dz = b[0] - a[0], b[1] - a[1]; L2 = dx * dx + dz * dz or 1
                    t = max(0, min(1, ((cx - a[0]) * dx + (cz - a[1]) * dz) / L2))
                    qx, qz = a[0] + t * dx, a[1] + t * dz; dist = math.hypot(qx - cx, qz - cz) * mps
                    if best is None or dist < best[0]:
                        best = (dist, qx, qz, r.get('name') or r['type'])
            rows.append((best[3], i, best[0], *to_ll(best[1], best[2])))
        for road, i, dist, la, lo in sorted(rows):
            print(f'{road:16s} b{i:<3d} {dist:4.0f} m from road at {la:.6f},{lo:.6f}')
        return
    la, lo = float(sys.argv[1]), float(sys.argv[2])
    px, pz = (lo - lon0) * kx, -(la - lat0) * kz
    brg = lambda x, z: math.degrees(math.atan2(x - px, -(z - pz))) % 360
    rows = []
    for i, cx, cz, pts in builds:
        dist = math.hypot(cx - px, cz - pz) * mps
        if dist > 70:
            continue
        bc = brg(cx, cz); rel = [((brg(x, z) - bc + 540) % 360) - 180 for x, z in pts]
        # the fitted walls facing the camera (compass direction of each wall's outward normal; "front" in survey.json
        # details snaps to the nearest of the four, so give one of these), the most squarely seen first
        fit = d['osBuildings'][i].get('fit')
        seen = ''
        if fit:
            back = (bc + 180) % 360
            faces = sorted(((fit['frame']['bearing'] + k * 90) % 360 for k in range(4)), key=lambda f: abs((f - back + 180) % 360 - 180))
            seen = '  walls seen: ' + ', '.join(f'{f:.0f}' for f in faces if abs((f - back + 180) % 360 - 180) < 90)
        rows.append((round(bc), round(bc + min(rel)), round(bc + max(rel)), round(dist), i, seen))
    for b, lo_, hi, dist, i, seen in sorted(rows):
        print(f'b{i:<3d} bearing {b:3d} (spans {lo_}..{hi}), {dist} m away{seen}')


if __name__ == '__main__':
    main()
