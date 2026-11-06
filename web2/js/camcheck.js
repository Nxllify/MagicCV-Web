import { loadEngine } from '../../web/js/scan/engine.js';
import { cropTensor, EW, EH } from '../../web/js/scan/warp.js';
import { frameData } from '../../web/js/scan/pipeline.js';
import { prefs } from './prefs.js';
import { h, icon, dialog } from './ui.js';

// "Camera check": tells a first-time user whether the scanner will work with their camera, lighting and card.
// Opens the camera, loads the (cached) engine, then for up to CHECK_SECONDS looks at one card and judges: camera, lighting, card found, sharpness, recognised.

const FLAG = 'magiccv2.camcheck.done';
export function shouldPromptFirstRun() { try { return localStorage.getItem(FLAG) !== '1'; } catch { return false; } }
export function markCameraCheckDone() { try { localStorage.setItem(FLAG, '1'); } catch { /* private mode: asks again next time */ } }

const CHECK_SECONDS = 25;
// Lighting: mean luma (0-255) of the whole frame.
const DARK = 60, DIM = 90, BRIGHT = 200;
const GLARE_SHARE = 0.10;            // share of near-white pixels (all channels >= 250) inside the flattened card
// Sharpness: variance of the Laplacian of the luma (0-255) of the flattened 272x384 card, central 84 %. The crop is a fixed size, so a card that is
// small in the frame (far away or low resolution) also comes out soft. Computed on a 2x downsampled crop (136x192).
// Measured on the 1280x720 six-card test scene (best card), brightness-normalised: original 147, darkened x0.4 -> 213, x0.15 -> 115, blur sigma 1 -> 62, sigma 2 -> 23, sigma 5 -> ~5.
export const SHARP_OK = 100, SHARP_SOFT = 40;      // >= SHARP_OK sharp, >= SHARP_SOFT a bit soft (still passes), below that blurry

// Pure measurements -------------------------------------------------------------------------------------------------------------------------------
export function meanLuma(img) {      // sampled every 7th pixel
  const d = img.data; let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 28) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
  return s / Math.max(1, n);
}
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
export function cardStats(t) {       // t: cropTensor output; first image = upright card. Returns {sharp, glare}
  const plane = EW * EH, luma = new Float32Array(plane); let white = 0, wn = 0;
  const x0 = Math.round(EW * 0.08), x1 = Math.round(EW * 0.92), y0 = Math.round(EH * 0.08), y1 = Math.round(EH * 0.92);
  for (let i = 0; i < plane; i++) {
    const r = (t[i] * STD[0] + MEAN[0]) * 255, g = (t[plane + i] * STD[1] + MEAN[1]) * 255, b = (t[2 * plane + i] * STD[2] + MEAN[2]) * 255;
    luma[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const x = i % EW, y = (i / EW) | 0;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) { wn++; if (r >= 250 && g >= 250 && b >= 250) white++; }
  }
  // 2x2 box downsample first (136x192): a card that is small in the frame is upscaled to the crop size, which would otherwise read as soft
  const HW = EW >> 1, HH = EH >> 1, lo = new Float32Array(HW * HH);
  for (let y = 0; y < HH; y++) for (let x = 0; x < HW; x++) { const i = 2 * y * EW + 2 * x; lo[y * HW + x] = (luma[i] + luma[i + 1] + luma[i + EW] + luma[i + EW + 1]) / 4; }
  const hx0 = x0 >> 1, hx1 = x1 >> 1, hy0 = y0 >> 1, hy1 = y1 >> 1;
  let s = 0, s2 = 0, n = 0, lm = 0;
  for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) {
    const i = y * HW + x, l = 4 * lo[i] - lo[i - 1] - lo[i + 1] - lo[i - HW] - lo[i + HW];
    s += l; s2 += l * l; n++; lm += lo[i];
  }
  const m = s / n, k = Math.max(20, lm / n) / 128;     // divide by the squared brightness so a dim picture is not mistaken for a soft one
  return { sharp: (s2 / n - m * m) / (k * k), glare: white / Math.max(1, wn) };
}

