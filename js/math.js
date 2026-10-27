// Kitbash Bench: pure geometry (no DOM). Exercised by the test harness on its own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ==MATH START==  (pure geometry, no DOM; exercised by the test harness)

/** Adjacency + per-triangle data for an indexed geometry. */
function buildTopo(geom) {
  const idx = geom.index.array, pos = geom.attributes.position.array;
  const T = idx.length / 3, Vn = pos.length / 3;
  const fn = new Float32Array(T * 3), fc = new Float32Array(T * 3), fa = new Float32Array(T);
  for (let t = 0; t < T; t++) {
    const a = idx[3*t]*3, b = idx[3*t+1]*3, c = idx[3*t+2]*3;
    const ux = pos[b]-pos[a], uy = pos[b+1]-pos[a+1], uz = pos[b+2]-pos[a+2];
    const vx = pos[c]-pos[a], vy = pos[c+1]-pos[a+1], vz = pos[c+2]-pos[a+2];
    let nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
    const L = Math.hypot(nx, ny, nz);
    fa[t] = L / 2;
    if (L > 0) { nx /= L; ny /= L; nz /= L; }
    fn[3*t] = nx; fn[3*t+1] = ny; fn[3*t+2] = nz;
    fc[3*t] = (pos[a]+pos[b]+pos[c])/3; fc[3*t+1] = (pos[a+1]+pos[b+1]+pos[c+1])/3; fc[3*t+2] = (pos[a+2]+pos[b+2]+pos[c+2])/3;
  }
  const nb = new Int32Array(T * 3).fill(-1);
  const open = new Map();
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
    const a = idx[3*t+e], b = idx[3*t+(e+1)%3];
    const key = a < b ? a * Vn + b : b * Vn + a;
    const o = open.get(key);
    if (o === undefined) open.set(key, 3*t+e);
    else { open.delete(key); nb[3*t+e] = (o / 3) | 0; nb[o] = t; }
  }
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i+k]); mx[k] = Math.max(mx[k], pos[i+k]); }
  const diag = Math.hypot(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) || 1;
  // vertex -> triangles, so regions can also cross T-junctions (a corner sitting mid-edge)
  const vtOff = new Int32Array(Vn + 1);
  for (let i = 0; i < idx.length; i++) vtOff[idx[i] + 1]++;
  for (let i = 0; i < Vn; i++) vtOff[i + 1] += vtOff[i];
  const vtList = new Int32Array(idx.length), fillAt = vtOff.slice(0, Vn);
  for (let i = 0; i < idx.length; i++) vtList[fillAt[idx[i]]++] = (i / 3) | 0;
  return { idx, pos, T, fn, fc, fa, nb, vtOff, vtList, diag, eps: diag * diag * 1e-12 };
}

/** Flood from `start` to every triangle sharing a corner with the region while test(from, to) holds. */
function growRegion(topo, start, test, cap = Infinity) {
  const { idx, vtOff, vtList } = topo;
  const flags = new Uint8Array(topo.T); flags[start] = 1;
  const list = [start], stack = [start];
  while (stack.length && list.length < cap) {
    const t = stack.pop();
    for (let k = 0; k < 3; k++) {
      const v = idx[3*t+k];
      for (let j = vtOff[v]; j < vtOff[v+1]; j++) {
        const n = vtList[j];
        if (!flags[n] && test(t, n)) { flags[n] = 1; list.push(n); stack.push(n); }
      }
    }
  }
  return { flags, list };
}

function solve4(A, b) {           // Gaussian elimination with partial pivoting
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 4; c++) {
    let p = c; for (let r = c+1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 4; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k < 5; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[4] / r[i]);
}

function fitSphereOnce(P, keep) {
  let n = 0, mx = 0, my = 0, mz = 0;
  for (let i = 0; i < P.length; i += 3) if (!keep || keep[i/3]) { mx += P[i]; my += P[i+1]; mz += P[i+2]; n++; }
  if (n < 4) return null;
  mx /= n; my /= n; mz /= n;
  const A = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], B = [0,0,0,0];
  for (let i = 0; i < P.length; i += 3) {
    if (keep && !keep[i/3]) continue;
    const x = P[i]-mx, y = P[i+1]-my, z = P[i+2]-mz, row = [2*x, 2*y, 2*z, 1], rhs = x*x+y*y+z*z;
    for (let r = 0; r < 4; r++) { B[r] += row[r]*rhs; for (let c = 0; c < 4; c++) A[r][c] += row[r]*row[c]; }
  }
  const s = solve4(A, B); if (!s) return null;
  const r2 = s[3] + s[0]*s[0] + s[1]*s[1] + s[2]*s[2];
  if (!(r2 > 0)) return null;
  return { c: V(s[0]+mx, s[1]+my, s[2]+mz), r: Math.sqrt(r2) };
}

/** Least-squares sphere through points (flat xyz array), trimming points off the sphere. */
function fitSphere(P, trim = 0.05) {
  let fit = fitSphereOnce(P), keep = null;
  for (let it = 0; it < 6 && fit; it++) {
    const tol = Math.max(fit.r * trim, 1e-4), next = new Uint8Array(P.length / 3);
    let cnt = 0, same = true;
    for (let i = 0; i < P.length; i += 3) {
      const d = Math.abs(Math.hypot(P[i]-fit.c.x, P[i+1]-fit.c.y, P[i+2]-fit.c.z) - fit.r);
      next[i/3] = d < tol ? 1 : 0; cnt += next[i/3];
      if (keep && keep[i/3] !== next[i/3]) same = false;
    }
    if (cnt < 4 || (keep && same)) break;
    keep = next; fit = fitSphereOnce(P, keep) || fit;
  }
  return fit && { ...fit, keep };
}

function boundaryLoops(topo, region) {
  const { idx, pos, nb } = topo, edges = [];
  for (const t of region.list) for (let e = 0; e < 3; e++) {
    const n = nb[3*t+e];
    if (n < 0 || !region.flags[n]) edges.push([idx[3*t+e], idx[3*t+(e+1)%3]]);
  }
  const byStart = new Map();
  edges.forEach((e, i) => { if (!byStart.has(e[0])) byStart.set(e[0], []); byStart.get(e[0]).push(i); });
  const used = new Uint8Array(edges.length), loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const loop = []; let cur = i;
    while (cur !== undefined && !used[cur]) {
      used[cur] = 1; loop.push(edges[cur]);
      const cand = byStart.get(edges[cur][1]) || [];
      cur = cand.find(j => !used[j]);
    }
    let L = 0; const c = V();
    for (const [a, b] of loop) {
      const ax = pos[3*a], ay = pos[3*a+1], az = pos[3*a+2], bx = pos[3*b], by = pos[3*b+1], bz = pos[3*b+2];
      const l = Math.hypot(bx-ax, by-ay, bz-az); L += l;
      c.x += (ax+bx)/2*l; c.y += (ay+by)/2*l; c.z += (az+bz)/2*l;
    }
    if (L > 0) c.multiplyScalar(1 / L);
    loops.push({ edges: loop, center: c, length: L });
  }
  return loops;
}

const triNormal = (topo, t) => V(topo.fn[3*t], topo.fn[3*t+1], topo.fn[3*t+2]);
const triCenter = (topo, t) => V(topo.fc[3*t], topo.fc[3*t+1], topo.fc[3*t+2]);
const worldNormal = (M, n) => n.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(M)).normalize();

/**
 * Ball / socket. Grows outward from the click in rings. Once the patch curves enough to measure,
 * a sphere is fitted, and from then on a triangle only joins if its corners lie on that sphere and
 * it faces along the radius. Growth stops where the cup or ball ends, even when it blends smoothly
 * into the rest of a sculpt. Sharp creases (Ball crease angle) and the max radius are hard stops.
 */
function pickBall(topo, M, tri, hitWorld, opts) {
  const { idx, pos, fn, fc, fa, eps, vtOff, vtList, T } = topo;
  const cosCrease = Math.cos(opts.smoothDeg * Math.PI / 180), cosRadial = Math.cos(35 * Math.PI / 180);
  const hitLocal = hitWorld.clone().applyMatrix4(M.clone().invert());
  const S = new THREE.Vector3().setFromMatrixScale(M), sc = Math.max(S.x, S.y, S.z) || 1;
  const rLocal = opts.maxRadius > 0 ? opts.maxRadius / sc : Infinity;
  const tolFrac = (opts.ballTol ?? 3) / 100;
  const flags = new Uint8Array(T), list = [tri], queue = [tri]; flags[tri] = 1;
  let fit = null, fitAt = 0, qh = 0;
  const seed = { n: triNormal(topo, tri).multiplyScalar(fa[tri]), spread: 0 };
  const collect = () => { const seen = new Set(), P = [];
    for (const t of list) for (let k = 0; k < 3; k++) seen.add(idx[3*t+k]);
    const ids = [...seen], step = Math.max(1, Math.floor(ids.length / 20000));
    for (let i = 0; i < ids.length; i += step) P.push(pos[3*ids[i]], pos[3*ids[i]+1], pos[3*ids[i]+2]);
    return P; };
  const refit = () => { const f = fitSphereOnce(collect()); if (f && f.r < topo.diag * 4) fit = f; fitAt = list.length; };
  const onSphere = n => {
    const tol = Math.max(fit.r * tolFrac, (opts.flatTol || 0.02) / sc * 0.5);
    for (let k = 0; k < 3; k++) { const i = 3 * idx[3*n+k];
      if (Math.abs(Math.hypot(pos[i]-fit.c.x, pos[i+1]-fit.c.y, pos[i+2]-fit.c.z) - fit.r) > tol) return false; }
    if (fa[n] < eps) return true;
    const rx = fc[3*n]-fit.c.x, ry = fc[3*n+1]-fit.c.y, rz = fc[3*n+2]-fit.c.z, L = Math.hypot(rx, ry, rz) || 1;
    return Math.abs((fn[3*n]*rx + fn[3*n+1]*ry + fn[3*n+2]*rz) / L) > cosRadial;
  };
  const curvedEnough = () => list.length >= 24 && seed.spread > 0.06;     // ~14° of bend across the patch
  const seedDir = () => seed.n.clone().normalize();
  while (qh < queue.length) {
    const t = queue[qh++];
    for (let k = 0; k < 3; k++) {
      const v = idx[3*t+k];
      for (let j = vtOff[v]; j < vtOff[v+1]; j++) {
        const n = vtList[j];
        if (flags[n]) continue;
        if (fa[n] >= eps && fa[t] >= eps && fn[3*t]*fn[3*n] + fn[3*t+1]*fn[3*n+1] + fn[3*t+2]*fn[3*n+2] < cosCrease) continue;
        if (rLocal !== Infinity && Math.hypot(fc[3*n]-hitLocal.x, fc[3*n+1]-hitLocal.y, fc[3*n+2]-hitLocal.z) > rLocal) continue;
        if (fit && !onSphere(n)) continue;
        flags[n] = 1; list.push(n); queue.push(n);
        if (!fit) {                                 // still seeding: track how much the patch bends
          seed.n.addScaledVector(triNormal(topo, n), fa[n]);
          if (fa[n] >= eps) seed.spread = Math.max(seed.spread, 1 - Math.abs(triNormal(topo, n).dot(seedDir())));
          if (curvedEnough()) refit();
        } else if (list.length > fitAt * 1.25) refit();
      }
    }
  }
  if (!fit) return { err: "That surface is too flat to fit a ball. Click nearer the middle of the ball or cup." };
  const P = collect(), final = fitSphere(P, Math.min(tolFrac * 0.5, 0.015)) || fit;
  if (final.r > topo.diag * 4) return { err: "That surface is too flat to fit a ball" };
  const c = final.c.clone().applyMatrix4(M), r = final.r * sc;
  return { point: c, normal: hitWorld.clone().sub(c).normalize(), region: list, info: `ball ⌀${(r*2).toFixed(2)} mm`, radius: r };
}

function planeBasis(n) {
  const u = Math.abs(n.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0);
  u.addScaledVector(n, -u.dot(n)).normalize();
  return { u, v: n.clone().cross(u) };
}
function regionPlane(topo, list) {           // area-weighted normal and centroid
  const n = V(), c = V(); let A = 0;
  for (const t of list) { const a = topo.fa[t]; A += a;
    n.x += topo.fn[3*t]*a; n.y += topo.fn[3*t+1]*a; n.z += topo.fn[3*t+2]*a;
    c.x += topo.fc[3*t]*a; c.y += topo.fc[3*t+1]*a; c.z += topo.fc[3*t+2]*a; }
  return A > 0 && n.length() > 0 ? { n: n.normalize(), p: c.multiplyScalar(1 / A), A } : null;
}

/**
 * Holes in a flat face (rim of a hole, or the base of a peg), found by drawing the face onto a fine
 * 2D grid and looking for enclosed empty areas. Seams, T-junctions and sliver triangles can't fake
 * or hide a hole this way. Coordinates are in the plane basis (u, v) around p0.
 */
function rasterHoles(topo, list, p0, u, v) {
  const { idx, pos, fa, eps } = topo;
  const P = new Map(), tmp = V();
  const uv = i => { let q = P.get(i); if (!q) { tmp.set(pos[3*i]-p0.x, pos[3*i+1]-p0.y, pos[3*i+2]-p0.z); q = [tmp.dot(u), tmp.dot(v)]; P.set(i, q); } return q; };
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const t of list) for (let k = 0; k < 3; k++) { const [x, y] = uv(idx[3*t+k]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cell = Math.max(Math.max(x1 - x0, y1 - y0) / 1024, 1e-6), pad = 2;
  const nx = Math.ceil((x1 - x0) / cell) + 2 * pad, ny = Math.ceil((y1 - y0) / cell) + 2 * pad;
  const ox = x0 - pad * cell, oy = y0 - pad * cell, grid = new Uint8Array(nx * ny), grow = cell * 0.75;
  for (const t of list) {
    if (fa[t] < eps) continue;
    const a = uv(idx[3*t]), b = uv(idx[3*t+1]), c = uv(idx[3*t+2]);
    const sgn = Math.sign((b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])); if (!sgn) continue;
    // each edge as  A*x + B*y + C >= 0  inside, widened by `grow`
    let ex = b[0]-a[0], ey = b[1]-a[1], L = Math.hypot(ex, ey) || 1;
    const A0 = -ey*sgn/L, B0 = ex*sgn/L, C0 = -(A0*a[0] + B0*a[1]) + grow;
    ex = c[0]-b[0]; ey = c[1]-b[1]; L = Math.hypot(ex, ey) || 1;
    const A1 = -ey*sgn/L, B1 = ex*sgn/L, C1 = -(A1*b[0] + B1*b[1]) + grow;
    ex = a[0]-c[0]; ey = a[1]-c[1]; L = Math.hypot(ex, ey) || 1;
    const A2 = -ey*sgn/L, B2 = ex*sgn/L, C2 = -(A2*c[0] + B2*c[1]) + grow;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - grow - ox) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) + grow - ox) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - grow - oy) / cell)), j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) + grow - oy) / cell));
    for (let j = j0; j <= j1; j++) { const y = oy + (j + 0.5) * cell, row = j * nx;
      for (let i = i0; i <= i1; i++) { const x = ox + (i + 0.5) * cell;
        if (A0*x + B0*y + C0 >= 0 && A1*x + B1*y + C1 >= 0 && A2*x + B2*y + C2 >= 0) grid[row + i] = 1; } }
  }
  const q = new Int32Array(nx * ny); let qh = 0, qt = 0;              // empty cells reachable from outside
  const push = k => { if (grid[k] === 0) { grid[k] = 2; q[qt++] = k; } };
  for (let i = 0; i < nx; i++) { push(i); push((ny - 1) * nx + i); }
  for (let j = 0; j < ny; j++) { push(j * nx); push(j * nx + nx - 1); }
  const flood = () => { while (qh < qt) { const k = q[qh++], i = k % nx;
    if (i > 0) push(k - 1); if (i < nx - 1) push(k + 1); if (k >= nx) push(k - nx); if (k < (ny - 1) * nx) push(k + nx); } };
  flood();
  const holes = [];
  for (let k = 0; k < grid.length; k++) {
    if (grid[k] !== 0) continue;
    qh = qt = 0; push(k); let sx = 0, sy = 0, n = 0;
    while (qh < qt) { const m = q[qh++], i = m % nx, j = (m / nx) | 0; sx += i; sy += j; n++;
      if (i > 0) push(m - 1); if (i < nx - 1) push(m + 1); if (m >= nx) push(m - nx); if (m < (ny - 1) * nx) push(m + nx); }
    const r = Math.sqrt(n / Math.PI) * cell + grow;                  // undo the drawing's slight overlap
    holes.push({ x: ox + (sx / n + 0.5) * cell, y: oy + (sy / n + 0.5) * cell, area: Math.PI * r * r, r, cells: n });
  }
  return { holes, cell };
}

/**
 * Flat face. The face is every connected triangle whose corners all sit within `flatTol` mm of
 * the face's own best-fit plane, so slightly uneven faces from sculpts and decimation still count
 * as one face. Returns every candidate centre; the snap picks one by the chosen "Centre on" mode.
 */
