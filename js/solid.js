// Kitbash Bench · solid merge: turn a pile of overlapping parts into one clean, closed shell for printing.
// Every closed shell is unioned with Manifold (exact booleans), so no surface is left inside the model; sealed hollows
// can be filled too. Plain number crunching, no page code: the Manifold module is handed in.

/** Weld a triangle soup (xyz per corner) into an indexed mesh. tol: vertices closer than this become one. */
export function weld(pos, tol = 1e-4) {
  const n = pos.length / 3, idx = new Uint32Array(n), map = new Map(), out = [];
  const q = 1 / tol;
  for (let i = 0; i < n; i++) {
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    const k = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
    let v = map.get(k);
    if (v === undefined) { v = out.length / 3; map.set(k, v); out.push(x, y, z); }
    idx[i] = v;
  }
  // drop triangles that collapsed
  const tris = [];
  for (let t = 0; t < n / 3; t++) { const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2]; if (a !== b && b !== c && a !== c) tris.push(a, b, c); }
  return { vert: new Float32Array(out), tri: new Uint32Array(tris) };
}

/**
 * Split an indexed mesh into pieces joined by shared edges. Returns arrays of triangle numbers.
 * strict: keep separate shells apart where they happen to touch along an edge (two boxes meeting at a corner line).
 * An edge shared by more than two triangles is paired up running opposite ways, each with the nearest triangle in
 * file order: files list each shell's triangles together, so neighbours in the list are neighbours on the shell.
 */
export function shells(tri, nv, strict = false) {
  const nt = tri.length / 3, parent = new Int32Array(nt).map((_, i) => i);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const join = (x, y) => { const ra = find(x), rb = find(y); if (ra !== rb) parent[ra] = rb; };
  const edge = new Map();
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const a = tri[3 * t + e], b = tri[3 * t + (e + 1) % 3], k = a < b ? a * nv + b : b * nv + a;
    const o = edge.get(k);
    if (!strict) { if (o === undefined) edge.set(k, t); else join(o, t); }
    else { const d = a < b ? 1 : -1; if (o === undefined) edge.set(k, [t, d]); else o.push(t, d); }
  }
  if (strict) for (const ts of edge.values()) {
    if (ts.length === 4) { if (ts[1] !== ts[3]) join(ts[0], ts[2]); continue; }
    if (ts.length < 4) continue;
    const fw = [], bw = []; for (let i = 0; i < ts.length; i += 2) (ts[i + 1] > 0 ? fw : bw).push(ts[i]);
    const used = new Uint8Array(bw.length);
    for (const t of fw) {
      let best = -1, bd = Infinity; for (let j = 0; j < bw.length; j++) if (!used[j] && Math.abs(bw[j] - t) < bd) { bd = Math.abs(bw[j] - t); best = j; }
      if (best >= 0) { used[best] = 1; join(t, bw[best]); }
    }
  }
  const groups = new Map();
  for (let t = 0; t < nt; t++) { const r = find(t); let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(t); }
  return [...groups.values()];
}

