# Mobile: what is done and what is still to do

Phones = up to 860 px wide (where the site switches to the top bar and bottom navigation). Desktop is not changed by any of this.

## Done

1. **Full-screen camera.** Tap the camera box (or Start camera): the camera fills the screen and the top bar and bottom navigation hide. The phone's Back button, the X or Done leaves it.
2. **Thumb bar on the camera.** Undo, a big Done / Stop button (shows how many cards are waiting), a Foil switch, and a flashlight button when the camera has one.
3. **Last scanned card on screen.** Picture, name, set, price and count; tap it to remove that scan or mark it foil. The phone vibrates on each card.
4. **Setup tucked away.** One "Into <binder> · <deck>" chip opens a sheet to choose the binder and deck (including + New binder / + New deck). The first-time tip can be closed for good; scanner settings and stats are under "More options".
5. **Review fills the screen.** One card per row with big + / − and Foil buttons, swipe a card sideways to remove it, binder / deck and the Add button stay at the bottom.
8. **Installable app.** `manifest.webmanifest`, icons in `icons/`, theme color and Apple tags: "Add to Home Screen" opens MagicCV full screen, starting on the Scanner.
9. **Width fixes.** Lists and Price Search no longer scroll sideways on a phone.
11. **Tap targets.** Steppers, the row "..." button, color dots, filter chips and switches are at least 44 px; form fields use 16 px text so iPhones do not zoom in.
12. **Bottom sheets.** Dialogs, the card "..." menu, the Database menu and the deck option pop-ups open from the bottom of the screen.

## Still to do (proposed, not built yet)

6. **More camera controls.** Tap to focus, pinch zoom, switch between cameras, and keep the screen awake while scanning (Wake Lock).
7. **Download and speed warnings.** The first start downloads about 110 MB: warn on mobile data with a progress bar, and show a "slow phone" hint when frames per second stay low (the README measured about 2.6 fps on a CPU; real phone speed is still unknown).
10. **Bottom bar.** Make Scanner a bigger centre button.
13. **Tap-to-preview.** The hover "large view" does not exist on touch screens; tapping a card should open a preview sheet (Inventory, Decks, Lists).
14. **Card-style rows.** Inventory and Lists tables become card rows on phones (like the scan review).
15. **Less text.** Hide the long intro paragraphs on other pages on phones.
- Also noticed: the deck rows' quick buttons (+ / − / Tag) only appear on hover, so phones only get them through the "..." menu.
- Not done with item 8: caching the 110 MB of models and card data for offline use needs our own service worker, which has to be combined with `coi-serviceworker.js`.
