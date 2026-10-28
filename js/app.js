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
import * as Lucky from './lucky.js';
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
// two cameras: perspective (the default) and orthographic (no perspective, for lining up against references);
// `camera` is whichever is in use, and everything that looks through it follows the switch
const perspCam = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
const ORTHO_H = 50;                  // the orthographic camera's half-height at zoom 1 (its zoom does the rest)
const orthoCam = new THREE.OrthographicCamera(-ORTHO_H, ORTHO_H, ORTHO_H, -ORTHO_H, 0.1, 5000);
let camera = perspCam;
perspCam.up.set(0, 0, 1); orthoCam.up.set(0, 0, 1);
camera.position.set(90, -110, 80);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true; orbit.dampingFactor = 0.15;
orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
orbit.enableRotate = false; orbit.enableZoom = false;         // turning and zooming are done by the viewport code below; OrbitControls keeps panning
scene.add(new THREE.HemisphereLight('#dfe6ee', '#2a2622', 1.6));
const sun = new THREE.DirectionalLight('#fff4e4', 1.8); sun.position.set(60, -80, 120); camera.add(sun); scene.add(perspCam, orthoCam);
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
  const j = new THREE.Object3D(); j.userData.joint = { rest: new THREE.Quaternion(), restPos: new THREE.Vector3(), size, type: 'pinned', min: null, max: null };
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
  j.userData.joint.rest.copy(j.quaternion); j.userData.joint.restPos.copy(j.position);
  j.attach(child);
  return null;
}

// ---------------------------------------------------------------------------
// Connection types and linkages
// ---------------------------------------------------------------------------
/*
 * Every link in the tree has a type:
 *   pinned  turns any way about its point (a ball, or a pin in a socket): the default
 *   hinge   turns about one axis only (its joint's Z), optionally between min and max degrees
 *   roller  slides along one axis only (its joint's Z), optionally between min and max mm
 *   fixed   doesn't move (no joint at all: the part sits straight on its parent)
 * Hinges and rollers have their joint turned so its Z is the chosen axis, so the gizmo shows just that ring or arrow.
 *
 * Linkages (pistons, levers) close loops the tree can't: an extra connection between two parts that already
 * have parents. kind 'pin': a point on A stays on a point on B. kind 'rail': a point on A stays on a line
 * along one of B's own axes (a roller on a rail), optionally between min and max mm.
 * While you pose, solveLinks() turns and slides the other joints in each loop so every connection holds.
 */
const TYPE_LABEL = { pinned: 'Pinned', hinge: 'Hinge', roller: 'Roller', fixed: 'Fixed' };
const TYPE_ICON = { pinned: '◆', hinge: '◐', roller: '⇕', fixed: '└' };
let links = [];                    // { id, a, b (part ids), pa, pb (points in each part's own frame), kind: 'pin' | 'rail', axis: 'x' | 'y' | 'z', min, max }
const linkTypeOf = part => { const j = jointOf(part); return j ? j.userData.joint.type || 'pinned' : parentPart(part) ? 'fixed' : null; };
const AXIS_V = { x: V(1, 0, 0), y: V(0, 1, 0), z: V(0, 0, 1) };
/** One of a part's own axes, in world space. */
function partAxis(part, ax) { part.updateMatrixWorld(true); return AXIS_V[ax].clone().transformDirection(part.matrixWorld); }
/** Turn a joint so its Z points along `dir` (world), without moving anything hanging off it; that becomes its rest. */
function reframeJoint(j, dir) {
  const kids = j.children.filter(isPart), home = j.parent; kids.forEach(k => home.attach(k));
  j.updateMatrixWorld(true);
  const z = dir.clone().normalize(), ref = Math.abs(z.x) < 0.9 ? V(1, 0, 0) : V(0, 1, 0), x = ref.clone().sub(z.clone().multiplyScalar(ref.dot(z))).normalize(), y = z.clone().cross(x);
  const W = new THREE.Matrix4().makeBasis(x, y, z).setPosition(V().setFromMatrixPosition(j.matrixWorld));
  setWorld(j, W); kids.forEach(k => j.attach(k));
  const jd = j.userData.joint; jd.rest.copy(j.quaternion); jd.restPos.copy(j.position);
}
/** Where a part could pivot on its parent: the middle of where they touch, or else the point of the part nearest its parent. */
function pivotPoint(part, par) {
  let c = null; try { c = contactBetween(contactContext([par, part]), 0, 1, Math.max(+$('ar-tol').value || 0.3, 0.05)); } catch (e) {}
  if (c) return { point: V().copy(c.centre || c.joint), axis: (c.nOut?.[0]?.lengthSq() > 1e-9 ? c.nOut[0].clone() : V(0, 0, 1)).normalize() };
  return { point: closestBetween(part, par), axis: worldBox(part).getCenter(V()).sub(worldBox(par).getCenter(V())).normalize() };
}
/** Roughly where two parts come closest: the middle of the nearest points on each. */
function closestBetween(a, b) {
  a.updateMatrixWorld(true); b.updateMatrixWorld(true);
  const onB = (m, p) => { const inv = m.matrixWorld.clone().invert(), h = m.geometry.boundsTree.closestPointToPoint(p.clone().applyMatrix4(inv)); return h.point.clone().applyMatrix4(m.matrixWorld); };
  let p = worldBox(a).getCenter(V());
  for (let i = 0; i < 3; i++) { const q = onB(b, p); p = onB(a, q); }
  return p.clone().add(onB(b, p)).multiplyScalar(0.5);
}
/** Change how a part is connected to its parent. axis: 'x' | 'y' | 'z' (the part's own) or 'joint' (keep the joint's axis). */
function setLinkType(part, type, axis = null) {
  const par = parentPart(part); if (!par) return 'It isn\'t attached to anything.';
  let j = jointOf(part);
  if (type === 'fixed') { if (j) { detach(part); par.attach(part); } return null; }
  if (!j) { const pv = pivotPoint(part, par); detach(part); attach(part, par, 'joint', pv.point, pv.axis); j = jointOf(part); }
  const jd = j.userData.joint, was = jd.type || 'pinned';
  jd.type = type;
  if (type === 'pinned') { if (was !== 'pinned') { jd.min = jd.max = null; } return null; }
  if (was !== type) { jd.min = jd.max = null; }
  const ax = axis || jd.axis || (type === 'roller' ? 'z' : 'joint');
  jd.axis = ax;
  if (ax !== 'joint') reframeJoint(j, partAxis(part, ax));
  else { const kids = j.children.filter(isPart); jd.rest.copy(j.quaternion); jd.restPos.copy(j.position); }
  return null;
}
/** Hinge angle (degrees) about the joint's Z from its rest, or roller travel (mm) along it. */
function jointValue(j) {
  const jd = j.userData.joint;
  if (jd.type === 'roller') return j.position.clone().sub(jd.restPos).dot(V(0, 0, 1).applyQuaternion(jd.rest));
  if (jd.type === 'hinge') { const d = jd.rest.clone().invert().multiply(j.quaternion); return 2 * Math.atan2(d.z, d.w) * 180 / Math.PI; }
  return 0;
}
/** Set a hinge's angle or a roller's travel, within its limits. */
function setJointValue(j, v) {
  const jd = j.userData.joint;
  if (jd.min != null) v = Math.max(v, jd.min); if (jd.max != null) v = Math.min(v, jd.max);
  if (jd.type === 'roller') { j.position.copy(jd.restPos).addScaledVector(V(0, 0, 1).applyQuaternion(jd.rest), v); j.quaternion.copy(jd.rest); }
  else if (jd.type === 'hinge') { let a = ((v + 180) % 360 + 360) % 360 - 180; j.quaternion.copy(jd.rest).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), a * Math.PI / 180)); j.position.copy(jd.restPos); }
  j.updateMatrixWorld(true);
}
/** After a drag: keep a joint to what its type allows (a hinge only turns about Z, a roller only slides along Z). */
function constrainJoint(j) {
  const jd = j.userData.joint;
  if (jd.type === 'hinge' || jd.type === 'roller') setJointValue(j, jointValue(j));
  else j.position.copy(jd.restPos);
}
const partByUuid = id => liveParts().find(p => p.uuid === id) || null;
function tidyLinks() { links = links.filter(l => partByUuid(l.a) && partByUuid(l.b)); }
/** Every link's error in world mm: a pin's ends apart, or a rail's point off its line (or past its ends). */
function linkResiduals(list, out = []) {
  for (const l of list) {
    const a = l._a, b = l._b, pa = l._pa.clone().applyMatrix4(a.matrixWorld), pb = l._pb.clone().applyMatrix4(b.matrixWorld), d = pa.sub(pb);
    if (l.kind === 'rail') { const ax = AXIS_V[l.axis].clone().transformDirection(b.matrixWorld); let t = d.dot(ax);
      if (l.min != null) t = Math.max(t, l.min); if (l.max != null) t = Math.min(t, l.max); d.addScaledVector(ax, -t); }
    out.push(d.x, d.y, d.z);
  }
  return out;
}
/** The joints on the tree path between two parts (each one's own link up to where their branches meet). */
function jointsBetween(a, b) {
  const up = p => { const out = []; for (let c = p; c; c = parentPart(c)) out.push(c); return out; };
  const ua = up(a), ub = up(b), meet = ua.find(x => ub.includes(x));
  const path = meet ? [...ua.slice(0, ua.indexOf(meet)), ...ub.slice(0, ub.indexOf(meet))] : [...ua, ...ub];   // separate groups: every joint in both
  return path.map(jointOf).filter(Boolean);
}
/**
 * Keep every linkage closed: turn and slide the joints in each loop (never `driven`, the one being posed)
 * until every pin meets and every rail point sits on its rail. Damped least squares; joints carrying more
 * parts are stiffer, so the pistons move before the leg does. Returns the worst error left (mm).
 */
function solveLinks(driven = null, iters = 30) {
  tidyLinks(); if (!links.length) return 0;
  const list = links.map(l => ({ ...l, _a: partByUuid(l.a), _b: partByUuid(l.b), _pa: V(...l.pa), _pb: V(...l.pb) })).filter(l => l._a && l._b);
  const js = [...new Set(list.flatMap(l => jointsBetween(l._a, l._b)))].filter(j => j !== driven);
  const dofs = [];
  for (const j of js) {
    const jd = j.userData.joint, w = 1 + subtreeParts(j).length * 0.5;
    if (jd.type === 'hinge' || jd.type === 'roller') dofs.push({ j, k: 'v', w: jd.type === 'roller' ? w * 0.2 : w });
    else for (const ax of ['x', 'y', 'z']) dofs.push({ j, k: ax, w });
  }
  if (!dofs.length) return Math.max(0, ...linkResiduals(list).map(Math.abs));
  const save = () => dofs.map(d => [d.j.position.clone(), d.j.quaternion.clone()]);
  const load = st => { dofs.forEach((d, i) => { d.j.position.copy(st[i][0]); d.j.quaternion.copy(st[i][1]); }); js.forEach(j => j.updateMatrixWorld(true)); };
  const nudge = (d, h) => {
    if (d.k === 'v') { setJointValue(d.j, jointValue(d.j) + (d.j.userData.joint.type === 'hinge' ? h * 180 / Math.PI : h)); return; }
    d.j.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_V[d.k], h)); d.j.updateMatrixWorld(true);
  };
  const cost = r => r.reduce((s, v) => s + v * v, 0);
  scene.updateMatrixWorld(true);
  let r = linkResiduals(list), c = cost(r), lambda = 1e-3;
  const n = dofs.length, m = r.length;
  for (let it = 0; it < iters && c > 1e-8; it++) {
    const st = save(), J = dofs.map((d, k) => { const h = 1e-4; nudge(d, h); const r2 = linkResiduals(list); load(st); return r2.map((v, i) => (v - r[i]) / h); });
    const A = Array.from({ length: n }, () => new Array(n).fill(0)), g = new Array(n).fill(0);
    for (let a = 0; a < n; a++) { for (let i = 0; i < m; i++) g[a] -= J[a][i] * r[i]; for (let b = a; b < n; b++) { let v = 0; for (let i = 0; i < m; i++) v += J[a][i] * J[b][i]; A[a][b] = A[b][a] = v; } }
    let improved = false;
    for (let tries = 0; tries < 6 && !improved; tries++) {
      const M = A.map((row, a) => row.map((v, b) => v + (a === b ? lambda * dofs[a].w * (1 + A[a][a]) + 1e-9 : 0)));
      const x = solveLinear(M, g); if (!x) { lambda *= 10; continue; }
      dofs.forEach((d, k) => nudge(d, Math.max(-0.3, Math.min(0.3, x[k]))));
      const r2 = linkResiduals(list), c2 = cost(r2);
      if (c2 < c) { r = r2; c = c2; lambda = Math.max(lambda / 3, 1e-6); improved = true; } else { load(st); lambda *= 10; }
    }
    if (!improved) break;
  }
  return Math.sqrt(Math.max(0, ...Array.from({ length: r.length / 3 }, (_, i) => r[3 * i] ** 2 + r[3 * i + 1] ** 2 + r[3 * i + 2] ** 2)));
}
/** Every joint a linkage solve might move, plus `j`: their positions and turns, to put back later. */
function linkedState(j) {
  const set = new Set(j ? [j] : []);
  for (const l of links) { const a = partByUuid(l.a), b = partByUuid(l.b); if (a && b) jointsBetween(a, b).forEach(x => set.add(x)); }
  return [...set].map(o => [o, o.position.clone(), o.quaternion.clone()]);
}
function applyState(st) { for (const [o, p, q] of st) { o.position.copy(p); o.quaternion.copy(q); } scene.updateMatrixWorld(true); }
/**
 * `j` has just been moved (from the pose `prev`). Close every linkage around it; if they can't close (a rigid
 * piston can't reach, a rail runs out), stop `j` at the furthest point they still can, like the real model jams.
 * Returns { ok, frac }: frac is how far toward the requested pose it got.
 */
