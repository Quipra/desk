// The select tool: a designer's hands on marks that are already down. Click or
// drag a marquee to choose, then move, scale and rotate through handles that
// keep the same size on screen however far the sheet is zoomed.

import { hits, type Instruments } from "./instruments.ts";
import type { Paper } from "./paper.ts";
import { bbox, clampPt, transformItem, type BBox, type Geometry, type Item, type Pt, type Scene } from "./scene.ts";

export interface SelectContext {
  scene: Scene;
  paper: Paper;
  instruments: Instruments;
  canvas: HTMLCanvasElement;
  onSelection: (ids: string[]) => void;
}

export interface Selection {
  selected(): string[];
  select(ids: string[]): void;
  deleteSelected(): void;
  duplicateSelected(): void;
}

// Screen sizes in CSS pixels. The overlay divides them by the zoom so a handle
// is always the same thing to grab, whatever the drawing is doing underneath.
const HANDLE = 9;
const SLOP = 5;
const ROTATE_GAP = 24;
const OFFSET = 20;
const DOUBLE_MS = 350;
const SNAP_DEG = 15;

type Spot = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";

type Drag =
  | { kind: "move"; from: Pt; originals: Item[] }
  | { kind: "scale"; spot: Spot; box: BBox; originals: Item[] }
  | { kind: "rotate"; center: Pt; from: number; originals: Item[] }
  | { kind: "marquee"; from: Pt; to: Pt; base: string[] };

