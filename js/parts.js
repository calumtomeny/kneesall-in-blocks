// Reusable LEGO builds: houses, windows, doors, trees, hedges, walls, signs...
import * as THREE from 'three';
import { PAL, BRICK, PLATE, F_TILE, F_HIDDEN, F_NOCOLLIDE, F_PLAIN, col, rng } from './bricks.js';

export const R = rng(20251014);
export const pick = (a) => a[Math.floor(R() * a.length)];

// Box coordinates for a feature set into a wall. axis = direction the wall runs.
// fixed = wall cell (perpendicular coordinate); f0/f1 = depth range within/around the wall cell.
function wb(axis, fixed, a0, a1, y0, y1, f0, f1) {
  return axis === 'x' ? [a0, y0, fixed + f0, a1, y1, fixed + f1] : [fixed + f0, y0, a0, fixed + f1, y1, a1];
}

// --------------------------------------------------------------- windows & doors
export function windowIn(W, axis, fixed, a0, w, y0, h, o = {}) {
  const frame = o.frame ?? PAL.white;
  for (let a = a0; a < a0 + w; a++) for (let y = y0; y < y0 + h; y++) {
    if (axis === 'x') W.set(a, y, fixed, frame, F_HIDDEN); else W.set(fixed, y, a, frame, F_HIDDEN);
  }
  const Y0 = y0 * BRICK, Y1 = (y0 + h) * BRICK, A1 = a0 + w, t = 0.16;
  W.extras.push(({ at }) => {
    const b = axis === 'x' ? at(a0, fixed) : at(fixed, a0);
    const c = col(frame), op = { chamfer: 0.02, gap: 0.004 };
    b.box(...wb(axis, fixed, a0, a0 + t, Y0, Y1, 0.3, 0.75), c, op);
    b.box(...wb(axis, fixed, A1 - t, A1, Y0, Y1, 0.3, 0.75), c, op);
    b.box(...wb(axis, fixed, a0 + t, A1 - t, Y1 - t, Y1, 0.3, 0.75), c, op);
    b.box(...wb(axis, fixed, a0 + t, A1 - t, Y0, Y0 + t, 0.3, 0.75), c, op);
    // mullions / glazing bars
    const mid = (a0 + A1) / 2;
    if (o.mullions !== false) {
      if (w >= 2) b.box(...wb(axis, fixed, mid - 0.06, mid + 0.06, Y0, Y1, 0.42, 0.62), c, op);
      if (h >= 2) { const ym = Y0 + (Y1 - Y0) * 0.62; b.box(...wb(axis, fixed, a0, A1, ym - 0.06, ym + 0.06, 0.42, 0.62), c, op); }
    }
    // sill (protruding tile on both faces)
    if (o.sill !== false) b.box(...wb(axis, fixed, a0 - 0.2, A1 + 0.2, Y0 - PLATE * 0.6, Y0, -0.25, 1.25), col(o.sillCol ?? PAL.lbg), { chamfer: 0.02 });
    // lintel
    if (o.lintel) b.box(...wb(axis, fixed, a0 - 0.25, A1 + 0.25, Y1, Y1 + PLATE, -0.05, 1.05), col(o.lintel), { chamfer: 0.02 });
  });
  W.glass.push([...wb(axis, fixed, a0 + 0.05, A1 - 0.05, Y0 + 0.05, Y1 - 0.05, 0.49, 0.56), o.glass ?? 0x9fc8d8]);
}

