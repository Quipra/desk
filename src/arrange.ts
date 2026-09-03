// Tidying a selection: line marks up on an edge or a centre line, and space
// them evenly. Both work on bounding boxes and only ever translate a mark, so
// geometry, pens and motion survive untouched.

import { bbox, transformItem, PAPER_H, PAPER_W, type BBox, type Item, type Scene } from "./scene.ts";

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Axis = "horizontal" | "vertical";

export const ALIGNS: Align[] = ["left", "center", "right", "top", "middle", "bottom"];
export const AXES: Axis[] = ["horizontal", "vertical"];

const PAPER: BBox = { x: 0, y: 0, w: PAPER_W, h: PAPER_H };

/** The marks named by `ids`, in scene order, ignoring ids that are gone. */
function pick(scene: Scene, ids: string[]): Item[] {
  const wanted = new Set(ids);
  return scene.items.filter((item) => wanted.has(item.id));
}

/** The box that contains every given box. */
function union(boxes: BBox[]): BBox {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** Align the given marks to each other (or to the paper when `toPaper`). Returns the changed items. */
export function align(scene: Scene, ids: string[], how: Align, toPaper = false): Item[] {
  const items = pick(scene, ids);
  // Aligning one mark to its own box is a no-op; only the paper gives it a target.
  if (items.length === 0 || (items.length < 2 && !toPaper)) return [];
  const boxes = items.map(bbox);
  const target = toPaper ? PAPER : union(boxes);
  const moved: Item[] = [];
  for (const [n, item] of items.entries()) {
    const b = boxes[n];
    let dx = 0;
    let dy = 0;
    switch (how) {
      case "left":
        dx = target.x - b.x;
        break;
      case "center":
        dx = target.x + target.w / 2 - (b.x + b.w / 2);
        break;
      case "right":
        dx = target.x + target.w - (b.x + b.w);
        break;
      case "top":
        dy = target.y - b.y;
        break;
      case "middle":
        dy = target.y + target.h / 2 - (b.y + b.h / 2);
        break;
      case "bottom":
        dy = target.y + target.h - (b.y + b.h);
        break;
    }
    if (dx === 0 && dy === 0) continue;
    moved.push(transformItem(item, { dx, dy }));
  }
  if (moved.length === 0) return [];
  scene.update(moved);
  return moved;
}

/**
 * Space the given marks evenly along an axis: the outermost two stay put and
 * the rest are slid so the gaps between neighbouring boxes are all equal.
 * Returns the changed items.
 */
export function distribute(scene: Scene, ids: string[], axis: Axis): Item[] {
  const items = pick(scene, ids);
  // Fewer than three marks are already evenly spaced between their extremes.
  if (items.length < 3) return [];
  const horizontal = axis === "horizontal";
  const order = items
    .map((item) => ({ item, b: bbox(item) }))
    .sort((a, b) => (horizontal ? a.b.x - b.b.x : a.b.y - b.b.y));
  const start = horizontal ? order[0].b.x : order[0].b.y;
  const last = order[order.length - 1].b;
  const end = horizontal ? last.x + last.w : last.y + last.h;
  const sizes = order.map(({ b }) => (horizontal ? b.w : b.h));
  const filled = sizes.reduce((sum, s) => sum + s, 0);
  const gap = (end - start - filled) / (order.length - 1);
  const moved: Item[] = [];
  let cursor = start;
  for (const [n, { item, b }] of order.entries()) {
    const at = horizontal ? b.x : b.y;
    const delta = cursor - at;
    cursor += sizes[n] + gap;
    if (n === 0 || n === order.length - 1 || delta === 0) continue;
    moved.push(transformItem(item, horizontal ? { dx: delta } : { dy: delta }));
  }
  if (moved.length === 0) return [];
  scene.update(moved);
  return moved;
}