// The dialog -------------------------------------------------------------------------------------------------------------------------------------
export function openCameraCheck() {
  let stream = null, run = 0, closed = false, engine = null;

  const video = h('video', { autoplay: true, playsinline: true, muted: true, 'aria-label': 'Camera preview' });
  video.muted = true;
  const overlay = h('canvas', { 'aria-hidden': 'true' });
  const bar = h('i'), progress = h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Loading the scanner', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, hidden: true }, bar);
  const phText = h('p', null, 'The preview appears here once the camera is open.');
  const stage = h('div', { class: 'stage cc-stage' }, video, overlay, h('div', { class: 'ph' }, icon('camera'), phText, progress));
  const stepLine = h('p', { class: 'cc-step', role: 'status', 'aria-live': 'polite' });
  const timer = h('span', { class: 'hint', 'aria-hidden': 'true' });
  const openBtn = h('button', { class: 'btn primary', type: 'button', onclick: begin }, icon('camera'), 'Open the camera');
  const againBtn = h('button', { class: 'btn', type: 'button', hidden: true, onclick: () => check() }, icon('scan'), 'Try again');

  // checklist rows
  const rows = {};
  const mkRow = (key, title) => {
    const ic = h('span', { class: 'cc-ic' }), txt = h('span', { class: 'cc-t' }), num = h('span', { class: 'cc-n mono', 'aria-hidden': 'true' });
    const li = h('li', { class: 'cc-row', 'data-state': 'pending' }, ic, h('span', { class: 'cc-b' }, h('b', null, title), txt, num));
    rows[key] = { li, ic, txt, num, state: '', text: '' };
    return li;
  };
  const list = h('ul', { class: 'cc-list', 'aria-label': 'Checklist', 'aria-live': 'polite', 'aria-relevant': 'text' },
    mkRow('camera', 'Camera'), mkRow('light', 'Lighting'), mkRow('found', 'Card found'), mkRow('sharp', 'Sharpness'), mkRow('id', 'Recognized'));
  // state: pending | pass | warn | fail. The spoken text changes only when the verdict does; numbers sit in an aria-hidden span.
  const IC = { pending: null, pass: 'check', warn: 'alert', fail: 'x' };
  function setRow(key, state, text, num = '') {
    const r = rows[key];
    if (r.state !== state) { r.state = state; r.li.dataset.state = state; r.ic.replaceChildren(IC[state] ? icon(IC[state]) : h('i', { class: 'cc-dot' })); }
    if (r.text !== text) { r.text = text; r.txt.textContent = text; }
    if (r.num.textContent !== num) r.num.textContent = num;
  }
  const resetRows = () => {
    for (const k of Object.keys(rows)) { rows[k].state = ''; rows[k].text = ''; }
    setRow('camera', 'pending', 'Not opened yet'); setRow('light', 'pending', 'Waiting'); setRow('found', 'pending', 'Waiting'); setRow('sharp', 'pending', 'Waiting'); setRow('id', 'pending', 'Waiting');
  };
  resetRows();

  const verdict = h('div', { class: 'cc-verdict', role: 'status', 'aria-live': 'polite', hidden: true });
  const status = (text, f) => {
    phText.textContent = text + (f ? ` ${Math.round(f * 100)} %` : '...'); progress.hidden = false;
    bar.style.width = (f ? Math.round(f * 100) : 4) + '%'; progress.setAttribute('aria-valuenow', Math.round((f || 0) * 100));
  };

  function stopCamera() {
    run++;
    stream?.getTracks().forEach((t) => t.stop()); stream = null; video.srcObject = null;
    stage.classList.remove('live');
  }

  async function begin() {
    openBtn.disabled = true; verdict.hidden = true; againBtn.hidden = true;
    const my = ++run;
    try {
      stepLine.textContent = 'Step 1 of 3: opening the camera';
      setRow('camera', 'pending', 'Opening...');
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('This browser cannot open a camera here (it needs https or localhost).'), { name: 'Unsupported' });
      const cam = prefs().camera;
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...(cam ? { deviceId: { exact: cam } } : { facingMode: 'environment' }), width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (closed || my !== run) { stream.getTracks().forEach((t) => t.stop()); stream = null; return; }
      video.srcObject = stream; await video.play().catch(() => {});
      await new Promise((res) => { if (video.videoWidth) res(); else { video.addEventListener('loadedmetadata', res, { once: true }); setTimeout(res, 3000); } });
      if (closed || my !== run) return;
      stage.classList.add('live'); openBtn.hidden = true;
      const st = stream.getVideoTracks()[0]?.getSettings?.() || {}, w = video.videoWidth || st.width, hh = video.videoHeight || st.height;
      const small = Math.max(w, hh) < 1000;
      setRow('camera', small ? 'warn' : 'pass', small ? 'Opened, but the picture is small. A larger picture reads cards better' : 'Opened', `${w} x ${hh}`);
      stepLine.textContent = 'Step 2 of 3: loading the scanner';
      engine = await loadEngine({ backend: prefs().backend, threads: prefs().threads, onStatus: status });
      if (closed || my !== run) return;
      progress.hidden = true;
      await check();
    } catch (e) {
      if (closed) return;
      stopCamera(); openBtn.hidden = false; openBtn.disabled = false; progress.hidden = true;
      const msg = e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow the camera in the address bar, then try again.'
        : e.name === 'NotFoundError' ? 'No camera was found. Plug one in or try another device.'
          : e.name === 'NotReadableError' ? 'The camera is busy. Close other programs or tabs that use it, then try again.' : String(e.message || e);
      setRow('camera', 'fail', msg); stepLine.textContent = 'The camera could not be opened.';
      showVerdict('fail', 'Camera check could not start', [msg]);
    }
  }

  function showVerdict(kind, title, tips) {
    verdict.hidden = false; verdict.dataset.kind = kind;
    verdict.replaceChildren(h('div', { class: 'cc-vh' }, icon(kind === 'pass' ? 'check' : kind === 'warn' ? 'alert' : 'x'), h('b', null, title)),
      ...(tips.length ? [h('ul', null, tips.map((t) => h('li', null, t)))] : []));
  }

  async function check() {
    if (!engine || !stream) return;
    const my = ++run;                              // a fresh "Try again" supersedes an older loop
    verdict.hidden = true; againBtn.hidden = true; resetRows();
    const st = stream.getVideoTracks()[0]?.getSettings?.() || {}, w0 = video.videoWidth;
    setRow('camera', Math.max(w0, video.videoHeight) < 1000 ? 'warn' : 'pass', Math.max(w0, video.videoHeight) < 1000 ? 'Opened, but the picture is small. A larger picture reads cards better' : 'Opened', `${w0} x ${video.videoHeight}`);
    void st;
    stepLine.textContent = 'Step 3 of 3: hold one card flat under the camera, whole card in view';
    const t0 = performance.now(), best = { found: 0, sharp: -1, sure: null, cos: 0, guess: '', light: null, glare: 0, lightMin: 255, lightMax: 0 };
    let passed = false, frames = 0, last = null, okFrames = 0;
    while (!closed && my === run && performance.now() - t0 < CHECK_SECONDS * 1000 && !passed) {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || video.readyState < 2) { await new Promise((r) => setTimeout(r, 60)); continue; }
      if (overlay.width !== vw) { overlay.width = vw; overlay.height = vh; }
      try {
        const fd = frameData(video, vw, vh), luma = meanLuma(fd);
        const dets = await engine.detector.detect(video, vw, vh, prefs().conf);
        if (closed || my !== run) break;
        const det = dets.length ? dets.reduce((a, b) => (b.score > a.score ? b : a)) : null;
        const ctx = overlay.getContext('2d'); ctx.clearRect(0, 0, vw, vh);
        frames++; last = { luma };
        best.light = luma; best.lightMin = Math.min(best.lightMin, luma); best.lightMax = Math.max(best.lightMax, luma);
        let lightState = luma < DARK ? 'fail' : luma < DIM ? 'warn' : luma > BRIGHT ? 'fail' : 'pass';
        let lightText = luma < DARK ? 'Too dark. Turn on a light or move to a brighter place' : luma < DIM ? 'A bit dark. More light would help' : luma > BRIGHT ? 'Too bright or glare. Move the light or tilt the card' : 'Good';
        if (det) {
          best.found = Math.max(best.found, det.score);
          ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, vw / 400); ctx.strokeStyle = '#4ade80'; ctx.beginPath();
          det.corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
          const tensor = cropTensor(fd, det.corners), { sharp, glare } = cardStats(tensor);
          last.sharp = sharp; best.sharp = Math.max(best.sharp, sharp); best.glare = Math.max(best.glare, glare);
          if (glare > GLARE_SHARE && lightState === 'pass') { lightState = 'warn'; lightText = 'Glare on the card. Tilt the card or move the light'; }
          setRow('found', 'pass', 'Found', `score ${det.score.toFixed(2)}`);
          const sState = sharp >= SHARP_OK ? 'pass' : sharp >= SHARP_SOFT ? 'warn' : 'fail';
          setRow('sharp', sState, sState === 'pass' ? 'Sharp' : sState === 'warn' ? 'A bit soft. Improve the focus and hold still' : 'Blurry. Focus the camera, hold still, add light', `${Math.round(sharp)}`);
          const emb = await engine.embed(tensor), info = await engine.matcher.lookup(emb);
          if (closed || my !== run) break;
          if (info.sure) {
            const name = engine.matcher.label(info.top); best.sure = name; best.cos = Math.max(best.cos, info.cos);
            setRow('id', 'pass', `Recognized: ${name}`, `cos ${info.cos.toFixed(2)}`);
            if (sState !== 'fail') { if (++okFrames >= 2) passed = true; } else okFrames = 0;   // two good frames in a row
          } else {
            okFrames = 0; best.guess = engine.matcher.cards?.name?.[info.top] ?? ''; best.cos = Math.max(best.cos, info.cos);
            setRow('id', 'warn', `Not sure${best.guess ? ` (best guess ${best.guess})` : ''}. Hold the card flat and fill more of the picture`, `cos ${info.cos.toFixed(2)}`);
          }
        } else {
          okFrames = 0;
          setRow('found', 'fail', 'No card found. Put one card flat, whole card in view, on a plain background');
          setRow('sharp', 'pending', 'Waiting for a card'); setRow('id', 'pending', 'Waiting for a card');
        }
        setRow('light', lightState, lightText, `brightness ${Math.round(luma)}`);
      } catch (e) {
        if (closed) break;
        setRow('id', 'fail', 'The scanner hit an error: ' + String(e.message || e)); break;
      }
      timer.textContent = `Checking... ${Math.max(0, Math.ceil(CHECK_SECONDS - (performance.now() - t0) / 1000))} s left`;
      await new Promise((r) => setTimeout(r, 0));
    }
    if (closed || my !== run) return;
    timer.textContent = '';
    overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
    list.dataset.metrics = JSON.stringify({ frames, light: last?.luma, sharp: best.sharp, found: best.found, sure: best.sure, cos: best.cos });
    againBtn.hidden = false; againBtn.focus?.();
    // final verdict, from the best the card did during the run
    const tips = [];
    if (best.light != null && best.lightMax < DARK) tips.push('Add light: turn on a lamp or face a window. A dim picture hides the card details.');
    else if (best.lightMin > BRIGHT) tips.push('Reduce the glare: move the lamp to the side and tilt the card a little.');
    if (!best.found) tips.push('Put one card flat on a plain, darker background, whole card in view and about a hand-span from the camera.');
    else if (best.sharp >= 0 && best.sharp < SHARP_OK) tips.push('Focus: hold the card still and about 20 cm from the camera, clean the lens, and add light so the camera can focus.');
    if (best.found && !best.sure && !tips.length) tips.push('Hold the card flat and fill more of the picture. Cards that are not in the catalog (or heavy glare) cannot be named.');
    if (passed) {
      stepLine.textContent = 'Check complete.';
      showVerdict('pass', `Pass. Your camera read ${best.sure}.`, best.sharp < SHARP_OK ? ['The picture is slightly soft: more light or better focus will make the scanner more reliable.'] : []);
      markCameraCheckDone();
    } else {
      stepLine.textContent = 'Check complete.';
      showVerdict('fail', 'Not yet. Fix this and try again:', tips.slice(0, 3).length ? tips.slice(0, 3) : ['Hold one card flat under the camera and try again.']);
    }
  }

  const build = (close) => {
    const done = h('button', { class: 'btn primary', type: 'button', onclick: () => close(true) }, 'Close');
    return h('div', { class: 'cc' },
      h('div', { class: 'cc-hd' }, h('h2', null, 'Camera check'), h('p', null, 'Find out whether the scanner works with your camera, lighting and cards. Nothing leaves your device.')),
      stage, h('div', { class: 'cc-bar' }, stepLine, timer),
      list, verdict,
      h('div', { class: 'acts' }, openBtn, againBtn, done));
  };

  return dialog(build, { wide: true, label: 'Camera check' }).then((r) => { closed = true; stopCamera(); return r; });
}
