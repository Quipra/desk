import assert from "node:assert/strict";
import test from "node:test";

import { Paper, pathProgress, smooth } from "../src/paper.ts";
import { bbox, PEN_PRESETS, Scene } from "../src/scene.ts";
import { registerDesk } from "../src/webmcp.ts";
import { describe } from "../src/look.ts";
import { inkColor, THEMES } from "../src/appearance.ts";
import { pencilStudy, runPencilStudy, STUDY_SENTENCE } from "../src/pencil-study.ts";
import { Instruments } from "../src/instruments.ts";

test("animation waiters settle after erase, undo, clear, and replay", async (t) => {
  for (const mutation of ["erase", "undo", "clear"] as const) {
    await t.test(mutation, async () => {
      const { scene, paper, runNextFrame } = paperHarness();
      const item = scene.add(
        { kind: "line", from: { x: 0, y: 0 }, to: { x: 1200, y: 800 }, arrow: false },
        { label: "long line", author: "agent", pen: PEN_PRESETS.pencil },
      );
      runNextFrame(0);
      const idle = paper.whenIdle();

      if (mutation === "erase") scene.remove([item.id]);
      if (mutation === "undo") scene.undo("agent");
      if (mutation === "clear") scene.clear("blank");

      await resolvesSoon(idle);
      assert.equal(paper.busy, false);
    });
  }

  await t.test("replay", async () => {
    const { scene, paper, flushFrames } = paperHarness();
    scene.add(
      { kind: "line", from: { x: 100, y: 100 }, to: { x: 600, y: 100 }, arrow: false },
      { label: "human line", author: "human", pen: PEN_PRESETS.pencil },
    );
    paper.replay();
    const idle = paper.whenIdle();
    flushFrames();
    await resolvesSoon(idle);
    assert.equal(paper.busy, false);
  });
});

test("registration attempts all twelve tools and names each failure", async () => {
  const attempted: string[] = [];
  installDocument({
    registerTool(tool: { name: string }) {
      attempted.push(tool.name);
      if (tool.name === "compass") throw new Error("schema rejected");
    },
  });

  const desk = await registerDesk(new Scene(), idlePaper(), { onActivity() {} });

  assert.equal(attempted.length, 12);
  assert.equal(attempted.includes("write"), false);
  assert.equal(desk.registered.length, 11);
  assert.deepEqual(attempted, desk.names);
  assert.equal(desk.connected, false);
  assert.deepEqual(desk.registrationErrors, ["compass: schema rejected"]);
});

test("registration classifies three read tools and nine state-changing tools", async () => {
  const registered: { name: string; annotations?: { readOnlyHint?: boolean } }[] = [];
  installDocument({ registerTool(tool) { registered.push(tool); } });
  const desk = await registerDesk(new Scene(), idlePaper(), { onActivity() {} });

  assert.equal(desk.connected, true);
  assert.deepEqual(registered.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name), ["guide", "look", "measure"]);
  assert.deepEqual(registered.filter((tool) => tool.annotations?.readOnlyHint === false).map((tool) => tool.name), [
    "pick_pen", "draw", "ruler", "compass", "stencil", "erase", "undo", "new_sheet", "construct",
  ]);
  assert.equal(registered.filter((tool) => typeof tool.annotations?.readOnlyHint !== "boolean").length, 0);
  desk.dispose();
});

// Chat hosts convert tool schemas to strict function schemas; keywords outside
// this subset make the whole tool unusable there.
test("tool schemas use only the host-safe JSON Schema subset", async () => {
  const registered: { name: string; inputSchema: unknown }[] = [];
  installDocument({ registerTool(tool) { registered.push(tool); } });
  await registerDesk(new Scene(), idlePaper(), { onActivity() {} });
  const allowed = new Set(["type", "properties", "required", "enum", "items", "description", "additionalProperties"]);
  const walk = (node: unknown, where: string) => {
    if (Array.isArray(node)) return;
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (where.endsWith(".properties")) {
        walk(value, `${where}.${key}`);
        continue;
      }
      assert.ok(allowed.has(key), `${where}.${key} is not in the safe schema subset`);
      walk(value, `${where}.${key}`);
    }
  };
  assert.equal(registered.length, 12);
  for (const tool of registered) walk(tool.inputSchema, tool.name);
});

