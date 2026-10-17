// The player's minifigure and the traffic on Newark Road
import * as THREE from 'three';
import { PAL, Builder, col } from './bricks.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const plastic = (hex, extra = {}) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.18, ...extra });

function faceTexture(kind = 'smile') {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#f2cd37'; x.fillRect(0, 0, 256, 128);
  const cx = 128;
  x.fillStyle = '#1b1b1b';
  x.beginPath(); x.ellipse(cx - 16, 52, 5, 8, 0, 0, Math.PI * 2); x.fill();
  x.beginPath(); x.ellipse(cx + 16, 52, 5, 8, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(cx - 14.5, 49, 1.8, 0, 7); x.arc(cx + 17.5, 49, 1.8, 0, 7); x.fill();
  x.strokeStyle = '#1b1b1b'; x.lineWidth = 4; x.lineCap = 'round';
  if (kind === 'beard') { x.fillStyle = '#5b3a1e'; x.beginPath(); x.ellipse(cx, 92, 30, 18, 0, 0, Math.PI); x.fill(); }
  x.beginPath(); x.arc(cx, 70, 20, 0.2 * Math.PI, 0.8 * Math.PI); x.stroke();
  if (kind === 'glasses') { x.lineWidth = 3; x.strokeRect(cx - 28, 42, 22, 18); x.strokeRect(cx + 6, 42, 22, 18); x.beginPath(); x.moveTo(cx - 6, 50); x.lineTo(cx + 6, 50); x.stroke(); }
  if (kind === 'lips') { x.fillStyle = '#c0392b'; x.beginPath(); x.ellipse(cx, 76, 10, 4, 0, 0, Math.PI * 2); x.fill(); x.lineWidth = 2; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(cx + s * 12, 44); x.lineTo(cx + s * 22, 40); x.stroke(); } }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function torsoTexture(base, kind) {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
  const x = cv.getContext('2d');
  x.fillStyle = '#' + new THREE.Color(base).getHexString(); x.fillRect(0, 0, 128, 128);
  x.strokeStyle = 'rgba(0,0,0,0.55)'; x.fillStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 3;
  if (kind === 'vicar') { x.fillStyle = '#fff'; x.fillRect(52, 0, 24, 10); }
  else if (kind === 'shirt') { x.beginPath(); x.moveTo(44, 0); x.lineTo(64, 24); x.lineTo(84, 0); x.stroke(); for (let i = 0; i < 4; i++) { x.beginPath(); x.arc(64, 34 + i * 22, 3, 0, 7); x.fill(); } }
  else if (kind === 'jacket') { x.fillStyle = '#eee'; x.beginPath(); x.moveTo(48, 0); x.lineTo(64, 40); x.lineTo(80, 0); x.fill(); x.fillStyle = '#b22'; x.fillRect(60, 6, 8, 34); x.beginPath(); x.moveTo(40, 0); x.lineTo(64, 128); x.moveTo(88, 0); x.lineTo(64, 128); x.stroke(); }
  else if (kind === 'overalls') { x.fillStyle = 'rgba(30,60,140,0.95)'; x.fillRect(30, 50, 68, 78); x.fillRect(34, 0, 12, 50); x.fillRect(82, 0, 12, 50); x.fillStyle = '#f2cd37'; x.beginPath(); x.arc(40, 52, 4, 0, 7); x.arc(88, 52, 4, 0, 7); x.fill(); }
  else if (kind === 'hivis') { x.fillStyle = '#c8e81a'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#ddd'; x.fillRect(0, 70, 128, 12); x.fillRect(30, 0, 12, 128); x.fillRect(86, 0, 12, 128); }
  else { x.beginPath(); x.moveTo(50, 0); x.quadraticCurveTo(64, 18, 78, 0); x.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const geoCache = {};
function torsoGeo() {
  if (geoCache.torso) return geoCache.torso;
  const g = new THREE.BoxGeometry(1.95, 1.6, 0.85, 1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) p.setX(i, p.getX(i) * 0.76);
  g.computeVertexNormals();
  return (geoCache.torso = g);
}

// Minifig, facing +z. Origin at the feet.
export function makeMinifig(o = {}) {
  const root = new THREE.Group();
  const skin = plastic(PAL.yellow);
  const legM = plastic(o.legs ?? PAL.darkBlue), hipM = plastic(o.hips ?? o.legs ?? PAL.darkBlue), shirt = o.torso ?? PAL.red;
  const armM = plastic(o.arms ?? shirt);
  const legs = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.48, 1.55, 0);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.45, 0.8), legM); leg.position.set(0, -0.73, -0.02);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.38, 0.25), legM); foot.position.set(0, -1.36, 0.48);
    pivot.add(leg, foot); root.add(pivot); legs.push(pivot);
  }
  const hips = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.35, 0.85), hipM); hips.position.y = 1.7; root.add(hips);
  const tm = plastic(shirt); const front = plastic(0xffffff, { map: torsoTexture(shirt, o.print) });
  const torso = new THREE.Mesh(torsoGeo(), [tm, tm, tm, tm, front, tm]); torso.position.y = 2.68; root.add(torso);
  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * 0.9, 3.25, 0); pivot.rotation.z = s * 0.12;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 1.25, 12), armM); arm.position.set(s * 0.12, -0.55, 0.05); arm.rotation.z = s * 0.1;
    const hand = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.35, 12), skin); hand.position.set(s * 0.2, -1.25, 0.25); hand.rotation.x = 0.6;
    pivot.add(arm, hand); root.add(pivot); arms.push(pivot);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 12), skin); neck.position.y = 3.55; root.add(neck);
  const faceM = plastic(0xffffff, { map: faceTexture(o.face) });
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.0, 28), [faceM, skin, skin]);
  head.position.y = 4.15; head.rotation.y = Math.PI; root.add(head);
  const stud = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14), skin); stud.position.y = 4.75; root.add(stud);
  if (o.hair !== undefined) {
    const hm = plastic(o.hair);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.66, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), hm);
    hair.scale.y = 0.75; hair.position.y = 4.5; root.add(hair);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.66, 0.7, 20, 1, true, Math.PI * 0.6, Math.PI * 0.8), hm);
    back.position.y = 4.2; back.material.side = THREE.DoubleSide; root.add(back);
  }
  if (o.helmet !== undefined) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.74, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), plastic(o.helmet));
    h.scale.y = 1.05; h.position.y = 4.15; root.add(h);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.745, 0.745, 0.42, 20, 1, true, -Math.PI * 0.32, Math.PI * 0.64), plastic(0x222222, { transparent: true, opacity: 0.75 }));
    visor.position.y = 4.2; root.add(visor);
  }
  if (o.cap !== undefined) {
    const cm = plastic(o.cap);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.64, 0.45, 20), cm); c.position.y = 4.8; root.add(c);
    const peak = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.5), cm); peak.position.set(0, 4.6, 0.75); root.add(peak);
  }
  root.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  root.userData = { legs, arms, phase: Math.random() * 6 };
  return root;
}