function pickFlat(topo, M, tri, hitWorld, opts) {
  const { idx, pos, fn, fa, eps } = topo;
  const S = new THREE.Vector3().setFromMatrixScale(M), sc = Math.max(S.x, S.y, S.z) || 1;
  const dtol = Math.max(opts.flatTol / sc, topo.diag * 2e-5);
  const hitLocal = hitWorld.clone().applyMatrix4(M.clone().invert());
  const cornersOnPlane = (n, n0, p0) => {
    if (fa[n] >= eps && fn[3*n]*n0.x + fn[3*n+1]*n0.y + fn[3*n+2]*n0.z <= 0.2) return false;
    for (let k = 0; k < 3; k++) { const i = 3 * idx[3*n+k];
      if (Math.abs((pos[i]-p0.x)*n0.x + (pos[i+1]-p0.y)*n0.y + (pos[i+2]-p0.z)*n0.z) > dtol) return false; }
    return true;
  };
  // 1. reference plane: area-weighted normal of a small disc around the click (a tilted sliver
  //    under the cursor barely counts), then drop off-plane triangles and refit
  const near = discAround(topo, tri, hitLocal, 40);
  // start from the clicked triangle (big CAD faces reach past their edges in any sample around the click)
  let n0 = topo.fa[tri] >= topo.eps ? triNormal(topo, tri) : (regionPlane(topo, near) || { n: V(0, 0, 1) }).n;
  if (n0.lengthSq() === 0) n0 = V(0, 0, 1);
  for (const deg of [30, 15, 8]) {
    const cos = Math.cos(deg * Math.PI / 180), ref = n0.clone();
    const pl = regionPlane(topo, near.filter(n => fn[3*n]*ref.x + fn[3*n+1]*ref.y + fn[3*n+2]*ref.z > cos)); if (pl) n0 = pl.n;
  }
  let p0 = (regionPlane(topo, near.filter(n => topo.fa[n] < topo.eps || triNormal(topo, n).dot(n0) > Math.cos(8 * Math.PI / 180))) || { p: hitLocal }).p;
  p0 = hitLocal.clone().addScaledVector(n0, p0.clone().sub(hitLocal).dot(n0));   // through the disc's average height
  // 2. grow the face, refit its plane, grow again so the result doesn't depend on where you clicked
  let region = growRegion(topo, tri, (t, n) => cornersOnPlane(n, n0, p0));
  for (let it = 0; it < 4; it++) {
    const fit = regionPlane(topo, region.list); if (!fit) break;
    const moved = fit.n.angleTo(n0) > 1e-4 || Math.abs(fit.p.clone().sub(p0).dot(fit.n)) > dtol * 0.05;
    if (!moved) break;
    const next = growRegion(topo, tri, (t, n) => cornersOnPlane(n, fit.n, fit.p));
    if (next.list.length < region.list.length * 0.98) break;     // refit made it worse: keep what we had
    n0 = fit.n; p0 = fit.p; region = next;
  }
  { const fit = regionPlane(topo, region.list); if (fit) { n0 = fit.n; p0 = fit.p; } }
  const { u, v } = planeBasis(n0);
  const onPlane = c => c.clone().addScaledVector(n0, -c.clone().sub(p0).dot(n0));
  const to3 = (x, y) => p0.clone().addScaledVector(u, x).addScaledVector(v, y);
  const fit = regionPlane(topo, region.list) || { p: p0, A: 0 };
  // centre candidates
  const area = onPlane(fit.p);
  const P2 = [], seen = new Set();
  for (const t of region.list) for (let k = 0; k < 3; k++) { const i = idx[3*t+k]; if (seen.has(i)) continue; seen.add(i);
    const d = V(pos[3*i], pos[3*i+1], pos[3*i+2]).sub(p0); P2.push(d.dot(u), d.dot(v)); }
  let mx = 0, my = 0; for (let i = 0; i < P2.length; i += 2) { mx += P2[i]; my += P2[i+1]; } mx /= P2.length / 2; my /= P2.length / 2;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < P2.length; i += 2) { const x = P2[i]-mx, y = P2[i+1]-my; sxx += x*x; syy += y*y; sxy += x*y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), ca = Math.cos(th), sa = Math.sin(th);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;   // box along the face's own long axis
  for (let i = 0; i < P2.length; i += 2) { const x = P2[i]*ca + P2[i+1]*sa, y = -P2[i]*sa + P2[i+1]*ca;
    a0 = Math.min(a0, x); a1 = Math.max(a1, x); b0 = Math.min(b0, y); b1 = Math.max(b1, y); }
  const bx = (a0 + a1) / 2, by = (b0 + b1) / 2;
  const bounds = to3(bx*ca - by*sa, bx*sa + by*ca);
  const click = onPlane(hitLocal);
  // rings: holes in the face. Grid finds them; a clean outline loop, when there is one, gives the exact centre.
  let ring = null, ringInfo = null, ringNear = false;
  const { holes, cell } = rasterHoles(topo, region.list, p0, u, v);
  const minArea = Math.max(fit.A * 2e-4, cell * cell * 30, dtol * dtol * 100);
  const real = holes.filter(h => h.area > minArea);
  if (real.length) {
    const hc = [onPlane(hitLocal).sub(p0).dot(u), onPlane(hitLocal).sub(p0).dot(v)];
    const best = real.reduce((a, b) => (Math.hypot(b.x - hc[0], b.y - hc[1]) < Math.hypot(a.x - hc[0], a.y - hc[1]) ? b : a));
    ring = to3(best.x, best.y);
    const loop = boundaryLoops(topo, region).find(l => l.length > 0 && onPlane(l.center).distanceTo(ring) < Math.max(cell * 2, best.r * 0.05)
      && Math.abs(l.length / (2 * Math.PI) - best.r) < best.r * 0.25);
    if (loop) ring = onPlane(loop.center);
    ringInfo = `ring ⌀≈${(2 * best.r * sc).toFixed(2)} mm`;
    ringNear = onPlane(hitLocal).distanceTo(ring) <= Math.max(3 * best.r, best.r + 2 / sc);   // clicked next to the peg/hole
  }
  const W = c => c && c.clone().applyMatrix4(M);
  const candidates = { ring: W(ring), area: W(area), bounds: W(bounds), click: W(click) };
  const useRing = ring && ringNear;
  return { point: useRing ? candidates.ring : candidates.area, normal: worldNormal(M, n0), region: region.list,
           candidates, ringInfo, ringNear, info: useRing ? `peg/hole ${ringInfo}` : ringInfo ? `face centre (a ${ringInfo} is here too)` : "face centre" };
}

/** Triangles connected to `tri` whose centres lie within a disc around `hitLocal`; the disc widens until it holds `want`. */
function discAround(topo, tri, hitLocal, want) {
  const { fc } = topo; let r = 0;
  { const c = triCenter(topo, tri); for (let k = 0; k < 3; k++) { const i = topo.idx[3*tri+k];
      r = Math.max(r, V(topo.pos[3*i], topo.pos[3*i+1], topo.pos[3*i+2]).distanceTo(c)); } }
  r = Math.max(r * 2, topo.diag * 1e-4);
  let list = [tri];
  for (let it = 0; it < 12; it++) {
    const R = r;
    list = growRegion(topo, tri, (t, n) => Math.hypot(fc[3*n]-hitLocal.x, fc[3*n+1]-hitLocal.y, fc[3*n+2]-hitLocal.z) < R, want * 8).list;
    if (list.length >= want) break;
    r *= 1.6;
  }
  return list;
}

/** Which centre a flat pick uses for a given "Centre on" mode, and a label for it. */
function resolveCentre(e, mode) {
  const c = e.candidates;
  if (!c) return { point: e.point, label: null };
  if (mode === 'ring' || (mode === 'auto' && e.ringNear)) {
    if (c.ring) return { point: c.ring, label: `peg/hole ${e.ringInfo}` };
    return { point: c.area, label: 'no peg or hole here, face centre' };
  }
  if (mode === 'auto') return { point: c.area, label: 'face centre' };
  return { point: c[mode], label: { area: 'face centre', bounds: 'box centre', click: 'clicked spot' }[mode] };
}

/**
 * Weld an STL triangle soup into a connected mesh. Corners within `tol` of each other become one
 * vertex even when float rounding puts them in different grid cells; collapsed triangles are dropped.
 */
function weldGeometry(geom, tolRel = 1e-5) {
  const src = geom.index ? geom.toNonIndexed() : geom;
  const p = src.attributes.position.array, n = p.length / 3;
  let mn = [Infinity, Infinity, Infinity], mxv = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i+k]); mxv[k] = Math.max(mxv[k], p[i+k]); }
  const diag = Math.hypot(mxv[0]-mn[0], mxv[1]-mn[1], mxv[2]-mn[2]) || 1;
  const tol = Math.max(diag * tolRel, 1e-6), tol2 = tol * tol, cell = tol * 2, inv = 1 / cell;
  const buckets = new Map(), out = [], remap = new Uint32Array(n);
  const key = (x, y, z) => ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0;
  for (let i = 0; i < n; i++) {
    const x = p[3*i], y = p[3*i+1], z = p[3*i+2];
    const fx = x * inv, fy = y * inv, fz = z * inv, cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
    const ox = fx - cx < 0.5 ? cx - 1 : cx + 1, oy = fy - cy < 0.5 ? cy - 1 : cy + 1, oz = fz - cz < 0.5 ? cz - 1 : cz + 1;
    let found = -1;
    search: for (const X of [cx, ox]) for (const Y of [cy, oy]) for (const Z of [cz, oz]) {
      const b = buckets.get(key(X, Y, Z)); if (!b) continue;
      for (const j of b) { const dx = out[3*j]-x, dy = out[3*j+1]-y, dz = out[3*j+2]-z; if (dx*dx + dy*dy + dz*dz <= tol2) { found = j; break search; } }
    }
    if (found < 0) {
      found = out.length / 3; out.push(x, y, z);
      const k = key(cx, cy, cz); let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(found);
    }
    remap[i] = found;
  }
  const index = [];
  for (let t = 0; t < n; t += 3) { const a = remap[t], b = remap[t+1], c = remap[t+2]; if (a !== b && b !== c && a !== c) index.push(a, b, c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.setIndex(out.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  return g;
}

function pickPoint(topo, M, tri, hitWorld, exact) {
  let p = hitWorld.clone();
  if (!exact) {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const i = topo.idx[3*tri+k], w = V(topo.pos[3*i], topo.pos[3*i+1], topo.pos[3*i+2]).applyMatrix4(M);
      const d = w.distanceTo(hitWorld); if (d < best) { best = d; p = w; }
    }
  }
  return { point: p, normal: worldNormal(M, triNormal(topo, tri)), region: null, info: exact ? "surface point" : "vertex" };
}

/** Midpoint of two surfaces, the axis across them (from surface 2 toward 1) and their distance apart. */
function gapMidframe(p1, n1, p2, n2) {
  const mid = p1.clone().add(p2).multiplyScalar(0.5);
  const axis = n1.clone().sub(n2);
  if (axis.length() < 1e-6) axis.copy(n1);
  axis.normalize();
  const d = p1.clone().sub(p2);
  if (axis.dot(d) < 0) axis.negate();
  return { mid, axis, width: Math.abs(d.dot(axis)) };
}

function frame3(p0, p1, p2) {
  const x = p1.clone().sub(p0), z = x.clone().cross(p2.clone().sub(p0));
  if (x.length() < 1e-9 || z.length() < 1e-9) return null;
  x.normalize(); z.normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p0);
}

const Tr = v => new THREE.Matrix4().makeTranslation(v.x, v.y, v.z);
const rotBetween = (a, b) => new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(a, b));

/** World transform for the moving part, plus the joint point and axis. */
function computeSnap(op) {
  const { mode, a, b, p } = op;
  const spin = (p.spin || 0) * Math.PI / 180;
  if (mode === 'MATCH') {               // the fit was found when the op was made; spin and gap adjust it
    const m = op.match.results[op.match.chosen], n = m.axis.clone().normalize(), c = m.joint.clone();
    const S = Tr(c).multiply(new THREE.Matrix4().makeRotationAxis(n, spin)).multiply(Tr(c.clone().negate()));
    return { T: Tr(n.clone().multiplyScalar(p.gap || 0)).multiply(S).multiply(m.T), joint: c.addScaledVector(n, p.gap || 0), axis: n };
  }
  if (mode === 'BALL') {
    return { T: Tr(b[0].point.clone().sub(a[0].point)), joint: b[0].point.clone(), axis: null };
  }
  if (mode === 'PLANE') {
    const nA = a[0].normal.clone().normalize(), nB = b[0].normal.clone().normalize();
    const R = rotBetween(nA, p.flip ? nB : nB.clone().negate());
    let base = Tr(b[0].point).multiply(R).multiply(Tr(a[0].point.clone().negate())), pivot = b[0].point.clone();
    if (op.seat) { base = op.seat.T.clone().multiply(base); pivot = op.seat.joint.clone(); }   // turned and slid until the parts fit together
    const S = Tr(pivot).multiply(new THREE.Matrix4().makeRotationAxis(nB, spin)).multiply(Tr(pivot.clone().negate()));
    const joint = pivot.clone().addScaledVector(nB, p.gap || 0);
    return { T: Tr(nB.clone().multiplyScalar(p.gap || 0)).multiply(S).multiply(base), joint, axis: nB };
  }
  if (mode === 'MID') {
    const A = gapMidframe(a[0].point, a[0].normal, a[1].point, a[1].normal);
    const B = gapMidframe(b[0].point, b[0].normal, b[1].point, b[1].normal);
    const R = rotBetween(A.axis, p.flip ? B.axis.clone().negate() : B.axis);
    const S = new THREE.Matrix4().makeRotationAxis(B.axis, spin);
    let joint = B.mid.clone().addScaledVector(B.axis, p.gap || 0);
    if (p.across) joint = A.mid.clone().addScaledVector(B.axis, B.mid.clone().sub(A.mid).dot(B.axis) + (p.gap || 0));
    return { T: Tr(joint).multiply(S).multiply(R).multiply(Tr(A.mid.clone().negate())), joint, axis: B.axis,
             widthA: A.width, widthB: B.width };
  }
  const MA = frame3(a[0].point, a[1].point, a[2].point), MB = frame3(b[0].point, b[1].point, b[2].point);
  if (!MA || !MB) return { err: "Three points on one part are in a straight line" };
  return { T: MB.clone().multiply(MA.clone().invert()), joint: b[0].point.clone(), axis: V().setFromMatrixColumn(MB, 2) };
}