test("construct runs steps in order with the shared pen and stops at the first bad step", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  const result = await desk.call("construct", {
    steps: [
      { tool: "pick_pen", kind: "marker", width: 5 },
      { tool: "ruler", from: { x: 300, y: 500 }, to: { x: 700, y: 500 }, label: "segment AB" },
      { tool: "compass", center: { x: 300, y: 500 }, radius: 260, label: "arc from A" },
      { tool: "ruler", from: { x: -5, y: 0 }, to: { x: 1, y: 1 }, label: "off paper" },
      { tool: "undo" },
    ],
  }) as { done: number; results: unknown[]; error?: string };
  assert.equal(result.done, 3);
  assert.equal(result.results.length, 3);
  assert.match(result.error ?? "", /^step 3 \(ruler\): from\.x/);
  assert.equal(scene.items.length, 2);
  assert.equal(scene.items[0].pen.width, 5);
  assert.deepEqual(await desk.call("construct", { steps: [{ tool: "guide" }] }), { done: 0, results: [], error: "step 0: tool must be one of pick_pen, draw, ruler, compass, stencil, erase, undo" });
  const guide = await desk.call("guide") as { guide: string; tools: string[] };
  assert.ok(guide.guide.includes("1200 wide x 800 tall"));
  assert.equal(guide.tools.length, 12);
});

test("grouped strokes preserve pen lifts and undo as one mark", async () => {
  const { scene, paper, flushFrames } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  const strokes = [[{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 400, y: 100 }, { x: 500, y: 100 }]];
  const result = await desk.call("draw", { strokes, label: "two strokes" }) as { strokes: number };
  assert.equal(result.strokes, 2);
  assert.equal(scene.items.length, 1);
  const item = scene.items[0];
  assert.equal(item.kind, "stroke");
  if (item.kind !== "stroke") throw new Error("expected stroke");
  assert.deepEqual(item.paths.map((path) => path.map(({ x, y }) => ({ x, y }))), strokes);
  assert.deepEqual(pathProgress(item.paths, 0.5).map((p) => p.progress), [1, 0]);
  assert.equal(describe(scene).raster.rows[4][12], ".", "pen lift must not paint the gap");
  flushFrames();
  await desk.call("undo");
  assert.equal(scene.items.length, 0);
});

test("invalid grouped input is atomic and prototype pen names are rejected", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  for (const input of [
    { points: [{ x: 1, y: 1 }], strokes: [[{ x: 1, y: 1 }]], label: "both" },
    { strokes: [[{ x: 1, y: 1 }], [{ x: -1, y: 1 }]], label: "bad second path" },
    { strokes: Array.from({ length: 65 }, () => [{ x: 1, y: 1 }]), label: "too many paths" },
    { points: Array.from({ length: 2001 }, () => ({ x: 1, y: 1 })), label: "too many points" },
  ]) {
    assert.ok("error" in (await desk.call("draw", input) as object));
    assert.equal(scene.items.length, 0);
  }
  assert.ok("error" in (await desk.call("pick_pen", { kind: "toString" }) as object));
});

test("look detail is bounded, paginated and can inspect without waiting for ink", async () => {
  const { scene, paper } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  for (let n = 0; n < 3; n++) await desk.call("draw", { label: `mark ${n}`, points: Array.from({ length: 100 }, (_, i) => ({ x: 100 + i, y: 100 + n * 100 })) });
  const result = await desk.call("look", { detail: true, wait: false, limit: 1 }) as ReturnType<typeof describe> & { drawing: boolean; appearance: { theme: string } };
  assert.equal(result.drawing, true);
  assert.equal(result.appearance.theme, "charcoal");
  assert.equal(result.count, 3);
  assert.equal(result.items.length, 1);
  assert.equal(result.nextOffset, 1);
  const geometry = result.items[0].geometry;
  assert.equal(geometry?.kind, "stroke");
  if (geometry?.kind !== "stroke") throw new Error("expected stroke geometry");
  assert.equal(geometry.paths[0].length, 32);
  assert.equal(geometry.sampled, true);
  const region = await desk.call("look", { wait: false, region: { x: 80, y: 180, w: 150, h: 40 } }) as ReturnType<typeof describe>;
  assert.equal(region.matched, 1);
  assert.equal(region.items[0].label, "mark 1");
});

test("cancelled look rejects without cancelling other waiters or deleting marks", async () => {
  const { scene, paper, flushFrames } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  await desk.call("draw", { points: [{ x: 100, y: 100 }, { x: 500, y: 100 }], label: "line" });
  const controller = new AbortController();
  const rejected = assert.rejects(desk.call("look", {}, { signal: controller.signal }), { name: "AbortError" });
  const other = paper.whenIdle();
  controller.abort();
  await rejected;
  assert.equal(scene.items.length, 1);
  flushFrames();
  await resolvesSoon(other);
  desk.dispose();
  await assert.rejects(desk.call("undo"), { name: "AbortError" });
  assert.equal(scene.items.length, 1);
});

