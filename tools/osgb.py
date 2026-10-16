"""WGS84 <-> Ordnance Survey National Grid (OSGB36 / EPSG:27700) conversion.

Uses the standard OS formulas (Transverse Mercator on the Airy 1830 ellipsoid) with a
7-parameter Helmert datum shift, accurate to a few metres, which is well under one LEGO stud.
"""
import math

AIRY = (6377563.396, 6356256.909)
WGS84 = (6378137.000, 6356752.3142)
F0, LAT0, LON0, E0, N0 = 0.9996012717, math.radians(49), math.radians(-2), 400000, -100000
# WGS84 -> OSGB36 Helmert parameters
TX, TY, TZ, S, RX, RY, RZ = -446.448, 125.157, -542.060, 20.4894e-6, -0.1502, -0.2470, -0.8421


def _to_cart(lat, lon, ell):
    a, b = ell
    e2 = 1 - b * b / (a * a)
    nu = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    return (nu * math.cos(lat) * math.cos(lon), nu * math.cos(lat) * math.sin(lon), (1 - e2) * nu * math.sin(lat))


def _from_cart(x, y, z, ell):
    a, b = ell
    e2 = 1 - b * b / (a * a)
    p = math.hypot(x, y)
    lat = math.atan2(z, p * (1 - e2))
    for _ in range(10):
        nu = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
        lat = math.atan2(z + e2 * nu * math.sin(lat), p)
    return lat, math.atan2(y, x)


def _helmert(x, y, z, sign):
    sec = math.pi / (180 * 3600)
    rx, ry, rz, s = sign * RX * sec, sign * RY * sec, sign * RZ * sec, sign * S
    return (sign * TX + (1 + s) * x - rz * y + ry * z,
            sign * TY + rz * x + (1 + s) * y - rx * z,
            sign * TZ - ry * x + rx * y + (1 + s) * z)


def _meridional(phi, a, b):
    n = (a - b) / (a + b)
    return b * F0 * ((1 + n + 5 / 4 * n ** 2 + 5 / 4 * n ** 3) * (phi - LAT0)
                     - (3 * n + 3 * n ** 2 + 21 / 8 * n ** 3) * math.sin(phi - LAT0) * math.cos(phi + LAT0)
                     + (15 / 8 * n ** 2 + 15 / 8 * n ** 3) * math.sin(2 * (phi - LAT0)) * math.cos(2 * (phi + LAT0))
                     - 35 / 24 * n ** 3 * math.sin(3 * (phi - LAT0)) * math.cos(3 * (phi + LAT0)))


def wgs84_to_osgb(lat_deg, lon_deg):
    x, y, z = _helmert(*_to_cart(math.radians(lat_deg), math.radians(lon_deg), WGS84), 1)
    phi, lam = _from_cart(x, y, z, AIRY)
    a, b = AIRY
    e2 = 1 - b * b / (a * a)
    s, c, t = math.sin(phi), math.cos(phi), math.tan(phi)
    nu = a * F0 / math.sqrt(1 - e2 * s * s)
    rho = a * F0 * (1 - e2) / (1 - e2 * s * s) ** 1.5
    eta2 = nu / rho - 1
    M = _meridional(phi, a, b)
    I, II = M + N0, nu / 2 * s * c
    III = nu / 24 * s * c ** 3 * (5 - t * t + 9 * eta2)
    IIIA = nu / 720 * s * c ** 5 * (61 - 58 * t * t + t ** 4)
    IV, V = nu * c, nu / 6 * c ** 3 * (nu / rho - t * t)
    VI = nu / 120 * c ** 5 * (5 - 18 * t * t + t ** 4 + 14 * eta2 - 58 * t * t * eta2)
    d = lam - LON0
    return E0 + IV * d + V * d ** 3 + VI * d ** 5, I + II * d ** 2 + III * d ** 4 + IIIA * d ** 6


def osgb_to_wgs84(E, N):
    a, b = AIRY
    e2 = 1 - b * b / (a * a)
    phi, M = LAT0, 0
    while True:
        phi = (N - N0 - M) / (a * F0) + phi
        M = _meridional(phi, a, b)
        if abs(N - N0 - M) < 1e-5:
            break
    s, c, t = math.sin(phi), math.cos(phi), math.tan(phi)
    nu = a * F0 / math.sqrt(1 - e2 * s * s)
    rho = a * F0 * (1 - e2) / (1 - e2 * s * s) ** 1.5
    eta2 = nu / rho - 1
    VII = t / (2 * rho * nu)
    VIII = t / (24 * rho * nu ** 3) * (5 + 3 * t * t + eta2 - 9 * t * t * eta2)
    IX = t / (720 * rho * nu ** 5) * (61 + 90 * t * t + 45 * t ** 4)
    X = 1 / (c * nu)
    XI = 1 / (c * 6 * nu ** 3) * (nu / rho + 2 * t * t)
    XII = 1 / (c * 120 * nu ** 5) * (5 + 28 * t * t + 24 * t ** 4)
    XIIA = 1 / (c * 5040 * nu ** 7) * (61 + 662 * t * t + 1320 * t ** 4 + 720 * t ** 6)
    dE = E - E0
    lat = phi - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6
    lon = LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7
    x, y, z = _helmert(*_to_cart(lat, lon, AIRY), -1)
    lat, lon = _from_cart(x, y, z, WGS84)
    return math.degrees(lat), math.degrees(lon)


if __name__ == '__main__':
    # OS's worked example: Caister water tower, OSGB36 lat/lon 52°39'27.2531"N 1°43'4.5177"E -> E 651409.903, N 313177.270
    e, n = wgs84_to_osgb(53.1708, -0.9486)
    print('Kneesall centre', round(e, 1), round(n, 1), '->', osgb_to_wgs84(e, n))
