/**
 * Vendored XML well-formedness parser.
 *
 * Tiny, dependency-free parser used by the SVG / HTML tests to assert
 * that the produced output is well-formed XML and to extract tag
 * attributes for geometry assertions. It is NOT a general XML
 * implementation: it handles the subset of XML that DiagramForge
 * emits (single root, well-formed tag matching, quoted attributes,
 * five predefined entities).
 *
 * Usage:
 *
 *   const doc = parseXmlString(svg);
 *   expect(doc.rootName).toBe('svg');
 *
 * Throws `Error` on any well-formedness violation (mismatched tag,
 * unterminated tag, etc.).
 */

export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: ReadonlyArray<XmlElement | string>;
}

export interface XmlDocument {
  readonly rootName: string;
  readonly root: XmlElement;
}

const ENTITY_MAP: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, body: string) => {
    if (body[0] === '#') {
      const cp =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return String.fromCodePoint(cp);
    }
    return ENTITY_MAP[body] ?? `&${body};`;
  });
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const name = m[1]!;
    const raw = m[3] ?? m[4] ?? '';
    out[name] = decodeEntities(raw);
  }
  return out;
}

export function parseXmlString(input: string): XmlDocument {
  // Strip XML declaration and processing instructions — we don't
  // need them, and skipping them keeps the main loop simple.
  const src = input
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const stack: XmlElement[] = [];
  let i = 0;
  let root: XmlElement | null = null;
  while (i < src.length) {
    if (src[i] === '<') {
      const close = src.indexOf('>', i);
      if (close < 0) throw new Error('unterminated tag');
      const tagBody = src.slice(i + 1, close).trim();
      i = close + 1;
      if (tagBody.startsWith('/')) {
        const name = tagBody.slice(1).trim();
        const top = stack.pop();
        if (!top) throw new Error(`unexpected closing </${name}>`);
        if (top.name !== name) {
          throw new Error(
            `mismatched tag: expected </${top.name}>, got </${name}>`,
          );
        }
      } else {
        const selfClose = tagBody.endsWith('/');
        const body = selfClose ? tagBody.slice(0, -1).trim() : tagBody;
        const m = /^([A-Za-z_][A-Za-z0-9_:.-]*)\s*([\s\S]*)$/.exec(body);
        if (!m) throw new Error(`invalid tag: <${tagBody}>`);
        const name = m[1]!;
        const attrs = parseAttrs(m[2] ?? '');
        const el: XmlElement = { name, attrs, children: [] };
        if (stack.length === 0) {
          if (root !== null) {
            throw new Error(`multiple roots: second root is <${name}>`);
          }
          root = el;
        } else {
          const parent = stack[stack.length - 1]!;
          (parent.children as Array<XmlElement | string>).push(el);
        }
        if (!selfClose) stack.push(el);
      }
    } else {
      const next = src.indexOf('<', i);
      const end = next < 0 ? src.length : next;
      const text = decodeEntities(src.slice(i, end));
      if (text.length > 0 && stack.length > 0) {
        const parent = stack[stack.length - 1]!;
        (parent.children as Array<XmlElement | string>).push(text);
      }
      i = end;
    }
  }
  if (stack.length > 0) {
    throw new Error(`unclosed tag: <${stack[stack.length - 1]!.name}>`);
  }
  if (!root) throw new Error('document has no root element');
  return { rootName: root.name, root };
}
