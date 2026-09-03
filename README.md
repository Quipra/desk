# Desk

One desk shared by a person and an agent. Paper, pens, an eraser, a ruler, a compass, stencils. Nothing else.

Agents are bad at drawing because we make them write code for it. Desk gives an agent the same instruments a person holds, through [WebMCP](https://webmachinelearning.github.io/webmcp/): it picks up a pencil, lays down a ruler, sets a compass, and its marks appear on the sheet live, in front of you. You can draw on the same sheet, and the agent can look at what you drew before it answers.

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/), for learning geometry: ask ChatGPT to construct a perpendicular bisector and watch it do it with a ruler and compass on your paper.

## Try it

Live: https://quipra.github.io/desk/

Open Desk in a browser with WebMCP:

- **ChatGPT desktop app**: open the URL in the built-in browser with GPT-5.6 Sol or Terra (Luna has site tools off). The instruments show up under **Site tools** in the address bar.
- **Chrome 149+**: turn on `chrome://flags/#enable-webmcp-testing`, reload, and use an agent extension such as Google's [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp).

The chip top-right reads "agent: ready" once the instruments are registered. Without WebMCP the page still works as a drawing tool.

Prompts that show it off:

- "Read the guide, then draw a 400-unit segment AB and construct its perpendicular bisector with the compass and ruler."
- "Draw triangle ABC and its incircle. Label the vertices."
- "Look at my sketch and tell me what I drew. Then label it."
- "Explain the Pythagorean theorem on the paper, step by step."

## Instruments

Fifteen tools registered with `document.modelContext.registerTool` (with a `navigator.modelContext` fallback). All of them write to the same scene the person's pointer writes to.

| Tool | On the desk |
|---|---|
| `guide` | One skill by topic: geometry, lettering, vectors, illustration, animation, recipes, collaboration, layers. The core skill and an index ride on the first `look` |
| `look` | Every mark with id, label, group, author, pen and bounding box, what changed since the last look, the agent's own brushes and recipes, and a 48 × 32 map of where ink is |
| `measure` | Exact geometry without ink: distance and angle between points, one mark's length, midpoint, center, radius or vertices, or the exact crossing points of two marks |
| `pick_pen` | Default pen for later marks. Any mark can carry its own inline pen instead |
| `draw` | Freehand: one stroke, or several pen-down paths as one mark. Letters are drawn this way |
| `ruler` | Straight line, optional arrowhead |
| `compass` | Circle or arc from a center and radius |
| `stencil` | Rectangle, triangle, or regular polygon |
| `path` | The pen tool: a vector from SVG path data, with optional solid fill |
| `edit` | Change existing marks without redrawing: restyle, move, scale, rotate, relabel, regroup, duplicate (paste), hide, reorder, and with `at`, keyframe |
| `erase` | By ids, group, or region |
| `undo` | Lift the agent's last mark |
| `timeline` | The sheet's clock: play, pause, seek, duration, fps, loop, onion skin, or a fresh sheet |
| `make` | The agent's own tools: a brush it designs, a recipe of construct steps with `$params` and expressions, or a motion preset it can apply anywhere |
| `construct` | Up to 40 instrument steps in one call, including recipes. `verify: true` returns the sheet in the same result |

**Animation.** A keyframe is an edit at a time: `edit { group: "ball", at: 1.5, dx: 300, ease: "easeOut" }`. Keyable: position, scale, rotation, opacity, and reveal (write-on). Curves: linear, ease, easeIn, easeOut, easeInOut, bounce, or a cubic bezier. Wiggle adds smooth drift; boil re-noises edges like hand-drawn animation. A built-in library (rise, drop, pop, fade, wipe, typewriter, breathe, spin, shake, drift, sketchy, fadeOut, sink) applies with `preset`, with `stagger` for cascades, and the agent can name its own with `make`. Playback starts when keys are added; a scrubber with keyframe ticks, loop, and onion skin appears under the paper. `look { at }` reports where every mark is at a time. The **export** button records one loop as WebM.

**Vectors and layers.** `path` takes SVG path data and makes a real vector mark that fills, transforms, animates and crosses like everything else. Groups are layers: a panel on the right lists them with visibility and z-order, and `edit` can hide, show, and reorder.

Five pens: pencil, fineliner, marker, brush, highlighter. Every pen but the fineliner is a stamp brush: a tip image laid along the stroke with pressure driving size and flow, seeded jitter, and a paper-grain mask; markers and highlighters multiply like ink. Nothing about a brush is fixed: the agent can set tip, spacing, scatter, grain, size and flow curves, jitter, wet edges, and effects (shadow, glow, blur) on any mark, or name a brush once with `make`. Every pen can be dashed, tapered, and can fill closed shapes and circles with a solid color and hatch, crosshatch, or stipple. Colors by name (ink, accent, blue, green, ochre) or hex. The paper is 1200 × 800 units, origin top-left. There is no text tool: labels are hand-drawn with `draw` and `strokes`, and the guide tells the agent how.

