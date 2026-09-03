import assert from "node:assert/strict";
import test from "node:test";

import { mountSelect } from "../src/select.ts";
import { PEN_PRESETS, Scene, type Geometry, type Item, type Pt } from "../src/scene.ts";
import type { Instruments } from "../src/instruments.ts";
import type { Paper } from "../src/paper.ts";

test("a marquee picks up every mark whose bounds it crosses", () => {
  const desk = selectHarness();
  const near = desk.line("near", { x: 100, y: 100 }, { x: 200, y: 100 });
  const alsoNear = desk.line("also", { x: 150, y: 200 }, { x: 160, y: 210 });
  desk.line("far", { x: 600, y: 600 }, { x: 700, y: 700 });

  desk.down(50, 50);
  desk.move(250, 250);
  desk.up(250, 250);

  assert.deepEqual(desk.selection.selected().sort(), [near.id, alsoNear.id].sort());
  assert.deepEqual(desk.announced.at(-1)?.sort(), [near.id, alsoNear.id].sort());
});

test("clicking one mark of a group takes the group, and double-clicking takes the mark", () => {
  const desk = selectHarness();
  const top = desk.line("top", { x: 300, y: 300 }, { x: 500, y: 300 }, "box");
  const left = desk.line("left", { x: 300, y: 300 }, { x: 300, y: 500 }, "box");
  const brace = desk.line("brace", { x: 320, y: 480 }, { x: 480, y: 320 }, "box");
  const loose = desk.line("loose", { x: 800, y: 300 }, { x: 900, y: 300 });

  desk.click(400, 400);
  assert.deepEqual(desk.selection.selected().sort(), [top.id, left.id, brace.id].sort());

  desk.click(400, 400);
  assert.deepEqual(desk.selection.selected(), [brace.id], "the second click inside the double window isolates the mark");

  desk.click(850, 300);
  assert.deepEqual(desk.selection.selected(), [loose.id]);

  desk.shiftClick(400, 400);
  assert.deepEqual(desk.selection.selected().sort(), [loose.id, top.id, left.id, brace.id].sort(), "shift adds the group");

  desk.shiftClick(860, 300);
  assert.deepEqual(desk.selection.selected().sort(), [top.id, left.id, brace.id].sort(), "shift toggles the lone mark back out");
});

test("dragging inside the selection moves its geometry, and arrow keys nudge it", () => {
  const desk = selectHarness();
  const line = desk.line("rail", { x: 100, y: 100 }, { x: 200, y: 100 });

  desk.down(150, 100);
  desk.move(150, 140);
  desk.up(150, 140);

  const moved = desk.scene.get(line.id) as Extract<Item, { kind: "line" }>;
  assert.deepEqual([moved.from.x, moved.from.y], [100, 140]);
  assert.deepEqual([moved.to.x, moved.to.y], [200, 140]);

  desk.key("ArrowRight");
  desk.key("ArrowDown", { shiftKey: true });
  const nudged = desk.scene.get(line.id) as Extract<Item, { kind: "line" }>;
  assert.deepEqual([nudged.from.x, nudged.from.y], [101, 150]);
});

test("an edge handle stretches one axis about the opposite edge", () => {
  const desk = selectHarness();
  const top = desk.line("top", { x: 100, y: 100 }, { x: 300, y: 100 });
  const bottom = desk.line("bottom", { x: 100, y: 300 }, { x: 300, y: 300 });
  desk.selection.select([top.id, bottom.id]);

  // Bounds are padded by the pen width, so the east handle sits at x = 302.5.
  desk.down(302.5, 200);
  desk.move(507.5, 200);
  desk.up(507.5, 200);

  const wide = desk.scene.get(top.id) as Extract<Item, { kind: "line" }>;
  assert.deepEqual([wide.from.x, wide.from.y], [102.5, 100], "x doubles about the west edge, y is untouched");
  assert.deepEqual([wide.to.x, wide.to.y], [502.5, 100]);
});

test("the rotate handle turns the selection about its center", () => {
  const desk = selectHarness();
  const line = desk.line("rail", { x: 100, y: 100 }, { x: 200, y: 100 });
  desk.selection.select([line.id]);

  desk.down(150, 74);
  desk.move(250, 100);
  desk.up(250, 100);

  const turned = desk.scene.get(line.id) as Extract<Item, { kind: "line" }>;
  assert.deepEqual([Math.round(turned.from.x), Math.round(turned.from.y)], [150, 50]);
  assert.deepEqual([Math.round(turned.to.x), Math.round(turned.to.y)], [150, 150]);
});

test("duplicate offsets the copies, keeps their pen and group, and selects them", () => {
  const desk = selectHarness();
  const line = desk.line("rail", { x: 100, y: 100 }, { x: 200, y: 100 }, "box");
  desk.selection.select([line.id]);

  desk.selection.duplicateSelected();

  assert.equal(desk.scene.items.length, 2);
  const copy = desk.scene.items[1] as Extract<Item, { kind: "line" }>;
  assert.notEqual(copy.id, line.id);
  assert.deepEqual([copy.from.x, copy.from.y], [120, 120]);
  assert.deepEqual([copy.to.x, copy.to.y], [220, 120]);
  assert.equal(copy.group, "box");
  assert.equal(copy.label, "rail");
  assert.equal(copy.pen.kind, "pencil");
  assert.deepEqual(desk.selection.selected(), [copy.id]);
  assert.deepEqual(desk.announced.at(-1), [copy.id]);
});

