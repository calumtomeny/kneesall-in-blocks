// Builds LEGO Kneesall from open data (data/kneesall.json + terrain.bin + ndsm.bin).
// Real, from OpenStreetMap: roads and names, church/restaurant/school/café identities, churchyard, playground,
//   car parks, hedges, woods, streams/ditches, power poles, bus stops, post box, benches.
// Real, from Ordnance Survey OpenMap Local: every building outline.
// Real, from Environment Agency LIDAR: ground shape, building heights and roof forms (gable/hip/flat),
//   roof materials (laser intensity), individual trees, and hedgerows (low vegetation).
// Hand-surveyed (data/survey.json): a few buildings measured from LIDAR and photographs, replacing OS outlines.
// From Historic England listings: Old Hall, Old Hall Cottage and the war memorial.
// From the Rural Payments Agency's Crop Map of England (CROME): the crop in each field.
// Invented: wall brick shades, street lamp positions, and (only without OS data) extra houses along unmapped roads.
import * as THREE from 'three';
import { World, Builder, PAL, BRICK, PLATE, F_TILE, F_HIDDEN, F_NOCOLLIDE, F_PLAIN, col, rng } from './bricks.js';
import { R, pick, tree, conifer, hedge, lamp, postBox, bench, sign } from './parts.js';
import { warMemorial, headstone, cow, tractor } from './landmarks.js';
import { buildingFromPolygon, buildingFromRect, churchFromPolygon, houseStyle, STYLES, MATERIALS, roofMaterial } from './buildings.js';
import { surveyedBuildings, surveyGrounds, surveyRoads, fittedBuilding } from './survey.js';
import { KWALL } from './roofs.js';
import { polyCells, pointInPoly, lineCells, distToPolyline, polylineLength, pointAlong, chainPolylines, ribbonY, dashesY, centroid, polyArea } from './geo.js';

const ROAD = {
  primary: { hw: 5, col: PAL.dbg, pave: true, dash: true },
  secondary: { hw: 4.5, col: PAL.dbg, pave: true },
  tertiary: { hw: 4, col: PAL.dbg, pave: true, dash: true },   // Ossington Road has a dashed centre line (Street View)
  unclassified: { hw: 4, col: PAL.dbg, pave: true },
  residential: { hw: 4, col: PAL.dbg, pave: true },
  service: { hw: 2.5, col: PAL.dbg },
  track: { hw: 2, col: PAL.darkTan, cells: true },
  footway: { hw: 1.3, col: PAL.tan },
  path: { hw: 1.2, col: PAL.tan },
  bridleway: { hw: 1.5, col: PAL.darkTan, cells: true },
  gravel: { hw: 2.2, col: PAL.darkTan, cells: true },
};
const PAVE = 2.6;              // pavement width beyond the carriageway
// carriageways stand a little above pavements so that where one road's pavement meets another road's carriageway
// (every junction) the carriageway always shows
const ROAD_TOP = 0.5, PAVE_TOP = 0.4;
const VILLAGE_R = 330;         // pavements / street lamps only near the village

// Listed buildings that OSM doesn't map (coordinates from Historic England via Wikipedia)
const LISTED = {
  oldHall: [53.17068, -0.95048],
  oldHallCottage: [53.17073, -0.94966],
  warMemorial: [53.17029, -0.94850],
};

export class Ground {
  constructor(half) {
    this.half = half; const n = this.n = half * 2;
    this.col = new Uint32Array(n * n).fill(PAL.green);
    this.base = new Float32Array(n * n);   // terrain height (whole plates)
    this.top = new Float32Array(n * n);    // walkable surface height
    this.stud = new Uint8Array(n * n).fill(1);
    this.occ = new Uint8Array(n * n);   // 1 building, 2 road+verge, 4 area, 8 water, 16 village, 32 blocked-for-infill, 64 carriageway
  }
  i(x, z) { x += this.half; z += this.half; return (x < 0 || z < 0 || x >= this.n || z >= this.n) ? -1 : z * this.n + x; }
  set(x, z, c, top = 0, stud = 1) { const i = this.i(x, z); if (i < 0) return; this.col[i] = c; this.top[i] = this.base[i] + top; this.stud[i] = stud; }
  baseAt(x, z) { const i = this.i(Math.min(this.half - 1, Math.max(-this.half, x)), Math.min(this.half - 1, Math.max(-this.half, z))); return this.base[i]; }
  flag(x, z, f) { const i = this.i(x, z); if (i >= 0) this.occ[i] |= f; }
  has(x, z, f) { const i = this.i(x, z); return i >= 0 && (this.occ[i] & f) !== 0; }
  heightAt(x, z) { const i = this.i(Math.floor(x), Math.floor(z)); return i < 0 ? 0 : this.top[i]; }
}

