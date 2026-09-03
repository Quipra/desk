// The pen tool: the same gesture Illustrator taught everyone. A click drops a
// corner, a press-and-drag drops a smooth point and pulls its handles out, and
// the path is committed as one "path" mark in the scene.
//
// It only listens while the mode is "path", and it takes the pointer stream in
// the capture phase so the freehand instruments never see these gestures.

import type { Instruments } from "./instruments.ts";
import type { Paper } from "./paper.ts";
import { PAPER_H, PAPER_W, type Pt, type Scene } from "./scene.ts";
import type { Segment } from "./svgpath.ts";

export interface PenToolContext {
  scene: Scene;
  paper: Paper;
  instruments: Instruments;
  canvas: HTMLCanvasElement;
}

export interface PenTool {
  cancel(): void;
}

type Overlay = (ctx: CanvasRenderingContext2D, view: { k: number; scale: number }) => void;

/** One point of the path being drawn, with its absolute Bézier handles. */
interface Anchor {
  p: Pt;
  /** Control point of the segment arriving at this anchor. */
  in?: Pt;
  /** Control point of the segment leaving this anchor. */
  out?: Pt;
}

/** Screen-space sizes, in CSS pixels: they stay the same at any zoom. */
const HIT_PX = 9;
const DRAG_PX = 3;
const ANCHOR_PX = 3;
const DOUBLE_MS = 350;
const FALLBACK_ACCENT = "#5b5bd6";

export function mountPenTool(ctx: PenToolContext): PenTool {
  const { scene, paper, instruments, canvas } = ctx;

  let anchors: Anchor[] = [];
  /** Where the cursor is, for the rubber band. */
  let cursor: Pt | null = null;
  /** The handle drag in progress, if the pointer is down. */
  let drag: { id: number; index: number; from: Pt; moved: boolean } | null = null;
  let lastDown: { at: number; p: Pt } | null = null;
  /** Whatever was drawing the overlay before us; we draw on top of it. */
  let under: Overlay | null = null;

  const active = () => instruments.mode === "path";
  /** Paper units per CSS pixel, so overlay sizes and hit radii stay screen-constant. */
  const unit = () => 1 / Math.max(1e-6, paper.scale * paper.view.k);

  // Drawing

  const overlay: Overlay = (c, view) => {
    under?.(c, view);
    if (!active() || anchors.length === 0) return;
    const u = 1 / Math.max(1e-6, view.k * view.scale);
    const color = accent();
    // While a handle is being pulled the cursor is the handle, not the next anchor.
    const band = drag ? null : cursor;
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    c.strokeStyle = color;
    c.fillStyle = color;

    c.lineWidth = 1.5 * u;
    c.beginPath();
    trace(c, band ? [...anchors, { p: band }] : anchors);
    c.stroke();

    c.lineWidth = u;
    c.beginPath();
    for (const a of anchors) {
      for (const h of [a.in, a.out]) {
        if (!h) continue;
        c.moveTo(a.p.x, a.p.y);
        c.lineTo(h.x, h.y);
      }
    }
    c.stroke();

    const s = ANCHOR_PX * u;
    for (const a of anchors) c.fillRect(a.p.x - s, a.p.y - s, s * 2, s * 2);
    // A ring on the first anchor once the cursor is close enough to close the path.
    if (anchors.length >= 2 && cursor && near(cursor, anchors[0].p, HIT_PX * u)) {
      c.lineWidth = 1.5 * u;
      c.beginPath();
      c.arc(anchors[0].p.x, anchors[0].p.y, HIT_PX * u * 0.7, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();
  };

  /** Take over the overlay, keeping whatever the select tool left there. */
  function install() {
    if (paper.overlay === overlay) return;
    under = paper.overlay;
    paper.overlay = overlay;
  }

  function reset() {
    anchors = [];
    cursor = null;
    drag = null;
    lastDown = null;
    if (paper.overlay === overlay) paper.overlay = under;
    under = null;
    paper.invalidate();
  }

  // Committing

  function commit(closed: boolean) {
    const segments = build(anchors, closed);
    reset();
    if (!segments) return;
    scene.add({ kind: "path", segments }, { label: "path", author: "human", pen: { ...instruments.pen } });
  }

  // Pointer

  function down(e: PointerEvent) {
    if (!active() || e.button !== 0 || e.isPrimary === false) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    install();
    const p = paper.toPaper(e);
    const hit = HIT_PX * unit();
    const now = Date.now();
    // Back on the first anchor: close the shape and commit it.
    if (anchors.length >= 2 && near(p, anchors[0].p, hit)) {
      commit(true);
      return;
    }
    // A second click in the same spot is a double-click: finish the open path.
    if (anchors.length > 0 && lastDown && now - lastDown.at < DOUBLE_MS && near(p, lastDown.p, hit)) {
      commit(false);
      return;
    }
    lastDown = { at: now, p };
    anchors.push({ p });
    cursor = p;
    drag = { id: e.pointerId, index: anchors.length - 1, from: p, moved: false };
    canvas.setPointerCapture?.(e.pointerId);
    paper.invalidate();
  }

  function move(e: PointerEvent) {
    if (!active()) return;
    const p = paper.toPaper(e);
    if (drag && e.pointerId === drag.id) {
      // Owned by the pen tool: nobody else should see the drag.
      e.stopImmediatePropagation();
      if (drag.moved || dist(p, drag.from) >= DRAG_PX * unit()) {
        drag.moved = true;
        const a = anchors[drag.index];
        // Symmetric handles: the incoming one mirrors the one being pulled out.
        a.out = p;
        a.in = { x: 2 * a.p.x - p.x, y: 2 * a.p.y - p.y };
      }
    }
    cursor = p;
    if (anchors.length > 0) paper.invalidate();
  }

  function up(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopImmediatePropagation();
    canvas.releasePointerCapture?.(e.pointerId);
    drag = null;
    paper.invalidate();
  }

  function lost(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    paper.invalidate();
  }

  function key(e: KeyboardEvent) {
    if (!active() || anchors.length === 0) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable)) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commit(false);
    } else if (e.key === "Backspace") {
      e.preventDefault();
      anchors.pop();
      lastDown = null;
      if (anchors.length === 0) reset();
      else paper.invalidate();
    }
  }

  canvas.addEventListener("pointerdown", down, { capture: true });
  canvas.addEventListener("pointermove", move, { capture: true });
  canvas.addEventListener("pointerup", up, { capture: true });
  canvas.addEventListener("pointercancel", lost, { capture: true });
  canvas.addEventListener("lostpointercapture", lost, { capture: true });
  // Enter and Backspace are path-mode shortcuts; the window is where they land.
  if (typeof window !== "undefined") window.addEventListener("keydown", key);

  return { cancel: reset };
}