function poseWithLinks(j, prev) {
  if (!links.length) return { ok: true, frac: 1 };
  const tol = 0.01, want = [j.position.clone(), j.quaternion.clone()];
  if (solveLinks(j) <= tol) return { ok: true, frac: 1 };
  const now = linkedState(j);
  applyState(prev); if (solveLinks(j, 0) > tol) { applyState(now); return { ok: true, frac: 1 }; }   // it didn't hold before either: just do our best
  const p0 = prev.find(e => e[0] === j); let lo = 0, hi = 1, best = linkedState(j);
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2; applyState(prev);
    j.position.lerpVectors(p0[1], want[0], mid); j.quaternion.slerpQuaternions(p0[2], want[1], mid); j.updateMatrixWorld(true);
    if (solveLinks(j) <= tol) { lo = mid; best = linkedState(j); } else hi = mid;
  }
  applyState(best); return { ok: false, frac: lo };
}
/** Connect two parts that both keep their parents: a pin (or a rail along one of `to`'s axes) where they meet. */
function addLink(part, to, kind = 'pin', axis = 'z') {
  if (part === to) return null;
  const pt = closestOrContact(part, to);
  part.updateMatrixWorld(true); to.updateMatrixWorld(true);
  const l = { id: uid(), a: part.uuid, b: to.uuid, pa: pt.clone().applyMatrix4(part.matrixWorld.clone().invert()).toArray(), pb: pt.clone().applyMatrix4(to.matrixWorld.clone().invert()).toArray(), kind, axis, min: null, max: null };
  links.push(l); return l;
}
function closestOrContact(a, b) {
  let c = null; try { c = contactBetween(contactContext([b, a]), 0, 1, Math.max(+$('ar-tol').value || 0.3, 0.05)); } catch (e) {}
  return c ? V().copy(c.centre || c.joint) : closestBetween(a, b);
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
    if (e.j) { e.c.attach(e.j); e.j.attach(e.p); e.j.userData.joint.rest.copy(e.j.quaternion).multiply(e.delta); e.j.userData.joint.restPos.copy(e.j.position); }
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
    rest: o.userData.joint ? o.userData.joint.rest.clone() : null, jd: o.userData.joint ? { type: o.userData.joint.type || 'pinned', restPos: o.userData.joint.restPos.clone(), min: o.userData.joint.min, max: o.userData.joint.max, axis: o.userData.joint.axis || null } : null, off: !!o.userData.optOff,
    paint: o.userData.part?.paint || null, fill: o.userData.part?.fill || null }));
  snap.options = JSON.parse(JSON.stringify(options));
  snap.sprues = sprues ? JSON.parse(JSON.stringify(sprues)) : null;
  snap.kit = kit ? JSON.parse(JSON.stringify(kit)) : null;
  snap.magnets = JSON.parse(JSON.stringify(magnets));
  snap.links = JSON.parse(JSON.stringify(links));
  snap.refs = JSON.parse(JSON.stringify(refs));
  return snap;
}
function restore(snap) {
  [...parts, ...joints].forEach(o => o.parent && o.parent.remove(o));
  for (const e of snap) {
    e.p.add(e.o); e.o.position.copy(e.pos); e.o.quaternion.copy(e.q); e.o.scale.copy(e.s); e.o.visible = e.vis; e.o.name = e.name;
    if (e.rest) e.o.userData.joint.rest.copy(e.rest);
    if (e.jd) Object.assign(e.o.userData.joint, { ...e.jd, restPos: e.jd.restPos.clone() });
    if (e.o.userData.part) { e.o.userData.optOff = e.off;
      const pt = e.o.userData.part; if (pt.paint !== e.paint || pt.fill !== e.fill) { pt.paint = e.paint; pt.fill = e.fill; pt.paintVer = (pt.paintVer || 0) + 1; refreshPaint(e.o); } }
  }
  if (snap.options) options = JSON.parse(JSON.stringify(snap.options));
  if ('sprues' in snap) sprues = snap.sprues ? JSON.parse(JSON.stringify(snap.sprues)) : null;
  if (snap.magnets) { magnets = JSON.parse(JSON.stringify(snap.magnets)); }
  if (snap.links) links = JSON.parse(JSON.stringify(snap.links));
  if (snap.refs && JSON.stringify(snap.refs) !== JSON.stringify(refs)) { refs = JSON.parse(JSON.stringify(snap.refs)); rebuildRefs(); if (benchSel?.kind === 'ref' && !refById(benchSel.k)) { benchSel = null; benchMark.visible = false; } }
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
const TOOL_NAMES = { BALL: "Ball & socket", PLANE: "Face to face", MID: "Midpoint of gap", THREE: "3-point align", MATCH: "Surface match", LUCKY: "Do ya feel lucky?" };
let tool = 'select', picks = [], lastOp = null, luckyFirst = null, luckyStop = null;
const settings = () => ({ smoothDeg: +$('set-smooth').value, maxRadius: +$('set-radius').value || 0, flatTol: +$('set-flat').value || 0.02, ballTol: +$('set-balltol').value || 3, creaseDeg: +$('set-crease').value || 30 });

function setTool(t) {
  cancelPick(); if (typeof magPending !== 'undefined' && magPending) { magPending = null; rebuildMagnets(); } if (typeof clearHover === 'function') clearHover();
  luckyFirst = null;
  if (t !== 'ORIENT' && typeof closeOrient === 'function' && !$('orient').hidden) closeOrient();
  tool = t;
  document.querySelectorAll('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false'));
  syncGizmo(); updateStep(); syncOptbar();
}
/** The bar under the menus shows only the current tool's settings, like Photoshop's options bar. */
function syncOptbar() {
  const btn = document.querySelector(`.tool[data-tool="${tool}"]`); $('opt-tool').textContent = tool === 'LUCKY' ? TOOL_NAMES.LUCKY : btn ? [...btn.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : tool;
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
                   LUCKY: luckyFirst ? `Now click the part ${luckyFirst.name} fits onto` : selection.length === 2 ? `Click the part that moves, then the part it fits onto. Enter: fit ${selection[0].name} onto ${selection[1].name}` : "Click the part that moves, then the part it fits onto. The bench works out how they go together",
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
  if (r.lucky) { const { contact, sunk } = r.lucky;
    return { text: `${contact.toFixed(1)} mm² sitting flush` + (sunk >= 0.05 ? `, ${sunk.toFixed(1)} mm² overlapping` : ', nothing overlapping'), good: contact >= 2 && sunk < Math.max(0.3, contact * 0.05) }; }
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
// Do ya feel lucky?: click two parts and the bench works out how they fit
// ---------------------------------------------------------------------------
const LUCKY_EFFORT = { quick: 0.5, normal: 1, thorough: 2 };
/** A part's triangles in world millimetres (mirrored parts get their winding flipped so faces still point out). */
function worldCopy(m) {
  m.updateMatrixWorld(true);
  const g = m.geometry, p = g.attributes.position.array, e = m.matrixWorld.elements, out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12]; out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13]; out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; }
  let idx = g.index ? g.index.array.slice() : null;
  if (m.matrixWorld.determinant() < 0) {
    const src = idx || Uint32Array.from({ length: p.length / 3 }, (_, i) => i); idx = new Uint32Array(src.length);
    for (let t = 0; t < src.length; t += 3) { idx[t] = src[t]; idx[t + 1] = src[t + 2]; idx[t + 2] = src[t + 1]; }
  }
  return { pos: out, idx };
}
/**
 * Every way `child` could sit on `fixed`, best first. The work is split between background helpers, one per
 * spare processor core; if the browser won't start them, it runs here in small steps instead.
 */
