// Transient UI mode state that isn't part of the document (never saved, never undone).

export const session = {
  drag: null,        // the active pointer drag: { type: 'move'|'marquee'|'spread'|'hard'|'pan'|'draw'|'stopMove'|'stopHard', ... }
  previewing: false,
  placing: null,     // null (a click adds a circle), 'arc' or 'line' (the next click places one), 'stroke' (the brush)
  sampling: false,
  spaceHeld: false,
};
