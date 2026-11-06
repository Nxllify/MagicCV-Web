// One still image or frame through the whole chain: detect -> flatten -> embed -> search. Used by the image test, the parity page and tests.
import { cropTensor } from './warp.js';

const grab = document.createElement('canvas'), grabCtx = grab.getContext('2d', { willReadFrequently: true });

export function frameData(source, w, h) {          // full-resolution pixels of a video frame / image
  if (grab.width !== w || grab.height !== h) { grab.width = w; grab.height = h; }
  grabCtx.drawImage(source, 0, 0, w, h);
  return grabCtx.getImageData(0, 0, w, h);
}

// Returns [{corners, vis, score, info, sure, row, label}] (info = matcher.lookup result); `label` only when the answer is sure.
export async function scanStill(engine, source, w, h, conf = 0.3) {
  const dets = await engine.detector.detect(source, w, h, conf);
  if (!dets.length) return [];
  const fd = frameData(source, w, h), out = [];
  for (const d of dets) {
    const emb = await engine.embed(cropTensor(fd, d.corners));
    const info = await engine.matcher.lookup(emb);
    out.push({ ...d, info, sure: info.sure, row: info.top, label: info.sure ? engine.matcher.label(info.top) : null });
  }
  return out;
}
