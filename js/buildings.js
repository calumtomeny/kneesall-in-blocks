// Turns building footprints (OSM polygons or generated rectangles) into LEGO buildings.
// Each building is built axis-aligned in its own local voxel World and then rotated into place,
// so walls stay straight even when the real building sits at an angle.
import { World, PAL, F_TILE, F_NOCOLLIDE } from './bricks.js';
import { R, pick, house, windowIn, doorIn, garageDoorIn, chimney, sign } from './parts.js';
import { churchBuilding } from './landmarks.js';
import { polyCells, dominantAngle, centroid } from './geo.js';
import { roofPlan } from './roofs.js';

const N4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// Building materials as LEGO colours
export const MATERIALS = {
  slate: PAL.dbg, pantile: PAL.darkOrange, brownTile: PAL.reddishBrown, concreteTile: PAL.darkTan, sheetLight: PAL.lbg, sheetDark: PAL.dbg, felt: PAL.dbg,
  redBrick: PAL.darkNougat, darkBrick: PAL.darkRed, brownBrick: PAL.reddishBrown, buffBrick: PAL.tan,
  render: PAL.white, creamRender: PAL.tan, greyRender: PAL.darkTan, black: PAL.black, solar: PAL.darkBlue, stone: PAL.lbg,
};

// Walls aren't in any open data. Where nobody has looked (survey.json "details"), houses and traditional farm
// ranges are plain red brick, the commonest walling in Kneesall, and modern sheds plain grey cladding. Roofs come
// from the LIDAR (roofMaterial) and these are only the fallback.
export const STYLES = {
  old: { wall: MATERIALS.redBrick, roof: MATERIALS.pantile },
  modern: { wall: MATERIALS.redBrick, roof: MATERIALS.brownTile },
  farm: { wall: PAL.lbg, roof: MATERIALS.sheetLight },
};

// Roof material from the National LIDAR Programme: low-pitched roofs are sheeting (large) or felt (small);
// pitched roofs by how strongly they return the laser: slate and grey tiles weakly, brown concrete tiles
// moderately, clay pantiles strongly. Thresholds checked against aerial photographs of a dozen roofs.
export function roofMaterial(b) {
  return b.roofI === undefined ? null : materialFor(b.roofI, b.roofPitch ?? 1, b.areaM2);
}
// intensity, pitch (rise per metre) and roof area (m2) -> material name
export function materialFor(I, pitch, area) {
  if (pitch < 0.3) return area > 150 ? (I >= 40 ? 'sheetLight' : 'sheetDark') : 'felt';
  return I < 26 ? 'slate' : I < 37 ? 'brownTile' : 'pantile';
}

// A building placed in the world: local voxel World + rigid transform (rotation a about y)
export class Placed {
  constructor(world, ox, oz, a) {
    Object.assign(this, { world, ox, oz, a, cos: Math.cos(a), sin: Math.sin(a) });
  }
  toWorld(lx, lz) { return [this.ox + lx * this.cos - lz * this.sin, this.oz + lx * this.sin + lz * this.cos]; }
  toLocal(x, z) { const dx = x - this.ox, dz = z - this.oz; return [dx * this.cos + dz * this.sin, -dx * this.sin + dz * this.cos]; }
}

// Pick a rotation, from the footprint's own edge directions, that puts local -z (the front) towards `front`
export function frameAngle(pts, front) {
  const t = dominantAngle(pts);
  let best = t, bd = -Infinity;
  for (let k = 0; k < 4; k++) {
    const a = t + k * Math.PI / 2;
    const d = Math.sin(a) * front[0] - Math.cos(a) * front[1];
    if (d > bd) { bd = d; best = a; }
  }
  return best;
}

