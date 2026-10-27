import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { computeBoundsTree, acceleratedRaycast, INTERSECTED, NOT_INTERSECTED } from 'three-mesh-bvh';
import {
  V,
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
} from './math.js';
const BVH = { INTERSECTED, NOT_INTERSECTED };

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;


// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
view.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#121518');
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(90, -110, 80);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.15;
orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
orbit.enableRotate = false; orbit.enableZoom = false;         // turning and zooming are done by the viewport code below; OrbitControls keeps panning
scene.add(new THREE.HemisphereLight('#dfe6ee', '#2a2622', 1.6));
const sun = new THREE.DirectionalLight('#fff4e4', 1.8); sun.position.set(60, -80, 120); camera.add(sun); scene.add(camera);
const fill = new THREE.DirectionalLight('#9fb7d6', 0.6); fill.position.set(-80, 60, 30); scene.add(fill);
const grid = new THREE.GridHelper(300, 30, '#4a535c', '#262c32'); grid.rotateX(Math.PI / 2); scene.add(grid);
const fine = new THREE.GridHelper(100, 100, '#1f2429', '#1c2126'); fine.rotateX(Math.PI / 2); fine.position.z = -0.01; scene.add(fine);
const axes = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([V(-150,0,0.02), V(150,0,0.02), V(0,-150,0.02), V(0,150,0.02)]),
  new THREE.LineBasicMaterial({ vertexColors: true }));
axes.geometry.setAttribute('color', new THREE.Float32BufferAttribute([.75,.3,.3, .75,.3,.3, .4,.65,.3, .4,.65,.3], 3));
scene.add(axes);
// the bench surface: a self-healing cutting mat (1 cm squares, ruler edges, angle guides), or the plain grid
const MAT = { w: 18 * 25.4, h: 12 * 25.4, label: '12 × 18 in', cx: 0, cy: 0 };
const MAT_STYLES = {
  green: { base: '#1f5a48', line: 'rgba(214,236,224,.5)', faint: 'rgba(214,236,224,.13)', accent: '#e9d27a', text: '#e6f2ea', edge: '#173f33' },
  black: { base: '#17191b', line: 'rgba(235,235,235,.42)', faint: 'rgba(235,235,235,.1)', accent: '#e8c35a', text: '#f0f0f0', edge: '#0d0e0f' },
  blue:  { base: '#1c3d63', line: 'rgba(220,232,246,.48)', faint: 'rgba(220,232,246,.12)', accent: '#f0c860', text: '#eaf1fa', edge: '#132b46' },
};
/** Ruler margin around the grid: smaller on small mats. */
const matMargin = (w, h) => Math.min(20, Math.max(7, Math.min(w, h) * 0.07));
function matTexture(st) {
  const ppm = Math.min(8, 4096 / Math.max(MAT.w, MAT.h)), W = Math.round(MAT.w * ppm), H = Math.round(MAT.h * ppm), c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), X = mm => (mm + MAT.w / 2) * ppm, Y = mm => (MAT.h / 2 - mm) * ppm;   // mat mm (origin at centre) to pixels
  g.fillStyle = st.base; g.fillRect(0, 0, W, H);
  // the measuring grid starts at its bottom-left corner (0, 0): a whole number of centimetres each way
  const m = matMargin(MAT.w, MAT.h), k = m / 20, gw = Math.floor((MAT.w - 2 * m) / 10) * 10, gh = Math.floor((MAT.h - 2 * m) / 10) * 10;
  const x0 = -gw / 2, x1 = gw / 2, y0 = -gh / 2, y1 = gh / 2;
  const line = (ax, ay, bx, by, col, wpx) => { g.strokeStyle = col; g.lineWidth = wpx; g.beginPath(); g.moveTo(X(ax), Y(ay)); g.lineTo(X(bx), Y(by)); g.stroke(); };
  const strong = st.line.replace(/[\d.]+\)$/, '.95)'), cm = st.line.replace(/[\d.]+\)$/, '.62)'), px = ppm / 4;
  // a line right across the mat every centimetre; the 0 lines heaviest
  for (let u = 0; u <= gw; u += 10) line(x0 + u, y0, x0 + u, y1, u === 0 ? strong : cm, (u === 0 ? 3.4 : 1.5) * px);
  for (let v = 0; v <= gh; v += 10) line(x0, y0 + v, x1, y0 + v, v === 0 ? strong : cm, (v === 0 ? 3.4 : 1.5) * px);
  // angle guides from the bottom corners
  if (gw >= 40 && gh >= 30) {
    g.setLineDash([10 * px, 8 * px]);
    const fs = Math.min(7, gh * 0.07, gw * 0.07), d = Math.min(75, Math.min(gw, gh) * 0.45);
    for (const [ang, lab] of [[30, '30°'], [45, '45°'], [60, '60°']]) {
      const t = Math.tan(ang * Math.PI / 180), L = Math.min(x1 - x0, (y1 - y0) / t);
      line(x0, y0, x0 + L, y0 + L * t, strong, 1.6 * px); line(x1, y0, x1 - L, y0 + L * t, strong, 1.6 * px);
      g.fillStyle = st.text; g.font = `600 ${fs * ppm}px "Barlow Condensed", system-ui, sans-serif`;
      const a = ang * Math.PI / 180;                     // the label sits on its own line, turned to follow it
      g.save(); g.translate(X(x0 + d * Math.cos(a)), Y(y0 + d * Math.sin(a))); g.rotate(-a); g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(lab, 0, -6 * px); g.restore();
    }
    g.setLineDash([]);
  }
  // ruler edges: a tick every millimetre (longer every 5 mm and centimetre), numbered in centimetres from 0
  g.fillStyle = st.text; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `600 ${Math.max(1.4, 3.6 * k) * ppm}px "Barlow Semi Condensed", system-ui, sans-serif`;
  const tick = u => (u % 10 ? (u % 5 ? 1.5 : 2.6) : 4) * Math.max(0.55, k), off = 7.5 * k + 0.5;
  for (let u = 0; u <= gw; u++) { const L = tick(u), w = (u % 10 ? 1 : 1.6) * px;
    line(x0 + u, y0, x0 + u, y0 - L, strong, w); line(x0 + u, y1, x0 + u, y1 + L, strong, w);
    if (u % 10 === 0) { g.fillText(String(u / 10), X(x0 + u), Y(y0 - off)); g.fillText(String(u / 10), X(x0 + u), Y(y1 + off)); } }
  for (let v = 0; v <= gh; v++) { const L = tick(v), w = (v % 10 ? 1 : 1.6) * px;
    line(x0, y0 + v, x0 - L, y0 + v, strong, w); line(x1, y0 + v, x1 + L, y0 + v, strong, w);
    if (v % 10 === 0) { g.fillText(String(v / 10), X(x0 - off - 0.5 * k), Y(y0 + v)); g.fillText(String(v / 10), X(x1 + off + 0.5 * k), Y(y0 + v)); } }
  // the mat's size, a brand mark and a self-healing note along the bottom edge
  const by = -MAT.h / 2 + m * 0.22, sz = MAT.label || '';
  g.textAlign = 'right'; g.fillStyle = st.accent; g.font = `700 ${Math.max(1.6, 6 * k) * ppm}px "Barlow Condensed", system-ui, sans-serif`; g.fillText(('KITBASH BENCH  ' + sz).trim(), X(x1), Y(by));
  if (k > 0.6) { g.textAlign = 'left'; g.fillStyle = st.text; g.font = `500 ${3.4 * k * ppm}px "Barlow Semi Condensed", system-ui, sans-serif`; g.fillText('SELF-HEALING CUTTING MAT · 1 cm squares · 0,0 bottom left', X(x0), Y(by)); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return tex;
}
/**
 * Mat sizes, in inches like the shop ones, smallest first. "Auto" picks the smallest that holds
 * everything on the bench (turned whichever way fits best) and only changes when the pieces outgrow it.
 */
const MAT_SIZES = [[3, 3], [3, 9], [9, 12], [12, 18], [18, 24], [24, 36]];
function matFor(size, box) {
  const need = box.isEmpty() ? null : box.getSize(V());
  const fits = (w, h) => { const m = matMargin(w, h); return need && need.x + 10 <= w - 2 * m && need.y + 10 <= h - 2 * m; };
  const mm = ([a, b]) => [Math.max(a, b) * 25.4, Math.min(a, b) * 25.4];
  if (size !== 'auto') { const [a, b] = size.split('x').map(Number), [W, H] = mm([a, b]);
    const tall = need && need.y > need.x && a !== b;
    return { w: tall ? H : W, h: tall ? W : H, label: `${Math.min(a, b)} × ${Math.max(a, b)} in` }; }
  if (!need) return { w: 18 * 25.4, h: 12 * 25.4, label: '12 × 18 in' };
  for (const s of MAT_SIZES) { const [W, H] = mm(s), label = `${s[0]} × ${s[1]} in`;
    if (fits(W, H)) return { w: W, h: H, label };
    if (fits(H, W)) return { w: H, h: W, label }; }
  const [W, H] = mm(MAT_SIZES[MAT_SIZES.length - 1]); return { w: W, h: H, label: '24 × 36 in' };
}
const mat = new THREE.Group(); scene.add(mat);
function setBench(style) {
  while (mat.children.length) { const o = mat.children.pop(); o.geometry.dispose(); [].concat(o.material).forEach(m => { m.map?.dispose(); m.dispose(); }); }
  const st = MAT_STYLES[style], plain = !st;
  grid.visible = fine.visible = axes.visible = plain;
  if (plain) return;
  const top = new THREE.Mesh(new THREE.PlaneGeometry(MAT.w, MAT.h), new THREE.MeshBasicMaterial({ map: matTexture(st), color: '#d4d4d4', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));   // unlit: a flat mat needs no lighting, and it keeps big views fast
  top.position.z = -0.02; top.renderOrder = -1;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(MAT.w, MAT.h, 1.6), new THREE.MeshStandardMaterial({ color: st.edge, roughness: 0.9 })); slab.position.z = -1.4;   // top at -0.6 mm, well under the print
  mat.add(top, slab);
  mat.position.set(MAT.cx || 0, MAT.cy || 0, 0);
  matSeeThrough = null;
}
/** Resize (and re-centre) the mat when the bench's contents call for it. */
function fitMat(force = false) {
  const style = $('set-bench').value; if (!MAT_STYLES[style]) return;
  const box = benchBox(), want = matFor($('set-mat').value, box);
  const c = box.isEmpty() ? V() : box.getCenter(V()), m = matMargin(MAT.w, MAT.h);
  const inside = box.isEmpty() || (box.min.x >= (MAT.cx || 0) - MAT.w / 2 + m - 1e-6 && box.max.x <= (MAT.cx || 0) + MAT.w / 2 - m + 1e-6 &&
                                   box.min.y >= (MAT.cy || 0) - MAT.h / 2 + m - 1e-6 && box.max.y <= (MAT.cy || 0) + MAT.h / 2 - m + 1e-6);
  const same = Math.abs(want.w - MAT.w) < 0.01 && Math.abs(want.h - MAT.h) < 0.01;
  if (!force && same && inside) return;
  Object.assign(MAT, want, { cx: Math.round(c.x / 10) * 10, cy: Math.round(c.y / 10) * 10 });
  if (box.isEmpty()) { MAT.cx = 0; MAT.cy = 0; }
  setBench(style);
}
/**
 * Seen from above, anything sunk below the mat shows through it as a glowing outline; seen from
 * below, the mat itself turns see-through. The outline is drawn only where something hides the
 * part (depth test reversed) and only for the part's surface under the mat.
 */
