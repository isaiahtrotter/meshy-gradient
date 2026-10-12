// Transient UI mode state that isn't part of the document (never saved, never undone).

export const session = {
  drag: null,        // the active pointer drag: { type: 'move'|'marquee'|'spread'|'hard'|'pan'|'draw'|'stopMove'|'stopHard', ... }
  previewing: false,
  placing: null,     // null (a click adds a circle), 'arc' or 'line' (the next click places one), 'stroke' (the brush), 'none' (no tool: drag selects, or pans on touch)
  pen: { color: '#c3cbcd', a: 1, grad: false, gradStops: [], gradAngle: 0, gradEase: 'linear' }, // the pencil's colour and opacity, edited in the Selected panel while the tool is active (node-shaped so that panel needs no special cases)
  stopSel: null,     // the selected hardness stop on a stroke, { id, i }; Delete removes it instead of the node
  sampling: false,
  spaceHeld: false,
  zoom: 1,           // mirrors view.zoom; read by handles.js so its screen-px sizing (hardness rings, circle
                      // arm scale) grows/shrinks with zoom without handles.js importing view.js (layering)
};