// Rasterise a world polygon into local cells for a frame angle. Returns cells + placement origin.
function footprint(pts, a) {
  const [cx, cz] = centroid(pts), c = Math.cos(a), s = Math.sin(a);
  const loc = pts.map(([x, z]) => { const dx = x - cx, dz = z - cz; return [dx * c + dz * s, -dx * s + dz * c]; });
  const minX = Math.floor(Math.min(...loc.map(p => p[0]))), minZ = Math.floor(Math.min(...loc.map(p => p[1])));
  const shifted = loc.map(([x, z]) => [x - minX, z - minZ]);
  const cells = new Set(); let W = 0, D = 0;
  polyCells(shifted, (x, z) => { cells.add(x + ',' + z); W = Math.max(W, x + 1); D = Math.max(D, z + 1); });
  return { cells, W, D, ox: cx + minX * c - minZ * s, oz: cz + minX * s + minZ * c };
}

export function buildingFromPolygon(pts, front, o = {}) {
  const a = frameAngle(pts, front);
  const fp = footprint(pts, a);
  if (fp.cells.size < 10) return null;
  const W = new World();
  const P = new Placed(W, fp.ox, fp.oz, a);
  Object.assign(P, { poly: pts, roofCol: o.roof, label: o.label });
  // o.heightAt(x, z): LIDAR roof height (m) at a world point; when it covers the building, it shapes it
  const plan = o.heightAt && roofPlan(fp.cells, (x, z) => o.heightAt(...P.toWorld(x + 0.5, z + 0.5)));
  if (plan) { lidarBuilding(W, plan, o); return P; }
  let minX = Infinity, minZ = Infinity, maxX = -1, maxZ = -1;
  for (const k of fp.cells) { const [x, z] = k.split(',').map(Number); minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
  const w = maxX - minX + 1, d = maxZ - minZ + 1;
  const fill = fp.cells.size / (w * d);
  if (fill > 0.86 && Math.min(w, d) <= 20 && !o.hip && o.roofCap !== 0) {
    house(W, { x0: minX, z0: minZ, w, d, front: 'n', ridge: w >= d ? 'x' : 'z', ...o });
  } else {
    footprintBuilding(W, fp.cells, o);
  }
  return P;
}

export function buildingFromRect(cx, cz, w, d, front, o = {}) {
  // rectangle centred on (cx,cz) with its local -z side facing `front`
  const a = Math.atan2(front[0], -front[1]);
  const W = new World();
  house(W, { x0: 0, z0: 0, w, d, front: 'n', ridge: w >= d ? 'x' : 'z', ...o });
  const c = Math.cos(a), s = Math.sin(a);
  const ox = cx - (w / 2 * c - d / 2 * s), oz = cz - (w / 2 * s + d / 2 * c);
  const P = new Placed(W, ox, oz, a);
  P.poly = [[0, 0], [w, 0], [w, d], [0, d]].map(([x, z]) => P.toWorld(x, z));
  Object.assign(P, { roofCol: o.roof, label: o.label });
  return P;
}

// St Bartholomew's on its real footprint: tower to the west, chancel to the east
export function churchFromPolygon(pts) {
  const t = dominantAngle(pts);
  let a = t, bc = -Infinity;
  for (let k = 0; k < 4; k++) { const aa = t + k * Math.PI / 2; if (Math.cos(aa) > bc) { bc = Math.cos(aa); a = aa; } }
  const W = new World();
  churchBuilding(W);
  const [cx, cz] = centroid(pts), c = Math.cos(a), s = Math.sin(a);
  const lx = 17, lz = 28; // local centre of the church model
  const P = new Placed(W, cx - (lx * c - lz * s), cz - (lx * s + lz * c), a);
  P.poly = pts; P.roofCol = PAL.dbg; P.label = "St Bartholomew's Church";
  return P;
}

// Generic footprint (L-shapes etc.): brick walls on the outline, windows on straight runs, hipped roof.
export function footprintBuilding(W, cells, o = {}) {
  const has = (x, z) => cells.has(x + ',' + z);
  const list = [...cells].map(k => k.split(',').map(Number));
  const H = (o.floors ?? 2) * 6;
  const wall = o.wall ?? PAL.darkOrange, roof = o.roof ?? PAL.dbg, plinth = o.plinth ?? PAL.dbg;
  const isB = ([x, z]) => !has(x + 1, z) || !has(x - 1, z) || !has(x, z + 1) || !has(x, z - 1);
  const boundary = list.filter(isB);
  for (let y = 0; y < H; y++) for (const [x, z] of boundary) W.set(x, y, z, y === 0 ? plinth : wall);
  for (const [x, z] of list) if (!isB([x, z])) W.set(x, 0, z, PAL.reddishBrown, F_TILE | F_NOCOLLIDE);

  // straight wall runs per outward direction
  const runs = [];
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const face = boundary.filter(([x, z]) => !has(x + dx, z + dz));
    const along = dz ? 0 : 1; // index of the coordinate that varies along the run
    const key = (p) => p[1 - along] * 10000 + p[along];
    face.sort((p, q) => key(p) - key(q));
    let cur = null;
    for (const p of face) {
      if (cur && p[1 - along] === cur.fixed && p[along] === cur.end + 1) cur.end++;
      else { cur = { dx, dz, fixed: p[1 - along], start: p[along], end: p[along] }; runs.push(cur); }
    }
  }
  const frontRuns = runs.filter(r => r.dz === -1).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const doorRun = frontRuns[0] ?? runs.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  for (const r of runs) {
    const axis = r.dz ? 'x' : 'z';
    const len = r.end - r.start + 1;
    if (len < 5) continue;
    const slots = [];
    for (let a = r.start + 2; a + 2 <= r.end - 1; a += 4) slots.push(a);
    const doorSlot = r === doorRun ? slots[Math.floor(slots.length / 2)] : null;
    if (o.windows !== false) for (let f = 0; f < (o.floors ?? 2); f++) for (const a of slots) {
      if (f === 0 && a === doorSlot) continue;
      windowIn(W, axis, r.fixed, a, 2, f * 6 + 2, 3, { frame: o.frame, lintel: o.lintel });
    }
    if (doorSlot !== null && doorSlot !== undefined) {
      const big = o.windows === false;
      doorIn(W, axis, r.fixed, big ? doorSlot - 1 : doorSlot, big ? 4 : 2, 5, { outward: r.dz || r.dx, color: o.door, frame: o.frame });
    }
  }

  // hipped roof: distance-from-edge levels, capped so big buildings get a flat top
  const level = new Map(), q = [];
  for (const [x, z] of boundary) { level.set(x + ',' + z, 0); q.push([x, z]); }
  for (let i = 0; i < q.length; i++) {
    const [x, z] = q[i], L = level.get(x + ',' + z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = (x + dx) + ',' + (z + dz);
      if (has(x + dx, z + dz) && !level.has(k)) { level.set(k, L + 1); q.push([x + dx, z + dz]); }
    }
  }
  const cap = o.roofCap ?? 6;
  const slopeCells = new Map(); // "axis|u|y|dir" -> [l...]
  let maxL = 0;
  for (const [x, z] of list) {
    const L = level.get(x + ',' + z);
    const y = H + Math.min(L, cap);
    maxL = Math.max(maxL, Math.min(L, cap));
    if (L >= cap) { W.set(x, y, z, roof, F_TILE); continue; }
    const lower = [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([dx, dz]) => !has(x + dx, z + dz) || level.get((x + dx) + ',' + (z + dz)) < L);
    if (!lower.length) { W.set(x, y, z, roof, F_TILE); continue; }
    const [dx, dz] = lower[0];
    const k = dz ? `x|${z}|${y}|${dz}` : `z|${x}|${y}|${dx}`;
    if (!slopeCells.has(k)) slopeCells.set(k, []);
    slopeCells.get(k).push(dz ? x : z);
  }
  for (const [k, ls] of slopeCells) {
    const [axis, u, y, dir] = k.split('|');
    ls.sort((a, b) => a - b);
    let s0 = ls[0], prev = ls[0];
    for (let i = 1; i <= ls.length; i++) {
      if (i < ls.length && ls[i] === prev + 1) { prev = ls[i]; continue; }
      W.slope(axis, +u, s0, prev, +y, +dir, roof);
      if (i < ls.length) { s0 = prev = ls[i]; }
    }
  }
  if (o.chimneys > 0) {
    const inner = list.filter(([x, z]) => level.get(x + ',' + z) >= 2 && has(x + 1, z) && has(x, z + 1) && has(x + 1, z + 1));
    if (inner.length) { const [x, z] = pick(inner); chimney(W, x, z, H, H + maxL + 1, o.chimney ?? wall); }
  }
}