async function luckySearch(child, fixed, effort, progress) {
  const A = worldCopy(child), B = worldCopy(fixed), opts = { effort };
  let stopped = false, stopNow; const stopP = new Promise((_, rej) => { stopNow = () => rej(new Error('stopped')); });
  const phase = pr => Promise.race([pr, stopP]);
  const n = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, navigator.deviceMemory && navigator.deviceMemory <= 4 ? 2 : 6));
  let workers = [];
  try { for (let i = 0; i < n; i++) workers.push(new Worker(new URL('./lucky-worker.js', import.meta.url), { type: 'module' })); }
  catch (e) { workers.forEach(w => w.terminate()); workers = []; }
  luckyStop = () => { stopped = true; workers.forEach(w => w.terminate()); stopNow(); };
  try {
    if (!workers.length) return await phase(luckyHere(A, B, opts, progress, () => stopped));
    const ask = (w, msg, until, onMsg) => new Promise((res, rej) => {
      w.onmessage = e => { const d = e.data; if (d.type === 'error') rej(new Error(d.message)); else if (d.type === until) res(d); else onMsg?.(d); };
      w.onerror = ev => { ev.preventDefault?.(); rej(new Error(ev.message || 'A search helper failed to start.')); };
      w.postMessage(msg);
    });
    progress(0.01, `Measuring ${fixed.name}…`);
    let ctx;
    try { ({ ctx } = await phase(ask(workers[0], { type: 'prepare', A, B, opts }, 'ctx', d => { if (d.type === 'tick') progress(0.08 * d.f, `Measuring ${fixed.name}…`); }))); }
    catch (e) { if (stopped) throw e; console.warn('Search helpers unavailable, searching on the page instead:', e); workers.forEach(w => w.terminate()); workers = []; return await phase(luckyHere(A, B, opts, progress, () => stopped)); }
    await phase(Promise.all(workers.slice(1).map(w => ask(w, { type: 'ctx', ctx }, 'ready'))));
    const lists = workers.map((_, i) => [...ctx.anchors.keys()].filter(a => a % workers.length === i)), done = workers.map(() => 0);
    const found = await phase(Promise.all(workers.map((w, i) => ask(w, { type: 'search', list: lists[i] }, 'found', d => {
      if (d.type === 'progress') { done[i] = d.f; progress(0.1 + 0.72 * done.reduce((a, b) => a + b, 0) / workers.length, `Trying every way ${child.name} could sit on ${fixed.name}…`); } }))));
    progress(0.83, 'Settling the best few into place…');
    const starts = Lucky.pickStarts(ctx, found.flatMap(f => f.mine), found.flatMap(f => f.best), Math.round(900 * Math.sqrt(effort)));
    const chunks = workers.map((_, i) => starts.filter((s2, k) => k % workers.length === i));
    const refined = (await phase(Promise.all(workers.map((w, i) => ask(w, { type: 'refine', starts: chunks[i] }, 'refined'))))).flatMap(r => r.out);
    progress(0.93, 'Settling the best few into place…');
    const { fits } = await phase(ask(workers[0], { type: 'rank', refined, max: 6 }, 'ranked'));
    progress(0.97, 'Marking where they touch…');
    const { res } = await phase(ask(workers[0], { type: 'contact', fits: fits.map(f => ({ R: f.R, t: f.t })) }, 'contact'));
    fits.forEach((f, k) => Object.assign(f, res[k]));
    return fits;
  } finally { workers.forEach(w => w.terminate()); luckyStop = null; }
}
/** The same search on the page itself, a little at a time so the page keeps drawing. */
async function luckyHere(A, B, opts, progress, stopped) {
  progress(0.02, 'Measuring…'); await nextFrame();
  const ctx = Lucky.prepare(A, B, opts), mine = [], best = [], all = [...ctx.anchors.keys()];
  for (let i = 0; i < all.length; i++) {
    if (stopped()) throw new Error('stopped');
    const r = Lucky.searchAnchors(ctx, [all[i]]); mine.push(...r.mine); best.push(...r.best);
    best.sort((x, y) => y.score - x.score); best.length = Math.min(best.length, ctx.params.keep);
    progress(0.1 + 0.72 * i / all.length, 'Trying every way they could fit…'); await nextFrame();
  }
  const starts = Lucky.pickStarts(ctx, mine, best, Math.round(900 * Math.sqrt(opts.effort || 1))), refined = [];
  for (let i = 0; i < starts.length; i += 25) {
    if (stopped()) throw new Error('stopped');
    refined.push(...Lucky.refineAll(ctx, starts.slice(i, i + 25))); progress(0.83 + 0.13 * i / starts.length, 'Settling the best few into place…'); await nextFrame();
  }
  const fits = Lucky.rankFits(ctx, refined, 6);
  fits.forEach(f => Object.assign(f, Lucky.contactOf(ctx, f, A, B)));
  return fits;
}
function luckyResult(f, k) {
  const R = f.R, t = f.t;
  const T = new THREE.Matrix4().set(R[0], R[1], R[2], t[0], R[3], R[4], R[5], t[1], R[6], R[7], R[8], t[2], 0, 0, 0, 1);
  return { T, joint: V(...f.joint), axis: V(...f.axis).normalize(), label: k ? `guess ${k + 1}` : 'best guess', regionA: f.regionA, regionB: f.regionB,
           sig: 'lucky' + k, lucky: { contact: f.contact, sunk: f.sunk }, coverage: 1, covTol: 0, gap: 0, size: 1, inside: 0, score: -f.score };
}
function handleLuckyClick(hit) {
  if (!hit) { toast(luckyFirst ? `Missed. Click the part ${luckyFirst.name} fits onto.` : 'Missed. Click the part that moves.'); return; }
  const m = hit.object;
  if (!luckyFirst) { luckyFirst = m; select(m); updateStep(); return; }
  if (m === luckyFirst) { toast(`That's ${m.name} again. Click the part it fits onto.`, 'bad'); return; }
  const a = luckyFirst; luckyFirst = null; updateStep(); feelLucky(a, m);
}
async function feelLucky(child, fixed) {
  if (luckyStop) { toast('Already searching. Wait for it, or Stop it first.', 'bad'); return; }
  const how = await askLink(child, 'Fit', { fixed });
  if (!how) { toast('Cancelled. Nothing moved.'); updateStep(); return; }
  scene.updateMatrixWorld(true);
  const op = { mode: 'MATCH', child, fixed, a: [{ point: worldBox(child).getCenter(V()), normal: V(0, 0, 1) }], b: [{ point: worldBox(fixed).getCenter(V()), normal: V(0, 0, 1) }],
    p: { spin: 0, gap: 0, flip: false, across: false, attach: lastAttach, centre: lastCentre, offset: [0, 0, 0], frame: lastFrame, pivot: lastPivot, seat: lastSeat }, before: snapshot() };
  op.reroot = how === 'group';
  op.match = { lucky: true, regionA: [], regionB: [], groupsA: [], groupsB: [], Ma: child.matrixWorld.clone(), Mb: fixed.matrixWorld.clone(), results: [], chosen: 0, flat: false };
  await startLucky(op);
}
async function startLucky(op) {
  const effort = LUCKY_EFFORT[$('lucky-effort').value] || 1;
  loading.show('Do ya feel lucky?'); loading.onStop(() => luckyStop?.());
  let fits = null;
  try { fits = await luckySearch(op.child, op.fixed, effort, (f, text) => loading.set(f, text)); }
  catch (e) { loading.hide(); if (e.message === 'stopped') toast('Stopped. Nothing moved.'); else { console.error(e); toast("The search didn't finish. Try Quick in the options bar, or fit them with Match.", 'bad'); } return; }
  loading.hide();
  if (!fits.length) { toast(`Couldn't find a way ${op.child.name} sits on ${op.fixed.name}. Do they touch when assembled?`, 'bad'); return; }
  const results = fits.map(luckyResult), b0 = results[0];
  op.match.results = results; op.match.chosen = 0; op.match.regionA = b0.regionA; op.match.regionB = b0.regionB;
  op.a = [{ point: b0.joint.clone().applyMatrix4(b0.T.clone().invert()), normal: b0.axis.clone().negate() }]; op.b = [{ point: b0.joint.clone(), normal: b0.axis.clone() }];
  if (lastOp === op) rerunLast();
  else { if (!runOp(op)) return; pushUndo(op.before); lastOp = op; select(op.child); }
  showAdjust(); flashMatch();
  const lead = results[1] ? results[0].lucky.contact - 5 * results[0].lucky.sunk - (results[1].lucky.contact - 5 * results[1].lucky.sunk) : Infinity;
  const v = matchVerdict(b0);
  toast(!v.good ? `Best guess is loose: ${v.text}. Check the other guesses in Adjust.`
    : lead < 2 ? `Lucky? Maybe: ${v.text}, but guess 2 is close behind. Compare them in Adjust.` : `Feeling lucky: ${v.text}.`, v.good && lead >= 2 ? 'ok' : v.good ? '' : 'bad');
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
    const m = op.match.results[op.match.chosen]; if (m.regionB?.length) op.seam.long = faceLongAxis(topoOf(op.fixed), op.match.Mb, m.regionB, op.seam.n);
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
  $('adjust-title').textContent = `Adjust: ${op.match?.lucky ? TOOL_NAMES.LUCKY : TOOL_NAMES[op.mode]}`;
  $('adj-search').hidden = !!op.match?.lucky;
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
      const t = document.createElement('span'); t.textContent = r.lucky ? `Guess ${k + 1}: ${r.lucky.contact.toFixed(1)} mm² flush` : r.seated ? `Fit ${k + 1}: ${r.seated.contact.toFixed(1)} mm² touching` : `Fit ${k + 1}: ${Math.round(r.coverage * 100)}% contact`;
      const sm = document.createElement('small'); sm.textContent = r.lucky ? (r.lucky.sunk >= 0.05 ? `${r.lucky.sunk.toFixed(1)} mm² overlapping` : 'nothing overlapping') : r.seated ? `${r.label}` : `gap ${r.gap.toFixed(2)} mm · ${r.label}`;
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
      if (m.lucky) startLucky(op); else startMatch(op);
      return;
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
    if (turn && benchSel.kind !== 'ref') { tc.showX = tc.showY = false; }                 // a box on the mat only turns about the up axis
    if (benchSel.kind === 'ref') { proxy.quaternion.copy(o.quaternion); tc.setSpace('local'); }   // a picture moves and turns in its own frame
    tc.attach(proxy); return;
  }
  if (!selected || !['move', 'rotate'].includes(tool)) { linkAsk.gizmoFor = null; if (linkAsk.soft) closeLinkAsk(null); }
  if (!selected || !['move', 'rotate', 'pose'].includes(tool)) return;      // only these tools have a gizmo
  if (tool === 'pose') {
    const j = jointOf(selected);
    if (!j) { toast(parentPart(selected) ? `${selected.name} is fixed to ${parentPart(selected).name}. Make it Pinned, Hinge or Roller in Properties to pose it.` : `${selected.name} has no joint yet. Snap it onto a parent first.`); return; }
    const t = j.userData.joint.type || 'pinned';
    tc.setMode(t === 'roller' ? 'translate' : 'rotate'); tc.setSpace('local');
    if (t !== 'pinned') { tc.showX = tc.showY = false; }          // a hinge turns, and a roller slides, about its Z only
    tc.attach(j); return;
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
let poseHeld = null;                // while posing with linkages: the last pose where every connection held
tc.addEventListener('mouseDown', () => {
  poseHeld = tc.object?.userData.joint && links.length ? linkedState(tc.object) : null;
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
  if (tc.object?.userData.joint) {
    const j = tc.object; constrainJoint(j);
    if (links.length) {
      const r = poseWithLinks(j, poseHeld || linkedState(j)); poseHeld = linkedState(j);
      if (!r.ok && performance.now() - (poseHeld.t || 0) > 1500) { toast("That's as far as the linkage goes: a piston or rail won't reach any further.", 'bad'); poseHeld.t = performance.now(); }
    }
    if (tool === 'pose') posePanelLive();
  }
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
    else if (bb.sel.kind === 'ref') { const r = refById(bb.sel.k); if (r) { r.pos = o.position.toArray(); r.quat = o.quaternion.toArray(); } }
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
  if (!roots.length && !refs.length) { box.innerHTML = '<div class="empty">No parts yet. Import STL files or load the sample kit.</div>'; return; }
  const kids = p => liveParts().filter(c => parentPart(c) === p);
  const row = (p, depth) => {
    const sl = slotOf(p);
    const r = document.createElement('div'); r.className = 'orow dnd-row' + (p.userData.optOff ? ' opt-off' : p.visible ? '' : ' hidden-part'); r.draggable = true; r._key = p;
    r.title = 'Drag onto another part: on its name to attach, on its right end to make it an option, onto empty space to set it loose';
    r.setAttribute('role', 'treeitem'); r.setAttribute('aria-selected', isSel(p) ? 'true' : 'false'); if (p === selected) r.classList.add('active');
    r.style.paddingLeft = (12 + depth * 14) + 'px';
    const link = document.createElement('span'); link.className = 'link';
    const lt = linkTypeOf(p); link.textContent = depth ? TYPE_ICON[lt] : ''; link.title = lt === 'fixed' ? 'Fixed to its parent' : `${TYPE_LABEL[lt]} (pose with P)`;
    if (links.some(l => l.a === p.uuid || l.b === p.uuid)) { link.textContent += '⛓'; link.title += ' · also connected to another part'; }
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
  for (const r of refs) {
    const el = document.createElement('div'); el.className = 'orow ref-row' + (benchSel?.kind === 'ref' && benchSel.k === r.id ? ' active' : '') + (r.visible === false ? ' hidden-part' : '');
    el.setAttribute('aria-selected', benchSel?.kind === 'ref' && benchSel.k === r.id ? 'true' : 'false');
    const ic = document.createElement('span'); ic.className = 'link'; ic.textContent = '▣'; ic.title = 'Reference image' + (r.locked ? ' (locked)' : '');
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = r.name;
    el.append(ic, nm); el.addEventListener('click', () => selectBench('ref', r.id)); box.append(el);
  }
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
  add('Attached to', par ? `${par.name} (${TYPE_LABEL[linkTypeOf(p)]})` : '—');
  add('Carries', subtreeParts(p).length - 1 + ' parts');
  if (p.userData.part.paint || p.userData.part.fill) add('Paint', [p.userData.part.fill ? 'filled ' + p.userData.part.fill : '', p.userData.part.paint ? 'brushed' : ''].filter(Boolean).join(', '));
  { const sl = slotOf(p); if (sl) add('Option', `${sl.name}: ${sl.members.indexOf(p.uuid) + 1} of ${sl.members.length}${p.userData.optOff ? ' (not chosen)' : ' (chosen)'}`); }
  const row = document.createElement('div'); row.className = 'btnrow';
  const b = (txt, fn, dis) => { const x = document.createElement('button'); x.className = 'btn'; x.type = 'button'; x.textContent = txt; x.disabled = !!dis; x.addEventListener('click', fn); row.append(x); };
  b('Reset pose', () => { pushUndo(); j.quaternion.copy(j.userData.joint.rest); j.position.copy(j.userData.joint.restPos); j.updateMatrixWorld(true); if (links.length) solveLinks(j); afterHierarchyChange(); }, !j);
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
  connectionRows(p, el);
  magnetRows(p, el);
}
/** How the selected part is connected: its link type to its parent, and any extra connections (pistons, levers). */
function connectionRows(p, el) {
  const par = parentPart(p), sec = document.createElement('div'); sec.className = 'conn';
  const h = document.createElement('div'); h.className = 'conn-h'; h.textContent = par ? `Connection to ${par.name}` : 'Connections'; sec.append(h);
  const field = (label, ...kids) => { const f = document.createElement('div'); f.className = 'conn-f'; const l = document.createElement('label'); l.textContent = label; f.append(l, ...kids); sec.append(f); return f; };
  const num = (v, ph, step, onCh, aria) => { const i = document.createElement('input'); i.type = 'number'; i.className = 'num'; i.step = step; i.placeholder = ph; i.value = v == null ? '' : +(+v).toFixed(2); i.setAttribute('aria-label', aria);
    i.addEventListener('change', () => onCh(i.value === '' ? null : +i.value)); return i; };
  const sel = (opts, v, onCh, aria) => { const s2 = document.createElement('select'); s2.className = 'num osel'; s2.setAttribute('aria-label', aria);
    for (const [k, t] of opts) { const o = document.createElement('option'); o.value = k; o.textContent = t; s2.append(o); } s2.value = v; s2.addEventListener('change', () => onCh(s2.value)); return s2; };
  const change = (fn, msg) => { pushUndo(); lastOp = null; const err = fn(); scene.updateMatrixWorld(true); if (links.length) solveLinks(jointOf(p)); afterHierarchyChange(); if (err) toast(err, 'bad'); else if (msg) toast(msg, 'ok'); };
  if (par) {
    const type = linkTypeOf(p), seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', `How ${p.name} connects to ${par.name}`);
    for (const [t, tip] of [['pinned', 'Turns any way about its point, like a ball or a pin in a socket'], ['hinge', 'Turns about one axis only, like a knee'], ['roller', 'Slides along one axis only, like a piston rod'], ['fixed', "Doesn't move"]]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = TYPE_LABEL[t]; b.title = tip; b.setAttribute('aria-pressed', type === t ? 'true' : 'false');
      b.addEventListener('click', () => { if (type !== t) change(() => setLinkType(p, t), `${p.name} is now ${TYPE_LABEL[t].toLowerCase()} to ${par.name}.`); });
      seg.append(b);
    }
    sec.append(seg);
    const j = jointOf(p), jd = j?.userData.joint;
    if (jd && (jd.type === 'hinge' || jd.type === 'roller')) {
      const isH = jd.type === 'hinge', unit = isH ? '°' : 'mm';
      field(isH ? 'Turns about' : 'Slides along', sel([...(isH ? [['joint', 'Joint axis']] : []), ['x', `${p.name}'s X`], ['y', `${p.name}'s Y`], ['z', `${p.name}'s Z`]], jd.axis || (isH ? 'joint' : 'z'),
        v => change(() => setLinkType(p, jd.type, v)), isH ? 'Hinge axis' : 'Roller axis'));
      const val = num(jointValue(j), '0', isH ? 1 : 0.1, v => { pushUndo(); lastOp = null; const prev = linkedState(j); setJointValue(j, v || 0); const r = poseWithLinks(j, prev); afterHierarchyChange();
        if (!r.ok) toast(`The linkage stops it at ${jointValue(j).toFixed(isH ? 1 : 2)}${isH ? '°' : ' mm'}: a piston or rail won't reach any further.`, 'bad'); }, isH ? 'Hinge angle in degrees' : 'Roller travel in mm'); val.id = 'conn-value';
      field(isH ? `Angle ${unit}` : `Travel ${unit}`, val);
      field(`Limits ${unit}`, num(jd.min, 'none', isH ? 1 : 0.1, v => change(() => { jd.min = v; constrainJoint(j); }), 'Lower limit'), document.createTextNode('to'),
        num(jd.max, 'none', isH ? 1 : 0.1, v => change(() => { jd.max = v; constrainJoint(j); }), 'Upper limit'));
    }
  }
  // extra connections that close loops: pistons, levers
  const mine = links.filter(l => l.a === p.uuid || l.b === p.uuid);
  for (const l of mine) {
    const other = partByUuid(l.a === p.uuid ? l.b : l.a); if (!other) continue;
    const railOn = partByUuid(l.b), f = document.createElement('div'); f.className = 'conn-link';
    const t = document.createElement('span');
    t.textContent = l.kind !== 'rail' ? `Also pinned to ${other.name}` : railOn === p ? `${other.name} rides a rail on it (its ${l.axis.toUpperCase()})` : `Rides a rail on ${railOn.name} (its ${l.axis.toUpperCase()})`;
    // seen from this part, a rail is on the other part: the rail side is b
    const kind = sel([['pin', 'Pin'], ['rail-x', `Rail along ${other.name}'s X`], ['rail-y', `Rail along ${other.name}'s Y`], ['rail-z', `Rail along ${other.name}'s Z`]],
      l.kind === 'rail' && railOn === other ? 'rail-' + l.axis : l.kind === 'rail' ? '' : 'pin', v => change(() => {
        const A = partByUuid(l.a), B = partByUuid(l.b); A.updateMatrixWorld(true); B.updateMatrixWorld(true);
        const at = V(...l.pa).applyMatrix4(A.matrixWorld);                  // where the moving end is now: the pin or the rail starts there
        if (v !== 'pin' && l.b === p.uuid) { Object.assign(l, { a: B.uuid, b: A.uuid }); }
        const a2 = partByUuid(l.a), b2 = partByUuid(l.b);
        l.pa = at.clone().applyMatrix4(a2.matrixWorld.clone().invert()).toArray(); l.pb = at.clone().applyMatrix4(b2.matrixWorld.clone().invert()).toArray();
        if (v === 'pin') l.kind = 'pin'; else { l.kind = 'rail'; l.axis = v.slice(5); l.min = l.max = null; } }), 'Connection kind');
    if (l.kind === 'rail' && railOn === p) { const o = document.createElement('option'); o.value = ''; o.textContent = `Rail on ${p.name}`; o.disabled = true; kind.prepend(o); kind.value = ''; }
    const del = document.createElement('button'); del.type = 'button'; del.className = 'mini'; del.textContent = '✕'; del.title = 'Remove this connection';
    del.addEventListener('click', () => change(() => { links = links.filter(x => x !== l); }, 'Removed that connection.'));
    f.append(t, kind, del); sec.append(f);
    if (l.kind === 'rail') field('Rail ends mm', num(l.min, 'none', 0.1, v => change(() => { l.min = v; }), 'Rail start'), document.createTextNode('to'), num(l.max, 'none', 0.1, v => change(() => { l.max = v; }), 'Rail end'));
  }
  const others = liveParts().filter(o => o !== p && !mine.some(l => l.a === o.uuid || l.b === o.uuid) && o !== par);
  if (others.length) {
    const who = sel([['', 'Connect also to…'], ...others.map(o => [o.uuid, o.name])], '', () => {}, 'Part to connect to');
    const kind = sel([['pin', 'with a pin'], ['rail-x', 'on a rail (its X)'], ['rail-y', 'on a rail (its Y)'], ['rail-z', 'on a rail (its Z)']], 'pin', () => {}, 'Connection kind');
    const go = document.createElement('button'); go.type = 'button'; go.className = 'btn'; go.textContent = 'Connect';
    go.title = 'For pistons and linkages: keeps its own parent and also stays connected to this part where they meet. Posing then moves both to keep it together.';
    go.addEventListener('click', () => { const o = partByUuid(who.value); if (!o) { toast('Pick the part to connect to first.', 'bad'); return; }
      toast(`Finding where ${p.name} meets ${o.name}…`);
      setTimeout(() => change(() => { const k = kind.value; addLink(p, o, k === 'pin' ? 'pin' : 'rail', k === 'pin' ? 'z' : k.slice(5)); },
        `${p.name} is now also ${kind.value === 'pin' ? 'pinned to' : 'on a rail on'} ${o.name}. Pose the joints around it and it moves to stay connected.`), 30); });
    const f = document.createElement('div'); f.className = 'conn-add'; f.append(who, kind, go); sec.append(f);
  }
  el.append(sec);
}
/** While posing: keep the angle or travel box showing where the joint is. */
function posePanelLive() { const i = $('conn-value'), j = selected && jointOf(selected); if (i && j && document.activeElement !== i) i.value = +jointValue(j).toFixed(2); }
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
  selection = selection.filter(m => m.parent); tidyLinks();
  if (selected && !selected.parent) selected = selection[selection.length - 1] || null;
  paintSelection();
  renderOutliner(); renderPartPanel(); renderOptions(); rebuildSprues(); rebuildMagnets(); showAdjust(); updateButtons(); updateStats(); syncGizmo();
}
// ---------------------------------------------------------------------------
// Rearranging by drag and drop: in the parts list and in the auto-assemble review
// ---------------------------------------------------------------------------
/**
 * Rows (class dnd-row, with a _key) can be dragged onto each other. Dropping on a row's name attaches the
 * dragged part to it; on its right end, makes it an option of it; on empty space, sets it loose.
 * can(src, dst, zone) says what's allowed; drop(src, dst, zone) does it; hint(src, dst, zone) describes it.
 */
function treeDnD(box, { can, drop, hint }) {
  let src = null;
  const clear = () => { box.querySelectorAll('[data-drop]').forEach(r => { delete r.dataset.drop; delete r.dataset.hint; }); box.classList.remove('drop-loose'); delete box.dataset.hint; };
  const where = e => { const row = e.target.closest('.dnd-row'); if (!row || !box.contains(row)) return { row: null, dst: null, zone: 'loose' };
    const r = row.getBoundingClientRect(); return { row, dst: row._key, zone: e.clientX > r.left + r.width * 0.62 ? 'option' : 'attach' }; };
  box.addEventListener('dragstart', e => { const row = e.target.closest?.('.dnd-row'); if (!row || e.target.closest('select, button, input')) return;
    src = row._key; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-kitbash-part', '1'); row.classList.add('dragging');
    box.dataset.loose = can(src, null, 'loose') ? 'Drop here to set it loose' : ''; box.classList.add('dnd-on'); });
  box.addEventListener('dragend', () => { src = null; clear(); box.classList.remove('dnd-on'); box.querySelectorAll('.dragging').forEach(r => r.classList.remove('dragging')); });
  box.addEventListener('dragover', e => {
    if (src == null) return; const { row, dst, zone } = where(e); clear();
    if (!can(src, dst, zone)) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (row) { row.dataset.drop = zone; row.dataset.hint = hint(src, dst, zone); } else { box.classList.add('drop-loose'); box.dataset.hint = hint(src, dst, zone); }
  });
  box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) clear(); });
  box.addEventListener('drop', e => { if (src == null) return; e.preventDefault(); e.stopPropagation(); const { dst, zone } = where(e), s2 = src; src = null; clear(); if (can(s2, dst, zone)) drop(s2, dst, zone); });
}
/** Attach `part` to `to`: with a joint where they touch, or fixed if they don't. Its options come along. */
function attachSmart(part, to) {
  toast(`Checking where ${part.name} touches ${to.name}…`);
  setTimeout(() => {
    let c = null; try { c = contactBetween(contactContext([to, part]), 0, 1, Math.max(+$('ar-tol').value || 0.3, 0.05)); } catch (e) { console.warn(e); }
    pushUndo(); lastOp = null;
    let e = null; if (c) e = planRig([to, part], [c], 0).edges[0];
    const how = e ? e.how : 'plain', w = e ? attach(part, to, how, e.joint, e.axis) : attach(part, to, 'plain');
    const sl = slotOf(part); if (sl && !w) shareSlotJoint(sl, part);
    afterHierarchyChange(); select(part);
    toast(w || (e ? `Attached ${part.name} to ${to.name}${how === 'joint' ? ` with a ${KIND_LABEL[e.kind] || 'joint'} where they touch` : ', fixed'}.` : `Attached ${part.name} to ${to.name}, fixed: they don't touch, so there's no joint.`) + (sl && !w ? ` Its other options came too.` : ''), w ? 'bad' : 'ok');
  }, 30);
}
/** Make `part` an alternative for `to` in the same spot: they join one option slot and hang where `to` hangs. */
function makeOptionOf(part, to) {
  pushUndo(); lastOp = null;
  for (const o of options.slots) o.members = o.members.filter(id => id !== part.uuid);
  let sl = slotOf(to);
  if (!sl) { const cn = commonName([to.name, part.name]); sl = { id: uid(), name: /^Slot \d+$/.test(cn) ? `${to.name} options` : cn, members: [to.uuid], active: to.uuid }; options.slots.push(sl); }
  sl.members.push(part.uuid);
  if (parentPart(to)) shareSlotJoint(sl, to); else if (parentPart(part)) detach(part);
  applyOptions(); afterHierarchyChange(); select(to);
  toast(`${part.name} is now an option for ${to.name} in "${sl.name}" (${sl.members.length} options). ${partById(sl.active)?.name} shows; switch in the Options tab or with the eye in the list.`, 'ok');
}
function setLoose(part) {
  pushUndo(); lastOp = null;
  const sl = slotOf(part);
  if (sl) { sl.members = sl.members.filter(id => id !== part.uuid); part.userData.optOff = false; part.visible = true; }
  if (parentPart(part)) detach(part);
  applyOptions(); afterHierarchyChange(); select(part);
  toast(`${part.name} is on its own now${sl ? `, no longer an option in "${sl.name}"` : ''}. Nothing moved.`);
}
function bindTreeDnD() {
  treeDnD($('outliner'), {
    can: (p, q, zone) => zone === 'loose' ? !!(parentPart(p) || slotOf(p))
      : q && q !== p && !subtreeParts(p).includes(q) && (zone === 'attach' ? parentPart(p) !== q : !(slotOf(p) && slotOf(p) === slotOf(q))),
    hint: (p, q, zone) => zone === 'loose' ? `Set ${p.name} loose` : zone === 'attach' ? `Attach to ${q.name}` : `Option of ${q.name}`,
    drop: (p, q, zone) => zone === 'loose' ? setLoose(p) : zone === 'attach' ? attachSmart(p, q) : makeOptionOf(p, q),
  });
  treeDnD($('ar-list'), {
    can: arCan,
    hint: (k, j, zone) => zone === 'loose' ? `Leave ${ar.meshes[k].name} loose` : zone === 'attach' ? `Attach to ${ar.meshes[j].name}` : `Option of ${ar.meshes[j].name}`,
    drop: arSet,
  });
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
  show(title) { this.depth++; $('ls-title').textContent = title; $('ls-text').textContent = 'Getting started…'; this.set(0); $('ls-stop').hidden = true; this.stop = null; $('loadscreen').hidden = false; },
  onStop(fn) { this.stop = fn; $('ls-stop').hidden = !fn; },
  set(frac, text) { const p = Math.round(Math.max(0, Math.min(1, frac)) * 100); $('ls-fill').style.width = p + '%'; $('loadscreen').querySelector('.ls-bar').setAttribute('aria-valuenow', String(p)); if (text) $('ls-text').textContent = text; },
  hide() { this.depth = Math.max(0, this.depth - 1); if (!this.depth) { $('loadscreen').hidden = true; $('ls-stop').hidden = true; this.stop = null; } },
  get on() { return !$('loadscreen').hidden; },
};
$('ls-stop').addEventListener('click', () => { $('ls-text').textContent = 'Stopping…'; loading.stop?.(); });
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
  if (!grp) {                                  // the box hasn't been built yet (unboxed straight after loading): open it without the show
    kit.state = 'open'; kit.opening = false; applySeal(); markDirty(); await buildKit(); renderPartPanel();
    toast(`Unboxed ${kit.name}.`, 'ok'); return;
  }
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
  $('nav-proj').addEventListener('click', () => setOrtho(!camera.isOrthographicCamera));
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
  if (sel.kind === 'ref') return refFx.children.find(c => c.userData.ref === sel.k) || null;
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
  const pickRefs = refFx.children.filter(m => m.visible && !refById(m.userData.ref)?.locked);
  const h = rc.intersectObjects([...kitFx.children, ...sprueFx.children, ...pickRefs], true)[0]; if (!h) return null;
  const part = raycast(ev); if (part && (part.distance < h.distance || h.object.userData.ref !== undefined)) return null;    // a part in front (or anywhere over a picture) wins
  let o = h.object; while (o && o.userData.kit === undefined && o.userData.frame === undefined && o.userData.ref === undefined) o = o.parent;
  if (!o) return null;
  if (o.userData.ref !== undefined) return { kind: 'ref', k: o.userData.ref };
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
  if (benchSel.kind === 'ref') return refPanel(el, o);
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
// ---------------------------------------------------------------------------
// Reference images: a picture on a plane in the scene, to line parts up and pose against
// ---------------------------------------------------------------------------
let refs = [];                       // { id, asset, name, aspect (h/w), pos, quat, w (mm), opacity, behind, locked, visible, flip }
const refFx = new THREE.Group(); scene.add(refFx);
const refTex = new Map();            // asset key -> texture (with .image a bitmap)
async function refTexture(key) {
  if (refTex.has(key)) return refTex.get(key);
  const blob = assetBlob(key); if (!blob) return null;
  const bmp = await createImageBitmap(blob, { imageOrientation: 'flipY' });
  const t = new THREE.Texture(bmp); t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.needsUpdate = true; t.anisotropy = 4;
  refTex.set(key, t); return t;
}
let refGen = 0;
async function rebuildRefs() {
  const gen = ++refGen;
  const meshes = [];
  for (const r of refs) {
    const tex = await refTexture(r.asset); if (gen !== refGen) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, color: tex ? '#ffffff' : '#555b61', transparent: true, opacity: r.opacity, side: THREE.DoubleSide, depthWrite: false, depthTest: !r.behind, toneMapped: false }));
    m.renderOrder = r.behind ? -10 : 1; m.userData.ref = r.id; m.name = 'ref-' + r.id;
    m.position.fromArray(r.pos); m.quaternion.fromArray(r.quat); m.scale.set(r.w * (r.flip ? -1 : 1), r.w * r.aspect, 1); m.visible = r.visible !== false;
    meshes.push(m);
  }
  while (refFx.children.length) { const c = refFx.children.pop(); c.geometry.dispose(); c.material.dispose(); }
  meshes.forEach(m => refFx.add(m));
  if (benchSel?.kind === 'ref') markBench();
}
const refById = id => refs.find(r => r.id === id) || null;
/** Add a picture: it faces the current view, through the middle of the view, sized to the parts and set behind them. */
async function addRefImage(file) {
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name)) { toast(`${file.name} isn't a picture.`, 'bad'); return; }
  const key = await addAsset(file); let aspect = 1;
  try { const bmp = await createImageBitmap(assetBlob(key)); aspect = bmp.height / bmp.width; bmp.close?.(); } catch (e) { assets.delete(key); toast(`Couldn't read ${file.name} as a picture.`, 'bad'); return; }
  scene.updateMatrixWorld(true);
  const box = liveParts().length ? sceneBox() : null, f = fwd();
  const h = box ? Math.max(box.getSize(V()).length() * 0.8, 10) : 80, w = h / aspect;
  const c = box ? box.getCenter(V()).addScaledVector(f, box.getSize(V()).length() * 0.6) : orbit.target.clone();
  pushUndo();
  const r = { id: uid(), asset: key, name: file.name.replace(/\.[^.]+$/, ''), aspect, pos: c.toArray(), quat: camera.quaternion.toArray(), w, opacity: 0.6, behind: true, locked: false, visible: true, flip: false };
  refs.push(r); await rebuildRefs(); markDirty(); renderOutliner(); selectBench('ref', r.id);
  toast(`Added ${r.name} facing this view, behind the parts. Move (G) and Rotate (R) place it; set its size and see-through in Properties.`, 'ok');
}
function removeRef(id) { pushUndo(); refs = refs.filter(r => r.id !== id); if (benchSel?.kind === 'ref' && benchSel.k === id) { benchSel = null; benchMark.visible = false; tc.detach(); } rebuildRefs(); markDirty(); renderOutliner(); renderPartPanel(); }
function refPanel(el, o) {
  const r = refById(benchSel.k); if (!r) return;
  const head = document.createElement('div'); head.className = 'multi-head';
  const nm = document.createElement('input'); nm.className = 'name-input'; nm.value = r.name; nm.setAttribute('aria-label', 'Reference image name');
  nm.addEventListener('change', () => { r.name = nm.value.trim() || r.name; markDirty(); renderOutliner(); });
  const sec = document.createElement('div'); sec.className = 'conn';
  const field = (label, ...kids) => { const f = document.createElement('div'); f.className = 'conn-f'; const l = document.createElement('label'); l.textContent = label; f.append(l, ...kids); sec.append(f); return f; };
  const upd = (fn, undo = true) => { if (undo) pushUndo(); fn(); rebuildRefs(); markDirty(); };
  const wIn = document.createElement('input'); wIn.type = 'number'; wIn.className = 'num'; wIn.step = '1'; wIn.min = '1'; wIn.value = r.w.toFixed(1); wIn.setAttribute('aria-label', 'Width in mm');
  const hOut = document.createElement('span'); hOut.textContent = `× ${(r.w * r.aspect).toFixed(1)} mm`;
  wIn.addEventListener('change', () => { const v = +wIn.value; if (v > 0) upd(() => { r.w = v; }); hOut.textContent = `× ${(r.w * r.aspect).toFixed(1)} mm`; });
  field('Size', wIn, hOut);
  const op = document.createElement('input'); op.type = 'range'; op.min = '0.05'; op.max = '1'; op.step = '0.05'; op.value = r.opacity; op.setAttribute('aria-label', 'See-through');
  op.addEventListener('input', () => { r.opacity = +op.value; const m = benchObj(); if (m) m.material.opacity = r.opacity; markDirty(); });
  field('Solid', op);
  const chk = (label, key, tip) => { const l = document.createElement('label'); l.className = 'check'; l.title = tip; const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!r[key];
    c.addEventListener('change', () => upd(() => { r[key] = c.checked; })); l.append(c, ' ' + label); sec.append(l); };
  chk('Always behind the parts', 'behind', 'Drawn behind everything, like a backdrop, wherever it is');
  chk('Locked (clicks go through it)', 'locked', 'Stops clicks on empty space picking it. Select it again from the Parts list.');
  chk('Mirrored', 'flip', 'Flip the picture left to right');
  const row = document.createElement('div'); row.className = 'btnrow';
  const b = (txt, fn, tip, primary) => { const x = document.createElement('button'); x.className = 'btn' + (primary ? ' primary' : ''); x.type = 'button'; x.textContent = txt; if (tip) x.title = tip; x.addEventListener('click', fn); row.append(x); };
  b('Face this view', () => upd(() => { r.quat = camera.quaternion.toArray(); }), 'Turn it to face the camera, about its middle');
  b('Look straight at it', () => lookAtRef(r), 'Turn the view to face it square on, in orthographic, framed');
  b(r.visible === false ? 'Show' : 'Hide', () => upd(() => { r.visible = r.visible === false; }));
  b('Delete', () => removeRef(r.id));
  const ap = document.createElement('div'); ap.className = 'conn'; ap.id = 'autopose-box';
  head.append(nm); const sm = document.createElement('small'); sm.textContent = 'Reference image. Move (G) slides it, Rotate (R) turns it.'; head.append(sm);
  el.append(head, sec, row, ap);
  autoPoseRows(r, ap);
}
// ---- Auto-pose (experimental): bend the joints until the model's outline covers the figure in the picture ----
const SIL_LAYER = 5;
let silRT = null, silCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000); silCam.layers.set(SIL_LAYER);
const silMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
/** The picture's frame: centre, right, up, out (unit), and its size in mm. */
function refFrame(r) {
  const q = new THREE.Quaternion().fromArray(r.quat);
  return { c: V(...r.pos), x: V(r.flip ? -1 : 1, 0, 0).applyQuaternion(q), y: V(0, 1, 0).applyQuaternion(q), n: V(0, 0, 1).applyQuaternion(q), w: r.w, h: r.w * r.aspect };
}
/** Where the figure is in the picture: a W×H mask cut out by transparency, or by distance from the background colour. */
async function refMask(r, W, tol) {
  const bmp = await createImageBitmap(assetBlob(r.asset)), H = Math.max(8, Math.round(W * r.aspect));
  const cv = new OffscreenCanvas(W, H), g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data, n = W * H, m = new Uint8Array(n);
  let clear = 0; for (let i = 0; i < n; i++) if (d[4 * i + 3] < 128) clear++;
  if (clear > n * 0.05) { for (let i = 0; i < n; i++) m[i] = d[4 * i + 3] >= 128 ? 1 : 0; return { m, W, H, how: 'transparency' }; }
  const border = []; for (let x = 0; x < W; x++) border.push(x, x + (H - 1) * W); for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  const med = k => { const v = border.map(i => d[4 * i + k]).sort((a, b) => a - b); return v[v.length >> 1]; }, bg = [med(0), med(1), med(2)];
  const t2 = (tol * 4.4) ** 2;
  for (let i = 0; i < n; i++) { const dr = d[4 * i] - bg[0], dg = d[4 * i + 1] - bg[1], db = d[4 * i + 2] - bg[2]; m[i] = dr * dr + dg * dg + db * db > t2 ? 1 : 0; }
  return { m, W, H, how: 'background', bg };
}
/** The figure's outline seen square-on to the picture, as a W×H mask in the picture's own pixels. */
function silhouette(r, parts, W, H) {
  if (!silRT || silRT.width !== W || silRT.height !== H) { silRT?.dispose(); silRT = new THREE.WebGLRenderTarget(W, H); silRT.buf = new Uint8Array(W * H * 4); }
  const F = refFrame(r), D = sceneScale() * 4 + F.w;
  silCam.left = -F.w / 2; silCam.right = F.w / 2; silCam.top = F.h / 2; silCam.bottom = -F.h / 2; silCam.near = 0.01; silCam.far = D * 3;
  silCam.position.copy(F.c).addScaledVector(F.n, D); silCam.up.copy(F.y); silCam.lookAt(F.c); silCam.updateProjectionMatrix(); silCam.updateMatrixWorld(true);
  if (r.flip) silCam.projectionMatrix.elements[0] *= -1;                 // a mirrored picture: mirror the outline to match
  parts.forEach(m => m.layers.enable(SIL_LAYER));
  const bg = scene.background, ov = scene.overrideMaterial, cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
  scene.background = null; scene.overrideMaterial = silMat; renderer.setClearColor(0x000000, 1);
  renderer.setRenderTarget(silRT); renderer.clear(); renderer.render(scene, silCam); renderer.setRenderTarget(null);
  scene.background = bg; scene.overrideMaterial = ov; renderer.setClearColor(cc, ca);
  parts.forEach(m => m.layers.disable(SIL_LAYER));
  renderer.readRenderTargetPixels(silRT, 0, 0, W, H, silRT.buf);
  const m = new Uint8Array(W * H), b = silRT.buf;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[(H - 1 - y) * W + x] = b[4 * (y * W + x)] > 127 ? 1 : 0;   // GL rows run bottom up
  return m;
}
const overlap = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] & b[k]) i++; if (a[k] | b[k]) u++; } return u ? i / u : 0; };
/** The figures that could be posed: each assembly with joints, biggest first. */
const poseFigures = () => liveParts().filter(p => !parentPart(p) && p.visible).map(p => ({ root: p, parts: subtreeParts(p).filter(m => m.visible && !m.userData.optOff) }))
  .filter(f => f.parts.length > 1).sort((a, b) => b.parts.length - a.parts.length);