export function buildKneesall(data, opts = {}) {
  const half = data.half;
  const G = new Ground(half);
  const W = new World();
  const lat0 = data.origin[0], lon0 = data.origin[1], mps = data.metresPerStud;
  const project = ([lat, lon]) => [(lon - lon0) * Math.cos(lat0 * Math.PI / 180) * 111320 / mps, -(lat - lat0) * 110540 / mps];
  const inBounds = (x, z, m = 0) => Math.abs(x) < half - m && Math.abs(z) < half - m;
  const labels = [];

  // ------------------------------------------------------------ terrain (LIDAR bare earth), in units above the village centre
  const T = data.terrainArr, TI = data.terrain;
  const terrainY = !T ? () => 0 : (x, z) => {
    let fx = (x - TI.min) / TI.step, fz = (z - TI.min) / TI.step;
    fx = Math.max(0, Math.min(TI.n - 1.001, fx)); fz = Math.max(0, Math.min(TI.n - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = TI.n;
    const h = T[j * n + i] * (1 - u) * (1 - v) + T[j * n + i + 1] * u * (1 - v) + T[(j + 1) * n + i] * (1 - u) * v + T[(j + 1) * n + i + 1] * u * v;
    return h / 100 / mps;
  };
  for (let z = -half; z < half; z++) for (let x = -half; x < half; x++) {
    const i = G.i(x, z); G.base[i] = G.top[i] = Math.round(terrainY(x + 0.5, z + 0.5) / PLATE) * PLATE;
  }
  W.baseAt = (x, z) => G.baseAt(x, z);
  // height above ground from the LIDAR surface model (metres), 0 where unknown
  const ND = data.ndsmArr;
  const ndsm = (x, z) => { if (!ND) return 0; const i = G.i(x, z); return i < 0 ? 0 : ND[i] / 10; };
  const lidar = !!ND && !!data.trees;
  // LIDAR surface over buildings (metres above ground, per stud): shapes walls and roofs stud by stud
  const RF = data.roofsArr;
  const roofHeight = (x, z) => { const i = G.i(Math.floor(x), Math.floor(z)); return i < 0 ? 0 : RF[i] / 10; };

  const roads = data.roads.filter(r => ROAD[r.type] && !r.area).map(r => ({ ...r, spec: ROAD[r.type] }));
  // unsealed service roads (OSM surface tag, or resurfaced by the survey) are gravel tracks
  const survey = data.survey && data.bng ? data.survey : null;
  for (const s of survey ? surveyRoads(survey, data.bng) : []) {
    const r = roads.reduce((best, r) => { const d = distToPolyline(s.x, s.z, r.pts).d; return d < best.d ? { d, r } : best; }, { d: 8 }).r;
    if (r) r.surface = s.surface;
  }
  for (const r of roads) if (r.type === 'service' && /^(gravel|fine_gravel|unpaved|compacted|dirt)$/.test(r.surface)) r.spec = ROAD.gravel;
  // pavements: the OSM sidewalk tag, or what Street View showed (survey.json), as a list of sides of the way's
  // direction; null where nobody knows, which gets pavements both sides inside the village
  for (const s of data.survey?.roads ?? []) if (s.osm) { const r = roads.find(r => r.id === s.osm); if (r) r.sidewalk = s.sidewalk; }
  for (const r of roads) {
    const sw = r.sidewalk ?? '';
    r.sides = !r.spec.pave ? [] : (sw === 'both' || sw === 'yes') ? ['left', 'right'] : (sw === 'left' || sw === 'right') ? [sw] : /^(no|none|separate)$/.test(sw) ? [] : null;
  }
  const paved = (r) => (r.sides === null ? !!r.spec.pave : r.sides.length > 0);
  // which side of a road (left/right of its direction) a point is on, by its nearest segment
  const sideOf = (r, x, z) => {
    const n = distToPolyline(x, z, r.pts), a = r.pts[n.seg], b = r.pts[n.seg + 1];
    return (x - n.qx) * -(b[1] - a[1]) + (z - n.qz) * (b[0] - a[0]) > 0 ? 'right' : 'left';
  };
  // is the cell (x, z), d from the centre line, on one of r's pavements?
  const onPave = (r, x, z, d) => d > r.spec.hw && (r.sides === null ? !!r.spec.pave : r.sides.includes(sideOf(r, x + 0.5, z + 0.5)));
  const carRoads = roads.filter(r => ['primary', 'secondary', 'tertiary', 'unclassified', 'residential'].includes(r.type));
  const nearestRoad = (x, z, list = carRoads) => {
    let best = null;
    for (const r of list) { const d = distToPolyline(x, z, r.pts); if (!best || d.d < best.d) best = { ...d, road: r }; }
    return best;
  };
  const frontTo = (x, z) => { const n = nearestRoad(x, z); const dx = n.qx - x, dz = n.qz - z, L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };

  // ------------------------------------------------------------ kerb corners
  // Where two roads meet, the kerbs sweep round on a radius instead of meeting in a point: in each corner between
  // neighbouring legs, the carriageway is filled out to an arc tangent to both kerbs (`fill`), and where both roads
  // have a pavement on that corner it turns with the kerb (`pave`, the band inside the arc).
  const KERB_R = 7;   // studs (about 5 m)
  const kerbCorners = [];
  {
    const legs = new Map();
    for (const r of roads) {
      if (!['primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service'].includes(r.type) || r.spec.cells) continue;
      r.pts.forEach((p, i) => {
        const k = p[0] + ',' + p[1];
        if (!legs.has(k)) legs.set(k, []);
        if (i > 0) legs.get(k).push({ r, pts: r.pts.slice(0, i + 1).reverse(), way: -1 });
        if (i < r.pts.length - 1) legs.get(k).push({ r, pts: r.pts.slice(i), way: 1 });
      });
    }
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    const unit = ([x, z]) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
    for (const [k, L] of legs) {
      if (new Set(L.map(l => l.r)).size < 2) continue;   // only where two ways meet
      const [nx, nz] = k.split(',').map(Number);
      for (const l of L) {
        l.len = polylineLength(l.pts);
        const p = pointAlong(l.pts, Math.min(4, l.len));
        l.u = unit([p.x - nx, p.z - nz]); l.a = Math.atan2(l.u[1], l.u[0]);
      }
      L.sort((a, b) => a.a - b.a);
      for (let j = 0; j < L.length; j++) {
        const A = L[j], B = L[(j + 1) % L.length];
        let da = B.a - A.a; if (da <= 0) da += 2 * Math.PI;
        if (da > Math.PI * 0.85 || da < 0.35) continue;   // nearly straight on, or too sharp to round
        const u1 = A.u, u2 = B.u, c12 = dot(u1, u2);
        const n1 = unit([u2[0] - c12 * u1[0], u2[1] - c12 * u1[1]]), n2 = unit([u1[0] - c12 * u2[0], u1[1] - c12 * u2[1]]);
        const h1 = A.r.spec.hw, h2 = B.r.spec.hw, R = KERB_R, d12 = dot(n1, n2);
        const t1 = (h2 + R - d12 * (h1 + R)) / dot(u1, n2), t2 = (h1 + R - d12 * (h2 + R)) / dot(u2, n1);
        if (!(t1 > 0 && t2 > 0 && t1 < A.len - 1 && t2 < B.len - 1)) continue;
        const k1 = (h2 - d12 * h1) / dot(u1, n2);
        const at = (n, h, u, t) => [nx + n[0] * h + u[0] * t, nz + n[1] * h + u[1] * t];
        const C = at(n1, h1 + R, u1, t1), T1 = at(n1, h1, u1, t1), T2 = at(n2, h2, u2, t2), K = at(n1, h1, u1, k1);
        const a0 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
        let sweep = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a0;
        sweep = ((sweep + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        const arc = (rad) => Array.from({ length: 9 }, (_, i) => [C[0] + rad * Math.cos(a0 + sweep * i / 8), C[1] + rad * Math.sin(a0 + sweep * i / 8)]);
        // which side of each road (left/right of its way) faces the corner, and whether it has a pavement there
        const side = (l, n) => ((dot(n, [-l.u[1], l.u[0]]) > 0) === (l.way > 0) ? 'right' : 'left');
        const paved = (l, n) => !!l.r.spec.pave && (l.r.sides === null ? Math.hypot(nx, nz + 40) < VILLAGE_R + 40 : l.r.sides.includes(side(l, n)));
        const outer = arc(R);
        kerbCorners.push({ fill: [K, ...outer], arc: outer, C, R, col: A.r.spec.col,
          pave: paved(A, n1) && paved(B, n2) ? [...outer, ...arc(R - PAVE).reverse()] : null, inner: arc(R - PAVE) });
      }
    }
  }

  // ------------------------------------------------------------ areas
  const areaFlag = { cemetery: 4, school: 4, pub: 4, playground: 4, parking: 4, farmyard: 4, works: 4, wood: 0, grass: 0, farmland: 0, meadow: 0 };
  for (const a of data.areas) if (areaFlag[a.kind]) polyCells(a.pts, (x, z) => G.flag(x, z, 4 | 32));

  // ------------------------------------------------------------ infill blockers: roads (+margin), areas
  for (const r of roads) lineCells(r.pts, r.spec.hw + (r.spec.pave ? PAVE : 0) + 3, (x, z) => G.flag(x, z, 32));

  // ------------------------------------------------------------ buildings
  const buildings = [];
  const addBuilding = (P) => {
    if (!P) return;
    buildings.push(P);
    polyCells(P.poly, (x, z) => { G.flag(x, z, 1); for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) G.flag(x + dx, z + dz, 32); });
    if (P.label) { const [cx, cz] = centroid(P.poly); labels.push({ name: P.label, x: cx, z: cz, r: Math.sqrt(Math.abs(polyArea(P.poly))) / 2 + 2 }); }
  };
  const area = (a) => data.areas.filter(x => x.kind === a);
  const inArea = (kind, x, z) => area(kind).some(a => pointInPoly(x, z, a.pts));
  const cafe = data.pois.find(p => p.kind === 'cafe');

  const styleFor = (pts, name, type, cx, cz, b = {}) => {
    const zone = cz < -220 ? 'modern' : 'old';
    const ar = Math.abs(polyArea(pts));
    if (type === 'school' || /school/i.test(name) || inArea('school', cx, cz)) return { wall: PAL.darkOrange, roof: PAL.dbg, floors: 1, door: PAL.blue, lintel: PAL.lbg, label: 'Kneesall CofE Primary Academy', chimneys: 0 };
    // the old Angel Inn, now the Rajdhaani restaurant: red brick over a white-painted ground floor (Street View)
    if (inArea('pub', cx, cz) && ar > 120) return { wall: MATERIALS.redBrick, groundWall: PAL.white, plinth: PAL.black, roof: PAL.dbg, floors: 2, door: PAL.white, porch: true, label: 'Rajdhaani', chimney: MATERIALS.redBrick };
    if (cafe && pointInPoly(cafe.x, cafe.z, pts)) return { wall: PAL.darkRed, roof: PAL.red, floors: 1, frame: PAL.reddishBrown, door: PAL.reddishBrown, label: 'Hay Barn Café', chimneys: 0 };
    if (inArea('farmyard', cx, cz) || ar > 420) {
      // modern sheds (low-pitched sheeting) are clad; traditional pitched farm ranges are brick
      const shed = /^sheet/.test(roofMaterial(b) ?? 'sheet');
      return { wall: shed ? pick(STYLES.farm.walls) : pick(STYLES.old.walls), roof: pick(STYLES.farm.roofs), floors: 1, windows: false, chimneys: 0, door: PAL.dbg, roofCap: 5, barn: true };
    }
    const o = houseStyle(zone);
    return ar < 45 ? { ...o, floors: 1, chimneys: 0, porch: false } : o;
  };
  const listedAt = { oldHall: project(LISTED.oldHall), oldHallCottage: project(LISTED.oldHallCottage) };
  const OLD_HALL = { wall: PAL.darkRed, plinth: PAL.dbg, roof: PAL.dbg, frame: PAL.tan, lintel: PAL.nougat, quoins: PAL.nougat, door: PAL.reddishBrown, chimneys: 2, chimney: PAL.darkRed, floors: 2, label: 'Old Hall (c.1525)' };
  const OLD_HALL_COTTAGE = { wall: MATERIALS.redBrick, roof: MATERIALS.pantile, lintel: PAL.lbg, chimneys: 2, floors: 2, label: 'Old Hall Cottage' };

  if (data.osBuildings) {
    // Ordnance Survey outlines; OSM supplies names, LIDAR the height and roof form
    const nearestTo = ([x, z]) => {
      let best = null, bd = 40;
      for (const b of data.osBuildings) { const [cx, cz] = centroid(b.pts); const d = pointInPoly(x, z, b.pts) ? 0 : Math.hypot(cx - x, cz - z); if (d < bd) { bd = d; best = b; } }
      return best;
    };
    const oldHall = nearestTo(listedAt.oldHall), cottage = nearestTo(listedAt.oldHallCottage);
    // hand-surveyed buildings replace any OS outline they mostly cover
    const surveyed = survey ? surveyedBuildings(survey, data.bng) : [];
    const details = (survey?.details ?? []).map(d => ({ ...d, xz: project(d.at) }));
    for (const P of surveyed) addBuilding(P);
    const replaced = (pts) => {
      let n = 0, hit = 0;
      polyCells(pts, (x, z) => { n++; if (surveyed.some(P => pointInPoly(x + 0.5, z + 0.5, P.poly))) hit++; });
      return n > 0 && hit / n > 0.3;
    };
    for (const b of data.osBuildings) {
      const [cx, cz] = centroid(b.pts);
      if (!inBounds(cx, cz, 6) || replaced(b.pts)) continue;
      const osm = data.buildings.find(o => pointInPoly(cx, cz, o.pts) || pointInPoly(...centroid(o.pts), b.pts));
      const name = b.name || osm?.name || '';
      if (/church/i.test(name) && !/school/i.test(name)) { addBuilding(churchFromPolygon(b.pts)); continue; }
      let o = b === oldHall ? { ...OLD_HALL } : b === cottage ? { ...OLD_HALL_COTTAGE } : styleFor(b.pts, name, osm?.type, cx, cz, b);
      // garages and sheds the OS outlines miss (survey.json "lidarBuildings"): one storey, a wide door, no windows
      if (b.lidarOnly) o = { ...o, floors: 1, chimneys: 0, windows: false, porch: false };
      // roof material measured by the LIDAR
      const rm = roofMaterial(b);
      if (rm) o.roof = MATERIALS[rm];
      // what was seen in Street View and aerial photographs (survey.json "details")
      const seen = details.find(d => pointInPoly(...d.xz, b.pts));
      let front = frontTo(cx, cz);
      if (seen) {
        const mat = (k) => MATERIALS[seen[k]] ?? PAL[seen[k]];
        if (seen.wall) o.wall = mat('wall');
        if (seen.groundWall) o.groundWall = mat('groundWall');
        if (seen.plinth) o.plinth = mat('plinth');
        if (seen.roof) { o.roof = mat('roof'); o.fixedRoof = true; }
        if (seen.door) o.door = mat('door');
        if (seen.frame) o.frame = mat('frame');
        if (seen.label) o.label = seen.label;
        const deg = (v) => (typeof v === 'number' ? v : { n: 0, e: 90, s: 180, w: 270 }[v]);
        if (seen.front !== undefined) { const f = deg(seen.front) * Math.PI / 180; front = [Math.sin(f), -Math.cos(f)]; }
        if (seen.solar) o.solar = { face: deg(seen.solar.face), span: seen.solar.span };
        if (seen.doors) o.doorAt = seen.doors;
        // windows seen on the front make it a house, even in a farmyard (barns get no windows and a wide door)
        if (seen.windows) { o.frontWindows = seen.windows; if (o.windows === false && seen.windows.some(n => n > 0)) { delete o.windows; o.barn = false; } }
        if (seen.chimneys) o.chimneyAlong = seen.chimneys;
        if (seen.storeys) o.floors = seen.storeys;
        if (seen.porch) o.canopy = seen.porch;
        if (seen.gablets) o.gablets = seen.gablets;
        if (seen.garages) o.garages = seen.garages.map(([f, c, n]) => [f, MATERIALS[c] ?? PAL[c] ?? PAL.white, n]);
      }
      // LIDAR: storeys from roof height, roof form from the surface model (h is 0 for buildings newer than the survey)
      if (b.h > 0 && !seen?.storeys && !o.label?.startsWith('Kneesall CofE')) {
        if (o.barn) o.floors = b.h > 8 ? 2 : 1;
        else o.floors = b.h < 5.2 ? 1 : b.h < 9.8 ? 2 : 3;
        // garages, sheds and stores: too small or low to be lived in, so no chimney stacks
        if (b.areaM2 < 60 || b.h < 4.5) o.chimneys = 0;
      }
      if (RF) o.heightAt = roofHeight;
      if (b.roof === 'hip') o.hip = true;
      if (b.roof === 'flat') { o.roofCap = 0; o.chimneys = 0; }
      // measured parts from tools/fit_buildings.py where the LIDAR covers the building, else the outline
      const fitted = b.fit && data.bng && fittedBuilding(b.fit, data.bng, o, front);
      addBuilding(fitted || buildingFromPolygon(b.pts, front, o));
    }
  } else {
    for (const b of data.buildings) {
      const [cx, cz] = centroid(b.pts);
      if (!inBounds(cx, cz, 10)) continue;
      if (/church/i.test(b.name)) { addBuilding(churchFromPolygon(b.pts)); continue; }
      const o = styleFor(b.pts, b.name, b.type, cx, cz);
      if (b.levels) o.floors = Math.max(1, Math.min(3, +b.levels));
      addBuilding(buildingFromPolygon(b.pts, frontTo(cx, cz), o));
    }
    // listed buildings OSM doesn't map, placed at their listing coordinates
    const [hx, hz] = listedAt.oldHall;
    addBuilding(buildingFromRect(hx, hz, 24, 12, frontTo(hx, hz), OLD_HALL));
    const P = buildings[buildings.length - 1];
    const [wx, wz] = P.toWorld(18, 20);
    addBuilding(buildingFromRect(wx, wz, 9, 14, frontTo(hx, hz), { wall: PAL.darkRed, roof: PAL.red, frame: PAL.tan, chimneys: 1, chimney: PAL.darkRed, floors: 2 }));
    const [cx, cz] = listedAt.oldHallCottage;
    addBuilding(buildingFromRect(cx, cz, 14, 10, frontTo(cx, cz), OLD_HALL_COTTAGE));
  }

  // Infill: generic houses along road frontages with no mapped buildings (default only without OS data)
  if (opts.infill ?? !data.osBuildings) {
    const IR = rng(4242);
    const frontage = carRoads.filter(r => r.type !== 'service');
    for (const r of frontage) {
      const L = polylineLength(r.pts);
      for (const side of [-1, 1]) for (let s = 6; s < L - 6; s += 19 + IR() * 6) {
        const p = pointAlong(r.pts, s);
        if (Math.hypot(p.x, p.z + 40) > 300 || IR() < 0.18) continue;
        const w = 12 + Math.floor(IR() * 4) * 2, d = 10 + Math.floor(IR() * 2) * 2;
        const back = r.spec.hw + PAVE + 5 + IR() * 4 + d / 2;
        const nx = -p.dz * side, nz = p.dx * side;           // unit normal towards this side
        const cx = p.x + nx * back, cz = p.z + nz * back;
        if (!inBounds(cx, cz, 20)) continue;
        const c = Math.cos(Math.atan2(-nx, nz)), sn = Math.sin(Math.atan2(-nx, nz));
        const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([lx, lz]) => [cx + lx * c - lz * sn, cz + lx * sn + lz * c]);
        let ok = true;
        polyCells(corners, (x, z) => { if (G.has(x, z, 32) || !inBounds(x, z, 4)) ok = false; });
        if (!ok) continue;
        addBuilding(buildingFromRect(cx, cz, w, d, [-nx, -nz], { ...houseStyle(cz < -220 ? 'modern' : 'old'), generated: true }));
        buildings[buildings.length - 1].generated = true;
      }
    }
  }

  // each building sits on the lowest ground under its footprint; the plot is levelled to that height
  for (const P of buildings) {
    let lo = Infinity;
    polyCells(P.poly, (x, z) => { const i = G.i(x, z); if (i >= 0) lo = Math.min(lo, G.base[i]); });
    P.y = lo === Infinity ? G.baseAt(...centroid(P.poly).map(Math.floor)) : lo;
    polyCells(P.poly, (x, z) => { const i = G.i(x, z); if (i >= 0) { G.base[i] = G.top[i] = P.y; } });
  }

  // ------------------------------------------------------------ village zone (gardens rather than fields)
  for (const P of buildings) {
    const [cx, cz] = centroid(P.poly), rr = 34 + Math.sqrt(Math.abs(polyArea(P.poly))) / 2;
    for (let z = Math.floor(cz - rr); z <= cz + rr; z++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) if ((x - cx) ** 2 + (z - cz) ** 2 < rr * rr) G.flag(x, z, 16);
  }
  for (const a of data.areas) if (areaFlag[a.kind]) polyCells(a.pts, (x, z) => G.flag(x, z, 16));

  // roads and water claim their cells before the fields are laid out
  for (const r of roads) lineCells(r.pts, r.spec.hw + (paved(r) ? PAVE : 0), (x, z, d) => { if (d <= r.spec.hw + 0.5 || onPave(r, x, z, d)) G.flag(x, z, 2); });
  for (const r of roads) lineCells(r.pts, r.spec.hw + 0.5, (x, z) => G.flag(x, z, 64));
  // kerb corners that would run into a building are left square
  for (let i = kerbCorners.length - 1; i >= 0; i--) { let hit = false; polyCells(kerbCorners[i].pave ?? kerbCorners[i].fill, (x, z) => { if (G.has(x, z, 1)) hit = true; }); if (hit) kerbCorners.splice(i, 1); }
  for (const c of kerbCorners) { if (c.pave) polyCells(c.pave, (x, z) => G.flag(x, z, 2)); polyCells(c.fill, (x, z) => G.flag(x, z, 2 | 64)); }
  for (const l of data.lines) if (l.kind === 'ditch' || l.kind === 'stream') lineCells(l.pts, l.kind === 'stream' ? 1.6 : 1.0, (x, z) => G.flag(x, z, 8));

  // ------------------------------------------------------------ LIDAR trees and hedgerows
  const hedgeMask = new Uint8Array(G.n * G.n);
  if (lidar) {
    const nearTree = new Uint8Array(G.n * G.n);
    for (const t of data.trees) {
      const x = Math.floor(t.x), z = Math.floor(t.z);
      if (!inBounds(x, z, 4) || G.has(x, z, 1 | 64 | 8)) continue;
      const r = Math.max(2.5, Math.min(7, t.r / mps * 0.9));
      const trunk = Math.max(3, Math.min(9, Math.round(t.h / (BRICK * mps) * 0.4)));
      tree(W, x, z, { r, trunk });
      const rr = Math.ceil(r);
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) if (dx * dx + dz * dz <= r * r) { const i = G.i(x + dx, z + dz); if (i >= 0) nearTree[i] = 1; }
    }
    // low vegetation (1–4.5 m) that isn't under a tree crown = hedges and shrubs
    for (let z = -half; z < half; z++) for (let x = -half; x < half; x++) {
      const i = G.i(x, z), h = ndsm(x, z);
      if (h < 1.0 || nearTree[i] || (G.occ[i] & (1 | 64 | 8))) continue;
      if ((G.occ[i] & 2) && Math.hypot(x, z + 40) < VILLAGE_R + 40) continue;   // keep pavements clear
      if (h > 4.5) { hedgeMask[i] = 2; continue; }   // tall vegetation without a detected trunk: leave as a barrier only
      hedgeMask[i] = 1;
      W.set(x, 0, z, (x * 3 + z * 5) % 23 === 0 ? PAL.green : PAL.darkGreen, F_PLAIN);
      if (h > 1.7) W.set(x, 1, z, (x + z) % 17 === 0 ? PAL.olive : PAL.darkGreen, F_PLAIN);
    }
  }

  // ------------------------------------------------------------ farmland: fields bounded by real hedges, roads and streams
  const FR = rng(77), SP = 170, I0 = Math.floor(-half / SP) - 2, NI = Math.ceil(2 * half / SP) + 5, seeds = [];
  for (let j = 0; j < NI; j++) for (let i = 0; i < NI; i++) seeds.push([(I0 + i + 0.15 + FR() * 0.7) * SP, (I0 + j + 0.15 + FR() * 0.7) * SP, Math.floor(FR() * 6)]);
  const seed = (i, j) => seeds[(j - I0) * NI + (i - I0)];
  const fieldId = new Int32Array(G.n * G.n).fill(-1);
  const CROPS = {
    wheat: { c: PAL.tan, top: PLATE, alt: PAL.darkTan },
    barley: { c: PAL.darkTan, top: PLATE, alt: PAL.tan },
    oats: { c: PAL.tan, top: PLATE, alt: PAL.olive },
    maize: { c: PAL.darkGreen, top: PLATE, alt: PAL.green },
    beans: { c: PAL.olive, top: PLATE, alt: PAL.darkGreen },
    beet: { c: PAL.green, top: PLATE, alt: PAL.darkGreen },
    rape: { c: PAL.yellow, top: PLATE, alt: PAL.brightLightYellow },
    pasture: { c: PAL.green, top: 0, alt: PAL.lime, pasture: true },
    ploughed: { c: PAL.reddishBrown, top: PLATE, plough: true },
  };
  // invented crops, where nothing better is known
  const crops = [CROPS.wheat, CROPS.rape, CROPS.pasture, CROPS.barley, CROPS.ploughed, CROPS.wheat];
  // Crop Map of England (CROME) land-use codes -> crops; trees and hedges (WO12) don't vote
  const CROME = { AC66: 'wheat', AC32: 'wheat', AC25: 'wheat', AC01: 'barley', AC63: 'barley', AC19: 'oats', AC65: 'oats', AC17: 'maize',
    LG03: 'beans', LG20: 'beans', AC03: 'beet', AC67: 'rape', AC06: 'rape', PG01: 'pasture', TG01: 'pasture', NA01: 'ploughed' };
  // CROME hexagons (40 m sides, 57 studs centre to corner) by 60-stud bucket, for the nearest centre to a cell
  const hexAt = (() => {
    const B = 60, grid = new Map();
    for (const h of data.crome?.hex ?? []) { const k = Math.floor(h[0] / B) + ',' + Math.floor(h[1] / B); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(h); }
    return (x, z) => {
      let best = null, bd = B * B;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (const h of grid.get((Math.floor(x / B) + di) + ',' + (Math.floor(z / B) + dj)) ?? []) {
        const d = (h[0] - x) ** 2 + (h[1] - z) ** 2; if (d < bd) { bd = d; best = h; }
      }
      return best;
    };
  })();
  // label connected open land between barriers; very large pieces are split with the jittered seeds
  const comp = new Int32Array(G.n * G.n).fill(-1);
  const sizes = [];
  const open = (i) => i >= 0 && comp[i] === -1 && !(G.occ[i] & (16 | 4 | 1 | 2 | 8)) && !hedgeMask[i];
  for (let z = -half; z < half; z++) for (let x = -half; x < half; x++) {
    const i0 = G.i(x, z); if (!open(i0)) continue;
    const id = sizes.length, q = [i0]; comp[i0] = id;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], xx = i % G.n, zz = (i / G.n) | 0;
      if (xx > 0 && open(i - 1)) { comp[i - 1] = id; q.push(i - 1); }
      if (xx < G.n - 1 && open(i + 1)) { comp[i + 1] = id; q.push(i + 1); }
      if (zz > 0 && open(i - G.n)) { comp[i - G.n] = id; q.push(i - G.n); }
      if (zz < G.n - 1 && open(i + G.n)) { comp[i + G.n] = id; q.push(i + G.n); }
    }
    sizes.push(q.length);
  }
  // each field's crop: what most of its CROME hexagons show (weighted by the classifier's confidence), else invented
  const votes = new Map();
  for (let z = -half; z < half; z++) for (let x = -half; x < half; x++) {
    const gi = G.i(x, z), c0 = comp[gi];
    if (c0 < 0) continue;
    if (sizes[c0] < 300) { G.set(x, z, PAL.green, 0, 1); continue; }   // verges and odd corners stay grass
    let id = c0;
    if (sizes[c0] > 30000) {
      const i = Math.floor(x / SP), j = Math.floor(z / SP);
      let best = 1e18, sid = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const sd = seed(i + di, j + dj), d = (sd[0] - x) ** 2 + (sd[1] - z) ** 2;
        if (d < best) { best = d; sid = (i + di + 100) * 1000 + (j + dj + 100); }
      }
      id = c0 * 1000003 + sid;
    }
    fieldId[gi] = id;
    const h = hexAt(x + 0.5, z + 0.5), kind = h && CROME[h[2]];
    if (kind) { if (!votes.has(id)) votes.set(id, new Map()); const v = votes.get(id); v.set(kind, (v.get(kind) ?? 0) + 0.05 + h[3]); }
  }
  const cropOf = new Map();
  for (const [id, v] of votes) cropOf.set(id, CROPS[[...v].sort((a, b) => b[1] - a[1])[0][0]]);
  for (let z = -half; z < half; z++) for (let x = -half; x < half; x++) {
    const gi = G.i(x, z), id = fieldId[gi];
    if (id < 0) continue;
    if (!cropOf.has(id)) cropOf.set(id, crops[Math.floor(FR() * crops.length)]);
    const C = cropOf.get(id);
    if (C.plough) G.set(x, z, z & 1 ? PAL.reddishBrown : PAL.brown, z & 1 ? PLATE : 0, z & 1);
    else G.set(x, z, ((x * 7 + z * 13) % 11 === 0 && Math.abs(x) + Math.abs(z) < 260) ? C.alt : C.c, C.top, 1);
    if (C.pasture && FR() < 0.00035) cow(W, x, z, FR() < 0.5 ? 1 : 0);
  }
  // without LIDAR, put invented hedges between the invented fields
  if (!lidar) for (let z = -half + 1; z < half - 1; z++) for (let x = -half + 1; x < half - 1; x++) {
    const a = fieldId[G.i(x, z)]; if (a < 0) continue;
    const r = fieldId[G.i(x + 1, z)], d = fieldId[G.i(x, z + 1)];
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => fieldId[G.i(x + dx, z + dz)] < 0 && !G.has(x + dx, z + dz, 2 | 8));
    if ((r >= 0 && r !== a) || (d >= 0 && d !== a) || edge) {
      if (((x * 31 + z * 17) % 97) < 6) continue;
      W.set(x, 0, z, PAL.darkGreen, F_PLAIN); if ((x ^ z) % 5) W.set(x, 1, z, R() < 0.1 ? PAL.green : PAL.darkGreen, F_PLAIN);
      if (R() < 0.004) tree(W, x, z, { r: 3.5 + R() * 2, trunk: 6 });
    }
  }

  // ------------------------------------------------------------ area surfaces & contents
  for (const a of data.areas) {
    const smooth = (c) => polyCells(a.pts, (x, z) => G.set(x, z, c, 0, 0));
    if (a.kind === 'farmyard' || a.kind === 'works') smooth(PAL.lbg);
    else if (a.kind === 'parking') smooth(PAL.dbg);
    else if (a.kind === 'playground') smooth(PAL.dbg);
    else if (a.kind === 'cemetery') {
      polyCells(a.pts, (x, z) => G.set(x, z, PAL.green, 0, 1));
      labels.push({ name: a.name || 'Churchyard', x: centroid(a.pts)[0], z: centroid(a.pts)[1], r: 10 });
    } else if (a.kind === 'wood') {
      polyCells(a.pts, (x, z) => { G.set(x, z, PAL.darkGreen, 0, 1); if (!lidar && ((x * 13 + z * 7) & 63) === 0 && R() < 0.8) tree(W, x, z, { r: 3 + R() * 2.5, trunk: 5 + Math.floor(R() * 4), greens: [PAL.darkGreen, PAL.green, PAL.olive] }); });
      if (a.name) labels.push({ name: a.name, x: centroid(a.pts)[0], z: centroid(a.pts)[1], r: 20 });
    }
  }

  // ------------------------------------------------------------ surveyed yards and drives
  for (const g of survey ? surveyGrounds(survey, data.bng) : []) {
    const c = { gravel: PAL.darkTan, tarmac: PAL.dbg, paving: PAL.lbg, grass: PAL.green }[g.surface] ?? PAL.darkTan;
    polyCells(g.poly, (x, z) => { if (!G.has(x, z, 1)) G.set(x, z, c, 0, g.surface === 'gravel' || g.surface === 'grass' ? 1 : 0); });
  }

  // ------------------------------------------------------------ water
  for (const l of data.lines) if (l.kind === 'ditch' || l.kind === 'stream') {
    lineCells(l.pts, l.kind === 'stream' ? 1.6 : 1.0, (x, z) => { if (!G.has(x, z, 1)) { G.set(x, z, 0x2f5f85, 0, 0); G.flag(x, z, 8); } });
  }

  // ------------------------------------------------------------ roads: ground cells (for studs, collision, minimap)
  const roadB = new Builder();
  for (const r of roads) {
    const S = r.spec;
    if (S.cells) { lineCells(r.pts, S.hw, (x, z) => { if (!G.has(x, z, 1)) G.set(x, z, S.col, 0, 1); }); continue; }
    lineCells(r.pts, S.hw + (paved(r) ? PAVE : 0), (x, z, d) => {
      const i = G.i(x, z); if (i < 0 || (G.occ[i] & 1)) return;
      const pv = onPave(r, x, z, d); if (d > S.hw && !pv) return;
      G.set(x, z, pv ? PAL.lbg : S.col, 0, 0); G.top[i] = terrainY(x + 0.5, z + 0.5) + (pv ? PAVE_TOP : ROAD_TOP); G.flag(x, z, 2);
    });
  }
  for (const c of kerbCorners) {
    const cell = (top, colr) => (x, z) => { const i = G.i(x, z); if (i < 0 || (G.occ[i] & 1)) return; G.set(x, z, colr, 0, 0); G.top[i] = terrainY(x + 0.5, z + 0.5) + top; };
    if (c.pave) polyCells(c.pave, cell(PAVE_TOP, PAL.lbg));
    polyCells(c.fill, cell(ROAD_TOP, c.col));
  }
  // ribbons: pavements first (lower), then carriageways, then markings
  for (const r of roads) if (paved(r)) {
    if (r.sides) { ribbonY(roadB, r.pts, r.spec.hw + PAVE, terrainY, PAVE_TOP, col(PAL.lbg), 1.2, r.spec.hw - 0.3, r.sides); continue; }
    // pavement sides unknown: both sides, only for the parts of the road inside the village
    let run = [];
    const flush = () => { if (run.length > 1) ribbonY(roadB, run, r.spec.hw + PAVE, terrainY, PAVE_TOP, col(PAL.lbg), 1.2, r.spec.hw - 0.3); run = []; };
    for (const p of r.pts) { if (Math.hypot(p[0], p[1] + 40) < VILLAGE_R + 40) run.push(p); else { if (run.length) run.push(p); flush(); } }
    flush();
  }
  for (const r of roads) if (!r.spec.cells) ribbonY(roadB, r.pts, r.spec.hw, terrainY, ROAD_TOP + (r.spec.pave ? 0 : -0.01), col(r.spec.col));
  // kerb corners: the pavement band round the arc, then the carriageway fanned from the kerbs' meeting point, each
  // with a kerb face down its curved back edge
  const kY = (p, top) => terrainY(p[0], p[1]) + top;
  const fan = (poly, top, c) => { for (let i = 1; i + 1 < poly.length; i++) roadB.poly([poly[0], poly[i], poly[i + 1]].map(p => [p[0], kY(p, top), p[1]]), c, [poly[0][0], kY(poly[0], top) - 5, poly[0][1]]); };
  // a vertical face 0.6 deep along `edge`, facing away from the point `from`
  const kerb = (edge, top, c, from) => { for (let i = 0; i + 1 < edge.length; i++) { const p = edge[i], q = edge[i + 1]; roadB.poly([[p[0], kY(p, top), p[1]], [q[0], kY(q, top), q[1]], [q[0], kY(q, top) - 0.6, q[1]], [p[0], kY(p, top) - 0.6, p[1]]], c, [from[0], kY(p, top) - 0.3, from[1]]); } };
  for (const c of kerbCorners) {
    if (c.pave) {
      for (let i = 0; i + 1 < c.arc.length; i++) fan([c.arc[i], c.arc[i + 1], c.inner[i + 1], c.inner[i]], PAVE_TOP, col(PAL.lbg));
      kerb(c.inner, PAVE_TOP, col(PAL.lbg), c.fill[0]);
    }
    fan(c.fill, ROAD_TOP, col(c.col));
    kerb(c.arc, ROAD_TOP, col(c.col), c.fill[0]);
  }
  for (const r of roads) if (r.spec.dash) dashesY(roadB, r.pts, 4, 5, 0.22, terrainY, ROAD_TOP + 0.02, col(PAL.white));
  // (unknown) pavement cells outside the village are verge again
  for (const r of roads) if (r.sides === null && r.spec.pave) lineCells(r.pts, r.spec.hw + PAVE, (x, z, d) => {
    if (d > r.spec.hw && Math.hypot(x, z + 40) >= VILLAGE_R + 40 && !G.has(x, z, 1)) { G.set(x, z, PAL.green, 0, 1); }
  });
  // road names
  const named = new Map();
  for (const r of roads) if (r.name) { if (!named.has(r.name)) named.set(r.name, []); named.get(r.name).push(r.pts); }
  for (const [name, list] of named) {
    const chain = chainPolylines(list).sort((a, b) => polylineLength(b) - polylineLength(a))[0];
    // label at the part of the road nearest the village centre
    let best = null;
    for (let s = 0, L = polylineLength(chain); s < L; s += 10) { const p = pointAlong(chain, s); const d = Math.hypot(p.x, p.z); if (inBounds(p.x, p.z, 20) && (!best || d < best.d)) best = { ...p, d }; }
    if (best) labels.push({ name, x: best.x, z: best.z, r: 6, road: true });
  }

  // ------------------------------------------------------------ hedges, fences, roadside hedges in the countryside
  for (const l of data.lines) {
    if (l.kind === 'hedge') lineCells(l.pts, 0.75, (x, z) => { if (!G.has(x, z, 1 | 64 | 8) && inBounds(x, z, 1)) { W.set(x, 0, z, PAL.darkGreen, F_PLAIN); W.set(x, 1, z, R() < 0.1 ? PAL.green : PAL.darkGreen, F_PLAIN); if (!lidar && R() < 0.02) tree(W, x, z, { r: 3.5 + R() * 2 }); } });
    if (l.kind === 'fence') lineCells(l.pts, 0.6, (x, z) => { if (!G.has(x, z, 1 | 2)) { W.set(x, 0, z, PAL.reddishBrown); W.set(x, 1, z, PAL.reddishBrown, F_TILE); } });
  }
  // garden and boundary walls seen in Street View and aerial photographs (survey.json "walls"): brick, stone or
  // (a colour name such as brown) timber fencing to their height, a coping tile on top, and piers a brick taller
  // every `piers` metres
  // A wall along a mapped road (`osm` way id, `side` left/right of its direction, `from`/`to` points) follows the
  // road between those points at the back of its pavement (or verge edge), or `offset` metres from its centre line.
  const alongRoad = (w) => {
    const r = roads.find(r => r.id === w.osm); if (!r) return [];
    const segL = (i) => Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]);
    const arc = ([x, z]) => { const n = distToPolyline(x, z, r.pts); let s = n.t * segL(n.seg); for (let i = 0; i < n.seg; i++) s += segL(i); return s; };
    let s0 = arc(project(w.from)), s1 = arc(project(w.to)); if (s0 > s1) [s0, s1] = [s1, s0];
    const off = (w.offset !== undefined ? w.offset / mps : r.spec.hw + ((r.sides === null ? r.spec.pave : r.sides.includes(w.side)) ? PAVE : 1) + 0.6) * (w.side === 'left' ? -1 : 1);
    const out = [];
    for (let t = s0; ; t = Math.min(s1, t + 1)) { const p = pointAlong(r.pts, t); out.push([p.x - p.dz * off, p.z + p.dx * off]); if (t >= s1) break; }
    return out;
  };
  for (const w of data.survey?.walls ?? []) {
    const pts = w.osm ? alongRoad(w) : w.pts.map(project), n = Math.max(1, Math.round(w.h * KWALL));
    if (pts.length < 2) continue;
    const c = MATERIALS[w.wall] ?? PAL[w.wall] ?? MATERIALS.redBrick, cap = MATERIALS[w.cap] ?? PAL[w.cap] ?? PAL.lbg;
    const piers = new Set();
    if (w.piers) for (let s = 0, L = polylineLength(pts); s <= L; s += w.piers / mps) { const p = pointAlong(pts, Math.min(s, L - 0.01)); piers.add(Math.floor(p.x) + ',' + Math.floor(p.z)); }
    lineCells(pts, 0.5, (x, z) => {
      if (G.has(x, z, 1 | 2 | 64) || !inBounds(x, z, 1)) return;
      const pier = piers.has(x + ',' + z);
      for (let y = 0; y < n + (pier ? 1 : 0); y++) W.set(x, y, z, c);
      W.set(x, n + (pier ? 1 : 0), z, cap, F_TILE);
    });
  }
  if (!lidar) for (const r of carRoads) lineCells(r.pts, r.spec.hw + 2.2, (x, z, d) => {
    if (d > r.spec.hw + 1.2 && !G.has(x, z, 16 | 64 | 1 | 8) && inBounds(x, z, 1) && ((x * 7 + z * 3) % 41) > 2) { W.set(x, 0, z, PAL.darkGreen, F_PLAIN); W.set(x, 1, z, PAL.darkGreen, F_PLAIN); }
  });

  // ------------------------------------------------------------ churchyard: wall, headstones, yews, memorial
  for (const a of area('cemetery')) {
    const ring = [...a.pts, a.pts[0]];
    lineCells(ring, 0.6, (x, z) => {
      if (G.has(x, z, 1 | 2) || nearestRoad(x + 0.5, z + 0.5, roads.filter(r => r.type === 'footway' || r.type === 'path' || r.type === 'service')).d < 3) return;
      W.set(x, 0, z, R() < 0.75 ? PAL.lbg : PAL.tan); W.set(x, 1, z, PAL.lbg, F_TILE);
    });
    const [mx, mz] = project(LISTED.warMemorial);
    warMemorial(W, Math.floor(mx), Math.floor(mz));
    let n = 0;
    polyCells(a.pts, (x, z) => {
      if (G.has(x, z, 1 | 2) || W.has(x, 0, z)) return;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (G.has(x + dx, z + dz, 1 | 2)) return;
      if ((x % 4 === 0) && (z % 5 === 0) && R() < 0.4) { headstone(W, x, z); n++; }
      else if (R() < 0.002) conifer(W, x, z, { h: 10 + Math.floor(R() * 3), base: 3 });
    });
  }

  // ------------------------------------------------------------ garden trees behind houses
  if (!lidar) for (const P of buildings) {
    if (R() < 0.45) continue;
    const [lx, lz] = [R() * 12, 22 + R() * 6];
    const [x, z] = P.toWorld(lx, lz).map(Math.floor);
    let ok = inBounds(x, z, 6);
    for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3; dx++) if (G.has(x + dx, z + dz, 1 | 2 | 8)) { ok = false; break; }
    if (ok) tree(W, x, z, { r: 3 + R() * 2.5 });
  }

  // ------------------------------------------------------------ power poles + wires
  const wires = [];
  for (const l of data.lines) if (l.kind === 'poles') {
    const pts = l.pts.filter(([x, z]) => inBounds(x, z, 2));
    const H = 15;
    for (const [x, z] of pts) {
      const cx = Math.floor(x), cz = Math.floor(z);
      if (G.has(cx, cz, 1 | 2)) continue;
      W.set(cx, 0, cz, PAL.reddishBrown, F_HIDDEN);
      W.extras.push(({ at }) => {
        at(cx, cz).geom(new THREE.CylinderGeometry(0.3, 0.38, H, 10), new THREE.Matrix4().makeTranslation(cx + 0.5, H / 2, cz + 0.5), col(PAL.reddishBrown));
        at(cx, cz).box(cx - 1, H - 1, cz + 0.3, cx + 2, H - 0.7, cz + 0.7, col(PAL.reddishBrown), { chamfer: 0.04, gap: 0 });
      });
    }
    const wy = ([x, z]) => H - 0.6 + G.baseAt(Math.floor(x), Math.floor(z));
    for (let i = 0; i + 1 < pts.length; i++) wires.push([[pts[i][0] + 0.5, wy(pts[i]), pts[i][1] + 0.5], [pts[i + 1][0] + 0.5, wy(pts[i + 1]), pts[i + 1][1] + 0.5]]);
  }

  // ------------------------------------------------------------ points of interest
  for (const p of data.pois) {
    const x = Math.floor(p.x), z = Math.floor(p.z);
    const n = nearestRoad(p.x, p.z);
    // nudge off the carriageway onto the verge/pavement edge
    let px = x, pz = z;
    if (n && n.d < n.road.spec.hw + 1) { const dx = p.x - n.qx, dz = p.z - n.qz, L = Math.hypot(dx, dz) || 1; px = Math.floor(n.qx + dx / L * (n.road.spec.hw + PAVE + 1)); pz = Math.floor(n.qz + dz / L * (n.road.spec.hw + PAVE + 1)); }
    if (p.kind === 'bus_stop') { sign(W, px, pz, 'BUS', { w: 1.6, h: 1.6, postH: 7, style: 'bus' }); labels.push({ name: 'Bus stop: ' + p.name, x: px, z: pz, r: 3 }); }
    if (p.kind === 'post_box') postBox(W, px, pz);
    if (p.kind === 'bench') bench(W, px, pz);
  }

  // ------------------------------------------------------------ street lamps, village signs, speed limits
  const newark = chainPolylines(roads.filter(r => r.type === 'primary').map(r => r.pts)).sort((a, b) => polylineLength(b) - polylineLength(a))[0];
  const villageEdge = [];
  for (const r of carRoads) {
    const L = polylineLength(r.pts);
    for (let s = 12; s < L; s += 34) {
      const p = pointAlong(r.pts, s);
      if (Math.hypot(p.x, p.z + 40) > VILLAGE_R) continue;
      // on the pavement if there is one (alternating sides if both), else on the verge
      const side = r.sides?.length === 1 ? (r.sides[0] === 'right' ? 1 : -1) : (Math.floor(s / 34) & 1) ? 1 : -1;
      const off = r.spec.hw + (r.sides === null || r.sides.includes(side > 0 ? 'right' : 'left') ? PAVE - 0.6 : 1.2);
      const x = Math.floor(p.x - p.dz * side * off), z = Math.floor(p.z + p.dx * side * off);
      if (!G.has(x, z, 1) && !W.has(x, 0, z)) lamp(W, x, z);
    }
  }
  for (const chain of [newark, ...chainPolylines(roads.filter(r => r.name === 'Eakring Road' || r.name === 'Ossington Road').map(r => r.pts))]) {
    if (!chain) continue;
    const L = polylineLength(chain); let inside = null;
    for (let s = 0; s < L; s += 2) {
      const p = pointAlong(chain, s); const now = Math.hypot(p.x, p.z + 40) < VILLAGE_R + 25;
      if (inside !== null && now !== inside && inBounds(p.x, p.z, 10)) villageEdge.push({ ...p, entering: now });
      inside = now;
    }
  }
  for (const e of villageEdge) {
    const dir = e.entering ? 1 : -1, off = nearestRoad(e.x, e.z).road.spec.hw + 1.2; // left-hand verge for traffic entering the village
    const lx = e.dz * dir, lz = -e.dx * dir;
    const x = Math.floor(e.x + lx * off), z = Math.floor(e.z + lz * off);
    sign(W, x, z, 'KNEESALL', { w: 7, h: 2.6, postH: 6, style: 'village', twoPosts: true, face: Math.atan2(e.dx * dir, e.dz * dir) });
    const x2 = Math.floor(e.x + lx * off - e.dx * dir * 6), z2 = Math.floor(e.z + lz * off - e.dz * dir * 6);
    sign(W, x2, z2, '30', { w: 2.4, h: 2.4, postH: 6, style: 'speed', face: Math.atan2(e.dx * dir, e.dz * dir) });
  }
  // restaurant sign at the road edge in front of the Rajdhaani (the old Angel Inn)
  const pub = buildings.find(b => b.label === 'Rajdhaani');
  if (pub) {
    const [cx, cz] = centroid(pub.poly); const n = nearestRoad(cx, cz);
    const dx = cx - n.qx, dz = cz - n.qz, L = Math.hypot(dx, dz);
    const x = Math.floor(n.qx + dx / L * (n.road.spec.hw + PAVE + 2)), z = Math.floor(n.qz + dz / L * (n.road.spec.hw + PAVE + 2));
    sign(W, x, z, 'RAJDHAANI', { w: 6, h: 2.2, postH: 9, style: 'pub', twoPosts: true, face: Math.atan2(-dx, -dz) });
  }
  const school = buildings.find(b => b.label && b.label.startsWith('Kneesall CofE'));
  if (school) {
    const [cx, cz] = centroid(school.poly); const n = nearestRoad(cx, cz);
    const dx = cx - n.qx, dz = cz - n.qz, L = Math.hypot(dx, dz);
    sign(W, Math.floor(n.qx + dx / L * (n.road.spec.hw + 4)), Math.floor(n.qz + dz / L * (n.road.spec.hw + 4)), 'KNEESALL CofE PRIMARY ACADEMY', { w: 7, h: 1.8, postH: 4, style: 'school', twoPosts: true, face: Math.atan2(-dx, -dz) });
  }
  // a tractor in Buckshaw Farm's yard, if it's on the map
  for (const a of area('farmyard')) {
    const [cx, cz] = centroid(a.pts);
    if (inBounds(cx, cz, 20)) tractor(W, Math.floor(cx), Math.floor(cz));
    if (a.name) labels.push({ name: a.name, x: cx, z: cz, r: 15 });
  }

  // ------------------------------------------------------------ building footprints: no studs underneath
  for (const P of buildings) polyCells(P.poly, (x, z) => { const i = G.i(x, z); if (i >= 0) { G.stud[i] = 0; G.top[i] = G.base[i] = P.y; } });

  // ------------------------------------------------------------ paths for traffic and pedestrians
  const carPath = newark ? clipPath(newark, (x, z) => inBounds(x, z, 2)) : null;
  const walkRoads = carRoads.filter(paved).map(r => ({ pts: r.pts, off: r.spec.hw + PAVE * 0.55, sides: r.sides === null ? [-1, 1] : r.sides.map(s => (s === 'right' ? 1 : -1)) }))
    .filter(r => r.pts.some(([x, z]) => Math.hypot(x, z + 40) < 200));

  const namedRoads = roads.filter(r => r.name);
  const roadY = (x, z) => terrainY(x, z) + ROAD_TOP;
  let minY = Infinity; for (let i = 0; i < G.base.length; i++) minY = Math.min(minY, G.base[i]);
  G.minY = minY;
  return { G, W, buildings, roadB, labels, wires, carPath, walkRoads, attribution: data.attribution, newark, namedRoads, terrainY, roadY };
}

