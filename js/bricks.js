// Brick engine: voxel world -> merged LEGO-style brick geometry.
// Units: 1 stud pitch = 1 unit. Brick height = 1.2, plate = 0.4.
import * as THREE from 'three';

export const BRICK = 1.2;
export const PLATE = 0.4;
const GAP = 0.012;     // half-gap between neighbouring bricks
const CHAMFER = 0.035; // edge bevel

// Approximate official LEGO colours
export const PAL = {
  green: 0x4b9f4a, darkGreen: 0x184632, sandGreen: 0xa0bcac, lime: 0xa5ca18, olive: 0x9b9a5a,
  tan: 0xe4cd9e, darkTan: 0x958a73, brown: 0x583927, reddishBrown: 0x582a12, nougat: 0xaa7d55,
  red: 0xc91a09, darkRed: 0x720e0f, darkOrange: 0xa95500, orange: 0xfe8a18, darkNougat: 0xad6140,
  white: 0xf4f4f0, lbg: 0xa0a5a9, dbg: 0x6c6e68, black: 0x1b2a34, yellow: 0xf2cd37,
  brightLightYellow: 0xfff03a, blue: 0x0055bf, darkBlue: 0x0a3463, sandBlue: 0x6074a1,
  mediumBlue: 0x5a93db, pearlGold: 0xaa7f2e, flesh: 0xf6d7b3, warmYellow: 0xf2cd37,
};

const colCache = new Map();
export function col(hex) {
  let c = colCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colCache.set(hex, c); }
  return c;
}

// Deterministic RNG so the village is the same every load
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const jitterRand = rng(1234);

