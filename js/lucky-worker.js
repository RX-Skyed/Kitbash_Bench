// Kitbash Bench · a background helper for "Do ya feel lucky?". Several of these split the search between them.
import * as L from './lucky.js';

let ctx = null, A = null, B = null;
self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'prepare') {                 // the first helper builds the grid and the samples for everyone
      A = m.A; B = m.B;
      ctx = L.prepare(A, B, { ...m.opts, tick: f => self.postMessage({ type: 'tick', f }) });
      self.postMessage({ type: 'ctx', ctx });
    } else if (m.type === 'ctx') {              // the others are handed a copy
      ctx = m.ctx; self.postMessage({ type: 'ready' });
    } else if (m.type === 'search') {
      let last = 0;
      const r = L.searchAnchors(ctx, m.list, (f, n) => { const now = performance.now(); if (now - last > 150 || f === 1) { last = now; self.postMessage({ type: 'progress', f, n }); } });
      self.postMessage({ type: 'found', mine: r.mine, best: r.best, poses: r.poses });
    } else if (m.type === 'refine') {
      self.postMessage({ type: 'refined', out: L.refineAll(ctx, m.starts) });
    } else if (m.type === 'rank') {
      self.postMessage({ type: 'ranked', fits: L.rankFits(ctx, m.refined, m.max) });
    } else if (m.type === 'contact') {
      self.postMessage({ type: 'contact', res: m.fits.map(f => L.contactOf(ctx, f, A, B)) });
    }
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.stack || err) }); }
};
