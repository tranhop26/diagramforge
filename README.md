# DiagramForge

> A zero-dependency, deterministic text-to-diagram MCP server — TypeScript, stdio transport, three diagram kinds, three themes, fully offline HTML preview, 209 tests.

---

## Quick start

```bash
npm ci                # clean install (uses package-lock.json)
npm run build        # tsc → dist/
npm test             # vitest run (209 tests, ~6 s)
npm start            # node dist/index.js  (stdio MCP server)
```

To try it end-to-end:

```bash
# Probe: spawn the server, list the four tool names, exit.
node scripts/probe-tools.js
# → ["list_diagram_types","make_diagram","parse_spec","render_diagram"]
```

To work on the source in dev mode (re-renders on save via tsx):

```bash
npm run dev          # tsx src/index.ts
```

---

## Claude Desktop MCP client config

The server is a standard MCP stdio server — drop the config below into your Claude Desktop `claude_desktop_config.json` and restart Claude Desktop. Two variants are supported:

### Variant 1 — production (built artifact)

```json
{
  "mcpServers": {
    "diagramforge": {
      "command": "node",
      "args": ["/absolute/path/to/diagramforge/dist/index.js"]
    }
  }
}
```

> Replace `/absolute/path/to/diagramforge` with the actual path on your machine.
> You must run `npm ci && npm run build` once before the first start so `dist/index.js` exists.

### Variant 2 — dev (TypeScript source via tsx)

```json
{
  "mcpServers": {
    "diagramforge": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/diagramforge/src/index.ts"]
    }
  }
}
```

> The dev variant avoids the build step — `tsx` compiles `src/index.ts` on the fly.
> Slower first call (~1 s warmup), no `dist/` directory required.

---

## Tools reference

DiagramForge exposes exactly four MCP tools. Every tool returns the `ToolOutput<T>` envelope (`{ ok: true, value: T }` or `{ ok: false, error: string }`) and never throws (AC-4).

### `list_diagram_types`

Returns the static catalog of supported diagram kinds and themes.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| (no fields) | — | — | Takes no input. |

**Example call** (JSON-RPC payload):

```json
{
  "method": "tools/call",
  "params": {
    "name": "list_diagram_types",
    "arguments": {}
  }
}
```

**Example output** (parsed envelope):

```json
{
  "ok": true,
  "value": {
    "types": [
      { "id": "flowchart", "label": "Flowchart", "description": "Directed graph of nodes and edges. Shapes: box, round, diamond, parallelogram." },
      { "id": "sequence",  "label": "Sequence",  "description": "Actors and time-ordered messages (sync, async, return). Lifelines and activation bars." },
      { "id": "erd",       "label": "ERD",       "description": "Entities with attributes and one/many relations rendered as a schema diagram." }
    ],
    "themes": [
      { "id": "light",     "label": "Light",     "isDark": false },
      { "id": "dark",      "label": "Dark",      "isDark": true  },
      { "id": "blueprint", "label": "Blueprint", "isDark": true  }
    ]
  }
}
```

### `parse_spec`

Parses a text spec into a `DiagramIR` and reports which route produced it (`dsl`, `llm`, or `heuristic`).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | `string` | yes | The text to parse (non-empty). |
| `type` | `"flowchart" \| "sequence" \| "erd"` | no | Hint; first-line `flowchart:` / `sequence:` / `erd:` prefix wins when present. |

**Example call**:

```json
{
  "method": "tools/call",
  "params": {
    "name": "parse_spec",
    "arguments": {
      "text": "flowchart: Order processing\nA: Start\nB [diamond]: Decide\nC: Pay\nA -> B\nB -> C: yes"
    }
  }
}
```

**Example output**:

```json
{
  "ok": true,
  "value": {
    "ir": {
      "kind": "flowchart",
      "title": "Order processing",
      "nodes": [
        { "id": "A", "label": "Start",  "shape": "box" },
        { "id": "B", "label": "Decide", "shape": "diamond" },
        { "id": "C", "label": "Pay",    "shape": "box" }
      ],
      "edges": [
        { "from": "A", "to": "B" },
        { "from": "B", "to": "C", "label": "yes" }
      ]
    },
    "via": "dsl"
  }
}
```

`via` is `"dsl"` when the input matches the line-based DSL grammar, `"llm"` when the LLM fallback produced the IR, and `"heuristic"` when the LLM was attempted but failed (or no key is set and the parser returned an empty IR).

### `render_diagram`