// ---------------------------------------------------------------- mesh builder
export class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.n = 0; }

  // Adds a convex planar polygon; orientation fixed so its normal faces away from `center`.
  poly(pts, c, center) {
    const [a, b, d] = pts;
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    let cx = 0, cy = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= pts.length; cy /= pts.length; cz /= pts.length;
    if (nx * (cx - center[0]) + ny * (cy - center[1]) + nz * (cz - center[2]) < 0) {
      pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz;
    }
    const base = this.n;
    for (const p of pts) {
      this.pos.push(p[0], p[1], p[2]); this.nor.push(nx, ny, nz); this.col.push(c.r, c.g, c.b); this.n++;
    }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  // Chamfered box between min and max corners. Small gaps make seams visible.
  box(x0, y0, z0, x1, y1, z1, c, opt = {}) {
    const g = opt.gap ?? GAP;
    x0 += g; z0 += g; x1 -= g; z1 -= g; y1 -= opt.noYGap ? 0 : g * 0.5;
    if (opt.jitter !== false) c = jitter(c, opt.jitterAmt ?? 0.035);
    const ctr = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const h = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
    const ch = Math.min(opt.chamfer ?? CHAMFER, h[0] * 0.45, h[1] * 0.45, h[2] * 0.45);
    if (ch <= 0.001) return this.plainBox(ctr, h, c);
    const P = (k, s) => {
      const v = [0, 0, 0];
      for (let i = 0; i < 3; i++) v[i] = ctr[i] + s[i] * (i === k ? h[i] : h[i] - ch);
      return v;
    };
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 3; k++) {
      const b = (k + 1) % 3, t = (k + 2) % 3;
      for (const sk of [-1, 1]) {
        if (opt.skipBottom && k === 1 && sk === -1) continue;
        this.poly(ring.map(([sb, st]) => { const s = []; s[k] = sk; s[b] = sb; s[t] = st; return P(k, s); }), c, ctr);
      }
    }
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
      const t = 3 - a - b;
      for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
        const S = (st) => { const s = []; s[a] = sa; s[b] = sb; s[t] = st; return s; };
        this.poly([P(a, S(-1)), P(a, S(1)), P(b, S(1)), P(b, S(-1))], c, ctr);
      }
    }
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const s = [sx, sy, sz];
      this.poly([P(0, s), P(1, s), P(2, s)], c, ctr);
    }
  }

  plainBox(ctr, h, c) {
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 3; k++) {
      const b = (k + 1) % 3, t = (k + 2) % 3;
      for (const sk of [-1, 1]) {
        this.poly(ring.map(([sb, st]) => { const v = []; v[k] = ctr[k] + sk * h[k]; v[b] = ctr[b] + sb * h[b]; v[t] = ctr[t] + st * h[t]; return v; }), c, ctr);
      }
    }
  }

  // Extruded convex profile. prof: [[u, y]...] in the u/y plane; extruded along `axis` ('x'|'z').
  // u maps to the perpendicular horizontal axis.
  prism(prof, axis, l0, l1, c, opt = {}) {
    if (opt.jitter !== false) c = jitter(c, 0.03);
    const W = (u, y, l) => axis === 'x' ? [l, y, u] : [u, y, l];
    let cu = 0, cy = 0;
    for (const [u, y] of prof) { cu += u; cy += y; }
    cu /= prof.length; cy /= prof.length;
    const ctr = W(cu, cy, (l0 + l1) / 2);
    const n = prof.length;
    for (let i = 0; i < n; i++) {
      const p = prof[i], q = prof[(i + 1) % n];
      this.poly([W(p[0], p[1], l0), W(q[0], q[1], l0), W(q[0], q[1], l1), W(p[0], p[1], l1)], c, ctr);
    }
    this.poly(prof.map(([u, y]) => W(u, y, l0)), c, ctr);
    this.poly(prof.map(([u, y]) => W(u, y, l1)), c, ctr);
  }

  // Merge a three.js geometry with a transform
  geom(g, m, c, opt = {}) {
    if (opt.jitter !== false) c = jitter(c, 0.02);
    const gi = g.index ? g : null;
    const p = g.attributes.position, nn = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    const base = this.n;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      w.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nor.push(w.x, w.y, w.z); this.col.push(c.r, c.g, c.b); this.n++;
    }
    if (gi) for (let i = 0; i < gi.index.count; i++) this.idx.push(base + gi.index.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

function jitter(c, amt) {
  const k = 1 + (jitterRand() - 0.5) * amt;
  return { r: c.r * k, g: c.g * k, b: c.b * k };
}

// ---------------------------------------------------------------- voxel world
export const F_TILE = 1 << 24;   // smooth top, no stud
export const F_HIDDEN = 1 << 25; // occupies space (collision / no studs below) but not drawn as a brick
export const F_NOCOLLIDE = 1 << 26;
export const F_PLAIN = 1 << 27;    // foliage: plain (un-bevelled) bricks, much cheaper to draw
const OFF = 2048, SPAN = 4096, SPAN2 = SPAN * SPAN;

export class World {
  constructor() {
    this.vox = new Map();       // key -> hex | flags
    this.ground = new Map();    // "x,z" cell -> {c, h (plates), stud}
    this.slopes = [];           // slope runs
    this.extras = [];           // fn(builders) for special parts
    this.studs = [];            // explicit studs [x,y,z,hex]
    this.glass = [];            // [x0,y0,z0,x1,y1,z1,hex,opacity]
    this.labels = [];           // {name, x, z, r}
    this.blockers = [];         // extra AABBs for collision {x0,z0,x1,z1,y1}
  }
  static key(x, y, z) { return ((y + 64) * SPAN + (z + OFF)) * SPAN + (x + OFF); }
  static decode(k) { return [(k % SPAN) - OFF, Math.floor(k / SPAN2) - 64, (Math.floor(k / SPAN) % SPAN) - OFF]; }
  set(x, y, z, hex, flags = 0) { this.vox.set(World.key(x, y, z), hex | flags); }
  del(x, y, z) { this.vox.delete(World.key(x, y, z)); }
  get(x, y, z) { return this.vox.get(World.key(x, y, z)); }
  has(x, y, z) { return this.vox.has(World.key(x, y, z)); }
  fill(x0, y0, z0, x1, y1, z1, hex, flags = 0) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, hex, flags);
  }
  clear(x0, y0, z0, x1, y1, z1) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.del(x, y, z);
  }
  setGround(x, z, hex, h = 0, stud = true) { this.ground.set(x + ',' + z, { c: hex, h, stud }); }
  groundAt(x, z) { return this.ground.get(x + ',' + z); }
  groundRect(x0, z0, x1, z1, hex, h = 0, stud = true) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.setGround(x, z, hex, h, stud);
  }
  // Solid voxel test (for collision) at integer cell and brick layer
  solid(x, y, z) {
    const v = this.vox.get(World.key(x, y, z));
    return v !== undefined && !(v & F_NOCOLLIDE);
  }
  // Slope run: cells along `axis` from l0..l1 (inclusive) at across-cell `u`, layer y, facing dir (+1/-1 across axis)
  slope(axis, u, l0, l1, y, dir, hex) {
    this.slopes.push({ axis, u, l0, l1, y, dir, hex });
    for (let l = l0; l <= l1; l++) {
      const [x, z] = axis === 'x' ? [l, u] : [u, l];
      if (!this.has(x, y, z)) this.set(x, y, z, hex, F_HIDDEN);
    }
  }
}