export function animateMinifig(fig, speed, dt) {
  const u = fig.userData;
  if (speed > 0.1) u.phase += dt * speed * 1.6; else u.phase *= 0.9;
  const a = speed > 0.1 ? Math.sin(u.phase) * Math.min(0.7, speed * 0.12) : 0;
  u.legs[0].rotation.x = a; u.legs[1].rotation.x = -a;
  u.arms[0].rotation.x = -a * 0.8; u.arms[1].rotation.x = a * 0.8;
}

// ---------------------------------------------------------------- traffic
// Vehicles face +x with their origin at road level, centred. Wheels are one vertex-coloured mesh each (tyre + hub).
let wheelGeo = null;
function wheelGeometry() {
  if (wheelGeo) return wheelGeo;
  const paint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const tyre = paint(new THREE.CylinderGeometry(1, 1, 0.9, 20), PAL.black), hub = paint(new THREE.CylinderGeometry(0.52, 0.52, 0.96, 12), PAL.lbg);
  return (wheelGeo = mergeGeometries([tyre, hub]).rotateX(Math.PI / 2));
}
const bodyMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.28, clearcoat: 0.5, clearcoatRoughness: 0.15 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x8fb4c4, roughness: 0.05, transparent: true, opacity: 0.55 });
const wheelMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55 });
// soft dark patch under each vehicle instead of a real shadow, so the shadow map needn't be redrawn as they move
let blobMat = null;
function blob(L, Wd) {
  if (!blobMat) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 8, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(L * 1.25, Wd * 1.5).rotateX(-Math.PI / 2), blobMat);
  m.position.y = 0.06; m.renderOrder = 1;
  return m;
}

