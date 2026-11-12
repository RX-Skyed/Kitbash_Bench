import { mergeSolid } from './solid.js';
// Ooze: organic strands strung between points on surfaces: sagging under their own weight, lumpy, necking thin
// where they stretch, with pustules, hanging drips and a splat where they stick on. No AI: it's a blobby field (a
// smooth blend of tapered tubes, balls and flattened splats laid along the path) turned into a closed mesh with
// Manifold's level set. Runs in the worker; everything is in world space.

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** Smooth 1D noise along a strand (so the wobble and swelling wander rather than jitter). */
function noise1(r, n = 64) { const v = Array.from({ length: n + 2 }, () => r() * 2 - 1); return t => { const x = Math.max(0, t) * n, i = Math.min(n, Math.floor(x)), f = x - i, s = f * f * (3 - 2 * f); return v[i] + (v[i + 1] - v[i]) * s; }; }

/**
 * The pieces of the field. p: { anchors: [{ p, n }] (world points on the surfaces and their normals), down (world
 * gravity), thick (mm, a strand's radius ×2), lumpy (0..1), sag (0..1), strands (1..4), twist (turns per 10 mm),
 * pustules (per 10 mm), drips (count), dripLen (mm), splat (mm, radius on the surface), seed }
 */
function elements(p) {
  const r = rng(p.seed), R = Math.max(0.05, p.thick / 2), down = norm(p.down || [0, 0, -1]), caps = [], balls = [], splats = [], webs = [], spans = [];
  const A = p.anchors, psz = Math.max(0.1, p.pustSize ?? 1);
  // splats where it sticks on: a flattened blob on the surface, sunk a little into it
  for (const a of A) { const n = norm(a.n); splats.push({ c: add(a.p, mul(n, -R * 0.3)), n, rt: Math.max(R * 1.1, p.splat), rn: Math.max(R * 0.75, (p.detail || 0.15) * 2.5) }); }
  for (let i = 0; i + 1 < A.length; i++) {
    const a = A[i], b = A[i + 1], n0 = norm(a.n), n1 = norm(b.n), L = len(sub(b.p, a.p)); if (L < 1e-6) continue;
    // out of each surface along its normal, then across, sagging under its weight in the middle
    const c0 = add(a.p, mul(n0, L * 0.3)), c1 = add(b.p, mul(n1, L * 0.3)), sagD = p.sag * L * 0.45;
    const N = Math.max(8, Math.ceil(L / (R * 0.45))), wob = noise1(r), wob2 = noise1(r), swell = noise1(r), pts = [];
    const tang = norm(sub(b.p, a.p)); let u = cross(tang, down); if (len(u) < 1e-6) u = cross(tang, [1, 0, 0]); u = norm(u); const v = norm(cross(tang, u));
    for (let k = 0; k <= N; k++) {
      const t = k / N, s = 1 - t;
      let q = add(add(mul(a.p, s * s * s), mul(c0, 3 * s * s * t)), add(mul(c1, 3 * s * t * t), mul(b.p, t * t * t)));
      q = add(q, mul(down, sagD * 4 * t * (1 - t)));
      const mid = 4 * t * (1 - t);                                   // 0 at the ends, 1 in the middle
      q = add(q, add(mul(u, wob(t) * R * 0.8 * p.lumpy * mid), mul(v, wob2(t) * R * 0.8 * p.lumpy * mid)));
      // thick where it leaves the surface, necking thinner as it stretches, swelling in places
      const rad = R * (1 + 0.45 * (1 - mid) ** 3) * (1 - 0.35 * p.sag * mid) * (1 - 0.75 * (p.stretch ?? 0) * mid ** 1.5) * (1 + 0.45 * p.lumpy * swell(t) * (1 - 0.6 * (p.stretch ?? 0)));
      pts.push({ q, rad: Math.max(R * 0.18, (p.detail || 0.15) * 1.1, rad), t });                // never thinner than the mesh can hold
    }
    // more than one strand: twisted round each other along the way
    const S = Math.max(1, Math.min(4, p.strands | 0)), strandPts = [];
    let arc = 0;
    for (let k = 0; k < pts.length; k++) {
      if (k) arc += len(sub(pts[k].q, pts[k - 1].q));
      pts[k].arc = arc;
    }
    for (let s = 0; s < S; s++) {
      const sp = pts.map(o => {
        if (S === 1) return o;
        const mid = 4 * o.t * (1 - o.t), ph = 2 * Math.PI * s / S + 2 * Math.PI * p.twist * o.arc / 10, off = o.rad * (1.15 + (p.webStrand ? 1.6 * (p.web ?? 0.5) : 0)) * Math.min(1, mid * 3);
        return { q: add(o.q, add(mul(u, Math.cos(ph) * off), mul(v, Math.sin(ph) * off))), rad: o.rad * (0.5 + 0.12 * r()), t: o.t };
      });
      for (let k = 0; k + 1 < sp.length; k++) caps.push({ a: sp[k].q, b: sp[k + 1].q, ra: sp[k].rad, rb: sp[k + 1].rad });
      strandPts.push(sp);
    }
    spans.push({ pts, strands: strandPts, a, b, n0, n1 });
    // lumps and pustules on it
    const nl = Math.round(L / (R * 4) * p.lumpy * 1.5);
    const onStrand = k => { const sp = strandPts[Math.floor(r() * strandPts.length)]; return sp[Math.max(1, Math.min(sp.length - 2, k))]; };   // lumps, pustules and drips sit on a strand, not between them
    for (let k = 0; k < nl; k++) { const o = onStrand(1 + Math.floor(r() * (pts.length - 2))); balls.push({ c: o.q, r: o.rad * (1.15 + r() * 0.6) }); }
    const np = Math.round(L / 10 * p.pustules * (1 + r()));
    for (let k = 0; k < np; k++) {
      const o = onStrand(1 + Math.floor(r() * (pts.length - 2))), ang = r() * 2 * Math.PI, dir = add(mul(u, Math.cos(ang)), mul(v, Math.sin(ang)));
      const pr = o.rad * (0.28 + r() * 0.35) * psz; balls.push({ c: add(o.q, mul(dir, o.rad * 0.85)), r: pr });
    }
    // drips: from the low points, hanging down and ending in a drop
    const lows = []; for (let k = 2; k + 2 < pts.length; k++) { const h = dot(pts[k].q, down); if (h >= dot(pts[k - 1].q, down) && h >= dot(pts[k + 1].q, down)) lows.push(k); }
    if (!lows.length) lows.push(Math.floor(pts.length / 2));
    const nd = Math.max(0, Math.round(p.drips * (0.6 + r() * 0.8)));
    for (let d = 0; d < nd; d++) {
      const k0 = lows[d % lows.length] + Math.round((r() - 0.5) * pts.length * 0.25 * (d >= lows.length ? 1 : 0.3));
      const o = onStrand(k0), dl = p.dripLen * (0.5 + r() * 0.8), rr = Math.max(o.rad * (0.45 + r() * 0.2), (p.detail || 0.15) * 2.4);
      const mid = add(o.q, mul(down, dl * 0.55)), end = add(o.q, mul(down, dl));
      caps.push({ a: o.q, b: mid, ra: rr, rb: rr * 0.55 }); caps.push({ a: mid, b: end, ra: rr * 0.55, rb: rr * 0.42 });
      balls.push({ c: add(end, mul(down, rr * 0.25)), r: rr * 0.8 });
    }
  }
  // pustules on the surfaces round where it sticks: boils half sunk into the part
  for (const a of A) {
    const n = norm(a.n); let x = cross(n, [0, 0, 1]); if (len(x) < 1e-6) x = cross(n, [1, 0, 0]); x = norm(x); const y = cross(n, x);
    if (a.surf) {                                                    // spots found on the part's own surface (by the page)
      for (const sp of a.surf) { const pr = R * (0.3 + r() * 0.5) * psz, sn = norm(sp.n); balls.push({ c: add(sp.p, mul(sn, -pr * 0.45)), r: pr }); }
      continue;
    }
    const ns = Math.round((p.pustSurf ?? 0) * (0.6 + r() * 0.8));
    for (let k = 0; k < ns; k++) {
      const ang = r() * 2 * Math.PI, rr = Math.max(R * 1.2, p.splat) * (0.5 + r() * 1.1), pr = R * (0.3 + r() * 0.5) * psz;
      balls.push({ c: add(add(a.p, add(mul(x, Math.cos(ang) * rr), mul(y, Math.sin(ang) * rr))), mul(n, -pr * 0.45)), r: pr });
    }
  }
  // webbing: thin sheets of goo, holed in places
  const web = Math.min(1, Math.max(0, p.web ?? 0.5)), th = Math.max(0.05, p.webTh ?? 0.4), holes = Math.min(0.95, Math.max(0, p.webHoles ?? 0.3));
  const patch = (nu, nv, P) => { const tris = []; for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = P(i / nu, j / nv), b = P((i + 1) / nu, j / nv), c = P((i + 1) / nu, (j + 1) / nv), d = P(i / nu, (j + 1) / nv); tris.push([a, b, c], [a, c, d]); } return tris; };
  const lerp = (a, b, t) => add(a, mul(sub(b, a), t)), at = (pts, f) => { const x = Math.max(0, Math.min(1, f)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(x)); return lerp(pts[i].q, pts[i + 1].q, x - i); };
  if (web > 0 && p.webJoint) for (let i = 1; i < spans.length; i++) {             // in the crook where it turns at a spot
    const P = spans[i - 1].pts, Q = spans[i].pts, F = 0.85 * web;
    webs.push(patch(8, 6, (u, f) => { const fm = F * (1 - 0.4 * Math.sin(Math.PI * u)) * f; return lerp(at(P, 1 - fm), at(Q, fm), u); }));
  }
  if (web > 0 && p.webStrand) for (const sp of spans) {                            // between twisted strands, in patches
    const S = sp.strands.length; if (S < 2) continue;
    for (let s = 0; s < (S === 2 ? 1 : S); s++) {
      const A1 = sp.strands[s], B1 = sp.strands[(s + 1) % S], mask = noise1(r, 12), runs = [];
      let st = -1; for (let k = 0; k < A1.length; k++) { const on = (mask(k / (A1.length - 1)) + 1) / 2 > 1 - web && k > 1 && k < A1.length - 2; if (on && st < 0) st = k; if ((!on || k === A1.length - 1) && st >= 0) { if (k - st > 2) runs.push([st, k]); st = -1; } }
      for (const [k0, k1] of runs) webs.push(patch(k1 - k0, 3, (t, u) => { const k = k0 + t * (k1 - k0), i = Math.min(k1 - 1, Math.floor(k)), f = k - i;
        return lerp(lerp(A1[i].q, A1[i + 1].q, f), lerp(B1[i].q, B1[i + 1].q, f), u); }));
    }
  }
  if (web > 0 && p.webSurf) for (const sp of spans) for (const [end, a, n] of [[0, sp.a, sp.n0], [1, sp.b, sp.n1]]) {   // down to the surface it leaves
    const F = 0.75 * web, nn = norm(n);
    webs.push(patch(8, 5, (t, u) => { const f = F * t * (1 - 0.45 * u), C = at(sp.pts, end ? 1 - f : f), Pp = sub(C, mul(nn, dot(sub(C, a.p), nn) + R * 0.2)); return lerp(C, Pp, u); }));
  }
  // threads: thin strings of slime stretched across, taut but sagging a little, blobbed where they stick and beaded
  const nth = Math.max(0, p.threads | 0), tR = Math.max((p.threadTh ?? 0.25) / 2, (p.detail || 0.15) * 0.9);
  if (nth && spans.length) {
    const any = () => { const sp = spans[Math.floor(r() * spans.length)], S = sp.strands, str = S[Math.floor(r() * S.length)]; return { sp, pts: str }; };
    const surfAt = sp => { const end = r() < 0.5, a = end ? sp.b : sp.a, n = norm(end ? sp.n1 : sp.n0); let x = cross(n, [0, 0, 1]); if (len(x) < 1e-6) x = cross(n, [1, 0, 0]); x = norm(x); const y = cross(n, x), ang = r() * 6.283, rr = Math.max(R * 1.1, p.splat) * (0.2 + r() * 0.6);           // within the splat, so it's stuck on
      return add(add(a.p, add(mul(x, Math.cos(ang) * rr), mul(y, Math.sin(ang) * rr))), mul(n, -tR)); };
    for (let k = 0; k < nth * spans.length; k++) {
      const A1 = any(), t1 = 0.12 + r() * 0.76, P1 = at(A1.pts, t1);
      let P2, kind = r();
      if (spans.length > 1 && kind < 0.35) { let B; do B = any(); while (B.sp === A1.sp && spans.length > 1); P2 = at(B.pts, 0.12 + r() * 0.76); }   // across to another span
      else if (kind < 0.7) { const t2 = Math.min(0.95, Math.max(0.05, t1 + (r() < 0.5 ? -1 : 1) * (0.15 + r() * 0.35))); P2 = at(A1.sp.strands[Math.floor(r() * A1.sp.strands.length)], t2); }   // a chord along it
      else P2 = surfAt(A1.sp);                                                   // down to the surface
      const L = len(sub(P2, P1)); if (L < R * 2) continue;
      const m = 10, sagT = L * (0.04 + r() * 0.1), q = [];
      for (let i = 0; i <= m; i++) { const t = i / m; q.push(add(lerp(P1, P2, t), mul(down, sagT * 4 * t * (1 - t)))); }
      for (let i = 0; i < m; i++) { const t0 = i / m, t1b = (i + 1) / m, rr = t => tR * (1 + 1.6 * Math.max(0, 1 - Math.min(t, 1 - t) * 6) ** 2); caps.push({ a: q[i], b: q[i + 1], ra: rr(t0), rb: rr(t1b) }); }
      const nb = Math.floor(r() * 3); for (let b = 0; b < nb; b++) { const t = 0.2 + r() * 0.6; balls.push({ c: add(lerp(P1, P2, t), mul(down, sagT * 4 * t * (1 - t))), r: tR * (1.6 + r() * 1.2) }); }
    }
  }
  return { caps, balls, splats, webs, R, th, holes, net: p.webStyle === 'net', cell: Math.max(0.3, p.cell ?? 1.5) };
}

