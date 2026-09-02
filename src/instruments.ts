// The person's hands on the desk: pointer gestures become the same scene items
// the agent's tools produce.

import type { Paper } from "./paper";
import { bbox, clampPt, PEN_PRESETS, type Item, type Pen, type PenKind, type Pt, type Scene, type StencilShape } from "./scene";

export type Mode = "pen" | "eraser" | "ruler" | "compass" | "stencil" | "text";

const ERASE_RADIUS = 14;

export class Instruments {
  mode: Mode = "pen";
  pen: Pen = { ...PEN_PRESETS.pencil };
  stencil: StencilShape = "rectangle";
  private scene: Scene;
  private paper: Paper;
  private down: Pt | null = null;
  private points: Pt[] = [];
  private onText: (at: Pt) => void;
  onChange: (() => void) | null = null;

  constructor(paper: Paper, scene: Scene, onText: (at: Pt) => void) {
    this.paper = paper;
    this.scene = scene;
    this.onText = onText;
    const c = paper.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", (e) => this.start(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.end(e));
    c.addEventListener("pointercancel", () => this.cancel());
    c.addEventListener("pointerleave", (e) => {
      if (this.down) this.end(e);
    });
  }

  setPenKind(kind: PenKind) {
    const preset = PEN_PRESETS[kind];
    this.pen = { ...preset, color: this.pen.color };
    this.mode = "pen";
    this.onChange?.();
  }

  setColor(color: string) {
    this.pen = { ...this.pen, color };
    if (this.mode === "eraser") this.mode = "pen";
    this.onChange?.();
  }

  setMode(mode: Mode) {
    this.mode = mode;
    this.onChange?.();
  }

  private pt(e: PointerEvent): Pt {
    const p = this.paper.toPaper(e);
    const pressure = e.pointerType === "mouse" ? 0.5 : e.pressure || 0.5;
    return clampPt({ x: p.x, y: p.y, p: pressure });
  }

  private start(e: PointerEvent) {
    if (e.button !== 0) return;
    this.paper.canvas.setPointerCapture(e.pointerId);
    const p = this.pt(e);
    this.down = p;
    this.points = [p];
    if (this.mode === "eraser") this.eraseAt(p);
    if (this.mode === "text") {
      this.down = null;
      this.onText(p);
      return;
    }
    this.paper.preview = this.previewItem(p);
    this.paper.render();
  }

  private move(e: PointerEvent) {
    if (!this.down) return;
    const p = this.pt(e);
    if (this.mode === "eraser") {
      this.eraseAt(p);
      return;
    }
    if (this.mode === "pen") {
      const last = this.points[this.points.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.5) return;
      this.points.push(p);
    }
    this.paper.preview = this.previewItem(p);
    this.paper.render();
  }

  private end(e: PointerEvent) {
    if (!this.down) return;
    const p = this.pt(e);
    const item = this.mode === "eraser" ? null : this.previewItem(p);
    this.paper.preview = null;
    this.down = null;
    if (item && this.meaningful(item)) {
      const { id: _id, ...rest } = item;
      this.scene.add(rest, { label: rest.label, author: "human", pen: rest.pen });
    } else {
      this.paper.render();
    }
  }

  private cancel() {
    this.down = null;
    this.paper.preview = null;
    this.paper.render();
  }

  private meaningful(item: Item): boolean {
    if (item.kind === "stroke") return item.points.length > 0;
    const b = bbox(item);
    return b.w > 4 || b.h > 4;
  }

  private previewItem(p: Pt): Item | null {
    const d = this.down;
    if (!d) return null;
    const base = { id: "preview", author: "human" as const, pen: this.pen };
    switch (this.mode) {
      case "pen":
        return { ...base, kind: "stroke", label: `${this.pen.kind} stroke`, points: this.points };
      case "ruler":
        return { ...base, kind: "line", label: "ruler line", from: d, to: p, arrow: false };
      case "compass":
        return { ...base, kind: "arc", label: "compass circle", cx: d.x, cy: d.y, r: Math.hypot(p.x - d.x, p.y - d.y), start: 0, end: 360 };
      case "stencil":
        return {
          ...base,
          kind: "shape",
          label: `${this.stencil} stencil`,
          shape: this.stencil,
          x: (d.x + p.x) / 2,
          y: (d.y + p.y) / 2,
          w: Math.abs(p.x - d.x),
          h: Math.abs(p.y - d.y),
          rotation: 0,
          sides: 6,
        };
      default:
        return null;
    }
  }

  private eraseAt(p: Pt) {
    const hit = this.scene.items.filter((item) => hits(item, p));
    if (hit.length > 0) this.scene.remove(hit.map((i) => i.id));
  }
}

function hits(item: Item, p: Pt): boolean {
  const b = bbox(item);
  const r = ERASE_RADIUS;
  if (p.x < b.x - r || p.x > b.x + b.w + r || p.y < b.y - r || p.y > b.y + b.h + r) return false;
  if (item.kind === "stroke") return item.points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= r + item.pen.width);
  if (item.kind === "line") return distToSegment(p, item.from, item.to) <= r + item.pen.width;
  if (item.kind === "arc") return Math.abs(Math.hypot(p.x - item.cx, p.y - item.cy) - item.r) <= r + item.pen.width;
  return true;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
