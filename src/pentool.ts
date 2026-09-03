// Stub: replaced by the pen-tool implementation.
import type { Instruments } from "./instruments.ts";
import type { Paper } from "./paper.ts";
import type { Scene } from "./scene.ts";

export interface PenToolContext {
  scene: Scene;
  paper: Paper;
  instruments: Instruments;
  canvas: HTMLCanvasElement;
}

export interface PenTool {
  cancel(): void;
}

export function mountPenTool(_ctx: PenToolContext): PenTool {
  return { cancel() {} };
}
