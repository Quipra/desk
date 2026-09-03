// Stub: replaced by the select-tool implementation.
import type { Instruments } from "./instruments.ts";
import type { Paper } from "./paper.ts";
import type { Scene } from "./scene.ts";

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

export function mountSelect(_ctx: SelectContext): Selection {
  return { selected: () => [], select() {}, deleteSelected() {}, duplicateSelected() {} };
}