export function mountSelect(ctx: SelectContext): Selection {
  const { scene, paper, canvas } = ctx;
  let ids: string[] = [];
  let drag: Drag | null = null;
  let pointerId: number | null = null;
  let lastDown = { t: -Infinity, x: 0, y: 0 };

  const active = () => ctx.instruments.mode === "select";
  const chosen = (): Item[] => ids.map((id) => scene.get(id)).filter((i): i is Item => i !== undefined);
  const box = (): BBox | null => union(chosen());
  /** One CSS pixel expressed in paper units at the current zoom. */
  const unit = () => 1 / Math.max(0.0001, paper.view.k * paper.scale);

  const set = (next: string[]) => {
    const unique = [...new Set(next)].filter((id) => scene.get(id) !== undefined);
    const same = unique.length === ids.length && unique.every((id, i) => id === ids[i]);
    ids = unique;
    if (!same) ctx.onSelection([...ids]);
    paper.invalidate();
  };

  const handles = (b: BBox, px: number): { spot: Spot; x: number; y: number }[] => {
    const mx = b.x + b.w / 2;
    const my = b.y + b.h / 2;
    const right = b.x + b.w;
    const bottom = b.y + b.h;
    return [
      { spot: "nw", x: b.x, y: b.y },
      { spot: "n", x: mx, y: b.y },
      { spot: "ne", x: right, y: b.y },
      { spot: "e", x: right, y: my },
      { spot: "se", x: right, y: bottom },
      { spot: "s", x: mx, y: bottom },
      { spot: "sw", x: b.x, y: bottom },
      { spot: "w", x: b.x, y: my },
      { spot: "rotate", x: mx, y: b.y - ROTATE_GAP * px },
    ];
  };

  const spotAt = (p: Pt): Spot | null => {
    const b = box();
    if (!b) return null;
    const reach = (HANDLE / 2 + SLOP) * unit();
    for (const h of handles(b, unit())) {
      if (Math.abs(p.x - h.x) <= reach && Math.abs(p.y - h.y) <= reach) return h.spot;
    }
    return null;
  };

  /** The topmost visible mark under the pointer, the way a stack of paper reads. */
  const itemAt = (p: Pt): Item | null => {
    for (let i = scene.items.length - 1; i >= 0; i--) {
      const item = scene.items[i];
      if (!item.hidden && hits(item, p)) return item;
    }
    return null;
  };

  /** A mark brings its whole group unless the click asked for the one mark. */
  const kin = (item: Item, whole: boolean): string[] =>
    whole && item.group ? scene.items.filter((i) => i.group === item.group).map((i) => i.id) : [item.id];

  const cursorFor = (p: Pt): string => {
    const spot = spotAt(p);
    if (spot === "rotate") return "grab";
    if (spot === "n" || spot === "s") return "ns-resize";
    if (spot === "e" || spot === "w") return "ew-resize";
    if (spot === "nw" || spot === "se") return "nwse-resize";
    if (spot) return "nesw-resize";
    return itemAt(p) || inside(box(), p) ? "move" : "default";
  };

  const onDown = (e: PointerEvent) => {
    if (!active()) return;
    // While select is the mode, no other instrument sees the gesture.
    e.stopImmediatePropagation();
    if (e.button !== 0 || e.isPrimary === false) return;
    e.preventDefault();
    const p = paper.toPaper(e);
    pointerId = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    const spot = spotAt(p);
    const b = box();
    if (spot === "rotate" && b) {
      const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
      drag = { kind: "rotate", center, from: angle(center, p), originals: chosen() };
    } else if (spot && b) {
      drag = { kind: "scale", spot, box: b, originals: chosen() };
    } else {
      const now = Date.now();
      const doubled = now - lastDown.t < DOUBLE_MS && Math.hypot(p.x - lastDown.x, p.y - lastDown.y) < 8;
      lastDown = { t: now, x: p.x, y: p.y };
      const hit = itemAt(p);
      if (hit && e.shiftKey) {
        set(toggle(ids, kin(hit, !doubled)));
      } else if (hit) {
        const picked = kin(hit, !doubled);
        // A click inside the selection keeps it, so a whole group can be dragged;
        // a double-click narrows to the one mark even when its group is selected.
        if (doubled || !picked.every((id) => ids.includes(id))) set(picked);
        drag = { kind: "move", from: p, originals: chosen() };
      } else if (!e.shiftKey && inside(b, p)) {
        drag = { kind: "move", from: p, originals: chosen() };
      } else {
        if (!e.shiftKey) set([]);
        drag = { kind: "marquee", from: p, to: p, base: [...ids] };
      }
    }
    paper.invalidate();
  };

  const onMove = (e: PointerEvent) => {
    if (!active()) return;
    e.stopImmediatePropagation();
    const p = paper.toPaper(e);
    const d = drag;
    if (!d) {
      canvas.style.cursor = cursorFor(p);
      return;
    }
    if (e.pointerId !== pointerId) return;
    if (d.kind === "marquee") {
      d.to = p;
      paper.invalidate();
      return;
    }
    if (d.kind === "move") {
      scene.update(d.originals.map((i) => transformItem(i, { dx: p.x - d.from.x, dy: p.y - d.from.y })));
    } else if (d.kind === "rotate") {
      const turn = ((angle(d.center, p) - d.from) * 180) / Math.PI;
      const deg = e.shiftKey ? Math.round(turn / SNAP_DEG) * SNAP_DEG : turn;
      scene.update(d.originals.map((i) => transformItem(i, { rotate: deg, about: d.center })));
    } else {
      const { about, sx, sy } = factors(d.spot, d.box, p, e.shiftKey);
      scene.update(d.originals.map((i) => (sx === sy ? transformItem(i, { scale: sx, about }) : stretch(i, about, sx, sy))));
    }
    paper.invalidate();
  };

  const onUp = (e: PointerEvent) => {
    if (!active()) return;
    e.stopImmediatePropagation();
    const done = drag;
    drag = null;
    pointerId = null;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (done?.kind === "marquee") {
      const region = rect(done.from, done.to);
      const caught = scene.inRegion(region).filter((i) => !i.hidden).map((i) => i.id);
      set([...done.base, ...caught]);
    }
    canvas.style.cursor = cursorFor(paper.toPaper(e));
    paper.invalidate();
  };

  const onCancel = () => {
    drag = null;
    pointerId = null;
    paper.invalidate();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!active() || ids.length === 0 || e.metaKey || e.ctrlKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    scene.update(chosen().map((i) => transformItem(i, { dx, dy })));
    paper.invalidate();
  };

  paper.overlay = (c, view) => {
    if (!active()) return;
    const px = 1 / Math.max(0.0001, view.k * view.scale);
    const accent = cssVar("--agent", "#5b5bd6");
    c.lineWidth = px;
    c.strokeStyle = accent;
    if (drag?.kind === "marquee") {
      const r = rect(drag.from, drag.to);
      c.save();
      c.fillStyle = cssVar("--select-marquee", "rgba(91, 91, 214, 0.12)");
      c.fillRect(r.x, r.y, r.w, r.h);
      c.setLineDash([5 * px, 4 * px]);
      c.strokeRect(r.x, r.y, r.w, r.h);
      c.restore();
    }
    const b = box();
    if (!b) return;
    c.strokeRect(b.x, b.y, b.w, b.h);
    const size = HANDLE * px;
    c.fillStyle = cssVar("--select-handle", "#ffffff");
    for (const h of handles(b, px)) {
      if (h.spot === "rotate") {
        c.beginPath();
        c.moveTo(b.x + b.w / 2, b.y);
        c.lineTo(h.x, h.y);
        c.stroke();
        c.beginPath();
        c.arc(h.x, h.y, size / 2, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        continue;
      }
      c.fillRect(h.x - size / 2, h.y - size / 2, size, size);
      c.strokeRect(h.x - size / 2, h.y - size / 2, size, size);
    }
  };

  canvas.addEventListener("pointerdown", onDown, true);
  canvas.addEventListener("pointermove", onMove, true);
  canvas.addEventListener("pointerup", onUp, true);
  canvas.addEventListener("pointercancel", onCancel, true);
  if (typeof window !== "undefined") window.addEventListener("keydown", onKey);

  // A mark that leaves the sheet leaves the selection with it.
  scene.on((e) => {
    if (e.type === "remove") {
      const gone = new Set(e.ids);
      if (ids.some((id) => gone.has(id))) set(ids.filter((id) => !gone.has(id)));
    } else if (e.type === "clear" && ids.length > 0) {
      set([]);
    }
  });

  return {
    selected: () => [...ids],
    select: (next) => set(next),
    deleteSelected: () => {
      if (ids.length > 0) scene.remove([...ids]);
    },
    duplicateSelected: () => {
      // Copies land offset so they read as new marks, and take the selection.
      const copies = chosen().map((item) => {
        const moved = transformItem(item, { dx: OFFSET, dy: OFFSET });
        return scene.add(geometryOf(moved), { label: item.label, author: "human", pen: item.pen, group: item.group });
      });
      if (copies.length > 0) set(copies.map((i) => i.id));
    },
  };
}

/**
 * Where a scale handle anchors and how far it stretches. Corners scale
 * uniformly about the opposite corner; an edge moves one axis, unless shift
 * asks it to keep the aspect too.
 */
function factors(spot: Spot, b: BBox, p: Pt, shift: boolean): { about: Pt; sx: number; sy: number } {
  const west = spot.includes("w");
  const east = spot.includes("e");
  const north = spot.includes("n");
  const south = spot.includes("s");
  const about = {
    x: west ? b.x + b.w : east ? b.x : b.x + b.w / 2,
    y: north ? b.y + b.h : south ? b.y : b.y + b.h / 2,
  };
  const grip = { x: west ? b.x : b.x + b.w, y: north ? b.y : b.y + b.h };
  const horizontal = (west || east) && Math.abs(grip.x - about.x) > 1e-6;
  const vertical = (north || south) && Math.abs(grip.y - about.y) > 1e-6;
  let sx = horizontal ? (p.x - about.x) / (grip.x - about.x) : 1;
  let sy = vertical ? (p.y - about.y) / (grip.y - about.y) : 1;
  sx = Math.max(0.02, sx);
  sy = Math.max(0.02, sy);
  if (spot.length === 2 || shift) {
    const s = horizontal && vertical ? (sx + sy) / 2 : horizontal ? sx : vertical ? sy : 1;
    sx = s;
    sy = s;
  }
  return { about, sx, sy };
}

/**
 * A non-uniformly scaled copy. transformItem only knows uniform scale, so this
 * mirrors its switch over the kinds and maps every point the same way.
 */
function stretch(item: Item, about: Pt, sx: number, sy: number): Item {
  const map = (p: Pt): Pt => clampPt({ x: about.x + (p.x - about.x) * sx, y: about.y + (p.y - about.y) * sy, p: p.p });
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
      // A circle cannot become an ellipse here, so it takes the average stretch.
      const c = map({ x: item.cx, y: item.cy });
      return { ...item, cx: c.x, cy: c.y, r: Math.max(1, (item.r * (sx + sy)) / 2) };
    }
    case "shape": {
      const c = map({ x: item.x, y: item.y });
      return { ...item, x: c.x, y: c.y, w: Math.max(2, item.w * sx), h: Math.max(2, item.h * sy) };
    }
  }
}