export function doorIn(W, axis, fixed, a0, w, h, o = {}) {
  const c = o.color ?? PAL.white;   // the commonest front door in the survey; others are recorded per house
  for (let a = a0; a < a0 + w; a++) for (let y = 0; y < h; y++) {
    if (axis === 'x') W.set(a, y, fixed, c, F_HIDDEN); else W.set(fixed, y, a, c, F_HIDDEN);
  }
  const Y1 = h * BRICK, A1 = a0 + w;
  const out = o.outward ?? -1; // which side the step goes
  W.extras.push(({ at }) => {
    const b = axis === 'x' ? at(a0, fixed) : at(fixed, a0);
    const fr = col(o.frame ?? PAL.white), op = { chamfer: 0.02, gap: 0.004 };
    b.box(...wb(axis, fixed, a0, a0 + 0.2, 0, Y1, 0.2, 0.85), fr, op);
    b.box(...wb(axis, fixed, A1 - 0.2, A1, 0, Y1, 0.2, 0.85), fr, op);
    b.box(...wb(axis, fixed, a0, A1, Y1 - 0.25, Y1, 0.2, 0.85), fr, op);
    b.box(...wb(axis, fixed, a0 + 0.2, A1 - 0.2, 0, Y1 - 0.25, 0.45, 0.65), col(c), { chamfer: 0.03, gap: 0.004 });
    // raised panels
    const pd = out < 0 ? [0.38, 0.45] : [0.65, 0.72];
    for (const yy of [[0.5, Y1 * 0.45], [Y1 * 0.52, Y1 - 0.7]]) {
      b.box(...wb(axis, fixed, a0 + 0.45, A1 - 0.45, yy[0], yy[1], pd[0], pd[1]), col(c), { chamfer: 0.02, gap: 0 });
    }
    // knob
    b.box(...wb(axis, fixed, A1 - 0.65, A1 - 0.45, Y1 * 0.45, Y1 * 0.45 + 0.2, out < 0 ? 0.3 : 0.7, out < 0 ? 0.45 : 0.85), col(PAL.pearlGold), { chamfer: 0.03, gap: 0 });
    // step
    const s0 = out < 0 ? -1.2 : 1, s1 = out < 0 ? 0 : 2.2;
    b.box(...wb(axis, fixed, a0 - 0.3, A1 + 0.3, 0, PLATE, s0, s1), col(PAL.lbg), { chamfer: 0.02 });
  });
}

// An up-and-over garage door w studs wide and h bricks tall: a frame and a ribbed panel, flush with the wall
export function garageDoorIn(W, axis, fixed, a0, w, h, o = {}) {
  const c = o.color ?? PAL.white;
  for (let a = a0; a < a0 + w; a++) for (let y = 0; y < h; y++) {
    if (axis === 'x') W.set(a, y, fixed, c, F_HIDDEN); else W.set(fixed, y, a, c, F_HIDDEN);
  }
  const Y1 = h * BRICK, A1 = a0 + w;
  W.extras.push(({ at }) => {
    const b = axis === 'x' ? at(a0, fixed) : at(fixed, a0);
    const fr = col(o.frame ?? PAL.white), op = { chamfer: 0.02, gap: 0.004 };
    b.box(...wb(axis, fixed, a0, a0 + 0.2, 0, Y1, 0.2, 0.85), fr, op);
    b.box(...wb(axis, fixed, A1 - 0.2, A1, 0, Y1, 0.2, 0.85), fr, op);
    b.box(...wb(axis, fixed, a0, A1, Y1 - 0.25, Y1, 0.2, 0.85), fr, op);
    b.box(...wb(axis, fixed, a0 + 0.2, A1 - 0.2, 0, Y1 - 0.25, 0.45, 0.6), col(c), { chamfer: 0.02, gap: 0.004 });
    for (let y = 0.6; y < Y1 - 0.5; y += 0.7) b.box(...wb(axis, fixed, a0 + 0.3, A1 - 0.3, y, y + 0.12, 0.38, 0.67), col(c), { chamfer: 0.01, gap: 0 });
  });
}

