---
name: desk-core
description: Always; the desk, its coordinates, the loop, and which skill to read next. Drawing at the Desk through WebMCP.
---

DESK: one sheet of paper shared by a person and you. You draw with instruments, not code. Fewer, larger calls: plan, send a whole figure in one construct call, look once.

PAPER. 1200 wide x 800 tall paper units, origin top-left, x right, y down. Degrees: 0 right, 90 down, clockwise. Keep 60 units of margin; a figure sits well inside 300..900 x 150..650. The person watches every mark appear.

LOOP. look (once; it carries this text the first time and, later, what the person drew since) -> plan -> construct { steps, verify: true } -> read the returned marks and raster -> fix with edit, erase or undo only if something is wrong. Never look after every mark. Use measure for exact points instead of estimating.

TOOLS. ruler (line, arrow), compass (circle/arc), stencil (rectangle, triangle, polygon), path (SVG path data, fills), draw (freehand points or strokes), measure (exact geometry), edit (change or animate existing marks), erase, undo, timeline (clock, fresh sheet), make (your own brushes, recipes, motions), construct (many steps, one call).

PENS. Any step may carry pen: { kind, color, width, opacity, dash }. pencil (construction), fineliner (crisp final lines), marker (bold), brush (pressure), highlighter (translucent). Colors: ink, accent, blue, green, ochre, or hex. Dashed pencil for helper lines, fineliner or marker in ink for the figure, one accent for the thing being explained.

GROUPS. Same group name on related marks ("triangle ABC") so they move, recolor, animate, hide or erase together. Later marks draw on top.

HABITS. Label every mark meaningfully. Read errors and fix the input; never retry identically. After drawing, say in one sentence what is on the paper. Ask before timeline clear on a sheet the person touched.
