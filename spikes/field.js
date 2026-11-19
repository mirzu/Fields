// Field spike v2: visits grow fibers; breaths are shared gusts that comb fibers and slowly relax;
// pinwheels leave strokes that also bend with the local comb.
const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- deterministic RNG ----------
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261119);
const pareto = (xm, alpha) => xm / Math.pow(1 - rnd(), 1 / alpha);
const expo = (mean) => -Math.log(1 - rnd()) * mean;

// ---------- wind: sea-breeze mapping ----------
// Midday (14:00) blows along AXIS, midnight (02:00) the opposite way, dawn/dusk calm.
const AXIS = -0.4;
const AXIS_PERP = { x: -Math.sin(AXIS), y: Math.cos(AXIS) };
function windAt(hour) {
  const s = Math.cos((TAU * (hour - 14)) / 24);
  return { x: Math.cos(AXIS) * s, y: Math.sin(AXIS) * s, s };
}
// Colour follows time of day: day amber → dawn/dusk rose → night blue.
const hueOfHour = (hour) => (40 - ((1 - windAt(hour).s) / 2) * 180 + 360) % 360;
const nowHour = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

// ---------- fake data ----------
const HABITS = [
  { name: 'office', w: 3, hour: () => 9 + rnd() * 9 },
  { name: 'home', w: 4, hour: () => (17 + rnd() * 7) % 24 },
  { name: 'night owls', w: 1, hour: () => (22 + rnd() * 7) % 24 },
  { name: 'mixed', w: 2, hour: () => (rnd() < 0.5 ? 9 + rnd() * 9 : (17 + rnd() * 7) % 24) },
  { name: 'VPN', w: 0.6, hour: () => rnd() * 24 },
];
const pickHabit = () => {
  let x = rnd() * HABITS.reduce((a, h) => a + h.w, 0);
  for (const h of HABITS) if ((x -= h.w) < 0) return h;
  return HABITS[0];
};

function makeEnvelope() {
  const peakPos = 0.05 + rnd() * 0.4, k = 2 + rnd() * 5, env = [];
  for (let i = 0; i < 16; i++) {
    const x = i / 15;
    const v = x < peakPos ? x / peakPos : Math.exp(-(x - peakPos) * k);
    env.push(clamp(v * (0.85 + rnd() * 0.3), 0, 1));
  }
  return env;
}

const FIBERS_PER_VISIT = 5;
const FS = 0.55; // fiber spacing (world units)

const heads = [];   // one per /8
const patches = []; // one per /16
const gusts = [];   // all breath events (shared)

function generate() {
  const used = new Set();
  while (used.size < 140) used.add(1 + Math.floor(rnd() * 223));
  for (const a of [...used].sort((x, y) => x - y)) {
    const head = { a, patches: [] };
    const nP = Math.min(220, Math.floor(pareto(2, 0.85)));
    const bs = new Set();
    let b = Math.floor(rnd() * 256);
    while (bs.size < nP) { bs.add(b); b = rnd() < 0.75 ? (b + 1) % 256 : Math.floor(rnd() * 256); }
    for (const b of [...bs].sort((x, y) => x - y)) {
      const habit = pickHabit();
      const crowd = rnd() < 0.04;
      const nVisits = crowd ? 60 + Math.floor(rnd() * 200) : Math.max(1, Math.min(80, Math.floor(pareto(1, 1.1))));
      const p = { a, b, head, habit, crowd, fibers: [], pins: [], affecting: [], idx: patches.length };
      // Oldest visits first, so fibers grow outward like rings.
      const visits = [];
      for (let i = 0; i < nVisits; i++) visits.push({ hour: habit.hour(), age: expo(60) });
      visits.sort((x, y) => y.age - x.age);
      for (const v of visits) addFibers(p, v.hour, v.age);
      const pinBias = rnd() < 0.1 ? 0.5 : 0.05;
      const nPins = Math.floor(nVisits * pinBias * rnd());
      for (let i = 0; i < nPins; i++) addPin(p, habit.hour(), expo(8), false);
      p.pendingGusts = Math.min(16, Math.floor(rnd() * (1 + nVisits * 0.35)));
      head.patches.push(p);
      patches.push(p);
    }
    heads.push(head);
  }
}

function addFibers(p, hour, ageDays) {
  for (let k = 0; k < FIBERS_PER_VISIT; k++) {
    const j = p.fibers.length;
    const ang = j * GA;
    const rest = ang + (rnd() - 0.5) * 0.5;
    p.fibers.push({
      j, hour, age: ageDays,
      rr: FS * Math.sqrt(j + 0.5), ang,
      rx: Math.cos(rest), ry: Math.sin(rest),
      len: 1.1 + rnd() * 0.9,
      jit: rnd(), seed: rnd(),
    });
  }
}