test("compass rejects enormous spans and preserves counterclockwise geometry", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {} });
  for (const end of [1e308, 1000, 0]) {
    assert.ok("error" in (await desk.call("compass", { center: { x: 500, y: 300 }, radius: 100, end, label: "bad" }) as object));
  }
  assert.equal(scene.items.length, 0);
  await desk.call("compass", { center: { x: 500, y: 300 }, radius: 100, start: 0, end: -90, label: "quarter arc" });
  assert.ok(bbox(scene.items[0]).y < 201);
  assert.equal(describe(scene).count, 1);
});

test("charcoal and paper ink stay readable without changing explicit colors", () => {
  assert.equal(inkColor("auto", "charcoal"), THEMES.charcoal.ink);
  assert.equal(inkColor("auto", "paper"), THEMES.paper.ink);
  assert.equal(inkColor("#123456", "charcoal"), "#123456");
  for (const theme of Object.values(THEMES)) {
    assert.ok(contrast(theme.ink, theme.paper) >= 7);
    assert.ok(contrast(theme.muted, theme.desk) >= 4.5);
  }
});

test("pencil study uses the exact sentence, only drawing tools, and stays inside the sheet", async () => {
  installDocument({ registerTool() {} });
  const scene = new Scene();
  const invoked: string[] = [];
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {}, onTool(name) { invoked.push(name); } });
  assert.equal(pencilStudy().map((word) => word.label).join(" "), STUDY_SENTENCE);
  await runPencilStudy(desk.call);
  assert.deepEqual([...new Set(invoked)], ["pick_pen", "draw"]);
  assert.equal(scene.items.length, pencilStudy().length);
  for (const item of scene.items) {
    assert.equal(item.kind, "stroke");
    assert.equal(item.pen.kind, "pencil");
    const b = bbox(item);
    assert.ok(b.x > 100 && b.x + b.w < 1120 && b.y > 70 && b.y + b.h < 740, `${item.label}: ${JSON.stringify(b)}`);
  }
});

test("reduced motion settles the entire pencil study in one frame", async () => {
  const { scene, paper, runNextFrame } = paperHarness();
  installDocument({ registerTool() {} });
  const desk = await registerDesk(scene, paper, { onActivity() {} });
  paper.reducedMotion = true;
  await runPencilStudy(desk.call);
  const idle = paper.whenIdle();
  runNextFrame(0);
  await resolvesSoon(idle);
  assert.equal(paper.busy, false);
});

test("smoothing never sends a valid edge stroke outside the paper", () => {
  const points = smooth([{ x: 0, y: 0 }, { x: 0, y: 700 }, { x: 1200, y: 800 }, { x: 1200, y: 0 }]);
  assert.ok(points.every((p) => p.x >= 0 && p.x <= 1200 && p.y >= 0 && p.y <= 800));
});

test("pointer ownership, coalesced samples, and the final pen-up coordinate are preserved", () => {
  const scene = new Scene();
  const listeners = new Map<string, (event: PointerEvent) => void>();
  const captures = new Set<number>();
  const canvas = {
    style: {},
    addEventListener(name: string, listener: (event: PointerEvent) => void) { listeners.set(name, listener); },
    setPointerCapture(id: number) { captures.add(id); },
    hasPointerCapture(id: number) { return captures.has(id); },
    releasePointerCapture(id: number) { captures.delete(id); },
  };
  const paper = { canvas, preview: null, render() {}, toPaper(e: PointerEvent) { return { x: e.clientX, y: e.clientY }; } } as unknown as Paper;
  const instruments = new Instruments(paper, scene);
  const event = (x: number, id = 1) => ({ clientX: x, clientY: 100, pointerId: id, pointerType: "mouse", button: 0, isPrimary: true, pressure: 0.5, preventDefault() {} }) as PointerEvent;
  const emit = (type: string, e: PointerEvent) => listeners.get(type)!(e);
  emit("pointerdown", event(100));
  emit("pointerdown", event(900, 2));
  emit("pointermove", event(1000, 2));
  const move = event(200);
  move.getCoalescedEvents = () => [event(150), event(200)];
  emit("pointermove", move);
  emit("pointerup", event(1100, 2));
  assert.equal(scene.items.length, 0);
  emit("pointerup", event(300));
  assert.equal(captures.size, 0);
  const item = scene.items[0];
  assert.equal(item.kind, "stroke");
  if (item.kind !== "stroke") throw new Error("expected stroke");
  assert.deepEqual(item.paths[0].map((p) => p.x), [100, 150, 200, 300]);

  emit("pointerdown", event(500));
  instruments.setMode("ruler");
  emit("pointerup", event(600));
  assert.equal(scene.items.length, 1, "changing instruments cancels the pending gesture");
  assert.equal(captures.size, 0);
  instruments.setMode("eraser");
  emit("pointerdown", event(250));
  emit("pointerup", event(250));
  assert.equal(scene.items.length, 0, "eraser hits the segment between sparse points");
});

