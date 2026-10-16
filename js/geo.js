// 2D geometry helpers for turning OpenStreetMap shapes into LEGO.
// All coordinates are in studs, x = east, z = south.

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length]; a += x0 * z1 - x1 * z0; }
  return a / 2;
}

export function centroid(pts) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    const f = x0 * z1 - x1 * z0; a += f; cx += (x0 + x1) * f; cz += (z0 + z1) * f;
  }
  if (Math.abs(a) < 1e-6) { // degenerate: plain average
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  }
  return [cx / (3 * a), cz / (3 * a)];
}

export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Calls fn(x, z) for every cell whose centre lies inside the polygon (scanline fill)
export function polyCells(pts, fn) {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) {
    const zc = z + 0.5, xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i], [xj, zj] = pts[j];
      if ((zi > zc) !== (zj > zc)) xs.push(xi + (zc - zi) / (zj - zi) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil(xs[k] - 0.5); x + 0.5 <= xs[k + 1]; x++) fn(x, z);
    }
  }
}

export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
  let t = L2 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx, qz = az + t * dz;
  return { d: Math.hypot(px - qx, pz - qz), t, qx, qz };
}

// Calls fn(x, z, d) for every cell whose centre is within halfW of the polyline
export function lineCells(pts, halfW, fn) {
  const seen = new Set();
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const x0 = Math.floor(Math.min(ax, bx) - halfW - 1), x1 = Math.ceil(Math.max(ax, bx) + halfW + 1);
    const z0 = Math.floor(Math.min(az, bz) - halfW - 1), z1 = Math.ceil(Math.max(az, bz) + halfW + 1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const k = x * 100003 + z; if (seen.has(k)) continue;
      const { d } = segDist(x + 0.5, z + 0.5, ax, az, bx, bz);
      if (d <= halfW) { seen.add(k); fn(x, z, d); }
    }
  }
}

export function distToPolyline(px, pz, pts) {
  let best = { d: Infinity };
  for (let i = 0; i + 1 < pts.length; i++) {
    const r = segDist(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (r.d < best.d) best = { ...r, seg: i };
  }
  return best;
}

export function polylineLength(pts) {
  let s = 0; for (let i = 0; i + 1 < pts.length; i++) s += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return s;
}

// Position + unit direction at arc length s along a polyline (clamped)
export function pointAlong(pts, s) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (s <= L || i === pts.length - 2) {
      const t = L ? Math.max(0, Math.min(1, s / L)) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: L ? (bx - ax) / L : 1, dz: L ? (bz - az) / L : 0 };
    }
    s -= L;
  }
  return { x: pts[0][0], z: pts[0][1], dx: 1, dz: 0 };
}

// Orientation (radians) of the minimum-area bounding rectangle, tested against every edge direction
export function dominantAngle(pts) {
  let best = 0, bestA = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    if (Math.hypot(x1 - x0, z1 - z0) < 0.5) continue;
    const a = Math.atan2(z1 - z0, x1 - x0), c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const A = (u1 - u0) * (v1 - v0);
    if (A < bestA - 1e-6) { bestA = A; best = a; }
  }
  return best;
}

// Join polylines that share end points into longer chains
export function chainPolylines(lines) {
  const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
  let rest = lines.map(l => l.slice());
  const out = [];
  while (rest.length) {
    let cur = rest.shift(), grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < rest.length; i++) {
        const l = rest[i];
        const ce = key(cur[cur.length - 1]), cs = key(cur[0]), ls = key(l[0]), le = key(l[l.length - 1]);
        if (ce === ls) cur = cur.concat(l.slice(1));
        else if (ce === le) cur = cur.concat(l.slice().reverse().slice(1));
        else if (cs === le) cur = l.concat(cur.slice(1));
        else if (cs === ls) cur = l.slice().reverse().concat(cur.slice(1));
        else continue;
        rest.splice(i, 1); grew = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}

// ---------------------------------------------------------------- smooth road surfaces
// Convex polygon prism: top face + sides (no bottom), added to a Builder
export function convexPrism(b, poly, y0, y1, c) {
  const [cx, cz] = centroid(poly);
  b.poly(poly.map(([x, z]) => [x, y1, z]), c, [cx, y0 - 1, cz]);
  const mid = [cx, (y0 + y1) / 2, cz];
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length];
    b.poly([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], c, mid);
  }
}

function disc(x, z, r, n = 14) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
  return out;
}

// A road/pavement ribbon following a polyline: one quad per segment plus round joints
export function ribbon(b, pts, halfW, y0, y1, c) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue;
    const nx = -(bz - az) / L * halfW, nz = (bx - ax) / L * halfW;
    convexPrism(b, [[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], y0, y1, c);
  }
  for (const [x, z] of pts) convexPrism(b, disc(x, z, halfW), y0, y1, c);
}

