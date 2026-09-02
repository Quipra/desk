// The agent's hands on the desk. Eleven instruments registered through WebMCP.
// Every tool writes to the same scene a person draws on; nothing here is
// agent-only except the pen the agent is currently holding.

import { describe } from "./look";
import { smooth, type Paper } from "./paper";
import { bbox, clampPt, PAPER_H, PAPER_W, PEN_PRESETS, type Item, type PaperKind, type Pen, type PenKind, type Pt, type Scene, type StencilShape } from "./scene";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface ModelContext {
  registerTool(tool: ToolDef): Promise<void> | void;
}

function modelContext(): ModelContext | null {
  const d = (document as unknown as { modelContext?: ModelContext }).modelContext;
  if (d && typeof d.registerTool === "function") return d;
  const n = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (n && typeof n.registerTool === "function") return n;
  return null;
}

const point = {
  type: "object",
  properties: {
    x: { type: "number", description: `0..${PAPER_W}, left to right` },
    y: { type: "number", description: `0..${PAPER_H}, top to bottom` },
  },
  required: ["x", "y"],
};

const label = { type: "string", description: "Short name for this mark so it can be found, erased, or referred to later, e.g. 'side AB', 'circle centered at O'." };

export interface AgentHooks {
  onActivity: (active: boolean) => void;
}

export interface Desk {
  /** True when the tools were registered with the browser's WebMCP. */
  connected: boolean;
  /** Call an instrument directly, e.g. from the console: desk.call("draw", {...}). */
  call: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
  names: string[];
}

