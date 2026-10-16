#!/usr/bin/env python3
"""Measure every building from the Environment Agency LIDAR as a few clean parts, like a hand survey.

Run after lidar_roofs.py (it needs "osBuildings" and the "bng" grid transform in the JSON):

  python3 tools/fit_buildings.py data/kneesall.json --dtm dtm.tif --dsm dsm.tif --dsm-last dsm_last.tif \
      --intensity intensity_tile.tif --bbox E0 N0 E1 N1 [--qa sheet.png]

For each Ordnance Survey building:
  1. footprint: LIDAR pixels that are raised, hard (first and last return agree) and smooth, starting from the
     OS outline and growing up to 6 m into raised neighbours, so wings missing from the generalised OS outline
     are found and parts the LIDAR sees as open ground are dropped;
  2. a 0.5 m grid rotated to the building's walls, split greedily into the largest rectangles that fit;
  3. each rectangle split where its ridge height steps, then fitted with a gable (either way), hip, lean-to or
     flat roof by least squares on the last-return heights, giving eaves and ridge heights;
  4. chimneys: small hard spots of the first return standing well above the fitted roof;
  5. each part's laser intensity ("roofI"), which picks its roof material (see roofMaterial in js/buildings.js).
The result is stored as "fit" on each building: {frame, parts, chimneys, rms, cover}, in the same form as
data/survey.json, and js/osm.js builds from it.

Environment Agency LIDAR © Environment Agency, Open Government Licence v3.0.
"""
import argparse
import json
import math
import os
import sys
from collections import deque

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiff import read_float_tiff  # noqa: E402
from lidar_roofs import fill_poly, dilate, erode  # noqa: E402
from osgb import wgs84_to_osgb  # noqa: E402

G = 0.5            # fitting grid (m)
MIN_SIDE = 2.0     # smallest part width (m)
MIN_PART = 6.0     # smallest part area (m2)
GROW = 6           # how far (m) a footprint may grow beyond its OS outline


def features(dtm, first, last):
    ndl = np.nan_to_num(last - dtm); ndf = np.nan_to_num(first - dtm)
    H, W = ndl.shape
    P = np.pad(np.nan_to_num(last), 1, mode='edge')
    win = np.stack([P[1 + dy:H + 1 + dy, 1 + dx:W + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)], -1)
    xs = np.array([dx for dy in (-1, 0, 1) for dx in (-1, 0, 1)], float); ys = np.array([dy for dy in (-1, 0, 1) for dx in (-1, 0, 1)], float)
    gx = (win * xs).sum(-1) / 6; gy = (win * ys).sum(-1) / 6
    res = win - (win.mean(-1)[..., None] + gx[..., None] * xs + gy[..., None] * ys)
    return ndl, ndf, ndf - ndl, np.sqrt((res ** 2).mean(-1))


def bearing_of(en):
    """Bearing (deg) of the minimum-area rectangle's first side."""
    best, ba = 0.0, 1e18
    for i in range(len(en)):
        (e0, n0), (e1, n1) = en[i], en[(i + 1) % len(en)]
        if math.hypot(e1 - e0, n1 - n0) < 1:
            continue
        b = math.atan2(e1 - e0, n1 - n0)
        u = [e * math.sin(b) + n * math.cos(b) for e, n in en]; w = [-e * math.cos(b) + n * math.sin(b) for e, n in en]
        A = (max(u) - min(u)) * (max(w) - min(w))
        if A < ba:
            ba, best = A, b
    return math.degrees(best) % 180


def max_rect(M, k):
    """Largest all-True rectangle with both sides >= k cells: (area, r0, r1, c0, c1) or None."""
    nr, nc = M.shape
    h = np.zeros(nc, int); best = None
    for r in range(nr):
        h = np.where(M[r], h + 1, 0)
        stack = []
        for c in range(nc + 1):
            cur = h[c] if c < nc else 0
            start = c
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                if hh >= k and c - s >= k and (best is None or hh * (c - s) > best[0]):
                    best = (hh * (c - s), r - hh + 1, r + 1, s, c)
                start = s
            stack.append((start, cur))
    return best


