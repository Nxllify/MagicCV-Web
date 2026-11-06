import * as db from '../store.js';
import { settings, set, BACKENDS } from '../settings.js';
import { h, icon, panel, toast, pickFile } from '../ui.js';
import { loadEngine, engineLoaded, webgpuAvailable } from '../scan/engine.js';
import { ScanSession } from '../scan/session.js';
import { scanStill } from '../scan/pipeline.js';

// Scanner page: live camera -> detector -> tracker -> embedder -> gallery search -> accept rules -> inventory (all in the browser).
// No SIFT verification here: the answer is only named when the embedder is sure (same thresholds as the desktop scanner).
let sessionCount = 0, lastCard = '—';
const recent = [];

export function scanner(root) {
  let stream = null, session = null, dead = false;
  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const overlay = h('canvas', { class: 'ov' });
  const bar = h('i'), progress = h('div', { class: 'prog' }, bar);
  const phText = h('div', null);
  const ph = h('div', { class: 'ph' }, icon('scan'), phText, progress);
  const box = h('div', { class: 'video' }, video, overlay, ph, h('div', { class: 'badge' }, '● LIVE'));
  const msg = h('div', { class: 'hint', style: 'padding:0 4px;min-height:18px' });
  const btn = h('button', { class: 'btn', style: 'height:52px;font-size:15px', onclick: toggle }, '▶  Start camera');
  const t = { session: h('b', null, sessionCount), inv: h('b', null, db.stats().total), last: h('b', null, lastCard), fps: h('span', null, '—'), view: h('span', null, '0'), ms: h('span', null, '—'), be: h('span', null, '—') };
  const list = h('div', { class: 'recent' });
  const runOn = h('select', { 'aria-label': 'Run the scanner on', onchange: () => {
    set({ backend: runOn.value });
    if (engineLoaded()) { stop(); toast('Switching: reloading the page'); setTimeout(() => location.reload(), 400); }   // the runtime picks its backend once per page load
    else t.be.textContent = BACKENDS.find(([v]) => v === runOn.value)[1].split(' (')[0] + ' (starts with the camera)';
  } }, BACKENDS.map(([v, l]) => h('option', { value: v, selected: settings().backend === v }, l)));
  webgpuAvailable().then((ok) => { if (!ok) { const o = [...runOn.options].find((x) => x.value === 'webgpu'); o.textContent += ' - not available in this browser'; } });

  const idle = () => { phText.replaceChildren('Press Start, then hold cards under the camera.', h('br'), 'Fanned and overlapping cards are fine.'); progress.style.display = 'none'; };
  const status = (text, f) => { phText.textContent = text + (f ? ` ${Math.round(f * 100)} %` : '…'); progress.style.display = ''; bar.style.width = (f ? Math.round(f * 100) : 6) + '%'; };
  idle();
  function drawRecent() { list.replaceChildren(...(recent.length ? recent.slice(0, 8).map((r) => h('div', { class: 'rrow' }, h('b', null, r.name), r.sp ? h('span', { class: 'tagsp' }, r.sp) : null, h('small', null, `${r.set.toUpperCase()} ${r.no}`))) : [h('div', { class: 'hint' }, 'Nothing scanned yet.')])); }
  drawRecent();

  function logRow(rec, track) {
    db.addScan(rec); sessionCount++;
    lastCard = rec.name + (rec.special_print ? ` [${rec.special_print}]` : '');
    recent.unshift({ name: rec.name, sp: rec.special_print, set: rec.best_guess_set, no: rec.collector_number });
    t.session.textContent = sessionCount; t.last.textContent = lastCard; t.inv.textContent = db.stats().total; drawRecent();
  }

  async function ready() {
    const eng = await loadEngine({ backend: settings().backend, threads: settings().threads, onStatus: status });
    t.be.textContent = eng.backend; if (eng.note) msg.textContent = eng.note; return eng;
  }

  async function toggle() {
    if (stream) return stop();
    btn.disabled = true; msg.textContent = '';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open a camera here (it needs https or localhost).');
      const eng = await ready(); if (dead) return;
      status('Opening the camera', 0);
      const cam = settings().camera;
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...(cam ? { deviceId: { exact: cam } } : { facingMode: 'environment' }), width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = stream; await video.play().catch(() => {});
      box.classList.add('live'); btn.textContent = '■  Stop camera'; btn.className = 'btn danger'; btn.style.height = '52px';
      session = new ScanSession({ engine: eng, video, overlay, conf: settings().conf, onLog: logRow, onStats: (s) => {
        if (s.error) { msg.textContent = s.error; return; }
        t.fps.textContent = s.fps.toFixed(1); t.view.textContent = s.cards; t.ms.textContent = s.recMs ? Math.round(s.recMs) + ' ms' : '—'; } });
      session.start();
    } catch (e) {
      stream?.getTracks().forEach((x) => x.stop()); stream = null; idle();
      msg.textContent = e.name === 'NotAllowedError' ? 'Camera permission was denied.' : e.name === 'NotFoundError' ? 'No camera was found.' : String(e.message || e);
    }
    btn.disabled = false;
  }
  function stop() {
    session?.stop(); session = null; stream?.getTracks().forEach((x) => x.stop()); stream = null; video.srcObject = null;
    box.classList.remove('live', 'still'); btn.textContent = '▶  Start camera'; btn.className = 'btn'; btn.style.height = '52px'; idle();
  }

  async function imageTest() {
    const file = await new Promise((resolve) => { const i = h('input', { type: 'file', accept: 'image/*', onchange: () => resolve(i.files[0] || null) }); i.click(); });
    if (!file) return;
    if (stream) stop();
    msg.textContent = '';
    try {
      const eng = await ready(); if (dead) return;
      const bmp = await createImageBitmap(file);
      overlay.width = bmp.width; overlay.height = bmp.height;
      const c = overlay.getContext('2d'); c.drawImage(bmp, 0, 0);
      box.classList.add('still'); ph.style.display = 'none';
      const t0 = performance.now(), res = await scanStill(eng, bmp, bmp.width, bmp.height, settings().conf), ms = performance.now() - t0;
      const fs = Math.max(14, Math.round(bmp.width / 62)); let named = 0;
      c.lineJoin = 'round'; c.font = `600 ${fs}px Roboto, "Segoe UI", sans-serif`; c.textBaseline = 'bottom';
      for (const r of res) {
        const col = r.sure ? '#3cff9a' : '#ffd23c'; c.lineWidth = Math.max(2, bmp.width / 480); c.strokeStyle = col; c.beginPath();
        r.corners.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke();
        const text = r.sure ? r.label : 'not sure (' + eng.matcher.cards.name[r.row] + '? ' + r.info.cos.toFixed(2) + ')';
        const x = Math.max(0, Math.min(...r.corners.map((p) => p[0]))), y = Math.min(...r.corners.map((p) => p[1])), w = c.measureText(text).width + fs * 0.8, ty = y < fs * 1.6 ? y + fs * 1.6 : y - fs * 0.3;
        c.fillStyle = 'rgba(6,10,20,.82)'; c.fillRect(x, ty - fs * 1.15, w, fs * 1.35); c.fillStyle = col; c.fillText(text, x + fs * 0.4, ty);
        if (r.sure) { logRow(eng.matcher.record(r.row)); named++; }
      }
      msg.textContent = `${res.length} card(s) found, ${named} named and added to the inventory, ${res.length - named} not sure (not added). ${Math.round(ms)} ms on ${eng.backend}.`;
      toast(`${named} card(s) added from the image`);
    } catch (e) { msg.textContent = String(e.message || e); }
  }

  const left = panel('Scanner', 'scan', h('div', { class: 'bd', style: 'display:grid;gap:10px' }, box, msg), h('span', { class: 'tag' }, 'runs in your browser'));
  const kv = (k, v) => h('div', { class: 'kv' }, h('span', null, k), v);
  const side = h('div', { class: 'stack' },
    panel('Session', 'cards', h('div', { class: 'bd side' }, h('label', { class: 'hint', style: 'display:grid;gap:4px' }, 'Run the scanner on', runOn), btn,
      h('div', { class: 'tile pink' }, h('small', null, 'This session'), t.session),
      h('div', { class: 'tile cyan' }, h('small', null, 'In your inventory'), t.inv),
      h('div', { class: 'tile amber' }, h('small', null, 'Last card'), t.last),
      h('button', { class: 'btn line', onclick: imageTest }, 'Scan an image file'),
      h('div', { class: 'hint' }, 'Tip: without a camera, pick a photo of cards to try the scanner on it. Changing "Run the scanner on" after it has run reloads the page.'))),
    panel('Live', 'clock', h('div', { class: 'bd', style: 'display:grid;gap:6px' }, kv('Frames per second', t.fps), kv('Cards in view', t.view), kv('Time per card', t.ms), kv('Runs on', t.be),
      h('div', { class: 'hint', style: 'margin-top:6px' }, 'A card is added once, after two matching confident answers. The first start downloads about 110 MB (models and card database), then it is cached by your browser.'))),
    panel('Recently scanned', 'cards', h('div', { class: 'bd' }, list)));

  root.replaceChildren(h('div', { class: 'cols' }, left, side));
  return { stop: () => { dead = true; stop(); } };
}
