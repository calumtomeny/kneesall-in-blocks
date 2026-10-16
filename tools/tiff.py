"""Minimal reader for single-band float32 GeoTIFFs: uncompressed (as served by the EA LIDAR WCS) or LZW
(as in the EA National LIDAR Programme tile downloads)."""
import struct

import numpy as np


def _tags(b):
    E = '>' if b[:2] == b'MM' else '<'
    off = struct.unpack(E + 'I', b[4:8])[0]
    n = struct.unpack(E + 'H', b[off:off + 2])[0]
    tags = {}
    for i in range(n):
        e = b[off + 2 + i * 12: off + 14 + i * 12]
        t, ty, c = struct.unpack(E + 'HHI', e[:8])
        size = {3: 2, 4: 4, 5: 8, 12: 8, 2: 1}.get(ty, 4) * c
        raw = e[8:12] if size <= 4 else b[struct.unpack(E + 'I', e[8:12])[0]:][:size]
        fmt = {3: 'H', 4: 'I', 12: 'd'}.get(ty)
        tags[t] = struct.unpack(E + fmt * c, raw[:size]) if fmt else raw
    return E, tags


def _lzw(data):
    """TIFF LZW (MSB-first codes, early change)."""
    out, n = bytearray(), len(data)
    table = [bytes([i]) for i in range(256)] + [b'', b'']
    bits, pos, prev = 9, 0, None
    while pos + bits <= n * 8:
        i = pos >> 3
        chunk = (data[i] << 16) | ((data[i + 1] << 8) if i + 1 < n else 0) | (data[i + 2] if i + 2 < n else 0)
        code = (chunk >> (24 - (pos & 7) - bits)) & ((1 << bits) - 1)
        pos += bits
        if code == 256:
            table, bits, prev = table[:258], 9, None
            continue
        if code == 257:
            break
        if prev is None:
            entry = table[code]
        else:
            entry = table[code] if code < len(table) else prev + prev[:1]
            table.append(prev + entry[:1])
        out += entry
        prev = entry
        if len(table) + 1 >= (1 << bits) and bits < 12:
            bits += 1
    return bytes(out)


def read_float_tiff(path, rows=None, georef=False):
    """Float32 raster with no-data as NaN. rows=(r0, r1) decodes only those rows (strip-organised files).
    georef=True also returns (E of left edge, N of top edge, pixel size) from the GeoTIFF tags."""
    b = open(path, 'rb').read()
    E, tags = _tags(b)
    comp = tags.get(259, (1,))[0]
    if comp not in (1, 5) or tags.get(339, (3,))[0] != 3 or tags.get(317, (1,))[0] != 1:
        raise ValueError('only float32 TIFFs, uncompressed or LZW without predictor, are supported')
    unpack = (lambda o, k: b[o:o + k]) if comp == 1 else (lambda o, k: _lzw(b[o:o + k]))
    W, H = tags[256][0], tags[257][0]
    out = np.full((H, W), np.nan, dtype=np.float32)
    if 322 in tags:  # tiled
        tw, th = tags[322][0], tags[323][0]
        across = (W + tw - 1) // tw
        for k, o in enumerate(tags[324]):
            ty_, tx_ = divmod(k, across)
            y0, x0 = ty_ * th, tx_ * tw
            if rows and (y0 + th <= rows[0] or y0 >= rows[1]):
                continue
            tile = np.frombuffer(unpack(o, tags[325][k]), dtype=E + 'f4')[:tw * th].reshape(th, tw)
            h, w = min(th, H - y0), min(tw, W - x0)
            out[y0:y0 + h, x0:x0 + w] = tile[:h, :w]
    else:  # stripped
        per = tags.get(278, (H,))[0]
        for k, o in enumerate(tags[273]):
            y0 = k * per; h = min(per, H - y0)
            if rows and (y0 + h <= rows[0] or y0 >= rows[1]):
                continue
            out[y0:y0 + h] = np.frombuffer(unpack(o, tags[279][k]), dtype=E + 'f4')[:W * h].reshape(h, W)
    out[(out < -1000) | (out > 10000)] = np.nan
    if not georef:
        return out
    tie, scale = tags.get(33922), tags.get(33550)
    return out, (tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1], scale[0]) if tie and scale else None
