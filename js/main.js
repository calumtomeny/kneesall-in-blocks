import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld, studGeometry, studTexture, Builder, World, BRICK, PLATE, PAL, col, rng, F_NOCOLLIDE } from './bricks.js';
import { buildKneesall, groundMeshes } from './osm.js';
import { polyCells, centroid, pointAlong, distToPolyline } from './geo.js';
import { makeMinifig, animateMinifig } from './actors.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('loading-text').textContent = t; };
const nextFrame = () => new Promise(r => { let done = false; const f = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(f); setTimeout(f, 60); });

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
window.__dbg = { renderer, scene, THREE };
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 3000);
window.__dbg.camera = camera;

// ------------------------------------------------------------------ sky, sun, environment
const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
const su = sky.material.uniforms;
su.turbidity.value = 4; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const SR = 70;
Object.assign(sun.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 1, far: 600 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5d7a3e, 0.55); scene.add(hemi);
scene.fog = new THREE.Fog(0xc9d9e8, 220, 1100);

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(1000); envScene.add(envSky);
let envRT = null;

const TIMES = [
  { name: 'Morning', elev: 16, az: 115, sunCol: 0xffe2b8, sunI: 2.6, hemiI: 0.45, fog: 0xd8dde4, exp: 0.8 },
  { name: 'Midday', elev: 48, az: 170, sunCol: 0xfff6e8, sunI: 3.2, hemiI: 0.55, fog: 0xc9d9e8, exp: 0.78 },
  { name: 'Late afternoon', elev: 24, az: 235, sunCol: 0xffe7c4, sunI: 2.9, hemiI: 0.5, fog: 0xd3dbe2, exp: 0.82 },
  { name: 'Golden hour', elev: 5, az: 268, sunCol: 0xffad5c, sunI: 2.2, hemiI: 0.35, fog: 0xe6c7a8, exp: 0.95 },
];
let timeIdx = 2;
const sunDir = new THREE.Vector3();
function applyTime() {
  const t = TIMES[timeIdx];
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - t.elev), THREE.MathUtils.degToRad(t.az));
  // azimuth: 180 = due south (+z)
  su.sunPosition.value.copy(sunDir);
  const eu = envSky.material.uniforms;
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = su[k].value;
  eu.sunPosition.value.copy(sunDir);
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(envScene, 0.02);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  sun.color.set(t.sunCol); sun.intensity = t.sunI; hemi.intensity = t.hemiI;
  scene.fog.color.set(t.fog); renderer.toneMappingExposure = t.exp;
  showToast(t.name);
}

// ------------------------------------------------------------------ materials
const brickMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.34, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.22, specularIntensity: 0.6 });
const studMat = new THREE.MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.2, specularIntensity: 0.6 });
// Ground uses a stud texture mapped in world space (1 repeat per stud) so distant baseplates still read as LEGO;
// real stud geometry is streamed in near the player.
const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, map: studTexture(renderer) });
groundMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vStudUv;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvStudUv = (modelMatrix * vec4(transformed, 1.0)).xz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vStudUv;')
    .replace('#include <map_fragment>', 'diffuseColor *= texture2D(map, vStudUv);');
};
const smoothMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.15, clearcoatRoughness: 0.3 });
const glassMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.62, envMapIntensity: 1.6, depthWrite: false, specularIntensity: 1 });

// ------------------------------------------------------------------ HUD helpers
let toastTimer = 0;
function showToast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('show'), 1800); }

// ------------------------------------------------------------------ build the village
let K, G, W, BOUNDS, studChunks = [], dynamic = { clouds: [] };
const groundStuds = new Map();
const stud = { hi: studGeometry(12, true), lo: studGeometry(6, false) };

// Turn a voxel World into meshes under `parent`; `place` (optional) maps local->world for LOD tests
function addWorldMeshes(world, parent, place) {
  const out = buildWorld(world);
  for (const [, b] of out.bricks) {
    if (!b.n) continue;
    const m = new THREE.Mesh(b.toGeometry(), brickMat); m.castShadow = true; m.receiveShadow = true; parent.add(m);
  }
  if (out.glass.n) { const g = new THREE.Mesh(out.glass.toGeometry(), glassMat); g.renderOrder = 2; parent.add(g); }
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  for (const [, a] of out.studs) {
    const n = a.length / 4;
    const near = new THREE.InstancedMesh(stud.hi, studMat, n);
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]); near.setMatrixAt(i, m4);
      c.setHex(a[i * 4 + 3]); near.setColorAt(i, c); cx += a[i * 4]; cz += a[i * 4 + 2];
    }
    near.computeBoundingSphere(); near.receiveShadow = true;
    const far = new THREE.InstancedMesh(stud.lo, studMat, n);
    far.instanceMatrix = near.instanceMatrix; far.instanceColor = near.instanceColor;
    far.boundingSphere = near.boundingSphere; far.receiveShadow = true;
    parent.add(near, far);
    const [wx, wz] = place ? place.toWorld(cx / n, cz / n) : [cx / n, cz / n];
    studChunks.push({ near, far, x: wx, z: wz });
  }
  addSigns(world, parent); addClocks(world, parent);
}

