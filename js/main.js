import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld, studGeometry, studTexture, Builder, World, BRICK, PLATE, PAL, col, rng, F_NOCOLLIDE } from './bricks.js';
import { buildKneesall, groundMeshes } from './osm.js';
import { polyCells, centroid, pointAlong, polylineLength, distToPolyline, pointInPoly } from './geo.js';
import { makeFigure, animateFigure, makeCar, makeMixer, makeLorry, makeBus, makeMotorbike } from './actors.js';
import { MONTHS } from './seasons.js';
import { KWALL } from './roofs.js';
import { Soundscape } from './sound.js';

const $ = (id) => document.getElementById(id);
const status = (t) => { $('loading-text').textContent = t; };
const nextFrame = () => new Promise(r => { let done = false; const f = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(f); setTimeout(f, 60); });

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// phones and tablets start lighter: lower resolution, smaller shadow map, no ambient occlusion
const TOUCH = matchMedia('(pointer: coarse)').matches;
let pixelRatio = Math.min(window.devicePixelRatio, TOUCH ? 1.25 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;   // redrawn by updateShadows when something has moved
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
window.__dbg = { renderer, scene, THREE };
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, 3000);
window.__dbg.camera = camera;

// ------------------------------------------------------------------ sky, sun, environment
// The sky's scattering shader is too costly to run over the screen every frame, so each time of day draws it once
// into a cube map for the background, and blurred for the environment light.
const skyScene = new THREE.Scene(), sky = new Sky(); sky.scale.setScalar(1000); skyScene.add(sky);
const skyCam = new THREE.CubeCamera(1, 2000, new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType }));
const su = sky.material.uniforms;
su.turbidity.value = 4; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(TOUCH ? 2048 : 4096, TOUCH ? 2048 : 4096);
const SR = 70;
Object.assign(sun.shadow.camera, { left: -SR, right: SR, top: SR, bottom: -SR, near: 1, far: 600 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5d7a3e, 0.55); scene.add(hemi);
scene.fog = new THREE.Fog(0xc9d9e8, 220, 1100);

const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;

const TIMES = [
  { key: 'morning', name: 'Morning', hour: 8, elev: 16, az: 115, sunCol: 0xffe2b8, sunI: 2.6, hemiI: 0.45, fog: 0xd8dde4, exp: 0.8 },
  { key: 'midday', name: 'Midday', hour: 12.5, elev: 48, az: 170, sunCol: 0xfff6e8, sunI: 3.2, hemiI: 0.55, fog: 0xc9d9e8, exp: 0.78 },
  { key: 'afternoon', name: 'Late afternoon', hour: 16.5, elev: 24, az: 235, sunCol: 0xffe7c4, sunI: 2.9, hemiI: 0.5, fog: 0xd3dbe2, exp: 0.82 },
  { key: 'golden', name: 'Golden hour', hour: 19.5, elev: 5, az: 268, sunCol: 0xffad5c, sunI: 2.2, hemiI: 0.35, fog: 0xe6c7a8, exp: 0.95 },
  { key: 'night', name: 'Night', hour: 22.5, night: true },
  { key: 'now', name: 'Now', now: true },
];
// how night looks: the moon (or the sky's glow) instead of the sun
const NIGHT = { sunCol: 0xa9bbdc, sunI: 0.5, hemiI: 0.09, fog: 0x0a1120, exp: 1.05 };
let timeIdx = 2, timeAt = 0;
const KNEESALL = [53.17, -0.95];   // latitude, longitude

// Where the sun is in the sky over Kneesall at a moment (compass azimuth and elevation in degrees), from the usual
// low-precision solar formulae (good to a fraction of a degree)
function sunAt(date, [lat, lon]) {
  const r = Math.PI / 180, d = date / 86400000 - 10957.5;   // days from noon on 1 January 2000 (UT)
  const g = (357.529 + 0.98560028 * d) * r, L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * r;
  const e = (23.439 - 0.00000036 * d) * r;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const H = ((18.697374558 + 24.06570982441908 * d) * 15 + lon) * r - ra, p = lat * r;
  const el = Math.asin(Math.sin(p) * Math.sin(dec) + Math.cos(p) * Math.cos(dec) * Math.cos(H));
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(p) - Math.sin(p) * Math.cos(H));
  return { elev: el / r, az: (az / r + 360) % 360 };
}

// Where the moon is and how much of it is lit, from the same low-precision formulae (as in the suncalc library):
// compass azimuth and elevation in degrees, the lit fraction, and whether it is waxing
function moonAt(date, [lat, lon]) {
  const r = Math.PI / 180, e = r * 23.4397, d = date / 86400000 - 10957.5;
  const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
  const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const L = r * (218.316 + 13.176396 * d), M = r * (134.963 + 13.064993 * d), F = r * (93.272 + 13.22935 * d);
  const ml = L + r * 6.289 * Math.sin(M), mb = r * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M);
  const m = { ra: ra(ml, mb), dec: dec(ml, mb) };
  const H = r * (280.16 + 360.9856235 * d) + r * lon - m.ra, p = r * lat;
  const el = Math.asin(Math.sin(p) * Math.sin(m.dec) + Math.cos(p) * Math.cos(m.dec) * Math.cos(H));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(p) - Math.tan(m.dec) * Math.cos(p));   // from south, west positive
  // the sun, for the phase
  const sM = r * (357.5291 + 0.98560028 * d), sL = sM + r * (1.9148 * Math.sin(sM) + 0.02 * Math.sin(2 * sM) + 0.0003 * Math.sin(3 * sM)) + r * 102.9372 + Math.PI;
  const s = { ra: ra(sL, 0), dec: dec(sL, 0) }, sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sd * Math.sin(phi), dist - sd * Math.cos(phi));
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { elev: el / r, az: (az / r + 180 + 360) % 360, lit: (1 + Math.cos(inc)) / 2, waxing: angle < 0 };
}

// the moon in the sky: a disc drawn lit on the side the sun is (on the right as it waxes), kept far off round the camera
const moonCanvas = document.createElement('canvas'); moonCanvas.width = moonCanvas.height = 128;
const moonTex = new THREE.CanvasTexture(moonCanvas); moonTex.colorSpace = THREE.SRGBColorSpace;
const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false, toneMapped: false }));
moonMesh.scale.setScalar(24); moonMesh.renderOrder = -1; moonMesh.visible = false; scene.add(moonMesh);
const moonDir = new THREE.Vector3();
function drawMoon(m) {
  const x = moonCanvas.getContext('2d'), R = 60, k = 1 - 2 * m.lit;   // k: where the terminator crosses, -1..1 of the radius
  x.clearRect(0, 0, 128, 128); x.save(); x.translate(64, 64); if (!m.waxing) x.scale(-1, 1);
  x.fillStyle = 'rgba(70,80,100,0.35)'; x.beginPath(); x.arc(0, 0, R, 0, Math.PI * 2); x.fill();   // earthshine
  x.fillStyle = '#f4f1e4'; x.beginPath(); x.arc(0, 0, R, -Math.PI / 2, Math.PI / 2); x.ellipse(0, 0, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, k < 0); x.fill();
  x.restore(); moonTex.needsUpdate = true;
}

