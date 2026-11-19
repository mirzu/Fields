// Breath spike: live features, breath detection, fingerprint packing.
const $ = (id) => document.getElementById(id);
const BAND_LO = 100, BAND_HI = 8000;
const HISTORY = 360; // frames shown (~6 s at 60 fps)

const sliders = ['onRatio', 'minFlat', 'minCent'];
for (const id of sliders) {
  const show = () => ($(id + 'V').textContent = $(id).value);
  $(id).addEventListener('input', show); show();
}
const param = (id) => parseFloat($(id).value);

let ctx, analyser, stream, timeBuf, freqBuf, binHz;
let floor = 1e-4;           // linear RMS
let breath = null;          // in-progress breath {t0, frames:[]}
let quietSince = 0;
const history = [];         // {rms, floor, cent, flat, inBreath}
const breaths = [];
let frameCount = 0, lastRateT = performance.now();

$('start').onclick = async () => {
  if (ctx) { stop(); return; }
  const proc = $('processing').checked;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { noiseSuppression: proc, echoCancellation: proc, autoGainControl: proc },
  });
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  timeBuf = new Float32Array(analyser.fftSize);
  freqBuf = new Float32Array(analyser.frequencyBinCount);
  binHz = ctx.sampleRate / analyser.fftSize;
  $('start').textContent = 'Stop mic';
  startT = performance.now();
  requestAnimationFrame(tick);
};
let startT = 0;

function stop() {
  stream.getTracks().forEach((t) => t.stop());
  ctx.close(); ctx = null;
  $('start').textContent = 'Start mic';
  $('sState').textContent = 'idle';
}

function features() {
  analyser.getFloatTimeDomainData(timeBuf);
  let sum = 0;
  for (const v of timeBuf) sum += v * v;
  const rms = Math.sqrt(sum / timeBuf.length);

  analyser.getFloatFrequencyData(freqBuf); // dB
  const lo = Math.floor(BAND_LO / binHz), hi = Math.min(freqBuf.length - 1, Math.ceil(BAND_HI / binHz));
  let pSum = 0, wSum = 0, logSum = 0, n = 0;
  for (let i = lo; i <= hi; i++) {
    const p = Math.pow(10, freqBuf[i] / 10) + 1e-20;
    pSum += p; wSum += p * i * binHz; logSum += Math.log(p); n++;
  }
  const cent = pSum > 0 ? wSum / pSum : 0;
  const flat = Math.exp(logSum / n) / (pSum / n);
  return { rms, cent, flat };
}

function tick(now) {
  if (!ctx) return;
  const f = features();

  // Noise floor: drops quickly, rises slowly, frozen during a breath.
  if (!breath) floor = f.rms < floor ? floor * 0.9 + f.rms * 0.1 : floor * 0.998 + f.rms * 0.002;
  floor = Math.max(floor, 1e-5);
  const onT = floor * param('onRatio');
  const offT = floor * Math.max(1.5, param('onRatio') / 2);

  // First 0.5 s: just learn the floor (track the level directly, no detection).
  if (now - startT < 500) { floor = Math.max(1e-5, f.rms); history.push({ ...f, floor, onT, inBreath: false }); requestAnimationFrame(tick); return; }
  if (!breath && f.rms > onT) {
    breath = { t0: now, frames: [] };
  }
  if (breath) {
    breath.frames.push({ t: now, ...f });
    if (f.rms < offT) {
      if (!quietSince) quietSince = now;
      if (now - quietSince > 120) { finishBreath(); quietSince = 0; }
    } else quietSince = 0;
    // Safety cap: a "breath" this long means the ambient level rose; re-learn the floor.
    if (breath && now - breath.t0 > 8000) { finishBreath(); floor = f.rms; quietSince = 0; }
  }

  history.push({ ...f, floor, onT, inBreath: !!breath });
  if (history.length > HISTORY) history.shift();

  $('sRms').textContent = db(f.rms).toFixed(1);
  $('sFloor').textContent = db(floor).toFixed(1);
  $('sCent').textContent = Math.round(f.cent);
  $('sFlat').textContent = f.flat.toFixed(3);
  $('sState').textContent = breath ? 'BREATH' : 'listening';

  frameCount++;
  if (now - lastRateT > 1000) {
    $('sRate').textContent = `${frameCount} · ${ctx.sampleRate}`;
    frameCount = 0; lastRateT = now;
  }
  draw();
  requestAnimationFrame(tick);
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-7));

