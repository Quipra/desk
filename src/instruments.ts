// The person's hands on the desk: pointer gestures become the same scene items
// the agent's tools produce.

import type { Paper } from "./paper.ts";
import { bbox, clampPt, PEN_PRESETS, type Item, type Pen, type PenKind, type Pt, type Scene, type StencilShape } from "./scene.ts";

export type Mode = "pen" | "eraser" | "ruler" | "compass" | "stencil";

const ERASE_RADIUS = 14;

export class Instruments {
  mode: Mode = "pen";
  pen: Pen = { ...PEN_PRESETS.pencil };
  stencil: StencilShape = "rectangle";
  private scene: Scene;
  private paper: Paper;
  private down: Pt | null = null;
  private points: Pt[] = [];
  private pointerId: number | null = null;
  onChange: (() => void) | null = null;

  constructor(paper: Paper, scene: Scene) {
    this.paper = paper;
    this.scene = scene;
    const c = paper.canvas;
    c.style.touchAction = "none";
    c.addEventListener("pointerdown", (e) => this.start(e));
    c.addEventListener("pointermove", (e) => this.move(e));
    c.addEventListener("pointerup", (e) => this.end(e));
    c.addEventListener("pointercancel", (e) => { if (e.pointerId === this.pointerId) this.cancel(); });
    c.addEventListener("lostpointercapture", (e) => { if (e.pointerId === this.pointerId) this.cancel(); });
  }

  setPenKind(kind: PenKind) {
    this.cancel();
    const preset = PEN_PRESETS[kind];
    // The highlighter keeps its own ochre; every other pen keeps the chosen ink.
    this.pen = { ...preset, color: kind === "highlighter" ? preset.color : this.pen.color };
    this.mode = "pen";
    this.onChange?.();
  }

  setColor(color: string) {
    this.cancel();
    this.pen = { ...this.pen, color };
    if (this.mode === "eraser") this.mode = "pen";
    this.onChange?.();
  }

  setMode(mode: Mode) {
    this.cancel();
    this.mode = mode;
    this.onChange?.();
  }

  private pt(e: PointerEvent): Pt {
    const p = this.paper.toPaper(e);
    const pressure = e.pointerType === "mouse" ? 0.5 : e.pressure || 0.5;
    return clampPt({ x: p.x, y: p.y, p: pressure });
  }

  private start(e: PointerEvent) {
    if (e.button !== 0 || this.pointerId !== null || e.isPrimary === false) return;
    const p = this.pt(e);
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.paper.canvas.setPointerCapture(e.pointerId);
    this.down = p;
    this.points = [p];
    if (this.mode === "eraser") this.eraseAt(p);
    this.paper.preview = this.previewItem(p);
    this.paper.render();
  }

  private move(e: PointerEvent) {
    if (!this.down || e.pointerId !== this.pointerId) return;
    const p = this.pt(e);
    if (this.mode === "eraser") {
      this.eraseAt(p);
      return;
    }
    if (this.mode === "pen") {
      const events = e.getCoalescedEvents?.() ?? [];
      for (const sample of events.length ? events : [e]) {
        const next = this.pt(sample);
        const last = this.points[this.points.length - 1];
        if (Math.hypot(next.x - last.x, next.y - last.y) >= 1) this.points.push(next);
      }
    }
    this.paper.preview = this.previewItem(p);
    this.paper.render();
  }

  private end(e: PointerEvent) {
    if (!this.down || e.pointerId !== this.pointerId) return;
    const p = this.pt(e);
    if (this.mode === "pen") {
      const last = this.points[this.points.length - 1];
      // Pointer-up may be the only sample at the final coordinate. Keep its
      // position but not the zero pressure caused by lifting the stylus.
      if (p.x !== last.x || p.y !== last.y) this.points.push({ ...p, p: last.p });
    }
    const item = this.mode === "eraser" ? null : this.previewItem(p);
    this.paper.preview = null;
    this.down = null;
    this.releasePointer();
    if (item && this.meaningful(item)) {
      const { id: _id, ...rest } = item;
      this.scene.add(rest, { label: rest.label, author: "human", pen: rest.pen });
    } else {
      this.paper.render();
    }
  }

  private cancel() {
    this.down = null;
    this.releasePointer();
    this.paper.preview = null;
    this.paper.render();
  }

  private releasePointer() {
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null && this.paper.canvas.hasPointerCapture(id)) this.paper.canvas.releasePointerCapture(id);
  }

  private meaningful(item: Item): boolean {
    if (item.kind === "stroke") return item.paths.some((points) => points.length > 0);
    const b = bbox(item);
    return b.w > 4 || b.h > 4;
  }

  private previewItem(p: Pt): Item | null {
    const d = this.down;
    if (!d) return null;
    const base = { id: "preview", author: "human" as const, pen: this.pen };
    switch (this.mode) {
      case "pen":
        return { ...base, kind: "stroke", label: `${this.pen.kind} stroke`, paths: [this.points] };
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
  if (item.kind === "stroke") return item.paths.some((points) => points.some((q, index) =>
    distToSegment(p, points[Math.max(0, index - 1)], q) <= r + item.pen.width));
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