**Skills, not a manual.** The agent reads the core skill once (about 450 tokens) with an index of eight more, and pulls a topic only when the task calls for it: geometry before a construction, lettering before a label, animation before motion. The same text lives in `skills/*/SKILL.md` for coding agents and humans.

Designed for few round-trips. A typical figure is one `look`, one `construct` with `verify`, done. In a scripted case study (a model given each tool set and the same task: draw segment AB, construct its perpendicular bisector with compass and ruler, label A and B, verify), the earlier eleven-tool set planned 13 calls; this set planned 1, both executing with no errors against the real tool code. The guide rides along with the first look, pens are inline, exact points come from `measure`, and the agent can write a recipe once and stamp it with different parameters.

Tool schemas stay inside the JSON Schema subset chat hosts accept for tool definitions (type, properties, required, enum, items, description, additionalProperties). Ranges are validated in code. A test guards this, because a single `oneOf` or `minimum` makes a tool unusable in ChatGPT.

Agent marks reveal progressively with a glow, then settle into plain ink. The **replay** button redraws the whole sheet in order. Paper is the default theme with a charcoal toggle in the DESK menu; `color: "auto"` follows the theme. The tray's hand-drawn icons are [Doodle Icons by Khushmeen Sidhu](https://khushmeen.com/icons.html) (CC0), vendored under `src/doodle/`.

## For the person at the desk

A hand-drawn tray: select (V), hand (H), pen (B), Bézier pen tool (P), eraser (E), ruler, compass, stencil, undo and redo (⌘Z, ⌘⇧Z), replay, paper. Select shows a bounding box with handles to move, scale and rotate; a marquee selects many; ⌘D duplicates; Delete removes. An inspector for the selection edits stroke, fill, brush, effects (shadow, glow, blur), group, order, and aligns or distributes marks. The row above it holds the active tool's options: five pen kinds, three widths, dash, five inks and a custom color; stencil shapes; paper types. Pinch or ⌘-wheel to zoom, wheel or hand to pan, ⌘0 to fit. The DESK mark opens a menu: new sheet, save (⌘S) to a library kept in the browser, export PNG, SVG, or one loop of the animation as WebM.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173
npm test
npm run build
```

In the browser console, `desk.call(name, input)` calls any instrument directly:

```js
await desk.call("make", { kind: "recipe", name: "arcs", params: ["A", "B"], steps: JSON.stringify([
  { tool: "compass", center: "$A", radius: "hypot($B.x-$A.x,$B.y-$A.y)*0.6", label: "arc A", pen: { kind: "pencil", dash: true } },
  { tool: "compass", center: "$B", radius: "hypot($B.x-$A.x,$B.y-$A.y)*0.6", label: "arc B", pen: { kind: "pencil", dash: true } },
]) });
await desk.call("construct", { verify: true, steps: [
  { tool: "ruler", from: { x: 300, y: 400 }, to: { x: 900, y: 400 }, label: "segment AB", pen: { kind: "marker" } },
  { tool: "recipe", name: "arcs", args: [{ name: "A", x: 300, y: 400 }, { name: "B", x: 900, y: 400 }] },
] });
```

## Layout

- `src/scene.ts` — the shared scene: items, authors, pens, bounding boxes
- `src/paper.ts` — canvas rendering, ribbon strokes, reveal animation, glow, replay
- `src/instruments.ts` — the person's pointer gestures
- `src/webmcp.ts` — the agent's fifteen tools, validation and lifecycle
- `src/geometry.ts` — exact intersections and mark properties for `measure`
- `src/recipes.ts` — the expression evaluator behind agent-made recipes
- `src/motion.ts` — keyframes, easing, wiggle, the motion library: where a mark is at a time
- `src/svgpath.ts` — the pen tool's SVG path parser
- `src/guide.ts` — what the `guide` tool returns
- `src/look.ts` — how the agent sees the sheet
- `src/appearance.ts` — theme palette shared by DOM and canvas
- `src/main.ts` — the tray, pickers, menu, zoom, strip and layers UI
- `src/export.ts` — PNG, SVG and WebM exporters
- `src/library.ts` — saved sheets in the browser
- `src/icons.ts` — the tray's icons, from the vendored doodle set in `src/doodle/`
- `src/skills.ts` — the skills the `guide` tool serves; `skills/` is generated from it by `npm run skills`

MIT.
