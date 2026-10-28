// Kitbash Bench · "Do ya feel lucky?": find how two parts fit together with no clicks.
//
// Plain number crunching on typed arrays with no imports, so the same code runs in background workers,
// on the page itself, and in tests. Everything is in world millimetres.
//
// How it works: a grid around the fixed part (B) stores, for each cell near its surface, the plane of the
// closest triangle, and for every cell whether it's inside B. Then every way the moving part (A) could sit
// on B is tried by brute force: anchor points spread over A are placed on points spread over B, facing
// each other, at every turn. Each pose is scored by how much of A sits flush on B (within a hair, facing
// it) minus how much has sunk into B. The best poses are refined and the clear winner is usually the joint.

/* ------------------------------------------------------------------ small vector and matrix helpers -- */
// rotations are row-major arrays of 9; poses are { R, t } with t an array of 3

const mulMM = (A, B) => [
  A[0] * B[0] + A[1] * B[3] + A[2] * B[6], A[0] * B[1] + A[1] * B[4] + A[2] * B[7], A[0] * B[2] + A[1] * B[5] + A[2] * B[8],
  A[3] * B[0] + A[4] * B[3] + A[5] * B[6], A[3] * B[1] + A[4] * B[4] + A[5] * B[7], A[3] * B[2] + A[4] * B[5] + A[5] * B[8],
  A[6] * B[0] + A[7] * B[3] + A[8] * B[6], A[6] * B[1] + A[7] * B[4] + A[8] * B[7], A[6] * B[2] + A[7] * B[5] + A[8] * B[8]];