/** Move every vertex out along its normal by d (angle-weighted normals of an outward-facing shell). */
function inflate(v, t, d) {
  if (!d) return v;
  const n = new Float32Array(v.length);
  for (let i = 0; i < t.length; i += 3) {
    const ia = 3 * t[i], ib = 3 * t[i + 1], ic = 3 * t[i + 2];
    const fx = (v[ib + 1] - v[ia + 1]) * (v[ic + 2] - v[ia + 2]) - (v[ib + 2] - v[ia + 2]) * (v[ic + 1] - v[ia + 1]);
    const fy = (v[ib + 2] - v[ia + 2]) * (v[ic] - v[ia]) - (v[ib] - v[ia]) * (v[ic + 2] - v[ia + 2]);
    const fz = (v[ib] - v[ia]) * (v[ic + 1] - v[ia + 1]) - (v[ib + 1] - v[ia + 1]) * (v[ic] - v[ia]);
    const fl = Math.hypot(fx, fy, fz); if (!fl) continue;
    for (const [o, p, q] of [[ia, ib, ic], [ib, ic, ia], [ic, ia, ib]]) {          // the corner's angle weights the face's normal
      const ux = v[p] - v[o], uy = v[p + 1] - v[o + 1], uz = v[p + 2] - v[o + 2], wx = v[q] - v[o], wy = v[q + 1] - v[o + 1], wz = v[q + 2] - v[o + 2];
      const c = (ux * wx + uy * wy + uz * wz) / (Math.hypot(ux, uy, uz) * Math.hypot(wx, wy, wz) || 1), a = Math.acos(Math.max(-1, Math.min(1, c)));
      n[o] += fx / fl * a; n[o + 1] += fy / fl * a; n[o + 2] += fz / fl * a;
    }
  }
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; out[i] = v[i] + n[i] / l * d; out[i + 1] = v[i + 1] + n[i + 1] / l * d; out[i + 2] = v[i + 2] + n[i + 2] / l * d; }
  return out;
}
/** Signed volume of some triangles (positive when they face out). */
export function signedVolume(vert, tri, list) {
  let v = 0;
  for (const t of list) {
    const a = 3 * tri[3 * t], b = 3 * tri[3 * t + 1], c = 3 * tri[3 * t + 2];
    v += vert[a] * (vert[b + 1] * vert[c + 2] - vert[b + 2] * vert[c + 1]) - vert[a + 1] * (vert[b] * vert[c + 2] - vert[b + 2] * vert[c]) + vert[a + 2] * (vert[b] * vert[c + 1] - vert[b + 1] * vert[c]);
  }
  return v / 6;
}

/** Boundary edges of some triangles, as directed pairs [a, b] (edges used once). Also counts edges used more than twice. */
function openEdges(tri, list, nv) {
  const cnt = new Map();
  for (const t of list) for (let e = 0; e < 3; e++) {
    const a = tri[3 * t + e], b = tri[3 * t + (e + 1) % 3], k = a < b ? a * nv + b : b * nv + a;
    const o = cnt.get(k); if (o) { o.n++; } else cnt.set(k, { n: 1, a, b });
  }
  const open = []; let over = 0;
  for (const o of cnt.values()) { if (o.n === 1) open.push([o.a, o.b]); else if (o.n > 2) over++; }
  return { open, over };
}

/** Close simple holes: walk each boundary loop and fan it from its middle. Returns extra triangles (or null if the edges don't make loops). */
function capHoles(vert, open) {
  const next = new Map();
  for (const [a, b] of open) { if (next.has(b)) return null; next.set(b, a); }   // the cap runs the other way round
  const extra = [], newVerts = [], seen = new Set(); let nv = vert.length / 3;
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let v = start;
    while (!seen.has(v)) { seen.add(v); loop.push(v); v = next.get(v); if (v === undefined) return null; }
    if (v !== start) return null;
    if (loop.length === 3) { extra.push(loop[0], loop[1], loop[2]); continue; }
    let cx = 0, cy = 0, cz = 0; for (const i of loop) { cx += vert[3 * i]; cy += vert[3 * i + 1]; cz += vert[3 * i + 2]; }
    newVerts.push(cx / loop.length, cy / loop.length, cz / loop.length); const c = nv++;
    for (let i = 0; i < loop.length; i++) extra.push(loop[i], loop[(i + 1) % loop.length], c);
  }
  return { extra, newVerts };
}

/**
 * Merge triangle soups into one closed solid.
 * M: the initialised Manifold module. soups: Float32Array of xyz per corner (world space, mm), one or many.
 * opts.fillHollows: also fill hollows sealed inside the result. opts.subtract: closed solids to cut away (magnet holes).
 * opts.loose: 'keep' | 'connect' | 'drop' for loose bits (opts.looseGap, mm). opts.clean: smooth out hairline slivers. opts.extra: more soups (already closed solids) to add, e.g. pocket fillers.
 * Returns { positions: Float32Array (xyz per corner), shells, inputShells, repaired, unmerged (pieces with holes it couldn't close, passed through as
 * they were), specks (flecks of loose triangles, dropped), hollows / hollowVolume (filled), hollowsLeft /
 * hollowLeftVolume (sealed hollows still inside, when not filling), volume }.
 */