const sunDir = new THREE.Vector3();
let night = 0, nightMoon = null;   // 0 by day, 1 at night (between in the twilight); the moon when it is dark
function applyTime(quiet = false) {
  let t = TIMES[timeIdx], when = new Date(), skyElev = null;
  night = 0;
  if (t.now || t.at) {
    // the real sun (now, or at a time of day a link gives), lit like the setting nearest its height; once it has set,
    // the twilight deepens into night
    if (t.at) when.setHours(Math.floor(t.hour), Math.round((t.hour % 1) * 60), 0, 0);
    const s = sunAt(when, KNEESALL), look = TIMES.filter(x => x.elev != null).sort((a, b) => Math.abs(a.elev - s.elev) - Math.abs(b.elev - s.elev))[0];
    const clock = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    night = THREE.MathUtils.clamp((1 - s.elev) / 10, 0, 1);
    t = { ...look, elev: Math.max(2, s.elev), az: s.az, name: (t.now ? `Now (${clock})` : clock) + (night >= 1 ? ': night' : night > 0 ? ': twilight' : '') };
    skyElev = s.elev;
    timeAt = performance.now();
  } else if (t.night) {
    when.setHours(Math.floor(t.hour), (t.hour % 1) * 60, 0, 0);
    const s = sunAt(when, KNEESALL);
    night = 1; t = { ...TIMES.find(x => x.key === 'golden'), name: t.name, az: s.az }; skyElev = Math.min(-12, s.elev);
  }
  nightMoon = night > 0 ? moonAt(when, KNEESALL) : null;
  if (nightMoon && night >= 1) t.name += nightMoon.elev > 0 ? `, the moon ${Math.round(nightMoon.lit * 100)}% lit` : ', no moon up';
  // compass azimuth (0 north, 90 east, 180 south) with x east and z south
  const dir = (elev, azim, v) => { const el = THREE.MathUtils.degToRad(elev), az = THREE.MathUtils.degToRad(azim); return v.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)); };
  dir(t.elev, t.az, sunDir);
  // the sky drawn for where the sun really is (below the horizon after sunset)
  su.sunPosition.value.copy(skyElev == null ? sunDir : dir(skyElev, t.az, new THREE.Vector3()));
  skyCam.update(renderer, skyScene);
  scene.background = skyCam.renderTarget.texture;
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(skyScene, 0.02);
  scene.environment = envRT.texture;
  shadowsDirty = true;
  scene.environmentIntensity = 0.55 * (1 - 0.85 * night);
  scene.backgroundIntensity = 1 - 0.7 * night;   // the sky drawn for a sun far below the horizon is still too pale
  sun.color.set(t.sunCol); sun.intensity = t.sunI; hemi.intensity = t.hemiI;
  scene.fog.color.set(t.fog); renderer.toneMappingExposure = t.exp;
  if (night > 0) {
    // after sunset: the light fades to the moon's (from where it is, as bright as it is full), or to the sky's glow
    const m = nightMoon, up = m.elev > 2;
    if (up) dir(m.elev, m.az, sunDir);
    const moonI = up ? NIGHT.sunI * (0.15 + 0.85 * m.lit) * Math.min(1, m.elev / 20) : 0.02;
    sun.color.lerp(new THREE.Color(NIGHT.sunCol), night); sun.intensity += (moonI - sun.intensity) * night;
    hemi.intensity += (NIGHT.hemiI - hemi.intensity) * night;
    scene.fog.color.lerp(new THREE.Color(NIGHT.fog), Math.min(1, night * 2.5));   // the haze darkens ahead of the light, as the sky does renderer.toneMappingExposure += (NIGHT.exp - renderer.toneMappingExposure) * night;
    moonMesh.visible = m.elev > -1; dir(m.elev, m.az, moonDir); drawMoon(m);
  } else moonMesh.visible = false;
  cloudMat.color.setScalar((1 - 0.5 * Math.max(0, weather.cover - 0.5) - (weather.rain > 0 ? 0.15 : 0)) * (1 - 0.85 * night));
  lampsOn = night >= 0.3; headlightsOn = night >= 0.2;
  // cloud cover takes the sun's strength (and so the shadows) away and lets the sky light it instead; rain and fog
  // close the view in
  const thick = Math.max(0, weather.cover - 0.4) / 0.6, wet = weather.rain > 0.05;
  sun.intensity *= 1 - 0.8 * thick - (wet ? 0.1 : 0); hemi.intensity *= 1 + 0.5 * thick;
  scene.fog.color.lerp(new THREE.Color(0xaeb4ba), 0.6 * thick);
  const haze = weather.fog ? 0.15 : wet ? 0.45 : 1 - 0.3 * thick;
  scene.fog.near = 220 * haze; scene.fog.far = 1100 * haze;
  if (!quiet) showToast(t.name);
}

// ------------------------------------------------------------------ materials
const brickMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.34, metalness: 0, clearcoat: 0.3, clearcoatRoughness: 0.22, specularIntensity: 0.6 });
const studMat = new THREE.MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.2, specularIntensity: 0.6 });
// Ground uses a stud texture mapped in world space (1 repeat per stud) so distant baseplates still read as bricks;
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

// After dark the street lights (and the traffic's headlights) light what is round them. three.js lights would cost
// every material a pass per lamp, so the ground, roads, bricks and studs instead add up to LAMPS small lights
// themselves: lampPos (xyz, reach), lampDir (xyz, and the cosine of the cone's edge, 0 for all round), lampCol.
const LAMPS = 24;
const lampU = { lampN: { value: 0 }, lampPos: { value: Array.from({ length: LAMPS }, () => new THREE.Vector4()) },
  lampDir: { value: Array.from({ length: LAMPS }, () => new THREE.Vector4()) }, lampCol: { value: Array.from({ length: LAMPS }, () => new THREE.Vector3()) } };