// --------------------------------------------------------------- house
// x0,z0 = min corner; w along x, d along z (d even); front = 'n'|'s' (door side facing road)
export function house(W, o) {
  const { x0, z0, w, d } = o;
  const x1 = x0 + w - 1, z1 = z0 + d - 1;
  const floors = o.floors ?? 2, FH = 6;
  const H = floors * FH;
  const wall = o.wall ?? PAL.darkOrange, plinth = o.plinth ?? PAL.dbg;
  const roof = o.roof ?? PAL.dbg;
  const front = o.front ?? 's';
  const ridge = o.ridge ?? 'x'; // ridge direction
  // walls
  for (let y = 0; y < H; y++) {
    const c = y === 0 ? plinth : (o.band && y % FH === FH - 1 ? o.band : wall);
    for (let x = x0; x <= x1; x++) { W.set(x, y, z0, c); W.set(x, y, z1, c); }
    for (let z = z0; z <= z1; z++) { W.set(x0, y, z, c); W.set(x1, y, z, c); }
  }
  // quoins (corner stones) for older houses
  if (o.quoins) for (let y = 1; y < H; y += 2) for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) W.set(x, y, z, o.quoins);
  // floor slab (hidden interior, stops looking hollow through windows)
  for (let z = z0 + 1; z < z1; z++) for (let x = x0 + 1; x < x1; x++) W.set(x, 0, z, PAL.reddishBrown, F_TILE | F_NOCOLLIDE);
  // windows + door on the front, regularly spaced windows on the back and one in each end wall
  const fz = front === 's' ? z1 : z0, bz = front === 's' ? z0 : z1;
  const out = front === 's' ? 1 : -1;
  const slots = [];
  for (let x = x0 + 2; x + 2 <= x1 - 1; x += 4) slots.push(x);
  const doorSlot = o.doorAt ?? slots[Math.floor(slots.length / 2)] ?? x0 + 2;
  for (let f = 0; f < (o.windows === false ? 0 : floors); f++) {
    for (const x of slots) {
      if (f === 0 && x === doorSlot) continue;
      windowIn(W, 'x', fz, x, 2, f * FH + 2, 3, { frame: o.frame, lintel: o.lintel });
      windowIn(W, 'x', bz, x, 2, f * FH + 2, 3, { frame: o.frame, lintel: o.lintel });
    }
    if (d >= 8) for (const x of [x0, x1]) windowIn(W, 'z', x, z0 + Math.floor(d / 2) - 1, 2, f * FH + 2, 3, { frame: o.frame, lintel: o.lintel });
  }
  doorIn(W, 'x', fz, doorSlot, 2, 5, { outward: out, color: o.door, frame: o.frame });
  if (o.porch) {
    const pz = front === 's' ? z1 + 1 : z0 - 3;
    W.fill(doorSlot - 1, 0, pz, doorSlot - 1, 4, pz + 2, wall); W.fill(doorSlot + 2, 0, pz, doorSlot + 2, 4, pz + 2, wall);
    for (let y = 0; y < 5; y++) W.del(doorSlot - 1, y, front === 's' ? pz + 2 : pz), W.del(doorSlot + 2, y, front === 's' ? pz + 2 : pz);
    W.fill(doorSlot - 1, 5, pz, doorSlot + 2, 5, pz + 2, roof, F_TILE);
  }
  // roof
  gableRoof(W, x0, z0, x1, z1, H, roof, wall, ridge);
  // chimneys
  const ch = o.chimney ?? wall;
  const top = H + (ridge === 'x' ? (d + 2) / 2 : (w + 2) / 2) + 1;
  if (o.chimneys !== 0) {
    const ends = ridge === 'x' ? [[x0 + 1, Math.floor((z0 + z1) / 2)], [x1 - 2, Math.floor((z0 + z1) / 2)]] : [[Math.floor((x0 + x1) / 2), z0 + 1], [Math.floor((x0 + x1) / 2), z1 - 2]];
    // none unless someone has seen them
    const n = Math.min(2, o.chimneys ?? 0);
    for (let i = 0; i < n; i++) chimney(W, ends[i][0], ends[i][1], H, top, ch);
  }
  if (o.label) W.labels.push({ name: o.label, x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.max(w, d) });
  return { x0, z0, x1, z1, H };
}

export function chimney(W, x, z, y0, y1, c) {
  // remove slope cells under the stack is not needed: chimney bricks simply poke through the roof
  W.fill(x, y0, z, x + 1, y1, z + 1, c);
  W.fill(x, y1 + 1, z, x + 1, y1 + 1, z + 1, PAL.dbg, F_TILE);
  W.extras.push(({ at }) => {
    const g = new THREE.CylinderGeometry(0.32, 0.38, 1.4, 12);
    for (const dx of [0.5, 1.5]) {
      const m = new THREE.Matrix4().makeTranslation(x + dx, (y1 + 2) * BRICK + 0.7, z + 1);
      at(x, z).geom(g, m, col(PAL.darkOrange));
    }
  });
}

