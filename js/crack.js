// Crack & cave in: a part made to look punched in. No AI: a crack pattern is drawn in 2D round the spot that was hit
// (rings round it, cracks running out from it, jagged), the part is cut along it into slabs, and each slab is tipped and
// pushed in as a whole, deepest in the middle, like a broken sidewalk. Runs in the worker, with Manifold.
//
// Everything is in the hit's own frame: the spot at the origin, z straight out of the surface (material below z = 0).
import { mergeSolid, weld } from './solid.js';

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * The crack pattern, in mm: rings (closed jagged loops) and lines (open jagged polylines, each with a width at each
 * point so the long ones can taper). Also the hole's outline, when it's punched right through.
 */
function pattern(p) {
  const r = rng(p.seed), R = p.radius, jag = p.jag, n = Math.max(1, p.rings | 0), core = R * p.core;
  const band = (R - core) / n;
  const loop = rho => {                                       // a jagged ring: a few long straight-ish runs, kinked, wandering in and out
    const k = Math.max(7, Math.round(2 * Math.PI * rho / Math.max(0.5, rho * 0.5))), ph = r() * 6.283, pts = [];
    const amp = Math.min(rho * 0.14, band * 0.32) * jag, f1 = 2 + Math.floor(r() * 3), a1 = r() * 6.28;
    for (let i = 0; i < k; i++) {
      const a = ph + (i + (r() - 0.5) * 0.7 * jag) * 2 * Math.PI / k;
      const rr = rho + amp * (0.6 * Math.sin(f1 * a + a1) + 0.8 * (r() - 0.5));
      pts.push([rr * Math.cos(a), rr * Math.sin(a)]);
    }
    return pts;
  };
  const line = (a, r0, r1, kinks) => {                        // a crack running outward from r0 to r1, wandering a little
    const pts = [], m = Math.max(1, kinks);
    for (let i = 0; i <= m; i++) { const t = i / m, rr = r0 + (r1 - r0) * t, aa = a + (i && i < m ? (r() - 0.5) * 0.35 * jag : 0) * Math.min(1, 1.5 / Math.max(rr, 0.5)) * 2; pts.push([rr * Math.cos(aa), rr * Math.sin(aa)]); }
    return pts;
  };
  // rings: the core's edge (if there is a core), then evenly out to the rim
  const radii = []; for (let k = 1; k <= n; k++) radii.push(core + (R - core) * k / n + (k < n ? (r() - 0.5) * 0.25 * (R - core) / n * jag : 0));
  const ringRadii = core > 0.05 ? [core, ...radii] : radii;
  const rings = ringRadii.map(loop);
  const outer = rings[rings.length - 1];
  // cracks out from the middle: a main set running through every band, and more added in each band outward
  const lines = [];
  const nm = Math.max(2, p.cracks | 0), turn0 = r() * 2 * Math.PI;
  const main = Array.from({ length: nm }, (_, i) => turn0 + (i + (r() - 0.5) * 0.6 * jag) * 2 * Math.PI / nm);
  const inner0 = core > 0.05 ? core * 0.9 : 0;
  for (let b = 0; b < radii.length; b++) {
    const lo = b === 0 ? inner0 : radii[b - 1] * 0.97, hi = radii[b] * 1.03;
    const extra = b === 0 ? 0 : Math.round(main.length * (0.6 + 0.3 * b) * (0.6 + 0.8 * r()));
    const as = main.map(a => a + (r() - 0.5) * 0.25 * jag);
    for (let e = 0; e < extra; e++) as.push(r() * 2 * Math.PI);
    for (const a of as) lines.push({ pts: line(a, lo, hi, 2 + Math.round((hi - lo) / 1.2)), w: [1, 1] });
  }
  // spider cracks: past the rim, fading out
  const spiders = [];
  if (p.spider > 0) for (const a0 of main) {
    if (r() < 0.25) continue;
    const len = R * p.spider * (0.5 + r() * 0.7), a = a0 + (r() - 0.5) * 0.3 * jag;
    spiders.push({ pts: line(a, R * 0.98, R + len, 3 + Math.round(len / 1.0)), w: [1, 0.15] });
    const par = spiders[spiders.length - 1].pts;
    if (r() < 0.5 * jag && par.length > 3) {                    // a branch, off part way along it
      const i0 = 1 + Math.floor(r() * (par.length - 3)), [sx, sy] = par[i0], b = Math.atan2(sy, sx) + (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.4), l2 = len * (0.3 + r() * 0.3), m = 3, pts = [[sx, sy]];
      for (let k = 1; k <= m; k++) { const bb = b + (r() - 0.5) * 0.5 * jag; pts.push([sx + Math.cos(bb) * l2 * k / m, sy + Math.sin(bb) * l2 * k / m]); }
      spiders.push({ pts, w: [0.6, 0.1] });
    }
  }
  return { rings, outer, lines, spiders, core: core > 0.05 ? rings[0] : null };
}

