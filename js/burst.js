// Burst: a growth bursting out of a part, the way a rotting tank's hull splits open. No AI. Runs in the worker.
// Round the spot clicked, the hull is pushed out in a smooth swell; in the middle it's torn open in a jagged hole,
// the plate round the hole broken into petals bent up and out on hinges at their outer edge; out of the hole swells
// a growth: a lumpy mass with ridges ringing round it, pustules, pock holes and horns. Everything is in the hit's
// frame: the hit at the origin, z straight out of the surface. The hull's thickness there (thick) is known.
import { mergeSolid } from './solid.js';

// ---- seeded randomness and noise
export function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
function hash(ix, s) { let h = (ix * 374761393 + s * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
/** Smooth 1D noise round a circle (period n), -1..1. */
function ringNoise(t, n, s) { const x = t * n, i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(((i % n) + n) % n, s) * (1 - u) + hash((((i + 1) % n) + n) % n, s) * u) * 2 - 1; }
function hash3(ix, iy, iz, s) { let h = (ix * 374761393 + iy * 668265263 + iz * 1442695041 + s * 974634851) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
export function vnoise3(x, y, z, s) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t, h = (a, b, c) => hash3(ix + a, iy + b, iz + c, s);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w) * 2 - 1;
}
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smax = (a, b, k) => -smin(-a, -b, k);