function finishBreath() {
  const fr = breath.frames;
  breath = null;
  // Trim the quiet tail used for offset detection.
  const onT = floor * param('onRatio') / 2;
  let end = fr.length; while (end > 1 && fr[end - 1].rms < onT) end--;
  const frames = fr.slice(0, end);
  if (frames.length < 3) return;

  const dur = (frames.at(-1).t - frames[0].t) / 1000;
  const peak = Math.max(...frames.map((x) => x.rms));
  // Loudness-weighted means so quiet edges don't dominate.
  const wsum = frames.reduce((a, x) => a + x.rms, 0);
  const cent = frames.reduce((a, x) => a + x.cent * x.rms, 0) / wsum;
  const flat = frames.reduce((a, x) => a + x.flat * x.rms, 0) / wsum;
  const envelope = resample(frames.map((x) => x.rms / peak), 16);

  const reasons = [];
  if (dur < 0.2) reasons.push('too short');
  if (dur > 6) reasons.push('too long');
  if (flat < param('minFlat')) reasons.push('too tonal (voice/whistle?)');
  if (cent < param('minCent')) reasons.push('too dark (thump/handling?)');

  const b = { dur, peakDb: db(peak), cent, flat, envelope, ok: reasons.length === 0, reasons };
  b.fingerprint = pack(b);
  breaths.push(b);
  addRow(b, breaths.length);
}

function resample(arr, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * arr.length, z = ((i + 1) / n) * arr.length;
    let s = 0, c = 0;
    for (let j = Math.floor(a); j < Math.ceil(z) && j < arr.length; j++) { s += arr[j]; c++; }
    out.push(c ? s / c : 0);
  }
  return out;
}

// 17 bytes: 16×6-bit envelope (12 B), centroid, flatness, duration, peak, mode flag.
function pack(b) {
  const bytes = new Uint8Array(17);
  let bit = 0;
  for (const v of b.envelope) {
    const q = Math.round(Math.min(1, Math.max(0, v)) * 63);
    for (let k = 5; k >= 0; k--, bit++) if ((q >> k) & 1) bytes[bit >> 3] |= 0x80 >> (bit & 7);
  }
  const logC = Math.log(Math.max(BAND_LO, Math.min(BAND_HI, b.cent)) / BAND_LO) / Math.log(BAND_HI / BAND_LO);
  bytes[12] = Math.round(logC * 255);
  bytes[13] = Math.round(Math.min(1, b.flat) * 255);
  bytes[14] = Math.min(255, Math.round(b.dur / 0.025));          // 25 ms units, max 6.375 s
  bytes[15] = Math.round(Math.min(1, Math.max(0, (b.peakDb + 80) / 80)) * 255); // −80…0 dBFS
  bytes[16] = 0b0000_0000;                                        // bit0 mode (0=breath), bit1-2 spin dir
  return bytes;
}

function addRow(b, i) {
  const tr = document.createElement('tr');
  const spark = document.createElement('canvas');
  spark.width = 96; spark.height = 24; spark.style.border = 'none';
  const g = spark.getContext('2d');
  g.fillStyle = getComputedStyle(document.body).getPropertyValue('--accent');
  b.envelope.forEach((v, k) => g.fillRect(k * 6, 24 - v * 24, 5, v * 24));
  const cells = [
    i, spark, b.dur.toFixed(2), b.peakDb.toFixed(1), Math.round(b.cent), b.flat.toFixed(3),
    b.ok ? '<span class="ok">breath</span>' : `<span class="bad">${b.reasons.join(', ')}</span>`,
    `<code>${[...b.fingerprint].map((x) => x.toString(16).padStart(2, '0')).join('')}</code>`,
  ];
  for (const c of cells) {
    const td = document.createElement('td');
    if (c instanceof HTMLElement) td.append(c); else td.innerHTML = c;
    tr.append(td);
  }
  $('rows').prepend(tr);
}

const plot = $('plot'), pg = plot.getContext('2d');
function draw() {
  const W = plot.width, H = plot.height, css = getComputedStyle(document.body);
  pg.clearRect(0, 0, W, H);
  const x = (i) => (i / HISTORY) * W;
  const yDb = (v) => H - ((db(v) + 90) / 90) * H; // −90…0 dBFS
  const yLin = (v) => H - v * H;
  const yCent = (c) => H - (Math.log(Math.max(BAND_LO, c) / BAND_LO) / Math.log(BAND_HI / BAND_LO)) * H;

  pg.fillStyle = 'rgba(242,182,50,0.15)';
  history.forEach((h, i) => { if (h.inBreath) pg.fillRect(x(i), 0, W / HISTORY + 1, H); });

  const line = (fn, color, dash = []) => {
    pg.strokeStyle = color; pg.setLineDash(dash); pg.lineWidth = 1.5; pg.beginPath();
    history.forEach((h, i) => (i ? pg.lineTo(x(i), fn(h)) : pg.moveTo(x(i), fn(h))));
    pg.stroke(); pg.setLineDash([]);
  };
  line((h) => yCent(h.cent), '#3a9d4a');
  line((h) => yLin(Math.min(1, h.flat)), '#4a7fd0');
  line((h) => yDb(h.floor), css.getPropertyValue('--muted'), [4, 4]);
  line((h) => yDb(h.onT), css.getPropertyValue('--muted'), [2, 6]);
  line((h) => yDb(h.rms), css.getPropertyValue('--accent'));
}

$('export').onclick = () => {
  const data = breaths.map((b) => ({ ...b, fingerprint: [...b.fingerprint] }));
  const blob = new Blob([JSON.stringify({ ua: navigator.userAgent, breaths: data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'breaths.json'; a.click();
};
$('clear').onclick = () => { breaths.length = 0; $('rows').innerHTML = ''; };
