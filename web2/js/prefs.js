// web2 settings: color theme, scanner options. Own storage key (the card database is shared with the classic site: key magiccv.db.1 in web/js/store.js).
const KEY = 'magiccv2.settings.1';
export const THEMES = [   // swatch = [background, surface, accent, text]
  { id: 'dark', name: 'OLED Dark', note: 'Deep black, green accent', swatch: ['#020617', '#0e1223', '#22c55e', '#f8fafc'] },
  { id: 'midnight', name: 'Midnight Blue', note: 'Navy, blue accent', swatch: ['#060b18', '#0e1830', '#3b82f6', '#f8fafc'] },
  { id: 'vaporwave', name: 'Vaporwave', note: 'Purple gradient, pink accent', swatch: ['#120726', '#1f0f3d', '#ff4fa3', '#f8fafc'] },
  { id: 'crimson', name: 'Crimson', note: 'Dark red, coral accent', swatch: ['#0e0508', '#1c0b11', '#ef4458', '#f8fafc'] },
  { id: 'amber', name: 'Amber', note: 'Warm dark, gold accent', swatch: ['#0d0a04', '#1a1409', '#f59e0b', '#f8fafc'] },
  { id: 'violet', name: 'Violet', note: 'Deep purple, violet accent', swatch: ['#0a0614', '#150d29', '#8b5cf6', '#f8fafc'] },
  { id: 'light', name: 'Light', note: 'Light surfaces, green accent', swatch: ['#f1f5f9', '#ffffff', '#15803d', '#0f172a'] },
];
export const BACKENDS = [['auto', 'Automatic (WebGPU if available)'], ['webgpu', 'Graphics card (WebGPU)'], ['wasm', 'CPU (WASM)']];
const DEFAULTS = { theme: 'dark', backend: 'auto', threads: 'auto', conf: 0.3, camera: '', sound: true };
let s = { ...DEFAULTS };
try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
if (!THEMES.some((t) => t.id === s.theme)) s.theme = DEFAULTS.theme;
if (!BACKENDS.some(([v]) => v === s.backend)) s.backend = 'auto';
export const prefs = () => s;
export function setPrefs(patch) { s = { ...s, ...patch }; localStorage.setItem(KEY, JSON.stringify(s)); apply(); }
export function apply() { document.documentElement.dataset.theme = s.theme; }
apply();
