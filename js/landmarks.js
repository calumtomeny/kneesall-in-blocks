// Landmark builds: St Bartholomew's Church, war memorial, headstones.
import * as THREE from 'three';
import { PAL, BRICK, F_TILE, F_HIDDEN, F_NOCOLLIDE, col } from './bricks.js';
import { R, house, windowIn, doorIn, bench } from './parts.js';
import { layersFor } from './roofs.js';

export function stone() { const r = R(); return r < 0.72 ? PAL.lbg : r < 0.9 ? PAL.tan : PAL.darkTan; }

// St Bartholomew's as the LIDAR measures it (survey.json "church"): the west tower, the nave with its clerestory under a
// low-pitched roof, lean-to aisles either side, the chancel and the south porch. `p` gives each part's cells (inclusive
// x along the church to the east, z across it to the south) and its eaves and top in metres.
export function churchBuilding(W, p) {
  const { tower: T, nave: N, northAisle: NA, southAisle: SA, chancel: C, porch: PO } = p;
  const L = layersFor, key = (x, z) => x + ',' + z;
  const mid = (q) => Math.floor((q.z[0] + q.z[1]) / 2);
  // roof layer of every cell, and the side its slope falls to (null: a flat tile)
  const top = new Map(), fall = new Map();
  // a low roof: a brick higher every stud in from the eaves on the sides `falls`, up to its top, then flat
  const roof = (q, falls) => {
    const eaves = L(q.eaves ?? q.top), t = Math.max(eaves + 1, L(q.top));
    for (let z = q.z[0]; z <= q.z[1]; z++) for (let x = q.x[0]; x <= q.x[1]; x++) {
      if (top.has(key(x, z))) continue;
      const edge = { n: z - q.z[0], s: q.z[1] - z, w: x - q.x[0], e: q.x[1] - x };
      const [side, d] = falls.length ? falls.map(f => [f, edge[f]]).sort((a, b) => a[1] - b[1])[0] : [null, Infinity];
      top.set(key(x, z), Math.min(t - 1, eaves + d));
      fall.set(key(x, z), d < t - eaves ? side : null);
    }
  };
  // the tower first, so the parts against it stop at its wall
  const TT = L(T.top);   // parapet on top of the last layer
  for (let z = T.z[0]; z <= T.z[1]; z++) for (let x = T.x[0]; x <= T.x[1]; x++) top.set(key(x, z), TT - 2);
  roof(N, ['n', 's']); roof(C, ['n', 's']);
  // the aisles run beside the nave only
  for (const A of [NA, SA]) roof({ ...A, x: [Math.max(A.x[0], N.x[0]), Math.min(A.x[1], N.x[1])] }, [A === NA ? 'n' : 's']);
  if (p.boilerHouse) roof(p.boilerHouse, []);

  // walls: a cell on the outside is wall from the ground to its roof; one inside stands up only where it is clear of a
  // lower neighbour (the clerestory above the aisles, the nave's east gable above the chancel)
  const N4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  const slopes = new Map();
  for (const [k, t] of top) {
    const [x, z] = k.split(',').map(Number), inT = x >= T.x[0] && x <= T.x[1] && z >= T.z[0] && z <= T.z[1];
    const ns = N4.map(([dx, dz]) => top.get(key(x + dx, z + dz)));
    const y0 = ns.some(v => v === undefined) ? 0 : Math.min(...ns) + 1;
    for (let y = y0; y < t; y++) W.set(x, y, z, inT && (y === 0 || y === 11 || y === 22) ? PAL.dbg : stone());
    if (y0 > 0 || inT) W.set(x, 0, z, PAL.tan, F_TILE | F_NOCOLLIDE);
    if (inT) {
      // the tower's panelled parapet round a flat lead roof
      if (ns.some(v => v === undefined || v < t)) { W.set(x, t, z, stone()); W.set(x, t + 1, z, PAL.lbg); } else W.set(x, t, z, PAL.dbg, F_TILE);
      continue;
    }
    const f = fall.get(k);
    if (!f) { W.set(x, t, z, PAL.dbg, F_TILE); continue; }
    const sk = (f === 'n' || f === 's' ? 'x|' + z : 'z|' + x) + '|' + t + '|' + (f === 's' || f === 'e' ? 1 : -1);
    if (!slopes.has(sk)) slopes.set(sk, []);
    slopes.get(sk).push(f === 'n' || f === 's' ? x : z);
  }
  for (const [sk, ls] of slopes) {
    const [axis, u, y, dir] = sk.split('|');
    ls.sort((a, b) => a - b);
    for (let i = 0, s0 = ls[0]; i < ls.length; i++) if (i === ls.length - 1 || ls[i + 1] !== ls[i] + 1) { W.slope(axis, +u, s0, ls[i], +y, +dir, PAL.dbg); s0 = ls[i + 1]; }
  }

  // tower: buttresses at the corners, west door and window, the clock (on the west face, Southwell & Nottingham Church
  // History Project), belfry louvres on every face and a pinnacle on each corner
  const tz = mid(T), tx = Math.floor((T.x[0] + T.x[1]) / 2);
  for (const [x, z] of [[T.x[0] - 1, T.z[0]], [T.x[0], T.z[0] - 1], [T.x[1] + 1, T.z[0]], [T.x[1], T.z[0] - 1], [T.x[0] - 1, T.z[1]], [T.x[0], T.z[1] + 1], [T.x[1] + 1, T.z[1]], [T.x[1], T.z[1] + 1]])
    if (!top.has(key(x, z))) for (let y = 0; y < 18 - Math.abs((x + z) % 3); y++) W.set(x, y, z, stone());
  doorIn(W, 'z', T.x[0], tz - 1, 2, 6, { color: PAL.reddishBrown, frame: PAL.dbg, outward: -1 });
  churchWindow(W, 'z', T.x[0], tz - 2, 4, 9, 5);
  W.clocks = [{ x: T.x[0], y: 18.5 * BRICK, z: (T.z[0] + T.z[1] + 1) / 2, face: 'w' }];
  for (const [axis, fixed, a0] of [['x', T.z[0], tx - 1], ['x', T.z[1], tx - 1], ['z', T.x[0], tz - 1], ['z', T.x[1], tz - 1]]) louvre(W, axis, fixed, a0, 3, TT - 9, 4);
  W.extras.push(({ at }) => {
    for (const [x, z] of [[T.x[0], T.z[0]], [T.x[1], T.z[0]], [T.x[0], T.z[1]], [T.x[1], T.z[1]]]) {
      const b = at(x, z), y = TT * BRICK;
      b.geom(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 12), new THREE.Matrix4().makeTranslation(x + 0.5, y + 0.8, z + 0.5), col(PAL.lbg));
      b.geom(new THREE.ConeGeometry(0.5, 2.6, 12), new THREE.Matrix4().makeTranslation(x + 0.5, y + 2.9, z + 0.5), col(PAL.lbg));
    }
  });

  // the doors and windows the listing (Historic England 1156936) describes, spread evenly along their walls
  const spread = (a0, a1, n, w) => Array.from({ length: n }, (_, i) => Math.round(a0 + (i + 0.5) * (a1 - a0 + 1) / n - w / 2));
  const ax1 = (A) => Math.min(A.x[1], N.x[1]), ax0 = (A) => Math.max(A.x[0], N.x[0]);
  // nave: three double lancets in the clerestory on each side, above the aisle roofs
  const clere = Math.max(top.get(key(N.x[0], NA.z[1])) ?? 0, top.get(key(N.x[0], SA.z[0])) ?? 0) + 1;
  for (const x of spread(N.x[0], N.x[1], 3, 2)) for (const z of [N.z[0], N.z[1]]) windowIn(W, 'x', z, x, 2, clere, Math.min(3, L(N.eaves) - clere), { frame: PAL.lbg, glass: 0x8db3c7, sill: false });
  // north aisle: a west doorway, two triple lancets to the east of it, and a smaller one in each end
  doorIn(W, 'x', NA.z[0], ax0(NA) + 2, 2, 5, { color: PAL.reddishBrown, frame: PAL.dbg, outward: -1 });
  for (const x of spread(ax0(NA) + 6, ax1(NA), 2, 3)) churchWindow(W, 'x', NA.z[0], x, 3, 2, 5);
  for (const x of [ax0(NA), ax1(NA)]) churchWindow(W, 'z', x, mid(NA) - 1, 3, 3, 3);
  // south aisle: a double lancet either side of the porch and one in each end
  for (const [a0, a1] of [[ax0(SA), PO.x[0] - 2], [PO.x[1] + 2, ax1(SA)]]) if (a1 - a0 >= 4) churchWindow(W, 'x', SA.z[1], spread(a0, a1, 1, 3)[0], 3, 2, 5);
  for (const x of [ax0(SA), ax1(SA)]) churchWindow(W, 'z', x, mid(SA) - 1, 3, 2, 5);
  // chancel: the five-light east window; on the south a priest's door between two triple lancets, on the north two
  // lancets at the west end; crocketed pinnacles on the corners of the east gable and one in the middle of the south eaves
  churchWindow(W, 'z', C.x[1], mid(C) - 2, 5, 2, 7);
  const cmid = Math.floor((C.x[0] + C.x[1]) / 2);
  doorIn(W, 'x', C.z[1], cmid, 2, 5, { color: PAL.reddishBrown, frame: PAL.dbg, outward: 1 });
  for (const x of [Math.round((C.x[0] + cmid) / 2) - 1, Math.round((cmid + C.x[1]) / 2)]) churchWindow(W, 'x', C.z[1], x, 3, 2, 5);
  for (const x of [C.x[0] + 2, C.x[0] + 5]) windowIn(W, 'x', C.z[0], x, 1, 2, 5, { frame: PAL.lbg, glass: 0x6f8fa6, sill: false });
  const CT = top.get(key(C.x[1], mid(C)));
  W.extras.push(({ at }) => {
    for (const [x, z] of [[C.x[1], C.z[0]], [C.x[1], C.z[1]], [cmid, C.z[1]]]) {
      const b = at(x, z), y0 = (CT + 1) * BRICK;
      b.geom(new THREE.CylinderGeometry(0.32, 0.32, 1.4, 12), new THREE.Matrix4().makeTranslation(x + 0.5, y0 + 0.7, z + 0.5), col(PAL.lbg));
      b.geom(new THREE.ConeGeometry(0.4, 2.2, 12), new THREE.Matrix4().makeTranslation(x + 0.5, y0 + 2.5, z + 0.5), col(PAL.lbg));
    }
  });
  // south porch: a little gabled stone porch with its ridge running out from the aisle
  house(W, { x0: PO.x[0], z0: PO.z[0], w: PO.x[1] - PO.x[0] + 1, d: PO.z[1] - PO.z[0] + 1, floors: 1, wall: PAL.lbg, plinth: PAL.dbg, roof: PAL.dbg, front: 's', ridge: 'z', chimneys: 0, windows: false, door: PAL.reddishBrown, frame: PAL.dbg, doorAt: PO.x[0] + Math.floor((PO.x[1] - PO.x[0] - 1) / 2) });
}

