// Landmark builds: St Bartholomew's Church, war memorial, farm animals, bus shelter.
import * as THREE from 'three';
import { PAL, BRICK, F_TILE, F_HIDDEN, F_NOCOLLIDE, col } from './bricks.js';
import { R, house, windowIn, doorIn, gableRoof, bench } from './parts.js';

export function stone() { const r = R(); return r < 0.72 ? PAL.lbg : r < 0.9 ? PAL.tan : PAL.darkTan; }

// St Bartholomew's: west tower, nave with aisles + clerestory, chancel, south porch.
// Local footprint x -7..41, z 15..42 (tower at the west/low-x end).
export function churchBuilding(W) {
  // Tower (west), 3 stages, battlements + pinnacles. x -6..3, z 21..30
  const tx0 = -6, tz0 = 21, T = 10, TH = 30;
  for (let y = 0; y < TH; y++) for (let i = 0; i < T; i++) {
    const c = (y === 10 || y === 20 || y === 0) ? PAL.dbg : stone();
    W.set(tx0 + i, y, tz0, c); W.set(tx0 + i, y, tz0 + T - 1, c); W.set(tx0, y, tz0 + i, c); W.set(tx0 + T - 1, y, tz0 + i, c);
  }
  // buttresses at corners
  for (const [x, z] of [[tx0 - 1, tz0], [tx0, tz0 - 1], [tx0 + T, tz0], [tx0 + T - 1, tz0 - 1], [tx0 - 1, tz0 + T - 1], [tx0, tz0 + T], [tx0 + T, tz0 + T - 1], [tx0 + T - 1, tz0 + T]])
    for (let y = 0; y < 18; y++) if (y < 18 - Math.abs((x + z) % 3)) W.set(x, y, z, stone());
  // battlements
  for (let i = 0; i < T; i++) if (i % 2 === 0) for (const [x, z] of [[tx0 + i, tz0], [tx0 + i, tz0 + T - 1], [tx0, tz0 + i], [tx0 + T - 1, tz0 + i]]) W.set(x, TH, z, PAL.lbg);
  for (let z = tz0 + 1; z < tz0 + T - 1; z++) for (let x = tx0 + 1; x < tx0 + T - 1; x++) W.set(x, TH - 1, z, PAL.dbg, F_TILE);
  // pinnacles
  W.extras.push(({ at }) => {
    for (const [x, z] of [[tx0, tz0], [tx0 + T - 1, tz0], [tx0, tz0 + T - 1], [tx0 + T - 1, tz0 + T - 1]]) {
      const b = at(x, z);
      b.geom(new THREE.CylinderGeometry(0.42, 0.42, 1.6, 12), new THREE.Matrix4().makeTranslation(x + 0.5, (TH + 1) * BRICK + 0.8, z + 0.5), col(PAL.lbg));
      b.geom(new THREE.ConeGeometry(0.5, 2.6, 12), new THREE.Matrix4().makeTranslation(x + 0.5, (TH + 1) * BRICK + 2.9, z + 0.5), col(PAL.lbg));
    }
    // weathervane
    const b = at(tx0 + 5, tz0 + 5);
    b.geom(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), new THREE.Matrix4().makeTranslation(tx0 + 5, TH * BRICK + 2, tz0 + 5), col(PAL.pearlGold));
    b.box(tx0 + 4.2, TH * BRICK + 3.4, tz0 + 4.95, tx0 + 5.8, TH * BRICK + 3.9, tz0 + 5.05, col(PAL.pearlGold), { chamfer: 0.02, gap: 0 });
  });
  // west door, west window, belfry openings, clock
  doorIn(W, 'z', tx0, tz0 + 4, 2, 6, { color: PAL.reddishBrown, frame: PAL.dbg, outward: -1 });
  churchWindow(W, 'z', tx0, tz0 + 3, 4, 9, 5);
  for (const [axis, fixed] of [['x', tz0], ['x', tz0 + T - 1], ['z', tx0], ['z', tx0 + T - 1]]) {
    const a0 = axis === 'x' ? tx0 + 3 : tz0 + 3;
    louvre(W, axis, fixed, a0, 4, 22, 4);
  }
  W.clocks = [{ x: tx0 + 5, y: 16 * BRICK + 1.2, z: tz0 - 0.05, face: 'n' }];

  // Nave with clerestory, x 4..29 z 22..29; aisles z 17..21 and z 30..34; chancel x 30..41
  const nx0 = 4, nx1 = 29, nz0 = 21, nz1 = 30, NH = 16;
  for (let y = 0; y < NH; y++) for (let x = nx0; x <= nx1; x++) { W.set(x, y, nz0, stone()); W.set(x, y, nz1, stone()); }
  for (let y = 0; y < NH; y++) for (let z = nz0; z <= nz1; z++) W.set(nx1, y, z, stone());
  // aisles: lower walls, lean-to roofs
  const AH = 8;
  for (const [az0, az1, out] of [[16, nz0 - 1, 16], [nz1 + 1, 35, 35]]) {
    for (let y = 0; y < AH; y++) for (let x = nx0; x <= nx1; x++) W.set(x, y, out, stone());
    for (let y = 0; y < AH; y++) for (let z = az0; z <= az1; z++) { W.set(nx0, y, z, stone()); W.set(nx1, y, z, stone()); }
    // lean-to: slopes rising toward the nave
    for (let k = 0; k < 4; k++) {
      if (out === 16) W.slope('x', 15 + k, nx0 - 1, nx1 + 1, AH + k, -1, PAL.dbg);
      else W.slope('x', 36 - k, nx0 - 1, nx1 + 1, AH + k, 1, PAL.dbg);
    }
    for (let k = 0; k < 4; k++) for (const x of [nx0, nx1]) for (let z = (out === 16 ? 16 + k : nz1 + 1); z <= (out === 16 ? nz0 - 1 : 35 - k); z++) W.set(x, AH + k, z, stone());
    for (let x = nx0 + 2; x + 3 <= nx1 - 1; x += 6) churchWindow(W, 'x', out, x, 3, 2, 4);
  }
  // remove nave wall below aisle roof (arcade), keep piers
  for (let x = nx0 + 1; x < nx1; x++) if ((x - nx0) % 5 !== 0) for (let y = 1; y < 7; y++) { W.del(x, y, nz0); W.del(x, y, nz1); }
  // clerestory windows
  for (let x = nx0 + 2; x + 2 <= nx1 - 1; x += 5) { windowIn(W, 'x', nz0, x, 2, 12, 3, { frame: PAL.lbg, glass: 0x8db3c7, sill: false }); windowIn(W, 'x', nz1, x, 2, 12, 3, { frame: PAL.lbg, glass: 0x8db3c7, sill: false }); }
  // nave roof (low pitch in reality; LEGO 45° here), slate
  gableRoof(W, nx0, nz0, nx1, nz1, NH, PAL.dbg, PAL.lbg, 'x');
  // chancel
  const cx0 = 30, cx1 = 41, cz0 = 22, cz1 = 29, CH = 11;
  for (let y = 0; y < CH; y++) { for (let x = cx0; x <= cx1; x++) { W.set(x, y, cz0, stone()); W.set(x, y, cz1, stone()); } for (let z = cz0; z <= cz1; z++) W.set(cx1, y, z, stone()); }
  gableRoof(W, cx0, cz0, cx1, cz1, CH, PAL.dbg, PAL.lbg, 'x');
  churchWindow(W, 'z', cx1, cz0 + 2, 4, 2, 7);  // Perpendicular east window
  churchWindow(W, 'x', cz0, cx0 + 3, 2, 2, 5); churchWindow(W, 'x', cz1, cx0 + 3, 2, 2, 5);
  churchWindow(W, 'x', cz0, cx0 + 7, 2, 2, 5); churchWindow(W, 'x', cz1, cx0 + 7, 2, 2, 5);
  // south porch
  house(W, { x0: 12, z0: 36, w: 7, d: 6, floors: 1, wall: PAL.lbg, plinth: PAL.dbg, roof: PAL.dbg, front: 's', ridge: 'z', chimneys: 0, door: PAL.reddishBrown, frame: PAL.dbg, doorAt: 14 });
  // interior floor of the church
  for (let z = 17; z <= 34; z++) for (let x = nx0 + 1; x < nx1; x++) if (!W.has(x, 0, z)) W.set(x, 0, z, PAL.tan, F_TILE | F_NOCOLLIDE);

  W.labels.push({ name: "St Bartholomew's Church", x: 17, z: 26, r: 22 });
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

