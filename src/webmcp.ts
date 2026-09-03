// The agent's hands on the desk. Instruments registered through WebMCP.
// Every tool writes to the same scene a person draws on; nothing here is
// agent-only except the pen the agent is currently holding.
//
// Schemas stay inside the JSON Schema subset that chat hosts accept for tool
// definitions: type, properties, required, enum, items, description,
// additionalProperties. Ranges and lengths are validated in code instead.

import { GUIDE } from "./guide.ts";
import { intersections, properties } from "./geometry.ts";
import { describe } from "./look.ts";
import { substitute, type ParamValue } from "./recipes.ts";
import { THEMES } from "./appearance.ts";
import { smooth, type Paper } from "./paper.ts";
import {
  bbox,
  clampPt,
  PALETTE,
  PAPER_H,
  PAPER_W,
  PEN_PRESETS,
  transformItem,
  type Item,
  type PaperKind,
  type Pen,
  type PenKind,
  type Pt,
  type Scene,
  type StencilShape,
} from "./scene.ts";

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
const group = { type: "string", description: "Optional group name shared by related marks, e.g. 'triangle ABC'." };
const region = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
  required: ["x", "y", "w", "h"],
  additionalProperties: false,
};
const penKinds = Object.keys(PEN_PRESETS);
const pen = {
  type: "object",
  description:
    "Pen for this mark: kind, or brush (a name you made with make), color by name (ink, accent, blue, green, ochre) or hex, width 1..24, opacity 0.05..1, dash for construction lines, texture grain|chalk, taper for thin ends, fill hatch|crosshatch|stipple for closed shapes and circles, hatchAngle.",
  properties: {
    kind: { type: "string", enum: penKinds },
    brush: { type: "string", description: "name of a brush made with make" },
    color: { type: "string" },
    width: { type: "number" },
    opacity: { type: "number" },
    dash: { type: "boolean" },
    texture: { type: "string", enum: ["grain", "chalk", "none"] },
    taper: { type: "boolean" },
    fill: { type: "string", enum: ["hatch", "crosshatch", "stipple", "none"] },
    hatchAngle: { type: "number" },
  },
  additionalProperties: false,
};
const recipeArgs = {
  type: "array",
  description: "parameter values: {name, x, y} for a point, {name, value} for a number, {name, text} for text",
  items: {
    type: "object",
    properties: { name: { type: "string" }, x: { type: "number" }, y: { type: "number" }, value: { type: "number" }, text: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
};
const MAX_RECIPE_DEPTH = 3;
const shapeEnum = ["rectangle", "triangle", "polygon"];
const ids = { type: "array", items: { type: "string" }, description: "mark ids" };

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
  let held: Pen = { ...PEN_PRESETS.pencil };
  let guideRead = false;
  // Tools the agent made for itself this session.
  const brushes = new Map<string, { pen: Pen; description: string }>();
  const recipes = new Map<string, { params: string[]; steps: Record<string, unknown>[]; description: string }>();
  const resolvePen = (base: Pen, input: unknown): Pen => resolvePenWith(base, input, brushes);
  // Ids present at the agent's last look, so the next look can say what changed.
  let seen: Map<string, Item> | null = null;

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

  /** The pen for one mark: the held pen, overridden by an inline pen. */
  const penFor = (i: Record<string, unknown>): Pen => (i.pen === undefined ? held : resolvePen(held, i.pen));
  const meta = (i: Record<string, unknown>, fallback: string) => ({
    label: i.label === undefined ? fallback : requiredText(i.label, "label"),
    author: "agent" as const,
    pen: penFor(i),
    group: i.group === undefined ? undefined : requiredText(i.group, "group", 64),
  });

  const select = (i: Record<string, unknown>): Item[] => {
    if (i.ids === undefined && i.group === undefined && i.region === undefined) throw new Error("select marks with ids, group and/or region");
    const picked = new Map<string, Item>();
    if (i.ids !== undefined) {
      if (!Array.isArray(i.ids)) throw new Error("ids must be an array of mark ids");
      for (const [k, id] of i.ids.entries()) {
        const name = requiredText(id, `ids[${k}]`, 64);
        const item = scene.get(name);
        if (!item) throw new Error(`no mark with id ${name}; call look to see ids`);
        picked.set(item.id, item);
      }
    }
    if (i.group !== undefined) {
      const g = requiredText(i.group, "group", 64);
      for (const item of scene.items) if (item.group === g) picked.set(item.id, item);
    }
    if (i.region !== undefined) for (const item of scene.inRegion(readRegion(i.region))) picked.set(item.id, item);
    return [...picked.values()];
  };

  // Instrument actions, shared by the individual tools and by construct.
  const act = {
    pick_pen(i: Record<string, unknown>) {
      held = resolvePen(held, i.pen === undefined ? i : i.pen);
      return { pen: held };
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
      const item = scene.add({ kind: "stroke", paths: paths.map(smooth) }, meta(i, "stroke"));
      return { id: item.id, label: item.label, strokes: paths.length, points: count, bbox: box(item) };
    },
    ruler(i: Record<string, unknown>) {
      const from = paperPoint(i.from, "from");
      const to = paperPoint(i.to, "to");
      if (i.arrow !== undefined && typeof i.arrow !== "boolean") throw new Error("arrow must be true or false");
      const item = scene.add({ kind: "line", from, to, arrow: i.arrow === true }, meta(i, "line"));
      return { id: item.id, label: item.label, ...measureBetween(from, to) };
    },
    compass(i: Record<string, unknown>) {
      const c = paperPoint(i.center, "center");
      const r = ranged(i.radius, "radius", 1, Math.max(PAPER_W, PAPER_H));
      const startIn = i.start === undefined ? 0 : ranged(i.start, "start", -360, 360);
      const endIn = i.end === undefined ? startIn + 360 : ranged(i.end, "end", -720, 720);
      const span = endIn - startIn;
      if (span === 0 || Math.abs(span) > 360) throw new Error("end minus start must be nonzero and within -360..360");
      const start = ((startIn % 360) + 360) % 360;
      const item = scene.add({ kind: "arc", cx: c.x, cy: c.y, r, start, end: start + span }, meta(i, "circle"));
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
        meta(i, shape),
      );
      return { id: item.id, label: item.label, bbox: box(item) };
    },
    edit(i: Record<string, unknown>) {
      const targets = select(i);
      if (targets.length === 0) return { edited: [], note: "nothing matched" };
      const t = {
        dx: i.dx === undefined ? undefined : ranged(i.dx, "dx", -PAPER_W, PAPER_W),
        dy: i.dy === undefined ? undefined : ranged(i.dy, "dy", -PAPER_H, PAPER_H),
        scale: i.scale === undefined ? undefined : ranged(i.scale, "scale", 0.05, 20),
        rotate: i.rotate === undefined ? undefined : ranged(i.rotate, "rotate", -360, 360),
        about: i.about === undefined ? undefined : paperPoint(i.about, "about"),
      };
      const moving = t.dx !== undefined || t.dy !== undefined || t.scale !== undefined || t.rotate !== undefined;
      const newPen = i.pen === undefined ? null : i.pen;
      const newLabel = i.label === undefined ? null : requiredText(i.label, "label");
      const newGroup = i.regroup === undefined ? null : requiredText(i.regroup, "regroup", 64);
      if (!moving && newPen === null && newLabel === null && newGroup === null && i.duplicate !== true) {
        throw new Error("edit needs something to change: pen, dx/dy, scale, rotate, label, regroup or duplicate");
      }
      // Duplicates are edited copies; originals stay untouched.
      let subjects = targets;
      if (i.duplicate === true) {
        subjects = targets.map((item) => {
          const { id: _id, ...rest } = item;
          return scene.add(rest, { label: item.label, author: "agent", pen: item.pen, group: item.group });
        });
      }
      const edited = subjects.map((item) => {
        let next: Item = moving ? transformItem(item, t) : { ...item };
        if (newPen !== null) next = { ...next, pen: resolvePen(next.pen, newPen) };
        if (newLabel !== null) next = { ...next, label: newLabel };
        if (newGroup !== null) next = { ...next, group: newGroup };
        return next;
      });
      const ids = scene.update(edited);
      return { edited: ids, duplicated: i.duplicate === true, marks: edited.map((item) => ({ id: item.id, label: item.label, bbox: box(item) })) };
    },
    erase(i: Record<string, unknown>) {
      const removed = scene.remove(select(i).map((item) => item.id));
      return { removed, remaining: scene.items.length };
    },
    undo() {
      const item = scene.undo("agent");
      return item ? { removed: item.id, label: item.label } : { removed: null };
    },
    recipe(i: Record<string, unknown>, depth = 0) {
      const name = requiredText(i.name, "name", 64);
      const recipe = recipes.get(name);
      if (!recipe) throw new Error(`no recipe named ${name}; make it first or check look.custom`);
      if (depth >= MAX_RECIPE_DEPTH) throw new Error("recipes may nest at most 3 deep");
      const params: Record<string, ParamValue> = {};
      for (const [k, arg] of (Array.isArray(i.args) ? i.args : []).entries()) {
        if (!arg || typeof arg !== "object") throw new Error(`args[${k}] must be an object`);
        const a = arg as Record<string, unknown>;
        const pname = requiredText(a.name, `args[${k}].name`, 64);
        if (a.x !== undefined || a.y !== undefined) params[pname] = paperPoint({ x: a.x, y: a.y }, pname);
        else if (a.value !== undefined) params[pname] = number(a.value, pname);
        else if (a.text !== undefined) params[pname] = requiredText(a.text, pname);
        else throw new Error(`args[${k}] needs x and y, value, or text`);
      }
      const missing = recipe.params.filter((p) => !(p in params));
      if (missing.length) throw new Error(`recipe ${name} needs ${missing.map((m) => "$" + m).join(", ")}`);
      const results: unknown[] = [];
      for (const [n, raw] of recipe.steps.entries()) {
        const step = substitute(raw, params) as Record<string, unknown>;
        const { tool, ...args } = step;
        if (tool === "recipe") {
          results.push({ step: n, tool, ...(act.recipe(args, depth + 1) as object) });
          continue;
        }
        if (typeof tool !== "string" || !(tool in act) || tool === "recipe") throw new Error(`recipe ${name} step ${n}: unknown tool ${String(tool)}`);
        results.push({ step: n, tool, ...((act as Record<string, (a: Record<string, unknown>) => unknown>)[tool](args) as object) });
      }
      return { recipe: name, done: results.length, results };
    },
  };
  type Action = keyof typeof act;
  const actionNames = Object.keys(act) as Action[];

  const lookAt = async (i: Record<string, unknown>, signal: AbortSignal) => {
    for (const f of ["detail", "wait"]) if (i[f] !== undefined && typeof i[f] !== "boolean") throw new Error(`${f} must be true or false`);
    const offset = i.offset === undefined ? 0 : integer(i.offset, "offset", 0, Number.MAX_SAFE_INTEGER);
    const limit = i.limit === undefined ? (i.detail ? 10 : 60) : integer(i.limit, "limit", 1, 100);
    const reg = i.region === undefined ? undefined : readRegion(i.region);
    // The scene is final the moment a mark is added; the reveal is cosmetic.
    // Waiting is opt-in and capped so a tool result never stalls on animation.
    if (i.wait === true) await paper.whenIdle(signal, 3000);
    const theme = paper.theme ?? "charcoal";
    const view = describe(scene, { region: reg, detail: i.detail === true, offset, limit });
    const changes = seen === null ? null : diffSince(seen, scene.items);
    seen = new Map(scene.items.map((item) => [item.id, item]));
    const first = !guideRead;
    guideRead = true;
    return {
      ...view,
      changes,
      appearance: { theme, background: THEMES[theme].paper, defaultInk: THEMES[theme].ink },
      pen: { ...held },
      custom: {
        brushes: [...brushes].map(([name, b]) => ({ name, description: b.description })),
        recipes: [...recipes].map(([name, r]) => ({ name, params: r.params, description: r.description })),
      },
      drawing: paper.busy,
      ...(first ? { guide: GUIDE } : {}),
    };
  };

  const tools: ToolDef[] = [
    {
      name: "guide",
      annotations: { readOnlyHint: true },
      description: "Read how the desk works: coordinates, instruments, pens, lettering, and ruler-and-compass recipes. The first look of a session includes this too.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: wrap(() => {
        guideRead = true;
        return { guide: GUIDE, tools: tools.map((t) => t.name) };
      }),
    },
    {
      name: "look",
      annotations: { readOnlyHint: true },
      description:
        "Look at the sheet: every mark (id, label, group, author human|agent, kind, pen, bounding box), what changed since your last look, the pen in hand, and a 48x32 map of where ink is. The first look also returns the guide. Look once before drawing and once after a figure, not after every mark. Optional region filters marks; detail adds sampled geometry.",
      inputSchema: {
        type: "object",
        properties: {
          region: { ...region, description: "only marks touching this rectangle" },
          detail: { type: "boolean", description: "include sampled point geometry" },
          wait: { type: "boolean", description: "true to wait (up to 3s) for ink in motion to settle first; the mark list is exact either way" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      execute: wrap(lookAt),
    },
    {
      name: "measure",
      annotations: { readOnlyHint: true },
      description:
        "Exact geometry without ink. Give from and to for distance and angle between points; of for one mark's length, midpoint, center, radius or vertices; a and b for the exact crossing points of two marks (lines, arcs, circles, shapes, strokes). Use it to find construction points instead of estimating.",
      inputSchema: {
        type: "object",
        properties: {
          from: point,
          to: point,
          of: { type: "string", description: "a mark id" },
          a: { type: "string", description: "first mark id" },
          b: { type: "string", description: "second mark id" },
        },
        additionalProperties: false,
      },
      execute: wrap((i) => {
        if (i.a !== undefined || i.b !== undefined) {
          const a = mark(requiredText(i.a, "a", 64));
          const b = mark(requiredText(i.b, "b", 64));
          const points = intersections(a, b);
          return { a: a.id, b: b.id, crossings: points, note: points.length ? undefined : "these marks do not cross" };
        }
        if (i.of !== undefined) {
          const item = mark(requiredText(i.of, "of", 64));
          return { id: item.id, label: item.label, ...properties(item), bbox: box(item) };
        }
        if (i.from === undefined || i.to === undefined) throw new Error("give from and to, or of, or a and b");
        return measureBetween(paperPoint(i.from, "from"), paperPoint(i.to, "to"));
      }),
    },
    {
      name: "pick_pen",
      annotations: { readOnlyHint: false },
      description: "Set the default pen for later marks: pencil, fineliner, marker, brush or highlighter, with color (ink, accent, blue, green, ochre or hex), width, opacity and dash. Any mark can also carry its own inline pen instead.",
      inputSchema: { type: "object", properties: pen.properties, required: ["kind"], additionalProperties: false },
      execute: wrap(act.pick_pen),
    },
    {
      name: "draw",
      annotations: { readOnlyHint: false },
      description: `Freehand on the ${PAPER_W}x${PAPER_H} sheet (origin top-left). Give points for one stroke, or strokes for several pen-down paths that form one mark (a letter, a word, a sketch). Each point may carry pressure p 0..1. Sparse points are smoothed into a curve. Use ruler and compass for exact lines and circles.`,
      inputSchema: {
        type: "object",
        properties: { points: { ...path, description: "one continuous stroke" }, strokes: { type: "array", items: path, description: "several paths, pen lifted between them" }, label, group, pen },
        required: ["label"],
        additionalProperties: false,
      },
      execute: wrap(act.draw),
    },
    {
      name: "ruler",
      annotations: { readOnlyHint: false },
      description: "Draw one straight line from one point to another. arrow: true adds an arrowhead at 'to'. Returns length and angle.",
      inputSchema: { type: "object", properties: { from: point, to: point, arrow: { type: "boolean" }, label, group, pen }, required: ["from", "to", "label"], additionalProperties: false },
      execute: wrap(act.ruler),
    },
    {
      name: "compass",
      annotations: { readOnlyHint: false },
      description: "Draw a circle or arc. Degrees: 0 right, 90 down, clockwise. Omit start and end for a full circle; give both for an arc (span within -360..360).",
      inputSchema: {
        type: "object",
        properties: { center: point, radius: { type: "number" }, start: { type: "number" }, end: { type: "number" }, label, group, pen },
        required: ["center", "radius", "label"],
        additionalProperties: false,
      },
      execute: wrap(act.compass),
    },
    {
      name: "stencil",
      annotations: { readOnlyHint: false },
      description: "Trace a shape stencil: rectangle, triangle (apex up) or regular polygon (sides 3..12). x,y is the center; w,h the size; rotation in degrees clockwise.",
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
          group,
          pen,
        },
        required: ["shape", "x", "y", "w", "h", "label"],
        additionalProperties: false,
      },
      execute: wrap(act.stencil),
    },
    {
      name: "edit",
      annotations: { readOnlyHint: false },
      description:
        "Change existing marks without redrawing. Select by ids, group and/or region, then any of: pen (restyle), dx/dy (move), scale (about a point, default the mark's center), rotate (degrees clockwise), label, regroup, duplicate (edit copies, keep originals). Returns the edited ids and bounds.",
      inputSchema: {
        type: "object",
        properties: {
          ids,
          group,
          region,
          pen,
          dx: { type: "number" },
          dy: { type: "number" },
          scale: { type: "number" },
          rotate: { type: "number" },
          about: point,
          label,
          regroup: { type: "string", description: "new group name for the selected marks" },
          duplicate: { type: "boolean" },
        },
        additionalProperties: false,
      },
      execute: wrap(act.edit),
    },
    {
      name: "erase",
      annotations: { readOnlyHint: false },
      description: "Rub out marks selected by ids, group and/or every mark touching a rectangular region. This removes the person's marks too, so look first.",
      inputSchema: { type: "object", properties: { ids, group, region }, additionalProperties: false },
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
      name: "make",
      annotations: { readOnlyHint: false },
      description:
        "Make your own tool for this session. kind brush: a named pen you design (kind, color, width, opacity, dash, texture grain|chalk, taper, fill hatch|crosshatch|stipple) and then use anywhere as pen: { brush: name }. kind recipe: a named list of construct steps with parameters, written as JSON text in steps; any number in a step may be an expression over $params such as \"($A.x+$B.x)/2\" or \"hypot($B.x-$A.x,$B.y-$A.y)/2\" (functions: sqrt abs min max hypot sin cos tan atan2 round). Use a recipe as a construct step { tool: recipe, name, args }. Making a name again replaces it.",
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["brush", "recipe"] },
          name: { type: "string", description: "short identifier, e.g. inkwash, bisector" },
          description: { type: "string", description: "what it is for, shown in look.custom" },
          pen,
          params: { type: "array", items: { type: "string" }, description: "recipe parameter names, e.g. [\"A\", \"B\"]" },
          steps: { type: "string", description: "recipe only: JSON text of an array of construct steps using $params" },
        },
        required: ["kind", "name"],
        additionalProperties: false,
      },
      execute: wrap((i) => {
        const kind = requiredText(i.kind, "kind");
        const name = requiredText(i.name, "name", 64);
        if (!/^[a-z][a-z0-9_-]*$/i.test(name)) throw new Error("name must be letters, digits, _ or -");
        const description = i.description === undefined ? "" : requiredText(i.description, "description", 200);
        if (kind === "brush") {
          if (i.pen === undefined) throw new Error("a brush needs a pen");
          const made = { ...resolvePen(held, i.pen), brush: name };
          brushes.set(name, { pen: made, description });
          return { made: "brush", name, pen: made, use: { pen: { brush: name } } };
        }
        if (kind !== "recipe") throw new Error("kind must be brush or recipe");
        if (typeof i.steps !== "string") throw new Error("a recipe needs steps as JSON text");
        let parsed: unknown;
        try {
          parsed = JSON.parse(i.steps);
        } catch (err) {
          throw new Error(`steps is not valid JSON: ${errorMessage(err)}`);
        }
        if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > MAX_STEPS) throw new Error(`steps must be a JSON array of 1..${MAX_STEPS} steps`);
        const steps = parsed.map((s, n) => {
          if (!s || typeof s !== "object" || Array.isArray(s)) throw new Error(`step ${n} must be an object`);
          const tool = (s as Record<string, unknown>).tool;
          if (typeof tool !== "string" || !actionNames.includes(tool as Action)) throw new Error(`step ${n}: tool must be one of ${actionNames.join(", ")}`);
          return s as Record<string, unknown>;
        });
        const params = Array.isArray(i.params) ? i.params.map((p, k) => requiredText(p, `params[${k}]`, 32)) : [];
        recipes.set(name, { params, steps, description });
        return { made: "recipe", name, params, steps: steps.length, use: { tool: "recipe", name, args: params.map((p) => ({ name: p, x: 0, y: 0 })) } };
      }),
    },
    {
      name: "construct",
      annotations: { readOnlyHint: false },
      description: `The main way to draw: up to ${MAX_STEPS} instrument steps in one call, in order. Each step names its tool (pick_pen, draw, ruler, compass, stencil, edit, erase, undo, or recipe with name and args) and carries that tool's fields, plus an optional inline pen and group. verify: true appends a look to the result so you can check the figure without another call. Stops at the first invalid step and reports what was done.`,
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
                group,
                pen,
                kind: { type: "string", enum: penKinds },
                color: { type: "string" },
                width: { type: "number" },
                opacity: { type: "number" },
                dash: { type: "boolean" },
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
                ids,
                region,
                dx: { type: "number" },
                dy: { type: "number" },
                scale: { type: "number" },
                rotate: { type: "number" },
                about: point,
                regroup: { type: "string" },
                duplicate: { type: "boolean" },
                name: { type: "string", description: "recipe name" },
                args: recipeArgs,
              },
              required: ["tool"],
              additionalProperties: false,
            },
          },
          verify: { type: "boolean", description: "append a look to the result" },
        },
        required: ["steps"],
        additionalProperties: false,
      },
      execute: wrap(async (i, signal) => {
        if (!Array.isArray(i.steps) || i.steps.length < 1 || i.steps.length > MAX_STEPS) throw new Error(`steps must contain 1..${MAX_STEPS} steps`);
        if (i.verify !== undefined && typeof i.verify !== "boolean") throw new Error("verify must be true or false");
        const results: unknown[] = [];
        let error: string | undefined;
        for (const [n, step] of (i.steps as unknown[]).entries()) {
          if (!step || typeof step !== "object" || Array.isArray(step)) {
            error = `step ${n} must be an object`;
            break;
          }
          const { tool, ...args } = step as Record<string, unknown>;
          if (typeof tool !== "string" || !actionNames.includes(tool as Action)) {
            error = `step ${n}: tool must be one of ${actionNames.join(", ")}`;
            break;
          }
          try {
            results.push({ step: n, tool, ...(act[tool as Action](args) as object) });
          } catch (err) {
            error = `step ${n} (${tool}): ${errorMessage(err)}`;
            break;
          }
        }
        const out: Record<string, unknown> = { done: results.length, results };
        if (error) out.error = error;
        if (i.verify === true) out.sheet = await lookAt({}, signal);
        return out;
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

  function mark(id: string): Item {
    const item = scene.get(id);
    if (!item) throw new Error(`no mark with id ${id}; call look to see ids`);
    return item;
  }
}

/** What a person did since the agent last looked. */
function diffSince(seen: Map<string, Item>, items: Item[]) {
  const now = new Set(items.map((i) => i.id));
  const added = items.filter((i) => !seen.has(i.id));
  return {
    added: added.map((i) => ({ id: i.id, label: i.label, author: i.author, kind: i.kind, bbox: box(i) })),
    removed: [...seen.keys()].filter((id) => !now.has(id)),
  };
}

/** Merge pen fields onto a base pen; brush or kind resets to that pen first. */
function resolvePenWith(base: Pen, input: unknown, brushes: Map<string, { pen: Pen }>): Pen {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("pen must be an object");
  const i = input as Record<string, unknown>;
  let next: Pen = { ...base };
  if (i.brush !== undefined) {
    const name = requiredText(i.brush, "brush", 64);
    const made = brushes.get(name);
    if (!made) throw new Error(`no brush named ${name}; make it first or check look.custom`);
    next = { ...made.pen };
  }
  if (i.kind !== undefined) {
    const kind = requiredText(i.kind, "kind") as PenKind;
    if (!Object.hasOwn(PEN_PRESETS, kind)) throw new Error(`kind must be one of ${penKinds.join(", ")}`);
    next = { ...PEN_PRESETS[kind], color: kind === "highlighter" ? PEN_PRESETS.highlighter.color : next.color, dash: next.dash, texture: next.texture, taper: next.taper, fill: next.fill, hatchAngle: next.hatchAngle };
    delete next.brush;
  }
  if (i.color !== undefined) next.color = cssColor(i.color);
  if (i.width !== undefined) next.width = ranged(i.width, "width", 1, 24);
  if (i.opacity !== undefined) next.opacity = ranged(i.opacity, "opacity", 0.05, 1);
  for (const flag of ["dash", "taper"] as const) {
    if (i[flag] === undefined) continue;
    if (typeof i[flag] !== "boolean") throw new Error(`${flag} must be true or false`);
    next[flag] = i[flag] as boolean;
  }
  if (i.texture !== undefined) {
    const t = requiredText(i.texture, "texture");
    if (!["grain", "chalk", "none"].includes(t)) throw new Error("texture must be grain, chalk or none");
    next.texture = t === "none" ? undefined : (t as Pen["texture"]);
  }
  if (i.fill !== undefined) {
    const f = requiredText(i.fill, "fill");
    if (!["hatch", "crosshatch", "stipple", "none"].includes(f)) throw new Error("fill must be hatch, crosshatch, stipple or none");
    next.fill = f === "none" ? undefined : (f as Pen["fill"]);
  }
  if (i.hatchAngle !== undefined) next.hatchAngle = ranged(i.hatchAngle, "hatchAngle", -180, 180);
  for (const key of ["dash", "taper", "texture", "fill", "hatchAngle", "brush"] as const) if (next[key] === undefined || next[key] === false) delete next[key];
  return next;
}

function box(item: Item) {
  const r = bbox(item);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
}

function measureBetween(a: Pt, b: Pt) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return { from: a, to: b, length: Math.round(length * 10) / 10, angle: Math.round(angle * 10) / 10, midpoint: { x: Math.round((a.x + b.x) * 5) / 10, y: Math.round((a.y + b.y) * 5) / 10 } };
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
  const named = PALETTE[color.toLowerCase()];
  if (named) return named;
  if (/var\(|currentcolor|^(inherit|initial|unset|revert|revert-layer)$/i.test(color)) throw new Error("color must be a palette name, a CSS color, or 'auto'");
  if (typeof CSS !== "undefined" && !CSS.supports("color", color)) throw new Error(`color must be one of ${Object.keys(PALETTE).join(", ")} or a valid CSS color`);
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