/** Binary STL of meshes in their current world pose. */
function writeSTL(meshes) {
  const idxOf = g => g.index ? g.index.array : (g.userData.seqIdx ||= Uint32Array.from({ length: g.attributes.position.count }, (_, i) => i));   // cut meshes come unindexed
  let n = 0; for (const m of meshes) n += idxOf(m.geometry).length / 3;
  const buf = new ArrayBuffer(84 + 50 * n), dv = new DataView(buf);
  const head = "Kitbash Bench export (mm)";
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84; const a = V(), b = V(), c = V(), u = V(), w = V();
  for (const m of meshes) {
    const M = m.matrixWorld, flip = M.determinant() < 0, idx = idxOf(m.geometry), pos = m.geometry.attributes.position.array;
    for (let t = 0; t < idx.length; t += 3) {
      a.fromArray(pos, idx[t]*3).applyMatrix4(M); b.fromArray(pos, idx[t+1]*3).applyMatrix4(M); c.fromArray(pos, idx[t+2]*3).applyMatrix4(M);
      if (flip) { const tmp = b.clone(); b.copy(c); c.copy(tmp); }
      u.subVectors(b, a); w.subVectors(c, a); u.cross(w).normalize();
      for (const v of [u, a, b, c]) { dv.setFloat32(o, v.x, true); dv.setFloat32(o+4, v.y, true); dv.setFloat32(o+8, v.z, true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
  }
  return buf;
}

/**
 * Cross-section of a mesh by a world plane, near `centre` (within R). Returns 2D segments
 * [x1,y1,x2,y2,...] in the cut's own (u, v) axes around `centre`. Uses the mesh's BVH when given one.
 */
function sliceMesh(geom, M, plane, centre, R, u, v, bvh) {
  const inv = M.clone().invert(), lp = plane.clone().applyMatrix4(inv);
  const S = new THREE.Vector3().setFromMatrixScale(M), sc = Math.max(S.x, S.y, S.z) || 1;
  const sphere = new THREE.Sphere(centre.clone().applyMatrix4(inv), (R * 1.5) / sc);
  const out = [], pa = V(), pb = V(), w = V();
  const n = lp.normal, k = lp.constant;
  const emit = (p) => { w.copy(p).applyMatrix4(M).sub(centre); out.push(w.dot(u), w.dot(v)); };
  const cut = (a, b, c) => {
    const da = n.dot(a) + k, db = n.dot(b) + k, dc = n.dot(c) + k;
    const sa = da >= 0, sb = db >= 0, scc = dc >= 0;
    if (sa === sb && sb === scc) return;
    let m = 0;
    if (sa !== sb) { (m++ ? pb : pa).lerpVectors(a, b, da / (da - db)); }
    if (sb !== scc) { (m++ ? pb : pa).lerpVectors(b, c, db / (db - dc)); }
    if (scc !== sa) { (m++ ? pb : pa).lerpVectors(c, a, dc / (dc - da)); }
    if (m === 2) { emit(pa); emit(pb); }
  };
  if (geom.boundsTree && bvh) {
    geom.boundsTree.shapecast({
      intersectsBounds: box => (box.intersectsPlane(lp) && box.intersectsSphere(sphere)) ? bvh.INTERSECTED : bvh.NOT_INTERSECTED,
      intersectsTriangle: tri => { cut(tri.a, tri.b, tri.c); return false; },
    });
  } else {
    const idx = geom.index.array, pos = geom.attributes.position.array, a = V(), b = V(), c = V();
    for (let t = 0; t < idx.length; t += 3) {
      a.fromArray(pos, idx[t]*3); b.fromArray(pos, idx[t+1]*3); c.fromArray(pos, idx[t+2]*3);
      if (Math.min(a.distanceTo(sphere.center), b.distanceTo(sphere.center), c.distanceTo(sphere.center)) > sphere.radius + a.distanceTo(b) + b.distanceTo(c)) continue;
      cut(a, b, c);
    }
  }
  return out;
}

/** Join cut segments into polylines; `closed` when a line meets its own start. */
function chainSegments(seg, R) {
  const q = Math.max(R / 50000, 1e-7), key = (x, y) => Math.round(x / q) + ',' + Math.round(y / q);
  const n = seg.length / 4, at = new Map(), used = new Uint8Array(n);
  for (let i = 0; i < n; i++) for (const e of [0, 1]) { const k = key(seg[4*i+2*e], seg[4*i+2*e+1]); let l = at.get(k); if (!l) at.set(k, l = []); l.push(i * 2 + e); }
  const lines = [];
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const pts = [seg[4*i], seg[4*i+1], seg[4*i+2], seg[4*i+3]];
    for (const dir of [1, -1]) {               // extend forwards from the end, then backwards from the start
      for (;;) {
        const L = pts.length, x = dir > 0 ? pts[L-2] : pts[0], y = dir > 0 ? pts[L-1] : pts[1];
        const cand = (at.get(key(x, y)) || []).find(c => !used[c >> 1]);
        if (cand === undefined) break;
        const s = cand >> 1, e = cand & 1; used[s] = 1;
        const ox = seg[4*s + 2*(1-e)], oy = seg[4*s + 2*(1-e) + 1];
        if (dir > 0) pts.push(ox, oy); else pts.unshift(ox, oy);
      }
    }
    const L = pts.length, closed = L > 6 && key(pts[0], pts[1]) === key(pts[L-2], pts[L-1]);
    lines.push({ pts, closed });
  }
  return lines;
}

/** Smallest distance between two sets of cut segments (sampled for speed). */
function segmentsGap(A, B, maxSamples = 1500) {
  const nA = A.length / 4, nB = B.length / 4; if (!nA || !nB) return Infinity;
  const sa = Math.max(1, Math.floor(nA / maxSamples)), sb = Math.max(1, Math.floor(nB / maxSamples));
  const ptSeg = (px, py, S, i) => { const x1 = S[4*i], y1 = S[4*i+1], dx = S[4*i+2]-x1, dy = S[4*i+3]-y1, L = dx*dx + dy*dy;
    const t = L > 0 ? Math.max(0, Math.min(1, ((px-x1)*dx + (py-y1)*dy) / L)) : 0; return Math.hypot(px - x1 - t*dx, py - y1 - t*dy); };
  let best = Infinity;
  for (let i = 0; i < nA; i += sa) for (const e of [0, 1]) { const px = A[4*i+2*e], py = A[4*i+2*e+1];
    for (let j = 0; j < nB; j += sb) { const d = ptSeg(px, py, B, j); if (d < best) best = d; } }
  for (let j = 0; j < nB; j += sb) for (const e of [0, 1]) { const px = B[4*j+2*e], py = B[4*j+2*e+1];
    for (let i = 0; i < nA; i += sa) { const d = ptSeg(px, py, A, i); if (d < best) best = d; } }
  return best;
}

/** Right-handed axes for a joint: Z along the joint axis, X and Y across it (X kept level where possible). */
function jointBasis(axis) {
  const Z = axis.clone().normalize();
  let X = Z.clone().cross(V(0, 0, 1)); if (X.length() < 0.2) X = Z.clone().cross(V(1, 0, 0)); X.normalize();
  return { X, Y: Z.clone().cross(X).normalize(), Z };
}

/**
 * How far `moving` can slide along unit `dir` (world) before it meets `fixed`.
 * Not touching: rays from sampled corners of each part toward the other; the nearest hit wins,
 * then a BVH overlap test catches edges the corner rays slipped past.
 * Already overlapping: the distance along `dir` that backs it out until they just stop overlapping.
 * Returns { dist, overlapping } with dist = Infinity when nothing lies that way.
 */
function slideToContact(moving, fixed, dir, maxSamples = 25000) {
  moving.updateMatrixWorld(true); fixed.updateMatrixWorld(true);
  const worldBox = o => { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); return o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); };
  const fixedInv = fixed.matrixWorld.clone().invert();
  const overlapsAt = t => fixed.geometry.boundsTree.intersectsGeometry(moving.geometry,
    fixedInv.clone().multiply(new THREE.Matrix4().makeTranslation(dir.x * t, dir.y * t, dir.z * t)).multiply(moving.matrixWorld));
  const span = worldBox(moving).union(worldBox(fixed)).getSize(V()).length() * 2 || 100;
  if (overlapsAt(0)) {                                   // back out along dir
    let hi = Math.max(span * 1e-3, 1e-3);
    while (overlapsAt(hi)) { hi *= 2; if (hi > span) return { dist: Infinity, overlapping: true }; }
    let lo = 0; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (overlapsAt(m)) lo = m; else hi = m; }
    return { dist: hi, overlapping: true };
  }
  const rc = new THREE.Raycaster(); rc.firstHitOnly = true; rc.far = span;
  const cast = (from, onto, d) => {
    const pos = from.geometry.attributes.position, n = pos.count, step = Math.max(1, Math.floor(n / maxSamples)), p = V();
    let best = Infinity;
    for (let i = 0; i < n; i += step) {
      p.fromBufferAttribute(pos, i).applyMatrix4(from.matrixWorld);
      rc.set(p, d); const h = rc.intersectObject(onto, false)[0];
      if (h && h.distance < best) best = h.distance;
    }
    return best;
  };
  let dist = Math.min(cast(moving, fixed, dir), cast(fixed, moving, dir.clone().negate()));
  if (dist === Infinity) return { dist, overlapping: false };
  if (overlapsAt(Math.max(dist - 1e-5, 0))) {           // a corner ray missed an edge: find the first contact instead
    let lo = 0, hi = dist; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (overlapsAt(m)) hi = m; else lo = m; }
    dist = lo;
  }
  return { dist, overlapping: false };
}

/** The three cuts for a snap: two that contain the joint axis, one across it. */
function fitCuts(joint, axis, acrossOffset) {
  const { X, Y, Z } = jointBasis(axis);
  const mk = (name, origin, normal, u, v, hint) => ({ name, origin, normal, u, v, hint, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin) });
  return [
    mk('Along A', joint.clone(), Y, X, Z, 'Cut through the joint, containing its axis'),
    mk('Along B', joint.clone(), X, Y.clone().negate(), Z, 'Cut through the joint, turned 90° from A'),
    mk('Across', joint.clone().addScaledVector(Z, acrossOffset), Z, X, Y, 'Cut straight across the joint axis'),
  ];
}

// ---- Auto-assemble: find where parts exported in position touch, and plan a rig from it ----

/** Symmetric n×n eigen-decomposition (Jacobi). Largest value first, each with its unit vector as an array. */
function eigenSym(m) {
  const n = m.length, A = m.map(r => r.slice()), E = m.map((_, i) => m.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += Math.abs(A[p][q]);
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-20) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = c * a - s * b; A[k][q] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = c * a - s * b; A[q][k] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = E[k][p], b = E[k][q]; E[k][p] = c * a - s * b; E[k][q] = s * a + c * b; }
    }
  }
  return [...Array(n).keys()].map(i => ({ value: A[i][i], vector: E.map(r => r[i]) })).sort((a, b) => b.value - a.value);
}
function eigenSym3(m) { return eigenSym(m).map(e => ({ value: e.value, vector: V(...e.vector).normalize() })); }

// ---- Surface match: fit two parts by the organic face they share ----

/** Best rigid motion taking points src[i] onto dst[i] (Horn's quaternion method), as a Matrix4. */
function rigidFit(src, dst, w) {
  let W = 0; const sc = V(), dc = V();
  for (let i = 0; i < src.length; i++) { const wi = w ? w[i] : 1; W += wi; sc.addScaledVector(src[i], wi); dc.addScaledVector(dst[i], wi); }
  sc.multiplyScalar(1 / W); dc.multiplyScalar(1 / W);
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < src.length; i++) {
    const wi = w ? w[i] : 1, sx = src[i].x - sc.x, sy = src[i].y - sc.y, sz = src[i].z - sc.z, dx = dst[i].x - dc.x, dy = dst[i].y - dc.y, dz = dst[i].z - dc.z;
    Sxx += wi*sx*dx; Sxy += wi*sx*dy; Sxz += wi*sx*dz; Syx += wi*sy*dx; Syy += wi*sy*dy; Syz += wi*sy*dz; Szx += wi*sz*dx; Szy += wi*sz*dy; Szz += wi*sz*dz;
  }
  const N = [[Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
             [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
             [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
             [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz]];
  const [qw, qx, qy, qz] = eigenSym(N)[0].vector;
  const q = new THREE.Quaternion(qx, qy, qz, qw).normalize();
  const t = dc.clone().sub(sc.clone().applyQuaternion(q));
  return new THREE.Matrix4().compose(t, q, V(1, 1, 1));
}

/** The surface around a click, up to the sharp edges that bound it (where the cut face meets the sculpt). */
function creaseRegion(topo, tri, creaseDeg, ref = null, maxTurnDeg = 180) {
  const cos = Math.cos(creaseDeg * Math.PI / 180), cosTurn = Math.cos(maxTurnDeg * Math.PI / 180), { fn, fa, eps } = topo;
  return growRegion(topo, tri, (t, n) => {
    if (fa[n] < eps || fa[t] < eps) return true;
    if (fn[3*t]*fn[3*n] + fn[3*t+1]*fn[3*n+1] + fn[3*t+2]*fn[3*n+2] <= cos) return false;      // a sharp edge
    return !ref || fn[3*n]*ref.x + fn[3*n+1]*ref.y + fn[3*n+2]*ref.z > cosTurn;              // never wraps around the part
  });
}

/**
 * Surface match pick. A flat spot takes exactly that flat face (same plane test as the Face tool),
 * so bevels and neighbouring faces stay out and pegs and holes become rings inside it. A curved spot
 * grows to the sharp edges around it but never turns more than 50° from the surface at the click.
 */
function pickSurface(topo, M, tri, hitWorld, s) {
  const hitLocal = hitWorld.clone().applyMatrix4(M.clone().invert()), area = l => l.reduce((a, t) => a + topo.fa[t], 0);
  // the surface direction at the click: nearby triangles that face roughly the way the clicked one does
  const n0 = triNormal(topo, tri), disc = discAround(topo, tri, hitLocal, 40);
  const ref = (topo.fa[tri] >= topo.eps && regionPlane(topo, disc.filter(t => topo.fa[t] < topo.eps || triNormal(topo, t).dot(n0) > Math.cos(Math.PI / 6)))?.n) || n0;
  // how rough is this face? (a cut through a sculpt that was decimated afterwards is rarely truly flat)
  const S0 = new THREE.Vector3().setFromMatrixScale(M), sc0 = Math.max(Math.abs(S0.x), Math.abs(S0.y), Math.abs(S0.z)) || 1;
  const core = discAround(topo, tri, hitLocal, 80).filter(t => topo.fa[t] < topo.eps || triNormal(topo, t).dot(ref) > Math.cos(15 * Math.PI / 180));
  const cp = regionPlane(topo, core); let ss = 0, nv = 0;
  if (cp) for (const t of core) for (let k = 0; k < 3; k++) { const i = topo.idx[3*t+k]; const d = V(topo.pos[3*i], topo.pos[3*i+1], topo.pos[3*i+2]).sub(cp.p).dot(cp.n); ss += d * d; nv++; }
  const rough = nv ? Math.sqrt(ss / nv) * sc0 : 0;
  const flatTol = Math.min(Math.max(s.flatTol ?? 0.02, rough * 3), 0.3);
  const flat = pickFlat(topo, M, tri, hitWorld, { flatTol }).region;
  let curved = creaseRegion(topo, tri, s.creaseDeg, ref, s.maxTurnDeg ?? 50).list;
  for (let k = 0; k < 2; k++) {               // measure the turn limit from the face's own average, not the slope at the click
    const mid = regionPlane(topo, curved)?.n; if (!mid) break;
    const next = creaseRegion(topo, tri, s.creaseDeg, mid, s.maxTurnDeg ?? 50).list;
    if (next.length === curved.length) break; curved = next;
  }
  // mostly one plane (a hard-surface face): just that plane, not the bevels around it. Otherwise the curved face.
  const useFlat = area(flat) >= 0.5 * area(curved);
  const list = useFlat ? flat : curved, kind = useFlat ? 'flat' : 'curved';
  const pl = regionPlane(topo, list);
  if (!pl || list.length < 2) return { err: 'That face is too small to match. Click inside the mating face, or raise the face edge angle.' };
  const S = new THREE.Vector3().setFromMatrixScale(M), sc = Math.max(Math.abs(S.x), Math.abs(S.y), Math.abs(S.z)) || 1, mm2 = pl.A * sc * sc;
  return { point: pl.p.clone().applyMatrix4(M), normal: worldNormal(M, pl.n), region: list, kind, rough: useFlat ? rough : 0,
           info: `${kind === 'flat' ? 'flat' : 'curved'} mating face, ${mm2.toFixed(mm2 < 10 ? 1 : 0)} mm²${useFlat && flatTol > 0.03 ? ` (rough, ±${flatTol.toFixed(2)} mm)` : ''}` };
}

/**
 * Split a whole part into the faces a click would select (same rule as the Match pick), biggest
 * triangles first. Flat-ish faces, which is what parts are usually cut and mated on, rank first.
 */
function segmentRegions(topo, creaseDeg, max = 10, opts = {}) {
  const taken = new Uint8Array(topo.T), out = [], I = new THREE.Matrix4(); let total = 0;
  for (let t = 0; t < topo.T; t++) total += topo.fa[t];
  const order = [...Array(topo.T).keys()].filter(t => topo.fa[t] >= topo.eps).sort((a, b) => topo.fa[b] - topo.fa[a]);
  const s = { creaseDeg, flatTol: opts.flatTol ?? 0.02 };
  let seeds = 0;
  for (const t of order) {
    if (taken[t]) continue;
    if (++seeds > (opts.maxSeeds || 120)) break;
    const r = pickSurface(topo, I, t, triCenter(topo, t), s);
    if (r.err) { taken[t] = 1; continue; }
    let a = 0, fresh = 0; for (const k of r.region) { a += topo.fa[k]; if (!taken[k]) fresh++; taken[k] = 1; }
    if (fresh < r.region.length * 0.5) continue;                  // mostly a face already found
    // a cut face meets the rest of the part along a sharp edge nearly all the way round; a patch of skin doesn't
    const inR = new Set(r.region); let edgeLen = 0, sharpLen = 0;
    for (const k of r.region) for (let e = 0; e < 3; e++) {
      const n = topo.nb[3*k+e]; if (n >= 0 && inR.has(n)) continue;
      const i0 = topo.idx[3*k+e], i1 = topo.idx[3*k+(e+1)%3];
      const len = Math.hypot(topo.pos[3*i1]-topo.pos[3*i0], topo.pos[3*i1+1]-topo.pos[3*i0+1], topo.pos[3*i1+2]-topo.pos[3*i0+2]);
      edgeLen += len;
      if (n < 0 || topo.fn[3*k]*topo.fn[3*n] + topo.fn[3*k+1]*topo.fn[3*n+1] + topo.fn[3*k+2]*topo.fn[3*n+2] < 0.5) sharpLen += len;
    }
    const sharp = edgeLen > 0 ? sharpLen / edgeLen : 0;
    out.push({ list: r.region, area: a, kind: r.kind, sharp, rank: a * (0.2 + 2 * sharp * sharp) * (r.kind === 'flat' ? 1.5 : 1) });
  }
  return out.filter(r => r.area > total * 0.004 && r.area < total * 0.7).sort((a, b) => b.rank - a.rank).slice(0, max);
}

const fract = x => x - Math.floor(x);
/**
 * World-space description of a face: evenly spread surface points (with normals), points along its
 * outline (outer edge and any holes), area, centre, average facing, and a BVH for nearest-point queries.
 */
function regionSamples(topo, M, list, opts = {}) {
  const { idx, pos, fa } = topo, nS = opts.nSurf || 1200, nE = opts.nEdge || 360;
  const S = new THREE.Vector3().setFromMatrixScale(M), sc = Math.max(Math.abs(S.x), Math.abs(S.y), Math.abs(S.z)) || 1;
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  const flags = new Uint8Array(topo.T); for (const t of list) flags[t] = 1;
  const cum = new Float64Array(list.length); let A = 0;
  const nrm = V(), cen = V();
  list.forEach((t, k) => { A += fa[t]; cum[k] = A; nrm.addScaledVector(triNormal(topo, t), fa[t]); cen.addScaledVector(triCenter(topo, t), fa[t]); });
  const a = V(), b = V(), c = V(), surf = [];
  for (let k = 0; k < nS && A > 0; k++) {
    const u = (k + 0.5) / nS * A; let lo = 0, hi = list.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
    const t = list[lo];
    a.fromArray(pos, idx[3*t] * 3); b.fromArray(pos, idx[3*t+1] * 3); c.fromArray(pos, idx[3*t+2] * 3);
    let r1 = fract(0.5 + k * 0.6180339887), r2 = fract(0.5 + k * 0.7548776662); if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
    surf.push(a.clone().addScaledVector(b.clone().sub(a), r1).addScaledVector(c.clone().sub(a), r2).applyMatrix4(M));
  }
  // outline: the outer edge, and inner rings (holes, peg bases) kept apart. Both resampled evenly by length.
  const loops = boundaryLoops(topo, { flags, list }).filter(l => l.length > 0).sort((x, y) => y.length - x.length);
  const outerLoops = loops.slice(0, 1), innerLoops = loops.slice(1).filter(l => l.length > (loops[0]?.length || 0) * 0.02);
  const L = outerLoops.reduce((s, l) => s + l.length, 0), step = L / nE;
  const sampleLoops = (ls, minPer) => {
    const nSeg = ls.reduce((s, l) => s + l.edges.length, 0), segs = new Float64Array(nSeg * 6), pts = []; let si = 0;
    for (const l of ls) {
      for (const [i0, i1] of l.edges) { a.fromArray(pos, i0 * 3).applyMatrix4(M); b.fromArray(pos, i1 * 3).applyMatrix4(M); segs.set([a.x, a.y, a.z, b.x, b.y, b.z], si); si += 6; }
      const st = Math.min(step, l.length / minPer); let carry = 0;
      for (const [i0, i1] of l.edges) {
        a.fromArray(pos, i0 * 3); b.fromArray(pos, i1 * 3); const len = a.distanceTo(b);
        for (let d = carry; d < len; d += st) pts.push(a.clone().lerp(b, d / len).applyMatrix4(M));
        carry = ((carry - len) % st + st) % st;
      }
    }
    return { pts, segs };
  };
  const { pts: edge, segs } = sampleLoops(outerLoops, 1);
  const inner = sampleLoops(innerLoops, 24);
  const innerCentres = innerLoops.map(l => l.center.clone().applyMatrix4(M));
  // flatness: spread of the surface points across their average plane
  const centre = cen.multiplyScalar(1 / (A || 1)).applyMatrix4(M), normal = nrm.applyMatrix3(nm).normalize();
  let dev = 0, ssd = 0; for (const p of surf) { const d = p.clone().sub(centre).dot(normal); dev = Math.max(dev, Math.abs(d)); ssd += d * d; }
  const areaW = A * sc * sc, size = Math.sqrt(areaW);
  let geom = null;
  if (opts.bvh !== false) {
    const arr = new Float32Array(list.length * 9);
    list.forEach((t, k) => { for (let j = 0; j < 3; j++) { a.fromArray(pos, idx[3*t+j] * 3).applyMatrix4(M); arr.set([a.x, a.y, a.z], k * 9 + j * 3); } });
    geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.BufferAttribute(arr, 3)); geom.computeBoundsTree();
  }
  const rms = Math.sqrt(ssd / Math.max(surf.length, 1)), nearFlat = dev < size * 0.05;
  return { surf, edge, segs, innerEdge: inner.pts, innerSegs: inner.segs, innerCentres, centre, normal, area: areaW, perimeter: L * sc, size,
           planar: dev < Math.max(0.03, size * 0.01), relief: dev, rough: nearFlat ? rms : 0, geom, list };
}

/**
 * Share of part A's corners that end up inside part B once A is moved by T (odd ray crossings).
 * Corners on B's surface (the contact itself) don't count. A real fit sits against B, not in it.
 */
function insideFraction(gA, MA, T, gB, MB, tol = 0.1, samples = 500) {
  const toB = MB.clone().invert().multiply(T).multiply(MA), pos = gA.attributes.position, step = Math.max(1, Math.floor(pos.count / samples));
  const S = new THREE.Vector3().setFromMatrixScale(MB), sc = Math.max(Math.abs(S.x), Math.abs(S.y), Math.abs(S.z)) || 1;
  if (!gB.boundingBox) gB.computeBoundingBox();
  const lim = Math.max(tol, 0.3, gB.boundingBox.getSize(V()).length() * 0.005) / sc;   // skip corners at or near the contact
  const dirs = [V(0.5774, 0.5771, 0.5777), V(-0.4082, 0.8166, -0.4086), V(0.2673, -0.5347, 0.8018)].map(d => d.normalize());
  const ray = new THREE.Ray(), p = V(), hitT = {};
  const crossings = d => {                    // distinct surface crossings along the ray (a hit on a shared edge counts once)
    ray.direction.copy(d); const ds = gB.boundsTree.raycast(ray, THREE.DoubleSide).map(h => h.distance).sort((a, b) => a - b);
    let n = 0, last = -Infinity; for (const x of ds) { if (x - last > 1e-5) n++; last = x; } return n;
  };
  let inside = 0, tested = 0;
  for (let i = 0; i < pos.count; i += step) {
    p.fromBufferAttribute(pos, i).applyMatrix4(toB);
    if (!gB.boundingBox.containsPoint(p)) { tested++; continue; }
    if (gB.boundsTree.closestPointToPoint(p, hitT, 0, lim)?.distance <= lim) continue;
    ray.origin.copy(p); tested++;
    let votes = 0; for (const d of dirs) if (crossings(d) % 2 === 1) votes++;
    if (votes >= 2) inside++;
  }
  return tested ? inside / tested : 0;
}

/** Closest point to p on a set of segments [ax,ay,az,bx,by,bz,...], written into out. */
function closestOnSegs(p, segs, out, dirOut) {
  let best = Infinity, bx = 0, by = 0, bz = 0, bk = 0;
  for (let k = 0; k < segs.length; k += 6) {
    const ax = segs[k], ay = segs[k+1], az = segs[k+2], dx = segs[k+3] - ax, dy = segs[k+4] - ay, dz = segs[k+5] - az;
    const L = dx*dx + dy*dy + dz*dz, t = L > 0 ? Math.max(0, Math.min(1, ((p.x-ax)*dx + (p.y-ay)*dy + (p.z-az)*dz) / L)) : 0;
    const qx = ax + t*dx, qy = ay + t*dy, qz = az + t*dz, d = (p.x-qx)**2 + (p.y-qy)**2 + (p.z-qz)**2;
    if (d < best) { best = d; bx = qx; by = qy; bz = qz; bk = k; }
  }
  if (dirOut) dirOut.set(segs[bk+3] - segs[bk], segs[bk+4] - segs[bk+1], segs[bk+5] - segs[bk+2]).normalize();
  return out.set(bx, by, bz);
}

/** Solve a small dense linear system (Gaussian elimination with pivoting). */
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-18) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Fit face A (moving part) onto face B (fixed part) so they meet face to face.
 * What has to line up: the outer outlines when the faces are the same size; the inner rings
 * (pegs into holes) whenever both faces have them; and the surfaces themselves when they're curved.
 * Starting guesses: every turn about B's facing, with A's centre on B's centre, and with A's biggest
 * ring over each of B's rings. The best few are refined by least squares (iterative closest points).
 */
