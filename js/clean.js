// Clean out the insides: keep the outside skin of a part and nothing within it. No AI. Runs in the worker.
// Closed pieces are unioned with Manifold, so anything closed that sits inside another piece (overlapping kit parts,
// pegs, a body inside its armour) is swallowed, and sealed hollows are filled. Bits that aren't closed (open sheets,
// stray triangles, broken shells) can't be unioned, so each of their triangles is tested by sight: rays cast from it
// in many directions; if any gets out of the model, it's on the outside and stays, if none does it's inside and goes.
import { mergeSolid } from './solid.js';

/** A uniform grid over triangles, for "does this ray hit anything" queries. */
function makeGrid(P) {
  const nt = P.length / 9, lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { const v = P[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
  for (let k = 0; k < 3; k++) { lo[k] -= 1e-3; hi[k] += 1e-3; }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], vol = Math.max(1e-9, ext[0] * ext[1] * ext[2]);
  const cell = Math.cbrt(vol / Math.max(1, nt * 0.5)), res = ext.map(e => Math.max(1, Math.min(200, Math.ceil(e / cell))));
  const cs = ext.map((e, k) => e / res[k]), nc = res[0] * res[1] * res[2];
  const ci = (v, k) => Math.max(0, Math.min(res[k] - 1, Math.floor((v - lo[k]) / cs[k])));
  const range = t => { const r = []; for (let k = 0; k < 3; k++) { const a = P[9 * t + k], b = P[9 * t + 3 + k], c = P[9 * t + 6 + k]; r.push(ci(Math.min(a, b, c), k), ci(Math.max(a, b, c), k)); } return r; };
  const count = new Uint32Array(nc + 1);
  for (let t = 0; t < nt; t++) { const r = range(t); for (let z = r[4]; z <= r[5]; z++) for (let y = r[2]; y <= r[3]; y++) for (let x = r[0]; x <= r[1]; x++) count[(z * res[1] + y) * res[0] + x + 1]++; }
  for (let i = 0; i < nc; i++) count[i + 1] += count[i];
  const items = new Uint32Array(count[nc]), fill = count.slice(0, nc);
  for (let t = 0; t < nt; t++) { const r = range(t); for (let z = r[4]; z <= r[5]; z++) for (let y = r[2]; y <= r[3]; y++) for (let x = r[0]; x <= r[1]; x++) items[fill[(z * res[1] + y) * res[0] + x]++] = t; }
  return { P, lo, hi, res, cs, start: count, items, stamp: new Uint32Array(nt), tick: 0 };
}

/** Does a ray from o along d hit any triangle (but skip)? Amanatides–Woo walk through the grid. */
function blocked(G, o, d, skip) {
  const { P, lo, hi, res, cs, start, items, stamp } = G;
  if (++G.tick === 0xffffffff) { stamp.fill(0); G.tick = 1; }
  const tk = G.tick;
  // where the ray is in the grid
  let t0 = 0, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) < 1e-12) { if (o[k] < lo[k] || o[k] > hi[k]) return false; continue; }
    let a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k]; if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b;
  }
  if (t0 > t1) return false;
  const cell = [0, 0, 0], step = [0, 0, 0], tMax = [0, 0, 0], tDelta = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const p = o[k] + d[k] * t0; cell[k] = Math.max(0, Math.min(res[k] - 1, Math.floor((p - lo[k]) / cs[k])));
    if (d[k] > 0) { step[k] = 1; tMax[k] = (lo[k] + (cell[k] + 1) * cs[k] - o[k]) / d[k]; tDelta[k] = cs[k] / d[k]; }
    else if (d[k] < 0) { step[k] = -1; tMax[k] = (lo[k] + cell[k] * cs[k] - o[k]) / d[k]; tDelta[k] = -cs[k] / d[k]; }
    else { step[k] = 0; tMax[k] = Infinity; tDelta[k] = Infinity; }
  }
  for (;;) {
    const c = (cell[2] * res[1] + cell[1]) * res[0] + cell[0];
    for (let j = start[c], je = start[c + 1]; j < je; j++) {
      const t = items[j]; if (t === skip || stamp[t] === tk) continue; stamp[t] = tk;
      // Möller–Trumbore
      const i = 9 * t, ax = P[i], ay = P[i + 1], az = P[i + 2];
      const e1x = P[i + 3] - ax, e1y = P[i + 4] - ay, e1z = P[i + 5] - az, e2x = P[i + 6] - ax, e2y = P[i + 7] - ay, e2z = P[i + 8] - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det, sx = o[0] - ax, sy = o[1] - ay, sz = o[2] - az, u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) * inv > 1e-7) return true;
    }
    let k = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    if (tMax[k] > t1) return false;
    cell[k] += step[k]; if (cell[k] < 0 || cell[k] >= res[k]) return false;
    tMax[k] += tDelta[k];
  }
}

