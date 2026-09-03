// What an agent needs to know to work well at the desk. Served by the `guide`
// tool so the model can read it once per session instead of guessing.

import { PAPER_H, PAPER_W } from "./scene.ts";

export const GUIDE = `DESK: one sheet of paper shared by a person and you. You draw with instruments, not code.

PAPER. ${PAPER_W} wide x ${PAPER_H} tall paper units. Origin top-left, x right, y down. Angles in degrees, 0 = right, 90 = down. Keep 60 units of margin. The person sees every mark appear live.

WORKFLOW. 1) look. 2) plan positions on paper, keep a figure inside roughly 300..900 x 150..650 so labels fit. 3) pick_pen once, then draw with ruler, compass, stencil, draw. 4) look again and fix with erase or undo. Use construct to send several steps in one call; it is faster and keeps a figure together.

INSTRUMENTS. ruler = exact straight line (arrow: true for a pointer). compass = circle or arc, give start/end for arcs. stencil = rectangle, triangle (apex up), regular polygon. draw = freehand: a list of points, or strokes (several pen-down paths in one mark). measure = distance and angle, no ink. erase = by id or region. undo = your last mark. new_sheet clears everything, ask first.

PENS. pencil for construction lines, marker for the final figure, brush for emphasis. Color "auto" is readable on both paper themes. Use one accent color (for example #dc716b) for the thing you are explaining, everything else auto.

LETTERING. There is no text tool. Write labels by hand with draw using strokes: one call per label, each letter one or two paths, cap height 28 units, letters 22 apart, placed 30 units outside the figure. Keep labels to a few characters: A, B, C, O, r, 90°. Prefer geometry that speaks for itself over long labels.

CONSTRUCTIONS. Segment AB: ruler A to B. Midpoint: compass at A and at B with the same radius (> half AB), ruler through the two intersections. Perpendicular at a point: compass at the point, then compass at both intersections, ruler through the crossings. Angle bisector: compass at vertex, then compass at both arm intersections, ruler through the crossing. Incircle: bisect two angles, compass at the crossing with radius = distance to a side (measure it). Use pencil for arcs, marker for the answer.

GOOD HABITS. Label every mark meaningfully (e.g. "side AB", "arc from A") so it can be referred to and erased. Do not repeat marks. Say what you drew in one sentence after you draw. If a result comes back with an error, read it and fix the input instead of retrying identically.`;
