/**
 * AC-7: theme presets.
 *
 * Three shipped themes, frozen objects, deterministic resolution,
 * `light` fallback for unknown names.
 */
import { describe, it, expect } from 'vitest';
import {
  getTheme,
  THEME_LIGHT,
  THEME_DARK,
  THEME_BLUEPRINT,
  ALL_THEMES,
} from '../src/themes/presets.js';

describe('AC-7: theme presets', () => {
  it('ships three distinct themes', () => {
    expect(ALL_THEMES.length).toBe(3);
    const names = new Set(ALL_THEMES.map((t) => t.name));
    expect(names.has('light')).toBe(true);
    expect(names.has('dark')).toBe(true);
    expect(names.has('blueprint')).toBe(true);
  });

  it('every theme has the required color roles', () => {
    for (const t of ALL_THEMES) {
      for (const key of [
        'background',
        'foreground',
        'text',
        'muted',
        'accent',
        'edge',
        'nodeFill',
        'nodeStroke',
      ] as const) {
        expect(typeof t[key]).toBe('string');
        expect(t[key].length).toBeGreaterThan(0);
      }
    }
  });

  it('themes are frozen objects (immutability)', () => {
    expect(Object.isFrozen(THEME_LIGHT)).toBe(true);
    expect(Object.isFrozen(THEME_DARK)).toBe(true);
    expect(Object.isFrozen(THEME_BLUEPRINT)).toBe(true);
  });

  it('two calls to getTheme(light) return the same reference (determinism)', () => {
    const a = getTheme('light');
    const b = getTheme('light');
    expect(a.theme).toBe(b.theme);
    expect(a.isFallback).toBe(false);
  });

  it('getTheme(dark) returns the dark theme reference', () => {
    const r = getTheme('dark');
    expect(r.theme).toBe(THEME_DARK);
    expect(r.isFallback).toBe(false);
  });

  it('getTheme(blueprint) returns the blueprint theme reference', () => {
    const r = getTheme('blueprint');
    expect(r.theme).toBe(THEME_BLUEPRINT);
    expect(r.isFallback).toBe(false);
  });

  it('unknown theme falls back to light and reports isFallback=true', () => {
    const r = getTheme('neon');
    expect(r.theme).toBe(THEME_LIGHT);
    expect(r.isFallback).toBe(true);
    const r2 = getTheme('');
    expect(r2.theme).toBe(THEME_LIGHT);
    expect(r2.isFallback).toBe(true);
  });
});
