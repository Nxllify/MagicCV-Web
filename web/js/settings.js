// User settings (theme, background, scanner options), kept in localStorage next to the database.
const KEY = 'magiccv.settings.1';
export const THEMES = [   // swatch = [background, panel, accent, highlight]
  { id: 'midnight', name: 'Midnight Blue', swatch: ['#0a101d', '#152036', '#1f6fd0', '#38c6d9'] },
  { id: 'vaporwave', name: 'Vaporwave', swatch: ['#170a2b', '#2a1450', '#e0237f', '#4de1ff'] },
  { id: 'emerald', name: 'Emerald', swatch: ['#07130e', '#11261c', '#1c9a5f', '#5fe0b0'] },
  { id: 'crimson', name: 'Crimson', swatch: ['#13080b', '#28111a', '#c2273d', '#ff9aa8'] },
  { id: 'amber', name: 'Amber', swatch: ['#120f09', '#251c0f', '#c98009', '#ffd37a'] },
  { id: 'slate', name: 'Slate', swatch: ['#0d1013', '#1a1f26', '#5b7393', '#8fb4d9'] },
  { id: 'light', name: 'Light', swatch: ['#eaf0f8', '#ffffff', '#1f6fd0', '#0b8aa0'] },
];
export const BACKENDS = [['auto', 'Automatic (WebGPU if available)'], ['webgpu', 'Graphics card (WebGPU)'], ['wasm', 'CPU (WASM)']];
const DEFAULTS = { theme: 'midnight', snow: true, backend: 'auto', threads: 'auto', conf: 0.3, camera: '' };
let s = { ...DEFAULTS };
try { s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; } catch { /* defaults */ }
if (!THEMES.some((t) => t.id === s.theme)) s.theme = DEFAULTS.theme;
if (s.webgpu === true && s.backend === 'auto') s.backend = 'webgpu';     // the earlier on/off switch
delete s.webgpu;
if (!BACKENDS.some(([v]) => v === s.backend)) s.backend = 'auto';
export const settings = () => s;
export function set(patch) { s = { ...s, ...patch }; localStorage.setItem(KEY, JSON.stringify(s)); apply(); }
export function apply() {
  document.documentElement.dataset.theme = s.theme;
  const c = document.getElementById('snow'); if (c) c.style.display = s.snow ? '' : 'none';
}
apply();
