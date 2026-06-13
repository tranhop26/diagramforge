/**
 * XML escape utility.
 *
 * Every text node and every attribute value the renderer emits into
 * SVG or Mermaid output must go through `escapeXml`. The five
 * entities map directly to the standard XML predefined entities.
 */
const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&apos;'],
];

export function escapeXml(s: string): string {
  let out = s;
  for (const [re, rep] of REPLACEMENTS) {
    if (re.test(out)) {
      out = out.replace(re, rep);
    }
  }
  return out;
}