// Building shaped by measured heights: plan.top gives the roof layer of every stud (see roofs.js). Outline studs
// are wall up to the roof (so gable ends come out stepped up to the ridge), inner studs get a wall only where
// they stand clear above a lower neighbour (the main house above an extension), and every stud is capped with a
// slope facing downhill or a flat tile.
export function lidarBuilding(W, { cells, top, roofCol, wallCol }, o = {}) {
  const has = (x, z) => cells.has(x + ',' + z);
  const T = (x, z) => top.get(x + ',' + z);
  const RC = (x, z) => roofCol?.get(x + ',' + z) ?? o.roof ?? PAL.dbg;   // roof colour per stud (several materials)
  const list = [...cells].map(k => k.split(',').map(Number));
  const wall = o.wall ?? PAL.darkOrange, plinth = o.plinth ?? PAL.dbg;
  const isB = (x, z) => N4.some(([dx, dz]) => !has(x + dx, z + dz));
  const slopeCells = new Map(); // "axis|u|y|dir|colour" -> [l...]
  for (const [x, z] of list) {
    const t = T(x, z), inside = N4.filter(([dx, dz]) => has(x + dx, z + dz));
    const y0 = isB(x, z) ? 0 : Math.min(...inside.map(([dx, dz]) => T(x + dx, z + dz) + 1));
    const wc = wallCol?.get(x + ',' + z) ?? wall;
    for (let y = y0; y < t; y++) W.set(x, y, z, y === 0 ? plinth : y < 6 && o.groundWall ? o.groundWall : wc);
    if (y0 > 0) W.set(x, 0, z, PAL.reddishBrown, F_TILE | F_NOCOLLIDE);
    if (o.quoins && N4.filter(([dx, dz]) => !has(x + dx, z + dz)).length === 2) for (let y = 1; y < t; y += 2) W.set(x, y, z, o.quoins);
    // downhill: the roof's own slope first, then off the edge of the building, then down a step
    const down = inside.find(([dx, dz]) => T(x + dx, z + dz) === t - 1) ?? N4.find(([dx, dz]) => !has(x + dx, z + dz))
      ?? inside.filter(([dx, dz]) => T(x + dx, z + dz) < t).sort((p, q) => T(x + p[0], z + p[1]) - T(x + q[0], z + q[1]))[0];
    if (!down) { W.set(x, t, z, RC(x, z), F_TILE); continue; }
    const [dx, dz] = down;
    const k = (dz ? `x|${z}|${t}|${dz}` : `z|${x}|${t}|${dx}`) + '|' + RC(x, z);
    if (!slopeCells.has(k)) slopeCells.set(k, []);
    slopeCells.get(k).push(dz ? x : z);
  }
  for (const [k, ls] of slopeCells) {
    const [axis, u, y, dir, c] = k.split('|');
    ls.sort((a, b) => a - b);
    let s0 = ls[0], prev = ls[0];
    for (let i = 1; i <= ls.length; i++) {
      if (i < ls.length && ls[i] === prev + 1) { prev = ls[i]; continue; }
      W.slope(axis, +u, s0, prev, +y, +dir, +c);
      if (i < ls.length) { s0 = prev = ls[i]; }
    }
  }

  // windows on each storey wherever the wall run is tall enough, door on the longest front run
  const runs = [];
  for (const [dx, dz] of N4) {
    const face = list.filter(([x, z]) => !has(x + dx, z + dz));
    const along = dz ? 0 : 1;
    const key = (p) => p[1 - along] * 10000 + p[along];
    face.sort((p, q) => key(p) - key(q));
    let cur = null;
    for (const p of face) {
      if (cur && p[1 - along] === cur.fixed && p[along] === cur.end + 1) cur.end++;
      else { cur = { dx, dz, fixed: p[1 - along], start: p[along], end: p[along] }; runs.push(cur); }
    }
  }
  const tallAt = (r, a, y) => [a, a + 1].every(v => (r.dz ? T(v, r.fixed) : T(r.fixed, v)) > y);
  const [ddx, ddz] = o.doorDir ?? [0, -1];
  const frontRuns = runs.filter(r => r.dx === ddx && r.dz === ddz).sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const doorRun = frontRuns[0] ?? [...runs].sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  // a position along a run, as a fraction 0..1 from the left as seen from outside, to a 2-stud slot
  const slotAt = (r, f) => {
    // facing a south (+z) face the viewer's right is +x; facing north it is -x, east -z, west +z
    const len = r.end - r.start + 1, rev = (r.dz ? r.dz : -r.dx) < 0;
    const a = Math.round(f * (len - 2));
    return Math.max(r.start, Math.min(r.end - 1, rev ? r.end - 1 - a : r.start + a));
  };
  for (const r of runs) {
    const axis = r.dz ? 'x' : 'z';
    if (r.end - r.start + 1 < 5) continue;
    let slots = [];
    for (let a = r.start + 2; a + 2 <= r.end - 1; a += 4) slots.push(a);
    let doors = r === doorRun ? [slots[Math.floor(slots.length / 2)]] : [];
    let upper = slots;
    // garage doors seen on the front ([fraction, colour, 2 for a double]), clear of the ground-floor windows and door
    const garages = r === doorRun && o.garages ? o.garages.map(([f, c, n]) => {
      const w = n === 2 ? 7 : 4, s = slotAt(r, f);
      return { a0: Math.max(r.start, Math.min(r.end - w + 1, s + 1 - (w >> 1))), w, c };
    }) : [];
    const inGarage = (a) => garages.some(g => a + 1 >= g.a0 - 1 && a <= g.a0 + g.w);
    // the surveyed front: doors where they were seen, and that many windows on each floor, evenly spaced
    if (r === doorRun && o.doorAt) doors = o.doorAt.map(f => slotAt(r, f));
    doors = doors.filter(d => d === undefined || !inGarage(d));
    if (r === doorRun && o.frontWindows) {
      // a count spaces that many windows evenly; a list gives each one's place (fractions, left to right)
      const even = (n) => Array.isArray(n) ? n.map(f => slotAt(r, f)) : Array.from({ length: n }, (_, k) => slotAt(r, (k + 0.5) / n));
      const [g, u] = o.frontWindows;
      slots = even(g).filter(a => doors.every(d => Math.abs(a - d) >= 3));
      // upstairs windows share out the stretch of the front that has an upper storey (not a lower wing's)
      const tall = [];
      for (let a = r.start; a < r.end; a++) if (tallAt(r, a, 10)) tall.push(a);
      upper = !Array.isArray(u) && tall.length && tall.length < r.end - r.start ? Array.from({ length: u }, (_, k) => tall[Math.floor((k + 0.5) / u * tall.length)]) : even(u);
      if (garages.length && !Array.isArray(g)) {
        // the ground-floor windows share out what the garage doors leave of the front
        const free = [];
        for (let a = r.start; a < r.end; a++) if (!inGarage(a) && doors.every(d => Math.abs(a - d) >= 3)) free.push(a);
        slots = Array.from({ length: g }, (_, k) => free[Math.floor((k + 0.5) / g * free.length)]).filter(a => a !== undefined);
      }
    }
    if (o.windows !== false) for (let f = 0; f < 3; f++) for (const a of f === 0 ? slots : upper) {
      if ((f === 0 && (doors.includes(a) || inGarage(a))) || !tallAt(r, a, f * 6 + 4)) continue;
      windowIn(W, axis, r.fixed, a, 2, f * 6 + 2, 3, { frame: o.frame, lintel: o.lintel });
    }
    for (const g of garages) {
      let ok = true; for (let a = g.a0; a + 1 < g.a0 + g.w; a++) ok &&= tallAt(r, a, 5);
      if (ok) garageDoorIn(W, axis, r.fixed, g.a0, g.w, 5, { color: g.c, frame: o.frame });
    }
    for (const doorSlot of doors) {
      if (doorSlot === undefined) continue;
      const big = o.windows === false, d0 = big ? doorSlot - 1 : doorSlot;
      if (!tallAt(r, d0, 5) || (big && !tallAt(r, d0 + 2, 5))) continue;
      doorIn(W, axis, r.fixed, d0, big ? 4 : 2, 5, { outward: r.dz || r.dx, color: o.door, frame: o.frame });
      if (o.canopy && !big) canopy(W, r, d0, o.canopy, o.roof ?? PAL.dbg, wall, has);
    }
  }

  // chimneys where they were surveyed (2x2 stacks, nudged inside the building), else on the ridge of a pitched roof
  for (let [x, z] of o.chimneyAt ?? []) {
    const fits = (x, z) => [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dz]) => has(x + dx, z + dz));
    const near = [[0, 0], [0, -1], [-1, 0], [-1, -1], [0, 1], [1, 0], [1, 1]].map(([dx, dz]) => [x + dx, z + dz]).find(([a, b]) => fits(a, b));
    if (!near) continue;
    [x, z] = near;
    const t = Math.max(T(x, z), T(x + 1, z), T(x, z + 1), T(x + 1, z + 1));
    chimney(W, x, z, Math.min(T(x, z), T(x + 1, z), T(x, z + 1), T(x + 1, z + 1)), t + 2, o.chimney ?? wall);
  }
  const maxT = Math.max(...list.map(([x, z]) => T(x, z))), minT = Math.min(...list.map(([x, z]) => T(x, z)));
  if (!o.chimneyAt && o.chimneys !== 0 && maxT - minT >= 3) {
    const ridge = list.filter(([x, z]) => T(x, z) >= maxT - 1 && !isB(x, z) && has(x + 1, z) && has(x, z + 1) && has(x + 1, z + 1))
      .sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const n = Math.min(ridge.length, o.chimneys ?? 0);
    for (const [x, z] of n === 2 ? [ridge[0], ridge[ridge.length - 1]] : ridge.length ? [pick(ridge)] : []) {
      const t = T(x, z);
      chimney(W, x, z, t - 1, t + 2, o.chimney ?? wall);
    }
  }
}