let autoPose = { tol: 12, whole: true, busy: false, stop: false, fig: null, preview: false };
function autoPoseRows(r, box) {
  const h = document.createElement('div'); h.className = 'conn-h'; h.textContent = 'Match a pose to it (experimental)'; box.append(h);
  const figs = poseFigures();
  const note = document.createElement('p'); note.className = 'note';
  note.textContent = figs.length ? 'Line the picture up with the figure first (size and place it so they overlap), ideally square on. Then it bends the joints until the outline covers the figure in the picture. Works best on a plain background or a cut-out.'
    : 'Build a rig first: the figure needs jointed parts to pose.';
  box.append(note); if (!figs.length) return;
  const field = (label, ...kids) => { const f = document.createElement('div'); f.className = 'conn-f'; const l = document.createElement('label'); l.textContent = label; f.append(l, ...kids); box.append(f); return f; };
  const fs = document.createElement('select'); fs.className = 'num osel'; fs.setAttribute('aria-label', 'Figure to pose');
  figs.forEach((f, k) => { const o = document.createElement('option'); o.value = f.root.uuid; o.textContent = `${f.root.name} (${f.parts.length} parts)`; fs.append(o); });
  if (autoPose.fig && figs.some(f => f.root.uuid === autoPose.fig)) fs.value = autoPose.fig; fs.addEventListener('change', () => { autoPose.fig = fs.value; });
  field('Figure', fs);
  const tl = document.createElement('input'); tl.type = 'range'; tl.min = '2'; tl.max = '60'; tl.step = '1'; tl.value = autoPose.tol; tl.setAttribute('aria-label', 'Background tolerance');
  tl.addEventListener('input', () => { autoPose.tol = +tl.value; if (autoPose.preview) showMaskPreview(r); });
  field('Background', tl);
  const pv = document.createElement('label'); pv.className = 'check'; const pc = document.createElement('input'); pc.type = 'checkbox'; pc.checked = autoPose.preview;
  pc.addEventListener('change', () => { autoPose.preview = pc.checked; if (pc.checked) showMaskPreview(r); else rebuildRefs(); }); pv.append(pc, ' Show what it sees as the figure'); box.append(pv);
  const wh = document.createElement('label'); wh.className = 'check'; const wc = document.createElement('input'); wc.type = 'checkbox'; wc.checked = autoPose.whole;
  wc.addEventListener('change', () => { autoPose.whole = wc.checked; }); wh.append(wc, ' Also slide and turn the whole figure in the picture'); box.append(wh);
  const row = document.createElement('div'); row.className = 'btnrow';
  const go = document.createElement('button'); go.type = 'button'; go.className = 'btn primary'; go.textContent = 'Match pose'; go.addEventListener('click', () => runAutoPose(r, figs.find(f => f.root.uuid === fs.value) || figs[0]));
  row.append(go); box.append(row);
  const out = document.createElement('p'); out.className = 'note'; out.id = 'autopose-out'; box.append(out);
}
/** Paint the cut-out on the picture: the figure as it reads it in colour, the rest dimmed. */
async function showMaskPreview(r) {
  const mk = await refMask(r, 320, autoPose.tol), cv = document.createElement('canvas'); cv.width = mk.W; cv.height = mk.H;
  const g = cv.getContext('2d'), im = g.createImageData(mk.W, mk.H);
  for (let i = 0; i < mk.m.length; i++) { const on = mk.m[i]; im.data.set(on ? [255, 160, 60, 255] : [20, 24, 28, 200], 4 * i); }
  g.putImageData(im, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const m = refFx.children.find(c => c.userData.ref === r.id); if (m) { m.material.map = t; m.material.needsUpdate = true; }
}
/** The things auto-pose may change: the whole figure in the picture's plane, then each joint, big limbs first. */
function poseDofs(fig, F, whole) {
  const out = [], size = sceneBox(fig.parts).getSize(V()).length();
  if (whole) {
    const root = fig.root, c = sceneBox(fig.parts).getCenter(V());
    const mv = d => () => { applyWorld(root, Tr(d)); };
    out.push({ name: 'slide across', step: size * 0.06, min: size * 0.004, apply: (h) => applyWorld(root, Tr(F.x.clone().multiplyScalar(h))) });
    out.push({ name: 'slide up', step: size * 0.06, min: size * 0.004, apply: (h) => applyWorld(root, Tr(F.y.clone().multiplyScalar(h))) });
    out.push({ name: 'turn', step: 0.2, min: 0.01, apply: (h) => { const p = sceneBox(fig.parts).getCenter(V()); applyWorld(root, Tr(p).multiply(new THREE.Matrix4().makeRotationAxis(F.n, h)).multiply(Tr(p.clone().negate()))); } });
  }
  const js = [...new Set(fig.parts.map(jointOf).filter(Boolean))].sort((a, b) => subtreeParts(b).length - subtreeParts(a).length);
  for (const j of js) {
    const jd = j.userData.joint, t = jd.type || 'pinned';
    if (t === 'hinge') out.push({ j, name: 'hinge', sweep: true, step: 0.35, min: 0.01, apply: h => setJointValue(j, jointValue(j) + h * 180 / Math.PI) });
    else if (t === 'roller') out.push({ j, name: 'roller', step: size * 0.04, min: size * 0.002, apply: h => setJointValue(j, jointValue(j) + h) });
    else {
      // pinned: turn in the picture's plane (what the outline shows best), and tilt toward or away from it (foreshortening),
      // both about the joint's point; a turn about the limb's own length doesn't change its outline, so that's left alone
      const turnWorld = (axis, h) => { const pw = j.parent.getWorldQuaternion(new THREE.Quaternion()); j.quaternion.premultiply(pw.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(axis, h)).multiply(pw)); j.updateMatrixWorld(true); };
      out.push({ j, name: 'swing', sweep: true, step: 0.35, min: 0.01, apply: h => turnWorld(F.n, h) });
      out.push({ j, name: 'tilt', late: true, step: 0.2, min: 0.01, apply: h => {
        const a = V().setFromMatrixPosition(j.matrixWorld), kid = j.children.find(isPart), tip = kid ? sceneBox(subtreeParts(kid)).getCenter(V()) : a.clone().add(F.x);
        const limb = tip.sub(a); limb.addScaledVector(F.n, -limb.dot(F.n)); if (limb.lengthSq() < 1e-9) limb.copy(F.x);
        turnWorld(limb.normalize().cross(F.n).normalize(), h); } });
    }
  }
  return out;
}
async function runAutoPose(r, fig) {
  if (autoPose.busy) return;
  autoPose.busy = true; autoPose.stop = false;
  const W = 140, mk = await refMask(r, W, autoPose.tol), H = mk.H, target = mk.m;
  const tgtN = target.reduce((a, v) => a + v, 0);
  if (tgtN < W * H * 0.01 || tgtN > W * H * 0.95) { autoPose.busy = false; toast(tgtN < W * H * 0.01 ? "It can't find a figure in the picture: raise Background, or use a picture with a plainer background." : "Almost all of the picture reads as figure: lower Background.", 'bad'); return; }
  pushUndo(); lastOp = null;
  const F = refFrame(r), dofs = poseDofs(fig, F, autoPose.whole);
  const all = () => [...fig.parts, ...dofs.filter(d => d.j).map(d => d.j)];
  const save = () => [fig.root, ...dofs.filter(d => d.j).map(d => d.j)].map(o => [o, o.position.clone(), o.quaternion.clone()]);
  const load = st => { for (const [o, p, q] of st) { o.position.copy(p); o.quaternion.copy(q); } scene.updateMatrixWorld(true); };
  const score = () => { scene.updateMatrixWorld(true); if (links.length) solveLinks(null, 8); return overlap(silhouette(r, fig.parts, W, H), target); };
  let best = score(); const start = best;
  loading.show('Matching the pose…'); loading.onStop(() => { autoPose.stop = true; });
  let evals = 0, t0 = performance.now(), pass = 0;
  const breathe = async (frac, what) => { if (performance.now() - t0 > 60) { loading.set(frac, `${what}: ${Math.round(best * 100)}% covered (from ${Math.round(start * 100)}%) · ${evals} tries`); await nextFrame(); t0 = performance.now(); } };
  try {
    // 1. each turning joint, biggest first, swept right round in the picture's plane (gets out of poses that are far off)
    const sweeps = dofs.filter(d => d.sweep);
    for (let k = 0; k < sweeps.length && !autoPose.stop; k++) {
      const d = sweeps[k], st0 = save(); let bestA = 0;
      for (let a = 15; a < 360; a += 15) {
        load(st0); d.apply(a * Math.PI / 180); const sc = score(); evals++;
        if (sc > best + 1e-4) { best = sc; bestA = a; }
        await breathe(0.3 * (k + a / 360) / sweeps.length, 'Swinging each joint round');
      }
      load(st0); if (bestA) d.apply(bestA * Math.PI / 180); scene.updateMatrixWorld(true);
    }
    // 2. fine steps, in the plane first; the tilts join once that settles
    let late = false;
    for (; pass < 60 && !autoPose.stop; pass++) {
      let moved = false;
      for (const d of dofs) {
        if (d.step < d.min || autoPose.stop || (d.late && !late)) continue;
        for (const sgn of [1, -1]) {
          const st = save(); d.apply(sgn * d.step); const sc = score(); evals++;
          if (sc > best + 1e-4) { best = sc; moved = true; d.lastGood = sgn; break; }
          load(st);
        }
        await breathe(Math.min(0.98, 0.3 + pass / 20), late ? 'Fine-tuning, with tilts' : 'Fine-tuning');
      }
      if (!moved) {
        let any = false; for (const d of dofs) { if (d.late && !late) continue; d.step /= 2; if (d.step >= d.min) any = true; }
        if (!any) { if (late) break; late = true; }            // the plane has settled: now let limbs tilt toward or away
      }
    }
  } finally {
    loading.hide(); autoPose.busy = false;
    if (links.length) solveLinks(null);
    afterHierarchyChange(); markDirty();
    const out = $('autopose-out'); if (out) out.textContent = `Outline covers ${Math.round(best * 100)}% of the figure (was ${Math.round(start * 100)}%). Undo puts the old pose back.`;
    toast(best > start + 0.01 ? `Matched: the outline now covers ${Math.round(best * 100)}% of the figure in the picture (was ${Math.round(start * 100)}%). Check it from the side too.` : "Couldn't improve on this pose. Line the picture up with the figure more closely and try again.", best > start + 0.01 ? 'ok' : 'bad');
  }
}
/** Turn the view square on to a reference (orthographic, framed on it). */
function lookAtRef(r) {
  const n = V(0, 0, 1).applyQuaternion(new THREE.Quaternion().fromArray(r.quat)), c = V(...r.pos);
  setOrtho(true); nav.glide = null;
  const up = V(0, 1, 0).applyQuaternion(new THREE.Quaternion().fromArray(r.quat));
  camera.up.copy(Math.abs(up.z) > 0.2 ? V(0, 0, 1) : up); orbit.target.copy(c);
  camera.position.copy(c).addScaledVector(n, Math.max(sceneScale(), r.w) * 4); camera.lookAt(c); orbit.update();
  camera.zoom = ORTHO_H * Math.min(1, (camera.right - camera.left) / (camera.top - camera.bottom)) / (Math.max(r.w, r.w * r.aspect) / 2 * 1.08); camera.updateProjectionMatrix();
  fitClipPlanes(); markViewMoved();
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
const linkLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#7fd3c4', depthTest: false, transparent: true, opacity: .95 }));
linkLines.renderOrder = 999; linkLines.frustumCulled = false; scene.add(linkLines);
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
  const lp = [];
  if (show) for (const l of links) {
    const a = partByUuid(l.a), b = partByUuid(l.b); if (!a || !b || !isVisibleChain(a) || !isVisibleChain(b)) continue;
    const pa = V(...l.pa).applyMatrix4(a.matrixWorld), pb = V(...l.pb).applyMatrix4(b.matrixWorld), s2 = markerSize() * 1.2;
    for (const d of [V(s2, 0, 0), V(0, s2, 0), V(0, 0, s2)]) lp.push(pa.clone().sub(d), pa.clone().add(d));
    if (l.kind === 'rail') { const ax = AXIS_V[l.axis].clone().transformDirection(b.matrixWorld), lo = l.min ?? -s2 * 8, hi = l.max ?? s2 * 8; lp.push(pb.clone().addScaledVector(ax, lo), pb.clone().addScaledVector(ax, hi)); }
    else if (pa.distanceTo(pb) > 1e-3) lp.push(pa, pb);
  }
  linkLines.geometry.setFromPoints(lp);
}

