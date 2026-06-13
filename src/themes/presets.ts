/**
 * Theme presets.
 *
 * The renderer, the HTML wrapper, and the SVG `<style>` block all read
 * from these three frozen objects so colors and contrast stay
 * consistent across outputs. The values are intentionally chosen for
 * high contrast (WCAG AA on body text) and are not exposed for
 * extension — the spec ships exactly three themes; unknown theme →
 * `light` fallback is enforced by `getTheme()`.
 *
 * Determinism: every theme is `Object.freeze`n at module load. The
 * renderer never mutates a theme; it reads it. `getTheme()` returns
 * the same reference for the same name on every call, so two renders
 * with the same `(ir, type, theme)` argument produce byte-identical
 * SVG (AC-7).
 */
import type { Theme, ThemeName } from '../types.js';

/**
 * `light` is the default theme. Soft off-white background, near-black
 * foreground, navy accents.
 */
export const THEME_LIGHT: Readonly<Theme> = Object.freeze({
  name: 'light',
  background: '#fdfdfd',
  foreground: '#1a1a1a',
  text: '#1a1a1a',
  muted: '#5a5a5a',
  accent: '#2b5fa6',
  edge: '#3a3a3a',
  nodeFill: '#ffffff',
  nodeStroke: '#2b5fa6',
});

/**
 * `dark` — true near-black background, light text, cyan accents.
 */
export const THEME_DARK: Readonly<Theme> = Object.freeze({
  name: 'dark',
  background: '#101216',
  foreground: '#e6e6e6',
  text: '#e6e6e6',
  muted: '#9aa0a6',
  accent: '#62c4d8',
  edge: '#9aa0a6',
  nodeFill: '#1c1f25',
  nodeStroke: '#62c4d8',
});

/**
 * `blueprint` — saturated blueprint blue background, white strokes,
 * dashed-grid feel without drawing the grid.
 */
export const THEME_BLUEPRINT: Readonly<Theme> = Object.freeze({
  name: 'blueprint',
  background: '#0e3a6b',
  foreground: '#ffffff',
  text: '#ffffff',
  muted: '#bcd4f2',
  accent: '#ffd166',
  edge: '#ffffff',
  nodeFill: '#134b87',
  nodeStroke: '#ffffff',
});

/** All three shipped themes, in display order. */
export const ALL_THEMES: ReadonlyArray<Readonly<Theme>> = Object.freeze([
  THEME_LIGHT,
  THEME_DARK,
  THEME_BLUEPRINT,
]);

const THEME_BY_NAME: ReadonlyMap<ThemeName, Readonly<Theme>> = new Map<
  ThemeName,
  Readonly<Theme>
>([
  ['light', THEME_LIGHT],
  ['dark', THEME_DARK],
  ['blueprint', THEME_BLUEPRINT],
]);

export interface GetThemeResult {
  /** The resolved theme (always one of the three shipped presets). */
  readonly theme: Readonly<Theme>;
  /** True when the caller passed a name that was not in the shipped set. */
  readonly isFallback: boolean;
}

/**
 * Resolve a theme by name. Unknown names fall back to `light` and
 * return `isFallback: true` so the caller can log a single stderr
 * line (AC-7: "one stderr line is emitted"). The caller is
 * responsible for the log — `getTheme` is pure.
 */
export function getTheme(name: string): GetThemeResult {
  if (name === 'light' || name === 'dark' || name === 'blueprint') {
    return { theme: THEME_BY_NAME.get(name)!, isFallback: false };
  }
  return { theme: THEME_LIGHT, isFallback: true };
}