let lampsOn = false, headlightsOn = false;
window.__dbg.lampU = lampU;
function withLamps(mat, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, lampU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 lampW4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          lampW4 = instanceMatrix * lampW4;
        #endif
        vLampW = (modelMatrix * lampW4).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        #define LAMPS ${LAMPS}
        uniform int lampN; uniform vec4 lampPos[LAMPS]; uniform vec4 lampDir[LAMPS]; uniform vec3 lampCol[LAMPS];
        varying vec3 vLampW;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        for (int i = 0; i < LAMPS; i++) {
          if (i >= lampN) break;
          vec3 d = lampPos[i].xyz - vLampW; float dist = length(d);
          float att = clamp(1.0 - dist / lampPos[i].w, 0.0, 1.0);
          if (att <= 0.0) continue;
          vec3 L = d / max(dist, 1e-3);
          float cone = lampDir[i].w > 0.0 ? smoothstep(lampDir[i].w, lampDir[i].w + 0.15, dot(-L, lampDir[i].xyz)) : 1.0;
          float ndl = max(dot(normal, normalize((viewMatrix * vec4(L, 0.0)).xyz)), 0.0);
          reflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * lampCol[i] * (ndl * att * att * cone);
        }`);
  };
  mat.customProgramCacheKey = () => 'lamps-' + key;
}
withLamps(groundMat, 'ground'); withLamps(brickMat, 'brick'); withLamps(studMat, 'stud'); withLamps(smoothMat, 'smooth');

// ------------------------------------------------------------------ HUD helpers
let toastTimer = 0;
function showToast(t) { const e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => e.classList.remove('show'), 1800); }

// ------------------------------------------------------------------ build the village
let K, G, W, BOUNDS, MONTH, treeXZ = [], studChunks = [], brickChunks = [], dynamic = { clouds: [] };
const traffic = { L: 0, cars: [], idle: [], queue: [0, 0], mixerAt: -60, busesToday: 0, toNewark: 1, data: null, counted: {} };
window.__dbg.traffic = traffic;   // traffic.spawn(dir, t) adds a vehicle
const groundStuds = new Map();
const stud = { hi: studGeometry(10, true), lo: studGeometry(6, false) };

// Turn a voxel World into meshes under `parent`; `place` (optional) maps local->world for LOD tests
function addWorldMeshes(world, parent, place) {
  const out = buildWorld(world);
  // each chunk of bricks has a near (bevelled bricks) and a far (plain faces) mesh; updateWorld shows one of them
  for (const k of new Set([...out.bricks.keys(), ...out.far.keys()])) {
    const mesh = (b) => { if (!b?.n) return null; const m = new THREE.Mesh(b.toGeometry(), brickMat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    const near = mesh(out.bricks.get(k)), far = mesh(out.far.get(k));
    const s = (near ?? far).geometry.boundingSphere, [wx, wz] = place ? place.toWorld(s.center.x, s.center.z) : [s.center.x, s.center.z];
    brickChunks.push({ near, far, x: wx, z: wz, r: s.radius });
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
  // optional hand-surveyed buildings, and the traffic counts
  try { const r = await fetch('data/survey.json'); if (r.ok) data.survey = await r.json(); } catch (e) { /* none */ }
  try { const r = await fetch('data/traffic.json'); if (r.ok) traffic.data = await r.json(); } catch (e) { /* made-up traffic */ }
  // the month to show (?month=1..12, else this month): crops, leaves and hedges follow the year
  const qm = +new URLSearchParams(location.search).get('month');
  MONTH = qm >= 1 && qm <= 12 ? qm : new Date().getMonth() + 1; data.month = MONTH;
  if (data.attribution) $('osm').innerHTML = data.attribution.replace('OpenStreetMap contributors', '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors');
  if (data.crome) $('osm').innerHTML += '; crop map © Rural Payments Agency (OGL v3)';
  if (traffic.data) $('osm').innerHTML += '; traffic and bus data from the Department for Transport (OGL v3)';
  status('Laying baseplates…'); await nextFrame();
  let t0 = performance.now();
  K = buildKneesall(data);
  treeXZ = (data.trees ?? []).map(t => [t.x, t.z]);
  G = K.G; W = K.W; Object.assign(window.__dbg, { K, brickChunks, studChunks });
  BOUNDS = { x0: -G.half, x1: G.half - 1, z0: -G.half, z1: G.half - 1 };
  console.log('osm', (performance.now() - t0) | 0, 'ms', K.buildings.length, 'buildings'); t0 = performance.now();

  const gm = groundMeshes(G);
  for (const [, b] of gm.studded) { const m = new THREE.Mesh(b.toGeometry(), groundMat); m.receiveShadow = true; scene.add(m); }
  for (const [, b] of gm.smooth) { const m = new THREE.Mesh(b.toGeometry(), smoothMat); m.receiveShadow = true; scene.add(m); }
  { const m = new THREE.Mesh(K.roadB.toGeometry(), smoothMat); m.receiveShadow = true; scene.add(m); }
  addRoadText(K, scene);
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
  traffic.L = K.carPath.length > 1 ? polylineLength(K.carPath) : 0;
  traffic.spawn = spawnVehicle;
  if (traffic.L) {
    // Newark is to the south-east: which way along the road that is
    const a = K.carPath[0], b = K.carPath[K.carPath.length - 1];
    traffic.toNewark = (b[0] - a[0]) + (b[1] - a[1]) > 0 ? 1 : -1;
    setupBuses();
  }
  buildMinimap();
  setupLamps();
  placePlayerAtStart();
  openLink(new URLSearchParams(location.search));
  // back where you were before Y changed the month
  try {
    const r = JSON.parse(sessionStorage.getItem('kneesall-resume') ?? 'null');
    sessionStorage.removeItem('kneesall-resume');
    if (r) { player.pos.fromArray(r.p); Object.assign(player, { yaw: r.yaw, pitch: r.pitch, fly: r.fly, third: r.third }); timeIdx = r.time; }
  } catch (e) { /* storage unavailable: start at the usual place */ }
  if (traffic.L) seedTraffic();
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
    // a warning on a yellow backing board is a plain rectangle with the triangle printed on it
    const board = s.backing ? (x.fillStyle = s.backing, x.fillRect(0, 0, pxW, pxH), true) : false;
    const S = board ? { ...s, w: s.w * 0.8, h: s.h * 0.8 } : s;
    // shaped plates: draw each outline (sign units, y up) onto the canvas, red-bordered triangle or black-bordered flags
    const P = (px, py) => [(px / s.w + 0.5) * pxW, (0.5 - py / s.h) * pxH - (board ? pxH * 0.02 : 0)];
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
      const poly = signShape(S)[0];
      path(poly); x.fillStyle = '#c91a09'; x.fill();
      x.save(); x.translate(pxW / 2, pxH * 0.6); x.scale(0.68, 0.68); x.translate(-pxW / 2, -pxH * 0.6); path(poly); x.restore();
      x.fillStyle = '#fff'; x.fill();
      x.fillStyle = '#111';
      const k = board ? 0.8 : 1; x.save(); x.translate(pxW / 2, pxH * 0.6); x.scale(k, k); x.translate(-pxW / 2, -pxH * 0.6);
      if (s.text === 'crossroads') {
        // the through road (thicker, pointed) crossed by the side roads
        const cx = pxW / 2, y0 = pxH * 0.36, y1 = pxH * 0.84, t = pxW * 0.07;
        x.beginPath(); x.moveTo(cx, y0 - t * 0.6); x.lineTo(cx + t * 0.6, y0 + t * 0.4); x.lineTo(cx + t * 0.6, y1); x.lineTo(cx - t * 0.6, y1); x.lineTo(cx - t * 0.6, y0 + t * 0.4); x.closePath(); x.fill();
        x.fillRect(cx - pxW * 0.17, pxH * 0.6, pxW * 0.34, t * 0.75);
      }
      if (s.text === 'school') {
        // two children, the older one leading
        const kid = (cx, h) => {
          const y1 = pxH * 0.84, y0 = y1 - h, r = h * 0.11;
          x.beginPath(); x.arc(cx, y0 + r, r, 0, 7); x.fill();
          x.fillRect(cx - h * 0.09, y0 + r * 2.1, h * 0.18, h * 0.42);
          x.save(); x.translate(cx, y0 + h * 0.62); x.rotate(0.35); x.fillRect(-h * 0.05, 0, h * 0.1, h * 0.38); x.rotate(-0.7); x.fillRect(-h * 0.05, 0, h * 0.1, h * 0.38); x.restore();
        };
        kid(pxW * 0.44, pxH * 0.4); kid(pxW * 0.57, pxH * 0.31);
      }
      x.restore();
      return { cv, shape: !board };
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
  if (s.style === 'chevron') {
    // bend chevrons: white arrowheads on black pointing the way the road turns (`text` "<" or ">")
    x.fillStyle = '#111'; x.fillRect(0, 0, pxW, pxH);
    const n = 2, dir = s.text === '<' ? -1 : 1, cw = pxW / n;
    x.fillStyle = '#f4f4f0';
    for (let i = 0; i < n; i++) {
      const c0 = cw * i + cw * 0.5, a = cw * 0.22, b = cw * 0.14;
      x.beginPath(); x.moveTo(c0 - dir * a, pxH * 0.1); x.lineTo(c0 - dir * a + dir * b, pxH * 0.1); x.lineTo(c0 + dir * a + dir * b, pxH * 0.5);
      x.lineTo(c0 - dir * a + dir * b, pxH * 0.9); x.lineTo(c0 - dir * a, pxH * 0.9); x.lineTo(c0 + dir * a, pxH * 0.5); x.closePath(); x.fill();
    }
    return { cv };
  }
  if (s.style === 'advert') {
    // a painted roadside board: the restaurant's name over its directions
    const [name, ...rest] = s.text.split('|');
    x.fillStyle = '#d9cf8f'; x.fillRect(0, 0, pxW, pxH);
    x.strokeStyle = '#8a5a2b'; x.lineWidth = 8; x.strokeRect(10, 10, pxW - 20, pxH - 20);
    x.fillStyle = '#7a1f2a'; x.font = 'bold ' + pxH * 0.16 + 'px Georgia, serif'; x.fillText(name, pxW / 2, pxH * 0.38);
    x.font = 'bold ' + pxH * 0.08 + 'px Arial, sans-serif'; rest.forEach((t, i) => x.fillText(t, pxW / 2, pxH * (0.66 + i * 0.12)));
    return { cv };
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
  const bg = { pub: '#ffffff', school: '#0a3463', bus: '#ffffff', place: '#3a4654', plate: '#ffffff' }[s.style] ?? '#fff';
  const fg = { pub: '#7a1f2a', school: '#ffffff', place: '#ffffff', plate: '#111111' }[s.style] ?? '#111';
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

// words and speed roundels painted on the road (K.roadText): white paint on a canvas, on a quad draped over the road
// `w` across the lane and `l` along it, upright for traffic travelling (ux, uz) — stretched, as road lettering is
function addRoadText(K, parent) {
  const paint = '#f4f4f0';
  for (const t of K.roadText || []) {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = Math.round(256 * t.l / t.w);
    const x = cv.getContext('2d'), W = cv.width, H = cv.height;
    x.fillStyle = paint; x.strokeStyle = paint; x.textAlign = 'center'; x.textBaseline = 'middle';
    const word = (s, cx, cy, maxW, capH) => {
      x.font = `bold ${capH / 0.72}px Arial, Helvetica, sans-serif`;
      x.save(); x.translate(cx, cy); x.scale(Math.min(1, maxW / x.measureText(s).width), 1); x.fillText(s, 0, capH * 0.04); x.restore();
    };
    if (t.kind === 'roundel') {
      const lw = W * 0.1;
      x.beginPath(); x.ellipse(W / 2, H / 2, W / 2 - lw / 2, H / 2 - lw / 2, 0, 0, 2 * Math.PI);
      if (t.red) { x.fillStyle = '#a9483f'; x.fill(); x.fillStyle = paint; }
      x.lineWidth = lw; x.stroke();
      word(t.text, W / 2, H / 2, W * 0.62, H * 0.48);
    } else word(t.text, W / 2, H / 2, W * 0.96, H * 0.9);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    // a grid draped on the road surface; uv (0, 0) is the near left corner for the reader
    const NA = 4, NL = Math.max(2, Math.ceil(t.l / 1.5)), pos = [], uv = [], idx = [];
    const rx = -t.uz, rz = t.ux;
    for (let j = 0; j <= NL; j++) for (let i = 0; i <= NA; i++) {
      const s = i / NA, v = j / NL, px = t.x + rx * (s - 0.5) * t.w + t.ux * (v - 0.5) * t.l, pz = t.z + rz * (s - 0.5) * t.w + t.uz * (v - 0.5) * t.l;
      pos.push(px, t.y(px, pz) + 0.01, pz); uv.push(s, v);
    }
    for (let j = 0; j < NL; j++) for (let i = 0; i < NA; i++) {
      const a = j * (NA + 1) + i, b = a + 1, c = a + NA + 2, d = a + NA + 1;
      idx.push(a, b, c, a, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true;
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

// ------------------------------------------------------------------ lights after dark
// The street lights located in Street View come on when the sun is two degrees below the horizon, as their
// photocells would; the traffic has its headlights on from just after sunset. Each lantern glows, and lights the
// road, pavement and walls round it (see withLamps); the nearest vehicles' headlights light the road ahead.
const glowTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
const glowMats = new Map();
function glow(hex, size) {
  if (!glowMats.has(hex)) glowMats.set(hex, new THREE.SpriteMaterial({ map: glowTex, color: hex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const g = new THREE.Sprite(glowMats.get(hex)); g.scale.setScalar(size); g.visible = false; return g;
}
const LAMP_COL = new THREE.Vector3(1, 0.9, 0.75).multiplyScalar(6), HEAD_COL = new THREE.Vector3(1, 0.95, 0.85).multiplyScalar(12);
const lamps = [];
function setupLamps() {
  for (const l of W.lamps ?? []) {
    const y = W.baseAt(l.gx, l.gz) + l.h, g = glow(0xffe0b0, l.style === 'swan' ? 3 : 3.6);
    g.position.set(l.x, y - 0.3, l.z); scene.add(g);
    lamps.push({ x: l.x, y: y - 0.6, z: l.z, g });
  }
}
// a vehicle's lamps (actors.js gives where): white at the front, red at the back
function vehicleGlows(v) {
  const u = v.obj.userData; if (!u.lamps || u.glows) return;
  u.glows = [];
  for (const [x, y, z] of u.lamps.head) { const g = glow(0xfff4dc, v.bike ? 1.6 : 2.2); g.position.set(x, y, z); v.obj.add(g); u.glows.push(g); }
  for (const [x, y, z] of u.lamps.tail) { const g = glow(0xff2a1a, 1.2); g.position.set(x, y, z); (u.trailer ?? v.obj).add(g); u.glows.push(g); }
}
const lampTmp = new THREE.Vector3();
function updateLamps() {
  let n = 0;
  const put = (x, y, z, reach, dx, dy, dz, cone, c) => { lampU.lampPos.value[n].set(x, y, z, reach); lampU.lampDir.value[n].set(dx, dy, dz, cone); lampU.lampCol.value[n].copy(c); n++; };
  const cam = camera.position;
  if (lampsOn) for (const l of lamps) if (n < LAMPS && Math.hypot(l.x - cam.x, l.z - cam.z) < 250) put(l.x, l.y, l.z, 34, 0, -1, 0, 0.15, LAMP_COL);
  for (const l of lamps) l.g.visible = lampsOn;
  if (headlightsOn) {
    const near = traffic.cars.filter(c => Math.hypot(c.obj.position.x - cam.x, c.obj.position.z - cam.z) < 150)
      .sort((a, b) => a.obj.position.distanceToSquared(cam) - b.obj.position.distanceToSquared(cam)).slice(0, 8);
    for (const c of near) {
      if (n >= LAMPS) break;
      const o = c.obj, yaw = o.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
      lampTmp.set(o.userData.L / 2 + 0.5, 2.4, 0).applyMatrix4(o.matrixWorld);
      put(lampTmp.x, lampTmp.y, lampTmp.z, c.bike ? 32 : 44, fx * 0.97, -0.24, fz * 0.97, 0.8, HEAD_COL);
    }
  }
  for (const c of traffic.cars) { if (headlightsOn) vehicleGlows(c); for (const g of c.obj.userData.glows ?? []) g.visible = headlightsOn; }
  lampU.lampN.value = n;
  if (moonMesh.visible) { moonMesh.position.copy(camera.position).addScaledVector(moonDir, 900); moonMesh.lookAt(camera.position); }
}

// ------------------------------------------------------------------ the model's clock
// "Now" is the real time; the other times of day start at their hour, today, and run on from when they were chosen.
// The traffic, the bus, the church clock and the birds keep to it.
let clockIdx = -1, clockAt = 0;
function modelNow() {
  const t = TIMES[timeIdx];
  if (t.now) return new Date();
  if (clockIdx !== timeIdx) { clockIdx = timeIdx; clockAt = performance.now(); }
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + t.hour * 3600000 + (performance.now() - clockAt));
}
window.__dbg.modelNow = () => modelNow();
// for testing while the page is hidden (no animation frames): run the traffic on by `secs` and draw a frame
window.__dbg.runTraffic = (secs, step = 1 / 30) => { for (let k = 0; k < secs / step; k++) { clockAt -= step * 1000; traffic.t = (traffic.t ?? 0) + step; updateTraffic(step, performance.now() / 1000 + traffic.t); } renderer.render(scene, camera); };
const ymd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate() + '';

// ------------------------------------------------------------------ traffic on Newark Road (A616)
// Vehicles come in at either end of the baseplate, drive through on the left at about 30 mph and leave at the other
// end. How many, of what kind and which way follow the Department for Transport's counts (data/traffic.json, from
// tools/traffic.py): the A616's average day, spread over the hours and days of the week, morning traffic mostly
// towards Newark and evening traffic back. The vehicles themselves (and their colours) are made up. Now and again,
// in working hours, one is a cement mixer. The 733 school bus runs on its timetable.
const MPH = 0.44704 / 0.7;   // studs per second
// the colours of new cars registered in the UK in 2025 (SMMT): grey 28%, black 23%, blue 15%, white 13%, red 6%,
// green 5%, silver and the rest 10%
const CAR_COLOURS = [[PAL.dbg, 20], [PAL.lbg, 8], [PAL.black, 23], [PAL.blue, 8], [PAL.darkBlue, 7], [PAL.white, 13], [PAL.red, 4],
  [PAL.darkRed, 2], [PAL.darkGreen, 5], [PAL.lbg, 7], [PAL.yellow, 1], [PAL.orange, 1], [PAL.reddishBrown, 1]];
const pick = (list) => { let r = Math.random() * list.reduce((a, [, w]) => a + w, 0); for (const [v, w] of list) if ((r -= w) < 0) return v; return list[0][0]; };
const CAB_COLOURS = [[PAL.white, 5], [PAL.blue, 2], [PAL.red, 1], [PAL.darkBlue, 2], [PAL.lbg, 1], [PAL.darkGreen, 1]];
const TRAILER_COLOURS = [[PAL.white, 4], [PAL.lbg, 3], [PAL.darkBlue, 2], [PAL.darkGreen, 1], [PAL.red, 1]];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// vehicles an hour each way at a moment, [the +1 direction along carPath, the -1 direction]: the day's flow times the
// national index for the hour and weekday, eased between hours
function flowAt(d) {
  const T = traffic.data;
  if (!T) return [270, 270];
  const h = d.getHours() + d.getMinutes() / 60 - 0.5, h0 = Math.floor(h), f = h - h0;
  const at = (hr) => {
    const day = (d.getDay() + (hr < 0 ? 6 : hr > 23 ? 1 : 0)) % 7, hh = (hr + 24) % 24;
    return [T.hourIndex[DAY_NAMES[day]][hh], T.towardsNewark[hh] ?? 0.5];
  };
  const [i0, n0] = at(h0), [i1, n1] = at(h0 + 1);
  const all = T.perDay.all / 24 * (i0 + (i1 - i0) * f) / 100, toNewark = n0 + (n1 - n0) * f;
  return traffic.toNewark > 0 ? [all * toNewark, all * (1 - toNewark)] : [all * (1 - toNewark), all * toNewark];
}

// what comes next, in the proportions counted: cars and taxis, vans, lorries (of each kind), coaches, motorbikes
function pickKind(t, d) {
  const T = traffic.data, P = T?.perDay;
  if (!P) return Math.random() < 0.18 ? 'van' : 'hatch';
  const h = d.getHours(), workday = d.getDay() > 0 && h >= 7 && h < 17;
  if (workday && !traffic.cars.some(c => c.mixer) && (t - traffic.mixerAt > 150 || (t - traffic.mixerAt > 40 && Math.random() < 0.1))) return 'mixer';
  const coaches = Math.max(0, P.buses - traffic.busesToday);
  const k = pick([['hatch', P.cars], ['van', P.vans], ['lorry', P.lorries], ['coach', coaches], ['bike', P.motorbikes]]);
  if (k !== 'lorry') return k;
  const H = T.lorries;
  return pick([['rigid2', H.rigid2], ['rigid3', H.rigid3], ['mixer', H.rigid4], ['artic', H.artic]]);
}

function spawnVehicle(dir, t, kind = null, bus = null) {
  const d = modelNow();
  kind ??= pickKind(t, d);
  const mixer = kind === 'mixer';
  let i = bus ? -1 : traffic.idle.findIndex(v => v.kind === kind && !v.bus && (mixer || Math.random() < 0.5));
  let v;
  if (i >= 0) v = traffic.idle.splice(i, 1)[0];
  else {
    const obj = mixer ? makeMixer()
      : kind === 'van' ? makeCar(Math.random() < 0.6 ? PAL.white : PAL.lbg, 'van')
      : kind === 'hatch' ? makeCar(pick(CAR_COLOURS), 'hatch')
      : kind === 'artic' ? makeLorry('artic', pick(CAB_COLOURS), pick(TRAILER_COLOURS))
      : kind === 'rigid2' || kind === 'rigid3' ? makeLorry(kind, pick(CAB_COLOURS), Math.random() < 0.7 ? PAL.white : pick(TRAILER_COLOURS))
      : kind === 'coach' ? makeBus([PAL.lbg, PAL.white], null)
      : kind === 'bus' ? (bus.obj ??= makeBus(bus.livery, bus.dest))
      : makeMotorbike(pick(CAR_COLOURS));
    v = { kind, obj };
  }
  if (mixer) traffic.mixerAt = t;
  const heavy = mixer || /^(rigid|artic|coach|bus)/.test(kind);
  Object.assign(v, { dir, mixer, heavy, bike: kind === 'bike', bus, s: dir > 0 ? 0 : traffic.L, speed: (heavy ? 27 + Math.random() * 2 : 28 + Math.random() * 5) * MPH });
  v.v = v.speed; v.obj.visible = true;
  scene.add(v.obj); traffic.cars.push(v);
  traffic.counted[kind + (dir > 0 ? '+' : '-')] = (traffic.counted[kind + (dir > 0 ? '+' : '-')] ?? 0) + 1;   // for __dbg
  return v;
}

// a few vehicles already on the road, as many as the flow would have on it
function seedTraffic() {
  const flow = flowAt(modelNow()), cross = traffic.L / (30 * MPH);
  [1, -1].forEach((dir, k) => {
    let n = 0; for (let mean = flow[k] / 3600 * cross, p = Math.exp(-mean), u = Math.random(), c = p; u > c && n < 12; ) { n++; p *= mean / n; c += p; }
    for (let j = 0; j < n; j++) {
      const s = traffic.L * (0.05 + 0.9 * Math.random());
      if (traffic.cars.some(c => c.dir === dir && Math.abs(c.s - s) < 30)) continue;
      spawnVehicle(dir, 0).s = s;
    }
  });
}

// The scheduled buses (data/traffic.json `buses`, from the Bus Open Data Service): on the days a trip runs it comes
// along the A616, calls at its Kneesall stop (waiting a minute there where the trip starts, and setting down where it
// ends) and drives on out of the village. Where it comes from before a trip, and goes after, isn't published, so it
// keeps going the same way along the A616.
function busRuns(trip, d) {
  const k = ymd(d);
  if (trip.off.includes(k)) return false;
  if (trip.on.includes(k)) return true;
  return !!trip.days && trip.days[(d.getDay() + 6) % 7] === '1' && k >= trip.from && k <= trip.to;
}
const secs = (hms) => { const [h, m, x] = hms.split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };
function setupBuses() {
  const path = K.carPath, along = ([lat, lon]) => {
    const [x, z] = K.project([lat, lon]), n = distToPolyline(x, z, path);
    let s = 0; for (let i = 0; i < n.seg; i++) s += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
    return s + n.t * Math.hypot(path[n.seg + 1][0] - path[n.seg][0], path[n.seg + 1][1] - path[n.seg][1]);
  };
  traffic.buses = [];
  for (const trip of traffic.data?.buses?.trips ?? []) {
    const call = trip.calls[0]; if (!call || trip.path.length < 2) continue;
    const dir = Math.sign(along(trip.path[trip.path.length - 1]) - along(trip.path[0])) || 1;
    // stop at the OpenStreetMap bus stop nearest the timetable's (where the stop sign is drawn)
    const [sx, sz] = K.project(call.at);
    const osm = (K.busStops ?? []).reduce((b, p) => Math.hypot(p.x - sx, p.z - sz) < Math.hypot(b.x - sx, b.z - sz) ? p : b, { x: sx, z: sz });
    const stopS = along(K.unproject([osm.x, osm.z]));
    const tD = secs(call.depart) + (call.last ? 40 : 0), tA = Math.min(secs(call.arrive), tD - (call.first ? 60 : 20));
    traffic.buses.push({ trip, dir, stopS, tA, tD, livery: [PAL.darkBlue, PAL.white], dest: trip.route + ' ' + trip.headsign, done: '' });
  }
}
function updateBuses(t, d) {
  const now = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000, sp = 28 * MPH, L = traffic.L;
  traffic.busesToday = 0;
  for (const b of traffic.buses ?? []) {
    if (!busRuns(b.trip, d)) continue;
    traffic.busesToday++;
    const from = b.dir > 0 ? b.stopS : L - b.stopS;   // how far the stop is from where it comes in
    const tIn = b.tA - from / sp, tOut = b.tD + (L - from) / sp, key = ymd(d);
    if (b.done === key || now < tIn || now > tOut || traffic.cars.some(c => c.bus === b)) continue;
    b.done = key;
    const v = spawnVehicle(b.dir, t, 'bus', b);
    const ds = now < b.tA ? -(b.tA - now) * sp : now < b.tD ? 0 : (now - b.tD) * sp;
    v.s = Math.max(0, Math.min(L, b.stopS + b.dir * ds)); v.speed = sp; v.v = now >= b.tA && now < b.tD ? 0 : sp;
  }
}

function updateTraffic(dt, t) {
  const path = K.carPath, L = traffic.L;
  if (!L) return;
  const d = modelNow(), flow = flowAt(d), now = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  updateBuses(t, d);
  [1, -1].forEach((dir, k) => {
    // arrivals at the edge of the baseplate as a Poisson stream at the hour's flow; they wait for room to come in
    if (Math.random() < flow[k] / 3600 * dt) traffic.queue[k] = Math.min(3, traffic.queue[k] + 1);
    if (traffic.queue[k] && traffic.cars.every(c => c.dir !== dir || (dir > 0 ? c.s : L - c.s) - (c.obj.userData.back ?? 0) > 30)) { spawnVehicle(dir, t); traffic.queue[k]--; }
  });
  const p = player.pos;
  for (const c of traffic.cars) {
    const q = pointAlong(path, c.s), a = pointAlong(path, c.s - 3 * c.dir), b = pointAlong(path, c.s + 3 * c.dir);
    let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;   // smoothed heading
    // slow down for the player standing in the lane ahead, or for the vehicle in front
    let target = c.speed;
    const half = c.obj.userData.L / 2;
    const vx = p.x - q.x, vz = p.z - q.z, ahead = vx * tx + vz * tz - half, lateral = vx * tz - vz * tx;
    if (lateral > -1.5 && lateral < 6 && ahead > -half && ahead < 30 && p.y - K.roadY(p.x, p.z) < 3) target = ahead < 4 ? 0 : c.speed * Math.min(1, (ahead - 4) / 20);
    for (const o of traffic.cars) if (o !== c && o.dir === c.dir) {
      const g = (o.s - c.s) * c.dir - (o.obj.userData.L + c.obj.userData.L) / 2 - (o.obj.userData.back ?? 0);
      if (g > -1 && g < 20) target = Math.min(target, Math.max(0, o.v * (g - 4) / 10));
    }
    // the bus pulls up at its stop and waits there until it is due to leave
    if (c.bus) {
      const toStop = (c.bus.stopS - c.s) * c.dir;
      if (toStop > -0.5 && now < c.bus.tD) target = Math.min(target, toStop < 0.5 ? 0 : Math.max(1.5, c.speed * Math.min(1, toStop / 25)));
    }
    c.v += (target - c.v) * Math.min(1, dt * (target < c.v ? 5 : 0.8));
    c.s += c.dir * c.v * dt;
    // drive on the left: offset to the left of the direction of travel
    const px = q.x + tz * 2.6, pz = q.z - tx * 2.6;
    const y0 = K.roadY(px - tx * half, pz - tz * half), y1 = K.roadY(px + tx * half, pz + tz * half);
    c.obj.position.set(px, (y0 + y1) / 2, pz);
    const yaw = Math.atan2(-tz, tx);
    c.obj.rotation.set(0, yaw, Math.atan2(y1 - y0, half * 2), 'YZX');
    const u = c.obj.userData;
    if (u.trailer) {
      // the trailer follows the road behind the tractor: from its axles to the fifth wheel
      const f = pointAlong(path, c.s - c.dir * u.pivot), r = pointAlong(path, c.s - c.dir * (u.pivot + u.axle));
      let rel = Math.atan2(-(f.z - r.z), f.x - r.x) - yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      u.trailer.rotation.y = rel;
    }
    for (const w of u.wheels) w.rotation.z -= c.v * dt / (w.scale.x || 1);
    if (u.drum) u.drum.rotation.x += dt * 1.6;
  }
  // gone off the end of the baseplate
  for (let i = traffic.cars.length - 1; i >= 0; i--) {
    const c = traffic.cars[i], back = c.obj.userData.back ?? 0;
    if (c.s < -2 - back || c.s > L + 2 + back) { scene.remove(c.obj); if (!c.bus) traffic.idle.push(c); traffic.cars.splice(i, 1); }
  }
}

// ------------------------------------------------------------------ clouds
const cloudMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.2 });
function addClouds() {
  const R = rng(7);
  const mat = cloudMat;
  // enough for an overcast sky; the weather shows as many as its cloud cover needs
  for (let i = 0; i < 44; i++) {
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

// ------------------------------------------------------------------ weather
// The weather over Kneesall now, from Open-Meteo (cloud cover, rain or snow, wind), fetched when the page opens and
// every quarter of an hour: the clouds that show and how grey they are, how much the sun gets through, the haze, the
// rain and the way the clouds drift. R steps through live, fair, overcast and rain; with no connection it is fair.
const WEATHERS = [
  { key: 'live', name: 'Live weather', live: true },
  { key: 'fair', name: 'Fair weather', cover: 0.3, rain: 0, snow: false, windFrom: 250, windSpeed: 4 },
  { key: 'overcast', name: 'Overcast', cover: 0.95, rain: 0, snow: false, windFrom: 250, windSpeed: 5 },
  { key: 'rain', name: 'Rain', cover: 1, rain: 2.5, snow: false, windFrom: 230, windSpeed: 7 },
];
let weatherIdx = 0, live = null, liveAt = -Infinity;
const weather = { ...WEATHERS[1] };
window.__dbg.weather = weather;   // what is shown: cover 0..1, rain mm/h, snow, wind from (compass) at m/s
// WMO weather codes Open-Meteo reports
const WMO = { 0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle',
  55: 'drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain',
  67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'showers', 81: 'showers',
  82: 'heavy showers', 85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm' };
async function fetchWeather() {
  liveAt = performance.now();
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${KNEESALL[0]}&longitude=${KNEESALL[1]}` +
      '&current=cloud_cover,precipitation,weather_code,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms';
    const c = (await (await fetch(u)).json()).current, code = c.weather_code;
    const wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95, snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
    live = { cover: c.cloud_cover / 100, rain: wet || snow ? Math.max(0.3, c.precipitation * 4) : 0, snow, fog: code === 45 || code === 48,
      windFrom: c.wind_direction_10m, windSpeed: c.wind_speed_10m, what: WMO[code] ?? '' };
    if (!$('osm').innerHTML.includes('Open-Meteo')) $('osm').innerHTML += ' · Weather <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0)';
  } catch (e) { live = null; }
  if (WEATHERS[weatherIdx].live) applyWeather(true);
}
function applyWeather(quiet = false) {
  const w = WEATHERS[weatherIdx];
  Object.assign(weather, { fog: false }, w.live ? live ?? WEATHERS[1] : w);
  // clouds: a few on a clear day, the whole sky when it is overcast, greyer as it closes in and when it rains
  const n = Math.round(3 + weather.cover * (dynamic.clouds.length - 3));
  dynamic.clouds.forEach((c, i) => { c.visible = i < n; c.scale.set(1 + 1.6 * weather.cover, 1 + 0.5 * weather.cover, 1 + 1.6 * weather.cover); });
  // the sky itself hazes over
  su.turbidity.value = 4 + 12 * weather.cover; su.rayleigh.value = 1.2 * (1 - 0.6 * weather.cover); su.mieCoefficient.value = 0.004 + 0.02 * weather.cover;
  applyTime(true);
  if (!quiet) showToast(w.live ? (live ? `Live weather: ${live.what}, ${Math.round(live.cover * 100)}% cloud` : 'Live weather unavailable: fair') : w.name);
}

