// Pinwheel spike: colour-blob tracking of one blade mark → spin speed and direction.
const $ = (id) => document.getElementById(id);
for (const id of ['hueTol', 'minSat', 'minVal']) {
  const show = () => ($(id + 'V').textContent = $(id).value);
  $(id).addEventListener('input', show); show();
}
const param = (id) => parseFloat($(id).value);

const W = 320, H = 240;
const view = $('view'), vg = view.getContext('2d', { willReadFrequently: true });
const video = document.createElement('video');
video.playsInline = true; video.muted = true;

let stream = null;
let target = null;            // {h, s, v}
let manualHub = null;         // {x, y}
const path = [];              // recent mark positions for auto hub
let lastAngle = null, lastT = null;
let speed = 0, peak = 0;
const history = [];           // {t, rps|null}
const frameTimes = [];

async function listCams() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  $('cam').innerHTML = devs.map((d, i) => `<option value="${d.deviceId}">${d.label || 'camera ' + (i + 1)}</option>`).join('');
}

$('start').onclick = async () => {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  const deviceId = $('cam').value;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, frameRate: { ideal: 60 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
  });
  video.srcObject = stream;
  await video.play();
  await listCams();
  const s = stream.getVideoTracks()[0].getSettings();
  $('cam').value = s.deviceId;
  $('start').textContent = `Restart camera (${s.width}×${s.height} @ ${s.frameRate ?? '?'} fps requested)`;
  schedule();
};
$('cam').onchange = () => stream && $('start').onclick();

function schedule() {
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback((now, meta) => { frame(meta.mediaTime * 1000); schedule(); });
  else requestAnimationFrame((now) => { frame(now); schedule(); });
}

function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

view.addEventListener('click', (e) => {
  const r = view.getBoundingClientRect();
  const x = Math.round(((e.clientX - r.left) / r.width) * W), y = Math.round(((e.clientY - r.top) / r.height) * H);
  if (e.shiftKey) { manualHub = { x, y }; $('autoHub').checked = false; return; }
  // Average a 5×5 patch for the target colour.
  vg.drawImage(video, 0, 0, W, H);
  const d = vg.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
  let R = 0, G = 0, B = 0;
  for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
  const n = d.length / 4;
  target = rgb2hsv(R / n, G / n, B / n);
  $('swatch').style.background = `rgb(${R / n},${G / n},${B / n})`;
  path.length = 0; lastAngle = null;
});

function frame(t) {
  if (frameTimes.length && t <= frameTimes.at(-1)) return; // duplicate frame
  frameTimes.push(t); while (frameTimes.length > 30) frameTimes.shift();
  vg.drawImage(video, 0, 0, W, H);
  if (!target) { pushHistory(t, null); updateStats(); return; }

  const img = vg.getImageData(0, 0, W, H), d = img.data;
  const tol = param('hueTol'), minS = param('minSat'), minV = param('minVal');
  let sx = 0, sy = 0, sxx = 0, syy = 0, n = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const c = rgb2hsv(d[i], d[i + 1], d[i + 2]);
    if (c.s < minS || c.v < minV) continue;
    const dh = Math.abs(c.h - target.h), hd = Math.min(dh, 360 - dh);
    if (hd > tol) continue;
    const x = p % W, y = (p / W) | 0;
    sx += x; sy += y; sxx += x * x; syy += y * y; n++;
    if ($('showMask').checked) { d[i] = 255; d[i + 1] = 0; d[i + 2] = 255; }
  }
  if ($('showMask').checked) vg.putImageData(img, 0, 0);

  const minPix = 8;
  if (n < minPix) { lastAngle = null; pushHistory(t, null); $('sPix').textContent = `${n} · –`; updateStats(); return; }
  const mx = sx / n, my = sy / n;
  const spread = Math.sqrt(sxx / n - mx * mx + syy / n - my * my);
  $('sPix').textContent = `${n} · ${spread.toFixed(1)}`;

  path.push({ x: mx, y: my }); while (path.length > 90) path.shift();
  const hub = $('autoHub').checked ? fitCircle(path) : manualHub;

  vg.strokeStyle = '#0f0'; vg.lineWidth = 2;
  vg.beginPath(); vg.arc(mx, my, 6, 0, Math.PI * 2); vg.stroke();
  if (!hub) { pushHistory(t, null); updateStats(); return; }
  vg.strokeStyle = '#ff0';
  vg.beginPath(); vg.moveTo(hub.x, hub.y); vg.lineTo(mx, my); vg.stroke();
  vg.beginPath(); vg.arc(hub.x, hub.y, 4, 0, Math.PI * 2); vg.stroke();

  const angle = Math.atan2(my - hub.y, mx - hub.x);
  let rps = null;
  if (lastAngle !== null && t > lastT) {
    let da = angle - lastAngle;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da <= -Math.PI) da += 2 * Math.PI;
    rps = da / (2 * Math.PI) / ((t - lastT) / 1000);  // + = clockwise in image coords
    $('sStep').textContent = ((da * 180) / Math.PI).toFixed(0);
    $('warn').textContent = Math.abs(da) > 0.6 * Math.PI
      ? '⚠ Rotation per frame is near half a turn: speed and direction are no longer reliable (aliasing).' : '';
  }
  lastAngle = angle; lastT = t;
  if (rps !== null) {
    speed = speed * 0.8 + rps * 0.2;
    peak = Math.max(peak, Math.abs(speed));
  }
  pushHistory(t, rps === null ? null : speed);
  updateStats();
}