let matSeeThrough = null;
function ghostMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35) } },
    vertexShader: 'varying vec3 vView; varying float vZ; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vZ = w.z; vec4 mv = viewMatrix * w; vView = mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 color; varying vec3 vView; varying float vZ;
      void main() {
        if (vZ > -0.02) discard;                                 // only what's under the mat
        vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
        float rim = 1.0 - abs(dot(n, normalize(-vView)));        // strongest where the surface turns away: the outline
        float a = smoothstep(0.5, 0.92, rim);
        gl_FragColor = vec4(color, 0.07 + 0.88 * a);
      }`,
    transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide,
  });
}
function updateMatView() {
  const on = mat.children.length > 0;
  const below = on && camera.position.z < -0.02;
  if (on && below !== matSeeThrough) {                   // looking up from underneath: see through the mat
    matSeeThrough = below;
    const [top, slab] = mat.children;
    for (const [m, o] of [[top.material, 0.38], [slab.material, 0.1]]) { m.transparent = below; m.opacity = below ? o : 1; m.depthWrite = !below; m.needsUpdate = true; }
    top.renderOrder = below ? 10 : -1; slab.renderOrder = below ? 10 : 0;
    top.material.side = below ? THREE.DoubleSide : THREE.FrontSide; top.material.needsUpdate = true;   // its printed face shows through from underneath
  }
  for (const p of liveParts()) {
    const want = on && !below && p.visible && worldBox(p).min.z < -0.05;
    let g = p.userData.ghost;
    if (want && !g) { g = p.userData.ghost = new THREE.Mesh(p.geometry, ghostMaterial(p.userData.part.color)); g.renderOrder = 20; g.raycast = () => {}; p.add(g); }
    if (g) g.visible = want;
  }
}
const world = new THREE.Group(); scene.add(world);
const fx = new THREE.Group(); scene.add(fx);                 // pick highlights, markers
const skeleton = new THREE.LineSegments(new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: '#d6a24a', depthTest: false, transparent: true, opacity: 0.85 }));
skeleton.renderOrder = 998; scene.add(skeleton);

const tc = new TransformControls(camera, renderer.domElement);
tc.setSize(0.8); scene.add(tc);
const proxy = new THREE.Object3D(); scene.add(proxy);
tc.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });

// ---------------------------------------------------------------------------
// Parts, joints, registry
// ---------------------------------------------------------------------------
const PART_COLORS = ['#b9b3a6', '#8fa3a8', '#a89a86', '#9aa58c', '#a18f9b', '#8d99ad', '#b2a07c', '#93a49b'];
const parts = [];             // every part ever made (mesh objects); deleted ones have no parent
const joints = [];            // every joint ever made
let colorIx = 0, selected = null, selection = [];   // selected: the active part (last clicked); selection: every selected part

function isPart(o) { return o && o.userData.part; }
function liveParts() { return parts.filter(m => m.parent); }

function addPart(name, geom, opts = {}) {
  let g = geom;
  if (!opts.welded) { geom.deleteAttribute('normal'); geom.deleteAttribute('uv'); g = weldGeometry(geom); }
  if (!g.boundingBox) g.computeBoundingBox();
  if (!g.boundsTree) g.computeBoundsTree();                   // copies of one piece share the mesh and its BVH
  const color = opts.color || PART_COLORS[colorIx++ % PART_COLORS.length];
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.05, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = name; mesh.userData.part = { color, topo: null, tris: g.index.count / 3, geomKey: opts.geomKey || THREE.MathUtils.generateUUID() };
  if (opts.id) mesh.uuid = opts.id;
  world.add(mesh);
  if (opts.at) mesh.position.fromArray(opts.at);
  if (opts.rot) mesh.rotation.set(...opts.rot);
  parts.push(mesh);
  if ($('set-plastic') && $('set-plastic').value !== 'parts') refreshPaint(mesh);
  return mesh;
}
// ---------------------------------------------------------------------------
// Plastic and paint: the bare-plastic look of every part, and colour brushed or filled onto them
// ---------------------------------------------------------------------------
const PLASTICS = {
  parts: { name: 'Part colours', rough: 0.72 },
  grey: { name: 'Grey plastic', color: '#8f9296', rough: 0.6 },
  lightgrey: { name: 'Light grey resin', color: '#c3c5c7', rough: 0.42 },
  cream: { name: 'Cream resin', color: '#d8cfb5', rough: 0.45 },
  white: { name: 'White plastic', color: '#e3e1da', rough: 0.55 },
  bone: { name: 'Bone plastic', color: '#cbbd9a', rough: 0.6 },
  'black-primer': { name: 'Black primer', color: '#28292b', rough: 0.92 },
  'grey-primer': { name: 'Grey primer', color: '#7b7d80', rough: 0.92 },
  'white-primer': { name: 'White primer', color: '#dedcd6', rough: 0.92 },
};
const PAINTS = [['Chalk white', '#e9e6dc'], ['Bone', '#d2c49a'], ['Skin', '#d9a383'], ['Leather', '#7a4b2a'], ['Rust', '#8e3d1f'], ['Blood red', '#8a1414'], ['Bright red', '#c0262b'],
  ['Orange', '#d9661f'], ['Ochre', '#c99a2e'], ['Yellow', '#e2c13b'], ['Moss green', '#5a6b2e'], ['Sickly green', '#8a9a3c'], ['Forest green', '#2f4a2a'], ['Teal', '#2b6b6b'],
  ['Sky blue', '#5f93c5'], ['Deep blue', '#1f3a78'], ['Purple', '#4b2d5e'], ['Steel', '#9aa2a8'], ['Gunmetal', '#4a4f55'], ['Brass', '#b08d3c'], ['Gold', '#c9a237'], ['Copper', '#a86a3c'],
  ['Mid grey', '#6e7074'], ['Black', '#1b1b1d']];
const plastic = () => PLASTICS[$('set-plastic')?.value] || PLASTICS.parts;
/** The colour of a part where it isn't brushed: its fill, or the plastic. */
function baseColor(m) { const pt = m.userData.part; return pt.fill || plastic().color || pt.color; }
/** Give a part its own geometry wrapper (same mesh data, its own colour layer) so copies don't share paint. */
function ownGeometry(m) {
  const g0 = m.geometry; if (g0.userData.owner === m.uuid) return g0;
  const g = new THREE.BufferGeometry(); g.setIndex(g0.index); g.setAttribute('position', g0.attributes.position);
  g.boundingBox = g0.boundingBox?.clone() || null; g.boundingSphere = g0.boundingSphere?.clone() || null; g.boundsTree = g0.boundsTree;
  g.userData = { ...g0.userData, owner: m.uuid }; m.geometry = g; return g;
}
const _c = new THREE.Color();
const SRGB2LIN = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const hexBytes = h => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
/** Show a part's plastic, fill and brushed paint. Paint is kept as ordinary (sRGB) bytes; the display layer is linear light. */
function refreshPaint(m, range) {
  const pt = m.userData.part, mat = m.material, base = _c.set(baseColor(m));        // linear
  const br = base.r, bg = base.g, bb = base.b;
  mat.roughness = plastic().rough;
  if (!pt.paint) {
    if (mat.vertexColors) { mat.vertexColors = false; mat.needsUpdate = true; }
    if (m.geometry.attributes.color && m.geometry.userData.owner === m.uuid) m.geometry.deleteAttribute('color');
    mat.color.set(baseColor(m)); return;
  }
  const g = ownGeometry(m), n = g.attributes.position.count, P = pt.paint;
  let col = g.attributes.color;
  if (!col || col.count !== n) { col = new THREE.BufferAttribute(new Float32Array(n * 3), 3); g.setAttribute('color', col); range = null; }
  const a = col.array, [i0, i1] = range || [0, n - 1], L = SRGB2LIN;
  for (let i = i0; i <= i1; i++) { const w = P[4*i+3] / 255;
    a[3*i] = br + (L[P[4*i]] - br) * w; a[3*i+1] = bg + (L[P[4*i+1]] - bg) * w; a[3*i+2] = bb + (L[P[4*i+2]] - bb) * w; }
  if (range) { col.clearUpdateRanges?.(); col.addUpdateRange?.(i0 * 3, (i1 - i0 + 1) * 3); }
  col.needsUpdate = true;
  if (!mat.vertexColors) { mat.vertexColors = true; mat.needsUpdate = true; }
  mat.color.set('#ffffff');
}
const sprueColor = () => plastic().color || '#c9ccce';
function applyPlastic() {
  for (const m of liveParts()) refreshPaint(m);
  if (typeof sprueMat !== 'undefined') { sprueMat.color.set(sprueColor()); sprueMat.roughness = Math.min(plastic().rough, 0.6); }
  if (typeof renderOutliner === 'function') renderOutliner();
}
const brush = { color: '#8a1414', stroke: null };
/** Brush paint around a world point on part m: full strength in the middle, softening to the rim. */
function paintAt(m, wp, face = -1) {
  const pt = m.userData.part, g = ownGeometry(m), n = g.attributes.position.count, st = brush.stroke;
  if (!st.touched.has(m)) { st.touched.add(m); pt.paint = pt.paint ? pt.paint.slice() : new Uint8Array(n * 4); pt.paintVer = (pt.paintVer || 0) + 1; }   // copy on first touch: undo keeps the old one
  m.updateMatrixWorld(true);
  const inv = m.matrixWorld.clone().invert(), lp = wp.clone().applyMatrix4(inv), sc = new THREE.Vector3().setFromMatrixScale(m.matrixWorld);
  const r = +$('paint-size').value / 2, rl = r / (Math.max(Math.abs(sc.x), Math.abs(sc.y), Math.abs(sc.z)) || 1), rl2 = rl * rl;
  const pos = g.attributes.position.array, ix = g.index.array, P = pt.paint, erase = $('paint-erase').checked;
  const [cr, cg, cb] = hexBytes(brush.color);
  const seen = new Set(); let lo = Infinity, hi = -1;
  g.boundsTree.shapecast({
    intersectsBounds: box => box.distanceToPoint(lp) <= rl,
    intersectsTriangle: (tri, ti) => { for (let k = 0; k < 3; k++) seen.add(ix[3 * ti + k]); return false; },
  });
  for (const i of seen) {
    const dx = pos[3*i] - lp.x, dy = pos[3*i+1] - lp.y, dz = pos[3*i+2] - lp.z, d2 = dx*dx + dy*dy + dz*dz; if (d2 > rl2) continue;
    const t = Math.sqrt(d2) / rl, w = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;          // soft rim
    if (erase) P[4*i+3] = Math.round(P[4*i+3] * (1 - w));
    else { const a0 = P[4*i+3] / 255, k = a0 > 0 ? w : 1;                       // first coat takes the colour; later coats blend
      P[4*i] = Math.round(P[4*i] + (cr - P[4*i]) * k); P[4*i+1] = Math.round(P[4*i+1] + (cg - P[4*i+1]) * k); P[4*i+2] = Math.round(P[4*i+2] + (cb - P[4*i+2]) * k);
      P[4*i+3] = Math.max(P[4*i+3], Math.round(w * 255)); }
    if (i < lo) lo = i; if (i > hi) hi = i;
  }
  if (hi < 0 && face >= 0 && !erase) for (let k = 0; k < 3; k++) {     // a blocky part with no points under the brush: colour the triangle it's on
    const i = ix[3 * face + k]; P[4*i] = cr; P[4*i+1] = cg; P[4*i+2] = cb; P[4*i+3] = 255; lo = Math.min(lo, i); hi = Math.max(hi, i); }
  if (hi >= 0) refreshPaint(m, [lo, hi]);
}
/** The colour showing at a point on a part (for Alt-click). */
function colourAt(hit) {
  const m = hit.object, pt = m.userData.part, ix = m.geometry.index.array, f = hit.faceIndex * 3;
  const pos = m.geometry.attributes.position.array, lp = hit.point.clone().applyMatrix4(m.matrixWorld.clone().invert());
  let best = ix[f], bd = Infinity; for (let k = 0; k < 3; k++) { const i = ix[f + k], d = (pos[3*i] - lp.x) ** 2 + (pos[3*i+1] - lp.y) ** 2 + (pos[3*i+2] - lp.z) ** 2; if (d < bd) { bd = d; best = i; } }
  if (pt.paint && pt.paint[4 * best + 3] > 127) return '#' + [0, 1, 2].map(k => pt.paint[4 * best + k].toString(16).padStart(2, '0')).join('');
  return '#' + new THREE.Color(baseColor(m)).getHexString();
}
function setBrushColor(hex) {
  brush.color = hex; $('paint-color').value = hex;
  document.querySelectorAll('#paint-swatches .swatch').forEach(b => b.setAttribute('aria-checked', String(b.dataset.c === hex)));
}
function clearPaint(list) {
  const painted = list.filter(m => m.userData.part.paint || m.userData.part.fill); if (!painted.length) return 0;
  pushUndo(); painted.forEach(m => { const pt = m.userData.part; pt.paint = null; pt.fill = null; pt.paintVer = (pt.paintVer || 0) + 1; refreshPaint(m); });
  markDirty(); renderOutliner(); renderPartPanel(); return painted.length;
}
function topoOf(mesh) { return mesh.userData.part.topo ||= (mesh.geometry.userData.topo ||= buildTopo(mesh.geometry)); }
/** A part's candidate mating faces, worked out once per part and setting. */
function facesOf(mesh, creaseDeg) {
  const topo = topoOf(mesh), key = 'faces' + creaseDeg;
  return (topo[key] ||= segmentRegions(topo, creaseDeg, 8));
}

function worldBox(o) {
  const b = new THREE.Box3(); o.updateWorldMatrix(true, false);
  if (isPart(o)) b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
  return b;
}
/** Exact world box of a part (the quick box is loose for files saved at an angle). */
function exactBox(m) {
  m.updateMatrixWorld(true); const b = new THREE.Box3(), v = V(), pos = m.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) b.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
  return b;
}
/** The true lowest point of some parts (the quick box is loose for files saved at an angle). */
function lowestZ(list) {
  let z = Infinity; const v = V();
  for (const m of list) { m.updateMatrixWorld(true); const pos = m.geometry.attributes.position, e = m.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); z = Math.min(z, e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]); } }
  return z;
}
function subtreeParts(root) { const out = []; root.traverse(o => { if (isPart(o)) out.push(o); }); return out; }
function sceneBox(list = liveParts()) { const b = new THREE.Box3(); list.forEach(p => b.union(worldBox(p))); return b; }

/** Give `o` a new world matrix while keeping its parent. */
function setWorld(o, W) {
  o.parent.updateWorldMatrix(true, false);
  const L = o.parent.matrixWorld.clone().invert().multiply(W);
  L.decompose(o.position, o.quaternion, o.scale);
  o.updateMatrixWorld(true);
}
function applyWorld(o, T) { o.updateWorldMatrix(true, false); setWorld(o, T.clone().multiply(o.matrixWorld)); }
function isDescendant(o, anc) { for (let p = o.parent; p; p = p.parent) if (p === anc) return true; return false; }
function jointOf(part) { return part.parent && part.parent.userData.joint ? part.parent : null; }
function parentPart(part) { let p = part.parent; if (p && p.userData.joint) p = p.parent; return isPart(p) ? p : null; }

function detach(part) {
  const j = jointOf(part);
  world.attach(part);
  if (j && j.parent && !j.children.some(isPart)) j.parent.remove(j);      // a joint other options still hang off stays
}

function makeJoint(size) {
  const j = new THREE.Object3D(); j.userData.joint = { rest: new THREE.Quaternion(), size };
  const h = new THREE.Group(); h.name = 'joint-helper';
  const ball = new THREE.Mesh(new THREE.SphereGeometry(size, 16, 10), new THREE.MeshBasicMaterial({ color: '#d6a24a', depthTest: false, transparent: true, opacity: .9 }));
  const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V(0, 0, size * 5)]), new THREE.LineBasicMaterial({ color: '#f1d08f', depthTest: false }));
  ball.renderOrder = axis.renderOrder = 999;
  h.add(ball, axis); j.add(h); joints.push(j);
  h.visible = $('set-joints').checked;
  return j;
}

function attach(child, fixed, how, jointPos, axis) {
  if (how === 'none') return null;
  if (fixed === child || isDescendant(fixed, child)) return `Moved, but not attached: ${fixed.name} already hangs off ${child.name}`;
  detach(child);
  if (how === 'plain') { fixed.attach(child); return null; }
  const size = Math.min(Math.max(worldBox(child).getSize(V()).length() * 0.025, 0.25), 2);
  const j = makeJoint(size);
  world.add(j);
  j.position.copy(jointPos);
  j.quaternion.setFromUnitVectors(V(0, 0, 1), axis.clone().normalize());
  j.updateMatrixWorld(true);
  fixed.attach(j);
  j.userData.joint.rest.copy(j.quaternion);
  j.attach(child);
  return null;
}

/**
 * Make `part` the base of its linked group: every link between it and the old base turns round,
 * so what was its parent now hangs off it (and so on up). Nothing moves; joints keep their place,
 * axis and current pose, and "Reset pose" still returns the same rest shape.
 * Returns an error string, or null.
 */
/** Ask whether moving a part that hangs off another should bring its whole linked group. → 'alone' | 'group' | null (cancelled) */
const linkAsk = { resolve: null, part: null };
function groupLabel(part) {
  const others = subtreeParts(rootOf(part)).filter(m => m !== part && !subtreeParts(part).includes(m)).length;
  return { par: parentPart(part), others };
}
function askLink(part, verb, { fixed = null } = {}) {
  if (!part || !parentPart(part)) return Promise.resolve('alone');
  if (fixed && rootOf(fixed) === rootOf(part)) return Promise.resolve('alone');    // fitting it within its own group: the group can't come along
  if (rerootCheck(part)) return Promise.resolve('alone');
  const pref = $('set-linkmove').value; if (pref !== 'ask') return Promise.resolve(pref);
  closeLinkAsk(null);
  const { par, others } = groupLabel(part), esc = s => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
  $('linkask-text').innerHTML = `<b>${esc(part.name)}</b> hangs off <b>${esc(par.name)}</b>${others > 1 ? ` (in a group of ${others + subtreeParts(part).length})` : ''}. ${verb} just ${esc(part.name)}, or make it the base so ${esc(par.name)}${others > 1 ? ' and the rest' : ''} come${others > 1 ? '' : 's'} along?`;
  $('linkask-alone').textContent = `Just ${part.name}`;
  $('linkask-group').textContent = 'Bring the group';
  $('linkask-remember').checked = false;
  $('linkask').hidden = false; linkAsk.part = part;
  $('linkask-group').focus({ preventScroll: true });
  return new Promise(res => { linkAsk.resolve = res; });
}
function closeLinkAsk(answer) {
  const r = linkAsk.resolve; linkAsk.resolve = null; linkAsk.part = null; linkAsk.soft = false; $('linkask').hidden = true;
  if (answer && $('linkask-remember').checked) { $('set-linkmove').value = answer; $('set-linkmove').dispatchEvent(new Event('change')); toast(answer === 'group' ? 'Will bring the group from now on. Change it in Edit › Preferences.' : 'Will move just the part from now on. Change it in Edit › Preferences.'); }
  r?.(answer);
}
function bindLinkAsk() {
  $('linkask-alone').addEventListener('click', () => closeLinkAsk('alone'));
  $('linkask-group').addEventListener('click', () => closeLinkAsk('group'));
  $('linkask').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeLinkAsk(null); } });
}
/** Turn the links round so `part` is the base, with undo and a note. */
function makeBase(part, quiet) {
  const old = rootOf(part); if (old === part) return true;
  const err = rerootCheck(part); if (err) { toast(err, 'bad'); return false; }
  pushUndo(); reroot(part); afterHierarchyChange();
  if (!quiet) toast(`${part.name} is now the base; ${old.name} and the rest hang off it.`, 'ok');
  return true;
}

function linkPath(part) { const path = []; for (let c = part, p; (p = parentPart(c)); c = p) path.push({ p, c, j: jointOf(c) }); return path; }
function rerootCheck(part) {
  for (const e of linkPath(part)) if (e.j && e.j.children.filter(isPart).length > 1) return `${e.c.name} shares its joint with other options, so that link can't turn round. Pick the option slot's base instead.`;
  return null;
}
function reroot(part) {
  const path = linkPath(part); if (!path.length) return null;
  const err = rerootCheck(part); if (err) return err;
  const top = path[path.length - 1].p, home = top.parent;
  scene.updateMatrixWorld(true);
  // how far each joint is posed from its rest, measured before anything moves
  for (const e of path) if (e.j) e.delta = e.j.userData.joint.rest.clone().invert().multiply(e.j.quaternion);
  // unhook the chain (attach() keeps world placement)
  for (const e of path) { home.attach(e.c); if (e.j) home.attach(e.j); }
  // hook it back the other way round: child → joint → old parent
  for (const e of path) {
    if (e.j) { e.c.attach(e.j); e.j.attach(e.p); e.j.userData.joint.rest.copy(e.j.quaternion).multiply(e.delta); }
    else e.c.attach(e.p);
  }
  scene.updateMatrixWorld(true);
  return null;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------
const undoStack = [], redoStack = [];
function snapshot() {
  const snap = [...parts, ...joints].filter(o => o.parent).map(o => ({
    o, p: o.parent, pos: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone(), vis: o.visible, name: o.name,
    rest: o.userData.joint ? o.userData.joint.rest.clone() : null, off: !!o.userData.optOff,
    paint: o.userData.part?.paint || null, fill: o.userData.part?.fill || null }));
  snap.options = JSON.parse(JSON.stringify(options));
  snap.sprues = sprues ? JSON.parse(JSON.stringify(sprues)) : null;
  snap.kit = kit ? JSON.parse(JSON.stringify(kit)) : null;
  snap.magnets = JSON.parse(JSON.stringify(magnets));
  return snap;
}
function restore(snap) {
  [...parts, ...joints].forEach(o => o.parent && o.parent.remove(o));
  for (const e of snap) {
    e.p.add(e.o); e.o.position.copy(e.pos); e.o.quaternion.copy(e.q); e.o.scale.copy(e.s); e.o.visible = e.vis; e.o.name = e.name;
    if (e.rest) e.o.userData.joint.rest.copy(e.rest);
    if (e.o.userData.part) { e.o.userData.optOff = e.off;
      const pt = e.o.userData.part; if (pt.paint !== e.paint || pt.fill !== e.fill) { pt.paint = e.paint; pt.fill = e.fill; pt.paintVer = (pt.paintVer || 0) + 1; refreshPaint(e.o); } }
  }
  if (snap.options) options = JSON.parse(JSON.stringify(snap.options));
  if ('sprues' in snap) sprues = snap.sprues ? JSON.parse(JSON.stringify(snap.sprues)) : null;
  if (snap.magnets) { magnets = JSON.parse(JSON.stringify(snap.magnets)); }
  if ('kit' in snap && JSON.stringify(snap.kit) !== JSON.stringify(kit)) { kit = snap.kit ? JSON.parse(JSON.stringify(snap.kit)) : null; buildKit(); }
  scene.updateMatrixWorld(true);
}
function pushUndo(before = snapshot()) { undoStack.push(before); if (undoStack.length > 80) undoStack.shift(); redoStack.length = 0; updateButtons(); }
function undo() {
  if (!undoStack.length) return;
  cancelPick(); redoStack.push(snapshot()); restore(undoStack.pop()); lastOp = null; afterHierarchyChange();
}
function redo() {
  if (!redoStack.length) return;
  cancelPick(); undoStack.push(snapshot()); restore(redoStack.pop()); lastOp = null; afterHierarchyChange();
}

// ---------------------------------------------------------------------------
// Tools and picking
// ---------------------------------------------------------------------------
const SNAP_STEPS = {
  BALL: ["Click the BALL on the part that moves", "Click the SOCKET on the part it joins"],
  PLANE: ["Click a flat face on the part that moves", "Click the flat face it should sit against"],
  MID: ["Moving part: click its first outer surface", "Moving part: click the opposite outer surface",
        "Fixed part: click one side of the gap", "Fixed part: click the other side of the gap"],
  THREE: ["Moving part: point 1 (lands exactly)", "Moving part: point 2 (sets direction)", "Moving part: point 3 (sets the plane)",
          "Fixed part: point 1", "Fixed part: point 2", "Fixed part: point 3"],
  MATCH: ["Click the mating areas on the part that moves", "Click the areas it fits against"],
};
const PER_SIDE = { BALL: 1, PLANE: 1, MID: 2, THREE: 3, MATCH: 1 };
const TOOL_NAMES = { BALL: "Ball & socket", PLANE: "Face to face", MID: "Midpoint of gap", THREE: "3-point align", MATCH: "Surface match" };
let tool = 'select', picks = [], lastOp = null;
const settings = () => ({ smoothDeg: +$('set-smooth').value, maxRadius: +$('set-radius').value || 0, flatTol: +$('set-flat').value || 0.02, ballTol: +$('set-balltol').value || 3, creaseDeg: +$('set-crease').value || 30 });

function setTool(t) {
  cancelPick(); if (typeof magPending !== 'undefined' && magPending) { magPending = null; rebuildMagnets(); } if (typeof clearHover === 'function') clearHover();
  if (t !== 'ORIENT' && typeof closeOrient === 'function' && !$('orient').hidden) closeOrient();
  tool = t;
  document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'));
  syncGizmo(); updateStep(); syncOptbar();
}
/** The bar under the menus shows only the current tool's settings, like Photoshop's options bar. */
function syncOptbar() {
  const btn = document.querySelector(`.tool[data-tool="${tool}"]`); $('opt-tool').textContent = btn ? [...btn.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : tool;
  let any = false;
  document.querySelectorAll('#optbar .ogroup').forEach(g => { const on = g.dataset.tools.split(' ').includes(tool); g.hidden = !on; any ||= on; });
  $('opt-none').hidden = any;
}
function cancelPick() { picks = []; clearFx(); updateStep(); }
function clearFx() { while (fx.children.length) { const c = fx.children.pop(); if (c.isSprite) c.material.dispose(); else c.geometry?.dispose(); } }   // sprites share one quad

function updateStep() {
  const el = $('step');
  if (!SNAP_STEPS[tool]) {
    const msgs = { select: "Click a part to select it. Ctrl-click or Ctrl-drag to select several", move: "Select parts, then drag the arrows (Ctrl-click to add)", rotate: "Select parts, then drag the rings (Ctrl-click to add)",
                   pose: "Click a jointed part, then drag the rings to pose it around its joint",
                   ORIENT: "Click a face to lay it flat or square it to the X, Y, Z planes",
                   MAGNET: "Click where two parts meet to set a pair of magnet holes, one in each. Not touching yet? Click one part, then the other",
                   paint: "Drag on a part to paint it. Alt-click picks up a colour; drag off the parts to turn the view" };
    el.hidden = false; $('step-count').textContent = ''; $('step-side').style.background = 'var(--muted)';
    $('step-text').textContent = msgs[tool]; $('step-hint').textContent = ''; return;
  }
  $('step-actions').hidden = tool !== 'MATCH';
  if (tool === 'MATCH') {
    const nA = picks.filter(q => q.side === 'move').length, nB = picks.length - nA;
    el.hidden = false;
    $('step-side').style.background = nA && nB ? 'var(--accent)' : nA ? 'var(--fixed)' : 'var(--move)';
    $('step-count').textContent = `Match ${nA} + ${nB}`;
    $('step-text').textContent = !nA ? 'Click the mating areas on the part that moves'
      : !nB ? `Moving part: ${nA} area${nA > 1 ? 's' : ''}. Click more, or click the part it fits against`
      : `${nA} area${nA > 1 ? 's' : ''} ↔ ${nB} area${nB > 1 ? 's' : ''}${(() => { const k = new Set(picks.filter(q => q.side === 'fixed').map(q => q.mesh)).size; return k > 1 ? ` on ${k} parts` : ''; })()}. Add more on any part, then Fit parts`;
    $('step-hint').textContent = picks.length ? 'Areas on other parts fit against them all at once. Click a picked area again to drop it. Enter: fit · Esc: clear' : 'Each area grows out to the sharp edge around it. Pick several where parts touch in more than one place.';
    $('step-apply').disabled = !(nA && nB);
    return;
  }
  const n = picks.length, total = PER_SIDE[tool] * 2, moving = n < PER_SIDE[tool];
  el.hidden = false;
  $('step-side').style.background = moving ? 'var(--move)' : 'var(--fixed)';
  $('step-count').textContent = `${TOOL_NAMES[tool]} ${n + 1}/${total}`;
  $('step-text').textContent = SNAP_STEPS[tool][n];
  $('step-hint').textContent = tool === 'THREE' ? 'Shift+click: exact point'
    : tool === 'PLANE' || tool === 'MID' ? 'Centres on the face. Click next to a peg or hole to centre on that instead.'
    : tool === 'MATCH' ? 'The face grows out to the sharp edge around it.'
    : (n ? 'Backspace: undo pick' : '');
}

let toastTimer;
function toast(msg, kind = '') {
  const t = $('toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

const raycaster = new THREE.Raycaster(); raycaster.firstHitOnly = true;
function raycast(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(liveParts().filter(p => p.visible && isVisibleChain(p)), false);
  return hits[0] || null;
}
function isVisibleChain(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

function markerSize() { return Math.min(Math.max(sceneBox().getSize(V()).length() * 0.006, 0.2), 3); }
function showRegion(mesh, list, color) {
  const topo = topoOf(mesh), pos = new Float32Array(list.length * 9);
  list.forEach((t, i) => { for (let k = 0; k < 3; k++) { const v = topo.idx[3*t+k]; pos.set(topo.pos.subarray(3*v, 3*v+3), i*9 + k*3); } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .55, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false }));
  mesh.updateMatrixWorld(true); m.matrixAutoUpdate = false; m.matrix.copy(mesh.matrixWorld); fx.add(m);
}
/** A pick marker: a thin ring with a pin-prick centre, the same size on screen at any zoom, so the surface under it stays visible. */
const ringTex = new Map();
function markerTexture(color) {
  if (ringTex.has(color)) return ringTex.get(color);
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.lineWidth = 7; g.strokeStyle = 'rgba(10,12,14,.75)'; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();   // dark halo reads on pale parts
  g.lineWidth = 3.5; g.strokeStyle = color; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(10,12,14,.75)'; g.beginPath(); g.arc(32, 32, 4.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = color; g.beginPath(); g.arc(32, 32, 2.8, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; ringTex.set(color, t); return t;
}
function showMarker(p, color = '#ffe066', scale = 1) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(color), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true }));
  m.scale.setScalar(0.034 * scale); m.position.copy(p); m.renderOrder = 999; fx.add(m);
}

/** Match: collect any number of areas on each part; nothing moves until Fit parts. */
function matchSides() { const a = picks.find(q => q.side === 'move')?.mesh || null, b = picks.find(q => q.side === 'fixed')?.mesh || null; return { a, b }; }
function handleMatchPick(hit) {
  if (!hit) { toast("Missed. Click on a part."); return; }
  const mesh = hit.object, { a, b } = matchSides();
  // clicking inside an area already picked drops it
  const k = picks.findIndex(q => q.mesh === mesh && q.region.includes(hit.faceIndex));
  if (k >= 0) { const q = picks.splice(k, 1)[0]; rebuildPickFx(); updateStep(); toast(`Dropped that ${q.side === 'move' ? 'moving' : 'fixed'} area.`); return; }
  const side = !a || mesh === a ? 'move' : 'fixed';          // the fixed areas can be on several parts: the last piece of the puzzle
  mesh.updateMatrixWorld(true);
  const res = pickSurface(topoOf(mesh), mesh.matrixWorld.clone(), hit.faceIndex, hit.point, settings());
  if (res.err) { toast(res.err, 'bad'); return; }
  picks.push({ mesh, side, ...res });
  rebuildPickFx(); clearHover(); updateStep();
  toast(`Got ${res.info} on ${mesh.name} (${side === 'move' ? 'moves' : 'stays'}).`);
}
async function applyMatch() {
  const A = picks.filter(q => q.side === 'move'), B = picks.filter(q => q.side === 'fixed');
  if (!A.length || !B.length) { toast('Pick at least one area on each part first.', 'bad'); return; }
  const union = list => [...new Set(list.flatMap(q => q.region))];
  // several fixed parts: it attaches to the one with the most picked area, and fits against them all
  const byMesh = new Map(); for (const q of B) { if (!byMesh.has(q.mesh)) byMesh.set(q.mesh, []); byMesh.get(q.mesh).push(q); }
  const areaOf = qs => qs.reduce((a, q) => a + q.region.reduce((s2, t) => s2 + topoOf(q.mesh).fa[t], 0), 0);
  const fixedParts = [...byMesh.entries()].sort((x, y) => areaOf(y[1]) - areaOf(x[1]));
  const B0 = fixedParts[0][1];
  const op = {
    mode: 'MATCH', child: A[0].mesh, fixed: B0[0].mesh, a: [keepPick(A[0])], b: [keepPick(B0[0])],
    p: { spin: 0, gap: 0, flip: false, across: false, attach: lastAttach, centre: lastCentre, offset: [0, 0, 0], frame: lastFrame, pivot: lastPivot, seat: lastSeat },
    before: snapshot(),
  };
  op.match = { regionA: union(A), regionB: union(B0), groupsA: A.map(q => q.region), groupsB: B0.map(q => q.region), Ma: A[0].mesh.matrixWorld.clone(), Mb: B0[0].mesh.matrixWorld.clone(), results: [], chosen: 0,
               flat: A.length === 1 && B.length === 1 && A[0].kind === 'flat' && B[0].kind === 'flat', areas: [A.length, B.length] };
  if (fixedParts.length > 1) op.match.targets = fixedParts.map(([mesh, qs]) => ({ mesh, M: mesh.matrixWorld.clone(), groups: qs.map(q => q.region), region: union(qs) }));
  const how = await askLink(op.child, 'Fit', { fixed: op.fixed });
  if (!how) { toast('Still picking. Fit parts when ready.'); return; }
  op.reroot = how === 'group';
  clearHover(); picks = []; updateStep();
  startMatch(op);
}
function handlePick(ev, hit) {
  if (tool === 'MATCH') { handleMatchPick(hit); return; }
  if (!hit) { toast("Missed. Click on a part."); return; }
  const mesh = hit.object, n = picks.length, per = PER_SIDE[tool];
  const first = picks[0]?.mesh;
  if (n >= per && mesh === first) { toast("That's the moving part. Click the part it attaches to.", 'bad'); return; }
  if (n > 0 && n < per && mesh !== first) { toast("Keep clicking on the moving part.", 'bad'); return; }
  if (n > per && mesh !== picks[per].mesh) { toast("Keep clicking on the same fixed part.", 'bad'); return; }
  mesh.updateMatrixWorld(true);
  const topo = topoOf(mesh), M = mesh.matrixWorld.clone(), tri = hit.faceIndex;
  const s = settings();
  const res = tool === 'BALL' ? pickBall(topo, M, tri, hit.point, s)
            : tool === 'THREE' ? pickPoint(topo, M, tri, hit.point, ev.shiftKey)
            : tool === 'MATCH' ? pickSurface(topo, M, tri, hit.point, s)
            : pickFlat(topo, M, tri, hit.point, s);
  if (res.err) { toast(res.err, 'bad'); return; }
  const side = n < per ? 'move' : 'fixed';
  if (res.region) showRegion(mesh, res.region, side === 'move' ? '#4db4dc' : '#e2804f');
  showMarker(res.point, '#ffe066', tool === 'THREE' ? 0.8 : 1.2);
  picks.push({ mesh, ...res });
  toast(`Got ${res.info}`);
  if (picks.length < per * 2) { updateStep(); return; }
  // all picks in: build the operation
  const op = {
    mode: tool, child: picks[0].mesh, fixed: picks[per].mesh,
    a: picks.slice(0, per).map(keepPick),
    b: picks.slice(per).map(keepPick),
    p: { spin: 0, gap: 0, flip: false, across: false, attach: lastAttach, centre: lastCentre, offset: [0, 0, 0], frame: lastFrame, pivot: lastPivot, seat: lastSeat },
    before: snapshot(),
  };
  picks = [];
  const go = async () => {
    const how = await askLink(op.child, 'Snap', { fixed: op.fixed });
    if (!how) { clearFx(); updateStep(); toast('Cancelled. Nothing moved.'); return; }
    op.reroot = how === 'group';
    if (op.mode === 'PLANE' && op.p.seat !== false) { toast('Fitting the parts together…'); await new Promise(r => setTimeout(r, 30)); }
    const ok = runOp(op);
    setTimeout(clearFx, 900);
    if (ok) { pushUndo(op.before); lastOp = op; select(op.child); showAdjust(); }
    updateStep();
    if (ok && op.seat) toast(`Seated: ${seatSummary(op.seat.info)}`, 'ok');
  };
  go();
}

const regionSig = list => { let mn = Infinity; for (const t of list) if (t < mn) mn = t; return list.length + ':' + mn; };
function matchResultFrom(r, A, B, label, listB) {
  return { ...r, joint: B.centre.clone(), axis: B.normal.clone(), label, regionB: listB, regionA: A.list, sig: regionSig(A.list) + '|' + regionSig(listB) };
}
/** Fit the picked faces; also try the fixed part's other faces of a similar size, in case the click landed on the wrong one. */
async function startMatch(op) {
  const s = settings(), tA = topoOf(op.child), tB = topoOf(op.fixed), m = op.match;
  toast('Matching surfaces…'); await nextFrame();
  try {
    if (m.targets) {                                                // the last piece: fit against several parts at once
      const fits = multiFit(tA, m.Ma, m.groupsA, m.targets.map(t => ({ topo: topoOf(t.mesh), M: t.M, groups: t.groups })));
      const nB = m.targets.reduce((a, t) => a + t.groups.length, 0), label = `your ${m.groupsA.length} + ${nB} areas on ${m.targets.length} parts`;
      const sig = regionSig(m.regionA) + '|' + m.targets.map(t => regionSig(t.region)).join('|');
      finishMatch(op, fits.map(r => ({ ...r, label, regionA: m.regionA, regionB: m.regionB, sig })));
      return;
    }
    if (m.groupsA.length > 1 || m.groupsB.length > 1) {             // several areas: fit them all at once
      const fits = multiFit(tA, m.Ma, m.groupsA, tB, m.Mb, m.groupsB);
      const sig = regionSig(m.regionA) + '|' + regionSig(m.regionB), label = `your ${m.groupsA.length} + ${m.groupsB.length} areas`;
      const results = fits.map(r => ({ ...r, label, regionA: m.regionA, regionB: m.regionB, sig }));
      await nextFrame();
      // let the parts settle into each other near that fit (small turns and slides only: the areas set the direction)
      const seated = await seatMatches(op, results.slice(0, 2), { area: Math.min(...[m.regionA, m.regionB].map((l, i) => l.reduce((a, t) => a + (i ? tB : tA).fa[t], 0))) }, [0.35], { shift: 0.6 });
      finishMatch(op, [...results, ...seated]);
      return;
    }
    const A = regionSamples(tA, m.Ma, m.regionA), results = [];
    const tryFace = (list, label, quick) => {
      const B = regionSamples(tB, m.Mb, list, quick ? { nSurf: 600, nEdge: 200 } : {});
      for (const r of matchRegions(A, B, quick ? { iters: 15, starts: 2 } : {})) results.push(matchResultFrom(r, A, B, label, list));
    };
    tryFace(m.regionB, 'your faces', false);
    const clickedArea = A.area;
    // seat the best fits of the faces you clicked: push the parts together along the face and let notches,
    // keys and pegs settle the turn and slide. These rank first: they use the faces you chose and how the parts really meet.
    const seated = await seatMatches(op, results.slice().sort((p, q) => p.score - q.score).slice(0, 2), A);
    const others = facesOf(op.fixed, s.creaseDeg).filter(r => regionSig(r.list) !== regionSig(m.regionB));
    for (const r of others.slice(0, 5)) {
      const B0 = regionSamples(tB, m.Mb, r.list, { nSurf: 50, nEdge: 20, bvh: false });
      if (Math.min(B0.area, clickedArea) / Math.max(B0.area, clickedArea) < 0.5) continue;
      await nextFrame(); tryFace(r.list, `another face (${B0.area.toFixed(0)} mm²)`, true);
    }
    // the clicked faces don't fit well: maybe the click missed a narrow mating face. Look at every face.
    const scored = results.map(r => ({ r, v: matchVerdict({ ...r, inside: insideFraction(op.child.geometry, m.Ma, r.T, op.fixed.geometry, m.Mb, 0.1, 250) }) }));
    results.push(...seated);
    if (!seated.some(r => seatGood(r.seated, clickedArea)) && !scored.some(x => x.v.good)) {
      toast("The faces you clicked don't fit closely. Searching every face of both parts…");
      results.push(...await searchFits(op, t => toast(t)));
    }
    finishMatch(op, results);
  } catch (err) { console.error(err); toast("Couldn't match those faces. Try clicking nearer the middle of each mating face.", 'bad'); clearFx(); }
}
const seatGood = (st, area) => st && st.contact >= Math.max(0.5, 0.25 * area) && st.sunk < st.contact * 0.6;
async function seatMatches(op, fits, A, spins = [Math.PI, 0.35], extra = {}) {
  const m = op.match, out = [];
  const rr = Math.max(regionRadius(op.child, m.Ma, m.regionA), regionRadius(op.fixed, m.Mb, m.regionB)), R = seatRadius(op, rr);
  for (const r of fits) for (const spinRange of spins) {
    await nextFrame();
    let st = null;
    try { st = seatSolve(op.child.geometry, r.T.clone().multiply(m.Ma), op.fixed.geometry, m.Mb, { o: r.joint, z: r.axis }, { R, spinRange, ...extra }); } catch (e) { console.error(e); }
    if (!st) continue;
    out.push({ ...r, T: st.T.clone().multiply(r.T), joint: r.joint.clone().applyMatrix4(st.T), seated: st, slides: false,
               coverage: Math.min(1, st.contact / Math.max(A.area, 1e-6)), seatArea: A.area, label: (spinRange < 1 ? 'settled in place' : 'seated') + ' · ' + (r.label.startsWith('your ') ? r.label.slice(5) : 'faces') });
  }
  // a surface fit that already sits as well as its seated version keeps its exact pose
  for (const r of fits) {
    let st0 = null;
    try { st0 = seatSolve(op.child.geometry, r.T.clone().multiply(m.Ma), op.fixed.geometry, m.Mb, { o: r.joint, z: r.axis }, { R, spinRange: 0, shift: 0, tilt: 0 }); } catch (e) { console.error(e); }
    const best = Math.max(...out.filter(x => x.sig === r.sig).map(x => x.seated.score), -Infinity);
    if (st0 && st0.score >= best * 0.97 - 1e-9) out.push({ ...r, seated: { ...st0, theta: 0, dx: 0, dy: 0, dz: 0 }, slides: false, seatArea: A.area,
      coverage: Math.min(1, st0.contact / Math.max(A.area, 1e-6)), label: 'as matched · ' + (r.label.startsWith('your ') ? r.label.slice(5) : 'faces'), exact: true });
  }
  out.sort((p, q) => (q.seated.score + (q.exact ? q.seated.score * 0.03 : 0)) - (p.seated.score + (p.exact ? p.seated.score * 0.03 : 0)));
  // seated fits rank above the bare surface fits, unless none of them actually seats (then a search may find better)
  const any = out.some(r => seatGood(r.seated, A.area));
  out.forEach((r, k) => { r.score = (any ? -10 : 10) + k * 0.01; });
  return out;
}
function finishMatch(op, results, keepChoice) {
  const m = op.match;
  for (const r of results) if (r.inside == null) {
    r.inside = m.targets ? Math.max(...m.targets.map(t => insideFraction(op.child.geometry, m.Ma, r.T, t.mesh.geometry, t.M))) : insideFraction(op.child.geometry, m.Ma, r.T, op.fixed.geometry, m.Mb);
    if (!r.seated) r.score += r.inside * 4;                   // a seat already weighs any overlap
  }
  const seen = new Set(), list = results.sort((a, b) => a.score - b.score).filter(r => {
    const key = r.sig + '|' + V().setFromMatrixPosition(r.T).toArray().map(v => v.toFixed(1)).join() + '|' + new THREE.Quaternion().setFromRotationMatrix(r.T).toArray().map(v => v.toFixed(2)).join();
    if (seen.has(key)) return false; seen.add(key); return true; })
    .filter((r, k, all) => {                                       // keep only fits worth trying
      if (k === 0) return true;
      if (r.seated) return r.seated.score > all[0].seated?.score * 0.6 || !all[0].seated;
      const bestBare = all.find(x => !x.seated);
      return r === bestBare || (r.coverage >= 0.2 && r.inside < 0.1 && r.score < bestBare.score + 0.12);
    }).slice(0, 5);
  if (!list.length) { toast("Couldn't find a fit between those faces.", 'bad'); clearFx(); return; }
  op.match.results = list; op.match.chosen = 0;
  if (lastOp === op) { rerunLast(); }
  else { const ok = runOp(op); if (!ok) { clearFx(); return; } pushUndo(op.before); lastOp = op; select(op.child); }
  showAdjust(); flashMatch();
  const b = list[0];
  toast(matchVerdict(b).good ? `Fitted: ${matchVerdict(b).text}` : `Best fit is loose: ${matchVerdict(b).text}. Check the other fits in Adjust.`, matchVerdict(b).good ? 'ok' : 'bad');
}
function matchVerdict(r) {
  if (r.seated) return { text: `seated: ${seatSummary(r.seated)}`, good: seatGood(r.seated, r.seatArea || 0) };
  const parts = [`typical gap ${r.gap.toFixed(2)} mm`, `${Math.round(r.coverage * 100)}% within ${r.covTol.toFixed(2)} mm`];
  if (r.ringErr != null) parts.push(`${r.rings > 1 ? 'pegs and holes' : 'peg and hole'} within ${r.ringErr.toFixed(2)} mm`);
  if (r.edgeErr != null) parts.push(`outlines within ${r.edgeErr.toFixed(2)} mm`);
  if (r.inside > 0.03) parts.push(`${Math.round(r.inside * 100)}% of it inside the other part`);
  const good = r.coverage > 0.6 && r.gap < 0.2 && (r.edgeErr == null || r.edgeErr < Math.max(0.3, r.size * 0.1)) && (r.ringErr == null || r.ringErr < 0.3) && !(r.inside > 0.03);
  return { text: parts.join(', '), good };
}
function flashMatch() {
  const op = lastOp; if (!op?.match?.results.length) return;
  const r = op.match.results[op.match.chosen]; clearFx(); scene.updateMatrixWorld(true);
  showRegion(op.child, r.regionA, '#4db4dc');
  if (op.match.targets) op.match.targets.forEach(t => showRegion(t.mesh, t.region, '#e2804f')); else showRegion(op.fixed, r.regionB, '#e2804f');
  clearTimeout(flashCentres.t); flashCentres.t = setTimeout(clearFx, 1600);
}
/** Every candidate face of one part against every candidate face of the other. Returns fits. */
async function searchFits(op, progress) {
  const s = settings(), tA = topoOf(op.child), tB = topoOf(op.fixed), m = op.match;
  progress('Finding the faces of both parts…'); await nextFrame();
  const fa = [...facesOf(op.child, s.creaseDeg)], fb = [...facesOf(op.fixed, s.creaseDeg)];
  if (!fa.some(r => regionSig(r.list) === regionSig(m.regionA))) fa.unshift({ list: m.regionA });
  const sa = fa.map(r => regionSamples(tA, m.Ma, r.list, { nSurf: 500, nEdge: 160 })), sb = fb.map(r => regionSamples(tB, m.Mb, r.list, { nSurf: 500, nEdge: 160 }));
  const pairs = []; sa.forEach((a, i) => sb.forEach((b, j) => { const k = Math.min(a.area, b.area) / Math.max(a.area, b.area);
    if (k >= 0.4) pairs.push({ i, j, k: k * Math.sqrt((fa[i].rank || fa[i].area) / Math.max(fa[i].area, 1e-9) * (fb[j].rank || fb[j].area) / Math.max(fb[j].area, 1e-9)) }); }));
  pairs.sort((x, y) => y.k - x.k);
  const quick = []; let n = 0; const N = Math.min(pairs.length, 12);
  for (const pr of pairs.slice(0, N)) {
    progress(`Searching every face for a fit… ${++n} of ${N}`); await nextFrame();
    const f = matchRegions(sa[pr.i], sb[pr.j], { iters: 8, starts: 2 })[0];
    if (f) { f.inside = insideFraction(op.child.geometry, m.Ma, f.T, op.fixed.geometry, m.Mb, 0.1, 250); quick.push({ ...pr, f, s: f.score + f.inside * 4 }); }
  }
  quick.sort((x, y) => x.s - y.s);
  const out = [];
  for (const q of quick.slice(0, 3)) {
    await nextFrame();
    const A = regionSamples(tA, m.Ma, sa[q.i].list), B = regionSamples(tB, m.Mb, sb[q.j].list);
    for (const r of matchRegions(A, B).slice(0, 2)) out.push(matchResultFrom(r, A, B, `found by search (${A.area.toFixed(0)} ↔ ${B.area.toFixed(0)} mm²)`, sb[q.j].list));
  }
  return out;
}
async function searchAllFaces() {
  if (lastOp?.match?.targets) { toast('Search all faces works between two parts. Pick areas on just one fixed part to use it.', 'bad'); return; }
  const op = lastOp; if (!op || op.mode !== 'MATCH') return;
  $('adj-search').disabled = true;
  try { const more = await searchFits(op, t => toast(t)); finishMatch(op, [...op.match.results, ...more]); }
  catch (err) { console.error(err); toast("The search didn't finish. Try clicking the mating faces instead.", 'bad'); }
  $('adj-search').disabled = false;
}

// ---------------------------------------------------------------------------
// Orient: lay a face flat, square a part or a seam to the X, Y, Z planes
// ---------------------------------------------------------------------------
const ori = { part: null, before: null, sources: [], p: { source: 0, target: '-z', square: true, spin: 0, ground: true, scope: 'assembly' } };
function rootOf(part) { let r = part; while (parentPart(r)) r = parentPart(r); return r; }
/** The seams in a part's assembly: every joint or fixed link between two parts. */
function seamsAround(part) {
  const out = [], root = rootOf(part);
  for (const child of subtreeParts(root)) {
    const parent = parentPart(child); if (!parent) continue;
    const j = jointOf(child);
    const frame = j || child;
    frame.updateMatrixWorld(true);
    const q = frame.getWorldQuaternion(new THREE.Quaternion()), c = V().setFromMatrixPosition(frame.matrixWorld);
    const n = j ? V(0, 0, 1).applyQuaternion(q) : worldBox(child).getCenter(V()).sub(worldBox(parent).getCenter(V())).normalize();
    const long = j?.userData.joint.long ? j.userData.joint.long.clone().applyQuaternion(q) : j ? V(1, 0, 0).applyQuaternion(q) : null;
    out.push({ kind: 'seam', label: `Seam: ${child.name} ↔ ${parent.name}`, n, c, long, child });
  }
  return out;
}
function orientFromFace(hit) {
  const mesh = hit.object, topo = topoOf(mesh); mesh.updateMatrixWorld(true);
  const M = mesh.matrixWorld.clone(), r = pickSurface(topo, M, hit.faceIndex, hit.point, settings());
  if (r.err) { toast(r.err, 'bad'); return; }
  const pl = regionPlane(topo, r.region), n = worldNormal(M, pl.n), c = pl.p.clone().applyMatrix4(M);
  showRegion(mesh, r.region, '#d6a24a'); clearTimeout(flashCentres.t); flashCentres.t = setTimeout(clearFx, 1200);
  openOrient(mesh, { kind: 'face', label: `The ${r.kind} face you clicked (${(pl.A).toFixed(0)} mm²)`, n, c, long: faceLongAxis(topo, M, r.region, n) });
}
function openOrient(part, first) {
  clearHover(); lastOp = null; $('adjust').hidden = true; showFit(); closeAutorig(false);
  pushUndo(); ori.before = snapshot(); ori.part = part;
  if (first.kind === 'auto' && !first.label) first.label = 'Square up automatically';
  ori.sources = [first, ...(first.kind === 'auto' ? [] : [{ kind: 'auto', label: 'Square up automatically' }]), ...seamsAround(part).filter(sm => sm.label !== first.label)];
  Object.assign(ori.p, { source: 0, spin: 0, target: first.kind === 'seam' ? '+z' : '-z' });
  ori.selection = selection.length > 1 && selection.includes(part) ? selectionRoots() : null;
  ori.p.scope = ori.selection ? 'selection' : ori.p.scope === 'selection' ? 'assembly' : ori.p.scope;
  const sel = $('or-source'); sel.innerHTML = '';
  ori.sources.forEach((sr, k) => { const o = document.createElement('option'); o.value = k; o.textContent = sr.label; sel.append(o); });
  $('orient').hidden = false; if (!ori.selection) select(part);
  applyOrient();
}
function applyOrient() {
  const src = ori.sources[ori.p.source]; if (!src) return;
  restore(ori.before);
  const part = ori.part, objs = ori.p.scope === 'selection' && ori.selection ? ori.selection : [ori.p.scope === 'assembly' ? rootOf(part) : part];
  const moving = [...new Set(objs.flatMap(subtreeParts))];
  const spin = ori.p.spin * Math.PI / 180;
  let R;
  if (src.kind === 'auto') {
    const dd = dominantDirections(ori.p.scope === 'part' ? [part] : moving), q = squareUpQuat(dd);
    const c = sceneBox(moving).getCenter(V());
    R = Tr(c).multiply(new THREE.Matrix4().makeRotationAxis(V(0, 0, 1), spin)).multiply(Tr(c.clone().negate())).multiply(rotAbout(q, c));
  } else {
    const target = AXES[ori.p.target], q = orientQuat(src.n, target, { inPlane: src.long, square: ori.p.square, spin });
    R = rotAbout(q, src.c);
  }
  for (const o of objs) applyWorld(o, R);
  if (ori.p.ground) { scene.updateMatrixWorld(true); const dz = -lowestZ(moving); for (const o of objs) applyWorld(o, Tr(V(0, 0, dz))); }
  afterHierarchyChange();
  renderOrient();
}
function renderOrient() {
  const src = ori.sources[ori.p.source], auto = src?.kind === 'auto', seam = src?.kind === 'seam';
  $('or-source').value = ori.p.source;
  const root = rootOf(ori.part), n = subtreeParts(root).length;
  $('or-sum').textContent = ori.p.scope === 'selection' && ori.selection ? `${ori.selection.length} selected parts` : ori.p.scope === 'assembly' && n > 1 ? `${root.name} + ${n - 1} attached` : ori.part.name;
  $('or-scope-sel').hidden = !ori.selection;
  $('or-target-f').hidden = auto; $('or-square-f').hidden = auto;
  $('or-target-label').textContent = seam ? 'Point the seam (its facing)' : 'Point the face';
  $('or-spin-label').textContent = auto ? 'Turn about Z (°)' : 'Turn about that axis (°)';
  document.querySelectorAll('#or-target button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ori.p.target ? 'true' : 'false'));
  document.querySelectorAll('#or-scope button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ori.p.scope ? 'true' : 'false'));
  $('or-square').checked = ori.p.square; $('or-ground').checked = ori.p.ground;
  if (document.activeElement !== $('or-spin')) $('or-spin').value = ori.p.spin;
  $('or-note').textContent = auto ? 'Turns it the least it can so its biggest flat faces (or, on organic parts, its long directions) line up with X, Y and Z.'
    : seam ? `Pointing the seam ${ori.p.target === '+z' || ori.p.target === '-z' ? 'up or down lays the plane the parts meet on flat' : 'along X or Y stands that plane upright'}.`
    : ori.p.target === '-z' ? 'Lays this face flat on the grid.' : '';
}
function closeOrient() { $('orient').hidden = true; ori.before = null; }
function bindOrient() {
  $('or-source').addEventListener('change', () => { ori.p.source = +$('or-source').value; ori.p.spin = 0;
    if (ori.sources[ori.p.source].kind === 'seam' && ori.p.target === '-z') ori.p.target = '+z'; applyOrient(); });
  document.querySelectorAll('#or-target button').forEach(b => b.addEventListener('click', () => { ori.p.target = b.dataset.v; ori.p.spin = 0; applyOrient(); }));
  document.querySelectorAll('#or-scope button').forEach(b => b.addEventListener('click', () => { ori.p.scope = b.dataset.v; applyOrient(); }));
  $('or-square').addEventListener('change', () => { ori.p.square = $('or-square').checked; applyOrient(); });
  $('or-ground').addEventListener('change', () => { ori.p.ground = $('or-ground').checked; applyOrient(); });
  $('or-spin').addEventListener('change', () => { ori.p.spin = +$('or-spin').value || 0; applyOrient(); });
  const turn = d => { ori.p.spin = ((ori.p.spin + d + 540) % 360) - 180; applyOrient(); };
  $('or-m90').addEventListener('click', () => turn(-90)); $('or-p90').addEventListener('click', () => turn(90)); $('or-flip').addEventListener('click', () => turn(180));
  $('or-done').addEventListener('click', () => { closeOrient(); toast('Oriented.', 'ok'); });
  $('or-close').addEventListener('click', closeOrient);
  $('or-revert').addEventListener('click', () => { restore(ori.before); afterHierarchyChange(); closeOrient(); toast('Put back where it was.'); });
  $('adj-seam').addEventListener('click', () => {
    const op = lastOp; if (!op?.seam) return;
    const label = `Seam: ${op.child.name} ↔ ${op.fixed.name}`;
    openOrient(op.child, { kind: 'seam', label, n: op.seam.n.clone(), c: op.seam.c.clone(), long: op.seam.long?.clone() || null });
  });
}

let lastAttach = 'joint', lastCentre = 'auto', lastFrame = 'world', lastPivot = 'parent', lastSeat = true;
const keepPick = q => ({ point: q.point.clone(), normal: q.normal.clone(), candidates: q.candidates, ringInfo: q.ringInfo, ringNear: q.ringNear, radius: q.radius, kind: q.kind });
function resolvedOp(op) {
  const res = e => ({ ...e, point: resolveCentre(e, op.p.centre).point.clone() });
  return { ...op, a: op.a.map(res), b: op.b.map(res) };
}
/** The moving part's own contact point (before the snap): ball centre, face point, gap midpoint, point 1. */
function childPoint(rop) { return rop.mode === 'MID' ? rop.a[0].point.clone().add(rop.a[1].point).multiplyScalar(0.5) : rop.a[0].point.clone(); }
/** Joint axes for an op, worked out from the snap alone so nudges never tilt them. */
function opBasis(op) { return jointBasis(op.baseAxis || V(0, 0, 1)); }
function offsetWorld(op) {
  const [x, y, z] = op.p.offset || [0, 0, 0];
  if (op.p.frame !== 'joint') return V(x, y, z);
  const { X, Y, Z } = opBasis(op);
  return X.multiplyScalar(x).addScaledVector(Y, y).addScaledVector(Z, z);
}
/** Biggest distance from a picked region's middle to its edge (mm, world). */
function regionRadius(mesh, M, list) {
  const t = topoOf(mesh), v = V(), c = V(), step = Math.max(1, Math.floor(list.length / 4000)); let n = 0, r = 0;
  for (let k = 0; k < list.length; k += step) { const i = list[k]; c.add(v.set(t.fc[3*i], t.fc[3*i+1], t.fc[3*i+2]).applyMatrix4(M)); n++; }
  if (!n) return 0; c.multiplyScalar(1 / n);
  for (let k = 0; k < list.length; k += step) { const i = list[k]; r = Math.max(r, v.set(t.fc[3*i], t.fc[3*i+1], t.fc[3*i+2]).applyMatrix4(M).distanceTo(c)); }
  return r;
}
/** How much of the parts around the joint the seat looks at: the picked faces and a margin, so nearby notches and pegs count. */
function seatRadius(op, rr) {
  const d = Math.min(worldBox(op.child).getSize(V()).length(), worldBox(op.fixed).getSize(V()).length());
  return Math.min(Math.max(2.5 * rr, 0.3 * d, 2), Math.max(0.5 * d, 2));
}
function seatSummary(st) {
  const deg = st.theta * 180 / Math.PI, slide = Math.hypot(st.dx, st.dy);
  const bits = [];
  if (Math.abs(deg) >= 0.5) bits.push(`turned ${Math.abs(deg).toFixed(0)}°`);
  if (slide >= 0.02) bits.push(`slid ${slide.toFixed(2)} mm`);
  if (Math.abs(st.dz) >= 0.02) bits.push(st.dz < 0 ? `pushed in ${(-st.dz).toFixed(2)} mm` : `backed out ${st.dz.toFixed(2)} mm`);
  return `${bits.length ? bits.join(', ') : 'already sat right'} · ${st.contact.toFixed(1)} mm² touching` + (st.sunk > 0.05 ? `, ${st.sunk.toFixed(1)} mm² pressed into each other` : '');
}
/** Face to face: after the faces meet, turn and slide the moving part about the joint until it fits best (cached per centre/flip choice). */
function ensureSeat(op, rop) {
  if (op.mode !== 'PLANE' || op.p.seat === false) return;
  const key = `${op.p.flip}|${op.p.centre}`;
  if (op.seatKey === key) return;
  op.seatKey = key; op.seat = null;
  op.child.updateWorldMatrix(true, false); op.fixed.updateWorldMatrix(true, false);
  const base = computeSnap({ ...rop, p: { ...rop.p, spin: 0, gap: 0 }, seat: null }); if (base.err) return;
  const rr = Math.max(regionRadius(op.child, op.child.matrixWorld, op.a[0].region || []), regionRadius(op.fixed, op.fixed.matrixWorld, op.b[0].region || []));
  try {
    const st = seatSolve(op.child.geometry, base.T.clone().multiply(op.child.matrixWorld), op.fixed.geometry, op.fixed.matrixWorld, { o: base.joint, z: base.axis }, { R: seatRadius(op, rr) });
    if (st) op.seat = { T: st.T, joint: base.joint.clone().applyMatrix4(st.T), info: st };
  } catch (e) { console.error(e); }
}
function runOp(op) {
  if (op.reroot) { const e = reroot(op.child); if (e) { toast(e, 'bad'); op.reroot = false; } }   // the moving part leads its whole group
  ensureSeat(op, resolvedOp(op));
  const rop = resolvedOp(op); if (op.mode === 'PLANE' && op.p.seat === false) rop.seat = null;
  const r = computeSnap(rop);
  if (r.err) { toast(r.err, 'bad'); return false; }
  let axis = r.axis;
  if (!axis) {                           // ball: point the joint along the limb (measured before any nudge)
    axis = worldBox(op.child).getCenter(V()).applyMatrix4(r.T).sub(r.joint);
    if (axis.length() < 1e-6) axis = V(0, 0, 1);
  }
  op.baseAxis = axis.clone().normalize();
  const T = Tr(offsetWorld(op)).multiply(r.T);
  const childPt = childPoint(rop).applyMatrix4(T);
  const joint = op.p.pivot === 'child' ? childPt : r.joint.clone();
  op.result = { ...r, T, joint, parentPoint: r.joint.clone(), childPoint: childPt };
  applyWorld(op.child, T);
  op.jointAxis = op.baseAxis.clone();
  const warn = attach(op.child, op.fixed, op.p.attach, joint, axis);
  if (warn) toast(warn, 'bad');
  { const sl = slotOf(op.child); if (sl && parentPart(op.child)) shareSlotJoint(sl, op.child); }   // the other options follow onto this joint
  op.seam = { n: axis.clone().normalize(), c: joint.clone(), long: null };
  if (op.mode === 'MATCH' && op.match?.results.length) {      // the seam line's own direction, from the matched face
    const m = op.match.results[op.match.chosen]; op.seam.long = faceLongAxis(topoOf(op.fixed), op.match.Mb, m.regionB, op.seam.n);
  }
  const j = jointOf(op.child); if (j && op.seam.long) j.userData.joint.long = op.seam.long.clone().applyQuaternion(j.getWorldQuaternion(new THREE.Quaternion()).invert());
  afterHierarchyChange();
  return true;
}

// ---------------------------------------------------------------------------
// Fit check: three cross-sections through the joint
// ---------------------------------------------------------------------------
const fit = { zoom: 1, op: null, cuts: null, R: 5, pending: false, depthFrac: 0 };
const cutPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#d6a24a', transparent: true, opacity: .14, side: THREE.DoubleSide, depthWrite: false }));
const cutEdge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(-.5,-.5), V(.5,-.5), V(.5,.5), V(-.5,.5)]), new THREE.LineBasicMaterial({ color: '#d6a24a', depthTest: false }));
cutPlane.add(cutEdge); cutPlane.visible = false; cutPlane.renderOrder = 997; scene.add(cutPlane);

function fitRadius(op) {
  if (op.mode === 'BALL' && op.a[0].radius) return op.a[0].radius * 2.2;
  const d = Math.min(worldBox(op.child).getSize(V()).length(), worldBox(op.fixed).getSize(V()).length());
  return Math.min(Math.max(d * 0.3, 1.5), 60);
}
function defaultDepthFrac(op) { return op.mode === 'PLANE' || (op.mode === 'MATCH' && op.match?.flat) ? -0.15 : 0; }   // flat contact: look just inside the fixed part     // faces: look just inside the fixed part, where a peg sits in its hole
function scheduleFit() { if (fit.pending) return; fit.pending = true; requestAnimationFrame(() => { fit.pending = false; drawFit(); }); }

function showFit() {
  const op = lastOp, el = $('fitcheck');
  if (!op || !op.result) { el.hidden = true; cutPlane.visible = false; return; }
  if (fit.op !== op) { fit.op = op; fit.zoom = 1; fit.depthFrac = defaultDepthFrac(op); $('fit-depth').value = Math.round(fit.depthFrac * 100); }
  el.hidden = false; scheduleFit();
}
function drawFit() {
  const op = lastOp; if (!op || !op.result || $('fitcheck').hidden || $('fit-body').hidden) return;
  scene.updateMatrixWorld(true);
  const R = fitRadius(op) * fit.zoom; fit.R = R;
  const depth = fit.depthFrac * R;
  $('fit-depth-n').textContent = `${depth >= 0 ? '+' : ''}${depth.toFixed(2)} mm`;
  fit.cuts = fitCuts(op.result.joint, op.jointAxis || V(0, 0, 1), depth);
  fit.cuts.forEach((c, i) => {
    const A = sliceMesh(op.child.geometry, op.child.matrixWorld, c.plane, c.origin, R, c.u, c.v, BVH);
    const B = sliceMesh(op.fixed.geometry, op.fixed.matrixWorld, c.plane, c.origin, R, c.u, c.v, BVH);
    drawCut($('cut' + i), $('cut' + i + '-read'), A, B, R, c);
  });
}

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function niceStep(span) { const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
function drawCut(cv, read, A, B, R, cut) {
  const dpr = Math.min(devicePixelRatio || 1, 2), size = Math.max(cv.clientWidth, 60), px = Math.round(size * dpr);
  if (cv.width !== px) { cv.width = cv.height = px; }
  const ctx = cv.getContext('2d'), s = px / (2 * R), X = x => px / 2 + x * s, Y = y => px / 2 - y * s;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px);
  // grid with a mm scale
  const step = niceStep(2 * R);
  ctx.strokeStyle = '#232a30'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let g = Math.ceil(-R / step) * step; g <= R; g += step) { ctx.moveTo(X(g), 0); ctx.lineTo(X(g), px); ctx.moveTo(0, Y(g)); ctx.lineTo(px, Y(g)); }
  ctx.stroke();
  const path = seg => { const p2 = new Path2D(); for (const l of chainSegments(seg, R)) { p2.moveTo(X(l.pts[0]), Y(l.pts[1]));
      for (let i = 2; i < l.pts.length; i += 2) p2.lineTo(X(l.pts[i]), Y(l.pts[i+1])); if (l.closed) p2.closePath(); } return p2; };
  const pA = path(A), pB = path(B);
  const mv = css('--move') || '#4db4dc', fx2 = css('--fixed') || '#e2804f';
  ctx.globalAlpha = 0.3; ctx.fillStyle = fx2; ctx.fill(pB, 'evenodd'); ctx.fillStyle = mv; ctx.fill(pA, 'evenodd'); ctx.globalAlpha = 1;
  // overlap: draw each part into its own channel and find pixels both cover
  const off = drawCut.off ||= document.createElement('canvas'); off.width = off.height = px;
  const o = off.getContext('2d', { willReadFrequently: true });
  o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, px, px); o.globalCompositeOperation = 'lighter';
  o.fillStyle = '#ff0000'; o.fill(pA, 'evenodd'); o.fillStyle = '#00ff00'; o.fill(pB, 'evenodd');
  const img = o.getImageData(0, 0, px, px), d = img.data; let over = 0;
  for (let i = 0; i < d.length; i += 4) { const both = d[i] > 200 && d[i+1] > 200; if (both) { over++; d[i] = 227; d[i+1] = 107; d[i+2] = 107; d[i+3] = 235; } else d[i+3] = 0; }
  o.globalCompositeOperation = 'source-over'; o.putImageData(img, 0, 0); ctx.drawImage(off, 0, 0);
  ctx.lineWidth = Math.max(1.2, dpr); ctx.strokeStyle = fx2; ctx.stroke(pB); ctx.strokeStyle = mv; ctx.stroke(pA);
  // joint marker and axis
  ctx.strokeStyle = '#d6a24a'; ctx.lineWidth = 1; ctx.setLineDash([3 * dpr, 3 * dpr]);
  if (cut.name !== 'Across') { ctx.beginPath(); ctx.moveTo(X(0), px); ctx.lineTo(X(0), 0); ctx.stroke(); }
  ctx.setLineDash([]); ctx.beginPath(); ctx.arc(X(0), Y(cut.name === 'Across' ? 0 : 0), 3 * dpr, 0, Math.PI * 2); ctx.stroke();
  // scale bar
  ctx.fillStyle = '#8d969e'; ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  const bar = step * s; ctx.fillRect(6 * dpr, px - 8 * dpr, bar, 2 * dpr);
  ctx.fillText(`${+step.toPrecision(3)} mm`, 6 * dpr, px - 12 * dpr);
  // readout
  const area = over / (s * s);
  if (!A.length || !B.length) { read.textContent = !A.length && !B.length ? 'no parts here' : !A.length ? 'moving part not cut' : 'fixed part not cut'; read.className = 'read'; return; }
  if (area > Math.max(4 / (s * s), R * R * 1e-5)) { read.textContent = `overlap ${area.toFixed(area < 1 ? 3 : 2)} mm²`; read.className = 'read bad'; return; }
  const gap = segmentsGap(A, B);
  if (gap < 0.005) { read.textContent = 'touching'; read.className = 'read ok'; }
  else { read.textContent = `gap ${gap.toFixed(gap < 1 ? 3 : 2)} mm`; read.className = 'read gap'; }
}
function bindFit() {
  $('fit-head').addEventListener('click', () => { $('fit-body').hidden = !$('fit-body').hidden; cutPlane.visible = false; scheduleFit(); });
  $('fit-depth').addEventListener('input', () => { fit.depthFrac = +$('fit-depth').value / 100; scheduleFit(); });
  document.querySelectorAll('.cut').forEach(fig => {
    const cv = fig.querySelector('canvas'), i = +fig.dataset.i;
    cv.addEventListener('wheel', e => { e.preventDefault(); fit.zoom = Math.min(Math.max(fit.zoom * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 0.05), 20); scheduleFit(); }, { passive: false });
    cv.addEventListener('dblclick', () => { fit.zoom = 1; if (lastOp) { fit.depthFrac = defaultDepthFrac(lastOp); $('fit-depth').value = Math.round(fit.depthFrac * 100); } scheduleFit(); });
    fig.addEventListener('mouseenter', () => {
      const c = fit.cuts?.[i]; if (!c) return;
      const R = fit.R; cutPlane.position.copy(c.origin);
      cutPlane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(c.u, c.v, c.normal));
      cutPlane.scale.set(2 * R, 2 * R, 1); cutPlane.visible = true;
    });
    fig.addEventListener('mouseleave', () => { cutPlane.visible = false; });
  });
  new ResizeObserver(() => scheduleFit()).observe($('fitcheck'));
}
function flashCentres() {          // briefly show the centres now in use
  if (!lastOp) return; clearFx(); scene.updateMatrixWorld(true);
  const T = lastOp.result?.T || new THREE.Matrix4();
  for (const e of lastOp.a) showMarker(resolveCentre(e, lastOp.p.centre).point.clone().applyMatrix4(T), '#4db4dc', 1.3);
  for (const e of lastOp.b) showMarker(resolveCentre(e, lastOp.p.centre).point, '#e2804f', 1.3);
  clearTimeout(flashCentres.t); flashCentres.t = setTimeout(clearFx, 1400);
}
function rerunLast() {
  if (!lastOp) return;
  restore(lastOp.before);
  runOp(lastOp);
  syncGizmo();
}

// ---------------------------------------------------------------------------
// Adjust Last Operation panel
// ---------------------------------------------------------------------------
function showAdjust() {
  const op = lastOp, el = $('adjust');
  showFit();
  if (!op) { el.hidden = true; return; }
  el.hidden = false;
  $('adjust-title').textContent = `Adjust: ${TOOL_NAMES[op.mode]}`;
  $('adj-chain').innerHTML = '';
  const mk = (txt, col, bold) => { const s = document.createElement('span'); if (col) { const d = document.createElement('i'); d.className = 'dot'; d.style.background = col; s.append(d, ' '); }
    const t = document.createElement(bold ? 'b' : 'span'); t.textContent = txt; s.append(t); return s; };
  $('adj-chain').append(mk(op.child.name, 'var(--move)', true), mk(op.p.attach === 'none' ? 'moved to' : 'attached to'), mk(op.fixed.name, 'var(--fixed)', true));
  if (op.match?.targets) $('adj-chain').append(mk('· also fitted against'), mk(op.match.targets.slice(1).map(t => t.mesh.name).join(', '), 'var(--fixed)', true));
  const geo = op.mode === 'PLANE' || op.mode === 'MID', isMatch = op.mode === 'MATCH';
  $('adj-spin-f').hidden = !(geo || isMatch); $('adj-gap-f').hidden = !(geo || isMatch); $('adj-flip-f').hidden = !geo; $('adj-across-f').hidden = op.mode !== 'MID';
  $('adj-match-f').hidden = !isMatch;
  if (isMatch) {
    const box = $('adj-matches'); box.innerHTML = '';
    op.match.results.forEach((r, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.setAttribute('aria-pressed', k === op.match.chosen ? 'true' : 'false');
      const t = document.createElement('span'); t.textContent = r.seated ? `Fit ${k + 1}: ${r.seated.contact.toFixed(1)} mm² touching` : `Fit ${k + 1}: ${Math.round(r.coverage * 100)}% contact`;
      const sm = document.createElement('small'); sm.textContent = r.seated ? `${r.label}` : `gap ${r.gap.toFixed(2)} mm · ${r.label}`;
      b.append(t, sm); b.addEventListener('click', () => { op.match.chosen = k; rerunLast(); showAdjust(); flashMatch(); });
      box.append(b);
    });
  }
  $('adj-centre-f').hidden = !geo; $('adj-seat-f').hidden = op.mode !== 'PLANE'; $('adj-seat').checked = op.p.seat !== false;
  document.querySelectorAll('#adj-centre button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === op.p.centre ? 'true' : 'false'));
  if (geo) {
    const lab = list => [...new Set(list.map(e => resolveCentre(e, op.p.centre).label))].join(' / ');
    $('adj-centre-used').textContent = `Moving: ${lab(op.a)} · Fixed: ${lab(op.b)}`;
  }
  $('adj-gap-label').textContent = op.mode === 'MID' ? 'Offset across the gap (mm)' : op.mode === 'MATCH' ? 'Gap between the surfaces (mm)' : 'Gap between faces (mm)';
  $('adj-flip-label').textContent = op.mode === 'MID' ? 'Swap sides' : 'Face the same way';
  $('adj-spin').value = $('adj-spin-n').value = op.p.spin;
  $('adj-gap').value = op.p.gap; $('adj-flip').checked = op.p.flip; $('adj-across').checked = op.p.across;
  document.querySelectorAll('#adj-parent button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === op.p.attach ? 'true' : 'false'));
  document.querySelectorAll('#adj-frame button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === op.p.frame ? 'true' : 'false'));
  document.querySelectorAll('#adj-pivot button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === op.p.pivot ? 'true' : 'false'));
  ['x', 'y', 'z'].forEach((k, i) => { const el = $('adj-off-' + k); if (el && document.activeElement !== el) el.value = (op.p.offset[i] || 0).toFixed(3); });
  const world = op.p.frame !== 'joint';
  const names = world ? [['← Left', 0, -1], ['Right →', 0, 1], ['↑ Up', 2, 1], ['← Back', 1, -1], ['Forward →', 1, 1], ['↓ Down', 2, -1]]
                      : [['−X', 0, -1], ['+X', 0, 1], ['+Z out', 2, 1], ['−Y', 1, -1], ['+Y', 1, 1], ['−Z in', 2, -1]];
  document.querySelectorAll('#adj-slides button').forEach((b, i) => { const [t, ax, sg] = names[i]; b.textContent = t; b.dataset.ax = ax; b.dataset.sg = sg;
    b.title = world ? `Slide ${t.replace(/[←→↑↓] ?| ?[←→↑↓]/g, '').toLowerCase()} until it touches ${op.fixed.name}` : `Slide along ${t.split(' ')[0]} of the joint until it touches ${op.fixed.name}`; });
  if (op.result) {
    const d = op.result.childPoint.distanceTo(op.result.parentPoint);
    $('adj-pivot-note').textContent = d < 1e-3 ? 'Both points meet, so either gives the same pivot.' : `The points are ${d.toFixed(3)} mm apart.`;
  }
  const fit = $('adj-fit');
  if (op.mode === 'MID' && op.result) {
    const { widthA: wA, widthB: wB } = op.result, side = (wB - wA) / 2;
    fit.hidden = false; fit.className = 'fit ' + (side >= 0 ? 'ok' : 'bad');
    fit.textContent = `Part ${wA.toFixed(3)} mm in gap ${wB.toFixed(3)} mm\n`;
    fit.textContent += side >= 0 ? `${side.toFixed(3)} mm clearance each side` : `${(-side).toFixed(3)} mm too wide each side`;
    fit.style.whiteSpace = 'pre-line';
  } else if (op.mode === 'PLANE' && op.p.seat !== false && op.seat) {
    const st = op.seat.info; fit.hidden = false; fit.className = 'fit ' + (st.contact > 0.5 ? 'ok' : 'bad'); fit.style.whiteSpace = 'pre-line';
    fit.textContent = `Seated: ${seatSummary(st)}` + (op.p.spin ? `\nSpin is on top of the seated turn.` : '');
  } else if (isMatch && op.match.results.length) {
    const r = op.match.results[op.match.chosen], v = matchVerdict(r);
    fit.hidden = false; fit.className = 'fit ' + (v.good ? 'ok' : 'bad'); fit.style.whiteSpace = 'pre-line';
    fit.textContent = v.text[0].toUpperCase() + v.text.slice(1) + (r.slides ? '\nThese flat faces differ in size, so the shapes can\'t say exactly where it sits. Slide it into place with Move.' : '');
  } else fit.hidden = true;
}
function bindAdjust() {
  const upd = () => { if (!lastOp) return;
    lastOp.p.spin = +$('adj-spin').value; lastOp.p.gap = +$('adj-gap').value || 0;
    lastOp.p.flip = $('adj-flip').checked; lastOp.p.across = $('adj-across').checked; rerunLast(); showAdjust(); };
  $('adj-spin').addEventListener('input', () => { $('adj-spin-n').value = $('adj-spin').value; upd(); });
  $('adj-spin-n').addEventListener('change', () => { $('adj-spin').value = $('adj-spin-n').value; upd(); });
  ['adj-gap', 'adj-across'].forEach(id => $(id).addEventListener('input', upd));
  // these may need a fresh seat, which takes a moment: let the message paint first
  const slow = fn => () => { if (!lastOp) return; if (lastOp.mode === 'PLANE' && lastOp.p.seat !== false) { toast('Fitting the parts together…'); setTimeout(fn, 30); } else fn(); };
  $('adj-flip').addEventListener('input', slow(upd));
  $('adj-seat').addEventListener('change', slow(() => { lastOp.p.seat = lastSeat = $('adj-seat').checked; rerunLast(); showAdjust(); if (lastOp.p.seat && lastOp.seat) toast(`Seated: ${seatSummary(lastOp.seat.info)}`, 'ok'); }));
  document.querySelectorAll('#adj-centre button').forEach(b => b.addEventListener('click', () => {
    if (!lastOp) return; slow(() => { lastOp.p.centre = lastCentre = b.dataset.v; rerunLast(); showAdjust(); flashCentres(); })(); }));
  document.querySelectorAll('#adj-parent button').forEach(b => b.addEventListener('click', () => {
    if (!lastOp) return; lastOp.p.attach = lastAttach = b.dataset.v; rerunLast(); showAdjust(); }));
  $('adjust-head').addEventListener('click', () => { $('adjust-body').hidden = !$('adjust-body').hidden; });
  $('adj-search').addEventListener('click', searchAllFaces);

  // nudges
  const box = $('adj-nudges');
  ['x', 'y', 'z'].forEach((k, i) => {
    const ax = document.createElement('span'); ax.className = 'ax ' + k; ax.textContent = k.toUpperCase();
    const minus = document.createElement('button'); minus.type = 'button'; minus.className = 'btn'; minus.textContent = '−'; minus.setAttribute('aria-label', `Move ${k.toUpperCase()} down one step`);
    const num = document.createElement('input'); num.type = 'number'; num.step = 'any'; num.className = 'num'; num.id = 'adj-off-' + k; num.value = '0.000'; num.setAttribute('aria-label', `${k.toUpperCase()} offset in mm`);
    const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'btn'; plus.textContent = '+'; plus.setAttribute('aria-label', `Move ${k.toUpperCase()} up one step`);
    const bump = sgn => { if (!lastOp) return; lastOp.p.offset[i] = +((lastOp.p.offset[i] || 0) + sgn * +$('adj-step').value).toFixed(6); rerunLast(); showAdjust(); };
    minus.addEventListener('click', () => bump(-1)); plus.addEventListener('click', () => bump(1));
    num.addEventListener('change', () => { if (!lastOp) return; lastOp.p.offset[i] = +num.value || 0; rerunLast(); showAdjust(); });
    box.append(ax, minus, num, plus);
  });
  // world/joint axes: keep the part where it is, re-express the offset
  document.querySelectorAll('#adj-frame button').forEach(b => b.addEventListener('click', () => {
    if (!lastOp || lastOp.p.frame === b.dataset.v) return;
    const w = offsetWorld(lastOp);
    lastOp.p.frame = lastFrame = b.dataset.v;
    if (b.dataset.v === 'joint') { const { X, Y, Z } = opBasis(lastOp); lastOp.p.offset = [w.dot(X), w.dot(Y), w.dot(Z)]; }
    else lastOp.p.offset = [w.x, w.y, w.z];
    showAdjust();
  }));
  // slide until touching
  const slides = $('adj-slides');
  for (let i = 0; i < 6; i++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn';
    b.addEventListener('click', () => {
      const op = lastOp; if (!op) return;
      const ax = +b.dataset.ax, sg = +b.dataset.sg;
      const unit = op.p.frame === 'joint' ? Object.values(opBasis(op))[ax].multiplyScalar(sg) : V(...[0, 1, 2].map(k => (k === ax ? sg : 0)));
      toast('Finding contact…');
      setTimeout(() => {
        const res = slideToContact(op.child, op.fixed, unit);
        if (res.dist === Infinity) { toast(res.overlapping ? `Can't back ${op.child.name} out that way.` : `Nothing of ${op.fixed.name} lies that way.`, 'bad'); return; }
        if (res.dist < 1e-4) { toast(`Already touching ${op.fixed.name} that way.`); return; }
        op.p.offset[ax] = +((op.p.offset[ax] || 0) + sg * res.dist).toFixed(6);
        rerunLast(); showAdjust();
        toast(res.overlapping ? `Backed out ${res.dist.toFixed(3)} mm: now just touching.` : `Slid ${res.dist.toFixed(3)} mm: now touching.`, 'ok');
      }, 20);
    });
    slides.append(b);
  }
  // pivot host
  document.querySelectorAll('#adj-pivot button').forEach(b => b.addEventListener('click', () => {
    if (!lastOp) return; lastOp.p.pivot = lastPivot = b.dataset.v; rerunLast(); showAdjust(); flashPivot(); }));
  // swap roles: the other part moves and becomes the child
  $('adj-swap').addEventListener('click', () => {
    const op = lastOp; if (!op) return;
    if (op.match?.targets) { toast(`${op.child.name} was fitted against ${op.match.targets.length} parts, so it can't swap roles with one of them.`, 'bad'); return; }
    restore(op.before);
    Object.assign(op, { child: op.fixed, fixed: op.child, a: op.b, b: op.a });
    op.p.offset = [0, 0, 0]; op.p.spin = 0;
    if (op.mode === 'MATCH') {
      const m = op.match; Object.assign(m, { regionA: m.regionB, regionB: m.regionA, Ma: m.Mb, Mb: m.Ma, results: [], chosen: 0 });
      startMatch(op); return;
    }
    if (runOp(op)) { select(op.child); showAdjust(); toast(`Swapped: ${op.child.name} now moves and attaches to ${op.fixed.name}.`, 'ok'); }
  });
}
function flashPivot() {
  if (!lastOp?.result) return; clearFx();
  showMarker(lastOp.result.parentPoint, '#e2804f', 1.2); showMarker(lastOp.result.childPoint, '#4db4dc', 1.2);
  showMarker(lastOp.result.joint, '#d6a24a', 1.8);
  clearTimeout(flashCentres.t); flashCentres.t = setTimeout(clearFx, 1400);
}