def roof_fit(u, w, h, r):
    """Best roof model for heights h at points (u, w) inside rectangle r = (u0, u1, w0, w1)."""
    u0, u1, w0, w1 = r
    D = {'gable_u': np.minimum(w - w0, w1 - w), 'gable_w': np.minimum(u - u0, u1 - u),
         'hip': np.minimum(np.minimum(u - u0, u1 - u), np.minimum(w - w0, w1 - w)),
         'lean_u0': u - u0, 'lean_u1': u1 - u, 'lean_w0': w - w0, 'lean_w1': w1 - w}
    dmax = {'gable_u': (w1 - w0) / 2, 'gable_w': (u1 - u0) / 2, 'hip': min(u1 - u0, w1 - w0) / 2,
            'lean_u0': u1 - u0, 'lean_u1': u1 - u0, 'lean_w0': w1 - w0, 'lean_w1': w1 - w0}
    penalty = {'flat': 0, 'gable_u': 0.03, 'gable_w': 0.03, 'hip': 0.06, 'lean_u0': 0.08, 'lean_u1': 0.08, 'lean_w0': 0.08, 'lean_w1': 0.08}
    best = None
    for name in ['flat'] + list(D):
        d = D.get(name, np.zeros_like(h)); keep = np.ones(len(h), bool)
        for _ in range(3):   # trimmed least squares: drop points far off the fitted plane (aerials, dormers, edges)
            if name == 'flat':
                e, p = float(np.median(h[keep])), 0.0
            else:
                X = np.stack([np.ones(keep.sum()), d[keep]], 1)
                e, p = np.linalg.lstsq(X, h[keep], rcond=None)[0]
            res = h - (e + p * d)
            s = max(0.15, 1.5 * float(np.median(np.abs(res[keep]))) * 1.48)
            keep = np.abs(res) < 2.5 * s
        if name != 'flat' and (p < 0.2 or p > 2.0):
            continue
        rms = float(np.sqrt(np.mean(np.minimum(res, 1.5) ** 2)))
        # a lean-to wider than 4 m is usually half of a gable or hip cut off by the rectangles
        score = rms + penalty[name] + (0.2 if name.startswith('lean') and dmax[name] > 4 else 0)
        if best is None or score < best[0]:
            best = (score, name, float(e), float(p), rms, dmax.get(name, 0))
    _, name, e, p, rms, dm = best
    return name, e, e + p * dm, rms


def split_steps(r, u, w, h, along):
    """Split a rectangle where its ridge height steps along its length. Returns list of rectangles."""
    u0, u1, w0, w1 = r
    a0, a1 = (u0, u1) if along == 'u' else (w0, w1)
    x = u if along == 'u' else w
    n = int((a1 - a0) / G)
    if n < 2 * int(2.5 / G):
        return [r]
    prof = np.full(n, np.nan)
    for i in range(n):
        s = (x >= a0 + i * G) & (x < a0 + (i + 1) * G)
        if s.sum() >= 2:
            prof[i] = np.percentile(h[s], 90)
    best = None
    m = int(2.5 / G)
    for i in range(m, n - m + 1):
        L, Rr = prof[:i][~np.isnan(prof[:i])], prof[i:][~np.isnan(prof[i:])]
        if len(L) < 3 or len(Rr) < 3:
            continue
        dlt = abs(np.median(L[-m:]) - np.median(Rr[:m]))
        if dlt > 0.7 and abs(np.median(L) - np.median(Rr)) > 0.6 and (best is None or dlt > best[0]):
            best = (dlt, i)
    if best is None:
        return [r]
    cut = a0 + best[1] * G
    ra, rb = ((u0, cut, w0, w1), (cut, u1, w0, w1)) if along == 'u' else ((u0, u1, w0, cut), (u0, u1, cut, w1))
    out = []
    for q in (ra, rb):
        sel = (u >= q[0]) & (u < q[1]) & (w >= q[2]) & (w < q[3])
        out += split_steps(q, u[sel], w[sel], h[sel], along)
    return out