/** Directions spread evenly over the sphere. */
function sphereDirs(n) {
  const out = [], g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = g * i; out.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  return out;
}

/** Which of the triangles first..nt-1 of P can see out of the model (from either face). */
function seenFromOutside(P, first, rays) {
  const G = makeGrid(P), nt = P.length / 9, dirs = sphereDirs(rays), keep = new Uint8Array(nt - first);
  let diag = 0; for (let k = 0; k < 3; k++) diag += (G.hi[k] - G.lo[k]) ** 2; const eps = Math.max(1e-5, Math.sqrt(diag) * 2e-6);
  // quick pass: flood the grid's empty cells from its border; a triangle in a cell next to that outside air is on
  // the outside. Only the rest (inside, or down a gap too narrow for the flood) need rays.
  const { res, start } = G, nc = res[0] * res[1] * res[2], air = new Uint8Array(nc), stack = [];
  const empty = c => start[c + 1] === start[c];
  for (let z = 0; z < res[2]; z++) for (let y = 0; y < res[1]; y++) for (let x = 0; x < res[0]; x++) {
    if (x && y && z && x < res[0] - 1 && y < res[1] - 1 && z < res[2] - 1) continue;
    const c = (z * res[1] + y) * res[0] + x; if (empty(c) && !air[c]) { air[c] = 1; stack.push(c); }
  }
  const sx = 1, sy = res[0], sz = res[0] * res[1];
  while (stack.length) {
    const c = stack.pop(), x = c % res[0], y = ((c / res[0]) | 0) % res[1], z = (c / sz) | 0;
    const go = n => { if (!air[n] && empty(n)) { air[n] = 1; stack.push(n); } };
    if (x > 0) go(c - sx); if (x < res[0] - 1) go(c + sx); if (y > 0) go(c - sy); if (y < res[1] - 1) go(c + sy); if (z > 0) go(c - sz); if (z < res[2] - 1) go(c + sz);
  }
  const touchesAir = new Uint8Array(nc);   // occupied cells with outside air next to them (or on the grid's edge)
  for (let z = 0; z < res[2]; z++) for (let y = 0; y < res[1]; y++) for (let x = 0; x < res[0]; x++) {
    const c = (z * res[1] + y) * res[0] + x; if (empty(c)) continue;
    touchesAir[c] = (x === 0 || y === 0 || z === 0 || x === res[0] - 1 || y === res[1] - 1 || z === res[2] - 1 || air[c - sx] || air[c + sx] || air[c - sy] || air[c + sy] || air[c - sz] || air[c + sz]) ? 1 : 0;
  }
  const outsideCell = new Uint8Array(nt);
  for (let c = 0; c < nc; c++) if (touchesAir[c]) for (let j = start[c]; j < start[c + 1]; j++) outsideCell[G.items[j]] = 1;
  const o = [0, 0, 0];
  for (let t = first; t < nt; t++) {
    if (outsideCell[t]) { keep[t - first] = 1; continue; }
    const i = 9 * t, cx = (P[i] + P[i + 3] + P[i + 6]) / 3, cy = (P[i + 1] + P[i + 4] + P[i + 7]) / 3, cz = (P[i + 2] + P[i + 5] + P[i + 8]) / 3;
    const ux = P[i + 3] - P[i], uy = P[i + 4] - P[i + 1], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vy = P[i + 7] - P[i + 1], vz = P[i + 8] - P[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // start with the directions the triangle faces, as those are the likeliest way out; then the other face
    let seen = false;
    for (let s = 1; s >= -1 && !seen; s -= 2) {
      o[0] = cx + s * nx * eps; o[1] = cy + s * ny * eps; o[2] = cz + s * nz * eps;
      for (const d of dirs) { if ((d[0] * nx + d[1] * ny + d[2] * nz) * s <= 0.02) continue; if (!blocked(G, o, d, t)) { seen = true; break; } }
    }
    keep[t - first] = seen ? 1 : 0;
  }
  return keep;
}

/**
 * p: { soup, pieces ('all' | 'largest': only the biggest closed piece, nothing else), open ('outside': open bits
 * kept where they're on the outside | 'drop': all open bits go), rays (how many directions each open triangle tries) }
 * → { positions, stats }
 */
export function buildClean(M, p) {
  const before = p.soup.length / 9;
  const clean = mergeSolid(M, [p.soup], { fillHollows: true, loose: 'keep', manifold: true });
  const stats = { before, hollows: clean.hollows, inputShells: clean.inputShells, pieces: 0, piecesDropped: 0, openKept: 0, openDropped: 0, after: 0 };
  let solidPos = clean.positions.subarray(0, clean.positions.length - clean.strays.length);
  try {
    if (clean.solid && p.pieces === 'largest') {
      const parts = clean.solid.decompose(); let best = null, bv = -Infinity;
      for (const x of parts) { const v = x.volume(); if (v > bv) { bv = v; best = x; } }
      if (best && parts.length > 1) {
        const ms = best.getMesh(), V = ms.vertProperties, np = ms.numProp, T = ms.triVerts, out = new Float32Array(T.length * 3);
        for (let i = 0; i < T.length; i++) { out[3 * i] = V[T[i] * np]; out[3 * i + 1] = V[T[i] * np + 1]; out[3 * i + 2] = V[T[i] * np + 2]; }
        solidPos = out; stats.piecesDropped = parts.length - 1;
      }
      stats.pieces = best ? 1 : 0; parts.forEach(x => x.delete());
    } else if (clean.solid) stats.pieces = clean.shells;
  } finally { if (clean.solid) clean.solid.delete(); }
  // the open bits: kept only where they can be seen from outside
  const S = clean.strays, ns = S.length / 9;
  let openOut = new Float32Array(0);
  if (ns && p.open !== 'drop' && p.pieces !== 'largest') {
    const all = new Float32Array(solidPos.length + S.length); all.set(solidPos); all.set(S, solidPos.length);
    const keep = seenFromOutside(all, solidPos.length / 9, Math.max(16, Math.min(512, p.rays | 0 || 96)));
    let n = 0; for (const k of keep) n += k;
    openOut = new Float32Array(n * 9); let o = 0;
    for (let t = 0; t < ns; t++) if (keep[t]) { openOut.set(S.subarray(9 * t, 9 * t + 9), o); o += 9; }
    if (p.debugDropped) { const d = new Float32Array((ns - n) * 9); let q = 0; for (let t = 0; t < ns; t++) if (!keep[t]) { d.set(S.subarray(9 * t, 9 * t + 9), q); q += 9; } stats.dropped = d; }
    stats.openKept = n; stats.openDropped = ns - n; stats.openChecked = true;
  } else stats.openDropped = ns;
  const positions = new Float32Array(solidPos.length + openOut.length); positions.set(solidPos); positions.set(openOut, solidPos.length);
  stats.after = positions.length / 9;
  if (!positions.length) throw new Error("that left nothing of it: it has no closed solid and nothing open can be seen from outside");
  return { positions, stats };
}