Pure function `(ir, type, theme) → { svg, mermaid, html }`. Two consecutive calls with identical input produce byte-equal `svg`. Unknown theme falls back to `light` and emits a single stderr line.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `ir` | `object` | yes | A `DiagramIR` (see `parse_spec` for shape). |
| `type` | `"flowchart" \| "sequence" \| "erd"` | yes | Must match `ir.kind`. |
| `theme` | `string` | yes | One of `light` / `dark` / `blueprint`; unknown names fall back to `light`. |

**Example call**:

```json
{
  "method": "tools/call",
  "params": {
    "name": "render_diagram",
    "arguments": {
      "ir": {
        "kind": "sequence",
        "title": "Login",
        "actors": [
          { "id": "U",  "label": "User"   },
          { "id": "S",  "label": "Server" },
          { "id": "DB", "label": "DB"     }
        ],
        "messages": [
          { "from": "U", "to": "S",  "label": "POST /login", "kind": "sync"   },
          { "from": "S", "to": "DB", "label": "query user",  "kind": "async"  },
          { "from": "DB","to": "S",  "label": "user record", "kind": "return" }
        ]
      },
      "type": "sequence",
      "theme": "dark"
    }
  }
}
```

**Example output** (truncated):

```json
{
  "ok": true,
  "value": {
    "svg": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"960\" ...",
    "mermaid": "sequenceDiagram\n  actor DB\n  actor S\n  actor U\n  DB --> S: user record\n  S ->> DB: query user\n  U -> S: POST /login\n",
    "html": "<!doctype html>\n<html lang=\"en\" data-theme=\"dark\">\n<head>..."
  }
}
```

### `make_diagram`

One-shot: orchestrates `parse_spec` → `render_diagram` and returns the same `{ svg, mermaid, html }` payload plus a `manifest` and a one-line `summary`.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `text` | `string` | yes | The text spec (non-empty). |
| `type` | `"flowchart" \| "sequence" \| "erd"` | no | Hint; prefix in `text` wins when present. |
| `theme` | `string` | no | One of `light` / `dark` / `blueprint`; unknown names fall back to `light`. |

**Example call**:

```json
{
  "method": "tools/call",
  "params": {
    "name": "make_diagram",
    "arguments": {
      "text": "flowchart: Order processing\nA: Start\nB [diamond]: Decide\nC: Pay\nA -> B\nB -> C: yes"
    }
  }
}
```

**Example output**:

```json
{
  "ok": true,
  "value": {
    "svg": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<svg ...",
    "mermaid": "flowchart TD\n  A[Start]\n  B{Decide}\n  C[Pay]\n  A --> B\n  B --> C : yes\n",
    "html": "<!doctype html>\n<html lang=\"en\" data-theme=\"light\">\n...",
    "manifest": { "type": "flowchart", "theme": "light", "nodeCount": 3, "edgeCount": 2 },
    "summary": "flowchart: Order processing — 3 nodes, 2 edges, theme=light"
  }
}
```

`manifest` shape:
- `type` — the resolved diagram kind (one of `flowchart` / `sequence` / `erd`).
- `theme` — the resolved theme (always one of the three shipped).
- `nodeCount` — `ir.nodes.length` for flowcharts, `ir.actors.length` for sequences, `ir.entities.length` for ERDs.
- `edgeCount` — `ir.edges.length` for flowcharts, `ir.messages.length` for sequences, `ir.relations.length` for ERDs.

`summary` is a single human-readable line. Unknown theme names add a `[theme: <unknown> → light]` marker.

---

## DSL syntax reference

The DSL is a line-based grammar (one statement per line, `#` introduces a comment, blank lines are skipped). The first non-empty line may be a type-and-title prefix; otherwise the parser uses the `type` hint and defaults to `flowchart`.

### Flowchart

```
flowchart: Order processing       # type prefix + title
A: Start                          # declare node, default label = id, shape = box
B [diamond]: Decide               # declare node with shape and label
C: Pay                            # declare node with label
A -> B                            # edge (no label)
B -> C: yes                       # edge with label
B --> C: yes                      # edge with label (alternate spelling)
B -- C: undirected                # undirected edge with label
```

Valid node shapes: `box`, `round`, `diamond`, `parallelogram`.

### Sequence

```
sequence: User login              # type prefix + title
actor U                           # declare actor, default label = id
actor S: Application server       # declare actor with label
actor DB                          # declare actor
U -> S: POST /login               # sync message
S ->> DB: query user              # async message
DB --> S: user record             # return message (dashed arrow)
```

Message kinds: `->` (sync, solid), `->>` (async, open arrow), `-->` (return, dashed).

### ERD

```
erd: Library schema               # type prefix + title
entity Book { id, title, isbn }   # entity with attributes
entity Author: Person name        # entity with explicit label
entity Publisher { id, name }     # another entity
Book ||--o{ Author: written by    # many-to-one relation
Book ||--o{ Publisher: by         # many-to-one relation
```