/** A 4×4 column-major matrix turning by angle a about the axis (unit) through point o. */
function rotAbout(ax, a, o) {
  const [x, y, z] = ax, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  const R = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c];
  // column-major: columns are R[0..2], R[3..5], R[6..8]; translation o - R·o
  const ro = [R[0] * o[0] + R[3] * o[1] + R[6] * o[2], R[1] * o[0] + R[4] * o[1] + R[7] * o[2], R[2] * o[0] + R[5] * o[1] + R[8] * o[2]];
  return [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, o[0] - ro[0], o[1] - ro[1], o[2] - ro[2], 1];
}
/** A matrix taking +z to unit direction d, then moving to point p. */
export function aimZ(d, p) {
  const z = d, up = Math.abs(z[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]; const l = Math.hypot(...x); x = x.map(v => v / l);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return [x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, p[0], p[1], p[2], 1];
}
/**
 * A solid with the triangles within reach of the origin split until no edge there is longer than L (both sides of
 * an edge split together, so it stays watertight), then every corner moved by fn. Built again as a Manifold.
 */
function refineWarp(M, man, reach, L, fn, C = [0, 0, 0]) {
  const g = man.getMesh(), np = g.numProp, V0 = g.vertProperties, T0 = g.triVerts;
  let nv = V0.length / np, P = new Float64Array(Math.max(3 * nv * 1.5, 3072)), T = new Uint32Array(Math.max(T0.length * 1.5, 3072)), nt = T0.length / 3;
  for (let i = 0; i < nv; i++) { P[3 * i] = V0[i * np]; P[3 * i + 1] = V0[i * np + 1]; P[3 * i + 2] = V0[i * np + 2]; }
  T.set(T0);
  const addV = (x, y, z) => { if (3 * nv + 3 > P.length) { const q = new Float64Array(P.length * 2); q.set(P); P = q; } P[3 * nv] = x; P[3 * nv + 1] = y; P[3 * nv + 2] = z; return nv++; };
  const addT = (a, b, c) => { if (3 * nt + 3 > T.length) { const q = new Uint32Array(T.length * 2); q.set(T); T = q; } T[3 * nt] = a; T[3 * nt + 1] = b; T[3 * nt + 2] = c; return nt++; };
  const near = (a, b) => { // the edge comes within reach of the origin
    const ax = P[3 * a] - C[0], ay = P[3 * a + 1] - C[1], az = P[3 * a + 2] - C[2], dx = P[3 * b] - P[3 * a], dy = P[3 * b + 1] - P[3 * a + 1], dz = P[3 * b + 2] - P[3 * a + 2], l2 = dx * dx + dy * dy + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy + az * dz) / l2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy, az + t * dz) < reach;
  };
  const len2 = (a, b) => (P[3 * a] - P[3 * b]) ** 2 + (P[3 * a + 1] - P[3 * b + 1]) ** 2 + (P[3 * a + 2] - P[3 * b + 2]) ** 2;
  // only triangles with an edge within reach are ever looked at (both triangles on such an edge are among them)
  let active = [];
  for (let t = 0; t < nt; t++) { const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2]; if (near(a, b) || near(b, c) || near(c, a)) active.push(t); }
  const key = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  for (let round = 0; round < 24 && active.length; round++) {
    const mid = new Map();
    for (const t of active) for (let e = 0; e < 3; e++) {
      const a = T[3 * t + e], b = T[3 * t + (e + 1) % 3], k = key(a, b);
      if (mid.has(k) || len2(a, b) <= L * L || !near(a, b)) continue;
      mid.set(k, addV((P[3 * a] + P[3 * b]) / 2, (P[3 * a + 1] + P[3 * b + 1]) / 2, (P[3 * a + 2] + P[3 * b + 2]) / 2));
    }
    if (!mid.size || nv > 8e6) break;
    const next = [];
    for (const t of active) {
      const v = [T[3 * t], T[3 * t + 1], T[3 * t + 2]], m = [0, 1, 2].map(e => mid.get(key(v[e], v[(e + 1) % 3])));
      const n = (m[0] !== undefined) + (m[1] !== undefined) + (m[2] !== undefined);
      if (!n) { next.push(t); continue; }
      const put = (a, b, c, first) => { if (first) { T[3 * t] = a; T[3 * t + 1] = b; T[3 * t + 2] = c; next.push(t); } else next.push(addT(a, b, c)); };
      if (n === 3) { put(v[0], m[0], m[2], 1); put(m[0], v[1], m[1]); put(m[2], m[1], v[2]); put(m[0], m[1], m[2]); continue; }
      let r = 0; if (n === 1) r = m.findIndex(x => x !== undefined); else r = m[0] === undefined ? 1 : m[1] === undefined ? 2 : 0;
      const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3], mab = m[r], mbc = m[(r + 1) % 3];
      if (n === 1) { put(a, mab, c, 1); put(mab, b, c); }
      else { put(a, mab, c, 1); put(mab, b, mbc); put(mab, mbc, c); }
    }
    active = next;
  }
  const vert = new Float32Array(3 * nv), w = [0, 0, 0];
  for (let i = 0; i < nv; i++) { w[0] = P[3 * i]; w[1] = P[3 * i + 1]; w[2] = P[3 * i + 2]; if (Math.hypot(w[0] - C[0], w[1] - C[1], w[2] - C[2]) < reach) fn(w); vert[3 * i] = w[0]; vert[3 * i + 1] = w[1]; vert[3 * i + 2] = w[2]; }
  const res = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: vert, triVerts: T.subarray(0, 3 * nt) }));
  if (res.status && res.status() !== 'NoError') { res.delete(); throw new Error('the swell folded the surface over itself: try less swell or push'); }
  return res;
}
/** Corners at exactly the same spot made one (a hash on the float bits: light on memory for millions of corners). */
export function exactWeld(soup) {
  const f = soup instanceof Float32Array ? soup : new Float32Array(soup), bits = new Uint32Array(f.buffer, f.byteOffset, f.length), n = f.length / 3;
  let size = 1; while (size < n * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1), idx = new Uint32Array(n), vert = new Float32Array(f.length); let nv = 0;
  for (let i = 0; i < n; i++) {
    const a = bits[3 * i], b = bits[3 * i + 1], c = bits[3 * i + 2];
    let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & (size - 1);
    for (;;) {
      const v = table[h];
      if (v < 0) { table[h] = nv; vert[3 * nv] = f[3 * i]; vert[3 * nv + 1] = f[3 * i + 1]; vert[3 * nv + 2] = f[3 * i + 2]; idx[i] = nv++; break; }
      if (vert[3 * v] === f[3 * i] && vert[3 * v + 1] === f[3 * i + 1] && vert[3 * v + 2] === f[3 * i + 2]) { idx[i] = v; break; }
      h = (h + 1) & (size - 1);
    }
  }
  let k = 0; const tri = new Uint32Array(n);
  for (let t = 0; t < n; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (a !== b && b !== c && a !== c) { tri[k++] = a; tri[k++] = b; tri[k++] = c; } }
  return { vert: vert.slice(0, 3 * nv), tri: tri.slice(0, k) };
}
/**
 * The part's shells (pieces joined corner to corner), split into the ones that come near the burst (within `lateral`
 * of the axis, between `down` under and `up` over the surface) as indexed meshes, and the rest as plain triangles.
 */