/** p as for elements, plus detail (mm, the mesh's edge length)  →  { positions } */
export function buildOoze(M, p) {
  const { caps, balls, splats, webs, R, th: th0, holes, net, cell } = elements(p);
  const k = R * 0.35;                                              // how softly the pieces melt into each other
  const items = [];
  for (const c of caps) items.push({ kind: 0, c, lo: [0, 1, 2].map(i => Math.min(c.a[i] - c.ra, c.b[i] - c.rb)), hi: [0, 1, 2].map(i => Math.max(c.a[i] + c.ra, c.b[i] + c.rb)) });
  for (const b of balls) items.push({ kind: 1, c: b, lo: b.c.map(x => x - b.r), hi: b.c.map(x => x + b.r) });
  for (const s of splats) { const e = Math.max(s.rt, s.rn); items.push({ kind: 2, c: s, lo: s.c.map(x => x - e), hi: s.c.map(x => x + e) }); }
  // webbing triangles: each sheet counts as one piece (its nearest triangle), so it doesn't thicken where they meet
  webs.forEach((tris, w) => { for (const [a, b, c] of tris) items.push({ kind: 3, w, a, b, c, lo: [0, 1, 2].map(i => Math.min(a[i], b[i], c[i])), hi: [0, 1, 2].map(i => Math.max(a[i], b[i], c[i])) }); });
  if (!items.length) throw new Error('click at least two spots to string it between');
  const pad = k * 4;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const it of items) for (let i = 0; i < 3; i++) { if (it.lo[i] < lo[i]) lo[i] = it.lo[i]; if (it.hi[i] > hi[i]) hi[i] = it.hi[i]; }
  for (let i = 0; i < 3; i++) { lo[i] -= pad; hi[i] += pad; }
  // the pieces near each spot: a coarse grid of buckets
  const C = Math.max(R * 3, 0.5), dims = [0, 1, 2].map(i => Math.max(1, Math.ceil((hi[i] - lo[i]) / C))), cells = new Map();
  const ci = (x, i) => Math.min(dims[i] - 1, Math.max(0, Math.floor((x - lo[i]) / C)));
  for (const it of items) {
    const a = [0, 1, 2].map(i => ci(it.lo[i] - pad, i)), b = [0, 1, 2].map(i => ci(it.hi[i] + pad, i));
    for (let x = a[0]; x <= b[0]; x++) for (let y = a[1]; y <= b[1]; y++) for (let z = a[2]; z <= b[2]; z++) { const key = (x * dims[1] + y) * dims[2] + z; (cells.get(key) || cells.set(key, []).get(key)).push(it); }
  }
  const dist = (it, q) => {
    if (it.kind === 0) {                                           // a tapered tube
      const { a, b, ra, rb } = it.c, ab = sub(b, a), L2 = dot(ab, ab), t = L2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / L2)) : 0;
      return len(sub(q, add(a, mul(ab, t)))) - (ra + (rb - ra) * t);
    }
    if (it.kind === 1) return len(sub(q, it.c.c)) - it.c.r;
    const s = it.c, d = sub(q, s.c), qn = dot(d, s.n), qt = Math.sqrt(Math.max(0, dot(d, d) - qn * qn));
    const k0 = Math.hypot(qt / s.rt, qn / s.rn), k1 = Math.hypot(qt / (s.rt * s.rt), qn / (s.rn * s.rn));    // a squashed ball (a good distance estimate)
    return k1 > 1e-12 ? k0 * (k0 - 1) / k1 : -Math.min(s.rt, s.rn);
  };
  const wBest = new Float64Array(webs.length).fill(Infinity), wSeen = [];
  const hs = Math.max(R * 2.5, 0.6), hn = (x, y, z) => {           // 3D value noise for the holes in the webbing
    const h = (i, j, l) => { let v = (i * 374761393 + j * 668265263 + l * 1442695041 + (p.seed | 0) * 2147483647) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(h(ix, iy, iz), h(ix + 1, iy, iz), sx), L(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), sx), sy), L(L(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), sx), L(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), sx), sy), sz);
  };
  const field = q => {
    const list = cells.get((ci(q[0], 0) * dims[1] + ci(q[1], 1)) * dims[2] + ci(q[2], 2)); if (!list) return -pad;
    let sum = 0, best = Infinity;
    for (const it of list) {
      if (it.kind === 3) { const d = triDist(q, it.a, it.b, it.c); if (d < wBest[it.w]) { if (wBest[it.w] === Infinity) wSeen.push(it.w); wBest[it.w] = d; } continue; }
      const d = dist(it, q); if (d < best) best = d; if (d < pad) sum += Math.exp(-d / k);
    }
    if (wSeen.length) {
      let half;
      if (net) {                                                    // a net: cells, some open, ringed by thick rims
        const { e, open } = worley(q[0] / cell, q[1] / cell, q[2] / cell), rimF = Math.exp(-((e / 0.09) ** 2));
        half = open ? rimT * rimF / 2 - (1 - rimF) * edge : (th + (rimT - th) * rimF) / 2;
      } else { let hole = 0; if (holes > 0) { const n = hn(q[0] / hs, q[1] / hs, q[2] / hs); hole = Math.max(0, n - (1 - holes)) / Math.max(holes, 1e-3); } half = th / 2 - hole * th * 2; }
      for (const w of wSeen) { const d = wBest[w] - half; wBest[w] = Infinity; if (d < best) best = d; if (d < pad) sum += Math.exp(-d / k); }
      wSeen.length = 0;
    }
    return sum > 0 ? k * Math.log(sum) : -best;                    // positive inside: −(smooth minimum of the distances)
  };
  const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
  let edge = Math.max(p.detail || 0.15, Math.cbrt(vol / 4e6), R / 6);
  // webbing thinner than the mesh can catch would vanish: thicken it to what this detail can show
  var th = th0; if (webs.length && th < edge * 1.7) th = edge * 1.7;
  var rimT = Math.max(th * 2.2, edge * 3);                         // a net's rims
  // Worley (cell) noise: how near a cell wall (e: 0 on it) and whether this cell is one of the open ones
  var worley = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z); let f1 = Infinity, f2 = Infinity, id = 0;
    const h = (i, j, l, s) => { let v = (i * 374761393 + j * 668265263 + l * 1442695041 + s * 974634851 + (p.seed | 0) * 2147483647) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const cx = ix + a, cy = iy + b, cz = iz + c, fx = cx + h(cx, cy, cz, 1), fy = cy + h(cx, cy, cz, 2), fz = cz + h(cx, cy, cz, 3), d = Math.hypot(fx - x, fy - y, fz - z);
      if (d < f1) { f2 = f1; f1 = d; id = h(cx, cy, cz, 4); } else if (d < f2) f2 = d;
    }
    return { e: (f2 - f1) / 2, open: id < holes };
  };
  const m0 = M.Manifold.levelSet(field, { min: lo, max: hi }, edge, 0);
  // crumbs (a scrap of a web's rim cut off at its edge, say) are dropped: only pieces of real size are kept
  const bits = m0.decompose(), big = Math.max(...bits.map(b => b.volume())), keepBits = bits.filter(b => b.volume() >= big * 0.01);
  const m = keepBits.length === bits.length ? m0 : M.Manifold.compose(keepBits);
  if (m !== m0) m0.delete(); bits.forEach(b => { if (b !== m) b.delete(); });
  try {
    const mesh = m.getMesh(), V = mesh.vertProperties, np = mesh.numProp, T = mesh.triVerts, out = new Float32Array(T.length * 3);
    for (let i = 0; i < T.length; i++) { const o = T[i] * np; out[3 * i] = V[o]; out[3 * i + 1] = V[o + 1]; out[3 * i + 2] = V[o + 2]; }
    // tidied as a closed solid: thin necks and webs leave a few pinched spots and specks straight off the level set
    const clean = mergeSolid(M, [out], { fillHollows: false, loose: 'drop' });
    return { positions: clean.positions.length ? clean.positions : out, edge, webTh: webs.length ? th : null };
  } finally { m.delete(); }
}

/** Distance from q to triangle abc. */
function triDist(q, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(q, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
  const near = x => len(sub(q, x));
  if (d1 <= 0 && d2 <= 0) return near(a);
  const bp = sub(q, b), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return near(b);
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) return near(add(a, mul(ab, d1 / (d1 - d3))));
  const cp = sub(q, c), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return near(c);
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) return near(add(a, mul(ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return near(add(b, mul(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))));
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; return near(add(a, add(mul(ab, v), mul(ac, w))));
}
