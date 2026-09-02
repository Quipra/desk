# Desk

One desk shared by a person and an agent. Paper, pens, an eraser, a ruler, a compass, stencils. Nothing else.

Agents are bad at drawing because we make them write code for it. Desk gives an agent the same instruments a person holds, through [WebMCP](https://webmachinelearning.github.io/webmcp/): it picks up a pencil, lays down a ruler, sets a compass, and its marks appear on the sheet live, in front of you. You can draw on the same sheet, and the agent can look at what you drew before it answers.

Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/), for learning geometry: ask ChatGPT to construct a perpendicular bisector and watch it do it with a ruler and compass on your paper.

## Try it

Live: (coming, see deploy below)

Open Desk in a browser with WebMCP:

- **ChatGPT desktop app**: open the URL in the built-in browser. The instruments show up under **Site tools** in the address bar.
- **Chrome 149+**: turn on `chrome://flags/#enable-webmcp-testing`, reload, and use an agent extension such as Google's [Model Context Tool Inspector](https://developer.chrome.com/docs/ai/webmcp).

Without WebMCP the page still works as a drawing tool; the agent just can't pick up the pens.

Prompts that show it off:

- "Draw triangle ABC and its incircle. Label the vertices."
- "Construct the perpendicular bisector of the line I drew, with a compass."
- "Look at my sketch and label which angle is 90°."
- "Explain the Pythagorean theorem on the paper, step by step."

## Instruments

Eleven tools, registered with `document.modelContext.registerTool` (falls back to `navigator.modelContext`). All of them write to the same scene a person draws on.

| Tool | On the desk |
|---|---|
| `pick_pen` | Pencil, marker, or brush, with color, width, opacity |
| `draw` | One freehand stroke: points with pressure |
| `ruler` | Straight line, optional arrowhead |
| `compass` | Circle or arc from a center and radius |
| `stencil` | Rectangle, triangle, or regular polygon |
| `write` | A short handwritten label or equation |
| `measure` | Distance and angle between two points, without drawing |
| `erase` | By id or region |
| `undo` | Lift the agent's last mark |
| `look` | Every mark with id, label, author, and bounding box, plus a coarse text raster of the sheet |
| `new_sheet` | Fresh paper: blank, grid, or lined |

The paper is 1200 × 800 units, origin top-left. Tool results are JSON, so `look` is how the agent sees: an inventory of marks and a 48 × 32 character map of where ink is.

Agent marks reveal progressively with a glow, then settle into plain ink. The **replay** button redraws the whole sheet in order.

## Run locally

```sh
npm install
npm run dev
```

In the browser console, `desk.call("draw", { points: [{x: 100, y: 100}, {x: 400, y: 300}], label: "test" })` calls any instrument directly.

## Deploy

Static Vite build, any host works:

```sh
npm run build   # outputs dist/
npx vercel      # or drag dist/ onto Netlify
```

## Layout

- `src/scene.ts` — the shared scene: items, authors, pens, bounding boxes
- `src/paper.ts` — canvas rendering, ribbon strokes, reveal animation, glow, replay
- `src/instruments.ts` — the person's pointer gestures
- `src/webmcp.ts` — the agent's eleven tools
- `src/look.ts` — how the agent sees the sheet
- `src/main.ts` — the tray and status UI

MIT.