const transpose = A => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
const mulMV = (R, x, y, z) => [R[0] * x + R[1] * y + R[2] * z, R[3] * x + R[4] * y + R[5] * z, R[6] * x + R[7] * y + R[8] * z];
/** A rotation whose third column is the unit vector (nx, ny, nz). */
function basisZ(nx, ny, nz) {
  let ax = 1, ay = 0, az = 0; if (Math.abs(nx) > 0.9) { ax = 0; ay = 1; }
  let ux = ny * az - nz * ay, uy = nz * ax - nx * az, uz = nx * ay - ny * ax; const l = Math.hypot(ux, uy, uz); ux /= l; uy /= l; uz /= l;
  const vx = ny * uz - nz * uy, vy = nz * ux - nx * uz, vz = nx * uy - ny * ux;
  return [ux, vx, nx, uy, vy, ny, uz, vz, nz];
}
function axisAngle(x, y, z, a) {
  const c = Math.cos(a), s = Math.sin(a), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
}
/** Solve the 6×6 system A x = b (Gaussian elimination with pivoting). */
function solve6(A, b) {
  const n = 6, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null; [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}
const fract = x => x - Math.floor(x);

/* -------------------------------------------------------------------------------------- the field -- */

/**
 * The grid around part B. pos: Float32Array of world positions, idx: triangle indices (or null for a
 * triangle soup). Cells within `band` cells of the surface keep the plane of the surface nearby (nx, ny, nz, d),
 * so distances are measured to the surface itself, well below a cell; every cell gets an inside vote from
 * odd ray crossings along z and along x.
 */
export function buildField(pos, idx, cell, opts = {}) {
  const t00 = performance.now(), T = idx ? idx.length / 3 : pos.length / 9, band = opts.band ?? 2, tick = opts.tick || (() => {});
  const vi = idx ? (t, k) => idx[3 * t + k] : (t, k) => 3 * t + k;
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < pos.length; i += 3) { const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z; }
  const pad = (band + 2) * cell, o = [mnx - pad, mny - pad, mnz - pad];
  const nx = Math.ceil((mxx - mnx + 2 * pad) / cell) + 1, ny = Math.ceil((mxy - mny + 2 * pad) / cell) + 1, nz = Math.ceil((mxz - mnz + 2 * pad) / cell) + 1;
  const N = nx * ny * nz, inv = 1 / cell;
  // 1. each cell that holds triangles gets one plane: their area-weighted facing through their area-weighted middle
  //    (triangles in a sculpt are far smaller than a cell, so this is the surface there)
  const occ = new Int32Array(N).fill(-1); let acc = new Float64Array(7 * 65536), nOcc = 0;
  for (let t = 0; t < T; t++) {
    const ia = 3 * vi(t, 0), ib = 3 * vi(t, 1), ic = 3 * vi(t, 2);
    const ax = pos[ia], ay = pos[ia + 1], az = pos[ia + 2], bx = pos[ib], by = pos[ib + 1], bz = pos[ib + 2], cx = pos[ic], cy = pos[ic + 1], cz = pos[ic + 2];
    const fx = (by - ay) * (cz - az) - (bz - az) * (cy - ay), fy = (bz - az) * (cx - ax) - (bx - ax) * (cz - az), fz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const w = Math.hypot(fx, fy, fz) / 2; if (!(w > 0)) continue;
    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    const v = Math.round((mx - o[0]) * inv) + nx * (Math.round((my - o[1]) * inv) + ny * Math.round((mz - o[2]) * inv));
    let q = occ[v]; if (q < 0) { q = occ[v] = nOcc++; if (7 * nOcc > acc.length) { const g = new Float64Array(acc.length * 2); g.set(acc); acc = g; } }
    acc[7 * q] += fx / 2; acc[7 * q + 1] += fy / 2; acc[7 * q + 2] += fz / 2; acc[7 * q + 3] += w * mx; acc[7 * q + 4] += w * my; acc[7 * q + 5] += w * mz; acc[7 * q + 6] += w;
    if ((t & 65535) === 0) tick(0.35 * t / T);
  }
  const op = new Float32Array(4 * nOcc), oc = new Float32Array(3 * nOcc), occCell = new Int32Array(nOcc);
  for (let v = 0; v < N; v++) if (occ[v] >= 0) occCell[occ[v]] = v;
  for (let q = 0; q < nOcc; q++) {
    const w = acc[7 * q + 6], x = acc[7 * q + 3] / w, y = acc[7 * q + 4] / w, z = acc[7 * q + 5] / w;
    let a = acc[7 * q], b = acc[7 * q + 1], c = acc[7 * q + 2]; const l = Math.hypot(a, b, c);
    if (l > 1e-12) { a /= l; b /= l; c /= l; } else { a = b = c = 0; }          // both sides of a wall in one cell: no facing to trust
    op[4 * q] = a; op[4 * q + 1] = b; op[4 * q + 2] = c; op[4 * q + 3] = a * x + b * y + c * z; oc[3 * q] = x; oc[3 * q + 1] = y; oc[3 * q + 2] = z;
  }
  tick(0.45);
  // 2. every cell within `band` cells of the surface takes the plane of the nearest surface middle
  const slot = new Int32Array(N).fill(-1), bestD = new Float32Array(N).fill(Infinity), lim = (band + 0.5) * cell, lim2 = lim * lim;
  for (let q = 0; q < nOcc; q++) {
    if (op[4 * q] === 0 && op[4 * q + 1] === 0 && op[4 * q + 2] === 0) continue;
    const v0 = occCell[q], i0 = v0 % nx, j0 = ((v0 / nx) | 0) % ny, k0 = (v0 / (nx * ny)) | 0, x = oc[3 * q], y = oc[3 * q + 1], z = oc[3 * q + 2];
    for (let dk = -band; dk <= band; dk++) { const k = k0 + dk; if (k < 0 || k >= nz) continue; const pz = o[2] + k * cell - z;
      for (let dj = -band; dj <= band; dj++) { const j = j0 + dj; if (j < 0 || j >= ny) continue; const py = o[1] + j * cell - y, row = nx * (j + ny * k);
        for (let di = -band; di <= band; di++) { const i = i0 + di; if (i < 0 || i >= nx) continue; const px = o[0] + i * cell - x;
          const d2 = px * px + py * py + pz * pz; if (d2 > lim2) continue;
          const v = row + i; if (d2 < bestD[v]) { bestD[v] = d2; slot[v] = q; } } } }
    if ((q & 65535) === 0) tick(0.45 + 0.3 * q / nOcc);
  }
  const pl = op, M = nOcc;
  const tBand = performance.now();
  // inside: odd crossings counted along two axes, so a crack or a doubled wall in one direction can't flip a cell
  const votes = new Uint8Array(N), dims = [nx, ny, nz];
  for (const ax of [2, 0]) {
    const u = ax === 2 ? 0 : 1, w = ax === 2 ? 1 : 2, nu = dims[u], nw = dims[w], ou = o[u] + 1.37e-4 * cell, ow = o[w] + 2.71e-4 * cell;
    const count = new Int32Array(nu * nw + 1), P = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const pass = fill => {
      for (let t = 0; t < T; t++) {
        for (let k = 0; k < 3; k++) { const q = 3 * vi(t, k); P[3 * k] = pos[q]; P[3 * k + 1] = pos[q + 1]; P[3 * k + 2] = pos[q + 2]; }
        const au = P[u], aw = P[w], bu = P[3 + u], bw = P[3 + w], cu = P[6 + u], cw = P[6 + w];
        const det = (bu - au) * (cw - aw) - (bw - aw) * (cu - au); if (Math.abs(det) < 1e-18) continue;
        const a0 = Math.max(0, Math.ceil((Math.min(au, bu, cu) - ou) * inv)), a1 = Math.min(nu - 1, Math.floor((Math.max(au, bu, cu) - ou) * inv));
        const c0 = Math.max(0, Math.ceil((Math.min(aw, bw, cw) - ow) * inv)), c1 = Math.min(nw - 1, Math.floor((Math.max(aw, bw, cw) - ow) * inv));
        for (let A = a0; A <= a1; A++) { const pu = ou + A * cell;
          for (let C = c0; C <= c1; C++) { const pw = ow + C * cell;
            const l1 = ((bu - pu) * (cw - pw) - (bw - pw) * (cu - pu)) / det, l2 = ((cu - pu) * (aw - pw) - (cw - pw) * (au - pu)) / det, l3 = 1 - l1 - l2;
            if (l1 < 0 || l2 < 0 || l3 < 0) continue;
            const col = A + nu * C;
            if (!fill) count[col + 1]++; else fill(col, l1 * P[ax] + l2 * P[3 + ax] + l3 * P[6 + ax]);
          } }
      }
    };
    pass(null);
    for (let c = 1; c <= nu * nw; c++) count[c] += count[c - 1];
    const at = count.slice(0, nu * nw), hits = new Float32Array(count[nu * nw]);
    pass((col, h) => { hits[at[col]++] = h; });
    for (let col = 0; col < nu * nw; col++) {
      const s0 = count[col], s1 = count[col + 1], n = s1 - s0; if (n < 2 || n % 2) continue;
      const hs = hits.subarray(s0, s1).sort(), A = col % nu, C = (col / nu) | 0;
      for (let h = 0; h + 1 < n; h += 2) {
        const t0 = Math.max(0, Math.ceil((hs[h] - o[ax]) * inv)), t1 = Math.min(dims[ax] - 1, Math.floor((hs[h + 1] - o[ax]) * inv));
        for (let q = t0; q <= t1; q++) { const id = [0, 0, 0]; id[ax] = q; id[u] = A; id[w] = C; votes[id[0] + nx * (id[1] + ny * id[2])]++; }
      }
    }
    tick(ax === 2 ? 0.85 : 1);
  }
  return { o, n: dims, cell, slot, pl, votes, time: [tBand - t00, performance.now() - tBand] };
}
/** Signed distance (+ outside) to B's surface at (x, y, z) in out.s (NaN away from the surface), its facing, and out.inside. */
export function fieldAt(F, x, y, z, out) {
  const c = F.cell, i = Math.round((x - F.o[0]) / c), j = Math.round((y - F.o[1]) / c), k = Math.round((z - F.o[2]) / c), n = F.n;
  if (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2]) { out.s = NaN; out.inside = false; return out; }
  const v = i + n[0] * (j + n[1] * k), s = F.slot[v];
  out.inside = F.votes[v] > 0;
  if (s < 0) { out.s = NaN; return out; }
  const p = F.pl; out.nx = p[4 * s]; out.ny = p[4 * s + 1]; out.nz = p[4 * s + 2]; out.s = out.nx * x + out.ny * y + out.nz * z - p[4 * s + 3];
  return out;
}