// ---------------------------------------------------------------------------
// Selection, gizmos, outliner, part panel
// ---------------------------------------------------------------------------
const isSel = m => selection.includes(m);
function paintSelection() { liveParts().forEach(m => m.material.emissive.set(m === selected ? '#4a3510' : isSel(m) ? '#2a1f09' : '#000000')); }
/** mode: 'replace' (plain click), 'toggle' (Ctrl-click), 'add' */
function select(mesh, mode = 'replace') {
  if (benchSel) { benchSel = null; benchMark.visible = false; }
  const m = mesh && mesh.parent ? mesh : null;
  if (mode === 'replace') selection = m ? [m] : [];
  else if (m && mode === 'toggle') selection = isSel(m) ? selection.filter(x => x !== m) : [...selection, m];
  else if (m && mode === 'add' && !isSel(m)) selection = [...selection, m];
  selected = m && isSel(m) ? m : selection[selection.length - 1] || null;
  paintSelection(); syncGizmo(); renderOutliner(); renderPartPanel(); renderOptions(); updateButtons();
}
function selectMany(list, add = false) {
  selection = add ? [...new Set([...selection, ...list])] : [...new Set(list)];
  selected = selection[selection.length - 1] || null;
  paintSelection(); syncGizmo(); renderOutliner(); renderPartPanel(); renderOptions(); updateButtons();
}
/** Selected parts that aren't inside another selected part's attachments (those move with it anyway). */
function selectionRoots() { return selection.filter(m => m.parent && !selection.some(o => o !== m && isDescendant(m, o))); }
let gizmoBase = null;
function syncGizmo() {
  tc.detach(); tc.showX = tc.showY = tc.showZ = true;
  if (benchSel && ['move', 'rotate'].includes(tool)) {
    const o = benchObj(); if (!o) return;
    const c = new THREE.Box3().setFromObject(o).getCenter(V());
    proxy.position.copy(c); proxy.quaternion.identity(); proxy.scale.set(1, 1, 1); proxy.updateMatrixWorld(true);
    const turn = tool === 'rotate' && benchSel.kind !== 'sprue';
    tc.setMode(turn ? 'rotate' : 'translate'); tc.setSpace('world');
    if (turn) { tc.showX = tc.showY = false; }                 // a box on the mat only turns about the up axis
    tc.attach(proxy); return;
  }
  if (!selected || !['move', 'rotate'].includes(tool)) { linkAsk.gizmoFor = null; if (linkAsk.soft) closeLinkAsk(null); }
  if (!selected || !['move', 'rotate', 'pose'].includes(tool)) return;      // only these tools have a gizmo
  if (tool === 'pose') {
    const j = jointOf(selected);
    if (!j) { toast(`${selected.name} has no joint yet. Snap it onto a parent first.`); return; }
    tc.setMode('rotate'); tc.setSpace('local'); tc.attach(j); return;
  }
  const c = sceneBox(selection.length ? selection : [selected]).getCenter(V());
  proxy.position.copy(c); proxy.quaternion.identity(); proxy.scale.set(1, 1, 1); proxy.updateMatrixWorld(true);
  tc.setMode(tool === 'move' ? 'translate' : 'rotate'); tc.setSpace('world'); tc.attach(proxy);
  gizmoLinkAsk();
}
/** The gizmo just landed on a part that hangs off another: offer to bring its group (once per pick of that part). */
function gizmoLinkAsk() {
  const part = selected;
  if (linkAsk.gizmoFor === part) return;
  linkAsk.gizmoFor = part;
  if (linkAsk.soft) closeLinkAsk(null);
  if (selection.length > 1 || !parentPart(part)) return;
  const pref = $('set-linkmove').value;
  if (pref === 'group') { makeBase(part); return; }
  if (pref !== 'ask') return;
  askLink(part, tool === 'move' ? 'Move' : 'Turn').then(a => { if (a === 'group' && part.parent && selected === part) makeBase(part); });
  linkAsk.soft = true;
}
tc.addEventListener('mouseDown', () => {
  if (linkAsk.soft && linkAsk.resolve) closeLinkAsk('alone');        // dragged without answering: just this part
  lastOp = null; $('adjust').hidden = true; showFit();
  pushUndo();
  if (tc.object === proxy && benchSel) {
    const o = benchObj(); if (!o) return; o.updateMatrixWorld(true);
    const items = benchSel.kind === 'sprue' ? piecesOn(benchSel.k).map(m => { m.updateMatrixWorld(true); return { m, W0: m.matrixWorld.clone() }; }) : [];
    gizmoBase = { M0inv: proxy.matrixWorld.clone().invert(), items, bench: { o, W0: o.matrixWorld.clone(), sel: { ...benchSel } } };
    return;
  }
  if (tc.object === proxy && selected) {
    const items = (selection.length ? selectionRoots() : [selected]).map(m => { m.updateMatrixWorld(true); return { m, W0: m.matrixWorld.clone() }; });
    gizmoBase = { M0inv: proxy.matrixWorld.clone().invert(), items };
  }
});
tc.addEventListener('objectChange', () => {
  if (tc.object !== proxy && magnets.length) rebuildMagnets();       // posing a joint carries its magnets
  if (tc.object === proxy && gizmoBase) {
    proxy.updateMatrixWorld(true);
    const D = proxy.matrixWorld.clone().multiply(gizmoBase.M0inv);          // the same move for every selected part
    for (const it of gizmoBase.items) setWorld(it.m, D.clone().multiply(it.W0));
    if (magnets.length) rebuildMagnets();             // the hole previews ride along
    if (gizmoBase.bench) { setWorld(gizmoBase.bench.o, D.clone().multiply(gizmoBase.bench.W0)); markBench(); }
  }
});
tc.addEventListener('mouseUp', () => {
  const bb = gizmoBase?.bench;
  if (bb) {                                           // keep where the box, booklet or sprue was put
    const o = bb.o;
    if (bb.sel.kind === 'box') { kit.at = o.position.toArray(); kit.rot = o.rotation.z; }
    else if (bb.sel.kind === 'book') { kit.bookAt = o.position.toArray(); kit.bookRot = o.rotation.z; }
    else if (sprues?.frames[bb.sel.k]) { shiftSprue(bb.sel.k, o.position.clone()); }
  }
  gizmoBase = null; renderPartPanel(); markDirty(); if (sprues) rebuildSprues();
  if (bb) syncGizmo();
});

