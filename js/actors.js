// The player's minifigure
import * as THREE from 'three';
import { PAL } from './bricks.js';

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