// War memorial: Celtic cross on a plinth (1920)
export function warMemorial(W, mx, mz) {
  W.fill(mx - 1, 0, mz - 1, mx + 1, 0, mz + 1, PAL.lbg); W.fill(mx, 1, mz, mx, 1, mz, PAL.lbg);
  W.extras.push(({ at }) => {
    const b = at(mx, mz), c = col(0xd8d4c4);
    b.box(mx + 0.1, 2.4, mz + 0.1, mx + 0.9, 7.2, mz + 0.9, c, { chamfer: 0.05 });
    b.box(mx - 0.8, 6.0, mz + 0.2, mx + 1.8, 6.7, mz + 0.8, c, { chamfer: 0.05 });
    b.geom(new THREE.TorusGeometry(0.9, 0.14, 8, 24), new THREE.Matrix4().makeTranslation(mx + 0.5, 6.35, mz + 0.5), c);
  });
  W.labels.push({ name: 'War Memorial', x: mx, z: mz, r: 4 });
}

export function headstone(W, x, z) {
  W.set(x, 0, z, PAL.lbg, F_HIDDEN);
  const h = 1.6 + R() * 1.4, c = col(R() < 0.7 ? PAL.lbg : PAL.dbg), rot = R() < 0.5;
  W.extras.push(({ at }) => {
    const b = at(x, z);
    if (rot) b.box(x + 0.35, 0, z + 0.05, x + 0.65, h, z + 0.95, c, { chamfer: 0.08 });
    else b.box(x + 0.05, 0, z + 0.35, x + 0.95, h, z + 0.65, c, { chamfer: 0.08 });
  });
}

