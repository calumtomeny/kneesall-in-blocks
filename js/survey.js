// Hand-surveyed buildings from data/survey.json. Each is a set of measured rectangles (British National Grid
// metres) with gable, lean-to or hipped roofs. They are rasterised into a roof layer per stud, exactly like a
// LIDAR roof plan, and built with lidarBuilding, so they match the rest of the village but have crisp outlines.
import { World, PAL } from './bricks.js';
import { Placed, lidarBuilding, MATERIALS, materialFor } from './buildings.js';
import { layersFor } from './roofs.js';

const SIDES = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };   // survey sides -> local stud directions

// (u, w) metres in a survey frame -> world studs
function framer(bng, frame) {
  const { o, A } = bng;   // [E, N] = o + A [x, z]
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const toStud = (E, N) => { const e = E - o[0], n = N - o[1]; return [(A[1][1] * e - A[0][1] * n) / det, (-A[1][0] * e + A[0][0] * n) / det]; };
  const b = frame.bearing * Math.PI / 180;
  const ue = [Math.sin(b), Math.cos(b)], we = [-Math.cos(b), Math.sin(b)];
  return (u, w) => toStud(frame.E + u * ue[0] + w * we[0], frame.N + u * ue[1] + w * we[1]);
}

export function surveyedBuildings(survey, bng) {
  return (survey.buildings ?? []).map(s => {
    const P = partsBuilding(framer(bng, s.frame), s.parts, {
      wall: MATERIALS[s.wall] ?? MATERIALS.redBrick, roof: MATERIALS[s.roof] ?? MATERIALS.slate, label: s.label,
      windows: s.windows, doorDir: SIDES[s.door] ?? SIDES.n, chimneys: s.chimneys ?? [], frontWindows: s.frontWindows, doorAt: s.doorAt,
      solar: s.solar, canopy: s.porch, frame: PAL[s.frame], door: PAL[s.doorColour],
    });
    if (P) P.survey = s.name;
    return P;
  }).filter(Boolean);
}

// A building measured by tools/fit_buildings.py, styled like any other (o), with its door towards `front`.
// o.chimneyAlong (fractions along the main ridge, left to right as seen from the front) replaces measured chimneys.
export function fittedBuilding(fit, bng, o, front) {
  const chimneys = o.chimneyAlong ? alongRidge(fit, o.chimneyAlong, front) : o.chimneys === 0 ? [] : fit.chimneys;
  const parts = o.gablets ? [...fit.parts, ...gablets(fit, o.gablets, front)] : fit.parts;
  return partsBuilding(framer(bng, fit.frame), parts, { ...o, chimneys, front });
}

// Small gables rising from the front eaves of the main roof (survey.json details "gablets": fractions along the
// front, left to right as seen from it), each 2.6 m wide with its own little ridge running back into the main roof
function gablets(fit, fs, front) {
  const area = (p) => (p.u[1] - p.u[0]) * (p.w[1] - p.w[0]);
  const main = fit.parts.reduce((a, b) => (area(b) > area(a) ? b : a));
  if (main.roof !== 'gable') return [];
  const b = fit.frame.bearing * Math.PI / 180, U = [Math.sin(b), -Math.cos(b)], Wv = [-Math.cos(b), -Math.sin(b)];
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
  const face = [['u1', dot(U, front)], ['u0', -dot(U, front)], ['w1', dot(Wv, front)], ['w0', -dot(Wv, front)]].sort((p, q) => q[1] - p[1])[0][0];
  const A = main.along, C = A === 'u' ? 'w' : 'u';
  if (face[0] !== C) return [];   // the front is a gable end, not an eaves side
  const ltr = dot(A === 'u' ? U : Wv, [front[1], -front[0]]) >= 0;
  const [a0, a1] = main[A], out = face[1] === '1' ? main[C][1] : main[C][0], depth = Math.min(3, (main[C][1] - main[C][0]) / 2 - 0.5);
  return fs.map(f => {
    const t = ltr ? a0 + f * (a1 - a0) : a1 - f * (a1 - a0);
    const back = face[1] === '1' ? [out - depth, out] : [out, out + depth];
    return { [A]: [t - 1.3, t + 1.3], [C]: back, roof: 'gable', along: C, eaves: main.eaves, top: main.eaves + 1.2 };
  });
}

