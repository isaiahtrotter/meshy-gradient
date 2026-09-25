// Transient UI mode state that isn't part of the document (never saved, never undone).

export const session = {
  drag: null,        // the active pointer drag: { type: 'move'|'marquee'|'spread'|'hard'|'pan', ... }
  previewing: false,
  addingArc: false,
  addingLine: false,
  sampling: false,
  spaceHeld: false,
};
