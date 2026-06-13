/**
 * Sequence diagram layout.
 *
 * Pure function: `SequenceIR → SequenceGeometry`.
 *
 * Layout:
 *   - Actors are laid out left-to-right in id-sorted order, evenly
 *     spaced.
 *   - The actor header band is at the top; a dashed lifeline drops
 *     from the bottom of the header down to `SEQ_LIFELINE_TAIL`
 *     below the last message.
 *   - Messages are stacked vertically below the header band with
 *     `SEQ_MSG_GAP` between them; each message is a horizontal arrow
 *     from the source actor's center-x to the target actor's
 *     center-x.
 *
 * Determinism: actors are sorted by id, messages are emitted in
 * insertion order, and the geometry is computed from constants
 * only.
 */
import {
  CANVAS_HEIGHT,
  CANVAS_MARGIN,
  CANVAS_WIDTH,
  CHAR_WIDTH,
  MIN_NODE_WIDTH,
  NODE_PADDING_X,
  SEQ_HEADER_BAND,
  SEQ_LIFELINE_TAIL,
  SEQ_MSG_GAP,
} from './constants.js';
import type {
  SequenceActorGeometry,
  SequenceGeometry,
  SequenceMessageGeometry,
} from './types.js';
import type { SequenceIR } from '../types.js';

const ACTOR_GAP_X = 64;

export function layoutSequence(ir: SequenceIR): SequenceGeometry {
  // Ensure all message endpoints are present as actors.
  const seen = new Set(ir.actors.map((a) => a.id));
  const actors = [...ir.actors];
  for (const m of ir.messages) {
    if (!seen.has(m.from)) {
      actors.push({ id: m.from, label: m.from });
      seen.add(m.from);
    }
    if (!seen.has(m.to)) {
      actors.push({ id: m.to, label: m.to });
      seen.add(m.to);
    }
  }
  // Sort by id for determinism.
  const sortedActors = [...actors].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // Compute actor widths first.
  const widths = sortedActors.map((a) =>
    Math.max(MIN_NODE_WIDTH, a.label.length * CHAR_WIDTH + NODE_PADDING_X * 2),
  );
  const totalW =
    widths.reduce((s, w) => s + w, 0) + Math.max(0, sortedActors.length - 1) * ACTOR_GAP_X;
  const canvasW = Math.max(totalW + 2 * CANVAS_MARGIN, CANVAS_WIDTH);

  // Distribute actors across the canvas with equal spacing.
  const span = canvasW - 2 * CANVAS_MARGIN;
  const step = sortedActors.length > 1 ? span / (sortedActors.length - 1) : 0;
  const actorGeoms: SequenceActorGeometry[] = sortedActors.map((a, i) => {
    const w = widths[i]!;
    const x = CANVAS_MARGIN + i * step;
    return {
      id: a.id,
      label: a.label,
      x,
      y: CANVAS_MARGIN,
      w,
      h: SEQ_HEADER_BAND - 16,
      lifelineY1: 0,
      lifelineY2: 0,
    };
  });

  // Messages stacked below header band.
  const messageGeoms: SequenceMessageGeometry[] = [];
  let y = CANVAS_MARGIN + SEQ_HEADER_BAND;
  for (const m of ir.messages) {
    const fromA = actorGeoms.find((a) => a.id === m.from);
    const toA = actorGeoms.find((a) => a.id === m.to);
    if (!fromA || !toA) continue;
    messageGeoms.push({
      from: m.from,
      to: m.to,
      label: m.label,
      kind: m.kind,
      x1: fromA.x,
      y1: y,
      x2: toA.x,
      y2: y,
    });
    y += SEQ_MSG_GAP;
  }

  const lifelineY1 = CANVAS_MARGIN + SEQ_HEADER_BAND - 16;
  const lifelineY2 = y + SEQ_LIFELINE_TAIL;
  const finalActors: SequenceActorGeometry[] = actorGeoms.map((a) => ({
    ...a,
    lifelineY1,
    lifelineY2,
  }));
  const canvasH = Math.max(lifelineY2 + CANVAS_MARGIN, CANVAS_HEIGHT);

  return {
    kind: 'sequence',
    width: canvasW,
    height: canvasH,
    actors: finalActors,
    messages: messageGeoms,
    title: ir.title,
  };
}