// Pointed (stepped) church window with tinted leaded glass
export function churchWindow(W, axis, fixed, a0, w, y0, h) {
  windowIn(W, axis, fixed, a0, w, y0, h, { frame: PAL.lbg, glass: 0x6f8fa6, sill: false });
  // stepped arch head
  const steps = Math.floor(w / 2);
  for (let s = 0; s < steps; s++) {
    const aa = a0 + s + 1, ww = w - 2 * (s + 1);
    if (ww <= 0) break;
    windowIn(W, axis, fixed, aa, ww, y0 + h + s, 1, { frame: PAL.lbg, glass: 0x7a6aa0, sill: false, mullions: false });
  }
}

function louvre(W, axis, fixed, a0, w, y0, h) {
  for (let a = a0; a < a0 + w; a++) for (let y = y0; y < y0 + h; y++) {
    if (axis === 'x') W.set(a, y, fixed, PAL.dbg, F_HIDDEN); else W.set(fixed, y, a, PAL.dbg, F_HIDDEN);
  }
  W.extras.push(({ at }) => {
    const b = axis === 'x' ? at(a0, fixed) : at(fixed, a0);
    for (let i = 0; i < h * 3; i++) {
      const y = y0 * BRICK + i * 0.4;
      if (axis === 'x') b.box(a0, y, fixed + 0.3, a0 + w, y + 0.18, fixed + 0.7, col(PAL.dbg), { chamfer: 0.01, gap: 0 });
      else b.box(fixed + 0.3, y, a0, fixed + 0.7, y + 0.18, a0 + w, col(PAL.dbg), { chamfer: 0.01, gap: 0 });
    }
    // dark backing
    if (axis === 'x') b.box(a0, y0 * BRICK, fixed + 0.75, a0 + w, (y0 + h) * BRICK, fixed + 0.85, col(PAL.black), { chamfer: 0, gap: 0 });
    else b.box(fixed + 0.75, y0 * BRICK, a0, fixed + 0.85, (y0 + h) * BRICK, a0 + w, col(PAL.black), { chamfer: 0, gap: 0 });
  });
}

export function busShelter(W, x, z) {
  for (let y = 0; y < 5; y++) { W.set(x, y, z, PAL.darkGreen); W.set(x + 5, y, z, PAL.darkGreen); W.set(x, y, z - 1, PAL.darkGreen); W.set(x + 5, y, z - 1, PAL.darkGreen); }
  W.fill(x, 5, z - 2, x + 5, 5, z + 1, PAL.darkGreen, F_TILE);
  W.glass.push([x + 1, 0.2, z - 1.95, x + 5, 5 * BRICK, z - 1.85, 0xbfdde6]);
  for (let xx = x + 1; xx < x + 5; xx++) for (let y = 0; y < 5; y++) W.set(xx, y, z - 2, PAL.darkGreen, F_HIDDEN);
  bench(W, x + 1, z - 1, 'x');
  W.labels.push({ name: 'Bus stop', x: x + 2, z: z, r: 4 });
}