// A small roof over the door at slot d0 (2 studs) of wall run r: 'gable' (a little pitched roof standing two studs
// out, its gable to the street) or 'lean' (one row of slopes falling away from the wall). Left off where it would
// run into the building.
function canopy(W, r, d0, kind, roof, wall, has) {
  const out = r.dz || r.dx, c1 = r.fixed + out, c2 = r.fixed + 2 * out, lo = Math.min(c1, c2), hi = Math.max(c1, c2);
  const xz = (a, c) => (r.dz ? [a, c] : [c, a]);   // (along the wall, out from it) -> (x, z)
  const Y = 5;   // just above the 5-brick door
  const free = (a0, a1, cs) => { for (let a = a0; a <= a1; a++) for (const c of cs) if (has(...xz(a, c))) return false; return true; };
  if (!free(d0 - 1, d0 + 2, [c1, c2])) {
    // hard by a corner: a narrow lean-to over the door alone, if even that fits
    if (free(d0, d0 + 1, [c1])) W.slope(r.dz ? 'x' : 'z', c1, d0, d0 + 1, Y, out, roof);
    return;
  }
  if (kind === 'lean') { W.slope(r.dz ? 'x' : 'z', c1, d0 - 1, d0 + 2, Y, out, roof); return; }
  // gable: slopes run out from the wall and fall along it, rising one brick from each side to the ridge
  const along = r.dz ? 'z' : 'x';
  for (const [a, y, dir] of [[d0 - 1, Y, -1], [d0, Y + 1, -1], [d0 + 1, Y + 1, 1], [d0 + 2, Y, 1]]) W.slope(along, a, lo, hi, y, dir, roof);
  for (const a of [d0, d0 + 1]) for (const c of [c1, c2]) { const [x, z] = xz(a, c); W.set(x, Y, z, wall); }
}

export function houseStyle(zone) {
  const S = STYLES[zone] ?? STYLES.old;
  return { wall: S.wall, roof: S.roof, floors: 2 };
}

export { sign };