export function cow(W, x, z, rot) {
  const c = () => (R() < 0.45 ? PAL.black : PAL.white);
  const L = rot ? [[0, 0], [0, 3], [1, 0], [1, 3]] : [[0, 0], [3, 0], [0, 1], [3, 1]];
  for (const [dx, dz] of L) W.set(x + dx, 0, z + dz, PAL.white, 0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) for (let y = 1; y <= 2; y++) {
    const [dx, dz] = rot ? [j, i] : [i, j];
    W.set(x + dx, y, z + dz, c());
  }
  // head
  const [hx, hz] = rot ? [x, z - 1] : [x + 4, z];
  W.set(hx, 2, hz, PAL.white); W.set(hx, 3, hz, PAL.black, F_TILE);
  if (rot) { W.set(hx + 1, 2, hz, PAL.white); W.set(hx + 1, 3, hz, PAL.black, F_TILE); }
  else { W.set(hx, 2, hz + 1, PAL.white); W.set(hx, 3, hz + 1, PAL.black, F_TILE); }
  W.set(hx, 1, hz, PAL.flesh, F_TILE);
}

export function tractor(W, x, z) {
  const g = PAL.darkGreen;
  W.fill(x, 1, z, x + 6, 2, z + 3, g);
  W.fill(x + 4, 3, z, x + 6, 5, z + 3, PAL.darkGreen);
  W.fill(x + 4, 6, z, x + 6, 6, z + 3, PAL.black, F_TILE);
  W.clear(x + 4, 3, z + 1, x + 6, 5, z + 2);
  W.fill(x + 1, 3, z + 1, x + 1, 4, z + 1, PAL.black);
  W.glass.push([x + 3.95, 3 * BRICK, z + 0.2, x + 4.05, 6 * BRICK, z + 3.8, 0xbfdde6]);
  W.fill(x, 0, z, x + 6, 0, z + 3, PAL.black, F_HIDDEN);
  W.extras.push(({ at }) => {
    const b = at(x, z);
    const big = new THREE.CylinderGeometry(1.8, 1.8, 1.2, 24), small = new THREE.CylinderGeometry(1.0, 1.0, 0.9, 20);
    const rx = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    for (const zz of [z - 0.6, z + 4.6]) {
      b.geom(big, new THREE.Matrix4().makeTranslation(x + 5, 1.8, zz).multiply(rx), col(PAL.black));
      b.geom(small, new THREE.Matrix4().makeTranslation(x + 1, 1.0, zz).multiply(rx), col(PAL.black));
      b.geom(new THREE.CylinderGeometry(1.0, 1.0, 1.25, 16), new THREE.Matrix4().makeTranslation(x + 5, 1.8, zz).multiply(rx), col(PAL.yellow));
    }
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