/** A polyline as a strip of the given half-width (tapering from w[0] to w[1] along it), with rounded joints. */
function strip(CS, pts, hw, closed = false, w = [1, 1]) {
  const parts = [], n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], t0 = i / segs, t1 = (i + 1) / segs;
    const h0 = hw * (w[0] + (w[1] - w[0]) * t0), h1 = hw * (w[0] + (w[1] - w[0]) * t1);
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1e-9) continue;
    const nx = -dy / L, ny = dx / L;
    parts.push(new CS([[[a[0] + nx * h0, a[1] + ny * h0], [a[0] - nx * h0, a[1] - ny * h0], [b[0] - nx * h1, b[1] - ny * h1], [b[0] + nx * h1, b[1] + ny * h1]]], 'Positive'));
    const j = h1; if (j > 1e-4) parts.push(CS.circle(j, 8).translate(b));
    if (i === 0 && h0 > 1e-4) parts.push(CS.circle(h0, 8).translate(a));
  }
  const u = CS.union(parts); parts.forEach(x => x.delete()); return u;
}

/** Distance from a point to a polygon set (0 inside). */
function polyDist(polys, x, y) {
  let inside = false, best = Infinity;
  for (const pl of polys) for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
    const [ax, ay] = pl[j], [bx, by] = pl[i];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y); if (d < best) best = d;
  }
  return inside ? 0 : best;
}

/** 4×4 column-major: about pivot c, turn by quaternion q, then move by t. */
function rigid(c, q, t) {
  const [x, y, z, w] = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  const R = [1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy)];
  const ap = v => [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]];
  const rc = ap(c), tr = [c[0] - rc[0] + t[0], c[1] - rc[1] + t[1], c[2] - rc[2] + t[2]];
  return { m: [R[0], R[1], R[2], 0, R[3], R[4], R[5], 0, R[6], R[7], R[8], 0, tr[0], tr[1], tr[2], 1], ap: v => { const a = ap(v); return [a[0] + tr[0], a[1] + tr[1], a[2] + tr[2]]; } };
}
function quatFromTo(a, b) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; let c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const w = 1 + d; if (w < 1e-8) return [1, 0, 0, 0];
  const L = Math.hypot(c[0], c[1], c[2], w); return [c[0] / L, c[1] / L, c[2] / L, w / L];
}
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qaxis = (ax, ang) => { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; };

const soupOf = m => { const mesh = m.getMesh(), P = mesh.vertProperties, np = mesh.numProp, T = mesh.triVerts, out = new Float32Array(T.length * 3);
  for (let i = 0; i < T.length; i++) { const o = T[i] * np; out[3 * i] = P[o]; out[3 * i + 1] = P[o + 1]; out[3 * i + 2] = P[o + 2]; } return out; };

/**
 * p: { soup (the part, in the hit's frame), radius, depth (how far the middle caves in), rings, cracks, width (crack
 * gap), jag (0..1), tumble (° each slab is knocked off true at random), thick (the part's thickness there), skin (mm
 * left whole at the back so it holds together; Infinity-free: through = break right through), through, hole, core
 * (the middle's size, a fraction of the radius), spider (cracks running on past the rim, a fraction of the radius),
 * seed }  →  { positions (in the same frame), slabs, loose }
 */