function assemble(b, gl, wheels, L, Wd, r) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(b.toGeometry(), bodyMat); body.receiveShadow = true;
  const glass = new THREE.Mesh(gl.toGeometry(), glassMat); glass.renderOrder = 2;
  g.add(body, glass, blob(L, Wd));
  g.userData.wheels = wheels.map(([x, z]) => { const w = new THREE.Mesh(wheelGeometry(), wheelMat); w.scale.setScalar(r); w.position.set(x - L / 2, r, z); w.receiveShadow = true; g.add(w); return w; });
  g.userData.r = r; g.userData.L = L;
  return g;
}

// A LEGO car, `kind` 'hatch' or 'van'; the front (headlights) is at +x
export function makeCar(bodyHex, kind = 'hatch') {
  const b = new Builder(), gl = new Builder();
  const L = 10, Wd = 5, c = col(bodyHex), k = col(PAL.black), grey = col(PAL.lbg);
  const bx = (x0, y0, z0, x1, y1, z1, cc, o) => b.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, cc, o);
  const gb = (x0, y0, z0, x1, y1, z1) => gl.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, col(0xffffff), { chamfer: 0, gap: 0, jitter: false });
  const back = kind === 'van' ? 0 : 1.5, wind = 6.2;
  bx(0.5, 0.7, 0.4, L - 0.5, 1.2, Wd - 0.4, k);             // chassis plate
  bx(0, 1.2, 0, L, 2.4, Wd, c);                             // lower body
  bx(wind, 2.4, 0, L, 2.8, Wd, c);                          // bonnet
  if (back > 0) bx(0, 2.4, 0, back, 2.8, Wd, c);            // boot
  for (const [x0, y0, x1, y1, cc] of [[L - 0.05, 1.6, L + 0.1, 2.2, col(0xfff7d6)], [-0.1, 1.6, 0.05, 2.2, col(PAL.red)]]) {
    bx(x0, y0, 0.4, x1, y1, 1.3, cc, { chamfer: 0.02 }); bx(x0, y0, Wd - 1.3, x1, y1, Wd - 0.4, cc, { chamfer: 0.02 });
  }
  bx(-0.2, 1.2, 0, 0.2, 1.6, Wd, grey); bx(L - 0.2, 1.2, 0, L + 0.2, 1.6, Wd, grey);   // bumpers
  for (const x of [back, 3.8, wind - 0.4]) { bx(x, 2.8, 0, x + 0.4, 4.4, 0.4, c); bx(x, 2.8, Wd - 0.4, x + 0.4, 4.4, Wd, c); }
  bx(back, 4.4, 0, wind, 4.8, Wd, c);                       // roof
  bx(3, 2.4, 0.9, 4.4, 3.4, 2.3, k); bx(3, 2.4, 2.7, 4.4, 3.4, 4.1, k);                 // seats
  gb(wind, 2.8, 0.4, wind + 0.6, 4.4, Wd - 0.4);            // windscreen
  gb(back - 0.3, 2.8, 0.4, back, 4.4, Wd - 0.4);            // rear window
  gb(back + 0.4, 2.8, 0.1, wind - 0.4, 4.4, 0.3); gb(back + 0.4, 2.8, Wd - 0.3, wind - 0.4, 4.4, Wd - 0.1);
  const g = assemble(b, gl, [[2.2, -Wd / 2 + 0.3], [2.2, Wd / 2 - 0.3], [L - 2.2, -Wd / 2 + 0.3], [L - 2.2, Wd / 2 - 0.3]], L, Wd, 1);
  g.userData.lamps = pairs(L / 2 + 0.15, 1.9, -L / 2 - 0.15, 1.9, Wd / 2 - 0.85);
  return g;
}
// head and tail lamps in pairs either side, for lighting up after dark (main.js adds the glows)
const pairs = (hx, hy, tx, ty, z) => ({ head: [[hx, hy, -z], [hx, hy, z]], tail: [[tx, ty, -z], [tx, ty, z]] });

