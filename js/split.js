// Split: a part cut in two along a rough surface, the break styled as a melted lance cut, a tear, a snap or a clean
// cut. No AI: the break is a plane pushed in and out by seeded noise of the chosen kind, and Manifold cuts the part
// with it. Runs in the worker. Everything is in the cut's own frame: the cut through the origin, z its normal
// (side A below, side B above), x along the cut as you saw it.
import { mergeSolid, weld } from './solid.js';

// ---- seeded noise
function hash(ix, iy, s) { let h = (ix * 374761393 + iy * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const fade = t => t * t * (3 - 2 * t);
function vnoise(x, y, s) {                                       // smooth value noise, 0..1
  const ix = Math.floor(x), iy = Math.floor(y), fx = fade(x - ix), fy = fade(y - iy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, s, oct = 4) { let v = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { v += a * vnoise(x * f, y * f, s + o * 101); n += a; a *= 0.5; f *= 2.03; } return v / n; }
function ridged(x, y, s, oct = 4) { let v = 0, a = 0.5, f = 1, n = 0; for (let o = 0; o < oct; o++) { const r = 1 - Math.abs(2 * vnoise(x * f, y * f, s + o * 131) - 1); v += a * r * r; n += a; a *= 0.55; f *= 2.1; } return v / n; }
/** Faceted: random heights on a coarse triangle lattice, flat between, like a brittle snap. */
function facets(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, h = (i, j) => hash(i, j, s) * 2 - 1;
  return fx + fy < 1 ? h(ix, iy) + (h(ix + 1, iy) - h(ix, iy)) * fx + (h(ix, iy + 1) - h(ix, iy)) * fy
    : h(ix + 1, iy + 1) + (h(ix, iy + 1) - h(ix + 1, iy + 1)) * (1 - fx) + (h(ix + 1, iy) - h(ix + 1, iy + 1)) * (1 - fy);
}

/** The break's height off the plane at (x, y), in mm, by style. */
function breakHeight(p) {
  const A = p.amp, S = Math.max(0.05, p.size), s = p.seed | 0;
  switch (p.style) {
    case 'lance':                                                 // a wavering burn line, with drag lines across it
      return (x, y) => A * 0.6 * (fbm(x / (3 * S), y / (3 * S), s, 3) - 0.5) * 2 + A * 0.12 * Math.sin(2 * Math.PI * y / (0.45 * S) + 3 * fbm(x / S, y / S, s + 7, 2));
    case 'torn':                                                  // ragged: sharp ridges and teeth at every scale
      return (x, y) => A * ((ridged(x / S, y / (0.6 * S), s, 5) - 0.45) * 2.2 + 0.5 * (fbm(x / (4 * S), y / (4 * S), s + 3, 2) - 0.5));
    case 'snapped':                                               // a few broad flat facets, splintered at the edges
      return (x, y) => A * (1.25 * facets(x / (1.1 * S), y / (1.1 * S), s) + 0.4 * facets(x / (0.4 * S), y / (0.4 * S), s + 9) + 0.2 * (ridged(x / (0.25 * S), y / (0.25 * S), s + 5, 2) - 0.5));
    default: return () => 0;
  }
}

/** The solid below the break surface z = h(x, y), over a box: fine squares where the part crosses, coarse beyond. */
function halfSpace(M, h, us, vs, zBot) {
  const nu = us.length, nv = vs.length, top = (i, j) => j * nu + i, bot = (i, j) => nu * nv + j * nu + i;
  const vert = new Float32Array(2 * nu * nv * 3);
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const t = 3 * top(i, j), b = 3 * bot(i, j);
    vert[t] = vert[b] = us[i]; vert[t + 1] = vert[b + 1] = vs[j]; vert[t + 2] = h(i, j); vert[b + 2] = zBot;
  }
  const tri = [];
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = top(i, j), b = top(i + 1, j), c = top(i + 1, j + 1), d = top(i, j + 1);
    tri.push(a, b, c, a, c, d);
    const A = bot(i, j), B = bot(i + 1, j), C = bot(i + 1, j + 1), D = bot(i, j + 1);
    tri.push(A, C, B, A, D, C);
  }
  const wall = (p, q) => { tri.push(q, p, p + nu * nv, q, p + nu * nv, q + nu * nv); };   // top edge p→q, down to the bottom
  for (let i = 0; i < nu - 1; i++) { wall(top(i, 0), top(i + 1, 0)); wall(top(i + 1, nv - 1), top(i, nv - 1)); }
  for (let j = 0; j < nv - 1; j++) { wall(top(nu - 1, j), top(nu - 1, j + 1)); wall(top(0, j + 1), top(0, j)); }
  const mesh = new M.Mesh({ numProp: 3, vertProperties: vert, triVerts: new Uint32Array(tri) });
  return new M.Manifold(mesh);
}

/**
 * p: { soup (the part, in the cut's frame), style ('clean'|'lance'|'torn'|'snapped'), amp (mm the break wanders),
 * size (mm, its features), kerf (mm cut away between the halves), gap (mm side B is pulled off along the normal),
 * keep ('both'|'a'|'b'), beads (slag along a lance cut), seed }  →  { positions, sides (per triangle: 0 A, 1 B) }
 */
export function buildSplit(M, p) {
  const { Manifold, Mesh } = M;
  const trash = [], keep = x => { trash.push(x); return x; };
  try {
    const clean = mergeSolid(M, [p.soup], { fillHollows: false, loose: 'drop' });
    if (!clean.positions.length) throw new Error("the part isn't a closed solid");
    const w0 = weld(clean.positions, 1e-6), mesh = new Mesh({ numProp: 3, vertProperties: w0.vert, triVerts: w0.tri }); mesh.merge();
    const part = keep(new Manifold(mesh));
    if (part.status && part.status() !== 'NoError') throw new Error("the part isn't a closed solid");
    // where the part crosses the cut (fine squares there), and how far it reaches (coarse beyond)
    const A = Math.max(0, p.amp), band = A * 1.6 + p.kerf + 0.5, bb = part.boundingBox();
    const [U0, V0, Z0] = bb.min, [U1, V1, Z1] = bb.max;
    if (Z0 > band || Z1 < -band) throw new Error('the cut misses the part: move it onto the part');
    const W = Math.max(U1 - U0, V1 - V0) + 10, slab = keep(part.intersect(keep(Manifold.cube([W * 2, W * 2, 2 * band]).translate([(U0 + U1) / 2 - W, (V0 + V1) / 2 - W, -band]))));
    if (slab.isEmpty()) throw new Error('the cut misses the part: move it onto the part');
    let [u0, v0] = slab.boundingBox().min, [u1, v1] = slab.boundingBox().max;
    u0 -= 1; u1 += 1; v0 -= 1; v1 += 1;                               // a little past where the part crosses
    const span = Math.max(u1 - u0, v1 - v0), cell = p.style === 'clean' ? span : Math.max(Math.min(0.12, p.size / 4), span / 360);
    const axis = (lo, hi, LO, HI) => { const out = [LO - 5]; for (let x = lo; x < hi; x += cell) out.push(x); out.push(hi, HI + 5); return out.filter((x, i, a) => i === 0 || x > a[i - 1] + 1e-6); };
    const us = axis(u0, u1, Math.min(U0, u0), Math.max(U1, u1)), vs = axis(v0, v1, Math.min(V0, v0), Math.max(V1, v1));
    const hf = breakHeight(p), taper = (x, y) => {           // the break dies away outside where the part crosses
      const dx = Math.max(0, u0 - x, x - u1), dy = Math.max(0, v0 - y, y - v1); return Math.max(0, 1 - Math.hypot(dx, dy) / 1);
    };
    const H = keep(halfSpace(M, (i, j) => hf(us[i], vs[j]) * taper(us[i], vs[j]), us, vs, Math.min(Z0, -band) - 5));
    if (H.status && H.status() !== 'NoError') throw new Error('the break surface came out broken');
    const kerf = Math.max(p.keep === 'both' ? 0.02 : 0, p.kerf);            // two halves never quite touch (or the export would fuse them)
    let a = keep(part.intersect(H)), b = keep(part.subtract(keep(H.translate([0, 0, kerf]))));
    // a lance leaves slag: beads of melted metal along the edges of the cut
    if (p.style === 'lance' && p.beads) {
      const r0 = Math.max(0.08, Math.min(0.6, p.size * 0.18)), rnd = (() => { let s = (p.seed * 9301 + 49297) >>> 0; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); })();
      const beadOn = (piece, off) => {
        const ms = piece.getMesh(), V = ms.vertProperties, np = ms.numProp, T = ms.triVerts, onCut = new Uint8Array(V.length / np), used = new Uint8Array(V.length / np);
        for (let i = 0; i < V.length / np; i++) { const x = V[i * np], y = V[i * np + 1], z = V[i * np + 2]; onCut[i] = Math.abs(z - (hf(x, y) * taper(x, y) + off)) < 1e-4 ? 1 : 0; }
        // corners where the cut face meets the outside of the part
        for (let t = 0; t < T.length; t += 3) { const c = onCut[T[t]] && onCut[T[t + 1]] && onCut[T[t + 2]]; for (let e = 0; e < 3; e++) used[T[t + e]] |= c ? 1 : 2; }
        const rim = []; for (let i = 0; i < used.length; i++) if (used[i] === 3) rim.push(i);
        if (!rim.length) return piece;
        const beads = [], want = Math.min(400, Math.round(rim.length * 0.12) + 4);
        for (let k = 0; k < want; k++) {
          const i = rim[Math.floor(rnd() * rim.length)], r = r0 * (0.4 + rnd() * 0.9);
          beads.push(Manifold.sphere(r, 10).scale([1, 1, 0.7]).translate([V[i * np] + (rnd() - 0.5) * r, V[i * np + 1] + (rnd() - 0.5) * r, V[i * np + 2] + (off > 0 ? r * 0.25 : -r * 0.25)]));
        }
        const u = Manifold.union([piece, ...beads]); beads.forEach(x => x.delete()); return keep(u);
      };
      a = beadOn(a, 0); b = beadOn(b, kerf);
    }
    if (p.gap) b = keep(b.translate([0, 0, p.gap]));
    const parts = (p.keep === 'a' ? [[a, 0]] : p.keep === 'b' ? [[b, 1]] : [[a, 0], [b, 1]]).filter(([x]) => !x.isEmpty());
    if (!parts.length) throw new Error('that side is empty: the cut misses the part');
    let n = 0; for (const [x] of parts) n += x.getMesh().triVerts.length;
    const positions = new Float32Array(n * 3), sides = new Uint8Array(n / 3); let o = 0, t = 0;
    for (const [x, side] of parts) {
      const ms = x.getMesh(), V = ms.vertProperties, np = ms.numProp, T = ms.triVerts;
      for (let i = 0; i < T.length; i++) { const q = T[i] * np; positions[o++] = V[q]; positions[o++] = V[q + 1]; positions[o++] = V[q + 2]; }
      sides.fill(side, t, t + T.length / 3); t += T.length / 3;
    }
    return { positions, sides };
  } finally { trash.forEach(x => { try { x.delete(); } catch (e) {} }); }
}