function addPin(p, hour, ageDays, live) {
  const w = windAt(hour);
  p.pins.push({
    hour, age: ageDays, u: rnd(), v: rnd(), spin: rnd() < 0.5 ? 1 : -1, peak: 0.3 + rnd() * 0.7,
    wx: w.x, wy: w.y, ws: w.s, born: live ? performance.now() : -1e12,
  });
}

// ---------- layouts ----------
function relax(items, iters, gap, pull) {
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < items.length; i++) {
      const A = items[i];
      for (let j = i + 1; j < items.length; j++) {
        const B = items[j];
        let dx = B.x - A.x, dy = B.y - A.y;
        let d = Math.hypot(dx, dy);
        const min = A.r + B.r + gap;
        if (d >= min) continue;
        if (d < 1e-6) { dx = rnd() - 0.5; dy = rnd() - 0.5; d = Math.hypot(dx, dy); }
        const push = (min - d) / 2;
        const wa = B.r / (A.r + B.r), wb = 1 - wa;
        A.x -= (dx / d) * push * wa * 2; A.y -= (dy / d) * push * wa * 2;
        B.x += (dx / d) * push * wb * 2; B.y += (dy / d) * push * wb * 2;
      }
    }
    for (const I of items) { I.x *= 1 - pull; I.y *= 1 - pull; }
  }
}
function packByAngle(items, key, span) {
  const area = items.reduce((s, I) => s + Math.PI * I.r * I.r, 0);
  const R = Math.sqrt(area / Math.PI);
  for (const I of items) {
    const ang = (TAU * key(I)) / span, rad = R * (0.45 + 0.5 * rnd());
    I.x = Math.cos(ang) * rad; I.y = Math.sin(ang) * rad;
  }
  relax(items, 80, 0.3, 0.02);
  relax(items, 40, 0.3, 0);
  let ext = 0;
  for (const I of items) ext = Math.max(ext, Math.hypot(I.x, I.y) + I.r);
  return ext;
}

function layoutMeadow() {
  for (const p of patches) p.mr = FS * Math.sqrt(p.fibers.length) + 1.4;
  for (const h of heads) {
    const items = h.patches.map((p) => ({ p, r: p.mr, x: 0, y: 0 }));
    h.mr = packByAngle(items, (I) => I.p.b, 256) + 0.5;
    for (const I of items) { I.p.mlx = I.x; I.p.mly = I.y; }
  }
  const items = heads.map((h) => ({ h, r: h.mr, x: 0, y: 0 }));
  packByAngle(items, (I) => I.h.a, 224);
  for (const I of items) {
    I.h.mx = I.x; I.h.my = I.y;
    for (const p of I.h.patches) { p.mx = I.x + p.mlx; p.my = I.y + p.mly; }
  }
}

function d2xy(n, d) {
  let x = 0, y = 0, t = d;
  for (let s = 1; s < n; s *= 2) {
    const rx = 1 & (t >> 1), ry = 1 & (t ^ rx);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
    x += s * rx; y += s * ry; t >>= 2;
  }
  return [x, y];
}
const CELL = 4;
function layoutHilbert() {
  const half = 128 * CELL;
  for (const p of patches) {
    const [x, y] = d2xy(256, p.a * 256 + p.b);
    p.hx = x * CELL + CELL / 2 - half; p.hy = y * CELL + CELL / 2 - half; p.hr = CELL * 0.45;
  }
  for (const h of heads) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let b = 0; b < 256; b += 15) {
      const [x, y] = d2xy(256, h.a * 256 + b);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    h.hx = ((x0 + x1 + 1) / 2) * CELL - half; h.hy = ((y0 + y1 + 1) / 2) * CELL - half;
    h.hr = 8 * CELL * Math.SQRT2;
  }
}
// Fiber and pin positions inside a patch, for both layouts (meadow local positions grow with
// visits; new fibers can spill past the laid-out radius until the next re-layout).
function placeInPatch(p) {
  const n = p.fibers.length;
  for (const f of p.fibers) {
    f.mlx = Math.cos(f.ang) * f.rr; f.mly = Math.sin(f.ang) * f.rr;
    const hr = p.hr * 0.9 * Math.sqrt((f.j + 0.5) / n);
    f.hlx = Math.cos(f.ang) * hr; f.hly = Math.sin(f.ang) * hr;
  }
  for (const s of p.pins) placePin(p, s);
}
function placePin(p, s) {
  const r = Math.sqrt(s.u), a = s.v * TAU;
  s.mlx = Math.cos(a) * r * (p.mr - 1); s.mly = Math.sin(a) * r * (p.mr - 1);
  s.hlx = Math.cos(a) * r * p.hr * 0.9; s.hly = Math.sin(a) * r * p.hr * 0.9;
}

// ---------- gusts (breaths) ----------
// A gust combs fibers along its frozen wind. Weight falls off with distance from where it
// landed (in meadow space, so the neighbourhood is the same whatever the view), is strongest
// in its own patch and reaches only patches of the same /8 clump.
const params = { hours: 0, halfLife: 12, fresh: 5, labels: true, neighbours: true };