/** The path so far as canvas commands; the caller owns beginPath and stroke. */
function trace(c: CanvasRenderingContext2D, list: Anchor[]) {
  c.moveTo(list[0].p.x, list[0].p.y);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    if (a.out || b.in) {
      const c1 = a.out ?? a.p;
      const c2 = b.in ?? b.p;
      c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.p.x, b.p.y);
    } else c.lineTo(b.p.x, b.p.y);
  }
}

/**
 * Anchors to path data. A pair with no handles between them is a straight line;
 * anything else is a cubic through the two facing handles. Paths of one anchor
 * are not marks, and everything lands inside the sheet.
 */
export function build(anchors: Anchor[], closed: boolean): Segment[] | null {
  if (anchors.length < 2) return null;
  const join = (a: Anchor, b: Anchor): Segment => {
    if (!a.out && !b.in) return { c: "L", ...clamp(b.p) };
    const c1 = clamp(a.out ?? a.p);
    const c2 = clamp(b.in ?? b.p);
    const end = clamp(b.p);
    return { c: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y };
  };
  const segments: Segment[] = [{ c: "M", ...clamp(anchors[0].p) }];
  for (let i = 1; i < anchors.length; i++) segments.push(join(anchors[i - 1], anchors[i]));
  if (closed) {
    const last = anchors[anchors.length - 1];
    const first = anchors[0];
    // A straight closing edge needs no segment of its own: Z draws it.
    if (last.out || first.in) segments.push(join(last, first));
    segments.push({ c: "Z" });
  }
  return segments;
}

function clamp(p: Pt): { x: number; y: number } {
  return { x: Math.max(0, Math.min(PAPER_W, p.x)), y: Math.max(0, Math.min(PAPER_H, p.y)) };
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function near(a: Pt, b: Pt, radius: number): boolean {
  return dist(a, b) <= radius;
}

/** The agent accent, so an in-progress path reads as scaffolding, not ink. */
function accent(): string {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return FALLBACK_ACCENT;
  return getComputedStyle(document.documentElement).getPropertyValue("--agent").trim() || FALLBACK_ACCENT;
}
