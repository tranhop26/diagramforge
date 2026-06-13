/**
 * HTML wrapper.
 *
 * Pure function: `(svg, manifest, title, allThemes) → HTML string`.
 *
 * Produces a single self-contained document with:
 *   - inline `<style>` defining CSS variables for every shipped theme
 *   - a theme `<select>` that flips `document.documentElement.dataset.theme`
 *   - inline `<script>` providing vanilla-JS pan (mousedown/move/up)
 *     and zoom (wheel) on a wrapping `<g id="zoom">` element inside
 *     the inline SVG
 *   - the supplied `svg` string embedded verbatim
 *
 * No remote URLs. No external `<link>`, `<script>`, font, or CDN
 * references. No `https?://` substring anywhere in the document.
 */
import type { Manifest, Theme, ThemeName } from '../types.js';

export interface RenderHtmlInput {
  readonly svg: string;
  readonly manifest: Manifest;
  readonly title: string;
  readonly allThemes: ReadonlyArray<Readonly<Theme>>;
}

const THEME_LABEL: Readonly<Record<ThemeName, string>> = {
  light: 'Light',
  dark: 'Dark',
  blueprint: 'Blueprint',
};

function themeCssBlock(theme: Readonly<Theme>): string {
  return `:root[data-theme="${theme.name}"] { --bg: ${theme.background}; --fg: ${theme.foreground}; --accent: ${theme.accent}; --muted: ${theme.muted}; }`;
}

function themeOptions(themes: ReadonlyArray<Readonly<Theme>>, current: ThemeName): string {
  return themes
    .map(
      (t) =>
        `<option value="${t.name}"${t.name === current ? ' selected' : ''}>${THEME_LABEL[t.name]}</option>`,
    )
    .join('');
}

const SCRIPT_BLOCK = `<script>
(function () {
  var sel = document.getElementById('theme');
  if (sel) {
    sel.addEventListener('change', function (e) {
      var v = e && e.target && e.target.value;
      if (v) document.documentElement.setAttribute('data-theme', v);
    });
  }
  var svg = document.querySelector('svg');
  var zoom = document.getElementById('zoom');
  if (svg && zoom) {
    var viewBox = svg.getAttribute('viewBox');
    var vb = viewBox ? viewBox.split(/\\s+/).map(Number) : [0, 0, 960, 640];
    var x = vb[0] || 0, y = vb[1] || 0, w = vb[2] || 960, h = vb[3] || 640;
    svg.setAttribute('viewBox', x + ' ' + y + ' ' + w + ' ' + h);
    svg.style.cursor = 'grab';
    var tx = 0, ty = 0, scale = 1, dragging = false, lastX = 0, lastY = 0;
    function apply() {
      zoom.setAttribute('transform', 'translate(' + tx + ' ' + ty + ') scale(' + scale + ')');
    }
    svg.addEventListener('mousedown', function (e) {
      dragging = true; lastX = e.clientX; lastY = e.clientY;
      svg.style.cursor = 'grabbing';
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      tx += (e.clientX - lastX); ty += (e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return; dragging = false; svg.style.cursor = 'grab';
    });
    svg.addEventListener('wheel', function (e) {
      e.preventDefault();
      var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      scale *= factor;
      if (scale < 0.1) scale = 0.1;
      if (scale > 8) scale = 8;
      apply();
    }, { passive: false });
  }
})();
</script>`;

export function renderHtml(input: RenderHtmlInput): string {
  const { svg, manifest, title, allThemes } = input;
  const css = allThemes.map(themeCssBlock).join('\n');
  const options = themeOptions(allThemes, manifest.theme);
  // Embed the SVG inline. HTML5 parsers auto-namespace inline SVG,
  // so we strip the standalone `xmlns` and the XML declaration to
  // guarantee the rendered document contains no `https?://`
  // substring and no orphan `<?xml ?>` processing instruction.
  const embeddedSvg = svg
    .replace('<?xml version="1.0" encoding="UTF-8"?>', '')
    .replace(' xmlns="http://www.w3.org/2000/svg"', '')
    .replace('<svg ', '<svg id="zoom-host" ');
  const body = `<!doctype html>
<html lang="en" data-theme="${manifest.theme}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font-family: Inter, system-ui, sans-serif; }
header { display: flex; align-items: center; gap: 1rem; padding: 12px 20px; border-bottom: 1px solid var(--muted); }
header h1 { margin: 0; font-size: 14px; font-weight: 600; }
header .meta { font-size: 12px; color: var(--muted); }
header select { background: var(--bg); color: var(--fg); border: 1px solid var(--muted); padding: 4px 8px; border-radius: 4px; }
main { padding: 0; }
${css}
</style>
</head>
<body>
<header>
<h1>${escapeHtml(title)}</h1>
<span class="meta">${escapeHtml(manifest.type)} · ${escapeHtml(String(manifest.nodeCount))} nodes · ${escapeHtml(String(manifest.edgeCount))} edges · theme=${escapeHtml(manifest.theme)}</span>
<select id="theme" aria-label="Theme">${options}</select>
</header>
<main>
${embeddedSvg}
</main>
${SCRIPT_BLOCK}
</body>
</html>
`;
  return body;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