// Points on the main ridge at fractions f (0 = left end as seen by someone facing the front) -> [[u, w]]
function alongRidge(fit, fs, front) {
  const area = (p) => (p.u[1] - p.u[0]) * (p.w[1] - p.w[0]);
  const main = fit.parts.reduce((a, b) => (area(b) > area(a) ? b : a));
  const A = main.roof === 'gable' ? main.along : (main.u[1] - main.u[0] >= main.w[1] - main.w[0] ? 'u' : 'w'), C = A === 'u' ? 'w' : 'u';
  const c = (main[C][0] + main[C][1]) / 2;
  // the run of parts the ridge passes through
  const row = fit.parts.filter(p => p[C][0] <= c && c <= p[C][1]);
  const a0 = Math.min(...row.map(p => p[A][0])), a1 = Math.max(...row.map(p => p[A][1]));
  // world direction of +A (frame bearing, x east / z south) against the viewer's right hand
  const b = (fit.frame.bearing - (A === 'w' ? 90 : 0)) * Math.PI / 180;
  const dir = [Math.sin(b), -Math.cos(b)], right = [front[1], -front[0]];
  const ltr = dir[0] * right[0] + dir[1] * right[1] >= 0;
  return fs.map(f => { const t = ltr ? a0 + f * (a1 - a0) : a1 - f * (a1 - a0); return A === 'u' ? [t, c] : [c, t]; });
}

// Surfaced areas (yards, drives): [{ surface, poly }] in world studs
export function surveyGrounds(survey, bng) {
  return (survey.grounds ?? []).map(g => { const at = framer(bng, g.frame); return { surface: g.surface, poly: g.poly.map(([u, w]) => at(u, w)) }; });
}

// Mapped roads to resurface: [{ x, z, surface }], applied to the road passing nearest the point
export function surveyRoads(survey, bng) {
  return (survey.roads ?? []).filter(r => r.frame).map(r => { const [x, z] = framer(bng, r.frame)(...r.at); return { x, z, surface: r.surface }; });
}

