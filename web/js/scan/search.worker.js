// Gallery search in a worker: int8 gallery [N,512] x float query [2,512] (upright + rotated crop) -> the TOP best rows by max cosine.
// Digital-only rows (flag 1) never match. cosine = rowScale * dot(query, int8 row).
const DIM = 512, TOP = 300, PART = 20 * 1024 * 1024;   // the gallery is stored as gallery.i8.0.bin, .1.bin ... of 20 MiB each (GitHub Pages: no Git LFS, files under 25 MiB)
let G, SC, FL, N = 0;

async function load(base, progress) {
  const fetchBytes = async (name, into, at, report) => {      // streams one file, optionally straight into a shared buffer
    const r = await fetch(base + name); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), parts = []; let got = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; if (into) into.set(value, at + got); else parts.push(value); got += value.length; if (total) report(got / total); }
    if (into) return got;
    const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
    return buf;
  };
  const get = async (name, Type) => new Type((await fetchBytes(name, null, 0, (f) => progress(name, f))).buffer);
  SC = await get('gallery.scale.f32.bin', Float32Array); FL = await get('flags.u8.bin', Uint8Array);
  N = SC.length;
  const bytes = N * DIM, nParts = Math.ceil(bytes / PART), buf = new Uint8Array(bytes), frac = new Array(nParts).fill(0);
  await Promise.all(Array.from({ length: nParts }, async (_, k) => {
    const want = Math.min(PART, bytes - k * PART);
    const got = await fetchBytes(`gallery.i8.${k}.bin`, buf, k * PART, (f) => { frac[k] = f; progress('gallery.i8.bin', frac.reduce((a, b) => a + b, 0) / nParts); });
    if (got !== want) throw new Error(`gallery.i8.${k}.bin: ${got} bytes, expected ${want}`);
  }));
  G = new Int8Array(buf.buffer);
  if (FL.length !== N) throw new Error('gallery files do not match');
}

function search(q) {
  const s = new Float32Array(N), q0 = q.subarray(0, DIM), q1 = q.subarray(DIM, 2 * DIM);
  for (let i = 0, base = 0; i < N; i++, base += DIM) {
    if (FL[i] & 1) { s[i] = -2; continue; }
    let a0 = 0, a1 = 0, a2 = 0, a3 = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    for (let k = 0; k < DIM; k += 4) {
      const g0 = G[base + k], g1 = G[base + k + 1], g2 = G[base + k + 2], g3 = G[base + k + 3];
      a0 += q0[k] * g0; a1 += q0[k + 1] * g1; a2 += q0[k + 2] * g2; a3 += q0[k + 3] * g3;
      b0 += q1[k] * g0; b1 += q1[k + 1] * g1; b2 += q1[k + 2] * g2; b3 += q1[k + 3] * g3;
    }
    s[i] = SC[i] * Math.max(a0 + a1 + a2 + a3, b0 + b1 + b2 + b3);
  }
  const c = Float32Array.from(s), k = N - TOP;           // quickselect: the TOP-th largest value is the threshold
  let lo = 0, hi = N - 1;
  while (lo < hi) {
    const p = c[(lo + hi) >> 1]; let i = lo, j = hi;
    while (i <= j) { while (c[i] < p) i++; while (c[j] > p) j--; if (i <= j) { const t = c[i]; c[i] = c[j]; c[j] = t; i++; j--; } }
    if (k <= j) hi = j; else if (k >= i) lo = i; else break;
  }
  const thr = c[k], idx = [];
  for (let i = 0; i < N; i++) if (s[i] >= thr) idx.push(i);
  idx.sort((a, b) => s[b] - s[a] || a - b);              // stable on ties, like the numpy version
  const rows = Int32Array.from(idx.slice(0, TOP)), scores = new Float32Array(rows.length);
  for (let i = 0; i < rows.length; i++) scores[i] = s[rows[i]];
  return { rows, scores };
}

onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') { await load(m.base, (name, f) => postMessage({ type: 'progress', name, f })); postMessage({ type: 'ready', n: N, flags: FL.slice() }); }
    else if (m.type === 'search') { const r = search(m.q); postMessage({ type: 'result', id: m.id, rows: r.rows, scores: r.scores }, [r.rows.buffer, r.scores.buffer]); }
  } catch (err) { postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) }); }
};