const eyeOpen = '<svg viewBox="0 0 16 16"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const eyeShut = '<svg viewBox="0 0 16 16"><path d="M2 10c1.5 1.5 3.5 2.5 6 2.5s4.5-1 6-2.5M3.5 11.5l-1 1.5M12.5 11.5l1 1.5M8 12.5V14"/></svg>';
function renderOutliner() {
  const box = $('outliner'); box.innerHTML = '';
  const roots = liveParts().filter(p => !parentPart(p));
  $('part-count').textContent = liveParts().length ? `${liveParts().length} parts` : '';
  if (!roots.length) { box.innerHTML = '<div class="empty">No parts yet. Import STL files or load the sample kit.</div>'; return; }
  const kids = p => liveParts().filter(c => parentPart(c) === p);
  const row = (p, depth) => {
    const sl = slotOf(p);
    const r = document.createElement('div'); r.className = 'orow' + (p.userData.optOff ? ' opt-off' : p.visible ? '' : ' hidden-part');
    r.setAttribute('role', 'treeitem'); r.setAttribute('aria-selected', isSel(p) ? 'true' : 'false'); if (p === selected) r.classList.add('active');
    r.style.paddingLeft = (12 + depth * 14) + 'px';
    const link = document.createElement('span'); link.className = 'link';
    link.textContent = depth ? (jointOf(p) ? '◆' : '└') : ''; link.title = jointOf(p) ? 'Jointed (pose with P)' : 'Fixed to parent';
    const sw = document.createElement('span'); sw.className = 'sw'; sw.style.background = baseColor(p);
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = p.name;
    const eye = document.createElement('button'); eye.className = 'eye'; eye.type = 'button'; eye.title = p.visible ? 'Hide' : 'Show';
    eye.innerHTML = p.visible ? eyeOpen : eyeShut;
    eye.addEventListener('click', e => { e.stopPropagation();
      if (p.userData.optOff && sl) { chooseOption(sl, p.uuid); return; }        // showing a hidden option makes it the choice
      p.visible = !p.visible; renderOutliner(); markDirty(); if (sprues) rebuildSprues(); });
    if (sl) { eye.title = p.userData.optOff ? `Show this option of ${sl.name}` : eye.title; }
    r.append(link, sw, nm);
    if (boxed(p)) { r.classList.add('in-box'); const tg = document.createElement('span'); tg.className = 'opt-tag'; tg.textContent = 'in box'; tg.title = 'Still sealed in the kit box. Click to open the box.'; r.append(tg); }
    if (sl) { const tg = document.createElement('span'); tg.className = 'opt-tag'; tg.textContent = `${sl.name} ${sl.members.indexOf(p.uuid) + 1}/${sl.members.length}`; tg.title = p.userData.optOff ? 'An option that isn\'t chosen' : 'The chosen option'; r.append(tg); }
    r.append(eye);
    r.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) return select(p, 'toggle');
      if (e.shiftKey && selected) {             // a range, in outliner order
        const order = [...box.querySelectorAll('.orow')].map(x => x._part), a = order.indexOf(selected), z = order.indexOf(p);
        if (a >= 0 && z >= 0) { const range = order.slice(Math.min(a, z), Math.max(a, z) + 1); selectMany(range); select(p, 'add'); return; }
      }
      if (boxed(p)) openBox();                  // it's still in the box: unwrap it first
      select(p);
    });
    r._part = p;
    box.append(r);
    kids(p).forEach(k => row(k, depth + 1));
  };
  roots.forEach(p => row(p, 0));
}
function renderPartPanel() {
  const el = $('part-panel'); el.innerHTML = '';
  if (benchSel) return renderBenchPanel(el);
  if (!selected) { el.innerHTML = '<p class="note">Select a part to see its size and attachments. Ctrl-click or Ctrl-drag to select several.</p>'; return; }
  if (selection.length > 1) return renderMultiPanel(el);
  const p = selected, size = exactBox(p).getSize(V()), par = parentPart(p), j = jointOf(p);
  const name = document.createElement('input'); name.className = 'name-input'; name.id = 'part-name'; name.value = p.name; name.setAttribute('aria-label', 'Part name');
  name.addEventListener('change', () => { pushUndo(); p.name = name.value.trim() || p.name; renderOutliner(); markDirty(); });
  const dl = document.createElement('dl'); dl.className = 'props';
  const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
  add('Size', `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} mm`);
  add('Triangles', p.userData.part.tris.toLocaleString());
  add('Attached to', par ? `${par.name} (${j ? 'joint' : 'fixed'})` : '—');
  add('Carries', subtreeParts(p).length - 1 + ' parts');
  if (p.userData.part.paint || p.userData.part.fill) add('Paint', [p.userData.part.fill ? 'filled ' + p.userData.part.fill : '', p.userData.part.paint ? 'brushed' : ''].filter(Boolean).join(', '));
  { const sl = slotOf(p); if (sl) add('Option', `${sl.name}: ${sl.members.indexOf(p.uuid) + 1} of ${sl.members.length}${p.userData.optOff ? ' (not chosen)' : ' (chosen)'}`); }
  const row = document.createElement('div'); row.className = 'btnrow';
  const b = (txt, fn, dis) => { const x = document.createElement('button'); x.className = 'btn'; x.type = 'button'; x.textContent = txt; x.disabled = !!dis; x.addEventListener('click', fn); row.append(x); };
  b('Reset pose', () => { pushUndo(); j.quaternion.copy(j.userData.joint.rest); afterHierarchyChange(); }, !j);
  b('Detach', () => { pushUndo(); detach(p); afterHierarchyChange(); }, !par);
  if (par) {     // turn the link round: the parent hangs off this part instead
    const swap = !parentPart(par);
    b(swap ? `Swap with ${par.name}` : 'Make base', () => {
      const old = par, base = rootOf(p); if (makeBase(p, true)) toast(swap ? `Swapped: ${old.name} now hangs off ${p.name}.` : `${p.name} is now the base. The links up to ${base.name} turned round.`, 'ok');
    }, !!rerootCheck(p));
    row.lastChild.title = rerootCheck(p) || (swap ? `Make ${p.name} the parent and ${par.name} its child. Nothing moves.` : `Make ${p.name} the base: every link between it and the current base turns round. Nothing moves.`);
  }
  b('Mirror', () => { pushUndo(); const c = worldBox(p).getCenter(V());
    applyWorld(p, Tr(c).multiply(new THREE.Matrix4().makeScale(-1, 1, 1)).multiply(Tr(c.clone().negate()))); afterHierarchyChange(); });
  b('Drop to grid', () => { pushUndo(); applyWorld(p, Tr(V(0, 0, -lowestZ([p])))); afterHierarchyChange(); });
  b('Square up', () => openOrient(p, { kind: 'auto' }));
  if (p.userData.part.paint || p.userData.part.fill) b('Clear paint', () => { clearPaint([p]); toast(`Cleared the paint on ${p.name}.`); });
  b('Delete', () => deleteSelected());
  el.append(name, dl, row);
  magnetRows(p, el);
}
function renderMultiPanel(el) {
  const list = selection, roots = selectionRoots(), box = new THREE.Box3(); list.forEach(m => box.union(exactBox(m)));
  const size = box.getSize(V()), tris = list.reduce((a, m) => a + m.userData.part.tris, 0);
  const head = document.createElement('div'); head.className = 'multi-head'; head.textContent = `${list.length} parts selected`;
  const sm = document.createElement('small'); sm.textContent = `Active (last picked): ${selected.name}. Move and Rotate turn them together.`; head.append(sm);
  const dl = document.createElement('dl'); dl.className = 'props';
  const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
  add('Together', `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} mm`);
  add('Triangles', tris.toLocaleString());
  const row = document.createElement('div'); row.className = 'btnrow';
  const b = (txt, fn, dis, title) => { const x = document.createElement('button'); x.className = 'btn'; x.type = 'button'; x.textContent = txt; x.disabled = !!dis; if (title) x.title = title; x.addEventListener('click', fn); row.append(x); };
  const others = list.filter(m => m !== selected);
  b(`Attach to ${selected.name}`, () => {
    pushUndo(); let n = 0;
    for (const m of others) if (!isDescendant(selected, m) && parentPart(m) !== selected) { attach(m, selected, 'plain'); n++; }
    afterHierarchyChange(); toast(n ? `Attached ${n} part${n > 1 ? 's' : ''} to ${selected.name}.` : 'Nothing to attach.', n ? 'ok' : '');
  }, !others.length, 'The others follow the active part (fixed, no joint)');
  b('Detach', () => { pushUndo(); list.filter(m => parentPart(m)).forEach(m => detach(m)); afterHierarchyChange(); }, !list.some(m => parentPart(m)));
  b('Drop to grid', () => { pushUndo(); const dz = -lowestZ(list); roots.forEach(m => applyWorld(m, Tr(V(0, 0, dz)))); afterHierarchyChange(); }, false, 'Lowers them together until the lowest touches the grid');
  b('Square up together', () => openOrient(selected, { kind: 'auto' }));
  const allShown = list.every(m => m.visible);
  b(allShown ? 'Hide' : 'Show', () => { list.forEach(m => { m.visible = !allShown; }); renderOutliner(); renderPartPanel(); markDirty(); });
  b('Delete', () => deleteSelected());
  el.append(head, dl, row);
}
function deleteSelected() {
  const list = selection.length ? [...selection] : selected ? [selected] : [];
  if (!list.length) return;
  pushUndo(); lastOp = null;
  select(null);
  for (const p of list) {
    // children that aren't being deleted keep their place: hand them to the world
    liveParts().filter(c => parentPart(c) === p && !list.includes(c)).forEach(c => detach(c));
    detach(p); world.remove(p);
  }
  afterHierarchyChange();
  if (list.length > 1) toast(`Deleted ${list.length} parts.`);
}
function afterHierarchyChange() {
  scene.updateMatrixWorld(true);
  markDirty();
  if (typeof seamFx !== 'undefined' && seamFx.children.length) clearSeamPreview();
  if (typeof pocketFx !== 'undefined' && pocketFx.children.length) clearPocketPreview();      // the parts moved: the pockets may have too
  if (typeof renderFolderStatus === 'function') renderFolderStatus();
  selection = selection.filter(m => m.parent);
  if (selected && !selected.parent) selected = selection[selection.length - 1] || null;
  paintSelection();
  renderOutliner(); renderPartPanel(); renderOptions(); rebuildSprues(); rebuildMagnets(); showAdjust(); updateButtons(); updateStats(); syncGizmo();
}
// ---------------------------------------------------------------------------
// Options: interchangeable parts for one spot (heads, weapons…), sets of choices, export per set
// ---------------------------------------------------------------------------
let options = { slots: [], sets: [] };
const partById = id => parts.find(p => p.uuid === id && p.parent) || null;
const uid = () => THREE.MathUtils.generateUUID().slice(0, 8);
function slotOf(part) { return options.slots.find(sl => sl.members.includes(part.uuid)) || null; }
function slotMembers(sl) { return sl.members.map(partById).filter(Boolean); }
function tidyOptions() {                                      // drop deleted parts and empty slots
  for (const sl of options.slots) { sl.members = sl.members.filter(id => partById(id)); if (!sl.members.includes(sl.active)) sl.active = sl.members[0] || null; }
  options.slots = options.slots.filter(sl => sl.members.length);
}
/** Show only the chosen part of each slot (the others are hidden, and their joint stays shared). */
function applyOptions() {
  tidyOptions();
  for (const sl of options.slots) for (const m of slotMembers(sl)) {
    const on = m.uuid === sl.active;
    if (!on) { m.userData.optOff = true; m.visible = false; }
    else if (m.userData.optOff) { m.userData.optOff = false; m.visible = true; }
  }
  for (const m of liveParts()) if (m.userData.optOff && !slotOf(m)) { m.userData.optOff = false; m.visible = true; }
}
/** Hang every option of a slot off the same joint (or the same parent) as the one that's attached. */
function shareSlotJoint(sl, prefer) {
  const ms = slotMembers(sl); if (ms.length < 2) return 0;
  const anchor = (prefer && parentPart(prefer) && ms.includes(prefer)) ? prefer : ms.find(m => jointOf(m)) || ms.find(m => parentPart(m));
  if (!anchor) return 0;
  const host = jointOf(anchor) || anchor.parent; let n = 0;
  for (const m of ms) {
    if (m === anchor || m.parent === host) continue;
    if (isDescendant(host, m)) continue;                       // never hang a part off its own child
    const old = jointOf(m); host.attach(m);
    if (old && !old.children.some(isPart) && old.parent) old.parent.remove(old);
    n++;
  }
  return n;
}
function commonName(names) {
  if (!names.length) return 'Option';
  let pre = names[0]; for (const n of names) while (pre && !n.startsWith(pre)) pre = pre.slice(0, -1);
  pre = pre.replace(/[\s_\-.(]+$/, '').trim();
  return pre.length >= 3 ? pre : `Slot ${options.slots.length + 1}`;
}
function makeSlot() {
  const list = selection.length ? [...selection] : selected ? [selected] : [];
  if (!list.length) { toast('Select the parts that can swap for each other first (Ctrl-click to pick several).', 'bad'); return; }
  pushUndo();
  // a part can only be in one slot: move it
  for (const sl of options.slots) sl.members = sl.members.filter(id => !list.some(m => m.uuid === id));
  const sl = { id: uid(), name: commonName(list.map(m => m.name)), members: list.map(m => m.uuid), active: (selected && list.includes(selected) ? selected : list[0]).uuid };
  options.slots.push(sl);
  const n = shareSlotJoint(sl);
  applyOptions(); afterHierarchyChange();
  setTimeout(() => { const el = document.querySelector('#opt-slots .opt-slot:last-child input'); if (el) { el.focus(); el.select(); } }, 0);   // name it straight away
  toast(`Made the "${sl.name}" slot with ${list.length} option${list.length > 1 ? 's' : ''}.` + (n ? ` ${n} now share${n === 1 ? 's' : ''} the same joint.` : !list.some(m => parentPart(m)) ? ' Snap one of them where it goes and the others will hang off the same joint.' : ''), 'ok');
}
function addToSlot(sl) {
  const list = (selection.length ? selection : selected ? [selected] : []).filter(m => !sl.members.includes(m.uuid));
  if (!list.length) { toast('Select the parts to add to this slot first.', 'bad'); return; }
  pushUndo();
  for (const o of options.slots) o.members = o.members.filter(id => !list.some(m => m.uuid === id));
  sl.members.push(...list.map(m => m.uuid));
  const n = shareSlotJoint(sl);
  applyOptions(); afterHierarchyChange();
  toast(`Added ${list.length} to "${sl.name}".` + (n ? ' They share its joint.' : ''), 'ok');
}
function chooseOption(sl, id) { if (sl.active === id) return; sl.active = id; applyOptions(); afterHierarchyChange(); }
const currentPick = () => Object.fromEntries(options.slots.map(sl => [sl.id, sl.active]));
function applyPick(pick) { for (const sl of options.slots) if (pick[sl.id] && sl.members.includes(pick[sl.id])) sl.active = pick[sl.id]; applyOptions(); }
const pickLabel = pick => options.slots.map(sl => partById(pick[sl.id] || sl.active)?.name).filter(Boolean).join(' · ');
const samePick = (a, b) => options.slots.every(sl => (a[sl.id] || sl.active) === (b[sl.id] || sl.active));

function renderOptions() {
  tidyOptions();
  const box = $('opt-slots'); box.innerHTML = '';
  const nS = options.slots.length;
  $('opt-count').textContent = nS ? `${nS} slot${nS > 1 ? 's' : ''}${options.sets.length ? ` · ${options.sets.length} set${options.sets.length > 1 ? 's' : ''}` : ''}` : '';
  const selN = selection.length || (selected ? 1 : 0);
  $('opt-new').disabled = !selN;
  $('opt-new').textContent = selN > 1 ? `Make option slot from ${selN} selected` : 'Make option slot from selection';
  for (const sl of options.slots) {
    const el = document.createElement('div'); el.className = 'opt-slot';
    const head = document.createElement('div'); head.className = 'opt-slot-head';
    const nm = document.createElement('input'); nm.value = sl.name; nm.setAttribute('aria-label', 'Slot name');
    nm.addEventListener('change', () => { sl.name = nm.value.trim() || sl.name; renderOptions(); markDirty(); });
    const add = document.createElement('button'); add.className = 'mini'; add.type = 'button'; add.textContent = '+ add selected'; add.title = 'Add the selected parts to this slot';
    add.addEventListener('click', () => addToSlot(sl));
    const del = document.createElement('button'); del.className = 'mini'; del.type = 'button'; del.textContent = '✕'; del.title = 'Remove this slot (the parts stay, all shown)';
    del.addEventListener('click', () => { pushUndo(); options.slots = options.slots.filter(o => o !== sl); slotMembers(sl).forEach(m => { m.userData.optOff = false; m.visible = true; }); applyOptions(); afterHierarchyChange(); });
    head.append(nm, add, del);
    const chips = document.createElement('div'); chips.className = 'opt-chips'; chips.setAttribute('role', 'radiogroup'); chips.setAttribute('aria-label', sl.name);
    for (const m of slotMembers(sl)) {
      const c = document.createElement('div'); c.className = 'opt-chip'; c.setAttribute('role', 'radio'); c.tabIndex = 0;
      c.setAttribute('aria-pressed', m.uuid === sl.active ? 'true' : 'false'); c.setAttribute('aria-checked', m.uuid === sl.active ? 'true' : 'false');
      const t = document.createElement('span'); t.textContent = m.name; c.title = `Show ${m.name}`;
      const x = document.createElement('button'); x.className = 'x'; x.type = 'button'; x.textContent = '×'; x.title = `Take ${m.name} out of this slot`;
      x.addEventListener('click', e => { e.stopPropagation(); pushUndo(); sl.members = sl.members.filter(id => id !== m.uuid); m.userData.optOff = false; m.visible = true; applyOptions(); afterHierarchyChange(); });
      c.addEventListener('click', () => chooseOption(sl, m.uuid));
      c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseOption(sl, m.uuid); } });
      c.append(t, x); chips.append(c);
    }
    const ms = slotMembers(sl), hosts = new Set(ms.map(m => jointOf(m) || (parentPart(m) ? m.parent : null)));
    const meta = document.createElement('div'); meta.className = 'opt-meta';
    const par = ms.map(parentPart).find(Boolean);
    meta.textContent = !par ? 'Not attached yet. Snap one option where it goes; the rest follow onto the same joint.'
      : hosts.size === 1 && !hosts.has(null) ? `All ${ms.length} on ${jointOf(ms[0]) ? 'one joint' : 'the same spot'} of ${par.name}.`
      : `Some options aren't on the shared joint of ${par.name}. Snap them, or remove and re-add them.`;
    el.append(head, chips, meta); box.append(el);
  }
  $('opt-sets-f').hidden = !nS;
  const sb = $('opt-sets'); sb.innerHTML = '';
  const cur = currentPick();
  for (const st of options.sets) {
    const r = document.createElement('div'); r.className = 'opt-set' + (samePick(st.pick, cur) ? ' current' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st.export !== false; cb.setAttribute('aria-label', `Export ${st.name}`);
    cb.addEventListener('change', () => { st.export = cb.checked; renderOptions(); markDirty(); });
    const sn = document.createElement('div'); sn.className = 'sn';
    const b = document.createElement('b'); b.textContent = st.name; b.title = 'Double-click to rename';
    b.addEventListener('dblclick', () => { const v = prompt('Set name', st.name); if (v && v.trim()) { st.name = v.trim(); renderOptions(); markDirty(); } });
    const sm = document.createElement('small'); sm.textContent = pickLabel(st.pick); sn.append(b, sm);
    const show = document.createElement('button'); show.className = 'btn'; show.type = 'button'; show.textContent = 'Show';
    show.addEventListener('click', () => { applyPick(st.pick); afterHierarchyChange(); toast(`Showing ${st.name}.`); });
    const del = document.createElement('button'); del.className = 'mini'; del.type = 'button'; del.textContent = '✕'; del.title = 'Delete this set';
    del.addEventListener('click', () => { options.sets = options.sets.filter(o => o !== st); renderOptions(); markDirty(); });
    r.append(cb, sn, show, del); sb.append(r);
  }
  const ticked = options.sets.filter(st => st.export !== false).length;
  $('opt-exp-sets').disabled = !ticked;
  $('opt-exp-sets').textContent = ticked ? `Export ${ticked} ticked set${ticked > 1 ? 's' : ''}` : 'Export ticked sets';
  const combos = options.slots.reduce((a, sl) => a * Math.max(1, sl.members.length), 1);
  $('opt-exp-all').textContent = `Every combination (${combos})`; $('opt-exp-all').disabled = combos > 64;
  $('opt-exp-all').title = combos > 64 ? 'More than 64 combinations: save the sets you want instead' : 'One STL for every mix of options';
}
/** Export one STL per pick. Puts the current choice back afterwards. */
async function exportPicks(list) {
  if (!list.length) return;
  const keep = currentPick(), files = [], notes = [];
  try {
    for (const [k, { name, pick }] of list.entries()) {
      toast(`Building ${k + 1} of ${list.length}: ${name}…`); await nextFrame();
      applyPick(pick); const ms = exportMeshes(); if (!ms.length) continue;
      const { data, note } = await oneSTL(ms); if (note) notes.push(`${name}: ${note}`);
      let fn = safe(name) + '.stl', i = 2; while (files.some(f => f.name === fn)) fn = `${safe(name)} (${i++}).stl`;
      files.push({ name: fn, data });
    }
  } finally { applyPick(keep); afterHierarchyChange(); }
  if (notes.length) $('exp-note').textContent = notes.slice(0, 3).join(' ');
  await deliver(files, `${safe(project.name || 'kit')}-sets.zip`);
}
function bindOptions() {
  $('opt-new').addEventListener('click', () => { showDockTab('tab-opts'); makeSlot(); });
  $('opt-save-set').addEventListener('click', () => {
    const pick = currentPick(), same = options.sets.find(st => samePick(st.pick, pick));
    if (same) { toast(`That's already saved as "${same.name}".`); return; }
    options.sets.push({ id: uid(), name: `Set ${options.sets.length + 1}`, pick, export: true });
    renderOptions(); markDirty(); toast(`Saved "Set ${options.sets.length}": ${pickLabel(pick)}. Double-click its name to rename.`, 'ok');
  });
  $('opt-exp-sets').addEventListener('click', () => exportPicks(options.sets.filter(st => st.export !== false).map(st => ({ name: st.name, pick: st.pick }))));
  $('opt-exp-all').addEventListener('click', () => {
    let combos = [{}];
    for (const sl of options.slots) combos = combos.flatMap(c => sl.members.map(id => ({ ...c, [sl.id]: id })));
    exportPicks(combos.map(pick => ({ name: pickLabel(pick), pick })));
  });
}
// ---------------------------------------------------------------------------
// Sprues: loose parts shown still on the plastic, like a new kit; printable as kits too
// ---------------------------------------------------------------------------
let sprues = null;          // { frames: [{ letter, x0, y0, x1, y1, z, runners }], gates: [{ part, frame, a, b, r0, r1 }], poses: { id: matrix }, nums: { id: n }, labels: { id: [x,y,z] } }
const sprueFx = new THREE.Group(); scene.add(sprueFx);
const SPRUE_BAR = 2.6, SPRUE_GAP = 6;
const sprueMat = new THREE.MeshStandardMaterial({ color: '#c9ccce', roughness: 0.5, metalness: 0.0 });
const labelTex = new Map();
function labelSprite(text, size) {
  let tex = labelTex.get(text);
  if (!tex) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = 'rgba(30,34,38,.82)'; g.beginPath(); g.roundRect(4, 4, 120, 56, 14); g.fill();
    g.fillStyle = '#e8e2d4'; g.font = '600 40px "Barlow Semi Condensed", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 34);
    tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; labelTex.set(text, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true })); s.scale.set(size * 2, size, 1); s.renderOrder = 996; return s;
}
/** A name moulded on a tag: dark lettering lying flat on the tag's top. */
function tagText(text, w, h = 3.4) {
  const key = 'flat:' + text; let tex = labelTex.get(key);
  if (!tex) {
    const c = document.createElement('canvas'), px = 48; c.height = Math.round(px * 1.4); c.width = Math.round(c.height * w / h);
    const g = c.getContext('2d'); g.fillStyle = '#4f5559'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = px; g.font = `600 ${fs}px "Barlow Semi Condensed", system-ui, sans-serif`;
    while (g.measureText(text).width > c.width * 0.92 && fs > 10) { fs -= 2; g.font = `600 ${fs}px "Barlow Semi Condensed", system-ui, sans-serif`; }
    g.fillText(text, c.width / 2, c.height / 2 + 2);
    tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; labelTex.set(key, tex);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.renderOrder = 996; return m;
}
/** Is this part still where it was put on the sprue (not moved, snapped or hidden since)? */
function onSprue(m) {
  const P = sprues?.poses[m.uuid]; if (!P || !m.parent || !isVisibleChain(m)) return false;
  m.updateMatrixWorld(true); const e = m.matrixWorld.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(e[i] - P[i]) > 1e-4) return false;
  return true;
}
function indexed(g) { if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i)); return g; }
function sprueMeshes(k) {                               // the plastic of one frame, with gates only to pieces still on it
  const f = sprues.frames[k];
  const gates = sprues.gates.filter(g => g.frame === k && (() => { const m = partById(g.part); return m && onSprue(m); })());
  const g = mergeVertices(sprueGeometry(f, gates, SPRUE_BAR), 1e-4); g.computeVertexNormals();     // smooth, like moulded plastic
  const mesh = new THREE.Mesh(g, sprueMat); mesh.updateMatrixWorld(true); return mesh;
}
function rebuildSprues() {
  while (sprueFx.children.length) { const c = sprueFx.children.pop(); c.traverse(o => { o.geometry?.dispose(); if (o.material && o.material !== sprueMat) o.material.dispose(); }); }
  $('exp-sprue-f').hidden = !sprues;
  if (!sprues) { markBench(); return; }
  const groups = sprues.frames.map((f, k) => {
    const g = new THREE.Group(); g.name = 'sprue-' + f.letter; g.userData.frame = k; sprueFx.add(g);
    g.add(sprueMeshes(k));
    const tag = labelSprite(f.letter, 4.5); tag.position.set(f.x0 + 9, f.y1 + SPRUE_BAR / 2 + 3, f.z + 2); g.add(tag);
    return g;
  });
  const frameOf = {}; for (const gt of sprues.gates) frameOf[gt.part] ??= gt.frame;
  for (const [id, n] of Object.entries(sprues.nums)) {
    const m = partById(id); if (!m || !onSprue(m) || !sprues.labels[id] || groups[frameOf[id]] === undefined) continue;
    const text = sprues.text?.[id] || shortLabel(m.name);
    const lab = tagText(text, Math.min(tagWidth(text), sprues.frames.flatMap(f => f.tags).find(t => Math.abs(t[0] - sprues.labels[id][0]) < 1e-6 && Math.abs(t[1] - sprues.labels[id][1]) < 1e-6)?.[2] || tagWidth(text))); lab.position.fromArray(sprues.labels[id]); groups[frameOf[id]].add(lab);
  }
  applySeal(); markBench();
}
/** Lay a part flat: its biggest faces square to the grid, thinnest way up, longest along X. */
function layFlat(m) {
  const c = exactBox(m).getCenter(V());
  applyWorld(m, rotAbout(squareUpQuat(dominantDirections([m])), c));
  const turn = (axis, ang) => applyWorld(m, rotAbout(new THREE.Quaternion().setFromAxisAngle(axis, ang), exactBox(m).getCenter(V())));
  let s = exactBox(m).getSize(V());
  if (s.x < s.z && s.x <= s.y) turn(V(0, 1, 0), Math.PI / 2); else if (s.y < s.z) turn(V(1, 0, 0), Math.PI / 2);
  s = exactBox(m).getSize(V()); if (s.y > s.x) turn(V(0, 0, 1), Math.PI / 2);
}
/**
 * Put loose parts on sprues: each laid flat in a row on a frame, held by gates from the runners
 * above and below it, numbered like a kit. Parts already on the sprues are laid out again with them.
 */
function layOnSprues(list) {
  const keep = sprues ? liveParts().filter(m => onSprue(m)) : [];
  const ms = [...new Set([...keep, ...list])].filter(m => m.parent === world);
  if (!ms.length) { toast('Only loose parts go on sprues. Detach a part first to put it back on.', 'bad'); return false; }
  toast('Putting the pieces on sprues…');
  ms.forEach(layFlat);
  // keep copies of the same piece together, in name order
  ms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const items = ms.map(m => { const s = exactBox(m).getSize(V()); return { id: m.uuid, w: s.x + 2 * SPRUE_GAP, h: s.y + 2 * SPRUE_GAP }; });
  const frames = packSprues(items, { maxW: 150, maxH: 150 / 1.618 });
  const others = liveParts().filter(p => !ms.includes(p) && !ms.some(m => isDescendant(p, m)));
  const fx0 = others.length ? sceneBox(others).max.x + 25 : 0;
  // frames in a block about as wide as a screen (golden ratio), not one long line
  const spots = goldenPack(frames.map(f => ({ w: f.w + SPRUE_BAR, h: f.h + SPRUE_BAR + 12 })), 18);
  const out = { frames: [], gates: [], poses: {}, nums: {}, labels: {}, text: {} };
  let num = 1; const inv = new THREE.Matrix4(), tg = {};
  frames.forEach((f, k) => {
    const mine = f.places.map(p => ({ p, m: ms.find(m => m.uuid === p.id) }));
    const thick = Math.max(...mine.map(({ m }) => exactBox(m).getSize(V()).z));
    const z = Math.max(SPRUE_BAR * 0.6, thick / 2), ox = fx0 + spots.pos[k].x, oy = spots.h - spots.pos[k].y - (f.h + SPRUE_BAR + 12) - spots.h / 2;
    const fr = { letter: String.fromCharCode(65 + (k % 26)) + (k >= 26 ? Math.floor(k / 26) : ''), x0: ox, y0: oy, x1: ox + f.w, y1: oy + f.h, z,
                 runners: f.rows.slice(1, -1).map(y => oy + y), dividers: [], tags: [] };
    // a runner between neighbouring pieces in a row, so each sits in its own cell
    for (let r = 0; r + 1 < f.rows.length; r++) {
      const row = f.places.filter(p => p.row === r).sort((a, b) => a.x - b.x);
      row.forEach((p, i) => { if (i) fr.dividers.push({ x: ox + p.x, y0: oy + f.rows[r], y1: oy + f.rows[r + 1] }); });
      const last = row[row.length - 1]; if (last && last.x + last.w < f.w - 1) fr.dividers.push({ x: ox + last.x + last.w, y0: oy + f.rows[r], y1: oy + f.rows[r + 1] });
    }
    out.frames.push(fr);
    // number pieces left to right, bottom row first
    mine.sort((a, b) => a.p.row - b.p.row || a.p.x - b.p.x);
    for (const { p, m } of mine) {
      const b = exactBox(m), c = b.getCenter(V()), s = b.getSize(V());
      applyWorld(m, Tr(V(ox + p.x + p.w / 2 - c.x, oy + p.y + p.h / 2 - c.y, z - c.z)));
      m.updateMatrixWorld(true); inv.copy(m.matrixWorld).invert();
      // longer pieces are held in more places: one gate per ~14 mm of length on each side, up to 4
      const cx = ox + p.x + p.w / 2, nG = Math.min(4, Math.max(1, Math.round(s.x / 14))), x0p = cx - s.x / 2;
      const xs = Array.from({ length: nG }, (_, i) => x0p + s.x * (i + 0.5) / nG);
      const cand = [];
      for (const yb of [oy + f.rows[p.row], oy + f.rows[p.row + 1]]) for (const x of xs) {
        const a = V(x, yb, z), h = m.geometry.boundsTree.closestPointToPoint(a.clone().applyMatrix4(inv), tg); if (!h) continue;
        const bpt = h.point.clone().applyMatrix4(m.matrixWorld), d = bpt.clone().sub(a), L = d.length(); if (L < 1e-3) continue;
        cand.push({ part: m.uuid, frame: k, a: a.toArray(), b: bpt.addScaledVector(d, 0.35 / L).toArray(), r0: SPRUE_BAR * 0.46, r1: Math.min(0.7, SPRUE_BAR * 0.26), L, ax: a });
      }
      let use = cand.filter(g => g.L <= SPRUE_GAP * 2.5);
      if (!use.length && cand.length) use = [cand.reduce((x, y) => (y.L < x.L ? y : x))];
      // two gates landing on the same spot of the piece are one too many
      use = use.sort((x, y) => x.L - y.L).filter((g, i, all) => !all.slice(0, i).some(h => V(...h.b).distanceTo(V(...g.b)) < 2.5));
      out.nums[m.uuid] = num++;
      const cyNow = oy + p.y + p.h / 2, text = shortLabel(m.name), tw = Math.min(tagWidth(text), Math.max(5.2, p.w - 2 * SPRUE_BAR - 1));
      // the name tag sits on the runner below the piece, inside its cell, in the widest gap between gates
      const yb = oy + f.rows[p.row], below = use.filter(g => g.ax.y <= cyNow).map(g => g.ax.x).sort((a, b) => a - b);
      const lo = ox + p.x + SPRUE_BAR, hi = ox + p.x + p.w - SPRUE_BAR, stops = [lo - 1.2, ...below, hi + 1.2];
      let best = [lo, hi], bw = -1;
      for (let i = 0; i + 1 < stops.length; i++) { const a = stops[i] + 1.2, b = stops[i + 1] - 1.2; if (b - a > bw) { bw = b - a; best = [a, b]; } }
      let tw2 = tw;
      if (bw < tw && bw >= 7) tw2 = bw;               // squeeze the name a little rather than lose a gate
      const fits = bw >= tw2, tx = fits ? (best[0] + best[1]) / 2 : Math.min(Math.max(cx, lo + tw / 2), hi - tw / 2);
      if (!fits) {                                  // no room between the gates below: the tag takes that stretch, the gates above hold the piece
        const keep = use.filter(g => !(g.ax.y <= cyNow && Math.abs(g.ax.x - tx) < tw / 2 + 1.4));
        if (keep.some(g => g.ax.y > cyNow) || keep.length >= 1) use = keep.length ? keep : use;
      }
      out.gates.push(...use.map(({ L, ax, ...g }) => g));
      const tag = [tx, yb + SPRUE_BAR / 2 + 1.5, fits ? tw2 : tw];
      fr.tags.push(tag);
      out.labels[m.uuid] = [tag[0], tag[1], z + SPRUE_BAR * 0.28 + 0.02];
      out.text[m.uuid] = text;
      out.poses[m.uuid] = m.matrixWorld.toArray();
    }
  });
  // centre the whole lot when nothing else is on the bench
  if (!others.length) {
    const dx = -(Math.min(...out.frames.map(f => f.x0)) + Math.max(...out.frames.map(f => f.x1))) / 2, dy = -(Math.min(...out.frames.map(f => f.y0)) + Math.max(...out.frames.map(f => f.y1))) / 2;
    const T = Tr(V(dx, dy, 0));
    for (const f of out.frames) { f.x0 += dx; f.x1 += dx; f.y0 += dy; f.y1 += dy; f.runners = f.runners.map(y => y + dy);
      f.dividers.forEach(d => { d.x += dx; d.y0 += dy; d.y1 += dy; }); f.tags = f.tags.map(([x, y, w]) => [x + dx, y + dy, w]); }
    for (const g of out.gates) { g.a = V(...g.a).applyMatrix4(T).toArray(); g.b = V(...g.b).applyMatrix4(T).toArray(); }
    for (const id in out.labels) out.labels[id] = V(...out.labels[id]).applyMatrix4(T).toArray();
    for (const m of ms) { applyWorld(m, T); out.poses[m.uuid] = m.matrixWorld.toArray(); }
  }
  sprues = out;
  return true;
}
function putOnSprues() {
  const loose = liveParts().filter(m => m.parent === world && isVisibleChain(m));
  if (!loose.length) { toast('No loose parts to put on sprues.', 'bad'); return; }
  pushUndo(); lastOp = null;
  if (layOnSprues(loose)) { afterHierarchyChange(); fitMat(true); frame(sceneBox()); toast(`${loose.length} piece${loose.length > 1 ? 's' : ''} on ${sprues.frames.length} sprue${sprues.frames.length > 1 ? 's' : ''}. Move or snap a piece to clip it off.`, 'ok'); }
}
async function exportSprues(only) {
  if (!sprues) return; scene.updateMatrixWorld(true);
  const files = [];
  sprues.frames.forEach((f, k) => {
    if (Array.isArray(only) && !only.includes(k)) return;
    const pieces = Object.keys(sprues.poses).map(partById).filter(m => m && onSprue(m) && sprues.gates.some(g => g.part === m.uuid && g.frame === k));
    files.push({ name: `Sprue ${f.letter}.stl`, pieces });
  });
  for (const f of files) { const cut = await cutMagnetHoles(f.pieces, f.pieces); f.data = writeSTL([sprueMeshes(sprues.frames.findIndex(x => `Sprue ${x.letter}.stl` === f.name)), ...cut.meshes]); delete f.pieces; }
  await deliver(files, `${safe(project.name || 'kit')}-sprues.zip`);
}
// ---------------------------------------------------------------------------
// Kit box and instructions: a folder's box art becomes a box on the bench, its PDF a booklet to flip through
// ---------------------------------------------------------------------------
let kit = null;              // { name, lines, image, pdf, pdfName, W, D, H, at, bookAt, bookAspect, pieces, sprueCount, noBox, noBook }
/** Put the box or the booklet away; the other stays on the bench. The kit goes only when both have. */
function putAway(kind) {
  if (!kit) return;
  pushUndo();
  if (kind === 'box') { if (kit.state === 'sealed') kit.state = 'open'; kit.noBox = true; }      // its contents come out first
  else kit.noBook = true;
  const boxLeft = !kit.noBox, bookLeft = !!kit.pdf && !kit.noBook;
  if (!boxLeft && !bookLeft) kit = null;
  buildKit(); select(null); markDirty(); renderPartPanel();
  toast(kind === 'box' ? (bookLeft ? 'Put the box away. The instructions stay on the bench.' : 'Put the box away. Undo brings it back.') : (boxLeft ? 'Put the instructions away. Undo brings them back.' : 'Put the instructions away.'));
}
const assets = new Map();    // key -> { type, name, data: ArrayBuffer }
const kitFx = new THREE.Group(); scene.add(kitFx);
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const book = { doc: null, key: null, pages: new Map(), n: 0, v: 0, busy: false, mode: 'pdf' };

function pickArt(list) {
  const imgs = list.filter(x => /\.(jpe?g|png|webp|gif)$/i.test(x.file.name));
  if (!imgs.length) return null;
  const score = x => (/(box|cover|front|art|kit)/i.test(x.file.name) ? 1e12 : 0) + x.file.size;
  return imgs.sort((a, b) => score(b) - score(a))[0];
}
function pickManual(list) {
  const pdfs = list.filter(x => /\.pdf$/i.test(x.file.name));
  if (!pdfs.length) return null;
  return pdfs.sort((a, b) => (/(instruct|manual|guide|assembl|build)/i.test(b.file.name) - /(instruct|manual|guide|assembl|build)/i.test(a.file.name)) || a.path.localeCompare(b.path))[0];
}
async function addAsset(file) {
  const key = 'asset:' + THREE.MathUtils.generateUUID();
  assets.set(key, { type: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/png'), name: file.name, data: await file.arrayBuffer() });
  return key;
}
const assetBlob = key => { const a = assets.get(key); return a ? new Blob([a.data], { type: a.type }) : null; };

/** Make the kit for a folder that came with box art and/or instructions. */
async function makeKit(name, list, pieces, opts = {}) {
  const art = pickArt(list), man = pickManual(list);
  if (!art && !man && !opts.always) return;
  const image = art ? await addAsset(art.file) : null, pdf = man ? await addAsset(man.file) : null;
  let aspect = 1.45;
  if (image) { try { const bm = await createImageBitmap(assetBlob(image)); aspect = bm.width / bm.height; bm.close?.(); } catch (e) {} }
  const W = 140, D = Math.min(Math.max(W / aspect, 60), 200), H = 30;
  const dirs = [...new Set(list.filter(x => /\.stl$/i.test(x.file.name)).map(x => x.path.split('/').slice(1, -1).join('/')).filter(Boolean))];
  const bb = sceneBox(), c = bb.isEmpty() ? V() : bb.getCenter(V());
  const x = bb.isEmpty() ? -W / 2 - 20 : bb.min.x - 30 - W / 2;
  kit = { name, dirs, image, pdf, pdfName: man?.file.name || null, artName: art?.file.name || null, W, D, H, at: [x, c.y, H / 2], pieces, bookAspect: 0.707, state: opts.state || 'closed' };
  kit.bookAt = [x - W / 2 + 34, c.y - D / 2 - 52, 1.3];
  await buildKit();
}
/** What the kit holds, for the box's back: copies counted once ("Leg ×8"). */
function kitContents() {
  const counts = new Map();
  for (const m of liveParts()) { const n = m.name.replace(/\s+\d+-(\d+)$/, ' ×$1'); counts.set(n, (counts.get(n) || 0) + 1); }
  return [...counts.keys()];
}
function boxSide(w, h, draw) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = Math.max(64, Math.round(1024 * h / w)); const g = c.getContext('2d');
  draw(g, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function fitFont(g, text, maxW, size, weight = 700, fam = '"Barlow Condensed", system-ui, sans-serif') {
  let s = size; g.font = `${weight} ${s}px ${fam}`;
  while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = `${weight} ${s}px ${fam}`; }
  return s;
}
/**
 * Several files coming in: ask how to set them out (a model kit, spread out, or where the files put them).
 * → 'kit' | 'spread' | 'asis' (or 'auto' if chosen in storage), or null if cancelled.
 */
function askLoadMode(count, name, entries = []) {
  const pref = $('set-loadas').value;
  if (pref !== 'ask') return Promise.resolve(pref);
  $('la-sub').textContent = `${count} files${name ? ` from ${name}` : ''}`; $('la-remember').checked = false;
  const box = $('loadask'); box.hidden = false; box.querySelector('.la-opt').focus();
  startLoadPreview(entries, document.activeElement?.dataset?.mode || 'kit');
  const hover = e => { const b = e.target.closest?.('.la-opt'); if (b) setPreviewMode(b.dataset.mode); };
  box.addEventListener('pointerover', hover); box.addEventListener('focusin', hover);
  return new Promise(res => {
    const done = mode => { box.hidden = true; box.removeEventListener('click', onClick); box.removeEventListener('keydown', onKey);
      box.removeEventListener('pointerover', hover); box.removeEventListener('focusin', hover); stopLoadPreview();
      if (mode && $('la-remember').checked) { $('set-loadas').value = mode; $('set-loadas').dispatchEvent(new Event('change')); toast('Saved. Change it in Edit › Preferences.'); }
      res(mode); };
    const onClick = e => { const b = e.target.closest('.la-opt'); if (b) done(b.dataset.mode); else if (e.target.closest('#la-cancel') || e.target === box) done(null); };
    const onKey = e => { e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (['1', '2', '3'].includes(e.key) && e.target.type !== 'checkbox') { e.preventDefault(); done(['kit', 'spread', 'asis'][+e.key - 1]); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const os = [...box.querySelectorAll('.la-opt')], i = os.indexOf(document.activeElement); os[(i + (e.key === 'ArrowDown' ? 1 : os.length - 1)) % os.length].focus(); } };
    box.addEventListener('click', onClick); box.addEventListener('keydown', onKey);
  });
}
/**
 * The little turntable in the "How should these come in?" popup: the parts as each choice would set them out.
 * Reads up to a budget of files (first ones first) so a huge folder still opens quickly.
 */
const lp = { renderer: null, scene: null, camera: null, root: null, items: [], mode: 'spread', raf: 0, gen: 0, t0: 0, more: 0 };
function previewRenderer() {
  if (lp.renderer) return;
  const cv = $('la-canvas');
  lp.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); lp.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  lp.scene = new THREE.Scene(); lp.camera = new THREE.PerspectiveCamera(30, 2, 0.1, 5000); lp.camera.up.set(0, 0, 1);
  lp.scene.add(new THREE.HemisphereLight('#f2efe8', '#2a3036', 1.6)); const d = new THREE.DirectionalLight('#ffffff', 1.8); d.position.set(2, -3, 4); lp.scene.add(d);
  lp.root = new THREE.Group(); lp.scene.add(lp.root);
}
function clearPreviewRoot() { while (lp.root?.children.length) { const c = lp.root.children.pop(); c.traverse(o => { if (o.userData.own) o.geometry?.dispose(); }); } }
async function startLoadPreview(entries, mode = 'spread') {
  previewRenderer(); const gen = ++lp.gen; lp.items.forEach(it => it.geom.dispose()); lp.items = []; clearPreviewRoot();
  lp.mode = mode; $('la-pv-mode').textContent = 'Reading the files…'; $('la-pv-count').textContent = '';
  const loop = () => { if (gen !== lp.gen) return; lp.raf = requestAnimationFrame(loop); drawPreview(); }; lp.t0 = performance.now(); loop();
  const loader = new STLLoader(); let bytes = 0, pieces = 0; const counted = [];
  const list = entries.filter(e => /\.stl$/i.test(e.file?.name || e.name || '.stl'));
  for (const [k, e] of list.entries()) {
    if (gen !== lp.gen) return;
    if (k >= 40 || (bytes + e.size > 60 * 1048576 && k > 0)) { lp.more = list.length - k; break; }
    try {
      const g = loader.parse(await e.file.arrayBuffer()); g.computeBoundingBox(); bytes += e.size;
      const q = $('set-qty').checked ? parseQuantity(e.name) : { base: e.name, count: 1 };
      lp.items.push({ geom: g, count: q.count, color: PART_COLORS[k % PART_COLORS.length] }); pieces += q.count; if (q.count > 1) counted.push(`${q.base} ×${q.count}`);
    } catch (err) { /* unreadable: the load itself will say so */ }
    if (k % 4 === 3) { arrangePreview(); await nextFrame(); }
  }
  if (gen !== lp.gen) return;
  const total = list.reduce((a, e) => a + (e.size || 0), 0);
  $('la-pv-count').textContent = `${list.length} file${list.length === 1 ? '' : 's'} → ${pieces + (lp.more ? '+' : '')} piece${pieces === 1 ? '' : 's'}${counted.length ? ` (${counted.slice(0, 2).join(', ')}${counted.length > 2 ? '…' : ''})` : ''} · ${fmtSize(total)}` + (lp.more ? ` · showing the first ${lp.items.length}` : '');
  arrangePreview();
}
function setPreviewMode(mode) { if (mode === lp.mode) return; lp.mode = mode; arrangePreview(); }
function arrangePreview() {
  clearPreviewRoot(); if (!lp.items.length) return;
  const mode = lp.mode, mats = new Map(), mat = c => mats.get(c) || (mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05 })), mats.get(c));
  $('la-pv-mode').textContent = { kit: 'Model kit: on sprues, in the box', spread: 'Off the sprue, spread out', asis: 'Where the files put them' }[mode] || '';
  if (mode === 'asis') { for (const it of lp.items) lp.root.add(new THREE.Mesh(it.geom, mat(it.color))); }
  else {
    // every copy, laid in a screen-shaped block; for a kit, laid flat (thinnest side down) on a sprue frame
    const pieces = []; for (const it of lp.items) for (let c = 0; c < Math.min(it.count, 12); c++) pieces.push(it);
    const rots = pieces.map(it => { const s = it.geom.boundingBox.getSize(V()); const r = new THREE.Matrix4();
      if (mode === 'kit') { if (s.x <= s.y && s.x <= s.z) r.makeRotationY(Math.PI / 2); else if (s.y <= s.z) r.makeRotationX(Math.PI / 2); } return r; });
    const boxes = pieces.map((it, i) => it.geom.boundingBox.clone().applyMatrix4(rots[i]));
    const big = Math.max(...boxes.map(b => b.getSize(V()).length())), gap = Math.max(big * 0.08, 1);
    const { pos, w, h } = goldenPack(boxes.map(b => ({ w: b.max.x - b.min.x, h: b.max.y - b.min.y })), gap);
    pieces.forEach((it, i) => { const b = boxes[i], m = new THREE.Mesh(it.geom, mat(mode === 'kit' ? sprueColor() : it.color));
      m.matrixAutoUpdate = false; m.matrix.copy(Tr(V(pos[i].x - b.min.x - w / 2, h / 2 - pos[i].y - b.max.y, -b.min.z))).multiply(rots[i]); lp.root.add(m); });
    if (mode === 'kit') {           // the frame: an outer rail and a runner between rows
      const bar = Math.max(big * 0.035, 0.8), plastic = mat(sprueColor()), rail = (x, y, sx, sy) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, bar), plastic); m.userData.own = true; m.position.set(x, y, bar / 2); lp.root.add(m); };
      rail(0, h / 2 + gap / 2, w + gap, bar); rail(0, -h / 2 - gap / 2, w + gap, bar); rail(-w / 2 - gap / 2, 0, bar, h + gap); rail(w / 2 + gap / 2, 0, bar, h + gap); rail(0, 0, w + gap, bar * 0.7);
    }
  }
  // frame it from a three-quarter view
  const bb = new THREE.Box3().setFromObject(lp.root), c = bb.getCenter(V()), r = Math.max(bb.getSize(V()).length() / 2, 1);
  lp.root.position.set(-c.x, -c.y, -c.z); lp.root.userData.r = r;
}
function drawPreview() {
  const cv = $('la-canvas'), W = cv.clientWidth, H = cv.clientHeight; if (!W || !H) return;
  if (cv.width !== Math.round(W * lp.renderer.getPixelRatio()) || cv.height !== Math.round(H * lp.renderer.getPixelRatio())) lp.renderer.setSize(W, H, false);
  const r = lp.root.userData.r || 10, a = (performance.now() - lp.t0) / 1000 * 0.35 + 0.6, still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  lp.camera.aspect = W / H; lp.camera.near = r / 50; lp.camera.far = r * 50; lp.camera.updateProjectionMatrix();
  const d = r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.05, ang = still ? 0.6 : a;
  lp.camera.position.set(Math.sin(ang) * d * 0.75, -Math.cos(ang) * d * 0.75, d * 0.6); lp.camera.lookAt(0, 0, 0);
  lp.renderer.render(lp.scene, lp.camera);
}
function stopLoadPreview() { lp.gen++; cancelAnimationFrame(lp.raf); clearPreviewRoot(); lp.items.forEach(it => it.geom.dispose()); lp.items = []; lp.more = 0; }