async function build() {
  status('Downloading the map…'); await nextFrame();
  const data = await (await fetch('data/kneesall.json')).json();
  // optional LIDAR rasters: bare-earth terrain and height above ground
  if (data.terrain) data.terrainArr = new Int16Array(await (await fetch('data/' + data.terrain.file)).arrayBuffer());
  if (data.ndsm) data.ndsmArr = new Uint8Array(await (await fetch('data/' + data.ndsm.file)).arrayBuffer());
  if (data.roofs) data.roofsArr = new Uint8Array(await (await fetch('data/' + data.roofs.file)).arrayBuffer());
  // optional hand-surveyed buildings
  try { const r = await fetch('data/survey.json'); if (r.ok) data.survey = await r.json(); } catch (e) { /* none */ }
  if (data.attribution) $('osm').innerHTML = data.attribution.replace('OpenStreetMap contributors', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');
  status('Laying baseplates…'); await nextFrame();
  let t0 = performance.now();
  K = buildKneesall(data);
  G = K.G; W = K.W; window.__dbg.K = K;
  BOUNDS = { x0: -G.half, x1: G.half - 1, z0: -G.half, z1: G.half - 1 };
  console.log('osm', (performance.now() - t0) | 0, 'ms', K.buildings.length, 'buildings'); t0 = performance.now();

  const gm = groundMeshes(G);
  for (const [, b] of gm.studded) { const m = new THREE.Mesh(b.toGeometry(), groundMat); m.receiveShadow = true; scene.add(m); }
  for (const [, b] of gm.smooth) { const m = new THREE.Mesh(b.toGeometry(), smoothMat); m.receiveShadow = true; scene.add(m); }
  { const m = new THREE.Mesh(K.roadB.toGeometry(), smoothMat); m.receiveShadow = true; scene.add(m); }
  // surrounding countryside so the baseplate never ends in a void
  {
    const S = 6000, g = new THREE.PlaneGeometry(S, S); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, cc = new Float32Array(p.count * 3), k = col(0x5f9a4c);
    for (let i = 0; i < p.count; i++) cc.set([k.r, k.g, k.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    const m = new THREE.Mesh(g, groundMat); m.position.y = G.minY - 1.55; m.receiveShadow = true; scene.add(m);
  }

  status('Snapping ' + W.vox.size.toLocaleString() + ' bricks together…'); await nextFrame();
  addWorldMeshes(W, scene);
  console.log('global world', (performance.now() - t0) | 0, 'ms'); t0 = performance.now();

  status('Building ' + K.buildings.length + ' houses…'); await nextFrame();
  for (const P of K.buildings) {
    const g = new THREE.Group();
    g.position.set(P.ox, P.y, P.oz); g.rotation.y = -P.a;
    addWorldMeshes(P.world, g, P);
    scene.add(g);
    const [cx, cz] = centroid(P.poly);
    P.cx = cx; P.cz = cz; P.r = Math.max(...P.poly.map(([x, z]) => Math.hypot(x - cx, z - cz))) + 6;
  }
  console.log('buildings', (performance.now() - t0) | 0, 'ms');

  // telephone wires between poles (gentle catenary)
  const wireMat = new THREE.LineBasicMaterial({ color: 0x222222 });
  for (const [a, b] of K.wires) {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector3(a[0] + (b[0] - a[0]) * t, a[1] - Math.sin(Math.PI * t) * 1.6, a[2] + (b[2] - a[2]) * t)); }
    for (const off of [-0.8, 0.8]) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(p => p.clone().add(new THREE.Vector3(off, 0, 0)))), wireMat); scene.add(l); }
  }

  status('Adding clouds…'); await nextFrame();
  addClouds();
  buildMinimap();
  placePlayerAtStart();
}

