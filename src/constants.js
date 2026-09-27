// Shared limits and tunables. Anything that also appears in CSS is noted.

export const MAXN = 40;               // uniform slots in the shader; an unlinked arc/line uses two
export const MAX_STROKE_PTS = 48;     // points per brush stroke; the columns of the renderer's stroke texture
export const HARD_K_MIN = 1, HARD_K_MAX = 40; // the range the hardness rings drag through
export const MOBILE_BREAKPOINT = 820; // must match the @media (max-width) in styles.css
export const CANVAS_MIN = 16, CANVAS_MAX = 8192, EXPORT_MAX = 16384;
export const ZOOM_MIN = 0.25, ZOOM_MAX = 8;
export const PX_PER_SPREAD = 100, ARM_MIN = 12; // a circle spread of 0.5 draws a 50px arm
export const UNDO_LIMIT = 60;
// An occluding node's own softness slider (0..1) maps onto this px range, added to its edge (not scaled by
// the global softness slider). The floor keeps an occluding node's edge always a little blurred, even at 0.
export const OCC_SOFT_MIN_PX = 3, OCC_SOFT_MAX_PX = 60;
// An occluding node's hard edge sits at half its configured size — matching how the same size value reads
// on a non-occluding node, whose soft core sits around size × the global softness slider's default (~0.5).
export const OCC_SIZE_SCALE = 0.5;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const isNum = v => typeof v === 'number' && Number.isFinite(v);
