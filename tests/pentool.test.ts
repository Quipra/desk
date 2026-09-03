import assert from "node:assert/strict";
import test from "node:test";

import type { Paper } from "../src/paper.ts";
import { mountPenTool } from "../src/pentool.ts";
import { Scene } from "../src/scene.ts";
import { Instruments } from "../src/instruments.ts";

// The pen tool talks to the canvas, the paper's view, and the window's keys.
// This harness is the smallest stand-in for all three that still exercises the
// real gesture code: pointer events in, scene items out.
function harness() {
  const pointers = new Map<string, ((event: PointerEvent) => void)[]>();
  const keys: ((event: KeyboardEvent) => void)[] = [];
  const captures = new Set<number>();
  const canvas = {
    style: {},
    addEventListener(name: string, listener: (event: PointerEvent) => void) {
      const list = pointers.get(name) ?? [];
      list.push(listener);
      pointers.set(name, list);
    },
    setPointerCapture(id: number) { captures.add(id); },
    hasPointerCapture(id: number) { return captures.has(id); },
    releasePointerCapture(id: number) { captures.delete(id); },
  } as unknown as HTMLCanvasElement;
  const paper = {
    canvas,
    scale: 1,
    view: { k: 1, x: 0, y: 0 },
    overlay: null,
    preview: null,
    invalidate() {},
    render() {},
    toPaper(e: { clientX: number; clientY: number }) { return { x: e.clientX, y: e.clientY }; },
  } as unknown as Paper;

  const previous = Reflect.get(globalThis, "window");
  Reflect.set(globalThis, "window", {
    addEventListener(_name: string, listener: (event: KeyboardEvent) => void) { keys.push(listener); },
  });
  const scene = new Scene();
  const instruments = new Instruments(paper, scene);
  const tool = mountPenTool({ scene, paper, instruments, canvas });
  Reflect.set(globalThis, "window", previous);
  instruments.setMode("path");

  let id = 0;
  const emit = (type: string, x: number, y: number, pointerId = id) => {
    const event = {
      clientX: x, clientY: y, pointerId, pointerType: "mouse", button: 0, isPrimary: true, pressure: 0.5,
      preventDefault() {}, stopImmediatePropagation() {},
    } as unknown as PointerEvent;
    for (const listener of pointers.get(type) ?? []) listener(event);
  };
  return {
    scene,
    paper,
    instruments,
    tool,
    /** A click: press and release without moving. */
    click(x: number, y: number) {
      id += 1;
      emit("pointerdown", x, y);
      emit("pointerup", x, y);
    },
    /** Press at the anchor, pull a handle out to (hx, hy), release. */
    dragHandle(x: number, y: number, hx: number, hy: number) {
      id += 1;
      emit("pointerdown", x, y);
      emit("pointermove", hx, hy);
      emit("pointerup", hx, hy);
    },
    press(key: string) {
      const event = { key, preventDefault() {}, target: null } as unknown as KeyboardEvent;
      for (const listener of keys) listener(event);
    },
  };
}

test("click, click, Enter commits a two-point straight path", () => {
  const desk = harness();
  desk.click(100, 100);
  desk.click(300, 200);
  assert.equal(desk.scene.items.length, 0, "nothing is committed while the path is being drawn");
  desk.press("Enter");

  assert.equal(desk.scene.items.length, 1);
  const item = desk.scene.items[0];
  assert.equal(item.kind, "path");
  if (item.kind !== "path") throw new Error("expected a path");
  assert.deepEqual(item.segments, [
    { c: "M", x: 100, y: 100 },
    { c: "L", x: 300, y: 200 },
  ]);
  assert.equal(item.author, "human");
  assert.equal(item.label, "path");
  assert.equal(desk.paper.overlay, null, "the overlay is handed back after committing");
});

test("dragging an anchor pulls out symmetric handles and curves the segment", () => {
  const desk = harness();
  desk.click(100, 100);
  desk.dragHandle(300, 100, 340, 180);
  desk.click(500, 100);
  desk.press("Enter");

  const item = desk.scene.items[0];
  if (item.kind !== "path") throw new Error("expected a path");
  assert.deepEqual(item.segments, [
    { c: "M", x: 100, y: 100 },
    // Into the smooth anchor: the previous corner has no handle, so the first
    // control point sits on it and the second is the anchor's mirrored in-handle.
    { c: "C", x1: 100, y1: 100, x2: 260, y2: 20, x: 300, y: 100 },
    // Out of it: its out-handle leads, and the plain corner ends the curve.
    { c: "C", x1: 340, y1: 180, x2: 500, y2: 100, x: 500, y: 100 },
  ]);
});

test("clicking the first anchor closes the path", () => {
  const desk = harness();
  desk.click(100, 100);
  desk.click(300, 100);
  desk.click(300, 300);
  desk.click(103, 102);

  const item = desk.scene.items[0];
  if (item.kind !== "path") throw new Error("expected a path");
  assert.deepEqual(item.segments, [
    { c: "M", x: 100, y: 100 },
    { c: "L", x: 300, y: 100 },
    { c: "L", x: 300, y: 300 },
    { c: "Z" },
  ]);
});

test("a curved closing edge keeps the facing handles before Z", () => {
  const desk = harness();
  desk.dragHandle(100, 100, 100, 40);
  desk.click(300, 300);
  desk.click(100, 100);

  const item = desk.scene.items[0];
  if (item.kind !== "path") throw new Error("expected a path");
  assert.equal(item.segments.length, 4);
  assert.deepEqual(item.segments[2], { c: "C", x1: 300, y1: 300, x2: 100, y2: 160, x: 100, y: 100 });
  assert.deepEqual(item.segments.at(-1), { c: "Z" });
});

test("Escape leaves the scene untouched and Backspace drops the last anchor", () => {
  const desk = harness();
  desk.click(100, 100);
  desk.click(300, 200);
  desk.tool.cancel();
  assert.deepEqual(desk.scene.items, []);
  desk.press("Enter");
  assert.deepEqual(desk.scene.items, [], "a cancelled path cannot be revived");

  desk.click(100, 100);
  desk.click(300, 200);
  desk.click(400, 400);
  desk.press("Backspace");
  desk.press("Enter");
  const item = desk.scene.items[0];
  if (item.kind !== "path") throw new Error("expected a path");
  assert.deepEqual(item.segments, [
    { c: "M", x: 100, y: 100 },
    { c: "L", x: 300, y: 200 },
  ]);
});

test("a lone anchor is not a mark, and points land inside the sheet", () => {
  const desk = harness();
  desk.click(100, 100);
  desk.press("Enter");
  assert.deepEqual(desk.scene.items, [], "one anchor is not a path");

  desk.click(-40, 900);
  desk.click(1400, 100);
  desk.press("Enter");
  const item = desk.scene.items[0];
  if (item.kind !== "path") throw new Error("expected a path");
  assert.deepEqual(item.segments, [
    { c: "M", x: 0, y: 800 },
    { c: "L", x: 1200, y: 100 },
  ]);
});

test("gestures are ignored outside path mode", () => {
  const desk = harness();
  desk.instruments.setMode("pen");
  desk.click(100, 100);
  desk.click(300, 200);
  desk.press("Enter");
  assert.equal(desk.paper.overlay, null);
  assert.equal(desk.scene.items.filter((i) => i.kind === "path").length, 0);
});