/** A popup that covers the bench while a kit gets ready, with a progress bar. */
const loading = {
  depth: 0,
  show(title) { this.depth++; $('ls-title').textContent = title; $('ls-text').textContent = 'Getting started…'; this.set(0); $('loadscreen').hidden = false; },
  set(frac, text) { const p = Math.round(Math.max(0, Math.min(1, frac)) * 100); $('ls-fill').style.width = p + '%'; $('loadscreen').querySelector('.ls-bar').setAttribute('aria-valuenow', String(p)); if (text) $('ls-text').textContent = text; },
  hide() { this.depth = Math.max(0, this.depth - 1); if (!this.depth) $('loadscreen').hidden = true; },
  get on() { return !$('loadscreen').hidden; },
};
/** Sealed: the sprues, their pieces and the booklet are inside the box, out of sight and out of reach. */
function boxed(m) { return kit?.state === 'sealed' && !!sprues && !!sprues.poses[m.uuid] && onSprue(m); }
function applySeal() {
  if (kit?.state === 'sealed' && !sprues) { kit.state = 'closed'; buildKit(); return; }      // nothing left inside to unwrap
  const sealed = kit?.state === 'sealed', L = sealed ? 1 : 0;
  sprueFx.traverse(o => o.layers.set(L));
  kitFx.getObjectByName('kit-book')?.traverse(o => o.layers.set(L));
  for (const m of liveParts()) m.layers.set(sealed && boxed(m) ? 1 : 0);
  if (applySeal.was !== sealed) { applySeal.was = sealed; renderOutliner(); }
}
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
function tween(ms, fn) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
  return new Promise(res => { const t0 = performance.now(); const tick = () => { const t = ms ? Math.min(1, (performance.now() - t0) / ms) : 1; fn(ease(t), t); if (t < 1) requestAnimationFrame(tick); else res(); }; tick(); });
}
/** Unbox: the film comes off, the lid lifts and rests beside the tray, the sprues and booklet come out onto the bench. */
async function openBox() {
  if (kit?.state !== 'sealed' || kit.opening) return;
  kit.opening = true;
  const grp = kitFx.getObjectByName('kit-box'), wrap = grp?.getObjectByName('kit-wrap'), lid = grp?.getObjectByName('kit-lid');
  try {
    if (wrap) await tween(450, e => { wrap.scale.setScalar(1 + 0.08 * e); wrap.material.opacity = 1 - e; });
    if (wrap) { grp.remove(wrap); wrap.geometry.dispose(); wrap.material.map?.dispose(); wrap.material.dispose(); }
    if (lid) { const to = lidSpot(true), lift = kit.H + 18;
      await tween(800, (e, t) => { lid.position.set(to.x * e, to.y * e, Math.sin(Math.PI * Math.min(1, t * 1.15)) * lift); }); lid.position.copy(to); }
    kit.state = 'open'; applySeal(); markDirty();
    // out they come: each sprue (with its pieces) and the booklet rises from the tray to its place on the bench
    grp.updateMatrixWorld(true); const from = new THREE.Box3().setFromObject(grp.getObjectByName('kit-tray')).getCenter(V()); from.z += kit.H * 0.4;
    const items = [];
    sprueFx.children.forEach(g => { const k = g.userData.frame; items.push({ objs: [g, ...piecesOn(k)], box: new THREE.Box3().setFromObject(g) }); });
    const bk = kitFx.getObjectByName('kit-book'); if (bk) items.push({ objs: [bk], box: new THREE.Box3().setFromObject(bk) });
    for (const it of items) { it.c = it.box.getCenter(V()); it.orig = it.objs.map(o => ({ o, p: o.position.clone(), s: o.scale.clone() })); }
    const place = (it, e) => { const s = 0.15 + 0.85 * e, off = from.clone().sub(it.c).multiplyScalar(1 - e); off.z += Math.sin(Math.PI * e) * kit.H * 0.8;
      for (const { o, p, s: s0 } of it.orig) { o.position.copy(p).sub(it.c).multiplyScalar(s).add(it.c).add(off); o.scale.copy(s0).multiplyScalar(s); } };
    items.forEach(it => place(it, 0));
    await Promise.all(items.map((it, i) => new Promise(r => setTimeout(r, i * 140)).then(() => tween(900, e => place(it, e)))));
    for (const it of items) for (const { o, p, s: s0 } of it.orig) { o.position.copy(p); o.scale.copy(s0); o.updateMatrixWorld(true); }
    applySeal(); markBench(); fitMat(true); frame(benchBox());
    toast(`Unboxed ${kit.name}: ${sprues ? `${sprues.frames.length} sprue${sprues.frames.length > 1 ? 's' : ''}` : 'the pieces'}${kit.pdf ? ' and the instructions' : ''}.`, 'ok');
  } finally { if (kit) kit.opening = false; renderPartPanel(); }
}
function closeLid() { if (!kit || kit.state !== 'open') return; pushUndo(); kit.state = 'closed'; buildKit(); markDirty(); renderPartPanel(); }

let kitGen = 0;
/** Where the lid sits in the box's own frame: on the tray, or resting beside it once opened. */
function lidSpot(open) { return open && kit ? V(-(kit.W + 14), 0, 0) : V(); }
let wrapEnv = null;
function wrapTexture() {               // creases, heat-seal lines and glints of the film, as a see-through map
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, 0, 512, 512);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sheen = g.createLinearGradient(0, 0, 512, 512);              // a broad diagonal sheen across the film
  sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(0.42, 'rgba(255,255,255,0.10)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.2)'); sheen.addColorStop(0.58, 'rgba(255,255,255,0.10)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, 512, 512);
  g.lineCap = 'round';
  for (let i = 0; i < 34; i++) {            // soft wavy creases, brighter on one edge
    const x = rnd() * 512, y = rnd() * 512, a = (rnd() - 0.5) * 1.2 + (i % 3 ? 0 : Math.PI / 2), l = 40 + rnd() * 140;
    const bx = Math.cos(a), by = Math.sin(a), nx = -by, ny = bx, bend = (rnd() - 0.5) * l * 0.6;
    const path = () => { g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + bx * l * 0.33 + nx * bend, y + by * l * 0.33 + ny * bend, x + bx * l * 0.66 - nx * bend * 0.6, y + by * l * 0.66 - ny * bend * 0.6, x + bx * l, y + by * l); };
    g.strokeStyle = `rgba(255,255,255,${0.04 + rnd() * 0.06})`; g.lineWidth = 6 + rnd() * 8; path(); g.stroke();
    g.strokeStyle = `rgba(255,255,255,${0.10 + rnd() * 0.14})`; g.lineWidth = 0.8 + rnd() * 1.2; path(); g.stroke();
  }
  for (let i = 0; i < 6; i++) {             // bright glints
    const x = rnd() * 512, y = rnd() * 512, gr = g.createRadialGradient(x, y, 0, x, y, 30 + rnd() * 50);
    gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512);
  }
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 3;               // heat-seal seam along the edge
  g.beginPath(); g.moveTo(0, 6); g.lineTo(512, 6); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
/** Glossy film tight round the box. */
function shrinkWrap(W, D, H) {
  if (!wrapEnv) { const pm = new THREE.PMREMGenerator(renderer); wrapEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
  const tex = wrapTexture(); tex.repeat.set(1, 1);
  const m = new THREE.Mesh(new RoundedBoxGeometry(W + 1.4, D + 1.4, H + 1.2, 3, 1.6),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', map: tex, transparent: true, depthWrite: false, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      envMap: wrapEnv, envMapIntensity: 0.9, specularIntensity: 1 }));
  m.name = 'kit-wrap'; m.renderOrder = 5; return m;
}
function clearKitFx() { while (kitFx.children.length) { const o = kitFx.children.pop(); o.traverse(c => { c.geometry?.dispose(); [].concat(c.material || []).forEach(m => { m.map?.dispose(); m.dispose(); }); }); } }
async function buildKit() {
  const gen = ++kitGen;          // a newer rebuild started while this one waited → leave it to that one
  if (kit) delete kit.opening;
  clearKitFx();
  if (!kit) { applySeal(); return; }
  const { W, D, H } = kit;
  // colours from the art: the box's sides use its darker average tone
  let artTex = null, tone = '#2b3138';
  if (kit.image) {
    try {
      const bm = await createImageBitmap(assetBlob(kit.image)), c = document.createElement('canvas');
      const s = Math.min(1, 2048 / Math.max(bm.width, bm.height)); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
      const g = c.getContext('2d'); g.drawImage(bm, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height).data; let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4 * 97) { r += px[i]; gg += px[i+1]; b += px[i+2]; n++; }
      tone = `rgb(${Math.round(r / n * 0.45)},${Math.round(gg / n * 0.45)},${Math.round(b / n * 0.45)})`;
      artTex = new THREE.CanvasTexture(c); artTex.colorSpace = THREE.SRGBColorSpace; artTex.anisotropy = 8;
    } catch (e) { artTex = null; }
  }
  if (gen !== kitGen) { artTex?.dispose(); return; }
  clearKitFx();
  const pieces = liveParts().length, sp = sprues?.frames.length || 0;
  const sub = `${pieces} piece${pieces === 1 ? '' : 's'}${sp ? ` · ${sp} sprue${sp === 1 ? '' : 's'}` : ''}${kit.pdf ? ' · instructions inside' : ''}`;
  const stripe = (g, w, h) => { g.fillStyle = tone; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(214,162,74,.9)'; g.fillRect(0, h - h * 0.12, w, h * 0.06); };
  const front = boxSide(W, H, (g, w, h) => { stripe(g, w, h);
    g.fillStyle = '#f2ecdf'; g.textBaseline = 'middle';
    const fs = fitFont(g, kit.name, w * 0.9, h * 0.42); g.fillText(kit.name, w * 0.05, h * 0.36);
    g.font = `500 ${Math.round(Math.min(fs * 0.45, h * 0.17))}px "Barlow Semi Condensed", system-ui, sans-serif`; g.fillStyle = '#d9cfbd'; g.fillText(sub, w * 0.05, h * 0.68); });
  const back = boxSide(W, H, (g, w, h) => { stripe(g, w, h);
    g.fillStyle = '#f2ecdf'; g.textBaseline = 'top';
    g.font = `700 ${Math.round(h * 0.16)}px "Barlow Condensed", system-ui, sans-serif`; g.fillText('CONTENTS', w * 0.04, h * 0.07);
    const items = kitContents(), cols = Math.min(4, Math.max(1, Math.ceil(items.length / 4))), rows = Math.ceil(items.length / cols) || 1;
    const lh = Math.min(h * 0.13, (h * 0.62) / rows); g.font = `500 ${Math.round(lh * 0.82)}px "Barlow Semi Condensed", system-ui, sans-serif`; g.fillStyle = '#d9cfbd';
    items.forEach((t, i) => { const cx = w * 0.04 + Math.floor(i / rows) * (w * 0.92 / cols), cy = h * 0.27 + (i % rows) * lh; fitFont(g, t, w * 0.92 / cols - 12, Math.round(lh * 0.82), 500, '"Barlow Semi Condensed", system-ui, sans-serif'); g.fillText(t, cx, cy); });
    if (kit.dirs.length) { g.font = `500 ${Math.round(h * 0.08)}px "IBM Plex Mono", monospace`; g.fillStyle = 'rgba(242,236,223,.6)'; g.fillText(kit.dirs.join('  ·  ').slice(0, 120), w * 0.04, h * 0.9 - h * 0.12); } });
  const end = boxSide(D, H, (g, w, h) => { stripe(g, w, h);
    g.fillStyle = '#f2ecdf'; g.textBaseline = 'middle'; fitFont(g, kit.name, w * 0.9, h * 0.4); g.fillText(kit.name, w * 0.05, h * 0.38);
    g.font = `500 ${Math.round(h * 0.15)}px "Barlow Semi Condensed", system-ui, sans-serif`; g.fillStyle = '#d9cfbd'; g.fillText(`${pieces} pieces`, w * 0.05, h * 0.68); });
  // a lid over a tray: closed it looks like the printed box; opened, the lid rests beside the tray
  const grp = new THREE.Group(); grp.name = 'kit-box'; grp.position.fromArray(kit.at); grp.rotation.z = kit.rot || 0; grp.visible = !kit.noBox;
  const T = 1.2, inner = new THREE.MeshStandardMaterial({ color: '#d8d2c6', roughness: 0.95 });
  const lid = new THREE.Group(); lid.name = 'kit-lid'; grp.add(lid);
  const slab = (w, d, h, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat); m.position.set(x, y, z); return m; };
  const outer = new THREE.MeshStandardMaterial({ color: tone, roughness: 0.8 });
  lid.add(slab(W, D, T, 0, 0, H / 2 - T / 2, [outer, outer, outer, outer, outer, inner]));
  for (const [w, d, x, y] of [[W, T, 0, -D / 2 + T / 2], [W, T, 0, D / 2 - T / 2], [T, D, -W / 2 + T / 2, 0], [T, D, W / 2 - T / 2, 0]]) lid.add(slab(w, d, H, x, y, 0, inner));
  const face = (tex, w, h, setup) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })); setup(m); lid.add(m); return m; };
  face(artTex || boxSide(W, D, (g, w, h) => { stripe(g, w, h); g.fillStyle = '#f2ecdf'; g.textBaseline = 'middle'; fitFont(g, kit.name, w * 0.85, h * 0.18); g.fillText(kit.name, w * 0.07, h * 0.5); }),
    W, D, m => { m.position.z = H / 2 + 0.05; });
  face(front, W, H, m => { m.rotateX(Math.PI / 2); m.position.y = -D / 2 - 0.05; });
  face(back, W, H, m => { m.rotateZ(Math.PI); m.rotateX(Math.PI / 2); m.position.y = D / 2 + 0.05; });
  face(end, D, H, m => { m.rotateZ(Math.PI / 2); m.rotateX(Math.PI / 2); m.position.x = W / 2 + 0.05; });
  face(end, D, H, m => { m.rotateZ(-Math.PI / 2); m.rotateX(Math.PI / 2); m.position.x = -W / 2 - 0.05; });
  const tray = new THREE.Group(); tray.name = 'kit-tray'; grp.add(tray);
  const tw = W - 2 * T - 0.4, td = D - 2 * T - 0.4, th = H - 1.5, card = new THREE.MeshStandardMaterial({ color: '#bdb6a9', roughness: 0.95 });
  tray.add(slab(tw, td, T, 0, 0, -H / 2 + T / 2, [card, card, card, card, inner, card]));
  for (const [w, d, x, y] of [[tw, T, 0, -td / 2 + T / 2], [tw, T, 0, td / 2 - T / 2], [T, td, -tw / 2 + T / 2, 0], [T, td, tw / 2 - T / 2, 0]]) tray.add(slab(w, d, th, x, y, -H / 2 + th / 2, [card, card, card, card, card, card]));
  lid.position.copy(lidSpot(kit.state === 'open'));
  if (kit.state === 'sealed') grp.add(shrinkWrap(W, D, H));
  grp.userData.kit = 'box'; grp.traverse(o => { o.userData.kit = 'box'; }); if (!kit.noBox) kitFx.add(grp);
  if (kit.pdf && !kit.noBook) {
    const bd = 74, bw = bd * kit.bookAspect, bt = 2.6, bk = new THREE.Group(); bk.name = 'kit-book'; bk.position.fromArray(kit.bookAt); bk.rotation.z = kit.bookRot ?? 0.12;
    const pages = new THREE.Mesh(new THREE.BoxGeometry(bw, bd, bt), [0, 1, 2, 3, 4, 5].map(i => new THREE.MeshStandardMaterial({ color: i === 1 ? '#3a3f45' : '#efeae0', roughness: 0.9 })));
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), new THREE.MeshStandardMaterial({ color: '#efeae0', roughness: 0.7 })); cover.position.z = bt / 2 + 0.05;
    const pg = kit.page || 1;
    if (pg > 1) {
      // lying open at the spread you left it on: two pages side by side, a little sag at the spine
      const [l, r] = [2 * Math.floor(pg / 2), 2 * Math.floor(pg / 2) + 1];
      // each page hinges at the spine and lifts toward its outer edge, so no part of it ever dips into the block below
      const top = -bt / 2 + 1.2, sag = 0.03, pageMat = () => new THREE.MeshStandardMaterial({ color: '#efeae0', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      pages.geometry.dispose(); pages.geometry = new THREE.BoxGeometry(bw * 2, bd, 1.2); pages.position.z = top - 0.6;
      cover.geometry.dispose(); cover.geometry = new THREE.PlaneGeometry(bw, bd).translate(-bw / 2, 0, 0); cover.material.dispose(); cover.material = pageMat();
      cover.position.set(0, 0, top + 0.12); cover.rotation.y = sag;
      const right = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd).translate(bw / 2, 0, 0), pageMat()); right.position.set(0, 0, top + 0.12); right.rotation.y = -sag;
      bk.add(pages, cover, right); bk.traverse(o => { o.userData.kit = 'book'; }); kitFx.add(bk);
      pageTexture(cover.material, l); pageTexture(right.material, r);
    } else {
      bk.add(pages, cover); bk.traverse(o => { o.userData.kit = 'book'; }); kitFx.add(bk);
      bookCover(cover.material);
    }
  }
  applySeal(); markBench();
}
async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error("the PDF reader didn't load")); document.head.append(s); });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
  return window.pdfjsLib;
}
async function pdfDoc() {
  if (book.doc && book.key === kit?.pdf) return book.doc;
  const lib = await loadPdfJs(), a = assets.get(kit.pdf);
  book.doc = await lib.getDocument({ data: new Uint8Array(a.data.slice(0)), isEvalSupported: false }).promise;
  book.key = kit.pdf; book.pages.clear(); book.n = book.doc.numPages; return book.doc;
}
/** Page n (1-based) as an image URL at about `px` pixels tall. */
async function pageImage(n, px = 1400) {
  const key = n + '@' + px; if (book.pages.has(key)) return book.pages.get(key);
  const doc = await pdfDoc(), page = await doc.getPage(n), v0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: px / v0.height }), c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  const url = c.toDataURL('image/jpeg', 0.9); book.pages.set(key, url); return url;
}
async function pageTexture(mat, n) {
  try {
    const doc = await pdfDoc(); if (!n || n > doc.numPages) { mat.color.set('#f6f3ec'); return; }
    const img = new Image(); img.src = await pageImage(n, 700); await img.decode();
    const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; mat.map = t; mat.color.set('#ffffff'); mat.needsUpdate = true;
  } catch (e) { console.warn(e); }
}
async function bookCover(mat) {
  try {
    const doc = await pdfDoc(), p1 = await doc.getPage(1), v = p1.getViewport({ scale: 1 }), asp = v.width / v.height;
    if (Math.abs(asp - kit.bookAspect) > 0.02) { kit.bookAspect = asp; return buildKit(); }      // reshape the booklet to the PDF's pages
    const img = new Image(); img.src = await pageImage(1, 700); await img.decode();
    const t = new THREE.Texture(img); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; mat.map = t; mat.color.set('#ffffff'); mat.needsUpdate = true;
  } catch (e) { console.warn(e); }
}
function kitHit(ev) {
  if (!kitFx.children.length) return null;
  const r = renderer.domElement.getBoundingClientRect(), rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
  const h = rc.intersectObjects(kitFx.children, true)[0], parts = raycast(ev);
  if (!h || (parts && parts.distance < h.distance)) return null;
  return h.object.userData.kit || null;
}
function benchBox() { const b = sceneBox(); for (const fx of [kitFx, sprueFx]) { fx.updateMatrixWorld(true); if (fx.children.length) b.union(new THREE.Box3().setFromObject(fx)); } return b; }

// the flip-through viewer
function spreadOf(v) { return v === 0 ? [null, 1] : [2 * v, 2 * v + 1 <= book.n ? 2 * v + 1 : null]; }
const narrowBook = () => window.innerWidth < 760;
async function setPage(el, n) {
  el.innerHTML = ''; el.classList.toggle('blank', !n); if (!n) return;
  const im = new Image(); im.alt = `Page ${n}`; im.src = await pageImage(n); await im.decode().catch(() => {});
  const wrap = document.createElement('div'); wrap.className = 'pgw';
  wrap.append(im); el.append(wrap);
}
async function showSpread() {
  const [l, r] = narrowBook() ? [null, book.v + 1] : spreadOf(book.v);
  $('book-spread').classList.toggle('single', narrowBook());
  await Promise.all([setPage($('pg-l'), l), setPage($('pg-r'), r)]);
  const last = narrowBook() ? book.n - 1 : Math.floor(book.n / 2);
  $('book-prev').disabled = book.v <= 0; $('book-next').disabled = book.v >= last;
  $('book-page').textContent = narrowBook() ? `Page ${book.v + 1} of ${book.n}` : (l && r ? `Pages ${l}–${r} of ${book.n}` : `Page ${l || r} of ${book.n}`);
  // render the pages either side ahead of time, so turning is instant
  for (const k of [book.v - 1, book.v + 1]) if (k >= 0) (narrowBook() ? [k + 1] : spreadOf(k)).forEach(n => n && n <= book.n && pageImage(n).catch(() => {}));
}
async function turn(dir) {
  if (book.busy || book.mode !== 'pdf') return;
  const last = narrowBook() ? book.n - 1 : Math.floor(book.n / 2), nv = book.v + dir;
  if (nv < 0 || nv > last) return;
  book.busy = true;
  try {
    if (narrowBook() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { book.v = nv; await showSpread(); return; }
    // a leaf turns over the spine: the page you're leaving on its front, the page you're going to on its back
    const [l0, r0] = spreadOf(book.v), [l1, r1] = spreadOf(nv), leaf = $('leaf');
    const front = leaf.querySelector('.front'), back = leaf.querySelector('.back');
    await Promise.all([setPage(front, dir > 0 ? r0 : l0), setPage(back, dir > 0 ? l1 : r1)]);
    if (dir > 0) await setPage($('pg-r'), r1); else await setPage($('pg-l'), l1);
    leaf.className = 'leaf ' + (dir > 0 ? 'fwd' : 'bwd'); leaf.hidden = false; void leaf.offsetWidth;
    leaf.classList.add('go');
    await new Promise(r => setTimeout(r, 560));
    leaf.hidden = true; book.v = nv; await showSpread();
  } finally { book.busy = false; }
}
async function openBook() {
  if (!kit?.pdf) return;
  book.mode = 'pdf'; $('book').hidden = false; $('book-putaway').hidden = false; $('book-title').textContent = kit.pdfName?.replace(/\.pdf$/i, '') || 'Instructions';
  $('book-nav').hidden = false; $('book-art').hidden = true; $('book-stage').hidden = false;
  $('book-page').textContent = 'Opening…';
  try { await pdfDoc(); const pg = kit.page || 1; book.v = Math.min(narrowBook() ? pg - 1 : Math.floor(pg / 2), narrowBook() ? book.n - 1 : Math.floor(book.n / 2)); await showSpread(); $('book-next').focus(); }
  catch (e) { $('book-page').textContent = `Couldn't open the PDF: ${e.message}`; }
}
function openArt() {
  if (!kit) return;
  book.mode = 'art'; $('book').hidden = false; $('book-putaway').hidden = true; $('book-title').textContent = kit.name;
  $('book-nav').hidden = true; $('book-stage').hidden = true; $('book-art').hidden = false;
  const im = $('book-art').querySelector('img'); if (kit.image) { im.src = URL.createObjectURL(assetBlob(kit.image)); im.hidden = false; } else im.hidden = true;
  $('book-page').textContent = [kit.artName, kit.pdfName].filter(Boolean).join(' · ');
  $('book-open-pdf').hidden = !kit.pdf;
}
function closeBook() {
  const wasOpen = !$('book').hidden; $('book').hidden = true;
  if (!wasOpen || book.mode !== 'pdf' || !kit?.pdf) return;
  const page = narrowBook() ? book.v + 1 : (book.v === 0 ? 1 : 2 * book.v);
  if (page !== (kit.page || 1)) { kit.page = page; markDirty(); buildKit(); }   // left open at that page, on the bench too
}
function bindKit() {
  $('book-prev').addEventListener('click', () => turn(-1)); $('book-next').addEventListener('click', () => turn(1));
  $('book-close').addEventListener('click', closeBook);
  $('book').addEventListener('click', e => { if (e.target === $('book')) closeBook(); });
  $('book-open-pdf').addEventListener('click', openBook);
  $('book-remove').addEventListener('click', () => { closeBook(); putAway('box'); });
  $('book-putaway').addEventListener('click', () => { closeBook(); putAway('book'); });
  $('book-spread').addEventListener('click', e => { if (book.mode !== 'pdf') return; const r = $('book-spread').getBoundingClientRect(); turn(e.clientX < r.left + r.width / 2 ? -1 : 1); });
  window.addEventListener('keydown', e => {
    if ($('book').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeBook(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); turn(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); e.stopImmediatePropagation(); turn(-1); }
  }, true);
}
// ---------------------------------------------------------------------------
// Navigation cube: click a face, edge or corner to look from there; drag it to turn the view
// ---------------------------------------------------------------------------
const navCube = (() => {
  const cv = $('navcube'), r = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setSize(112, 112, false);
  const sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  const face = (text, tint) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = tint; g.fillRect(0, 0, 128, 128); g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 122);
    g.fillStyle = '#e9e4d8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 30; g.font = `700 ${fs}px "Barlow Condensed", system-ui, sans-serif`; while (g.measureText(text).width > 108) { fs -= 2; g.font = `700 ${fs}px "Barlow Condensed", system-ui, sans-serif`; }
    g.fillText(text, 64, 66);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshBasicMaterial({ map: t, color: '#ffffff' });
  };
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z; turned so its +y is our up (+z) and its +z is our front (-y)
  const mats = [face('RIGHT', '#3b4650'), face('LEFT', '#3b4650'), face('TOP', '#45525d'), face('BOTTOM', '#2e363d'), face('FRONT', '#3f4a54'), face('BACK', '#3f4a54')];
  const geo = new THREE.BoxGeometry(2, 2, 2); geo.rotateX(Math.PI / 2);
  const cube = new THREE.Mesh(geo, mats); sc.add(cube);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: '#8b96a0' })); sc.add(edges);
  // little axes off the bottom corner: X red, Y green, Z blue
  const ax = (to, col) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(-1.25, -1.25, -1.25), V(-1.25, -1.25, -1.25).add(to)]), new THREE.LineBasicMaterial({ color: col })); sc.add(l); };
  ax(V(1.1, 0, 0), '#d46a6a'); ax(V(0, 1.1, 0), '#7fbf5a'); ax(V(0, 0, 1.1), '#6a9be0');
  const hl = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 10), new THREE.MeshBasicMaterial({ color: '#d6a24a', transparent: true, opacity: 0.85, depthTest: false }));
  hl.renderOrder = 5; hl.visible = false; sc.add(hl);
  const NAMES = { '1,0,0': 'Right', '-1,0,0': 'Left', '0,1,0': 'Back', '0,-1,0': 'Front', '0,0,1': 'Top', '0,0,-1': 'Bottom' };
  const rc = new THREE.Raycaster(), ndc = new THREE.Vector2();
  /** Which view a point on the cube asks for: a face, an edge (two axes) or a corner (three). */
  const regionAt = ev => {
    const b = cv.getBoundingClientRect(); ndc.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1);
    rc.setFromCamera(ndc, cam); const h = rc.intersectObject(cube)[0]; if (!h) return null;
    const p = h.point, d = V(Math.abs(p.x) > 0.62 ? Math.sign(p.x) : 0, Math.abs(p.y) > 0.62 ? Math.sign(p.y) : 0, Math.abs(p.z) > 0.62 ? Math.sign(p.z) : 0);
    // the face you're on always counts
    const n = h.face.normal.clone(); ['x', 'y', 'z'].forEach(k => { if (Math.abs(n[k]) > 0.5) d[k] = Math.sign(n[k]); });
    return d;
  };
  const label = d => { const parts = []; if (d.z) parts.push(d.z > 0 ? 'Top' : 'Bottom'); if (d.y) parts.push(d.y > 0 ? 'Back' : 'Front'); if (d.x) parts.push(d.x > 0 ? 'Right' : 'Left'); return parts.join(' ') || 'view'; };
  let hover = null, drag = null, anim = null;
  const showHover = d => {
    hover = d; mats.forEach(m => m.color.set('#ffffff')); hl.visible = false;
    if (!d) { cv.title = 'Click a face, edge or corner to look from there. Drag to turn the view.'; return; }
    const nz = (d.x !== 0) + (d.y !== 0) + (d.z !== 0);
    if (nz === 1) { const i = d.x > 0 ? 0 : d.x < 0 ? 1 : d.z > 0 ? 2 : d.z < 0 ? 3 : d.y < 0 ? 4 : 5; mats[i].color.set('#f3c977'); }
    else { hl.position.copy(d).multiplyScalar(1.0); hl.visible = true; }
    cv.title = `Look from the ${label(d).toLowerCase()}`;
  };
  /** Swing the main camera round the orbit centre to look from direction d (a unit-ish vector from the centre to the eye). */
  const goTo = (d, ms = 380) => {
    const to = d.clone().normalize();
    const lim = Math.sin(89.4 * Math.PI / 180);
    if (Math.abs(to.z) > lim) { to.set(0, -Math.sqrt(1 - lim * lim), Math.sign(to.z) * lim); }      // straight up/down: keep front at the bottom of the screen
    const from = camera.position.clone().sub(orbit.target), dist = from.length();
    anim = { q: new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to), from: from.normalize(), dist, t0: performance.now(), ms };
    nav.glide = null;
  };
  const step = () => {
    if (!anim) return;
    const t = Math.min(1, (performance.now() - anim.t0) / anim.ms), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const q = new THREE.Quaternion().slerp(anim.q, e);
    camera.position.copy(orbit.target).addScaledVector(anim.from.clone().applyQuaternion(q), anim.dist);
    camera.lookAt(orbit.target); orbit.update();
    if (t >= 1) { anim = null; markViewMoved(); }
  };
  const render = () => {
    step();
    cam.quaternion.copy(camera.quaternion); cam.position.set(0, 0, 9).applyQuaternion(camera.quaternion); cam.up.copy(camera.up);
    r.render(sc, cam);
  };
  cv.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (!drag.moved && Math.hypot(dx, dy) < 3) return;
      drag.moved = true; drag.x = e.clientX; drag.y = e.clientY; anim = null; turnView(dx * 2.2, dy * 2.2, orbit.target.clone()); return;
    }
    showHover(regionAt(e));
  });
  cv.addEventListener('pointerleave', () => { if (!drag) showHover(null); });
  cv.addEventListener('pointerdown', e => { e.preventDefault(); drag = { x: e.clientX, y: e.clientY, moved: false }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointerup', e => {
    const d = drag; drag = null; if (!d) return;
    if (d.moved) { markViewMoved(); return; }
    const reg = regionAt(e); if (reg) { goTo(reg); toast(`${label(reg)} view`); }
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  $('nav-home').addEventListener('click', () => { goTo(V(1, -1.2, 0.85)); setTimeout(() => frame(benchBox()), 400); });
  // keyboard: number-pad style views, like Blender
  return { render, goTo, NAMES };
})();
/** Turn the view about a pivot by a screen drag (px): around the up axis for x, tilting for y, never past straight up or down. */
function turnView(dx, dy, P) {
  const k = 2 * Math.PI / renderer.domElement.clientHeight, f = fwd(), right = V().crossVectors(f, camera.up).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), -dx * k);
  let tilt = -dy * k; const pitch = Math.asin(Math.max(-1, Math.min(1, f.z))), lim = Math.PI / 2 - 0.01;
  tilt = Math.max(-lim - pitch, Math.min(lim - pitch, tilt));
  q.multiply(new THREE.Quaternion().setFromAxisAngle(right, tilt));
  for (const v of [camera.position, orbit.target]) v.sub(P).applyQuaternion(q).add(P);
  camera.lookAt(orbit.target); orbit.update();
}
// ---------------------------------------------------------------------------
// Bench objects: the kit box, the instructions and whole sprues can be picked up and moved like parts
// ---------------------------------------------------------------------------
let benchSel = null;                 // { kind: 'box' | 'book' | 'sprue', k }
const benchMark = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#d6a24a')); benchMark.visible = false; scene.add(benchMark);
function benchObj(sel = benchSel) {
  if (!sel) return null;
  if (sel.kind === 'box') return kitFx.getObjectByName('kit-box') || null;
  if (sel.kind === 'book') return kitFx.getObjectByName('kit-book') || null;
  return sprueFx.children.find(c => c.userData.frame === sel.k) || null;
}
function markBench() {
  const o = benchObj(); benchMark.visible = !!o;
  if (o) { o.updateMatrixWorld(true); benchMark.box.setFromObject(o).expandByScalar(0.6); }
}
function selectBench(kind, k = 0) {
  select(null); benchSel = { kind, k }; markBench(); syncGizmo(); renderPartPanel();
  if (['move', 'rotate'].includes(tool) && kind === 'sprue' && tool === 'rotate') toast('Sprues slide but don\'t turn. Use Move.');
}
/** What's under the cursor among the box, the booklet and the sprue plastic (a part in front wins). */
function benchHit(ev) {
  const r = renderer.domElement.getBoundingClientRect(), rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
  const h = rc.intersectObjects([...kitFx.children, ...sprueFx.children], true)[0]; if (!h) return null;
  const part = raycast(ev); if (part && part.distance < h.distance) return null;
  let o = h.object; while (o && o.userData.kit === undefined && o.userData.frame === undefined) o = o.parent;
  if (!o) return null;
  return o.userData.frame !== undefined ? { kind: 'sprue', k: o.userData.frame } : { kind: o.userData.kit };
}
/** The pieces still held on sprue k. */
function piecesOn(k) { return [...new Set(sprues.gates.filter(g => g.frame === k).map(g => g.part))].map(partById).filter(m => m && onSprue(m)); }
/** Slide sprue k's plastic and everything about it by t (the pieces have already moved). */
function shiftSprue(k, t) {
  const f = sprues.frames[k];
  f.x0 += t.x; f.x1 += t.x; f.y0 += t.y; f.y1 += t.y; f.z += t.z; f.runners = f.runners.map(y => y + t.y);
  (f.dividers || []).forEach(d => { d.x += t.x; d.y0 += t.y; d.y1 += t.y; });
  f.tags = (f.tags || []).map(([x, y, w]) => [x + t.x, y + t.y, w]);
  const ids = new Set();
  for (const g of sprues.gates) if (g.frame === k) { g.a = V(...g.a).add(t).toArray(); g.b = V(...g.b).add(t).toArray(); ids.add(g.part); }
  for (const id of ids) { if (sprues.labels[id]) sprues.labels[id] = V(...sprues.labels[id]).add(t).toArray(); const m = partById(id); if (m) { m.updateMatrixWorld(true); sprues.poses[id] = m.matrixWorld.toArray(); } }
}
function removeSprue(k) {
  pushUndo();
  sprues.frames.splice(k, 1); sprues.gates = sprues.gates.filter(g => g.frame !== k).map(g => ({ ...g, frame: g.frame > k ? g.frame - 1 : g.frame }));
  if (!sprues.frames.length) sprues = null;
  select(null); afterHierarchyChange(); toast('Removed that sprue frame. Its pieces stay where they are.');
}
function renderBenchPanel(el) {
  const o = benchObj(); if (!o) { benchSel = null; el.innerHTML = '<p class="note">Select a part to see its size and attachments.</p>'; return; }
  const head = document.createElement('div'); head.className = 'multi-head';
  const dl = document.createElement('dl'); dl.className = 'props';
  const add = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
  const row = document.createElement('div'); row.className = 'btnrow';
  const b = (txt, fn, primary) => { const x = document.createElement('button'); x.className = 'btn' + (primary ? ' primary' : ''); x.type = 'button'; x.textContent = txt; x.addEventListener('click', fn); row.append(x); };
  const size = new THREE.Box3().setFromObject(o).getSize(V());
  if (benchSel.kind === 'sprue') {
    const f = sprues.frames[benchSel.k], on = piecesOn(benchSel.k);
    head.textContent = `Sprue ${f.letter}`;
    add('Size', `${(f.x1 - f.x0).toFixed(0)} × ${(f.y1 - f.y0).toFixed(0)} mm`); add('Pieces on it', `${on.length}`);
    b('Export this sprue', () => exportSprues([benchSel.k]), true); b('Remove frame', () => removeSprue(benchSel.k));
  } else if (benchSel.kind === 'box') {
    head.textContent = kit.name + (kit.state === 'sealed' ? ' (sealed)' : ''); add('Kit box', `${kit.W.toFixed(0)} × ${kit.D.toFixed(0)} × ${kit.H.toFixed(0)} mm`);
    if (kit.artName) add('Box art', kit.artName); if (kit.pdfName) add('Instructions', kit.pdfName);
    if (kit.state === 'sealed') { add('Inside', `${sprues ? sprues.frames.length : 0} sprue${sprues?.frames.length === 1 ? '' : 's'}${kit.pdf ? ', instructions' : ''}`); b('Open the box', openBox, true); if (kit.image) b('Show box art', openArt); }
    else { if (kit.image) b('Show box art', openArt, true); if (kit.pdf) b('Open instructions', openBook); if (kit.state === 'open') b('Put the lid back on', closeLid); }
    b('Put the box away', () => putAway('box'));
  } else {
    head.textContent = 'Instructions'; add('File', kit.pdfName || '—'); if (book.n) add('Pages', String(book.n));
    b('Open', openBook, true); b('Put the instructions away', () => putAway('book'));
  }
  const sm = document.createElement('small'); sm.textContent = 'Move (G) slides it' + (benchSel.kind === 'sprue' ? ', pieces and all.' : '; Rotate (R) turns it.') + ' Delete removes it.'; head.append(sm);
  el.append(head, dl, row);
}
function updateButtons() {
  $('btn-undo').disabled = !undoStack.length; $('btn-redo').disabled = !redoStack.length;
  const any = liveParts().length > 0;
  $('exp-all').disabled = $('exp-each').disabled = !any; $('exp-sel').disabled = !selected;
  $('exp-sel').textContent = selection.length > 1 ? `${selection.length} selected + attached` : 'Selected + attached';
}
function updateStats() {
  const ps = liveParts(), tris = ps.reduce((s, p) => s + p.userData.part.tris, 0);
  $('stats').textContent = `${ps.length} parts · ${tris.toLocaleString()} tris · ${joints.filter(j => j.parent).length} joints`;
}

