// Kitbash Bench · merges parts into one clean solid in the background, with Manifold (exact mesh booleans, Apache 2.0),
// which ships with the page in js/vendor so it works offline and needs nothing from the internet.
import Module from './vendor/manifold.js';
import { mergeSolid } from './solid.js';
const ready = (async () => {
  const M = await Module({ locateFile: f => new URL('./vendor/' + f, import.meta.url).href }); M.setup(); return M;
})();
self.onmessage = async e => {
  const { id, jobs, opts } = e.data;
  try {
    const M = await ready;
    const out = jobs.map(j => mergeSolid(M, j.soups, { ...opts, subtract: j.subtract }));
    self.postMessage({ id, out }, out.map(r => r.positions.buffer));
  } catch (err) { self.postMessage({ id, error: String(err && (err.stack || err.message) || err) }); }
};