// ---------------------------------------------------------------------------
// Camera framing, layout, import, sample
// ---------------------------------------------------------------------------
function frame(box) {
  if (box.isEmpty()) return;
  const c = box.getCenter(V()), r = Math.max(box.getSize(V()).length() / 2, 5);
  const dir = camera.position.clone().sub(orbit.target).normalize();
  if (camera.isOrthographicCamera) {                     // no perspective: back off well clear, and zoom so it fits
    orbit.target.copy(c); camera.position.copy(c).addScaledVector(dir, r * 4);
    camera.zoom = ORTHO_H * Math.min(1, (camera.right - camera.left) / (camera.top - camera.bottom)) / (r * 1.05);
    camera.near = r / 100; camera.far = r * 200; camera.updateProjectionMatrix(); orbit.update(); markViewMoved(); return;
  }
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
  $('ar-sum').textContent = `${meshes.length} parts · ${pairs.length} contact${pairs.length === 1 ? '' : 's'}`;
  $('ar-note').textContent = !pairs.length
    ? `The files kept their own positions, but no two parts are within ${(+$('ar-tol').value).toFixed(2)} mm of each other. If they should fit together, raise the contact tolerance and detect again.`
    : `${opts.auto ? 'These files are already in their assembled places, so they kept their positions. ' : ''}Each part hangs off the neighbour it touches most. Change what anything hangs off, or make parts options of each other (heads, weapons that swap in the same spot): use the menus, or drag a part by its ⋮⋮ onto another part's name to attach it, or onto its right end to make it an option. Then build the rig.`;
  rowsFromPlan(); renderAutorigList();
  showRigPreview();
  if (opts.auto && pairs.length) toast(`Found ${pairs.length} contact${pairs.length === 1 ? '' : 's'} between ${meshes.length} parts. Review them in Auto-assemble.`, 'ok');
}
/* The review is a tree the user can rearrange before anything is built: per part, what it connects to (and how),
   or which part it's an option of. ar.rows[k] = { parent: index | -1, how: 'joint' | 'plain', optionOf: index | -1, edge } */
