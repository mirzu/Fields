// Field spike: fake meadow of IP neighbourhoods, two layouts, seed visuals, wind, fading, watering.
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

// ---------- wind: sea-breeze mapping ----------
// Midday (14:00) blows along AXIS, midnight (02:00) the opposite way, dawn/dusk calm.
const AXIS = -0.4;
function windAt(hour) {
  const s = Math.cos((TAU * (hour - 14)) / 24);
  return { x: Math.cos(AXIS) * s, y: Math.sin(AXIS) * s, s };
}

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

function makeSeed(hour, mode, ageDays) {
  const w = windAt(hour);
  return {
    hour, mode, // 0 breath, 1 pinwheel
    spin: rnd() < 0.5 ? 1 : -1,
    age: ageDays,
    env: makeEnvelope(),
    cent: clamp(0.35 + (rnd() - 0.5) * 0.6, 0, 1), // brightness 0..1
    flat: rnd(),                                   // breathiness 0..1
    peak: 0.3 + rnd() * 0.7,
    wx: w.x, wy: w.y, ws: w.s,                     // frozen wind
    u: rnd(), v: rnd(), phase: rnd(),              // stand-in for keyed scatter hash
    born: -1e9,
  };
}

const heads = [];   // one per /8
const patches = []; // one per /16
function generate() {
  const used = new Set();
  const nHeads = 140;
  while (used.size < nHeads) used.add(1 + Math.floor(rnd() * 223));
  for (const a of [...used].sort((x, y) => x - y)) {
    const head = { a, patches: [] };
    const nP = Math.min(220, Math.floor(pareto(2, 0.85)));
    const bs = new Set();
    let b = Math.floor(rnd() * 256);
    while (bs.size < nP) { // allocations come in runs
      bs.add(b);
      b = rnd() < 0.75 ? (b + 1) % 256 : Math.floor(rnd() * 256);
    }
    for (const b of [...bs].sort((x, y) => x - y)) {
      const habit = pickHabit();
      const crowd = rnd() < 0.04;
      const n = crowd ? 40 + Math.floor(rnd() * 200) : Math.min(60, Math.floor(pareto(1, 1.25)));
      const pinBias = rnd() < 0.1 ? 0.6 : 0.1;
      const p = { a, b, head, habit, crowd, seeds: [], water: rnd() };
      for (let i = 0; i < n; i++) p.seeds.push(makeSeed(habit.hour(), rnd() < pinBias ? 1 : 0, -Math.log(1 - rnd()) * 15));
      head.patches.push(p);
      patches.push(p);
    }
    heads.push(head);
  }
}

// ---------- layouts ----------
// Each patch gets world positions for both layouts: (mx,my,mr) meadow, (hx,hy,hr) Hilbert.
// Each seed gets local offsets: (mlx,mly) meadow, (hlx,hly) Hilbert.

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
        const wa = B.r / (A.r + B.r), wb = 1 - wa; // big items move less
        A.x -= (dx / d) * push * wa * 2; A.y -= (dy / d) * push * wa * 2;
        B.x += (dx / d) * push * wb * 2; B.y += (dy / d) * push * wb * 2;
      }
    }
    for (const I of items) { I.x *= 1 - pull; I.y *= 1 - pull; }
  }
}

// Address order becomes angle: nearby prefixes sit in nearby directions, then pack.
function packByAngle(items, key, span) {
  const area = items.reduce((s, I) => s + Math.PI * I.r * I.r, 0);
  const R = Math.sqrt(area / Math.PI);
  for (const I of items) {
    const ang = (TAU * key(I)) / span;
    const rad = R * (0.45 + 0.5 * rnd());
    I.x = Math.cos(ang) * rad; I.y = Math.sin(ang) * rad;
  }
  relax(items, 80, 0.15, 0.02);
  relax(items, 40, 0.15, 0); // final pass: no overlaps
  let ext = 0;
  for (const I of items) ext = Math.max(ext, Math.hypot(I.x, I.y) + I.r);
  return ext;
}