Cardinality markers:

| LHS / RHS | Cardinality | Renders as |
| --- | --- | --- |
| `\|\|` | exactly one | `1` |
| `o\|`  | exactly one | `1` |
| `}o`   | many        | `N` |
| `o{`   | many        | `N` |

---

## Diagram-type × theme gallery

Every (type, theme) combination renders cleanly. Click any thumbnail in your local clone to open the self-contained HTML preview.

| Type \ Theme | `light` | `dark` | `blueprint` |
| --- | --- | --- | --- |
| **flowchart** | [`examples/flowchart/flowchart.html`](examples/flowchart/flowchart.html) | regenerate via `make_diagram({ text, theme: 'dark' })` | regenerate via `make_diagram({ text, theme: 'blueprint' })` |
| **sequence**  | [`examples/sequence/sequence.html`](examples/sequence/sequence.html) | regenerate via `make_diagram({ text, theme: 'dark' })` | regenerate via `make_diagram({ text, theme: 'blueprint' })` |
| **erd**       | [`examples/erd/erd.html`](examples/erd/erd.html) | regenerate via `make_diagram({ text, theme: 'dark' })` | regenerate via `make_diagram({ text, theme: 'blueprint' })` |
| **architecture** (self-dogfood) | [`examples/architecture/architecture.html`](examples/architecture/architecture.html) | — | — |

The committed `light` variants are the canonical artifacts. To regenerate any (type, theme) combo:

```bash
npm run build:examples   # regenerates all 12 light-theme artifacts
```

The HTML preview is a single self-contained file — no `https?://`, no external `<link>` / `<script>` / font, no CDN. Vanilla-JS pan (mousedown / move / up) and zoom (wheel) operate on a `<g id="zoom">` wrapper; the theme `<select>` flips `document.documentElement.dataset.theme` between the three shipped themes.

---

## Project layout

```
.
├── src/
│   ├── index.ts                  # stdio entry point
│   ├── server.ts                 # createServer(): wires the 4 MCP tools
│   ├── types.ts                  # DiagramIR, RenderResult, Manifest, …
│   ├── llm.ts                    # OpenAI wrapper (only used when OPENAI_API_KEY is set)
│   ├── parsers/
│   │   ├── dsl.ts                # line-based DSL parser
│   │   └── prose.ts              # router: DSL → LLM → DSL fallback
│   ├── layout/
│   │   ├── constants.ts          # every layout constant in one place
│   │   ├── types.ts              # FlowchartGeometry, SequenceGeometry, ErdGeometry
│   │   ├── flowchart.ts          # pure: FlowchartIR → FlowchartGeometry
│   │   ├── sequence.ts           # pure: SequenceIR  → SequenceGeometry
│   │   └── erd.ts                # pure: ErdIR       → ErdGeometry
│   ├── render/
│   │   ├── _escape.ts            # XML/Mermaid/HTML escapers
│   │   ├── svg.ts                # pure: Geometry → SVG string
│   │   ├── mermaid.ts            # pure: IR → Mermaid source
│   │   └── html.ts               # self-contained HTML wrapper (pan/zoom/theme)
│   ├── themes/
│   │   └── presets.ts            # 3 frozen Theme objects + getTheme()
│   └── tools/
│       ├── _util.ts              # tryOk, formatZodIssues
│       ├── list-diagram-types.ts # → list_diagram_types
│       ├── parse-spec.ts         # → parse_spec
│       ├── render-diagram.ts     # → render_diagram
│       └── make-diagram.ts       # → make_diagram (orchestrator)
├── tests/                        # vitest suite (209 tests, mirrors src/)
│   ├── _helpers.ts               # StdioClient (JSON-RPC driver)
│   ├── util/xml.ts               # vendored XML well-formedness parser
│   ├── parse-spec.test.ts        # 25 tests (DSL + LLM fallback)
│   ├── render-diagram.test.ts    # 10 tests (determinism, unknown theme)
│   ├── render-svg.test.ts        # 11 tests (well-formedness, non-overlap, ±1.5 px)
│   ├── render-html.test.ts       # 18 tests (offline, pan/zoom, theme toggle)
│   ├── render-mermaid.test.ts    # 18 tests (header, id regex, colon, quotes)
│   ├── make-diagram.test.ts      # 49 tests (orchestrator, manifest, summary)
│   ├── layout.test.ts            # 48 tests (determinism + structure for all 3 layouts)
│   ├── server.test.ts            # 1 test (stdio MCP server smoke)
│   ├── tools.test.ts             # 22 tests (error envelope, list_diagram_types)
│   └── themes.test.ts            # 7 tests (theme presets)
├── examples/                     # 12 committed artifacts (4 × 3)
│   ├── flowchart/                # Order processing
│   ├── sequence/                 # User login
│   ├── erd/                      # Library schema
│   └── architecture/             # self-dogfood: DiagramForge pipeline
├── scripts/
│   ├── probe-tools.js            # stdio smoke (spawns dist/index.js)
│   ├── build-examples.ts         # regenerates examples/ deterministically
│   └── check-examples.js         # asserts 12 files + SVG well-formedness
├── docs/
│   ├── self-score.md             # 6-category rubric scorecard
│   └── plans/                    # working plan
├── .github/
│   └── workflows/ci.yml          # CI: Node 18 + Node 20 on ubuntu-latest
├── package.json                  # scripts: build, test, dev, start, build:examples, check:examples, audit
├── tsconfig.json                 # strict mode, ESM, target ES2022
├── vitest.config.ts              # testTimeout 30 s (stdio safety margin)
└── README.md                     # you are here
```

