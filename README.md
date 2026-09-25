# Meshy Gradient

A WebGL mesh-gradient editor. Static ES modules, no build step, deployed on Vercel
(`vercel.json` rewrites `/` to `meshygradient.html`). Live at the `meshy-gradient` Vercel project.

## Files

| File | What |
|---|---|
| `meshygradient.html` | Markup only. Loads `styles.css` and `src/app.js` (type=module) |
| `styles.css` | All styling. Mobile breakpoint is 820px (mirrored in `src/constants.js`) |
| `presets.json` | Array of gradient configs shown in the Presets grid. Paste a "Copy gradient" payload in to add one |
| `src/` | The app, one concern per module (below) |

## Module map

Layers go top to bottom; a module only imports from layers above it. `refresh.js` is the one place that
composes handles + panel + draw, so most mutations end with `refreshAll()` from there.

| Module | Owns | Imports from |
|---|---|---|
| `constants.js` | limits, breakpoint, `clamp`, `isNum` | — |
| `color.js` | hex/rgb/hsv/hsl conversions, `parseHexInput`, `randomColor` | — |
| `geometry.js` | pure arc maths: `arcGeom`, `halfArcGeom`, `wrapAngle` | — |
| `nodes.js` | the node model: `normalizeNode`, `createNode`, `armAngle`, `armEnds`, `arcCurves`, `convertNodeType`, `toggleLinked` | geometry, color |
| `state.js` | `state`, `PALETTES`, ids, selection helpers, `targetNodes`, `addNode`/`setNodes`, `serializeConfig`/`applyConfig` | constants, nodes |
| `undo.js` | undo/redo stacks, `snapshot`, `pushUndo`, `onRestore`/`onUndoChange` hooks | state |
| `persistence.js` | localStorage save/load (`meshGradientState.v1`), debounced + flushed on pagehide | state |
| `session.js` | transient UI state: `drag`, `previewing`, placement mode, `sampling`, `spaceHeld` | — |
| `dom.js` | `$`, stage/frame/overlay refs, `frameRect`, `maxDim`, `normPos`, `setStatus` | — |
| `shader.js` | GLSL source + the per-slot uniform layout comment | constants |
| `renderer.js` | `makeRenderer(canvas)` → `render(w, h, state)`, `renderClean` (grain off); packs nodes into slots | shader, nodes, color |
| `exporter.js` | export width/height inputs, JPG export | renderer, state |
| `handles.js` | per-node overlay DOM, `refreshHandles`, hardness ring maths | state, session, nodes, dom |
| `view.js` | preview renderer + `draw()`, `layout()`, zoom/pan, reference image | renderer, handles, exporter, persistence |
| `colorPanel.js` | Selected panel, hex input, HSV picker, `refreshSelectionPanel`, `setSelectedColor` | state, undo, handles, view |
| `refresh.js` | `refreshAll`, `refreshSelection` | handles, colorPanel, view |
| `actions.js` | `deleteSelected`, `selectAllNodes`, `clearSelection`, `nudgeSelected` | state, undo, refresh |
| `modes.js` | preview toggle, arc/line placement, hint text | session, dom |
| `sampling.js` | eyedropper, loupe, `colorAtCanvasPoint` | view, refresh, modes |
| `nodeMenu.js` | right-click menu: type conversion, link/unlink | nodes, state, undo, refresh |
| `interaction.js` | the pointer drag state machine (spread / hard / move / marquee / pan) | most of the above |
| `keyboard.js` | global shortcuts | actions, modes, sampling, view, undo |
| `controls.js` | canvas size + scrubbers, sliders, palettes, align/shuffle/scatter, `syncControlsFromState`, `seedNodes` | state, undo, view, refresh, actions |
| `presets.js` | fetches `presets.json`, applies presets, Copy gradient | state, undo, view, refresh, controls |
| `app.js` | entry: wires undo hooks, restores state, first layout | everything |

Listener registration order matters in one place: `sampling.js` must evaluate before `interaction.js` (its
capture-phase pointerdown swallows clicks while sampling). `interaction.js` imports `sampling.js`, so this holds.

## Data model