function layoutMeadow() {
  for (const p of patches) {
    const n = p.seeds.length;
    p.mr = Math.sqrt(n) * 1.0 + 0.8;
    // Seeds as a phyllotaxis head, ordered by their scatter hash.
    const order = p.seeds.map((s, i) => i).sort((i, j) => p.seeds[i].u - p.seeds[j].u);
    order.forEach((si, k) => {
      const s = p.seeds[si], rr = (p.mr - 0.5) * Math.sqrt((k + 0.5) / n), ang = k * GA;
      s.mlx = Math.cos(ang) * rr; s.mly = Math.sin(ang) * rr;
    });
  }
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
    for (const s of p.seeds) {
      const rr = p.hr * 0.9 * Math.sqrt(s.u), ang = s.v * TAU;
      s.hlx = Math.cos(ang) * rr; s.hly = Math.sin(ang) * rr;
    }
  }
  for (const h of heads) { // a /8 is an aligned 16×16 block of the curve
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let b = 0; b < 256; b += 15) {
      const [x, y] = d2xy(256, h.a * 256 + b);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const [lx, ly] = d2xy(256, h.a * 256 + 255);
    x0 = Math.min(x0, lx); y0 = Math.min(y0, ly); x1 = Math.max(x1, lx); y1 = Math.max(y1, ly);
    h.hx = ((x0 + x1 + 1) / 2) * CELL - half; h.hy = ((y0 + y1 + 1) / 2) * CELL - half;
    h.hr = 8 * CELL * Math.SQRT2;
  }
}

// ---------- derived state: ground colour, stats ----------
const params = { days: 0, fresh: 5, gust: 1, labels: true, watering: true };
// Colour follows the frozen wind's time of day: day amber → dusk/dawn rose → night blue.
// Brightness (spectral centroid) nudges it ±18°.
const hueOf = (s) => (40 - ((1 - s.ws) / 2) * 180 + (s.cent - 0.5) * 36 + 360) % 360;

function circMean(list) { // [{h, w}]
  let x = 0, y = 0, w = 0;
  for (const it of list) { x += Math.cos((it.h * Math.PI) / 180) * it.w; y += Math.sin((it.h * Math.PI) / 180) * it.w; w += it.w; }
  return w ? { h: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, w } : { h: 90, w: 0 };
}