function nearShells(soup, lateral, up, down) {
  const w = exactWeld(soup), nv = w.vert.length / 3, T = w.tri, nt = T.length / 3;
  const par = new Int32Array(nv); for (let i = 0; i < nv; i++) par[i] = i;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < nt; t++) { const a = find(T[3 * t]), b = find(T[3 * t + 1]); par[b] = a; const c = find(T[3 * t + 2]); par[c] = find(a); }
  // a shell is near if any triangle of it reaches into the burst's box
  const isNear = new Uint8Array(nv), V = w.vert;
  for (let t = 0; t < nt; t++) {
    const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
    if (Math.max(V[a], V[b], V[c]) < -lateral || Math.min(V[a], V[b], V[c]) > lateral || Math.max(V[a + 1], V[b + 1], V[c + 1]) < -lateral || Math.min(V[a + 1], V[b + 1], V[c + 1]) > lateral || Math.max(V[a + 2], V[b + 2], V[c + 2]) < -down || Math.min(V[a + 2], V[b + 2], V[c + 2]) > up) continue;
    isNear[find(T[3 * t])] = 1;
  }
  const groups = new Map(), farTris = [];
  for (let t = 0; t < nt; t++) { const r = find(T[3 * t]); if (isNear[r]) { let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(t); } else farTris.push(t); }
  const near = [];
  for (const list of groups.values()) {
    const remap = new Map(), vert = [], tri = new Uint32Array(list.length * 3);
    list.forEach((t, k) => { for (let e = 0; e < 3; e++) { const v = T[3 * t + e]; let i = remap.get(v); if (i === undefined) { i = vert.length / 3; remap.set(v, i); vert.push(w.vert[3 * v], w.vert[3 * v + 1], w.vert[3 * v + 2]); } tri[3 * k + e] = i; } });
    near.push({ vert: new Float32Array(vert), tri });
  }
  const far = new Float32Array(farTris.length * 9); let o = 0;
  for (const t of farTris) for (let e = 0; e < 3; e++) { const v = T[3 * t + e] * 3; far[o++] = w.vert[v]; far[o++] = w.vert[v + 1]; far[o++] = w.vert[v + 2]; }
  return { near, far };
}
export function soupOf(m) {
  const g = m.getMesh(), V = g.vertProperties, np = g.numProp, T = g.triVerts, out = new Float32Array(T.length * 3);
  for (let i = 0; i < T.length; i++) { const o = T[i] * np; out[3 * i] = V[o]; out[3 * i + 1] = V[o + 1]; out[3 * i + 2] = V[o + 2]; }
  return out;
}

/**
 * p: { soup (the part, in the hit's frame), thick (mm of part straight in from the hit),
 *   radius (mm: the hole torn in the hull), swell (mm the hull round it is pushed out), reach (how far the swell
 *   spreads, × radius), tear (bool: torn open; off: only swollen), petals (pieces round the hole), peel (° they're
 *   bent out), jag (0..1), plate (mm: how thick a plate peels up at most),
 *   grow (0..: the growth's size across, × radius; 0 for none), height (mm it stands out of the surface),
 *   lumps (0..1), ridges (0..1), pustules (count), pocks (count), horns (count), hornLen (mm), curl (0..1),
 *   detail (mm), seed }
 * → { positions, stats }
 */
