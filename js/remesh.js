// Rebuild as one solid: any mesh, however broken (open sheets, holes, overlapping and inside-out shells, stray
// bits), made into one clean watertight solid of its outside. No AI. Runs in the worker.
// The mesh is sampled on a grid of the chosen detail: each point's distance to the nearest triangle (near the
// surface), then the outside air flooded in from the edges of the grid, stopped by the surface: a point the air
// reaches is outside, any other is inside (cracks and holes narrower than the detail seal up). A surface is drawn
// through where inside meets outside with Manifold's level set, so it's watertight by construction; flat stretches
// are then thinned out (simplified within a fifth of the detail) and any pinch split apart.
import { unpinch } from './solid.js';

/** Squared distance from point p to triangle abc (all [x,y,z]). */
function dist2Tri(px, py, pz, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  const sq = (x, y, z) => x * x + y * y + z * z;
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz);
  const bpx = px - b[0], bpy = py - b[1], bpz = pz - b[2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return sq(apx - v * abx, apy - v * aby, apz - v * abz); }
  const cpx = px - c[0], cpy = py - c[1], cpz = pz - c[2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return sq(apx - w * acx, apy - w * acy, apz - w * acz); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return sq(bpx - w * (c[0] - b[0]), bpy - w * (c[1] - b[1]), bpz - w * (c[2] - b[2])); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return sq(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w);
}