export function mergeSolid(M, soups, opts = {}) {
  const { Manifold, Mesh } = M;
  const pos = concat(Array.isArray(soups) ? soups : [soups]);
  const { vert, tri } = weld(pos, opts.tol ?? 1e-4), nv = vert.length / 3;
  const solids = [], turned = []; let loose = [];
  // pieces that only touch, face to face, would stay separate shells with a wall between them: every shell is grown by
  // a micron first so touching faces overlap and fuse (cleaned back up after the merge)
  const fuse = opts.fuse ?? 0.001; let inputShells = 0, repaired = 0;
  const toManifold = (v, t) => {
    const mesh = new Mesh({ numProp: 3, vertProperties: v, triVerts: t });
    mesh.merge();
    const m = new Manifold(mesh);
    if (m.status && m.status() !== 'NoError') { m.delete(); return null; }
    return m;
  };
  const tryShell = list => {
    // the shell's own vertices, renumbered
    const remap = new Map(), v = [], t = new Uint32Array(list.length * 3);
    list.forEach((tt, i) => { for (let e = 0; e < 3; e++) { const o = tri[3 * tt + e]; let r = remap.get(o); if (r === undefined) { r = v.length / 3; remap.set(o, r); v.push(vert[3 * o], vert[3 * o + 1], vert[3 * o + 2]); } t[3 * i + e] = r; } });
    let vv = new Float32Array(v), all = [...Array(list.length).keys()];
    const inward = signedVolume(vv, t, all) < 0;
    if (inward) for (let i = 0; i < t.length; i += 3) { const s = t[i + 1]; t[i + 1] = t[i + 2]; t[i + 2] = s; }   // inside out: turn it round
    let m = null;
    try { m = toManifold(inflate(vv, t, fuse), t); } catch (e) { m = null; }
    if (!m) {                                          // holes? cap them and try again
      const { open, over } = openEdges(t, all, vv.length / 3);
      const cap = !over && open.length ? capHoles(vv, open) : null;
      if (cap) {
        const v2 = new Float32Array(vv.length + cap.newVerts.length); v2.set(vv); v2.set(cap.newVerts, vv.length);
        const t2 = new Uint32Array(t.length + cap.extra.length); t2.set(t); t2.set(cap.extra, t.length);
        if (signedVolume(v2, t2, [...Array(t2.length / 3).keys()]) < 0) for (let i = 0; i < t2.length; i += 3) { const s = t2[i + 1]; t2[i + 1] = t2[i + 2]; t2[i + 2] = s; }
        try { m = toManifold(inflate(v2, t2, fuse), t2); } catch (e) { m = null; }
        if (m) repaired++;
      }
    }
    if (m && m.volume() > 1e-9) { (inward ? turned : solids).push(m); return true; }
    m?.delete(); return false;
  };
  // shells first as strictly separate pieces; the ones that won't close are tried again joined to whatever they touch
  const failed = [];
  for (const list of shells(tri, nv, true)) { if (list.length < 4 || !tryShell(list)) failed.push(...list); else inputShells++; }
  if (failed.length) {
    const sub = new Uint32Array(failed.length * 3); failed.forEach((t, i) => { sub[3 * i] = tri[3 * t]; sub[3 * i + 1] = tri[3 * t + 1]; sub[3 * i + 2] = tri[3 * t + 2]; });
    for (const l of shells(sub, nv)) { const list = l.map(i => failed[i]); inputShells++; if (list.length < 4 || !tryShell(list)) loose.push(list); }
  }
  for (const s of opts.extra || []) {
    const w = weld(s, opts.tol ?? 1e-4);
    try { const m = toManifold(w.vert, w.tri); if (m) solids.push(m); } catch (e) {}
  }
  let out = solids.length ? (solids.length === 1 ? solids[0] : Manifold.union(solids)) : null;
  if (solids.length > 1) solids.forEach(m => m.delete());
  // a shell facing inwards is either a part that's inside out (turned round, it joins the rest) or the wall of a
  // hollow inside another part: that stays hollow, unless hollows are being filled
  let hollowsIn = 0, hollowsInVol = 0;
  if (turned.length) {
    const cavities = [], parts = [];
    for (const m of turned) {
      let inside = 0; if (out) { const x = out.intersect(m); inside = x.volume(); x.delete(); }
      (inside > 0.5 * m.volume() ? cavities : parts).push(m);
    }
    if (parts.length) { const u = Manifold.union(out ? [out, ...parts] : parts); if (out) out.delete(); parts.forEach(m => m.delete()); out = u; }
    for (const c of cavities) {
      if (opts.fillHollows) { if (c.volume() >= 1e-3) { hollowsIn++; hollowsInVol += c.volume(); } }
      else { const d = out.subtract(c); out.delete(); out = d; }
      c.delete();
    }
  }
  // holes to cut (magnet sockets): closed solids taken away from the result
  let cut = 0;
  if (out && opts.subtract?.length) {
    const hs = [];
    for (const s of opts.subtract) { const w = weld(s, opts.tol ?? 1e-4); try { const m = toManifold(w.vert, w.tri); if (m) { if (m.volume() < 0) { m.delete(); continue; } hs.push(m); } } catch (e) {} }
    if (hs.length) { const h = hs.length === 1 ? hs[0] : Manifold.union(hs); if (hs.length > 1) hs.forEach(m => m.delete()); const d = out.subtract(h); out.delete(); h.delete(); out = d; cut = hs.length; }
  }
  // hairline slivers where faces of different pieces nearly lined up: smoothed out within 5 µm, far below any printer
  if (out && opts.clean !== false) { const c = out.simplify(opts.cleanTol ?? 0.005); out.delete(); out = c; }
  // loose bits: small pieces near the rest that don't touch it (a fin floating beside a barrel). Reported, and with
  // opts.loose 'connect' joined on with a small bridge, or with 'drop' left out.
  const read = m => {
    const mesh = m.getMesh(), P = mesh.vertProperties, np = mesh.numProp, T = mesh.triVerts;
    const V = new Float32Array(P.length / np * 3); for (let i = 0, j = 0; i < P.length; i += np, j += 3) { V[j] = P[i]; V[j + 1] = P[i + 1]; V[j + 2] = P[i + 2]; }
    return { V, T, parts: shells(T, V.length / 3).map(list => ({ list, sv: signedVolume(V, T, list) })) };
  };
  let looseBits = [], dropped = 0, bridged = 0;
  let R = out ? read(out) : null;
  if (R) {
    looseBits = findLoose(R, opts.looseGap ?? 2);
    // bridge, then look again: a bridge can land on another loose bit instead of the main piece
    for (let pass = 0, todo = looseBits; pass < 3 && todo.length && opts.loose === 'connect'; pass++) {
      const bridges = [];
      for (const b of todo) { const h = bridge(M, R.V, b); if (h) bridges.push(h); }
      if (!bridges.length) break;
      const u = Manifold.union([out, ...bridges]); out.delete(); bridges.forEach(m => m.delete()); out = u; R = read(out);
      todo = findLoose(R, opts.looseGap ?? 2);
      bridged = looseBits.length - todo.length;
    }
  }
  // hollows: the result's inner shells face inwards (negative volume); filling one is just leaving it out
  let hollows = 0, hollowVolume = 0, hollowsLeft = 0, hollowLeftVolume = 0, shellsOut = 0, positions = new Float32Array(0), volume = 0;
  if (out) {
    const { V, T } = R, keep = [], skip = new Set(opts.loose === 'drop' ? looseBits.map(b => b.part) : []);
    dropped = skip.size;
    for (const part of R.parts) {
      const { list, sv } = part;
      if (skip.has(part)) continue;
      if (Math.abs(sv) < 1e-3) continue;                 // a fleck left where pieces barely touched
      if (sv < 0 && opts.fillHollows) { hollows++; hollowVolume -= sv; continue; }
      if (sv < 0) { hollowsLeft++; hollowLeftVolume -= sv; }
      if (sv > 0) shellsOut++; volume += sv; keep.push(list);
    }
    let n = 0; for (const l of keep) n += l.length;
    positions = new Float32Array(n * 9); let o = 0;
    for (const l of keep) for (const t of l) for (let e = 0; e < 3; e++) { const i = 3 * T[3 * t + e]; positions[o++] = V[i]; positions[o++] = V[i + 1]; positions[o++] = V[i + 2]; }
    out.delete();
    hollows += hollowsIn; hollowVolume += hollowsInVol;
  }
  // anything that couldn't be made solid goes through untouched
  let unmerged = 0, specks = 0;
  const area = l => { let A = 0; for (const t of l) { const a = 3 * tri[3 * t], b = 3 * tri[3 * t + 1], c = 3 * tri[3 * t + 2];
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2], vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; } return A; };
  loose = loose.filter(l => { if (area(l) < (opts.speck ?? 0.01)) { specks++; return false; } return true; });   // flecks of loose triangles: nothing to print
  if (loose.length) {
    let n = 0; for (const l of loose) n += l.length;
    const p2 = new Float32Array(positions.length + n * 9); p2.set(positions); let o = positions.length;
    for (const l of loose) { unmerged++; for (const t of l) for (let e = 0; e < 3; e++) { const i = 3 * tri[3 * t + e]; p2[o++] = vert[i]; p2[o++] = vert[i + 1]; p2[o++] = vert[i + 2]; } }
    positions = p2;
  }
  const looseOut = looseBits.map(b => ({ volume: b.sv, gap: b.gap, at: b.at }));
  return { positions, cut, loose: looseOut, bridged, dropped, shells: shellsOut, inputShells, repaired, unmerged, specks, hollows, hollowVolume, hollowsLeft, hollowLeftVolume, volume };
}