/** The geometry of a mark, without its identity, ready for scene.add. */
function geometryOf(item: Item): Geometry {
  switch (item.kind) {
    case "stroke":
      return { kind: "stroke", paths: item.paths };
    case "path":
      return { kind: "path", segments: item.segments };
    case "line":
      return { kind: "line", from: item.from, to: item.to, arrow: item.arrow };
    case "arc":
      return { kind: "arc", cx: item.cx, cy: item.cy, r: item.r, start: item.start, end: item.end };
    case "shape":
      return { kind: "shape", shape: item.shape, x: item.x, y: item.y, w: item.w, h: item.h, rotation: item.rotation, sides: item.sides };
  }
}

function union(items: Item[]): BBox | null {
  if (items.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const item of items) {
    const b = bbox(item);
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function rect(a: Pt, b: Pt): BBox {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function inside(b: BBox | null, p: Pt): boolean {
  return b !== null && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

function angle(center: Pt, p: Pt): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

function toggle(current: string[], picked: string[]): string[] {
  const has = picked.every((id) => current.includes(id));
  return has ? current.filter((id) => !picked.includes(id)) : [...current, ...picked];
}

/** A theme color from the stylesheet, so the overlay follows the desk's palette. */
function cssVar(name: string, fallback: string): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  } catch {
    return fallback;
  }
}