function addGust(p, hour, ageHours, live, character = {}) {
  const w = windAt(hour);
  const peak = character.peak ?? 0.3 + rnd() * 0.7;
  const cent = character.cent ?? rnd();
  const flat = character.flat ?? rnd();
  const env = character.env ?? makeEnvelope();
  // Calm hours (dawn/dusk) still stir: blend in a sideways swirl.
  const calm = 1 - Math.abs(w.s);
  let dx = w.x + AXIS_PERP.x * calm * (rnd() < 0.5 ? -1 : 1), dy = w.y + AXIS_PERP.y * calm * (rnd() < 0.5 ? -1 : 1);
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const cum = []; let acc = 0;
  for (const v of env) { acc += v; cum.push(acc); }
  for (let i = 0; i < 16; i++) cum[i] /= acc || 1;
  const r = Math.sqrt(rnd()) * (p.mr - 1), a = rnd() * TAU;
  const reach = (3 + 9 * peak) * (1.3 - 0.6 * cent); // dark breaths are broad and gentle
  const g = {
    patch: p, hour, ageH: ageHours, born: live ? performance.now() : -1e12,
    ox: p.mx + Math.cos(a) * r, oy: p.my + Math.sin(a) * r,
    dx, dy, peak, cent, flat, env, cum,
    mag: (0.35 + 0.65 * Math.abs(w.s)) * (0.5 + peak) * (0.8 + 0.4 * cent),
    reach2: reach * reach, reach,
    playMs: 1800 + 2200 * rnd(),
    _frame: -1, _play: 1, _tr: 0, _dec: 1,
  };
  gusts.push(g);
  for (const q of p.head.patches) {
    const d = Math.hypot(q.mx - g.ox, q.my - g.oy) - q.mr;
    if (q === p || d < reach * 2.2) {
      q.affecting.push(g);
      if (q.affecting.length > 40) q.affecting.shift(); // spike: cap per patch
      if (live) q.liveUntil = Math.max(q.liveUntil || 0, g.born + g.playMs);
      q._lf = -1e9;
    }
  }
  return g;
}

let frameId = 0, nowMs = 0;
function gustState(g) {
  if (g._frame === frameId) return g;
  g._frame = frameId;
  const since = nowMs - g.born;
  if (since < g.playMs) {
    const t = clamp(since / g.playMs, 0, 1) * 15, i = Math.floor(t), f = t - i, i2 = Math.min(15, i + 1);
    g._play = lerp(g.cum[i], g.cum[i2], f);
    g._tr = lerp(g.env[i], g.env[i2], f);
  } else { g._play = 1; g._tr = 0; }
  const ageH = g.ageH + params.hours + (g.born > 0 ? since / 3.6e6 : 0);
  g._dec = Math.pow(0.5, ageH / params.halfLife);
  return g;
}

// Lean (combing) at a meadow-space point inside patch p. jit spreads direction by breathiness.
const out = { x: 0, y: 0, wob: 0 };
function leanAt(p, x, y, jit) {
  let lx = 0, ly = 0, wob = 0;
  for (const g0 of p.affecting) {
    const g = gustState(g0);
    if (g._dec < 0.01 && g._tr === 0) continue;
    const ddx = x - g.ox, ddy = y - g.oy;
    let w = Math.exp(-(ddx * ddx + ddy * ddy) / g.reach2);
    if (g.patch === p) w = Math.max(w, 0.55); else w *= 0.75;
    if (w < 0.01) continue;
    const j = (jit - 0.5) * g.flat * 1.2;
    const dx = g.dx - g.dy * j, dy = g.dy + g.dx * j;
    const m = g.mag * w * (g._play * g._dec + g._tr * 0.9);
    lx += dx * m; ly += dy * m;
    wob += g._tr * w * (0.3 + g.flat);
  }
  const L = Math.hypot(lx, ly), soft = L > 0 ? 1.3 / (1 + L) : 0; // saturates near 1.3
  out.x = lx * soft; out.y = ly * soft; out.wob = wob;
  return out;
}

// Lean at a patch centre, cached: only recomputed every ~0.5 s unless a gust is playing there.
function centreLean(p) {
  if (!p.affecting.length) return ZERO;
  if (p._cl && frameId - p._lf < 30 && nowMs > (p.liveUntil || 0)) return p._cl;
  const ln = leanAt(p, p.mx, p.my, 0.5);
  p._cl = { x: ln.x, y: ln.y, wob: ln.wob }; p._lf = frameId;
  return p._cl;
}
const ZERO = { x: 0, y: 0, wob: 0 };