function matchRegions(A, B, opts = {}) {
  const iters = opts.iters || 30, starts = opts.starts || 4;
  const sym = Math.min(A.area, B.area) / Math.max(A.area, B.area) > 0.85, useOuter = sym;
  const useInner = A.innerEdge.length > 0 && B.innerEdge.length > 0;
  const surfaceMatters = !(A.planar && B.planar);
  const nearestD = (p, set) => { let best = Infinity; for (let i = 0; i < set.length; i++) { const d = p.distanceToSquared(set[i]); if (d < best) best = d; } return Math.sqrt(best); };
  const hit = {};
  const surfDist = p => { const h = B.geom.boundsTree.closestPointToPoint(p, hit); return h ? h.distance : Infinity; };
  const sub = (arr, n) => { const st = Math.max(1, Math.floor(arr.length / n)); return arr.filter((_, i) => i % st === 0); };
  const eA = sub(A.edge, 70), eB = sub(B.edge, 70), iA = sub(A.innerEdge, 80), iB = sub(B.innerEdge, 80), sA = sub(A.surf, 40);
  const q0 = new THREE.Quaternion().setFromUnitVectors(A.normal, B.normal.clone().negate());
  const poseAt = (th, from, to) => { const q = new THREE.Quaternion().setFromAxisAngle(B.normal, th).multiply(q0);
    return Tr(to).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(Tr(from.clone().negate())); };
  // starting places: centre on centre; on a bigger face, a grid of places; A's largest ring over each of B's rings
  const bases = [{ from: A.centre, to: B.centre }];
  if (!useOuter && !useInner && B.size > A.size * 1.05) {
    const { X, Y } = jointBasis(B.normal), r = (B.size - A.size) * 0.6;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (i || j) bases.push({ from: A.centre, to: B.centre.clone().addScaledVector(X, r * i / 2).addScaledVector(Y, r * j / 2) });
  }
  if (useInner) {
    const anchor = A.innerCentres[0];              // the longest ring after the outline: usually the biggest peg or hole
    for (const bc of B.innerCentres.slice(0, 12)) bases.push({ from: anchor, to: bc });
  }
  const cap = A.size * 0.3;
  const coarseCost = T => {
    let c = 0, k = 0;
    if (useOuter) { const tA = eA.map(p => p.clone().applyMatrix4(T)), tAll = A.edge.map(p => p.clone().applyMatrix4(T));
      let c1 = 0; for (const p of tA) c1 += nearestD(p, B.edge); let c2 = 0; for (const p of eB) c2 += nearestD(p, tAll);
      c += (c1 / (tA.length || 1) + c2 / (eB.length || 1)) / 2; k++; }
    if (useInner) { let c3 = 0; for (const p of iA) c3 += Math.min(nearestD(p.clone().applyMatrix4(T), B.innerEdge), cap); c += c3 / iA.length * 2; k++; }
    if (surfaceMatters) { let c4 = 0; for (const p of sA) c4 += Math.min(surfDist(p.clone().applyMatrix4(T)), A.size); c += c4 / sA.length; k++; }
    return k ? c : 0;
  };
  const STEP = 4, per = 360 / STEP, costs = [];
  for (const base of bases) for (let deg = 0; deg < 360; deg += STEP) costs.push({ deg, base, cost: coarseCost(poseAt(deg * Math.PI / 180, base.from, base.to)) });
  const mins = costs.filter((c, i) => { const b0 = i - (i % per), prev = costs[b0 + (i - b0 + per - 1) % per], next = costs[b0 + (i - b0 + 1) % per];
    return c.cost <= prev.cost && c.cost <= next.cost; }).sort((a, b) => a.cost - b.cost).slice(0, bases.length > 1 ? starts + 2 : starts);
  // refine
  const sA2 = sub(A.surf, 400), eB2 = sub(B.edge, 360), iB2 = sub(B.innerEdge, 300);
  const perp = d => { const u1 = d.clone().cross(Math.abs(d.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0)).normalize(); return [u1, d.clone().cross(u1).normalize()]; };
  const results = mins.map(m => {
    let T = poseAt(m.deg * Math.PI / 180, m.base.from, m.base.to);
    for (let it = 0; it < iters; it++) {
      // each row: a point p on the moving face, a target q, and a direction u the gap is measured along.
      // Outline points are pulled only across the other outline (they may slide along it); surface points
      // only through the other surface. That lets the fit slide into place in a few steps.
      const rows = [], Ti = T.clone().invert(), Rm = new THREE.Matrix3().setFromMatrix4(T), q = V(), d = V();
      let grp = 0;
      const add = (p, q, u) => rows.push({ p, u, e: u.dot(p.clone().sub(q)), dist: p.distanceTo(q), grp });   // trimmed by the point's whole gap
      const lines = (srcPts, srcSegs, dstPts, dstSegs) => {
        for (const s of srcPts) { const p = s.clone().applyMatrix4(T); closestOnSegs(p, dstSegs, q, d); for (const u of perp(d)) add(p, q.clone(), u); }
        for (const b of dstPts) { const qa = closestOnSegs(b.clone().applyMatrix4(Ti), srcSegs, V(), d), p = qa.applyMatrix4(T);
          for (const u of perp(d.clone().applyMatrix3(Rm).normalize())) add(p, b, u); }
      };
      if (useOuter) { grp = 1; lines(A.edge, A.segs, eB2, B.segs); }
      if (useInner) { grp = 2; lines(A.innerEdge, A.innerSegs, iB2, B.innerSegs); }
      grp = 3;
      const pa = B.geom.attributes.position.array;
      for (const s of sA2) {
        const p = s.clone().applyMatrix4(T), h = B.geom.boundsTree.closestPointToPoint(p, hit); if (!h) continue;
        const f = h.faceIndex * 9, a0 = V(pa[f], pa[f+1], pa[f+2]), n = V(pa[f+3], pa[f+4], pa[f+5]).sub(a0).cross(V(pa[f+6], pa[f+7], pa[f+8]).sub(a0)).normalize();
        add(p, h.point.clone(), n);
      }
      // drop outliers within each kind of point (outline, rings, surface), so a near-perfect surface
      // doesn't make the still-misaligned rings look like outliers
      const cuts = {};
      for (const gId of [1, 2, 3]) { const ds = rows.filter(r => r.grp === gId).map(r => r.dist).sort((x, y) => x - y);
        if (ds.length) cuts[gId] = Math.max(ds[Math.floor(ds.length / 2)] * 3, A.size * 1e-3); }
      // least squares for a small turn w (about the face centre) and shift t: u·(w×(p-c)) + u·t = -e
      const c = B.centre, H = [...Array(6)].map(() => Array(6).fill(0)), g = Array(6).fill(0);
      for (const r of rows) {
        if (r.dist > cuts[r.grp]) continue;
        const pc = r.p.clone().sub(c), j = [...pc.clone().cross(r.u).toArray(), ...r.u.toArray()];
        for (let a = 0; a < 6; a++) { g[a] -= j[a] * r.e; for (let b2 = 0; b2 < 6; b2++) H[a][b2] += j[a] * j[b2]; }
      }
      const tr = H[0][0] + H[1][1] + H[2][2] + H[3][3] + H[4][4] + H[5][5];
      for (let a = 0; a < 6; a++) H[a][a] += tr * 1e-9;                            // keeps flat, round faces solvable
      const x = solveLinear(H, g); if (!x) break;
      const w = V(x[0], x[1], x[2]), ang = w.length();
      const R = ang > 0 ? new THREE.Matrix4().makeRotationAxis(w.clone().divideScalar(ang), ang) : new THREE.Matrix4();
      T = Tr(c.clone().add(V(x[3], x[4], x[5]))).multiply(R).multiply(Tr(c.clone().negate())).multiply(T);
      if (ang * A.size + Math.hypot(x[3], x[4], x[5]) < A.size * 1e-7) break;
    }
    // quality: how far apart outlines, rings and surfaces end up
    const qq = V(), pct = (pts, segs) => { const e = pts.map(p => { const t = p.clone().applyMatrix4(T); return t.distanceTo(closestOnSegs(t, segs, qq)); }).sort((x, y) => x - y);
      return e[Math.floor(e.length * 0.8)] ?? Infinity; };                    // 80% of the line lies within this
    const edgeErr = useOuter ? pct(A.edge, B.segs) : null, ringErr = useInner ? pct(A.innerEdge, B.innerSegs) : null;
    // "in contact" means within a normal print tolerance (separate exports of one cut rarely match exactly)
    const covTol = Math.max(0.1, Math.min(0.25, A.size * 0.02), 2.5 * Math.max(A.rough, B.rough));
    const sd = A.surf.map(p => surfDist(p.clone().applyMatrix4(T))), sorted = [...sd].sort((x, y) => x - y);
    const inContact = sd.filter(v => v <= covTol);
    const rms = arr => Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / Math.max(arr.length, 1));
    const coverage = inContact.length / Math.max(sd.length, 1), surfRms = rms(inContact), gap = sorted[Math.floor(sorted.length / 2)] ?? Infinity;
    // flat faces of different sizes with no rings can slide on each other: nothing in the shapes says where
    return { T, edgeErr, ringErr, surfRms, gap, coverage, covTol, sym, size: A.size, rings: useInner ? Math.min(A.innerCentres.length, B.innerCentres.length) : 0,
             slides: !useOuter && !useInner && A.planar && B.planar,
             score: ((edgeErr ?? 0) * 0.5 + (ringErr ?? 0) + gap) / A.size + (1 - coverage) * 0.5 };
  });
  // drop near-duplicates
  const out = [];
  for (const r of results.sort((a, b) => a.score - b.score)) {
    const p = V().setFromMatrixPosition(r.T), q = new THREE.Quaternion().setFromRotationMatrix(r.T);
    if (!out.some(o => V().setFromMatrixPosition(o.T).distanceTo(p) < A.size * 0.02 && new THREE.Quaternion().setFromRotationMatrix(o.T).angleTo(q) < 0.05)) out.push(r);
  }
  return out;
}

function partBox(m) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); m.updateMatrixWorld(true); return m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); }
const boxVol = b => { const s = b.getSize(V()); return Math.max(s.x, 1e-3) * Math.max(s.y, 1e-3) * Math.max(s.z, 1e-3); };

/**
 * Parts that all sit at the same spot (each file exported around its own origin) rather than
 * in their assembled places. Then every pair would "touch" and the contacts mean nothing.
 */
function looksStacked(meshes) {
  const boxes = meshes.map(partBox); let close = 0, total = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    total++;
    const inter = boxes[i].clone().intersect(boxes[j]); if (inter.isEmpty()) continue;
    const dI = boxes[i].getSize(V()).length(), dJ = boxes[j].getSize(V()).length();
    const cd = boxes[i].getCenter(V()).distanceTo(boxes[j].getCenter(V()));
    if (boxVol(inter) > 0.6 * Math.min(boxVol(boxes[i]), boxVol(boxes[j])) && cd < 0.15 * Math.min(dI, dJ)) close++;
  }
  return total > 0 && close >= Math.max(1, Math.ceil(total * 0.3));
}

function contactContext(meshes) {
  meshes.forEach(m => m.updateMatrixWorld(true));
  return {
    meshes, boxes: meshes.map(partBox), invs: meshes.map(m => m.matrixWorld.clone().invert()),
    scales: meshes.map(m => { const s = new THREE.Vector3().setFromMatrixScale(m.matrixWorld); return Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) || 1; }),
    nmats: meshes.map(m => new THREE.Matrix3().getNormalMatrix(m.matrixWorld)),
  };
}

/**
 * Where parts i and j meet: corners of each part lying within `tol` mm of the other's surface,
 * plus the lines where their triangles cut through each other. Returns null when they don't touch.
 * The joint is the centre of a ball when the contact is a ball in a cup, else the contact's centre.
 */