def fit_building(S, ndl, ndf, diff, bearing, E0, N1, inten=None):
    """S: bool raster footprint; inten: laser intensity raster or None. Returns fit dict in survey form, or None."""
    rr, cc = np.nonzero(S)
    if len(rr) < 6:
        return None
    E = E0 + cc + 0.5; N = N1 - rr - 0.5
    oE, oN = float(E.mean()), float(N.mean())
    b = math.radians(bearing); ue = (math.sin(b), math.cos(b)); we = (-math.cos(b), math.sin(b))
    U = (E - oE) * ue[0] + (N - oN) * ue[1]; Wd = (E - oE) * we[0] + (N - oN) * we[1]
    us = np.arange(math.floor(U.min()) - 1.5, U.max() + 1.5, G) + G / 2
    ws = np.arange(math.floor(Wd.min()) - 1.5, Wd.max() + 1.5, G) + G / 2
    UU, WW = np.meshgrid(us, ws)
    EE = oE + UU * ue[0] + WW * we[0]; NN = oN + UU * ue[1] + WW * we[1]
    cf = EE - E0 - 0.5; rf = N1 - NN - 0.5
    c0 = np.floor(cf).astype(int); r0 = np.floor(rf).astype(int); fc = cf - c0; fr = rf - r0
    Sf = S.astype(float); num = np.zeros(UU.shape); mem = np.zeros(UU.shape); hf = np.zeros(UU.shape); veg = np.zeros(UU.shape)
    for dr, dc, wt in ((0, 0, (1 - fr) * (1 - fc)), (0, 1, (1 - fr) * fc), (1, 0, fr * (1 - fc)), (1, 1, fr * fc)):
        R_, C_ = np.clip(r0 + dr, 0, S.shape[0] - 1), np.clip(c0 + dc, 0, S.shape[1] - 1)
        mem += Sf[R_, C_] * wt; num += Sf[R_, C_] * wt * ndl[R_, C_]
        hf += wt * ndf[R_, C_]; veg += wt * diff[R_, C_]
    In = inten[np.clip(np.round(rf).astype(int), 0, S.shape[0] - 1), np.clip(np.round(cf).astype(int), 0, S.shape[1] - 1)] if inten is not None else None
    M = mem >= 0.5
    H = np.where(mem > 0.05, num / np.maximum(mem, 1e-9), 0)
    # tidy the outline: majority filter, then close notches up to 1 m (a square closing keeps square corners)
    for _ in range(2):
        P = np.pad(M, 1)
        cnt = sum(P[1 + dy:P.shape[0] - 1 + dy, 1 + dx:P.shape[1] - 1 + dx].astype(int) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        M = cnt >= 5
    M = erode(erode(dilate(dilate(np.pad(M, 3)))))[3:-3, 3:-3]
    total = M.sum()
    if total * G * G < MIN_PART:
        return None
    k = int(round(MIN_SIDE / G)); rem = M.copy(); rects = []
    while len(rects) < 10:
        r = max_rect(rem, k)
        if r is None or r[0] * G * G < MIN_PART:
            break
        _, a, bb, c, d = r
        rem[a:bb, c:d] = False
        rects.append((us[c] - G / 2, us[d - 1] + G / 2, ws[a] - G / 2, ws[bb - 1] + G / 2))
    if not rects:
        return None
    pu, pw, ph = UU[M], WW[M], H[M]
    inr = lambda q: (pu >= q[0]) & (pu < q[1]) & (pw >= q[2]) & (pw < q[3])
    # merge neighbours sharing a whole side when one roof fits both as well (two halves of a gable, say)
    same = lambda x, y: abs(x - y) < 1e-6
    merged = True
    while merged:
        merged = False
        for i in range(len(rects)):
            for j in range(i + 1, len(rects)):
                a_, b_ = rects[i], rects[j]
                touch_w = same(a_[3], b_[2]) or same(b_[3], a_[2])
                touch_u = same(a_[1], b_[0]) or same(b_[1], a_[0])
                ov = lambda p0, p1, q0, q1: max(0, min(p1, q1) - max(p0, q0)) / max(1e-6, min(p1 - p0, q1 - q0))
                if not ((touch_w and ov(a_[0], a_[1], b_[0], b_[1]) > 0.7) or (touch_u and ov(a_[2], a_[3], b_[2], b_[3]) > 0.7)):
                    continue
                un = (min(a_[0], b_[0]), max(a_[1], b_[1]), min(a_[2], b_[2]), max(a_[3], b_[3]))
                cells = (UU >= un[0]) & (UU < un[1]) & (WW >= un[2]) & (WW < un[3])
                if M[cells].mean() < 0.9:
                    continue
                fa, fb, fu = (roof_fit(pu[inr(q)], pw[inr(q)], ph[inr(q)], q) for q in (a_, b_, un))
                na, nb = inr(a_).sum(), inr(b_).sum()
                if fu[3] <= (fa[3] * na + fb[3] * nb) / max(1, na + nb) + 0.12:
                    rects[i] = un; del rects[j]; merged = True
                    break
            if merged:
                break
    parts = []
    for r in rects:
        sel = (pu >= r[0]) & (pu < r[1]) & (pw >= r[2]) & (pw < r[3])
        along = 'u' if r[1] - r[0] >= r[3] - r[2] else 'w'
        for q in split_steps(r, pu[sel], pw[sel], ph[sel], along):
            s2 = (pu >= q[0]) & (pu < q[1]) & (pw >= q[2]) & (pw < q[3])
            if s2.sum() < 8:
                continue
            name, e, top, rms = roof_fit(pu[s2], pw[s2], ph[s2], q)
            part = {'u': [round(q[0], 1), round(q[1], 1)], 'w': [round(q[2], 1), round(q[3], 1)],
                    'eaves': round(max(1.8, e), 1), 'top': round(max(e, top), 1), 'rms': round(rms, 2)}
            if In is not None:
                # laser intensity off this part's roof, away from its edges and anything leafy
                core = M & (UU > q[0] + 0.5) & (UU < q[1] - 0.5) & (WW > q[2] + 0.5) & (WW < q[3] - 0.5) & (veg < 0.4)
                v = In[core]; v = v[np.isfinite(v)]
                if len(v) >= 6:
                    part['roofI'] = round(float(np.median(v)), 1)
            if name == 'flat':
                part['roof'] = 'flat'
            elif name.startswith('gable'):
                part['roof'] = 'gable'; part['along'] = name[-1]
            elif name == 'hip':
                part['roof'] = 'hip'
            else:
                part['roof'] = 'lean'; part['low'] = {'u0': 'u0', 'u1': 'u1', 'w0': 'w0', 'w1': 'w1'}[name[5:]]
            parts.append(part)
    if not parts:
        return None

    # model surface, for the overall error and for chimneys
    model = np.full(UU.shape, -1.0)
    for p in parts:
        u0, u1 = p['u']; w0, w1 = p['w']
        inside = (UU >= u0) & (UU < u1) & (WW >= w0) & (WW < w1)
        du0, du1, dw0, dw1 = UU - u0, u1 - UU, WW - w0, w1 - WW
        d = {'flat': 0 * UU, 'hip': np.minimum(np.minimum(du0, du1), np.minimum(dw0, dw1))}.get(p['roof'])
        if p['roof'] == 'gable':
            d = np.minimum(dw0, dw1) if p['along'] == 'u' else np.minimum(du0, du1)
        if p['roof'] == 'lean':
            d = {'u0': du0, 'u1': du1, 'w0': dw0, 'w1': dw1}[p['low']]
        dm = max(1e-6, float(d[inside].max()) if inside.any() else 1)
        z = p['eaves'] + (p['top'] - p['eaves']) * np.minimum(1, d / dm) if p['roof'] != 'flat' else p['top'] + 0 * UU
        model = np.where(inside, np.maximum(model, z), model)
    covered = (model >= 0) & M
    rms = float(np.sqrt(np.mean((H[covered] - model[covered]) ** 2))) if covered.any() else 9
    # chimneys: hard first-return spots, 0.25-3 m2, standing > 0.9 m proud of the roof and above its ridge
    ridge = np.full(UU.shape, -1.0)
    for p in parts:
        inside = (UU >= p['u'][0] - G) & (UU < p['u'][1] + G) & (WW >= p['w'][0] - G) & (WW < p['w'][1] + G)
        ridge = np.where(inside, np.maximum(ridge, p['top']), ridge)
    spot = (ridge >= 0) & (hf - np.maximum(model, 0) > 1.0) & (hf > ridge + 0.4) & (veg < 0.5)
    chims = []
    seen = np.zeros_like(spot)
    for a, c in zip(*np.nonzero(spot)):
        if seen[a, c]:
            continue
        comp = [(a, c)]; seen[a, c] = True; i = 0
        while i < len(comp):
            y, x = comp[i]; i += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < spot.shape[0] and 0 <= xx < spot.shape[1] and spot[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True; comp.append((yy, xx))
        if 1 <= len(comp) <= 12:
            chims.append([round(float(np.mean([UU[y, x] for y, x in comp])), 1), round(float(np.mean([WW[y, x] for y, x in comp])), 1)])
    return {'frame': {'E': round(oE, 2), 'N': round(oN, 2), 'bearing': round(bearing, 1)}, 'parts': parts, 'chimneys': chims,
            'rms': round(rms, 2), 'cover': round(float(covered.sum()) / max(1, total), 2)}


def roof_model(parts, U, W):
    """Height of the fitted roofs at points (U, W) of the building's frame; -1 where no part covers."""
    model = np.full(np.shape(U), -1.0)
    for p in parts:
        u0, u1 = p['u']; w0, w1 = p['w']
        inside = (U >= u0) & (U < u1) & (W >= w0) & (W < w1)
        du0, du1, dw0, dw1 = U - u0, u1 - U, W - w0, w1 - W
        if p['roof'] == 'flat':
            z = p['top'] + 0 * U
        else:
            d, dm = {'hip': (np.minimum(np.minimum(du0, du1), np.minimum(dw0, dw1)), min(u1 - u0, w1 - w0) / 2),
                     'gable': (np.minimum(dw0, dw1), (w1 - w0) / 2) if p.get('along') == 'u' else (np.minimum(du0, du1), (u1 - u0) / 2),
                     'lean': ({'u0': du0, 'u1': du1, 'w0': dw0, 'w1': dw1}.get(p.get('low')), (u1 - u0) if p.get('low', 'u')[0] == 'u' else (w1 - w0))}[p['roof']]
            z = p['eaves'] + (p['top'] - p['eaves']) * np.minimum(1, d / max(dm, 1e-6))
        model = np.where(inside, np.maximum(model, z), model)
    return model


def raster_error(f, S, ndl, E0, N1):
    """Mean error (m, capped at 3 a pixel) of a fit against the last return, on the 1 m LIDAR pixels of the
    building and of the open ground just around it: the same pixels whichever way the fit is turned, so missing
    pieces of building and parts overhanging the ground both count."""
    ring = dilate(S, 2) & ~S & (ndl < 1.0)
    rr, cc = np.nonzero(S | ring)
    E = E0 + cc + 0.5; N = N1 - rr - 0.5
    fr = f['frame']; b = math.radians(fr['bearing'])
    U = (E - fr['E']) * math.sin(b) + (N - fr['N']) * math.cos(b); W = -(E - fr['E']) * math.cos(b) + (N - fr['N']) * math.sin(b)
    m = np.maximum(roof_model(f['parts'], U, W), 0)
    h = np.where(S[rr, cc], ndl[rr, cc], 0)
    return float(np.mean(np.minimum(np.abs(h - m), 3)))


def fit_turned(S, ndl, ndf, diff, bearing, E0, N1, inten=None):
    """fit_building at the OS outline's bearing, or turned up to 15 degrees where that fits the LIDAR clearly
    better (OS outlines are generalised, and a few sit several degrees off the real walls)."""
    fit = lambda t: fit_building(S, ndl, ndf, diff, t, E0, N1, inten)
    err = lambda f: raster_error(f, S, ndl, E0, N1) if f else 9
    base = fit(bearing)
    if base is None:
        return None
    # the per-pixel error alone would rather fit a few lean-tos across a roof than a gable or hip that is
    # slightly off, so a turned fit must keep the same main roof and add no lean-tos
    area = lambda p: (p['u'][1] - p['u'][0]) * (p['w'][1] - p['w'][0])
    form = lambda f: (max(f['parts'], key=area)['roof'], sum(p['roof'] == 'lean' for p in f['parts']))
    alike = lambda f: f and form(f)[0] == form(base)[0] and form(f)[1] <= form(base)[1]
    e0 = err(base); best, eb = base, e0
    for d in list(range(-15, 0, 3)) + list(range(3, 16, 3)):
        f = fit(bearing + d); e = err(f) if alike(f) else 9
        if e < eb:
            best, eb = f, e
    t = best['frame']['bearing']
    for d in (-1.5, 1.5):
        f = fit(t + d); e = err(f) if alike(f) else 9
        if e < eb:
            best, eb = f, e
    turn = round((best['frame']['bearing'] - bearing + 90) % 180 - 90, 1)
    if os.environ.get('FIT_DEBUG'):
        print('turn', turn, 'err', round(e0, 3), '->', round(eb, 3), 'rms', base['rms'], '->', best['rms'], 'cover', base['cover'], '->', best['cover'], file=sys.stderr)
    if eb < e0 - max(0.04, 0.12 * e0):
        best['turned'] = turn
        return best
    return base


def outline_fit(en, bearing, eaves=5.0, pitch=0.8):
    """Parts for a building newer than the LIDAR: its outline [(E, N)] split into the largest rectangles that fit,
    each under a gable along its longer side at `eaves` metres, rising `pitch` metres per metre (about 40 degrees,
    as on the new houses in the village)."""
    b = math.radians(bearing); ue = (math.sin(b), math.cos(b)); we = (-math.cos(b), math.sin(b))
    oE = sum(e for e, _ in en) / len(en); oN = sum(n for _, n in en) / len(en)
    uw = [((e - oE) * ue[0] + (n - oN) * ue[1], (e - oE) * we[0] + (n - oN) * we[1]) for e, n in en]
    us = np.arange(min(u for u, _ in uw), max(u for u, _ in uw), G) + G / 2
    ws = np.arange(min(w for _, w in uw), max(w for _, w in uw), G) + G / 2
    M = np.zeros((len(ws), len(us)), bool)
    fill_poly(M, [((u - us[0]) / G + 0.5, (w - ws[0]) / G + 0.5) for u, w in uw])
    k = int(round(MIN_SIDE / G)); parts = []
    while len(parts) < 6:
        r = max_rect(M, k)
        if r is None or r[0] * G * G < MIN_PART:
            break
        _, a, bb, c, d = r
        M[a:bb, c:d] = False
        u0, u1, w0, w1 = (float(v) for v in (us[c] - G / 2, us[d - 1] + G / 2, ws[a] - G / 2, ws[bb - 1] + G / 2))
        along = 'u' if u1 - u0 >= w1 - w0 else 'w'
        half = (w1 - w0 if along == 'u' else u1 - u0) / 2
        parts.append({'u': [round(u0, 1), round(u1, 1)], 'w': [round(w0, 1), round(w1, 1)], 'eaves': eaves,
                      'top': round(eaves + pitch * half, 1), 'roof': 'gable', 'along': along})
    if not parts:
        return None
    return {'frame': {'E': round(oE, 2), 'N': round(oN, 2), 'bearing': round(bearing, 1)}, 'parts': parts, 'chimneys': [],
            'outline': True}


def hull(pts):
    """Convex hull of [(x, y)], anticlockwise."""
    pts = sorted(set(pts))
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return lo[:-1] + hi[:-1]


def lidar_only_building(s, free, raised, ndl, ndf, diff, inten, E0, N1, o, A):
    """A building that is in the LIDAR but not the OS outlines, at survey point s['at'] (lat, lon): the blob of
    free building-like pixels there, out to its raised edge pixels (which are too rough to be building-like), fitted
    like any other, with the attributes os_lidar.py gives OS buildings."""
    E, N = wgs84_to_osgb(*s['at'])
    r0, c0 = int(N1 - N), int(E - E0)
    near = [(abs(r - r0) + abs(c - c0), r, c) for r in range(r0 - 4, r0 + 5) for c in range(c0 - 4, c0 + 5)
            if 0 <= r < free.shape[0] and 0 <= c < free.shape[1] and free[r, c]]
    if not near:
        return None
    _, r, c = min(near)
    comp = [(r, c)]; seen = {(r, c)}; i = 0
    while i < len(comp) and len(comp) < 400:
        y, x = comp[i]; i += 1
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            q = (y + dy, x + dx)
            if q not in seen and 0 <= q[0] < free.shape[0] and 0 <= q[1] < free.shape[1] and free[q]:
                seen.add(q); comp.append(q)
    S = np.zeros_like(free)
    for q in comp:
        S[q] = True
    S |= dilate(S) & raised
    comp = list(zip(*np.nonzero(S)))
    corners = hull([(E0 + x + dx, N1 - y - dy) for y, x in comp for dx in (0, 1) for dy in (0, 1)])
    f = fit_turned(S, ndl, ndf, diff, bearing_of(corners), E0, N1, inten)
    if f is None:
        return None
    fr = f['frame']; b = math.radians(fr['bearing']); ue = (math.sin(b), math.cos(b)); we = (-math.cos(b), math.sin(b))
    en = hull([(fr['E'] + u * ue[0] + w * we[0], fr['N'] + u * ue[1] + w * we[1]) for p in f['parts'] for u in p['u'] for w in p['w']])
    Ai = np.linalg.inv(A)
    studs = [Ai @ (np.array(q) - o) for q in en]
    main = max(f['parts'], key=lambda p: (p['u'][1] - p['u'][0]) * (p['w'][1] - p['w'][0]))
    span = min(main['u'][1] - main['u'][0], main['w'][1] - main['w'][0]) / (1 if main['roof'] == 'lean' else 2)
    out = {'pts': [[round(float(x), 2), round(float(z), 2)] for x, z in studs], 'areaM2': int(S.sum()),
           'h': round(float(np.percentile(ndl[S], 90)), 1), 'roof': 'flat' if main['roof'] == 'flat' else 'hip' if main['roof'] == 'hip' else 'gable',
           'roofPitch': round(0 if main['roof'] == 'flat' else (main['top'] - main['eaves']) / max(0.5, span), 2), 'fit': f,
           'lidarOnly': True, 'name': ''}
    if 'roofI' in main:
        out['roofI'] = main['roofI']
    return out


def contact_sheet(sheet, ndl, E0, N1, path):
    """Per building: last-return relief in the building's own grid, with the fitted parts (white), ridges (red)
    and chimneys (magenta) drawn over it, to check the fit by eye."""
    from PIL import Image, ImageDraw
    S = 8   # pixels per metre
    tiles = []
    for i, f in sheet:
        fr = f['frame']; b = math.radians(fr['bearing'])
        ue = (math.sin(b), math.cos(b)); we = (-math.cos(b), math.sin(b))
        u0 = min(p['u'][0] for p in f['parts']) - 3; u1 = max(p['u'][1] for p in f['parts']) + 3
        w0 = min(p['w'][0] for p in f['parts']) - 3; w1 = max(p['w'][1] for p in f['parts']) + 3
        nu, nw = int((u1 - u0) * S), int((w1 - w0) * S)
        uu, ww = np.meshgrid(u0 + (np.arange(nu) + 0.5) / S, w1 - (np.arange(nw) + 0.5) / S)
        cf = fr['E'] + uu * ue[0] + ww * we[0] - E0 - 0.5; rf = N1 - (fr['N'] + uu * ue[1] + ww * we[1]) - 0.5
        c0 = np.clip(np.floor(cf).astype(int), 0, ndl.shape[1] - 2); r0 = np.clip(np.floor(rf).astype(int), 0, ndl.shape[0] - 2)
        fc = cf - c0; fr_ = rf - r0
        h = sum(ndl[r0 + dr, c0 + dc] * wt for dr, dc, wt in ((0, 0, (1 - fr_) * (1 - fc)), (0, 1, (1 - fr_) * fc), (1, 0, fr_ * (1 - fc)), (1, 1, fr_ * fc)))
        gy, gx = np.gradient(h, 1 / S)
        shade = np.clip(0.6 + 0.4 * (-gx + gy) / np.sqrt(2), 0.15, 1)
        v = np.clip(h / 9, 0, 1)
        rgb = np.stack([60 + 150 * v, 70 + 110 * v, 90 + 40 * v], -1) * shade[..., None] * np.where(h > 1.5, 1, 0.35)[..., None]
        t = Image.new('RGB', (nu, nw + 14), (25, 25, 25)); t.paste(Image.fromarray(rgb.astype(np.uint8)), (0, 14))
        d = ImageDraw.Draw(t)
        X = lambda u: (u - u0) * S; Y = lambda w: 14 + (w1 - w) * S
        for p in f['parts']:
            a, bb = p['u']; c, e = p['w']
            d.rectangle([X(a), Y(e), X(bb), Y(c)], outline=(255, 255, 255))
            uc, wc = (a + bb) / 2, (c + e) / 2
            if p['roof'] == 'gable':
                d.line([X(a), Y(wc), X(bb), Y(wc)] if p['along'] == 'u' else [X(uc), Y(c), X(uc), Y(e)], fill=(255, 40, 40), width=2)
            elif p['roof'] == 'hip':
                s_ = min(bb - a, e - c) / 2
                r = [(a + s_, wc), (bb - s_, wc)] if bb - a >= e - c else [(uc, c + s_), (uc, e - s_)]
                d.line([X(r[0][0]), Y(r[0][1]), X(r[1][0]), Y(r[1][1])], fill=(255, 40, 40), width=2)
                for cu, cw in ((a, c), (a, e), (bb, c), (bb, e)):
                    q = min(r, key=lambda z: (z[0] - cu) ** 2 + (z[1] - cw) ** 2)
                    d.line([X(cu), Y(cw), X(q[0]), Y(q[1])], fill=(255, 120, 40))
            elif p['roof'] == 'lean':
                hi = {'u0': [X(bb), Y(c), X(bb), Y(e)], 'u1': [X(a), Y(c), X(a), Y(e)], 'w0': [X(a), Y(e), X(bb), Y(e)], 'w1': [X(a), Y(c), X(bb), Y(c)]}[p['low']]
                d.line(hi, fill=(255, 200, 40), width=3)
            d.text((X(uc) - 8, Y(wc) - 5), f"{p['eaves']:.0f}/{p['top']:.0f}", fill=(200, 255, 200))
        for cu, cw in f['chimneys']:
            d.ellipse([X(cu) - 4, Y(cw) - 4, X(cu) + 4, Y(cw) + 4], outline=(255, 0, 255), width=2)
        d.text((2, 1), f"#{i} rms {f.get('rms', 'outline')} grown {f.get('grown', 'LIDAR only')}", fill=(255, 255, 255))
        tiles.append(t)
    W = 1800; x = y = rowh = 0; places = []
    for t in tiles:
        if x + t.width > W:
            x = 0; y += rowh + 6; rowh = 0
        places.append((x, y)); x += t.width + 6; rowh = max(rowh, t.height)
    out = Image.new('RGB', (W, y + rowh), (0, 0, 0))
    for t, p in zip(tiles, places):
        out.paste(t, p)
    out.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('json'); ap.add_argument('--dtm', required=True); ap.add_argument('--dsm', required=True)
    ap.add_argument('--dsm-last', required=True); ap.add_argument('--bbox', nargs=4, type=float, required=True)
    ap.add_argument('--intensity', help='National LIDAR Programme intensity tile, for each part\'s roof material')
    ap.add_argument('--qa', help='write a contact sheet PNG: each fit drawn over the LIDAR relief (needs Pillow)')
    ap.add_argument('--survey', help="survey.json: its 'lidarBuildings' (garages and sheds seen on aerial photographs but "
                    "missing from the OS outlines) are measured from the LIDAR alone and added as buildings")
    a = ap.parse_args()
    data = json.load(open(a.json))
    data['osBuildings'] = [b for b in data['osBuildings'] if not b.get('lidarOnly')]
    o = np.array(data['bng']['o']); A = np.array(data['bng']['A'])
    E0, N0, E1, N1 = a.bbox
    dtm = read_float_tiff(a.dtm)
    ndl, ndf, diff, rough = features(dtm, read_float_tiff(a.dsm), read_float_tiff(a.dsm_last))
    H, W = ndl.shape
    inten = None
    if a.intensity:
        probe = read_float_tiff(a.intensity, rows=(0, 1), georef=True)[1]
        r0 = int((probe[1] - N1) / probe[2]); r1 = int((probe[1] - N0) / probe[2]) + 1
        tile, (tE, tN, res) = read_float_tiff(a.intensity, rows=(max(0, r0), r1), georef=True)
        rr, cc = np.mgrid[0:H, 0:W]
        tr = ((tN - (N1 - rr - 0.5)) / res).astype(int); tc = (((E0 + cc + 0.5) - tE) / res).astype(int)
        ok = (tr >= 0) & (tr < tile.shape[0]) & (tc >= 0) & (tc < tile.shape[1])
        inten = np.full((H, W), np.nan, np.float32); inten[ok] = tile[tr[ok], tc[ok]]

    # OS outlines on the raster
    lab = np.full((H, W), -1, int); ens = []
    for i, b in enumerate(data['osBuildings']):
        en = (o[:, None] + A @ np.array(b['pts']).T).T
        ens.append(en)
        m = np.zeros((H, W), bool)
        fill_poly(m, [(E - E0, N1 - N) for E, N in en])
        lab[m & (lab < 0)] = i
    # footprints: OS pixels that are raised, grown through raised hard smooth neighbours (ridges bridged)
    cand = (ndl > 1.8) & (diff < 0.6) & (rough < 0.7)
    cand = erode(dilate(cand, 1)) & (ndl > 1.8)
    own = np.where((lab >= 0) & (ndl > 1.5), lab, -1); dist = np.where(own >= 0, 0, 99)
    q = deque(zip(*np.nonzero(own >= 0)))
    while q:
        r, c = q.popleft()
        if dist[r, c] >= GROW:
            continue
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            rr, cc = r + dr, c + dc
            if 0 <= rr < H and 0 <= cc < W and own[rr, cc] < 0 and lab[rr, cc] < 0 and cand[rr, cc]:
                own[rr, cc] = own[r, c]; dist[rr, cc] = dist[r, c] + 1; q.append((rr, cc))
    # grown pixels only count in solid blobs (>= 10 m2 after an opening), so hedges and cars don't become wings
    added = (own >= 0) & (lab < 0)
    solid = dilate(erode(added), 1) & added
    seen = np.zeros_like(solid)
    keep = np.zeros_like(solid)
    for r, c in zip(*np.nonzero(solid)):
        if seen[r, c]:
            continue
        comp = [(r, c)]; seen[r, c] = True; i = 0
        while i < len(comp):
            y, x = comp[i]; i += 1
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < H and 0 <= xx < W and solid[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True; comp.append((yy, xx))
        if len(comp) >= 10:
            for y, x in comp:
                keep[y, x] = True
    own = np.where(added & ~keep, -1, own)

    n = 0; sheet = []
    for i, b in enumerate(data['osBuildings']):
        b.pop('fit', None)
        S = own == i
        if b.get('h', 0) == 0 and b['areaM2'] >= 40:
            # built since the LIDAR survey: the OS outline in clean parts, two storeys under pitched roofs
            f = outline_fit(ens[i], bearing_of(ens[i]))
        elif S.sum() < 6:
            continue
        else:
            f = fit_turned(S, ndl, ndf, diff, bearing_of(ens[i]), E0, N1, inten)
        if f:
            f['grown'] = int((S & (lab != i)).sum())
            b['fit'] = f; n += 1
            sheet.append((i, f))
    if a.survey:
        free = cand & (own < 0) & (lab < 0)
        free = dilate(erode(free), 1) & free   # cut thin links into hedges
        for s in json.load(open(a.survey)).get('lidarBuildings', []):
            b = lidar_only_building(s, free, (ndl > 1.5) & (own < 0) & (lab < 0), ndl, ndf, diff, inten, E0, N1, o, A)
            if b:
                data['osBuildings'].append(b); n += 1
                sheet.append((len(data['osBuildings']) - 1, b['fit']))
            else:
                print('no LIDAR building at', s['at'], file=sys.stderr)
    if a.qa:
        contact_sheet(sheet, ndl, E0, N1, a.qa)
    json.dump(data, open(a.json, 'w'), separators=(',', ':'))
    fits = [b['fit'] for b in data['osBuildings'] if 'fit' in b]
    print('fitted', n, 'of', len(data['osBuildings']), 'buildings; parts', sum(len(f['parts']) for f in fits),
          'chimneys', sum(len(f['chimneys']) for f in fits), 'median rms', round(float(np.median([f['rms'] for f in fits if 'rms' in f])), 2),
          'from outlines alone', sum(1 for f in fits if f.get('outline')))


if __name__ == '__main__':
    main()
