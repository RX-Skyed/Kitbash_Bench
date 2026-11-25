// Kitbash Bench · image to relief: turn a picture (a logo, an emblem) into a solid you can stick on a model.
// No AI: the picture is read as a field of numbers (how much "ink" each pixel has), the outline is traced where that
// field crosses a threshold, and the height comes from the field too (depth map) or is flat with an optional bevel.
// Plain number crunching, no page code: the Manifold module is handed in for the solid.

/**
 * A picture's pixels (RGBA, w × h) as an ink field: 0 = background, 1 = full ink.
 * raise: 'dark' (dark on light, the usual logo), 'light', or 'auto' (whatever the border isn't). Transparent pixels
 * are always background, so a cut-out PNG works as it is.
 */
export function inkField(rgba, w, h, raise = 'auto') {
  const n = w * h, L = new Float32Array(n), A = new Float32Array(n);
  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    const r = rgba[4 * i], g = rgba[4 * i + 1], b = rgba[4 * i + 2], a = rgba[4 * i + 3] / 255;
    L[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; A[i] = a; if (a < 0.98) hasAlpha = true;
  }
  // the border tells us which side is background
  let bs = 0, bn = 0, ba = 0;
  const edge = i => { bs += L[i]; ba += A[i]; bn++; };
  for (let x = 0; x < w; x++) { edge(x); edge((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { edge(y * w); edge(y * w + w - 1); }
  const borderL = bs / bn, borderClear = ba / bn < 0.5;
  const dark = raise === 'dark' || (raise === 'auto' && (borderClear ? true : borderL > 0.5));
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = dark ? 1 - L[i] : L[i];
    if (hasAlpha) v = borderClear && raise === 'auto' ? A[i] : v * A[i];      // a cut-out: whatever isn't see-through is the logo
    f[i] = v;
  }
  // stretch to the full 0..1 range
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < n; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
  const span = hi - lo || 1; for (let i = 0; i < n; i++) f[i] = (f[i] - lo) / span;
  return { field: f, raise: dark ? 'dark' : 'light', hasAlpha };
}

/** Soften a field (repeated box blur, radius r pixels): smoother outlines and smoother depth. */
export function blurField(f, w, h, r) {
  if (!(r > 0)) return f;
  let a = Float32Array.from(f), b = new Float32Array(f.length);
  const R = Math.max(1, Math.round(r));
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) { let s = 0, c = 0; const row = y * w;
      for (let x = -R; x < w; x++) { if (x + R < w) { s += a[row + x + R]; c++; } if (x - R - 1 >= 0) { s -= a[row + x - R - 1]; c--; } if (x >= 0) b[row + x] = s / c; } }
    for (let x = 0; x < w; x++) { let s = 0, c = 0;
      for (let y = -R; y < h; y++) { if (y + R < h) { s += b[(y + R) * w + x]; c++; } if (y - R - 1 >= 0) { s -= b[(y - R - 1) * w + x]; c--; } if (y >= 0) a[y * w + x] = s / c; } }
  }
  return a;
}

/** The threshold that best splits the field into two groups (Otsu's method). */
export function otsu(f) {
  const bins = 256, hist = new Float64Array(bins); for (const v of f) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const n = f.length; let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = 0.5;
  for (let i = 0; i < bins; i++) { wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break; sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; t = (i + 0.5) / bins; } }
  return t;
}

/**
 * The outline where the field crosses t (marching squares, with the crossing placed between pixels, so it's smooth
 * rather than stepped). Pixel centres are at (x, y). Returns closed loops of [x, y].
 */