// 45° LEGO slope roof with 1-stud eaves overhang
export function gableRoof(W, x0, z0, x1, z1, H, roof, gable, ridge = 'x') {
  if (ridge === 'x') {
    const D = z1 - z0 + 3, K = Math.floor(D / 2);
    for (let k = 0; k < K; k++) {
      const y = H + k;
      W.slope('x', z0 - 1 + k, x0 - 1, x1 + 1, y, -1, roof);
      W.slope('x', z1 + 1 - k, x0 - 1, x1 + 1, y, 1, roof);
      for (let z = z0 + k; z <= z1 - k; z++) { W.set(x0, y, z, gable); W.set(x1, y, z, gable); }
    }
    if (D % 2) for (let x = x0 - 1; x <= x1 + 1; x++) W.set(x, H + K, z0 - 1 + K, roof, F_TILE);
  } else {
    const D = x1 - x0 + 3, K = Math.floor(D / 2);
    for (let k = 0; k < K; k++) {
      const y = H + k;
      W.slope('z', x0 - 1 + k, z0 - 1, z1 + 1, y, -1, roof);
      W.slope('z', x1 + 1 - k, z0 - 1, z1 + 1, y, 1, roof);
      for (let x = x0 + k; x <= x1 - k; x++) { W.set(x, y, z0, gable); W.set(x, y, z1, gable); }
    }
    if (D % 2) for (let z = z0 - 1; z <= z1 + 1; z++) W.set(x0 - 1 + K, H + K, z, roof, F_TILE);
  }
}

// --------------------------------------------------------------- nature
export function tree(W, x, z, o = {}) {
  const h = o.trunk ?? 5 + Math.floor(R() * 3);
  const r = o.r ?? 3.5 + R() * 2;
  const greens = o.greens ?? [PAL.green, PAL.green, PAL.darkGreen, PAL.olive];
  // round trunk (brown) + collision
  for (let y = 0; y < h; y++) W.set(x, y, z, PAL.reddishBrown, F_HIDDEN);
  W.extras.push(({ at }) => {
    const g = new THREE.CylinderGeometry(0.48, 0.55, h * BRICK, 12);
    at(x, z).geom(g, new THREE.Matrix4().makeTranslation(x + 0.5, h * BRICK / 2, z + 0.5), col(PAL.reddishBrown));
  });
  // the crown: an ellipsoid, or for a conifer (o.cone: its height in bricks) a cone from the top of the trunk
  const cone = o.cone, cy = cone ? h : h + r * 0.55, ry = cone ? cone : r * 0.75;
  const R2 = Math.ceil(r);
  const inside = cone ? (dx, dy, dz) => dy >= 0 && dy <= cone && Math.hypot(dx, dz) <= Math.max(0.6, r * (1 - dy / cone))
    : (dx, dy, dz) => (dx * dx + dz * dz) / (r * r) + (dy * dy) / (ry * ry) <= 1;
  for (let dy = cone ? 0 : -Math.ceil(ry); dy <= Math.ceil(ry); dy++) for (let dz = -R2; dz <= R2; dz++) for (let dx = -R2; dx <= R2; dx++) {
    if (!inside(dx, dy, dz)) continue;
    const shell = !inside(dx + 1, dy, dz) || !inside(dx - 1, dy, dz) || !inside(dx, dy + 1, dz) || !inside(dx, dy - 1, dz) || !inside(dx, dy, dz + 1) || !inside(dx, dy, dz - 1);
    if (!shell && !(dx === 0 && dz === 0)) continue;
    if (shell && R() < 0.12 && dy > -ry + 1) continue; // ragged edge
    if (o.keep < 1 && !(dx === 0 && dz === 0) && R() > o.keep) continue;   // thin crowns: spring, autumn, bare winter twigs
    const y = Math.round(cy + dy); if (y < 2) continue;
    if (!W.has(x + dx, y, z + dz)) W.set(x + dx, y, z + dz, dy > ry * 0.3 && R() < 0.5 ? greens[0] : pick(greens), F_NOCOLLIDE | F_PLAIN);
  }
}

export function hedge(W, x0, z0, x1, z1, h = 2, c = PAL.darkGreen) {
  for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = 0; y < h; y++) W.set(x, y, z, (R() < 0.15 ? PAL.green : c), F_PLAIN);
    if (R() < 0.12) W.set(x, h, z, c, F_PLAIN);
  }
}

