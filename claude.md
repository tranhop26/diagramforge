# Project Standards

DiagramForge is a TypeScript MCP stdio server. These notes are the source of truth for Claude when working on the project.

## Tech stack (fixed)
- **Runtime**: Node.js >= 18 (developed on 20/24). ES modules only.
- **Language**: TypeScript `strict: true`, `module: Node16`, `moduleResolution: Node16`, `target: ES2022`.
- **Runtime deps (pinned)**: `@modelcontextprotocol/sdk`, `zod`, `openai`.
- **Dev deps (pinned)**: `typescript`, `vitest`, `@types/node`, `tsx`.
- **Test runner**: `vitest` (`tests/` mirrors `src/`, `examples/` is excluded).
- **Transport**: stdio only. `stdout` is the MCP channel. **All logs and errors go to stderr.**
- **Determinism**: no `Date`, `Math.random`, or env-derived randomness in `src/parsers/dsl.ts`, `src/layout/`, or `src/render/`.

## Build & test
- `npm ci` → `npm run build` → `npm run typecheck` → `npm test` → `npm audit` must all be green.
- `bin` entry: `./dist/index.js` (with `#!/usr/bin/env node` shebang in `src/index.ts`).
- Use `tsx` for dev, run built `dist/` for stdio smoke tests.
- ESM/Node16 requires `.js` extensions on all relative imports in source files.

## Code conventions
- Tool handlers never throw; they return `{ ok: false, error: <string> }` on any failure.
- Pure functions take `(ir, type, theme)` and are byte-deterministic.
- XML-escape all user text before emitting SVG (`&`, `<`, `>`, `"`, `'`).
- HTML output must be fully offline (no remote `script`/`link`/font/CDN).
- Mermaid output is validated by a syntactic sanity check, not a real Mermaid runtime.

## File layout (authoritative)
See `docs/plans/...md` Implementation Notes §1.

## Workflow
- One AC at a time. Do not silently expand scope.
- After each AC, write a concise summary of what changed, what was verified, and the AC status.
- Commit with a descriptive message; do not commit `node_modules/`, `dist/`, or scratch artifacts.
