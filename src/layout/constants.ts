/**
 * Layout constants.
 *
 * Every geometric constant the layout engine uses lives here. Keeping
 * them in one place makes the determinism of the layout easy to audit
 * (no magic numbers scattered through the layout modules) and lets
 * the renderer reason about font metrics uniformly.
 *
 * All values are in **SVG user units** (1 user unit = 1 px at 1×
 * zoom). No env reads, no `Date`, no `Math.random` — the constants
 * ARE the source of truth.
 */

/** Width of one character at the default font size, in user units. */
export const CHAR_WIDTH = 8;

/** Default font size for body text (nodes, labels, etc). */
export const FONT_SIZE = 14;

/** Font size for small captions (e.g. cardinality labels on ERD lines). */
export const FONT_SIZE_SMALL = 11;

/** Padding around text inside a node. */
export const NODE_PADDING_X = 12;
export const NODE_PADDING_Y = 10;

/** Minimum node width regardless of label size. */
export const MIN_NODE_WIDTH = 60;
/** Minimum node height regardless of label size. */
export const MIN_NODE_HEIGHT = 36;

/** Vertical gap between flowchart rows. */
export const ROW_GAP = 48;
/** Horizontal gap between flowchart columns / between nodes on the same row. */
export const COL_GAP = 32;

/** Vertical gap between sequence messages. */
export const SEQ_MSG_GAP = 28;
/** Height of the actor header band. */
export const SEQ_HEADER_BAND = 48;
/** Lifeline extends this far below the last message. */
export const SEQ_LIFELINE_TAIL = 32;

/** ERD grid: gap between adjacent tables on the same row. */
export const ERD_GRID_GAP_X = 48;
export const ERD_GRID_GAP_Y = 48;
/** ERD table row height (one attribute per row). */
export const ERD_ROW_HEIGHT = 22;
/** ERD table header band height. */
export const ERD_HEADER_BAND = 28;

/** Outer margin from the canvas edge to the first node. */
export const CANVAS_MARGIN = 24;

/** Width of the SVG canvas backing these layouts (also used by the HTML wrapper). */
export const CANVAS_WIDTH = 960;
/** Height of the SVG canvas backing these layouts. */
export const CANVAS_HEIGHT = 640;