export function wallRun(W, x0, z0, x1, z1, h, c, cap) {
  for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    for (let y = 0; y < h; y++) W.set(x, y, z, c);
    if (cap) W.set(x, h, z, cap, F_TILE);
  }
}

export function fencePost(W, x, z, c = PAL.reddishBrown) { W.set(x, 0, z, c); W.set(x, 1, z, c); }

// --------------------------------------------------------------- street furniture
export function phoneBox(W, x, z) {
  // K6 kiosk: red 2x2, 7 bricks tall, crown on top
  for (let y = 0; y < 7; y++) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) W.set(x + dx, y, z + dz, PAL.red, F_HIDDEN);
  W.extras.push(({ at, glass }) => {
    const b = at(x, z), r = col(PAL.red);
    const posts = [[0, 0], [1.75, 0], [0, 1.75], [1.75, 1.75]];
    for (const [px, pz] of posts) b.box(x + px, 0, z + pz, x + px + 0.25, 7 * BRICK, z + pz + 0.25, r, { chamfer: 0.03, gap: 0 });
    b.box(x, 0, z, x + 2, 0.4, z + 2, r, { chamfer: 0.03, gap: 0 });
    b.box(x - 0.05, 7 * BRICK, z - 0.05, x + 2.05, 7 * BRICK + 0.8, z + 2.05, r, { chamfer: 0.06, gap: 0 });
    b.box(x + 0.2, 7 * BRICK + 0.8, z + 0.2, x + 1.8, 7 * BRICK + 1.3, z + 1.8, r, { chamfer: 0.12, gap: 0 });
    // glazing bars
    for (let i = 1; i < 6; i++) {
      const y = 0.9 + i * 1.05;
      b.box(x + 0.1, y, z + 0.05, x + 1.9, y + 0.12, z + 0.2, r, { chamfer: 0.01, gap: 0 });
      b.box(x + 0.1, y, z + 1.8, x + 1.9, y + 0.12, z + 1.95, r, { chamfer: 0.01, gap: 0 });
      b.box(x + 0.05, y, z + 0.1, x + 0.2, y + 0.12, z + 1.9, r, { chamfer: 0.01, gap: 0 });
      b.box(x + 1.8, y, z + 0.1, x + 1.95, y + 0.12, z + 1.9, r, { chamfer: 0.01, gap: 0 });
    }
    // white "TELEPHONE" panels
    b.box(x + 0.3, 7 * BRICK + 0.1, z - 0.08, x + 1.7, 7 * BRICK + 0.6, z, col(PAL.white), { chamfer: 0.01, gap: 0 });
    b.box(x + 0.3, 7 * BRICK + 0.1, z + 2, x + 1.7, 7 * BRICK + 0.6, z + 2.08, col(PAL.white), { chamfer: 0.01, gap: 0 });
    glass.box(x + 0.15, 0.4, z + 0.15, x + 1.85, 7 * BRICK, z + 1.85, col(0xbfdde6), { chamfer: 0, gap: 0 });
  });
}

export function postBox(W, x, z) {
  W.set(x, 0, z, PAL.red, F_HIDDEN); W.set(x, 1, z, PAL.red, F_HIDDEN);
  W.extras.push(({ at }) => {
    const b = at(x, z);
    b.geom(new THREE.CylinderGeometry(0.45, 0.45, 2.6, 16), new THREE.Matrix4().makeTranslation(x + 0.5, 1.3, z + 0.5), col(PAL.red));
    const cap = new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    b.geom(cap, new THREE.Matrix4().makeTranslation(x + 0.5, 2.6, z + 0.5), col(PAL.red));
    b.box(x + 0.25, 2.0, z + 0.03, x + 0.75, 2.1, z + 0.1, col(PAL.black), { chamfer: 0, gap: 0 });
  });
}