/** p: { soup (Float32Array triangles), detail (mm) } → { positions, stats } */
export function buildRemesh(M, p) {
  const S = p.soup, nt = S.length / 9; if (!nt) throw new Error('nothing to rebuild');
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < S.length; i += 3) for (let k = 0; k < 3; k++) { const v = S[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  // the detail: as asked, but no finer than about 40 million grid points
  let h = Math.max(0.02, p.detail || 0.15);
  const pts = hh => ((hi[0] - lo[0]) / hh + 7) * ((hi[1] - lo[1]) / hh + 7) * ((hi[2] - lo[2]) / hh + 7);
  while (pts(h) > 4e7) h *= 1.1;
  const pad = 3 * h, o = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
  const nx = Math.ceil((hi[0] - lo[0] + 2 * pad) / h) + 1, ny = Math.ceil((hi[1] - lo[1] + 2 * pad) / h) + 1, nz = Math.ceil((hi[2] - lo[2] + 2 * pad) / h) + 1, N = nx * ny * nz;
  const band = 1.5 * h, D = new Float32Array(N).fill(band * band);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  // distance to the nearest triangle, for the points near the surface
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const q = 9 * t; a[0] = S[q]; a[1] = S[q + 1]; a[2] = S[q + 2]; b[0] = S[q + 3]; b[1] = S[q + 4]; b[2] = S[q + 5]; c[0] = S[q + 6]; c[1] = S[q + 7]; c[2] = S[q + 8];
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - band - o[0]) / h)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) + band - o[0]) / h));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - band - o[1]) / h)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) + band - o[1]) / h));
    const k0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - band - o[2]) / h)), k1 = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2], c[2]) + band - o[2]) / h));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const g = idx(i, j, k), d2 = dist2Tri(o[0] + i * h, o[1] + j * h, o[2] + k * h, a, b, c); if (d2 < D[g]) D[g] = d2;
    }
  }
  // the outside air, flooded in from the edges; the surface (points nearer it than ~0.6 of the detail) stops it
  const wall = (0.62 * h) ** 2, out = new Uint8Array(N), stack = new Int32Array(N); let sp = 0;
  const seed = g => { if (!out[g] && D[g] > wall) { out[g] = 1; stack[sp++] = g; } };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (!i || !j || !k || i === nx - 1 || j === ny - 1 || k === nz - 1) seed(idx(i, j, k));
  while (sp) {
    const g = stack[--sp], i = g % nx, j = ((g / nx) | 0) % ny, k = (g / (nx * ny)) | 0;
    if (i > 0) seed(g - 1); if (i < nx - 1) seed(g + 1); if (j > 0) seed(g - nx); if (j < ny - 1) seed(g + nx); if (k > 0) seed(g - nx * ny); if (k < nz - 1) seed(g + nx * ny);
  }
  // the field: positive inside (as the level set wants), its size the distance to the surface; inside points
  // that are walls themselves sit just inside, so the surface comes out close to where it was
  const F = new Float32Array(N); let inside = 0;
  for (let g = 0; g < N; g++) { const d = Math.sqrt(D[g]); if (out[g]) F[g] = -d; else { F[g] = d < 0.62 * h ? 0.62 * h - d * 0.38 : d; inside++; } }
  if (!inside) throw new Error('it has no inside to rebuild: it may be all thin sheets; try a finer detail');
  const field = q => {
    let x = (q[0] - o[0]) / h, y = (q[1] - o[1]) / h, z = (q[2] - o[2]) / h;
    x = Math.min(nx - 1.0001, Math.max(0, x)); y = Math.min(ny - 1.0001, Math.max(0, y)); z = Math.min(nz - 1.0001, Math.max(0, z));
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k, g = idx(i, j, k), sx = 1, sy = nx, sz = nx * ny;
    const L = (u, v, t) => u + (v - u) * t;
    return L(L(L(F[g], F[g + sx], fx), L(F[g + sy], F[g + sy + sx], fx), fy), L(L(F[g + sz], F[g + sz + sx], fx), L(F[g + sz + sy], F[g + sz + sy + sx], fx), fy), fz);
  };
  const m0 = M.Manifold.levelSet(field, { min: [o[0] + h, o[1] + h, o[2] + h], max: [o[0] + (nx - 2) * h, o[1] + (ny - 2) * h, o[2] + (nz - 2) * h] }, h, 0);
  // crumbs go (specks smaller than a few grid cells)
  const bits = m0.decompose(); let big = 0; for (const x of bits) big = Math.max(big, x.volume());
  const keep = bits.filter(x => x.volume() > Math.max(big * 1e-4, 8 * h * h * h)); bits.forEach(x => { if (!keep.includes(x)) x.delete(); });
  const res0 = keep.length === bits.length ? m0 : M.Manifold.compose(keep);
  if (res0 !== m0) m0.delete();
  const res = res0.simplify(h * 0.2); res0.delete();
  try {
    const g = res.getMesh(), np = g.numProp, V0 = g.vertProperties, T = Array.from(g.triVerts);
    const V1 = np === 3 ? V0 : (() => { const v = new Float32Array(V0.length / np * 3); for (let i = 0; i < V0.length / np; i++) { v[3 * i] = V0[i * np]; v[3 * i + 1] = V0[i * np + 1]; v[3 * i + 2] = V0[i * np + 2]; } return v; })();
    // corners at exactly the same spot made one first (that's how a pinch comes out of Manifold: two corners in one
    // place), so the pinch can be seen and split properly
    { const map = new Map(); const rep = new Int32Array(V1.length / 3);
      for (let i = 0; i < rep.length; i++) { const k = V1[3 * i] + ',' + V1[3 * i + 1] + ',' + V1[3 * i + 2], j = map.get(k); if (j === undefined) { map.set(k, i); rep[i] = i; } else rep[i] = j; }
      for (let i = 0; i < T.length; i++) T[i] = rep[T[i]]; }
    // a triangle and its twin facing the other way are a fold of no thickness: both go
    { const seen = new Map(), drop = new Set();
      for (let t = 0; t < T.length / 3; t++) { const v = [T[3 * t], T[3 * t + 1], T[3 * t + 2]].sort((x, y) => x - y), k = v.join(','), e = seen.get(k); if (e !== undefined) { drop.add(e); drop.add(t); } else seen.set(k, t); }
      if (drop.size) { let o = 0; for (let t = 0; t < T.length / 3; t++) if (!drop.has(t)) { T[o++] = T[3 * t]; T[o++] = T[3 * t + 1]; T[o++] = T[3 * t + 2]; } T.length = o; } }
    const { V } = unpinch(V1, T), pos = new Float32Array(T.length * 3);
    for (let i = 0; i < T.length; i++) { const q = 3 * T[i]; pos[3 * i] = V[q]; pos[3 * i + 1] = V[q + 1]; pos[3 * i + 2] = V[q + 2]; }
    return { positions: pos, stats: { detail: +h.toFixed(3), pieces: keep.length, dropped: bits.length - keep.length, before: nt, after: T.length / 3, volume: res.volume() } };
  } finally { res.delete(); keep.forEach(x => { if (x !== res) try { x.delete(); } catch (e) {} }); }
}
