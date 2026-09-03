import assert from "node:assert/strict";
import test from "node:test";

import { applyPatch } from "../src/inspector.ts";
import { Paper } from "../src/paper.ts";
import { PEN_PRESETS, Scene, type Item } from "../src/scene.ts";

test("a patch restyles every mark it is given and leaves the originals alone", () => {
  const scene = new Scene();
  const a = scene.add({ kind: "line", from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, arrow: false }, { label: "a", author: "human", pen: PEN_PRESETS.pencil });
  const b = scene.add({ kind: "line", from: { x: 0, y: 0 }, to: { x: 20, y: 20 }, arrow: false }, { label: "b", author: "human", pen: PEN_PRESETS.marker });

  const next = applyPatch([a, b], { pen: { color: "#3b82f6", width: 12 } });

  assert.deepEqual(next.map((i) => i.pen.color), ["#3b82f6", "#3b82f6"]);
  assert.deepEqual(next.map((i) => i.pen.width), [12, 12]);
  // Each mark keeps the rest of its own pen: the marker stays a marker.
  assert.deepEqual(next.map((i) => i.pen.kind), ["pencil", "marker"]);
  assert.deepEqual(next.map((i) => i.id), [a.id, b.id]);

  assert.equal(a.pen.color, "auto");
  assert.equal(b.pen.width, PEN_PRESETS.marker.width);
  assert.notEqual(next[0], a);
  assert.notEqual(next[0].pen, a.pen);
});

test("a setting patched to undefined is removed rather than stored empty", () => {
  const item = mark({ ...PEN_PRESETS.brush, fill: "hatch", hatchAngle: 20, texture: "chalk", fillColor: "#22a06b", dash: true });

  const [cleared] = applyPatch([item], { pen: { fill: undefined, texture: undefined, fillColor: undefined, dash: undefined } });

  assert.equal("fill" in cleared.pen, false);
  assert.equal("texture" in cleared.pen, false);
  assert.equal("fillColor" in cleared.pen, false);
  assert.equal("dash" in cleared.pen, false);
  // Untouched settings survive the clear.
  assert.equal(cleared.pen.hatchAngle, 20);
  assert.equal(cleared.pen.kind, "brush");
});

test("label, group and hidden are mark-level edits, and empty means none", () => {
  const item = mark(PEN_PRESETS.pencil);

  const [named] = applyPatch([item], { label: "roof line", group: "sketch", hidden: true });
  assert.equal(named.label, "roof line");
  assert.equal(named.group, "sketch");
  assert.equal(named.hidden, true);

  const [bare] = applyPatch([named], { group: "", hidden: false });
  assert.equal("group" in bare, false);
  assert.equal("hidden" in bare, false);
  assert.equal(bare.label, "roof line", "an absent label leaves the name alone");
});

test("effects round-trip through the scene", () => {
  const scene = new Scene();
  const item = scene.add({ kind: "shape", shape: "rectangle", x: 100, y: 100, w: 60, h: 40, rotation: 0, sides: 4 }, { label: "box", author: "human", pen: PEN_PRESETS.fineliner });
  const changes: string[][] = [];
  scene.on((event) => {
    if (event.type === "change") changes.push(event.ids);
  });

  const effects = { shadow: { dx: 4, dy: 6, blur: 8, color: "#000000" }, glow: { blur: 12, color: "#5b5bd6" }, blur: 3 };
  scene.update(applyPatch([item], { pen: effects }));

  const stored = scene.get(item.id)!;
  assert.deepEqual(stored.pen.shadow, effects.shadow);
  assert.deepEqual(stored.pen.glow, effects.glow);
  assert.equal(stored.pen.blur, 3);
  assert.deepEqual(changes, [[item.id]]);

  scene.update(applyPatch([stored], { pen: { shadow: undefined, glow: undefined, blur: undefined } }));
  const plain = scene.get(item.id)!.pen;
  assert.deepEqual([plain.shadow, plain.glow, plain.blur], [undefined, undefined, undefined]);
});

// Canvas shadows and filters are measured in device pixels, so what the renderer
// hands the context has to carry the view's scale or effects shrink as you zoom.
test("effects reach the canvas scaled into device space", () => {
  const scaled = renderPen({ ...PEN_PRESETS.fineliner, shadow: { dx: 4, dy: -6, blur: 8, color: "#123456" }, blur: 3 });
  assert.equal(scaled.shadowOffsetX, 8);
  assert.equal(scaled.shadowOffsetY, -12);
  assert.equal(scaled.shadowBlur, 16);
  assert.equal(scaled.shadowColor, "#123456");
  assert.equal(scaled.filter, "blur(6px)");

  // One shadow slot: a glow takes it over, centred on the mark.
  const glowing = renderPen({ ...PEN_PRESETS.fineliner, shadow: { dx: 4, dy: 4, blur: 8, color: "#123456" }, glow: { blur: 5, color: "#5b5bd6" } });
  assert.equal(glowing.shadowOffsetX, 0);
  assert.equal(glowing.shadowOffsetY, 0);
  assert.equal(glowing.shadowBlur, 10);
  assert.equal(glowing.shadowColor, "#5b5bd6");

  const plain = renderPen(PEN_PRESETS.fineliner);
  assert.equal(plain.shadowBlur, 0);
  assert.equal(plain.filter, "none");
});

function mark(pen: Item["pen"]): Item {
  const scene = new Scene();
  return scene.add({ kind: "line", from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, arrow: false }, { label: "mark", author: "human", pen });
}

/** Draw one mark with the given pen and report the context state it left behind. */
function renderPen(pen: Item["pen"]) {
  const callbacks: FrameRequestCallback[] = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: {} } });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "#5b5bd6" }) });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => callbacks.push(callback),
  });

  const noop = () => {};
  // A recording stand-in for a 2D context: assignments stick so the test can read
  // them back, and the transform reports a 2x view.
  const context = {
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    shadowColor: "rgba(0, 0, 0, 0)",
    filter: "none",
    globalAlpha: 1,
    getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }),
    setTransform: noop,
    fillRect: noop,
    beginPath: noop,
    moveTo: noop,
    lineTo: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    arc: noop,
    fill: noop,
    closePath: noop,
    clip: noop,
    rect: noop,
    strokeRect: noop,
    strokeText: noop,
    fillText: noop,
    setLineDash: noop,
    drawImage: noop,
    clearRect: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  } as unknown as CanvasRenderingContext2D;
  const canvas = { getContext: () => context, style: {} } as unknown as HTMLCanvasElement;

  const scene = new Scene();
  const paper = new Paper(canvas, scene);
  scene.add({ kind: "line", from: { x: 100, y: 100 }, to: { x: 400, y: 300 }, arrow: false }, { label: "mark", author: "human", pen });
  paper.render(0);

  return context;
}