function contactBetween(ctx, i, j, tol, maxSamples = 4000) {
  const { meshes, boxes, invs, scales, nmats } = ctx;
  const zone = boxes[i].clone().expandByScalar(tol).intersect(boxes[j].clone().expandByScalar(tol));
  if (zone.isEmpty()) return null;
  const side = { [i]: [], [j]: [] }, cutPts = [], nOut = { [i]: V(), [j]: V() }, nCnt = { [i]: 0, [j]: 0 };
  const p = V(), pl = V(), nrm = V(), hitT = {};
  const faceNormal = (k, fi) => {
    const g = meshes[k].geometry, ix = g.index.array, ps = g.attributes.position.array;
    const a = ix[3*fi] * 3, b = ix[3*fi+1] * 3, c = ix[3*fi+2] * 3;
    const ux = ps[b]-ps[a], uy = ps[b+1]-ps[a+1], uz = ps[b+2]-ps[a+2], vx = ps[c]-ps[a], vy = ps[c+1]-ps[a+1], vz = ps[c+2]-ps[a+2];
    return nrm.set(uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx).applyMatrix3(nmats[k]).normalize();
  };
  const sample = (a, b) => {                       // corners of a that lie on b's surface
    const pos = meshes[a].geometry.attributes.position.array, M = meshes[a].matrixWorld, inZone = [];
    for (let v = 0; v < pos.length; v += 3) { p.set(pos[v], pos[v+1], pos[v+2]).applyMatrix4(M); if (zone.containsPoint(p)) inZone.push(v); }
    const step = Math.max(1, Math.floor(inZone.length / maxSamples)), lim = tol / scales[b];
    for (let s = 0; s < inZone.length; s += step) {
      const v = inZone[s];
      p.set(pos[v], pos[v+1], pos[v+2]).applyMatrix4(M); pl.copy(p).applyMatrix4(invs[b]);
      const hit = meshes[b].geometry.boundsTree.closestPointToPoint(pl, hitT, 0, lim * 1.0001);
      if (!hit || hit.distance > lim) continue;
      side[a].push(p.x, p.y, p.z);
      nOut[b].add(faceNormal(b, hit.faceIndex)); nCnt[b]++;      // b's outward normal: from b toward a
    }
  };
  sample(i, j); sample(j, i);
  // where the surfaces cut through each other (parts that overlap a little, as most sculpted kits do)
  const rel = invs[i].clone().multiply(meshes[j].matrixWorld), line = new THREE.Line3(), pl1 = new THREE.Plane(), pl2 = new THREE.Plane();
  const eps = Math.max(tol * 1e-3, 1e-7) / scales[i]; let cuts = 0;
  const straddles = (pl, t) => { const a = pl.distanceToPoint(t.a), b = pl.distanceToPoint(t.b), c = pl.distanceToPoint(t.c);
    return Math.min(a, b, c) < -eps && Math.max(a, b, c) > eps; };
  meshes[i].geometry.boundsTree.bvhcast(meshes[j].geometry.boundsTree, rel, {
    intersectsTriangles(t1, t2) {
      // only surfaces that truly pass through each other: faces that merely touch (flush, or edge on face)
      // depend on how they were triangulated, and the corner sampling already has them
      if (!straddles(t1.getPlane(pl1), t2) || !straddles(t2.getPlane(pl2), t1)) return false;
      if (t1.intersectsTriangle(t2, line, true) && (line.start.lengthSq() > 0 || line.end.lengthSq() > 0)) {
        line.getCenter(p).applyMatrix4(meshes[i].matrixWorld); cutPts.push(p.x, p.y, p.z); if (++cuts >= 4000) return true; }
      return false;
    },
  });
  // average the points in each small cell, so densely triangulated spots don't outweigh plain ones
  const thin = (arrs, cell) => {
    const m = new Map();
    for (const arr of arrs) for (let k = 0; k < arr.length; k += 3) {
      const key = `${Math.floor(arr[k] / cell)},${Math.floor(arr[k+1] / cell)},${Math.floor(arr[k+2] / cell)}`;
      let e = m.get(key); if (!e) m.set(key, e = [0, 0, 0, 0]); e[0] += arr[k]; e[1] += arr[k+1]; e[2] += arr[k+2]; e[3]++;
    }
    const out = []; for (const e of m.values()) out.push(e[0] / e[3], e[1] / e[3], e[2] / e[3]); return out;
  };
  const pts = thin([side[i], side[j], cutPts], Math.max(tol * 0.75, 1e-3));
  const N = pts.length / 3;
  if (N < 6) return null;
  const c = V(); for (let k = 0; k < pts.length; k += 3) { c.x += pts[k]; c.y += pts[k+1]; c.z += pts[k+2]; } c.multiplyScalar(1 / N);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let k = 0; k < pts.length; k += 3) { const d = [pts[k]-c.x, pts[k+1]-c.y, pts[k+2]-c.z];
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[r][q] += d[r] * d[q] / N; }
  const ev = eigenSym3(C), range = ev.map(e => { let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < pts.length; k += 3) { const t = (pts[k]-c.x)*e.vector.x + (pts[k+1]-c.y)*e.vector.y + (pts[k+2]-c.z)*e.vector.z; lo = Math.min(lo, t); hi = Math.max(hi, t); }
    return hi - lo; });
  if (range[0] < Math.max(tol * 1.5, 0.15)) return null;           // a speck where two parts graze, not a joint
  const planar = Math.sqrt(Math.max(ev[2].value, 0)) < Math.max(tol * 0.35, Math.sqrt(Math.max(ev[0].value, 0)) * 0.06);
  let kind = planar ? 'flat' : 'socket', joint = c.clone(), radius = null;
  if (!planar) {
    // a ball in a cup: each part's own contact surface is a sphere, and both share a centre
    const sphereOf = raw => {
      const arr = thin([raw], Math.max(tol * 0.5, 1e-3));
      if (arr.length < 24 * 3) return null;                     // too little surface to call it a ball
      const fs = fitSphere(arr, 0.04); if (!fs) return null;
      const dir = V();                                           // must cover a real cap of the sphere, not a few corners
      for (let k = 0; k < arr.length; k += 3) dir.add(V(arr[k] - fs.c.x, arr[k+1] - fs.c.y, arr[k+2] - fs.c.z).normalize());
      if (dir.length() / (arr.length / 3) > 0.85) return null;
      let kept = 0, ss = 0, lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
      for (let k = 0; k < arr.length; k += 3) { if (fs.keep && !fs.keep[k / 3]) continue; kept++;
        const d = Math.hypot(arr[k]-fs.c.x, arr[k+1]-fs.c.y, arr[k+2]-fs.c.z) - fs.r; ss += d * d;
        lo.min(V(arr[k], arr[k+1], arr[k+2])); hi.max(V(arr[k], arr[k+1], arr[k+2])); }
      const rms = Math.sqrt(ss / Math.max(kept, 1)), span = hi.distanceTo(lo);
      return kept > 0.7 * arr.length / 3 && rms < 0.04 * fs.r && span > 0.8 * fs.r && fs.r < range[0] * 2 ? { ...fs, n: kept } : null;
    };
    const fits = [sphereOf(side[i]), sphereOf(side[j])].filter(Boolean);
    const agree = fits.length === 2 && fits[0].c.distanceTo(fits[1].c) < 0.25 * Math.min(fits[0].r, fits[1].r);
    if (fits.length === 1 || agree) {
      kind = 'ball';
      joint = fits.reduce((a, f) => a.addScaledVector(f.c, 1 / fits.length), V());
      radius = fits.reduce((a, f) => a + f.r, 0) / fits.length;
    }
  }
  return { i, j, count: N, joint, kind, radius, area: Math.max(range[0] * range[1], tol * tol), nOut, nCnt, centre: c };
}

/** Every touching pair among meshes (synchronous; the app runs contactBetween itself so it can show progress). */
function detectContacts(meshes, tol) {
  if (looksStacked(meshes)) return { stacked: true, pairs: [] };
  const ctx = contactContext(meshes), pairs = [];
  for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) { const c = contactBetween(ctx, i, j, tol); if (c) pairs.push(c); }
  return { stacked: false, pairs };
}

const NAME_ROOT = /(^|[^a-z])(torso|body|chest|hips?|pelvis|waist|trunk|core)([^a-z]|$)/i;
const NAME_FIXED = /(^|[^a-z])(base|plinth|stand|display)([^a-z]|$)/i;

/**
 * A skeleton from the contacts: the best-connected, biggest part (or one named torso/body/hips)
 * is the root, and each other part hangs off the neighbour it shares the largest contact with.
 * Parts in separate touching groups get their own root; parts touching nothing stay loose.
 */
function planRig(meshes, pairs, rootIndex = null) {
  const n = meshes.length, boxes = meshes.map(partBox), vols = boxes.map(boxVol), maxVol = Math.max(...vols, 1e-9);
  const degree = k => pairs.filter(p => p.i === k || p.j === k).length;
  const score = k => degree(k) * 2 + 3 * vols[k] / maxVol + (NAME_ROOT.test(meshes[k].name) ? 4 : 0) - (NAME_FIXED.test(meshes[k].name) ? 3 : 0);
  const order = [...Array(n).keys()].sort((a, b) => score(b) - score(a));
  if (rootIndex != null && rootIndex >= 0 && rootIndex < n) order.splice(0, 0, ...order.splice(order.indexOf(rootIndex), 1));
  const inTree = new Uint8Array(n), edges = [], roots = [], used = new Set();
  for (const start of order) {
    if (inTree[start]) continue;
    inTree[start] = 1; roots.push(start);
    for (;;) {                                        // grow along the biggest contact first
      let best = null;
      for (const p of pairs) if (inTree[p.i] !== inTree[p.j] && (!best || p.area > best.area)) best = p;
      if (!best) break;
      const parent = inTree[best.i] ? best.i : best.j, child = parent === best.i ? best.j : best.i;
      inTree[child] = 1; used.add(best);
      const toChild = boxes[child].getCenter(V()).sub(best.joint);
      let axis = toChild.clone();
      if (best.kind !== 'ball') { const ns = best.nOut[parent]; if (ns && ns.length() > 0.25 * Math.max(best.nCnt[parent], 1)) axis = ns.clone(); }
      if (axis.lengthSq() < 1e-12) axis = V(0, 0, 1);
      axis.normalize(); if (toChild.lengthSq() > 1e-12 && axis.dot(toChild) < 0) axis.negate();
      edges.push({ parent, child, pair: best, joint: best.joint.clone(), axis, kind: best.kind, how: NAME_FIXED.test(meshes[child].name) ? 'plain' : 'joint' });
    }
  }
  const linked = new Set(edges.flatMap(e => [e.parent, e.child]));
  return { edges, roots, root: roots[0], loops: pairs.filter(p => !used.has(p)), loose: roots.filter(r => !linked.has(r)) };
}

// ---- Orient: lay faces flat, square parts and seams to the X, Y, Z planes ----

const AXES = { '+x': V(1, 0, 0), '-x': V(-1, 0, 0), '+y': V(0, 1, 0), '-y': V(0, -1, 0), '+z': V(0, 0, 1), '-z': V(0, 0, -1) };
/** The world axis direction closest to v (optionally only among axes perpendicular to `perpTo`). */
function nearestAxis(v, perpTo = null) {
  let best = null, bd = -Infinity;
  for (const a of Object.values(AXES)) { if (perpTo && Math.abs(a.dot(perpTo)) > 0.5) continue; const d = a.dot(v); if (d > bd) { bd = d; best = a; } }
  return best.clone();
}
/**
 * Rotation that turns direction n onto `target`, then (optionally) turns `inPlane` (a direction lying
 * in the face) onto the nearest grid axis around `target`, then spins by `spin` radians about `target`.
 */
function orientQuat(n, target, opts = {}) {
  const q = new THREE.Quaternion().setFromUnitVectors(n.clone().normalize(), target.clone().normalize());
  let extra = opts.spin || 0;
  if (opts.inPlane && opts.square) {
    const d = opts.inPlane.clone().applyQuaternion(q); d.addScaledVector(target, -d.dot(target));
    if (d.lengthSq() > 1e-12) { d.normalize(); const a = nearestAxis(d, target); extra += Math.atan2(d.clone().cross(a).dot(target), d.dot(a)); }
  }
  return new THREE.Quaternion().setFromAxisAngle(target.clone().normalize(), extra).multiply(q);
}
/** Rotate about point c by quaternion q, as a Matrix4. */
const rotAbout = (q, c) => Tr(c).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)).multiply(Tr(c.clone().negate()));

/**
 * The directions a set of meshes "is built along": area-weighted clusters of facing directions
 * (big flat faces show up as heavy clusters) and the principal axes of its corners as a fallback.
 */
function dominantDirections(meshes) {
  const bins = new Map(), a = V(), b = V(), c = V(), n = V(); let total = 0;
  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], mean = V(); let cnt = 0; const corners = [];
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const g = m.geometry, ix = g.index.array, pos = g.attributes.position.array, M = m.matrixWorld, flip = M.determinant() < 0;
    for (let t = 0; t < ix.length; t += 3) {
      a.fromArray(pos, ix[t] * 3).applyMatrix4(M); b.fromArray(pos, ix[t+1] * 3).applyMatrix4(M); c.fromArray(pos, ix[t+2] * 3).applyMatrix4(M);
      n.subVectors(b, a).cross(c.clone().sub(a)); const area = n.length() / 2; if (area <= 0) continue;
      n.normalize(); if (flip) n.negate();
      const key = `${Math.round(n.x * 14)},${Math.round(n.y * 14)},${Math.round(n.z * 14)}`;     // ~4° cells
      let e = bins.get(key); if (!e) bins.set(key, e = { area: 0, n: V() }); e.area += area; e.n.addScaledVector(n, area); total += area;
      if ((t / 3) % 7 === 0) { corners.push(a.clone()); mean.add(a); cnt++; }
    }
  }
  mean.multiplyScalar(1 / Math.max(cnt, 1));
  for (const p of corners) { const d = p.clone().sub(mean).toArray(); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j]; }
  // merge each cell with its neighbours so a face split across two cells counts once
  const cl = [...bins.values()].map(e => ({ area: e.area, n: e.n.clone().normalize() })).sort((x, y) => y.area - x.area), merged = [];
  for (const e of cl) { const m = merged.find(x => x.n.dot(e.n) > Math.cos(6 * Math.PI / 180)); if (m) { m.n.multiplyScalar(m.area).addScaledVector(e.n, e.area).normalize(); m.area += e.area; } else merged.push({ ...e }); }
  merged.sort((x, y) => y.area - x.area);
  return { clusters: merged.map(x => ({ ...x, share: x.area / total })), axes: eigenSym3(cov).map(e => e.vector), total };
}
/**
 * Smallest rotation that squares a shape to the grid: its biggest flat face onto the nearest axis,
 * then the next big face at right angles to it onto the nearest axis around that. Organic shapes with
 * no real flat faces use their longest and next-longest directions instead.
 */
function squareUpQuat(dd) {
  const flat = dd.clusters.filter(c => c.share > 0.04);
  let n1, n2;
  if (flat.length) {
    n1 = flat[0].n;
    n2 = flat.find(c => Math.abs(c.n.dot(n1)) < 0.2)?.n || null;
  }
  if (!n1) { n1 = dd.axes[0]; n2 = dd.axes[1]; }
  if (!n2) { n2 = (Math.abs(n1.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0)).cross(n1).normalize(); n2 = dd.axes.find(a => Math.abs(a.dot(n1)) < 0.5) || n2; }
  const q1 = new THREE.Quaternion().setFromUnitVectors(n1, nearestAxis(n1));
  const a1 = nearestAxis(n1), d = n2.clone().applyQuaternion(q1); d.addScaledVector(a1, -d.dot(a1));
  if (d.lengthSq() < 1e-12) return q1;
  d.normalize(); const a2 = nearestAxis(d, a1);
  return new THREE.Quaternion().setFromAxisAngle(a1, Math.atan2(d.clone().cross(a2).dot(a1), d.dot(a2))).multiply(q1);
}
/** The long direction of a face, in world space: the main axis of its area (exact for any triangulation). */
function faceLongAxis(topo, M, list, normalW) {
  // second moment of area: a triangle contributes A/12 (aaᵀ + bbᵀ + ccᵀ + ssᵀ), s = a + b + c
  let A = 0; const c = V(), S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], a = V(), b = V(), d = V();
  for (const t of list) {
    a.fromArray(topo.pos, topo.idx[3*t] * 3).applyMatrix4(M); b.fromArray(topo.pos, topo.idx[3*t+1] * 3).applyMatrix4(M); d.fromArray(topo.pos, topo.idx[3*t+2] * 3).applyMatrix4(M);
    const ar = b.clone().sub(a).cross(d.clone().sub(a)).length() / 2; if (!ar) continue;
    const sum = a.clone().add(b).add(d); A += ar; c.addScaledVector(sum, ar / 3);
    for (const v of [a, b, d, sum]) { const x = v.toArray(); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += ar / 12 * x[i] * x[j]; }
  }
  if (!A) return null;
  c.multiplyScalar(1 / A); const cc = c.toArray();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] -= A * cc[i] * cc[j];
  // only directions in the face's plane
  const P = [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) - normalW.getComponent(i) * normalW.getComponent(j)));
  const PS = P.map(r => [0, 1, 2].map(j => r.reduce((s2, v, k) => s2 + v * S[k][j], 0)));
  const PSP = PS.map(r => [0, 1, 2].map(j => r.reduce((s2, v, k) => s2 + v * P[k][j], 0)));
  const ax = eigenSym3(PSP)[0].vector; ax.addScaledVector(normalW, -ax.dot(normalW));
  return ax.lengthSq() > 1e-12 ? ax.normalize() : null;
}

// ---- Fill seams: make touching parts overlap so they print as one solid piece ----

/** Corner normals of a mesh in world space (area-weighted from its faces). */
function vertexNormalsWorld(m) {
  const g = m.geometry, ix = g.index.array, pos = g.attributes.position.array, n = new Float32Array(pos.length);
  const a = V(), b = V(), c = V(), f = V();
  for (let t = 0; t < ix.length; t += 3) {
    a.fromArray(pos, ix[t] * 3); b.fromArray(pos, ix[t+1] * 3); c.fromArray(pos, ix[t+2] * 3);
    f.subVectors(b, a).cross(c.clone().sub(a));                       // length = 2 × area: area-weighted
    for (let k = 0; k < 3; k++) { const i = ix[t+k] * 3; n[i] += f.x; n[i+1] += f.y; n[i+2] += f.z; }
  }
  const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld), flip = m.matrixWorld.determinant() < 0 ? -1 : 1;
  for (let i = 0; i < n.length; i += 3) { f.set(n[i], n[i+1], n[i+2]).applyMatrix3(nm).normalize().multiplyScalar(flip); n[i] = f.x; n[i+1] = f.y; n[i+2] = f.z; }
  return n;
}

