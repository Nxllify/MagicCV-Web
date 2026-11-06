// Match an embedding against the gallery and decide whether the answer may be named. Port of Recognizer.embed_info / embed_accepts /
// generic_sure / fuse_embeddings in reference_python/avatar_scanner_v2.py (embedder-only path: no SIFT verification in the browser).
export const EMBED_SURE = 0.65, EMBED_MARGIN = 0.10, EMBED_KEY_MARGIN = 0.03, GENERIC_COS = 0.80, GENERIC_MARGIN = 0.10, EMB_FUSE = 5;
export const DIM = 512;

export class Matcher {
  constructor() { this.worker = null; this.pending = new Map(); this.nextId = 1; this.cards = null; this.flags = null; }

  // base: URL of the folder with the exported files; onProgress(text, 0..1)
  async load(base, onProgress = () => {}) {
    const meta = await (await fetch(base + 'meta.json')).json();
    const cards = await (await fetch(base + 'cards.json')).json();
    this.cards = cards; this.n = meta.n;
    // name / key ids (casefolded name; name + treatment), the same identity the desktop Recognizer uses for margins
    const nid = new Map(), kid = new Map();
    this.nameId = new Int32Array(this.n); this.keyId = new Int32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const nm = cards.name[i].toLowerCase(), key = nm + '|' + cards.treat[i];
      this.nameId[i] = nid.get(nm) ?? (nid.set(nm, nid.size), nid.size - 1);
      this.keyId[i] = kid.get(key) ?? (kid.set(key, kid.size), kid.size - 1);
    }
    this.worker = new Worker(new URL('./search.worker.js', import.meta.url));
    await new Promise((resolve, reject) => {
      this.worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') onProgress(`Loading card database (${m.name.split('.')[0]})`, m.f);
        else if (m.type === 'ready') { this.flags = m.flags; this.worker.onmessage = (ev) => this._msg(ev); resolve(); }
        else if (m.type === 'error') reject(new Error(m.message));
      };
      this.worker.onerror = (e) => reject(new Error(e.message || 'search worker failed'));
      this.worker.postMessage({ type: 'init', base });
    });
  }
  _msg(e) {
    const m = e.data, p = this.pending.get(m.id); if (!p) return;
    this.pending.delete(m.id);
    m.type === 'error' ? p.reject(new Error(m.message)) : p.resolve(m);
  }
  _search(q) {
    return new Promise((resolve, reject) => { const id = this.nextId++; this.pending.set(id, { resolve, reject }); this.worker.postMessage({ type: 'search', id, q }, [q.buffer]); });
  }

  // emb: Float32Array(2*512) (upright, rotated). Returns embed_info: {rows, scores, top, cos, margin, keyMargin, sure, generic}
  async lookup(emb) {
    const { rows, scores } = await this._search(emb.slice());
    const t0 = rows[0], n0 = this.nameId[t0], k0 = this.keyId[t0], floor = scores[scores.length - 1];
    let other = floor, otherKey = floor;
    for (let i = 0; i < rows.length; i++) if (this.nameId[rows[i]] !== n0) { other = scores[i]; break; }
    for (let i = 0; i < rows.length; i++) if (this.nameId[rows[i]] === n0 && this.keyId[rows[i]] !== k0) { otherKey = scores[i]; break; }
    const cos = scores[0], margin = cos - other, keyMargin = cos - otherKey;
    const generic = !!(this.flags[t0] & 4), genericSure = cos >= GENERIC_COS && margin >= GENERIC_MARGIN;
    const sure = cos >= EMBED_SURE && margin >= EMBED_MARGIN && keyMargin >= EMBED_KEY_MARGIN && (!generic || genericSure);
    return { rows, scores, top: t0, cos, margin, keyMargin, sure, generic, emb };
  }

  // cos^2-weighted mean of this frame's embedding and the card's last few (hist = [{emb, cos}], newest last), as in fuse_embeddings
  fuse(emb, cos, hist) {
    const pool = hist.slice(-(EMB_FUSE - 1)).concat([{ emb, cos }]), m = new Float32Array(2 * DIM);
    for (const { emb: e, cos: c } of pool) {
      const w = Math.max(c, 0) ** 2;
      for (let r = 0; r < 2; r++) {
        let nrm = 0; for (let k = 0; k < DIM; k++) nrm += e[r * DIM + k] ** 2;
        nrm = Math.max(Math.sqrt(nrm), 1e-8);
        for (let k = 0; k < DIM; k++) m[r * DIM + k] += w * e[r * DIM + k] / nrm;
      }
    }
    for (let r = 0; r < 2; r++) {
      let nrm = 0; for (let k = 0; k < DIM; k++) nrm += m[r * DIM + k] ** 2;
      nrm = Math.max(Math.sqrt(nrm), 1e-8);
      for (let k = 0; k < DIM; k++) m[r * DIM + k] /= nrm;
    }
    return m;
  }

  // the label shown and logged: treatments of the printing, plus 'promo' unless it has a regular/promo twin (flag 2)
  specialPrint(row) {
    const t = this.cards.treat[row] ? this.cards.treat[row].split(', ') : [];
    if ((this.flags[row] & 8) && !(this.flags[row] & 2)) t.push('promo');
    return t.join(', ');
  }
  record(row) { const c = this.cards; return { name: c.name[row], special_print: this.specialPrint(row), best_guess_set: c.set[row], collector_number: c.no[row] }; }
  label(row) { const sp = this.specialPrint(row); return this.cards.name[row] + (sp ? ` [${sp}]` : ''); }
  key(row) { return this.keyId[row]; }
  dispose() { this.worker?.terminate(); }
}