// Algebraic (Kåsa) circle fit; needs the mark to have swept a decent arc.
function fitCircle(pts) {
  if (pts.length < 12) return null;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= pts.length; my /= pts.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of pts) {
    const u = p.x - mx, v = p.y - my;
    suu += u * u; svv += v * v; suv += u * v;
    suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-6) return null;
  const a = 0.5 * (suuu + suvv), b = 0.5 * (svvv + svuu);
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length);
  if (r < 5 || r > W) return null; // not a plausible arc yet
  return { x: uc + mx, y: vc + my };
}

function pushHistory(t, v) {
  history.push({ t, v });
  while (history.length && t - history[0].t > 10000) history.shift();
}

function fps() {
  if (frameTimes.length < 2) return 0;
  return ((frameTimes.length - 1) * 1000) / (frameTimes.at(-1) - frameTimes[0]);
}

function updateStats() {
  const f = fps();
  $('sFps').textContent = f.toFixed(1);
  $('sSpeed').textContent = Math.abs(speed).toFixed(2);
  $('sDir').textContent = Math.abs(speed) < 0.1 ? 'still' : speed > 0 ? 'clockwise' : 'counter-cw';
  $('sMax').textContent = peak.toFixed(2);
  drawPlot(f);
}

const plot = $('plot'), pg = plot.getContext('2d');
function drawPlot(f) {
  const PW = plot.width, PH = plot.height, css = getComputedStyle(document.body);
  pg.clearRect(0, 0, PW, PH);
  const lim = Math.max(5, f / 2 + 2);
  const y = (v) => PH / 2 - (v / lim) * (PH / 2);
  const now = history.at(-1)?.t ?? 0;
  const x = (t) => PW - ((now - t) / 10000) * PW;
  pg.strokeStyle = css.getPropertyValue('--line'); pg.beginPath(); pg.moveTo(0, PH / 2); pg.lineTo(PW, PH / 2); pg.stroke();
  pg.strokeStyle = css.getPropertyValue('--muted'); pg.setLineDash([4, 4]);
  for (const s of [1, -1]) { pg.beginPath(); pg.moveTo(0, y((s * f) / 2)); pg.lineTo(PW, y((s * f) / 2)); pg.stroke(); }
  pg.setLineDash([]);
  pg.strokeStyle = css.getPropertyValue('--accent'); pg.lineWidth = 1.5; pg.beginPath();
  let pen = false;
  for (const h of history) {
    if (h.v === null) { pen = false; continue; }
    pen ? pg.lineTo(x(h.t), y(h.v)) : pg.moveTo(x(h.t), y(h.v)); pen = true;
  }
  pg.stroke();
}