// A cement mixer lorry: white cab at +x, a striped drum that turns as it drives
export function makeMixer() {
  const b = new Builder(), gl = new Builder();
  const L = 18, Wd = 5, cab = col(PAL.white), k = col(PAL.black), grey = col(PAL.lbg), dk = col(PAL.dbg);
  const bx = (x0, y0, z0, x1, y1, z1, cc, o) => b.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, cc, o);
  const gb = (x0, y0, z0, x1, y1, z1) => gl.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, col(0xffffff), { chamfer: 0, gap: 0, jitter: false });
  bx(0.4, 1.1, 0.6, L - 0.4, 1.7, Wd - 0.6, k);             // chassis
  bx(13.6, 1.7, 0, L, 3.8, Wd, cab);                        // cab lower
  for (const z of [0, Wd - 0.4]) { bx(13.6, 3.8, z, 14, 5.6, z + 0.4, cab); bx(L - 0.4, 3.8, z, L, 5.6, z + 0.4, cab); }
  bx(13.6, 5.6, 0, L, 6.2, Wd, cab);                        // cab roof
  bx(13.6, 3.8, 0.4, 14, 5.6, Wd - 0.4, cab);               // cab back wall
  gb(L - 0.4, 3.8, 0.4, L - 0.1, 5.6, Wd - 0.4);            // windscreen
  gb(14, 3.8, 0.05, L - 0.4, 5.6, 0.3); gb(14, 3.8, Wd - 0.3, L - 0.4, 5.6, Wd - 0.05);
  bx(L, 1.3, 0, L + 0.3, 2.1, Wd, grey);                    // bumper
  bx(L, 2.4, 0.4, L + 0.12, 3.0, 1.3, col(0xfff7d6), { chamfer: 0.02 }); bx(L, 2.4, Wd - 1.3, L + 0.12, 3.0, Wd - 0.4, col(0xfff7d6), { chamfer: 0.02 });
  bx(L - 0.1, 2.0, 1.6, L + 0.05, 3.4, Wd - 1.6, dk);       // grille
  bx(0.6, 1.7, 0.6, 13.6, 2.3, Wd - 0.6, dk);               // subframe
  bx(11.6, 2.3, 1.2, 12.6, 4.4, Wd - 1.2, grey);            // drum front stand
  bx(1.4, 2.3, 1.0, 2.6, 6.2, Wd - 1.0, grey);              // drum rear stand
  bx(0.2, 4.2, 1.9, 1.4, 4.6, Wd - 1.9, grey);              // chute
  bx(-0.4, 1.6, 0.6, 0.4, 2.2, Wd - 0.6, grey);             // rear bumper
  bx(-0.1, 2.3, 0.6, 0.05, 2.8, 1.3, col(PAL.red), { chamfer: 0.02 }); bx(-0.1, 2.3, Wd - 1.3, 0.05, 2.8, Wd - 0.6, col(PAL.red), { chamfer: 0.02 });
  for (const s of [0, Wd - 0.3]) bx(4, 1.7, s, 13.4, 2.0, s + 0.3, col(PAL.yellow), { chamfer: 0.02 });   // side guards
  const g = assemble(b, gl, [[3.4, -Wd / 2 + 0.4], [3.4, Wd / 2 - 0.4], [6.1, -Wd / 2 + 0.4], [6.1, Wd / 2 - 0.4], [15.6, -Wd / 2 + 0.4], [15.6, Wd / 2 - 0.4]], L, Wd, 1.25);
  // drum: a lathe turned about its own axis, tilted up towards the back, with a spiral stripe so you can see it turn
  const prof0 = [[0.3, -5.6], [1.15, -5.5], [1.5, -4.2], [2.2, -2.2], [2.45, -0.6], [2.45, 0.8], [2.1, 2.6], [1.3, 4.6], [0.5, 5.2], [0.2, 5.25]];
  const prof = [];
  for (let i = 0; i + 1 < prof0.length; i++) {
    const [r0, y0] = prof0[i], [r1, y1] = prof0[i + 1], n = Math.max(1, Math.round(Math.abs(y1 - y0) / 0.35));
    for (let k = 0; k < n; k++) prof.push(new THREE.Vector2(r0 + (r1 - r0) * k / n, y0 + (y1 - y0) * k / n));
  }
  prof.push(new THREE.Vector2(...prof0[prof0.length - 1]));
  const dg = new THREE.LatheGeometry(prof, 64).toNonIndexed();
  const p = dg.attributes.position, cc = new Float32Array(p.count * 3), o = new THREE.Color(PAL.orange), w = new THREE.Color(PAL.white);
  for (let i = 0; i < p.count; i += 3) {   // one colour per triangle, from its centre, so the stripe edges stay crisp
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += p.getX(i + k); y += p.getY(i + k); z += p.getZ(i + k); }
    const t = (Math.atan2(z, x) / (Math.PI * 2) + y / 3 * 0.09) * 2, c = t - Math.floor(t) < 0.3 ? w : o;
    for (let k = 0; k < 3; k++) cc.set([c.r, c.g, c.b], (i + k) * 3);
  }
  dg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  dg.rotateZ(-Math.PI / 2);                                // lathe axis y -> x, wide end towards the cab
  const drum = new THREE.Mesh(dg, bodyMat); drum.receiveShadow = true;
  const tilt = new THREE.Group(); tilt.position.set(7.2 - L / 2, 4.9, 0); tilt.rotation.z = -0.2;
  tilt.add(drum); g.add(tilt);
  g.userData.drum = drum;
  g.userData.lamps = pairs(L / 2 + 0.2, 2.7, -L / 2 - 0.15, 2.55, Wd / 2 - 0.95);
  return g;
}

