// Kitbash Bench · background work with Manifold (exact mesh booleans, Apache 2.0): merging parts into one clean solid,
// and building reliefs from pictures. Manifold ships with the page in js/vendor, so it works offline.
import Module from './vendor/manifold.js';
import { mergeSolid } from './solid.js';
import { buildRelief } from './relief.js';
import { buildCrack } from './crack.js';
import { buildSplit } from './split.js';
import { buildOoze } from './ooze.js';
import { buildClean } from './clean.js';
const ready = (async () => {
  const M = await Module({ locateFile: f => new URL('./vendor/' + f, import.meta.url).href }); M.setup(); return M;
})();
self.onmessage = async e => {
  const { id, jobs, opts, relief, crack, split, ooze, clean } = e.data;
  try {
    const M = await ready;
    if (relief) { const r = buildRelief(M, relief); self.postMessage({ id, out: r }, [r.positions.buffer]); return; }
    if (crack) { const r = buildCrack(M, crack); self.postMessage({ id, out: r }, [r.positions.buffer]); return; }
    if (clean) { const r = buildClean(M, clean); self.postMessage({ id, out: r }, [r.positions.buffer]); return; }
    if (ooze) { const r = buildOoze(M, ooze); self.postMessage({ id, out: r }, [r.positions.buffer]); return; }
    if (split) { const r = buildSplit(M, split); self.postMessage({ id, out: r }, [r.positions.buffer, r.sides.buffer]); return; }
    const out = jobs.map(j => mergeSolid(M, j.soups, { ...opts, subtract: j.subtract }));
    self.postMessage({ id, out }, out.map(r => r.positions.buffer));
  } catch (err) { self.postMessage({ id, error: String(err && (err.stack || err.message) || err) }); }
};