/**
 * For printing as one piece. Every corner of a part that lies within `maxGap` mm of another part's
 * surface, outside it and facing it, is pushed onto that surface and `overlap` mm past it, so the
 * parts overlap instead of leaving a slit. A `blend` band beyond maxGap fades the push out so there's
 * no step. Corners further away are untouched. Returns world-space positions per mesh, and what it did.
 */
/** Each corner's neighbours along the mesh's edges (compressed rows), kept on the geometry. */
function cornerNeighbours(geom) {
  if (geom.userData.nbrs?.n === geom.attributes.position.count) return geom.userData.nbrs;
  const ix = geom.index.array, n = geom.attributes.position.count, deg = new Uint32Array(n + 1);
  for (let t = 0; t < ix.length; t += 3) for (let k = 0; k < 3; k++) deg[ix[t+k] + 1] += 2;
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const fillAt = deg.slice(0, n), list = new Uint32Array(deg[n]);
  for (let t = 0; t < ix.length; t += 3) for (let k = 0; k < 3; k++) { const a = ix[t+k]; list[fillAt[a]++] = ix[t + (k+1) % 3]; list[fillAt[a]++] = ix[t + (k+2) % 3]; }
  return (geom.userData.nbrs = { n, start: deg, list });
}
/** Typical edge length of a mesh in world mm (median of a sample). */
function edgeLengthWorld(m) {
  const ix = m.geometry.index.array, p = m.geometry.attributes.position.array, s = new THREE.Vector3().setFromMatrixScale(m.matrixWorld), sc = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1;
  const T = ix.length / 3, step = Math.max(1, Math.floor(T / 4000)), L = [];
  for (let t = 0; t < T; t += step) { const a = ix[3*t] * 3, b = ix[3*t+1] * 3; L.push(Math.hypot(p[a]-p[b], p[a+1]-p[b+1], p[a+2]-p[b+2])); }
  L.sort((x, y) => x - y); return (L[L.length >> 1] || 1) * sc;
}
/** The corners within `rings` edge steps of `seed` (a Uint8Array flag per corner), as a list. */
function growBand(nb, seed, rings) {
  const inR = Uint8Array.from(seed); let front = []; for (let i = 0; i < inR.length; i++) if (inR[i]) front.push(i);
  const all = front.slice();
  for (let r = 0; r < rings && front.length; r++) {
    const next = [];
    for (const i of front) for (let e = nb.start[i]; e < nb.start[i + 1]; e++) { const j = nb.list[e]; if (!inR[j]) { inR[j] = 1; next.push(j); all.push(j); } }
    front = next;
  }
  return { list: all, flag: inR };
}
function fillSeams(meshes, opts = {}) {
  const maxGap = opts.maxGap ?? 0.5, overlap = opts.overlap ?? 0.15, blend = opts.blend ?? 0, reach = maxGap + blend;   // no half-way pushes past the limit: they never reach the other part, so they only make bumps
  // the push blends over this radius, so neighbouring corners don't jump different amounts (no teeth on fine sculpts)
  const smoothR = opts.smooth ?? 0.25;
  meshes.forEach(m => m.updateMatrixWorld(true));
  const boxes = meshes.map(partBox), invs = meshes.map(m => m.matrixWorld.clone().invert());
  const scales = meshes.map(m => { const s = new THREE.Vector3().setFromMatrixScale(m.matrixWorld); return Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)) || 1; });
  const nmats = meshes.map(m => new THREE.Matrix3().getNormalMatrix(m.matrixWorld));
  const out = [], stats = { moved: 0, largest: 0, pairs: new Set(), perMesh: [] };
  const v = V(), vl = V(), q = V(), nB = V(), hitT = {}, ray = new THREE.Ray();
  meshes.forEach((A, ai) => {
    const pos = A.geometry.attributes.position, P = new Float32Array(pos.count * 3), N = vertexNormalsWorld(A);
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(A.matrixWorld); P[3*i] = v.x; P[3*i+1] = v.y; P[3*i+2] = v.z; }
    const mag = new Float32Array(pos.count), buried = new Uint8Array(pos.count), rawDir = new Float32Array(pos.count * 3); let moved = 0;
    const nb = cornerNeighbours(A.geometry), K = Math.min(40, Math.round(smoothR / edgeLengthWorld(A)));
    // 1. the corners near another part, and the band around them that the smoothing reaches
    const near = new Uint8Array(pos.count); let anyNear = false;
    meshes.forEach((B, bi) => {
      if (bi === ai) return;
      const zone = boxes[ai].clone().expandByScalar(reach).intersect(boxes[bi].clone().expandByScalar(reach)); if (zone.isEmpty()) return;
      const lim = reach / scales[bi], only = opts.only?.[ai];
      for (let i = 0; i < pos.count; i++) {
        if (near[i] || (only && !only.has(i))) continue;
        v.set(P[3*i], P[3*i+1], P[3*i+2]); if (!zone.containsPoint(v)) continue;
        vl.copy(v).applyMatrix4(invs[bi]); const h = B.geometry.boundsTree.closestPointToPoint(vl, hitT, 0, lim);
        if (h && h.distance <= lim) { near[i] = 1; anyNear = true; }
      }
    });
    if (!anyNear) { stats.perMesh.push(0); out.push({ positions: P, moved: mag }); return; }
    const band = growBand(nb, near, K);
    // 2. a calm facing direction: corner normals averaged over the same radius (a sculpt's own normals are noisy)
    if (K > 0) {
      let cur = new Float32Array(N), nxt = new Float32Array(N);
      for (let it = 0; it < K; it++) {
        for (const i of band.list) { let x = cur[3*i], y = cur[3*i+1], z = cur[3*i+2];
          for (let e = nb.start[i]; e < nb.start[i + 1]; e++) { const j = nb.list[e]; x += cur[3*j]; y += cur[3*j+1]; z += cur[3*j+2]; }
          const l = Math.hypot(x, y, z) || 1; nxt[3*i] = x / l; nxt[3*i+1] = y / l; nxt[3*i+2] = z / l; }
        for (const i of band.list) { cur[3*i] = nxt[3*i]; cur[3*i+1] = nxt[3*i+1]; cur[3*i+2] = nxt[3*i+2]; }
      }
      N.set(cur);
    }
    // 3. how far each near corner must go along that direction to reach the other part, plus the overlap
    meshes.forEach((B, bi) => {
      if (bi === ai) return;
      const zone = boxes[ai].clone().expandByScalar(reach).intersect(boxes[bi].clone().expandByScalar(reach));
      if (zone.isEmpty()) return;
      const gB = B.geometry, pb = gB.attributes.position.array, ixb = gB.index.array, lim = reach / scales[bi];
      for (let i = 0; i < pos.count; i++) {
        if (!near[i]) continue;
        v.set(P[3*i], P[3*i+1], P[3*i+2]); if (!zone.containsPoint(v)) continue;
        vl.copy(v).applyMatrix4(invs[bi]);
        const h = gB.boundsTree.closestPointToPoint(vl, hitT, 0, lim); if (!h || h.distance > lim) continue;
        q.copy(h.point).applyMatrix4(B.matrixWorld);
        const faceN = (fi, out) => { const f = fi * 3, a0 = V().fromArray(pb, ixb[f] * 3);
          return out.copy(V().fromArray(pb, ixb[f+1] * 3).sub(a0).cross(V().fromArray(pb, ixb[f+2] * 3).sub(a0))).applyMatrix3(nmats[bi]).normalize(); };
        faceN(h.faceIndex, nB);
        const d = v.distanceTo(q);
        if (v.clone().sub(q).dot(nB) < -1e-5) { buried[i] = 1; continue; }   // already inside the other part: they overlap here
        const nA = V(N[3*i], N[3*i+1], N[3*i+2]);
        // straight out along the facing: does it meet the other part across a gap?
        let gap = Infinity, dir = nA;
        ray.origin.copy(v).applyMatrix4(invs[bi]); ray.direction.copy(nA).transformDirection(invs[bi]);
        const r = gB.boundsTree.raycastFirst(ray, THREE.DoubleSide);
        if (r) { const t = r.point.clone().applyMatrix4(B.matrixWorld).distanceTo(v);
          if (t <= reach && faceN(r.faceIndex, V()).dot(nA) < 0) gap = t; }               // hit the side of it that faces us
        // otherwise the nearest point, if it's roughly the way this corner faces (rims, edges): far enough along the facing to reach it
        if (gap === Infinity && d > 1e-6) { const c = q.clone().sub(v).dot(nA) / d; if (c >= 0.5) { gap = d; dir = q.clone().sub(v).divideScalar(d); } }   // straight across, so a sharp rim doesn't flare out sideways
        else if (gap === Infinity) gap = 0;
        if (gap === Infinity) continue;
        const w = gap <= maxGap ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * (gap - maxGap) / blend);  // fades out across the blend band
        let amt = (gap + overlap) * w;
        if (amt <= mag[i]) continue;
        // where does it land? It must end up inside the other part (out of sight). Through a thin edge or past a rim it would
        // come out the far side as a bump: try a shorter push, else leave the corner be.
        const inB = t => { vl.copy(dir).multiplyScalar(t).add(v).applyMatrix4(invs[bi]); const hh = gB.boundsTree.closestPointToPoint(vl, hitT, 0, reach / scales[bi] + 1);
          if (!hh) return false; const f = hh.faceIndex * 3, a0 = V().fromArray(pb, ixb[f] * 3);
          return vl.clone().sub(hh.point).dot(V().fromArray(pb, ixb[f+1] * 3).sub(a0).cross(V().fromArray(pb, ixb[f+2] * 3).sub(a0))) <= 0; };
        if (!inB(amt)) { const t2 = gap + Math.min(overlap, 0.03); if (t2 > mag[i] && inB(t2)) amt = t2; else continue; }
        if (amt > mag[i]) { mag[i] = amt; rawDir[3*i] = dir.x; rawDir[3*i+1] = dir.y; rawDir[3*i+2] = dir.z; stats.pairs.add([ai, bi].sort().join('-')); }
      }
    });
    // which way each corner goes: the way that closes its gap, blended between neighbours; the calm facing where none was needed
    const D = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) if (mag[i] > 0) { D[3*i] = rawDir[3*i] * mag[i]; D[3*i+1] = rawDir[3*i+1] * mag[i]; D[3*i+2] = rawDir[3*i+2] * mag[i]; }
    if (K > 0) {
      const nx = new Float32Array(D);
      for (let it = 0; it < K; it++) {
        for (const i of band.list) { let x = D[3*i], y = D[3*i+1], z = D[3*i+2], c = 1;
          for (let e = nb.start[i]; e < nb.start[i + 1]; e++) { const j = nb.list[e]; x += D[3*j]; y += D[3*j+1]; z += D[3*j+2]; c++; }
          nx[3*i] = x / c; nx[3*i+1] = y / c; nx[3*i+2] = z / c; }
        for (const i of band.list) { D[3*i] = nx[3*i]; D[3*i+1] = nx[3*i+1]; D[3*i+2] = nx[3*i+2]; }
      }
    }
    // 4. blend the amounts. A corner that closes a gap keeps at least its own amount (it ends up inside the other part, out of
    //    sight); the corners around it get the average of their neighbourhood: a small fillet that fades out, never a full-height slab.
    //    Corners already buried in the other part stay put: hidden anyway, and pushing them could poke out through a thin wall.
    if (K > 0) {
      const raw = Float32Array.from(mag); let cur = Float32Array.from(mag), nxt = Float32Array.from(mag);
      for (let it = 0; it < K; it++) { for (const i of band.list) { let s = cur[i], c = 1; for (let e = nb.start[i]; e < nb.start[i + 1]; e++) { s += cur[nb.list[e]]; c++; } nxt[i] = s / c; } cur.set(nxt); }
      for (const i of band.list) { const m = Math.max(raw[i], cur[i]); mag[i] = m > 1e-4 && !buried[i] ? m : 0; }
    }
    for (let i = 0; i < pos.count; i++) if (mag[i] > 0) {
      let x = D[3*i], y = D[3*i+1], z = D[3*i+2], l = Math.hypot(x, y, z);
      // fading out at the edge of the band, ease from the closing direction to the calm facing
      const w = Math.min(1, l / (mag[i] * 0.5 + 1e-9));
      x = x / (l || 1) * w + N[3*i] * (1 - w); y = y / (l || 1) * w + N[3*i+1] * (1 - w); z = z / (l || 1) * w + N[3*i+2] * (1 - w); l = Math.hypot(x, y, z) || 1;
      P[3*i] += x / l * mag[i]; P[3*i+1] += y / l * mag[i]; P[3*i+2] += z / l * mag[i]; moved++; stats.largest = Math.max(stats.largest, mag[i]); }
    stats.moved += moved; stats.perMesh.push(moved);
    out.push({ positions: P, moved: mag });
  });
  stats.seams = stats.pairs.size; delete stats.pairs;
  return { out, stats };
}

/**
 * fillSeams, then clean-up passes on the result until nothing looks across a slit (at most 4):
 * when both sides move, a corner beside them can be left facing a new sliver.
 */
function fillSeamsAll(meshes, opts = {}) {
  const maxGap = opts.maxGap ?? 0.5;
  let res = fillSeams(meshes, opts), passes = 1;
  const moved = res.out.map(o => Float32Array.from(o.moved));
  let left = gapsLeft(meshes, res.out, maxGap);
  for (; passes < 6; passes++) {
    if (left.open === 0) break;
    const tmp = meshes.map((m, k) => { const g = m.geometry.clone(); g.setAttribute('position', new THREE.BufferAttribute(res.out[k].positions, 3));
      g.computeBoundingBox(); g.computeBoundsTree(); return new THREE.Mesh(g); });
    const next = fillSeams(tmp, { ...opts, blend: 0.02, only: left.byMesh, smooth: Math.max(0.1, (opts.smooth ?? 0.25) / 2) });   // touch-ups: a tighter blend  // only gaps up to maxGap: wider ones stay as they are
    tmp.forEach(m => m.geometry.dispose());
    const after = gapsLeft(meshes, next.out, maxGap);
    if (after.open >= left.open) break;                                          // that pass didn't help: keep what we had
    next.out.forEach((o, k) => o.moved.forEach((v, i) => { moved[k][i] += v; }));
    res = { out: next.out, stats: { ...res.stats, largest: Math.max(res.stats.largest, next.stats.largest) } }; left = after;
  }
  let count = 0; moved.forEach(a => a.forEach(v => { if (v > 0) count++; }));
  return { out: res.out.map((o, k) => ({ positions: o.positions, moved: moved[k] })), stats: { ...res.stats, moved: count, passes } };
}

/**
 * After filling: corners that are still close to another part but on its outside (a gap the fill
 * couldn't close, e.g. wider than maxGap). Checked against the filled shapes.
 */
function gapsLeft(meshes, filled, maxGap) {
  const tmp = meshes.map((m, k) => { const g = m.geometry.clone(); g.setAttribute('position', new THREE.BufferAttribute(filled[k].positions, 3));
    g.computeBoundingBox(); g.computeBoundsTree(); const t = new THREE.Mesh(g); return t; });
  let open = 0, checked = 0; const v = V(), ray = new THREE.Ray(), spots = [], byMesh = meshes.map(() => new Set());
  tmp.forEach((A, ai) => {
    const N = vertexNormalsWorld(A), P = A.geometry.attributes.position.array;
    tmp.forEach((B, bi) => {
      if (ai === bi) return;
      const zone = A.geometry.boundingBox.clone().intersect(B.geometry.boundingBox.clone().expandByScalar(maxGap)); if (zone.isEmpty()) return;
      const ixb = B.geometry.index.array, pb = B.geometry.attributes.position.array;
      for (let i = 0; i < P.length; i += 3) {
        v.set(P[i], P[i+1], P[i+2]); if (!zone.containsPoint(v)) continue;
        const n = V(N[i], N[i+1], N[i+2]); ray.origin.copy(v).addScaledVector(n, 1e-4); ray.direction.copy(n);
        const r = B.geometry.boundsTree.raycastFirst(ray, THREE.DoubleSide); if (!r || r.distance > maxGap) continue;
        checked++;
        const f = r.faceIndex * 3, a0 = V().fromArray(pb, ixb[f] * 3), fn = V().fromArray(pb, ixb[f+1] * 3).sub(a0).cross(V().fromArray(pb, ixb[f+2] * 3).sub(a0));
        if (fn.dot(n) < 0 && r.distance > 1e-3) { open++; byMesh[ai].add(i / 3); if (spots.length < 2000) spots.push(v.clone()); }   // a slit: looking out, we see the other part's outside
      }
    });
  });
  tmp.forEach(m => m.geometry.dispose());
  return { open, checked, spots, byMesh };
}