// rain (or snow) falling in a box round the camera
const VY_PER_M = KWALL * BRICK;   // world units up per metre (walls are stretched, so this is more than across)
const DROPS = 5000, rainPos = new Float32Array(DROPS * 6), drops = new Float32Array(DROPS * 3);
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0.55 });
const rainLines = new THREE.LineSegments(rainGeo, rainMat); rainLines.frustumCulled = false; rainLines.visible = false; scene.add(rainLines);
for (let i = 0; i < DROPS; i++) drops.set([Math.random() * 120 - 60, Math.random() * 60, Math.random() * 120 - 60], i * 3);
function updateRain(dt) {
  const on = weather.rain > 0.05;
  rainLines.visible = on;
  if (!on) return;
  const n = Math.min(DROPS, Math.round(DROPS * Math.min(1, 0.2 + weather.rain / 4)));
  const snow = weather.snow, fall = (snow ? 1.2 : 9) * VY_PER_M, len = snow ? 0.15 : 1.4;
  rainMat.color.set(snow ? 0xffffff : 0xb8c4d0); rainMat.opacity = snow ? 0.9 : 0.55;
  const to = (weather.windFrom + 180) * Math.PI / 180, wx = Math.sin(to) * weather.windSpeed / 0.7 * 0.5, wz = -Math.cos(to) * weather.windSpeed / 0.7 * 0.5;
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  for (let i = 0; i < n; i++) {
    let x = drops[i * 3], y = drops[i * 3 + 1] - fall * dt, z = drops[i * 3 + 2];
    x += wx * dt; z += wz * dt;
    if (y < -15) { y += 60; x = Math.random() * 120 - 60; z = Math.random() * 120 - 60; }
    if (x > 60) x -= 120; else if (x < -60) x += 120;
    if (z > 60) z -= 120; else if (z < -60) z += 120;
    drops[i * 3] = x; drops[i * 3 + 1] = y; drops[i * 3 + 2] = z;
    const sx = wx / fall * len, sz = wz / fall * len;
    rainPos.set([cx + x, cy + y, cz + z, cx + x - sx, cy + y + len, cz + z - sz], i * 6);
  }
  rainGeo.setDrawRange(0, n * 2);
  rainGeo.attributes.position.needsUpdate = true;
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
  // on a pavement stud (not the carriageway or a building) with room to stand
  const clear = (x, z) => {
    const cx = Math.floor(x), cz = Math.floor(z);
    return G.has(cx, cz, 2) && !G.has(cx, cz, 1 | 64) && !blocked(x, z, groundH(x, z));
  };
  // how much of the way towards the church is open at eye height (hedges, walls, trees and other buildings block it)
  const view = (x, z) => {
    const L = Math.hypot(ch.cx - x, ch.cz - z), ux = (ch.cx - x) / L, uz = (ch.cz - z) / L;
    let open = 0, n = 0;
    for (let t = 2; t < L; t += 1) {
      const px = Math.floor(x + ux * t), pz = Math.floor(z + uz * t);
      if (pointInPoly(px + 0.5, pz + 0.5, ch.poly)) break;   // reached the church
      n++; if (![2, 3, 4].some(y => W.has(px, y, pz)) && !(G.has(px, pz, 1))) open++; else break;
    }
    return n ? open / Math.max(n, 20) : 0;
  };
  for (let k = 0; k < 60; k++) {
    const ds = (30 + 2 * (k >> 1)) * (k & 1 ? 1 : -1);
    const q = pointAlong(K.newark, s0 + ds);
    for (const side of [1, -1]) for (const off of [6.3, 5.9, 6.7, 7.1]) {
      const x = q.x - q.dz * side * off, z = q.z + q.dx * side * off;
      if (!clear(x, z)) continue;
      const v = view(x, z);
      if (!best || v > best.v) best = { x, z, v };
      break;
    }
    if (best && best.v >= 1) break;
  }
  if (!best) best = { x: n.qx, z: n.qz };
  player.pos.set(best.x, 0, best.z);
  player.pos.y = supportH(best.x, best.z, groundH(best.x, best.z));
  player.yaw = Math.atan2(-(ch.cx - best.x), -(ch.cz - best.z));
}

