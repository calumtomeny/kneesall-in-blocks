// Roof heights from the LIDAR surface model, one value per stud of a building's footprint.
// The measured height (metres above ground) becomes a brick count; where neighbouring studs differ by a
// little it is a roof slope (at most one brick per stud, the steepest LEGO slope), and where they differ a
// lot it is a wall — so extensions, lean-tos, gable ends and hips all come out of the data.

const N4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const FH = 6;              // bricks per storey
const EAVES2 = 5.2;        // metres: typical two-storey eaves height, which becomes 2 * FH bricks
export const KWALL = 2 * FH / EAVES2;   // brick layers per metre of wall
const STEP = 1.3;          // metres: a jump bigger than this between neighbouring studs is a wall, not roof
const KROOF = 1.7;         // bricks per metre above the eaves: a typical 40° pitch becomes one brick per stud

// metres above ground -> brick layers: walls are stretched so a two-storey eaves gets two minifig storeys,
// above that the roof keeps its pitch
export const layersFor = (v) => Math.max(FH, Math.round(v <= EAVES2 ? v * KWALL : 2 * FH + (v - EAVES2) * KROOF));

const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

// cells: Set of "x,z" local cells; hAt(x, z): measured height (m) at a local cell, 0 if unknown.
// Returns null if the LIDAR has nothing usable, else { cells, top: Map "x,z" -> roof layer }.
export function roofPlan(cells, hAt) {
  const raw = new Map();
  for (const k of cells) { const [x, z] = k.split(',').map(Number); raw.set(k, hAt(x, z)); }
  const vals = [...raw.values()];
  if (median(vals) < 1.5) return null;

  // studs the scan sees as open ground (yards, gaps in a merged outline) are dropped, then specks removed
  let keep = new Set([...cells].filter(k => raw.get(k) >= 1.2));
  if (keep.size < Math.max(10, cells.size * 0.5)) keep = new Set(cells);
  keep = dropSpecks(keep, 8);
  if (keep.size < 10) return null;

  // 3x3 median within the footprint: removes noise and overhanging branches but keeps steps sharp
  const cap = pct([...keep].map(k => raw.get(k)), 0.97);
  const h = new Map();
  for (const k of keep) {
    const [x, z] = k.split(',').map(Number), n = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const kk = (x + dx) + ',' + (z + dz); if (keep.has(kk)) n.push(Math.max(1.2, raw.get(kk))); }
    h.set(k, Math.min(cap, median(n)));
  }
  // then along whichever axis the roof is level (ridges and eaves run with the building's sides), which
  // straightens ridge lines without blunting the slopes across them
  const at = (x, z) => h.get(x + ',' + z);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map();
    for (const [k, v] of h) {
      const [x, z] = k.split(',').map(Number);
      const g = (dx, dz) => { const a = at(x + dx, z + dz) ?? v, b = at(x - dx, z - dz) ?? v; return Math.abs(a - b); };
      const [dx, dz] = g(1, 0) <= g(0, 1) ? [1, 0] : [0, 1];
      const line = [];
      for (let i = -2; i <= 2; i++) { const w = at(x + i * dx, z + i * dz); if (w !== undefined) line.push(w); }
      next.set(k, median(line));
    }
    for (const [k, v] of next) h.set(k, v);
  }

  // eaves: where the roof climbs inwards from the outline, the 1 m scan has already risen by the outline stud,
  // so extrapolate it back down to the wall line (gable ends, level with the stud inside them, are left alone)
  const has = (x, z) => keep.has(x + ',' + z);
  const eav = new Map();
  for (const [k, v] of h) {
    const [x, z] = k.split(',').map(Number);
    const out = N4.filter(([dx, dz]) => !has(x + dx, z + dz));
    if (out.length !== 1) continue;
    const inner = at(x - out[0][0], z - out[0][1]);
    if (inner !== undefined && inner - v > 0.25 && inner - v < STEP) eav.set(k, Math.max(1.2, 2 * v - inner));
  }
  for (const [k, v] of eav) h.set(k, v);

  const top = new Map();
  for (const [k, v] of h) top.set(k, layersFor(v));

  // single studs poking above or dipping below all their neighbours are noise
  for (const k of keep) {
    const [x, z] = k.split(',').map(Number);
    const n = N4.map(([dx, dz]) => top.get((x + dx) + ',' + (z + dz))).filter(v => v !== undefined);
    if (n.length < 2) continue;
    const t = top.get(k), lo = Math.min(...n), hi = Math.max(...n);
    if (t < lo) top.set(k, lo); else if (t > hi) top.set(k, hi);
  }

  // slopes can rise at most one brick per stud: settle each stud down onto its neighbours, except across walls
  const wall = (a, b) => Math.abs(h.get(a) - h.get(b)) > STEP;
  for (let changed = true; changed;) {
    changed = false;
    for (const k of keep) {
      const [x, z] = k.split(',').map(Number);
      for (const [dx, dz] of N4) {
        const n = (x + dx) + ',' + (z + dz);
        if (!keep.has(n) || wall(k, n)) continue;
        if (top.get(k) > top.get(n) + 1) { top.set(k, top.get(n) + 1); changed = true; }
      }
    }
  }
  return { cells: keep, top };
}

function dropSpecks(cells, min) {
  const out = new Set(), seen = new Set();
  for (const k of cells) {
    if (seen.has(k)) continue;
    const comp = [k]; seen.add(k);
    for (let i = 0; i < comp.length; i++) {
      const [x, z] = comp[i].split(',').map(Number);
      for (const [dx, dz] of N4) { const n = (x + dx) + ',' + (z + dz); if (cells.has(n) && !seen.has(n)) { seen.add(n); comp.push(n); } }
    }
    if (comp.length >= min) for (const c of comp) out.add(c);
  }
  return out;
}