function rowsFromPlan() {
  ar.rows = ar.meshes.map(() => ({ parent: -1, how: 'joint', optionOf: -1, edge: null }));
  for (const e of ar.plan.edges) ar.rows[e.child] = { parent: e.parent, how: e.how === 'skip' ? 'joint' : e.how, optionOf: -1, edge: e };
}
/** The contact between two parts as a joint (point, axis pointing from parent to child), or null if they don't touch. */
function edgeBetween(child, parent) {
  const p = ar.pairs.find(q => (q.i === child && q.j === parent) || (q.j === child && q.i === parent)); if (!p) return null;
  const pl = planRig([ar.meshes[parent], ar.meshes[child]], [{ ...p, i: p.i === parent ? 0 : 1, j: p.j === parent ? 0 : 1,
    nOut: { 0: p.nOut[parent], 1: p.nOut[child] }, nCnt: { 0: p.nCnt[parent], 1: p.nCnt[child] } }], 0);
  const e = pl.edges[0]; return e ? { pair: p, joint: e.joint, axis: e.axis, kind: e.kind, how: e.how } : null;
}
const arTarget = k => { let t = k, n = 0; while (ar.rows[t].optionOf >= 0 && n++ < 64) t = ar.rows[t].optionOf; return t; };     // the part an option stands in for
/** Where a part really hangs: an option hangs wherever the part it stands in for does. */
const arParent = k => ar.rows[arTarget(k)].parent;
function arBelow(k, anc) { let p = arParent(k), n = 0; while (p >= 0 && n++ < 64) { if (p === anc) return true; p = arParent(p); } return false; }
function arCan(src, dst, zone) {
  if (src === dst) return false;
  if (zone === 'loose') return ar.rows[src].parent >= 0 || ar.rows[src].optionOf >= 0;
  if (dst < 0 || arBelow(dst, src)) return false;                      // never under its own branch
  if (zone === 'attach') return !(ar.rows[src].parent === dst && ar.rows[src].optionOf < 0) && arTarget(dst) !== src;
  return arTarget(dst) !== arTarget(src) || ar.rows[src].optionOf < 0 && arTarget(dst) !== src;
}
function arSet(src, dst, zone) {
  const r = ar.rows[src];
  if (zone === 'loose') Object.assign(r, { parent: -1, optionOf: -1, edge: null });
  else if (zone === 'attach') { const e = edgeBetween(src, dst); Object.assign(r, { parent: dst, optionOf: -1, edge: e, how: e ? e.how : 'plain' }); }
  else { r.optionOf = arTarget(dst); for (const o of ar.rows) if (o.optionOf === src) o.optionOf = r.optionOf; }   // its own options join the same group
  renderAutorigList(); showRigPreview();
}
/** The links the review will build, for the preview and for Build. */
function arEdges() {
  return ar.rows.map((r, k) => {
    if (r.optionOf >= 0 || r.parent < 0) return null;
    const e = r.edge || edgeBetween(k, r.parent);
    return { child: k, parent: r.parent, how: e ? r.how : 'plain', joint: e ? e.joint : partBox(ar.meshes[k]).getCenter(V()), axis: e ? e.axis : V(0, 0, 1), kind: e ? e.kind : 'none', pair: e?.pair || null };
  }).filter(Boolean);
}
function renderAutorigList() {
  const { meshes, rows } = ar, box = $('ar-list'); box.innerHTML = '';
  const names = meshes.map(m => m.name);
  const pick = (label, value, opts, onChange, title) => {
    const s = document.createElement('select'); s.className = 'num ar-pick'; s.setAttribute('aria-label', label); s.title = title;
    for (const [v, t, dis] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; o.disabled = !!dis; s.append(o); }
    s.value = String(value); s.addEventListener('change', () => onChange(+s.value)); return s;
  };
  const draw = (k, depth, asOption) => {
    const r = rows[k], m = meshes[k], e = r.optionOf < 0 && r.parent >= 0 ? (r.edge || edgeBetween(k, r.parent)) : null;
    const row = document.createElement('div'); row.className = 'ar-row dnd-row' + (asOption ? ' is-option' : '') + (r.parent < 0 && r.optionOf < 0 ? ' is-root' : '');
    row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.draggable = true; row._key = k; row.style.paddingLeft = (6 + depth * 14) + 'px';
    const who = document.createElement('div'); who.className = 'who';
    const grip = document.createElement('span'); grip.className = 'grip'; grip.textContent = '⋮⋮'; grip.title = 'Drag onto another part: on its name to attach, on its right end to make it an option';
    const nm = document.createElement('b'); nm.textContent = m.name;
    who.append(grip, ...(asOption ? [Object.assign(document.createElement('span'), { className: 'opt-mark', textContent: '⇄', title: `An option for ${names[r.optionOf]}` })] : depth ? [Object.assign(document.createElement('span'), { className: 'arrow', textContent: e && r.how === 'joint' ? '◆' : '└' })] : []), nm);
    row.append(who);
    if (!asOption && r.parent >= 0) {           // how it attaches
      const seg = document.createElement('div'); seg.className = 'seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', `How ${m.name} attaches`);
      for (const [v, t, tip] of [['joint', 'Pinned', 'Turns any way about where they touch (set Hinge or Roller in Properties after building)'], ['plain', 'Fixed', 'Follows its parent, no joint']]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.title = v === 'joint' && !e ? `${m.name} doesn't touch ${names[r.parent]}, so there's nowhere to put a joint` : tip;
        b.disabled = v === 'joint' && !e; b.setAttribute('aria-pressed', (e ? r.how : 'plain') === v ? 'true' : 'false');
        b.addEventListener('click', () => { r.how = v; renderAutorigList(); showRigPreview(); }); seg.append(b);
      }
      row.append(seg);
    }
    const meta = document.createElement('div'); meta.className = 'meta';
    if (asOption) {
      meta.append('option of', pick(`What ${m.name} is an option of`, r.optionOf, [[-1, '— not an option'], ...names.map((n, j) => [j, n, j === k || !arCan(k, j, 'option')])], v => arSet(k, v, v < 0 ? 'loose' : 'option'), 'Options swap for each other in the same spot'));
    } else {
      meta.append(depth ? 'on' : 'base', pick(`What ${m.name} attaches to`, r.parent, [[-1, depth ? '— nothing (leave loose)' : '— nothing'], ...names.map((n, j) => [j, n, j === k || !arCan(k, j, 'attach') && r.parent !== j])], v => arSet(k, v, v < 0 ? 'loose' : 'attach'), 'The part it hangs off'));
      meta.append(pick(`Make ${m.name} an option of another part`, -1, [[-1, '⇄ option of…'], ...names.map((n, j) => [j, n, j === k || !arCan(k, j, 'option')])], v => { if (v >= 0) arSet(k, v, 'option'); }, 'Make it an alternative for another part in the same spot (a head, a weapon…)'));
      if (r.parent >= 0) { const kd = document.createElement('span'); kd.className = 'kind ' + (e ? e.kind : 'none');
        kd.textContent = e ? (KIND_LABEL[e.kind] || e.kind) + (e.kind === 'ball' && e.pair.radius ? ` ⌀${(e.pair.radius * 2).toFixed(2)}` : ` ≈${e.pair.area.toFixed(e.pair.area < 10 ? 1 : 0)} mm²`) : 'not touching'; meta.append(kd); }
    }
    row.append(meta);
    row.addEventListener('mouseenter', () => showRigPreview(k)); row.addEventListener('mouseleave', () => showRigPreview());
    row.addEventListener('dblclick', ev => { if (ev.target.closest('select, button')) return; frame(sceneBox([m, ...(r.parent >= 0 ? [meshes[r.parent]] : [])])); });
    box.append(row);
    rows.forEach((o, j) => { if (o.optionOf === k) draw(j, depth + 1, true); });
    rows.forEach((o, j) => { if (o.optionOf < 0 && o.parent === k) draw(j, depth + 1, false); });
  };
  rows.forEach((r, k) => { if (r.parent < 0 && r.optionOf < 0) draw(k, 0, false); });
  const edges = arEdges(), nOpt = rows.filter(r => r.optionOf >= 0).length, roots = rows.filter(r => r.parent < 0 && r.optionOf < 0).length;
  const extra = [];
  if (roots > 1) extra.push(`${roots} separate bases: drag one onto another part to join them up.`);
  $('ar-extra').textContent = extra.join(' ');
  // contacts the tree leaves out (each part has one parent): a piston's far end, a linkage. Tick to pin them too.
  const used = new Set(edges.map(e => e.pair).filter(Boolean)), isOpt = k => rows[k].optionOf >= 0 || rows.some(o => o.optionOf === k);
  const loops = ar.pairs.filter(q => !used.has(q) && !isOpt(q.i) && !isOpt(q.j));
  ar.loopOn ||= new Set(); for (const q of [...ar.loopOn]) if (!loops.includes(q)) ar.loopOn.delete(q);
  if (loops.length) {
    const hd = document.createElement('div'); hd.className = 'ar-loops-h'; hd.textContent = 'Also connect (pistons, linkages)';
    hd.title = 'These parts touch, but each part has only one parent, so the tree leaves the contact out. Tick it to pin them together as well: posing then moves the pistons to keep it connected.';
    box.append(hd);
    for (const q of loops) {
      const lab = document.createElement('label'); lab.className = 'ar-loop';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = ar.loopOn.has(q);
      cb.addEventListener('change', () => { if (cb.checked) ar.loopOn.add(q); else ar.loopOn.delete(q); renderAutorigList(); });
      lab.append(cb, ` ${meshes[q.i].name} ↔ ${meshes[q.j].name}`, Object.assign(document.createElement('small'), { textContent: ` · ${KIND_LABEL[q.kind] || q.kind} ≈${q.area.toFixed(q.area < 10 ? 1 : 0)} mm²` }));
      lab.addEventListener('mouseenter', () => { paintSelection(); meshes[q.i].material.emissive.set('#0d2f3d'); meshes[q.j].material.emissive.set('#3d200f'); });
      lab.addEventListener('mouseleave', () => paintSelection());
      box.append(lab);
    }
  }
  const n = edges.length;
  $('ar-build').textContent = n || nOpt ? `Build rig (${[n ? `${n} link${n > 1 ? 's' : ''}` : '', nOpt ? `${nOpt} option${nOpt > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ')})` : 'Build rig';
  $('ar-build').disabled = !n && !nOpt;
}
function showRigPreview(hot = -1) {
  while (rigPreview.children.length) { const c = rigPreview.children.pop(); c.geometry?.dispose(); }
  if ($('autorig').hidden || !ar.rows) return;
  const { meshes } = ar, sz = markerSize() * 1.6, pts = [], hotPts = [], optPts = [];
  for (const e of arEdges()) {
    const pc = partBox(meshes[e.parent]).getCenter(V()), cc = partBox(meshes[e.child]).getCenter(V()), isHot = e.child === hot || e.parent === hot && false;
    (isHot ? hotPts : pts).push(pc, e.joint, e.joint, cc);
    if (e.kind === 'none') continue;
    const m = new THREE.Mesh(new THREE.SphereGeometry(sz * (isHot ? 1.6 : 1), 16, 10),
      new THREE.MeshBasicMaterial({ color: e.how === 'plain' ? '#8d969e' : '#d6a24a', depthTest: false, transparent: true, opacity: .95 }));
    m.position.copy(e.joint); m.renderOrder = 999; rigPreview.add(m);
    const ax = new THREE.Line(new THREE.BufferGeometry().setFromPoints([e.joint, e.joint.clone().addScaledVector(e.axis, sz * 6)]),
      new THREE.LineBasicMaterial({ color: '#f1d08f', depthTest: false })); ax.renderOrder = 999; rigPreview.add(ax);
  }
  ar.rows.forEach((r, k) => { if (r.optionOf >= 0) optPts.push(partBox(meshes[k]).getCenter(V()), partBox(meshes[r.optionOf]).getCenter(V())); });
  for (const [list, color, op] of [[pts, '#d6a24a', .55], [hotPts, '#ffe066', 1], [optPts, '#7fb6d6', .9]]) {
    if (!list.length) continue;
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(list), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: op }));
    l.renderOrder = 998; rigPreview.add(l);
  }
  paintSelection();
  if (hot >= 0) { meshes[hot].material.emissive.set('#0d2f3d'); const r = ar.rows[hot], p = r.optionOf >= 0 ? r.optionOf : r.parent; if (p >= 0) meshes[p].material.emissive.set('#3d200f'); }
}
function closeAutorig(clear = true) {
  $('autorig').hidden = true; showRigPreview();
  paintSelection();
  if (clear) { ar.plan = null; ar.meshes = []; ar.pairs = []; ar.rows = null; ar.loopOn = null; }
}
function buildRig() {
  const { meshes, rows } = ar; if (!rows) return;
  pushUndo(); lastOp = null;
  let joints = 0, fixed = 0, nOpt = 0; const warns = [];
  for (const e of arEdges()) {
    const w = attach(meshes[e.child], meshes[e.parent], e.how, e.joint, e.axis);
    if (w) warns.push(w); else if (e.how === 'joint') joints++; else fixed++;
  }
  // options: each part an option stands in for, with its alternatives, becomes a slot; they share its joint
  const groups = new Map(); rows.forEach((r, k) => { if (r.optionOf >= 0) { const t = arTarget(k); if (!groups.has(t)) groups.set(t, []); groups.get(t).push(k); } });
  for (const [t, ks] of groups) {
    const main = meshes[t], alts = ks.map(k => meshes[k]);
    for (const sl of options.slots) sl.members = sl.members.filter(id => !alts.some(m => m.uuid === id));
    let sl = slotOf(main);
    if (!sl) { const cn = commonName([main.name, ...alts.map(m => m.name)]); sl = { id: uid(), name: /^Slot \d+$/.test(cn) ? `${main.name} options` : cn, members: [main.uuid], active: main.uuid }; options.slots.push(sl); }
    sl.members.push(...alts.map(m => m.uuid)); nOpt += alts.length;
    shareSlotJoint(sl, main);
  }
  if (groups.size) applyOptions();
  let nLinks = 0;
  for (const q of ar.loopOn || []) {                   // extra pins where the tree left a contact out
    const a = meshes[q.i], b2 = meshes[q.j], pt = V().copy(q.centre || q.joint); a.updateMatrixWorld(true); b2.updateMatrixWorld(true);
    links.push({ id: uid(), a: a.uuid, b: b2.uuid, pa: pt.clone().applyMatrix4(a.matrixWorld.clone().invert()).toArray(), pb: pt.clone().applyMatrix4(b2.matrixWorld.clone().invert()).toArray(), kind: 'pin', axis: 'z', min: null, max: null });
    nLinks++;
  }
  const base = meshes[rows.findIndex(r => r.parent < 0 && r.optionOf < 0)] || meshes[0];
  closeAutorig(); afterHierarchyChange(); select(base);
  if (warns.length) toast(warns[0], 'bad');
  else toast(`Built the rig from ${base.name}: ${joints} joint${joints === 1 ? '' : 's'}${fixed ? `, ${fixed} fixed` : ''}${nOpt ? `, ${groups.size} option slot${groups.size > 1 ? 's' : ''}` : ''}${nLinks ? `, ${nLinks} extra pin${nLinks > 1 ? 's' : ''}` : ''}. Press P to pose.`, 'ok');
}
function bindAutorig() {
  $('ar-root').addEventListener('change', () => {
    const opts = ar.rows.map(r => r.optionOf);                     // keep the options; re-plan the links from the new base
    ar.plan = planRig(ar.meshes, ar.pairs, +$('ar-root').value); rowsFromPlan();
    opts.forEach((o, k) => { if (o >= 0) ar.rows[k].optionOf = o; });
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
  if (tool === 'LUCKY') { handleLuckyClick(hit); return; }
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
  if (camera.isOrthographicCamera) {                              // orthographic: zoom is a scale; keep the spot under the cursor still
    const r = renderer.domElement.getBoundingClientRect(), nx = ((e.clientX - r.left) / r.width) * 2 - 1, ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    const z0 = camera.zoom, z1 = Math.min(Math.max(z0 * Math.exp(-dy * 0.0018), 1e-3), 1e5), k = 1 / z0 - 1 / z1;
    const right = V(1, 0, 0).applyQuaternion(camera.quaternion), upv = V(0, 1, 0).applyQuaternion(camera.quaternion);
    const shift = right.multiplyScalar(nx * (camera.right - camera.left) / 2 * k).add(upv.multiplyScalar(ny * (camera.top - camera.bottom) / 2 * k));
    camera.position.add(shift); orbit.target.add(shift); camera.zoom = z1; camera.updateProjectionMatrix(); orbit.update(); markViewMoved(); return;
  }
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
  if (camera.isOrthographicCamera) {
    const S = Math.max(sceneScale(), mat.children.length ? Math.hypot(MAT.w, MAT.h) : 0), d0 = camera.position.distanceTo(orbit.target);
    if (d0 < S * 2) camera.position.copy(orbit.target).addScaledVector(fwd(), -S * 3);
    const d = camera.position.distanceTo(orbit.target), near = Math.max(0.01, d - S * 2.5), far = d + S * 20;
    if (Math.abs(near - camera.near) > near * 0.05 || Math.abs(far - camera.far) > far * 0.05) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
    return;
  }
  const d = camera.position.distanceTo(orbit.target), S = Math.max(sceneScale(), mat.children.length ? Math.hypot(MAT.w, MAT.h) : 0);
  const near = Math.max(0.005, Math.min(d * 0.02, S * 0.01)), far = Math.max(S * 20, d * 20, 500);
  if (Math.abs(near - camera.near) > near * 0.05 || Math.abs(far - camera.far) > far * 0.05) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
}
function markViewMoved() { orbit.dispatchEvent({ type: 'end' }); }
/** Switch between perspective and orthographic, keeping the view the same size. */
function setOrtho(on) {
  if (!!on === camera.isOrthographicCamera) return;
  const t = orbit.target.clone(), f = fwd(), d = camera.position.distanceTo(t), halfFov = perspCam.fov * Math.PI / 360;
  if (on) {
    orthoCam.quaternion.copy(perspCam.quaternion); orthoCam.position.copy(t).addScaledVector(f, -Math.max(d, sceneScale() * 3));
    orthoCam.zoom = ORTHO_H / Math.max(d * Math.tan(halfFov), 1e-3); camera = orthoCam;
  } else {
    perspCam.quaternion.copy(orthoCam.quaternion); perspCam.position.copy(t).addScaledVector(f, -(ORTHO_H / orthoCam.zoom) / Math.tan(halfFov)); camera = perspCam;
  }
  camera.add(sun); orbit.object = camera; tc.camera = camera;
  resize(); camera.updateProjectionMatrix(); fitClipPlanes(); orbit.update(); markViewMoved();
  $('nav-proj').textContent = on ? 'Ortho' : 'Persp'; $('nav-proj').setAttribute('aria-pressed', String(!!on));
  $('menu-ortho')?.setAttribute('aria-checked', String(!!on));
}

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
  const pics = fs.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
  (async () => { for (const f of pics) await addRefImage(f); })();
  const rest = fs.filter(f => !pics.includes(f)); if (rest.length) importFiles(rest); });