// Lorries: a box lorry on two or three axles, or an articulated lorry (a tractor unit pulling a curtain-sided
// trailer, which follows the road round bends: userData.trailer is turned each frame, userData.back how far it
// reaches behind the tractor)
export function makeLorry(kind, cabHex, bodyHex) {
  const b = new Builder(), gl = new Builder();
  const artic = kind === 'artic', L = artic ? 9 : 17, Wd = 5, cab = col(cabHex), k = col(PAL.black), grey = col(PAL.lbg), dk = col(PAL.dbg);
  const bx = (x0, y0, z0, x1, y1, z1, cc, o) => b.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, cc, o);
  const gb = (x0, y0, z0, x1, y1, z1) => gl.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, col(0xffffff), { chamfer: 0, gap: 0, jitter: false });
  const c0 = L - 4.4;                                         // back of the cab
  bx(0.4, 1.1, 0.6, L - 0.4, 1.7, Wd - 0.6, k);               // chassis
  bx(c0, 1.7, 0, L, 3.8, Wd, cab);                            // cab lower
  for (const z of [0, Wd - 0.4]) { bx(c0, 3.8, z, c0 + 0.4, 5.8, z + 0.4, cab); bx(L - 0.4, 3.8, z, L, 5.8, z + 0.4, cab); }
  bx(c0, 5.8, 0, L, 6.6, Wd, cab);                            // cab roof
  bx(c0, 3.8, 0.4, c0 + 0.4, 5.8, Wd - 0.4, cab);
  gb(L - 0.4, 3.8, 0.4, L - 0.1, 5.8, Wd - 0.4);              // windscreen
  gb(c0 + 0.4, 3.8, 0.05, L - 0.4, 5.8, 0.3); gb(c0 + 0.4, 3.8, Wd - 0.3, L - 0.4, 5.8, Wd - 0.05);
  bx(L, 1.3, 0, L + 0.3, 2.1, Wd, grey);                      // bumper
  bx(L, 2.4, 0.4, L + 0.12, 3.0, 1.3, col(0xfff7d6), { chamfer: 0.02 }); bx(L, 2.4, Wd - 1.3, L + 0.12, 3.0, Wd - 0.4, col(0xfff7d6), { chamfer: 0.02 });
  bx(L - 0.1, 2.0, 1.6, L + 0.05, 3.4, Wd - 1.6, dk);         // grille
  let wheels;
  if (artic) {
    bx(1.0, 1.7, 1.2, 3.6, 2.0, Wd - 1.2, dk);                // fifth wheel
    for (const z of [0.6, Wd - 1.4]) bx(c0 - 0.6, 1.7, z, c0, 5.4, z + 0.8, dk);   // exhaust stacks behind the cab
    wheels = [[2.0, -Wd / 2 + 0.4], [2.0, Wd / 2 - 0.4], [L - 2.0, -Wd / 2 + 0.4], [L - 2.0, Wd / 2 - 0.4]];
  } else {
    const body = col(bodyHex);
    bx(0.2, 1.7, -0.1, c0 - 0.3, 7.4, Wd + 0.1, body);         // box body
    bx(-0.05, 1.8, 0.2, 0.2, 7.2, Wd - 0.2, grey);            // rear doors
    bx(-0.1, 2.3, 0.6, 0.05, 2.8, 1.3, col(PAL.red), { chamfer: 0.02 }); bx(-0.1, 2.3, Wd - 1.3, 0.05, 2.8, Wd - 0.6, col(PAL.red), { chamfer: 0.02 });
    wheels = [[3.0, -Wd / 2 + 0.4], [3.0, Wd / 2 - 0.4], [L - 2.4, -Wd / 2 + 0.4], [L - 2.4, Wd / 2 - 0.4]];
    if (kind === 'rigid3') wheels.push([5.4, -Wd / 2 + 0.4], [5.4, Wd / 2 - 0.4]);
  }
  const g = assemble(b, gl, wheels, L, Wd, 1.15);
  g.userData.lamps = pairs(L / 2 + 0.2, 2.7, -L / 2 - 0.15, 2.55, Wd / 2 - 0.95);
  if (!artic) return g;
  // the trailer, pivoting on the fifth wheel
  const T = 25, tb = new Builder(), body = col(bodyHex), side = col(PAL.lbg);
  const tx = (x0, y0, z0, x1, y1, z1, cc, o) => tb.box(x0 - T, y0, z0 - Wd / 2, x1 - T, y1, z1 - Wd / 2, cc, o);
  tx(0.4, 1.4, 0.6, T, 2.0, Wd - 0.6, k);                     // chassis
  tx(0, 2.0, -0.1, T, 2.5, Wd + 0.1, side);                   // floor
  tx(0, 2.5, -0.1, T, 7.2, Wd + 0.1, body);                   // curtain sides
  tx(0, 7.2, -0.1, T, 7.6, Wd + 0.1, side);                   // roof rail
  tx(-0.1, 2.6, 0.3, 0.1, 7.1, Wd - 0.3, side);               // rear doors
  tx(-0.15, 2.0, 0.6, 0.05, 2.5, 1.3, col(PAL.red), { chamfer: 0.02 }); tx(-0.15, 2.0, Wd - 1.3, 0.05, 2.5, Wd - 0.6, col(PAL.red), { chamfer: 0.02 });
  tx(9, 1.0, 0.8, 9.6, 2.0, Wd - 0.8, grey);                  // landing legs
  const trailer = new THREE.Group(); trailer.position.set(2.3 - L / 2, 0, 0);
  const tm = new THREE.Mesh(tb.toGeometry(), bodyMat); tm.receiveShadow = true; trailer.add(tm);
  const tb2 = blob(T, Wd); tb2.position.x = -T / 2; trailer.add(tb2);
  for (const x of [2.0, 4.4, 6.8]) for (const z of [-Wd / 2 + 0.4, Wd / 2 - 0.4]) {
    const w = new THREE.Mesh(wheelGeometry(), wheelMat); w.scale.setScalar(1.15); w.position.set(x - T, 1.15, z); trailer.add(w); g.userData.wheels.push(w);
  }
  g.add(trailer);
  Object.assign(g.userData, { trailer, pivot: L / 2 - 2.3, axle: T - 4.4, back: T - 2.3 });
  g.userData.lamps.tail = [[-T - 0.2, 2.25, -Wd / 2 + 0.95], [-T - 0.2, 2.25, Wd / 2 - 0.95]];   // in the trailer's frame
  return g;
}

