// Growths: a growth is a part of its own (a lumpy ball made here, or any part you choose, like a sculpted growth
// you imported) that you place and move like any other, and that pushes the parts round it out of its way, as if
// it had swollen up between them. No AI. Runs in the worker.
//  - buildGrowBall: the ball's mesh, in its own frame (centre at the origin): lumps, rings, pustules, pock holes,
//    curved horns, all round.
//  - buildWarp: one part's mesh pushed out of the growth's room. The part comes in already in the growth's
//    "unit" frame (its room is the unit ball there: a sphere, or an ellipsoid for a shape), is split finer where
//    it's within reach so it bends smoothly, every corner within reach is pushed out from the middle, and it goes
//    back to the part's own frame.
import { rng, vnoise3, smin, smax, aimZ, exactWeld, soupOf } from './burst.js';

/** p: { r (mm), lumps, ridges (0..1), pustules, pocks, horns (counts; none unless asked), hornPct (length, × r), curl (0..1), detail (mm), seed } */
export function buildGrowBall(M, p) {
  const { Manifold } = M, trash = [], keep = x => { trash.push(x); return x; };
  const r = Math.max(0.5, p.r || 8), detail = Math.max(0.05, Math.min(p.detail || 0.25, r / 12)), rnd = rng((p.seed | 0) * 7919 + 31), sN = (p.seed | 0) % 100000;
  const stats = { horns: 0, pustules: 0, pocks: 0 };
  const dir = () => { const z = rnd() * 2 - 1, a = rnd() * 2 * Math.PI, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z]; };
  try {
    const lumpK = Math.max(0, p.lumps ?? 0.6), lumps = [];
    for (let i = 0, n = Math.round(6 + 18 * lumpK); i < n; i++) { const d = dir(), at = r * (0.45 + 0.35 * rnd()); lumps.push([d[0] * at, d[1] * at, d[2] * at, r * (0.25 + 0.25 * rnd()) * (0.6 + lumpK)]); }
    const eyes = []; for (let i = 0, n = 2 + Math.round(3 * lumpK); i < n; i++) { const d = dir(); eyes.push(d.map(v => v * r)); }
    const base = (x, y, z) => {
      let d = Math.hypot(x, y, z) - r * 0.82;
      for (const [lx, ly, lz, lr] of lumps) d = smin(d, Math.hypot(x - lx, y - ly, z - lz) - lr, lr * 0.7);
      return d + 0.06 * r * vnoise3(x / (r * 0.35), y / (r * 0.35), z / (r * 0.35), sN + 11) * (0.4 + lumpK);
    };
    const lam = Math.max(detail * 6, r * 0.2), ridgeA = Math.max(0, p.ridges ?? 0.6) * lam * 0.22;
    const ridged = (x, y, z) => {
      let d = base(x, y, z); if (ridgeA <= 0) return d;
      let best = Infinity; for (const [ex, ey, ez] of eyes) { const dd = Math.hypot(x - ex, y - ey, z - ez); best = best === Infinity ? dd : smin(best, dd, lam * 0.8); }
      return d - ridgeA * Math.sin(2 * Math.PI * best / lam + 0.7 * vnoise3(x / lam, y / lam, z / lam, sN + 5));
    };
    const surfPt = d0 => {
      let lo = 0, hi = r * 3; if (base(d0[0] * hi, d0[1] * hi, d0[2] * hi) < 0) return null;
      for (let it = 0; it < 32; it++) { const m = (lo + hi) / 2; if (base(d0[0] * m, d0[1] * m, d0[2] * m) < 0) lo = m; else hi = m; }
      const P = d0.map(v => v * lo), e = detail * 0.5;
      const n = [base(P[0] + e, P[1], P[2]) - base(P[0] - e, P[1], P[2]), base(P[0], P[1] + e, P[2]) - base(P[0], P[1] - e, P[2]), base(P[0], P[1], P[2] + e) - base(P[0], P[1], P[2] - e)];
      const nl = Math.hypot(...n) || 1; return { P, n: n.map(v => v / nl) };
    };
    const pust = [], pocks = [];
    for (let i = 0; i < Math.round(p.pustules ?? 16); i++) { const sp = surfPt(dir()); if (!sp) continue; const q = Math.max(detail * 1.3, r * (0.04 + 0.05 * rnd())); pust.push([...sp.P.map((v, k) => v + sp.n[k] * q * 0.35), q]); }
    for (let i = 0; i < Math.round(p.pocks ?? 6); i++) { const sp = surfPt(dir()); if (!sp) continue; const q = Math.max(detail * 1.6, r * (0.05 + 0.07 * rnd())); pocks.push([...sp.P.map((v, k) => v + sp.n[k] * q * 0.45), q]); }
    stats.pustules = pust.length; stats.pocks = pocks.length;
    const field = (x, y, z) => {
      let d = ridged(x, y, z);
      for (const [px, py, pz, q] of pust) d = smin(d, Math.hypot(x - px, y - py, z - pz) - q, q * 0.5);
      for (const [px, py, pz, q] of pocks) d = smax(d, -(Math.hypot(x - px, y - py, z - pz) - q), q * 0.35);
      return -d;
    };
    const pad = r * 0.9 + ridgeA + detail * 2;
    const g0 = keep(Manifold.levelSet(q => field(q[0], q[1], q[2]), { min: [-r - pad, -r - pad, -r - pad], max: [r + pad, r + pad, r + pad] }, detail, 1.234e-4));
    const bits = g0.decompose(); let big = null, bv = -1; for (const b of bits) { const v = b.volume(); if (v > bv) { bv = v; big = b; } } for (const b of bits) if (b !== big) b.delete();
    if (!big) throw new Error('the growth came out empty');
    const all = [keep(big)];
    // horns: curved, out of the surface all round
    const hl = Math.max(detail * 3, p.hornPct != null ? r * p.hornPct : (p.hornLen ?? r * 0.6));   // horns sized to the ball
    for (let i = 0; i < Math.round(p.horns ?? 0); i++) {
      const sp = surfPt(dir()); if (!sp) continue;
      const len = hl * (0.55 + 0.7 * rnd()), rb = Math.max(detail * 1.5, len * (0.16 + 0.08 * rnd())), L0 = len + rb;
      let cone = keep(Manifold.cylinder(L0, rb, Math.max(detail * 0.4, rb * 0.06), 14));
      const bend = Math.max(0, p.curl ?? 0.6) * (Math.PI * 0.85) * (0.6 + 0.8 * rnd()), cd = rnd() * 2 * Math.PI, cx = Math.cos(cd), cy = Math.sin(cd);
      if (bend > 1e-3) cone = keep(keep(cone.refineToLength(Math.max(detail * 0.8, L0 / 24))).warp(v => {
        const rr = L0 / bend, a = v[2] / rr, wv = v[0] * cx + v[1] * cy, qx = v[0] - wv * cx, qy = v[1] - wv * cy, k = rr - wv, along = rr - k * Math.cos(a);
        v[0] = qx + along * cx; v[1] = qy + along * cy; v[2] = k * Math.sin(a);
      }));
      all.push(keep(cone.transform(aimZ(sp.n, sp.P.map((v, k) => v - sp.n[k] * rb))))); stats.horns++;
    }
    const u = keep(Manifold.union(all));
    return { positions: soupOf(u), stats };
  } finally { trash.forEach(x => { try { x.delete(); } catch (e) {} }); }
}