// ------------------------------------------------------------------ links to a view
// ?at=lat,lon (WGS84, so a point copied from an online map works too) &look=heading,pitch (compass degrees; pitch up
// is positive) &fly=metres above the ground &view=third &time=morning|midday|afternoon|golden|night|now|HH:MM
// &weather=fair|overcast|rain &month=1..12. L copies one for where you are.
const DEFAULT_TIME = timeIdx;
function viewLink() {
  const [lat, lon] = K.unproject([player.pos.x, player.pos.z]), q = new URLSearchParams();
  q.set('at', lat.toFixed(6) + ',' + lon.toFixed(6));
  const h = Math.round((-THREE.MathUtils.radToDeg(player.yaw) % 360 + 360) % 360), p = Math.round(THREE.MathUtils.radToDeg(player.pitch));
  q.set('look', p ? h + ',' + p : String(h));
  if (player.fly) q.set('fly', Math.max(0, (player.pos.y - groundH(player.pos.x, player.pos.z)) / VY_PER_M).toFixed(1));
  if (player.third) q.set('view', 'third');
  if (timeIdx !== DEFAULT_TIME) q.set('time', TIMES[timeIdx].key);
  if (weatherIdx) q.set('weather', WEATHERS[weatherIdx].key);
  if (new URLSearchParams(location.search).has('month')) q.set('month', MONTH);
  return location.origin + location.pathname + '?' + q.toString().replace(/%2C/g, ',');
}
function shareLink() {
  const url = viewLink();
  history.replaceState(null, '', url);
  const title = 'Kneesall in Blocks: ' + lastPlace;
  if (TOUCH && navigator.share) { navigator.share({ title, url }).catch(() => {}); return; }
  const done = () => showToast('Link to this view copied');
  // where the clipboard API is refused, the old way: copy from a selected text box
  const fail = () => {
    const t = document.createElement('textarea'); t.value = url; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* not allowed */ }
    t.remove(); if (ok) done(); else showToast('Link to this view is in the address bar');
  };
  try { navigator.clipboard.writeText(url).then(done, fail); } catch (e) { fail(); }
}
function openLink(q) {
  // a time of day by name, or a clock time (?time=07:48), which joins the times T steps through
  const tq = q.get('time') ?? '', hm = tq.match(/^(\d{1,2}):(\d\d)$/);
  if (hm && +hm[1] < 24 && +hm[2] < 60) TIMES.splice(TIMES.length - 1, 0, { key: hm[1].padStart(2, '0') + ':' + hm[2], hour: +hm[1] + hm[2] / 60, at: true });
  const t = TIMES.findIndex(x => x.key === (hm ? hm[1].padStart(2, '0') + ':' + hm[2] : tq)); if (t >= 0) timeIdx = t;
  const w = WEATHERS.findIndex(x => x.key === q.get('weather')); if (w >= 0) weatherIdx = w;
  if (q.get('view') === 'third') player.third = true;
  const at = (q.get('at') ?? '').split(',').map(Number);
  if (at.length !== 2 || !at.every(Number.isFinite)) return;
  const [x, z] = K.project(at);
  if (x < BOUNDS.x0 + 2 || x > BOUNDS.x1 - 1 || z < BOUNDS.z0 + 2 || z > BOUNDS.z1 - 1) { linkNote = 'That place is outside the model'; return; }
  const [h = NaN, p = 0] = (q.get('look') ?? '').split(',').map(Number);
  if (Number.isFinite(h)) player.yaw = -THREE.MathUtils.degToRad(h);
  if (Number.isFinite(p)) player.pitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(p), -1.45, 1.45);
  const alt = parseFloat(q.get('fly'));
  if (q.has('fly')) {
    player.fly = true; player.pos.set(x, groundH(x, z) + (Number.isFinite(alt) ? alt : 10) * VY_PER_M, z);
    return;
  }
  // on foot: the nearest spot you can stand (a point from a map may be inside a house or a hedge)
  for (let r = 0; r <= 12; r += 0.5) for (let k = 0, n = Math.max(1, Math.round(r * 6)); k < n; k++) {
    const a = k / n * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (blocked(px, pz, groundH(px, pz))) continue;
    player.pos.set(px, supportH(px, pz, groundH(px, pz)), pz);
    return;
  }
  player.fly = true; player.pos.set(x, groundH(x, z) + 10 * VY_PER_M, z);
}
let linkNote = '';

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
  if (e.code === 'Space') e.preventDefault();
  if (started) command(e.code);
});
// a key's command (also the touch buttons')
function command(code) {
  const e = { code };
  if (e.code === 'KeyV') { player.third = !player.third; showToast(player.third ? 'Third person' : 'First person'); }
  if (e.code === 'KeyF') { player.fly = !player.fly; player.vy = 0; showToast(player.fly ? (TOUCH ? 'Fly mode' : 'Fly mode (Space up, C down)') : 'Walking'); syncActions(); }
  if (e.code === 'KeyT') { timeIdx = (timeIdx + 1) % TIMES.length; applyTime(); }
  if (e.code === 'KeyR') { weatherIdx = (weatherIdx + 1) % WEATHERS.length; applyWeather(); }
  if (e.code === 'KeyN') { sound.start(); showToast(sound.toggle() ? 'Sound on' : 'Sound off'); }
  if (e.code === 'KeyY') {
    // the next month: the village is rebuilt for it (a reload), and you come back where you were
    try { sessionStorage.setItem('kneesall-resume', JSON.stringify({ p: player.pos.toArray(), yaw: player.yaw, pitch: player.pitch, fly: player.fly, third: player.third, time: timeIdx })); } catch (e) { /* no storage */ }
    const q = new URLSearchParams(location.search); q.set('month', MONTH % 12 + 1); location.search = q;
  }
  if (e.code === 'KeyM') $('minimap').classList.toggle('hidden');
  if (e.code === 'KeyO') { aoOn = !aoOn; showToast(aoOn ? 'Ambient occlusion on' : 'Ambient occlusion off'); }
  if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  if (e.code === 'KeyL') shareLink();
  if (e.code === 'Fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }
}
// the round touch buttons follow fly mode: Jump and Fly walking; Up, Down and Land flying
function syncActions() {
  const up = document.querySelector('#actions [data-key="Space"]'), down = document.querySelector('#actions [data-key="KeyC"]'), fly = document.querySelector('#actions [data-key="KeyF"]');
  up.textContent = player.fly ? 'Up' : 'Jump';
  down.classList.toggle('hidden', !player.fly);
  fly.textContent = player.fly ? 'Land' : 'Fly'; fly.classList.toggle('on', player.fly);
  if (!player.fly) keys.KeyC = false;
}
if (document.fullscreenEnabled) document.querySelector('#touchbar [data-key="Fullscreen"]').classList.remove('hidden');
// touch buttons: a tap runs a key's command; Jump/Up and Down are held like Space and C
for (const b of document.querySelectorAll('#touchbar button, #actions button')) {
  const code = b.dataset.key, hold = b.dataset.hold !== undefined;
  // sharing and full screen need a real click; and a tap on the sideways-scrolling bar may be the start of a scroll
  if (b.closest('#touchbar')) { b.addEventListener('click', () => { if (started) command(code); }); continue; }
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (hold) keys[code] = true; else if (started) command(code); });
  for (const up of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(up, () => { if (hold) keys[code] = false; });
}
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