export function buildCrack(M, p) {
  const { Manifold, Mesh, CrossSection: CS } = M;
  const trash = []; const keep = x => { trash.push(x); return x; };
  try {
    // the part as one clean solid
    const clean = mergeSolid(M, [p.soup], { fillHollows: false, loose: 'drop' });
    if (!clean.positions.length) throw new Error("the part isn't a closed solid");
    const w0 = weld(clean.positions, 1e-6), mesh = new Mesh({ numProp: 3, vertProperties: w0.vert, triVerts: w0.tri }); mesh.merge();
    const part = keep(new Manifold(mesh));
    if (part.status && part.status() !== 'NoError') throw new Error("the part isn't a closed solid");

    const R = p.radius, hw = p.width / 2, pat = pattern(p);
    const zlo = -(p.thick + 0.6 * R + 0.5), zhi = 0.6 * R + 2, prism = cs => keep(cs.extrude(zhi - zlo).translate([0, 0, zlo]));
    // 2D: the slabs (the area inside the rim, less the cracks), the cracks, and everything the effect covers
    const outerPoly = keep(new CS([pat.outer], 'Positive'));
    const crackParts = [...pat.rings.map(l => strip(CS, l, hw, true)), ...pat.lines.map(l => strip(CS, l.pts, hw, false, l.w))];
    const cracks = keep(CS.union(crackParts)); crackParts.forEach(x => x.delete());
    const foot = keep(outerPoly.offset(hw, 'Round', 2, 8).add(cracks.intersect(keep(outerPoly.offset(hw, 'Round', 2, 8)))));
    let slabsCS = keep(outerPoly.subtract(cracks));
    let hole = null;
    if (p.hole && pat.core) { hole = keep(new CS([pat.core], 'Positive')); slabsCS = keep(slabsCS.subtract(hole)); }
    let gaps = keep(foot.subtract(slabsCS)); if (hole) gaps = keep(gaps.subtract(hole));
    const slabs = slabsCS.decompose().filter(s => { if (s.area() < 0.02 * p.width * R) { s.delete(); return false; } return true; });
    slabs.forEach(keep);

    // 3D: what's left round about, the slabs, and (holding it together) the back of the cracks
    let body = keep(part.subtract(prism(foot)));
    const depthCut = p.through ? Infinity : Math.max(0.05, p.thick - p.skin);
    const topLayer = depthCut === Infinity ? null : keep(part.subtract(keep(part.translate([0, 0, -depthCut]))));
    if (pat.spiders.length && topLayer) {
      const sp = pat.spiders.map(l => strip(CS, l.pts, hw * 0.8, false, l.w)), spc = keep(CS.union(sp)); sp.forEach(x => x.delete());
      body = keep(body.subtract(keep(prism(keep(spc.subtract(foot))).intersect(topLayer))));
    }
    const pieces = [body];

    // each slab tipped toward the middle and pushed in, as the dish of the dent would have it, then knocked a little
    const r = rng(p.seed ^ 0x9e3779b9), motions = [];
    const D = rr => p.depth * Math.max(0, 1 - (rr / R) ** 2), slope = rr => 2 * p.depth * rr / (R * R);
    let n = 0;
    for (const s of slabs) {
      const piece = keep(part.intersect(prism(s))); if (piece.isEmpty()) continue;
      const polys = s.toPolygons(), bb = s.bounds(), c2 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2];
      // the slab's middle by area
      let ax = 0, ay = 0, aa = 0; for (const pl of polys) for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) { const cr = pl[j][0] * pl[i][1] - pl[i][0] * pl[j][1]; aa += cr; ax += (pl[j][0] + pl[i][0]) * cr; ay += (pl[j][1] + pl[i][1]) * cr; }
      const c = aa ? [ax / (3 * aa), ay / (3 * aa)] : c2, rr = Math.hypot(c[0], c[1]), u = rr > 1e-6 ? [c[0] / rr, c[1] / rr] : [1, 0];
      const pb = piece.boundingBox(), top = pb.max[2];
      const g = slope(rr), nrm = [-g * u[0], -g * u[1], 1], nl = Math.hypot(...nrm);
      let q = quatFromTo([0, 0, 1], nrm.map(v => v / nl));
      const tum = p.tumble * Math.PI / 180;
      if (tum > 0) { const a = r() * 2 * Math.PI; q = qmul(qaxis([Math.cos(a), Math.sin(a), 0], (r() * 2 - 1) * tum), q); q = qmul(qaxis([0, 0, 1], (r() * 2 - 1) * tum * 0.4), q); }
      const dd = D(rr) * (1 + (r() - 0.5) * 0.5 * p.jag);
      const T = rigid([c[0], c[1], top], q, [0, 0, -dd]);
      pieces.push(keep(piece.transform(T.m)));
      motions.push({ polys, bb: [bb.min[0], bb.min[1], bb.max[0], bb.max[1]], T }); n++;
    }

    // the back of the cracks: stretched between the slabs on either side (and the part round about), so it all stays one
    if (topLayer) {
      let g = keep(part.intersect(prism(gaps)).subtract(topLayer));
      if (!g.isEmpty()) {
        g = keep(g.refineToLength(Math.max(0.05, Math.min(p.width, 0.25))));
        const near = hw * 3 + 0.05;
        g = keep(g.warp(v => {
          const [x, y] = v; const cand = [];
          for (const m of motions) { if (x < m.bb[0] - near || x > m.bb[2] + near || y < m.bb[1] - near || y > m.bb[3] + near) continue; cand.push([polyDist(m.polys, x, y), m.T]); }
          // the part round about starts half a crack past the rim
          const dl = distToLoop(pat.outer, x, y), inRim = polyDist([pat.outer], x, y) === 0;
          cand.push([inRim ? hw + dl : Math.max(0, hw - dl), null]);
          cand.sort((a, b) => a[0] - b[0]);
          const use = cand.slice(0, 3);
          if (use[0][0] < 1e-6) { if (use[0][1]) { const o = use[0][1].ap(v); v[0] = o[0]; v[1] = o[1]; v[2] = o[2]; } return; }
          let sw = 0, sx = 0, sy = 0, sz = 0;
          for (const [d, T] of use) { const wgt = 1 / (d * d + 1e-10), o = T ? T.ap(v) : v; sw += wgt; sx += wgt * o[0]; sy += wgt * o[1]; sz += wgt * o[2]; }
          v[0] = sx / sw; v[1] = sy / sw; v[2] = sz / sw;
        }));
        pieces.push(g);
      }
    }
    // all of it back together as one solid (pieces that only touch are fused)
    const out = mergeSolid(M, pieces.map(soupOf), { fillHollows: false, loose: 'keep' });
    return { positions: out.positions, slabs: n, shells: out.shells };
  } finally { trash.forEach(x => { try { x.delete(); } catch (e) {} }); }
}

function distToLoop(pl, x, y) {
  let best = Infinity;
  for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
    const [ax, ay] = pl[j], [bx, by] = pl[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
    const d = Math.hypot(ax + t * dx - x, ay + t * dy - y); if (d < best) best = d;
  }
  return best;
}