test("delete removes the marks and empties the selection", () => {
  const desk = selectHarness();
  const a = desk.line("a", { x: 100, y: 100 }, { x: 200, y: 100 });
  const b = desk.line("b", { x: 100, y: 300 }, { x: 200, y: 300 });
  desk.selection.select([a.id, b.id]);

  desk.selection.deleteSelected();

  assert.deepEqual(desk.scene.items, []);
  assert.deepEqual(desk.selection.selected(), []);
  assert.deepEqual(desk.announced.at(-1), []);
});

test("clearing the sheet drops the selection", () => {
  const desk = selectHarness();
  const a = desk.line("a", { x: 100, y: 100 }, { x: 200, y: 100 });
  desk.selection.select([a.id]);
  desk.scene.clear();
  assert.deepEqual(desk.selection.selected(), []);
});

test("other tools keep their gestures, and the overlay draws nothing, outside select mode", () => {
  const desk = selectHarness();
  desk.line("rail", { x: 100, y: 100 }, { x: 200, y: 100 });
  desk.instruments.mode = "pen";

  const swallowed = desk.down(150, 100);
  desk.up(150, 100);
  assert.equal(swallowed.stopped, 0, "select must not intercept another tool's pointer events");
  assert.deepEqual(desk.selection.selected(), []);
  assert.equal(desk.drawOverlay(), 0, "nothing is drawn while another tool is in hand");

  desk.instruments.mode = "select";
  desk.selection.select(desk.scene.items.map((i) => i.id));
  assert.ok(desk.drawOverlay() > 0, "the box and its handles are drawn in select mode");
});

function selectHarness() {
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const keys: ((event: KeyboardEvent) => void)[] = [];
  const captures = new Set<number>();
  let drawCalls = 0;

  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: {} } });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({ getPropertyValue: () => "#5b5bd6" }),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { addEventListener: (_name: string, fn: (event: KeyboardEvent) => void) => keys.push(fn) },
  });

  const canvas = {
    style: {} as { cursor?: string },
    addEventListener(name: string, listener: (event: PointerEvent) => void) { listeners.set(name, listener); },
    setPointerCapture(id: number) { captures.add(id); },
    hasPointerCapture(id: number) { return captures.has(id); },
    releasePointerCapture(id: number) { captures.delete(id); },
  } as unknown as HTMLCanvasElement;

  const paper = {
    canvas,
    scale: 1,
    view: { k: 1, x: 0, y: 0 },
    overlay: null,
    invalidate() {},
    toPaper(e: { clientX: number; clientY: number }) { return { x: e.clientX, y: e.clientY }; },
  } as unknown as Paper;

  const scene = new Scene();
  const instruments = { mode: "select" } as Instruments;
  const announced: string[][] = [];
  const selection = mountSelect({ scene, paper, instruments, canvas, onSelection: (ids) => announced.push(ids) });

  const emit = (type: string, x: number, y: number, opts: { shiftKey?: boolean } = {}) => {
    let stopped = 0;
    const event = {
      clientX: x,
      clientY: y,
      pointerId: 1,
      button: 0,
      isPrimary: true,
      detail: 1,
      shiftKey: opts.shiftKey === true,
      preventDefault() {},
      stopImmediatePropagation() { stopped += 1; },
    } as unknown as PointerEvent;
    listeners.get(type)!(event);
    return { stopped };
  };

  const noop = () => {};
  const recorder = {
    save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, arc: noop,
    setLineDash: noop,
    stroke: () => { drawCalls += 1; },
    fill: () => { drawCalls += 1; },
    fillRect: () => { drawCalls += 1; },
    strokeRect: () => { drawCalls += 1; },
  } as unknown as CanvasRenderingContext2D;

  return {
    scene,
    instruments,
    selection,
    announced,
    line(label: string, from: Pt, to: Pt, group?: string) {
      const geometry: Geometry = { kind: "line", from, to, arrow: false };
      return scene.add(geometry, { label, author: "human", pen: PEN_PRESETS.pencil, group });
    },
    down: (x: number, y: number, opts?: { shiftKey?: boolean }) => emit("pointerdown", x, y, opts),
    move: (x: number, y: number, opts?: { shiftKey?: boolean }) => emit("pointermove", x, y, opts),
    up: (x: number, y: number, opts?: { shiftKey?: boolean }) => emit("pointerup", x, y, opts),
    click(x: number, y: number) {
      emit("pointerdown", x, y);
      emit("pointerup", x, y);
    },
    shiftClick(x: number, y: number) {
      emit("pointerdown", x, y, { shiftKey: true });
      emit("pointerup", x, y, { shiftKey: true });
    },
    key(key: string, opts: { shiftKey?: boolean } = {}) {
      const event = { key, shiftKey: opts.shiftKey === true, target: null, preventDefault() {} } as unknown as KeyboardEvent;
      for (const fn of keys) fn(event);
    },
    drawOverlay() {
      drawCalls = 0;
      paper.overlay?.(recorder, { k: 1, scale: 1 });
      return drawCalls;
    },
  };
}