// Dashed centre line
export function dashes(b, pts, len, gap, halfW, y, c) {
  const total = polylineLength(pts);
  for (let s = gap / 2; s + len < total; s += len + gap) {
    const p = pointAlong(pts, s), q = pointAlong(pts, s + len);
    const nx = -p.dz * halfW, nz = p.dx * halfW;
    b.poly([[p.x + nx, y, p.z + nz], [q.x + nx, y, q.z + nz], [q.x - nx, y, q.z - nz], [p.x - nx, y, p.z - nz]], c, [p.x, y - 1, p.z]);
  }
}

// ---------------------------------------------------------------- terrain-following versions
export function densify(pts, maxLen) {
  const out = [pts[0]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxLen));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
  }
  return out;
}

// Prism whose top vertices each have their own height (sloped), sides reaching `depth` below
function slopedPrism(b, poly3, depth, c) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of poly3) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= poly3.length; cy /= poly3.length; cz /= poly3.length;
  b.poly(poly3, c, [cx, cy - depth * 4, cz]);
  const mid = [cx, cy - depth / 2, cz];
  for (let i = 0; i < poly3.length; i++) {
    const p = poly3[i], q = poly3[(i + 1) % poly3.length];
    b.poly([[p[0], p[1] - depth, p[2]], [q[0], q[1] - depth, q[2]], q, p], c, mid);
  }
}

// Road/pavement ribbon draped over terrain: every vertex sits at the ground height yAt(x, z) plus top, so the surface
// follows slopes both along and across the road (a level slab across a sloping road would dig into the ground on one
// side and stand proud of a crossing road on the other). The strip is offset from the centre line with mitred corners,
// so it runs on without gaps round bends. With inner > 0 only side strips from inner to halfW are drawn (pavements),
// on the sides listed: 'left' and 'right' of the polyline's direction.
export function ribbonY(b, pts, halfW, yAt, top, c, depth = 1.2, inner = 0, sides = ['left', 'right']) {
  const P = densify(pts, 3).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-3);
  if (P.length < 2) return;
  const Y = (x, z) => yAt(x, z) + top;
  // unit normal of each segment, pointing right of the direction of travel (x east, z south)
  const segN = [];
  for (let i = 0; i + 1 < P.length; i++) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], L = Math.hypot(dx, dz); segN.push([-dz / L, dx / L]); }
  // mitred offset direction at each point (scaled so the strip keeps its width round a bend)
  const N = P.map((_, i) => {
    const a = segN[Math.max(0, i - 1)], b2 = segN[Math.min(segN.length - 1, i)];
    let nx = a[0] + b2[0], nz = a[1] + b2[1]; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const k = 1 / Math.max(0.35, nx * b2[0] + nz * b2[1]);
    return [nx * k, nz * k];
  });
  const bands = inner > 0 ? sides.map(s => (s === 'right' ? [inner, halfW] : [-halfW, -inner])) : [[-halfW, halfW]];
  for (let i = 0; i + 1 < P.length; i++) {
    for (const [w0, w1] of bands) {
      const at = (j, w) => [P[j][0] + N[j][0] * w, P[j][1] + N[j][1] * w];
      const q = [at(i, w1), at(i + 1, w1), at(i + 1, w0), at(i, w0)];
      slopedPrism(b, q.map(([x, z]) => [x, Y(x, z), z]), depth, c);
    }
  }
  if (inner > 0) return;
  // carriageways: round joints where the polyline bends or meets another road, also draped (fanned from the centre)
  for (const [x, z] of pts) {
    const ring = disc(x, z, halfW).map(([px, pz]) => [px, Y(px, pz) - 0.004, pz]), ctr = [x, Y(x, z) - 0.004, z];
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k], q = ring[(k + 1) % ring.length];
      b.poly([ctr, p, q], c, [x, ctr[1] - depth * 4, z]);
      b.poly([[p[0], p[1] - depth, p[2]], [q[0], q[1] - depth, q[2]], q, p], c, [x, ctr[1] - depth / 2, z]);
    }
  }
}

export function dashesY(b, pts, len, gap, halfW, yAt, top, c) {
  const total = polylineLength(pts);
  for (let s = gap / 2; s + len < total; s += len + gap) {
    const p = pointAlong(pts, s), q = pointAlong(pts, s + len);
    const nx = -p.dz * halfW, nz = p.dx * halfW;
    const yp = yAt(p.x, p.z) + top, yq = yAt(q.x, q.z) + top;
    b.poly([[p.x + nx, yp, p.z + nz], [q.x + nx, yq, q.z + nz], [q.x - nx, yq, q.z - nz], [p.x - nx, yp, p.z - nz]], c, [p.x, yp - 1, p.z]);
  }
}