// ---------------------------------------------------------------- build meshes
const CHUNK = 32;
const PLAIN = { chamfer: 0 };
const ck = (x, z) => Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);

class ChunkSet {
  constructor() { this.m = new Map(); }
  get(x, z) { const k = ck(x, z); let b = this.m.get(k); if (!b) { b = new Builder(); this.m.set(k, b); } return b; }
}

// Split [s, s+len) at bond breaks (staggered every course) with bricks of max length 4
function splitRun(s, len, y, phase) {
  const out = []; let a = s;
  for (let x = s + 1; x <= s + len; x++) {
    const brk = x === s + len || ((x + phase + (y & 1) * 2) & 3) === 0;
    if (brk) {
      if (x - a === 1 && out.length && out[out.length - 1][1] - out[out.length - 1][0] < 4 && x !== s + len) { /* keep 1x1 */ }
      out.push([a, x]); a = x;
    }
  }
  // merge stray singles into neighbours where possible (looks more like real building)
  for (let i = 0; i < out.length; i++) {
    const [a0, a1] = out[i];
    if (a1 - a0 === 1) {
      if (i > 0 && out[i - 1][1] - out[i - 1][0] < 4) { out[i - 1][1] = a1; out.splice(i, 1); i--; }
      else if (i < out.length - 1 && out[i + 1][1] - out[i + 1][0] < 4) { out[i + 1][0] = a0; out.splice(i, 1); i--; }
    }
  }
  return out;
}

// Wraps a Builder so everything added to it is raised by dy (used to sit parts on terrain)
class Shifted {
  constructor(b, dy) { this.b = b; this.dy = dy; }
  box(x0, y0, z0, x1, y1, z1, c, o) { this.b.box(x0, y0 + this.dy, z0, x1, y1 + this.dy, z1, c, o); }
  plainBox(ctr, h, c) { this.b.plainBox([ctr[0], ctr[1] + this.dy, ctr[2]], h, c); }
  poly(pts, c, ctr) { this.b.poly(pts.map(p => [p[0], p[1] + this.dy, p[2]]), c, [ctr[0], ctr[1] + this.dy, ctr[2]]); }
  prism(prof, axis, l0, l1, c, o) { this.b.prism(prof.map(([u, y]) => [u, y + this.dy]), axis, l0, l1, c, o); }
  geom(g, m, c, o) { this.b.geom(g, new THREE.Matrix4().makeTranslation(0, this.dy, 0).multiply(m), c, o); }
}
// Glass builder that raises each box by the terrain height under its centre
class TerrainGlass {
  constructor(b, baseAt) { this.b = b; this.baseAt = baseAt; }
  box(x0, y0, z0, x1, y1, z1, c, o) { const dy = this.baseAt((x0 + x1) / 2, (z0 + z1) / 2); this.b.box(x0, y0 + dy, z0, x1, y1 + dy, z1, c, o); }
}