/** Builds the desk instruments and registers them with WebMCP when the browser has it. */
export async function registerDesk(scene: Scene, paper: Paper, hooks: AgentHooks): Promise<Desk> {
  const mc = modelContext();

  let pen: Pen = { ...PEN_PRESETS.pencil };

  const wrap = (fn: (input: Record<string, unknown>) => unknown) => async (input: Record<string, unknown>) => {
    hooks.onActivity(true);
    try {
      return fn(input ?? {});
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (!paper.busy) hooks.onActivity(false);
    }
  };

  const tools: ToolDef[] = [
    {
      name: "pick_pen",
      description:
        "Pick up a pen from the tray. Choose pencil (thin, precise), marker (bold, even) or brush (soft, pressure-sensitive), and optionally its color, width and opacity. The pen stays in hand for every following draw, ruler, compass, stencil and write call.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["pencil", "marker", "brush"] },
          color: { type: "string", description: "CSS color, e.g. '#1a1a1a', '#d63b3b', 'royalblue'" },
          width: { type: "number", description: "Base line width in paper units, 1..24" },
          opacity: { type: "number", description: "0..1" },
        },
        required: ["kind"],
      },
      execute: wrap((i) => {
        const kind = str(i.kind, "pencil") as PenKind;
        if (!(kind in PEN_PRESETS)) throw new Error("kind must be pencil, marker or brush");
        pen = {
          ...PEN_PRESETS[kind],
          color: typeof i.color === "string" && i.color.trim() ? i.color.trim() : pen.color,
          width: i.width === undefined ? PEN_PRESETS[kind].width : clamp(num(i.width), 1, 24),
          opacity: i.opacity === undefined ? PEN_PRESETS[kind].opacity : clamp(num(i.opacity), 0.05, 1),
        };
        return { pen };
      }),
    },
    {
      name: "draw",
      description:
        `Draw one freehand stroke with the pen in hand, the way a hand moves across paper. Give an ordered list of points; each may carry pressure p (0..1) which changes line weight, most on the brush. Use many points for curves. One call is one continuous stroke: lift the pen by calling draw again. The paper is ${PAPER_W} wide and ${PAPER_H} tall with the origin at the top-left. The stroke is drawn live in front of the person.`,
      inputSchema: {
        type: "object",
        properties: {
          points: {
            type: "array",
            minItems: 1,
            items: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, p: { type: "number", description: "pressure 0..1, default 0.5" } }, required: ["x", "y"] },
          },
          label,
        },
        required: ["points", "label"],
      },
      execute: wrap((i) => {
        const raw = Array.isArray(i.points) ? i.points : [];
        const points = raw.map((p) => clampPt({ x: num((p as Pt).x), y: num((p as Pt).y), p: (p as Pt).p === undefined ? undefined : num((p as Pt).p) }));
        if (points.length === 0) throw new Error("points must contain at least one point");
        const item = scene.add({ kind: "stroke", points: smooth(points) }, { label: str(i.label, "stroke"), author: "agent", pen });
        return { id: item.id, label: item.label, points: points.length, bbox: box(item.id) };
      }),
    },
    {
      name: "ruler",
      description: "Lay the ruler down and draw one straight line from one point to another with the pen in hand. Set arrow to true for an arrowhead at the end. Returns the line's length and angle.",
      inputSchema: { type: "object", properties: { from: point, to: point, arrow: { type: "boolean" }, label }, required: ["from", "to", "label"] },
      execute: wrap((i) => {
        const from = pt(i.from);
        const to = pt(i.to);
        const item = scene.add({ kind: "line", from, to, arrow: i.arrow === true }, { label: str(i.label, "line"), author: "agent", pen });
        return { id: item.id, label: item.label, ...measure(from, to) };
      }),
    },
    {
      name: "compass",
      description: "Set the compass at a center point and draw a circle or arc of the given radius with the pen in hand. Angles are in degrees, 0 points right, 90 points down (screen coordinates). Omit start and end for a full circle.",
      inputSchema: {
        type: "object",
        properties: { center: point, radius: { type: "number", description: "paper units" }, start: { type: "number", description: "degrees, default 0" }, end: { type: "number", description: "degrees, default 360" }, label },
        required: ["center", "radius", "label"],
      },
      execute: wrap((i) => {
        const c = pt(i.center);
        const r = clamp(num(i.radius), 1, Math.max(PAPER_W, PAPER_H));
        const start = i.start === undefined ? 0 : num(i.start);
        const end = i.end === undefined ? 360 : num(i.end);
        const item = scene.add({ kind: "arc", cx: c.x, cy: c.y, r, start, end }, { label: str(i.label, "circle"), author: "agent", pen });
        return { id: item.id, label: item.label, center: c, radius: r, start, end, bbox: box(item.id) };
      }),
    },
    {
      name: "stencil",
      description: "Trace a shape stencil with the pen in hand: rectangle, triangle (apex up) or regular polygon with the given number of sides. Position is the shape's center. Rotation in degrees, clockwise.",
      inputSchema: {
        type: "object",
        properties: {
          shape: { type: "string", enum: ["rectangle", "triangle", "polygon"] },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number", description: "width in paper units" },
          h: { type: "number", description: "height in paper units" },
          rotation: { type: "number", description: "degrees, default 0" },
          sides: { type: "number", description: "for polygon, 3..12, default 6" },
          label,
        },
        required: ["shape", "x", "y", "w", "h", "label"],
      },
      execute: wrap((i) => {
        const shape = str(i.shape, "rectangle") as StencilShape;
        if (!["rectangle", "triangle", "polygon"].includes(shape)) throw new Error("shape must be rectangle, triangle or polygon");
        const c = clampPt({ x: num(i.x), y: num(i.y) });
        const item = scene.add(
          { kind: "shape", shape, x: c.x, y: c.y, w: clamp(num(i.w), 2, PAPER_W), h: clamp(num(i.h), 2, PAPER_H), rotation: i.rotation === undefined ? 0 : num(i.rotation), sides: i.sides === undefined ? 6 : clamp(num(i.sides), 3, 12) },
          { label: str(i.label, shape), author: "agent", pen },
        );
        return { id: item.id, label: item.label, bbox: box(item.id) };
      }),
    },
    {
      name: "write",
      description: "Write a short label, letter, number or equation on the paper by hand with the pen in hand. Position is the left end of the text baseline. Keep it short; this is handwriting, not a document.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, size: { type: "number", description: "text height in paper units, 12..96, default 24" }, label },
        required: ["text", "x", "y"],
      },
      execute: wrap((i) => {
        const text = str(i.text, "").slice(0, 120);
        if (!text) throw new Error("text is required");
        const c = clampPt({ x: num(i.x), y: num(i.y) });
        const size = i.size === undefined ? 24 : clamp(num(i.size), 12, 96);
        const item = scene.add({ kind: "text", x: c.x, y: c.y, text, size }, { label: str(i.label, text), author: "agent", pen });
        return { id: item.id, label: item.label, bbox: box(item.id) };
      }),
    },
    {
      name: "measure",
      description: "Hold the ruler between two points without drawing. Returns the distance in paper units and the angle in degrees. Use it to check a construction before or after drawing.",
      inputSchema: { type: "object", properties: { from: point, to: point }, required: ["from", "to"] },
      annotations: { readOnlyHint: true },
      execute: wrap((i) => measure(pt(i.from), pt(i.to))),
    },
    {
      name: "erase",
      description: "Rub out marks. Give ids (from look or from earlier results) and/or a rectangular region; anything whose bounds touch the region is removed, including marks the person made, so look first.",
      inputSchema: {
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" } },
          region: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }, required: ["x", "y", "w", "h"] },
        },
      },
      execute: wrap((i) => {
        const ids = new Set<string>(Array.isArray(i.ids) ? i.ids.map(String) : []);
        if (i.region && typeof i.region === "object") {
          const r = i.region as Record<string, unknown>;
          for (const item of scene.inRegion({ x: num(r.x), y: num(r.y), w: num(r.w), h: num(r.h) })) ids.add(item.id);
        }
        const removed = scene.remove([...ids]);
        return { removed, remaining: scene.items.length };
      }),
    },
    {
      name: "undo",
      description: "Lift your own last mark off the paper. Only removes marks the agent made; use erase for anything else.",
      inputSchema: { type: "object", properties: {} },
      execute: wrap(() => {
        const item = scene.undo("agent");
        return item ? { removed: item.id, label: item.label } : { removed: null };
      }),
    },
    {
      name: "look",
      description:
        "Look at the paper. Returns every mark with its id, label, author (human or agent), kind, pen and bounding box, plus a coarse character raster of the whole sheet so you can see where ink is. Call this before drawing on a sheet someone else has touched, and after drawing to verify the result.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        await paper.whenIdle();
        return describe(scene);
      },
    },
    {
      name: "new_sheet",
      description: "Take a fresh sheet of paper: blank, grid (50-unit squares) or lined. This clears everything on the current sheet, including the person's marks, so ask before using it mid-conversation.",
      inputSchema: { type: "object", properties: { paper: { type: "string", enum: ["blank", "grid", "lined"] } } },
      execute: wrap((i) => {
        const kind = str(i.paper, scene.paper) as PaperKind;
        if (!["blank", "grid", "lined"].includes(kind)) throw new Error("paper must be blank, grid or lined");
        scene.clear(kind);
        return { paper: kind, items: 0 };
      }),
    },
  ];

  if (mc) for (const tool of tools) await mc.registerTool(tool);
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    connected: mc !== null,
    names: tools.map((t) => t.name),
    call: async (name, input = {}) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`no instrument named ${name}`);
      return tool.execute(input);
    },
  };

  function box(id: string) {
    const item = scene.get(id);
    return item ? describeBox(item) : null;
  }
}

function describeBox(item: Item) {
  const r = bbox(item);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function measure(a: Pt, b: Pt) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { from: a, to: b, length: Math.round(length * 10) / 10, angle: Math.round(angle * 10) / 10 };
}

function pt(v: unknown): Pt {
  if (!v || typeof v !== "object") throw new Error("point must be an object with x and y");
  const o = v as Record<string, unknown>;
  return clampPt({ x: num(o.x), y: num(o.y) });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new Error(`expected a number, got ${JSON.stringify(v)}`);
  return n;
}

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