---

## Layout-engine data flow

The renderer is a four-stage pipeline with **pure functions at every stage**, which is what makes `(text, type, theme) → svg` byte-deterministic and what makes every stage unit-testable in isolation.

```
text ──► parse_spec ──► DiagramIR ──► layout*() ──► Geometry ──► render*() ──► {svg, mermaid, html}
           (parsers/)    (types.ts)  (layout/)        (layout/types.ts)   (render/)        (tools/make-diagram.ts)
```

1. **`parse_spec`** — the line-based DSL parser produces a tagged `DiagramIR` (`flowchart` | `sequence` | `erd`). Free-form prose falls through to the LLM route (when `OPENAI_API_KEY` is set) or returns an empty IR with `via: 'heuristic'`. The parser is pure: same input → same IR, no I/O, no env reads in the hot path.
2. **`layout*()`** — three pure functions (`layoutFlowchart`, `layoutSequence`, `layoutErd`) turn the IR into a `Geometry` (axis-aligned boxes + routed edges). Flowcharts get a longest-path rank layering with id-sorted rows; sequences get evenly-spaced actor columns with stacked messages; ERDs get a `ceil(sqrt(n))` grid with auto-promoted relation endpoints. All coordinates are integers in SVG user units, derived only from constants in `layout/constants.ts` — no `Math.random`, no `Date`, no env reads.
3. **`renderSvg` / `renderMermaid` / `renderHtml`** — three pure renderers. `renderSvg` emits a single `<svg xmlns="http://www.w3.org/2000/svg">` root with explicit XML escaping, non-overlapping nodes, and edges that land on the target node's border within ±1.5 px. `renderMermaid` emits the syntax-only Mermaid source (no Mermaid runtime is bundled). `renderHtml` wraps the SVG in a self-contained HTML document with inline pan/zoom JS and a theme `<select>`.
4. **`make_diagram`** — the orchestrator wires stages 1–3 together, computes the `manifest` (counts the IR's nodes/edges), and emits a one-line `summary` for human display.

Because every stage is pure and reads no clock, no random source, and no env (in the hot path), two consecutive calls with identical input produce byte-identical output. This is the property AC-7 promises of `render_diagram` and which `make_diagram` inherits. The 48 layout-determinism tests in `tests/layout.test.ts` verify the upstream half of this pipeline directly.

---

## Environment variables

All variables are **optional**. The server runs offline with no env set; the LLM fallback only kicks in when at least `OPENAI_API_KEY` is present.

| Variable | Required? | Default | Purpose |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | optional | (unset) | Enables the LLM route for free-form prose in `parse_spec`. When unset, prose falls through to the DSL parser (which silently returns an empty IR for non-DSL text). |
| `OPENAI_BASE_URL` | optional | `https://api.openai.com/v1` | Override the OpenAI base URL (useful for proxies, local stubs, or Azure-compatible endpoints). |
| `OPENAI_MODEL` | optional | `gpt-4o-mini` | Model name passed to OpenAI's structured-output endpoint. |

When `OPENAI_API_KEY` is set and the LLM call fails (network, auth, schema mismatch), `parse_spec` logs exactly one `[parse_spec] LLM failed, falling back to DSL parser` line to stderr and returns the DSL parser's output with `via: 'heuristic'`.

---

## Self-score

DiagramForge's 6-category rubric scorecard is at **[`docs/self-score.md`](docs/self-score.md)** — each category is scored 0–10 with a one-line justification and a weighted total.

---

## License

MIT — see `LICENSE`.