/** Sample kit: a 32 mm base with a pin hole, a body with a foot peg and shoulder cups, an arm with a ball and clevis, a weapon with a 2 mm tab. */
function sampleKit() {
  const clean = g => { g.deleteAttribute('normal'); g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; };
  const merge = gs => mergeGeometries(gs.map(clean));
  const box = (w, d, h, x, y, z) => new THREE.BoxGeometry(w, d, h).translate(x, y, z);
  const ringPlate = (shape, holeR, depth) => {
    const hole = new THREE.Path(); hole.absarc(0, 0, holeR, 0, Math.PI * 2, true); shape.holes.push(hole);
    return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 48 });
  };
  const disc = new THREE.Shape(); disc.absarc(0, 0, 16, 0, Math.PI * 2, false);
  const base = merge([ringPlate(disc, 1.6, 4)]);                                  // top face z=4 has the hole
  const plateShape = new THREE.Shape(); plateShape.moveTo(-5, -3); plateShape.lineTo(5, -3); plateShape.lineTo(5, 3); plateShape.lineTo(-5, 3); plateShape.closePath();
  const cup = (sx) => new THREE.SphereGeometry(3.15, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(sx * Math.PI / 2).translate(sx * 10.15, 0, 23);
  const body = merge([
    ringPlate(plateShape, 1.5, 1),                                                 // foot plate, underside z=0 has the peg ring
    new THREE.CylinderGeometry(1.5, 1.5, 3, 24).rotateX(Math.PI / 2).translate(0, 0, -1.5),  // foot peg
    box(10, 6, 12, 0, 0, 7), box(14, 8, 14, 0, 0, 20),
    cup(1), cup(-1),
  ]);
  const arm = merge([
    new THREE.SphereGeometry(3, 32, 20),                                           // shoulder ball
    new THREE.CylinderGeometry(1.8, 1.6, 14, 20).rotateZ(Math.PI / 2).translate(9, 0, 0),
    box(4, 1, 4, 18, 1.6, 0), box(4, 1, 4, 18, -1.6, 0),                           // clevis: 2.2 mm gap
  ]);
  const weapon = merge([box(5, 2, 3.5, 0, 0, 0), box(26, 0.8, 6, 15, 0, 0)]);      // 2.0 mm tab + blade
  return [
    { name: "Base 32mm", geom: base, at: [0, 0, 0], rot: [0, 0, 0] },
    { name: "Body", geom: body, at: [40, 0, 3], rot: [0, 0, 0.5] },
    { name: "Right Arm", geom: arm, at: [-28, 22, 6], rot: [0.4, 0.2, 2.2] },
    { name: "Sword", geom: weapon, at: [-30, -24, 4], rot: [1.2, 0.3, -0.6] },
  ];
}
/**
 * Height field of a mesh seen along `frame.z`, inside a disc of radius R around frame.o.
 * mode 'max' keeps the highest surface in each cell (the fixed part, seen from the moving part),
 * 'min' the lowest (the moving part, seen from the fixed part). Cells nothing covers are NaN.
 */
function heightField(geom, M, frame, R, cell, mode, hLim) {
  const n = Math.ceil(2 * R / cell), H = new Float32Array(n * n).fill(NaN), pos = geom.attributes.position.array, idx = geom.index.array;
  const e = M.elements, { o, x: X, y: Y, z: Z } = frame, max = mode === 'max';
  const nv = pos.length / 3, P = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const a = pos[3*i], b = pos[3*i+1], c = pos[3*i+2];
    const wx = e[0]*a + e[4]*b + e[8]*c + e[12] - o.x, wy = e[1]*a + e[5]*b + e[9]*c + e[13] - o.y, wz = e[2]*a + e[6]*b + e[10]*c + e[14] - o.z;
    P[3*i] = wx*X.x + wy*X.y + wz*X.z; P[3*i+1] = wx*Y.x + wy*Y.y + wz*Y.z; P[3*i+2] = wx*Z.x + wy*Z.y + wz*Z.z;
  }
  const put = (k, h) => { const c = H[k]; if (c !== c || (max ? h > c : h < c)) H[k] = h; };
  const inv = 1 / cell;
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = 3*idx[t], i1 = 3*idx[t+1], i2 = 3*idx[t+2];
    const ax = P[i0], ay = P[i0+1], ah = P[i0+2], bx = P[i1], by = P[i1+1], bh = P[i1+2], cx = P[i2], cy = P[i2+1], ch = P[i2+2];
    if (Math.max(ax, bx, cx) < -R || Math.min(ax, bx, cx) > R || Math.max(ay, by, cy) < -R || Math.min(ay, by, cy) > R) continue;
    if (Math.min(ah, bh, ch) > hLim || Math.max(ah, bh, ch) < -hLim) continue;
    const gx0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) + R) * inv)), gx1 = Math.min(n - 1, Math.floor((Math.max(ax, bx, cx) + R) * inv));
    const gy0 = Math.max(0, Math.floor((Math.min(ay, by, cy) + R) * inv)), gy1 = Math.min(n - 1, Math.floor((Math.max(ay, by, cy) + R) * inv));
    // only surfaces that face the other part: walls are left out, so two walls that meet exactly
    // don't read as one part sunk into the other in the cells along the wall
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax), nl = Math.hypot((by - ay) * (ch - ah) - (bh - ah) * (cy - ay), (bh - ah) * (cx - ax) - (bx - ax) * (ch - ah), nz);
    if (!(nl > 0) || (max ? nz / nl < 0.2 : nz / nl > -0.2)) continue;
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (gx0 === gx1 && gy0 === gy1) { const h = (ah + bh + ch) / 3; if (Math.abs(h) <= hLim) put(gy0 * n + gx0, h); continue; }   // smaller than a cell
    if (Math.abs(det) < 1e-12) continue;
    for (let gy = gy0; gy <= gy1; gy++) { const py = -R + (gy + 0.5) * cell;
      for (let gx = gx0; gx <= gx1; gx++) { const px = -R + (gx + 0.5) * cell;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const h = l1 * ah + l2 * bh + l3 * ch; if (Math.abs(h) <= hLim) put(gy * n + gx, h);
      } }
  }
  return { H, n, cell, R };
}

/**
 * Seat the moving part on the fixed one the way you'd push two pieces together by hand: look along
 * the joint axis, try every turn about it (and small slides across it, and slight tilts), push the
 * moving part in until it touches, and keep the pose with the most surface touching.
 * Keys, notches and pegs only let the parts close up in the right orientation, so that pose wins.
 * frame: { o: joint point, z: axis pointing from the fixed part toward the moving part } (world).
 * Returns { theta (rad, about z), dx, dy (along frame x/y), dz (along z, negative = pushed in), tiltX, tiltY,
 *           contact (mm²), depthGain, T (world matrix to pre-multiply the moving part's pose) }.
 */