// skeleton: joint to joint lines, drawn every frame
function updateSkeleton() {
  const show = $('set-joints').checked, pts = [];
  if (show) for (const j of joints) {
    if (!j.parent || !isVisibleChain(j)) continue;
    const a = V().setFromMatrixPosition(j.matrixWorld);
    const fixedPart = j.parent, up = jointOf(fixedPart);
    const b = up ? V().setFromMatrixPosition(up.matrixWorld) : worldBox(fixedPart).getCenter(V());
    pts.push(b, a);
  }
  skeleton.geometry.setFromPoints(pts);
}

// ---------------------------------------------------------------------------
// Camera framing, layout, import, sample
// ---------------------------------------------------------------------------
function frame(box) {
  if (box.isEmpty()) return;
  const c = box.getCenter(V()), r = Math.max(box.getSize(V()).length() / 2, 5);
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(c); camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05);
  camera.near = r / 100; camera.far = r * 200; camera.updateProjectionMatrix();
}
function placeBeside(mesh) {
  const others = liveParts().filter(p => p !== mesh);
  if (!others.length) return;
  const sb = sceneBox(others), mb = worldBox(mesh);
  applyWorld(mesh, Tr(V(sb.max.x + 8 - mb.min.x, (sb.min.y + sb.max.y) / 2 - (mb.min.y + mb.max.y) / 2, -mb.min.z)));
}
/** New imports side by side as a screen-shaped block (golden ratio), beside whatever is already on the bench. */
function placeNew(list) {
  const ms = list.filter(m => m.parent === world); if (!ms.length) return;
  if (ms.length === 1) { placeBeside(ms[0]); return; }
  const others = liveParts().filter(p => !ms.includes(p) && !ms.some(m => isDescendant(p, m)));
  const boxes = ms.map(p => ({ p, b: worldBox(p) }))
    .sort((a, c) => (c.b.max.y - c.b.min.y) - (a.b.max.y - a.b.min.y) || a.p.name.localeCompare(c.p.name, undefined, { numeric: true }));
  const { pos, w, h } = goldenPack(boxes.map(({ b }) => ({ w: b.max.x - b.min.x, h: b.max.y - b.min.y })), 8);
  const sb = others.length ? sceneBox(others) : null, x0 = sb ? sb.max.x + 15 : -w / 2, yc = sb ? (sb.min.y + sb.max.y) / 2 : 0;
  boxes.forEach(({ p, b }, i) => applyWorld(p, Tr(V(x0 + pos[i].x - b.min.x, yc + h / 2 - pos[i].y - b.max.y, -b.min.z))));
}
function layOut() {
  const roots = liveParts().filter(p => p.parent === world);
  if (!roots.length) return;
  pushUndo(); lastOp = null;
  // rows of parts in a block about as wide as a screen (golden ratio), tallest first, copies side by side
  const boxes = roots.map(p => ({ p, b: worldBox(p) }))
    .sort((a, c) => (c.b.max.y - c.b.min.y) - (a.b.max.y - a.b.min.y) || a.p.name.localeCompare(c.p.name, undefined, { numeric: true }));
  const { pos, w, h } = goldenPack(boxes.map(({ b }) => ({ w: b.max.x - b.min.x, h: b.max.y - b.min.y })), 8);
  boxes.forEach(({ p, b }, i) => applyWorld(p, Tr(V(pos[i].x - w / 2 - b.min.x, h / 2 - pos[i].y - b.max.y, -b.min.z))));
  afterHierarchyChange(); fitMat(true); frame(sceneBox());
}
function applyAll(T, list) { list.forEach(p => applyWorld(p, T)); }

async function importFiles(files) {
  const list = [...files].filter(f => /\.stl$/i.test(f.name));
  if (!list.length) { toast("Only .stl files can be imported.", 'bad'); return; }
  await loadBatch(list.map(f => ({ file: f, path: f.name, name: f.name.replace(/\.stl$/i, ''), size: f.size })), null, project.name || 'Kit');
}
/** Load files with the loading popup for anything more than a couple; onto sprues with no box yet, they arrive sealed in a plain one. */
async function loadBatch(entries, src, name) {
  const mode = entries.length > 1 ? await askLoadMode(entries.length, src ? name : '', entries) : 'auto';
  if (!mode) { toast('Nothing loaded.'); return; }
  const kitMode = mode === 'kit', big = entries.length > 2 || kitMode;
  if (big) loading.show(kitMode ? `Packing ${name}` : `Loading ${entries.length} files`);
  try {
    const hadSprues = !!sprues;
    await loadGroup(entries, src, big ? { mode, progress: (f, t) => loading.set(f * 0.85, t) } : { mode });
    if (kitMode && sprues && (!kit || (kit.state !== 'open' && !hadSprues))) {
      loading.set(0.9, kit ? 'Packing the box…' : 'Printing the box…'); await nextFrame();
      if (kit) { kit.state = 'sealed'; kit.noBox = false; await buildKit(); }      // into the box: it comes back out if it was put away else await makeKit(name, [], liveParts().length, { always: true, state: 'sealed' });
      fitMat(true); select(null); frameBox(); markDirty();
      toast(`${name} is sealed in its box. Double-click the box to open it.`, 'ok');
    }
  } finally { if (big) loading.hide(); }
}
function frameBox() { const o = kitFx.getObjectByName('kit-box'); if (!o) return; o.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(o); b.expandByScalar(b.getSize(V()).length() * 0.45); frame(b); }
const nextFrame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60); });   // keeps going in a background tab

/**
 * Load STL entries. A single file goes beside what's on the bench. Several files keep their own
 * coordinates if they look exported in their assembled places (then Auto-assemble opens);
 * if they're all piled at the origin they're laid out side by side instead.
 */
async function loadGroup(entries, src, opts = {}) {
  pushUndo(); lastOp = null; closeAutorig(false);
  const progress = opts.progress || (() => {});
  const loader = new STLLoader(), added = [], failed = [], counted = []; let copies = 0;
  for (const [k, e] of entries.entries()) {
    e.state = 'loading'; renderFolderStatus();
    toast(`Loading ${k + 1} of ${entries.length}: ${e.name}`); progress(k / entries.length, `Reading ${e.name} (${k + 1} of ${entries.length})`);
    await nextFrame();
    try {
      const geom = loader.parse(await e.file.arrayBuffer());
      if (!geom.attributes.position || geom.attributes.position.count < 3) throw new Error('empty');
      const q = $('set-qty').checked ? parseQuantity(e.name) : { base: e.name, count: 1 };
      const m = addPart(q.count > 1 ? `${q.base} 1-${q.count}` : e.name, geom);
      m.userData.part.source = src ? { folder: src.id, path: e.path } : null;
      if (src?.offset) applyWorld(m, Tr(src.offset));
      e.partId = m.uuid; e.state = 'loaded'; added.push(m);
      for (let i = 2; i <= q.count; i++) {                 // "Leg x8": the kit needs 8 of these
        const c = addPart(`${q.base} ${i}-${q.count}`, m.geometry, { welded: true, geomKey: m.userData.part.geomKey, color: m.userData.part.color });
        c.userData.part.source = m.userData.part.source; c.matrix.copy(m.matrix); c.matrix.decompose(c.position, c.quaternion, c.scale);
        added.push(c); copies++;
      }
      if (q.count > 1) counted.push(`${q.base} ×${q.count}`);
    } catch (err) { e.state = 'failed'; failed.push(e.name); }
    renderFolderStatus();
  }
  if (!added.length) { afterHierarchyChange(); toast(`Couldn't read ${failed.join(', ')}. Check they're valid STL files.`, 'bad'); return; }
  const copyNote = counted.length ? ` Made copies from the file names: ${counted.join(', ')}.` : '';
  const mode = opts.mode || 'auto';
  // a kit on sprues: every new piece goes on the plastic
  if (mode === 'kit') {
    progress(1, 'Moulding the sprues…'); await nextFrame();
    layOnSprues(added);
    finishLoad(added, failed, `${added.length} piece${added.length > 1 ? 's' : ''} on ${sprues?.frames.length || 0} sprue${sprues?.frames.length === 1 ? '' : 's'}.${copyNote} Move or snap a piece to clip it off.`);
    return;
  }
  // which parts share a coordinate system with the new ones: everything loose from the same folder
  const group = src ? liveParts().filter(m => m.userData.part.source?.folder === src.id && !parentPart(m)) : added;
  const others = liveParts().filter(m => !group.includes(m));
  if (mode === 'spread' || (mode === 'auto' && (group.length < 2 || copies))) {     // copies sit on top of each other: spread them out
    placeNew(added);
    finishLoad(added, failed, (added.length > 1 ? `Loaded ${added.length} parts.` : `Loaded ${added[0].name}.`) + copyNote);
    return;
  }
  if (looksStacked(group)) {
    if (mode === 'asis') { finishLoad(added, failed, `Left where the files put them. They're each centred on the origin, so they overlap: Kit › Lay out parts spreads them.${copyNote}`); return; }
    placeNew(added);
    finishLoad(added, failed, `These files are each centred on the origin rather than placed where they fit, so they're laid out side by side. Snap them together by hand.`);
    return;
  }
  // assembled: keep their positions, but move the whole group clear of anything else on the bench
  if (others.length && !(src && src.offset)) {
    const gb = sceneBox(group), sb = sceneBox(others);
    const off = V(sb.max.x + 12 - gb.min.x, (sb.min.y + sb.max.y) / 2 - (gb.min.y + gb.max.y) / 2, sb.min.z - gb.min.z);
    group.forEach(m => applyWorld(m, Tr(off)));
    if (src) src.offset = off;
  } else if (src && !src.offset) src.offset = V();
  // only treat them as assembled if they actually touch: most loose kits are just scattered about
  const pairs = await findAllContacts(group);
  if (!pairs.length) {
    if (mode === 'asis') { finishLoad(added, failed, `Left where the files put them.${copyNote}`); return; }
    placeNew(added);
    finishLoad(added, failed, added.length > 1 ? 'None of these parts touch where they were exported, so they\'re laid out side by side. Snap them together by hand.' : `Loaded ${added[0].name}.`);
    return;
  }
  finishLoad(added, failed, null);
  Object.assign(ar, { meshes: group, pairs, root: null }); ar.plan = planRig(group, pairs);
  openAutorig({ auto: true });
}
function finishLoad(added, failed, msg) {
  afterHierarchyChange(); fitMat();
  select(added[added.length - 1]); frame(sceneBox());
  if (failed.length) toast(`Couldn't read ${failed.join(', ')}. Check they're valid STL files.`, 'bad');
  else if (msg) toast(msg, 'ok');
}

// ---------------------------------------------------------------------------
// Folder browser
// ---------------------------------------------------------------------------
const folder = { id: null, name: '', entries: [], offset: null };
const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

async function readDropped(entries) {          // walk dropped folders (readEntries returns batches)
  const out = [];
  const walk = async (en, prefix) => {
    if (en.isFile) { const file = await new Promise((res, rej) => en.file(res, rej)); out.push({ file, path: prefix + en.name }); return; }
    const reader = en.createReader();
    for (;;) { const batch = await new Promise((res, rej) => reader.readEntries(res, rej)); if (!batch.length) break;
      for (const c of batch) await walk(c, prefix + en.name + '/'); }
  };
  for (const en of entries) await walk(en, '');
  return out;
}
async function openFolder(list, name) {
  const depth = x => x.path.split('/').length;                 // the folder's own files first, then subfolders
  const stls = list.filter(x => /\.stl$/i.test(x.file.name))
    .sort((a, b) => (depth(a) > 2) - (depth(b) > 2) || a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
  if (!stls.length) { toast(`No STL files in ${name}.`, 'bad'); return; }
  // a fresh bench that only shows the untouched sample kit becomes this folder's project
  if (project.pristine) await newProject(name, true);
  const base = stls.map(x => x.file.name.replace(/\.stl$/i, ''));
  Object.assign(folder, { id: THREE.MathUtils.generateUUID(), name, offset: null });
  folder.entries = stls.map((x, k) => {
    const rel = x.path.split('/').slice(1).join('/') || x.file.name;          // path inside the folder
    const dup = base.filter(b => b === base[k]).length > 1;
    return { file: x.file, path: rel, dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', name: dup ? rel.replace(/\.stl$/i, '') : base[k],
             size: x.file.size, selected: true, state: null, partId: null, thumb: null };
  });
  $('tab-files').hidden = false; $('folder-name').textContent = name; $('folder-filter').value = '';
  renderFolder();
  const total = folder.entries.reduce((a, e) => a + e.size, 0);
  if (folder.entries.length <= 40 && total <= 200 * 1048576) {
    const mode = folder.entries.length > 1 ? await askLoadMode(folder.entries.length, name, folder.entries) : 'auto';
    if (!mode) {                                   // cancelled: the files are listed, nothing is loaded
      folder.entries.forEach(e => { e.selected = false; }); renderFolder(); showDockTab('tab-files');
      $('folder-note').textContent = 'Nothing loaded yet. Tick the files you want, then Load selected.'; toast(`Opened ${name}. Nothing loaded.`); return;
    }
    $('folder-note').textContent = 'Loaded every file. Untick any you don\'t want before loading more.';
    const onSprues = mode === 'kit';
    loading.show(onSprues ? `Packing ${name}` : `Opening ${name}`);
    try {
      await loadGroup(folder.entries.filter(e => e.selected), folder, { mode, progress: (f, t) => loading.set(f * 0.8, t) });
      const seal = onSprues && !!sprues && !kit;
      loading.set(0.85, seal ? 'Printing the box…' : 'Setting out the bench…'); await nextFrame();
      await makeKit(name, list, liveParts().length, seal ? { always: true, state: 'sealed' } : {}); fitMat(true);
      if (seal) { loading.set(0.96, 'Shrink-wrapping…'); await nextFrame(); select(null); frameBox(); toast(`${name} is sealed in its box${kit.pdf ? ' with the instructions' : ''}. Double-click the box to open it.`, 'ok'); }
      else if (kit) { frame(benchBox()); toast(`Opened the ${name} kit${kit.image ? ' box' : ''}${kit.pdf ? ' with its instructions. Click the booklet to read them' : ''}.`, 'ok'); }
      loading.set(1, 'Ready');
    } finally { loading.hide(); }
  } else {
    await makeKit(name, list, 0);
    folder.entries.forEach(e => { e.selected = false; }); renderFolder(); showDockTab('tab-files');     // you pick what to load, so the list comes to the front
    $('folder-note').textContent = `${folder.entries.length} files, ${fmtSize(total)} in all. Tick the ones you want, then Load selected.`;
    toast(`Opened ${name}. Pick the files to load.`);
  }
}
function renderFolder() {
  const box = $('folder-list'), q = $('folder-filter').value.trim().toLowerCase();
  box.innerHTML = '';
  let lastDir = null, shown = 0;
  for (const e of folder.entries) {
    if (q && !e.path.toLowerCase().includes(q)) continue;
    shown++;
    if (e.dir !== lastDir) { lastDir = e.dir; if (e.dir) { const g = document.createElement('div'); g.className = 'fgroup'; g.textContent = e.dir + '/'; box.append(g); } }
    const row = document.createElement('label'); row.className = 'frow'; row.setAttribute('role', 'listitem');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = e.selected; cb.setAttribute('aria-label', `Select ${e.name}`);
    cb.addEventListener('change', () => { e.selected = cb.checked; updateFolderButtons(); });
    const th = document.createElement(e.size > 30 * 1048576 ? 'div' : 'img');
    th.className = 'thumb' + (e.size > 30 * 1048576 ? ' big' : ''); th.alt = '';
    if (e.size > 30 * 1048576) th.textContent = 'large file'; else { if (e.thumb) th.src = e.thumb; else queueThumb(e, th); }
    const fn = document.createElement('span'); fn.className = 'fn'; fn.textContent = e.name;
    const fs = document.createElement('span'); fs.className = 'fs'; fs.textContent = fmtSize(e.size);
    const fp = document.createElement('span'); fp.className = 'fp'; fp.textContent = e.path;
    const chip = document.createElement('span'); chip.className = 'chip'; chip.hidden = true; e.chip = chip;
    chip.addEventListener('click', ev => { const m = liveParts().find(p => p.uuid === e.partId); if (m) { ev.preventDefault(); select(m); frame(sceneBox(subtreeParts(m))); } });
    row.append(cb, th, fn, fs, fp, chip); box.append(row);
  }
  if (!shown) box.innerHTML = '<div class="empty">No files match.</div>';
  renderFolderStatus(); updateFolderButtons();
}
function renderFolderStatus() {
  if ($('tab-files').hidden) return;
  const live = new Set(liveParts().map(m => m.uuid));
  let onBench = 0;
  for (const e of folder.entries) {
    if (e.state === 'loaded' && !live.has(e.partId)) e.state = null;     // deleted from the bench
    if (e.state === 'loaded') onBench++;
    if (!e.chip) continue;
    e.chip.hidden = !e.state;
    e.chip.className = 'chip' + (e.state === 'loading' ? ' busy' : e.state === 'failed' ? ' bad' : '');
    e.chip.textContent = e.state === 'loading' ? 'loading' : e.state === 'failed' ? "couldn't read" : 'on bench';
    e.chip.title = e.state === 'loaded' ? 'Click to select it on the bench' : '';
  }
  $('folder-count').textContent = `${onBench}/${folder.entries.length} on bench`;
  updateFolderButtons();
}
function updateFolderButtons() {
  const n = folder.entries.filter(e => e.selected && e.state !== 'loaded').length;
  $('folder-load').textContent = n ? `Load ${n} file${n > 1 ? 's' : ''}` : 'Load selected';
  $('folder-load').disabled = !n;
}

// thumbnails: rendered lazily, one at a time, with a small second renderer
let thumbR = null; const thumbQ = []; let thumbBusy = false;
const thumbIO = 'IntersectionObserver' in window ? new IntersectionObserver(list => {
  for (const it of list) if (it.isIntersecting) { thumbIO.unobserve(it.target); thumbQ.push(it.target._job); pumpThumbs(); }
}, { rootMargin: '80px' }) : null;
function queueThumb(e, img) { img._job = { e, img }; if (thumbIO) thumbIO.observe(img); else { thumbQ.push(img._job); pumpThumbs(); } }
async function pumpThumbs() {
  if (thumbBusy) return; thumbBusy = true;
  while (thumbQ.length) {
    const { e, img } = thumbQ.shift();
    if (!e.thumb) { try { e.thumb = await renderThumb(e.file); } catch (err) { e.thumb = ''; } }
    if (e.thumb && img.isConnected) img.src = e.thumb;
    await nextFrame();
  }
  thumbBusy = false;
}
async function renderThumb(file) {
  if (!thumbR) {
    thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.setSize(88, 88, false); thumbR.setPixelRatio(1);
  }
  const g = new STLLoader().parse(await file.arrayBuffer()); g.computeBoundingBox();
  const sc = new THREE.Scene(), b = g.boundingBox, c = b.getCenter(V()), r = Math.max(b.getSize(V()).length() / 2, 1e-3);
  sc.add(new THREE.HemisphereLight('#e8edf2', '#3a332c', 2.2));
  const d = new THREE.DirectionalLight('#ffffff', 1.4); d.position.set(1, -1.5, 2); sc.add(d);
  sc.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#b9b3a6', roughness: .7, flatShading: true })));
  const cam = new THREE.PerspectiveCamera(30, 1, r / 50, r * 20); cam.up.set(0, 0, 1);
  cam.position.copy(c).add(V(1, -1.3, 0.9).normalize().multiplyScalar(r / Math.sin(THREE.MathUtils.degToRad(15)) * 1.02)); cam.lookAt(c);
  thumbR.render(sc, cam);
  const url = thumbR.domElement.toDataURL('image/png');
  g.dispose(); return url;
}

// ---------------------------------------------------------------------------
// Auto-assemble: contacts -> joints and parent links
// ---------------------------------------------------------------------------
const ar = { meshes: [], pairs: [], plan: null, root: null, busy: false };
const rigPreview = new THREE.Group(); scene.add(rigPreview);
const KIND_LABEL = { ball: 'ball joint', socket: 'peg / socket', flat: 'flat contact' };

async function runAutorig(meshes, opts = {}) {
  if (ar.busy) return;
  if (meshes.length < 2) { toast('Auto-assemble needs at least two loose parts on the bench.'); return; }
  if (looksStacked(meshes)) {
    toast("These parts are piled on top of each other, each centred on the origin, so their positions don't say how they fit. Lay them out and snap them by hand.", 'bad');
    return;
  }
  ar.busy = true; ar.meshes = meshes; ar.root = null;
  ar.pairs = await findAllContacts(meshes); ar.busy = false;
  ar.plan = planRig(meshes, ar.pairs);
  openAutorig(opts);
}
async function findAllContacts(meshes) {
  const tol = Math.max(+$('ar-tol').value || 0.3, 0.01);
  const ctx = contactContext(meshes), pairs = [];
  const total = meshes.length * (meshes.length - 1) / 2; let done = 0, t0 = performance.now();
  for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) {
    done++;
    if (performance.now() - t0 > 120) { toast(`Finding where parts touch… ${done} of ${total} pairs`); await nextFrame(); t0 = performance.now(); }
    try { const c = contactBetween(ctx, i, j, tol); if (c) pairs.push(c); } catch (err) { console.warn('contact check failed', err); }
  }
  return pairs;
}
function openAutorig(opts = {}) {
  const { meshes, plan, pairs } = ar;
  $('autorig').hidden = false;
  const sel = $('ar-root'); sel.innerHTML = '';
  meshes.forEach((m, k) => { const o = document.createElement('option'); o.value = k; o.textContent = m.name; sel.append(o); });
  sel.value = plan.root;
  const joints = plan.edges.length;
  $('ar-sum').textContent = `${meshes.length} parts · ${pairs.length} contact${pairs.length === 1 ? '' : 's'}`;
  $('ar-note').textContent = !pairs.length
    ? `The files kept their own positions, but no two parts are within ${(+$('ar-tol').value).toFixed(2)} mm of each other. If they should fit together, raise the contact tolerance and detect again.`
    : `${opts.auto ? 'These files are already in their assembled places, so they kept their positions. ' : ''}Each part hangs off the neighbour it touches most. Check the connections, then build the rig.`;
  renderAutorigList();
  showRigPreview();
  $('ar-build').disabled = !joints;
  if (opts.auto && pairs.length) toast(`Found ${pairs.length} contact${pairs.length === 1 ? '' : 's'} between ${meshes.length} parts. Review them in Auto-assemble.`, 'ok');
}
function renderAutorigList() {
  const { meshes, plan } = ar, box = $('ar-list'); box.innerHTML = '';
  for (const [k, e] of plan.edges.entries()) {
    const row = document.createElement('div'); row.className = 'ar-row' + (e.how === 'skip' ? ' skip' : ''); row.setAttribute('role', 'listitem');
    const who = document.createElement('div'); who.className = 'who';
    const c = document.createElement('b'), arw = document.createElement('span'), pr = document.createElement('b');
    c.textContent = meshes[e.child].name; arw.className = 'arrow'; arw.textContent = '→'; pr.textContent = meshes[e.parent].name;
    who.append(c, arw, pr); who.title = `${meshes[e.child].name} attaches to ${meshes[e.parent].name}`;
    const meta = document.createElement('div'); meta.className = 'meta';
    const kd = document.createElement('span'); kd.className = 'kind ' + e.kind; kd.textContent = KIND_LABEL[e.kind] || e.kind;
    const info = document.createElement('span');
    info.textContent = e.kind === 'ball' && e.pair.radius ? `⌀${(e.pair.radius * 2).toFixed(2)} mm` : `≈${e.pair.area.toFixed(e.pair.area < 10 ? 1 : 0)} mm² contact`;
    meta.append(kd, info);
    const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', `How ${meshes[e.child].name} attaches`);
    for (const [v, t, tip] of [['joint', 'Joint', 'Rotates around this point in Pose'], ['plain', 'Fixed', 'Follows its parent, no joint'], ['skip', 'Skip', 'Leave it unattached']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = tip; b.setAttribute('aria-pressed', e.how === v ? 'true' : 'false');
      b.addEventListener('click', () => { e.how = v; renderAutorigList(); showRigPreview(); });
      seg.append(b);
    }
    row.append(who, seg, meta);
    row.addEventListener('mouseenter', () => showRigPreview(k));
    row.addEventListener('mouseleave', () => showRigPreview());
    row.addEventListener('dblclick', () => { const b = sceneBox([meshes[e.child], meshes[e.parent]]); frame(b); });
    box.append(row);
  }
  if (!plan.edges.length) box.innerHTML = '<div class="empty">No connections found.</div>';
  const extra = [];
  if (plan.loose.length) extra.push(`Not touching anything: ${plan.loose.map(k => meshes[k].name).join(', ')}.`);
  if (plan.roots.length - plan.loose.length > 1) extra.push(`${plan.roots.length - plan.loose.length} separate groups; each gets its own root.`);
  if (plan.loops.length) extra.push(`${plan.loops.length} weaker contact${plan.loops.length > 1 ? 's' : ''} left out, since each part has one parent.`);
  $('ar-extra').textContent = extra.join(' ');
  const n = plan.edges.filter(e => e.how !== 'skip').length;
  $('ar-build').textContent = n ? `Build rig (${n} link${n > 1 ? 's' : ''})` : 'Build rig';
  $('ar-build').disabled = !n;
}
function showRigPreview(hot = -1) {
  while (rigPreview.children.length) { const c = rigPreview.children.pop(); c.geometry?.dispose(); }
  if ($('autorig').hidden || !ar.plan) return;
  const { meshes, plan } = ar, sz = markerSize() * 1.6, pts = [], hotPts = [];
  plan.edges.forEach((e, k) => {
    if (e.how === 'skip') return;
    const pc = partBox(meshes[e.parent]).getCenter(V()), cc = partBox(meshes[e.child]).getCenter(V());
    (k === hot ? hotPts : pts).push(pc, e.joint, e.joint, cc);
    const m = new THREE.Mesh(new THREE.SphereGeometry(sz * (k === hot ? 1.6 : 1), 16, 10),
      new THREE.MeshBasicMaterial({ color: e.how === 'plain' ? '#8d969e' : '#d6a24a', depthTest: false, transparent: true, opacity: .95 }));
    m.position.copy(e.joint); m.renderOrder = 999; rigPreview.add(m);
    const ax = new THREE.Line(new THREE.BufferGeometry().setFromPoints([e.joint, e.joint.clone().addScaledVector(e.axis, sz * 6)]),
      new THREE.LineBasicMaterial({ color: '#f1d08f', depthTest: false })); ax.renderOrder = 999; rigPreview.add(ax);
  });
  for (const [list, color, op] of [[pts, '#d6a24a', .55], [hotPts, '#ffe066', 1]]) {
    if (!list.length) continue;
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(list), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: op }));
    l.renderOrder = 998; rigPreview.add(l);
  }
  paintSelection();
  if (hot >= 0) { const e = plan.edges[hot]; meshes[e.child].material.emissive.set('#0d2f3d'); meshes[e.parent].material.emissive.set('#3d200f'); }
}
function closeAutorig(clear = true) {
  $('autorig').hidden = true; showRigPreview();
  paintSelection();
  if (clear) { ar.plan = null; ar.meshes = []; ar.pairs = []; }
}
function buildRig() {
  const { meshes, plan } = ar; if (!plan) return;
  pushUndo(); lastOp = null;
  let joints = 0, fixed = 0; const warns = [];
  for (const e of plan.edges) {
    if (e.how === 'skip') continue;
    const w = attach(meshes[e.child], meshes[e.parent], e.how, e.joint, e.axis);
    if (w) warns.push(w); else if (e.how === 'joint') joints++; else fixed++;
  }
  const root = meshes[plan.root];
  closeAutorig(); afterHierarchyChange(); select(root);
  if (warns.length) toast(warns[0], 'bad');
  else toast(`Built the rig from ${root.name}: ${joints} joint${joints === 1 ? '' : 's'}${fixed ? `, ${fixed} fixed` : ''}. Press P to pose.`, 'ok');
}
function bindAutorig() {
  $('ar-root').addEventListener('change', () => {
    const keep = new Map(ar.plan.edges.map(e => [e.pair, e.how]));
    ar.plan = planRig(ar.meshes, ar.pairs, +$('ar-root').value);
    ar.plan.edges.forEach(e => { if (keep.has(e.pair) && keep.get(e.pair) === 'skip') e.how = 'skip'; });
    renderAutorigList(); showRigPreview();
  });
  $('ar-detect').addEventListener('click', () => runAutorig(ar.meshes.filter(m => m.parent)));
  $('ar-build').addEventListener('click', buildRig);
  $('ar-cancel').addEventListener('click', () => { closeAutorig(); toast('Left the parts where they are, unattached.'); });
  $('ar-close').addEventListener('click', () => closeAutorig());
  $('btn-autorig').addEventListener('click', () => {
    // several parts selected: just those; otherwise every loose part on the bench
    const list = selection.length > 1 ? [...selection] : liveParts().filter(m => !parentPart(m) && isVisibleChain(m));
    runAutorig(list);
  });
  // folder
  const fi = $('folder-input');
  if (!('webkitdirectory' in fi)) { $('btn-folder').hidden = true; }
  $('btn-folder').addEventListener('click', () => fi.click());
  fi.addEventListener('change', () => {
    const files = [...fi.files]; fi.value = '';
    if (!files.length) return;
    const name = (files[0].webkitRelativePath || '').split('/')[0] || 'Folder';
    openFolder(files.map(f => ({ file: f, path: f.webkitRelativePath || f.name })), name);
  });
  $('folder-filter').addEventListener('input', renderFolder);
  $('folder-all').addEventListener('click', () => { folder.entries.forEach(e => { e.selected = true; }); renderFolder(); });
  $('folder-none').addEventListener('click', () => { folder.entries.forEach(e => { e.selected = false; }); renderFolder(); });
  $('folder-load').addEventListener('click', () => {
    const list = folder.entries.filter(e => e.selected && e.state !== 'loaded');
    if (list.length) loadBatch(list, folder, folder.name);
  });
}
function loadSample() {
  pushUndo(); lastOp = null;
  for (const s of sampleKit()) addPart(s.name, s.geom, { at: s.at, rot: s.rot });
  afterHierarchyChange(); fitMat(true); frame(sceneBox());
  toast("Sample kit loaded. Try Ball: click the arm's ball, then the cup on the body's shoulder.", 'ok');
}

// ---------------------------------------------------------------------------
// Export (zip of binary STLs through the viewer's save dialog)
// ---------------------------------------------------------------------------
const safe = s => s.replace(/[^\w\- .]+/g, '_').trim() || 'part';
async function deliver(files, zipName) {
  const inViewer = !!(window.claude && window.claude.use);
  const dl = inViewer ? await window.claude.use('downloads').catch(() => null) : null;
  if (!inViewer && files.length === 1) return saveViaLink(new Blob([files[0].data], { type: 'model/stl' }), files[0].name);
  if (typeof JSZip === 'undefined') { toast("The zip library didn't load. Check your connection and reload.", 'bad'); return; }
  const zip = new JSZip(); files.forEach(f => zip.file(f.name, f.data));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  if (dl) {
    try { await dl.save({ filename: zipName, data: blob }); toast(`Saved ${zipName}`, 'ok'); }
    catch (e) { if (e?.code !== 'declined') toast(`Couldn't save: ${e?.message || e?.code || 'unknown error'}`, 'bad'); }
    return;
  }
  if (inViewer) { toast("Saving files isn't available in this view. Open the artifact in claude.ai to export.", 'bad'); return; }
  saveViaLink(blob, zipName);
}
function saveViaLink(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); toast(`Saved ${name}`, 'ok');
}
function exportMeshes() { scene.updateMatrixWorld(true); return liveParts().filter(p => isVisibleChain(p)); }
const fillOpts = () => ({ maxGap: Math.max(+$('exp-gap').value || 0.5, 0.01), overlap: Math.max(+$('exp-overlap').value || 0, 0) });
/** A stand-in mesh holding a part's filled corners in world space (same triangles; mirrored parts keep their winding). */
function filledMesh(m, positions) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const ix = Uint32Array.from(m.geometry.index.array);
  if (m.matrixWorld.determinant() < 0) for (let t = 0; t < ix.length; t += 3) { const k = ix[t+1]; ix[t+1] = ix[t+2]; ix[t+2] = k; }
  g.setIndex(new THREE.BufferAttribute(ix, 1)); const out = new THREE.Mesh(g); out.updateMatrixWorld(true); return out;
}
/** One STL of these parts, with the seams filled if that option is on. */
async function oneSTL(ms) {
  // hollow pockets first, on the parts as they are: the filler goes in as one more solid
  let extra = [], pnote = '';
  if ($('exp-pockets').checked) {
    const r = await runPockets('Filling hollow pockets', ms);
    if (r?.geometry) { const f = new THREE.Mesh(r.geometry); f.updateMatrixWorld(true); extra = [f]; }
    if (r) pnote = (r.pockets ? `Filled ${pocketSummary(r).replace(/^\d+ sealed/, m => m.toLowerCase())}.` : 'No sealed pockets to fill.') + ' ';
  }
  if (!$('exp-fill').checked || ms.length < 2) { const cut = await cutMagnetHoles(ms, ms); return { data: writeSTL([...cut.meshes, ...extra]), note: pnote + cut.note }; }
  toast('Filling seams…'); await nextFrame();
  const { out, stats } = fillSeamsAll(ms, fillOpts());
  const left = gapsLeft(ms, out, fillOpts().maxGap * 2);
  const note = stats.moved ? `Filled ${stats.seams} seam${stats.seams === 1 ? '' : 's'}: pushed ${stats.moved.toLocaleString()} corners by up to ${stats.largest.toFixed(2)} mm.` : 'No seams within reach to fill.';
  const cut = await cutMagnetHoles(ms.map((m, k) => filledMesh(m, out[k].positions)), ms);
  return { data: writeSTL([...cut.meshes, ...extra]), note: pnote + cut.note + note + (left.open ? ` ${left.open} spot${left.open > 1 ? 's' : ''} have gaps wider than ${fillOpts().maxGap} mm; raise "Close gaps up to" to fill them.` : '') };
}
$('exp-all').addEventListener('click', async () => {
  const ms = exportMeshes(); if (!ms.length) return;
  const { data, note } = await oneSTL(ms); if (note) $('exp-note').textContent = note;
  deliver([{ name: 'model.stl', data }], 'model-stl.zip');
});
$('exp-sel').addEventListener('click', async () => {
  if (!selected) return; scene.updateMatrixWorld(true);
  const roots = selection.length ? selectionRoots() : [selected], ms = [...new Set(roots.flatMap(subtreeParts))].filter(isVisibleChain);
  const name = roots.length > 1 ? 'selection' : safe(selected.name);
  const { data, note } = await oneSTL(ms); if (note) $('exp-note').textContent = note;
  deliver([{ name: name + '.stl', data }], name + '-stl.zip');
});