function signCanvas(s) {
  const pxW = 512, pxH = Math.round(512 * s.h / s.w);
  const cv = document.createElement('canvas'); cv.width = pxW; cv.height = pxH;
  const x = cv.getContext('2d');
  const font = (sz, w = 'bold') => `${w} ${sz}px "Transport", "Helvetica Neue", Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  if (s.style === 'speed') {
    // speed limit roundel: white disc, red ring, black number
    x.fillStyle = '#fff'; x.beginPath(); x.arc(pxW / 2, pxH / 2, pxW / 2 - 4, 0, 7); x.fill();
    x.strokeStyle = '#c91a09'; x.lineWidth = pxW * 0.1; x.beginPath(); x.arc(pxW / 2, pxH / 2, pxW / 2 - pxW * 0.07, 0, 7); x.stroke();
    x.fillStyle = '#111'; x.font = font(pxW * 0.42); x.fillText(s.text, pxW / 2, pxH / 2 + 8);
    return { cv, round: true };
  }
  if (s.style === 'lorryEnd') {
    // end of the goods-vehicle restriction: white disc, black lorry, crossed out by black diagonal bands
    x.fillStyle = '#fff'; x.beginPath(); x.arc(pxW / 2, pxH / 2, pxW / 2 - 4, 0, 7); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = 8; x.beginPath(); x.arc(pxW / 2, pxH / 2, pxW / 2 - 10, 0, 7); x.stroke();
    x.fillStyle = '#111';
    x.fillRect(pxW * 0.42, pxH * 0.36, pxW * 0.38, pxH * 0.24); x.fillRect(pxW * 0.22, pxH * 0.44, pxW * 0.18, pxH * 0.16);
    for (const cx of [0.3, 0.7]) { x.beginPath(); x.arc(pxW * cx, pxH * 0.63, pxW * 0.05, 0, 7); x.fill(); }
    x.save(); x.beginPath(); x.arc(pxW / 2, pxH / 2, pxW / 2 - 14, 0, 7); x.clip();
    x.translate(pxW / 2, pxH / 2); x.rotate(-Math.PI / 4); x.fillStyle = '#fff';
    for (let i = -2; i <= 1; i++) x.fillRect(-pxW, i * pxW * 0.07 + pxW * 0.01, pxW * 2, pxW * 0.025);
    x.fillStyle = '#111'; for (let i = -2; i <= 1; i++) x.fillRect(-pxW, i * pxW * 0.07 + pxW * 0.035, pxW * 2, pxW * 0.03);
    x.restore();
    return { cv, round: true };
  }
  if (s.style === 'giveway' || s.style === 'direction' || s.style === 'warning') {
    // shaped plates: draw each outline (sign units, y up) onto the canvas, red-bordered triangle or black-bordered flags
    const P = (px, py) => [(px / s.w + 0.5) * pxW, (0.5 - py / s.h) * pxH];
    const path = (poly) => { x.beginPath(); poly.forEach(([a, b], i) => x[i ? 'lineTo' : 'moveTo'](...P(a, b))); x.closePath(); };
    x.lineJoin = 'round';
    if (s.style === 'giveway') {
      const poly = signShape(s)[0];
      path(poly); x.fillStyle = '#c91a09'; x.fill();
      x.save(); x.translate(pxW / 2, pxH * 0.42); x.scale(0.62, 0.62); x.translate(-pxW / 2, -pxH * 0.42); path(poly); x.restore();
      x.fillStyle = '#fff'; x.fill();
      x.fillStyle = '#111'; x.font = font(pxH * 0.1); x.fillText('GIVE', pxW / 2, pxH * 0.3); x.fillText('WAY', pxW / 2, pxH * 0.42);
      return { cv, shape: true };
    }
    if (s.style === 'warning') {
      // red-bordered warning triangle; `text` names the symbol
      const poly = signShape(s)[0];
      path(poly); x.fillStyle = '#c91a09'; x.fill();
      x.save(); x.translate(pxW / 2, pxH * 0.6); x.scale(0.68, 0.68); x.translate(-pxW / 2, -pxH * 0.6); path(poly); x.restore();
      x.fillStyle = '#fff'; x.fill();
      x.fillStyle = '#111';
      if (s.text === 'crossroads') {
        // the through road (thicker, pointed) crossed by the side roads
        const cx = pxW / 2, y0 = pxH * 0.36, y1 = pxH * 0.84, t = pxW * 0.07;
        x.beginPath(); x.moveTo(cx, y0 - t * 0.6); x.lineTo(cx + t * 0.6, y0 + t * 0.4); x.lineTo(cx + t * 0.6, y1); x.lineTo(cx - t * 0.6, y1); x.lineTo(cx - t * 0.6, y0 + t * 0.4); x.closePath(); x.fill();
        x.fillRect(cx - pxW * 0.17, pxH * 0.6, pxW * 0.34, t * 0.75);
      }
      return { cv, shape: true };
    }
    const names = s.text.split('|');
    signShape(s).forEach((poly, i) => {
      path(poly); x.fillStyle = '#fff'; x.fill(); x.strokeStyle = '#111'; x.lineWidth = pxH * 0.07; x.stroke();
      // place name above the route number, centred on the square end of the flag
      const words = names[i].split(' '), route = words.pop(), mid = (poly[0][0] + poly[1][0]) / 2;
      x.fillStyle = '#111'; x.font = font(pxH * 0.3);
      x.fillText(words.join(' '), P(mid, 0)[0], pxH * 0.31); x.fillText(route, P(mid, 0)[0], pxH * 0.69);
    });
    return { cv, shape: true };
  }
  if (s.style === 'village') {
    // Kneesall's pictorial village sign: a painted oval (fields, sky and the church tower) over the name
    x.fillStyle = '#1b2a1f'; x.fillRect(0, 0, pxW, pxH);
    x.fillStyle = '#f3ecd8'; x.fillRect(12, 12, pxW - 24, pxH - 24);
    const cx = pxW / 2, cy = pxH * 0.4, rx = pxW * 0.38, ry = pxH * 0.3;
    x.save(); x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.clip();
    x.fillStyle = '#9cc6e6'; x.fillRect(0, 0, pxW, pxH);
    x.fillStyle = '#5e9a3f'; x.fillRect(0, cy + ry * 0.25, pxW, pxH);
    x.fillStyle = '#b9b2a1'; x.fillRect(cx - pxW * 0.05, cy - ry * 0.6, pxW * 0.1, ry * 0.9);
    for (let i = 0; i < 4; i++) x.fillRect(cx - pxW * 0.05 + i * pxW * 0.03, cy - ry * 0.7, pxW * 0.015, ry * 0.12);
    x.restore();
    x.strokeStyle = '#1b2a1f'; x.lineWidth = 8; x.beginPath(); x.ellipse(cx, cy, rx, ry, 0, 0, 7); x.stroke();
    x.fillStyle = '#111'; x.font = font(pxH * 0.13); x.fillText(s.text, pxW / 2, pxH * 0.83);
    return { cv };
  }
  // the Rajdhaani's board is white with maroon lettering, the school's dark blue with white, Kneesall's
  // name plate on the A616 dark grey-blue with white (Street View)
  const bg = { pub: '#ffffff', school: '#0a3463', bus: '#ffffff', place: '#3a4654' }[s.style] ?? '#fff';
  const fg = { pub: '#7a1f2a', school: '#ffffff', place: '#ffffff' }[s.style] ?? '#111';
  x.fillStyle = bg; x.fillRect(0, 0, pxW, pxH);
  x.strokeStyle = fg; x.lineWidth = 10; x.strokeRect(14, 14, pxW - 28, pxH - 28);
  x.fillStyle = fg;
  if (s.style === 'pub') {
    x.font = 'italic bold ' + pxH * 0.3 + 'px Georgia, serif'; x.fillText(s.text, pxW / 2, pxH / 2);
  } else {
    let sz = pxH * 0.5; x.font = font(sz);
    while (x.measureText(s.text).width > pxW - 60) { sz -= 2; x.font = font(sz); }
    x.fillText(s.text, pxW / 2, pxH / 2 + 2);
  }
  return { cv };
}

// outlines of shaped plates in sign units (centred, y up): a give-way triangle, or a pair of direction flags
// pointing away from each other
function signShape(s) {
  const w = s.w, h = s.h;
  if (s.style === 'giveway') return [[[-w / 2, h / 2], [w / 2, h / 2], [0, -h / 2]]];
  if (s.style === 'warning') return [[[-w / 2, -h / 2], [w / 2, -h / 2], [0, h / 2]]];
  const g = w * 0.02, p = h * 0.45;
  return [[[-g, h / 2], [-w / 2 + p, h / 2], [-w / 2, 0], [-w / 2 + p, -h / 2], [-g, -h / 2]],
    [[g, h / 2], [w / 2 - p, h / 2], [w / 2, 0], [w / 2 - p, -h / 2], [g, -h / 2]]];
}

function addSigns(world, parent) {
  for (const s of world.signs || []) {
    const { cv, round, shape } = signCanvas(s);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    if (round) { tex.center.set(0.5, 0.5); tex.rotation = Math.PI / 2; }   // a disc's cap is mapped a quarter turn round
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, transparent: !!round, alphaTest: round ? 0.5 : 0 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xa0a5a9, roughness: 0.4 });
    const geo = round ? new THREE.CylinderGeometry(s.w / 2, s.w / 2, 0.2, 32) : new THREE.BoxGeometry(s.w, s.h, 0.2);
    let m;
    if (shape) {
      // a plain grey plate cut to shape, the printed face just in front of it
      const shapes = signShape(s).map(poly => new THREE.Shape(poly.map(([a, b]) => new THREE.Vector2(a, b))));
      const body = new THREE.ExtrudeGeometry(shapes, { depth: 0.2, bevelEnabled: false }); body.translate(0, 0, -0.1);
      tex.repeat.set(1 / s.w, 1 / s.h); tex.offset.set(0.5, 0.5);
      const front = new THREE.Mesh(new THREE.ShapeGeometry(shapes), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 }));
      front.position.z = 0.105;
      m = new THREE.Group(); m.add(new THREE.Mesh(body, edge), front);
    } else if (round) {
      const fm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 });
      m = new THREE.Mesh(geo, [edge, fm, s.oneSided ? edge : fm]); m.rotation.x = Math.PI / 2;
      const g = new THREE.Group(); g.add(m); m = g;
    } else m = new THREE.Mesh(geo, [edge, edge, edge, edge, face, s.oneSided ? edge : face]);   // road signs have plain backs
    // the panel stands just in front of its post(s)
    const fx = Math.sin(s.face ?? 0) * 0.25, fz = Math.cos(s.face ?? 0) * 0.25;
    m.position.set(s.x + 0.5 + fx, (s.postH ?? 4.5) - s.h / 2 + 0.3 + (world.baseAt ? world.baseAt(s.x, s.z) : 0), s.z + 0.5 + fz);
    m.rotation.y = s.face ?? 0;
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    parent.add(m);
  }
}

function addClocks(world, parent) {
  for (const c of world.clocks || []) {
    // a skeleton dial: gilded chapter ring, Roman numerals and hands fixed straight onto the stone
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const x = cv.getContext('2d'), gold = '#c9971f';
    x.strokeStyle = gold; x.fillStyle = gold;
    for (const r of [122, 84]) { x.lineWidth = 9; x.beginPath(); x.arc(128, 128, r, 0, 7); x.stroke(); }
    x.font = 'bold 34px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    ROMAN.forEach((n, i) => {
      const a = i / 12 * Math.PI * 2;
      x.save(); x.translate(128 + Math.sin(a) * 104, 128 - Math.cos(a) * 104); x.rotate(a); x.fillText(n, 0, 1); x.restore();
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const R = 1.5, turn = { n: Math.PI, w: -Math.PI / 2, s: 0, e: Math.PI / 2 }[c.face ?? 'n'];
    const nx = Math.sin(turn) * 0.05, nz = Math.cos(turn) * 0.05;
    const m = new THREE.Mesh(new THREE.CircleGeometry(R, 40), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.35, metalness: 0.4 }));
    m.position.set(c.x + nx, c.y, c.z + nz); m.rotation.y = turn;
    parent.add(m);
    const hands = new THREE.Group(); hands.position.set(c.x + 2 * nx, c.y, c.z + 2 * nz); hands.rotation.y = turn;
    const hm = new THREE.MeshStandardMaterial({ color: 0xd9b44a, metalness: 0.6, roughness: 0.3 });
    const hr = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.05), hm); hr.geometry.translate(0, 0.33, 0);
    const mn = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.15, 0.05), hm); mn.geometry.translate(0, 0.52, 0);
    hands.add(hr, mn); parent.add(hands);
    dynamic.clock = { hr, mn };
  }
}

// ------------------------------------------------------------------ clouds
function addClouds() {
  const R = rng(7);
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.2 });
  for (let i = 0; i < 14; i++) {
    const b = new Builder();
    const n = 6 + Math.floor(R() * 8);
    for (let j = 0; j < n; j++) {
      const w = 4 + Math.floor(R() * 10), d = 4 + Math.floor(R() * 8), h = 1 + Math.floor(R() * 3);
      const x = Math.floor((R() - 0.5) * 24), z = Math.floor((R() - 0.5) * 14), y = Math.floor(R() * 3) * BRICK;
      b.box(x, y, z, x + w, y + h * BRICK, z + d, col(PAL.white), { chamfer: 0.1, gap: 0.02 });
    }
    const m = new THREE.Mesh(b.toGeometry(), mat);
    m.position.set((R() - 0.5) * 700, 95 + R() * 40, (R() - 0.5) * 600);
    m.castShadow = true;
    scene.add(m); dynamic.clouds.push(m);
  }
}

// ------------------------------------------------------------------ player + collision
const player = { pos: new THREE.Vector3(0, 0.4, 0), vy: 0, yaw: 0, pitch: 0.02, onGround: true, fly: false, third: false };
window.__dbg.player = player;
const RADIUS = 0.7, HEIGHT = 4.8, EYE = 4.2, STEP = 0.85;
let avatar;

function placePlayerAtStart() {
  // stand on the Newark Road pavement a little way from St Bartholomew's, looking along the road at the church
  const ch = K.buildings.find(b => b.label === "St Bartholomew's Church");
  if (!ch || !K.newark) return;
  const n = distToPolyline(ch.cx, ch.cz, K.newark);
  let s0 = 0; for (let i = 0; i < n.seg; i++) s0 += Math.hypot(K.newark[i + 1][0] - K.newark[i][0], K.newark[i + 1][1] - K.newark[i][1]);
  s0 += n.t * Math.hypot(K.newark[n.seg + 1][0] - K.newark[n.seg][0], K.newark[n.seg + 1][1] - K.newark[n.seg][1]);
  let best = null;
  const clear = (x, z) => {
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) for (let y = 0; y < 8; y++) if (W.has(Math.floor(x) + dx, y, Math.floor(z) + dz)) return false;
    return G.has(Math.floor(x), Math.floor(z), 2) && !blocked(x, z, groundH(x, z));
  };
  for (const ds of [-30, 30, -50, 50, -70, 70, -90, 90]) {
    const q = pointAlong(K.newark, s0 + ds);
    for (const side of [1, -1]) {
      const x = q.x - q.dz * side * 6.6, z = q.z + q.dx * side * 6.6;
      if (!clear(x, z)) continue;
      const d = Math.hypot(x - ch.cx, z - ch.cz);
      if (!best || d < best.d) best = { x, z, d };
    }
    if (best) break;
  }
  if (!best) best = { x: n.qx, z: n.qz };
  player.pos.set(best.x, 0, best.z);
  player.pos.y = supportH(best.x, best.z, groundH(best.x, best.z));
  player.yaw = Math.atan2(-(ch.cx - best.x), -(ch.cz - best.z));
}

function groundH(x, z) { return G.heightAt(x, z); }
// solid(cx, layer, cz) in brick layers above base(cx, cz)
function circleHits(solid, base, x, z, feet) {
  for (let cz = Math.floor(z - RADIUS); cz <= Math.floor(z + RADIUS); cz++) for (let cx = Math.floor(x - RADIUS); cx <= Math.floor(x + RADIUS); cx++) {
    const nx = Math.max(cx, Math.min(x, cx + 1)), nz = Math.max(cz, Math.min(z, cz + 1));
    if ((nx - x) ** 2 + (nz - z) ** 2 > RADIUS * RADIUS) continue;
    const b = base(cx, cz);
    const y0 = Math.max(0, Math.floor((feet + STEP - b) / BRICK)), y1 = Math.floor((feet + HEIGHT - b) / BRICK);
    for (let y = y0; y <= y1; y++) if (solid(cx, y, cz)) return true;
  }
  return false;
}
const wsolid = (a, b, c) => W.solid(a, b, c), wbase = (x, z) => G.baseAt(x, z);
function nearBuildings(x, z) { return K.buildings.filter(P => Math.abs(P.cx - x) < P.r && Math.abs(P.cz - z) < P.r); }
function blocked(x, z, feet) {
  if (x < BOUNDS.x0 + 1 || x > BOUNDS.x1 || z < BOUNDS.z0 + 1 || z > BOUNDS.z1) return true;
  if (circleHits(wsolid, wbase, x, z, feet)) return true;
  for (const P of nearBuildings(x, z)) {
    const [lx, lz] = P.toLocal(x, z);
    if (circleHits((a, b, c) => P.world.solid(a, b, c), () => P.y, lx, lz, feet)) return true;
  }
  return false;
}
function solidAt(x, y, z) {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (W.solid(cx, Math.floor((y - G.baseAt(cx, cz)) / BRICK), cz)) return true;
  for (const P of nearBuildings(x, z)) { const [lx, lz] = P.toLocal(x, z); if (P.world.solid(Math.floor(lx), Math.floor((y - P.y) / BRICK), Math.floor(lz))) return true; }
  return false;
}
// highest standable surface under the player's footprint (ground, or the top of low walls/hedges)
function supportH(x, z, feet) {
  let best = -Infinity;
  for (const [dx, dz] of [[0, 0], [RADIUS * 0.6, 0], [-RADIUS * 0.6, 0], [0, RADIUS * 0.6], [0, -RADIUS * 0.6]]) {
    const cx = Math.floor(x + dx), cz = Math.floor(z + dz), b = G.baseAt(cx, cz);
    let h = groundH(x + dx, z + dz);
    const top = Math.floor((feet + STEP - b) / BRICK);
    for (let y = 0; y <= top; y++) if (W.solid(cx, y, cz) && b + (y + 1) * BRICK <= feet + STEP) h = Math.max(h, b + (y + 1) * BRICK);
    best = Math.max(best, h);
  }
  return best;
}

// ------------------------------------------------------------------ input
const keys = {};
let locked = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!started) return;
  if (e.code === 'KeyV') { player.third = !player.third; showToast(player.third ? 'Third person' : 'First person'); }
  if (e.code === 'KeyF') { player.fly = !player.fly; player.vy = 0; showToast(player.fly ? 'Fly mode (Space up, C down)' : 'Walking'); }
  if (e.code === 'KeyT') { timeIdx = (timeIdx + 1) % TIMES.length; applyTime(); }
  if (e.code === 'KeyM') $('minimap').classList.toggle('hidden');
  if (e.code === 'KeyO') { aoOn = !aoOn; showToast(aoOn ? 'Ambient occlusion on' : 'Ambient occlusion off'); }
  if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
let dragging = false;
addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (!locked && !(dragging && started)) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = THREE.MathUtils.clamp(player.pitch - e.movementY * 0.0022, -1.45, 1.45);
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  $('paused').classList.toggle('hidden', locked || !started);
});
renderer.domElement.addEventListener('click', () => { if (started && !locked) lockPointer(); });
$('paused').addEventListener('click', () => { $('paused').classList.add('hidden'); lockPointer(); });
function lockPointer() { try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* no pointer lock available */ } }

// touch: left half = move stick, right half = look
const touch = { move: null, look: null, mx: 0, mz: 0 };
renderer.domElement.addEventListener('touchstart', (e) => {
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && !touch.move) touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
    else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: true });
renderer.domElement.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.mx = THREE.MathUtils.clamp((t.clientX - touch.move.x) / 60, -1, 1); touch.mz = THREE.MathUtils.clamp((t.clientY - touch.move.y) / 60, -1, 1); }
    if (touch.look && t.identifier === touch.look.id) { player.yaw -= (t.clientX - touch.look.x) * 0.005; player.pitch = THREE.MathUtils.clamp(player.pitch - (t.clientY - touch.look.y) * 0.005, -1.4, 1.4); touch.look.x = t.clientX; touch.look.y = t.clientY; }
  }
}, { passive: true });
renderer.domElement.addEventListener('touchend', (e) => {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
}, { passive: true });

// ------------------------------------------------------------------ update
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
let moveSpeed = 0;
function updatePlayer(dt) {
  const run = keys.ShiftLeft || keys.ShiftRight;
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touch.mx;
  let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - touch.mz;
  const len = Math.hypot(ix, iz); if (len > 1) { ix /= len; iz /= len; }
  fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  right.set(-fwd.z, 0, fwd.x);
  const sp = player.fly ? (run ? 60 : 25) : (run ? 13 : 6);
  const dx = (fwd.x * iz + right.x * ix) * sp * dt, dz = (fwd.z * iz + right.z * ix) * sp * dt;
  moveSpeed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
  const p = player.pos;
  if (player.fly) {
    p.x = THREE.MathUtils.clamp(p.x + dx, BOUNDS.x0, BOUNDS.x1); p.z = THREE.MathUtils.clamp(p.z + dz, BOUNDS.z0, BOUNDS.z1);
    p.y += ((keys.Space ? 1 : 0) - (keys.KeyC ? 1 : 0)) * sp * dt;
    p.y = Math.max(p.y, groundH(p.x, p.z));
    return;
  }
  // axis-separated sliding collision; step-up handled by checking from feet+STEP
  if (!blocked(p.x + dx, p.z, p.y)) p.x += dx;
  if (!blocked(p.x, p.z + dz, p.y)) p.z += dz;
  const floor = supportH(p.x, p.z, p.y);
  if (player.onGround && keys.Space) { player.vy = 12; player.onGround = false; }
  player.vy -= 34 * dt;
  p.y += player.vy * dt;
  if (p.y <= floor) {
    // smooth step-up
    if (floor - p.y > 0.05 && player.onGround) p.y = Math.min(floor, p.y + Math.max(0.1, (floor - p.y)) * Math.min(1, dt * 18) + 0.02);
    else p.y = floor;
    if (p.y >= floor - 0.001) p.y = floor;
    player.vy = 0; player.onGround = true;
  } else if (p.y - floor > 0.3) player.onGround = false;
}

const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const p = player.pos;
  camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  avatar.visible = player.third;
  avatar.position.copy(p); avatar.rotation.y = player.yaw + Math.PI;
  animateMinifig(avatar, player.fly ? 0 : moveSpeed, dt);
  if (!player.third) { camera.position.set(p.x, p.y + EYE, p.z); return; }
  // third person: pull the camera back, shortening it if bricks are in the way
  const back = new THREE.Vector3(0, 0, 1).applyEuler(camera.rotation);
  camTarget.set(p.x, p.y + 4.2, p.z);
  let d = 11;
  for (let t = 1; t <= 11; t += 0.5) {
    const q = camTarget.clone().addScaledVector(back, t);
    if (solidAt(q.x, q.y, q.z)) { d = t - 0.8; break; }
  }
  camera.position.copy(camTarget).addScaledVector(back, Math.max(1.5, d));
}

function updateWorld(dt, t) {
  for (const cl of dynamic.clouds) { cl.position.x += dt * 1.6; if (cl.position.x > 800) cl.position.x = -800; }
  if (dynamic.clock) {
    const d = new Date(); const h = d.getHours() % 12 + d.getMinutes() / 60, m = d.getMinutes() + d.getSeconds() / 60;
    dynamic.clock.hr.rotation.z = -h / 12 * Math.PI * 2; dynamic.clock.mn.rotation.z = -m / 60 * Math.PI * 2;
  }
  // shadow camera follows the player, snapped to texels to avoid shimmering
  const p = player.pos;
  const tex = (2 * SR) / 4096;
  const cx = Math.round(p.x / tex) * tex, cz = Math.round(p.z / tex) * tex;
  sun.target.position.set(cx, 0, cz);
  sun.position.set(cx + sunDir.x * 300, sunDir.y * 300, cz + sunDir.z * 300);
  // stud level-of-detail
  for (const s of studChunks) {
    const d = Math.hypot(s.x - camera.position.x, s.z - camera.position.z);
    s.near.visible = d < 45;
    s.far.visible = d >= 45 && d < 110;
  }
  streamGroundStuds();
}

// Real stud geometry on the baseplate is created on demand around the camera (the texture covers the rest)
const GS = 16;
function streamGroundStuds() {
  const cx = Math.floor(camera.position.x / GS), cz = Math.floor(camera.position.z / GS), R = Math.ceil(110 / GS);
  let made = 0;
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const k = (cx + i) + ',' + (cz + j);
    const ch = groundStuds.get(k);
    const mx = (cx + i + 0.5) * GS, mz = (cz + j + 0.5) * GS;
    const d = Math.hypot(mx - camera.position.x, mz - camera.position.z);
    if (ch) { if (ch.near) { ch.near.visible = d < 45; ch.far.visible = d >= 45 && d < 110; } continue; }
    if (d > 110 || made > 6) continue;
    made++;
    const a = [];
    for (let z = (cz + j) * GS; z < (cz + j + 1) * GS; z++) for (let x = (cx + i) * GS; x < (cx + i + 1) * GS; x++) {
      const gi = G.i(x, z); if (gi < 0 || !G.stud[gi] || W.has(x, 0, z)) continue;
      a.push(x + 0.5, G.top[gi], z + 0.5, G.col[gi]);
    }
    if (!a.length) { groundStuds.set(k, {}); continue; }
    const n = a.length / 4, m4 = new THREE.Matrix4(), c = new THREE.Color();
    const near = new THREE.InstancedMesh(stud.hi, studMat, n);
    for (let q = 0; q < n; q++) { m4.makeTranslation(a[q * 4], a[q * 4 + 1], a[q * 4 + 2]); near.setMatrixAt(q, m4); c.setHex(a[q * 4 + 3]); near.setColorAt(q, c); }
    near.computeBoundingSphere(); near.receiveShadow = true;
    const far = new THREE.InstancedMesh(stud.lo, studMat, n);
    far.instanceMatrix = near.instanceMatrix; far.instanceColor = near.instanceColor; far.boundingSphere = near.boundingSphere; far.receiveShadow = true;
    near.visible = d < 45; far.visible = d >= 45 && d < 110;
    scene.add(near, far);
    groundStuds.set(k, { near, far });
  }
}

// ------------------------------------------------------------------ minimap + location
let mapBase, mapCtx, lastPlace = '';
const MAPS = 1.0;
function buildMinimap() {
  const w = G.n, h = G.n;
  mapBase = document.createElement('canvas'); mapBase.width = w; mapBase.height = h;
  const x = mapBase.getContext('2d'); const img = x.createImageData(w, h);
  const colr = new Uint32Array(G.col);
  // hedges, trees, walls from the global voxel world (top-most voxel wins)
  const topY = new Int16Array(w * h).fill(-1);
  for (const [k, v] of W.vox) {
    const [vx, vy, vz] = World.decode(k); const i = G.i(vx, vz);
    if (i >= 0 && vy > topY[i]) { topY[i] = vy; colr[i] = v & 0xffffff; }
  }
  for (const P of K.buildings) polyCells(P.poly, (bx, bz) => { const i = G.i(bx, bz); if (i >= 0) { colr[i] = P.roofCol ?? PAL.dbg; topY[i] = 20; } });
  const c = new THREE.Color();
  for (let i = 0; i < w * h; i++) {
    c.setHex(colr[i]);
    const xi = i % w, zi = (i / w) | 0;
    const gx = G.base[zi * w + Math.min(w - 1, xi + 1)] - G.base[zi * w + Math.max(0, xi - 1)];
    const gz = G.base[Math.min(h - 1, zi + 1) * w + xi] - G.base[Math.max(0, zi - 1) * w + xi];
    const hill = 1 + Math.max(-0.25, Math.min(0.25, (-gx - gz) * 0.35));   // lit from the north-west
    const shade = (topY[i] >= 0 ? 0.8 + Math.min(0.3, topY[i] * 0.02) : 1) * hill;
    img.data[i * 4] = Math.min(255, (c.r ** (1 / 2.2)) * 255 * shade); img.data[i * 4 + 1] = Math.min(255, (c.g ** (1 / 2.2)) * 255 * shade); img.data[i * 4 + 2] = Math.min(255, (c.b ** (1 / 2.2)) * 255 * shade); img.data[i * 4 + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  mapCtx = $('minimap').getContext('2d');
  allLabels = [...K.labels, ...W.labels];
}
let allLabels = [];
function drawMinimap() {
  const cv = $('minimap'); if (cv.classList.contains('hidden')) return;
  const S = cv.width, ctx = mapCtx, zoom = 1.6;
  ctx.save(); ctx.fillStyle = '#4b9f4a'; ctx.fillRect(0, 0, S, S);
  ctx.translate(S / 2, S / 2); ctx.scale(zoom, zoom);
  ctx.translate(-(player.pos.x - BOUNDS.x0), -(player.pos.z - BOUNDS.z0));
  ctx.imageSmoothingEnabled = false; ctx.drawImage(mapBase, 0, 0);
  ctx.font = 'bold 6px system-ui, sans-serif'; ctx.textAlign = 'center';
  for (const l of allLabels) {
    ctx.font = l.road ? 'italic 5px system-ui, sans-serif' : 'bold 6px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(l.name, l.x - BOUNDS.x0 + 0.5, l.z - BOUNDS.z0 + 0.5);
    ctx.fillStyle = '#fff'; ctx.fillText(l.name, l.x - BOUNDS.x0, l.z - BOUNDS.z0);
  }
  ctx.restore();
  // player arrow
  ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(-player.yaw);
  ctx.fillStyle = '#e8261f'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', S / 2, 14);
}
function updatePlace() {
  let best = null, bd = Infinity;
  for (const l of allLabels) { if (l.road) continue; const d = Math.hypot(player.pos.x - l.x, player.pos.z - l.z) - l.r; if (d < 10 && d < bd) { bd = d; best = l.name; } }
  if (!best) {
    // otherwise name the road you're on/near
    let rd = Infinity;
    for (const r of K.namedRoads ?? []) { const d = distToPolyline(player.pos.x, player.pos.z, r.pts).d; if (d < 12 && d < rd) { rd = d; best = r.name === 'Newark Road' ? 'Newark Road (A616)' : r.name; } }
  }
  const name = best ?? 'Kneesall';
  if (name !== lastPlace) { lastPlace = name; $('place').textContent = name; }
}

// ------------------------------------------------------------------ postprocessing
let composer, gtao, aoOn = true;
function setupPost() {
  try {
    const rt = new THREE.WebGLRenderTarget(innerWidth * pixelRatio, innerHeight * pixelRatio, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pixelRatio);
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
    gtao.output = GTAOPass.OUTPUT.Default;
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  } catch (e) { console.warn('AO disabled', e); composer = null; }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ main loop
let fpsN = 0, fpsT = 0;
let started = false, last = performance.now(), frames = 0, perfT = 0, perfChecked = false;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (started) updatePlayer(dt);
  updateCamera(dt);
  updateWorld(dt, now / 1000);
  if (gtao) gtao.enabled = aoOn;
  if (composer) composer.render(); else renderer.render(scene, camera);
  drawMinimap(); updatePlace();
  // adaptive quality: if the first few seconds are slow, drop AO and resolution
  if (!perfChecked && started) {
    frames++; perfT += dt;
    if (perfT > 4) {
      perfChecked = true;
      const fps = frames / perfT;
      if (fps < 30) {
        aoOn = false; pixelRatio = Math.min(pixelRatio, 1); renderer.setPixelRatio(pixelRatio);
        sun.shadow.mapSize.set(2048, 2048); sun.shadow.map?.dispose(); sun.shadow.map = null;
        if (composer) { composer.setPixelRatio(pixelRatio); composer.setSize(innerWidth, innerHeight); }
        showToast('Reduced quality for smoother framerate (O toggles AO)');
      }
    }
  }
  fpsN++; fpsT += dt; if (fpsT > 1) { $('fps').textContent = Math.round(fpsN / fpsT) + ' fps'; fpsN = 0; fpsT = 0; }
}

(async () => {
  try {
    await build();
    avatar = makeMinifig({ torso: PAL.red, legs: PAL.darkBlue, print: 'shirt', hair: PAL.brown });
    scene.add(avatar);
    applyTime();
    setupPost();
    status('Ready');
    $('start').disabled = false; $('start').textContent = 'Enter Kneesall';
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e); status('Something went wrong: ' + e.message);
  }
})();
$('start').addEventListener('click', () => {
  started = true; last = performance.now();
  $('intro').classList.add('hidden');
  lockPointer();
});
