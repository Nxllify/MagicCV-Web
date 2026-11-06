// Loads onnxruntime-web (vendored in web/vendor/ort, MIT), the detector and the embedder, and the card database. Once per page.
import { Detector } from './detector.js';
import { Matcher } from './matcher.js';

const MODELS = new URL('../../models/', import.meta.url).href, DATA = new URL('../../data/', import.meta.url).href;
let cached = null;

async function fetchBytes(url, label, onStatus) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${label}: HTTP ${r.status} (${url})`);
  const total = +r.headers.get('content-length') || 0, reader = r.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (total) onStatus(label, got / total); }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}

export async function webgpuAvailable() {
  try { return !!navigator.gpu && !!(await navigator.gpu.requestAdapter()); } catch { return false; }
}
let loadedBackend = null;                       // set once the models are loaded: the runtime cannot switch backend afterwards (reload the page)
export const engineLoaded = () => loadedBackend !== null;

// backend: 'auto' | 'webgpu' | 'wasm'; threads: 'auto' | 1 | 2 | 4 | 8 (CPU only; more than 1 needs cross-origin isolation)
export function loadEngine({ backend = 'auto', threads = 'auto', onStatus = () => {} } = {}) {
  if (cached) return cached;
  cached = (async () => {
    onStatus('Loading the model runtime', 0);
    const mod = await import('../../vendor/ort/ort.all.min.mjs'), ort = mod.default ?? mod;
    ort.env.wasm.wasmPaths = new URL('../../vendor/ort/', import.meta.url).href;
    const gpuOk = backend !== 'wasm' && await webgpuAvailable();
    let note = '', want = backend === 'wasm' ? 'wasm' : gpuOk ? 'webgpu' : 'wasm';
    if (backend === 'webgpu' && !gpuOk) note = 'WebGPU is not available in this browser, using the CPU. ';
    // CPU threads need cross-origin isolation (coi-serviceworker.js adds it on GitHub Pages; the page reloads once)
    const iso = self.crossOriginIsolated, cores = navigator.hardwareConcurrency || 2;
    const nThreads = want === 'webgpu' ? 1 : !iso ? 1 : threads === 'auto' ? Math.min(4, cores) : Math.max(1, Math.min(+threads, cores));
    ort.env.wasm.numThreads = nThreads;
    ort.env.wasm.proxy = want !== 'webgpu';      // CPU: run the model in a worker so the page stays responsive; WebGPU runs on the GPU anyway
    const [det, emb] = await Promise.all([fetchBytes(MODELS + 'card_corners_v9_640.onnx', 'Loading the card detector', onStatus), fetchBytes(MODELS + 'card_embed_v3_512.onnx', 'Loading the card model', onStatus)]);
    onStatus('Starting the models', 0);
    const create = (ep) => Promise.all([ort.InferenceSession.create(det, { executionProviders: ep, graphOptimizationLevel: 'all', logSeverityLevel: 3 }), ort.InferenceSession.create(emb, { executionProviders: ep, graphOptimizationLevel: 'all', logSeverityLevel: 3 })]);
    let sessions;
    try { sessions = await create(want === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm']); }
    catch (e) {
      if (want !== 'webgpu') throw e;
      note = `WebGPU failed (${String(e.message || e).slice(0, 70)}), using the CPU. `; want = 'wasm';
      sessions = await create(['wasm']);
    }
    const label = want === 'webgpu' ? 'Graphics card (WebGPU)' : `CPU (WASM, ${nThreads} thread${nThreads > 1 ? 's' : ''}${iso ? '' : '; reload the page for more'})`;
    const matcher = new Matcher();
    await matcher.load(DATA, (t, f) => onStatus(t, f));
    loadedBackend = want;
    return {
      ort, backend: label, backendId: want, note, matcher, detector: new Detector(ort, sessions[0]),
      async embed(tensor) {           // tensor: Float32Array [2,3,384,272] -> Float32Array(2*512), unit-length rows
        const r = await sessions[1].run({ input: new ort.Tensor('float32', tensor, [2, 3, 384, 272]) });
        return Float32Array.from(r.emb.data);
      },
    };
  })();
  cached.catch(() => { cached = null; loadedBackend = null; });     // a failed load can be retried
  return cached;
}