// ---------- per-patch summary (colour, recency) ----------
function circMean(list) {
  let x = 0, y = 0, w = 0;
  for (const it of list) { x += Math.cos((it.h * Math.PI) / 180) * it.w; y += Math.sin((it.h * Math.PI) / 180) * it.w; w += it.w; }
  return w ? ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360 : 90;
}
function summarise(p) {
  const hs = [];
  let rec = 0;
  for (const f of p.fibers) {
    f.rec = Math.exp(-f.age / 20);
    f.hue = hueOfHour(f.hour);
    const l = Math.round(55 + 28 * f.rec), al = (0.5 + 0.5 * f.rec).toFixed(2);
    f.col = `hsla(${Math.round(f.hue / 8) * 8},70%,${Math.round(l / 6) * 6}%,${(Math.round(al * 5) / 5).toFixed(1)})`;
    hs.push({ h: f.hue, w: 0.3 + f.rec });
    rec += f.rec;
  }
  p.hue = circMean(hs);
  p.rec = rec / (p.fibers.length || 1);
  p.drawOrder = [...p.fibers].sort((a, b) => (a.col < b.col ? -1 : a.col > b.col ? 1 : 0));
}
function summariseHead(h) {
  const hs = [];
  let n = 0, rec = 0;
  for (const p of h.patches) { hs.push({ h: p.hue, w: p.fibers.length }); n += p.fibers.length; rec += p.rec * p.fibers.length; }
  h.hue = circMean(hs); h.fiberCount = n; h.rec = rec / (n || 1);
}

// ---------- camera ----------
const cv = $('field'), g = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { x: 0, y: 0, scale: 1 };
let camAnim = null;
let layoutT = 0, layoutTarget = 0; // 0 meadow, 1 Hilbert

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = W * DPR; cv.height = H * DPR;
}
window.addEventListener('resize', resize);
const toScreen = (x, y) => [(x - cam.x) * cam.scale + W / 2, (y - cam.y) * cam.scale + H / 2];
const toWorld = (sx, sy) => [(sx - W / 2) / cam.scale + cam.x, (sy - H / 2) / cam.scale + cam.y];

function worldBounds(t) {
  let ext = 0;
  for (const h of heads) {
    const x = lerp(h.mx, h.hx, t), y = lerp(h.my, h.hy, t), r = lerp(h.mr, h.hr, t);
    ext = Math.max(ext, Math.abs(x) + r, Math.abs(y) + r);
  }
  return ext;
}
function flyTo(x, y, scale, ms = 1200) { camAnim = { from: { ...cam }, to: { x, y, scale }, t0: performance.now(), ms }; }
function fitAll(t = layoutTarget, ms = 1200) { flyTo(0, 0, (Math.min(W, H) / (2 * worldBounds(t))) * 0.95, ms); }

const pointers = new Map();
let pinch = null;
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  cv.classList.add('dragging'); camAnim = null;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: cam.scale };
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId), cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (pointers.size === 1) {
    cam.x -= (cur.x - prev.x) / cam.scale; cam.y -= (cur.y - prev.y) / cam.scale;
  } else if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d / cam.scale);
    cam.x -= (cur.x - prev.x) / 2 / cam.scale; cam.y -= (cur.y - prev.y) / 2 / cam.scale;
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (!pointers.size) cv.classList.remove('dragging');
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('wheel', (e) => {
  e.preventDefault(); camAnim = null;
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
}, { passive: false });
cv.addEventListener('dblclick', (e) => { const [x, y] = toWorld(e.clientX, e.clientY); flyTo(x, y, cam.scale * 3, 600); });
function zoomAt(sx, sy, f) {
  const [wx, wy] = toWorld(sx, sy);
  cam.scale = clamp(cam.scale * f, 0.05, 400);
  cam.x = wx - (sx - W / 2) / cam.scale; cam.y = wy - (sy - H / 2) / cam.scale;
}

// ---------- sprites ----------
const blobCache = new Map();
function blob(h, s, l) {
  const key = `${Math.round(h / 6) * 6},${Math.round(s / 10) * 10},${Math.round(l / 5) * 5}`;
  let c = blobCache.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    const [hh, ss, ll] = key.split(',').map(Number);
    gr.addColorStop(0, `hsla(${hh},${ss}%,${ll}%,1)`);
    gr.addColorStop(0.45, `hsla(${hh},${ss}%,${ll}%,0.55)`);
    gr.addColorStop(1, `hsla(${hh},${ss}%,${ll}%,0)`);
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    blobCache.set(key, c);
  }
  return c;
}
function drawBlob(sx, sy, r, h, s, l, a) {
  if (a <= 0.01 || r < 0.5) return;
  g.globalAlpha = clamp(a, 0, 1);
  g.drawImage(blob(h, s, l), sx - r, sy - r, r * 2, r * 2);
  g.globalAlpha = 1;
}

// ---------- drawing ----------
const HEAD_DETAIL = 70; // px: below this a /8 is one summary head
const FIBER_DETAIL = 26; // px: above this a /16 shows its fibers
let time = 0, drawnFibers = 0;

