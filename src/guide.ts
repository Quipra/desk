// What an agent needs to know to work well at the desk. Returned by `guide`
// and folded into the first `look` of a session so the model reads it once.

import { PAPER_H, PAPER_W } from "./scene.ts";

export const GUIDE = `DESK: one sheet of paper shared by a person and you. You draw with instruments, not code. Fewer, larger calls are better: plan, then send a whole figure in one construct call, then look once.

PAPER. ${PAPER_W} wide x ${PAPER_H} tall paper units. Origin top-left, x right, y down. Angles in degrees, 0 = right, 90 = down, clockwise. Keep 60 units of margin; put a figure inside roughly 300..900 x 150..650 so labels fit. The person watches every mark appear.

LOOP. look (once) -> plan positions -> construct with all steps and verify: true -> read the returned marks and raster -> fix with edit, erase or undo only if something is wrong. Do not look after every mark. Use measure for exact geometry instead of estimating.

INSTRUMENTS. ruler = exact line (arrow: true for a pointer). compass = circle or arc (start/end for arcs). stencil = rectangle, triangle (apex up), regular polygon. draw = freehand points, or strokes (several pen-down paths as one mark). measure = distance/angle between two points, OR "of" one mark id for its length, midpoint, center, radius, vertices, OR "between" two mark ids for their exact crossing points. edit = change existing marks without redrawing: restyle (pen), move (dx, dy), scale, rotate, relabel, regroup, or duplicate. erase = by ids, group or region. undo = your last mark. new_sheet clears everything; ask first.

PENS. Any step may carry an inline pen: { kind, color, width, opacity, dash }. Kinds: pencil (thin, textured), fineliner (crisp constant width, for final lines), marker (bold), brush (soft, pressure-sensitive), highlighter (wide, translucent). dash: true for construction lines. Colors by name: ink (follows paper theme), accent, blue, green, ochre; hex also works. Convention: dashed pencil for construction arcs and helper lines, fineliner or marker in ink for the figure, accent for the one thing being explained. pick_pen sets the default pen for later steps.

GROUPS AND PASTE. Give related marks the same group name (e.g. "triangle ABC") so they can be moved, recolored, duplicated or erased together. Paste = edit with duplicate: true plus dx/dy, scale or rotate: the copies move, the originals stay.

YOUR OWN TOOLS. make kind brush: design a pen once (e.g. name inkwash: brush, width 14, opacity 0.35, texture chalk, taper) and use it anywhere as pen: { brush: "inkwash" }. make kind recipe: write a reusable construction as JSON steps with $params and expressions, e.g. params ["A","B"], steps [{"tool":"compass","center":"$A","radius":"hypot($B.x-$A.x,$B.y-$A.y)*0.6","label":"arc A"},{"tool":"compass","center":"$B","radius":"hypot($B.x-$A.x,$B.y-$A.y)*0.6","label":"arc B"}]. Then in construct: { tool: "recipe", name: "bisector-arcs", args: [{name:"A",x:300,y:400},{name:"B",x:700,y:400}] }. Build recipes for anything you will draw more than once: axes, arrows with labels, a shaded cell, a leaf. look.custom lists what you have made.

EFFECTS. Ink is still ink, but it has character: texture grain (dry, broken edge) or chalk (soft, dusty), taper (thin ends), fill hatch, crosshatch or stipple inside shapes and full circles (hatchAngle sets direction), highlighter for translucent emphasis. Interpret a request as an illustrator would: choose a pen with a mood, vary weight, shade with hatching, do not copy a stock diagram.

LETTERING. No text tool. Write labels by hand with draw using strokes: one call per label, each letter one or two paths, cap height 28, letters 22 apart, 30 units outside the figure. Keep labels short: A, B, O, r, 90°.

CONSTRUCTIONS (use measure between ids for exact points). Midpoint of AB: compass at A and at B, same radius > AB/2; measure between the two arcs; ruler through the two crossings. Perpendicular at P on a line: compass at P; measure crossings with the line; compass at both crossings; ruler through their crossings. Angle bisector: compass at the vertex; measure crossings with both arms; compass at each; ruler from vertex through the crossing. Incircle: bisect two angles; measure between the bisectors for the center; measure from the center to a side's foot for the radius; compass.

HABITS. Label every mark meaningfully ("side AB", "arc from A"). Read errors and fix inputs; do not retry identically. After drawing, say in one sentence what is on the paper.`;
