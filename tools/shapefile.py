"""Minimal ESRI shapefile reader: polygons (type 5) within a bounding box, plus their DBF attributes."""
import struct


def _dbf(path):
    f = open(path, 'rb')
    head = f.read(32)
    n, hlen, rlen = struct.unpack('<IHH', head[4:12])
    fields = []
    while True:
        d = f.read(32)
        if d[0] == 0x0D:
            break
        fields.append((d[:11].split(b'\0')[0].decode(), d[16]))
    return f, n, hlen, rlen, fields


def read_polygons(base, bbox):
    """Yield (attrs, rings) for polygons whose bbox intersects bbox=(xmin, ymin, xmax, ymax)."""
    xmin, ymin, xmax, ymax = bbox
    shx = open(base + '.shx', 'rb').read()
    shp = open(base + '.shp', 'rb')
    dbf, n, hlen, rlen, fields = _dbf(base + '.dbf')
    count = (len(shx) - 100) // 8
    for i in range(count):
        off = struct.unpack('>I', shx[100 + i * 8: 104 + i * 8])[0] * 2
        shp.seek(off + 8)
        head = shp.read(36)
        stype = struct.unpack('<i', head[:4])[0]
        if stype not in (5, 15, 25):
            continue
        bx0, by0, bx1, by1 = struct.unpack('<4d', head[4:36])
        if bx1 < xmin or bx0 > xmax or by1 < ymin or by0 > ymax:
            continue
        nparts, npts = struct.unpack('<2i', shp.read(8))
        parts = list(struct.unpack('<%di' % nparts, shp.read(4 * nparts)))
        pts = struct.unpack('<%dd' % (2 * npts), shp.read(16 * npts))
        rings = []
        for k, p in enumerate(parts):
            e = parts[k + 1] if k + 1 < nparts else npts
            rings.append([(pts[2 * j], pts[2 * j + 1]) for j in range(p, e)])
        dbf.seek(hlen + i * rlen + 1)
        rec = dbf.read(rlen - 1)
        attrs, pos = {}, 0
        for name, size in fields:
            attrs[name] = rec[pos:pos + size].decode('latin-1').strip()
            pos += size
        yield attrs, rings