export function buildBurst(M, p) {
  const { Manifold, CrossSection: CS } = M;
  const trash = [], keep = x => { trash.push(x); return x; };
  const swap = (old, nu) => { const i = trash.indexOf(old); if (i >= 0) trash.splice(i, 1); try { old.delete(); } catch (e) {} return keep(nu); };   // a big part is not kept twice
  const rnd = rng(p.seed * 7919 + 17), jag = Math.min(1, Math.max(0, p.jag));
  // From a sphere inside: a ball (radius sr, its centre depth under the surface) pushes the part out from within;
  // where it breaks the surface is the hole, and the growth is the ball coming out
  const sphere = p.from === 'sphere', sr = Math.max(0.3, p.sr || 6), depth = p.depth ?? sr * 0.5;
  const R = sphere ? Math.max(0.3, depth < sr ? Math.sqrt(sr * sr - depth * depth) : 0.3) : Math.max(0.3, p.radius);
  const breaks = !sphere || depth < sr * 0.98;
  const stats = { petals: 0, horns: 0, pustules: 0, pocks: 0 };
  try {
    // Only the shells of the part that the swell or the tear reach are worked on (a big kit is often many shells,
    // one of them the hull), each on its own; the rest go through untouched. A shell is made a solid straight from
    // its triangles if it's clean (quick, and light on memory); a big one that isn't goes through the full clean-up.
    const Rw = R * Math.max(1.05, p.reach || 2), swell = sphere ? 0 : Math.max(0, p.swell || 0), plate0 = Math.max(0.2, p.plate || 1.5);
    const push = sphere && p.warp !== false ? Math.max(0, p.push ?? sr * 0.4) : 0, Cw = [0, 0, -depth], Rp = sr * Math.max(1.05, p.preach || 2.2);
    const lateral = Math.max(swell > 1e-3 ? Rw : 0, push > 0 ? Rp : 0, R * 1.75 + 1);
    const { near, far } = push > 0 ? nearShells(p.soup, Rp, Rp - depth, Rp + depth) : nearShells(p.soup, lateral, Math.max(Rw, R * 3), swell > 1e-3 ? Rw : plate0 + 1);
    let strays = far; const parts = [];
    { const bad = [];
      for (const sh of near) {
        let m0 = null; try { m0 = new Manifold(new M.Mesh({ numProp: 3, vertProperties: sh.vert, triVerts: sh.tri })); } catch (e) { m0 = null; }
        if (m0 && (!m0.status || m0.status() === 'NoError') && !m0.isEmpty()) parts.push(keep(m0)); else { if (m0) m0.delete(); bad.push(sh); }
      }
      const big = bad.filter(sh => sh.tri.length / 3 > 2000);
      if (big.length) {
        let n = 0; for (const sh of big) n += sh.tri.length * 3;
        const soup = new Float32Array(n); let o = 0; for (const sh of big) for (let i = 0; i < sh.tri.length; i++) { const v = sh.tri[i] * 3; soup[o++] = sh.vert[v]; soup[o++] = sh.vert[v + 1]; soup[o++] = sh.vert[v + 2]; }
        const clean = mergeSolid(M, [soup], { fillHollows: false, loose: 'keep', manifold: true });
        if (clean.solid) parts.push(keep(clean.solid));
        if (clean.strays.length) bad.push({ soup: clean.strays });
      }
      const pass = bad.filter(sh => sh.soup || sh.tri.length / 3 <= 2000);
      if (pass.length) {
        const fs = pass.map(sh => { if (sh.soup) return sh.soup; const f = new Float32Array(sh.tri.length * 3); for (let i = 0; i < sh.tri.length; i++) { const v = sh.tri[i] * 3; f[3 * i] = sh.vert[v]; f[3 * i + 1] = sh.vert[v + 1]; f[3 * i + 2] = sh.vert[v + 2]; } return f; });
        let n = strays.length; for (const f of fs) n += f.length; const a = new Float32Array(n); a.set(strays); let o = strays.length; for (const f of fs) { a.set(f, o); o += f.length; } strays = a;
      }
    }
    if (!parts.length) throw new Error('there\'s no closed solid there to burst: click on the part itself');
    let size = 0; for (const x of parts) { const b = x.boundingBox(); size = Math.max(size, b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]); }
    const detail = Math.max(0.05, Math.min(p.detail || 0.25, size / 40));
    const plate = plate0;                                                  // the plates peel up this thick, the hole is cut this deep
    const reaches = (x, r) => { const b = x.boundingBox(); let d2 = 0; for (let k = 0; k < 3; k++) { const v = Math.max(b.min[k], Math.min(0, b.max[k])); d2 += v * v; } return d2 < r * r; };
    // ---- 1. the swell: the hull round the spot pushed out, smoothly to nothing at the edge
    const swellAt = (x, y, z) => { const d = Math.hypot(x, y, z) / Rw; if (d >= 0.97) return 0; const f = 1 - (d / 0.97) ** 2; return swell * f * f; };
    if (swell > 1e-3) for (let i = 0; i < parts.length; i++) if (reaches(parts[i], Rw)) parts[i] = swap(parts[i], refineWarp(M, parts[i], Rw, Math.max(detail * 1.5, Rw / 50), v => { v[2] += swellAt(v[0], v[1], v[2]); }));
    // or the sphere inside pushing everything round it out from its middle: fully at its edge, dying away to nothing
    // by its reach; a little lumpy (displace) so it doesn't look blown up like a balloon
    const lumpy = Math.max(0, p.pnoise ?? 0.3), pushAt = (x, y, z) => {
      const dx = x - Cw[0], dy = y - Cw[1], dz = z - Cw[2], d = Math.hypot(dx, dy, dz);
      if (d >= Rp * 0.97 || d < 1e-6) return [0, 0, 0];
      const f = d <= sr ? 1 : (() => { const t = (d - sr) / (Rp * 0.97 - sr); const u = 1 - t * t; return u * u; })();
      const k = push * f * (1 + lumpy * vnoise3(x / (sr * 0.45), y / (sr * 0.45), z / (sr * 0.45), (p.seed | 0) % 100000 + 21)) / d;
      return [dx * k, dy * k, dz * k];
    };
    if (push > 1e-3) for (let i = 0; i < parts.length; i++) if (reaches(parts[i], Rp + depth)) parts[i] = swap(parts[i], refineWarp(M, parts[i], Rp, Math.max(detail * 1.5, Rp / 60), v => { const d = pushAt(v[0], v[1], v[2]); v[0] += d[0]; v[1] += d[1]; v[2] += d[2]; }, Cw));
    const surfZ = (x, y) => swell > 1e-3 ? swellAt(x, y, 0) : push > 1e-3 ? pushAt(x, y, 0)[2] : 0;   // where the outside of the plate went
    // ---- 2. torn open: a jagged hole, the plate round it broken into petals bent up and out
    const tear = p.tear !== false && R > 0.2 && breaks;
    const nn = 24, seedN = (p.seed | 0) % 100000;
    const holeR = t => R * 0.72 * (1 + 0.32 * jag * ringNoise(t, 9, seedN) + 0.12 * jag * ringNoise(t, 23, seedN + 3));
    const petalR = t => R * 1.3 * (1 + 0.22 * jag * ringNoise(t, 7, seedN + 5) + 0.08 * jag * ringNoise(t, 19, seedN + 9));
    const zTop = swell + push + R * 3 + (p.height || 0) + 5, zLow = -(plate + 0.05) + (push > 0 ? Math.min(0, surfZ(0, 0)) : 0);   // the cut reaches through the plate only
    const prism = (cs, lo = zLow) => keep(cs.extrude(zTop - lo).translate([0, 0, lo]));
    const loop = (fr, a0, a1, steps) => { const out = []; for (let i = 0; i <= steps; i++) { const t = a0 + (a1 - a0) * i / steps; out.push([fr(t) * Math.cos(2 * Math.PI * t), fr(t) * Math.sin(2 * Math.PI * t)]); } return out; };
    const petals = [];
    if (tear) {
      const holeCS = keep(new CS([loop(holeR, 0, 1, 180).slice(0, -1)], 'Positive'));
      // the petals reach a little past where the hull is cut, so where they hinge they stay joined to it
      const ov = Math.max(0.4, plate * 0.6), ringCS = keep(keep(new CS([loop(t => petalR(t) + ov, 0, 1, 180).slice(0, -1)], 'Positive')).subtract(holeCS));
      const ringP = prism(ringCS), outerP = prism(keep(new CS([loop(petalR, 0, 1, 180).slice(0, -1)], 'Positive'))), zs = [];
      for (let i = 0; i < parts.length; i++) {
        if (!reaches(parts[i], R * 2.2)) continue;
        const z = parts[i].intersect(ringP); if (z.isEmpty()) { z.delete(); continue; } zs.push(z);
        parts[i] = swap(parts[i], parts[i].subtract(outerP));
      }
      const zone = keep(zs.length ? Manifold.union(zs) : Manifold.cube([0, 0, 0])); zs.forEach(x => x.delete());
      // petals: the ring cut into wedges along jagged lines running out from the hole
      const k = Math.max(2, Math.round(p.petals || 6)), cuts = [];
      for (let i = 0; i < k; i++) cuts.push((i + 0.5 * (rnd() - 0.5) * (jag + 0.2)) / k);
      cuts.sort((a, b) => a - b);
      for (let i = 0; i < k; i++) {
        const a0 = cuts[i], a1 = i + 1 < k ? cuts[i + 1] : cuts[0] + 1;
        // the wedge: out past the ring along a jagged line, round, back in along the next jagged line
        const side = (a, out) => { const pts = []; const n = 9; for (let j = 0; j <= n; j++) { const r = R * 0.2 + (R * 2.2) * (out ? j / n : 1 - j / n), wob = (rnd() - 0.5) * 0.11 * jag * (j > 0 && j < n ? 1 : 0) * Math.min(1, R / Math.max(r, 1e-3)); pts.push([r * Math.cos(2 * Math.PI * (a + wob)), r * Math.sin(2 * Math.PI * (a + wob))]); } return pts; };
        const arc = []; for (let j = 1; j < 12; j++) { const t = a0 + (a1 - a0) * j / 12; arc.push([R * 2.4 * Math.cos(2 * Math.PI * t), R * 2.4 * Math.sin(2 * Math.PI * t)]); }
        const wedge = keep(new CS([[...side(a0, true), ...arc, ...side(a1, false)]], 'Positive'));
        const piece = keep(zone.intersect(prism(wedge)));
        if (piece.isEmpty() || piece.volume() < 1e-3) continue;
        // curled up and out from where the petal meets the hull, like bent sheet metal: bent round a curve, every
        // point keeping its depth in the plate (so the plate keeps its thickness), the bend growing to the tip
        const mid = (a0 + a1) / 2, ux = Math.cos(2 * Math.PI * mid), uy = Math.sin(2 * Math.PI * mid), hr = petalR(mid);
        const zc = surfZ(hr * ux, hr * uy) - plate * 0.5, hinge = [hr * ux, hr * uy, zc];
        const ang = (Math.max(0, p.peel ?? 35) * (0.55 + 0.9 * rnd())) * Math.PI / 180, w = Math.max(plate, hr - holeR(mid)), rho = ang > 1e-3 ? w / ang : 0;
        let bentP = piece;
        if (rho > 0) bentP = keep(keep(piece.refineToLength(Math.max(detail, Math.min(plate * 0.8, w / 10)))).warp(v => {
          const r = v[0] * ux + v[1] * uy, s = hr - r; if (s <= 0) return;           // the hinge strip, joined to the hull, stays
          const tx = v[0] - r * ux, ty = v[1] - r * uy, h = v[2] - zc, th = s / rho, k = rho - h;
          const r2 = hr - k * Math.sin(th), z2 = zc + rho - k * Math.cos(th);
          v[0] = tx + r2 * ux; v[1] = ty + r2 * uy; v[2] = z2;
        }));
        const tw = (rnd() - 0.5) * 0.35 * jag;                                 // knocked a little off true
        bentP = keep(bentP.transform(rotAbout([ux, uy, 0], tw, hinge)));
        petals.push(bentP); stats.petals++;
      }
    }
    // ---- 3. the growth: a lumpy mass swelling out of the hole
    let growth = null; const hornList = [];
    const G = Math.max(0, p.grow ?? 0.85) * (sphere ? sr : R), H = Math.max(0, p.height ?? R);
    if (G > 0.2 && H > 0.1 && breaks) {
      let cz = swell * 0.6 - plate * 0.6, rz = H + plate * 0.6 - swell * 0.6 + swell;     // from under the plate to H out
      if (sphere) { cz = -depth; rz = Math.max(sr * 0.5, H + depth + push * 0.5); }           // the ball itself, coming out
      const lumps = [], nL = Math.round(4 + 14 * (p.lumps ?? 0.6));
      for (let i = 0; i < nL; i++) {
        const a = rnd() * 2 * Math.PI, rr = G * Math.sqrt(rnd()) * 0.85, z = cz + rz * (0.25 + 0.6 * rnd()) * Math.sqrt(Math.max(0, 1 - (rr / G) ** 2));
        lumps.push([rr * Math.cos(a), rr * Math.sin(a), z, G * (0.22 + 0.3 * rnd()) * (0.5 + (p.lumps ?? 0.6))]);
      }
      // eyes: the centres the ridges ring round (and where pocks sit deepest)
      const eyes = []; const nE = 1 + Math.round(2 * (p.lumps ?? 0.6) + rnd());
      for (let i = 0; i < nE; i++) { const a = rnd() * 2 * Math.PI, rr = i === 0 ? G * 0.15 * rnd() : G * (0.3 + 0.4 * rnd()); eyes.push([rr * Math.cos(a), rr * Math.sin(a)]); }
      const pust = [], pocks = [];
      const core = (x, y, z) => { const qx = x / G, qy = y / G, qz = (z - cz) / rz, k = Math.hypot(qx, qy, qz); return (k - 1) * Math.min(G, rz) * 0.9; };
      let base = (x, y, z) => {
        let d = core(x, y, z);
        for (const [lx, ly, lz, lr] of lumps) d = smin(d, Math.hypot(x - lx, y - ly, z - lz) - lr, lr * 0.7);
        d += 0.06 * Math.min(G, rz) * vnoise3(x / (G * 0.35), y / (G * 0.35), z / (G * 0.35), seedN + 11) * (0.4 + (p.lumps ?? 0.6));
        return d;
      };
      // ridges ringing each eye: the surface raised and lowered in rings
      // ridges no steeper than the mesh can follow (steeper ones fold into each other and pinch)
      const lam = Math.max(detail * 6, G * 0.2), ridgeA = Math.max(0, p.ridges ?? 0.6) * lam * 0.22;
      const ridged = (x, y, z) => {
        let d = base(x, y, z);
        if (ridgeA > 0 && z > cz) { let best = Infinity; for (const [ex, ey] of eyes) { const dd = Math.hypot(x - ex, y - ey); best = best === Infinity ? dd : smin(best, dd, lam * 0.8); } d -= ridgeA * Math.sin(2 * Math.PI * best / lam + 0.7 * vnoise3(x / lam, y / lam, z / lam, seedN + 5)); }
        return d;
      };
      // points on the surface: march in from straight above (or out along a direction) to where the field crosses
      const surfPt = (dx, dy, dz) => {
        const L = Math.hypot(dx, dy, dz); dx /= L; dy /= L; dz /= L; let lo = 0, hi = Math.max(G, rz) * 2.5;
        if (base(dx * hi, dy * hi, cz + dz * hi) < 0) return null;
        for (let it = 0; it < 32; it++) { const m = (lo + hi) / 2; if (base(dx * m, dy * m, cz + dz * m) < 0) lo = m; else hi = m; }
        const P = [dx * lo, dy * lo, cz + dz * lo], e = detail * 0.5;
        const n = [base(P[0] + e, P[1], P[2]) - base(P[0] - e, P[1], P[2]), base(P[0], P[1] + e, P[2]) - base(P[0], P[1] - e, P[2]), base(P[0], P[1], P[2] + e) - base(P[0], P[1], P[2] - e)];
        const nl = Math.hypot(...n) || 1; return { P, n: n.map(v => v / nl) };
      };
      const upDir = () => { const a = rnd() * 2 * Math.PI, c = 0.15 + 0.85 * rnd(), s = Math.sqrt(1 - c * c); return [s * Math.cos(a), s * Math.sin(a), c]; };
      for (let i = 0; i < Math.round(p.pustules ?? 12); i++) { const sp = surfPt(...upDir()); if (!sp || sp.P[2] < swell * 0.3) continue; const r = Math.max(detail * 1.3, G * (0.035 + 0.05 * rnd())); pust.push([...sp.P.map((v, k) => v + sp.n[k] * r * 0.35), r]); }
      for (let i = 0; i < Math.round(p.pocks ?? 5); i++) { const sp = surfPt(...upDir()); if (!sp || sp.P[2] < swell * 0.3) continue; const r = Math.max(detail * 1.6, G * (0.05 + 0.07 * rnd())); pocks.push([...sp.P.map((v, k) => v + sp.n[k] * r * 0.45), r]); }
      stats.pustules = pust.length; stats.pocks = pocks.length;
      const field = (x, y, z) => {
        let d = ridged(x, y, z);
        for (const [px, py, pz, r] of pust) d = smin(d, Math.hypot(x - px, y - py, z - pz) - r, r * 0.5);
        for (const [px, py, pz, r] of pocks) d = smax(d, -(Math.hypot(x - px, y - py, z - pz) - r), r * 0.35);
        return -d;                                                                 // positive inside
      };
      const pad = ridgeA + detail * 2 + G * 0.6;
      const lo = [-G - pad, -G - pad, cz - rz - pad], hi = [G + pad, G + pad, cz + rz + pad];
      const g0 = keep(Manifold.levelSet(q => field(q[0], q[1], q[2]), { min: lo, max: hi }, detail, 1.234e-4));
      // keep the body of it (crumbs cut off by the box edge or a pock go)
      const bits = g0.decompose(); let big = null, bv = -1; for (const b of bits) { const v = b.volume(); if (v > bv) { bv = v; big = b; } }
      for (const b of bits) if (b !== big) b.delete();
      growth = big ? keep(big) : null;
      // horns: cones out of the growth along its surface, bent a little, sunk into it at the root
      const nh = Math.round(p.horns ?? 6), hl = Math.max(0.5, p.hornLen ?? R * 0.8);
      for (let i = 0; i < nh; i++) {
        const sp = surfPt(...upDir()); if (!sp) continue;
        const len = hl * (0.55 + 0.7 * rnd()), rb = Math.max(detail * 1.5, len * (0.16 + 0.08 * rnd())), seg = 14;
        let cone = keep(Manifold.cylinder(len + rb, rb, Math.max(detail * 0.4, rb * 0.06), seg));
        // curved like a horn: the whole length bent round an arc (up to about 150° at full curl),
        // thickness kept
        const L0 = len + rb, bend = Math.max(0, p.curl ?? 0.6) * (Math.PI * 0.85) * (0.6 + 0.8 * rnd()), cdir = rnd() * 2 * Math.PI, cx = Math.cos(cdir), cy = Math.sin(cdir);
        if (bend > 1e-3) cone = keep(keep(cone.refineToLength(Math.max(detail * 0.8, L0 / 24))).warp(v => {
          const rr = L0 / bend, a = v[2] / rr, wv = v[0] * cx + v[1] * cy, qx = v[0] - wv * cx, qy = v[1] - wv * cy, k = rr - wv;
          const along = rr - k * Math.cos(a); v[0] = qx + along * cx; v[1] = qy + along * cy; v[2] = k * Math.sin(a);
        }));
        // lean the horn between the surface's way out and straight up
        const dir = sp.n.map((v, k) => v * 0.75 + (k === 2 ? 0.25 : 0)); const dl = Math.hypot(...dir);
        const base0 = sp.P.map((v, k) => v - (dir[k] / dl) * rb);
        hornList.push(keep(cone.transform(aimZ(dir.map(v => v / dl), base0)))); stats.horns++;
      }
    }
    // ---- 4. all together
    // nudged off the hull's planes by a hair, so no face of the growth lies exactly on one (that leaves pinched edges)
    const nudge = x => keep(x.translate([1.37e-4, -0.91e-4, 1.13e-4]));
    // what's added, together first (small), its crumbs dropped (a sliver where a pock grazed a horn, say); then onto the part
    let added = null;
    const adds = [...petals.map(nudge), ...(growth ? [nudge(growth)] : []), ...hornList.map(nudge)];
    if (adds.length) {
      const u = keep(Manifold.union(adds)), bits = u.decompose(); let big = 0; for (const b of bits) big = Math.max(big, b.volume());
      const kept = bits.filter(b => b.volume() > Math.max(1e-3, big * 1e-4)); bits.forEach(b => { if (!kept.includes(b)) b.delete(); }); kept.forEach(keep);
      added = kept.length === bits.length ? u : keep(Manifold.compose(kept));
    }
    // out: the worked shells, what's added (its own solid, overlapping the hull where it grows from it: merged on
    // export), and the untouched rest
    const outs = [...parts.map(soupOf), ...(added ? [soupOf(added)] : []), strays];
    let n = 0; for (const f of outs) n += f.length; const positions = new Float32Array(n); let o = 0; for (const f of outs) { positions.set(f, o); o += f.length; }
    return { positions, stats };
  } finally { trash.forEach(x => { try { x.delete(); } catch (e) {} }); }
}
