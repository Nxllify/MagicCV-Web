// Flatten a card and build the embedder input: the same chain as the Python scanner (camera_open.crop_from_fullres to 350x489, then
// resize to 272x384 with INTER_AREA), done in one pass with 2x2 supersampling. Returns a [2,3,384,272] float32 tensor:
// the upright card and the same card rotated 180 degrees (the embedder is run on both; the better cosine counts).
export const EW = 272, EH = 384, CW = 350, CH = 489;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

function squareToQuad(q) {          // projective map from the unit square to the quad (corners TL, TR, BR, BL)
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) return { a: x1 - x0, b: x2 - x1, c: x0, d: y1 - y0, e: y2 - y1, f: y0, g: 0, h: 0 };
  const den = dx1 * dy2 - dx2 * dy1, g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den;
  return { a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0, d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0, g, h };
}

// frame: ImageData of the full camera frame; quad: 4x2 corners in frame pixels. Outside the frame the card is filled grey (128).
export function cropTensor(frame, quad) {
  const { width: W, height: H, data } = frame, M = squareToQuad(quad);
  const plane = EW * EH, out = new Float32Array(2 * 3 * plane), sub = [-0.25, 0.25];
  for (let py = 0; py < EH; py++) for (let px = 0; px < EW; px++) {
    let r = 0, g = 0, b = 0;
    for (const sy of sub) for (const sx of sub) {
      const u = ((px + 0.5 + sx) * CW / EW - 0.5) / (CW - 1), v = ((py + 0.5 + sy) * CH / EH - 0.5) / (CH - 1);
      const den = M.g * u + M.h * v + 1, X = (M.a * u + M.b * v + M.c) / den, Y = (M.d * u + M.e * v + M.f) / den;
      if (X < -0.5 || Y < -0.5 || X > W - 0.5 || Y > H - 0.5) { r += 128; g += 128; b += 128; continue; }
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(X))), y0 = Math.max(0, Math.min(H - 2, Math.floor(Y)));
      const fx = Math.min(1, Math.max(0, X - x0)), fy = Math.min(1, Math.max(0, Y - y0));
      const i00 = (y0 * W + x0) * 4, i10 = i00 + 4, i01 = i00 + W * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      r += data[i00] * w00 + data[i10] * w10 + data[i01] * w01 + data[i11] * w11;
      g += data[i00 + 1] * w00 + data[i10 + 1] * w10 + data[i01 + 1] * w01 + data[i11 + 1] * w11;
      b += data[i00 + 2] * w00 + data[i10 + 2] * w10 + data[i01 + 2] * w01 + data[i11 + 2] * w11;
    }
    const k = py * EW + px;
    out[k] = (r / 4 / 255 - MEAN[0]) / STD[0]; out[plane + k] = (g / 4 / 255 - MEAN[1]) / STD[1]; out[2 * plane + k] = (b / 4 / 255 - MEAN[2]) / STD[2];
  }
  const base = 3 * plane;                       // second image: rotated 180 degrees = reversed pixel order within each channel
  for (let c = 0; c < 3; c++) for (let i = 0; i < plane; i++) out[base + c * plane + i] = out[c * plane + (plane - 1 - i)];
  return out;
}
