// The agent's hands on the desk. Instruments registered through WebMCP.
// Every tool writes to the same scene a person draws on; nothing here is
// agent-only except the pen the agent is currently holding.
//
// Schemas stay inside the JSON Schema subset that chat hosts accept for tool
// definitions: type, properties, required, enum, items, description,
// additionalProperties. Ranges and lengths are validated in code instead.

import { GUIDE } from "./guide.ts";
import { describe } from "./look.ts";
import { THEMES } from "./appearance.ts";
import { smooth, type Paper } from "./paper.ts";
import { bbox, clampPt, PAPER_H, PAPER_W, PEN_PRESETS, type Item, type PaperKind, type Pen, type PenKind, type Pt, type Scene, type StencilShape } from "./scene.ts";

interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: Record<string, unknown>, options?: ExecutionOptions) => Promise<unknown> | unknown;
}

interface ExecutionOptions {
  signal?: AbortSignal;
  source?: "local" | "webmcp";
}

interface ModelContext {
  registerTool(tool: ToolDef, options?: { signal: AbortSignal }): Promise<void> | void;
  getTools?(): Promise<{ name: string }[]>;
  executeTool?(tool: { name: string }, input: string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

function modelContext(): ModelContext | null {
  const d = (document as unknown as { modelContext?: ModelContext }).modelContext;
  if (d && typeof d.registerTool === "function") return d;
  const n = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  if (n && typeof n.registerTool === "function") return n;
  return null;
}

/** Some hosts inject the API shortly after load; wait briefly before giving up. */
async function waitForModelContext(timeoutMs: number): Promise<ModelContext | null> {
  const deadline = Date.now() + timeoutMs;
  let mc = modelContext();
  while (!mc && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    mc = modelContext();
  }
  return mc;
}

// Schema pieces. Plain subset only; see the note at the top of this file.
const point = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
  additionalProperties: false,
};
const pressurePoint = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, p: { type: "number", description: "pressure 0..1, default 0.5" } },
  required: ["x", "y"],
  additionalProperties: false,
};
const path = { type: "array", items: pressurePoint, description: "one pen-down path" };
const label = { type: "string", description: "Short name for this mark, e.g. 'side AB', 'arc from A'." };
const region = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
  required: ["x", "y", "w", "h"],
  additionalProperties: false,
};
const shapeEnum = ["rectangle", "triangle", "polygon"];
const penEnum = ["pencil", "marker", "brush"];

const MAX_PATHS = 64;
const MAX_POINTS = 2000;
const MAX_STEPS = 40;

export interface AgentHooks {
  onActivity: (active: boolean) => void;
  onTool?: (name: string, source: "local" | "webmcp") => void;
}