function seatSolve(moving, Mm, fixed, Mf, frame0, opts = {}) {
  const z = frame0.z.clone().normalize(), { u: x, v: y } = planeBasis(z), o = frame0.o.clone();
  const frame = { o, x, y, z };
  const R = opts.R, cell = opts.cell || Math.max(R / 110, 0.02), shift = opts.shift ?? Math.max(1, R * 0.35), hLim = opts.hLim || Math.max(R, 3);
  const tol = opts.tol ?? Math.max(0.08, cell * 1.2), spinRange = opts.spinRange ?? Math.PI;
  const F = heightField(fixed, Mf, frame, R + shift, cell, 'max', hLim);
  const C = heightField(moving, Mm, frame, R, cell, 'min', hLim);
  // moving part's cells as points
  const pts = []; for (let gy = 0; gy < C.n; gy++) for (let gx = 0; gx < C.n; gx++) { const h = C.H[gy * C.n + gx]; if (h === h) { const px = -R + (gx + .5) * cell, py = -R + (gy + .5) * cell; if (px*px + py*py <= R*R) pts.push(px, py, h); } }
  const all = new Float32Array(pts), nAll = all.length / 3;
  if (nAll < 30) return null;
  const sub = (k) => { const s = Math.max(1, Math.floor(nAll / k)), out = new Float32Array(Math.ceil(nAll / s) * 3); let j = 0; for (let i = 0; i < nAll; i += s) { out[j++] = all[3*i]; out[j++] = all[3*i+1]; out[j++] = all[3*i+2]; } return out.subarray(0, j); };
  const FR = F.R, Fn = F.n, FH = F.H, finv = 1 / cell;
  const D = new Float32Array(nAll);
  // score one pose: push it in as far as pays off. Cells that touch count for it, cells that would sink
  // into the fixed part count against it (a few wall cells always clash on a grid, so this is a trade, not a hard stop)
  const QS = [0, 0.002, 0.005, 0.01, 0.02, 0.035, 0.06, 0.09, 0.13, 0.18];
  let tolC = tol, tolP = tol * 1.2, SUNK_W = 1;
  const score = (P, th, dx, dy, tx, ty) => {
    const c = Math.cos(th), s = Math.sin(th), np = P.length / 3; let m = 0;
    for (let i = 0; i < np; i++) {
      const px = P[3*i], py = P[3*i+1], qx = c*px - s*py + dx, qy = s*px + c*py + dy;
      const gx = Math.floor((qx + FR) * finv), gy = Math.floor((qy + FR) * finv);
      if (gx < 0 || gy < 0 || gx >= Fn || gy >= Fn) continue;
      const hf = FH[gy * Fn + gx]; if (hf !== hf) continue;
      D[m++] = P[3*i+2] + tx * px + ty * py - hf;
    }
    if (m < np * 0.05) return null;
    const d = D.subarray(0, m); d.sort();
    let best = null;
    for (const q of QS) {
      const push = d[Math.min(m - 1, Math.floor(m * q))];
      let lo = 0; while (lo < m && d[lo] < push - tolP) lo++;            // sunk deeper than allowed
      let hi = lo; while (hi < m && d[hi] < push + tolC) hi++;           // touching
      const v = (hi - lo) - SUNK_W * lo;
      if (!best || v > best.v) best = { v, push, touch: hi - lo, sunk: lo, m };
    }
    return best;
  };
  const area1 = cell * cell;
  // when poses fit equally well (a plain block on a plain face), keep the one that moves least
  const rank0 = (r, P) => r ? r.v * (nAll / (P.length / 3)) * area1 : -1e9;
  let rank = rank0;
  const lean = (a, th, dx, dy) => a - Math.abs(a) * (0.02 * Math.abs(angDiff(th, 0)) / Math.PI + 0.01 * Math.hypot(dx, dy) / Math.max(shift, 1e-6));
  // 1. coarse: every turn, a grid of slides, judged loosely so a nearly-right pose still shows as seated
  tolC = Math.max(tol, 0.25); tolP = 0.4; SUNK_W = 0.3;
  const P1 = sub(2000), cands = [];
  const thStep = opts.thStep || (3 * Math.PI / 180), sStep = Math.max(shift / 5, cell * 2);
  const nTh = Math.floor(spinRange / thStep + 1e-9), nS = Math.floor(shift / sStep + 1e-9);
  for (let it = spinRange >= Math.PI ? -nTh + 1 : -nTh; it <= nTh; it++) { const th = it * thStep;
    for (let ix = -nS; ix <= nS; ix++) for (let iy = -nS; iy <= nS; iy++) { const dx = ix * sStep, dy = iy * sStep;
      if (dx*dx + dy*dy > shift*shift * 1.01 + 1e-12) continue;
      const r = score(P1, th, dx, dy, 0, 0); if (!r) continue;
      cands.push({ th, dx, dy, tx: 0, ty: 0, a: lean(rank(r, P1), th, dx, dy), push: r.push });
    } }
  if (!cands.length) return null;
  cands.sort((p, q) => q.a - p.a);
  // 2. the most promising poses again with more points and the real tolerance, then refine the best few:
  //    shrinking steps over turn, slide and tilt
  tolC = Math.max(tol, 0.15); tolP = tolC; SUNK_W = opts.sunkWeight ?? 1;
  const P2 = sub(6000), top = [];
  const short = cands.slice(0, 80).map(c0 => { const r = score(P2, c0.th, c0.dx, c0.dy, 0, 0); return { ...c0, a: lean(rank(r, P2), c0.th, c0.dx, c0.dy), push: r ? r.push : 0 }; }).sort((p, q) => q.a - p.a);
  for (const c0 of short) { if (top.length >= 8) break; if (top.some(t => Math.abs(angDiff(t.th, c0.th)) < thStep * 2.5 && Math.hypot(t.dx - c0.dx, t.dy - c0.dy) < sStep * 1.5)) continue; top.push(c0); }
  const tiltMax = opts.tilt ?? 0.035;
  const refined = top.map(c0 => {
    let best = { ...c0 }; { const r = score(P2, best.th, best.dx, best.dy, 0, 0); best.a = rank(r, P2); best.push = r ? r.push : 0; }
    let st = thStep / 2, ss = sStep / 2, sT = tiltMax / 2;
    for (let it = 0; it < 7; it++) {
      let moved = true;
      while (moved) { moved = false;
        for (const [k, s] of [['th', st], ['dx', ss], ['dy', ss], ['tx', sT], ['ty', sT]]) for (const sg of [-1, 1]) {
          const t = { ...best }; t[k] += sg * s;
          if ((k === 'tx' || k === 'ty') && Math.abs(t[k]) > tiltMax) continue;
          if ((k === 'dx' || k === 'dy') && Math.hypot(t.dx, t.dy) > shift * 1.2 + 1e-12) continue;
          if (k === 'th' && spinRange < Math.PI && Math.abs(t.th) > spinRange * 1.2 + 1e-12) continue;
          const r = score(P2, t.th, t.dx, t.dy, t.tx, t.ty); const a = rank(r, P2);
          if (a > best.a * 1.0005 + 1e-9) { best = { ...t, a, push: r.push }; moved = true; }
        } }
      st /= 2; ss /= 2; sT /= 2;
    }
    const rf = score(all, best.th, best.dx, best.dy, best.tx, best.ty);
    return { ...best, a: rank(rf, all), push: rf ? rf.push : best.push, touch: rf ? rf.touch * area1 : 0, sunk: rf ? rf.sunk * area1 : 0 };
  }).sort((p, q) => lean(q.a, q.th, q.dx, q.dy) - lean(p.a, p.th, p.dx, p.dy));
  const b = refined[0];
  // world transform: tilt + turn about the joint, slide across, push along the axis
  const rot = new THREE.Matrix4().makeBasis(x, y, z), toF = rot.clone().transpose();
  const local = new THREE.Matrix4().makeRotationZ(b.th);
  // small tilt: heights change by tx*x + ty*y  →  rotate about y by -tx, about x by ty
  const tilt = new THREE.Matrix4().makeRotationY(-Math.atan(b.tx)).premultiply(new THREE.Matrix4().makeRotationX(Math.atan(b.ty)));
  const Lm = new THREE.Matrix4().makeTranslation(b.dx, b.dy, -b.push).multiply(local).multiply(tilt);
  const T = Tr(o).multiply(rot).multiply(Lm).multiply(toF).multiply(Tr(o.clone().negate()));
  const alt = refined.slice(1).map(r => ({ theta: r.th, contact: r.touch, score: r.a }));
  return { theta: b.th, dx: b.dx, dy: b.dy, dz: -b.push, tiltX: b.tx, tiltY: b.ty, contact: b.touch, sunk: b.sunk, score: b.a, T, frame, alt, cells: nAll };
}
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
/** Points spread over some triangles of a part (by area), with their normals, in world space. */
function areaSamples(topo, M, list, n, seed = 7) {
  const cum = new Float64Array(list.length); let A = 0;
  list.forEach((t, k) => { A += topo.fa[t]; cum[k] = A; });
  const P = [], N = [], nm = new THREE.Matrix3().getNormalMatrix(M), a = V(), b = V(), c = V();
  let s = seed; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < n && A > 0; k++) {
    const u = (k + rnd()) / n * A; let lo = 0, hi = list.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < u) lo = m + 1; else hi = m; }
    const t = list[lo], ix = topo.idx;
    a.fromArray(topo.pos, 3 * ix[3*t]); b.fromArray(topo.pos, 3 * ix[3*t+1]); c.fromArray(topo.pos, 3 * ix[3*t+2]);
    let x = rnd(), y = rnd(); if (x + y > 1) { x = 1 - x; y = 1 - y; }
    P.push(a.clone().addScaledVector(b.clone().sub(a), x).addScaledVector(c.clone().sub(a), y).applyMatrix4(M));
    N.push(triNormal(topo, t).applyMatrix3(nm).normalize());
  }
  return { P, N, area: A };
}
/** A BVH over just some triangles of a part, in world space (so distances only count the picked areas). */
function patchMesh(topo, M, list) {
  const pos = new Float32Array(list.length * 9), v = V();
  list.forEach((t, i) => { for (let k = 0; k < 3; k++) { v.fromArray(topo.pos, 3 * topo.idx[3*t+k]).applyMatrix4(M); pos.set([v.x, v.y, v.z], i*9 + k*3); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(Array.from({ length: list.length * 3 }, (_, i) => i)); g.computeBoundsTree();
  return g;
}

/**
 * Fit several picked areas of one part onto several picked areas of another, all at once. Areas don't need
 * to pair up one to one or be the same size: the fit brings as much of the picked surface on each side as
 * possible against picked surface on the other, facing it. Tries each picked area against each picked area
 * at a range of turns, then refines the best with point-to-plane steps.
 * groupsA/B: arrays of triangle lists. Returns fits sorted best first: { T, joint, axis, coverage, gap, score }.
 */
function multiFit(topoA, MA, groupsA, topoB, MB, groupsB, opts = {}) {
  // the fixed side can be several parts (the last piece of a puzzle): topoB = [{ topo, M, groups }, …]
  const srcB = Array.isArray(topoB) ? topoB : [{ topo: topoB, M: MB, groups: groupsB }];
  const listA = [...new Set(groupsA.flat())];
  const gA = patchMesh(topoA, MA, listA), SA = areaSamples(topoA, MA, listA, 1500, 11);
  const partsB = srcB.map(sb => { const list = [...new Set(sb.groups.flat())]; return { ...sb, list, area: list.reduce((a, t) => a + sb.topo.fa[t], 0) }; });
  const areaB = partsB.reduce((a, q) => a + q.area, 0) || 1;
  const gB = partsB.length === 1 ? patchMesh(partsB[0].topo, partsB[0].M, partsB[0].list) : (() => {      // one BVH over every fixed part's picked areas
    const gs = partsB.map(q => patchMesh(q.topo, q.M, q.list)), n = gs.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3); let o = 0;
    for (const g of gs) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; g.disposeBoundsTree?.(); g.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(Array.from({ length: n }, (_, i) => i)); g.computeBoundsTree(); return g; })();
  const SB = { P: [], N: [], area: 0 };
  partsB.forEach((q, k) => { const r = areaSamples(q.topo, q.M, q.list, Math.max(150, Math.round(1500 * q.area / areaB)), 23 + k); SB.P.push(...r.P); SB.N.push(...r.N); SB.area += r.area; });
  // outline points of every picked area: flat areas only line up across the face by their edges
  const edgeSamples = (topo, M, list, n) => {
    const inSet = new Set(list), segs = []; let L = 0; const a = V(), b = V();
    for (const t of list) for (let e = 0; e < 3; e++) { const nb = topo.nb[3*t+e]; if (nb >= 0 && inSet.has(nb)) continue;
      a.fromArray(topo.pos, 3 * topo.idx[3*t+e]).applyMatrix4(M); b.fromArray(topo.pos, 3 * topo.idx[3*t+(e+1)%3]).applyMatrix4(M);
      const l = a.distanceTo(b); if (l > 0) { segs.push([a.clone(), b.clone(), l]); L += l; } }
    const out = []; if (!L) return out; const step = L / n; let acc = step / 2;
    for (const [p, q, l] of segs) { while (acc <= l) { out.push(p.clone().lerp(q, acc / l)); acc += step; } acc -= l; }
    return out;
  };
  const EA = edgeSamples(topoA, MA, listA, 400), EB = partsB.flatMap(q => edgeSamples(q.topo, q.M, q.list, Math.max(80, Math.round(400 * q.area / areaB))));
  const nearestPt = (p, set) => { let bi = -1, bd = Infinity; for (let i = 0; i < set.length; i++) { const d = p.distanceToSquared(set[i]); if (d < bd) { bd = d; bi = i; } } return bi < 0 ? null : { q: set[bi], d: Math.sqrt(bd) }; };
  const plane = (topo, M, list) => { const pl = regionPlane(topo, list); const nm = new THREE.Matrix3().getNormalMatrix(M); return { n: pl.n.clone().applyMatrix3(nm).normalize(), p: pl.p.clone().applyMatrix4(M), A: pl.A }; };
  const pa = groupsA.map(l => plane(topoA, MA, l)), pb = partsB.flatMap(q => q.groups.map(l => plane(q.topo, q.M, l)));
  const all = (ps) => { const n = V(), p = V(); let A = 0; ps.forEach(q => { n.addScaledVector(q.n, q.A); p.addScaledVector(q.p, q.A); A += q.A; }); return { n: n.normalize(), p: p.multiplyScalar(1 / A), A }; };
  const uA = all(pa), uB = all(pb);
  const size = Math.max(new THREE.Box3().setFromPoints(SA.P).getSize(V()).length(), 1);
  const tol = opts.tol ?? Math.max(0.1, Math.min(0.25, size * 0.01));
  const tg = {}, q = V(), fn = V(), ta = V(), tb = V(), tc = V();
  const near = (g, p, thr) => { const h = g.boundsTree.closestPointToPoint(p, tg, 0, thr); if (!h) return null;
    const f = h.faceIndex * 3, ix = g.index.array, P = g.attributes.position; ta.fromBufferAttribute(P, ix[f]); tb.fromBufferAttribute(P, ix[f+1]); tc.fromBufferAttribute(P, ix[f+2]);
    fn.subVectors(tb, ta).cross(tc.clone().sub(ta)).normalize(); return { p: h.point, d: h.distance, n: fn }; };
  // one ICP run from pose T (world, applied to A); sA/sB are sample subsets
  const run = (T0, iters, nA, nB, thr0, thr1) => {
    let T = T0.clone();
    const idxA = Array.from({ length: Math.min(nA, SA.P.length) }, (_, i) => Math.floor(i * SA.P.length / Math.min(nA, SA.P.length)));
    const idxB = Array.from({ length: Math.min(nB, SB.P.length) }, (_, i) => Math.floor(i * SB.P.length / Math.min(nB, SB.P.length)));
    for (let it = 0; it < iters; it++) {
      const thr = thr0 * Math.pow(thr1 / thr0, it / Math.max(1, iters - 1));
      const Rm = new THREE.Matrix3().setFromMatrix4(T), Ti = T.clone().invert(), Rmi = new THREE.Matrix3().setFromMatrix4(Ti);
      const AtA = Array.from({ length: 6 }, () => new Float64Array(6)), Atb = new Float64Array(6); let cnt = 0;
      const ctr = uB.p;
      const add = (p, f, n) => {       // moving point p (world, already posed) should sit on plane (f, n)
        const r = p.clone().sub(f).dot(n), px = p.x - ctr.x, py = p.y - ctr.y, pz = p.z - ctr.z;
        const J = [py * n.z - pz * n.y, pz * n.x - px * n.z, px * n.y - py * n.x, n.x, n.y, n.z];
        for (let x = 0; x < 6; x++) { Atb[x] -= J[x] * r; for (let y = 0; y < 6; y++) AtA[x][y] += J[x] * J[y]; } cnt++;
      };
      for (const i of idxA) { const p = SA.P[i].clone().applyMatrix4(T), n = SA.N[i].clone().applyMatrix3(Rm).normalize();
        const h = near(gB, p, thr); if (!h || h.n.dot(n) > -0.3) continue; add(p, h.p.clone(), h.n.clone()); }
      const eStep = Math.max(1, Math.floor(EA.length / Math.max(60, nA / 4)));
      for (let i = 0; i < EA.length; i += eStep) { const p = EA[i].clone().applyMatrix4(T), h = nearestPt(p, EB); if (!h || h.d > thr) continue;
        for (const ax of [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)]) add(p, h.q, ax); }
      for (const i of idxB) { const pb = SB.P[i], nb = SB.N[i];          // B's point vs A's surface, in A's posed frame
        const h = near(gA, q.copy(pb).applyMatrix4(Ti), thr); if (!h) continue;
        const pA = h.p.clone().applyMatrix4(T), nA = h.n.clone().applyMatrix3(Rm).normalize(); if (nA.dot(nb) > -0.3) continue;
        // move A's surface point onto B's point along B's normal
        add(pA, pb, nb); }
      if (cnt < 12) break;
      for (let k = 0; k < 6; k++) AtA[k][k] += 1e-6 * (AtA[k][k] + 1);
      const x = solveLinear(AtA.map(r => Array.from(r)), Array.from(Atb)); if (!x) break;
      const rv = V(x[0], x[1], x[2]), ang = rv.length();
      const Rk = ang > 1e-12 ? new THREE.Matrix4().makeRotationAxis(rv.clone().divideScalar(ang), Math.min(ang, 0.2)) : new THREE.Matrix4();
      const tr = V(x[3], x[4], x[5]); const tl = tr.length(), cap = size * 0.2; if (tl > cap) tr.multiplyScalar(cap / tl);
      T = Tr(tr.add(ctr)).multiply(Rk).multiply(Tr(ctr.clone().negate())).multiply(T);
    }
    return T;
  };
  const evalT = (T) => {        // how much picked surface meets picked surface, both ways
    const Rm = new THREE.Matrix3().setFromMatrix4(T), Ti = T.clone().invert(); let inA = 0, inB = 0, nA = 0, nB = 0; const ds = [];
    for (let i = 0; i < SA.P.length; i += 3) { nA++; const p = SA.P[i].clone().applyMatrix4(T), n = SA.N[i].clone().applyMatrix3(Rm).normalize();
      const h = near(gB, p, 1); if (h && h.n.dot(n) < -0.3) { ds.push(h.d); if (h.d < tol) inA++; } }
    for (let i = 0; i < SB.P.length; i += 3) { nB++; const h = near(gA, q.copy(SB.P[i]).applyMatrix4(Ti), tol); if (h) inB++; }
    ds.sort((a, b) => a - b);
    const covA = inA / nA, covB = inB / nB;
    return { coverage: Math.max(covA, covB), covA, covB, gap: ds.length ? ds[ds.length >> 1] : Infinity, fit: (covA * SA.area + covB * SB.area) / (SA.area + SB.area) };
  };
  // starting poses: every picked area of A onto every picked area of B (and all onto all), at 12 turns
  const starts = [];
  const pairs = [[uA, uB], ...pa.flatMap(a => pb.map(b => [a, b]))].slice(0, 13);
  for (const [a, b] of pairs) {
    const q0 = new THREE.Quaternion().setFromUnitVectors(a.n, b.n.clone().negate());
    for (let k = 0; k < 12; k++) {
      const qk = new THREE.Quaternion().setFromAxisAngle(b.n, k * Math.PI / 6).multiply(q0);
      starts.push(Tr(b.p).multiply(new THREE.Matrix4().makeRotationFromQuaternion(qk)).multiply(Tr(a.p.clone().negate())));
    }
  }
  if (opts.startAt) starts.unshift(opts.startAt.clone());
  const coarse = starts.map(T0 => { const T = run(T0, 10, 300, 300, Math.max(size * 0.15, 1), Math.max(tol * 2, 0.2)); return { T, e: evalT(T) }; })
    .sort((x, y) => y.e.fit - x.e.fit);
  const out = [];
  for (const c of coarse.slice(0, 5)) {
    const T = run(c.T, 25, 1500, 1500, Math.max(tol * 4, 0.5), tol), e = evalT(T);
    out.push({ T, joint: uB.p.clone(), axis: uB.n.clone(), coverage: e.coverage, covTol: tol, gap: e.gap, size, fit: e.fit, score: 1 - e.fit });
  }
  return out.sort((x, y) => y.fit - x.fit);
}
/**
 * How many of a part a file name asks for: "Leg x8", "leg_8x", "Arm (x2)", "2x shoulder pad".
 * Returns { base, count } with the count marker taken out of the name. Count is 1 when there's none.
 */
function parseQuantity(name) {
  const re = /(^|[\s_\-.(\[])(?:[x×]\s?(\d{1,3})|(\d{1,3})\s?[x×])(?=$|[\s_\-.)\]])/i;
  const m = name.match(re);
  if (!m) return { base: name, count: 1 };
  const count = Math.min(+(m[2] || m[3]), 99);
  if (!(count >= 1)) return { base: name, count: 1 };
  const base = (name.slice(0, m.index) + m[1] + name.slice(m.index + m[0].length)).replace(/[\s_\-]*[(\[]\s*[)\]]/g, '').replace(/([\s_\-.])[\s_\-.]+/g, '$1').replace(/[\s_\-.]+$/, '').replace(/^[\s_\-.]+/, '').replace(/\s{2,}/g, ' ').trim();
  return { base: base || name, count };
}

/** A piece's name for its sprue tag: the file name, shortened in the middle part if needed; "Leg 3-8" keeps its count. */
function shortLabel(name, max = 16) {
  const n = name.replace(/\.stl$/i, '').replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (n.length <= max) return n;
  const m = n.match(/^(.*?)(\s*\d+-\d+)$/), base = m ? m[1] : n, tail = m ? m[2] : '';
  return base.slice(0, Math.max(3, max - tail.length - 1)).replace(/[\s\-]+$/, '') + '…' + tail;
}
/** Width of a moulded name tag for a label (mm). */
const tagWidth = text => Math.max(5.2, 1.8 + 1.25 * text.length);

/**
 * Lay part footprints out on sprue frames, row by row like a kit. items: [{ id, w, h }] in mm (part
 * size plus room for the gates). Rows fill left to right up to `maxW`, frames fill up to `maxH`.
 * Returns frames: [{ w, h, rows: [y boundaries], places: [{ id, x, y, w, h, row }] }] in frame coordinates.
 */
function packSprues(items, opts = {}) {
  const maxW = Math.max(opts.maxW || 140, ...items.map(i => i.w)), maxH = Math.max(opts.maxH || 110, ...items.map(i => i.h));
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  const frames = []; let fr = null, row = null;
  const newFrame = () => { fr = { w: 0, h: 0, rows: [0], places: [] }; frames.push(fr); row = null; };
  const newRow = it => {
    const y = fr.h;
    if (fr.places.length && y + it.h > maxH) { newFrame(); return newRow(it); }
    row = { y, h: it.h, x: 0, k: fr.rows.length - 1 }; fr.h = y + it.h; fr.rows.push(fr.h);
  };
  newFrame();
  for (const it of sorted) {
    if (!row || row.x + it.w > maxW) newRow(it);
    fr.places.push({ id: it.id, x: row.x, y: row.y, w: it.w, h: it.h, row: row.k });      // sits on the runner below, so its gates stay short
    row.x += it.w; fr.w = Math.max(fr.w, row.x);
  }
  return frames.filter(f => f.places.length);
}

/**
 * Plastic for one sprue frame, styled like an injection-moulded kit: round runners with rounded
 * joints, an outer rim, a runner between rows and between neighbouring pieces (each piece in its own
 * cell), a lettered tab, a little number tag by each piece, and thick round gates that taper down to
 * where they meet the piece. All in world space. bar = runner diameter in mm.
 */
function sprueGeometry(f, gates, bar = 2.6) {
  const gs = [], z = f.z, r = bar / 2, ends = new Map();
  const ball = (x, y, zz, rr) => { const k = `${x.toFixed(3)},${y.toFixed(3)},${zz.toFixed(3)},${rr.toFixed(3)}`; if (ends.has(k)) return; ends.set(k, 1);
    const g = new THREE.SphereGeometry(rr, 14, 10); g.translate(x, y, zz); gs.push(g); };
  const rod = (a, b, r0, r1 = r0, seg = 16) => {
    const d = b.clone().sub(a), L = d.length(); if (!(L > 1e-4)) return;
    const c = new THREE.CylinderGeometry(r1, r0, L, seg, 1, true);
    c.translate(0, L / 2, 0); c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize())); c.translate(a.x, a.y, a.z); gs.push(c);
  };
  const runner = (x0, y0, x1, y1) => { rod(V(x0, y0, z), V(x1, y1, z), r); ball(x0, y0, z, r); ball(x1, y1, z, r); };
  const { x0, y0, x1, y1 } = f;
  runner(x0, y0, x1, y0); runner(x0, y1, x1, y1); runner(x0, y0, x0, y1); runner(x1, y0, x1, y1);
  for (const y of f.runners) runner(x0, y, x1, y);
  for (const d of f.dividers || []) runner(d.x, d.y0, d.x, d.y1);
  // the frame's letter tab, sticking out of the top rim
  { const t = new THREE.BoxGeometry(11, 7, bar * 0.7); t.translate(x0 + 9, y1 + r + 3, z); gs.push(t); rod(V(x0 + 9, y1, z), V(x0 + 9, y1 + r + 0.5, z), r * 0.8); }
  for (const t of f.tags || []) { const g = new THREE.BoxGeometry(t[2] || 5.2, 3.4, bar * 0.55); g.translate(t[0], t[1], z); gs.push(g); }
  for (const g of gates) {
    const a = V(...g.a), b = V(...g.b);
    rod(a, b, g.r0, g.r1, 14);                                      // thick at the runner, narrowing to the piece
    ball(a.x, a.y, a.z, g.r0 * 1.15);                               // a rounded root where it leaves the runner
    ball(b.x, b.y, b.z, g.r1);
  }
  const out = mergeGeometries(gs.map(g => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g.index ? g.toNonIndexed() : g; }));
  gs.forEach(g => g.dispose());
  return out;
}
/**
 * Arrange boxes (w × h) in rows so the whole block comes out close to the golden ratio (about 1.6
 * wide to 1 tall, like a screen) rather than one long line. Items keep the order given; tries a few
 * row widths and keeps the one that is closest to the ratio and wastes least room.
 * Returns { pos: [{ x, y }] (top-left of each, y measured downward), w, h }.
 */
function goldenPack(items, gap = 8, ratio = 1.618) {
  if (!items.length) return { pos: [], w: 0, h: 0 };
  const area = items.reduce((a, it) => a + (it.w + gap) * (it.h + gap), 0), widest = Math.max(...items.map(i => i.w));
  const pack = W => {
    const pos = []; let x = 0, y = 0, rowH = 0, w = 0;
    items.forEach((it, i) => { if (x > 0 && x + it.w > W + 1e-9) { y += rowH + gap; x = 0; rowH = 0; } pos[i] = { x, y }; x += it.w + gap; rowH = Math.max(rowH, it.h); w = Math.max(w, x - gap); });
    return { pos, w, h: y + rowH };
  };
  const W0 = Math.max(widest, Math.sqrt(area * ratio));
  let best = null;
  for (const f of [0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.7]) {
    const r = pack(Math.max(widest, W0 * f));
    r.score = Math.abs(Math.log(r.w / Math.max(r.h, 1e-6) / ratio)) + 0.6 * Math.log(Math.max(1, (r.w + gap) * (r.h + gap) / area));
    if (!best || r.score < best.score - 1e-9) best = r;
  }
  return best;
}
// ==MATH END==

export {
  buildTopo,
  growRegion,
  solve4,
  fitSphereOnce,
  fitSphere,
  boundaryLoops,
  triNormal,
  triCenter,
  worldNormal,
  pickBall,
  planeBasis,
  regionPlane,
  rasterHoles,
  pickFlat,
  discAround,
  resolveCentre,
  weldGeometry,
  pickPoint,
  gapMidframe,
  frame3,
  Tr,
  rotBetween,
  computeSnap,
  writeSTL,
  sliceMesh,
  chainSegments,
  segmentsGap,
  jointBasis,
  slideToContact,
  fitCuts,
  eigenSym,
  eigenSym3,
  rigidFit,
  creaseRegion,
  pickSurface,
  segmentRegions,
  fract,
  regionSamples,
  insideFraction,
  closestOnSegs,
  solveLinear,
  matchRegions,
  partBox,
  boxVol,
  looksStacked,
  contactContext,
  contactBetween,
  detectContacts,
  NAME_ROOT,
  NAME_FIXED,
  planRig,
  AXES,
  nearestAxis,
  orientQuat,
  rotAbout,
  dominantDirections,
  squareUpQuat,
  faceLongAxis,
  vertexNormalsWorld,
  cornerNeighbours,
  edgeLengthWorld,
  growBand,
  fillSeams,
  fillSeamsAll,
  gapsLeft,
  sampleKit,
  heightField,
  seatSolve,
  angDiff,
  areaSamples,
  patchMesh,
  multiFit,
  parseQuantity,
  shortLabel,
  tagWidth,
  packSprues,
  sprueGeometry,
  goldenPack,
};