// touch: left half = move stick (drawn where the thumb comes down; pushed past its ring, you run), right half = look
const touch = { move: null, look: null, mx: 0, mz: 0, run: false };
const STICK_R = 50, STICK_RUN = 80;
function moveStick(dx, dy) {
  const d = Math.hypot(dx, dy), k = Math.min(d, STICK_RUN) / Math.max(d, 1e-6);
  touch.mx = THREE.MathUtils.clamp(dx / STICK_R, -1, 1); touch.mz = THREE.MathUtils.clamp(dy / STICK_R, -1, 1);
  touch.run = d >= STICK_RUN - 4;
  $('knob').style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  $('stick').classList.toggle('run', touch.run);
}
renderer.domElement.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.clientX < innerWidth / 2 && !touch.move) {
      touch.move = { id: t.identifier, x: t.clientX, y: t.clientY };
      const st = $('stick'); st.style.left = t.clientX + 'px'; st.style.top = t.clientY + 'px'; st.classList.remove('hidden'); moveStick(0, 0);
    } else if (!touch.look) touch.look = { id: t.identifier, x: t.clientX, y: t.clientY };
  }
}, { passive: false });
renderer.domElement.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) moveStick(t.clientX - touch.move.x, t.clientY - touch.move.y);
    if (touch.look && t.identifier === touch.look.id) { player.yaw -= (t.clientX - touch.look.x) * 0.005; player.pitch = THREE.MathUtils.clamp(player.pitch - (t.clientY - touch.look.y) * 0.005, -1.4, 1.4); touch.look.x = t.clientX; touch.look.y = t.clientY; }
  }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (touch.move && t.identifier === touch.move.id) { touch.move = null; touch.mx = touch.mz = 0; touch.run = false; $('stick').classList.add('hidden'); }
    if (touch.look && t.identifier === touch.look.id) touch.look = null;
  }
}
// iOS Safari pinch-zooms the page whatever the viewport tag and touch-action say, unless its gestures are refused
for (const g of ['gesturestart', 'gesturechange']) document.addEventListener(g, (e) => e.preventDefault(), { passive: false });
// a second finger is refused as it comes down (Safari settles on a pinch then, before anything moves), except on the
// bottom row, whose taps need their clicks; the walking and looking touches are the canvas's own and already refused
document.addEventListener('touchstart', (e) => { if (e.touches.length > 1 && !e.target.closest?.('#touchbar')) e.preventDefault(); }, { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
// and if the page is zoomed all the same (a browser set to allow zoom everywhere), put it back
const viewportTag = document.querySelector('meta[name=viewport]');
visualViewport?.addEventListener('resize', () => {
  if (visualViewport.scale <= 1.01) return;
  const c = viewportTag.content; viewportTag.content = c + ', minimum-scale=1'; requestAnimationFrame(() => { viewportTag.content = c; });
});
renderer.domElement.addEventListener('touchend', touchEnd, { passive: true });
renderer.domElement.addEventListener('touchcancel', touchEnd, { passive: true });

// ------------------------------------------------------------------ update
const fwd = new THREE.Vector3(), right = new THREE.Vector3();
let moveSpeed = 0;
function updatePlayer(dt) {
  const run = keys.ShiftLeft || keys.ShiftRight || touch.run;
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
  animateFigure(avatar, player.fly ? 0 : moveSpeed, dt);
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
  // "Now" follows the real sun, moved on every five minutes
  if (TIMES[timeIdx].now && performance.now() - timeAt > 300000) applyTime(true);
  // clouds drift downwind, and the weather is looked up again every quarter of an hour
  const to = (weather.windFrom + 180) * Math.PI / 180, v = 0.4 + weather.windSpeed * 0.4;
  for (const cl of dynamic.clouds) {
    cl.position.x += Math.sin(to) * v * dt; cl.position.z -= Math.cos(to) * v * dt;
    if (cl.position.x > 800) cl.position.x -= 1600; else if (cl.position.x < -800) cl.position.x += 1600;
    if (cl.position.z > 800) cl.position.z -= 1600; else if (cl.position.z < -800) cl.position.z += 1600;
  }
  updateRain(dt);
  if (WEATHERS[weatherIdx].live && performance.now() - liveAt > 900000) fetchWeather();
  if (dynamic.clock) {
    const d = modelNow(); const h = d.getHours() % 12 + d.getMinutes() / 60, m = d.getMinutes() + d.getSeconds() / 60;
    dynamic.clock.hr.rotation.z = -h / 12 * Math.PI * 2; dynamic.clock.mn.rotation.z = -m / 60 * Math.PI * 2;
  }
  updateTraffic(dt, t);
  updateLamps();
  updateShadows(t);
  // brick level of detail: bevelled bricks near the camera, plain faces further off
  for (const c of brickChunks) {
    const near = Math.hypot(c.x - camera.position.x, c.z - camera.position.z) - c.r < LOD_NEAR;
    if (c.near) c.near.visible = near || !c.far;
    if (c.far) c.far.visible = !near || !c.near;
  }
  // stud level-of-detail
  for (const s of studChunks) {
    const d = Math.hypot(s.x - camera.position.x, s.z - camera.position.z);
    s.near.visible = d < STUD_NEAR;
    s.far.visible = d >= STUD_NEAR && d < STUD_FAR;
  }
  streamGroundStuds();
}

// The shadow camera follows the player in steps of about two studs (a whole number of shadow texels, so edges don't
// shimmer), and the shadow map is redrawn only when it moves, the figure is on show, the sun changes or the clouds
// have drifted a little
let shadowsDirty = true, shadowAt = '', shadowT = 0, figPose = '';
function updateShadows(t) {
  const tex = (2 * SR) / sun.shadow.mapSize.x, step = tex * Math.round(2 / tex);
  const cx = Math.round(player.pos.x / step) * step, cz = Math.round(player.pos.z / step) * step, at = cx + ',' + cz;
  const pose = player.third ? [player.pos.x, player.pos.y, player.pos.z, player.yaw, moveSpeed > 0.1].join() : '';
  if (!shadowsDirty && at === shadowAt && pose === figPose && t - shadowT < 0.5) return;
  shadowsDirty = false; shadowAt = at; shadowT = t; figPose = pose;
  sun.target.position.set(cx, 0, cz);
  sun.position.set(cx + sunDir.x * 300, sunDir.y * 300, cz + sunDir.z * 300);
  renderer.shadowMap.needsUpdate = true;
}

const LOD_NEAR = 40;   // studs from a chunk's bounding sphere to the camera within which its bricks are bevelled
const STUD_NEAR = 35, STUD_FAR = 90;   // rounded studs within STUD_NEAR of a chunk's centre, plain ones out to STUD_FAR

// Real stud geometry on the baseplate is created on demand around the camera (the texture covers the rest)
const GS = 16;
function streamGroundStuds() {
  const cx = Math.floor(camera.position.x / GS), cz = Math.floor(camera.position.z / GS), R = Math.ceil(STUD_FAR / GS);
  let made = 0;
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const k = (cx + i) + ',' + (cz + j);
    const ch = groundStuds.get(k);
    const mx = (cx + i + 0.5) * GS, mz = (cz + j + 0.5) * GS;
    const d = Math.hypot(mx - camera.position.x, mz - camera.position.z);
    if (ch) { if (ch.near) { ch.near.visible = d < STUD_NEAR; ch.far.visible = d >= STUD_NEAR && d < STUD_FAR; } continue; }
    if (d > STUD_FAR || made > 6) continue;
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
    near.visible = d < STUD_NEAR; far.visible = d >= STUD_NEAR && d < STUD_FAR;
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
  // rights of way as the Ordnance Survey's Landranger maps show them: short red dashes for footpaths, long for bridleways
  x.strokeStyle = '#d4291c'; x.lineWidth = 1.2; x.lineCap = 'butt';
  for (const r of K.rightsOfWay ?? []) {
    x.setLineDash(r.kind === 'public_bridleway' ? [6, 3] : [2.5, 2.5]);
    x.beginPath(); r.pts.forEach(([px, pz], i) => (i ? x.lineTo : x.moveTo).call(x, px - BOUNDS.x0, pz - BOUNDS.z0)); x.stroke();
  }
  x.setLineDash([]);
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
    // or the public footpath or bridleway
    if (!best) for (const r of K.rightsOfWay ?? []) if (distToPolyline(player.pos.x, player.pos.z, r.pts).d < 4) { best = r.kind === 'public_bridleway' ? 'Public bridleway' : 'Public footpath'; break; }
  }
  const name = best ?? 'Kneesall';
  if (name !== lastPlace) { lastPlace = name; $('place').textContent = name; }
}

// ------------------------------------------------------------------ postprocessing
let composer, gtao, aoOn = !TOUCH;
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
  // a phone turned round mid-drag: let go of the stick rather than leave it walking
  if (touch.move) touchEnd({ changedTouches: [{ identifier: touch.move.id }] });
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ sound
const sound = new Soundscape();
window.__dbg.sound = sound;
let soundPrev = null, treesNear = 0, treesAt = 0;
function updateSound(dt, now) {
  const p = player.pos;
  // how wooded it is about you (for the birds), looked at twice a second
  if (now - treesAt > 500) { treesAt = now; let n = 0; for (const [x, z] of treeXZ) if (Math.abs(x - p.x) < 30 && Math.abs(z - p.z) < 30) n++; treesNear = Math.min(1, n / 8); }
  const moved = soundPrev && player.onGround && !player.fly ? Math.hypot(p.x - soundPrev.x, p.z - soundPrev.z) : 0;
  soundPrev = { x: p.x, z: p.z };
  const d = modelNow();
  sound.update(dt, { x: camera.position.x, z: camera.position.z, yaw: player.yaw, cars: traffic.cars, weather, month: MONTH,
    hour: d.getHours() + d.getMinutes() / 60, trees: treesNear, step: moved < 2 ? moved : 0,
    hard: G.has(Math.floor(p.x), Math.floor(p.z), 2) });
}

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
  // the composer is only needed for ambient occlusion; without it, straight to the screen
  if (composer && aoOn) composer.render(); else renderer.render(scene, camera);
  drawMinimap(); updatePlace();
  if (started) updateSound(dt, now);
  // adaptive quality: if the first few seconds are slow, drop AO and resolution
  if (!perfChecked && started) {
    frames++; perfT += dt;
    if (perfT > 4) {
      perfChecked = true;
      const fps = frames / perfT;
      if (fps < 30) {
        aoOn = false; pixelRatio = Math.min(pixelRatio, 1); renderer.setPixelRatio(pixelRatio);
        sun.shadow.mapSize.set(2048, 2048); sun.shadow.map?.dispose(); sun.shadow.map = null; shadowsDirty = true;
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
    avatar = makeFigure({ torso: PAL.red, legs: PAL.darkBlue, print: 'shirt', hair: PAL.brown });
    scene.add(avatar);
    applyTime();
    fetchWeather();
    if (!WEATHERS[weatherIdx].live) applyWeather(true);
    setupPost();
    status('Ready: ' + MONTHS[MONTH - 1] + (MONTH === new Date().getMonth() + 1 ? ' (this month)' : ''));
    $('start').disabled = false; $('start').textContent = 'Enter Kneesall';
    requestAnimationFrame(loop);
  } catch (e) {
    console.error(e); status('Something went wrong: ' + e.message);
  }
})();
$('start').addEventListener('click', () => {
  started = true; last = performance.now();
  sound.start();
  $('intro').classList.add('hidden');
  syncActions();
  lockPointer();
  if (linkNote) showToast(linkNote);
});
