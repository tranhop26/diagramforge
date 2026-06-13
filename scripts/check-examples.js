#!/usr/bin/env node
/**
 * `scripts/check-examples.js` — asserts the 12 example files exist
 * and each SVG is well-formed XML.
 *
 *   1. Walks the 4 × 3 grid:
 *        examples/{flowchart,sequence,erd,architecture}/{subdir}.{svg,html,mermaid}
 *      and asserts every file is present, non-empty, and readable.
 *   2. Parses every SVG with a tiny vendored XML well-formedness
 *      parser and asserts:
 *        - exactly one root element
 *        - the root is named `svg`
 *        - the root carries the SVG namespace
 *        - all tags are balanced (no unclosed / mismatched tags)
 *
 * Exits 0 on success, 1 on the first failure. No external deps.
 *
 * Usage: `npm run check:examples`  (alias for `node scripts/check-examples.js`)
 */
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES_ROOT = path.resolve(__dirname, '..', 'examples');

const SUBDIRS = ['flowchart', 'sequence', 'erd', 'architecture'];
const EXTENSIONS = ['svg', 'html', 'mermaid'];

// ---------------------------------------------------------------------------
// Vendored XML well-formedness parser.
//
// Mirrors `tests/util/xml.ts` but in plain JavaScript so this script
// can be invoked with `node` (not `tsx`). The parser handles the
// subset of XML that DiagramForge emits: single root, well-formed
// tag matching, quoted attributes, and the five predefined entities.
// ---------------------------------------------------------------------------

const ENTITY_MAP = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_m, body) => {
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

function parseAttrs(s) {
  const out = {};
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1];
    const raw = m[3] ?? m[4] ?? '';
    out[name] = decodeEntities(raw);
  }
  return out;
}

function parseXmlString(input) {
  const src = input
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  let i = 0;
  let root = null;
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
        const name = m[1];
        const attrs = parseAttrs(m[2] ?? '');
        const el = { name, attrs, children: [] };
        if (stack.length === 0) {
          if (root !== null) {
            throw new Error(`multiple roots: second root is <${name}>`);
          }
          root = el;
        } else {
          const parent = stack[stack.length - 1];
          parent.children.push(el);
        }
        if (!selfClose) stack.push(el);
      }
    } else {
      const next = src.indexOf('<', i);
      const end = next < 0 ? src.length : next;
      i = end;
    }
  }
  if (stack.length > 0) {
    throw new Error(`unclosed tag: <${stack[stack.length - 1].name}>`);
  }
  if (!root) throw new Error('document has no root element');
  return { rootName: root.name, root };
}

// ---------------------------------------------------------------------------
// File-walk + per-file assertion.
// ---------------------------------------------------------------------------

function fail(msg) {
  process.stderr.write(`[check-examples] FAIL: ${msg}\n`);
  process.exit(1);
}

function checkFile(absPath, ext) {
  let buf;
  try {
    buf = readFileSync(absPath, 'utf8');
  } catch (err) {
    fail(`cannot read ${absPath}: ${err.message}`);
  }
  const stat = statSync(absPath);
  if (stat.size === 0) {
    fail(`${absPath} is empty`);
  }
  if (ext === 'svg') {
    let doc;
    try {
      doc = parseXmlString(buf);
    } catch (err) {
      fail(`${absPath} is not well-formed XML: ${err.message}`);
    }
    if (doc.rootName !== 'svg') {
      fail(
        `${absPath} root is <${doc.rootName}>, expected <svg>`,
      );
    }
    if (
      doc.root.attrs['xmlns'] !== 'http://www.w3.org/2000/svg'
    ) {
      fail(
        `${absPath} root is missing xmlns="http://www.w3.org/2000/svg"`,
      );
    }
  }
}

function main() {
  let checked = 0;
  for (const sub of SUBDIRS) {
    const dir = path.join(EXAMPLES_ROOT, sub);
    for (const ext of EXTENSIONS) {
      const abs = path.join(dir, `${sub}.${ext}`);
      checkFile(abs, ext);
      checked++;
    }
  }
  process.stdout.write(
    `[check-examples] OK: ${checked} files present, all SVGs well-formed\n`,
  );
  process.exit(0);
}

main();