export function traceOutline(f, w, h, t) {
  const W = w + 2, H = h + 2, g = new Float32Array(W * H);          // a border of background all round closes every loop
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[(y + 1) * W + x + 1] = f[y * w + x];
  const at = (x, y) => g[y * W + x];
  const pts = new Map(), adj = new Map();
  // an edge's crossing point: horizontal edge (x,y)-(x+1,y) is id 2*(y*W+x), vertical (x,y)-(x,y+1) is id 2*(y*W+x)+1
  const point = id => {
    if (pts.has(id)) return; const k = id >> 1, x = k % W, y = (k - x) / W, vert = id & 1;
    const a = at(x, y), b = vert ? at(x, y + 1) : at(x + 1, y), s = Math.abs(b - a) < 1e-9 ? 0.5 : Math.min(1, Math.max(0, (t - a) / (b - a)));
    pts.set(id, vert ? [x - 1, y - 1 + s] : [x - 1 + s, y - 1]);
  };
  const link = (p, q) => { point(p); point(q); (adj.get(p) || adj.set(p, []).get(p)).push(q); (adj.get(q) || adj.set(q, []).get(q)).push(p); };
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = at(x, y) >= t, b = at(x + 1, y) >= t, c = at(x + 1, y + 1) >= t, d = at(x, y + 1) >= t;
    const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0); if (code === 0 || code === 15) continue;
    const top = 2 * (y * W + x), bottom = 2 * ((y + 1) * W + x), left = 2 * (y * W + x) + 1, right = 2 * (y * W + x + 1) + 1;
    switch (code) {
      case 1: case 14: link(left, top); break;
      case 2: case 13: link(top, right); break;
      case 3: case 12: link(left, right); break;
      case 4: case 11: link(right, bottom); break;
      case 6: case 9: link(top, bottom); break;
      case 7: case 8: link(left, bottom); break;
      case 5: case 10: {                                              // a saddle: the middle decides which way it joins
        const mid = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= t;
        if ((code === 5) === mid) { link(left, top); link(right, bottom); } else { link(top, right); link(left, bottom); }
        break;
      }
    }
  }
  const loops = [], done = new Set();
  for (const start of adj.keys()) {
    if (done.has(start)) continue;
    const loop = []; let prev = -1, cur = start;
    while (cur !== undefined && !done.has(cur)) {
      done.add(cur); loop.push(pts.get(cur));
      const nb = adj.get(cur); const next = nb[0] !== prev ? nb[0] : nb[1]; prev = cur; cur = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** For each pixel inside (f ≥ t), how far it is (pixels) to the nearest pixel outside: exact, Felzenszwalb's method. */
export function distanceInside(f, w, h, t) {
  const INF = 1e20, d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = f[i] >= t ? INF : 0;
  const n = Math.max(w, h), v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float64Array(n), o = new Float64Array(n);
  const pass = (get, set, len) => {
    for (let i = 0; i < len; i++) g[i] = get(i);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let s; do { const p = v[k]; s = ((g[q] + q * q) - (g[p] + p * p)) / (2 * q - 2 * p); if (s <= z[k]) k--; else break; } while (k >= 0);
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0; for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; o[q] = (q - p) * (q - p) + g[p]; }
    for (let i = 0; i < len; i++) set(i, o[i]);
  };
  for (let x = 0; x < w; x++) pass(y => d[y * w + x], (y, val) => { d[y * w + x] = val; }, h);
  for (let y = 0; y < h; y++) pass(x => d[y * w + x], (x, val) => { d[y * w + x] = val; }, w);
  // the picture's own edge counts as outside too, so a logo touching the border still gets its bevel there
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; out[i] = Math.min(Math.sqrt(d[i]), x + 1, y + 1, w - x, h - y); if (f[i] < t) out[i] = 0; }
  return out;
}

/** Bilinear sample of a w × h field at pixel coordinates (x, y), clamped at the edges. */
function sample(f, w, h, x, y) {
  x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  return (f[y0 * w + x0] * (1 - fx) + f[y0 * w + x1] * fx) * (1 - fy) + (f[y1 * w + x0] * (1 - fx) + f[y1 * w + x1] * fx) * fy;
}
const smooth = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

