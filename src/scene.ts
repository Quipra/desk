// The scene is the single source of truth for what is on the paper.
// Humans and agents both write to it through the same instruments.

export const PAPER_W = 1200;
export const PAPER_H = 800;

export type Author = "human" | "agent";
export type PenKind = "pencil" | "marker" | "brush";
export type PaperKind = "blank" | "grid" | "lined";
export type StencilShape = "rectangle" | "triangle" | "polygon";

export interface Pen {
  kind: PenKind;
  color: string;
  width: number;
  opacity: number;
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
}

export type Geometry =
  | { kind: "stroke"; points: Pt[] }
  | { kind: "line"; from: Pt; to: Pt; arrow: boolean }
  | { kind: "arc"; cx: number; cy: number; r: number; start: number; end: number }
  | { kind: "shape"; shape: StencilShape; x: number; y: number; w: number; h: number; rotation: number; sides: number }
  | { kind: "text"; x: number; y: number; text: string; size: number };

export type Item = Base & Geometry;

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PEN_PRESETS: Record<PenKind, Pen> = {
  pencil: { kind: "pencil", color: "#1a1a1a", width: 2.5, opacity: 0.9 },
  marker: { kind: "marker", color: "#1a1a1a", width: 6, opacity: 0.85 },
  brush: { kind: "brush", color: "#1a1a1a", width: 9, opacity: 0.8 },
};

type Listener = (event: SceneEvent) => void;
export type SceneEvent =
  | { type: "add"; item: Item }
  | { type: "remove"; ids: string[] }
  | { type: "clear" }
  | { type: "paper"; paper: PaperKind };

export class Scene {
  items: Item[] = [];
  paper: PaperKind = "grid";
  private counter = 0;
  private listeners = new Set<Listener>();

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

  add(geometry: Geometry, meta: { label: string; author: Author; pen: Pen }): Item {
    const item = { ...geometry, ...meta, id: this.nextId(geometry.kind[0]) } as Item;
    this.items.push(item);
    this.emit({ type: "add", item });
    return item;
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
    this.emit({ type: "clear" });
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

export function bbox(item: Item): BBox {
  switch (item.kind) {
    case "stroke":
      return ptsBox(item.points, item.pen.width);
    case "line":
      return ptsBox([item.from, item.to], item.pen.width);
    case "arc": {
      // Approximate with points along the arc so partial arcs get tight boxes.
      const pts: Pt[] = [];
      const steps = 24;
      for (let i = 0; i <= steps; i++) {
        const a = ((item.start + ((item.end - item.start) * i) / steps) * Math.PI) / 180;
        pts.push({ x: item.cx + item.r * Math.cos(a), y: item.cy + item.r * Math.sin(a) });
      }
      return ptsBox(pts, item.pen.width);
    }
    case "shape":
      return ptsBox(shapeVertices(item), item.pen.width);
    case "text": {
      const w = item.text.length * item.size * 0.62;
      return { x: item.x, y: item.y - item.size, w, h: item.size * 1.2 };
    }
  }
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
