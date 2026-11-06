// Card-corner detector: letterbox -> ONNX -> decode. A port of reference_python/corner_model.py (letterbox, peaks, plausible, decode).
const STRIDE = 4, HM = 0, REG = 1, WH = 3, KPS = 5, VIS = 13, CHM = 17, CREG = 18;   // channel layout of the 'maps' output (sigmoids already applied)
const SIZE = 640;

export function letterbox(source, sw, sh, ctx) {
  const s = SIZE / Math.max(sw, sh), nw = Math.round(sw * s), nh = Math.round(sh * s);
  const px = (SIZE - nw) >> 1, py = (SIZE - nh) >> 1;
  ctx.fillStyle = 'rgb(114,114,114)'; ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, sw, sh, px, py, nw, nh);
  const d = ctx.getImageData(0, 0, SIZE, SIZE).data, plane = SIZE * SIZE, out = new Float32Array(3 * plane);
  for (let i = 0, j = 0; i < plane; i++, j += 4) { out[i] = d[j] / 255; out[plane + i] = d[j + 1] / 255; out[2 * plane + i] = d[j + 2] / 255; }   // RGB, CHW, 0-1
  return { tensor: out, s, px, py };
}

function peaks(maps, ch, w, h, conf, topk) {
  const base = ch * w * h, out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = maps[base + y * w + x];
    if (v < conf) continue;
    let ok = true;                                  // equal to the 3x3 maximum (ties are kept, like the numpy version)
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < h && xx >= 0 && xx < w && maps[base + yy * w + xx] > v) { ok = false; break; }
    }
    if (ok) out.push({ y, x, s: v });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, topk);
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const sides = (q) => q.map((p, i) => dist(p, q[(i + 1) % 4]));
const meanSide = (q) => sides(q).reduce((a, b) => a + b, 0) / 4;

function convex(q) {
  let pos = 0, neg = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cr > 0) pos++; else if (cr < 0) neg++;
  }
  return pos === 0 || neg === 0;
}
export function plausible(q) {      // convex, angles 39-141 deg, opposite sides within 1.8x, aspect .48-.88
  if (!convex(q)) return false;
  const s = sides(q);
  if (Math.min(...s) <= 0 || Math.max(s[0], s[2]) / Math.min(s[0], s[2]) > 1.8 || Math.max(s[1], s[3]) / Math.min(s[1], s[3]) > 1.8) return false;
  const r = (s[0] + s[2]) / (s[1] + s[3]), m = Math.min(r, 1 / r);
  if (!(m > 0.48 && m < 0.88)) return false;
  for (let i = 0; i < 4; i++) {
    const p = q[i], a = [q[(i + 3) % 4][0] - p[0], q[(i + 3) % 4][1] - p[1]], b = [q[(i + 1) % 4][0] - p[0], q[(i + 1) % 4][1] - p[1]];
    if (Math.abs(a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)) > 0.78) return false;
  }
  return true;
}

export function decode(maps, w = 160, h = 160, { conf = 0.3, topk = 20, snap = true, cornerConf = 0.35, dedup = 0.15, snapR = 0.3 } = {}) {
  const at = (ch, y, x) => maps[ch * w * h + y * w + x];
  const centers = peaks(maps, HM, w, h, conf, topk);
  let cpts = [];
  if (snap) cpts = peaks(maps, CHM, w, h, cornerConf, 200).map((p) => [p.x + at(CREG, p.y, p.x), p.y + at(CREG + 1, p.y, p.x)]);
  const dets = [];
  for (const { y, x, s } of centers) {
    let corners = [0, 1, 2, 3].map((j) => [x + at(KPS + 2 * j, y, x), y + at(KPS + 2 * j + 1, y, x)]);
    if (snap && cpts.length) {
      const r = Math.max(2, snapR * meanSide(corners)), used = new Set(), reg = corners.map((p) => p.slice());
      for (let j = 0; j < 4; j++) {
        const p = corners[j];
        if (!(p[0] >= 0 && p[0] < w && p[1] >= 0 && p[1] < h)) continue;
        const order = cpts.map((c, k) => [dist(c, p), k]).sort((a, b) => a[0] - b[0]);
        for (const [d, k] of order) { if (d > r) break; if (!used.has(k)) { used.add(k); corners[j] = cpts[k].slice(); break; } }
      }
      if (!plausible(corners) && plausible(reg)) {       // a wide radius can catch an inner corner: undo the biggest snaps
        const order = [0, 1, 2, 3].sort((a, b) => dist(corners[b], reg[b]) - dist(corners[a], reg[a]));
        for (const j of order) { corners[j] = reg[j]; if (plausible(corners)) break; }
      }
    }
    dets.push({ score: s, corners, vis: [0, 1, 2, 3].map((j) => at(VIS + j, y, x)) });
  }
  const out = [];
  for (const d of dets) {                                // drop duplicates of the same card
    const side = meanSide(d.corners);
    if (out.every((e) => d.corners.reduce((a, p, i) => a + dist(p, e.corners[i]), 0) / 4 > dedup * side)) out.push(d);
  }
  return out;
}

export class Detector {
  constructor(ort, session) {
    this.ort = ort; this.session = session;
    this.canvas = Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }
  // source: video / canvas / image; returns [{score, corners (4x2, source pixels), vis}] best first
  async detect(source, sw, sh, conf = 0.3) {
    const { tensor, s, px, py } = letterbox(source, sw, sh, this.ctx);
    const res = await this.session.run({ images: new this.ort.Tensor('float32', tensor, [1, 3, SIZE, SIZE]) });
    const maps = res.maps.data;
    return decode(maps, 160, 160, { conf }).map((d) => ({ ...d, corners: d.corners.map(([x, y]) => [(x * STRIDE - px) / s, (y * STRIDE - py) / s]) }));
  }
}