// A single-deck bus: `livery` [lower, upper] colours and the destination display's text (none on a coach)
export function makeBus(livery, dest) {
  const b = new Builder(), gl = new Builder();
  const L = 24, Wd = 5.2, lo = col(livery[0]), up = col(livery[1]), k = col(PAL.black), grey = col(PAL.lbg);
  const bx = (x0, y0, z0, x1, y1, z1, cc, o) => b.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, cc, o);
  const gb = (x0, y0, z0, x1, y1, z1) => gl.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, col(0xffffff), { chamfer: 0, gap: 0, jitter: false });
  bx(0.6, 0.9, 0.6, L - 0.6, 1.5, Wd - 0.6, k);               // chassis
  bx(0, 1.5, 0, L, 3.4, Wd, lo);                              // lower panels
  // window pillars down each side, and the glass between them
  for (let x = 0; x <= L - 3; x += 3.4) for (const z of [0, Wd - 0.35]) bx(x, 3.4, z, x + 0.5, 6.6, z + 0.35, up);
  gb(0.5, 3.4, 0.05, L - 0.4, 6.6, 0.3); gb(0.5, 3.4, Wd - 0.3, L - 0.4, 6.6, Wd - 0.05);
  bx(0, 6.6, 0, L, 7.6, Wd, up);                              // roof
  bx(0, 3.4, 0.35, 0.4, 6.6, Wd - 0.35, up);                  // back
  gb(-0.05, 4.4, 0.6, 0.05, 6.2, Wd - 0.6);                   // rear window
  gb(L - 0.35, 2.2, 0.4, L - 0.05, 6.4, Wd - 0.4);            // windscreen, deep as on a low-floor bus
  bx(L - 0.4, 6.4, 0.3, L, 7.6, Wd - 0.3, k);                 // destination display surround
  bx(L, 1.4, 0, L + 0.25, 2.2, Wd, grey); bx(-0.25, 1.4, 0, 0, 2.2, Wd, grey);   // bumpers
  bx(L, 1.7, 0.4, L + 0.12, 2.2, 1.2, col(0xfff7d6), { chamfer: 0.02 }); bx(L, 1.7, Wd - 1.2, L + 0.12, 2.2, Wd - 0.4, col(0xfff7d6), { chamfer: 0.02 });
  bx(-0.1, 2.6, 0.4, 0.05, 3.2, 1.0, col(PAL.red), { chamfer: 0.02 }); bx(-0.1, 2.6, Wd - 1.0, 0.05, 3.2, Wd - 0.4, col(PAL.red), { chamfer: 0.02 });
  bx(L - 4.2, 1.5, -0.05, L - 1.2, 6.4, 0.05, col(0x2b3a44));   // entrance doors, on the nearside (the left, -z)
  const g = assemble(b, gl, [[4.4, -Wd / 2 + 0.4], [4.4, Wd / 2 - 0.4], [L - 4.6, -Wd / 2 + 0.4], [L - 4.6, Wd / 2 - 0.4]], L, Wd, 1.1);
  g.userData.lamps = pairs(L / 2 + 0.2, 1.95, -L / 2 - 0.15, 2.9, Wd / 2 - 0.8);
  if (dest) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 64;
    const x = cv.getContext('2d'); x.fillStyle = '#111'; x.fillRect(0, 0, 512, 64);
    x.fillStyle = '#ffb020'; x.font = 'bold 44px system-ui, sans-serif'; x.textBaseline = 'middle';
    const [num, ...rest] = dest.split(' ');
    x.fillText(num, 14, 34); x.font = 'bold 34px system-ui, sans-serif'; x.fillText(rest.join(' '), 120, 34, 380);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(Wd - 1.0, 0.85), new THREE.MeshBasicMaterial({ map: tex }));
    m.rotation.y = Math.PI / 2; m.position.set(L / 2 + 0.02, 7.0, 0); g.add(m);
  }
  return g;
}