// Summary head: filaments radiate, combed by the lean at its centre.
function drawHeadIcon(sx, sy, sr, hue, fiberCount, rec, lean, pinsLive, id) {
  drawBlob(sx, sy, sr * 1.25, hue, 40 + 40 * rec, 30, 0.2 + 0.35 * Math.min(1, fiberCount / 300));
  if (sr < 1.5) return;
  const fullness = Math.log2(1 + fiberCount);
  const n = Math.round(clamp(3 + fullness * 4, 3, Math.min(56, 3 + sr * 0.9)));
  const curved = sr > 14;
  const len = sr * clamp(0.3 + fullness * 0.07, 0.3, 0.95);
  const lm = Math.min(1, Math.hypot(lean.x, lean.y));
  const wob = Math.sin(time * 10 + id) * lean.wob * 0.15;
  g.strokeStyle = `hsla(${hue},${45 + 40 * rec}%,${60 + 25 * rec}%,${clamp(0.3 + fullness * 0.06, 0, 0.85)})`;
  g.lineWidth = Math.max(0.6, sr * 0.025);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * GA + wob, rx = Math.cos(a), ry = Math.sin(a);
    const tx = rx * (1 - lm * 0.6) + lean.x, ty = ry * (1 - lm * 0.6) + lean.y;
    g.moveTo(sx, sy);
    if (curved) g.quadraticCurveTo(sx + rx * len * 0.45, sy + ry * len * 0.45, sx + tx * len, sy + ty * len);
    else g.lineTo(sx + tx * len, sy + ty * len);
  }
  g.stroke();
  if (pinsLive > 0 && sr > 6) {
    const m = Math.min(8, pinsLive);
    let ux = Math.cos(AXIS) + lean.x, uy = Math.sin(AXIS) + lean.y;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    g.strokeStyle = 'hsla(45,40%,88%,0.5)';
    g.lineWidth = Math.max(0.8, sr * 0.03);
    g.beginPath();
    for (let i = 0; i < m; i++) {
      const t = (time * 0.25 + i / m + id * 0.13) % 1, r0 = sr * (0.2 + 0.8 * ((i * 0.618) % 1));
      const ox = sx + Math.cos(i * 2.4) * r0 * 0.6 + ux * (t - 0.5) * sr * 1.2;
      const oy = sy + Math.sin(i * 2.4) * r0 * 0.6 + uy * (t - 0.5) * sr * 1.2;
      g.moveTo(ox, oy); g.lineTo(ox + ux * sr * 0.25, oy + uy * sr * 0.25);
    }
    g.stroke();
  }
}

function livePins(p) {
  let n = 0;
  for (const s of p.pins) if (s.age + params.hours / 24 < params.fresh) n++;
  return n;
}

function drawFibers(p, px, py, t, k) {
  const u = k; // world unit → px
  const order = p.drawOrder;
  let col = null;
  const lw = Math.max(0.6, u * 0.06);
  g.lineWidth = lw; g.lineCap = 'round';
  for (const f of order) {
    const fx = px + lerp(f.mlx, f.hlx, t), fy = py + lerp(f.mly, f.hly, t);
    const sx = (fx - cam.x) * k + W / 2, sy = (fy - cam.y) * k + H / 2;
    const L = f.len * (t > 0 ? lerp(1, Math.min(1, p.hr * 0.4), t) : 1) * u;
    if (sx < -L || sy < -L || sx > W + L || sy > H + L) continue;
    const ln = leanAt(p, p.mx + f.mlx, p.my + f.mly, f.jit);
    const lm = Math.min(1, Math.hypot(ln.x, ln.y));
    const w = Math.sin(time * 14 + f.seed * 40) * ln.wob * 0.25;
    const rx = f.rx - f.ry * w, ry = f.ry + f.rx * w;
    const tx = rx * (1 - lm * 0.7) + ln.x, ty = ry * (1 - lm * 0.7) + ln.y;
    if (f.col !== col) {
      if (col) g.stroke();
      col = f.col; g.strokeStyle = col; g.beginPath();
    }
    g.moveTo(sx, sy);
    g.quadraticCurveTo(sx + rx * L * 0.45, sy + ry * L * 0.45, sx + tx * L, sy + ty * L);
    drawnFibers++;
  }
  if (col) g.stroke();
  g.lineCap = 'butt';
}

