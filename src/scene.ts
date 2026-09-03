// The scene is the single source of truth for what is on the paper.
// Humans and agents both write to it through the same instruments.

import { flatten, type Segment } from "./svgpath.ts";

export const PAPER_W = 1200;
export const PAPER_H = 800;

export type Author = "human" | "agent";
export type PenKind = "pencil" | "fineliner" | "marker" | "brush" | "highlighter";
export type PaperKind = "blank" | "grid" | "lined";
export type StencilShape = "rectangle" | "triangle" | "polygon";

export type Texture = "grain" | "chalk";
export type Fill = "hatch" | "crosshatch" | "stipple";

export interface Pen {
  kind: PenKind;
  /** "auto" follows the paper theme; explicit colors are never recolored. */
  color: string;
  width: number;
  opacity: number;
  /** Dashed ink, the convention for construction lines. */
  dash?: boolean;
  /** Name of the agent-made brush this pen came from, for the record. */
  brush?: string;
  /** Edge character of freehand strokes. */
  texture?: Texture;
  /** Thin ends, like a real brush lifting off. */
  taper?: boolean;
  /** Illustrative fill drawn as ink inside closed shapes and circles. */
  fill?: Fill;
  /** Hatch direction in degrees, default 45. */
  hatchAngle?: number;
  /** Solid fill for closed paths, shapes and circles: a color, or "auto" for theme ink. */
  fillColor?: string;
  /** Brush engine overrides for custom brushes. */
  tip?: import("./brush.ts").Tip;
  spacing?: number;
  scatter?: number;
  /** Paper grain strength 0..1 (overrides the kind's default). */
  grain?: number;
  /** Any brush engine parameter, for fully custom brushes. */
  engine?: Partial<import("./brush.ts").BrushDef>;
  /** Effects, rendered around the mark. Offsets and blurs in paper units. */
  shadow?: { dx: number; dy: number; blur: number; color: string };
  glow?: { blur: number; color: string };
  blur?: number;
}

export interface Pt {
  x: number;
  y: number;
  /** Pressure 0..1. Defaults to 0.5 when the input has none. */
  p?: number;
}

interface Base {
  id: string;
  label: string;
  author: Author;
  pen: Pen;
  /** Optional name shared by marks that belong together, like a layer. */
  group?: string;
  /** Keyframes and procedural motion, when the mark moves over the timeline. */
  motion?: import("./motion.ts").Motion;
  /** Hidden marks stay in the scene (and in look) but are not drawn. */
  hidden?: boolean;
}

export interface Timeline {
  /** Seconds. */
  duration: number;
  fps: number;
  loop: boolean;
  /** Tracing paper: show the previous frame faintly while scrubbing. */
  onion: boolean;
}

export type Geometry =
  | { kind: "stroke"; paths: Pt[][] }
  | { kind: "line"; from: Pt; to: Pt; arrow: boolean }
  | { kind: "arc"; cx: number; cy: number; r: number; start: number; end: number }
  | { kind: "shape"; shape: StencilShape; x: number; y: number; w: number; h: number; rotation: number; sides: number }
  | { kind: "path"; segments: Segment[] };

export type Item = Base & Geometry;

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PEN_PRESETS: Record<PenKind, Pen> = {
  pencil: { kind: "pencil", color: "auto", width: 2.5, opacity: 0.9 },
  fineliner: { kind: "fineliner", color: "auto", width: 2, opacity: 1 },
  marker: { kind: "marker", color: "auto", width: 6, opacity: 0.85 },
  brush: { kind: "brush", color: "auto", width: 9, opacity: 0.8 },
  highlighter: { kind: "highlighter", color: "#f59e0b", width: 18, opacity: 0.3 },
};

/** Named inks. "ink" follows the paper theme; the rest are fixed so figures stay consistent. */
export const PALETTE: Record<string, string> = {
  ink: "auto",
  auto: "auto",
  accent: "#e5484d",
  blue: "#3b82f6",
  green: "#22a06b",
  ochre: "#f59e0b",
};

type Listener = (event: SceneEvent) => void;
export type SceneEvent =
  | { type: "add"; item: Item }
  | { type: "remove"; ids: string[] }
  | { type: "change"; ids: string[] }
  | { type: "motion"; ids: string[] }
  | { type: "clear" }
  | { type: "paper"; paper: PaperKind }
  | { type: "timeline"; timeline: Timeline };