Every node in `state.nodes` has passed through `normalizeNode()` (on create, load, preset, undo restore), so
readers never apply fallbacks. Positions and lengths are normalized: `x`,`y` in 0..1 of the canvas.

Common fields: `id`, `type` (`'circle'|'arc'|'line'`), `x`, `y`, `a` (alpha), `k` (hardness), `color`
(`#rrggbb` lowercase), `th` (primary axis angle), `linked` (bool), `sl`, `sr` (left/right arm lengths).

| `type` | Extra fields | Length units |
|---|---|---|
| `circle` | `st`, `sb`, `th2` (second axis angle) | spread × `PX_PER_SPREAD` (100px) on screen; `× uSoft` in shader |
| `arc` | `phi` (bend at apex), `sw` (band width) | fraction of the canvas's long side |
| `line` | `sw` | fraction of the long side |

Unlinked nodes (`linked: false`) store each arm's own angle in `ar`, `al` (and `at`, `ab` for circles).
`armAngle(n, side)` is the only reader; it derives angles from `th`/`th2`/`phi` when linked.

Legacy shapes still accepted by the normalizer: single `r`, `rx`/`ry`, absent `type`, arc `thr`/`thl`.

## Render pipeline

1. Any visible change calls `draw()` (view.js), which coalesces into one `requestAnimationFrame` and schedules
   a debounced localStorage save.
2. `render(w, h, state)` walks the nodes and packs each into a **slot** across parallel uniform arrays
   (`uNode`, `uNode2`, `uNode3`, `uTh2`, `uType`, `uColor`). The layout per `uType` is documented at the top
   of `shader.js`. An unlinked arc or line consumes two slots. `MAXN` = 40 slots.
3. The fragment shader loops over slots, computes a weight `(1 / (1 + d²))^k` per slot from a normalized
   distance, and blends colours by weight. Then hue/sat/brightness, optional linear light, and seeded grain
   sized relative to the logical canvas width.
4. Arc circles are fit on the CPU (`arcCurves` → `geometry.js`) each frame and passed as centre/radius/span.
5. Preview renders at the frame's on-screen size × DPR (max 2), capped at 4096 per side. Export builds a
   second renderer on an offscreen canvas.

## Conventions

- Undo: `const snap = snapshot()` before a change, `pushUndo(snap)` once committed. Snapshots cover nodes
  and canvas size only.
- Every mutation ends in `refreshAll()` (handles + selection panel + draw) or `refreshHandles(); draw()`
  during drags.
- Actions on "the selection or everything" go through `targetNodes()`.
- Nodes are looked up with `nodeById(id)`; never mutate `state.nodes` by index from UI code, use the helpers
  in `state.js`.
- Screen-space positions come from `frameRect()` / `maxDim()` / `normPos()` in `dom.js`.

## Testing

```
npm install && npm run test:setup   # once: installs Playwright and a headless Chromium
npm test                            # runs everything, ~40s
```

Run `npm test` before every push to prod. It starts its own static server, so nothing needs to be running.

- `tests/app.spec.js` drives the real page: add, drag, undo/redo, arc/line placement, spread handles, the
  context menu, colour picker, palettes, presets, canvas size, sliders, zoom, preview, copy, reload
  persistence, legacy saved shapes, export.
- `tests/render.spec.js` renders every preset and compares it pixel-for-pixel with the baselines in
  `tests/render.spec.js-snapshots/`. When a rendering change is intended, regenerate them with
  `npm run test:update` and commit the new PNGs. Baselines are per platform; they're generated on macOS.
- `tests/helpers.js` holds the shared page helpers. The app exposes `window.__meshy.state` for the tests.

Pure modules (`geometry`, `nodes`, `state`, `undo`, `color`) import cleanly in Node if unit tests are added later.

## Remaining backlog

1. Decouple `scheduleSave()` from `draw()`: save on state mutation, not on render.
2. Perf: only re-lay-out handles for changed nodes; half-resolution preview while dragging; render only the
   visible part of the frame when zoomed in.
3. Extend undo snapshots to cover softness/grain/adjustments (presets change them but undo doesn't restore).
4. Add a storage version/migration hook beyond the normalizer for future non-node schema changes.
5. Check in a test runner (vitest) for the pure modules and an eslint config.
