// Shared limits and tunables. Anything that also appears in CSS is noted.

export const MAXN = 40;               // uniform slots in the shader; an unlinked arc/line uses two
export const MOBILE_BREAKPOINT = 820; // must match the @media (max-width) in styles.css
export const CANVAS_MIN = 16, CANVAS_MAX = 8192, EXPORT_MAX = 16384;
export const ZOOM_MIN = 0.25, ZOOM_MAX = 8;
export const PX_PER_SPREAD = 100, ARM_MIN = 12; // a circle spread of 0.5 draws a 50px arm
export const UNDO_LIMIT = 60;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isNum = v => typeof v === 'number' && Number.isFinite(v);