/**
 * Build the relief. M: the Manifold module. p: { field, w, h, t (threshold), mode: 'flat' | 'depth' | 'image',
 * width (mm across), height (mm, the tallest point), low (mm, the lowest raised height for depth and bevels),
 * bevel (mm), base (mm, a backing plate under the whole picture; 0 for none), cell (mm, how fine the mesh is) }.
 * 'image' uses the whole picture as a depth map, no outline. Returns { positions (xyz per corner), size: [x, y, z], loops }.
 * The relief lies flat: its back on z = 0, raised toward +z, centred on the origin.
 */
export function buildRelief(M, p) {
  const { Manifold, CrossSection } = M;
  const { field: f, w, h } = p, s = p.width / w, t = p.mode === 'image' ? -1 : p.t;
  const toMM = ([x, y]) => [(x - (w - 1) / 2) * s, ((h - 1) / 2 - y) * s];
  const toPx = (x, y) => [x / s + (w - 1) / 2, (h - 1) / 2 - y / s];
  let cs;
  if (p.mode === 'image') {
    const hw = w * s / 2, hh = h * s / 2; cs = new CrossSection([[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]]);
  } else {
    const loops = traceOutline(f, w, h, t).map(l => l.map(toMM));
    if (!loops.length) return { positions: new Float32Array(0), size: [0, 0, 0], loops: 0 };
    cs = new CrossSection(loops, 'EvenOdd'); const s2 = cs.simplify(s * 0.15); cs.delete(); cs = s2;
  }
  // copies on a lattice (p.tiles.at, in mm, the picture's centre for each) and trimmed to an outline (p.clip: 2D
  // triangles x0 y0 x1 y1 x2 y2 …, the face they go on, seen straight on), all in 2D before the solid is built
  const at = p.tiles?.at?.length ? p.tiles.at : [[0, 0]], pitch = p.tiles?.pitch || [Infinity, Infinity];
  let clipCS = null;
  const trisCS = c => {                                               // 2D triangles (either way round) → their union
    const polys = [];
    for (let i = 0; i + 5 < c.length; i += 6) {
      const ar = (c[i + 2] - c[i]) * (c[i + 5] - c[i + 1]) - (c[i + 4] - c[i]) * (c[i + 3] - c[i + 1]);
      if (Math.abs(ar) < 1e-12) continue;
      polys.push(ar > 0 ? [[c[i], c[i + 1]], [c[i + 2], c[i + 3]], [c[i + 4], c[i + 5]]] : [[c[i], c[i + 1]], [c[i + 4], c[i + 5]], [c[i + 2], c[i + 3]]]);
    }
    return new CrossSection(polys, 'Positive');
  };
  if (p.clip?.length) {
    clipCS = trisCS(p.clip);
    if (p.fillHoles) {                                                 // only its outside edge: gaps inside it count as in
      const outer = clipCS.toPolygons().filter(l => { let a = 0; for (let i = 0; i < l.length; i++) { const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length]; a += x0 * y1 - x1 * y0; } return a > 0; });
      clipCS.delete(); clipCS = new CrossSection(outer, 'Positive');
    }
    if (p.margin > 0) { const o = clipCS.offset(-p.margin, 'Miter'); clipCS.delete(); clipCS = o; }
  }
  const spread = one => {
    let out = one;
    if (at.length > 1 || at[0][0] || at[0][1]) { const copies = at.map(c => one.translate(c)); out = CrossSection.union(copies); copies.forEach(c => c.delete()); one.delete(); }
    if (clipCS) { const i = out.intersect(clipCS); out.delete(); out = i; }
    return out;
  };
  cs = spread(cs);
  // shapes that only touch at a corner (a checkerboard's squares), or nearly, would meet in a pinch that slicers call
  // broken once it's bent onto a surface: join them with a little neck (40 µm), far below anything a printer shows
  if (p.mode !== 'image') { const a = cs.offset(0.02, 'Miter', 2), b = a.offset(-0.02, 'Miter', 2); a.delete(); cs.delete(); cs = b; }
  if (cs.isEmpty()) { cs.delete(); clipCS?.delete(); return { positions: new Float32Array(0), size: [0, 0, 0], loops: 0 }; }
  // a spot on the solid → the same spot on its own copy of the picture
  const [ax, ay] = at[0], local = (x, y) => [
    isFinite(pitch[0]) ? x - ax - Math.round((x - ax) / pitch[0]) * pitch[0] : x - ax,
    isFinite(pitch[1]) ? y - ay - Math.round((y - ay) / pitch[1]) * pitch[1] : y - ay];
  const dist = p.bevel > 0 && p.mode !== 'image' ? blurField(distanceInside(f, w, h, t), w, h, 1) : null;   // softened a touch, so the bevel's slope is smooth
  const H = Math.max(0.05, p.height), lo = Math.min(H, Math.max(0.05, p.low ?? 0.3));
  const top = (x0, y0) => {
    const [x, y] = local(x0, y0), [gx, gy] = toPx(x, y);
    let z = H;
    if (p.mode !== 'flat') { const v = sample(f, w, h, gx, gy), lo2 = p.mode === 'image' ? 0 : t; z = lo + (H - lo) * Math.min(1, Math.max(0, (v - lo2) / Math.max(1e-6, 1 - lo2))); }
    if (dist) z = lo + (z - lo) * smooth(sample(dist, w, h, gx, gy) * s / p.bevel);
    return Math.max(0.05, z);
  };
  // pieces (p.pieces: 2D triangles of each flat facet of the surface it goes on): cut along the creases, each piece
  // built on its own, so where it's bent round a corner it has corners of its own and needs no fine mesh to fold
  let pieceCS = null;
  if (p.pieces?.length) pieceCS = p.pieces.map(trisCS);
  const split = whole => {
    if (!pieceCS) return [whole];
    const out = [];
    for (const g of pieceCS) { const c = whole.intersect(g); if (c.isEmpty()) c.delete(); else out.push(c); }
    {                                                                   // whatever isn't on a facet (a bump, or past the edge), as it is
      const all = CrossSection.union(pieceCS), rest = whole.subtract(all); all.delete();
      if (rest.isEmpty() || rest.area() < 1e-6) rest.delete(); else out.push(rest);
    }
    whole.delete(); return out;
  };
  const refine = m => { if (!(p.cell < 1e3)) return m; const r = m.refineToLength(Math.max(0.02, p.cell)); m.delete(); return r; };
  const solids = [];
  for (const piece of split(cs)) {
    let m = refine(piece.extrude(1)); piece.delete();
    const wm = m.warp(v => { v[2] = v[2] * top(v[0], v[1]); }); m.delete(); m = wm;
    if (p.base > 0) { const up = m.translate([0, 0, p.base - 0.001]); m.delete(); m = up; }
    solids.push(m);
  }
  if (p.base > 0) {                                                    // a plate under the whole picture, the relief on top of it
    const hw = w * s / 2, hh = h * s / 2;
    for (const pc of split(spread(new CrossSection([[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]])))) { solids.push(refine(pc.extrude(p.base))); pc.delete(); }
  }
  pieceCS?.forEach(g => g.delete());
  let m;
  if (solids.length === 1) m = solids[0];
  else if (p.base > 0 && !pieceCS) { m = Manifold.union(solids); solids.forEach(x => x.delete()); }
  else { m = Manifold.compose(solids); solids.forEach(x => x.delete()); }   // pieces side by side; the export merge fuses them
  clipCS?.delete();
  const mesh = m.getMesh(), P = mesh.vertProperties, np = mesh.numProp, T = mesh.triVerts, out = new Float32Array(T.length * 3);
  for (let i = 0; i < T.length; i++) { const k = T[i] * np; out[3 * i] = P[k]; out[3 * i + 1] = P[k + 1]; out[3 * i + 2] = P[k + 2]; }
  const bb = m.boundingBox(); m.delete();
  return { positions: out, size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]] };
}
