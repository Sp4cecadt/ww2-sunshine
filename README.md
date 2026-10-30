# Battle for Sunshine (v1)

A WW2 "what if" real-time strategy game in the browser, fought on a real map of **Sunshine, Victoria, Australia**
(about 1.9 × 1.9 km around Sunshine station). Allies vs Germans, you against a computer opponent.

Play: https://sp4cecadt.github.io/ww2-sunshine/ (desktop browsers and iPhone/iPad; can be added to the Home Screen).

## Controls
**Mouse & keyboard**: left-click selects; drag a box to select any mix of units as one group (Shift adds).
Right-click ground = move in formation, right-click enemy = attack, right-click own truck with infantry selected = board.
F + click = attack-move, H = hold, X = stop, U = unload, Ctrl/Shift + 1–9 = save group, 1–9 = recall (twice = jump camera),
Ctrl+A = select all, Space = centre on selection, P/Esc = pause.
Camera: WASD/arrows/screen edge = pan, Q/E or right-drag = rotate, wheel or +/- = zoom, middle-drag = pan.
Note: in desktop Chrome/Edge, Ctrl+1–9 switches browser tabs and cannot be overridden, so use Shift+1–9 there (or the group bar).

**Touch**: tap to select / move / attack; ▢ Select mode or long-press-then-drag for box selection; one finger pans,
pinch zooms, two-finger twist rotates; group bar: Save then a number stores, a number recalls.

## Rules
- Infantry: cheap, 50% damage reduction inside buildings (shown on the roof), grenades vs tanks under 45 m.
- Tanks: front armour ×0.5 damage, sides ×1.0, rear ×1.6. Buildings block tanks and trucks (flow-field pathing on a 4 m grid).
- Artillery: 750 m range, 70 m minimum; only fires at enemies currently seen by a friendly unit (spotting via fog of war + line of sight through buildings).
- Trucks: carry 2 infantry squads, resupply ammo (and some morale) to friendly units within 50 m.
- Morale: drops with damage, nearby friendly losses and shelling; recovers after 6 s without being hit; below 22 a unit breaks and retreats to base until it rallies above 55.
- Surrender: an army surrenders at ≥70% losses (by unit value), or ≥35% losses with army morale under 30. Wiping out all combat units also wins.

## Data and attribution
- Ground texture: Esri World Imagery tiles (zoom 17, 8×8 tiles) stitched by `build/fetch_tiles.py`.
  Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.
- Buildings, roads, rail, water: © OpenStreetMap contributors (ODbL), via the Overpass API (`build/fetch_osm.sh`, `build/process_osm.py`).
  Heights come from OSM `height`/`building:levels` where tagged, otherwise estimated from building type and footprint size.
- Three.js r169 (MIT) vendored in `vendor/`.
- German vehicles use the Balkenkreuz only; no swastikas or party symbols are used anywhere.

## Development
`node build/serve.mjs` → http://localhost:47621/ww2-sunshine/ · `?debug=1` exposes `window.dbg` (fast-forward with `dbg.step(seconds)`),
`?autostart=allies|axis`, `?speed=N`, `?noedge`. Tests: `node build/e2e.mjs` (Playwright, headless Chromium, desktop + iPhone touch).
Deploy: `build/deploy_github_pages.sh [--bump]`.
