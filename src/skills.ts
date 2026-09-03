// Skills: what an agent needs to know at the desk, split by task so it reads
// only what the moment calls for. `core` rides on the first look; the rest
// come through guide { topic }. The repo's skills/ folder is generated from
// this file (npm run skills), so the two never drift.

import { PAPER_H, PAPER_W } from "./scene.ts";

export interface Skill {
  /** One line: when to read this. Shown in the index. */
  when: string;
  body: string;
}

export const SKILLS: Record<string, Skill> = {
  core: {
    when: "always; the desk, its coordinates, the loop, and which skill to read next",
    body: `DESK: one sheet of paper shared by a person and you. You draw with instruments, not code. Fewer, larger calls: plan, send a whole figure in one construct call, look once.

PAPER. ${PAPER_W} wide x ${PAPER_H} tall paper units, origin top-left, x right, y down. Degrees: 0 right, 90 down, clockwise. Keep 60 units of margin; a figure sits well inside 300..900 x 150..650. The person watches every mark appear.

LOOP. look (once; it carries this text the first time and, later, what the person drew since) -> plan -> construct { steps, verify: true } -> read the returned marks and raster -> fix with edit, erase or undo only if something is wrong. Never look after every mark. Use measure for exact points instead of estimating.

TOOLS. ruler (line, arrow), compass (circle/arc), stencil (rectangle, triangle, polygon), path (SVG path data, fills), draw (freehand points or strokes), measure (exact geometry), edit (change or animate existing marks), erase, undo, timeline (clock, fresh sheet), make (your own brushes, recipes, motions), construct (many steps, one call).

PENS. Any step may carry pen: { kind, color, width, opacity, dash }. pencil (construction), fineliner (crisp final lines), marker (bold), brush (pressure), highlighter (translucent). Colors: ink, accent, blue, green, ochre, or hex. Dashed pencil for helper lines, fineliner or marker in ink for the figure, one accent for the thing being explained.

GROUPS. Same group name on related marks ("triangle ABC") so they move, recolor, animate, hide or erase together. Later marks draw on top.

HABITS. Label every mark meaningfully. Read errors and fix the input; never retry identically. After drawing, say in one sentence what is on the paper. Ask before timeline clear on a sheet the person touched.`,
  },
  geometry: {
    when: "constructions, proofs, anything that must be exact: bisectors, perpendiculars, incircles, tangents",
    body: `EXACT POINTS. measure { a, b } returns the crossing points of two marks; measure { of } returns a mark's length, midpoint, center, radius or vertices; measure { from, to } gives distance and angle. Use these instead of arithmetic in your head, then draw through the returned points.

CONVENTION. Given lines and the answer in fineliner or marker (ink). Construction arcs and helper lines in dashed pencil. Points marked with a small compass circle of radius 3. Label with lettering (see lettering).

RECIPES (radius r > half the distance).
Midpoint / perpendicular bisector of AB: compass at A and at B with the same r; measure between the two arcs; ruler through the two crossings.
Perpendicular at P on a line: compass at P (any r); measure crossings with the line, call them X and Y; compass at X and at Y with r' > r; ruler from P through their crossing.
Perpendicular from an external point P to a line: compass at P crossing the line twice; then as above from those two crossings.
Angle bisector at vertex V: compass at V crossing both arms; compass at each crossing with the same r; ruler from V through their crossing.
Incircle: bisect two angles; measure between the bisectors for the center I; drop a perpendicular from I to a side for the radius, or measure from I to the foot; compass at I.
Circumcircle: perpendicular bisectors of two sides; their crossing is the center; radius = distance to a vertex.
Tangent from P to a circle with center O: midpoint M of OP; compass at M with radius MO; its crossings with the circle are the tangent points.

Write each recipe once with make kind recipe (params A, B, ...), then reuse it.`,
  },
  lettering: {
    when: "any label, letter, number or short word on the paper",
    body: `There is no text tool. Letters are drawn with draw { strokes } as pen-down paths, one call per label, fineliner or pencil, cap height 28, letters about 22 apart, placed 30 units outside the figure so they never cross a line.

Keep labels short: A, B, O, r, 90°, x. For a word, one draw call with one or two paths per letter. Uppercase is cleaner than lowercase; sans-serif shapes; numbers as simple as a seven-segment display.

Reference glyphs at cap height h with origin at the baseline-left (x right, y up; subtract y from the baseline):
A: [(0,0),(h/2,h),(h,0)] and crossbar [(h/4,h/2.5),(3h/4,h/2.5)]. B: stem [(0,0),(0,h)] plus two bowls. C: an arc from about 45° to 315° on a circle of radius h/2. O: compass with radius h/2 (use the compass tool). I: one stem. L: stem then base. T: bar then stem. X: two diagonals. 1: stem with a short flag. 7: bar then diagonal. °: compass radius 4 at cap height.

For emphasis use a slightly heavier width, not a bigger letter. For a title, marker with taper.`,
  },
  vectors: {
    when: "organic shapes, icons, characters, logos, anything the ruler and compass can't draw",
    body: `path { d } takes SVG path data in paper units: M L H V C S Q T Z, absolute or relative. Example leaf: "M 300 400 C 350 300 450 300 500 400 S 350 500 300 400 Z".

FILLS. pen.fillColor gives a solid vector shape (palette name, hex, or auto for theme ink); pen.fill adds hatch, crosshatch or stipple as ink on top; opacity applies to both. Closed shapes (Z) fill; open paths only stroke.

DRAWING WELL. Sketch the silhouette with 3-6 cubic segments, not 30 lines. Put control points about a third of the way along each segment for smooth curves. Use S for symmetric continuations. Build a figure from a few closed paths in one group, back to front: ground, body, details. Consistent stroke width within a group; no stroke (width 1, same color as fill) for flat illustration.

Paths transform, keyframe, cross with measure, and reveal like every other mark. edit { duplicate: true, dx, scale, rotate } pastes copies; a recipe with $params stamps variations.`,
  },
  illustration: {
    when: "the request is a picture, a mood, a scene or a style rather than a diagram",
    body: `Interpret like an illustrator, do not reproduce a stock diagram. Decide three things before drawing: one pen with a mood, one accent color, and the order of layers (back to front).

PENS WITH CHARACTER. Every pen but the fineliner is a real stamp brush: a tip laid along the stroke, pressure driving size and flow, paper grain breaking the deposit. pencil is graphite on grain; marker is a chisel that multiplies like ink on paper; brush is soft and pressure-sensitive; highlighter is a wide translucent chisel. Vary pressure p along a stroke for life: light in, heavy through, light out. Design your own with make kind brush: tip round|soft|flat|bristle|chalk|pencil, spacing (0.05 dense .. 0.4 dotted), scatter (0..1 spray), grain (0..1), taper, opacity. Examples: dry brush = bristle, spacing 0.08, grain 0.6; ink wash = soft, opacity 0.35, width 18; charcoal = chalk, grain 0.8, scatter 0.1; spray = round, spacing 0.3, scatter 0.9, opacity 0.2.

SHADING. fill hatch (one direction, hatchAngle follows the form), crosshatch for the darkest areas, stipple for soft gradients and skies. Vary width: thick near, thin far. Leave paper empty where the light hits.

COMPOSITION. Sit the subject off-center. Three values: light paper, mid hatch, dark crosshatch. Repeat a shape three times at different sizes for rhythm (edit duplicate with scale). Sign nothing; label sparingly.

PACE. One construct call for the whole scene, groups per element, then look once. Add motion only if asked (see animation).`,
  },
  animation: {
    when: "anything should move, appear over time, wiggle, or be shown frame by frame",
    body: `The sheet has a clock: timeline { duration, fps, loop, onion }. A keyframe is an edit at a time: edit { group, at, dx, dy, scale, rotate, opacity, reveal, ease }.

RULES. Like After Effects, each property holds its first key before it and its last key after it, so start every animated mark with a key at 0 that sets each property you will animate (rest is dx 0, dy 0, scale 1, rotate 0, opacity 1, reveal 1). A single key is a constant. Keys are relative to where the mark was drawn.

CURVES. ease into a key: linear, ease, easeIn, easeOut, easeInOut, bounce, or bezier [x1,y1,x2,y2]. Overshoot then settle for life: scale 0 -> 1.1 (easeOut) -> 1.

PRESETS. edit { preset, at, stagger }: rise, drop, pop, fade, wipe (write-on), typewriter, breathe, spin, shake, drift (wiggle), sketchy (line boil), fadeOut, sink. stagger cascades a group. Make your own with make kind motion { keys, wiggle, boil } and apply it the same way.

HAND-DRAWN LIFE. wiggle { amp, freq } for float; boil for a shimmering edge; reveal keys for a construction appearing step by step.

PLAYBACK. Adding keys plays once; timeline play/pause/seek control it; look { at } shows the pose at a time. Keep loops under a few seconds; stagger groups by a few frames; at 12 fps a frame is 1/12 s, so frame-by-frame means a key per frame or a duplicate per frame.`,
  },
  recipes: {
    when: "you will draw something more than once, or want a brush or motion of your own",
    body: `make kind brush { name, pen }: a named pen (kind, color, width, opacity, dash, texture, taper, fill, fillColor). Use as pen { brush: name } anywhere; fields given inline override it.

make kind recipe { name, params, steps }: steps is JSON text, an array of construct steps whose numbers may be expressions over $params: "$A.x", "($A.x+$B.x)/2", "hypot($B.x-$A.x,$B.y-$A.y)*0.6". Functions: sqrt abs min max hypot sin cos tan atan2 round floor ceil (degrees). A point param is used whole as "$A" or by part as "$A.x". Text params can label: "label": "$name". Use as a construct step { tool: "recipe", name, args: [{name:"A",x,y},{name:"r",value},{name:"t",text}] }. Recipes may call recipes.

make kind motion { name, motion }: JSON text { keys: [{at, dx, dy, scale, rotate, opacity, reveal, ease}], wiggle, boil } with times relative to where it is applied; apply with edit { preset: name, at }.

look.custom lists what you have made. Making a name again replaces it. Good candidates: axes with ticks, an arrow with a label, a hatched cell, a leaf, a bisector, a pop-in.`,
  },
  collaboration: {
    when: "the person has drawn something, asks you to look, correct, continue or explain their marks",
    body: `The person's marks have author "human". look returns them with ids and bounds, and look.changes lists what was added or removed since your last look; read changes before assuming the sheet is as you left it.

Treat their marks as the subject, not noise: label them, measure them (measure of / between works on any mark), continue them, draw on top with a different pen or accent so both hands stay visible. Never erase or move a human mark unless asked; never timeline clear without asking.

To explain, draw next to their mark rather than over it, and keep your marks in a group named for the explanation so they can be hidden or removed as a unit. When they ask "what did I draw", answer from geometry and bounds; labels are what the author typed, not recognition.`,
  },
  layers: {
    when: "organizing a busy sheet, showing or hiding parts, ordering what draws on top, pasting copies",
    body: `Groups are layers. Give every mark a group; the person sees groups in a panel with visibility and order.

edit { group, hidden: true|false } shows or hides. edit { group, order: "front"|"back" } changes drawing order (later draws on top). edit { group, regroup } renames. erase { group } removes.

PASTE. edit { ids|group, duplicate: true, dx, dy, scale, rotate, regroup } makes edited copies and leaves the originals. Stamp a leaf three times with different scale and rotate for a bush; a recipe with $params is the alternative when the copies differ in more than transform.

Keep groups small and named for meaning ("axis", "triangle ABC", "answer"), not for tools.`,
  },
};

export const SKILL_NAMES = Object.keys(SKILLS);

/** One line per skill: the map the agent reads first. */
export function skillIndex(): string {
  return `SKILLS (read one with guide { topic }):\n${SKILL_NAMES.filter((n) => n !== "core")
    .map((n) => `- ${n}: ${SKILLS[n].when}`)
    .join("\n")}`;
}

/** What the first look carries: the core skill and the index. */
export function coreGuide(): string {
  return `${SKILLS.core.body}\n\n${skillIndex()}`;
}