export interface Desk {
  /** True when every tool was registered with the browser's WebMCP. */
  connected: boolean;
  registrationErrors: string[];
  registered: string[];
  names: string[];
  /** Call an instrument directly, e.g. from the console: desk.call("draw", {...}). */
  call: (name: string, input?: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
  /** Round-trip through the browser's own getTools/executeTool when available. */
  nativeCall?: (name: string, input?: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown>;
  dispose: () => void;
}

/** Builds the desk instruments and registers them with WebMCP when the browser has it. */
export async function registerDesk(scene: Scene, paper: Paper, hooks: AgentHooks, options: { waitMs?: number } = {}): Promise<Desk> {
  const mc = await waitForModelContext(options.waitMs ?? 0);
  const lifetime = new AbortController();
  let pen: Pen = { ...PEN_PRESETS.pencil };

  const wrap = (fn: (input: Record<string, unknown>, signal: AbortSignal) => unknown) => async (input: Record<string, unknown>, options: ExecutionOptions = {}) => {
    const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
    try {
      signal.throwIfAborted();
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("input must be an object");
      return await fn(input, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      return { error: errorMessage(err) };
    } finally {
      if (!paper.busy) hooks.onActivity(false);
    }
  };

  // Instrument actions, shared by the individual tools and by construct.
  const act = {
    pick_pen(i: Record<string, unknown>) {
      const kind = requiredText(i.kind, "kind") as PenKind;
      if (!Object.hasOwn(PEN_PRESETS, kind)) throw new Error("kind must be pencil, marker or brush");
      pen = {
        ...PEN_PRESETS[kind],
        color: i.color === undefined ? pen.color : cssColor(i.color),
        width: i.width === undefined ? PEN_PRESETS[kind].width : ranged(i.width, "width", 1, 24),
        opacity: i.opacity === undefined ? PEN_PRESETS[kind].opacity : ranged(i.opacity, "opacity", 0.05, 1),
      };
      return { pen };
    },
    draw(i: Record<string, unknown>) {
      if (i.points === undefined && i.strokes === undefined) throw new Error("give points (one path) or strokes (several paths)");
      if (i.points !== undefined && i.strokes !== undefined) throw new Error("give either points or strokes, not both");
      const raw = i.strokes ?? [i.points];
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PATHS) throw new Error(`strokes must contain 1..${MAX_PATHS} paths`);
      let count = 0;
      const paths = raw.map((p, n) => {
        if (!Array.isArray(p) || p.length < 1) throw new Error(`path ${n} must contain at least one point`);
        count += p.length;
        if (count > MAX_POINTS) throw new Error(`draw accepts at most ${MAX_POINTS} points per call`);
        return p.map((q, k) => paperPoint(q, `path ${n} point ${k}`, true));
      });
      const item = scene.add({ kind: "stroke", paths: paths.map(smooth) }, { label: requiredText(i.label, "label"), author: "agent", pen });
      return { id: item.id, label: item.label, strokes: paths.length, points: count, bbox: box(item) };
    },
    ruler(i: Record<string, unknown>) {
      const from = paperPoint(i.from, "from");
      const to = paperPoint(i.to, "to");
      if (i.arrow !== undefined && typeof i.arrow !== "boolean") throw new Error("arrow must be true or false");
      const item = scene.add({ kind: "line", from, to, arrow: i.arrow === true }, { label: requiredText(i.label, "label"), author: "agent", pen });
      return { id: item.id, label: item.label, ...measure(from, to) };
    },
    compass(i: Record<string, unknown>) {
      const c = paperPoint(i.center, "center");
      const r = ranged(i.radius, "radius", 1, Math.max(PAPER_W, PAPER_H));
      const startIn = i.start === undefined ? 0 : ranged(i.start, "start", -360, 360);
      const endIn = i.end === undefined ? startIn + 360 : ranged(i.end, "end", -720, 720);
      const span = endIn - startIn;
      if (span === 0 || Math.abs(span) > 360) throw new Error("end minus start must be nonzero and within -360..360");
      const start = ((startIn % 360) + 360) % 360;
      const item = scene.add({ kind: "arc", cx: c.x, cy: c.y, r, start, end: start + span }, { label: requiredText(i.label, "label"), author: "agent", pen });
      return { id: item.id, label: item.label, center: c, radius: r, start, end: start + span, bbox: box(item) };
    },
    stencil(i: Record<string, unknown>) {
      const shape = requiredText(i.shape, "shape") as StencilShape;
      if (!shapeEnum.includes(shape)) throw new Error("shape must be rectangle, triangle or polygon");
      const c = paperPoint({ x: i.x, y: i.y }, "position");
      const item = scene.add(
        {
          kind: "shape",
          shape,
          x: c.x,
          y: c.y,
          w: ranged(i.w, "w", 2, PAPER_W),
          h: ranged(i.h, "h", 2, PAPER_H),
          rotation: i.rotation === undefined ? 0 : ranged(i.rotation, "rotation", -360, 360),
          sides: i.sides === undefined ? 6 : integer(i.sides, "sides", 3, 12),
        },
        { label: requiredText(i.label, "label"), author: "agent", pen },
      );
      return { id: item.id, label: item.label, bbox: box(item) };
    },
    erase(i: Record<string, unknown>) {
      if (i.ids === undefined && i.region === undefined) throw new Error("erase needs ids and/or a region");
      if (i.ids !== undefined && !Array.isArray(i.ids)) throw new Error("ids must be an array of mark ids");
      const ids = new Set<string>((i.ids as unknown[] | undefined)?.map((id, k) => requiredText(id, `ids[${k}]`, 64)) ?? []);
      if (i.region !== undefined) for (const item of scene.inRegion(readRegion(i.region))) ids.add(item.id);
      const removed = scene.remove([...ids]);
      return { removed, remaining: scene.items.length };
    },
    undo() {
      const item = scene.undo("agent");
      return item ? { removed: item.id, label: item.label } : { removed: null };
    },
  };
  type Action = keyof typeof act;
  const actionNames = Object.keys(act) as Action[];

  const tools: ToolDef[] = [
    {
      name: "guide",
      annotations: { readOnlyHint: true },
      description: "Read how the desk works: coordinates, instruments, lettering, and ruler-and-compass recipes. Call once at the start of a session before drawing.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: wrap(() => ({ guide: GUIDE, tools: tools.map((t) => t.name) })),
    },
    {
      name: "look",
      annotations: { readOnlyHint: true },
      description:
        "Look at the sheet. Returns every mark (id, label, author human|agent, kind, pen, bounding box), the pen in hand, and a 48x32 character map of where ink is. Call before drawing on a sheet someone touched, and after drawing to verify. Optional region filters marks; detail adds sampled geometry.",
      inputSchema: {
        type: "object",
        properties: {
          region: { ...region, description: "only marks touching this rectangle" },
          detail: { type: "boolean", description: "include sampled point geometry" },
          wait: { type: "boolean", description: "default true: wait for ink in motion to settle first" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      execute: wrap(async (i, signal) => {
        for (const f of ["detail", "wait"]) if (i[f] !== undefined && typeof i[f] !== "boolean") throw new Error(`${f} must be true or false`);
        const offset = i.offset === undefined ? 0 : integer(i.offset, "offset", 0, Number.MAX_SAFE_INTEGER);
        const limit = i.limit === undefined ? (i.detail ? 10 : 60) : integer(i.limit, "limit", 1, 100);
        const reg = i.region === undefined ? undefined : readRegion(i.region);
        if (i.wait !== false) await paper.whenIdle(signal);
        const theme = paper.theme ?? "charcoal";
        return {
          ...describe(scene, { region: reg, detail: i.detail === true, offset, limit }),
          appearance: { theme, background: THEMES[theme].paper, defaultInk: THEMES[theme].ink },
          pen: { ...pen },
          drawing: paper.busy,
        };
      }),
    },
    {
      name: "measure",
      annotations: { readOnlyHint: true },
      description: "Hold the ruler between two points without drawing. Returns distance in paper units and angle in degrees.",
      inputSchema: { type: "object", properties: { from: point, to: point }, required: ["from", "to"], additionalProperties: false },
      execute: wrap((i) => measure(paperPoint(i.from, "from"), paperPoint(i.to, "to"))),
    },
    {
      name: "pick_pen",
      annotations: { readOnlyHint: false },
      description: "Pick up a pen: pencil (thin, for construction lines), marker (bold, for the final figure) or brush (soft, pressure-sensitive). Optional color (CSS color or 'auto' for theme ink), width 1..24, opacity 0.05..1. Stays in hand for later calls.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: penEnum },
          color: { type: "string", description: "'auto' or a CSS color like #dc716b" },
          width: { type: "number" },
          opacity: { type: "number" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
      execute: wrap(act.pick_pen),
    },
    {
      name: "draw",
      annotations: { readOnlyHint: false },
      description: `Freehand with the pen in hand on the ${PAPER_W}x${PAPER_H} sheet (origin top-left). Give points for one stroke, or strokes for several pen-down paths that form one mark (a letter, a word, a sketch). Each point may carry pressure p 0..1. Sparse points are smoothed into a curve. Use ruler and compass for exact lines and circles.`,
      inputSchema: {
        type: "object",
        properties: {
          points: { ...path, description: "one continuous stroke" },
          strokes: { type: "array", items: path, description: "several paths, pen lifted between them" },
          label,
        },
        required: ["label"],
        additionalProperties: false,
      },
      execute: wrap(act.draw),
    },
    {
      name: "ruler",
      annotations: { readOnlyHint: false },
      description: "Draw one straight line from one point to another with the pen in hand. arrow: true adds an arrowhead at 'to'. Returns length and angle.",
      inputSchema: { type: "object", properties: { from: point, to: point, arrow: { type: "boolean" }, label }, required: ["from", "to", "label"], additionalProperties: false },
      execute: wrap(act.ruler),
    },
    {
      name: "compass",
      annotations: { readOnlyHint: false },
      description: "Draw a circle or arc with the pen in hand. Degrees: 0 right, 90 down, clockwise. Omit start and end for a full circle; give both for an arc (span within -360..360).",
      inputSchema: {
        type: "object",
        properties: { center: point, radius: { type: "number" }, start: { type: "number" }, end: { type: "number" }, label },
        required: ["center", "radius", "label"],
        additionalProperties: false,
      },
      execute: wrap(act.compass),
    },
    {
      name: "stencil",
      annotations: { readOnlyHint: false },
      description: "Trace a shape stencil with the pen in hand: rectangle, triangle (apex up) or regular polygon (sides 3..12). x,y is the center; w,h the size; rotation in degrees clockwise.",
      inputSchema: {
        type: "object",
        properties: {
          shape: { type: "string", enum: shapeEnum },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          rotation: { type: "number" },
          sides: { type: "number" },
          label,
        },
        required: ["shape", "x", "y", "w", "h", "label"],
        additionalProperties: false,
      },
      execute: wrap(act.stencil),
    },
    {
      name: "erase",
      annotations: { readOnlyHint: false },
      description: "Rub out marks by id (from look or earlier results) and/or every mark touching a rectangular region. This removes the person's marks too, so look first.",
      inputSchema: {
        type: "object",
        properties: { ids: { type: "array", items: { type: "string" } }, region },
        additionalProperties: false,
      },
      execute: wrap(act.erase),
    },
    {
      name: "undo",
      annotations: { readOnlyHint: false },
      description: "Lift your own last mark off the paper. Only removes marks the agent made.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: wrap(act.undo),
    },
    {
      name: "new_sheet",
      annotations: { readOnlyHint: false },
      description: "Take a fresh sheet: blank, grid (50-unit squares) or lined. Clears everything including the person's marks, so ask first.",
      inputSchema: { type: "object", properties: { paper: { type: "string", enum: ["blank", "grid", "lined"] } }, additionalProperties: false },
      execute: wrap((i) => {
        const kind = i.paper === undefined ? scene.paper : (requiredText(i.paper, "paper") as PaperKind);
        if (!["blank", "grid", "lined"].includes(kind)) throw new Error("paper must be blank, grid or lined");
        scene.clear(kind);
        return { paper: kind, items: 0 };
      }),
    },
    {
      name: "construct",
      annotations: { readOnlyHint: false },
      description: `Do several instrument steps in one call, in order: up to ${MAX_STEPS} steps of pick_pen, draw, ruler, compass, stencil, erase or undo. Each step names its tool and carries that tool's fields. Use it for a whole construction or a labeled figure; stops at the first invalid step and reports what was done.`,
      inputSchema: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", enum: actionNames },
                label,
                kind: { type: "string", enum: penEnum },
                color: { type: "string" },
                width: { type: "number" },
                opacity: { type: "number" },
                points: path,
                strokes: { type: "array", items: path },
                from: point,
                to: point,
                arrow: { type: "boolean" },
                center: point,
                radius: { type: "number" },
                start: { type: "number" },
                end: { type: "number" },
                shape: { type: "string", enum: shapeEnum },
                x: { type: "number" },
                y: { type: "number" },
                w: { type: "number" },
                h: { type: "number" },
                rotation: { type: "number" },
                sides: { type: "number" },
                ids: { type: "array", items: { type: "string" } },
                region,
              },
              required: ["tool"],
              additionalProperties: false,
            },
          },
        },
        required: ["steps"],
        additionalProperties: false,
      },
      execute: wrap((i) => {
        if (!Array.isArray(i.steps) || i.steps.length < 1 || i.steps.length > MAX_STEPS) throw new Error(`steps must contain 1..${MAX_STEPS} steps`);
        const results: unknown[] = [];
        for (const [n, step] of (i.steps as unknown[]).entries()) {
          if (!step || typeof step !== "object" || Array.isArray(step)) return { done: n, results, error: `step ${n} must be an object` };
          const { tool, ...args } = step as Record<string, unknown>;
          if (typeof tool !== "string" || !actionNames.includes(tool as Action)) return { done: n, results, error: `step ${n}: tool must be one of ${actionNames.join(", ")}` };
          try {
            results.push({ step: n, tool, ...(act[tool as Action](args) as object) });
          } catch (err) {
            return { done: n, results, error: `step ${n} (${tool}): ${errorMessage(err)}` };
          }
        }
        return { done: results.length, results };
      }),
    },
  ];

  for (const tool of tools) {
    const execute = tool.execute;
    tool.execute = (input, options) => {
      hooks.onTool?.(tool.name, options?.source ?? "webmcp");
      if (!tool.annotations.readOnlyHint) hooks.onActivity(true);
      return execute(input, options);
    };
  }

  const registrationErrors: string[] = [];
  const registered: string[] = [];
  if (mc) {
    for (const tool of tools) {
      try {
        await mc.registerTool(tool, { signal: lifetime.signal });
        registered.push(tool.name);
      } catch (error) {
        registrationErrors.push(`${tool.name}: ${errorMessage(error)}`);
      }
    }
  }
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    connected: mc !== null && registrationErrors.length === 0,
    registrationErrors,
    registered,
    names: tools.map((t) => t.name),
    dispose: () => lifetime.abort(),
    nativeCall: mc?.getTools && mc.executeTool
      ? async (name, input = {}, options) => {
          const tool = (await mc.getTools!()).find((t) => t.name === name);
          if (!tool) throw new Error(`WebMCP instrument unavailable: ${name}`);
          const result = await mc.executeTool!(tool, JSON.stringify(input), options);
          if (typeof result !== "string") return result;
          try {
            return JSON.parse(result);
          } catch {
            return result;
          }
        }
      : undefined,
    call: async (name, input = {}, options) => {
      const tool = byName.get(name);
      if (!tool) throw new Error(`no instrument named ${name}`);
      return tool.execute(input, { ...options, source: "local" });
    },
  };
}

