// Stub: replaced by the inspector implementation.
import type { Instruments } from "./instruments.ts";
import type { Paper } from "./paper.ts";
import type { Scene } from "./scene.ts";

export interface InspectorContext {
  scene: Scene;
  paper: Paper;
  instruments: Instruments;
  host: HTMLElement;
  selection: () => string[];
}

export interface Inspector {
  refresh(): void;
}

export function mountInspector(_ctx: InspectorContext): Inspector {
  return { refresh() {} };
}
