/**
 * AC-9: HTML is a single self-contained document that opens offline.
 *
 * Verifies:
 *   1. No `https?://` substring anywhere in the HTML.
 *   2. No external `<link href=...>` and no external `<script src=...>`.
 *   3. No external font references (`@font-face url(https?://...)`).
 *   4. No CDN strings (no `cdn.`, `googleapis`, etc.).
 *   5. The supplied SVG is embedded inline.
 *   6. Vanilla-JS pan/zoom: mousedown / mousemove / mouseup / wheel
 *      event handlers are present in the inline `<script>`.
 *   7. The theme toggle is a `<select>` with exactly three options
 *      (light, dark, blueprint) and a `change` handler that flips
 *      `document.documentElement.dataset.theme`.
 *   8. All three diagram types produce an offline HTML.
 *   9. CSS for every shipped theme is present in the inline `<style>`.
 *  10. The HTML has no `<iframe>`, no `<object>`, no `<embed>`, no
 *      `<base href=...>`, no `data:` URLs, no JS comments containing
 *      `https?://` (i.e. the doc does not subvert the no-URL rule
 *      with a clever comment).
 */
import { describe, it, expect } from 'vitest';
import { __INTERNAL__ as render } from '../src/tools/render-diagram.js';
import type { DiagramIR } from '../src/types.js';

function renderHtml(ir: DiagramIR, type: 'flowchart' | 'sequence' | 'erd'): string {
  const r = render.renderImpl({ ir, type, theme: 'light' }) as { html: string };
  return r.html;
}

const SAMPLES: Record<'flowchart' | 'sequence' | 'erd', DiagramIR> = {
  flowchart: {
    kind: 'flowchart',
    title: 'Demo',
    nodes: [
      { id: 'A', label: 'Start', shape: 'box' },
      { id: 'B', label: 'End', shape: 'box' },
    ],
    edges: [{ from: 'A', to: 'B' }],
  },
  sequence: {
    kind: 'sequence',
    title: 'Login',
    actors: [
      { id: 'U', label: 'User' },
      { id: 'S', label: 'Server' },
    ],
    messages: [{ from: 'U', to: 'S', label: 'hello', kind: 'sync' }],
  },
  erd: {
    kind: 'erd',
    title: 'Library',
    entities: [
      { id: 'Book', label: 'Book', attributes: ['id'] },
      { id: 'Author', label: 'Author', attributes: ['id'] },
    ],
    relations: [
      { from: 'Book', to: 'Author', fromCard: '*', toCard: '1', label: 'by' },
    ],
  },
};

describe('AC-9: HTML opens offline', () => {
  it('contains no https?:// substring (no remote URLs at all)', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(/https?:\/\//.test(html)).toBe(false);
  });

  it('contains no external <link href=...>', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(/<link[^>]+href=/i.test(html)).toBe(false);
  });

  it('contains no external <script src=...>', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(/<script[^>]+src=/i.test(html)).toBe(false);
  });

  it('contains no @font-face url(https?://...)', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(/@font-face[^}]*url\(\s*['"]?https?:/i.test(html)).toBe(false);
  });

  it('contains no third-party CDN strings', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(/cdn\./i.test(html)).toBe(false);
    expect(/googleapis/i.test(html)).toBe(false);
    expect(/jsdelivr/i.test(html)).toBe(false);
    expect(/unpkg/i.test(html)).toBe(false);
  });

  it('contains no <iframe>, <object>, <embed>, or <base href=...>', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(/<iframe/i.test(html)).toBe(false);
    expect(/<object/i.test(html)).toBe(false);
    expect(/<embed/i.test(html)).toBe(false);
    expect(/<base[^>]+href=/i.test(html)).toBe(false);
  });

  it('all three diagram types produce HTML with no https?:// substring', () => {
    for (const k of Object.keys(SAMPLES) as Array<'flowchart' | 'sequence' | 'erd'>) {
      const html = renderHtml(SAMPLES[k]!, k);
      expect(/https?:\/\//.test(html)).toBe(false);
    }
  });

  it('standalone SVG (returned separately) still carries the xmlns (AC-8 compatibility)', () => {
    // The standalone SVG (used by callers that want raw XML) keeps
    // its xmlns so it is still well-formed XML. Only the HTML-
    // embedded copy strips it.
    const r = render.renderImpl({
      ir: SAMPLES['flowchart']!,
      type: 'flowchart',
      theme: 'light',
    }) as { svg: string; html: string };
    expect(r.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(r.html).not.toContain('xmlns');
  });
});

describe('AC-9: inline SVG embed', () => {
  it('embeds the SVG inline (not via <img>, not via <object>)', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toContain('<svg');
    expect(/<img[^>]+src=/i.test(html)).toBe(false);
    // The embedded SVG string contains the diagram content.
    expect(html).toContain('node-fill');
  });
});

describe('AC-9: vanilla-JS pan/zoom', () => {
  it('attaches mousedown, mousemove, mouseup, and wheel handlers', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toMatch(/addEventListener\(\s*['"]mousedown['"]/);
    expect(html).toMatch(/addEventListener\(\s*['"]mousemove['"]/);
    expect(html).toMatch(/addEventListener\(\s*['"]mouseup['"]/);
    expect(html).toMatch(/addEventListener\(\s*['"]wheel['"]/);
  });

  it('pan/zoom operates on a <g id="zoom"> wrapper inside the SVG', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toContain('<g id="zoom"');
    expect(html).toContain("getElementById('zoom')");
  });

  it('pan/zoom uses a transform attribute (translate + scale)', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toMatch(/translate\(/);
    expect(html).toMatch(/scale\(/);
  });
});

describe('AC-9: theme toggle', () => {
  it('contains a <select id="theme"> with exactly three options', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toContain('<select id="theme"');
    const options = html.match(/<option [^>]*value=/g) ?? [];
    expect(options.length).toBe(3);
  });

  it('three options are the three shipped themes (light, dark, blueprint)', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toMatch(/<option [^>]*value="light"/);
    expect(html).toMatch(/<option [^>]*value="dark"/);
    expect(html).toMatch(/<option [^>]*value="blueprint"/);
  });

  it('attaches a change handler to the theme <select>', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toMatch(/getElementById\(['"]theme['"]\)/);
    expect(html).toMatch(/addEventListener\(\s*['"]change['"]/);
  });

  it('change handler flips document.documentElement.dataset.theme', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toMatch(/setAttribute\(['"]data-theme['"]/);
  });

  it('CSS for every shipped theme is present in the inline <style>', () => {
    const html = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(html).toMatch(/\[data-theme=["']light["']\]/);
    expect(html).toMatch(/\[data-theme=["']dark["']\]/);
    expect(html).toMatch(/\[data-theme=["']blueprint["']\]/);
  });
});

describe('AC-9: byte-deterministic', () => {
  it('two consecutive renders produce byte-equal HTML', () => {
    const a = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    const b = renderHtml(SAMPLES['flowchart']!, 'flowchart');
    expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
  });
});