function box(item: Item) {
  const r = bbox(item);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function measure(a: Pt, b: Pt) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { from: a, to: b, length: Math.round(length * 10) / 10, angle: Math.round(angle * 10) / 10 };
}

function paperPoint(v: unknown, name: string, pressure = false): Pt {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error(`${name} must be an object with x and y`);
  const o = v as Record<string, unknown>;
  const p: Pt = { x: ranged(o.x, `${name}.x`, 0, PAPER_W), y: ranged(o.y, `${name}.y`, 0, PAPER_H) };
  if (pressure && o.p !== undefined) p.p = ranged(o.p, `${name}.p`, 0, 1);
  return clampPt(p);
}

function number(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${name} must be a finite number`);
  return v;
}

function ranged(v: unknown, name: string, min: number, max: number): number {
  const n = number(v, name);
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}

function integer(v: unknown, name: string, min: number, max: number): number {
  const n = ranged(v, name, min, max);
  if (!Number.isInteger(n)) throw new Error(`${name} must be a whole number`);
  return n;
}

function requiredText(v: unknown, name: string, max = 120): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${name} must be a non-empty string`);
  const value = v.trim();
  if (value.length > max) throw new Error(`${name} must be no more than ${max} characters`);
  return value;
}

function cssColor(v: unknown): string {
  const color = requiredText(v, "color", 64);
  if (color === "auto") return color;
  if (/var\(|currentcolor|^(inherit|initial|unset|revert|revert-layer)$/i.test(color)) throw new Error("color must be a CSS color or 'auto'");
  if (typeof CSS !== "undefined" && !CSS.supports("color", color)) throw new Error("color must be a valid CSS color");
  return color;
}

function readRegion(v: unknown) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("region must be an object with x, y, w and h");
  const r = v as Record<string, unknown>;
  const w = number(r.w, "region.w");
  const h = number(r.h, "region.h");
  if (w <= 0 || h <= 0) throw new Error("region w and h must be greater than 0");
  return { x: number(r.x, "region.x"), y: number(r.y, "region.y"), w, h };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
