/**
 * DiagramForge core type definitions.
 *
 * Every IR shape is a tagged union (`kind`) so consumers can narrow with a
 * single discriminant check. Types are intentionally narrow at the leaves
 * (literal unions for shapes, cardinalities, message kinds) so the DSL
 * parser can reject invalid input at the boundary.
 */

/** The three diagram kinds DiagramForge renders. */
export type DiagramType = 'flowchart' | 'sequence' | 'erd';

/** The three shipped themes. */
export type ThemeName = 'light' | 'dark' | 'blueprint';

/** A theme is a frozen color palette keyed by role. */
export interface Theme {
  readonly name: ThemeName;
  readonly background: string;
  readonly foreground: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly edge: string;
  readonly nodeFill: string;
  readonly nodeStroke: string;
}

/** Standard envelope returned by every MCP tool handler. */
export type ToolOutput<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Flowchart-specific node shapes supported by the renderer. */
export type FlowchartShape = 'box' | 'round' | 'diamond' | 'parallelogram';

export interface FlowchartNode {
  readonly id: string;
  readonly label: string;
  readonly shape: FlowchartShape;
}

export interface FlowchartEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface FlowchartIR {
  readonly kind: 'flowchart';
  readonly title: string;
  readonly nodes: readonly FlowchartNode[];
  readonly edges: readonly FlowchartEdge[];
}

/** Sequence-diagram message kinds. `return` draws a dashed arrow. */
export type SequenceMessageKind = 'sync' | 'return' | 'async';

export interface SequenceActor {
  readonly id: string;
  readonly label: string;
}

export interface SequenceMessage {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly kind: SequenceMessageKind;
}

export interface SequenceIR {
  readonly kind: 'sequence';
  readonly title: string;
  readonly actors: readonly SequenceActor[];
  readonly messages: readonly SequenceMessage[];
}

/** ERD cardinality sides. `1` = one, `*` = many. */
export type ErdCardinality = '1' | '*';

export interface ErdEntity {
  readonly id: string;
  readonly label: string;
  readonly attributes: readonly string[];
}

export interface ErdRelation {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly fromCard: ErdCardinality;
  readonly toCard: ErdCardinality;
}

export interface ErdIR {
  readonly kind: 'erd';
  readonly title: string;
  readonly entities: readonly ErdEntity[];
  readonly relations: readonly ErdRelation[];
}

/** Discriminated union over the three diagram kinds. */
export type DiagramIR = FlowchartIR | SequenceIR | ErdIR;

/** Manifest returned alongside every render in `make_diagram`. */
export interface Manifest {
  readonly type: DiagramType;
  readonly theme: ThemeName;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/** Payload shape returned by `render_diagram` and `make_diagram`. */
export interface RenderResult {
  readonly svg: string;
  readonly mermaid: string;
  readonly html: string;
}

/** Top-level payload returned by `make_diagram`. */
export interface MakeDiagramResult extends RenderResult {
  readonly manifest: Manifest;
  readonly summary: string;
}

/** A diagram-type descriptor returned by `list_diagram_types`. */
export interface DiagramTypeInfo {
  readonly id: DiagramType;
  readonly label: string;
  readonly description: string;
}

/** A theme descriptor returned by `list_diagram_types`. */
export interface ThemeInfo {
  readonly id: ThemeName;
  readonly label: string;
  readonly isDark: boolean;
}

/** Payload returned by `list_diagram_types`. */
export interface ListDiagramTypesResult {
  readonly types: readonly DiagramTypeInfo[];
  readonly themes: readonly ThemeInfo[];
}