export function buildWorld(world) {
  const bricks = new ChunkSet();
  // optional per-column ground height (world.baseAt(x, z) in units); local building worlds have none
  const baseAt = world.baseAt ? (x, z) => world.baseAt(Math.floor(x), Math.floor(z)) : () => 0;
  const studs = new Map(); // chunk -> [x,y,z,hex]
  const addStud = (x, y, z, hex) => {
    const k = ck(x, z); let a = studs.get(k); if (!a) { a = []; studs.set(k, a); } a.push(x, y, z, hex);
  };

  // --- voxels grouped by layer (numeric keys: xz = (z+OFF)*SPAN + (x+OFF))
  const layers = new Map();
  for (const [k, v] of world.vox) {
    const y = Math.floor(k / SPAN2) - 64;
    let L = layers.get(y); if (!L) { L = new Map(); layers.set(y, L); }
    L.set(k - (y + 64) * SPAN2, v);
  }
  const X = (k) => (k % SPAN) - OFF, Z = (k) => Math.floor(k / SPAN) - OFF;
  const hexOf = (v) => v & 0xffffff;
  const drawable = (v) => v !== undefined && !(v & F_HIDDEN);
  for (const [y, L] of layers) {
    const used = new Set();
    const keys = [...L.keys()].sort((a, b) => a - b);
    const yb = y * BRICK;
    const same = (k, v, B) => L.get(k) === v && !used.has(k) && baseAt(X(k), Z(k)) === B;
    // pass 1: runs along x
    for (const k of keys) {
      const v = L.get(k);
      const x = X(k), z = Z(k), B = baseAt(x, z);
      if (!drawable(v) || used.has(k) || same(k - 1, v, B)) continue;
      let e = k; while (same(e + 1, v, B)) e++;
      if (e === k) continue;
      for (let i = k; i <= e; i++) used.add(i);
      for (const [a, b] of splitRun(x, e - k + 1, y, z & 1)) bricks.get(a, z).box(a, yb + B, z, b, yb + BRICK + B, z + 1, col(hexOf(v)), (v & F_PLAIN) ? PLAIN : undefined);
    }
    // pass 2: runs along z
    for (const k of keys) {
      const v = L.get(k);
      const x = X(k), z = Z(k), B = baseAt(x, z);
      if (!drawable(v) || used.has(k) || same(k - SPAN, v, B)) continue;
      let e = k, n = 1; while (same(e + SPAN, v, B)) { e += SPAN; n++; }
      for (let i = k; i <= e; i += SPAN) used.add(i);
      for (const [a, b] of splitRun(z, n, y, (x & 1) + 1)) bricks.get(x, a).box(x, yb + B, a, x + 1, yb + BRICK + B, b, col(hexOf(v)), (v & F_PLAIN) ? PLAIN : undefined);
    }
    // studs on exposed tops
    const base = (y + 64) * SPAN2;
    for (const k of keys) {
      const v = L.get(k);
      if (!drawable(v) || (v & F_TILE)) continue;
      if (world.vox.has(base + SPAN2 + k)) continue;
      addStud(X(k) + 0.5, (y + 1) * BRICK + baseAt(X(k), Z(k)), Z(k) + 0.5, hexOf(v));
    }
  }

  // --- slopes (45° roof bricks). Profile: low lip at outer edge, rising to full height on inner edge.
  for (const s of world.slopes) {
    const yb = s.y * BRICK + (s.axis === 'x' ? baseAt(s.l0, s.u) : baseAt(s.u, s.l0));
    const lowEdge = s.u + (s.dir > 0 ? 1 : 0);
    const A = (t) => lowEdge - s.dir * t; // t=0 outer (low), t=1 inner (high)
    const g = GAP;
    const prof = [[A(g), yb], [A(1 - g * 0), yb], [A(1 - g * 0), yb + BRICK - g * 0.5], [A(g), yb + 0.22]];
    for (const [a, b] of splitRun(s.l0, s.l1 - s.l0 + 1, s.y, s.u & 1)) {
      const bx = s.axis === 'x' ? a : s.u, bz = s.axis === 'x' ? s.u : a;
      bricks.get(bx, bz).prism(prof, s.axis, a + g, b - g, col(s.hex));
    }
  }

  // --- explicit studs
  for (let i = 0; i < world.studs.length; i++) { const [x, y, z, h] = world.studs[i]; addStud(x, y, z, h); }

  // --- custom parts
  const glass = new Builder();
  const tglass = world.baseAt ? new TerrainGlass(glass, baseAt) : glass;
  for (const fn of world.extras) fn({ at: world.baseAt ? (x, z) => new Shifted(bricks.get(x, z), baseAt(x, z)) : (x, z) => bricks.get(x, z), glass: tglass });
  for (const [x0, y0, z0, x1, y1, z1, hex] of world.glass) tglass.box(x0, y0, z0, x1, y1, z1, col(hex), { chamfer: 0.02, gap: 0.004 });

  // --- ground: raised tiles/plates and flat baseplate cells
  const groundB = new ChunkSet();   // flat baseplate quads (textured with stud pattern)
  const seen = new Set();
  const gkeys = [...world.ground.keys()].map(s => s.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, z] of gkeys) {
    const g = world.groundAt(x, z);
    if (g.stud && !world.has(x, 0, z)) addStud(x + 0.5, g.h * PLATE, z + 0.5, g.c);
    if (g.h > 0) groundB.get(x, z).poly([[x, 0.01, z], [x + 1, 0.01, z], [x + 1, 0.01, z + 1], [x, 0.01, z + 1]], col(PAL.dbg), [x, -1, z]);
  }
  // Merge ground cells into 2x2 tiles (raised) or quads (flat)
  for (const [x, z] of gkeys) {
    const k = x + ',' + z; if (seen.has(k)) continue;
    const g = world.groundAt(x, z);
    if (g.h === 0) {
      // greedy row merge for flat quads
      let e = x; while (true) { const n = world.groundAt(e + 1, z); if (!n || n.h !== 0 || n.c !== g.c || seen.has((e + 1) + ',' + z)) break; e++; }
      for (let i = x; i <= e; i++) seen.add(i + ',' + z);
      const c = col(g.c);
      const b = groundB.get(x, z);
      b.poly([[x, 0, z], [e + 1, 0, z], [e + 1, 0, z + 1], [x, 0, z + 1]], c, [x, -1, z]);
      continue;
    }
    // raised: 2x2 tiles where possible (dark underlay so seams never show daylight)
    const ok = (xx, zz) => { const n = world.groundAt(xx, zz); return n && n.h === g.h && n.c === g.c && n.stud === g.stud && !seen.has(xx + ',' + zz); };
    let w = 1, d = 1;
    const wantW = ((x & 1) === 0) ? 2 : 1, wantD = ((z & 1) === 0) ? 2 : 1;
    if (wantW === 2 && ok(x + 1, z)) w = 2;
    if (wantD === 2 && ok(x, z + 1) && (w === 1 || ok(x + 1, z + 1))) d = 2;
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) seen.add((x + i) + ',' + (z + j));
    bricks.get(x, z).box(x, 0, z, x + w, g.h * PLATE, z + d, col(g.c), { chamfer: 0.025, skipBottom: true, jitterAmt: 0.02 });
  }

  return { bricks: bricks.m, ground: groundB.m, studs, glass };
}