/* ------------------------------------------------------------------------------------- the samples -- */

/** n points spread evenly over the surface by area, with normals averaged over `smooth` mm so sculpt texture doesn't twist them. */
export function samplePoints(pos, idx, n, seed, smooth) {
  const T = idx ? idx.length / 3 : pos.length / 9, vi = idx ? (t, k) => idx[3 * t + k] : (t, k) => 3 * t + k;
  const cum = new Float64Array(T), fnv = new Float32Array(3 * T); let A = 0;
  for (let t = 0; t < T; t++) {
    const a = 3 * vi(t, 0), b = 3 * vi(t, 1), c = 3 * vi(t, 2);
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z);
    A += l / 2; cum[t] = A; if (l > 0) { fnv[3 * t] = x / l; fnv[3 * t + 1] = y / l; fnv[3 * t + 2] = z / l; }
  }
  const P = new Float64Array(3 * n), N = new Float64Array(3 * n), tri = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n * A; let lo = 0, hi = T - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
    const t = lo, a = 3 * vi(t, 0), b = 3 * vi(t, 1), c = 3 * vi(t, 2);
    let r1 = fract(0.5 + (k + seed * 7919) * 0.6180339887), r2 = fract(0.5 + (k + seed * 7919) * 0.7548776662); if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    for (let d = 0; d < 3; d++) { P[3 * k + d] = pos[a + d] + r1 * (pos[b + d] - pos[a + d]) + r2 * (pos[c + d] - pos[a + d]); N[3 * k + d] = fnv[3 * t + d]; }
    tri[k] = t;
  }
  if (smooth > 0) {
    // the facing at each point: area-weighted average over the mesh's own triangles within `smooth` mm,
    // so fine sculpted texture averages out; Q says how much they agree (1 = one clear way, low = edge or ridge)
    const h = smooth, h2 = h * h, inv = 1 / h, grid = new Map(), key = (i, j, k) => (i * 73856093) ^ (j * 19349663) ^ (k * 83492791);
    const cen = new Float32Array(3 * T);
    for (let t = 0; t < T; t++) {
      const a = 3 * vi(t, 0), b = 3 * vi(t, 1), c = 3 * vi(t, 2);
      const x = (pos[a] + pos[b] + pos[c]) / 3, y = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, z = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
      cen[3 * t] = x; cen[3 * t + 1] = y; cen[3 * t + 2] = z;
      const kk = key(Math.floor(x * inv), Math.floor(y * inv), Math.floor(z * inv)); let l = grid.get(kk); if (!l) grid.set(kk, l = []); l.push(t);
    }
    const S = new Float64Array(3 * n), Q = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = P[3 * k], y = P[3 * k + 1], z = P[3 * k + 2], cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
      const ox = N[3 * k], oy = N[3 * k + 1], oz = N[3 * k + 2];
      let sx = 0, sy = 0, sz = 0, ax = 0, ay = 0, az = 0, aw = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const l = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!l) continue;
        for (const t of l) { const ex = cen[3 * t] - x, ey = cen[3 * t + 1] - y, ez = cen[3 * t + 2] - z; if (ex * ex + ey * ey + ez * ez >= h2) continue;
          const w = cum[t] - (t ? cum[t - 1] : 0), fx = fnv[3 * t] * w, fy = fnv[3 * t + 1] * w, fz = fnv[3 * t + 2] * w;
          ax += fx; ay += fy; az += fz; aw += w;
          if (fnv[3 * t] * ox + fnv[3 * t + 1] * oy + fnv[3 * t + 2] * oz > 0) { sx += fx; sy += fy; sz += fz; } }
      }
      Q[k] = aw > 0 ? Math.hypot(ax, ay, az) / aw : 0;
      const l = Math.hypot(sx, sy, sz); if (l > 0) { S[3 * k] = sx / l; S[3 * k + 1] = sy / l; S[3 * k + 2] = sz / l; } else { S[3 * k] = ox; S[3 * k + 1] = oy; S[3 * k + 2] = oz; }
    }
    return { P, N: S, Q, tri, area: A, n };
  }
  return { P, N, Q: new Float32Array(n).fill(1), tri, area: A, n };
}
/** count well-spread picks among the points listed in `from` (all when omitted): farthest-point sampling. */
export function spreadPick(P, count, start = 0, from = null) {
  const ids = from || Array.from({ length: P.length / 3 }, (_, i) => i), n = ids.length;
  if (n <= count) return ids.slice();
  const d = new Float64Array(n).fill(Infinity), out = [ids[start % n]];
  for (let s = 1; s < count; s++) {
    const l = out[out.length - 1], lx = P[3 * l], ly = P[3 * l + 1], lz = P[3 * l + 2]; let bi = 0, bd = -1;
    for (let q = 0; q < n; q++) { const i = ids[q], dx = P[3 * i] - lx, dy = P[3 * i + 1] - ly, dz = P[3 * i + 2] - lz, di = dx * dx + dy * dy + dz * dz;
      if (di < d[q]) d[q] = di; if (d[q] > bd) { bd = d[q]; bi = q; } }
    out.push(ids[bi]);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------- set-up -- */

/**
 * Everything the search needs, in one plain object that can be posted to workers.
 * A, B: { pos: Float32Array (world), idx: Uint32Array | null }. effort: 0.5 quick … 1 normal … 2 thorough.
 */
export function prepare(A, B, opts = {}) {
  const tick = opts.tick || (() => {});
  const box = pos => { let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let d = 0; d < 3; d++) { const v = pos[i + d]; if (v < mn[d]) mn[d] = v; if (v > mx[d]) mx[d] = v; } return [mn, mx]; };
  const area = (pos, idx) => { const T = idx ? idx.length / 3 : pos.length / 9; let a = 0; const vi = idx ? (t, k) => idx[3 * t + k] : (t, k) => 3 * t + k;
    for (let t = 0; t < T; t++) { const p = 3 * vi(t, 0), q = 3 * vi(t, 1), r = 3 * vi(t, 2), ux = pos[q] - pos[p], uy = pos[q + 1] - pos[p + 1], uz = pos[q + 2] - pos[p + 2], vx = pos[r] - pos[p], vy = pos[r + 1] - pos[p + 1], vz = pos[r + 2] - pos[p + 2];
      a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2; } return a; };
  const [bmn, bmx] = box(B.pos), aB = area(B.pos, B.idx), sB = [bmx[0] - bmn[0], bmx[1] - bmn[1], bmx[2] - bmn[2]];
  const cell = opts.cell ?? Math.max(0.05, Math.cbrt(sB[0] * sB[1] * sB[2] / 6e6), Math.sqrt(aB / 2.5e5));
  const F = buildField(B.pos, B.idx, cell, { tick: f => tick(0.75 * f) });
  const effort = opts.effort ?? 1, smooth = opts.smooth ?? Math.max(0.4, 4 * cell);
  const seed = opts.seed ?? 0, SA = samplePoints(A.pos, A.idx, opts.nEval ?? 3000, 11 + seed, smooth); tick(0.85);
  const SB = samplePoints(B.pos, B.idx, opts.nB ?? 2400, 17 + seed, smooth); tick(0.95);
  // anchors and targets only where the surface faces one clear way (not on edges, ridges or bumps), so a
  // pose built from their facing is close to right; mating surfaces are mostly like that anyway
  const steady = (S, q0) => { for (let q = q0; q > 0.5; q -= 0.02) { const ids = []; for (let i = 0; i < S.n; i++) if (S.Q[i] >= q) ids.push(i); if (ids.length >= S.n * 0.35) return ids; } return null; };
  const anchors = spreadPick(SA.P, Math.round((opts.nAnchors ?? 160) * Math.sqrt(effort)), 0, steady(SA, opts.steady ?? 0.97));
  const targets = spreadPick(SB.P, Math.round((opts.nTargets ?? 1400) * Math.sqrt(effort)), 0, steady(SB, opts.steady ?? 0.97));
  const [amn, amx] = box(A.pos), sizeA = Math.hypot(amx[0] - amn[0], amx[1] - amn[1], amx[2] - amn[2]);
  const centre = [(amn[0] + amx[0]) / 2, (amn[1] + amx[1]) / 2, (amn[2] + amx[2]) / 2];
  const params = {
    cell, sizeA, centre, spins: opts.spins ?? 24,
    tol: opts.tol ?? Math.max(0.1, 1.2 * cell), sink: opts.sink ?? Math.max(0.15, 2 * cell),
    qTol: Math.max(0.2, 3 * cell), qSink: Math.max(0.45, 5 * cell), maxSunk: 10,
    sinkWeight: opts.sinkWeight ?? 5,          // overlap counts five times against: pressed into a wall isn't a fit
    rLoc: Math.max(1.2, Math.min(2.5, 0.1 * sizeA)), nLoc: 80, nGlobal: 120, perAnchor: 5, keep: 1500,
  };
  const gIdx = spreadPick(SA.P, params.nGlobal, 3), refineIdx = spreadPick(SA.P, Math.min(1200, SA.n), 2);
  return { F, SA, SB, anchors, targets, gIdx, refineIdx, params, wA: SA.area / SA.n };
}

/* ---------------------------------------------------------------------------------------- search -- */

/** Search the given anchors (indices into ctx.anchors). Returns candidates { score, ia, ib, s }: each anchor's best few, and the best overall. */
export function searchAnchors(ctx, list, progress) {
  const { F, SA, SB, targets, gIdx, params: pr } = ctx, P = SA.P, Nn = SA.N, f = {};
  const spins = pr.spins, cs = new Float64Array(spins), sn = new Float64Array(spins);
  for (let s = 0; s < spins; s++) { cs[s] = Math.cos(2 * Math.PI * s / spins); sn[s] = Math.sin(2 * Math.PI * s / spins); }
  const { qTol, qSink, maxSunk, rLoc, nLoc, perAnchor, keep } = pr;
  const best = []; let minKept = -Infinity;
  const push = c => { if (best.length < keep) { best.push(c); if (best.length === keep) { best.sort((x, y) => y.score - x.score); minKept = best[keep - 1].score; } return; }
    if (c.score <= minKept) return; best[keep - 1] = c; for (let k = keep - 1; k > 0 && best[k].score > best[k - 1].score; k--) { const t = best[k]; best[k] = best[k - 1]; best[k - 1] = t; } minKept = best[keep - 1].score; };
  const ox = F.o[0], oy = F.o[1], oz = F.o[2], ic = 1 / F.cell, gnx = F.n[0], gny = F.n[1], gnz = F.n[2], slot = F.slot, pl = F.pl, votes = F.votes;
  const mineAll = []; let poses = 0, done = 0, passed = 0; const gMax = Math.round(gIdx.length * (pr.gSunk ?? 0.08));
  // targets with their facing frames, worked out once
  const TB = targets.map(ib => ({ ib, x: SB.P[3 * ib], y: SB.P[3 * ib + 1], z: SB.P[3 * ib + 2], e: basisZ(-SB.N[3 * ib], -SB.N[3 * ib + 1], -SB.N[3 * ib + 2]) }));
  const local = (FaT, ax, ay, az, ids) => { const L = new Float64Array(3 * ids.length), Ln = new Float64Array(3 * ids.length);
    ids.forEach((i, k) => { const p = mulMV(FaT, P[3 * i] - ax, P[3 * i + 1] - ay, P[3 * i + 2] - az), n = mulMV(FaT, Nn[3 * i], Nn[3 * i + 1], Nn[3 * i + 2]);
      L[3 * k] = p[0]; L[3 * k + 1] = p[1]; L[3 * k + 2] = p[2]; Ln[3 * k] = n[0]; Ln[3 * k + 1] = n[1]; Ln[3 * k + 2] = n[2]; }); return [L, Ln]; };
  for (const ai of list) {
    const ia = ctx.anchors[ai], ax = P[3 * ia], ay = P[3 * ia + 1], az = P[3 * ia + 2], FaT = transpose(basisZ(Nn[3 * ia], Nn[3 * ia + 1], Nn[3 * ia + 2]));
    let near = []; for (let i = 0; i < SA.n; i++) { const dx = P[3 * i] - ax, dy = P[3 * i + 1] - ay, dz = P[3 * i + 2] - az; if (dx * dx + dy * dy + dz * dz < rLoc * rLoc) near.push(i); }
    if (near.length > nLoc) near = spreadPick(P, nLoc, 0, near);
    near.sort((i, j) => ((P[3 * i] - ax) ** 2 + (P[3 * i + 1] - ay) ** 2 + (P[3 * i + 2] - az) ** 2) - ((P[3 * j] - ax) ** 2 + (P[3 * j + 1] - ay) ** 2 + (P[3 * j + 2] - az) ** 2));
    const [L, Ln] = local(FaT, ax, ay, az, near), [G, Gn] = local(FaT, ax, ay, az, gIdx), nL = near.length, nG = gIdx.length;
    const need = Math.max(4, Math.round(nL * 0.15)), mine = [];
    for (const tb of TB) {
      const e = tb.e, px = tb.x, py = tb.y, pz = tb.z;
      // (the grid lookup is written out in full here: this loop runs millions of times)
      const e0 = e[0], e1 = e[1], e2 = e[2], e3 = e[3], e4 = e[4], e5 = e[5], e6 = e[6], e7 = e[7], e8 = e[8];
      for (let s = 0; s < spins; s++) {
        const c = cs[s], si = sn[s]; let touch = 0, sunk = 0; poses++;
        for (let k = 0; k < nL; k++) {
          const lx0 = L[3 * k], ly0 = L[3 * k + 1], lz = L[3 * k + 2], lx = c * lx0 - si * ly0, ly = si * lx0 + c * ly0;
          const x = px + e0 * lx + e1 * ly + e2 * lz, y = py + e3 * lx + e4 * ly + e5 * lz, z = pz + e6 * lx + e7 * ly + e8 * lz;
          const gx = (x - ox) * ic + 0.5, gy = (y - oy) * ic + 0.5, gz = (z - oz) * ic + 0.5;
          if (gx < 0 || gy < 0 || gz < 0 || gx >= gnx || gy >= gny || gz >= gnz) continue;
          const v = (gx | 0) + gnx * ((gy | 0) + gny * (gz | 0)), q = slot[v];
          if (q >= 0) {
            const fx = pl[4 * q], fy = pl[4 * q + 1], fz = pl[4 * q + 2], d = fx * x + fy * y + fz * z - pl[4 * q + 3];
            if (d < -qSink) { if (++sunk > maxSunk) break; }
            else if (d <= qTol) { const nx0 = Ln[3 * k], ny0 = Ln[3 * k + 1], nz = Ln[3 * k + 2], nx = c * nx0 - si * ny0, ny = si * nx0 + c * ny0;
              if (fx * (e0 * nx + e1 * ny + e2 * nz) + fy * (e3 * nx + e4 * ny + e5 * nz) + fz * (e6 * nx + e7 * ny + e8 * nz) < -0.5) touch++; }
          } else if (votes[v] > 0 && ++sunk > maxSunk) break;
          if (k === 24 && touch < 6) break;                 // the anchor's own neighbourhood isn't touching
        }
        if (sunk > maxSunk || touch < need) continue;
        passed++;
        let gt = 0, gs = 0;                                  // the whole part: touching anywhere, passing through anywhere
        for (let k = 0; k < nG; k++) {
          if (gs > gMax) break;                              // it passes right through B somewhere: not a fit
          const lx0 = G[3 * k], ly0 = G[3 * k + 1], lz = G[3 * k + 2], lx = c * lx0 - si * ly0, ly = si * lx0 + c * ly0;
          const x = px + e0 * lx + e1 * ly + e2 * lz, y = py + e3 * lx + e4 * ly + e5 * lz, z = pz + e6 * lx + e7 * ly + e8 * lz;
          const gx = (x - ox) * ic + 0.5, gy = (y - oy) * ic + 0.5, gz = (z - oz) * ic + 0.5;
          if (gx < 0 || gy < 0 || gz < 0 || gx >= gnx || gy >= gny || gz >= gnz) continue;
          const v = (gx | 0) + gnx * ((gy | 0) + gny * (gz | 0)), q = slot[v];
          if (q >= 0) {
            const fx = pl[4 * q], fy = pl[4 * q + 1], fz = pl[4 * q + 2], d = fx * x + fy * y + fz * z - pl[4 * q + 3];
            if (d < -qSink) gs++;
            else if (d <= qTol) { const nx0 = Gn[3 * k], ny0 = Gn[3 * k + 1], nz = Gn[3 * k + 2], nx = c * nx0 - si * ny0, ny = si * nx0 + c * ny0;
              if (fx * (e0 * nx + e1 * ny + e2 * nz) + fy * (e3 * nx + e4 * ny + e5 * nz) + fz * (e6 * nx + e7 * ny + e8 * nz) < -0.5) gt++; }
          } else if (votes[v] > 0) gs++;
        }
        if (gs > gMax) continue;
        const score = touch - sunk + 2 * gt - 3 * gs, cand = { score, ai, ib: tb.ib, s };
        if (mine.length < perAnchor) { mine.push(cand); mine.sort((x, y) => y.score - x.score); }
        else if (score > mine[perAnchor - 1].score) { mine[perAnchor - 1] = cand; mine.sort((x, y) => y.score - x.score); }
        if (best.length < keep || score > minKept) push(cand);
      }
    }
    mineAll.push(...mine);
    if (progress) progress(++done / list.length, poses);
  }
  return { mine: mineAll, best, poses, passed };
}
/** The pose a candidate stands for: anchor on A placed on target on B, facing it, turned by spin s. */
export function poseOf(ctx, c) {
  const { SA, SB, params } = ctx, ia = ctx.anchors[c.ai], ib = c.ib, a = 2 * Math.PI * c.s / params.spins;
  const Fa = basisZ(SA.N[3 * ia], SA.N[3 * ia + 1], SA.N[3 * ia + 2]), Fb = basisZ(-SB.N[3 * ib], -SB.N[3 * ib + 1], -SB.N[3 * ib + 2]);
  const R = mulMM(mulMM(Fb, [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1]), transpose(Fa));
  const pa = mulMV(R, SA.P[3 * ia], SA.P[3 * ia + 1], SA.P[3 * ia + 2]);
  return { R, t: [SB.P[3 * ib] - pa[0], SB.P[3 * ib + 1] - pa[1], SB.P[3 * ib + 2] - pa[2]] };
}

/* ------------------------------------------------------------------------------ refine and measure -- */

/** Flush and sunk point counts for A posed by (R, t), over the sample ids given (all when omitted). */
export function measure(ctx, R, t, ids = null) {
  const { F, SA, params } = ctx, P = SA.P, N = SA.N, f = {}, tol = params.tol, sink = params.sink; let touch = 0, sunk = 0;
  const n = ids ? ids.length : SA.n;
  for (let q = 0; q < n; q++) {
    const i = ids ? ids[q] : q, x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    fieldAt(F, R[0] * x + R[1] * y + R[2] * z + t[0], R[3] * x + R[4] * y + R[5] * z + t[1], R[6] * x + R[7] * y + R[8] * z + t[2], f);
    if (f.s === f.s) {
      if (f.s < -sink) { sunk++; continue; }
      if (f.s <= tol) { const nx = N[3 * i], ny = N[3 * i + 1], nz = N[3 * i + 2];
        if (f.nx * (R[0] * nx + R[1] * ny + R[2] * nz) + f.ny * (R[3] * nx + R[4] * ny + R[5] * nz) + f.nz * (R[6] * nx + R[7] * ny + R[8] * nz) < -0.5) touch++; }
    } else if (f.inside) sunk++;
  }
  return { touch, sunk };
}
/** Pull A's nearly-flush points onto B's surface and push sunk ones out: small least-squares turns and shifts. */
export function refinePose(ctx, R0, t0, opts = {}) {
  const { F, SA } = ctx, refineIdx = opts.ids || ctx.refineIdx, P = SA.P, N = SA.N, f = {};
  let R = R0.slice(), t = t0.slice(); const iters = opts.iters ?? 25, th0 = opts.thr0 ?? 4 * F.cell, th1 = opts.thr1 ?? F.cell;
  const rows = new Float64Array(8 * refineIdx.length);   // x y z, B's facing, distance, weight per point in play
  for (let it = 0; it < iters; it++) {
    const thr = th0 * Math.pow(th1 / th0, it / Math.max(1, iters - 1));
    let m = 0, cx = 0, cy = 0, cz = 0;
    for (const i of refineIdx) {
      const x0 = P[3 * i], y0 = P[3 * i + 1], z0 = P[3 * i + 2];
      const x = R[0] * x0 + R[1] * y0 + R[2] * z0 + t[0], y = R[3] * x0 + R[4] * y0 + R[5] * z0 + t[1], z = R[6] * x0 + R[7] * y0 + R[8] * z0 + t[2];
      fieldAt(F, x, y, z, f); if (f.s !== f.s) continue;
      const nx = N[3 * i], ny = N[3 * i + 1], nz = N[3 * i + 2];
      const dn = f.nx * (R[0] * nx + R[1] * ny + R[2] * nz) + f.ny * (R[3] * nx + R[4] * ny + R[5] * nz) + f.nz * (R[6] * nx + R[7] * ny + R[8] * nz);
      const flush = f.s <= thr && f.s >= -thr && dn < -0.3, deep = f.s < -thr * 0.5;
      if (!flush && !deep) continue;
      rows.set([x, y, z, f.nx, f.ny, f.nz, f.s, deep && !flush ? 2 : 1], 8 * m); m++; cx += x; cy += y; cz += z;
    }
    if (m < 12) break; cx /= m; cy /= m; cz /= m;
    const AtA = Array.from({ length: 6 }, () => new Array(6).fill(0)), Atb = new Array(6).fill(0), J = new Array(6);
    for (let r = 0; r < m; r++) {
      const o = 8 * r, px = rows[o] - cx, py = rows[o + 1] - cy, pz = rows[o + 2] - cz, ax = rows[o + 3], ay = rows[o + 4], az = rows[o + 5], s = rows[o + 6], w = rows[o + 7];
      J[0] = py * az - pz * ay; J[1] = pz * ax - px * az; J[2] = px * ay - py * ax; J[3] = ax; J[4] = ay; J[5] = az;
      for (let a = 0; a < 6; a++) { Atb[a] -= w * J[a] * s; for (let b = 0; b < 6; b++) AtA[a][b] += w * J[a] * J[b]; }
    }
    for (let k = 0; k < 6; k++) AtA[k][k] += 1e-6 * (AtA[k][k] + 1) + (k < 3 ? 1e-3 : 1e-4) * m;
    const x = solve6(AtA, Atb); if (!x) break;
    const ang = Math.hypot(x[0], x[1], x[2]);
    const dR = ang > 1e-12 ? axisAngle(x[0] / ang, x[1] / ang, x[2] / ang, Math.min(ang, 0.15)) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    let dx = x[3], dy = x[4], dz = x[5]; const dl = Math.hypot(dx, dy, dz), cap = 4 * F.cell; if (dl > cap) { dx *= cap / dl; dy *= cap / dl; dz *= cap / dl; }
    R = mulMM(dR, R); const q = mulMV(dR, t[0] - cx, t[1] - cy, t[2] - cz); t = [q[0] + cx + dx, q[1] + cy + dy, q[2] + cz + dz];
    if (ang < 1e-5 && dl < 1e-5) break;
  }
  return { R, t };
}
/** Same pose, near enough: A's centre lands within dmax mm and the turn differs by less than amax degrees. */
export function samePose(ctx, a, b, dmax = 0.6, amax = 6) {
  const c = ctx.params.centre, pa = mulMV(a.R, ...c), pb = mulMV(b.R, ...c);
  if (Math.hypot(pa[0] + a.t[0] - pb[0] - b.t[0], pa[1] + a.t[1] - pb[1] - b.t[1], pa[2] + a.t[2] - pb[2] - b.t[2]) > dmax) return false;
  const M = mulMM(a.R, transpose(b.R)); return (M[0] + M[4] + M[8] - 1) / 2 > Math.cos(amax * Math.PI / 180);
}
/** Refine starting poses and measure each on all the samples. */
export function refineAll(ctx, starts) {
  const out = [];
  for (const st of starts) {
    const r = refinePose(ctx, st.R, st.t), a = measure(ctx, r.R, r.t), b = measure(ctx, st.R, st.t);
    const W = ctx.params.sinkWeight, use = a.touch - W * a.sunk >= b.touch - W * b.sunk ? { ...r, ...a } : { R: st.R, t: st.t, ...b };
    out.push({ R: use.R, t: use.t, contact: use.touch * ctx.wA, sunk: use.sunk * ctx.wA, quick: st.quick ?? 0 });
  }
  return out;
}
/** Order candidates for refining: every anchor's own best few first (so one popular spot can't crowd out the rest), then the best overall. */
export function pickStarts(ctx, mine, best, max = 900) {
  const pool = [...mine.sort((x, y) => y.score - x.score), ...best.sort((x, y) => y.score - x.score)], out = [];
  for (const c of pool) {
    if (out.length >= max) break;
    const p = poseOf(ctx, c); if (out.some(o => samePose(ctx, o, p, 0.8, 8))) continue;
    out.push({ ...p, quick: c.score });
  }
  return out;
}
/** The best few distinct fits, best first. The leaders get a last, finer settle on every sample point. */
export function rankFits(ctx, refined, max = 8) {
  const W = ctx.params.sinkWeight, sc = o => o.contact - W * o.sunk;
  refined.sort((x, y) => sc(y) - sc(x));
  const lead = [];
  for (const o of refined) { if (o.contact <= 0 || lead.some(q => samePose(ctx, q, o, 1.5, 15))) continue; lead.push(o); if (lead.length >= max * 2) break; }
  // settling can stop in a dip a few degrees short of the seat: restart it from small tilts and shifts around
  // each leader and keep whichever lands best
  const all = Array.from({ length: ctx.SA.n }, (_, i) => i), c0 = ctx.params.centre, nudges = [[0, 0, 0, 0]];
  for (const ax of [0, 1, 2]) for (const a of [-8, -4, 4, 8]) nudges.push([1, ax, a * Math.PI / 180, 0]);
  for (const ax of [0, 1, 2]) for (const d of [-0.3, 0.3]) nudges.push([2, ax, 0, d]);
  for (const o of lead.slice(0, Math.max(3, Math.ceil(max / 2)))) {
    const pc = mulMV(o.R, ...c0).map((v, d) => v + o.t[d]);        // the part's centre, where it sits now
    let best = { R: o.R, t: o.t, s: sc(o) };
    for (const [kind, ax, ang, d] of nudges) {
      let R = o.R, t = o.t;
      if (kind === 1) { const u = [0, 0, 0]; u[ax] = 1; const dR = axisAngle(u[0], u[1], u[2], ang); R = mulMM(dR, o.R); const q = mulMV(dR, t[0] - pc[0], t[1] - pc[1], t[2] - pc[2]); t = [q[0] + pc[0], q[1] + pc[1], q[2] + pc[2]]; }
      if (kind === 2) { t = t.slice(); t[ax] += d; }
      const r = refinePose(ctx, R, t, { iters: 40, thr0: 3 * ctx.F.cell, thr1: 0.5 * ctx.F.cell, ids: all }), m = measure(ctx, r.R, r.t);
      const s = (m.touch - W * m.sunk) * ctx.wA;
      if (s > best.s + 1e-9) best = { R: r.R, t: r.t, s, contact: m.touch * ctx.wA, sunk: m.sunk * ctx.wA };
    }
    if (best.contact != null) Object.assign(o, { R: best.R, t: best.t, contact: best.contact, sunk: best.sunk });
  }
  lead.forEach(o => { o.score = sc(o); }); lead.sort((x, y) => y.score - x.score);
  const out = [];
  for (const o of lead) { if (out.some(q => samePose(ctx, q, o, 1.5, 15))) continue; out.push(o); if (out.length >= max) break; }
  return out;
}
/**
 * For a fit: the triangles of A and of B that touch (for showing the contact), the middle of the contact,
 * and the direction B pushes back there (the joint axis, pointing from B out toward A).
 */
export function contactOf(ctx, fit, A, B) {
  const { F, params } = ctx, R = fit.R, t = fit.t, f = {}, tol = params.tol * 1.5, sink = params.sink;
  const vi = (idx, tr, k) => idx ? idx[3 * tr + k] : 3 * tr + k;
  const TA = A.idx ? A.idx.length / 3 : A.pos.length / 9, regionA = [], pts = [];
  let jx = 0, jy = 0, jz = 0, nx = 0, ny = 0, nz = 0, w = 0;
  for (let tr = 0; tr < TA; tr++) {
    const a = 3 * vi(A.idx, tr, 0), b = 3 * vi(A.idx, tr, 1), c = 3 * vi(A.idx, tr, 2), p = A.pos;
    const x0 = (p[a] + p[b] + p[c]) / 3, y0 = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, z0 = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    const x = R[0] * x0 + R[1] * y0 + R[2] * z0 + t[0], y = R[3] * x0 + R[4] * y0 + R[5] * z0 + t[1], z = R[6] * x0 + R[7] * y0 + R[8] * z0 + t[2];
    fieldAt(F, x, y, z, f); if (!(f.s === f.s) || f.s < -sink || f.s > tol) continue;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, ar = Math.hypot(cx, cy, cz) / 2; if (!(ar > 0)) continue;
    const m = mulMV(R, cx, cy, cz); if ((f.nx * m[0] + f.ny * m[1] + f.nz * m[2]) / (2 * ar) > -0.3) continue;
    regionA.push(tr); pts.push(x, y, z); jx += x * ar; jy += y * ar; jz += z * ar; nx += f.nx * ar; ny += f.ny * ar; nz += f.nz * ar; w += ar;
  }
  if (!w) return { regionA: [], regionB: [], joint: [...mulMV(R, ...params.centre)].map((v, d) => v + t[d]), axis: [0, 0, 1] };
  const nl = Math.hypot(nx, ny, nz) || 1;
  // B's triangles near A's touching ones
  const h = Math.max(tol * 2, params.cell * 2), grid = new Set(), key = (i, j, k) => i + ',' + j + ',' + k;
  for (let q = 0; q < pts.length; q += 3) grid.add(key(Math.floor(pts[q] / h), Math.floor(pts[q + 1] / h), Math.floor(pts[q + 2] / h)));
  const TB = B.idx ? B.idx.length / 3 : B.pos.length / 9, regionB = [];
  for (let tr = 0; tr < TB; tr++) {
    const a = 3 * vi(B.idx, tr, 0), b = 3 * vi(B.idx, tr, 1), c = 3 * vi(B.idx, tr, 2), p = B.pos;
    const x = (p[a] + p[b] + p[c]) / 3, y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
    if (grid.has(key(Math.floor(x / h), Math.floor(y / h), Math.floor(z / h)))) regionB.push(tr);
  }
  return { regionA, regionB, joint: [jx / w, jy / w, jz / w], axis: [nx / nl, ny / nl, nz / nl] };
}

/** The whole search in one go on this thread (the page uses workers instead; tests use this). */
export function luckyFits(A, B, opts = {}) {
  const t0 = performance.now(), ctx = prepare(A, B, opts), t1 = performance.now();
  const all = [...ctx.anchors.keys()], s = searchAnchors(ctx, all, opts.progress), t2 = performance.now();
  const starts = pickStarts(ctx, s.mine, s.best, opts.nRefine ?? 900), fits = rankFits(ctx, refineAll(ctx, starts), opts.results ?? 8);
  for (const fit of fits) Object.assign(fit, contactOf(ctx, fit, A, B));
  return { fits, ctx, stats: { cell: ctx.params.cell, poses: s.poses, passed: s.passed, anchors: ctx.anchors.length, targets: ctx.targets.length, refined: starts.length, prepare: (t1 - t0) / 1000, search: (t2 - t1) / 1000, refine: (performance.now() - t2) / 1000 } };
}