function clipPath(pts, ok) {
  let best = [], cur = [];
  for (const p of pts) { if (ok(p[0], p[1])) cur.push(p); else { if (cur.length > best.length) best = cur; cur = []; } }
  if (cur.length > best.length) best = cur;
  return best;
}

// Merge ground cells into row runs. Tops go in the studded/smooth builders; terrace sides (where the
// neighbouring ground is lower) go in the smooth builder so the stud texture doesn't streak down them.
export function groundMeshes(G) {
  const CH = 64;
  const studded = new Map(), smooth = new Map();
  const get = (m, x, z) => { const k = Math.floor(x / CH) + ',' + Math.floor(z / CH); let b = m.get(k); if (!b) { b = new Builder(); m.set(k, b); } return b; };
  const n = G.n, h = G.half, floor = G.minY - 1.5;
  // road cells are drawn by the smooth ribbons, so their ground stays at terrain height underneath
  const T = (j) => (G.occ[j] & 2) ? G.base[j] : G.top[j];
  const TT = (xi, zi) => (xi < 0 || zi < 0 || xi >= n || zi >= n) ? floor : T(zi * n + xi);
  for (let zi = 0; zi < n; zi++) {
    let xi = 0;
    while (xi < n) {
      const i = zi * n + xi, c = G.col[i], t = T(i), s = G.stud[i];
      let e = xi + 1;
      while (e < n && (e - xi) < CH && G.col[zi * n + e] === c && T(zi * n + e) === t && G.stud[zi * n + e] === s) e++;
      const x0 = xi - h, x1 = e - h, z0 = zi - h, z1 = z0 + 1, cc = col(c);
      get(s ? studded : smooth, x0, z0).poly([[x0, t, z0], [x1, t, z0], [x1, t, z1], [x0, t, z1]], cc, [x0, t - 1, z0]);
      // sides: west/east ends of the run, and north/south faces per cell where lower
      const side = get(smooth, x0, z0), dark = { r: cc.r * 0.85, g: cc.g * 0.85, b: cc.b * 0.85 };
      const wall = (ax, az, bx, bz, lo, ctr) => side.poly([[ax, lo, az], [bx, lo, bz], [bx, t, bz], [ax, t, az]], dark, ctr);
      const lw = TT(xi - 1, zi); if (lw < t) wall(x0, z0, x0, z1, lw, [x0 + 1, t, z0 + 0.5]);
      const le = TT(e, zi); if (le < t) wall(x1, z0, x1, z1, le, [x1 - 1, t, z0 + 0.5]);
      for (let k = xi; k < e; k++) {
        const xa = k - h;
        const ln = TT(k, zi - 1); if (ln < t) wall(xa, z0, xa + 1, z0, ln, [xa + 0.5, t, z0 + 1]);
        const ls = TT(k, zi + 1); if (ls < t) wall(xa, z1, xa + 1, z1, ls, [xa + 0.5, t, z1 - 1]);
      }
      xi = e;
    }
  }
  return { studded, smooth };
}