test("native dispatch uses registered read/write callbacks, JSON input, and registration cleanup", async () => {
  type Registered = { name: string; execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> };
  const registered = new Map<string, Registered>();
  const sources: string[] = [];
  const mc = {
    registerTool(tool: Registered, options: { signal: AbortSignal }) {
      registered.set(tool.name, tool);
      options.signal.addEventListener("abort", () => registered.delete(tool.name), { once: true });
    },
    async getTools() { return [...registered.values()]; },
    async executeTool(tool: Registered, input: string) {
      assert.equal(typeof input, "string");
      return JSON.stringify(await tool.execute(JSON.parse(input)));
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext: mc } });
  const scene = new Scene();
  const human = scene.add(
    { kind: "line", from: { x: 20, y: 20 }, to: { x: 40, y: 20 }, arrow: false },
    { label: "person's mark", author: "human", pen: PEN_PRESETS.pencil },
  );
  const desk = await registerDesk(scene, idlePaper(), { onActivity() {}, onTool(_name, source) { sources.push(source); } });
  assert.equal(desk.connected, true);
  assert.ok(desk.nativeCall);
  const result = await desk.nativeCall("measure", { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }) as { length: number };
  assert.equal(result.length, 5);
  await desk.call("measure", { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } });
  assert.deepEqual(sources, ["webmcp", "local"]);
  await desk.nativeCall("pick_pen", { kind: "pencil", width: 4 });
  const drawn = await desk.nativeCall("draw", {
    points: [{ x: 100, y: 100 }, { x: 200, y: 180 }], label: "registered pencil gesture",
  }) as { id: string };
  assert.equal(scene.get(drawn.id)?.pen.width, 4);
  const beforeLook = JSON.stringify(scene.items);
  const looked = await desk.nativeCall("look", { wait: false }) as ReturnType<typeof describe>;
  assert.equal(looked.count, 2);
  assert.equal(JSON.stringify(scene.items), beforeLook, "read-only inspection leaves marks unchanged");
  await desk.nativeCall("undo");
  assert.deepEqual(scene.items.map((item) => item.id), [human.id]);
  assert.deepEqual(sources.slice(2), ["webmcp", "webmcp", "webmcp", "webmcp"]);
  desk.dispose();
  assert.equal(registered.size, 0);
});

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test("tool calls reject malformed values with field-specific errors", async () => {
  installDocument({ registerTool() {} });
  Object.defineProperty(globalThis, "CSS", { configurable: true, value: { supports: (_property: string, value: string) => value !== "not-a-color" } });
  const desk = await registerDesk(new Scene(), idlePaper(), { onActivity() {} });

  assert.deepEqual(
    await desk.call("ruler", { from: { x: "10", y: 20 }, to: { x: 30, y: 40 }, label: "line" }),
    { error: "from.x must be a finite number" },
  );
  assert.deepEqual(await desk.call("erase", {}), { error: "erase needs ids and/or a region" });
  assert.deepEqual(await desk.call("pick_pen", { kind: "marker", color: "not-a-color" }), { error: "color must be a valid CSS color" });
});

function installDocument(modelContext: { registerTool(tool: { name: string }): void }) {
  Object.defineProperty(globalThis, "document", { configurable: true, value: { modelContext } });
}

function idlePaper(): Paper {
  return { busy: false, whenIdle: () => Promise.resolve() } as Paper;
}

function paperHarness() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let rafId = 0;
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: {} } });
  Object.defineProperty(globalThis, "getComputedStyle", { configurable: true, value: () => ({ getPropertyValue: () => "#5b5bd6" }) });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      const id = ++rafId;
      callbacks.set(id, callback);
      return id;
    },
  });

  const noop = () => {};
  const context = {
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
    strokeText: noop,
    fillText: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
  } as unknown as CanvasRenderingContext2D;
  const canvas = {
    getContext: () => context,
    style: {},
  } as unknown as HTMLCanvasElement;
  const scene = new Scene();
  const paper = new Paper(canvas, scene);

  const runNextFrame = (now: number) => {
    const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    assert.ok(entry, "expected a queued animation frame");
    callbacks.delete(entry[0]);
    entry[1](now);
  };
  const flushFrames = () => {
    let now = 0;
    for (let count = 0; callbacks.size > 0 && count < 20; count++) {
      runNextFrame(now);
      now += 2000;
    }
    assert.equal(callbacks.size, 0, "animation did not finish within 20 frames");
  };

  return { scene, paper, runNextFrame, flushFrames };
}

async function resolvesSoon(promise: Promise<void>) {
  await Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("animation waiter did not settle")), 100)),
  ]);
}