export class Scene {
  items: Item[] = [];
  paper: PaperKind = "grid";
  timeline: Timeline = { duration: 4, fps: 12, loop: true, onion: false };
  private counter = 0;
  private listeners = new Set<Listener>();

  /** True when any mark has keyframes or procedural motion. */
  get animated(): boolean {
    return this.items.some((i) => i.motion && (i.motion.keys.length > 0 || i.motion.wiggle || i.motion.boil));
  }

  setTimeline(patch: Partial<Timeline>) {
    this.timeline = { ...this.timeline, ...patch };
    this.emit({ type: "timeline", timeline: this.timeline });
  }

  /** Replace motion on items in place, then notify players. */
  setMotion(next: Item[]) {
    const ids: string[] = [];
    for (const item of next) {
      const at = this.items.findIndex((i) => i.id === item.id);
      if (at === -1) continue;
      this.items[at] = item;
      ids.push(item.id);
    }
    if (ids.length) this.emit({ type: "motion", ids });
    return ids;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: SceneEvent) {
    for (const fn of this.listeners) fn(event);
  }

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}${this.counter}`;
  }

  add(geometry: Geometry, meta: { label: string; author: Author; pen: Pen; group?: string }): Item {
    const item = { ...geometry, ...meta, pen: { ...meta.pen }, id: this.nextId(geometry.kind[0]) } as Item;
    if (!item.group) delete item.group;
    this.items.push(item);
    this.emit({ type: "add", item });
    return item;
  }

  /** Put a previously removed item back, keeping its id, at its old index when possible. */
  insert(item: Item, index?: number) {
    if (this.items.some((i) => i.id === item.id)) return;
    const at = index === undefined ? this.items.length : Math.max(0, Math.min(this.items.length, index));
    this.items.splice(at, 0, item);
    this.emit({ type: "add", item });
  }

  /** Replace items in place (same ids), then notify renderers. */
  update(next: Item[]) {
    const ids: string[] = [];
    for (const item of next) {
      const at = this.items.findIndex((i) => i.id === item.id);
      if (at === -1) continue;
      this.items[at] = item;
      ids.push(item.id);
    }
    if (ids.length) this.emit({ type: "change", ids });
    return ids;
  }

  /** Bring marks to the front or send them to the back of the drawing order. */
  reorder(ids: string[], where: "front" | "back"): string[] {
    const set = new Set(ids);
    const picked = this.items.filter((i) => set.has(i.id));
    if (picked.length === 0) return [];
    const rest = this.items.filter((i) => !set.has(i.id));
    this.items = where === "front" ? [...rest, ...picked] : [...picked, ...rest];
    this.emit({ type: "change", ids: picked.map((i) => i.id) });
    return picked.map((i) => i.id);
  }

  remove(ids: string[]): string[] {
    const set = new Set(ids);
    const removed = this.items.filter((i) => set.has(i.id)).map((i) => i.id);
    if (removed.length === 0) return removed;
    this.items = this.items.filter((i) => !set.has(i.id));
    this.emit({ type: "remove", ids: removed });
    return removed;
  }

  undo(author?: Author): Item | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (author && item.author !== author) continue;
      this.items.splice(i, 1);
      this.emit({ type: "remove", ids: [item.id] });
      return item;
    }
    return undefined;
  }

  clear(paper?: PaperKind) {
    this.items = [];
    if (paper) this.paper = paper;
    this.timeline = { ...this.timeline, duration: 4 };
    this.emit({ type: "clear" });
  }

  /** Replace everything with a saved sheet. */
  load(doc: { items: Item[]; paper?: PaperKind; timeline?: Partial<Timeline> }) {
    this.items = doc.items.map((i) => ({ ...i }));
    if (doc.paper) this.paper = doc.paper;
    this.timeline = { ...this.timeline, ...(doc.timeline ?? {}) };
    let max = 0;
    for (const i of this.items) max = Math.max(max, Number(i.id.replace(/^\D+/, "")) || 0);
    this.counter = Math.max(this.counter, max);
    this.emit({ type: "clear" });
    for (const item of this.items) this.emit({ type: "add", item });
    this.emit({ type: "timeline", timeline: this.timeline });
  }

  setPaper(paper: PaperKind) {
    this.paper = paper;
    this.emit({ type: "paper", paper });
  }

  get(id: string): Item | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** Items whose bounding box intersects the given region. */
  inRegion(region: BBox): Item[] {
    return this.items.filter((i) => intersects(bbox(i), region));
  }
}

export function intersects(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Vertices of a stencil shape, in paper coordinates. */
export function shapeVertices(s: Extract<Geometry, { kind: "shape" }>): Pt[] {
  const pts: Pt[] = [];
  const hw = s.w / 2;
  const hh = s.h / 2;
  if (s.shape === "rectangle") {
    pts.push({ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh });
  } else if (s.shape === "triangle") {
    pts.push({ x: 0, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh });
  } else {
    const n = Math.max(3, Math.min(12, Math.round(s.sides || 6)));
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      pts.push({ x: hw * Math.cos(a), y: hh * Math.sin(a) });
    }
  }
  const rad = (s.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  return pts.map((p) => ({ x: s.x + p.x * c - p.y * sn, y: s.y + p.x * sn + p.y * c }));
}

/** Points along an arc, used for bounds, rasters and intersections. */
export function arcPoints(a: Extract<Geometry, { kind: "arc" }>, steps = 48): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const ang = ((a.start + ((a.end - a.start) * i) / steps) * Math.PI) / 180;
    pts.push({ x: a.cx + a.r * Math.cos(ang), y: a.cy + a.r * Math.sin(ang) });
  }
  return pts;
}

/** Flattened polylines of a path mark, one per subpath. */
export function pathPoints(item: Extract<Geometry, { kind: "path" }>): Pt[][] {
  return flatten(item.segments);
}

export function bbox(item: Item): BBox {
  switch (item.kind) {
    case "stroke":
      return ptsBox(item.paths.flat(), item.pen.width);
    case "path":
      return ptsBox(pathPoints(item).flat(), item.pen.width);
    case "line":
      return ptsBox([item.from, item.to], item.pen.width);
    case "arc":
      return ptsBox(arcPoints(item, 24), item.pen.width);
    case "shape":
      return ptsBox(shapeVertices(item), item.pen.width);
  }
}

export function center(item: Item): Pt {
  const b = bbox(item);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function ptsBox(pts: Pt[], pad: number): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function clampPt(p: Pt): Pt {
  return {
    x: Math.max(0, Math.min(PAPER_W, p.x)),
    y: Math.max(0, Math.min(PAPER_H, p.y)),
    p: p.p === undefined ? undefined : Math.max(0, Math.min(1, p.p)),
  };
}

export interface Transform {
  dx?: number;
  dy?: number;
  /** Uniform scale about `about` (defaults to the mark's center). */
  scale?: number;
  /** Degrees clockwise about `about`. */
  rotate?: number;
  about?: Pt;
}

/** A moved, scaled or rotated copy of a mark. Pure; the scene decides whether to keep it. */
export function transformItem(item: Item, t: Transform): Item {
  const about = t.about ?? center(item);
  const s = t.scale ?? 1;
  const rad = ((t.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = t.dx ?? 0;
  const dy = t.dy ?? 0;
  const map = (p: Pt): Pt => {
    const x = (p.x - about.x) * s;
    const y = (p.y - about.y) * s;
    return clampPt({ x: about.x + x * cos - y * sin + dx, y: about.y + x * sin + y * cos + dy, p: p.p });
  };
  switch (item.kind) {
    case "stroke":
      return { ...item, paths: item.paths.map((path) => path.map(map)) };
    case "path":
      return {
        ...item,
        segments: item.segments.map((seg) => {
          if (seg.c === "Z") return seg;
          const p = map({ x: seg.x, y: seg.y });
          if (seg.c === "C") {
            const a = map({ x: seg.x1, y: seg.y1 });
            const b = map({ x: seg.x2, y: seg.y2 });
            return { ...seg, x1: a.x, y1: a.y, x2: b.x, y2: b.y, x: p.x, y: p.y };
          }
          if (seg.c === "Q") {
            const a = map({ x: seg.x1, y: seg.y1 });
            return { ...seg, x1: a.x, y1: a.y, x: p.x, y: p.y };
          }
          return { ...seg, x: p.x, y: p.y };
        }),
      };
    case "line":
      return { ...item, from: map(item.from), to: map(item.to) };
    case "arc": {
      const c = map({ x: item.cx, y: item.cy });
      return { ...item, cx: c.x, cy: c.y, r: Math.max(1, item.r * s), start: item.start + (t.rotate ?? 0), end: item.end + (t.rotate ?? 0) };
    }
    case "shape": {
      const c = map({ x: item.x, y: item.y });
      return { ...item, x: c.x, y: c.y, w: Math.max(2, item.w * s), h: Math.max(2, item.h * s), rotation: item.rotation + (t.rotate ?? 0) };
    }
  }
}
