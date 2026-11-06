# web2 design notes

Source: the UI/UX Pro Max skill (`ui-ux-pro-max`, installed in `~/.claude/skills/`), run for a *trading card collection manager with a live scanner, a dense dark dashboard* (design dials: variance 5, motion 4, density 7). What was used, what was not, and the rules applied.

## Used from the skill's design system

- **Style: Dark Mode (OLED).** Deep black base, low glow, high contrast, visible focus, reduced motion respected. Light mode is kept as a theme but is not the default (the skill: "light mode not recommended").
- **Colors** (CSS tokens in `css/style.css`): background `#020617`, surface `#0e1223`, muted `#1a1e2f`, border `#334155`, text `#f8fafc`, muted text `#94a3b8`, accent `#22c55e` with on-accent `#0f172a`, destructive `#ef4444` (text `#f87171` for contrast). Extra data colors for chips and stats: sky `#38bdf8`, amber `#f59e0b`, violet `#a78bfa`.
- **Typography: Fira Sans (UI) / Fira Code (numbers, set codes, quantities).** Self-hosted from `fonts/` (latin subset, OFL licence files included), so no request goes to Google at runtime.
- **Motion:** 150-250 ms transitions, the page entrance animation plays only on page changes, `prefers-reduced-motion` turns all of it off. No particles.
- **Pre-delivery checklist:** no emoji icons (one SVG set), `cursor: pointer` on clickable things, smooth hover states, text contrast of at least 4.5:1, visible keyboard focus, reduced motion, responsive at 375, 768, 1024 and 1440 px.

## Not used

- The suggested **page pattern ("Enterprise Gateway")** is a marketing landing page (mega menu, client logos, contact sales). This is an app, so it was ignored; the layout follows the UX rules below instead.

## UX rules applied (from `--domain ux` searches)

- **Tables:** horizontal scroll inside the card on phones (the page never scrolls sideways), empty states with a message and an action, multi-select with a checkbox column and an action bar for bulk actions.
- **Loading:** a real progress bar (`role="progressbar"`) with a status line while the models and card data load.
- **Navigation:** sidebar on desktop, bottom navigation with 4 items on phones (the skill's limit is 5), hash routes keep the browser Back button working, the main region takes focus on page change, a skip link is the first Tab stop.
- **Dialogs and focus:** native `<dialog>` (focus trap, Escape, focus returns to the opener), 2 px focus ring with offset on every control.
- **Feedback:** toasts auto-dismiss after 4 s in a polite live region; nav counts are announced with context ("Inventory, 63 cards"), not as bare numbers.
- **Media:** the camera starts only on a button press and has a visible Stop; nothing autoplays.

## Contrast notes

Muted text `#94a3b8` on surface `#0e1223` is about 6.9:1; accent `#22c55e` on surface about 8:1; on-accent `#0f172a` on `#22c55e` about 7.9:1; destructive text uses `#f87171` (the plain red is only for borders and fills). The Light theme uses darker accent and muted tones (`#15803d`, `#475569`) to stay above 4.5:1.
