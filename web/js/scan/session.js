// The live scan loop: camera frame -> detector -> tracker -> (one card per pass) flatten + embed + search -> accept rules -> log once.
import { Tracker } from './tracker.js';
import { cropTensor } from './warp.js';
import { frameData } from './pipeline.js';

const RECHECK_MS = 600;       // pause before the same unidentified card is looked at again

export class ScanSession {
  constructor({ engine, video, overlay, conf = 0.3, onLog, onStats }) {
    Object.assign(this, { engine, video, overlay, conf, onLog, onStats });
    this.tracker = new Tracker(); this.running = false; this.logged = 0; this.fps = 0; this.recMs = 0; this.turn = 0;
  }
  start() { this.running = true; this.loop(); }
  stop() { this.running = false; const c = this.overlay.getContext('2d'); c.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  async loop() {
    let prev = performance.now();
    while (this.running) {
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      if (!vw || this.video.readyState < 2) { await new Promise((r) => setTimeout(r, 60)); continue; }
      if (this.overlay.width !== vw) { this.overlay.width = vw; this.overlay.height = vh; }
      try {
        const now = performance.now();
        const dets = await this.engine.detector.detect(this.video, vw, vh, this.conf);
        this.tracker.update(dets, now);
        const job = this.pick(now);
        if (job) await this.recognise(job, vw, vh, now);
        if (this.running) this.draw(vw, vh);      // stopped while a frame was in flight: leave the cleared overlay alone
      } catch (e) { this.onStats?.({ error: String(e.message || e) }); await new Promise((r) => setTimeout(r, 500)); }
      const t = performance.now(); this.fps = 0.85 * this.fps + 0.15 * (1000 / Math.max(1, t - prev)); prev = t;
      this.onStats?.({ fps: this.fps, cards: this.tracker.live().filter((x) => this.tracker.confirmed(x)).length, recMs: this.recMs });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  pick(now) {      // the confirmed, not yet logged card that waited longest
    const c = this.tracker.live().filter((t) => this.tracker.confirmed(t) && !t.logged && now - t.lastRec >= RECHECK_MS);
    c.sort((a, b) => a.lastRec - b.lastRec);
    return c[0];
  }

  async recognise(t, vw, vh, now) {
    const t0 = performance.now(), m = this.engine.matcher;
    t.lastRec = now;
    const emb = await this.engine.embed(cropTensor(frameData(this.video, vw, vh), t.quad));
    let info = await m.lookup(emb);
    if (!info.sure && t.hist.length) {            // not sure from this frame alone: the card's last few embeddings together may be
      const f = await m.lookup(m.fuse(emb, info.cos, t.hist));
      if (f.sure) info = f;
    }
    t.hist.push({ emb, cos: info.cos }); if (t.hist.length > 4) t.hist.shift();
    t.info = info;
    if (info.sure) {
      const key = m.key(info.top);
      t.votes.push(key); if (t.votes.length > 3) t.votes.shift();
      t.ident = { row: info.top, key, label: m.label(info.top) };
      const n = t.votes.length;
      if (n >= 2 && t.votes[n - 1] === t.votes[n - 2] && !t.logged) {     // two sure answers in a row agree: log it, once
        t.logged = true;
        if (!this.tracker.isReappearance(t, key, now)) { this.logged++; this.onLog?.(m.record(info.top), t); }
      }
    }
    this.recMs = 0.7 * this.recMs + 0.3 * (performance.now() - t0);
  }

  draw(vw, vh) {
    const ctx = this.overlay.getContext('2d'), fs = Math.max(14, Math.round(vw / 62));
    ctx.clearRect(0, 0, vw, vh); ctx.lineJoin = 'round'; ctx.font = `600 ${fs}px Roboto, "Segoe UI", sans-serif`; ctx.textBaseline = 'bottom';
    for (const t of this.tracker.live()) {
      const conf = this.tracker.confirmed(t);
      const col = t.logged ? '#3cff9a' : t.ident ? '#38c6d9' : conf ? '#ffd23c' : 'rgba(180,190,210,.7)';
      ctx.lineWidth = Math.max(2, vw / 480); ctx.strokeStyle = col; ctx.beginPath();
      t.shown.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
      if (!conf) continue;
      const text = `#${t.id} ` + (t.ident ? t.ident.label + (t.logged ? '' : ' …') : 'identifying…');
      const x = Math.min(...t.shown.map((p) => p[0])), y = Math.min(...t.shown.map((p) => p[1])), w = ctx.measureText(text).width + fs * 0.8;
      const ty = y - fs * 0.3 < fs * 1.4 ? y + fs * 1.5 : y - fs * 0.3;
      ctx.fillStyle = 'rgba(6,10,20,.82)'; ctx.fillRect(Math.max(0, x), ty - fs * 1.15, w, fs * 1.35);
      ctx.fillStyle = col; ctx.fillText(text, Math.max(0, x) + fs * 0.4, ty);
    }
  }
}
