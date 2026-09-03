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

Twelve tools registered with `document.modelContext.registerTool` (with a `navigator.modelContext` fallback). All of them write to the same scene the person's pointer writes to.

| Tool | On the desk |
|---|---|
| `guide` | How the desk works: coordinates, instruments, lettering, ruler-and-compass recipes. Read once per session |
| `look` | Every mark with id, label, author, pen and bounding box, plus a 48 × 32 map of where ink is |
| `measure` | Distance and angle between two points, without drawing |
| `pick_pen` | Pencil, marker, or brush, with color, width, opacity |
| `draw` | Freehand: one stroke, or several pen-down paths as one mark. Letters are drawn this way |
| `ruler` | Straight line, optional arrowhead |
| `compass` | Circle or arc from a center and radius |
| `stencil` | Rectangle, triangle, or regular polygon |
| `erase` | By id or region |
| `undo` | Lift the agent's last mark |
| `new_sheet` | Fresh paper: blank, grid, or lined |
| `construct` | Up to 40 instrument steps in one call, for a whole figure |

The paper is 1200 × 800 units, origin top-left. Tool results are JSON, so `look` is how the agent sees. There is no text tool: labels are hand-drawn with `draw` and `strokes`, and the guide tells the agent how.

Tool schemas stay inside the JSON Schema subset chat hosts accept for tool definitions (type, properties, required, enum, items, description, additionalProperties). Ranges are validated in code. A test guards this, because a single `oneOf` or `minimum` makes a tool unusable in ChatGPT.

Agent marks reveal progressively with a glow, then settle into plain ink. The **replay** button redraws the whole sheet in order. Charcoal is the default theme with a light-paper toggle; `color: "auto"` follows the theme.

## Run locally

```sh
npm install
npm run dev     # http://localhost:5173
npm test
npm run build
```

In the browser console, `desk.call(name, input)` calls any instrument directly:

```js
await desk.call("construct", { steps: [
  { tool: "pick_pen", kind: "marker" },
  { tool: "ruler", from: { x: 300, y: 400 }, to: { x: 900, y: 400 }, label: "segment AB" },
  { tool: "compass", center: { x: 300, y: 400 }, radius: 380, start: -60, end: 60, label: "arc from A" },
] });
await desk.call("look");
```

## Layout

- `src/scene.ts` — the shared scene: items, authors, pens, bounding boxes
- `src/paper.ts` — canvas rendering, ribbon strokes, reveal animation, glow, replay
- `src/instruments.ts` — the person's pointer gestures
- `src/webmcp.ts` — the agent's twelve tools, validation and lifecycle
- `src/guide.ts` — what the `guide` tool returns
- `src/look.ts` — how the agent sees the sheet
- `src/appearance.ts` — theme palette shared by DOM and canvas
- `src/main.ts` — the tray and status UI
- `SKILL.md` — a short skill for coding agents that build on Desk

MIT.