export function bench(W, x, z, axis = 'x') {
  W.extras.push(({ at }) => {
    const b = at(x, z), c = col(PAL.reddishBrown), k = col(PAL.black);
    if (axis === 'x') {
      b.box(x, 0, z, x + 0.3, 1.0, z + 1, k); b.box(x + 2.7, 0, z, x + 3, 1.0, z + 1, k);
      b.box(x - 0.2, 1.0, z, x + 3.2, 1.2, z + 1, c);
      b.box(x - 0.2, 1.2, z + 0.75, x + 3.2, 2.2, z + 0.95, c);
    } else {
      b.box(x, 0, z, x + 1, 1.0, z + 0.3, k); b.box(x, 0, z + 2.7, x + 1, 1.0, z + 3, k);
      b.box(x, 1.0, z - 0.2, x + 1, 1.2, z + 3.2, c);
      b.box(x + 0.05, 1.2, z - 0.2, x + 0.25, 2.2, z + 3.2, c);
    }
  });
}

// Sign with canvas text (separate textured mesh, collected in W.signs)
// A street light seen in Street View: a grey steel column with a short outreach arm and a flat lantern ('column'),
// or a swan-neck bracket with a hanging lantern ('swan'); `arm` [dx, dz] points over the road
export function streetLight(W, x, z, arm, style = 'column') {
  if (!W.has(x, 0, z)) W.set(x, 0, z, PAL.lbg, F_HIDDEN);
  W.extras.push(({ at, glass }) => {
    const b = at(x, z), c = col(PAL.lbg), cx = x + 0.5, cz = z + 0.5, [ax, az] = arm;
    const H = style === 'swan' ? 13 : 15, turn = Math.atan2(-az, ax);
    // a box lying along the arm, `d0`..`d1` studs out from the column
    const along = (d0, d1, y, h, w, colour) => b.geom(new THREE.BoxGeometry(d1 - d0, h, w),
      new THREE.Matrix4().makeRotationY(turn).setPosition(cx + ax * (d0 + d1) / 2, y, cz + az * (d0 + d1) / 2), colour);
    b.geom(new THREE.CylinderGeometry(0.12, 0.18, H, 10), new THREE.Matrix4().makeTranslation(cx, H / 2, cz), c);
    if (style === 'swan') {
      // the neck curves up and over, then the lantern hangs at its end
      b.geom(new THREE.TorusGeometry(0.8, 0.09, 6, 12, Math.PI), new THREE.Matrix4().makeRotationY(turn).setPosition(cx + ax * 0.8, H, cz + az * 0.8), c);
      along(1.6, 2.4, H, 0.16, 0.16, c);
      b.geom(new THREE.CylinderGeometry(0.15, 0.35, 0.5, 8), new THREE.Matrix4().makeTranslation(cx + ax * 2.3, H - 0.3, cz + az * 2.3), c);
      const lx = cx + ax * 2.3, lz = cz + az * 2.3;
      glass.box(lx - 0.24, H - 1.25, lz - 0.24, lx + 0.24, H - 0.55, lz + 0.24, col(0xfff1b0), { chamfer: 0.04, gap: 0 });
    } else {
      along(0, 1.2, H - 0.1, 0.14, 0.14, c);
      along(1.0, 2.1, H, 0.2, 0.45, c);
      const lx = cx + ax * 1.55, lz = cz + az * 1.55;
      glass.box(lx - 0.18, H - 0.16, lz - 0.18, lx + 0.18, H - 0.1, lz + 0.18, col(0xfff1b0), { chamfer: 0.01, gap: 0 });
    }
  });
}

export function sign(W, x, z, text, o = {}) {
  W.signs = W.signs || [];
  const face = o.face ?? (o.rot ? Math.PI / 2 : 0);
  W.signs.push({ x, z, text, ...o, face });
  if (!W.has(x, 0, z)) W.set(x, 0, z, PAL.lbg, F_HIDDEN);
  W.extras.push(({ at }) => {
    const b = at(x, z), h = o.postH ?? 4.5, ux = Math.cos(face), uz = -Math.sin(face);
    for (const dx of o.posts ?? (o.twoPosts ? [-((o.w ?? 4) / 2) + 0.3, (o.w ?? 4) / 2 - 0.3] : [0])) {
      b.geom(new THREE.CylinderGeometry(0.15, 0.15, h, 8), new THREE.Matrix4().makeTranslation(x + 0.5 + ux * dx, h / 2, z + 0.5 + uz * dx), col(o.post ?? PAL.lbg));
    }
  });
}