// Stud geometry with a slightly rounded top edge (catches the light like the real thing)
export function studGeometry(segments = 14, bevel = true) {
  const pts = bevel
    ? [new THREE.Vector2(0.3, 0), new THREE.Vector2(0.3, 0.16), new THREE.Vector2(0.265, 0.2), new THREE.Vector2(0, 0.2)]
    : [new THREE.Vector2(0.3, 0), new THREE.Vector2(0.3, 0.2), new THREE.Vector2(0, 0.2)];
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

// Canvas texture showing a stud from above; used on the flat baseplate so distant ground still reads as LEGO
export function studTexture(renderer) {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, S, S);
  const r = S * 0.3;
  // contact shadow
  const sh = x.createRadialGradient(S * 0.56, S * 0.56, r * 0.9, S * 0.56, S * 0.56, r * 1.35);
  sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = sh; x.beginPath(); x.arc(S * 0.56, S * 0.56, r * 1.35, 0, Math.PI * 2); x.fill();
  // stud top
  const tg = x.createLinearGradient(S * 0.3, S * 0.3, S * 0.7, S * 0.7);
  tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#d8d8d8');
  x.fillStyle = tg; x.beginPath(); x.arc(S / 2, S / 2, r, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 2; x.beginPath(); x.arc(S / 2, S / 2, r - 2, Math.PI * 0.9, Math.PI * 1.6); x.stroke();
  // faint seam lines
  x.strokeStyle = 'rgba(0,0,0,0.06)'; x.lineWidth = 1; x.strokeRect(0.5, 0.5, S - 1, S - 1);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