function drawPin(p, s, px, py, k) {
  const age = s.age + params.hours / 24;
  if (age >= params.fresh) return;
  const f = clamp(age / params.fresh, 0, 1);
  const birth = clamp((nowMs - s.born) / 1500, 0, 1);
  const grow = birth < 1 ? 1 - Math.pow(1 - birth, 3) : 1;
  const sx = (px - cam.x) * k + W / 2, sy = (py - cam.y) * k + H / 2;
  const u = k * grow;
  if (sx < -u * 3 || sy < -u * 3 || sx > W + u * 3 || sy > H + u * 3) return;
  const ln = leanAt(p, p.mx + s.mlx, p.my + s.mly, 0.5);
  const hue = hueOfHour(s.hour);
  let dx = s.wx - AXIS_PERP.x * s.spin * 0.35, dy = s.wy - AXIS_PERP.y * s.spin * 0.35;
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  const L = u * (1.2 + s.peak * 1.4) * (1 + f * 0.5);
  const nx = -dy * s.spin, ny = dx * s.spin;
  // Local breath bends the stroke: control point and tail are pushed along the comb.
  const x0 = sx - dx * L * 0.5, y0 = sy - dy * L * 0.5;
  const x1 = sx + dx * L * 0.5 + ln.x * L * 0.8, y1 = sy + dy * L * 0.5 + ln.y * L * 0.8;
  const cx = sx + nx * L * 0.35 + ln.x * L * 0.5, cy = sy + ny * L * 0.35 + ln.y * L * 0.5;
  const a = 0.85 - f * 0.6;
  g.lineCap = 'round';
  for (const [w, al, l] of [[0.16, 0.25, 45], [0.08, 0.6, 70], [0.03, 0.9, 92]]) {
    g.strokeStyle = `hsla(${hue},70%,${l}%,${a * al})`;
    g.lineWidth = Math.max(0.5, u * w * (1 - f * 0.5));
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
  }
  g.setLineDash([u * 0.12, u * 0.3]);
  g.lineDashOffset = -time * u * (0.4 + Math.abs(s.ws));
  g.strokeStyle = `hsla(${hue},40%,96%,${a * 0.8})`;
  g.lineWidth = Math.max(0.5, u * 0.025);
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
  g.setLineDash([]); g.lineCap = 'butt';
  if (birth < 1) drawBlob(sx, sy, u * 3 * birth, hue, 70, 70, (1 - birth) * 0.5);
}

// Where a gust is playing, a faint ripple shows where it landed.
function drawGustMarks(t, k) {
  for (const g0 of gusts) {
    if (nowMs - g0.born > g0.playMs) continue;
    const gs = gustState(g0), p = g0.patch;
    const x = lerp(g0.ox, p.hx + (g0.ox - p.mx) * (p.hr / p.mr), t), y = lerp(g0.oy, p.hy + (g0.oy - p.my) * (p.hr / p.mr), t);
    const [sx, sy] = toScreen(x, y);
    const prog = clamp((nowMs - g0.born) / g0.playMs, 0, 1);
    const R = g0.reach * k * (0.3 + prog), hue = hueOfHour(g0.hour);
    if (R < 2) continue;
    g.strokeStyle = `hsla(${hue},60%,80%,${0.35 * (1 - prog) * (0.3 + gs._tr)})`;
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(sx, sy, R, 0, TAU); g.stroke();
  }
}