const mul = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];

/**
 * p: { soup (the part, its own frame), toQ / fromQ (4×4 column-major: the part's frame to the growth's unit frame
 * and back), reach (the push dies away by this distance, in units of the growth's size: > 1), sink (0..0.5: how far
 * the parts may stay inside the growth's skin, so they bury into it), strength (0..1), noise (0..1), L (finest edge
 * there, unit frame), seed } → { positions, moved }
 */
export function buildWarp(p) {
  const R1 = Math.max(1.1, p.reach || 2), m = 1 - Math.min(0.5, Math.max(0, p.sink ?? 0.12)), noise = Math.max(0, p.noise ?? 0.3), sN = (p.seed | 0) % 100000 + 21;
  // how far the parts are shoved out at the growth's skin (in units of its size); no more than keeps the push from
  // folding the surface over itself as it dies away
  const PUSH = Math.min(Math.max(0, p.strength ?? 0.5), 0.9 * 2 * (R1 - 1) / Math.PI);
  // corners into the growth's frame
  const src = p.soup, w = exactWeld(src), n0 = w.vert.length / 3;
  let P_ = new Float64Array(Math.max(n0 * 3 * 1.5, 3072)), T = new Uint32Array(Math.max(w.tri.length * 1.5, 3072)), nv = n0, nt = w.tri.length / 3;
  for (let i = 0; i < n0; i++) { const q = mul(p.toQ, w.vert[3 * i], w.vert[3 * i + 1], w.vert[3 * i + 2]); P_[3 * i] = q[0]; P_[3 * i + 1] = q[1]; P_[3 * i + 2] = q[2]; }
  T.set(w.tri);
  // split finer within reach, both triangles on an edge together (so nothing opens up)
  const L = Math.max(1e-3, p.L || 0.06);
  const addV = (x, y, z) => { if (3 * nv + 3 > P_.length) { const q = new Float64Array(P_.length * 2); q.set(P_); P_ = q; } P_[3 * nv] = x; P_[3 * nv + 1] = y; P_[3 * nv + 2] = z; return nv++; };
  const addT = (a, b, c) => { if (3 * nt + 3 > T.length) { const q = new Uint32Array(T.length * 2); q.set(T); T = q; } T[3 * nt] = a; T[3 * nt + 1] = b; T[3 * nt + 2] = c; return nt++; };
  const near = (a, b) => { const ax = P_[3 * a], ay = P_[3 * a + 1], az = P_[3 * a + 2], dx = P_[3 * b] - ax, dy = P_[3 * b + 1] - ay, dz = P_[3 * b + 2] - az, l2 = dx * dx + dy * dy + dz * dz; const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy + az * dz) / l2)) : 0; return Math.hypot(ax + t * dx, ay + t * dy, az + t * dz) < R1; };
  const len2 = (a, b) => (P_[3 * a] - P_[3 * b]) ** 2 + (P_[3 * a + 1] - P_[3 * b + 1]) ** 2 + (P_[3 * a + 2] - P_[3 * b + 2]) ** 2;
  let active = []; for (let t = 0; t < nt; t++) { const a = T[3 * t], b = T[3 * t + 1], c = T[3 * t + 2]; if (near(a, b) || near(b, c) || near(c, a)) active.push(t); }
  if (!active.length) return { positions: src instanceof Float32Array ? src : new Float32Array(src), moved: 0 };
  const key = (a, b) => a < b ? a * 4194304 + b : b * 4194304 + a;
  for (let round = 0; round < 24 && active.length; round++) {
    const mid = new Map();
    for (const t of active) for (let e = 0; e < 3; e++) { const a = T[3 * t + e], b = T[3 * t + (e + 1) % 3], k = key(a, b); if (mid.has(k) || len2(a, b) <= L * L || !near(a, b)) continue; mid.set(k, addV((P_[3 * a] + P_[3 * b]) / 2, (P_[3 * a + 1] + P_[3 * b + 1]) / 2, (P_[3 * a + 2] + P_[3 * b + 2]) / 2)); }
    if (!mid.size || nv > 8e6) break;
    const next = [];
    for (const t of active) {
      const v = [T[3 * t], T[3 * t + 1], T[3 * t + 2]], md = [0, 1, 2].map(e => mid.get(key(v[e], v[(e + 1) % 3]))), c = (md[0] !== undefined) + (md[1] !== undefined) + (md[2] !== undefined);
      if (!c) { next.push(t); continue; }
      const put = (a, b, cc, first) => { if (first) { T[3 * t] = a; T[3 * t + 1] = b; T[3 * t + 2] = cc; next.push(t); } else next.push(addT(a, b, cc)); };
      if (c === 3) { put(v[0], md[0], md[2], 1); put(md[0], v[1], md[1]); put(md[2], md[1], v[2]); put(md[0], md[1], md[2]); continue; }
      let r = 0; if (c === 1) r = md.findIndex(x => x !== undefined); else r = md[0] === undefined ? 1 : md[1] === undefined ? 2 : 0;
      const a = v[r], b = v[(r + 1) % 3], cc = v[(r + 2) % 3], mab = md[r], mbc = md[(r + 1) % 3];
      if (c === 1) { put(a, mab, cc, 1); put(mab, b, cc); } else { put(a, mab, cc, 1); put(mab, b, mbc); put(mab, mbc, cc); }
    }
    active = next;
  }
  // Away (the usual): the part is shoved aside, away from the growth, as a whole near it and less and less further
  // off, so it bends out of the way and the growth takes its place: at a corner each part goes its own way and the
  // corner opens up. Which way is from the growth's middle to the bit of the part that's in its room. The shove is
  // most at the middle and dies away smoothly by the reach, never so fast that the surface folds over itself.
  // Around: everything is pushed straight out from the middle, so the part swells round it.
  let ux = 0, uy = 0, uz = 0, cnt = 0;
  for (let i = 0; i < nv; i++) { const x = P_[3 * i], y = P_[3 * i + 1], z = P_[3 * i + 2], d = Math.hypot(x, y, z); if (d < 1.25) { ux += x; uy += y; uz += z; cnt++; } }
  if (!cnt) for (let i = 0; i < nv; i++) { const x = P_[3 * i], y = P_[3 * i + 1], z = P_[3 * i + 2], d = Math.hypot(x, y, z); if (d < R1) { const w = 1 / Math.max(d, 1e-3); ux += x * w; uy += y * w; uz += z * w; cnt++; } }
  const ul = Math.hypot(ux, uy, uz) / Math.max(cnt, 1), away = p.mode !== 'around' && ul > 0.08;
  if (away) { const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l; }
  const C = Math.min(1 + PUSH - (1 - m), 0.9 * 2 * R1 / Math.PI);
  let moved = 0;
  for (let i = 0; i < nv; i++) {
    const x = P_[3 * i], y = P_[3 * i + 1], z = P_[3 * i + 2], d = Math.hypot(x, y, z);
    if (d >= R1) continue;
    const wob = 1 + noise * vnoise3(x * 2.2, y * 2.2, z * 2.2, sN);
    if (away) {
      const s = C * 0.5 * (1 + Math.cos(Math.PI * d / R1)) * wob;
      P_[3 * i] = x + ux * s; P_[3 * i + 1] = y + uy * s; P_[3 * i + 2] = z + uz * s;
    } else {
      if (d < 1e-9) continue;
      const d2 = d < 1 ? m + (1 + PUSH - m) * d : d + PUSH * 0.5 * (1 + Math.cos(Math.PI * (d - 1) / (R1 - 1)));
      const k = (d + (d2 - d) * wob) / d; P_[3 * i] = x * k; P_[3 * i + 1] = y * k; P_[3 * i + 2] = z * k;
    }
    moved++;
  }
  const out = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) { const v = T[3 * t + e], q = mul(p.fromQ, P_[3 * v], P_[3 * v + 1], P_[3 * v + 2]); out.set(q, 9 * t + 3 * e); }
  return { positions: out, moved };
}