// parts: rectangles in metres in the frame `at`; o: lidarBuilding options plus chimneys [[u, w]] and either
// doorDir (local) or front (world direction the door should face)
function partsBuilding(at, parts0, o) {
  // local frame: x along u, z along -w (so local -z, the usual front, is +w); studs per metre from the grid transform
  const [x0, z0] = at(0, 0), [x1, z1] = at(1, 0);
  const k = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0);
  const parts = parts0.map(p => ({ ...p, x: [p.u[0] * k, p.u[1] * k], z: [-p.w[1] * k, -p.w[0] * k] }));
  const mx = Math.floor(Math.min(...parts.map(p => p.x[0]))), mz = Math.floor(Math.min(...parts.map(p => p.z[0])));
  for (const p of parts) { p.x = p.x.map(v => v - mx); p.z = p.z.map(v => v - mz); }

  // roof layer of every stud: each part rises one brick per stud in from its eaves, up to its ridge height.
  // The roof material is the part's own where it has one (named, or measured intensity), else the building's.
  const top = new Map(), roofCol = new Map(), wallCol = new Map();
  const slopeOf = new Map();   // stud -> { down: local downhill direction, d: studs up from the eaves, ridge }
  for (const p of parts) {
    const span = Math.min(p.u[1] - p.u[0], p.w[1] - p.w[0]) / (p.roof === 'lean' ? 1 : 2);
    const mat = p.mat ?? (p.roofI !== undefined && !o.fixedRoof
      ? materialFor(p.roofI, p.roof === 'flat' ? 0 : (p.top - p.eaves) / Math.max(0.5, span), (p.u[1] - p.u[0]) * (p.w[1] - p.w[0])) : null);
    const pc = mat ? MATERIALS[mat] : o.roof, wc = p.wall ? MATERIALS[p.wall] : o.wall;
    const eaves = layersFor(p.eaves), ridge = Math.max(eaves, layersFor(p.top));
    for (let z = Math.ceil(p.z[0] - 0.5); z + 0.5 <= p.z[1]; z++) for (let x = Math.ceil(p.x[0] - 0.5); x + 0.5 <= p.x[1]; x++) {
      const dx0 = x + 0.5 - p.x[0], dx1 = p.x[1] - x - 0.5, dz0 = z + 0.5 - p.z[0], dz1 = p.z[1] - z - 0.5;
      const d = p.roof === 'flat' ? 0 : p.roof === 'hip' ? Math.min(dx0, dx1, dz0, dz1)
        : p.roof === 'lean' ? { u0: dx0, u1: dx1, w0: dz1, w1: dz0 }[p.low]
        : p.along === 'u' ? Math.min(dz0, dz1) : Math.min(dx0, dx1);
      const t = Math.min(ridge, eaves + Math.floor(d));
      const key = x + ',' + z;
      if (!(top.get(key) >= t)) {
        top.set(key, t); roofCol.set(key, pc); wallCol.set(key, wc);
        const sides = p.roof === 'hip' ? [[-1, 0, dx0], [1, 0, dx1], [0, -1, dz0], [0, 1, dz1]]
          : p.along === 'u' ? [[0, -1, dz0], [0, 1, dz1]] : [[-1, 0, dx0], [1, 0, dx1]];
        const down = p.roof === 'flat' ? null : p.roof === 'lean' ? { u0: [-1, 0], u1: [1, 0], w0: [0, 1], w1: [0, -1] }[p.low]
          : sides.sort((a, b) => a[2] - b[2])[0].slice(0, 2);
        slopeOf.set(key, { down, d: t - eaves, ridge: t >= ridge });
      }
    }
  }
  // solar panels (survey.json details "solar"): the studs of the roof slopes facing solar.face (compass degrees),
  // between the eaves row and the ridge, over solar.span (fractions left to right, seen from that side)
  if (o.solar) {
    const compass = ([lx, lz]) => (Math.atan2(lx * Math.cos(a) - lz * Math.sin(a), -(lx * Math.sin(a) + lz * Math.cos(a))) * 180 / Math.PI + 360) % 360;
    const f = typeof o.solar.face === 'number' ? o.solar.face : { n: 0, e: 90, s: 180, w: 270 }[o.solar.face], [s0, s1] = o.solar.span ?? [0, 1];
    const on = [...slopeOf].filter(([, s]) => s.down && s.d >= 1 && !s.ridge && Math.abs(((compass(s.down) - f + 540) % 360) - 180) < 45);
    // the viewer faces f + 180, so their right hand is f - 90: position along that, in local studs
    const r = (f - 90) * Math.PI / 180, rx = Math.sin(r), rz = -Math.cos(r);
    const lr = ([k]) => { const [x, z] = k.split(',').map(Number); return (x + 0.5) * (rx * Math.cos(a) + rz * Math.sin(a)) + (z + 0.5) * (-rx * Math.sin(a) + rz * Math.cos(a)); };
    const ps = on.map(lr), lo = Math.min(...ps), hi = Math.max(...ps);
    on.forEach((c, i) => { const t = (ps[i] - lo) / Math.max(1, hi - lo); if (t >= s0 && t <= s1) roofCol.set(c[0], MATERIALS.solar); });
  }
  if (top.size < 4) return null;
  const cells = new Set(top.keys());

  const W = new World();
  const [ox, oz] = at(mx / k, -mz / k);
  const P = new Placed(W, ox, oz, a);
  const { chimneys, front, ...opts } = o;
  // 2x2 stacks centred on each chimney (lidarBuilding nudges them inside the walls)
  const chimneyAt = (chimneys ?? []).map(([u, w]) => [Math.round(u * k - mx - 1), Math.round(-w * k - mz - 1)]);
  let doorDir = opts.doorDir;
  if (!doorDir && front) {
    const fx = front[0] * Math.cos(a) + front[1] * Math.sin(a), fz = -front[0] * Math.sin(a) + front[1] * Math.cos(a);
    doorDir = Math.abs(fx) > Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
  }
  lidarBuilding(W, { cells, top, roofCol, wallCol }, { ...opts, chimney: opts.chimney ?? opts.wall, doorDir, chimneyAt });
  P.poly = outline(cells).map(([x, z]) => P.toWorld(x, z));
  // the commonest roof colour stands for the building on the map
  const tally = new Map(); for (const c of roofCol.values()) tally.set(c, (tally.get(c) ?? 0) + 1);
  P.roofCol = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? opts.roof; P.label = opts.label;
  return P;
}

// Outer boundary of a set of "x,z" cells as a polygon of cell corners (local studs), collinear points removed
function outline(cells) {
  const has = (x, z) => cells.has(x + ',' + z), next = new Map();
  for (const c of cells) {
    const [x, z] = c.split(',').map(Number);
    if (!has(x, z - 1)) next.set(x + ',' + z, [x + 1, z]);
    if (!has(x + 1, z)) next.set((x + 1) + ',' + z, [x + 1, z + 1]);
    if (!has(x, z + 1)) next.set((x + 1) + ',' + (z + 1), [x, z + 1]);
    if (!has(x - 1, z)) next.set(x + ',' + (z + 1), [x, z]);
  }
  // start from the top-left corner, which is always on the outer boundary
  const start = [...next.keys()].map(k => k.split(',').map(Number)).sort((p, q) => p[1] - q[1] || p[0] - q[0])[0];
  const ring = [start];
  for (let p = next.get(start.join(',')); p && p.join(',') !== start.join(',') && ring.length < 4 * cells.size; p = next.get(p.join(','))) ring.push(p);
  return ring.filter((p, i) => {
    const q = ring[(i + ring.length - 1) % ring.length], r = ring[(i + 1) % ring.length];
    return (p[0] - q[0]) * (r[1] - p[1]) !== (p[1] - q[1]) * (r[0] - p[0]);
  });
}