['drop', 'dragend'].forEach(t => window.addEventListener(t, hideDrop));
window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });   // stop the browser opening a missed drop as a file

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.querySelector('.mtop[aria-expanded="true"]')) { e.preventDefault(); closeMenus(); return; }
  if (loading.on) { if (e.key === 'Escape' && loading.stop) { e.preventDefault(); loading.stop(); } return; }     // nothing else while it works
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
  if (e.code === 'Numpad5') { e.preventDefault(); setOrtho(!camera.isOrthographicCamera); toast(camera.isOrthographicCamera ? 'Orthographic view: no perspective, so things line up with references.' : 'Perspective view.'); return; }
  const pad = { Numpad1: V(0, -1, 0), Numpad3: V(1, 0, 0), Numpad7: V(0, 0, 1) }[e.code];
  if (pad) { e.preventDefault(); navCube.goTo(e.ctrlKey || e.metaKey ? pad.negate() : pad); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const map = { '1': 'select', g: 'move', r: 'rotate', p: 'pose', o: 'ORIENT', b: 'BALL', h: 'PLANE', m: 'MID', t: 'THREE', j: 'MATCH', c: 'paint', n: 'MAGNET', l: 'LUCKY' };
  if (k === 'e' && tool === 'paint') { const c = $('paint-erase'); c.checked = !c.checked; toast(c.checked ? 'Erasing back to bare plastic.' : 'Painting.'); return; }
  if (map[k]) { setTool(map[k]); return; }
  if (k === 'escape' && benchSel) { select(null); syncGizmo(); renderPartPanel(); return; }
  if (k === 'escape' && magPending) { magPending = null; rebuildMagnets(); updateStep(); toast('Cancelled that magnet.'); return; }
  if (k === 'escape') { if (!$('orient').hidden) { closeOrient(); return; } if (picks.length) cancelPick(); else if (tool === 'select' && selection.length) select(null); else setTool('select'); return; }
  if (k === 'enter' && tool === 'MATCH' && picks.length) { e.preventDefault(); applyMatch(); return; }
  if (k === 'enter' && tool === 'LUCKY' && !luckyFirst && selection.length === 2) { e.preventDefault(); feelLucky(selection[0], selection[1]); return; }
  if (k === 'escape' && luckyFirst) { luckyFirst = null; updateStep(); toast('Cancelled.'); return; }
  if (k === 'backspace' && picks.length) { e.preventDefault(); picks.pop(); rebuildPickFx(); updateStep(); return; }
  if ((k === 'delete' || k === 'x') && benchSel) {
    if (benchSel.kind === 'ref') removeRef(benchSel.k);
    else if (benchSel.kind === 'sprue') removeSprue(benchSel.k);
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
const SETTING_IDS = ['lucky-effort', 'set-smooth', 'set-balltol', 'set-radius', 'set-flat', 'set-joints', 'set-qty', 'set-orbitsel', 'set-plastic', 'ar-tol', 'set-crease', 'exp-fill', 'exp-gap', 'exp-overlap', 'exp-pockets', 'exp-pocket-res', 'exp-pocket-drain'];
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
    joints: joints.filter(j => j.parent).map(j => { const jd = j.userData.joint; return { id: j.uuid, parent: parentId(j), size: jd.size, rest: jd.rest.toArray(),
      type: jd.type || 'pinned', restPos: jd.restPos.toArray(), min: jd.min, max: jd.max, axis: jd.axis || null, ...tr(j) }; }),
    links: JSON.parse(JSON.stringify(links)),
    refs: JSON.parse(JSON.stringify(refs)),
    settings: Object.fromEntries(SETTING_IDS.map(id => [id, $(id).type === 'checkbox' ? $(id).checked : $(id).value])),
    camera: { pos: camera.position.toArray(), target: orbit.target.toArray(), ortho: camera.isOrthographicCamera, zoom: camera.zoom },
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
  for (const j of data.joints || []) { const o = makeJoint(j.size || 0.5); o.uuid = j.id; const jd = o.userData.joint; jd.rest.fromArray(j.rest);
    Object.assign(jd, { type: j.type || 'pinned', min: j.min ?? null, max: j.max ?? null, axis: j.axis || null }); jd.restPos.fromArray(j.restPos || j.pos); byId.set(j.id, o); }
  const place = (o, rec) => { (rec.parent && byId.get(rec.parent) || world).add(o); o.position.fromArray(rec.pos); o.quaternion.fromArray(rec.quat); o.scale.fromArray(rec.scale); };
  for (const j of data.joints || []) place(byId.get(j.id), j);
  for (const p of data.parts) if (byId.has(p.id)) place(byId.get(p.id), p);
  colorIx = parts.length;
  options = data.options ? JSON.parse(JSON.stringify(data.options)) : { slots: [], sets: [] }; applyOptions();
  sprues = data.sprues ? JSON.parse(JSON.stringify(data.sprues)) : null;
  magnets = Array.isArray(data.magnets) ? JSON.parse(JSON.stringify(data.magnets)) : [];
  links = Array.isArray(data.links) ? JSON.parse(JSON.stringify(data.links)) : [];
  refs = Array.isArray(data.refs) ? JSON.parse(JSON.stringify(data.refs)) : []; rebuildRefs();
  kit = data.kit ? JSON.parse(JSON.stringify(data.kit)) : null; book.doc = null; buildKit().then(() => fitMat(true));
  applyPlastic();
  project.id = data.id; project.name = data.name || 'Untitled kit'; $('proj-name').value = project.name;
  project.saved = new Set(data.parts.map(p => p.geom));
  if (data.camera) { setOrtho(false); camera.position.fromArray(data.camera.pos); orbit.target.fromArray(data.camera.target); orbit.update();
    if (data.camera.ortho) { setOrtho(true); if (data.camera.zoom) { camera.zoom = data.camera.zoom; camera.updateProjectionMatrix(); } } }
  afterHierarchyChange(); updateButtons();
  project.loading = false; project.dirty = false; project.pristine = false;
  if (missing.length) toast(`Couldn't find the mesh for ${missing.join(', ')}.`, 'bad');
}

function markDirty() {
  if (project.loading) return;
  project.pristine = false;
  project.dirty = true; project.ver = (project.ver || 0) + 1; setProjStatus('unsaved', 'busy');
  clearTimeout(project.timer); project.timer = setTimeout(saveToBrowser, 1200);
}
async function saveToBrowser() {
  // a save already running: wait for it, then save whatever changed while it ran (switching projects relies on this)
  if (project.saving) { await project.saving; if (project.dirty) return saveToBrowser(); return; }
  if (!(await idbReady)) { setProjStatus('not saved', 'bad'); $('proj-note').textContent = "This browser isn't letting the page store data (a private window, or site data blocked). Use Save project file to keep your work."; return; }
  let finished; project.saving = new Promise(r => { finished = r; }); setProjStatus('saving…', 'busy');
  const ver = project.ver || 0;
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
    for (const k of [kit?.image, kit?.pdf, ...refs.map(r => r.asset)].filter(Boolean)) {   // box art, instructions and reference pictures, stored once like meshes
      if (project.saved.has(k) || !assets.has(k)) continue;
      await idbReq('geoms', 'readwrite', st => st.put(assets.get(k), k)); project.saved.add(k);
    }
    await idbReq('projects', 'readwrite', st => st.put(data));
    if ((project.ver || 0) === ver) project.dirty = false;            // changed while saving: the timer saves again
    else { clearTimeout(project.timer); project.timer = setTimeout(saveToBrowser, 400); }
    if (!project.dirty) setProjStatus(`saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, 'ok');
    try { localStorage.setItem('kitbash-last', project.id); } catch (e) {}
    if (!$('dlg-projects').hidden) renderProjectList();
  } catch (e) {
    setProjStatus('not saved', 'bad');
    $('proj-note').textContent = /quota/i.test(e?.name || e?.message || '') ? "Browser storage is full. Delete old saved projects, or use Save project file." : `Couldn't save in this browser (${e?.message || 'storage error'}). Use Save project file to keep your work.`;
  } finally { project.saving = null; finished(); }
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
    for (const k of [data.kit?.image, data.kit?.pdf, ...(data.refs || []).map(r => r.asset)].filter(Boolean)) { const rec = await idbReq('geoms', 'readonly', st => st.get(k)); if (rec) assets.set(k, rec); }
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
  for (const k of [kit?.image, kit?.pdf, ...refs.map(r => r.asset)].filter(Boolean)) { const a = assets.get(k); if (a) files.push({ name: `assets/${k.slice(6)}`, data: new Blob([a.data]) }); }
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
    for (const [k, type, name] of [[data.kit?.image, 'image', data.kit?.artName], [data.kit?.pdf, 'application/pdf', data.kit?.pdfName], ...(data.refs || []).map(r => [r.asset, 'image', r.name + '.png'])]) {
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
  on('menu-ortho', () => setOrtho(!camera.isOrthographicCamera));
  on('menu-addref', () => $('ref-input').click());
  $('ref-input').addEventListener('change', async () => { for (const f of [...$('ref-input').files]) await addRefImage(f); $('ref-input').value = ''; });
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
  renderer.setSize(w, h, false); perspCam.aspect = w / h; perspCam.updateProjectionMatrix();
  orthoCam.left = -ORTHO_H * w / h; orthoCam.right = ORTHO_H * w / h; orthoCam.top = ORTHO_H; orthoCam.bottom = -ORTHO_H; orthoCam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
bindAdjust();
bindFit();
bindProject();
bindAutorig(); bindTreeDnD();
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
if (new URLSearchParams(location.search).has('kbtest')) { window.__kb = { THREE, get camera() { return camera; }, setOrtho, get refs() { return refs; }, rebuildRefs, silhouette, refMask, poseFigures, overlap, orbit, scene, liveParts, renderer, tc, proxy, get links() { return links; }, jointOf, solveLinks, get sprues() { return sprues; }, get kit() { return kit; }, get magnets() { return magnets; }, cutMagnetHoles }; }
