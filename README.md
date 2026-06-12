# DiagramForge

> A zero-dependency, deterministic text-to-diagram MCP server. TypeScript, stdio, three diagram types, three themes, fully offline HTML preview.

## Quick start

```bash
npm ci
npm run build
npm test
```

See `docs/plans/<plan-id>.md` for the full spec and rubric, and `docs/self-score.md` for the rubric scoring.

## Project status

| AC | Area | Status |
| --- | --- | --- |
| AC-1 | `npm install` / `npm audit` clean | in progress |
| AC-2 | `tsconfig` strict + build/typecheck | pending |
| AC-3 | stdio server, 4 tools | pending |
| AC-4 | tool error envelope | pending |
| AC-5 | `list_diagram_types` ≥ 3 types / ≥ 3 themes | pending |
| AC-6 | DSL parser + LLM fallback | pending |
| AC-7 | `render_diagram` pure | pending |
| AC-8 | SVG well-formed | pending |
| AC-9 | HTML offline | pending |
| AC-10 | Mermaid format | pending |
| AC-11 | `make_diagram` orchestrator | pending |
| AC-12 | full vitest suite | pending |
| AC-13 | CI workflow | pending |
| AC-14 | examples/ | pending |
| AC-15 | README rubric | pending |

## Layout

- `src/` — TypeScript source (tools, parsers, layout, render, themes, llm, types).
- `tests/` — vitest tests, mirrors `src/`.
- `examples/` — generated artifacts (`*.svg`, `*.html`, `*.mermaid`).
- `scripts/` — `probe-tools.js` (stdio smoke), `build-examples.ts`, `check-examples.js`.
- `docs/` — plan, self-score, design notes.
- `.github/workflows/ci.yml` — CI (Node 18 + Node 20).
