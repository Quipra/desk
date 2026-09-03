// Stub: replaced by the arrange implementation.
import type { Item, Scene } from "./scene.ts";

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Axis = "horizontal" | "vertical";

/** Align the given marks to each other (or to the paper when `toPaper`). Returns the changed items. */
export function align(_scene: Scene, _ids: string[], _how: Align, _toPaper = false): Item[] {
  return [];
}

/** Space the given marks evenly along an axis. Returns the changed items. */
export function distribute(_scene: Scene, _ids: string[], _axis: Axis): Item[] {
  return [];
}