function label(text, sx, sy, size, alpha) {
  g.font = `${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = `rgba(232,230,225,${alpha})`;
  g.fillText(text, sx, sy);
}

const visible = [];
function draw() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#11150f';
  g.fillRect(0, 0, W, H);
  drawnFibers = 0;
  visible.length = 0;
  const t = layoutT, k = cam.scale;

  for (let hi = 0; hi < heads.length; hi++) {
    const h = heads[hi];
    const hx = lerp(h.mx, h.hx, t), hy = lerp(h.my, h.hy, t), hr = lerp(h.mr, h.hr, t);
    const [sx, sy] = toScreen(hx, hy), sr = hr * k;
    if (sx + sr < 0 || sy + sr < 0 || sx - sr > W || sy - sr > H) continue;
    if (sr < HEAD_DETAIL) {
      // Clump lean = fiber-weighted average of lean at each patch centre.
      let lx = 0, ly = 0, wob = 0, pins = 0;
      for (const p of h.patches) {
        if (p.affecting.length) {
          const ln = centreLean(p), wt = p.fibers.length / h.fiberCount;
          lx += ln.x * wt; ly += ln.y * wt; wob += ln.wob * wt;
        }
        pins += livePins(p);
      }
      drawHeadIcon(sx, sy, sr, h.hue, h.fiberCount, h.rec, { x: lx, y: ly, wob }, pins, hi);
      if (params.labels && sr > 22) label(`${h.a}.x`, sx, sy - sr * 1.05, 11, 0.7);
      continue;
    }
    if (params.labels) label(`${h.a}.x`, sx, sy - sr - 6, 13, 0.85);
    for (const p of h.patches) {
      const px = lerp(p.mx, p.hx, t), py = lerp(p.my, p.hy, t), pr = lerp(p.mr, p.hr, t);
      const [psx, psy] = toScreen(px, py), psr = pr * k;
      if (psx + psr < 0 || psy + psr < 0 || psx - psr > W || psy - psr > H) continue;
      visible.push(p);
      if (psr < FIBER_DETAIL) {
        drawHeadIcon(psx, psy, psr, p.hue, p.fibers.length, p.rec, centreLean(p), livePins(p), p.idx);
        continue;
      }
      drawBlob(psx, psy, psr * 1.3, p.hue, 30 + 40 * p.rec, 26, 0.25 + 0.3 * Math.min(1, p.fibers.length / 150));
      drawFibers(p, px, py, t, k);
      for (const s of p.pins) drawPin(p, s, px + lerp(s.mlx, s.hlx, t), py + lerp(s.mly, s.hly, t), k);
      if (params.labels && psr > 40) {
        label(`${p.a}.${p.b}  ${p.habit.name}${p.crowd ? ' · crowd' : ''}${p === home ? ' · you' : ''}`, psx, psy - psr - 4, 11, 0.75);
      }
    }
  }
  drawGustMarks(t, k);
}

// ---------- wind dial ----------
const dial = $('dial'), dg = dial.getContext('2d');
function drawDial() {
  const S = 300, c = S / 2, R = 105;
  dg.clearRect(0, 0, S, S);
  dg.fillStyle = 'rgba(20,22,20,0.75)';
  dg.beginPath(); dg.arc(c, c, 145, 0, TAU); dg.fill();
  const hn = nowHour();
  for (let h = 0; h < 24; h++) {
    const a = (TAU * h) / 24 - Math.PI / 2;
    const px = c + Math.cos(a) * R, py = c + Math.sin(a) * R;
    const w = windAt(h), len = 22 * Math.abs(w.s) + 2;
    const ux = Math.sign(w.s || 1) * Math.cos(AXIS), uy = Math.sign(w.s || 1) * Math.sin(AXIS);
    const cur = Math.abs(h - Math.floor(hn)) < 0.5;
    dg.strokeStyle = cur ? '#ffffff' : `hsla(${hueOfHour(h)},75%,65%,0.9)`;
    dg.lineWidth = cur ? 5 : 3;
    dg.beginPath(); dg.moveTo(px - (ux * len) / 2, py - (uy * len) / 2); dg.lineTo(px + (ux * len) / 2, py + (uy * len) / 2); dg.stroke();
    dg.fillStyle = dg.strokeStyle;
    dg.beginPath(); dg.arc(px + (ux * len) / 2, py + (uy * len) / 2, 3.5, 0, TAU); dg.fill();
    if (h % 6 === 0) {
      dg.fillStyle = '#9a9890'; dg.font = '20px system-ui'; dg.textAlign = 'center'; dg.textBaseline = 'middle';
      dg.fillText(String(h).padStart(2, '0'), c + Math.cos(a) * 132, c + Math.sin(a) * 132);
    }
  }
  const w = windAt(hn);
  dg.strokeStyle = `hsl(${hueOfHour(hn)},80%,65%)`; dg.lineWidth = 6;
  dg.beginPath(); dg.moveTo(c, c); dg.lineTo(c + w.x * 60, c + w.y * 60); dg.stroke();
  dg.fillStyle = '#e8e6e1'; dg.font = '18px system-ui'; dg.textAlign = 'center';
  dg.fillText('your wind now', c, c + 80);
}

// ---------- controls ----------
function bindRange(id, key) {
  const el = $(id), o = $(id + 'V');
  const upd = () => { params[key] = parseFloat(el.value); o.textContent = el.value; for (const p of patches) p._lf = -1e9; };
  el.addEventListener('input', upd); upd();
}
bindRange('hours', 'hours');
bindRange('halfLife', 'halfLife');
bindRange('fresh', 'fresh');
$('labels').onchange = (e) => (params.labels = e.target.checked);
$('neighbours').onchange = (e) => (params.neighbours = e.target.checked);
$('collapse').onclick = () => $('panel').classList.toggle('min');

function setLayout(v) {
  layoutTarget = v;
  $('lMeadow').classList.toggle('on', v === 0);
  $('lHilbert').classList.toggle('on', v === 1);
  fitAll(v, 1400);
}
$('lMeadow').onclick = () => setLayout(0);
$('lHilbert').onclick = () => setLayout(1);
$('fit').onclick = () => fitAll();

let home = null;
function goHome(scale = 14) {
  const t = layoutTarget;
  flyTo(lerp(home.mx, home.hx, t), lerp(home.my, home.hy, t), t ? 60 : scale, 1500);
}
function visit() {
  addFibers(home, nowHour(), 0);
  placeInPatch(home);
  summarise(home); summariseHead(home.head);
}
function blow() {
  addGust(home, nowHour(), 0, true);
  if (!visible.includes(home)) goHome();
}
function pin() {
  addPin(home, nowHour(), 0, true);
  placePin(home, home.pins.at(-1));
  if (!visible.includes(home)) goHome();
}
$('home').onclick = () => goHome();
$('visit').onclick = () => { visit(); if (!visible.includes(home)) goHome(); };
$('blow').onclick = blow;
$('blowPin').onclick = pin;

// Neighbours breathing: random gusts, biased toward what's on screen so you can see them land.
let nextNeighbour = 0;
function simulateNeighbours() {
  if (!params.neighbours || nowMs < nextNeighbour) return;
  nextNeighbour = nowMs + 400 + rnd() * 900;
  const pool = visible.length && rnd() < 0.8 ? visible : patches;
  const p = pool[Math.floor(rnd() * pool.length)];
  addGust(p, p.habit.hour(), 0, true);
}

// Fully relaxed gusts no longer move anything: drop them (the server would delete them too).
function pruneGusts() {
  const dead = (x) => { gustState(x); return x._dec < 0.01 && nowMs - x.born > x.playMs; };
  for (const p of patches) if (p.affecting.length) p.affecting = p.affecting.filter((x) => !dead(x));
  for (let i = gusts.length - 1; i >= 0; i--) if (dead(gusts[i])) gusts.splice(i, 1);
}

// ---------- loop ----------
let last = performance.now(), fpsAcc = 0, fpsN = 0, statT = 0;
function frame(now) {
  nowMs = now; frameId++;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  time += dt;
  layoutT += clamp(layoutTarget - layoutT, -dt / 1.2, dt / 1.2);
  if (camAnim) {
    const q = clamp((now - camAnim.t0) / camAnim.ms, 0, 1), e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
    cam.scale = Math.exp(lerp(Math.log(camAnim.from.scale), Math.log(camAnim.to.scale), e));
    cam.x = lerp(camAnim.from.x, camAnim.to.x, e); cam.y = lerp(camAnim.from.y, camAnim.to.y, e);
    if (q >= 1) camAnim = null;
  }
  simulateNeighbours();
  if (frameId % 120 === 0) pruneGusts();
  draw();
  fpsAcc += dt; fpsN++;
  if (now - statT > 500) {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; statT = now;
    const total = patches.reduce((a, p) => a + p.fibers.length, 0);
    const active = gusts.filter((x) => gustState(x)._dec > 0.05).length;
    $('stats').textContent = `${heads.length} clumps · ${patches.length} patches · ${total} fibers · ${active} active gusts · drawing ${drawnFibers} fibers · ${fps.toFixed(0)} fps · zoom ${cam.scale.toFixed(2)}`;
    drawDial();
  }
  requestAnimationFrame(frame);
}

// ---------- your network ----------
// A static page can't see its own IP, so ask an echo service. Only the /16 prefix is kept;
// the full address is dropped as soon as it is parsed and never stored or sent anywhere else.
async function fetchPrefix() {
  const sources = [
    ['https://1.1.1.1/cdn-cgi/trace', (t) => /^ip=(.+)$/m.exec(t)?.[1]],
    ['https://api.ipify.org?format=json', (t) => JSON.parse(t).ip],
  ];
  for (const [url, parse] of sources) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store', credentials: 'omit' });
      clearTimeout(timer);
      const m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec((parse(await res.text()) || '').trim());
      if (m) return { a: +m[1], b: +m[2] };
    } catch { /* try the next source */ }
  }
  return null;
}

// Find or create the head and patch for your prefix in the fake meadow.
function ensurePatch(a, b) {
  let head = heads.find((h) => h.a === a);
  if (!head) {
    head = { a, patches: [] };
    heads.push(head);
    heads.sort((x, y) => x.a - y.a);
  }
  let p = head.patches.find((q) => q.b === b);
  if (!p) {
    const habit = HABITS.find((h) => h.name === 'mixed');
    p = { a, b, head, habit, crowd: false, fibers: [], pins: [], affecting: [], idx: patches.length, pendingGusts: 0 };
    head.patches.push(p);
    head.patches.sort((x, y) => x.b - y.b);
    patches.push(p);
  }
  return p;
}

async function boot() {
  resize();
  $('stats').textContent = 'Finding your network…';
  const prefix = await fetchPrefix();
  generate();
  if (prefix) {
    home = ensurePatch(prefix.a, prefix.b);
    $('you').textContent = `Your patch: ${prefix.a}.${prefix.b} (from your IP; only these two numbers are kept, in this tab).`;
  } else {
    const mids = patches.filter((p) => p.fibers.length >= 18 && p.fibers.length <= 60);
    home = mids[Math.floor(rnd() * mids.length)];
    $('you').textContent = `Couldn't look up your IP, so a stand-in patch ${home.a}.${home.b} is used.`;
  }
  addFibers(home, nowHour(), 0); // your visit
  layoutMeadow();
  layoutHilbert();
  for (const p of patches) {
    placeInPatch(p);
    // Historic gusts need meadow positions, so add them after layout.
    for (let i = 0; i < p.pendingGusts; i++) addGust(p, p.habit.hour(), expo(10), false);
  }
  for (const p of patches) summarise(p);
  for (const h of heads) summariseHead(h);
  cam.scale = (Math.min(W, H) / (2 * worldBounds(0))) * 0.95;
  drawDial();
  requestAnimationFrame(frame);
}
boot();
window.__field = { draw, heads, patches, gusts, cam, params, flyTo, setLayout, blow, pin, visit, goHome, get home() { return home; } };