// A motorbike and its rider
export function makeMotorbike(hex) {
  const b = new Builder(), gl = new Builder();
  const L = 5, Wd = 1.6, c = col(hex), k = col(PAL.black), grey = col(PAL.lbg);
  const bx = (x0, y0, z0, x1, y1, z1, cc, o) => b.box(x0 - L / 2, y0, z0 - Wd / 2, x1 - L / 2, y1, z1 - Wd / 2, cc, o);
  bx(1.2, 1.0, 0.45, 3.8, 1.8, 1.15, grey);                    // engine
  bx(1.0, 1.8, 0.3, 2.6, 2.3, 1.3, k);                         // seat
  bx(2.6, 1.8, 0.25, 3.9, 2.7, 1.35, c);                       // tank
  bx(3.8, 1.2, 0.5, 4.3, 3.4, 1.1, grey);                      // forks
  bx(3.9, 3.0, -0.4, 4.2, 3.2, 2.0, k);                        // handlebars
  bx(4.2, 2.6, 0.45, 4.6, 3.2, 1.15, col(0xfff7d6), { chamfer: 0.02 });   // headlamp
  bx(0.2, 1.6, 0.3, 1.2, 2.0, 1.3, c);                         // tail
  bx(0.05, 1.6, 0.55, 0.2, 1.9, 1.05, col(PAL.red), { chamfer: 0.02 });
  const g = assemble(b, gl, [[0.9, 0], [L - 0.9, 0]], L, Wd, 0.9);
  for (const w of g.userData.wheels) w.scale.set(0.9, 0.9, 0.35);
  const rider = makeMinifig({ torso: PAL.black, legs: PAL.black, arms: PAL.black, helmet: hex, print: 'plain' });
  rider.rotation.y = Math.PI / 2; rider.position.set(-0.7, 0.75, 0);
  for (const l of rider.userData.legs) l.rotation.x = -1.35;
  for (const a of rider.userData.arms) a.rotation.x = -1.1;
  rider.traverse(m => { if (m.isMesh) m.castShadow = false; });
  g.add(rider);
  g.userData.lamps = { head: [[2.2, 2.9, 0]], tail: [[-2.45, 1.75, 0]] };
  return g;
}
