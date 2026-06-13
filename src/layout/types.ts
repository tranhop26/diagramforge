/**
 * Geometry types shared by the three layout modules and consumed by
 * the SVG renderer.
 *
 * Layout outputs are pure data: arrays of node geometries, arrays of
 * edge geometries, and an overall canvas size. The renderer walks
 * these and emits SVG; it does not run any layout itself. This
 * separation is what makes the renderer testable independently of
 * layout and what makes `(ir, type, theme) → svg` byte-deterministic
 * (AC-7).
 */
import type { FlowchartShape, SequenceMessageKind } from '../types.js';

/** Axis-aligned bounding box, in SVG user units. */
export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A laid-out flowchart node. */
export interface FlowchartNodeGeometry extends BoundingBox {
  readonly id: string;
  readonly label: string;
  readonly shape: FlowchartShape;
}

/** A flowchart edge routed as an orthogonal polyline. */
export interface FlowchartEdgeGeometry {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly points: ReadonlyArray<{ readonly x: number; readonly y: number }>;
  readonly kind: 'flow';
}

export interface FlowchartGeometry {
  readonly kind: 'flowchart';
  readonly width: number;
  readonly height: number;
  readonly nodes: ReadonlyArray<FlowchartNodeGeometry>;
  readonly edges: ReadonlyArray<FlowchartEdgeGeometry>;
  readonly title: string;
}

/** A laid-out sequence actor. */
export interface SequenceActorGeometry {
  readonly id: string;
  readonly label: string;
  readonly x: number; // center x
  readonly y: number; // top y of the actor header
  readonly w: number;
  readonly h: number;
  readonly lifelineY1: number;
  readonly lifelineY2: number;
}

/** A sequence message rendered as a horizontal arrow with a label. */
export interface SequenceMessageGeometry {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly kind: SequenceMessageKind;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface SequenceGeometry {
  readonly kind: 'sequence';
  readonly width: number;
  readonly height: number;
  readonly actors: ReadonlyArray<SequenceActorGeometry>;
  readonly messages: ReadonlyArray<SequenceMessageGeometry>;
  readonly title: string;
}

/** A single row in an ERD table. */
export interface ErdRowGeometry {
  readonly label: string;
  readonly y: number;
  readonly h: number;
}

/** A laid-out ERD entity (table). */
export interface ErdEntityGeometry extends BoundingBox {
  readonly id: string;
  readonly label: string;
  readonly rows: ReadonlyArray<ErdRowGeometry>;
}

/** A relation line between two ERD entities. */
export interface ErdRelationGeometry {
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly fromCard: '1' | '*';
  readonly toCard: '1' | '*';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface ErdGeometry {
  readonly kind: 'erd';
  readonly width: number;
  readonly height: number;
  readonly entities: ReadonlyArray<ErdEntityGeometry>;
  readonly relations: ReadonlyArray<ErdRelationGeometry>;
  readonly title: string;
}

/** Discriminated union over the three geometry types. */
export type Geometry = FlowchartGeometry | SequenceGeometry | ErdGeometry;