// ---------------------------------------------------------------------------
// Hollow pockets: air sealed inside the model. Found on a voxel grid of all the parts together (inside where
// two of three ray directions agree), the outside air flooded in from the edges; whatever air it can't reach
// is a pocket. The filler fills each pocket and overlaps one cell into the parts round it. Parts don't change.
// ---------------------------------------------------------------------------
async function findPockets(ms, h, progress = () => {}, opts = {}) {
  scene.updateMatrixWorld(true);
  const bb = new THREE.Box3(); ms.forEach(m => bb.union(exactBox(m))); if (bb.isEmpty()) return null;
  let size = bb.getSize(V());
  while ((size.x / h + 5) * (size.y / h + 5) * (size.z / h + 5) > 30e6) h *= 1.25;          // keep the grid in memory
  bb.expandByScalar(2 * h); size = bb.getSize(V());
  const n = [Math.ceil(size.x / h) + 1, Math.ceil(size.y / h) + 1, Math.ceil(size.z / h) + 1], [nx, ny, nz] = n, N = nx * ny * nz;
  const at = (i, j, k) => i + nx * (j + ny * k), o = bb.min, votes = new Uint8Array(N), stamp = new Uint8Array(N);
  const parts = ms.map(m => ({ m, inv: m.matrixWorld.clone().invert(), box: exactBox(m) }));
  const ray = new THREE.Ray(), wp = V(); let done = 0, lastYield = performance.now(); const total = 3;
  for (let ax = 0; ax < 3; ax++) {                       // columns along x, then y, then z
    const u = (ax + 1) % 3, w = (ax + 2) % 3, dir = V(); dir.setComponent(ax, 1);
    for (const P of parts) {
      const u0 = Math.max(0, Math.floor((P.box.min.getComponent(u) - o.getComponent(u)) / h)), u1 = Math.min(n[u] - 1, Math.ceil((P.box.max.getComponent(u) - o.getComponent(u)) / h));
      const w0 = Math.max(0, Math.floor((P.box.min.getComponent(w) - o.getComponent(w)) / h)), w1 = Math.min(n[w] - 1, Math.ceil((P.box.max.getComponent(w) - o.getComponent(w)) / h));
      const bvh = P.m.geometry.boundsTree, ldir = dir.clone().transformDirection(P.inv);
      for (let a = u0; a <= u1; a++) {
        for (let c = w0; c <= w1; c++) {
          const org = V(); org.setComponent(ax, o.getComponent(ax) - h); org.setComponent(u, o.getComponent(u) + a * h); org.setComponent(w, o.getComponent(w) + c * h);
          ray.origin.copy(org).applyMatrix4(P.inv); ray.direction.copy(ldir);
          const hits = bvh.raycast(ray, THREE.DoubleSide); if (hits.length < 2 || hits.length % 2) continue;   // open or touching: no say here
          const ts = hits.map(x => wp.copy(x.point).applyMatrix4(P.m.matrixWorld).getComponent(ax)).sort((p, q) => p - q);
          for (let k = 0; k + 1 < ts.length; k += 2) {
            const i0 = Math.max(0, Math.ceil((ts[k] - o.getComponent(ax)) / h)), i1 = Math.min(n[ax] - 1, Math.floor((ts[k + 1] - o.getComponent(ax)) / h));
            for (let t = i0; t <= i1; t++) { const idx = [0, 0, 0]; idx[ax] = t; idx[u] = a; idx[w] = c; const v = at(idx[0], idx[1], idx[2]);
              if (stamp[v] !== ax + 1) { stamp[v] = ax + 1; votes[v]++; } }
          }
        }
        if (performance.now() - lastYield > 120) { progress((done + (a - u0) / Math.max(1, u1 - u0) / parts.length) / total * 0.8, 'Measuring the solid…'); await nextFrame(); lastYield = performance.now(); }
      }
    }
    done++;
  }
  const solid = new Uint8Array(N); for (let v = 0; v < N; v++) solid[v] = votes[v] >= 2 ? 1 : 0;
  // flood the outside air in from the edges of the grid. Resin can't drain through a crack, so the flood only
  // passes where the opening is at least `drain` mm wide; then it spreads back that far into the narrow bits it skipped.
  progress(0.85, 'Letting the air out…'); await nextFrame();
  const outside = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
  const sx0 = 1, sy0 = nx, sz0 = nx * ny, R = Math.max(0, Math.round((opts.drain ?? 1) / 2 / h));
  const near = new Uint8Array(N);                      // air within R cells of the solid: too tight for the flood to pass
  if (R > 0) {
    const d = new Uint8Array(N).fill(255); for (let v = 0; v < N; v++) if (solid[v]) { d[v] = 0; q[qt++] = v; }
    while (qh < qt) { const v = q[qh++], dv = d[v]; if (dv >= R) continue; near[v] = 1;
      const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / sz0);
      for (const [ok, w] of [[i > 0, v - sx0], [i < nx - 1, v + sx0], [j > 0, v - sy0], [j < ny - 1, v + sy0], [k > 0, v - sz0], [k < nz - 1, v + sz0]])
        if (ok && d[w] > dv + 1) { d[w] = dv + 1; q[qt++] = w; } }
    qh = qt = 0;
  }
  const seed = v => { if (!solid[v] && !outside[v] && !near[v]) { outside[v] = 1; q[qt++] = v; } };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { seed(at(i, j, 0)); seed(at(i, j, nz - 1)); }
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { seed(at(i, 0, k)); seed(at(i, ny - 1, k)); }
  for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) { seed(at(0, j, k)); seed(at(nx - 1, j, k)); }
  const sx = 1, sy = nx, sz = nx * ny;
  while (qh < qt) { const v = q[qh++], i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / sz);
    if (i > 0) seed(v - sx); if (i < nx - 1) seed(v + sx); if (j > 0) seed(v - sy); if (j < ny - 1) seed(v + sy); if (k > 0) seed(v - sz); if (k < nz - 1) seed(v + sz); }
  if (R > 0) {                                          // spread back R cells into the tight air next to the outside
    const depth = new Uint8Array(N); qh = 0; qt = 0; for (let v = 0; v < N; v++) if (outside[v]) q[qt++] = v;
    while (qh < qt) { const v = q[qh++]; if (depth[v] >= R) continue; const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / sz);
      for (const [ok, w] of [[i > 0, v - sx], [i < nx - 1, v + sx], [j > 0, v - sy], [j < ny - 1, v + sy], [k > 0, v - sz], [k < nz - 1, v + sz]])
        if (ok && !solid[w] && !outside[w]) { outside[w] = 1; depth[w] = depth[v] + 1; q[qt++] = w; } }
  }
  // pockets: air the outside can't reach. Count them, and fill each plus one cell into the parts around it.
  progress(0.92, 'Filling the pockets…'); await nextFrame();
  const fill = new Uint8Array(N), label = new Int32Array(N); let cells = 0, pockets = 0, biggest = 0;
  for (let v = 0; v < N; v++) {
    if (solid[v] || outside[v] || label[v]) continue;
    pockets++; let c = 0; qh = qt = 0; q[qt++] = v; label[v] = pockets;
    while (qh < qt) { const x = q[qh++]; c++; fill[x] = 1; const i = x % nx, j = Math.floor(x / nx) % ny, k = Math.floor(x / sz);
      for (const [ok, y] of [[i > 0, x - sx], [i < nx - 1, x + sx], [j > 0, x - sy], [j < ny - 1, x + sy], [k > 0, x - sz], [k < nz - 1, x + sz]])
        if (ok && !solid[y] && !outside[y] && !label[y]) { label[y] = pockets; q[qt++] = y; } }
    if (c < 8 || c * h ** 3 < 1) { for (let y = 0; y < qt; y++) fill[q[y]] = 0; pockets--; continue; }      // a speck (under 1 mm³): ray directions disagreeing in a wall, or too small to matter
    cells += c; biggest = Math.max(biggest, c);
  }
  if (!pockets) return { pockets: 0, volume: 0, biggest: 0, h, geometry: null };
  const grow = new Uint8Array(fill);
  const nearOutside = y => [y - sx, y + sx, y - sy, y + sy, y - sz, y + sz].some(z => z >= 0 && z < N && outside[z]);
  for (let v = 0; v < N; v++) if (fill[v]) { for (const y of [v - sx, v + sx, v - sy, v + sy, v - sz, v + sz]) if (y >= 0 && y < N && solid[y] && !nearOutside(y)) grow[y] = 1; }   // into the walls, never through to the outside
  // the filler's skin: a square face wherever a filled cell meets an unfilled one
  const pos = []; const cube = (i, j, k, d) => {
    const x0 = o.x + (i - 0.5) * h, y0 = o.y + (j - 0.5) * h, z0 = o.z + (k - 0.5) * h, x1 = x0 + h, y1 = y0 + h, z1 = z0 + h;
    const F = [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
               [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]][d];
    pos.push(...F[0], ...F[1], ...F[2], ...F[0], ...F[2], ...F[3]); };
  for (let v = 0; v < N; v++) { if (!grow[v]) continue; const i = v % nx, j = Math.floor(v / nx) % ny, k = Math.floor(v / sz);
    [[i > 0 ? v - sx : -1, 0], [i < nx - 1 ? v + sx : -1, 1], [j > 0 ? v - sy : -1, 2], [j < ny - 1 ? v + sy : -1, 3], [k > 0 ? v - sz : -1, 4], [k < nz - 1 ? v + sz : -1, 5]]
      .forEach(([y, d]) => { if (y < 0 || !grow[y]) cube(i, j, k, d); }); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(Array.from({ length: pos.length / 3 }, (_, i) => i));
  return { pockets, volume: cells * h ** 3, biggest: biggest * h ** 3, h, geometry: g };
}
const pocketFx = new THREE.Group(); scene.add(pocketFx);
function clearPocketPreview() { while (pocketFx.children.length) { const c = pocketFx.children.pop(); c.geometry?.dispose(); } $('exp-pocket-show').setAttribute('aria-pressed', 'false'); $('exp-pocket-show').textContent = 'Show pockets'; }
const pocketSummary = r => r.pockets ? `${r.pockets} sealed pocket${r.pockets > 1 ? 's' : ''}, ${r.volume < 1 ? r.volume.toFixed(2) : r.volume.toFixed(0)} mm³ in all (largest ${r.biggest < 1 ? r.biggest.toFixed(2) : r.biggest.toFixed(0)} mm³)` : 'No sealed pockets';
async function runPockets(title, ms = exportMeshes()) {
  if (!ms.length) return null;
  loading.show(title);
  try { return await findPockets(ms, +$('exp-pocket-res').value, (f, t) => loading.set(f, t), { drain: Math.max(0, +$('exp-pocket-drain').value || 0) }); }
  finally { loading.hide(); }
}
async function showPocketPreview() {
  clearPocketPreview();
  const r = await runPockets('Looking for hollow pockets'); if (!r) return;
  $('exp-pocket-note').textContent = `${pocketSummary(r)}, checked at ${r.h.toFixed(2)} mm.` + (r.pockets ? ' Shown in red through the model; exports with this option on fill them solid.' : ' Nothing to fill.');
  toast(pocketSummary(r) + '.', r.pockets ? 'bad' : 'ok');
  if (!r.geometry) return;
  const m = new THREE.Mesh(r.geometry, new THREE.MeshBasicMaterial({ color: '#e36b6b', transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  m.renderOrder = 998; pocketFx.add(m);
  $('exp-pocket-show').setAttribute('aria-pressed', 'true'); $('exp-pocket-show').textContent = 'Hide pockets';
}

// ---------------------------------------------------------------------------
// Magnets: a pair of round holes, one in each part, facing each other across where they meet. Each hole is
// kept in its own part's frame, so it moves and poses with the part; holes are cut only when exporting.
// ---------------------------------------------------------------------------
let magnets = [];       // [{ id, d, t, cd, ct, sides: [{ part, o: local point, n: local outward normal, pole: 'N'|'S' }] }]
const magnetFx = new THREE.Group(); scene.add(magnetFx);
const magSize = () => ({ d: Math.max(0.5, +$('mag-d').value || 3), t: Math.max(0.3, +$('mag-t').value || 2), cd: Math.max(0, +$('mag-cd').value || 0), ct: Math.max(0, +$('mag-ct').value || 0) });
const magLabel = mg => `${+mg.d.toFixed(2)} × ${+mg.t.toFixed(2)} mm`;
let magPending = null;
function toLocal(part, p, n) { part.updateMatrixWorld(true); const inv = part.matrixWorld.clone().invert(); return { o: p.clone().applyMatrix4(inv).toArray(), n: n.clone().transformDirection(inv).toArray() }; }
function sideWorld(sd) { const m = partById(sd.part); if (!m) return null; m.updateMatrixWorld(true); return { m, o: V(...sd.o).applyMatrix4(m.matrixWorld), n: V(...sd.n).transformDirection(m.matrixWorld).normalize() }; }
const hitNormal = hit => hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
/** How much part is left behind a hole of this depth (the wall to the far side). */
function wallBehind(m, o, n, depth) {
  const rc = new THREE.Raycaster(o.clone().addScaledVector(n, -0.01), n.clone().negate(), 0, depth + 5); rc.firstHitOnly = true;
  const h = rc.intersectObject(m, false)[0]; return h ? h.distance + 0.01 : Infinity;
}
function addMagnet(sides) {
  const sz = magSize(); pushUndo();
  const mg = { id: uid(), ...sz, sides: sides.map((sd, k) => ({ part: sd.m.uuid, ...toLocal(sd.m, sd.o, sd.n), pole: k ? 'S' : 'N' })) };
  magnets.push(mg); markDirty(); rebuildMagnets(); renderPartPanel();
  const depth = sz.t + sz.ct, thin = sides.filter(sd => wallBehind(sd.m, sd.o, sd.n, depth) < depth + 0.6).map(sd => sd.m.name);
  const what = sides.length > 1 ? `between ${sides[0].m.name} and ${sides[1].m.name}` : `in ${sides[0].m.name}`;
  toast(thin.length ? `Magnet ${magLabel(mg)} ${what}, but ${thin.join(' and ')} ${thin.length > 1 ? 'are' : 'is'} too thin there: the hole would break through or leave under 0.6 mm. Try a thinner magnet or another spot.`
                    : `Magnet ${magLabel(mg)} ${what}: holes ${(sz.d + sz.cd).toFixed(2)} mm wide, ${depth.toFixed(2)} mm deep.`, thin.length ? 'bad' : 'ok');
}
function handleMagnetClick(hit) {
  if (!hit) { toast('Missed. Click on a part where it meets another.'); return; }
  const m = hit.object, p = hit.point.clone(), n = hitNormal(hit);
  if (magPending) {                               // second click: the part it fits against
    if (m === magPending.m) { toast(`That's ${m.name} again. Click the part it fits against.`, 'bad'); return; }
    const a = magPending; magPending = null; updateStep();
    // touching? then the pair goes where they really meet (that face is usually hidden once assembled), nearest the first click
    let c = null; try { c = contactBetween(contactContext([a.m, m]), 0, 1, Math.max(+$('ar-tol').value || 0.3, 0.05)); } catch (e) { c = null; }
    if (c) {
      const at = V().copy(c.centre || c.joint), dir = (c.nOut?.[0]?.lengthSq() > 1e-9 ? c.nOut[0].clone() : V(0, 0, 1)).normalize();      // out of the first part, toward the second
      if (worldBox(m).getCenter(V()).sub(worldBox(a.m).getCenter(V())).dot(dir) < 0) dir.negate();       // from the first part toward the second
      const surf = (part, from, d) => { const rc = new THREE.Raycaster(from, d, 0, 8); rc.firstHitOnly = true; return rc.intersectObject(part, false)[0]?.point || null; };
      const pa = surf(a.m, at.clone().addScaledVector(dir, 3), dir.clone().negate()) || at, pb = surf(m, at.clone().addScaledVector(dir, -3), dir) || at;
      addMagnet([{ m: a.m, o: pa, n: dir.clone() }, { m, o: pb, n: dir.clone().negate() }]); return;
    }
    addMagnet([a, { m, o: p, n }]); return;
  }
  // where it meets another part: look across the surface for the other part's face, within 2 mm (or a little overlap)
  const others = liveParts().filter(x => x !== m && isVisibleChain(x) && !boxed(x));
  const rc = new THREE.Raycaster(p.clone().addScaledVector(n, -0.6), n, 0, 2.6); rc.firstHitOnly = true;
  const h2 = rc.intersectObjects(others, false)[0];
  if (h2) addMagnet([{ m, o: p, n }, { m: h2.object, o: h2.point.clone(), n: n.clone().negate() }]);
  else { magPending = { m, o: p, n }; updateStep(); $('step-text').textContent = `No part touches ${m.name} there. Click the spot on the part it fits against (Esc to cancel)`; rebuildMagnets(); }
}
function holeGeometry(mg, o, n, extraOut = 0.3) {      // a cylinder from just outside the surface down to the hole's depth
  const r = (mg.d + mg.cd) / 2, depth = mg.t + mg.ct, len = depth + extraOut;
  const g = new THREE.CylinderGeometry(r, r, len, Math.max(24, Math.min(64, Math.round(r * 20))), 1, false);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g.translate(0, (extraOut - depth) / 2, 0);                                         // its top sits extraOut above the surface
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n)); g.translate(o.x, o.y, o.z);
  return g;
}
function rebuildMagnets() {
  while (magnetFx.children.length) { const c = magnetFx.children.pop(); c.geometry?.dispose(); c.material?.dispose?.(); }
  magnets = magnets.filter(mg => { mg.sides = mg.sides.filter(sd => partById(sd.part)); return mg.sides.length; });
  const items = magnets.flatMap(mg => mg.sides.map(sd => ({ mg, sd })));
  if (magPending) items.push({ mg: { ...magSize() }, sd: null, pend: magPending });
  for (const { mg, sd, pend } of items) {
    const w = pend || sideWorld(sd); if (!w || !isVisibleChain(w.m)) continue;
    const body = new THREE.Mesh(holeGeometry(mg, w.o, w.n, 0.05), new THREE.MeshBasicMaterial({ color: pend ? '#d6a24a' : sd.pole === 'N' ? '#d2716c' : '#6fa3dd', transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }));
    body.name = 'magnet-hole'; body.renderOrder = 997; body.raycast = () => {}; magnetFx.add(body);
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 40 }, (_, i) => { const a = i / 40 * Math.PI * 2; return V(Math.cos(a), Math.sin(a), 0).multiplyScalar((mg.d + mg.cd) / 2); })),
      new THREE.LineBasicMaterial({ color: '#f1d08f', depthTest: false })); ring.position.copy(w.o).addScaledVector(w.n, 0.02); ring.quaternion.setFromUnitVectors(V(0, 0, 1), w.n);
    ring.renderOrder = 998; ring.raycast = () => {}; magnetFx.add(ring);
  }
}
/** Each part's magnet rows in its Properties: size, partner, resize, remove. */
function magnetRows(p, el) {
  const mine = magnets.filter(mg => mg.sides.some(sd => sd.part === p.uuid)); if (!mine.length) return;
  const box = document.createElement('div'); box.className = 'mag-list';
  const h = document.createElement('div'); h.className = 'opt-sub'; h.textContent = `Magnets (${mine.length})`; box.append(h);
  for (const mg of mine) {
    const other = mg.sides.find(sd => sd.part !== p.uuid), row = document.createElement('div'); row.className = 'mag-row';
    const t = document.createElement('span'); t.textContent = `${magLabel(mg)} · hole ${(mg.d + mg.cd).toFixed(2)} × ${(mg.t + mg.ct).toFixed(2)}${other ? ` · ${partById(other.part)?.name}` : ''}`;
    const bt = (txt, title, fn) => { const x = document.createElement('button'); x.className = 'btn'; x.type = 'button'; x.textContent = txt; x.title = title; x.addEventListener('click', fn); return x; };
    row.append(t, bt('Use bar size', `Give this pair the size and fit set in the Magnet tool's bar`, () => { pushUndo(); Object.assign(mg, magSize()); markDirty(); rebuildMagnets(); renderPartPanel(); toast(`That magnet is now ${magLabel(mg)}.`); }),
               bt('Remove', 'Remove this pair of holes', () => { pushUndo(); magnets = magnets.filter(x => x !== mg); markDirty(); rebuildMagnets(); renderPartPanel(); toast('Removed the magnet.'); }));
    box.append(row);
  }
  el.append(box);
}
/** At export: the holes cut into copies of the parts that carry magnets (meshes[i] is the export copy of parts[i]). */
async function cutMagnetHoles(meshes, parts) {
  const todo = parts.map((m, i) => ({ i, m, sides: magnets.flatMap(mg => mg.sides.filter(sd => sd.part === m.uuid).map(sd => ({ mg, sd }))) })).filter(x => x.sides.length);
  if (!todo.length) return { meshes, note: '' };
  let CSG; try { CSG = await import('three-bvh-csg'); } catch (e) { return { meshes, note: "Magnet holes weren't cut: the hole-cutting tool didn't load. Check your connection. " }; }
  loading.show('Cutting magnet holes'); const out = meshes.slice(); let holes = 0, failed = [];
  try {
    const ev = new CSG.Evaluator(); ev.attributes = ['position']; ev.useGroups = false;
    for (const [k, { i, m, sides }] of todo.entries()) {
      loading.set(k / todo.length, `${m.name}: ${sides.length} hole${sides.length > 1 ? 's' : ''}`); await nextFrame();
      try {
        const src = meshes[i]; src.updateMatrixWorld(true);
        const g0 = src.geometry, pos = g0.attributes.position, wpos = new Float32Array(pos.count * 3), v = V();
        for (let j = 0; j < pos.count; j++) { v.fromBufferAttribute(pos, j).applyMatrix4(src.matrixWorld); wpos.set([v.x, v.y, v.z], 3 * j); }
        let geom = new THREE.BufferGeometry(); geom.setAttribute('position', new THREE.BufferAttribute(wpos, 3));
        const ix = Uint32Array.from(g0.index.array); if (src.matrixWorld.determinant() < 0) for (let t = 0; t < ix.length; t += 3) { const tmp = ix[t+1]; ix[t+1] = ix[t+2]; ix[t+2] = tmp; }
        geom.setIndex(new THREE.BufferAttribute(ix, 1));
        let brush = new CSG.Brush(geom); brush.updateMatrixWorld();
        for (const { mg, sd } of sides) {
          const w = sideWorld(sd); const hole = new CSG.Brush(mergeVertices(holeGeometry(mg, w.o, w.n))); hole.updateMatrixWorld();
          brush = ev.evaluate(brush, hole, CSG.SUBTRACTION); holes++;
        }
        const res = new THREE.Mesh(brush.geometry); res.updateMatrixWorld(true); out[i] = res;
      } catch (e) { console.warn(e); failed.push(m.name); }
    }
  } finally { loading.hide(); }
  return { meshes: out, note: `Cut ${holes} magnet hole${holes === 1 ? '' : 's'}.` + (failed.length ? ` Couldn't cut into ${failed.join(', ')} (its mesh may not be closed); exported without.` : '') + ' ' };
}
function bindMagnets() {
  const SIZE = () => $('mag-size').value;
  $('mag-size').addEventListener('change', () => { if (SIZE() === 'custom') return; const [d, t] = SIZE().split('x').map(Number); $('mag-d').value = d; $('mag-t').value = t; rebuildMagnets(); });
  ['mag-d', 'mag-t'].forEach(id => $(id).addEventListener('change', () => { const v = `${+$('mag-d').value}x${+$('mag-t').value}`; $('mag-size').value = [...$('mag-size').options].some(o => o.value === v) ? v : 'custom'; rebuildMagnets(); }));
  $('mag-fit').addEventListener('change', () => { const f = { resin: 0.15, fdm: 0.3 }[$('mag-fit').value]; if (f != null) { $('mag-cd').value = f; $('mag-ct').value = f; } });
  ['mag-cd', 'mag-ct'].forEach(id => $(id).addEventListener('change', () => { const a = +$('mag-cd').value, b = +$('mag-ct').value; $('mag-fit').value = a === b && a === 0.15 ? 'resin' : a === b && a === 0.3 ? 'fdm' : 'custom'; }));
  $('mag-apply').addEventListener('click', () => { if (!magnets.length) { toast('No magnets yet. Click where two parts meet.'); return; }
    pushUndo(); magnets.forEach(mg => Object.assign(mg, magSize())); markDirty(); rebuildMagnets(); renderPartPanel(); toast(`All ${magnets.length} magnet${magnets.length > 1 ? 's are' : ' is'} now ${magLabel(magSize())}.`, 'ok'); });
}

// seam preview: amber where surfaces will be pushed, red where a gap is too wide to fill
const seamFx = new THREE.Group(); scene.add(seamFx);
function clearSeamPreview() { while (seamFx.children.length) { const c = seamFx.children.pop(); c.geometry?.dispose(); } $('exp-preview').setAttribute('aria-pressed', 'false'); $('exp-preview').textContent = 'Show seams'; }
async function showSeamPreview() {
  const ms = exportMeshes(); if (ms.length < 2) { toast('Fill seams needs at least two parts.'); return; }
  toast('Finding seams…'); await nextFrame();
  const o = fillOpts(), { out, stats } = fillSeamsAll(ms, o), wide = gapsLeft(ms, out, o.maxGap * 2);
  clearSeamPreview();
  const pts = [];
  ms.forEach((m, k) => { const P = out[k].positions, mv = out[k].moved; for (let i = 0; i < mv.length; i++) if (mv[i] > 0) pts.push(P[3*i], P[3*i+1], P[3*i+2]); });
  const dots = (arr, color, size) => { if (!arr.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false })); p.renderOrder = 999; seamFx.add(p); };
  dots(pts, '#d6a24a', 3); dots(wide.spots.flatMap(v => [v.x, v.y, v.z]), '#e36b6b', 5);
  $('exp-preview').setAttribute('aria-pressed', 'true'); $('exp-preview').textContent = 'Hide seams';
  $('exp-fill-note').textContent = (stats.moved ? `${stats.seams} seam${stats.seams === 1 ? '' : 's'}: ${stats.moved.toLocaleString()} corners (amber) pushed by up to ${stats.largest.toFixed(2)} mm. No slits left up to ${o.maxGap} mm.`
    : `No parts within ${o.maxGap} mm of each other.`) + (wide.open ? ` Red: ${wide.open} spot${wide.open > 1 ? 's' : ''} with a gap wider than ${o.maxGap} mm that won't be filled.` : '');
}
$('exp-pockets').addEventListener('change', () => { $('exp-pockets-f').hidden = !$('exp-pockets').checked; if (!$('exp-pockets').checked) clearPocketPreview(); markDirty(); });
$('exp-pocket-show').addEventListener('click', () => { if ($('exp-pocket-show').getAttribute('aria-pressed') === 'true') clearPocketPreview(); else showPocketPreview(); });
['exp-pocket-res', 'exp-pocket-drain'].forEach(id => $(id).addEventListener('change', () => { if (pocketFx.children.length) showPocketPreview(); markDirty(); }));
$('exp-fill').addEventListener('change', () => { $('exp-fill-f').hidden = !$('exp-fill').checked; if (!$('exp-fill').checked) clearSeamPreview(); markDirty(); });
$('exp-sprue').addEventListener('click', () => exportSprues());
$('exp-sprue-clear').addEventListener('click', () => { pushUndo(); sprues = null; afterHierarchyChange(); toast('Removed the sprue frames.'); });
$('exp-preview').addEventListener('click', () => { if ($('exp-preview').getAttribute('aria-pressed') === 'true') clearSeamPreview(); else showSeamPreview(); });
['exp-gap', 'exp-overlap'].forEach(id => $(id).addEventListener('change', () => { if (seamFx.children.length) showSeamPreview(); markDirty(); }));
$('exp-each').addEventListener('click', async () => {
  const ms = exportMeshes(); if (!ms.length) return;
  const used = new Set(), cut = await cutMagnetHoles(ms, ms); if (cut.note) $('exp-note').textContent = cut.note;
  const files = ms.map((m, i) => { let n = safe(m.name), k = 2; while (used.has(n)) n = `${safe(m.name)}_${k++}`; used.add(n); return { name: n + '.stl', data: writeSTL([cut.meshes[i]]) }; });
  deliver(files, 'parts-stl.zip');
});

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, onGizmo: tc.dragging || tc.axis !== null, button: e.button }; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || down.button !== 0 || down.onGizmo) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
  if (moved > 5) return;                          // that was an orbit drag
  if (!SNAP_STEPS[tool] && tool !== 'ORIENT' && tool !== 'pose' && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
    const bh = benchHit(e);
    if (bh) { if (bh.kind === 'book' && tool === 'select') { openBook(); return; } selectBench(bh.kind, bh.k); return; }
  }
  const hit = raycast(e);
  if (tool === 'MAGNET') { handleMagnetClick(hit); return; }
  if (SNAP_STEPS[tool]) {                          // measuring a big surface can take a moment: let the message paint first
    const ev = { shiftKey: e.shiftKey };
    if (hit && hit.object.userData.part.tris > 150000) { toast('Measuring surface…'); setTimeout(() => handlePick(ev, hit), 30); }
    else handlePick(ev, hit);
    return;
  }
  if (tool === 'ORIENT') { if (hit) orientFromFace(hit); return; }
  const multi = e.ctrlKey || e.metaKey || e.shiftKey;
  if (multi) { if (hit) select(hit.object, 'toggle'); return; }      // Ctrl-click: add or remove, never clears
  select(hit ? hit.object : null);
  if (tool === 'pose' && hit && !jointOf(hit.object)) { /* toast shown by syncGizmo */ }
});
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

// Viewport navigation, Blender style.
//  - Wheel zooms toward the point under the cursor by a share of the distance to it, so it never stalls near the orbit
//    centre; over empty space the orbit centre is pushed ahead once you reach it (dolly through).
//  - Left/middle drag turns the view around the selection (or the point under the cursor) without the view jumping.
//  - Double-click glides the view to centre on the clicked spot.
const nav = { rot: null, glide: null };
const fwd = () => camera.getWorldDirection(V());
function sceneScale() { const b = sceneBox(); return b.isEmpty() ? 50 : Math.max(b.getSize(V()).length(), 5); }
function setPivotDepth(depth) {                                 // move the orbit centre along the view axis: the picture doesn't change
  orbit.target.copy(camera.position).addScaledVector(fwd(), Math.max(depth, sceneScale() * 0.002));
}
renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault(); nav.glide = null;
  let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  dy = Math.max(-200, Math.min(200, dy));
  if (!dy) return;
  const hit = raycast(e), dir = raycaster.ray.direction.clone(), f = fwd();
  const S = sceneScale(), minD = S * 0.002, airD = S * 0.03;     // over empty space never crawl slower than this
  const d = hit ? hit.distance : Math.max(camera.position.distanceTo(orbit.target), airD);
  const share = 1 - Math.exp(-Math.abs(dy) * 0.0018);               // ≈16% per wheel notch
  let move = dy < 0 ? d * share : -d * share / (1 - share);         // zooming out exactly undoes zooming in
  if (hit && dy < 0) move = Math.min(move, d - minD);               // stop just short of the surface
  const pivot = hit ? hit.point.clone() : orbit.target.clone();
  camera.position.addScaledVector(dir, move);
  const depth = pivot.sub(camera.position).dot(f);                 // keep the pivot at the depth of what you zoomed at
  setPivotDepth(hit ? depth : Math.max(depth, airD));
  orbit.update(); markViewMoved();
}, { passive: false });

renderer.domElement.addEventListener('pointerdown', e => {
  const turnBtn = e.button === 1 || (e.button === 0 && !(e.shiftKey || e.ctrlKey || e.metaKey));
  if (!turnBtn || (e.button === 1 && (e.shiftKey || e.ctrlKey || e.metaKey))) return;
  nav.rot = { x: e.clientX, y: e.clientY, started: false, ev: { clientX: e.clientX, clientY: e.clientY } };
});
function orbitPivot(ev) {
  if ($('set-orbitsel').checked && selection.length) {
    const b = sceneBox([...new Set(selectionRoots().flatMap(subtreeParts))]);
    if (!b.isEmpty()) return b.getCenter(V());
  }
  const hit = raycast(ev);
  if (hit) return hit.point.clone();
  return orbit.target.clone();
}
window.addEventListener('pointermove', e => {
  const r = nav.rot; if (!r) return;
  if (!r.started) {
    if (Math.hypot(e.clientX - r.x, e.clientY - r.y) < 4) return;
    if (!orbit.enabled || tc.dragging || marq) { nav.rot = null; return; }   // a gizmo drag or a box select owns this drag
    r.started = true; r.pivot = orbitPivot(r.ev); nav.glide = null;
    setPivotDepth(r.pivot.clone().sub(camera.position).dot(fwd()));
    r.lx = r.x; r.ly = r.y;
  }
  const dx = e.clientX - r.lx, dy = e.clientY - r.ly; r.lx = e.clientX; r.ly = e.clientY;
  turnView(dx, dy, r.pivot);
});
window.addEventListener('pointerup', () => { if (nav.rot && nav.rot.started) markViewMoved(); nav.rot = null; });

renderer.domElement.addEventListener('dblclick', e => {
  if (SNAP_STEPS[tool] || tool === 'ORIENT') return;            // double-clicks there are picks
  const bh = benchHit(e); if (bh?.kind === 'box') { if (kit?.state === 'sealed') openBox(); else openArt(); return; } if (bh?.kind === 'book') return;
  const hit = raycast(e); if (!hit) return;
  nav.glide = { to: hit.point.clone().sub(orbit.target) };
});
function stepGlide() {                                            // called every frame
  const g = nav.glide; if (!g) return;
  const s = g.to.clone().multiplyScalar(0.18);
  camera.position.add(s); orbit.target.add(s); g.to.sub(s);
  if (g.to.length() < sceneScale() * 1e-4) { nav.glide = null; markViewMoved(); }
}
function fitClipPlanes() {                                        // near plane follows the camera so close-ups don't get cut away
  const d = camera.position.distanceTo(orbit.target), S = Math.max(sceneScale(), mat.children.length ? Math.hypot(MAT.w, MAT.h) : 0);
  const near = Math.max(0.005, Math.min(d * 0.02, S * 0.01)), far = Math.max(S * 20, d * 20, 500);
  if (Math.abs(near - camera.near) > near * 0.05 || Math.abs(far - camera.far) > far * 0.05) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
}
function markViewMoved() { orbit.dispatchEvent({ type: 'end' }); }

// Colour tool: drag on a part to paint (a drag off the parts still turns the view), Alt-click picks up a colour
const brushRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false }));
brushRing.renderOrder = 999; brushRing.visible = false; scene.add(brushRing);
const paintMode = () => document.querySelector('#paint-mode [aria-pressed="true"]')?.dataset.v || 'brush';
function showBrushRing(hit) {
  if (!hit || tool !== 'paint' || paintMode() !== 'brush') { brushRing.visible = false; return; }
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  brushRing.position.copy(hit.point).addScaledVector(n, 0.02); brushRing.quaternion.setFromUnitVectors(V(0, 0, 1), n);
  brushRing.scale.setScalar(Math.max(+$('paint-size').value / 2, 0.05)); brushRing.material.color.set($('paint-erase').checked ? '#ff8a8a' : '#ffffff'); brushRing.visible = true;
}
renderer.domElement.addEventListener('pointerdown', e => {
  if (tool !== 'paint' || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const hit = raycast(e); if (!hit) return;                              // off the parts: the view turns as usual
  e.stopImmediatePropagation(); e.preventDefault();
  const m = hit.object, pt = m.userData.part;
  if (e.altKey) { const c = colourAt(hit); setBrushColor(c); toast(`Picked up ${c}.`); return; }
  if (paintMode() === 'fill') {
    pushUndo();
    if ($('paint-erase').checked) { pt.fill = null; pt.paint = null; } else pt.fill = brush.color;
    pt.paintVer = (pt.paintVer || 0) + 1; refreshPaint(m); markDirty(); renderOutliner(); renderPartPanel(); return;
  }
  pushUndo(); brush.stroke = { touched: new Set(), last: hit.point.clone(), obj: m };
  paintAt(m, hit.point, hit.faceIndex);
  try { renderer.domElement.setPointerCapture(e.pointerId); } catch (err) {}
}, { capture: true });
let paintEv = null;
renderer.domElement.addEventListener('pointermove', e => {
  if (tool !== 'paint') { if (brushRing.visible) brushRing.visible = false; return; }
  const first = !paintEv; paintEv = { clientX: e.clientX, clientY: e.clientY }; if (!first) return;
  requestAnimationFrame(() => {
    const ev = paintEv; paintEv = null; if (!ev) return;
    const hit = raycast(ev); showBrushRing(hit);
    const st = brush.stroke; if (!st || !hit) return;
    const step = Math.max(+$('paint-size').value * 0.25, 0.02);
    if (hit.object === st.obj) { const d = st.last.distanceTo(hit.point), n = Math.min(40, Math.floor(d / step));
      for (let k = 1; k <= n; k++) paintAt(hit.object, st.last.clone().lerp(hit.point, k / (n + 1))); }
    paintAt(hit.object, hit.point, hit.faceIndex); st.last.copy(hit.point); st.obj = hit.object;
  });
});
renderer.domElement.addEventListener('pointerleave', () => { brushRing.visible = false; });
window.addEventListener('pointerup', () => { if (!brush.stroke) return; brush.stroke = null; markDirty(); renderPartPanel(); });
function bindPaint() {
  const sw = $('paint-swatches');
  for (const [name, hex] of PAINTS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch'; b.dataset.c = hex; b.style.background = hex;
    b.title = name; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', name); b.addEventListener('click', () => setBrushColor(hex)); sw.append(b); }
  setBrushColor(brush.color);
  $('paint-color').addEventListener('input', () => setBrushColor($('paint-color').value));
  $('paint-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    $('paint-mode').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('paint-size-f').hidden = b.dataset.v !== 'brush'; brushRing.visible = false; });
  const syncSize = from => { const v = Math.max(0.1, +from.value || 1.5); $('paint-size').value = v; $('paint-size-r').value = Math.min(v, 8); };
  $('paint-size').addEventListener('change', () => syncSize($('paint-size'))); $('paint-size-r').addEventListener('input', () => syncSize($('paint-size-r')));
  view.addEventListener('wheel', e => { if (tool !== 'paint' || !e.altKey) return; e.preventDefault(); e.stopImmediatePropagation();      // Alt-wheel: brush size
    $('paint-size').value = Math.max(0.1, Math.min(30, +$('paint-size').value * (e.deltaY > 0 ? 0.9 : 1.1))).toFixed(2); syncSize($('paint-size')); }, { passive: false, capture: true });
  $('set-plastic').addEventListener('change', applyPlastic);
}

// Ctrl-drag (Cmd on a Mac) on the viewport: box-select every part that shows inside the box
let marq = null;
renderer.domElement.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !(e.ctrlKey || e.metaKey) || SNAP_STEPS[tool] || tool === 'ORIENT' || tool === 'pose' || tc.axis !== null) return;   // Shift-drag still pans
  orbit.enabled = false;                                      // this drag selects instead of orbiting
  marq = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, view: view.getBoundingClientRect() };
}, { capture: true });
window.addEventListener('pointermove', e => {
  if (!marq) return;
  marq.x1 = e.clientX; marq.y1 = e.clientY;
  if (Math.hypot(marq.x1 - marq.x0, marq.y1 - marq.y0) < 5) return;
  const el = $('marquee'), v = marq.view, x = Math.min(marq.x0, marq.x1) - v.left, y = Math.min(marq.y0, marq.y1) - v.top;
  Object.assign(el.style, { left: x + 'px', top: y + 'px', width: Math.abs(marq.x1 - marq.x0) + 'px', height: Math.abs(marq.y1 - marq.y0) + 'px' }); el.hidden = false;
});
window.addEventListener('pointerup', () => {
  if (!marq) return;
  const m = marq; marq = null; orbit.enabled = true; $('marquee').hidden = true;
  if (Math.hypot(m.x1 - m.x0, m.y1 - m.y0) < 5) return;       // just a Ctrl-click: handled by the click
  const r = renderer.domElement.getBoundingClientRect();
  const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
  const hits = [], v = V();
  for (const p of liveParts()) {
    if (!isVisibleChain(p) || boxed(p)) continue;
    p.updateMatrixWorld(true);
    const pos = p.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 400));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(p.matrixWorld).project(camera);
      if (v.z < -1 || v.z > 1) continue;
      const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (1 - v.y) / 2 * r.height;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) { hits.push(p); break; }
    }
  }
  selectMany(hits, true);
  toast(hits.length ? `Selected ${hits.length} part${hits.length > 1 ? 's' : ''} in the box (${selection.length} in all).` : 'No parts in that box.');
});