function recompute() {
  for (const p of patches) {
    const melted = [], all = [];
    let breaths = 0, pins = 0, wx = 0, wy = 0, live = 0;
    for (const s of p.seeds) {
      const age = s.age + params.days;
      const hu = { h: hueOf(s), w: s.peak };
      all.push(hu);
      if (age >= params.fresh) melted.push(hu);
      else { live++; s.mode ? pins++ : breaths++; wx += s.wx; wy += s.wy; }
    }
    const g = circMean(melted.length ? melted : all);
    p.groundHue = g.h;
    p.groundDensity = 1 - Math.exp(-melted.length / 5);
    p.allHue = circMean(all).h;
    Object.assign(p, { breaths, pins, live, wx: live ? wx / live : 0, wy: live ? wy / live : 0 });
  }
  for (const h of heads) {
    let breaths = 0, pins = 0, wx = 0, wy = 0, dens = 0;
    const hs = [];
    for (const p of h.patches) {
      breaths += p.breaths; pins += p.pins; wx += p.wx * p.live; wy += p.wy * p.live;
      dens += p.groundDensity; hs.push({ h: p.groundHue, w: p.seeds.length });
    }
    const live = breaths + pins;
    Object.assign(h, { breaths, pins, live, wx: live ? wx / live : 0, wy: live ? wy / live : 0,
      groundHue: circMean(hs).h, groundDensity: dens / h.patches.length });
  }
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
function flyTo(x, y, scale, ms = 1200) {
  camAnim = { from: { ...cam }, to: { x, y, scale }, t0: performance.now(), ms };
}
function fitAll(t = layoutTarget, ms = 1200) {
  const ext = worldBounds(t);
  flyTo(0, 0, (Math.min(W, H) / (2 * ext)) * 0.95, ms);
}

// pan / zoom (mouse, touch, pinch)
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
  const prev = pointers.get(e.pointerId);
  const cur = { x: e.clientX, y: e.clientY };
  pointers.set(e.pointerId, cur);
  if (pointers.size === 1) {
    cam.x -= (cur.x - prev.x) / cam.scale; cam.y -= (cur.y - prev.y) / cam.scale;
  } else if (pointers.size === 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    zoomAt(mid.x, mid.y, (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d / cam.scale);
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
cv.addEventListener('dblclick', (e) => {
  const [x, y] = toWorld(e.clientX, e.clientY);
  flyTo(x, y, cam.scale * 3, 600);
});
function zoomAt(sx, sy, f) {
  const [wx, wy] = toWorld(sx, sy);
  cam.scale = clamp(cam.scale * f, 0.05, 400);
  cam.x = wx - (sx - W / 2) / cam.scale; cam.y = wy - (sy - H / 2) / cam.scale;
}

// ---------- sprites ----------
const blobCache = new Map();
function blob(h, s, l) { // soft radial blob, cached by rounded colour
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
const HEAD_DETAIL = 70; // px radius: below this a /8 is drawn as one seed head
const SEED_DETAIL = 22; // px radius: above this a /16 shows its individual seeds
let time = 0, drawnSeeds = 0;

const sat = (water) => (params.watering ? 15 + 75 * water : 60);

// A summary seed head (used for /8s and /16s when zoomed out).
function drawHeadIcon(sx, sy, sr, o, water, id) {
  const S = sat(water);
  drawBlob(sx, sy, sr * 1.25, o.groundHue, S * 0.8, 32, 0.25 + 0.6 * o.groundDensity);
  if (sr < 1.5) return;
  const fullness = Math.log2(1 + o.breaths);
  const n = Math.round(clamp(4 + fullness * 5, 0, 48));
  const sway = Math.sin(time * 1.3 + id) * clamp(o.pins / (o.live || 1), 0, 1) * 0.5;
  const len = sr * clamp(0.35 + fullness * 0.12, 0.3, 0.95);
  const lean = { x: o.wx * 0.25, y: o.wy * 0.25 };
  g.strokeStyle = `hsla(${o.groundHue + 10},${S}%,${78}%,${clamp(0.25 + fullness * 0.08, 0, 0.85)})`;
  g.lineWidth = Math.max(0.6, sr * 0.025);
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = i * GA + sway;
    const dx = Math.cos(a) + lean.x, dy = Math.sin(a) + lean.y;
    g.moveTo(sx, sy); g.lineTo(sx + dx * len, sy + dy * len);
  }
  g.stroke();
  if (o.breaths === 0 && o.pins === 0) { // bud
    g.fillStyle = `hsla(${o.groundHue},${S * 0.6}%,45%,0.8)`;
    g.beginPath(); g.arc(sx, sy, Math.max(1, sr * 0.12), 0, TAU); g.fill();
  }
  // Pinwheel energy streams as short strokes in the clump's average wind.
  if (o.pins > 0 && sr > 6) {
    const m = Math.min(8, o.pins), wl = Math.hypot(o.wx, o.wy) || 1;
    const ux = o.wx / wl, uy = o.wy / wl;
    g.strokeStyle = `hsla(45,${S * 0.5}%,88%,0.55)`;
    g.lineWidth = Math.max(0.8, sr * 0.03);
    g.beginPath();
    for (let i = 0; i < m; i++) {
      const t = ((time * 0.25 + i / m + id * 0.13) % 1);
      const r0 = sr * (0.2 + 0.8 * ((i * 0.618) % 1));
      const ox = sx + Math.cos(i * 2.4) * r0 * 0.6 + ux * (t - 0.5) * sr * 1.2;
      const oy = sy + Math.sin(i * 2.4) * r0 * 0.6 + uy * (t - 0.5) * sr * 1.2;
      g.moveTo(ox, oy); g.lineTo(ox + ux * sr * 0.25, oy + uy * sr * 0.25);
    }
    g.stroke();
  }
}

function lerpHue(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function envAt(s, tau) {
  const x = tau * 15, i = Math.floor(x), f = x - i;
  return lerp(s.env[i], s.env[Math.min(15, i + 1)], f);
}

function drawSeed(p, s, px, py, k, water) {
  const age = s.age + params.days;
  if (age >= params.fresh) return;
  const f = clamp(age / params.fresh, 0, 1); // 0 fresh → 1 melting
  const birth = clamp((performance.now() - s.born) / 1500, 0, 1);
  const grow = birth < 1 ? 1 - Math.pow(1 - birth, 3) : 1;
  const S = sat(water);
  const hue = lerpHue(hueOf(s), p.groundHue, f * f);
  const tau = (time / 5 + s.phase) % 1; // gust replay, 5 s loop
  const e = envAt(s, tau) * params.gust * (1 - f * 0.7);
  const gx = s.wx * e * 0.6, gy = s.wy * e * 0.6;
  const sx = (px + gx - cam.x) * cam.scale + W / 2, sy = (py + gy - cam.y) * cam.scale + H / 2;
  if (sx < -50 || sy < -50 || sx > W + 50 || sy > H + 50) return;
  drawnSeeds++;
  const u = k * grow; // world unit → px

  if (s.mode === 0) {
    // Breath: watercolour bloom that widens and fades with age, plus a seed head.
    drawBlob(sx, sy, u * (0.8 + s.peak * 0.9) * (1 + f * 1.6), hue, S, 55, (0.55 - f * 0.35) * (0.6 + 0.4 * s.peak));
    if (birth < 1) drawBlob(sx, sy, u * 3 * birth, hue, S, 70, (1 - birth) * 0.6); // birth pulse
    const n = Math.round(6 + s.cent * 14);
    const L = u * (0.35 + 0.25 * s.cent) * (1 - f * 0.6);
    const wob = Math.sin(time * 9 + s.phase * 40) * s.flat * 0.35;
    const lx = s.wx * e * 0.5, ly = s.wy * e * 0.5;
    g.strokeStyle = `hsla(${hue},${S * 0.4}%,88%,${0.85 - f * 0.6})`;
    g.lineWidth = Math.max(0.5, u * 0.02);
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = i * GA + wob;
      const tx = sx + (Math.cos(a) + lx) * L, ty = sy + (Math.sin(a) + ly) * L;
      g.moveTo(sx, sy); g.lineTo(tx, ty);
    }
    g.stroke();
    if (u > 25) { // pappus tips
      g.fillStyle = g.strokeStyle;
      for (let i = 0; i < n; i++) {
        const a = i * GA + wob;
        g.beginPath(); g.arc(sx + (Math.cos(a) + lx) * L, sy + (Math.sin(a) + ly) * L, u * 0.018, 0, TAU); g.fill();
      }
    }
    g.fillStyle = `hsla(${hue},${S}%,35%,${0.9 - f * 0.5})`;
    g.beginPath(); g.arc(sx, sy, Math.max(0.6, u * 0.05), 0, TAU); g.fill();
  } else {
    // Pinwheel: a brushstroke along its frozen wind, curled by spin, with paint flowing along it.
    let dx = s.wx + -AXIS_PERP.x * s.spin * 0.35, dy = s.wy + -AXIS_PERP.y * s.spin * 0.35;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const L = u * (0.9 + s.peak * 1.1) * (1 + f * 0.5);
    const nx = -dy * s.spin, ny = dx * s.spin;
    const x0 = sx - dx * L * 0.5, y0 = sy - dy * L * 0.5, x1 = sx + dx * L * 0.5, y1 = sy + dy * L * 0.5;
    const cx = sx + nx * L * 0.35, cy = sy + ny * L * 0.35;
    const a = 0.8 - f * 0.6;
    for (const [w, al, l] of [[0.16, 0.25, 45], [0.08, 0.6, 70], [0.03, 0.9, 92]]) {
      g.strokeStyle = `hsla(${hue},${S}%,${l}%,${a * al})`;
      g.lineWidth = Math.max(0.5, u * w * (1 - f * 0.5));
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
    }
    g.setLineDash([u * 0.12, u * 0.3]);
    g.lineDashOffset = -time * u * (0.4 + Math.abs(s.ws));
    g.strokeStyle = `hsla(${hue},${S * 0.5}%,96%,${a * 0.8})`;
    g.lineWidth = Math.max(0.5, u * 0.025);
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
    g.setLineDash([]); g.lineCap = 'butt';
  }
}
const AXIS_PERP = { x: -Math.sin(AXIS), y: Math.cos(AXIS) };

function label(text, sx, sy, size, alpha) {
  g.font = `${size}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = `rgba(232,230,225,${alpha})`;
  g.fillText(text, sx, sy);
}

let visibleTick = 0;
function draw() {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = '#11150f';
  g.fillRect(0, 0, W, H);
  drawnSeeds = 0;
  const t = layoutT;
  const k = cam.scale;
  const water = params.watering;

  for (let hi = 0; hi < heads.length; hi++) {
    const h = heads[hi];
    const hx = lerp(h.mx, h.hx, t), hy = lerp(h.my, h.hy, t), hr = lerp(h.mr, h.hr, t);
    const [sx, sy] = toScreen(hx, hy), sr = hr * k;
    if (sx + sr < 0 || sy + sr < 0 || sx - sr > W || sy - sr > H) continue;
    const hWater = h.patches.reduce((a, p) => a + p.water, 0) / h.patches.length;
    if (sr < HEAD_DETAIL) {
      drawHeadIcon(sx, sy, sr, h, hWater, hi);
      if (water && sr > 3) for (const p of h.patches) p.water = Math.min(1, p.water + 0.0015);
      if (params.labels && sr > 22) label(`${h.a}.x`, sx, sy - sr * 1.05, 11, 0.7);
      continue;
    }
    if (params.labels) label(`${h.a}.x`, sx, sy - sr - 6, 13, 0.85);
    for (const p of h.patches) {
      const px = lerp(p.mx, p.hx, t), py = lerp(p.my, p.hy, t), pr = lerp(p.mr, p.hr, t);
      const [psx, psy] = toScreen(px, py), psr = pr * k;
      if (psx + psr < 0 || psy + psr < 0 || psx - psr > W || psy - psr > H) continue;
      if (water) p.water = Math.min(1, p.water + 0.004);
      if (psr < SEED_DETAIL) { drawHeadIcon(psx, psy, psr, p, p.water, p.b * 7 + hi); continue; }
      drawBlob(psx, psy, psr * 1.35, p.groundHue, sat(p.water) * 0.8, 30, 0.2 + 0.65 * p.groundDensity);
      for (const s of p.seeds) {
        drawSeed(p, s, px + lerp(s.mlx, s.hlx, t), py + lerp(s.mly, s.hly, t), k, p.water);
      }
      if (params.labels && psr > 40) {
        label(`${p.a}.${p.b}  ${p.habit.name}${p.crowd ? ' · crowd' : ''}`, psx, psy - psr - 4, 11, 0.7);
      }
    }
  }
  if (water && ++visibleTick % 30 === 0) for (const p of patches) p.water = Math.max(0, p.water - 0.002); // evaporation
}

// ---------- wind dial ----------
const dial = $('dial'), dg = dial.getContext('2d');
function drawDial() {
  const S = 300, c = S / 2, R = 105;
  dg.clearRect(0, 0, S, S);
  dg.fillStyle = 'rgba(20,22,20,0.75)';
  dg.beginPath(); dg.arc(c, c, 145, 0, TAU); dg.fill();
  const now = new Date(), hourNow = now.getHours() + now.getMinutes() / 60;
  for (let h = 0; h < 24; h++) {
    const a = (TAU * h) / 24 - Math.PI / 2;
    const px = c + Math.cos(a) * R, py = c + Math.sin(a) * R;
    const w = windAt(h);
    const len = 22 * Math.abs(w.s) + 2;
    const ux = w.s >= 0 ? Math.cos(AXIS) : -Math.cos(AXIS), uy = w.s >= 0 ? Math.sin(AXIS) : -Math.sin(AXIS);
    dg.strokeStyle = Math.abs(h - Math.floor(hourNow)) < 0.5 ? '#f2b632' : w.s >= 0 ? 'rgba(255,220,150,0.7)' : 'rgba(150,200,255,0.7)';
    dg.lineWidth = Math.abs(h - Math.floor(hourNow)) < 0.5 ? 5 : 3;
    dg.beginPath(); dg.moveTo(px - ux * len / 2, py - uy * len / 2); dg.lineTo(px + ux * len / 2, py + uy * len / 2); dg.stroke();
    dg.fillStyle = dg.strokeStyle;
    dg.beginPath(); dg.arc(px + ux * len / 2, py + uy * len / 2, 3.5, 0, TAU); dg.fill();
    if (h % 6 === 0) {
      dg.fillStyle = '#9a9890'; dg.font = '20px system-ui'; dg.textAlign = 'center'; dg.textBaseline = 'middle';
      dg.fillText(String(h).padStart(2, '0'), c + Math.cos(a) * 138 * 0.98 - Math.cos(a) * 8, c + Math.sin(a) * 130);
    }
  }
  const w = windAt(hourNow);
  dg.strokeStyle = '#f2b632'; dg.lineWidth = 6;
  dg.beginPath(); dg.moveTo(c, c); dg.lineTo(c + w.x * 60, c + w.y * 60); dg.stroke();
  dg.fillStyle = '#e8e6e1'; dg.font = '18px system-ui'; dg.textAlign = 'center';
  dg.fillText('your wind now', c, c + 80);
}

// ---------- controls ----------
function bindRange(id, key, fn) {
  const el = $(id), out = $(id + 'V');
  const upd = () => { params[key] = parseFloat(el.value); out.textContent = el.value; fn?.(); };
  el.addEventListener('input', upd); upd();
}
let recomputePending = false;
const scheduleRecompute = () => { if (!recomputePending) { recomputePending = true; setTimeout(() => { recompute(); recomputePending = false; }, 30); } };
bindRange('days', 'days', scheduleRecompute);
bindRange('fresh', 'fresh', scheduleRecompute);
bindRange('gust', 'gust');
$('labels').onchange = (e) => (params.labels = e.target.checked);
$('watering').onchange = (e) => (params.watering = e.target.checked);
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
function blow(mode) {
  if (!home) { // a mid-sized neighbourhood stands in for "your network"
    const mids = patches.filter((p) => p.seeds.length >= 6 && p.seeds.length <= 25);
    home = mids[Math.floor(rnd() * mids.length)];
  }
  const now = new Date();
  const s = makeSeed(now.getHours() + now.getMinutes() / 60, mode, -params.days);
  s.born = performance.now();
  // Place it without re-laying out the patch (as a live update would until compaction).
  const ang = rnd() * TAU, rr = home.mr * 0.95 * Math.sqrt(rnd());
  s.mlx = Math.cos(ang) * rr; s.mly = Math.sin(ang) * rr;
  const hr = home.hr * 0.9 * Math.sqrt(s.u), ha = s.v * TAU;
  s.hlx = Math.cos(ha) * hr; s.hly = Math.sin(ha) * hr;
  home.seeds.push(s);
  home.water = 1;
  recompute();
  const t = layoutTarget;
  flyTo(lerp(home.mx, home.hx, t) + lerp(s.mlx, s.hlx, t), lerp(home.my, home.hy, t) + lerp(s.mly, s.hly, t), 30, 1600);
}
$('blow').onclick = () => blow(0);
$('blowPin').onclick = () => blow(1);

// ---------- loop ----------
let last = performance.now(), fpsAcc = 0, fpsN = 0, fps = 0, statT = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  time += dt;
  layoutT += clamp(layoutTarget - layoutT, -dt / 1.2, dt / 1.2);
  if (camAnim) {
    const q = clamp((now - camAnim.t0) / camAnim.ms, 0, 1), e = q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
    const ls = lerp(Math.log(camAnim.from.scale), Math.log(camAnim.to.scale), e);
    cam.scale = Math.exp(ls);
    cam.x = lerp(camAnim.from.x, camAnim.to.x, e); cam.y = lerp(camAnim.from.y, camAnim.to.y, e);
    if (q >= 1) camAnim = null;
  }
  draw();
  fpsAcc += dt; fpsN++;
  if (now - statT > 500) {
    fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; statT = now;
    const total = patches.reduce((a, p) => a + p.seeds.length, 0);
    $('stats').textContent = `${heads.length} /8 clumps · ${patches.length} /16 patches · ${total} seeds · drawing ${drawnSeeds} seeds · ${fps.toFixed(0)} fps · zoom ${cam.scale.toFixed(2)}`;
    drawDial();
  }
  requestAnimationFrame(frame);
}

generate();
layoutMeadow();
layoutHilbert();
recompute();
resize();
fitAll(0, 0);
camAnim && (cam.scale = camAnim.to.scale, cam.x = 0, cam.y = 0, camAnim = null);
drawDial();
requestAnimationFrame(frame);
window.__field = { heads, patches, cam, params, draw, flyTo, blow, setLayout, get layoutT() { return layoutT; }, set layoutT(v) { layoutT = v; } };