function concat(list) {
  if (list.length === 1) return list[0];
  let n = 0; for (const a of list) n += a.length;
  const out = new Float32Array(n); let o = 0; for (const a of list) { out.set(a, o); o += a.length; }
  return out;
}

/**
 * Loose bits in a merged result: closed pieces (outward shells) within maxGap of a piece at least ten times their size,
 * without touching it. Returns [{ part, sv, gap, p (on the bit), q (nearest point on the rest), at }].
 */
function findLoose(R, maxGap) {
  const solid = R.parts.filter(p => p.sv > 1e-3);
  if (solid.length < 2) return [];
  const big = Math.max(...solid.map(p => p.sv)), { V, T } = R;
  const vertsOf = p => { const s = new Set(); for (const t of p.list) { s.add(T[3 * t]); s.add(T[3 * t + 1]); s.add(T[3 * t + 2]); } return [...s]; };
  const out = [];
  for (const p of solid) {
    if (p.sv * 10 > big) continue;
    // the triangles of everything bigger than it, in a grid of maxGap cells
    const mine = vertsOf(p), cell = maxGap, grid = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, f = Math.floor;
    for (const o of solid) {
      if (o === p || o.sv < 10 * p.sv) continue;          // only to something much bigger: a bit is joined to the model, not to another bit
      for (const t of o.list) {
        const a = 3 * T[3 * t], b = 3 * T[3 * t + 1], c = 3 * T[3 * t + 2];
        const x0 = f(Math.min(V[a], V[b], V[c]) / cell), x1 = f(Math.max(V[a], V[b], V[c]) / cell), y0 = f(Math.min(V[a + 1], V[b + 1], V[c + 1]) / cell), y1 = f(Math.max(V[a + 1], V[b + 1], V[c + 1]) / cell), z0 = f(Math.min(V[a + 2], V[b + 2], V[c + 2]) / cell), z1 = f(Math.max(V[a + 2], V[b + 2], V[c + 2]) / cell);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096) continue;              // a huge triangle: not worth gridding
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) { const k = key(x, y, z); let g = grid.get(k); if (!g) grid.set(k, g = []); g.push(t); }
      }
    }
    let best = Infinity, bp = -1, Q = null, bt = -1;
    for (const v of mine) {
      const P0 = [V[3 * v], V[3 * v + 1], V[3 * v + 2]], cx = f(P0[0] / cell), cy = f(P0[1] / cell), cz = f(P0[2] / cell), seen = new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const g = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!g) continue;
        for (const t of g) { if (seen.has(t)) continue; seen.add(t); const q = closestOnTri(P0, V, 3 * T[3 * t], 3 * T[3 * t + 1], 3 * T[3 * t + 2]), d = Math.hypot(P0[0] - q[0], P0[1] - q[1], P0[2] - q[2]); if (d < best) { best = d; bp = v; Q = q; bt = t; } }
      }
    }
    if (bp < 0 || best > maxGap) continue;
    const P = [V[3 * bp], V[3 * bp + 1], V[3 * bp + 2]];
    const a = 3 * T[3 * bt], b = 3 * T[3 * bt + 1], c = 3 * T[3 * bt + 2];
    const n = norm(cross([V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]]));
    out.push({ part: p, sv: p.sv, gap: best, p: P, q: Q, n, verts: mine, at: P.map((x, i) => (x + Q[i]) / 2) });
  }
  return out;
}
/** A small bridge joining a loose bit to the rest: the hull of the bit's corner nearest the rest and a nub sunk into the rest. */
function bridge(M, V, b) {
  const { Manifold } = M, [px, py, pz] = b.p, [qx, qy, qz] = b.q;
  // the bit's own corners near its closest point (its end that faces the rest), so the bridge is as wide as the bit there
  // as thick as the bit itself (a 0.25 mm fin gets a 0.25 mm bridge), within 0.25–1 mm
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of b.verts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], V[3 * v + k]); hi[k] = Math.max(hi[k], V[3 * v + k]); }
  const r = Math.max(0.125, Math.min(0.5, Math.min(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2));
  const reach = Math.max(2 * r, 0.25), pts = [];
  for (const v of b.verts) { const x = V[3 * v], y = V[3 * v + 1], z = V[3 * v + 2]; if (Math.hypot(x - px, y - py, z - pz) <= reach) pts.push([x, y, z]); }
  const sink = 2 * r + 0.2;          // well into the rest, so they overlap rather than just touch
  const [nx, ny, nz] = b.n.map(x => -x);                    // into the rest, square to its surface
  const ax = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0], e1 = norm(cross([nx, ny, nz], ax)), e2 = cross([nx, ny, nz], e1);
  for (const s of [-1, 1]) for (const t of [-1, 1]) for (const w of [-0.02, sink]) {
    // a small square of corners around the nub: from just outside the surface to well inside
    pts.push([qx + nx * w + (e1[0] * s + e2[0] * t) * r, qy + ny * w + (e1[1] * s + e2[1] * t) * r, qz + nz * w + (e1[2] * s + e2[2] * t) * r]);
  }
  if (pts.length < 4) return null;
  try { const h = Manifold.hull(pts); if (h.volume() > 1e-6) return h; h.delete(); } catch (e) {}
  return null;
}
/** The point of triangle (a, b, c: offsets into V) nearest p (Ericson's method). */
function closestOnTri(p, V, a, b, c) {
  const A = [V[a], V[a + 1], V[a + 2]], B = [V[b], V[b + 1], V[b + 2]], C = [V[c], V[c + 1], V[c + 2]];
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], at = (o, u, s, w, t) => [o[0] + u[0] * s + w[0] * t, o[1] + u[1] * s + w[1] * t, o[2] + u[2] * s + w[2] * t];
  const ab = sub(B, A), ac = sub(C, A), ap = sub(p, A), d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return A;
  const bp = sub(p, B), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return B;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(A, ab, d1 / (d1 - d3), ac, 0);
  const cp = sub(p, C), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return C;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(A, ab, 0, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [B[0] + (C[0] - B[0]) * w, B[1] + (C[1] - B[1]) * w, B[2] + (C[2] - B[2]) * w]; }
  const den = 1 / (va + vb + vc); return at(A, ab, vb * den, ac, vc * den);
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The corners of a binary STL, xyz per corner. */
export function soupFromSTL(buf) {
  const dv = new DataView(buf), n = dv.getUint32(80, true), p = new Float32Array(n * 9);
  for (let t = 0, o = 84; t < n; t++, o += 50) for (let k = 0; k < 9; k++) p[9 * t + k] = dv.getFloat32(o + 12 + 4 * k, true);
  return p;
}
/** A binary STL of corners, xyz per corner. */
export function stlFromSoup(p) {
  const n = p.length / 9, buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf), head = 'Kitbash Bench export (mm)';
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  for (let t = 0, o = 84; t < n; t++, o += 50) {
    const i = 9 * t, ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2], vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
    for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + 4 * k, p[i + k], true);
  }
  return buf;
}
