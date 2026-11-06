// Follows each physical card across frames (a light version of scanner_multi.MultiTracker): detections are matched to tracks by
// centre distance, a track is confirmed after 3 hits and dropped after MAX_MISS frames without a detection.
const MAX_MISS = 10, CONFIRM = 3;
const centroid = (q) => [q.reduce((a, p) => a + p[0], 0) / 4, q.reduce((a, p) => a + p[1], 0) / 4];
const sideLen = (q) => q.reduce((a, p, i) => a + Math.hypot(p[0] - q[(i + 1) % 4][0], p[1] - q[(i + 1) % 4][1]), 0) / 4;

export class Tracker {
  constructor() { this.tracks = []; this.lost = []; this.nextId = 1; }
  update(dets, now) {
    const free = new Set(this.tracks.map((_, i) => i));
    for (const d of dets) {
      const c = centroid(d.corners), size = sideLen(d.corners);
      let best = -1, bd = Infinity;
      for (const i of free) {
        const t = this.tracks[i], dd = Math.hypot(c[0] - t.c[0], c[1] - t.c[1]);
        if (dd < 0.6 * Math.max(size, t.size) && dd < bd) { bd = dd; best = i; }
      }
      if (best >= 0) {
        free.delete(best);
        const t = this.tracks[best];
        t.quad = d.corners; t.c = c; t.size = size; t.vis = d.vis; t.misses = 0; t.hits++; t.score = d.score;
        t.shown = t.shown ? t.shown.map((p, k) => [p[0] + 0.5 * (d.corners[k][0] - p[0]), p[1] + 0.5 * (d.corners[k][1] - p[1])]) : d.corners;   // smoothed outline (display only)
      } else {
        this.tracks.push({ id: this.nextId++, quad: d.corners, shown: d.corners, c, size, vis: d.vis, score: d.score, hits: 1, misses: 0, born: now,
                           hist: [], votes: [], ident: null, logged: false, lastRec: 0, info: null });
      }
    }
    for (const i of free) this.tracks[i].misses++;
    this.tracks = this.tracks.filter((t) => {
      if (t.misses <= MAX_MISS) return true;
      if (t.ident) this.lost.push({ key: t.ident.key, c: t.c, size: t.size, at: now, logged: t.logged });
      return false;
    });
    this.lost = this.lost.filter((l) => now - l.at < 60000);
  }
  confirmed(t) { return t.hits >= CONFIRM; }
  live() { return this.tracks.filter((t) => t.misses === 0); }
  // a card that dropped out and came back as a new track must not be logged twice: true when a recently lost, already logged track
  // with the same identity sat where this one is
  isReappearance(t, key, now) {
    return this.lost.some((l) => l.logged && l.key === key && now - l.at < 10000 && Math.hypot(l.c[0] - t.c[0], l.c[1] - t.c[1]) < 1.2 * Math.max(l.size, t.size));
  }
}