// Match: light up the face a click would select, before clicking (mating faces can be very narrow)
const hoverFx = new THREE.Group(); scene.add(hoverFx);
let hoverTimer = 0, hoverKey = '';
function clearHover() { hoverKey = ''; while (hoverFx.children.length) { const c = hoverFx.children.pop(); c.geometry?.dispose(); } }
renderer.domElement.addEventListener('pointermove', e => {
  if ((tool !== 'MATCH' && tool !== 'ORIENT') || e.buttons) { if (hoverFx.children.length) clearHover(); return; }
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    const hit = raycast(e); if (!hit) { clearHover(); return; }
    let side = 'orient';
    if (tool === 'MATCH') {
      const { a, b } = matchSides(), m = hit.object;
      side = !a || m === a ? 'move' : 'fixed';
      if (!side) { clearHover(); $('step-hint').textContent = 'Areas go on two parts only. Clear to start over.'; return; }
      if (picks.some(q => q.mesh === m && q.region.includes(hit.faceIndex))) { clearHover(); $('step-hint').textContent = 'Click to drop this area'; return; }
    }
    const topo = topoOf(hit.object), key = hit.object.uuid + ':' + hit.faceIndex;
    if (key === hoverKey) return;
    hit.object.updateMatrixWorld(true);
    const res = pickSurface(topo, hit.object.matrixWorld.clone(), hit.faceIndex, hit.point, settings());
    clearHover(); hoverKey = key; if (res.err) return;
    const list = res.region, pos = new Float32Array(list.length * 9);
    list.forEach((t, i) => { for (let k = 0; k < 3; k++) { const v = topo.idx[3*t+k]; pos.set(topo.pos.subarray(3*v, 3*v+3), i*9 + k*3); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mm = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: side === 'move' ? '#4db4dc' : side === 'fixed' ? '#e2804f' : '#d6a24a', transparent: true, opacity: .32, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, depthWrite: false }));
    mm.matrixAutoUpdate = false; mm.matrix.copy(hit.object.matrixWorld); hoverFx.add(mm);
    $('step-hint').textContent = tool === 'ORIENT' ? `Click to orient by this ${res.info.replace(' mating', '')}` : `Click to add this ${res.info} (${side === 'move' ? 'moves' : 'stays'})`;
  }, 70);
});
renderer.domElement.addEventListener('pointerleave', clearHover);

document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('step-apply').addEventListener('click', applyMatch);
$('step-clear').addEventListener('click', () => { cancelPick(); toast('Cleared the picked areas.'); });
$('btn-import').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
$('btn-sample').addEventListener('click', loadSample);
$('btn-arrange').addEventListener('click', layOut);
$('btn-sprue').addEventListener('click', putOnSprues);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
const syncPair = (r, n) => { $(r).addEventListener('input', () => { $(n).value = $(r).value; }); $(n).addEventListener('change', () => { $(r).value = $(n).value; }); };
syncPair('set-smooth', 'set-smooth-n');
// the other pick settings: the typed box is the setting, the bar drags it (typing past the bar's range still works)
const SLIDERS = ['set-balltol', 'set-radius', 'set-crease', 'set-flat'];
const syncSlider = id => { $(id + '-r').value = Math.min(+$(id + '-r').max, Math.max(+$(id + '-r').min, +$(id).value || 0)); };
SLIDERS.forEach(id => {
  $(id + '-r').addEventListener('input', () => { $(id).value = $(id + '-r').value; });
  $(id + '-r').addEventListener('change', () => $(id).dispatchEvent(new Event('change', { bubbles: true })));
  $(id).addEventListener('input', () => syncSlider(id)); $(id).addEventListener('change', () => syncSlider(id));
});
$('set-joints').addEventListener('change', () => joints.forEach(j => { const h = j.getObjectByName('joint-helper'); if (h) h.visible = $('set-joints').checked; }));

// Drop overlay: shown only while files are dragged over the viewport
let dragDepth = 0, dragTimer;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
const hideDrop = () => { dragDepth = 0; clearTimeout(dragTimer); $('drop').hidden = true; };
view.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('drop').hidden = false; });
view.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault();
  clearTimeout(dragTimer); dragTimer = setTimeout(hideDrop, 400); });   // a drag that ends elsewhere stops sending dragover
view.addEventListener('dragleave', e => { if (--dragDepth <= 0 || !view.contains(e.relatedTarget)) hideDrop(); });
view.addEventListener('drop', e => { e.preventDefault(); hideDrop(); const fs = [...(e.dataTransfer?.files || [])];
  // folders must be read from the items during the drop event itself
  const entries = [...(e.dataTransfer?.items || [])].map(it => it.webkitGetAsEntry?.()).filter(Boolean);
  const dir = entries.find(en => en.isDirectory);
  if (dir) { readDropped(entries).then(list => openFolder(list, dir.name)).catch(() => toast("Couldn't read that folder.", 'bad')); return; }
  const proj = fs.find(f => /\.zip$/i.test(f.name)); if (proj) { openProjectFile(proj); return; }
  if (fs.length) importFiles(fs); });
['drop', 'dragend'].forEach(t => window.addEventListener(t, hideDrop));
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });   // stop the browser opening a missed drop as a file

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.querySelector('.mtop[aria-expanded="true"]')) { e.preventDefault(); closeMenus(); return; }
  if (e.key === 'Escape' && closeDialogs()) { e.preventDefault(); return; }
  if (!$('linkask').hidden) {            // the "bring the group?" question is up: its buttons take Enter, Esc dismisses it
    if (e.key === 'Escape') { e.preventDefault(); closeLinkAsk(null); return; }
    if (e.key === 'Enter' || $('linkask').contains(e.target)) return;
  }
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); selectMany(liveParts().filter(isVisibleChain)); toast(`Selected all ${selection.length} parts.`); return; }
  // number pad views, like Blender: 1 front, 3 right, 7 top; with Ctrl the opposite side
  const pad = { Numpad1: V(0, -1, 0), Numpad3: V(1, 0, 0), Numpad7: V(0, 0, 1) }[e.code];
  if (pad) { e.preventDefault(); navCube.goTo(e.ctrlKey || e.metaKey ? pad.negate() : pad); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const map = { '1': 'select', g: 'move', r: 'rotate', p: 'pose', o: 'ORIENT', b: 'BALL', h: 'PLANE', m: 'MID', t: 'THREE', j: 'MATCH', c: 'paint', n: 'MAGNET' };
  if (k === 'e' && tool === 'paint') { const c = $('paint-erase'); c.checked = !c.checked; toast(c.checked ? 'Erasing back to bare plastic.' : 'Painting.'); return; }
  if (map[k]) { setTool(map[k]); return; }
  if (k === 'escape' && benchSel) { select(null); syncGizmo(); renderPartPanel(); return; }
  if (k === 'escape' && magPending) { magPending = null; rebuildMagnets(); updateStep(); toast('Cancelled that magnet.'); return; }
  if (k === 'escape') { if (!$('orient').hidden) { closeOrient(); return; } if (picks.length) cancelPick(); else if (tool === 'select' && selection.length) select(null); else setTool('select'); return; }
  if (k === 'enter' && tool === 'MATCH' && picks.length) { e.preventDefault(); applyMatch(); return; }
  if (k === 'backspace' && picks.length) { e.preventDefault(); picks.pop(); rebuildPickFx(); updateStep(); return; }
  if ((k === 'delete' || k === 'x') && benchSel) {
    if (benchSel.kind === 'sprue') removeSprue(benchSel.k);
    else putAway(benchSel.kind === 'book' ? 'book' : 'box');
    return;
  }
  if (k === 'delete' || k === 'x') { deleteSelected(); return; }
  if (k === 'f' || k === '.') { frame(selection.length ? sceneBox([...new Set(selectionRoots().flatMap(subtreeParts))]) : sceneBox()); return; }
  if (k === 'home') { frame(benchBox()); return; }
});
function rebuildPickFx() {
  clearFx();
  picks.forEach((q, i) => { const side = (q.side ? q.side === 'move' : i < PER_SIDE[tool]) ? '#4db4dc' : '#e2804f'; if (q.region) showRegion(q.mesh, q.region, side); showMarker(q.point, '#ffe066', tool === 'THREE' ? .8 : 1.2); });
}

// ---------------------------------------------------------------------------
// Projects: autosave to this browser (IndexedDB) and project files (.zip)
// ---------------------------------------------------------------------------
const SETTING_IDS = ['set-smooth', 'set-balltol', 'set-radius', 'set-flat', 'set-joints', 'set-qty', 'set-orbitsel', 'set-plastic', 'ar-tol', 'set-crease', 'exp-fill', 'exp-gap', 'exp-overlap', 'exp-pockets', 'exp-pocket-res', 'exp-pocket-drain'];
const project = { id: THREE.MathUtils.generateUUID(), name: 'Untitled kit', dirty: false, timer: 0, saving: false, loading: false, saved: new Set() };
let idb = null;
const idbReady = new Promise(res => {
  try {
    const r = indexedDB.open('kitbash-bench', 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('projects', { keyPath: 'id' }); d.createObjectStore('geoms'); };
    r.onsuccess = () => { idb = r.result; res(idb); };
    r.onerror = r.onblocked = () => res(null);
  } catch (e) { res(null); }
});
try { navigator.storage?.persist?.(); } catch (e) {}       // ask the browser not to clear it under storage pressure
const idbReq = (store, mode, fn) => new Promise((res, rej) => {
  const tx = idb.transaction(store, mode), st = tx.objectStore(store), r = fn(st);
  tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
  tx.onerror = tx.onabort = () => rej(tx.error || new Error('storage error'));
});
function setProjStatus(text, kind = '') { const el = $('proj-status'); el.textContent = text; el.className = 'proj-status ' + kind; }

/** Everything needed to rebuild the bench: parts, joints, hierarchy, pose, settings, camera. */
function serializeProject() {
  scene.updateMatrixWorld(true);
  const parentId = o => (o.parent === world ? null : o.parent.uuid);
  const tr = o => ({ pos: o.position.toArray(), quat: o.quaternion.toArray(), scale: o.scale.toArray() });
  return {
    format: 'kitbash-bench', version: 1, id: project.id, name: project.name, updated: Date.now(),
    parts: liveParts().map(m => ({ id: m.uuid, name: m.name, color: m.userData.part.color, visible: m.visible, fill: m.userData.part.fill || null, paint: !!m.userData.part.paint,
      geom: m.userData.part.geomKey, tris: m.userData.part.tris, parent: parentId(m), ...tr(m) })),
    joints: joints.filter(j => j.parent).map(j => ({ id: j.uuid, parent: parentId(j), size: j.userData.joint.size, rest: j.userData.joint.rest.toArray(), ...tr(j) })),
    settings: Object.fromEntries(SETTING_IDS.map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value])),
    camera: { pos: camera.position.toArray(), target: orbit.target.toArray() },
    options: JSON.parse(JSON.stringify(options)),
    sprues: sprues ? JSON.parse(JSON.stringify(sprues)) : null,
    kit: kit ? JSON.parse(JSON.stringify(kit)) : null,
    magnets: JSON.parse(JSON.stringify(magnets)),
  };
}
function geomBuffers(m) {
  const g = m.geometry;
  return { pos: g.attributes.position.array.slice().buffer, idx: Uint32Array.from(g.index.array).buffer };
}
function geomFrom(rec) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(rec.pos), 3));
  g.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(rec.idx), 1));
  return g;
}

/** Replace the bench with a saved project. `geoms` maps geometry key -> {pos, idx} buffers. */
function buildProject(data, geoms, paints = new Map()) {
  project.loading = true;
  closeAutorig(); if (!$('orient').hidden) closeOrient();
  cancelPick(); select(null); tc.detach();
  [...parts, ...joints].forEach(o => o.parent && o.parent.remove(o));
  parts.length = 0; joints.length = 0; undoStack.length = 0; redoStack.length = 0; lastOp = null;
  for (const [id, v] of Object.entries(data.settings || {})) { const el = $(id); if (!el) continue; if (el.type === 'checkbox') el.checked = !!v; else el.value = v; }
  $('set-smooth-n').value = $('set-smooth').value; SLIDERS.forEach(syncSlider); $('exp-fill-f').hidden = !$('exp-fill').checked; $('exp-pockets-f').hidden = !$('exp-pockets').checked;
  const byId = new Map(), missing = [], shared = new Map();
  for (const p of data.parts) {
    const rec = geoms.get(p.geom); if (!rec) { missing.push(p.name); continue; }
    const g = shared.get(p.geom) || geomFrom(rec); shared.set(p.geom, g);
    const m = addPart(p.name, g, { welded: true, color: p.color, id: p.id, geomKey: p.geom });
    m.visible = p.visible !== false; byId.set(p.id, m);
    const pt = m.userData.part, pb = paints.get(p.id); pt.fill = p.fill || null;
    if (pb && pb.byteLength === g.attributes.position.count * 4) { pt.paint = new Uint8Array(pb.slice(0)); pt.paintVer = pt.paintSaved = 1; }
    refreshPaint(m);
  }
  for (const j of data.joints || []) { const o = makeJoint(j.size || 0.5); o.uuid = j.id; o.userData.joint.rest.fromArray(j.rest); byId.set(j.id, o); }
  const place = (o, rec) => { (rec.parent && byId.get(rec.parent) || world).add(o); o.position.fromArray(rec.pos); o.quaternion.fromArray(rec.quat); o.scale.fromArray(rec.scale); };
  for (const j of data.joints || []) place(byId.get(j.id), j);
  for (const p of data.parts) if (byId.has(p.id)) place(byId.get(p.id), p);
  colorIx = parts.length;
  options = data.options ? JSON.parse(JSON.stringify(data.options)) : { slots: [], sets: [] }; applyOptions();
  sprues = data.sprues ? JSON.parse(JSON.stringify(data.sprues)) : null;
  magnets = Array.isArray(data.magnets) ? JSON.parse(JSON.stringify(data.magnets)) : [];
  kit = data.kit ? JSON.parse(JSON.stringify(data.kit)) : null; book.doc = null; buildKit().then(() => fitMat(true));
  applyPlastic();
  project.id = data.id; project.name = data.name || 'Untitled kit'; $('proj-name').value = project.name;
  project.saved = new Set(data.parts.map(p => p.geom));
  if (data.camera) { camera.position.fromArray(data.camera.pos); orbit.target.fromArray(data.camera.target); orbit.update(); }
  afterHierarchyChange(); updateButtons();
  project.loading = false; project.dirty = false; project.pristine = false;
  if (missing.length) toast(`Couldn't find the mesh for ${missing.join(', ')}.`, 'bad');
}

function markDirty() {
  if (project.loading) return;
  project.pristine = false;
  project.dirty = true; setProjStatus('unsaved', 'busy');
  clearTimeout(project.timer); project.timer = setTimeout(saveToBrowser, 1200);
}
async function saveToBrowser() {
  if (project.saving) { project.timer = setTimeout(saveToBrowser, 600); return; }
  if (!(await idbReady)) { setProjStatus('not saved', 'bad'); $('proj-note').textContent = "This browser isn't letting the page store data (a private window, or site data blocked). Use Save project file to keep your work."; return; }
  project.saving = true; setProjStatus('saving…', 'busy');
  try {
    const data = serializeProject();
    for (const m of liveParts()) {                         // meshes never change after import, so each is stored once
      const k = m.userData.part.geomKey; if (project.saved.has(k)) continue;
      await idbReq('geoms', 'readwrite', st => st.put(geomBuffers(m), k)); project.saved.add(k);
    }
    for (const m of liveParts()) {                         // brushed paint, saved again only after it changes
      const pt = m.userData.part; if (!pt.paint || pt.paintSaved === pt.paintVer) continue;
      await idbReq('geoms', 'readwrite', st => st.put(pt.paint.slice().buffer, 'paint:' + m.uuid)); pt.paintSaved = pt.paintVer;
    }
    for (const k of [kit?.image, kit?.pdf].filter(Boolean)) {   // box art and instructions, stored once like meshes
      if (project.saved.has(k) || !assets.has(k)) continue;
      await idbReq('geoms', 'readwrite', st => st.put(assets.get(k), k)); project.saved.add(k);
    }
    await idbReq('projects', 'readwrite', st => st.put(data));
    project.dirty = false;
    setProjStatus(`saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'ok');
    try { localStorage.setItem('kitbash-last', project.id); } catch (e) {}
    if (!$('dlg-projects').hidden) renderProjectList();
  } catch (e) {
    setProjStatus('not saved', 'bad');
    $('proj-note').textContent = /quota/i.test(e?.name || e?.message || '') ? "Browser storage is full. Delete old saved projects, or use Save project file." : `Couldn't save in this browser (${e?.message || 'storage error'}). Use Save project file to keep your work.`;
  } finally { project.saving = false; }
}
async function listProjects() {
  if (!(await idbReady)) return [];
  try { return (await idbReq('projects', 'readonly', st => st.getAll())).sort((a, b) => b.updated - a.updated); } catch (e) { return []; }
}
async function openSaved(id) {
  if (project.dirty) await saveToBrowser();
  try {
    const data = await idbReq('projects', 'readonly', st => st.get(id)); if (!data) throw new Error('not found');
    const geoms = new Map();
    for (const k of new Set(data.parts.map(p => p.geom))) { const rec = await idbReq('geoms', 'readonly', st => st.get(k)); if (rec) geoms.set(k, rec); }
    for (const k of [data.kit?.image, data.kit?.pdf].filter(Boolean)) { const rec = await idbReq('geoms', 'readonly', st => st.get(k)); if (rec) assets.set(k, rec); }
    const paints = new Map();
    for (const p of data.parts) if (p.paint) { const rec = await idbReq('geoms', 'readonly', st => st.get('paint:' + p.id)); if (rec) paints.set(p.id, rec); }
    buildProject(data, geoms, paints); frame(sceneBox());
    setProjStatus('saved', 'ok'); toast(`Opened ${data.name}.`, 'ok');
    try { localStorage.setItem('kitbash-last', id); } catch (e) {}
    return true;
  } catch (e) { toast(`Couldn't open that project (${e.message}).`, 'bad'); return false; }
}
async function deleteSaved(id) {
  try {
    const all = await listProjects(), gone = all.find(p => p.id === id); if (!gone) return;
    const keep = new Set(all.filter(p => p.id !== id).flatMap(p => p.parts.map(q => q.geom)));
    if (id === project.id) liveParts().forEach(m => keep.add(m.userData.part.geomKey));
    await idbReq('projects', 'readwrite', st => st.delete(id));
    for (const k of new Set(gone.parts.map(q => q.geom))) if (!keep.has(k)) await idbReq('geoms', 'readwrite', st => st.delete(k));
    for (const q of gone.parts) if (q.paint && id !== project.id) await idbReq('geoms', 'readwrite', st => st.delete('paint:' + q.id));
    if (id === project.id) project.saved.clear();
    toast(`Deleted ${gone.name} from this browser.`);
  } catch (e) { toast(`Couldn't delete it (${e.message}).`, 'bad'); }
  renderProjectList();
}
async function renderProjectList() {
  const box = $('proj-list'), all = await listProjects();
  box.innerHTML = '';
  if (!all.length) { box.innerHTML = '<div class="empty">Nothing saved in this browser yet. Your work saves here as soon as you change something.</div>'; return; }
  for (const p of all) {
    const row = document.createElement('div'); row.className = 'proj-row'; if (p.id === project.id) row.setAttribute('aria-current', 'true');
    const n = document.createElement('div'); n.className = 'pn'; n.textContent = p.name;
    const m = document.createElement('div'); m.className = 'pm';
    m.textContent = `${p.parts.length} parts · ${new Date(p.updated).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    const a = document.createElement('div'); a.className = 'pa';
    const b = (txt, fn, cls = '') => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn ' + cls; x.textContent = txt; x.addEventListener('click', fn); a.append(x); return x; };
    if (p.id !== project.id) b('Open', () => openSaved(p.id)); else { const t = document.createElement('span'); t.className = 'pm'; t.textContent = 'open now'; a.append(t); }
    const del = b('Delete', () => {                         // two-step: the viewer has no confirm dialog
      if (del.dataset.armed) return deleteSaved(p.id);
      del.dataset.armed = '1'; del.textContent = 'Really delete?'; del.classList.add('danger');
      setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'Delete'; del.classList.remove('danger'); } }, 3500);
    });
    row.append(n, m, a); box.append(row);
  }
}
async function newProject(name = 'Untitled kit', quiet = false) {
  if (project.dirty) await saveToBrowser();
  closeAutorig();
  buildProject({ id: THREE.MathUtils.generateUUID(), name, parts: [], joints: [], settings: null }, new Map());
  project.saved.clear(); project.pristine = false; setProjStatus('empty');
  if (!quiet) toast('New project. Import STL files or open a folder to start.');
}

// project file: scene.json plus one binary per mesh, zipped
async function saveProjectFile() {
  if (!liveParts().length) { toast('Nothing to save yet.'); return; }
  const data = serializeProject(), files = [{ name: 'scene.json', data: JSON.stringify(data, null, 1) }];
  const seen = new Set();
  for (const m of liveParts()) { const k = m.userData.part.geomKey; if (seen.has(k)) continue; seen.add(k);
    const { pos, idx } = geomBuffers(m), head = new Uint32Array([pos.byteLength, idx.byteLength]);
    files.push({ name: `meshes/${k}.bin`, data: new Blob([head, pos, idx]) }); }
  for (const k of [kit?.image, kit?.pdf].filter(Boolean)) { const a = assets.get(k); if (a) files.push({ name: `assets/${k.slice(6)}`, data: new Blob([a.data]) }); }
  for (const m of liveParts()) if (m.userData.part.paint) files.push({ name: `paint/${m.uuid}.bin`, data: new Blob([m.userData.part.paint]) });
  await deliver(files, `${safe(project.name)}.kitbash.zip`);
}
async function openProjectFile(file) {
  if (typeof JSZip === 'undefined') { toast("The zip library didn't load. Check your connection and reload.", 'bad'); return; }
  try {
    const zip = await JSZip.loadAsync(file), sceneFile = zip.file('scene.json');
    if (!sceneFile) throw new Error("it isn't a Kitbash Bench project file");
    const data = JSON.parse(await sceneFile.async('string'));
    if (data.format !== 'kitbash-bench') throw new Error("it isn't a Kitbash Bench project file");
    const geoms = new Map();
    for (const k of new Set(data.parts.map(p => p.geom))) {
      const f = zip.file(`meshes/${k}.bin`); if (!f) continue;
      const buf = await f.async('arraybuffer'), [pl, il] = new Uint32Array(buf, 0, 2);
      geoms.set(k, { pos: buf.slice(8, 8 + pl), idx: buf.slice(8 + pl, 8 + pl + il) });
    }
    for (const [k, type, name] of [[data.kit?.image, 'image', data.kit?.artName], [data.kit?.pdf, 'application/pdf', data.kit?.pdfName]]) {
      const f = k && zip.file(`assets/${k.slice(6)}`); if (!f) continue;
      const nm = name || ''; const t = type === 'image' ? (/\.png$/i.test(nm) ? 'image/png' : /\.webp$/i.test(nm) ? 'image/webp' : /\.gif$/i.test(nm) ? 'image/gif' : 'image/jpeg') : type;
      assets.set(k, { type: t, name: nm, data: await f.async('arraybuffer') });
    }
    if (project.dirty) await saveToBrowser();
    const existing = (await listProjects()).some(p => p.id === data.id);
    if (existing && data.id !== project.id) data.id = THREE.MathUtils.generateUUID();   // never overwrite a different saved copy
    const paints = new Map();
    for (const p of data.parts) { const f = p.paint && zip.file(`paint/${p.id}.bin`); if (f) paints.set(p.id, await f.async('arraybuffer')); }
    buildProject(data, geoms, paints); project.saved.clear(); liveParts().forEach(m => { m.userData.part.paintSaved = 0; }); frame(sceneBox());
    toast(`Opened ${data.name} from file.`, 'ok'); markDirty();
  } catch (e) { toast(`Couldn't open ${file.name}: ${e.message}.`, 'bad'); }
}


// ---------------------------------------------------------------------------
// Window chrome: menus, the tabbed dock, dialogs, mirrored settings
// ---------------------------------------------------------------------------
function openDialog(id) {
  const d = $(id); document.querySelectorAll('.dlg').forEach(x => { if (x !== d) x.hidden = true; });
  d.hidden = false; (d.querySelector('.content button, .content input, .content select') || d.querySelector('.dlg-x')).focus({ preventScroll: true });
}
function closeDialogs() { let any = false; document.querySelectorAll('.dlg').forEach(d => { if (!d.hidden) { d.hidden = true; any = true; } }); return any; }
function showDockTab(tabId) {
  const tab = $(tabId), group = tab.closest('.dgroup'); group.classList.remove('folded'); group.querySelector('.dfold').setAttribute('aria-expanded', 'true');
  group.querySelectorAll('.dtab').forEach(t => { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; $(t.getAttribute('aria-controls')).hidden = !on; });
}
function closeMenus() { document.querySelectorAll('.menu .mlist').forEach(l => { l.hidden = true; l.previousElementSibling.setAttribute('aria-expanded', 'false'); }); }
/** Grey out what can't be done right now, tick the toggles. */
function refreshMenus() {
  const any = liveParts().length > 0;
  $('menu-undo').disabled = !undoStack.length; $('menu-redo').disabled = !redoStack.length;
  $('menu-selall').disabled = !any; $('menu-selnone').disabled = !selection.length && !selected; $('menu-delete').disabled = !selected && !benchSel;
  $('btn-arrange').disabled = $('btn-sprue').disabled = $('btn-autorig').disabled = !any; $('menu-unsprue').disabled = !sprues; $('menu-unbox').disabled = kit?.state !== 'sealed';
  $('menu-slot').disabled = selection.length < 2; $('menu-pockets').disabled = !liveParts().length; $('menu-nomagnets').disabled = !magnets.length; $('menu-clearpaint').disabled = !liveParts().some(m => m.userData.part.paint || m.userData.part.fill); $('menu-export').disabled = !any; $('menu-frame').disabled = !any;
  $('menu-joints').setAttribute('aria-checked', String($('set-joints').checked));
  $('menu-seams').setAttribute('aria-checked', $('exp-preview').getAttribute('aria-pressed')); $('menu-seams').disabled = liveParts().length < 2;
}
function openMenu(top) {
  closeMenus(); refreshMenus();
  const list = top.nextElementSibling; list.hidden = false; top.setAttribute('aria-expanded', 'true');
  return list;
}
function bindChrome() {
  // menus: click to open, hover to switch while one is open, arrows to move, Esc to close
  document.querySelectorAll('.menu .mtop').forEach(top => {
    top.addEventListener('click', e => { e.stopPropagation();
      if (top.getAttribute('aria-expanded') === 'true' && performance.now() - (top._hoverOpened || 0) > 400) closeMenus(); else openMenu(top); });
    top.addEventListener('mouseenter', () => { if (document.querySelector('.mtop[aria-expanded="true"]') && top.getAttribute('aria-expanded') !== 'true') { openMenu(top); top._hoverOpened = performance.now(); } });
    top.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(top).querySelector('.mi:not(:disabled)')?.focus(); } });
  });
  document.querySelectorAll('.mlist').forEach(list => {
    list.addEventListener('click', e => { if (e.target.closest('.mi')) closeMenus(); });
    list.addEventListener('keydown', e => {
      const items = [...list.querySelectorAll('.mi:not(:disabled):not([hidden])')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const t = list.previousElementSibling; closeMenus(); t.focus(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const tops = [...document.querySelectorAll('.mtop')], k = tops.indexOf(list.previousElementSibling);
        const nt = tops[(k + (e.key === 'ArrowRight' ? 1 : -1) + tops.length) % tops.length]; openMenu(nt).querySelector('.mi:not(:disabled)')?.focus(); }
    });
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.menu')) closeMenus(); });
  // menu commands that aren't existing buttons
  const on = (id, fn) => $(id).addEventListener('click', fn);
  on('menu-export', () => openDialog('dlg-export'));
  on('menu-prefs', () => openDialog('dlg-prefs'));
  on('menu-clearpaint', () => { const n = clearPaint(liveParts()); toast(n ? `Cleared the paint on ${n} part${n > 1 ? 's' : ''}. Undo brings it back.` : 'Nothing is painted.'); });
  on('menu-undo', undo); on('menu-redo', redo);
  on('menu-selall', () => { selectMany(liveParts().filter(isVisibleChain)); });
  on('menu-selnone', () => { select(null); syncGizmo(); renderPartPanel(); });
  on('menu-delete', () => {
    if (!benchSel) { deleteSelected(); return; }
    if (benchSel.kind === 'sprue') removeSprue(benchSel.k);
    else putAway(benchSel.kind === 'book' ? 'book' : 'box');
  });
  on('menu-unsprue', () => $('exp-sprue-clear').click());
  on('menu-unbox', openBox);
  on('menu-nomagnets', () => { if (!magnets.length) return; pushUndo(); const n = magnets.length; magnets = []; afterHierarchyChange(); toast(`Removed ${n} magnet${n > 1 ? 's' : ''}. Undo brings them back.`); });
  on('menu-pockets', () => { openDialog('dlg-export'); if (!$('exp-pockets').checked) { $('exp-pockets').checked = true; $('exp-pockets').dispatchEvent(new Event('change')); } showPocketPreview(); });
  on('menu-slot', () => { showDockTab('tab-opts'); $('opt-new').click(); });
  on('menu-home', () => $('nav-home').click());
  on('menu-front', () => navCube.goTo(V(0, -1, 0))); on('menu-right', () => navCube.goTo(V(1, 0, 0))); on('menu-top', () => navCube.goTo(V(0, 0, 1)));
  on('menu-frame', () => frame(selection.length ? sceneBox([...new Set(selectionRoots().flatMap(subtreeParts))]) : sceneBox()));
  on('menu-joints', () => { const c = $('set-joints'); c.checked = !c.checked; c.dispatchEvent(new Event('change', { bubbles: true })); });
  on('menu-seams', () => $('exp-preview').click());
  // dialogs
  document.querySelectorAll('.dlg-x').forEach(x => x.addEventListener('click', () => { x.closest('.dlg').hidden = true; }));
  // dock tabs and folding
  document.querySelectorAll('.dtab').forEach(t => {
    t.addEventListener('click', () => showDockTab(t.id));
    t.addEventListener('keydown', e => { if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = [...t.parentElement.querySelectorAll('.dtab:not([hidden])')], k = tabs.indexOf(t), n = tabs[(k + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]; showDockTab(n.id); n.focus(); });
  });
  document.querySelectorAll('.dfold').forEach(b => b.addEventListener('click', () => { const g = b.closest('.dgroup'); g.classList.toggle('folded'); b.setAttribute('aria-expanded', String(!g.classList.contains('folded'))); }));
  // settings shown in two places (options bar and Preferences) stay in step with the one the app reads
  document.querySelectorAll('[data-mirror]').forEach(m => {
    const src = $(m.dataset.mirror), key = m.type === 'checkbox' ? 'checked' : 'value', pull = () => { m[key] = src[key]; };
    pull(); src.addEventListener('change', pull); src.addEventListener('input', pull);
    m.addEventListener('change', () => { src[key] = m[key]; src.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  // shortcuts for the menus
  window.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'o' && !e.shiftKey) { e.preventDefault(); $('btn-import').click(); }
    else if (k === 'e') { e.preventDefault(); if (liveParts().length) openDialog('dlg-export'); }
    else if (k === ',') { e.preventDefault(); openDialog('dlg-prefs'); }
  });
  syncOptbar();
}

function bindProject() {
  $('proj-name').addEventListener('change', () => { project.name = $('proj-name').value.trim() || 'Untitled kit'; $('proj-name').value = project.name; markDirty(); });
  $('proj-new').addEventListener('click', () => newProject());
  $('proj-list-btn').addEventListener('click', () => { openDialog('dlg-projects'); renderProjectList(); });
  $('proj-save-file').addEventListener('click', saveProjectFile);
  $('proj-open-file').addEventListener('click', () => $('proj-file').click());
  $('proj-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProjectFile(f); });
  SETTING_IDS.forEach(id => $(id).addEventListener('change', markDirty));
  orbit.addEventListener('end', () => { if (liveParts().length && !project.dirty) { clearTimeout(project.timer); project.timer = setTimeout(() => project.dirty || saveToBrowser(), 4000); } });
  window.addEventListener('pagehide', () => { if (project.dirty) saveToBrowser(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && project.dirty) saveToBrowser(); });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function resize() {
  const w = view.clientWidth, h = view.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
bindAdjust();
bindFit();
bindProject();
bindAutorig();
bindOrient();
bindOptions();
bindKit(); bindLinkAsk(); bindChrome(); bindPaint(); bindMagnets();
$('set-loadas').addEventListener('change', () => { try { localStorage.setItem('kitbash-loadas', $('set-loadas').value); } catch (e) {} });
try { const v = localStorage.getItem('kitbash-loadas'); if (['ask', 'kit', 'spread', 'asis', 'auto'].includes(v)) $('set-loadas').value = v; } catch (e) {}
$('set-linkmove').addEventListener('change', () => { try { localStorage.setItem('kitbash-linkmove', $('set-linkmove').value); } catch (e) {} });
try { const v = localStorage.getItem('kitbash-linkmove'); if (['ask', 'alone', 'group'].includes(v)) $('set-linkmove').value = v; } catch (e) {}   // a habit, kept for this browser
$('set-bench').addEventListener('change', () => { setBench($('set-bench').value); fitMat(true); try { localStorage.setItem('kitbash-surface', $('set-bench').value); } catch (e) {} });
$('set-mat').addEventListener('change', () => { fitMat(true); try { localStorage.setItem('kitbash-mat', $('set-mat').value); } catch (e) {} });
try { const v = localStorage.getItem('kitbash-mat'); if (v && [...$('set-mat').options].some(o => o.value === v)) $('set-mat').value = v; } catch (e) {}
try { const v = localStorage.getItem('kitbash-surface'); if (v && MAT_STYLES[v] || v === 'grid') $('set-bench').value = v; } catch (e) {}     // a preference for this browser, not per project
setBench($('set-bench').value);
setTool('select');
$('set-smooth-n').value = $('set-smooth').value; SLIDERS.forEach(syncSlider);   // the browser may restore form values on reload: line the bars up with the boxes
(async () => {
  project.loading = true;
  loadSample(); undoStack.length = 0;        // something to look at straight away
  project.name = 'Sample kit'; $('proj-name').value = project.name;
  project.loading = false; project.dirty = false; project.pristine = true; setProjStatus('not saved yet');
  updateButtons();
  const all = await listProjects();
  let last = null; try { last = localStorage.getItem('kitbash-last'); } catch (e) {}
  const pick = all.find(p => p.id === last) || all[0];
  if (pick && await openSaved(pick.id)) toast(`Welcome back. Reopened ${pick.name} from this browser.`, 'ok');
})();
renderer.setAnimationLoop(() => { stepGlide(); orbit.update(); fitClipPlanes(); updateSkeleton(); updateMatView(); renderer.render(scene, camera); navCube.render(); });
// automated tests only (a query string never reaches the page inside claude.ai)
if (new URLSearchParams(location.search).has('kbtest')) { window.__kb = { THREE, camera, orbit, scene, liveParts, renderer, tc, proxy, get sprues() { return sprues; }, get kit() { return kit; }, get magnets() { return magnets; }, cutMagnetHoles }; }
